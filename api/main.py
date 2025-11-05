import os
import uuid
import json
import time
import re
from typing import Any, Dict, List, Optional, Tuple

import requests
from fastapi import FastAPI, APIRouter, Query, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import psycopg2
import psycopg2.extras
from threading import Lock

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

# Overpass (com fallbacks)
PRIMARY_OVERPASS = os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
ALT_ENV = [u.strip() for u in os.getenv("OVERPASS_URL_ALTS", "").split(",") if u.strip()]
DEFAULT_FALLBACKS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]
OVERPASS_ENDPOINTS: List[str] = [PRIMARY_OVERPASS, *ALT_ENV, *DEFAULT_FALLBACKS]

# Anti-rajada simples para Overpass
OVERPASS_LOCK = Lock()
LAST_OVERPASS_CALL = 0.0
MIN_INTERVAL_S = float(os.getenv("OVERPASS_MIN_INTERVAL", "0.8"))

# Cache simples em memória (TTL curto)
OVERPASS_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
CACHE_TTL_S = int(os.getenv("OVERPASS_CACHE_TTL", "300"))

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

# ===================== Handler global p/ JSON legível =====================
@app.exception_handler(Exception)
async def all_exceptions_handler(request: Request, exc: Exception):
    print("\n=== Unhandled Exception ===")
    print(repr(exc))
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": f"{type(exc).__name__}: {str(exc)}"},
    )
# ==========================================================================

# ===================== MODELOS ============================================
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
# ==========================================================================

@app.get("/health")
def health():
    return {"status": "ok"}

@app.api_route("/consent", methods=["GET", "POST"])
def consent():
    pid = str(uuid.uuid4())
    return {"participant_id": pid}

# ---------- util: leitura robusta de JSON ----------
async def _safe_json_from_request(request: Request) -> Dict[str, Any]:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {"payload": data}
    except Exception:
        pass
    try:
        body = await request.body()
    except Exception:
        return {}
    for enc, kwargs in [
        ("utf-8", {"errors": "strict"}),
        ("utf-8-sig", {"errors": "strict"}),
        ("latin-1", {"errors": "strict"}),
        ("utf-8", {"errors": "ignore"}),
    ]:
        try:
            text = body.decode(enc, **kwargs)
            data = json.loads(text)
            return data if isinstance(data, dict) else {"payload": data}
        except Exception:
            continue
    return {}

# ---------- helpers DB ----------
def get_conn():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL não configurada.")
    conn = psycopg2.connect(DATABASE_URL)
    try:
        conn.set_client_encoding("UTF8")
    except Exception:
        pass
    return conn

def ensure_participant(cur, participant_id: str):
    try:
        cur.execute(
            "INSERT INTO public.participants (id) VALUES (%s) ON CONFLICT (id) DO NOTHING",
            (participant_id,),
        )
    except Exception:
        pass

