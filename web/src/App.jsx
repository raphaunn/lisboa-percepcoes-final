import { useState, useRef, useEffect } from "react";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  FeatureGroup,
  GeoJSON
} from "react-leaflet";
import { EditControl } from "react-leaflet-draw";

// ====== CONFIG ======
const API = "https://api-lisbonperceptions.rederua.pt/api";
const TEST_PASSWORD = "lisboa123";

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations?.()
    .then((regs) => regs.forEach((r) => r.unregister().catch(() => {})))
    .catch(() => {});
}

// BBOX aproximado da cidade de Lisboa (minLon, minLat, maxLon, maxLat)
const LISBON_BBOX = [-9.25, 38.69, -9.05, 38.80];
const CITY_BBOX_PARAM = `${LISBON_BBOX[0]},${LISBON_BBOX[1]},${LISBON_BBOX[2]},${LISBON_BBOX[3]}`;

// Catálogo de categorias (rótulo + cor) — deve refletir exatamente o backend
const CATEGORY_META = {
  parks:            { label: "Parques e Jardins",                color: "#2e7d32" },
  public_buildings: { label: "Edifícios públicos",               color: "#1f2937" },
  schools:          { label: "Escolas/Universidades",            color: "#2563eb" },
  hospitals:        { label: "Hospitais/Clínicas",               color: "#dc2626" },
  museums:          { label: "Museus e Equipamentos culturais",  color: "#7c3aed" },
  heritage:         { label: "Património/Histórico",             color: "#8b5e34" },
  sports:           { label: "Equipamentos desportivos",         color: "#0f766e" },
  retail_areas:     { label: "Áreas comerciais",                 color: "#ea580c" },
  neighborhoods:    { label: "Bairros/Regiões",                  color: "#b45309" },
};

function catColor(code) {
  return CATEGORY_META[code]?.color || "#6b7280";
}

// Mapeia class/type do OSM para categorias (alinhado com backend)
function classTypeToCategory(osmClass, osmType) {
  const cls = (osmClass || "").toLowerCase();
  const typ = (osmType || "").toLowerCase();

  // ---- PARKS ----
  if (cls === "leisure" && /(park|garden|nature_reserve|golf_course)/.test(typ))
    return "parks";
  if (cls === "landuse" && /(grass|forest)/.test(typ))
    return "parks";

  // ---- PUBLIC BUILDINGS ----
  if (cls === "building" && /(public|civic|townhall|library|courthouse|government)/.test(typ))
    return "public_buildings";
  if (cls === "amenity" && /(police|fire_station|bureau|public_building)/.test(typ))
    return "public_buildings";

  // ---- SCHOOLS ----
  if (cls === "building" && /(school|university|college|kindergarten)/.test(typ))
    return "schools";
  if (cls === "amenity" && /(school|university|college|kindergarten)/.test(typ))
    return "schools";

  // ---- HOSPITALS ----
  if (cls === "building" && /(hospital|clinic|doctors)/.test(typ))
    return "hospitals";
  if (cls === "amenity" && /(hospital|clinic|doctors|dentist)/.test(typ))
    return "hospitals";

  // ---- MUSEUMS ----
  if (cls === "tourism" && /(museum|gallery)/.test(typ))
    return "museums";

  // ---- HERITAGE ----
  if (cls === "historic" || cls === "heritage")
    return "heritage";
  if (cls === "tourism" && /(attraction|artwork|monument)/.test(typ))
    return "heritage";

  // ---- SPORTS ----
  if (cls === "leisure" && /(stadium|sports_centre|pitch|arena|court)/.test(typ))
    return "sports";

  // ---- RETAIL AREAS ----
  if (cls === "landuse" && /(retail|commercial)/.test(typ))
    return "retail_areas";
  if (cls === "shop")
    return "retail_areas";

  // ---- NEIGHBORHOODS ----
  if (cls === "place" && /(suburb|neighbourhood|quarter|district)/.test(typ))
    return "neighborhoods";

  return null;
}

function isPolygonGeom(gj) {
  return !!gj && (gj.type === "Polygon" || gj.type === "MultiPolygon");
}

function extractPolygonGeometry(gj) {
  if (!gj) return null;

  // Se já for geometria
  if (gj.type === "Polygon" || gj.type === "MultiPolygon") return gj;

  // Se vier como Feature
  if (gj.type === "Feature") {
    const g = gj.geometry;
    if (g && (g.type === "Polygon" || g.type === "MultiPolygon")) return g;
    return null;
  }

  // Se vier como FeatureCollection
  if (gj.type === "FeatureCollection") {
    const feats = gj.features || [];
    for (const f of feats) {
      const g = f?.geometry;
      if (g && (g.type === "Polygon" || g.type === "MultiPolygon")) return g;
    }
    return null;
  }

  return null;
}

// ---- cálculo robusto do centro ----
function _bboxFromCoordsArray(lonlatArray) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of lonlatArray) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}
function _centerFromBBox({minLon, minLat, maxLon, maxLat}) {
  return [(minLat + maxLat)/2, (minLon + maxLon)/2]; // [lat, lon]
}
function _fallbackCenter(geojson) {
  try {
    if (!geojson) return null;
    if (geojson.type === "Polygon") {
      const rings = geojson.coordinates || [];
      if (!rings.length || !rings[0]?.length) return null;
      const bbox = _bboxFromCoordsArray(rings[0]);
      return _centerFromBBox(bbox);
    }
    if (geojson.type === "MultiPolygon") {
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      for (const poly of geojson.coordinates || []) {
        if (!poly?.[0]?.length) continue;
        const b = _bboxFromCoordsArray(poly[0]);
        if (b.minLon < minLon) minLon = b.minLon;
        if (b.minLat < minLat) minLat = b.minLat;
        if (b.maxLon > maxLon) maxLon = b.maxLon;
        if (b.maxLat > maxLat) maxLat = b.maxLat;
      }
      if (!isFinite(minLon)) return null;
      return _centerFromBBox({minLon, minLat, maxLon, maxLat});
    }
  } catch {}
  return null;
}
function getGeoJSONCenter(geojson) {
  try {
    if (!geojson) return null;
    if (geojson.type === "Point") {
      const [lon, lat] = geojson.coordinates;
      return [lat, lon];
    }
    if (typeof window !== "undefined" && window.L && window.L.GeoJSON) {
      const tmp = new window.L.GeoJSON(geojson);
      const b = tmp.getBounds();
      if (b && b.isValid()) {
        const c = b.getCenter();
        return [c.lat, c.lng];
      }
    }
  } catch {}
  return _fallbackCenter(geojson);
}

const normalizeOsmId = (x) => Number(x ?? NaN);

async function getFreshPid() {
  const r = await axios.get(`${API}/consent`, { timeout: 15000 });
  const pid = r?.data?.participant_id;
  if (!pid) throw new Error("API /consent não devolveu participant_id.");
  try { localStorage.setItem("pid", pid); } catch {}
  return pid;
}

