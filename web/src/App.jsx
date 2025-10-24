import { useState, useRef, useEffect } from "react";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  FeatureGroup,
  GeoJSON
} from "react-leaflet";
import { EditControl } from "react-leaflet-draw";

// ====== CONFIG ======
const API = "/api"; // via proxy do Vite (evita CORS/Network Error)

const TEST_PASSWORD = "lisboa123";

// BBOX aproximado da cidade de Lisboa (minLon, minLat, maxLon, maxLat)
const LISBON_BBOX = [-9.25, 38.69, -9.05, 38.80];

function isInLisbon(lat, lon) {
  const [minLon, minLat, maxLon, maxLat] = LISBON_BBOX;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}
function isPolygonGeom(gj) {
  return !!gj && (gj.type === "Polygon" || gj.type === "MultiPolygon");
}
function getGeoJSONCenter(geojson) {
  try {
    if (!geojson) return null;
    if (geojson.type === "Point") {
      const [lon, lat] = geojson.coordinates;
      return [lat, lon];
    }
    const tmp = new window.L.GeoJSON(geojson);
    const b = tmp.getBounds();
    if (b && b.isValid()) {
      const c = b.getCenter();
      return [c.lat, c.lng];
    }
  } catch {}
  return null;
}

// =================== TOGGLE MODO TESTE ===================
function TestModeToggle({ testMode, setTestMode }) {
  const activate = () => {
    const pw = window.prompt("Introduza a senha para ativar o Modo Teste:");
    if (pw && pw === TEST_PASSWORD) {
      setTestMode(true);
      try { localStorage.setItem("testMode", "1"); } catch {}
      alert("Modo Teste ativado. Nenhum dado será gravado.");
    } else if (pw !== null) {
      alert("Senha incorreta.");
    }
  };
  const deactivate = () => {
    if (window.confirm("Desativar o Modo Teste?")) {
      setTestMode(false);
      try { localStorage.removeItem("testMode"); } catch {}
    }
  };
  return (
    <div style={{
      position: "fixed", right: 12, bottom: 12, zIndex: 9999,
      display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6
    }}>
      {testMode && (
        <div style={{
          background:"#fef3c7", color:"#7c2d12",
          border:"1px solid #f59e0b", borderRadius:8,
          padding:"6px 10px", fontSize:".9rem", boxShadow:"0 2px 6px rgba(0,0,0,.08)"
        }}>
          <strong>Modo Teste ON</strong> — não grava dados
        </div>
      )}
      <button
        onClick={testMode ? deactivate : activate}
        style={{
          background: testMode ? "#dc2626" : "#111827",
          color:"#fff", border:"none", borderRadius: 999,
          padding:"8px 12px", cursor:"pointer"
        }}
      >
        {testMode ? "Modo Teste (ON)" : "Modo Teste"}
      </button>
    </div>
  );
}

