**ENGLISH VERSION ABOVE • VERSÃO EM PORTUGUÊS ABAIXO**

# The Lisbons Within Lisbon - WebGIS (EN):

Version: **lisboa-percepcoes-final_05.11.25**

**Stack**:
- **Frontend**: Vite + React + Leaflet (+ Leaflet.Draw)
- **Backend**: FastAPI (Python)
- **Base de Dados**: Supabase (PostgreSQL + PostGIS)
- **APIs Externas:** Nominatim e Overpass (OpenStreetMap)

## Folder Structure:
```bash
lisboa-percepcoes/
├── api/ # FastAPI Backend
│   ├── main.py # Main API (routes, DB, geocoding)
│   ├── mini_api.py # Lightweight/local debug version
│   └── requirements.txt # Python dependencies
│
├── web/ # React + Vite Frontend
│   ├── index.html # Application root HTML
│   ├── vite.config.js # Vite configuration (dev/prod)
│   ├── package.json # JS dependencies + npm scripts
│   ├── public/ # Public images and assets
│   │   ├── logo_novaims.png
│   │   └── vite.svg
│   └── src/ # React source code
│       ├── App.jsx # Main component (WebGIS structure)
│       ├── main.jsx # React entry point
│       ├── global.css # Global styles
│       ├── responsive.css # Responsive styles
│       ├── index.css # Base layout
│       └── App.css # Map-specific styling
│
├── backups/
│   └── schema_public_v1_24.10.25.sql # Supabase DB structure (unused)
│   └── schema_public_v2_25.11.25.sql # Reference schema (final version)
│
├── .gitignore # Ignore cache, node_modules, .env, etc.
├── .gitattributes # Normalize line endings (LF/CRLF)
└── README.md # This document
```

## How to run locally:
### Backend (FastAPI):
```bash
cd api
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```
### Frontend (React + Vite)
```bash
cd web
npm install
npm run dev
```

## Internal Workflow:
**api/main.py**:
- Contém todas as rotas FastAPI:
  - /health → API status
  - /consent → creates participant_id
  - /profile → stores socio-demographic data
  - /geocode → location search (Nominatim + Overpass)
  - /categories → OSM category list
  - /category/{code} → filtered thematic layers (ex: parks, schools)
  - /submit → saves selections & manual polygons
- Connects to Supabase/PostgreSQL via DATABASE_URL (.env)
- Outputs geographic data as GeoJSON for Leaflet
 
**web/src/App.jsx**:
- Core of the frontend:
  - Loads Leaflet map and dynamic layers
  - Enables polygon drawing (Leaflet.Draw)
  - Handles selection submission
  - Communicates with the API
   
**web/src/main.jsx**:
- React entry point
- Renders <App /> and applies global styles
 
**web/vite.config.js**:
- Defines the SQL structure of the Supabase database (PostgreSQL + PostGIS)
- Includes tables: participants, profiles, themes, selections, user_polygons, osm_cache
- It serves as a blueprint for reconfiguring the database

## External integrations:
- **Nominatim**: OpenStreetMap geocoding service — converts text into coordinates/polygons
- **Overpass API**:Allows direct queries to OSM entities
  
## Simplified Flow:
- User fills the profile → stored in profiles
- User selects or draws locations → sent to /submit
- FastAPI stores:
  - OSM selections → selections
  - Manual drawings → user_polygons
- Data can be analyzed in QGIS/ArcGIS (direct Supabase connection)

## Main dependencies:
- **Backend (api/requirements.txt)**:
  - fastapi
  - uvicorn
  - psycopg2
  - requests
  - pydantic
  - python-dotenv
- **Frontend (web/package.json)**:
  - react, react-dom
  - vite
  - leaflet
  - leaflet-draw

## Credits:
Project developed as part of the Master’s thesis “As Lisboas de Lisboa: Participatory GIS for Identifying Urban Landscape Perception Patterns”, NOVA IMS, Master in Geographic Information Systems and Sciences, 2026.
Note: development was supported by AI-assisted tools.

---

---

# As Lisboas de Lisboa – WebSIG (PT):

Versão: **lisboa-percepcoes-final_05.11.25**

**Stack**:
- **Frontend**: Vite + React + Leaflet (+ Leaflet.Draw)
- **Backend**: FastAPI (Python)
- **Base de Dados**: Supabase (PostgreSQL + PostGIS)
- **APIs Externas:** Nominatim e Overpass (OpenStreetMap)

