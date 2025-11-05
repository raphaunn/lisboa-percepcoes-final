# As Lisboas de Lisboa – WebSIG

Versão: **lisboa-percepcoes_v1_24.10.25**

Stack:
- **Frontend**: Vite + React + Leaflet (+ Leaflet.Draw)
- **Backend**: FastAPI
- **BD**: Supabase (PostgreSQL + PostGIS)

## Como rodar
### Backend
```bash
cd api
python -m uvicorn main:app --reload --port 8000