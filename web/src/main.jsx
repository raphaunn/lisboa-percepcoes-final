import React from 'react'
import ReactDOM from 'react-dom/client'

// >>> CSS essenciais do Leaflet (resolvem a “quebra” do mapa)
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'

import App from './App.jsx'
import './global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)