def upsert_profile(cur, participant_id: str, data: Dict[str, Any]):
    payload = {
        "age_band": data.get("age_band") or "NA",
        "gender": data.get("gender") or "na",
        "ethnicity": data.get("ethnicity"),
        "nationality": data.get("nationality"),
        "education": data.get("education"),
        "income_band": data.get("income_band"),
        "tenure": data.get("tenure"),
        "rent_stress_pct": data.get("rent_stress_pct"),
        "lives_in_lisbon": bool(data.get("lives_in_lisbon", False)),
        "lived_in_lisbon_past": bool(data.get("lived_in_lisbon_past", False)),
        "works_in_lisbon": bool(data.get("works_in_lisbon", False)),
        "studies_in_lisbon": bool(data.get("studies_in_lisbon", False)),
        "visitors_regular": bool(data.get("visitors_regular", False)),
        "visitors_sporadic": bool(data.get("visitors_sporadic", False)),
        "years_in_lisbon_band": data.get("years_in_lisbon_band"),
        "pt_use": data.get("pt_use"),
        "main_mode": data.get("main_mode"),
        "belonging_1_5": data.get("belonging_1_5"),
        "safety_overall_1_5": data.get("safety_overall_1_5"),
    }
    cur.execute(
        """
        INSERT INTO public.profiles (
          participant_id, age_band, gender, ethnicity, nationality, education,
          income_band, tenure, rent_stress_pct,
          lives_in_lisbon, lived_in_lisbon_past, works_in_lisbon, studies_in_lisbon,
          visitors_regular, visitors_sporadic, years_in_lisbon_band, pt_use, main_mode,
          belonging_1_5, safety_overall_1_5
        ) VALUES (
          %(participant_id)s, %(age_band)s, %(gender)s, %(ethnicity)s, %(nationality)s, %(education)s,
          %(income_band)s, %(tenure)s, %(rent_stress_pct)s,
          %(lives_in_lisbon)s, %(lived_in_lisbon_past)s, %(works_in_lisbon)s, %(studies_in_lisbon)s,
          %(visitors_regular)s, %(visitors_sporadic)s, %(years_in_lisbon_band)s, %(pt_use)s, %(main_mode)s,
          %(belonging_1_5)s, %(safety_overall_1_5)s
        )
        ON CONFLICT (participant_id) DO UPDATE SET
          age_band = EXCLUDED.age_band,
          gender = EXCLUDED.gender,
          ethnicity = EXCLUDED.ethnicity,
          nationality = EXCLUDED.nationality,
          education = EXCLUDED.education,
          income_band = EXCLUDED.income_band,
          tenure = EXCLUDED.tenure,
          rent_stress_pct = EXCLUDED.rent_stress_pct,
          lives_in_lisbon = EXCLUDED.lives_in_lisbon,
          lived_in_lisbon_past = EXCLUDED.lived_in_lisbon_past,
          works_in_lisbon = EXCLUDED.works_in_lisbon,
          studies_in_lisbon = EXCLUDED.studies_in_lisbon,
          visitors_regular = EXCLUDED.visitors_regular,
          visitors_sporadic = EXCLUDED.visitors_sporadic,
          years_in_lisbon_band = EXCLUDED.years_in_lisbon_band,
          pt_use = EXCLUDED.pt_use,
          main_mode = EXCLUDED.main_mode,
          belonging_1_5 = EXCLUDED.belonging_1_5,
          safety_overall_1_5 = EXCLUDED.safety_overall_1_5
        ;
        """,
        {"participant_id": participant_id, **payload},
    )

def ensure_profile_min(cur, participant_id: str):
    cur.execute("SELECT 1 FROM public.profiles WHERE participant_id=%s", (participant_id,))
    if cur.fetchone():
        return
    cur.execute(
        """
        INSERT INTO public.profiles (participant_id, age_band, gender, lives_in_lisbon)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (participant_id) DO NOTHING
        """,
        (participant_id, "NA", "na", False),
    )

def fetch_theme_id(cur, code: str) -> Optional[int]:
    cur.execute("SELECT id FROM public.themes WHERE code=%s", (code,))
    row = cur.fetchone()
    return int(row[0]) if row else None

def upsert_osm_cache(cur, rec: Dict[str, Any]):
    cur.execute(
        """
        INSERT INTO public.osm_cache (osm_id, osm_type, display_name, class, type, geojson)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (osm_id) DO UPDATE SET
            osm_type = EXCLUDED.osm_type,
            display_name = EXCLUDED.display_name,
            class = EXCLUDED.class,
            type = EXCLUDED.type,
            geojson = EXCLUDED.geojson
        """,
        (
            int(rec.get("osm_id")),
            rec.get("osm_type") or "",
            rec.get("display_name") or "",
            rec.get("class"),
            rec.get("type"),
            json.dumps(rec.get("geojson")),
        ),
    )

# ===================== /profile ============================================
@app.post("/profile")
async def profile(request: Request, participant_id: Optional[str] = Query(None)):
    data = await _safe_json_from_request(request)
    if not isinstance(data, dict):
        data = {"payload": data}

    with get_conn() as conn:
        with conn.cursor() as cur:
            if participant_id:
                ensure_participant(cur, participant_id)
                upsert_profile(cur, participant_id, data)
        conn.commit()

    return {"ok": True, "participant_id": participant_id, "received": data}