// ====== PIP (point-in-polygon) ======
function pointInRing(lat, lon, ringLonLat) {
  const x = lon;
  const y = lat;
  let inside = false;
  for (let i = 0, j = ringLonLat.length - 1; i < ringLonLat.length; j = i++) {
    const xi = ringLonLat[i][0];
    const yi = ringLonLat[i][1];
    const xj = ringLonLat[j][0];
    const yj = ringLonLat[j][1];
    const intersects =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
function pointInPolygonOrMulti(lat, lon, gj) {
  if (!gj) return false;
  if (gj.type === "Polygon") {
    const rings = gj.coordinates;
    if (!rings || rings.length === 0) return false;
    const outer = rings[0];
    if (!pointInRing(lat, lon, outer)) return false;
    for (let k = 1; k < rings.length; k++) {
      if (pointInRing(lat, lon, rings[k])) return false; // buraco
    }
    return true;
  }
  if (gj.type === "MultiPolygon") {
    for (const poly of gj.coordinates || []) {
      const outer = poly[0];
      if (!outer) continue;
      if (!pointInRing(lat, lon, outer)) continue;
      let inHole = false;
      for (let k = 1; k < poly.length; k++) {
        if (pointInRing(lat, lon, poly[k])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
  }
  return false;
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
          background: testMode ? "#dc2626" : "#11182726",
          color:"#ffffffb8", border:"none", borderRadius: 999,
          padding:"4px 6px", cursor:"pointer", fontSize:".6rem"
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
  const allChecked = agreeTerms && consent;

  const create = async () => {
      try {
        localStorage.removeItem("pid");
      } catch {}
    if (testMode) {
      const dummy = `TEST-${Date.now()}`;
      try { localStorage.setItem("pid", dummy); } catch {}
      setPid(dummy);
      await new Promise(res => setTimeout(res, 200));
      onOk();
      return;
    }
    if (!allChecked) return;

    try {
      const r = await axios.get(`${API}/consent`, {
        timeout: 5000   // 5 segundos para evitar freeze infinito
      });
      try { localStorage.setItem("pid", r.data.participant_id); } catch {}
      setPid(r.data.participant_id);
      onOk();
    } catch (err) {
      console.warn("Falha no consentimento remoto, criando ID local.");

      // === fallback local ===
      const fallback = `LOCAL-${Date.now()}`;
      try { localStorage.setItem("pid", fallback); } catch {}
      setPid(fallback);
      onOk(); // segue mesmo assim
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>
        <strong>Olá!</strong>
      </h2>
      <p>O objetivo deste inquérito interativo é mapear as diferentes Lisboas dentro de Lisboa e, para isto, <strong>a sua participação é essencial!</strong></p>
      <p>Pretende-se identificar tendências na forma como diferentes pessoas enxergam a mesma paisagem urbana.</p>
      <p>Esse projeto é realizado em contexto acadêmico, em âmbito do Mestrado de Ciências e Sistemas de Informação Geográfica, pela NOVA IMS. O repositório do projeto, juntamente a referências e informações adicionais encontram-se em: <strong>github.com/raphaunn/lisboa-percepcoes-final.</strong></p>
      <p>O desenvolvimento da plataforma é autoral e o domínio foi contributo da <strong>Rede RUA</strong> (rederua.pt), uma startup de impacto social, com valores alinhados ao projeto, que se prestou a colaborar.</p>
      <p>Este formulário é anónimo e os dados serão usados exclusivamente para fins científicos.</p>
      <p>O tempo estimado é de aproximadamente 5 minutos.</p>
      <p><strong>Nota:</strong> é possível que oscilações na conexão com as bases de dados ocorram e obriguem carregar o botão desejado novamente ou recarregar a página.</p>

      <div style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
        <label><input type="checkbox" checked={agreeTerms} onChange={(e)=>setAgreeTerms(e.target.checked)}/> Li e concordo com os termos de uso.</label>
        <label><input type="checkbox" checked={consent} onChange={(e)=>setConsent(e.target.checked)}/> Consinto em participar do inquérito.</label>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <button onClick={create} disabled={!allChecked && !testMode}>Continuar</button>
        {(!allChecked && !testMode) && <div style={{ fontSize: ".9rem", color: "#666", marginTop: ".25rem" }}>Marque as duas opções acima para prosseguir.</div>}
        {testMode && <div style={{ fontSize: ".9rem", color: "#7c2d12", marginTop: ".4rem" }}>Modo Teste: pode continuar sem marcar as caixas.</div>}
      </div>
    </div>
  );
}

// =================== PERFIL ===================
function Profile({ participantId, onOk, testMode, setPid }) {
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
    visitors_regular: false,
    visitors_sporadic: false,
    years_in_lisbon_band: "não aplicável",
    pt_use: "",
    main_mode: "",
    belonging_1_5: null,
    safety_overall_1_5: null
  });

  // Estado para mostrar/ocultar nota discreta do rendimento (botão ℹ︎)
  const [showIncomeInfo, setShowIncomeInfo] = useState(false);
  // Estado de "saving" para evitar múltiplos pedidos e melhorar UX
  const [saving, setSaving] = useState(false);
  // Trava síncrona anti-duplo clique (não depende do state do React)
  const savingRef = useRef(false);

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
      years_in_lisbon_band: checked || f.lives_in_lisbon ? f.years_in_lisbon_band : "não aplicável"
    }));
  };

  const yearsEnabled = form.lives_in_lisbon || form.lived_in_lisbon_past;
  const hasAnyRelation =
    form.lives_in_lisbon ||
    form.lived_in_lisbon_past ||
    form.works_in_lisbon ||
    form.studies_in_lisbon ||
    form.visitors_regular ||
    form.visitors_sporadic;

  const requiredMissing = [];
  if (!hasAnyRelation) requiredMissing.push("Relação com Lisboa (marque pelo menos uma)");
  if (!form.age_band) requiredMissing.push("Faixa etária");
  if (!form.gender) requiredMissing.push("Género");
  if (!form._ethnicity_choice) requiredMissing.push("Identidade étnico-racial");
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
      alert("Por favor, preencha: \n- " + requiredMissing.join("\n- "));
      return;
    }
      // Evita duplo clique/tap ANTES do React atualizar o estado
    if (savingRef.current) return;
    savingRef.current = true;


    const payload = { ...form, ethnicity: consolidateEthnicity() };

    // === PERFIL PENDENTE (guardar sempre antes do POST) ===
    try {
      localStorage.setItem("pending_profile", JSON.stringify(payload));
      localStorage.setItem("profile_status", "pending");
    } catch {}

    setSaving(true);
  
    // Se viemos do fallback LOCAL-..., tenta regularizar PID antes de salvar perfil
    let pidToUse = participantId;
    
    if (typeof pidToUse === "string" && pidToUse.startsWith("LOCAL-")) {
      try {
        const fresh = await getFreshPid();
        pidToUse = fresh;
        if (typeof setPid === "function") setPid(fresh);
      } catch (e) {
        console.warn("Não foi possível obter PID real; tentando gravar com LOCAL mesmo assim.");
      }
    }

    const postWithPid = (pid) =>
      axios.post(`${API}/profile`, payload, {
        params: { participant_id: pid },
        timeout: 20000,
      });

    try {
      await postWithPid(pidToUse);

      // === PERFIL CONFIRMADO ===
      try {
        localStorage.removeItem("pending_profile");
        localStorage.setItem("profile_status", "confirmed");
      } catch {}

      onOk();
      return;

    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      const msg = (data?.error || err?.message || "").toString().toLowerCase();

      console.log("PROFILE SAVE ERROR:", {
        pid: participantId,
        code: err?.code,
        status: err?.response?.status,
        data: err?.response?.data,
        message: err?.message
      });    

      // 409 duplicate/already existe = SUCESSO
      if (status === 409 && (msg.includes("already") || msg.includes("duplicate") || msg.includes("exists"))) {
        try {
          localStorage.removeItem("pending_profile");
          localStorage.setItem("profile_status", "confirmed");
        } catch {}
        onOk();
        return;
      }  

      const looksLikePidProblem =
        status === 404 || status === 422 ||
        msg.includes("participant") ||
        msg.includes("not found") ||
        msg.includes("foreign key") ||
        msg.includes("invalid");

      if (looksLikePidProblem) {
        try {
          const newPid = await getFreshPid();
          if (typeof setPid === "function") setPid(newPid);

          await postWithPid(newPid);

          // === PERFIL CONFIRMADO (fallback PID) ===
          try {
            localStorage.removeItem("pending_profile");
            localStorage.setItem("profile_status", "confirmed");
          } catch {}

          onOk();
          return;
        } catch (err2) {
          console.error("Auto-recuperação de pid falhou:", err2);
        }
      }

      alert(
        "Ocorreu um problema temporário ao guardar o perfil.\n\n" +
        "Vamos continuar para a próxima etapa."
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }

  };

  return (
    <div>
      <h2>Perfil</h2>

      <fieldset style={{border:"1px solid #ddd", padding:"10px", marginBottom:"10px"}}>
        <legend><strong>Demografia</strong></legend>
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
          <label>Identidade étnico-racial:
            <select value={form._ethnicity_choice} onChange={e=>setForm({...form, _ethnicity_choice:e.target.value})}>
              <option value="">-- selecione --</option>
              {ethnicityChoices.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label>Nacionalidade (origem):
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

          {/* Rendimento com botão informativo discreto */}
          <label style={{display:"grid"}}>
            <span style={{display:"flex", alignItems:"center", gap:6}}>
              <span>Rendimento médio mensal (€):</span>
              <button
                type="button"
                onClick={()=>setShowIncomeInfo(v=>!v)}
                aria-label="Informação sobre rendimento médio mensal"
                title="O que significa 'rendimento médio mensal'?"
                style={{
                  border:"1px solid #dadadaff", background:"#f6f6f6ff", color:"#374151",
                  borderRadius:999, width:20, height:20, fontSize:"1rem",
                  lineHeight:"18px", textAlign:"center", cursor:"pointer", padding:0
                }}
              >ⓘ</button>
            </span>
            <select value={form.income_band} onChange={e=>setForm({...form, income_band:e.target.value})}>
              <option value="">-- selecione --</option>
              <option>{"<700"}</option><option>700–1000</option><option>1000–1500</option>
              <option>1500–2000</option><option>2000–3000</option><option>{">3000"}</option>
              <option>Prefiro não dizer</option>
            </select>
            {showIncomeInfo && (
              <div style={{fontSize:".85rem", color:"#6b7280", marginTop:4}}>
                Entenda como <em>rendimento individual mensal</em>. Quando isso não for objetivamente possível,
                considere a <em>média por indivíduo do agregado familiar</em>.
              </div>
            )}
          </label>
        </div>
      </fieldset>

      <fieldset style={{border:"1px solid #ddd", padding:"10px", marginBottom:"10px"}}>
        <legend><strong>Habitação</strong></legend>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px"}}>
          <label>Situação habitacional atual:
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
        <legend><strong>Relação com Lisboa</strong></legend>
        <div style={{marginBottom:"6px"}}><strong>Selecione as opções que se aplicam:</strong></div>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px"}}>
          <label><input type="checkbox" checked={form.lives_in_lisbon} onChange={e=>toggleLivesNow(e.target.checked)}/> Vivo atualmente em Lisboa</label>
          <label><input type="checkbox" checked={form.lived_in_lisbon_past} onChange={e=>toggleLivedPast(e.target.checked)}/> Vivi em Lisboa no passado</label>
          <label><input type="checkbox" checked={form.works_in_lisbon} onChange={e=>setForm({...form, works_in_lisbon: e.target.checked})}/> Trabalho em Lisboa</label>
          <label><input type="checkbox" checked={form.studies_in_lisbon} onChange={e=>setForm({...form, studies_in_lisbon: e.target.checked})}/> Estudo em Lisboa</label>
          <label><input type="checkbox" checked={form.visitors_regular} onChange={e=>setForm({...form, visitors_regular: e.target.checked})}/> Visitante regular (conhece razoavelmente Lisboa)</label>
          <label><input type="checkbox" checked={form.visitors_sporadic} onChange={e=>setForm({...form, visitors_sporadic: e.target.checked})}/> Turista ou visitante esporádico</label>
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
              <option>{"3-5 anos"}</option>
              <option>{"5-7 anos"}</option><option>{"7-10 anos"}</option><option>{">10 anos"}</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset style={{border:"1px solid #ddd", padding:"10px", marginBottom:"10px"}}>
        <legend><strong>Mobilidade</strong></legend>
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
              <option value="micromobility">Micromobilidade (bicicleta, trotinete, etc.)</option>
              <option value="pt">Transporte público</option>
              <option value="car">Carro</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset style={{
        border:"1px solid #e5e7eb",
        background:"#ffffffa2",
        padding:"10px",
        marginTop:"18px",
        marginBottom:"10px",
        borderRadius:"6px"
      }}>
        <legend><strong>Perceções</strong></legend>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px"}}>
          <label>Qual o seu nível de conexão com Lisboa (sensação de pertença)? (1–5)
            <input
              type="number"
              min="1"
              max="5"
              value={form.belonging_1_5 ?? ""}
              onChange={e=>setForm({
                ...form,
                belonging_1_5: e.target.value===""? null : +e.target.value
              })}
            />
            <div style={{fontSize:".85rem", color:"#6b7280"}}>
              Indique de 1 a 5, sendo <strong>1</strong> “muito pouca ou nula conexão” e <strong>5</strong> “muita conexão”.
            </div>
            <div style={{fontSize:".85rem", color:"#6b7280"}}>
              <strong>Nota:</strong> “Pertença” refere-se à ligação emocional e social ao lugar e à comunidade.
            </div>
          </label>
          <label>Como avalia a sua sensação de segurança? (1–5)
            <input
              type="number"
              min="1"
              max="5"
              value={form.safety_overall_1_5 ?? ""}
              onChange={e=>setForm({
                ...form,
                safety_overall_1_5: e.target.value===""? null : +e.target.value
              })}
            />
            <div style={{fontSize:".85rem", color:"#6b7280"}}>
              Indique de 1 a 5, sendo <strong>1</strong> “muito baixa” e <strong>5</strong> “muito alta”.
            </div>
            <div style={{fontSize:".85rem", color:"#6b7280"}}>
              <strong>Nota:</strong> é uma perceção subjetiva influenciada por fatores pessoais e pela qualidade do espaço público.
            </div>
          </label>
        </div>
      </fieldset>

      <div>
        <button
          onClick={save}
          disabled={
            (!testMode && requiredMissing.length > 0) || saving
          }
        >
          {saving ? "A guardar..." : "Continuar"}
        </button>
        {(!testMode && requiredMissing.length>0) && (
          <div style={{ fontSize: ".9rem", color: "#666", marginTop: ".25rem" }}>
            Preencha os campos acima para prosseguir.
          </div>
        )}
        {testMode && (
          <div style={{ fontSize: ".9rem", color: "#7c2d12", marginTop: ".4rem" }}>
            Modo Teste: pode continuar sem preencher tudo. Nada será gravado.
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Placeholders curtos para comentários =====
const COMMENT_PLACEHOLDERS = [
  "Ex.: o uso da praça mudou depois da pandemia",
  "Ex.: esta rua costuma ser perigosa à noite",
  "Ex.: tornou-se muito turístico nos últimos anos",
  "Ex.: comércio local substituído por alojamento"
];

// =================== LISTA DE SELECIONADOS =================
function SelectedList({ items, setItems, onRemove }) {
  const removeAt = (idx) => {
    const copy = [...items];
    const removed = copy[idx];
    copy.splice(idx,1);
    setItems(copy);
    onRemove?.(removed); // o ThemePage trata da remoção da camada manual, se existir
  };
  const update = (idx, patch) => {
    const copy = [...items]; copy[idx] = { ...copy[idx], ...patch }; setItems(copy);
  };
  return (
    <div>
      <h3>Locais adicionados ({items.length})</h3>
      {items.map((it, idx)=>(
        <div key={it.layerKey || `${it.kind}-${it.osm_id}` || idx} style={{border:"1px solid #ddd", padding:"8px", marginBottom:"8px"}}>
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
              <input
                style={{width:"100%"}}
                value={it.comment || ""}
                placeholder={COMMENT_PLACEHOLDERS[idx % COMMENT_PLACEHOLDERS.length]}
                onChange={e=>update(idx,{comment:e.target.value})}
              />
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
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [results, setResults] = useState([]);
  const [items, setItems] = useState([]);
  const [showHowTo, setShowHowTo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const searchAbortRef = useRef(null);

  // Categorias
  const [categories, setCategories] = useState([]);
  const [selectedCats, setSelectedCats] = useState(new Set());
  const [catFeatures, setCatFeatures] = useState({}); // code -> array de feats
  const [showCats, setShowCats] = useState(false);     // botão expansível

  // Loading por categoria + ativar por defeito
  const [loadingCats, setLoadingCats] = useState(new Set());
  const loadingCatsRef = useRef(loadingCats);
  useEffect(()=>{ loadingCatsRef.current = loadingCats; }, [loadingCats]);

  useEffect(() => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: "smooth" // ou "auto"
    });
  }, []);

  // *ATIVAR CATEGORIAS POR DEFEITO - DESATIVADO PARA OTIMIZAÇÃO DE PROCESSAMENTO
 // useEffect(() => {
 //   if (categories.length > 0 && selectedCats.size === 0) {
 //     const all = new Set(categories.map(c => c.code));
 //     setSelectedCats(all);
 //  
      // carregar todas as categorias logo ao início
 //     categories.forEach(cat => {
 //       fetchCategory(cat.code, CITY_BBOX_PARAM);
 //       catFirstGlobalRef.current[cat.code] = true;
 //     });
 //   }
 // }, [categories]);

  // Controle de versão de requisições por categoria
  const catReqVersionRef = useRef({}); // { [code]: number }

  // Primeira carga ampla (cidade inteira) por categoria
  const catFirstGlobalRef = useRef({}); // { [code]: boolean }

  // Duplicados (OSM já adicionados)
  const [selectedOSM, setSelectedOSM] = useState(new Set());
  const selectedOSMRef = useRef(selectedOSM);
  useEffect(()=>{ selectedOSMRef.current = selectedOSM; }, [selectedOSM]);

  // Limite real de Lisboa
  const [lisbonBoundary, setLisbonBoundary] = useState(null);

  const mapRef = useRef(null);

  // mapeamento layerKey -> layer viva no FeatureGroup (para remover/editar de forma confiável)
  const fgRef = useRef(null);
  const manualLayersIndexRef = useRef(new Map()); // Map(layerKey => LeafletLayer)

  // registo dos layerKeys ativos
  const manualLayerKeys = useRef(new Set());
  const moveDebounceTimer = useRef(null);

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

    const onMoveEnd = () => {
      if (moveDebounceTimer.current) clearTimeout(moveDebounceTimer.current);
      moveDebounceTimer.current = setTimeout(() => {
        refreshSelectedCategories();
      }, 400);
    };
    map.on("moveend", onMoveEnd);

    return () => {
      map.off("draw:drawstart", handleStart);
      map.off("draw:drawstop", handleStop);
      map.off("moveend", onMoveEnd);
    };
  }, []);

  // Carrega lista de categorias
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/categories`);
        const cats = (r.data?.categories || []).map(c => ({
          ...c,
          color: CATEGORY_META[c.code]?.color || "#666",
          label: CATEGORY_META[c.code]?.label || c.label || c.code
        }));
        setCategories(cats);
      } catch (e) {
        console.warn("Falha ao carregar categorias:", e);
      }
    })();
  }, []);

  // Carrega contorno real de Lisboa
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/lisbon_boundary`, { timeout: 15000 });
  
        // alguns backends devolvem {geojson: ...}, outros devolvem o GeoJSON direto
        const raw = r.data?.geojson ?? r.data;
  
        const geom = extractPolygonGeometry(raw);
        if (geom) setLisbonBoundary(geom);
        else console.warn("lisbon_boundary veio sem Polygon/MultiPolygon:", raw);
  
      } catch (e) {
        console.warn("Falha ao carregar limite de Lisboa; usando apenas BBOX.", e);
      }
    })();
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

  const getCurrentBboxParam = () => {
    const map = getMap();
    if (!map) {
      const [minLon, minLat, maxLon, maxLat] = LISBON_BBOX;
      return `${minLon},${minLat},${maxLon},${maxLat}`;
    }
    const b = map.getBounds();
    const south = b.getSouth();
    const west  = b.getWest();
    const north = b.getNorth();
    const east  = b.getEast();
    return `${west},${south},${east},${north}`;
  };

  const isInsideLisbon = (lat, lon) => {
    if (lisbonBoundary && isPolygonGeom(lisbonBoundary)) {
      return pointInPolygonOrMulti(lat, lon, lisbonBoundary);
    }
    const [minLon, minLat, maxLon, maxLat] = LISBON_BBOX;
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
  };

  // =================== BUSCA ===================
  const runSearch = async () => {
    const term = q.trim();
    if (!term) return;

    // === CANCELA A PESQUISA ANTERIOR ===
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    searchAbortRef.current = new AbortController();

    setLoadingSearch(true);
    setResults([]);

    try {
      // índice osm_id -> categoria já carregada
      const knownCatByOsmId = new Map();
      for (const code of Object.keys(catFeatures)) {
        const feats = catFeatures[code] || [];
        for (const f of feats) {
          const oid = Number(f.osm_id ?? NaN);
          if (Number.isFinite(oid)) knownCatByOsmId.set(oid, code);
        }
      }

      const r = await axios.get(`${API}/geocode`, {
        params: { q: term },
        timeout: 10000,
        signal: searchAbortRef.current.signal
      });

      if (r.data && r.data.error) {
        alert(`Lentidão inesperada ao tentar pesquisar no Nominatim via API. Tente executar a ação novamente.\n\nDetalhe: ${r.data.error}`);
        return;
      }

      const list = (r.data.results || [])
        .filter((it) => isPolygonGeom(it.geojson))
        .map((it) => {
          const center = getGeoJSONCenter(it.geojson);
          const oid = Number(it.osm_id ?? NaN);
          const knownCat = Number.isFinite(oid) ? knownCatByOsmId.get(oid) : null;
          const inferred = classTypeToCategory(it.class, it.type);
          const cat = knownCat || inferred || null;
          return {
            ...it,
            _center: center,
            _cat: cat,
            _color: catColor(cat),
          };
        });

      setResults(list);

    } catch (err) {
      // === PESQUISA CANCELADA — NÃO FAZ NADA ===
      if (
        axios.isCancel?.(err) ||
        err?.name === "CanceledError" ||
        err?.name === "AbortError"
      ) {
        return;
      }

      console.error(err);
      const msg = err?.response?.data?.error || err?.message || "Erro desconhecido";
      alert(
        "A pesquisa demorou mais do que o esperado.\n" +
        "Isto pode acontecer por instabilidade temporária do serviço.\n\n" +
        "Por favor, tente novamente."
      );
    } finally {
      setLoadingSearch(false);
    }
  };

  // =================== DEDUP (OSM) ===================
  const hasOsmAlready = (osmIdRaw) => {
    const osmId = Number(osmIdRaw ?? NaN);
    if (!Number.isFinite(osmId)) return false;
    if (selectedOSMRef.current.has(osmId)) return true;
    return items.some(it => it.kind === "osm" && Number(it.osm_id ?? NaN) === osmId);
  };

  const addOSM = (r) => {
    if (!isPolygonGeom(r.geojson)) { alert("Apenas polígonos são permitidos."); return; }
    const center = getGeoJSONCenter(r.geojson);
    if (!center || !isInsideLisbon(center[0], center[1])) { alert("Apenas localizações dentro da cidade de Lisboa."); return; }

    const osmId = Number(r.osm_id ?? NaN);
    if (!Number.isFinite(osmId)) return;
    if (hasOsmAlready(osmId)) return; // dedup forte

    setItems(prev => [...prev, {
      kind: "osm",
      theme_code: themeCode,
      osm_id: osmId,
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
    setSelectedOSM(prev => {
      const next = new Set(prev);
      next.add(osmId);
      return next;
    });
  };

  // =================== DESENHO MANUAL (MELHORADO) ===================
  // 1) Criação: adiciona o polígono à lista + indexa o layer para futuras edições/remoções
  const onCreated = (e) => {
    const layer = e.layer;
    const gj = layer.toGeoJSON().geometry;

    if (!isPolygonGeom(gj)) { // garante que só entram polígonos
      alert("Desenhe apenas polígonos.");
      try { layer.remove(); } catch {}
      return;
    }

    const c = getGeoJSONCenter(gj);
    if (!c || !isInsideLisbon(c[0], c[1])) {
      alert("Apenas polígonos dentro da cidade de Lisboa.");
      try { layer.remove(); } catch {}
      return;
    }

    // heurística contra duplicados de manuais (centro + nº vértices)
    const EPS = 1e-5;
    const vertCount = (gj.type === "Polygon") ? (gj.coordinates?.[0]?.length || 0)
                    : (gj.coordinates?.[0]?.[0]?.length || 0);
    const isDup = items.some(it => {
      if (it.kind !== "manual" || !isPolygonGeom(it.geojson)) return false;
      const cc = getGeoJSONCenter(it.geojson);
      const v2 = (it.geojson.type === "Polygon") ? (it.geojson.coordinates?.[0]?.length || 0)
                : (it.geojson.coordinates?.[0]?.[0]?.length || 0);
      if (!cc) return false;
      const dLat = Math.abs((cc[0] ?? 0) - c[0]);
      const dLon = Math.abs((cc[1] ?? 0) - c[1]);
      return dLat < EPS && dLon < EPS && v2 === vertCount;
    });
    if (isDup) {
      alert("Este polígono parece duplicado de outro já desenhado.");
      try { layer.remove(); } catch {}
      return;
    }

    // liga uma chave única ao layer e guarda referência
    const layerKey = `layer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    layer._websigKey = layerKey;
    manualLayerKeys.current.add(layerKey);

    // Indexa o layer vivo (para remoções/edições posteriores)
    try { manualLayersIndexRef.current.set(layerKey, layer); } catch {}

    // Adiciona item ao estado
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

  // 2) Edição: se o utilizador mexer nos vértices, sincroniza a nova geometria no array de itens
  const onEdited = (e) => {
    const updates = [];
    try {
      e.layers.eachLayer((layer) => {
        const key = layer._websigKey;
        if (!key) return;
        const gj = layer.toGeoJSON().geometry;
        if (!isPolygonGeom(gj)) return; // ignora edições inválidas
        updates.push({ key, gj });
      });
    } catch {}
    if (updates.length === 0) return;

    setItems(prev => prev.map(it => {
      if (it.kind === "manual" && it.layerKey) {
        const u = updates.find(up => up.key === it.layerKey);
        if (u) return { ...it, geojson: u.gj };
      }
      return it;
    }));
  };

  // 3) Remoção via caixa de edição (lixo): retira também da lista
  const onDeleted = (e) => {
    const toRemoveKeys = new Set();
    try {
      e.layers.eachLayer((layer) => {
        if (layer._websigKey) toRemoveKeys.add(layer._websigKey);
      });
    } catch {}
    if (toRemoveKeys.size === 0) return;

    setItems(prev => prev.filter(it => !(it.kind === "manual" && it.layerKey && toRemoveKeys.has(it.layerKey))));
    toRemoveKeys.forEach(k => {
      manualLayerKeys.current.delete(k);
      manualLayersIndexRef.current.delete(k);
    });
  };

  // Função utilitária: remover camada manual quando o utilizador apaga na lista
  const removeManualLayerByKey = (layerKey) => {
    const fg = fgRef.current;
    if (!fg || !layerKey) return;
    const layer = manualLayersIndexRef.current.get(layerKey);
    if (layer) {
      try { fg.removeLayer(layer); } catch {}
      manualLayersIndexRef.current.delete(layerKey);
      manualLayerKeys.current.delete(layerKey);
    } else {
      // fallback: varrer o FG à procura do layer (defensivo)
      try {
        const layers = fg.getLayers?.() || [];
        for (const L of layers) {
          if (L && L._websigKey === layerKey) {
            try { fg.removeLayer(L); } catch {}
            break;
          }
        }
      } catch {}
      manualLayerKeys.current.delete(layerKey);
    }
  };

  // =================== CATEGORIAS ===================
  const getCurrentBbox = () => getCurrentBboxParam();

  const markCatLoading = (code, isLoading) => {
    setLoadingCats(prev => {
      const next = new Set(prev);
      if (isLoading) next.add(code); else next.delete(code);
      return next;
    });
  };

  // tentativa com fallback automático se der erro (ex.: 502)
  const fetchCategory = async (code, bboxOverride = null) => {
    const ver = (catReqVersionRef.current[code] || 0) + 1;
    catReqVersionRef.current[code] = ver;

    markCatLoading(code, true);

    const attempt = async (bboxParam, limitVal) => {
      const r = await axios.get(`${API}/category/${encodeURIComponent(code)}`, {
        params: { bbox: bboxParam, limit: limitVal }
      });
      const feats = (r.data?.results || [])
        .filter(f => isPolygonGeom(f.geojson))
        .map((f) => ({...f, _center: getGeoJSONCenter(f.geojson)}))
        .filter(f => f._center && isInsideLisbon(f._center[0], f._center[1]));
      return feats;
    };

    try {
      const primaryBBox = bboxOverride || getCurrentBbox();
      const primaryLimit = bboxOverride ? 800 : 900;
      const feats = await attempt(primaryBBox, primaryLimit);
      if (catReqVersionRef.current[code] !== ver) return;
      setCatFeatures(prev => ({ ...prev, [code]: feats }));
    } catch (e1) {
      try {
        const status = e1?.response?.status;
        console.warn("Falha ao carregar categoria", code, e1?.message || status || e1);
        const fbBBox = getCurrentBbox();
        const featsFb = await attempt(fbBBox, 600);
        if (catReqVersionRef.current[code] !== ver) return;
        setCatFeatures(prev => ({ ...prev, [code]: featsFb }));
      } catch (e2) {
        console.error("Fallback também falhou para", code, e2?.message || e2);
      }
    } finally {
      if (catReqVersionRef.current[code] === ver) markCatLoading(code, false);
    }
  };

  const refreshSelectedCategories = () => {
    if (!selectedCats || selectedCats.size === 0) return;
    selectedCats.forEach(code => fetchCategory(code));
  };

  const toggleCategory = async (code, checked) => {
    const next = new Set(selectedCats);
    if (checked) next.add(code); else next.delete(code);
    setSelectedCats(next);

    if (checked) {
      if (!catFirstGlobalRef.current[code]) {
        catFirstGlobalRef.current[code] = true;
        fetchCategory(code, CITY_BBOX_PARAM);
      } else {
        fetchCategory(code);
      }
    } else {
      setCatFeatures(prev => {
        const copy = { ...prev };
        delete copy[code];
        return copy;
      });
    }
  };

  // =================== SUBMETER ===================
  async function ensureProfileConfirmed(participantId) {
    const status = localStorage.getItem("profile_status");
  
    // Já confirmado → segue
    if (status === "confirmed") return true;
  
    const raw = localStorage.getItem("pending_profile");
    if (!raw) return false;
  
    try {
      const payload = JSON.parse(raw);
  
      await axios.post(`${API}/profile`, payload, {
        params: { participant_id: participantId },
        timeout: 15000
      });
  
      localStorage.removeItem("pending_profile");
      localStorage.setItem("profile_status", "confirmed");
      return true;
  
    } catch (err) {
      console.warn("Falha ao confirmar perfil antes do submit:", err);
      return false;
    }
  }

  const submit = async () => {
    for (const it of items) {
      if (it.kind === "manual" && !it.name.trim()) {
        alert("Dê um nome a todos os polígonos criados antes de submeter.");
        return;
      }
    }
  
    if (testMode) {
      onNext();
      return;
    }
  
    // 🔒 GARANTIA FINAL DE PERFIL
    const profileOk = await ensureProfileConfirmed(participantId);
    if (!profileOk) {
      alert(
        "Não foi possível confirmar o seu perfil neste momento.\n\n" +
        "Por favor, verifique a sua ligação à internet e tente novamente.\n\n" +
        "Os dados continuam visíveis nesta página."
      );
      return;
    }

    if (submitting) return;
    setSubmitting(true);

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

    try {
      await axios.post(`${API}/submit`, payload, { timeout: 8000 });
      onNext();
    } catch (err) {
      console.error(err);
      const retry = window.confirm(
        "Falha ao guardar as seleções no servidor.\n\n" +
        "Deseja tentar novamente agora?"
      );
      if (retry) {
        try {
          await axios.post(`${API}/submit`, payload, { timeout: 10000 });
          onNext();
          return;
        } catch (err2) {
          console.error(err2);
          alert(
            "Ainda não foi possível guardar as seleções.\n\n" +
            "Verifique a sua ligação à internet e tente novamente dentro de instantes.\n\n" +
            "Enquanto permanecer nesta página, as localizações continuam visíveis e pode voltar a clicar em \"Guardar e continuar\"."
          );
        }
      } else {
        alert(
          "As localizações continuam visíveis nesta página.\n\n" +
          "Pode voltar a tentar guardar clicando novamente em \"Guardar e continuar\"."
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ===== Micro-explicação por tema =====
  const microExplain = (() => {
    if (themeCode === "identity") {
      return 'Ex.: um miradouro, um bairro ou um jardim que, para si, resume "o que é Lisboa". Podem ser lugares simbólicos do seu quotidiano.';
    }
    if (themeCode === "cultural_change") {
      return "Ex.: uma rua onde o comércio local fechou, uma zona tradicional que perdeu moradores, ou um largo que mudou de uso.";
    }
    if (themeCode === "cost_sense") {
      return "Ex.: áreas onde sente preços mais altos (habitação, serviços, restauração) ou maior pressão económica.";
    }
    return "";
  })();

  // =================== RENDER ===================
  const anyCatLoading = loadingCats.size > 0;

  return (
    <div>
      <div style={{background:"#eef2f7", color:"#1f2937b3", padding:"2px 12px", borderRadius:8, marginBottom:"12px"}}>
        Mapeie a sua perceção através de representações espaciais (pesquisa, categorias no mapa, ou desenho).
        {" "}{testMode && <span style={{color:"#7c2d12"}}>(Modo Teste — não grava dados)</span>}
      </div>

      {/* === BLOCO DE DESTAQUE === */}
      <div style={{
        background:"#d0d0d032", border:"3px solid #000000ff", borderRadius:12,
        padding:"14px 14px 10px", boxShadow:"0 1px 2px rgba(0,0,0,0.04)", marginBottom:12
      }}>
        <h2 style={{margin:"0 0 6px 0"}}>{title}</h2>
        <p style={{margin:"0 0 10px 0"}}>{prompt}</p>

        {/* Micro-explicação curta por tema */}
        {microExplain && (
          <div style={{
            margin:"0 0 10px 0",
            fontSize:".95rem",
            color:"#374151",
            background:"#ffffff19",
            border:"1px solid #e5e7eb",
            borderRadius:8,
            padding:"8px 10px"
          }}>
            {microExplain}
          </div>
        )}

        {/* Caixa discreta DENTRO do bloco de destaque */}
        <div style={{
          margin:"2px 0 10px",
          background:"#d0d0d054",
          border:"2px solid #000000ff",
          borderRadius:8,
          padding:"10px 12px",
          color:"#334155"
        }}>
          Insira <strong>tantas localizações quanto considerar relevantes para esta temática</strong>, pesquisando, navegando pelo mapa através das categorias ou desenhando livremente.
        </div>
      </div>

      {/* Botão "Como mapear" — discreto, acima da pesquisa */}
      <div style={{display:"flex", justifyContent:"flex-start", marginBottom:"8px"}}>
        <button
          onClick={()=>setShowHowTo(v=>!v)}
          style={{
            background:"transparent",
            color:"#4b5563",
            border:"1px solid #e5e7eb",
            borderRadius:8,
            padding:"6px 10px",
            cursor:"pointer",
            whiteSpace:"nowrap",
            fontSize:".95rem"
          }}
          title="Como mapear"
        >
          {showHowTo ? "Fechar instruções" : "ⓘ Como mapear"}
        </button>
      </div>

      {showHowTo && (
        <div style={{
          marginTop:4, marginBottom:8,
          background:"#f9fafb", border:"1px solid #e5e7eb",
          borderRadius:8, padding:"10px 12px", color:"#374151", fontSize:".95rem"
        }}>
          Pesquise por uma localização para encontrar a correspondência certa ou <strong>explore no mapa</strong> selecionando as categorias alinhadas ao que deseja pesquisar.
          Caso não encontre, não há problema! Pode criar cuidadosamente o seu próprio polígono.
          <br/>Para criar o polígono manualmente, utilize a ferramenta de <em>desenhar polígono</em> ⬠, depois use <em>editar</em> ✏️ para ajustar com precisão e, se necessário, apague com 🗑️.
          Em seguida, na lista de localizações, <strong>nomeie</strong> o seu polígono para compreendermos do que se trata.
        </div>
      )}

      <br />

      {/* Pesquisa */}
      <div style={{display:"flex", gap:"8px", marginBottom:"8px", alignItems:"center"}}>
        <input
          value={q}
          onChange={e=>setQ(e.target.value)}
          placeholder="Pesquise aqui uma localização (apenas polígonos)"
          style={{flex:1}}
          onKeyDown={(e)=>{ if (e.key === "Enter") runSearch(); }}
        />
        <button onClick={runSearch} disabled={loadingSearch}>
          {loadingSearch ? "A pesquisar..." : "Pesquisar"}
        </button>
      </div>

      {/* Resultados da pesquisa */}
      <div style={{fontWeight:600, margin:"8px 0 4px"}}>Resultados da pesquisa</div>
      <div style={{maxHeight:180, overflow:"auto"}}>
        {results.length===0 ? (
          <div style={{color:"#777", padding:"6px 0"}}>{loadingSearch ? "A carregar..." : "Nenhum resultado ainda."}</div>
        ) : results.map((r,i)=>{
          const catCode = r._cat;
          const color = r._color || "#6b7280";
          const already = hasOsmAlready(r.osm_id);
          return (
            <div key={`r-${i}`}
                 style={{
                   display:"flex", justifyContent:"space-between", gap:8, marginBottom:6, cursor:"pointer",
                   border:"1px solid #e5e7eb", borderLeft:`4px solid ${color}`, borderRadius:6, padding:8, background:"#fff"
                 }}
                 title="Clique para fazer zoom no mapa"
                 onClick={()=> r.geojson ? fitToGeoJSON(r.geojson) : null}>
              <div style={{fontSize:".9rem", minWidth:0}}>
                <div style={{display:"flex", alignItems:"center", gap:8}}>
                  <div style={{width:10, height:10, borderRadius:999, background:color}} />
                  <div style={{fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                    {r.display_name}
                  </div>
                </div>
                <div style={{color:"#555", marginTop:2}}>
                  {r.class}{r.type?`:${r.type}`:""} · {r.geojson?.type}
                  {catCode && (
                    <span style={{marginLeft:8, fontSize:".85rem", padding:"2px 6px", borderRadius:999, background:"#f3f4f6"}}>
                      {CATEGORY_META[catCode]?.label || catCode}
                    </span>
                  )}
                </div>
              </div>
              <div style={{display:"flex", gap:6}}>
                <button
                  onClick={(e)=>{ e.stopPropagation(); if (!already) addOSM(r); }}
                  disabled={already}
                  style={already ? {opacity:.6, cursor:"not-allowed"} : {}}
                >
                  {already ? "Já adicionado" : "Adicionar"}
                </button>
                <button onClick={(e)=>{ e.stopPropagation(); fitToGeoJSON(r.geojson); }}>Zoom</button>
              </div>
            </div>
          );
        })}
      </div>

      <br />

      {/* Explorar por categoria */}
      <div style={{marginTop:12, marginBottom:8}}>
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          <div style={{fontWeight:600}}>Explorar por categoria</div>
          {anyCatLoading && (
            <div style={{fontSize:".9rem", color:"#475569"}} title="A carregar mais locais da(s) categoria(s) visível(is) conforme o mapa">
              ⏳ a carregar locais…
            </div>
          )}
        </div>

        {/* Botão expansível "Categorias" */}
        <div style={{marginTop:6, marginBottom:6}}>
          <button
            onClick={()=>setShowCats(v=>!v)}
            style={{
              border:"1px solid #e5e7eb", background:"#fff", borderRadius:8,
              padding:"6px 10px", cursor:"pointer", fontWeight:600, color:"#111827", fontSize:".95rem",
              display:"inline-flex", alignItems:"center", gap:6
            }}
            aria-expanded={showCats}
          >
            <span>Categorias</span>
            <span>{showCats ? "▲" : "▼"}</span>
          </button>
        </div>

        {showCats && (
          <div style={{display:"flex", flexWrap:"wrap", gap:10, marginTop:6}}>
            {categories.map(cat => {
              const checked = selectedCats.has(cat.code);
              const isLoading = loadingCats.has(cat.code);
              return (
                <label key={cat.code}
                       style={{
                         display:"inline-flex", alignItems:"center", gap:8,
                         border:`1px solid ${checked ? cat.color : "#e5e7eb"}`,
                         background: checked ? "#f8fafc" : "#fff",
                         padding:"6px 10px", borderRadius:999, cursor:"pointer"
                       }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e=>toggleCategory(cat.code, e.target.checked)}
                  />
                  <span style={{width:10, height:10, borderRadius:999, background:cat.color}} />
                  <span>{cat.label}</span>
                  {isLoading && <span style={{fontSize:".85rem", color:"#64748b"}}> · a carregar…</span>}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* MAPA */}
      <div style={{position:"relative"}}>
        <MapContainer ref={mapRef} center={[38.72, -9.14]} zoom={12} style={{height: "540px", width:"100%"}}
          whenCreated={(map) => (mapRef.current = map)}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors"/>

          {/* Contorno real de Lisboa (se disponível) */}
          {lisbonBoundary && isPolygonGeom(lisbonBoundary) && (
            <GeoJSON
              data={lisbonBoundary}
              style={{ color: "#334155", weight: 2, fillOpacity: 0, dashArray: "6 4" }}
            />
          )}

          {/* RESULTADOS da pesquisa no mapa */}
          {results.map((r, i) => {
            const gj = r.geojson; if (!isPolygonGeom(gj)) return null;
            const color = r._color || "#6b7280";
            const addId = `sr-add-${i}`, zoomId = `sr-zoom-${i}`;
            return (
              <GeoJSON
                key={`gjres-${i}`}
                data={gj}
                style={{ color, weight: 2, fillOpacity: 0.08 }}
                onEachFeature={(_feature, layer) => {
                  const already = hasOsmAlready(r.osm_id);
                  const html = `
                    <div style="max-width:260px">
                      <div style="display:flex;align-items:center;gap:8px">
                        <div style="width:10px;height:10px;border-radius:999px;background:${color}"></div>
                        <strong>${r.display_name ?? "Local"}</strong>
                      </div>
                      <div style="font-size:.85rem; color:#555; margin-top:4px">
                        ${r.class ?? ""}${r.type ? `:${r.type}` : ""}
                        ${r._cat ? ` · ${CATEGORY_META[r._cat]?.label || r._cat}` : ""}
                      </div>
                      <div style="display:flex; gap:6; margin-top:8">
                        <button id="${addId}" type="button" ${already?"disabled style='opacity:.6;cursor:not-allowed'":""}>${already?"Já adicionado":"Adicionar"}</button>
                        <button id="${zoomId}" type="button">Zoom</button>
                      </div>
                    </div>`;
                  layer.bindPopup(html);
                  layer.on("popupopen", () => {
                    const addBtn = document.getElementById(addId);
                    const zoomBtn = document.getElementById(zoomId);
                    if (addBtn && !already) addBtn.onclick = () => addOSM(r);
                    if (zoomBtn) zoomBtn.onclick = () => fitToGeoJSON(gj);
                  });
                }}
                eventHandlers={{ click: () => fitToGeoJSON(gj) }}
              />
            );
          })}

          {/* CAMADAS POR CATEGORIA (coloridas) */}
          {[...selectedCats].map(code => {
            const feats = catFeatures[code] || [];
            const color = catColor(code);
            return feats.map((f, idx) => {
              const gj = f.geojson; if (!isPolygonGeom(gj)) return null;
              const addId = `cat-${code}-add-${idx}`, zoomId = `cat-${code}-zoom-${idx}`;
              const already = hasOsmAlready(f.osm_id);
              return (
                <GeoJSON
                  key={`cat-${code}-${f.osm_id}-${idx}`}
                  data={gj}
                  style={{ color, weight: 2.5, fillOpacity: 0.10 }}
                  onEachFeature={(_feature, layer) => {
                    const html = `
                      <div style="max-width:260px">
                        <div style="display:flex;align-items:center;gap:8px">
                          <div style="width:10px;height:10px;border-radius:999px;background:${color}"></div>
                          <strong>${f.display_name ?? "Local"}</strong>
                        </div>
                        <div style="font-size:.85rem; color:#555; margin-top:4px">
                          ${f.class ?? ""}${f.type ? `:${f.type}` : ""} · ${CATEGORY_META[code]?.label || code}
                        </div>
                        <div style="display:flex; gap:6; margin-top:8">
                          <button id="${addId}" type="button" ${already?"disabled style='opacity:.6;cursor:not-allowed'":""}>${already?"Já adicionado" :"Adicionar"}</button>
                          <button id="${zoomId}" type="button">Zoom</button>
                        </div>
                      </div>`;
                    layer.bindPopup(html);
                    layer.on("popupopen", () => {
                      const addBtn = document.getElementById(addId);
                      const zoomBtn = document.getElementById(zoomId);
                      if (addBtn && !already) addBtn.onclick = () => addOSM(f);
                      if (zoomBtn) zoomBtn.onclick = () => fitToGeoJSON(gj);
                    });
                  }}
                  eventHandlers={{ click: () => fitToGeoJSON(gj) }}
                />
              );
            });
          })}

          {/* ITENS ADICIONADOS (verde) */}
          {items.map((it, i) => {
            if (it.kind === "manual" || !isPolygonGeom(it.geojson)) return null;
            return <GeoJSON key={`sel-${i}`} data={it.geojson} style={{ color: "#16a34a", weight: 3, fillOpacity: 0.18 }} />;
          })}

          {/* FeatureGroup que recebe os desenhos manuais; guardamos ref para gerir camadas */}
          <FeatureGroup ref={fgRef}>
            <EditControl
              position="topright"
              onCreated={onCreated}
              onEdited={onEdited}   // SINCRONIZA EDIÇÕES COM O ESTADO
              onDeleted={onDeleted} // SINCRONIZA REMOÇÕES COM O ESTADO
              draw={{
                polyline: false,
                rectangle: false,
                circle: false,
                circlemarker: false,
                marker: false,
                // Mantemos apenas polígono, com opções simples e consistentes
                polygon: { allowIntersection: true, showArea: true, drawError: false }
              }}
              // Mantemos a edição/remover padrão do plugin
            />
          </FeatureGroup>
        </MapContainer>
      </div>

      {/* LISTA + BOTÕES */}
      <div style={{marginTop:12}}>
        <SelectedList
          items={items}
          setItems={setItems}
          onRemove={(removed)=>{
            // Coerência: se o item removido na lista for manual, remover camada desenhada.
            if (removed?.kind === "manual" && removed.layerKey) {
              removeManualLayerByKey(removed.layerKey);
            }
            if (removed?.kind === "osm" && removed.osm_id != null) {
              const osmId = Number(removed.osm_id ?? NaN);
              setSelectedOSM(prev => {
                const next = new Set(prev);
                next.delete(osmId);
                return next;
              });
            }
          }}
        />
        <div style={{display:"flex", gap:8, marginTop:8, justifyContent:"flex-end", flexWrap:"wrap"}}>
          <button
            onClick={items.length === 0 ? onSkip : submit}
            disabled={items.length > 0 && submitting}
          >
            {items.length === 0
              ? "Continuar sem mapear →"
              : (submitting ? "A guardar..." : "Guardar e continuar →")}
          </button>
        </div>
      </div>
    </div>
  );
}

// =================== WIZARD ===================================================
function ThemeWizard({ participantId, onDone, testMode }) {

  // 🔹 NOVO useEffect — NÃO substitui nenhum
  useEffect(() => {
    const status = localStorage.getItem("profile_status");
    const pending = localStorage.getItem("pending_profile");

    if (status === "pending" && pending && participantId) {
      retryProfileSync();
    }
  }, [participantId]);

  const retryProfileSync = async () => {
    try {
      const raw = localStorage.getItem("pending_profile");
      if (!raw) return;

      const payload = JSON.parse(raw);

      await axios.post(`${API}/profile`, payload, {
        params: { participant_id: participantId },
        timeout: 15000
      });

      localStorage.removeItem("pending_profile");
      localStorage.setItem("profile_status", "confirmed");
    } catch {

    }
  };

  const pages = [
    {
      code: "identity",
      title: "➀ Para si, quais os lugares que mais expressam a identidade de Lisboa?",
      prompt: "Assinale áreas que, na sua perceção, representam melhor a identidade lisboeta."
    },
    {
      code: "cultural_change",
      title: "➁ Para si, quais os lugares que têm vindo a descaracterizar-se culturalmente?",
      prompt: "Pense em zonas onde, na sua perceção, houve perda de comércio local e/ou afetação do modo de vida tradicional."
    },
    {
      code: "cost_sense",
      title: "➂ Sensação de encarecimento",
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
      {/* Cabeçalho com logo */}
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:12}}>
        <div>
          <h1 style={{marginBottom:10, fontSize:"2.0rem", lineHeight:1}}>As Lisboas de Lisboa</h1>
          <div style={{marginTop:-8, fontSize:"0.8rem", marginBottom:13, color:"#666"}}>O que as diferentes perceções revelam sobre a cidade</div>
          <div style={{marginTop:10, marginBottom:16, color:"#666"}}><strong>Tese de Mestrado</strong></div>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:10}}>
            <img
              src="/logo_novaims.png"
              alt="NOVA IMS"
              style={{height:42, opacity:.92}}
              title="NOVA Information Management School"
            />
          </div>
        </div>

      {step===0 && <Consent onOk={()=>setStep(1)} setPid={setPid} testMode={testMode} />}
      {step===1 && pid && (
        <Profile
          participantId={pid}
          setPid={setPid}
          onOk={() => setStep(2)}
          testMode={testMode}
        />
      )}
      {step===2 && pid && <ThemeWizard participantId={pid} onDone={()=>setStep(3)} testMode={testMode} />}

      {step===3 && (
        <div>
          <h2>Obrigado pelo tempo investido!</h2>
          <p>As suas respostas foram guardadas.</p>
          {testMode && <p style={{color:"#7c2d12"}}>Nota: Modo Teste estava ativo — nada foi gravado.</p>}
        </div>
      )}

      <TestModeToggle testMode={testMode} setTestMode={setTestMode} />

      <footer style={{
        width:"100%",
        display:"flex",
        justifyContent:"flex-end", 
        padding:"10px 0",
        marginTop:"1px",
        opacity:0.9
      }}>
        <a href="https://www.netlify.com" target="_blank">
          <img 
            src="https://www.netlify.com/assets/badges/netlify-badge-color-bg.svg" 
            alt="Deploys by Netlify"
            style={{height:30}}
          />
        </a>
    </footer>
      
    </div>
  );
}