// =================== CONSENTIMENTO ===================
function Consent({ onOk, setPid, testMode }) {
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [consent, setConsent] = useState(false);
  const [hasRelation, setHasRelation] = useState(false);
  const allChecked = agreeTerms && consent && hasRelation;

  const create = async () => {
    if (testMode) {
      const dummy = `TEST-${Date.now()}`;
      try { localStorage.setItem("pid", dummy); } catch {}
      setPid(dummy);
      onOk();
      return;
    }
    if (!allChecked) return;

    try {
      // **Plano B**: GET em vez de POST — permite seguir mesmo se algum middleware bloquear POST
      const r = await axios.get(`${API}/consent`);
      try { localStorage.setItem("pid", r.data.participant_id); } catch {}
      setPid(r.data.participant_id);
      onOk();
    } catch (err) {
      console.error(err);
      alert(
        "Não foi possível contactar a API (/api).\n" +
        "Verifique se o terminal da API está a correr (Uvicorn) e tente novamente."
      );
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>
        <strong>Olá!</strong>
      </h2>
      <p>Estamos a tentar perceber as várias Lisboas dentro de Lisboa e <strong>a sua participação é essencial!</strong></p>
      <p>Pretendemos identificar tendências na forma como diferentes pessoas enxergam a mesma paisagem urbana.</p>
      <p>Este formulário é anónimo e funciona melhor num computador.</p>
      <p>Os dados serão usados exclusivamente para fins científicos (tese NOVA IMS).</p>

      <div style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
        <label><input type="checkbox" checked={agreeTerms} onChange={(e)=>setAgreeTerms(e.target.checked)}/> Eu li e concordo com os termos de uso.</label>
        <label><input type="checkbox" checked={consent} onChange={(e)=>setConsent(e.target.checked)}/> Eu consinto em participar do inquérito.</label>
        <label><input type="checkbox" checked={hasRelation} onChange={(e)=>setHasRelation(e.target.checked)}/> Você vive, viveu, trabalha ou estuda em Lisboa?</label>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <button onClick={create} disabled={!allChecked && !testMode}>Continuar</button>
        {(!allChecked && !testMode) && <div style={{ fontSize: ".9rem", color: "#666", marginTop: ".25rem" }}>Marque as três opções acima para prosseguir.</div>}
        {testMode && <div style={{ fontSize: ".9rem", color: "#7c2d12", marginTop: ".4rem" }}>Modo Teste: pode continuar sem marcar as caixas.</div>}
      </div>
    </div>
  );
}

// =================== PERFIL ===================
function Profile({ participantId, onOk, testMode }) {
  const [form, setForm] = useState({
    age_band: "",
    gender: "",
    ethnicity: "",
    _ethnicity_choice: "",
    nationality: "Portuguesa",
    education: "",
    income_band: "",
    tenure: "",
    rent_stress_pct: null,
    lives_in_lisbon: false,
    lived_in_lisbon_past: false,
    works_in_lisbon: false,
    studies_in_lisbon: false,
    years_in_lisbon_band: "não aplicável",
    pt_use: "",
    main_mode: "",
    belonging_1_5: null,
    safety_overall_1_5: null
  });

  const ethnicityChoices = [
    "Branca","Preta/Negra","Parda/Mista","Amarela (ascendência asiática)","Indígena/Autóctone","Outra/Prefiro não dizer"
  ];
  const nationalityChoices = [
    "Portuguesa","Brasileira","Espanhola","Francesa","Italiana","Alemã","Britânica","Irlandesa","Neerlandesa","Belga","Luxemburguesa","Suíça",
    "Angolana","Cabo-verdiana","Moçambicana","São-tomense","Guineense","Timorense",
    "Estadunidense","Canadense","Argentina","Chilena","Mexicana",
    "Chinesa","Japonesa","Sul-coreana","Indiana","Paquistanesa","Bangladeshiana",
    "Marroquina","Argelina","Tunisina","Egípcia","Turca","Outra/Prefiro não dizer"
  ];

  const toggleLivesNow = (checked) => {
    setForm(f => ({
      ...f,
      lives_in_lisbon: checked,
      lived_in_lisbon_past: checked ? false : f.lived_in_lisbon_past,
      years_in_lisbon_band: checked || f.lived_in_lisbon_past ? f.years_in_lisbon_band : "não aplicável"
    }));
  };
  const toggleLivedPast = (checked) => {
    setForm(f => ({
      ...f,
      lived_in_lisbon_past: checked,
      lives_in_lisbon: checked ? false : f.lives_in_lisbon,
      years_in_lisbon_band: checked || f.lived_in_lisbon ? f.years_in_lisbon_band : "não aplicável"
    }));
  };

  const yearsEnabled = form.lives_in_lisbon || form.lived_in_lisbon_past;
  const hasAnyRelation = form.lives_in_lisbon || form.lived_in_lisbon_past || form.works_in_lisbon || form.studies_in_lisbon;

  const requiredMissing = [];
  if (!hasAnyRelation) requiredMissing.push("Relação com Lisboa (marque pelo menos uma)");
  if (!form.age_band) requiredMissing.push("Faixa etária");
  if (!form.gender) requiredMissing.push("Género");
  if (!form._ethnicity_choice) requiredMissing.push("Etnia/raça");
  if (!form.nationality) requiredMissing.push("Nacionalidade");
  if (!form.education) requiredMissing.push("Escolaridade completa");
  if (!form.income_band) requiredMissing.push("Rendimento médio mensal");
  if (!form.tenure) requiredMissing.push("Situação habitacional");
  if (!form.pt_use) requiredMissing.push("Uso de transporte público");
  if (!form.main_mode) requiredMissing.push("Modo de transporte predominante");
  if (yearsEnabled && (!form.years_in_lisbon_band || form.years_in_lisbon_band === "não aplicável")) {
    requiredMissing.push("Tempo que reside ou residiu em Lisboa");
  }
  if (!(form.belonging_1_5 >= 1 && form.belonging_1_5 <= 5)) requiredMissing.push("Pertença (1–5)");
  if (!(form.safety_overall_1_5 >= 1 && form.safety_overall_1_5 <= 5)) requiredMissing.push("Segurança geral (1–5)");

  const consolidateEthnicity = () => form._ethnicity_choice || form.ethnicity || "";

  const save = async () => {
    if (testMode) { onOk(); return; }
    if (requiredMissing.length) {
      alert("Por favor, preencha: \n- " + requiredMissing.join("\n- ")); return;
    }
    const payload = { ...form, ethnicity: consolidateEthnicity() };
    try {
      await axios.post(`${API}/profile`, payload, { params: { participant_id: participantId }});
      onOk();
    } catch (err) {
      console.error(err);
      alert("Falha ao contactar a API /profile. Verifique a API e tente novamente.");
    }
  };

  return (
    <div>
      <h2>Perfil</h2>
      <fieldset style={{border:"1px solid #ddd", padding:"10px", marginBottom:"10px"}}>
        <legend>Demografia</legend>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px"}}>
          <label>Faixa etária:
            <select value={form.age_band} onChange={e=>setForm({...form, age_band:e.target.value})}>
              <option value="">-- selecione --</option>
              <option>18-24</option><option>25-34</option><option>35-44</option>
              <option>45-54</option><option>55-64</option><option>65+</option>
            </select>
          </label>
          <label>Género:
            <select value={form.gender} onChange={e=>setForm({...form, gender:e.target.value})}>
              <option value="">-- selecione --</option>
              <option value="f">Feminino</option>
              <option value="m">Masculino</option>
              <option value="o">Outro</option>
              <option value="na">Prefiro não dizer</option>
            </select>
          </label>
          <label>Etnia/raça (autoidentificação):
            <select value={form._ethnicity_choice} onChange={e=>setForm({...form, _ethnicity_choice:e.target.value})}>
              <option value="">-- selecione --</option>
              {ethnicityChoices.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label>Nacionalidade:
            <select value={form.nationality} onChange={e=>setForm({...form, nationality:e.target.value})}>
              <option value="">-- selecione --</option>
              {nationalityChoices.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>Escolaridade completa:
            <select value={form.education} onChange={e=>setForm({...form, education:e.target.value})}>
              <option value="">-- selecione --</option>
              <option>Ensino básico</option><option>Ensino secundário</option>
              <option>Licenciatura</option><option>Mestrado</option><option>Doutoramento</option>
            </select>
          </label>
          <label>Rendimento médio mensal:
            <select value={form.income_band} onChange={e=>setForm({...form, income_band:e.target.value})}>
              <option value="">-- selecione --</option>
              <option>{"<700"}</option><option>700–1000</option><option>1000–1500</option>
              <option>1500–2000</option><option>2000–3000</option><option>{">3000"}</option>
              <option>Prefiro não dizer</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset style={{border:"1px solid #ddd", padding:"10px", marginBottom:"10px"}}>
        <legend>Habitação</legend>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px"}}>
          <label>Situação habitacional:
            <select value={form.tenure} onChange={e=>setForm({...form, tenure:e.target.value})}>
              <option value="">-- selecione --</option>
              <option value="owner">Proprietário(a)</option>
              <option value="tenant">Arrendatário(a)</option>
              <option value="other">Outro</option>
            </select>
          </label>
          <label>Percentagem do rendimento gasto com habitação (opcional):
            <input type="number" min="0" max="100"
              value={form.rent_stress_pct ?? ""}
              onChange={e=>setForm({...form, rent_stress_pct: e.target.value===""? null : +e.target.value})}
              placeholder="ex.: 30(%)"
            />
          </label>
        </div>
      </fieldset>

      <fieldset style={{border:"1px solid #ddd", padding:"10px", marginBottom:"10px"}}>
        <legend>Relação com Lisboa</legend>
        <div style={{marginBottom:"6px"}}><strong>Você vive, viveu, trabalha ou estuda em Lisboa?</strong></div>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px"}}>
          <label><input type="checkbox" checked={form.lives_in_lisbon} onChange={e=>toggleLivesNow(e.target.checked)}/> Vivo atualmente em Lisboa</label>
          <label><input type="checkbox" checked={form.lived_in_lisbon_past} onChange={e=>toggleLivedPast(e.target.checked)}/> Vivi em Lisboa no passado</label>
          <label><input type="checkbox" checked={form.works_in_lisbon} onChange={e=>setForm({...form, works_in_lisbon: e.target.checked})}/> Trabalho em Lisboa</label>
          <label><input type="checkbox" checked={form.studies_in_lisbon} onChange={e=>setForm({...form, studies_in_lisbon: e.target.checked})}/> Estudo em Lisboa</label>
        </div>
        <div style={{marginTop:"8px"}}>
          <label>Tempo que reside ou residiu em Lisboa (se aplicável):
            <select
              value={form.years_in_lisbon_band}
              onChange={e=>setForm({...form, years_in_lisbon_band:e.target.value})}
              disabled={!(form.lives_in_lisbon || form.lived_in_lisbon_past)}
            >
              <option>não aplicável</option>
              <option>{"<1 ano"}</option><option>{"1-2 anos"}</option><option>{"2-3 anos"}</option>
              <option>{"3-5 anos"}</option><option>{">5 anos"}</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset style={{border:"1px solid #ddd", padding:"10px", marginBottom:"10px"}}>
        <legend>Mobilidade</legend>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px"}}>
          <label>Uso de transporte público:
            <select value={form.pt_use} onChange={e=>setForm({...form, pt_use:e.target.value})}>
              <option value="">-- selecione --</option>
              <option value="never">Nunca</option>
              <option value="sometimes">Às vezes</option>
              <option value="often">Frequentemente</option>
            </select>
          </label>
          <label>Modo de transporte predominante:
            <select value={form.main_mode} onChange={e=>setForm({...form, main_mode:e.target.value})}>
              <option value="">-- selecione --</option>
              <option value="walk">A pé</option>
              <option value="micromobility">Micromobilidade</option>
              <option value="pt">Transporte público</option>
              <option value="car">Carro</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset style={{border:"1px solid #ddd", padding:"10px", marginBottom:"10px"}}>
        <legend>Perceções</legend>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px"}}>
          <label>Qual o seu nível de conexão com Lisboa (senso de pertença)? (1–5)
            <input type="number" min="1" max="5" value={form.belonging_1_5 ?? ""} onChange={e=>setForm({...form, belonging_1_5: e.target.value===""? null : +e.target.value})}/>
          </label>
          <label>Como avalia a sua sensação de segurança? (1–5)
            <input type="number" min="1" max="5" value={form.safety_overall_1_5 ?? ""} onChange={e=>setForm({...form, safety_overall_1_5: e.target.value===""? null : +e.target.value})}/>
          </label>
        </div>
      </fieldset>

      <div>
        <button onClick={save} disabled={!testMode && requiredMissing.length>0}>Continuar</button>
        {(!testMode && requiredMissing.length>0) && <div style={{ fontSize: ".9rem", color: "#666", marginTop: ".25rem" }}>Preencha os campos acima para prosseguir.</div>}
        {testMode && <div style={{ fontSize: ".9rem", color: "#7c2d12", marginTop: ".4rem" }}>Modo Teste: pode continuar sem preencher tudo. Nada será gravado.</div>}
      </div>
    </div>
  );
}

// =================== LISTA DE SELECIONADOS (sem importância) =================
function SelectedList({ items, setItems }) {
  const removeAt = (idx) => {
    const copy = [...items]; copy.splice(idx,1); setItems(copy);
  };
  const update = (idx, patch) => {
    const copy = [...items]; copy[idx] = { ...copy[idx], ...patch }; setItems(copy);
  };
  return (
    <div>
      <h3>Locais adicionados ({items.length})</h3>
      {items.map((it, idx)=>(
        <div key={it.layerKey || idx} style={{border:"1px solid #ddd", padding:"8px", marginBottom:"8px"}}>
          <div style={{fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
            {it.kind === "osm" ? (it.display_name || `OSM ${it.osm_id}`) : (it.name || "Polígono sem nome")}
          </div>
          <div style={{fontSize:".85rem", color:"#555"}}>Geometria: Polígono · Tipo: {it.feature_type || (it.kind==="manual" ? "manual" : "—")}</div>
          {it.kind === "manual" && (
            <div style={{marginTop:6}}>
              <label>Nome do polígono (obrigatório):
                <input placeholder="Nomeie o polígono (obrigatório)" style={{width:"100%"}}
                  value={it.name} onChange={e=>update(idx,{name:e.target.value})}/>
              </label>
            </div>
          )}
          <div style={{marginTop:6}}>
            <label>Comentário (opcional):
              <input style={{width:"100%"}} value={it.comment || ""} onChange={e=>update(idx,{comment:e.target.value})}/>
            </label>
          </div>
          <div style={{marginTop:6}}><button onClick={()=>removeAt(idx)}>Remover</button></div>
        </div>
      ))}
    </div>
  );
}

// =================== PÁGINA DE UM TEMA =======================================
function ThemePage({ participantId, themeCode, title, prompt, onNext, onSkip, testMode, showRepeatNote }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [items, setItems] = useState([]);
  const mapRef = useRef(null);
  const manualLayerKeys = useRef(new Set());

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const tv = url.searchParams.get("test");
      if (tv && tv === TEST_PASSWORD) localStorage.setItem("testMode","1");
    } catch {}
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const handleStart = () => { try { map.doubleClickZoom.disable(); } catch {} };
    const handleStop  = () => { try { map.doubleClickZoom.enable(); } catch {} };
    map.on("draw:drawstart", handleStart);
    map.on("draw:drawstop", handleStop);
    return () => { map.off("draw:drawstart", handleStart); map.off("draw:drawstop", handleStop); };
  }, []);

  const getMap = () => mapRef.current;

  const fitToGeoJSON = (geojson) => {
    const map = getMap(); if (!map || !geojson) return;
    try {
      map.invalidateSize();
      const group = window.L.featureGroup();
      const layer = window.L.geoJSON(geojson);
      layer.eachLayer(l => group.addLayer(l));
      const b = group.getBounds();
      if (b && b.isValid()) map.fitBounds(b.pad(0.2), { animate: true });
    } catch (e) { console.error("fitToGeoJSON error:", e); }
  };

  const runSearch = async () => {
    if (!q.trim()) return;
    setResults([]);
    try {
      const r = await axios.get(`${API}/geocode`, { params: { q }});
      if (r.data && r.data.error) {
        alert(`Falha ao pesquisar no Nominatim via API.\n\nDetalhe: ${r.data.error}`);
        return;
      }
      const list = (r.data.results || [])
        .filter((it) => isPolygonGeom(it.geojson))
        .map((it) => ({ ...it, _center: getGeoJSONCenter(it.geojson) }))
        .filter((it) => it._center && isInLisbon(it._center[0], it._center[1]));
      setResults(list);
      setTimeout(() => fitToGeoJSON({ type:"FeatureCollection", features: list.filter(x=>x.geojson).map(x=>({type:"Feature", geometry:x.geojson})) }), 0);
    } catch (err) {
      console.error(err);
      const msg = err?.response?.data?.error || err?.message || "Erro desconhecido";
      alert(`Falha ao pesquisar no Nominatim via API.\n\nDetalhe: ${msg}`);
    }
  };

  const addOSM = (r) => {
    if (!isPolygonGeom(r.geojson)) { alert("Apenas polígonos são permitidos."); return; }
    const center = getGeoJSONCenter(r.geojson);
    if (!center || !isInLisbon(center[0], center[1])) { alert("Apenas localizações dentro da cidade de Lisboa."); return; }
    if (items.find(p => p.kind==="osm" && p.osm_id === r.osm_id)) return;
    setItems(prev => [...prev, {
      kind: "osm",
      theme_code: themeCode,
      osm_id: r.osm_id,
      osm_type: r.osm_type,
      display_name: r.display_name,
      osm_class: r.class,
      osm_feature_type: r.type,
      geojson: r.geojson || null,
      geometry_type: "Polygon",
      feature_type: r.class && r.type ? `${r.class}:${r.type}` : (r.class || r.type || ""),
      importance_1_5: 3,
      comment: ""
    }]);
  };

  const onCreated = (e) => {
    const layer = e.layer;
    const gj = layer.toGeoJSON().geometry;
    const c = getGeoJSONCenter(gj);
    if (!isPolygonGeom(gj)) { alert("Desenhe apenas polígonos."); try { layer.remove(); } catch {} return; }
    if (!c || !isInLisbon(c[0], c[1])) { alert("Apenas polígonos dentro da cidade de Lisboa."); try { layer.remove(); } catch {} return; }
    const layerKey = `layer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    layer._websigKey = layerKey;
    manualLayerKeys.current.add(layerKey);
    setItems(prev => [...prev, {
      kind: "manual",
      layerKey,
      theme_code: themeCode,
      name: "",
      importance_1_5: 3,
      comment: "",
      geojson: gj,
      geometry_type: "Polygon",
      feature_type: "manual"
    }]);
  };
  const onDeleted = (e) => {
    const toRemove = new Set();
    try { e.layers.eachLayer((layer) => { if (layer._websigKey) toRemove.add(layer._websigKey); }); } catch {}
    if (toRemove.size === 0) return;
    setItems(prev => prev.filter(it => !(it.kind === "manual" && it.layerKey && toRemove.has(it.layerKey))));
    toRemove.forEach(k => manualLayerKeys.current.delete(k));
  };

  const submit = async () => {
    for (const it of items) {
      if (it.kind==="manual" && !it.name.trim()) { alert("Dê um nome a todos os polígonos criados antes de submeter."); return; }
    }
    if (testMode) { onNext(); return; }

    const payload = {
      participant_id: participantId,
      selections: items.map(it => {
        if (it.kind === "osm") {
          return {
            theme_code: it.theme_code,
            osm_id: it.osm_id,
            importance_1_5: it.importance_1_5,
            comment: it.comment,
            osm_type: it.osm_type,
            display_name: it.display_name,
            osm_class: it.osm_class,
            osm_feature_type: it.osm_feature_type,
            geojson: it.geojson
          };
        } else {
          return {
            theme_code: it.theme_code,
            manual_polygon: {
              name: it.name,
              importance_1_5: it.importance_1_5,
              comment: it.comment,
              geojson: it.geojson
            }
          };
        }
      })
    };

    try { await axios.post(`${API}/submit`, payload); onNext(); }
    catch (err) {
      console.error(err);
      const proceed = window.confirm("Falha ao guardar as seleções no servidor.\nDeseja continuar para a próxima etapa mesmo assim?");
      if (proceed) onNext();
    }
  };

  return (
    <div>
      <div style={{background:"#eef2f7", color:"#1f2937", padding:"8px 12px", borderRadius:8, marginBottom:"12px"}}>
        <strong>Mapeie a sua perceção</strong> — responda com polígonos (pesquisa ou desenho).
        {" "}{testMode && <span style={{color:"#7c2d12"}}>(Modo Teste — não grava dados)</span>}
      </div>

      <h2 style={{marginBottom:6}}>{title}</h2>
      <p style={{marginTop:0}}>{prompt}</p>
      <div style={{fontSize:".95rem", color:"#374151", margin:"4px 0 12px"}}>
        Tente inserir de <strong>duas a cinco</strong> localizações que exprimam esta temática para si.
      </div>
      {showRepeatNote && (
        <div style={{fontSize:".9rem", color:"#666", marginBottom:8}}>
          <strong>Nota:</strong> Adicionou uma localização noutra pergunta e acha que também vale aqui? Tudo bem — pode repetir.
        </div>
      )}

      <div style={{display:"grid", gridTemplateColumns:"1fr", gap:"1rem", minWidth:0}}>
        {/* Pesquisa + resultados (ACIMA DO MAPA) */}
        <div>
          <div style={{display:"flex", gap:"8px", marginBottom:"8px"}}>
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Pesquise aqui uma localização (apenas polígonos)" style={{flex:1}}/>
            <button onClick={runSearch}>Pesquisar</button>
          </div>

          {/* Nota discreta de instruções */}
          <div style={{fontSize:".75rem", color:"#6b7280", margin:"-4px 0 8px"}}>
            Pesquise por uma localização para encontrar a correspondência certa ou crie cuidadosamente o seu próprio polígono.<br/>
            Para criar o polígono manualmente, utilize a ferramenta de <em>desenhar polígono</em> ⬠, depois use <em>editar</em> ✏️ para ajustar com precisão e, se necessário, apague com 🗑️.<br/>  
            Em seguida, na lista de localizações, <strong>nomeie</strong> o seu polígono para compreendermos do que se trata.
          </div>

          <div style={{fontWeight:600, marginBottom:4}}>Resultados da pesquisa</div>
          <div style={{maxHeight:160, overflow:"auto", border:"1px solid #eee", padding:6}}>
            {results.length===0 ? <div style={{color:"#777"}}>Nenhum resultado ainda.</div> :
              results.map((r,i)=>(
                <div key={`r-${i}`} style={{display:"flex", justifyContent:"space-between", gap:8, marginBottom:6, cursor:"pointer"}}
                     onClick={()=> r.geojson ? fitToGeoJSON(r.geojson) : null} title="Clique para fazer zoom no mapa">
                  <div style={{fontSize:".9rem", minWidth:0}}>
                    <div style={{fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{r.display_name}</div>
                    <div style={{color:"#555"}}>{r.class}{r.type?`:${r.type}`:""} · {r.geojson?.type}</div>
                  </div>
                  <div style={{display:"flex", gap:6}}>
                    <button onClick={(e)=>{ e.stopPropagation(); addOSM(r); }}>Adicionar</button>
                    <button onClick={(e)=>{ e.stopPropagation(); fitToGeoJSON(r.geojson); }}>Zoom</button>
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* MAPA */}
        <div>
          <MapContainer ref={mapRef} center={[38.72, -9.14]} zoom={12} style={{height: "520px", width:"100%"}}
            whenCreated={(map) => (mapRef.current = map)}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors"/>

            {/* RESULTADOS (cinza) */}
            {results.map((r, i) => {
              const gj = r.geojson; if (!isPolygonGeom(gj)) return null;
              const addId = `add-${i}`, zoomId = `zoom-${i}`;
              return (
                <GeoJSON
                  key={`gjres-${i}`}
                  data={gj}
                  style={{ color: "#666", weight: 2, fillOpacity: 0.08 }}
                  onEachFeature={(_feature, layer) => {
                    const html = `
                      <div style="max-width:260px">
                        <strong>${r.display_name ?? "Local"}</strong><br/>
                        <div style="font-size:.85rem; color:#555">${r.class ?? ""}${r.type ? `:${r.type}` : ""}</div>
                        <div style="display:flex; gap:6; margin-top:6">
                          <button id="${addId}" type="button">Adicionar</button>
                          <button id="${zoomId}" type="button">Zoom</button>
                        </div>
                      </div>`;
                    layer.bindPopup(html);
                    layer.on("popupopen", () => {
                      const addBtn = document.getElementById(addId);
                      const zoomBtn = document.getElementById(zoomId);
                      if (addBtn) addBtn.onclick = () => addOSM(r);
                      if (zoomBtn) zoomBtn.onclick = () => fitToGeoJSON(gj);
                    });
                  }}
                  eventHandlers={{ click: () => fitToGeoJSON(gj) }}
                />
              );
            })}

            {/* ITENS ADICIONADOS (verde) – apenas OSM (manuais surgem na FeatureGroup) */}
            {items.map((it, i) => {
              if (it.kind === "manual" || !isPolygonGeom(it.geojson)) return null;
              return <GeoJSON key={`sel-${i}`} data={it.geojson} style={{ color: "#2e7d32", weight: 3, fillOpacity: 0.18 }} />;
            })}

            <FeatureGroup>
              <EditControl
                position="topright"
                onCreated={onCreated}
                onDeleted={onDeleted}
                draw={{
                  polyline: false,
                  rectangle: false,
                  circle: false,
                  circlemarker: false,
                  marker: false,
                  polygon: { allowIntersection: false, showArea: true }
                }}
              />
            </FeatureGroup>
          </MapContainer>
        </div>

        {/* LISTA + BOTÕES */}
        <div>
          <SelectedList items={items} setItems={setItems} />
          <div style={{display:"flex", gap:8, marginTop:8, justifyContent:"flex-end", flexWrap:"wrap"}}>
            <button onClick={items.length === 0 ? onSkip : submit}>
              {items.length === 0 ? "Continuar sem mapear →" : "Guardar e continuar →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =================== WIZARD ===================================================
function ThemeWizard({ participantId, onDone, testMode }) {
  const pages = [
    {
      code: "identity",
      title: "Para si, quais os lugares que mais expressam a identidade de Lisboa?",
      prompt: "Assinale áreas que, na sua perceção, representam melhor a identidade lisboeta (use a pesquisa ou desenhe polígonos)."
    },
    {
      code: "cultural_change",
      title: "Para si, quais os lugares que têm se descaracterizado culturalmente?",
      prompt: "Pense em zonas onde, na sua perceção, houve perda de comércio local e/ou afetação do modo de vida tradicional. Sinalize essas áreas (pesquisa ou polígono)."
    },
    {
      code: "cost_sense",
      title: "Sensação de custo",
      prompt: "Quais são as áreas que, para si, transmitem uma sensação de encarecimento/custo de vida elevado (ex.: preços de comércio, serviços, habitação)?"
    }
  ];
  const [idx, setIdx] = useState(0);
  const next = () => setIdx(i => Math.min(i+1, pages.length-1));
  const back = () => setIdx(i => Math.max(i-1, 0));
  const onNext = () => { if (idx === pages.length-1) onDone(); else next(); };
  const onSkip = () => { if (idx === pages.length-1) onDone(); else next(); };

  return (
    <div>
      <ThemePage
        key={pages[idx].code}
        participantId={participantId}
        themeCode={pages[idx].code}
        title={pages[idx].title}
        prompt={pages[idx].prompt}
        onNext={onNext}
        onSkip={onSkip}
        testMode={testMode}
        showRepeatNote={idx >= 1}
      />
      <div style={{display:"flex", gap:8, marginTop:12}}>
        {idx>0 && <button onClick={back}>← Anterior</button>}
      </div>
    </div>
  );
}

export default function App(){
  const [step, setStep] = useState(0);
  const [pid, setPid] = useState(() => localStorage.getItem("pid"));
  const [testMode, setTestMode] = useState(() => { try { return localStorage.getItem("testMode") === "1"; } catch { return false; } });

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const tv = url.searchParams.get("test");
      if (tv && tv === TEST_PASSWORD) { setTestMode(true); localStorage.setItem("testMode","1"); }
    } catch {}
  }, []);

  return (
    <div className="container">
      {/* Cabeçalho com logo (coloque o arquivo em /public/logo_novaims.png) */}
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:12}}>
        <div>
          <h1 style={{marginBottom:4, fontSize:"1.8rem"}}>As Lisboas de Lisboa</h1>
          <div style={{marginTop:-6, marginBottom:16, color:"#666"}}><em>O que as diferentes perceções revelam sobre a cidade.</em></div>
        </div>
        <img
          src="/logo_novaims.png"
          alt="NOVA IMS"
          style={{height:42, opacity:.92}}
          title="NOVA Information Management School"
        />
      </div>

      {step===0 && <Consent onOk={()=>setStep(1)} setPid={setPid} testMode={testMode} />}
      {step===1 && pid && <Profile participantId={pid} onOk={()=>setStep(2)} testMode={testMode} />}
      {step===2 && pid && <ThemeWizard participantId={pid} onDone={()=>setStep(3)} testMode={testMode} />}

      {step===3 && (
        <div>
          <h2>Obrigado!</h2>
          <p>As suas respostas foram guardadas.</p>
          {testMode && <p style={{color:"#7c2d12"}}>Nota: Modo Teste estava ativo — nada foi gravado.</p>}
        </div>
      )}

      <TestModeToggle testMode={testMode} setTestMode={setTestMode} />
    </div>
  );
}