# ===================== BUSCA (Nominatim + Overpass) ========================
def _bbox_overlap(item_bbox: List[str], bbox: Tuple[float, float, float, float]) -> bool:
    try:
        south = float(item_bbox[0]); north = float(item_bbox[1])
        west = float(item_bbox[2]);  east  = float(item_bbox[3])
    except Exception:
        return False
    minx, miny, maxx, maxy = bbox
    return not (east < minx or west > maxx or north < miny or south > maxy)

def _point_in_bbox(lat: float, lon: float, bbox: Tuple[float, float, float, float]) -> bool:
    minx, miny, maxx, maxy = bbox
    return (minx <= lon <= maxx) and (miny <= lat <= maxy)

def _normalize_geojson(item: Dict[str, Any]) -> Dict[str, Any]:
    gj = item.get("geojson")
    if isinstance(gj, dict) and "type" in gj:
        return gj
    try:
        lat = float(item.get("lat"))
        lon = float(item.get("lon"))
        return {"type": "Point", "coordinates": [lon, lat]}
    except Exception:
        return {}

def _cache_get(key: str) -> Optional[Dict[str, Any]]:
    now = time.time()
    hit = OVERPASS_CACHE.get(key)
    if not hit:
        return None
    ts, data = hit
    if now - ts > CACHE_TTL_S:
        OVERPASS_CACHE.pop(key, None)
        return None
    return data

def _cache_set(key: str, data: Dict[str, Any]) -> None:
    OVERPASS_CACHE[key] = (time.time(), data)

def _overpass_request(ql: str) -> Dict[str, Any]:
    global LAST_OVERPASS_CALL
    headers = {"User-Agent": USER_AGENT}
    with OVERPASS_LOCK:
        delay = time.perf_counter() - LAST_OVERPASS_CALL
        if delay < MIN_INTERVAL_S:
            time.sleep(MIN_INTERVAL_S - delay)
        last_exc: Optional[Exception] = None
        for url in OVERPASS_ENDPOINTS:
            try:
                r = requests.post(url, data={"data": ql}, headers=headers, timeout=45)
                if r.status_code in (429, 502, 503, 504):
                    time.sleep(1.2)
                    r = requests.post(url, data={"data": ql}, headers=headers, timeout=45)
                r.raise_for_status()
                LAST_OVERPASS_CALL = time.perf_counter()
                return r.json()
            except Exception as e:
                last_exc = e
                continue
        raise HTTPException(status_code=502, detail=f"Overpass indisponível: {type(last_exc).__name__}")

