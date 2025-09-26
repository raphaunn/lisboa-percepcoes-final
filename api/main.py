from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import os, psycopg2, psycopg2.extras, httpx
import psycopg2.extras

# carregar .env
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:5173")
NOMINATIM_URL = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org")
OVERPASS_URL = os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
USER_AGENT = os.getenv("USER_AGENT", "contact@example.com")

app = FastAPI(title="Lisboa Percepcoes API (MVP)")

# CORS: permitir frontend local (Vite: 5173 por padrão)
from fastapi.middleware.cors import CORSMiddleware

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,   # ok para dev
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_conn():
    # abre uma ligação por pedido (simples para MVP)
    return psycopg2.connect(DATABASE_URL)

@app.get("/health")
def health():
    # testa a ligação à BD
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("select 1;")
                _ = cur.fetchone()
        db_ok = True
    except Exception as e:
        db_ok = False
    return {"ok": True, "db": db_ok}

# ---------- modelos ----------
class Profile(BaseModel):
    age_band: str
    gender: str
    ethnicity: str | None = None
    nationality: str | None = None
    education: str | None = None
    income_band: str | None = None
    tenure: str | None = None
    rent_stress_pct: int | None = None
    lives_in_lisbon: bool
    parish_home: str | None = None
    years_in_lisbon_band: str | None = None
    works_in_lisbon: bool | None = None
    parish_work: str | None = None
    studies_in_lisbon: bool | None = None
    pt_use: str | None = None         # 'never'/'sometimes'/'often'
    main_mode: str | None = None      # 'walk'/'bike'/'pt'/'car'
    belonging_1_5: int                # 1..5
    safety_day_1_5: int
    safety_night_1_5: int

class Selection(BaseModel):
    theme_code: str                   # 'gentrification','identity','safety','daily_centrality'
    osm_id: int
    importance_1_5: int = Field(ge=1, le=5)
    comment: str | None = None

class SubmitPayload(BaseModel):
    participant_id: str
    selections: list[Selection]

# ---------- endpoints ----------
@app.post("/consent")
def create_participant():
    # cria um participant e devolve o UUID
    with get_conn() as conn:
        with conn.cursor() as cur:
            # NOTA: se o teu esquema usou gen_random_uuid() e deu erro,
            # ativa a extensão no Supabase: CREATE EXTENSION IF NOT EXISTS pgcrypto;
            cur.execute("insert into participants default values returning id;")
            pid = cur.fetchone()[0]
    return {"participant_id": str(pid)}

@app.post("/profile")
def save_profile(participant_id: str, profile: Profile):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("select 1 from participants where id=%s;", (participant_id,))
            if cur.fetchone() is None:
                raise HTTPException(400, "participant not found")
            cols = list(profile.model_dump().keys())
            vals = list(profile.model_dump().values())
            placeholders = ",".join(["%s"]*len(vals))
            cur.execute(
                f"insert into profiles(participant_id,{','.join(cols)}) values(%s,{placeholders})",
                (participant_id, *vals)
            )
    return {"ok": True}

# ------- OSM: busca por nome (Nominatim) e (mais tarde) cache Overpass -------
async def nominatim_search(q: str):
    # BBox de Lisboa (aprox) no formato left, top, right, bottom
    params = {
        "q": q,
        "format": "jsonv2",
        "addressdetails": 0,
        "polygon_geojson": 1,
        "bounded": 1,
        "viewbox": "-9.25,38.80,-9.05,38.65"  # <<< ATENÇÃO: ordem correta
    }
    headers = {"User-Agent": USER_AGENT}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{NOMINATIM_URL}/search", params=params, headers=headers)
        r.raise_for_status()
        return r.json()

@app.get("/geocode")
async def geocode(q: str):
    data = await nominatim_search(q)
    out = []
    for item in data[:10]:
        out.append({
            "display_name": item.get("display_name"),
            "osm_id": item.get("osm_id"),
            "osm_type": item.get("osm_type"),  # 'node','way','relation'
            "class": item.get("class"),
            "type": item.get("type"),
            "geojson": item.get("geojson", None)
        })
    return {"results": out}

@app.post("/submit")
def submit(payload: SubmitPayload):
    with get_conn() as conn:
        with conn.cursor() as cur:
            # valida participant
            cur.execute("select 1 from participants where id=%s;", (payload.participant_id,))
            if cur.fetchone() is None:
                raise HTTPException(400, "participant not found")

            # mapear código de tema -> id
            cur.execute("select id, code from themes;")
            theme_map = {code: tid for (tid, code) in cur.fetchall()}

            for sel in payload.selections:
                if sel.theme_code not in theme_map:
                    raise HTTPException(400, f"unknown theme {sel.theme_code}")

                # GARANTIR a existência do OSM no cache (stub)
                # 'osm_type' é NOT NULL, então guardamos 'unknown' por agora;
                # depois podemos completar com name/tags/geom noutro endpoint.
                cur.execute("""
                    insert into osm_cache(osm_id, osm_type, name, tags, geom)
                    values (%s, %s, NULL, NULL, NULL)
                    on conflict (osm_id) do nothing;
                """, (sel.osm_id, 'unknown'))

                # agora podemos gravar a seleção com segurança
                cur.execute("""
                    insert into selections(participant_id, theme_id, osm_id, importance_1_5, comment)
                    values (%s, %s, %s, %s, %s);
                """, (
                    payload.participant_id,
                    theme_map[sel.theme_code],
                    sel.osm_id,
                    sel.importance_1_5,
                    sel.comment
                ))
    return {"ok": True}