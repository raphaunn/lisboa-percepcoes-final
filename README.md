# As Lisboas de Lisboa – WebSIG

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
│ └── schema_public_v1_24.10.25.sql # Estrutura da BD Supabase (referência)
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
  - /health → status da API.
  - /consent → cria participant_id.
  - /profile → grava dados sociodemográficos.
  - /geocode → busca locais (Nominatim + Overpass).
  - /categories → lista categorias OSM.
  - /category/{code} → retorna camadas filtradas (ex: parques, escolas).
  - /submit → grava seleções e polígonos manuais no BD.
- Integra-se ao Supabase/PostgreSQL via DATABASE_URL definida em .env.
- Expõe dados geográficos em formato GeoJSON, para consumo direto pelo Leaflet.
 
**web/src/App.jsx**:
- Núcleo do frontend:
  - Carrega o mapa Leaflet e os layers dinâmicos.
  - Permite desenhar polígonos (Leaflet.Draw).
  - Controla envio e recuperação das seleções.
  - Comunica com o backend via chamadas à API (fetch('/api/...')).
   
**web/src/main.jsx**:
- Ponto de inicialização React.
- Renderiza <App /> e aplica estilos globais (index.css, global.css).
 
**web/vite.config.js**:
- Estrutura SQL da BD Supabase (PostgreSQL + PostGIS).
- Inclui tabelas: participants, profiles, themes, selections, user_polygons, osm_cache.
- Serve como blueprint para reconfigurar o banco.

## Integrações externas:
- **Nominatim**: Serviço de geocodificação do OpenStreetMap — converte texto em coordenadas/polígonos.
- **Overpass API**:Permite consultas diretas a entidades OSM.

## Fluxo simplificado:
- Utilizador preenche o perfil → gravado em profiles.
- Utilizador seleciona ou desenha locais → enviados para /submit.
- FastAPI grava:
  - Seleções OSM em selections.
  - Desenhos manuais em user_polygons.
- Dados podem ser analisados via QGIS (ligação direta ao Supabase).

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