def _way_geojson(el: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    geom = el.get("geometry")
    if not isinstance(geom, list) or len(geom) < 2:
        return None
    coords = [[pt["lon"], pt["lat"]] for pt in geom]
    # Se for anel fechado (>=4 e primeiro==último) -> Polígono
    if len(coords) >= 4 and coords[0] == coords[-1]:
        return {"type": "Polygon", "coordinates": [coords]}
    # Caso contrário, é LineString
    return {"type": "LineString", "coordinates": coords}

def _relation_geojson(el: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # 1) tenta montar MultiPolygon a partir de members com anéis fechados
    members = el.get("members") or []
    polys: List[List[List[float]]] = []
    for m in members:
        mg = m.get("geometry")
        if isinstance(mg, list) and len(mg) >= 4:
            ring = [[p["lon"], p["lat"]] for p in mg]
            if ring[0] == ring[-1]:
                polys.append(ring)
    if polys:
        return {"type": "MultiPolygon", "coordinates": [[ring] for ring in polys]}
    # 2) fallback: juntar geometria como MultiLineString
    geom = el.get("geometry")
    if isinstance(geom, list) and len(geom) >= 2:
        line = [[p["lon"], p["lat"]] for p in geom]
        return {"type": "MultiLineString", "coordinates": [line]}
    return None

def _elements_to_features_any(elements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    feats: List[Dict[str, Any]] = []
    seen = set()
    for el in elements:
        t = el.get("type")
        osm_id = el.get("id")
        if (t, osm_id) in seen:
            continue

        tags = el.get("tags", {}) or {}
        display = tags.get("name") or f"osm:{t}"
        cls, typ = None, None
        for k in ["place", "building", "amenity", "leisure", "tourism", "historic", "landuse", "highway", "railway"]:
            if k in tags:
                cls, typ = k, tags.get(k)
                break

        gj = None
        if t == "node":
            lat = el.get("lat"); lon = el.get("lon")
            if isinstance(lat, (float, int)) and isinstance(lon, (float, int)):
                gj = {"type": "Point", "coordinates": [float(lon), float(lat)]}
        elif t == "way":
            gj = _way_geojson(el)
        elif t == "relation":
            gj = _relation_geojson(el)

        if not isinstance(gj, dict) or "type" not in gj:
            continue

        feats.append({
            "osm_id": int(osm_id) if isinstance(osm_id, int) else osm_id,
            "osm_type": t,
            "display_name": display,
            "class": cls,
            "type": typ,
            "geojson": gj,
            "geometry_type": gj.get("type"),
        })
        seen.add((t, osm_id))
    return feats

def _build_overpass_name_query(q: str) -> str:
    # usa regex case-insensitive, escapando caracteres especiais do overpass
    patt = re.escape(q)
    # procurar também por place=suburb/neighbourhood/quarter
    return f"""
[out:json][timeout:45];
area["name"="Lisboa"]["boundary"="administrative"]["admin_level"~"^(7|8)$"]->.searchArea;
(
  node(area.searchArea)["name"~"{patt}", i];
  way(area.searchArea)["name"~"{patt}", i];
  relation(area.searchArea)["name"~"{patt}", i];

  node(area.searchArea)["place"~"suburb|neighbourhood|quarter", i]["name"~"{patt}", i];
  way(area.searchArea)["place"~"suburb|neighbourhood|quarter", i]["name"~"{patt}", i];
  relation(area.searchArea)["place"~"suburb|neighbourhood|quarter", i]["name"~"{patt}", i];
);
out tags geom;
""".strip()

@app.get("/geocode")
def geocode(q: str = Query(..., min_length=2)):
    """
    Busca combinada:
      1) Nominatim ancorado em Lisboa (+ fallback "q Lisboa"), aceitando Point/Line/Polygon.
      2) Overpass por nome dentro da área administrativa de Lisboa (fallback enriquecedor).
    Junta, remove duplicados e devolve geometry_type para a UI.
    """
    base_url = f"{NOMINATIM_URL.rstrip('/')}/search"
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "pt"}

    def _run_nominatim(params: Dict[str, Any]) -> List[Dict[str, Any]]:
        r = requests.get(base_url, params=params, headers=headers, timeout=15)
        if r.status_code == 429:
            retry = int(r.headers.get("Retry-After", "1"))
            time.sleep(min(retry, 3))
            r = requests.get(base_url, params=params, headers=headers, timeout=15)
        r.raise_for_status()
        return r.json()

    def _filter_to_lisbon(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = []
        for it in items:
            bb = it.get("boundingbox")
            if isinstance(bb, list) and len(bb) == 4 and _bbox_overlap(bb, LISBON_BBOX):
                out.append(it); continue
            try:
                lat = float(it.get("lat")); lon = float(it.get("lon"))
                if _point_in_bbox(lat, lon, LISBON_BBOX):
                    out.append(it)
            except Exception:
                continue
        return out

    results_combined: Dict[Tuple[str, Any], Dict[str, Any]] = {}

    try:
        # 1) Nominatim (ancorado)
        params1 = {
            "q": q,
            "format": "jsonv2",
            "polygon_geojson": 1,
            "addressdetails": 0,
            "limit": 30,
            "dedupe": 0,
            "extratags": 0,
            "namedetails": 0,
            "viewbox": VIEWBOX,
            "bounded": 1,
            "countrycodes": "pt",
        }
        res1 = _run_nominatim(params1)
        nomi1 = _filter_to_lisbon(res1)

        # 1b) fallback Nominatim “q Lisboa” se vazio
        nomi_final = nomi1
        if not nomi_final:
            params2 = dict(params1)
            params2.pop("viewbox", None)
            params2.pop("bounded", None)
            params2["q"] = f"{q} Lisboa"
            res2 = _run_nominatim(params2)
            nomi_final = _filter_to_lisbon(res2)

        for it in nomi_final:
            gj = _normalize_geojson(it)
            if not isinstance(gj, dict) or "type" not in gj:
                continue
            key = (str(it.get("osm_type") or ""), it.get("osm_id"))
            if key in results_combined:
                continue
            it_copy = dict(it)
            it_copy["geojson"] = gj
            it_copy["geometry_type"] = gj.get("type")
            results_combined[key] = {
                "osm_id": it_copy.get("osm_id"),
                "osm_type": it_copy.get("osm_type"),
                "display_name": it_copy.get("display_name"),
                "class": it_copy.get("class"),
                "type": it_copy.get("type"),
                "geojson": it_copy.get("geojson"),
                "geometry_type": it_copy.get("geometry_type"),
            }

        # 2) Overpass (fallback enriquecedor)
        if not results_combined or len(results_combined) < 10:
            ql = _build_overpass_name_query(q)
            cache_key = f"geocode_overpass|{q}"
            cached = _cache_get(cache_key)
            data = cached if cached is not None else _overpass_request(ql)
            if cached is None:
                _cache_set(cache_key, data)
            elements = data.get("elements", [])
            feats = _elements_to_features_any(elements)
            for f in feats:
                key = (str(f.get("osm_type") or ""), f.get("osm_id"))
                if key not in results_combined:
                    results_combined[key] = f

        return {"results": list(results_combined.values())[:40]}

    except requests.exceptions.Timeout:
        return {"results": [], "error": "Tempo de espera excedido (timeout) ao consultar Nominatim/Overpass."}
    except requests.exceptions.HTTPError as e:
        status = getattr(e.response, "status_code", None)
        msg = f"Erro HTTP {status} em Nominatim/Overpass." if status else "Erro HTTP em Nominatim/Overpass."
        return {"results": [], "error": msg}
    except Exception as e:
        return {"results": [], "error": f"Erro de rede: {str(e)}"}

# ===================== CATEGORIAS (Overpass) ===============================
CATEGORIES: Dict[str, Dict[str, Any]] = {
    "parks": {"label": "Parques e Jardins", "filters": [("leisure", "park"), ("leisure", "garden")], "regex": False, "primary_keys": ["leisure"]},
    "public_buildings": {
        "label": "Edifícios públicos",
        "filters": [("building", "public|civic|townhall|library|courthouse"), ("amenity", "townhall|library|courthouse|police|fire_station")],
        "regex": True, "primary_keys": ["building", "amenity"],
    },
    "schools": {"label": "Escolas/Universidades", "filters": [("building", "school|university|college"), ("amenity", "school|university|college")], "regex": True, "primary_keys": ["building", "amenity"]},
    "hospitals": {"label": "Hospitais/Clínicas", "filters": [("building", "hospital|clinic"), ("amenity", "hospital|clinic")], "regex": True, "primary_keys": ["building", "amenity"]},
    "museums": {"label": "Museus", "filters": [("tourism", "museum")], "regex": False, "primary_keys": ["tourism"]},
    "heritage": {"label": "Património/Histórico", "filters": [("historic", ".*"), ("heritage", ".*")], "regex": True, "primary_keys": ["historic", "heritage"]},
    "sports": {"label": "Equipamentos desportivos", "filters": [("leisure", "stadium|sports_centre|pitch")], "regex": True, "primary_keys": ["leisure"]},
    "retail_areas": {"label": "Áreas comerciais", "filters": [("landuse", "retail|commercial")], "regex": True, "primary_keys": ["landuse"]},
    "neighborhoods": {"label": "Bairros/Regiões", "filters": [("place", "suburb|neighbourhood|quarter")], "regex": True, "primary_keys": ["place"]},
}

def _parse_bbox(bbox_str: str) -> Tuple[float, float, float, float]:
    try:
        parts = [float(x) for x in bbox_str.split(",")]
        if len(parts) != 4:
            raise ValueError
        minx, miny, maxx, maxy = parts
        return (minx, miny, maxx, maxy)
    except Exception:
        raise HTTPException(status_code=400, detail="bbox inválido. Use: minLon,minLat,maxLon,maxLat")

def _build_overpass_ql(filters: List[Tuple[str, str]], bbox: Tuple[float, float, float, float], regex: bool) -> str:
    minx, miny, maxx, maxy = bbox
    south, west, north, east = (miny, minx, maxy, maxx)
    selectors = []
    for key, val in filters:
        if regex:
            sel_way = f'way["{key}"~"{val}"]({south},{west},{north},{east})(area.searchArea);'
            sel_rel = f'relation["{key}"~"{val}"]({south},{west},{north},{east})(area.searchArea);'
        else:
            if val == ".*":
                sel_way = f'way["{key}"]({south},{west},{north},{east})(area.searchArea);'
                sel_rel = f'relation["{key}"]({south},{west},{north},{east})(area.searchArea);'
            else:
                sel_way = f'way["{key}"="{val}"]({south},{west},{north},{east})(area.searchArea);'
                sel_rel = f'relation["{key}"="{val}"]({south},{west},{north},{east})(area.searchArea);'
        selectors.append(sel_way)
        selectors.append(sel_rel)
    union = "\n  ".join(selectors)
    ql = f"""
[out:json][timeout:45];
area["name"="Lisboa"]["boundary"="administrative"]["admin_level"~"^(7|8)$"]->.searchArea;
(
  {union}
);
out tags geom;
"""
    return ql.strip()

def _elements_to_features(elements: List[Dict[str, Any]], primary_keys: List[str], limit: Optional[int]) -> List[Dict[str, Any]]:
    feats: List[Dict[str, Any]] = []
    seen = set()

    def _coords_to_polygon(coords: List[Dict[str, float]]) -> Optional[List[List[float]]]:
        if not coords or len(coords) < 4:
            return None
        ring = [[pt["lon"], pt["lat"]] for pt in coords]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        if len(ring) < 4:
            return None
        return ring

    for el in elements:
        t = el.get("type")
        if t not in ("way", "relation"):
            continue

        tags = el.get("tags", {}) or {}
        cls, typ = None, None
        for k in primary_keys:
            if k in tags:
                cls, typ = k, tags.get(k)
                break
        if cls is None:
            for k in ["building", "amenity", "leisure", "tourism", "historic", "landuse", "place"]:
                if k in tags:
                    cls, typ = k, tags.get(k)
                    break

        display = tags.get("name") or f"{(cls or 'osm')}:{(typ or 'feature')}"
        osm_id = el.get("id")
        if osm_id in seen:
            continue

        gj = None
        if t == "way":
            geom = el.get("geometry")
            ring = _coords_to_polygon(geom) if isinstance(geom, list) else None
            if ring:
                gj = {"type": "Polygon", "coordinates": [ring]}
        elif t == "relation":
            geom = el.get("geometry")
            if isinstance(geom, list):
                ring = _coords_to_polygon(geom)
                if ring:
                    gj = {"type": "Polygon", "coordinates": [ring]}
            if gj is None:
                members = el.get("members") or []
                polys = []
                for m in members:
                    mg = m.get("geometry")
                    if isinstance(mg, list):
                        ring = _coords_to_polygon(mg)
                        if ring:
                            polys.append(ring)
                if polys:
                    gj = {"type": "MultiPolygon", "coordinates": [[ring] for ring in polys]}

        if gj is None:
            continue

        seen.add(osm_id)
        feat = {
            "osm_id": int(osm_id) if isinstance(osm_id, int) else osm_id,
            "osm_type": t,
            "display_name": display,
            "class": cls,
            "type": typ,
            "geojson": gj,
        }
        feats.append(feat)
        if limit and len(feats) >= int(limit):
            break
    return feats

# ---------- ENDPOINTS: categorias ----------
@app.get("/categories")
def categories():
    return {
        "categories": [
            {"code": code, "label": data["label"]}
            for code, data in CATEGORIES.items()
        ]
    }

@app.get("/category/{code}")
def category(code: str, bbox: Optional[str] = None, limit: int = 900):
    if code not in CATEGORIES:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    conf = CATEGORIES[code]
    bbox_tuple = _parse_bbox(bbox) if bbox else LISBON_BBOX
    ql = _build_overpass_ql(conf["filters"], bbox_tuple, regex=conf["regex"])
    cache_key = f"cat|{code}|{bbox_tuple}|{limit}"
    cached = _cache_get(cache_key)
    data = cached if cached is not None else _overpass_request(ql)
    if cached is None:
        _cache_set(cache_key, data)
    elements = data.get("elements", [])
    feats = _elements_to_features(elements, conf["primary_keys"], limit=limit)
    return {"results": feats}

# ===================== Limite real de Lisboa (Nominatim) ===================
_LISBON_CACHE: Dict[str, Any] = {}

@app.get("/lisbon_boundary")
def lisbon_boundary():
    if "geojson" in _LISBON_CACHE:
        return {"geojson": _LISBON_CACHE["geojson"]}
    url = f"{NOMINATIM_URL.rstrip('/')}/search"
    params = {"q": "Lisboa", "format": "jsonv2", "polygon_geojson": 1, "addressdetails": 0, "limit": 10, "dedupe": 1}
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "pt"}
    try:
        r = requests.get(url, params=params, headers=headers, timeout=20)
        if r.status_code == 429:
            retry = int(r.headers.get("Retry-After", "1"))
            time.sleep(min(retry, 3))
            r = requests.get(url, params=params, headers=headers, timeout=20)
        r.raise_for_status()
        results = r.json()
        chosen = None
        for it in results:
            gj = it.get("geojson")
            if not isinstance(gj, dict): continue
            if gj.get("type") not in ("Polygon", "MultiPolygon"): continue
            cls = (it.get("class") or "").lower()
            typ = (it.get("type") or "").lower()
            name = (it.get("display_name") or "")
            if cls == "boundary" and typ == "administrative" and "Lisboa" in name:
                chosen = it
                break
        if not chosen:
            for it in results:
                gj = it.get("geojson")
                if isinstance(gj, dict) and gj.get("type") in ("Polygon", "MultiPolygon"):
                    chosen = it
                    break
        if not chosen:
            raise HTTPException(status_code=502, detail="Não foi possível obter o limite de Lisboa.")
        _LISBON_CACHE["geojson"] = chosen["geojson"]
        return {"geojson": chosen["geojson"]}
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Timeout ao consultar Nominatim (limite Lisboa).")
    except requests.exceptions.HTTPError as e:
        status = getattr(e.response, "status_code", None)
        raise HTTPException(status_code=502, detail=f"Erro HTTP do Nominatim ({status}).")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erro ao obter limite de Lisboa: {str(e)}")

# ===================== SUBMISSÃO ===========================================
@app.post("/submit")
def submit(payload: SubmitPayload):
    if not payload.participant_id:
        return {"ok": False, "error": "participant_id em falta"}
    if not payload.selections:
        return {"ok": True, "participant_id": payload.participant_id, "saved": 0}

    saved = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            ensure_participant(cur, payload.participant_id)
            ensure_profile_min(cur, payload.participant_id)

            for sel in payload.selections:
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
                          (%s, %s, %s, %s, %s,
                           ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(%s)), 4326)
                          )
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

# ===================== ROTEADOR /api (espelho dos endpoints) ===============
api = APIRouter(prefix="/api")

@api.get("/health")
def api_health(): return health()

@api.api_route("/consent", methods=["GET", "POST"])
def api_consent(): return consent()

@api.post("/profile")
async def api_profile(request: Request, participant_id: Optional[str] = Query(None)):
    return await profile(request, participant_id)

@api.get("/geocode")
def api_geocode(q: str = Query(..., min_length=2)):
    return geocode(q)

@api.get("/categories")
def api_categories():
    return categories()

@api.get("/category/{code}")
def api_category(code: str, bbox: Optional[str] = None, limit: int = 900):
    return category(code, bbox, limit)

@api.get("/lisbon_boundary")
def api_lisbon_boundary():
    return lisbon_boundary()

@api.post("/submit")
def api_submit(payload: SubmitPayload):
    return submit(payload)

app.include_router(api)

# ===================== Run local ============================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)