## Estrutura de Pastas:
```bash
lisboa-percepcoes/
├── api/ # Backend FastAPI
│ ├── main.py # API principal (rotas, BD, geocodificação)
│ ├── mini_api.py # Versão leve/alternativa (debug/local)
│ └── requirements.txt # Dependências Python
│
├── web/ # Frontend React + Vite
│ ├── index.html # HTML base da aplicação
│ ├── vite.config.js # Configuração do ambiente Vite (dev/prod)
│ ├── package.json # Dependências JS + scripts npm
│ ├── public/ # Imagens e ícones públicos
│ │ ├── logo_novaims.png
│ │ └── vite.svg
│ └── src/ # Código-fonte React
│ ├── App.jsx # Componente principal (estrutura do WebSIG)
│ ├── main.jsx # Ponto de entrada do React
│ ├── global.css # Estilo global
│ ├── responsive.css # Estilos responsivos
│ ├── index.css # Layout base
│ └── App.css # Estilo específico do mapa
│
├── backups/
│ └── schema_public_v1_24.10.25.sql # Estrutura da BD Supabase (primeira versão; *inutilizada*)
│ └── schema_public_v2_25.11.25.sql # Estrutura da BD Supabase (estrutura de referência; backup compatível com a versão final)
│
├── .gitignore # Ignora cache, node_modules, .env, etc.
├── .gitattributes # Normaliza fim de linha (LF/CRLF)
└── README.md # Este documento

  backups/
    schema_public_v1_24.10.25.sql # Estrutura da BD Supabase (referência)

  .gitignore # Ignora cache, node_modules, .env, etc.
  .gitattributes # Normaliza fim de linha (LF/CRLF)
  README.md # Este documento
```

## Como rodar localmente:
### Backend (FastAPI):
```bash
cd api
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```
### Frontend (React + Vite)
```bash
cd web
npm install
npm run dev
```

## Funcionamente interno:
**api/main.py**:
- Contém todas as rotas FastAPI:
  - /health → status da API
  - /consent → cria participant_id
  - /profile → grava dados sociodemográficos
  - /geocode → busca locais (Nominatim + Overpass)
  - /categories → lista categorias OSM
  - /category/{code} → retorna camadas filtradas (ex: parques, escolas)
  - /submit → grava seleções e polígonos manuais no BD
- Integra-se ao Supabase/PostgreSQL via DATABASE_URL definida em .env
- Expõe dados geográficos em formato GeoJSON, para consumo direto pelo Leaflet
 
**web/src/App.jsx**:
- Núcleo do frontend:
  - Carrega o mapa Leaflet e os layers dinâmicos
  - Permite desenhar polígonos (Leaflet.Draw)
  - Controla envio e recuperação das seleções
  - Comunica com o backend via chamadas à API (fetch('/api/...')
   
**web/src/main.jsx**:
- Ponto de inicialização React
- Renderiza <App /> e aplica estilos globais (index.css, global.css)
 
**web/vite.config.js**:
- Estrutura SQL da BD Supabase (PostgreSQL + PostGIS)
- Inclui tabelas: participants, profiles, themes, selections, user_polygons, osm_cache
- Serve como blueprint para reconfigurar o banco

## Integrações externas:
- **Nominatim**: Serviço de geocodificação do OpenStreetMap — converte texto em coordenadas/polígonos
- **Overpass API**:Permite consultas diretas a entidades OSM

## Fluxo simplificado:
- Utilizador preenche o perfil → gravado em profiles
- Utilizador seleciona ou desenha locais → enviados para /submit
- FastAPI grava:
  - Seleções OSM em selections
  - Desenhos manuais em user_polygons
- Dados podem ser analisados via QGIS/ArcGIS (ligação direta ao Supabase)

## Dependências principais:
- **Backend (api/requirements.txt)**:
  - fastapi
  - uvicorn
  - psycopg2
  - requests
  - pydantic
  - python-dotenv
- **Frontend (web/package.json)**:
  - react, react-dom
  - vite
  - leaflet
  - leaflet-draw

## Créditos:
Projeto desenvolvido no âmbito da tese de mestrado “As Lisboas de Lisboa: SIG Participativo na Identificação de Diferentes Tendências de Percepção da Paisagem Urbana”, pela NOVA IMS, Mestrado em Ciências e Sistemas de Informações Geográficas, 2026.
Nota importante: o desenvolvimento do WebSIG foi consolidado com o apoio de ferramentas de Inteligência Artificial.
