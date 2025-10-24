import os
import uuid
import json
import time
from typing import Any, Dict, List, Optional

import requests
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# (opcional) .env
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except Exception:
    pass

DATABASE_URL = os.getenv("DATABASE_URL", "")
NOMINATIM_URL = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org")
USER_AGENT = os.getenv("USER_AGENT", "lisboa-percepcoes/1.0 (academic use)")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:5173")

# BBOX Lisboa
LISBON_BBOX = (-9.25, 38.69, -9.05, 38.80)
VIEWBOX = f"{LISBON_BBOX[0]},{LISBON_BBOX[3]},{LISBON_BBOX[2]},{LISBON_BBOX[1]}"

app = FastAPI(title="Lisboa Percepções – API (dev)")

ALLOWED_ORIGINS = {
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:5174", "http://127.0.0.1:5174",
    "http://localhost:5175", "http://127.0.0.1:5175",
    ALLOWED_ORIGIN,
}
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================[ NOVO ]=====================
# Handler global para devolver JSON legível quando houver 500
@app.exception_handler(Exception)
async def all_exceptions_handler(request: Request, exc: Exception):
    # Mostra no terminal E retorna JSON para o frontend.
    print("\n=== Unhandled Exception ===")
    print(repr(exc))
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": f"{type(exc).__name__}: {str(exc)}"},
    )
# =================================================

# ----- modelos (mantidos) -----
class ManualPolygon(BaseModel):
    name: str
    importance_1_5: int
    comment: Optional[str] = None
    geojson: Dict[str, Any]

class Selection(BaseModel):
    theme_code: str
    osm_id: Optional[int] = None
    osm_type: Optional[str] = None
    display_name: Optional[str] = None
    osm_class: Optional[str] = None
    osm_feature_type: Optional[str] = None
    geojson: Optional[Dict[str, Any]] = None
    importance_1_5: Optional[int] = None
    comment: Optional[str] = None
    manual_polygon: Optional[ManualPolygon] = None

class SubmitPayload(BaseModel):
    participant_id: str
    selections: List[Selection]

@app.get("/health")
def health():
    return {"status": "ok"}

@app.api_route("/consent", methods=["GET", "POST"])
def consent():
    pid = str(uuid.uuid4())
    return {"participant_id": pid}

@app.post("/profile")
async def profile(request: Request, participant_id: Optional[str] = Query(None)):
    """
    Recebe o perfil do participante (assíncrono para evitar 500).
    """
    data: Dict[str, Any] = {}
    try:
        data = await request.json()
        if not isinstance(data, dict):
            data = {"payload": data}
    except Exception:
        try:
            raw = await request.body()
            data = json.loads((raw or b"{}").decode("utf-8") or "{}")
            if not isinstance(data, dict):
                data = {"payload": data}
        except Exception:
            data = {}

    # Se quiser gravar o perfil, implemente aqui (tabela public.profiles)
    return {"ok": True, "participant_id": participant_id, "received": data}


@app.get("/geocode")
def geocode(q: str = Query(..., min_length=2)):
    """
    Proxy para Nominatim com:
      - viewbox Lisboa + bounded=1 (reduz ruído/erros)
      - Accept-Language=pt
      - tratamento de 429 Retry-After
    """
    url = f"{NOMINATIM_URL.rstrip('/')}/search"
    params = {
        "q": q,
        "format": "jsonv2",
        "polygon_geojson": 1,
        "addressdetails": 0,
        "limit": 10,
        "dedupe": 1,
        "extratags": 0,
        "namedetails": 0,
        "viewbox": VIEWBOX,
        "bounded": 1,
    }
    headers = {
        "User-Agent": USER_AGENT,
        "Accept-Language": "pt",
    }

    try:
        r = requests.get(url, params=params, headers=headers, timeout=15)
        # Lida gentilmente com rate-limit
        if r.status_code == 429:
            retry = int(r.headers.get("Retry-After", "1"))
            time.sleep(min(retry, 3))
            r = requests.get(url, params=params, headers=headers, timeout=15)

        r.raise_for_status()
        results = r.json()

        # Segurança extra: devolve só features com geojson poligonal
        filtered: List[Dict[str, Any]] = []
        for item in results:
            gj = item.get("geojson")
            if not isinstance(gj, dict):
                continue
            if gj.get("type") not in ("Polygon", "MultiPolygon"):
                continue
            filtered.append(item)

        return {"results": filtered}

    except requests.exceptions.Timeout:
        return {"results": [], "error": "Tempo de espera excedido (timeout) ao consultar Nominatim."}
    except requests.exceptions.HTTPError as e:
        status = getattr(e.response, "status_code", None)
        msg = f"Erro HTTP {status} do Nominatim." if status else "Erro HTTP do Nominatim."
        return {"results": [], "error": msg}
    except Exception as e:
        return {"results": [], "error": f"Erro de rede: {str(e)}"}


@app.post("/submit")
def submit(payload: SubmitPayload):
    """
    Grava seleções (OSM/Manuais). Apenas aceita polígonos.
    """
    if not payload.participant_id:
        return {"ok": False, "error": "participant_id em falta"}
    if not payload.selections:
        return {"ok": True, "participant_id": payload.participant_id, "saved": 0}

    saved = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            ensure_participant(cur, payload.participant_id)

            for sel in payload.selections:
                # resolve/insere theme
                theme_id = fetch_theme_id(cur, sel.theme_code)
                if theme_id is None:
                    cur.execute(
                        "INSERT INTO public.themes (code) VALUES (%s) ON CONFLICT (code) DO NOTHING RETURNING id",
                        (sel.theme_code,),
                    )
                    row = cur.fetchone()
                    theme_id = int(row[0]) if row else fetch_theme_id(cur, sel.theme_code)

                if sel.manual_polygon:
                    mp = sel.manual_polygon
                    gj = mp.geojson or {}
                    if gj.get("type") not in ("Polygon", "MultiPolygon"):
                        continue
                    cur.execute(
                        """
                        INSERT INTO public.user_polygons
                          (participant_id, theme_id, name, importance_1_5, comment, geom)
                        VALUES
                          (%s, %s, %s, %s, %s, ST_GeomFromGeoJSON(%s))
                        """,
                        (
                            payload.participant_id,
                            theme_id,
                            mp.name,
                            int(mp.importance_1_5 or 3),
                            mp.comment,
                            json.dumps(mp.geojson),
                        ),
                    )
                    saved += 1
                else:
                    # OSM: aceita somente polígonos
                    if sel.osm_id is None or not sel.geojson or sel.geojson.get("type") not in ("Polygon", "MultiPolygon"):
                        continue

                    osm_record = {
                        "osm_id": sel.osm_id,
                        "osm_type": sel.osm_type or "",
                        "display_name": sel.display_name or "",
                        "class": sel.osm_class,
                        "type": sel.osm_feature_type,
                        "geojson": sel.geojson,
                    }
                    upsert_osm_cache(cur, osm_record)

                    cur.execute(
                        """
                        INSERT INTO public.selections
                          (participant_id, theme_id, osm_id, importance_1_5, comment)
                        VALUES (%s, %s, %s, %s, %s)
                        """,
                        (
                            payload.participant_id,
                            theme_id,
                            int(sel.osm_id),
                            int(sel.importance_1_5 or 3),
                            sel.comment,
                        ),
                    )
                    saved += 1
        conn.commit()

    return {"ok": True, "participant_id": payload.participant_id, "saved": saved}


# Para rodar diretamente: python -m uvicorn main:app --reload --port 8000
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)