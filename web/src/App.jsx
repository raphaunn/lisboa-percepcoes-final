import { useState } from "react";
import axios from "axios";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";

const API = "http://localhost:8000"; // sua API local

function Consent({ onOk, setPid }) {
  const [agree, setAgree] = useState(false);

  const create = async () => {
    const r = await axios.post(`${API}/consent`);
    setPid(r.data.participant_id);
    onOk();
  };

  return (
    <div>
      <h2>Consentimento</h2>
      <p>Este estudo é anónimo. Os dados serão usados apenas para fins académicos.</p>
      <label>
        <input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)} /> Concordo
      </label>
      <div><button disabled={!agree} onClick={create}>Continuar</button></div>
    </div>
  );
}

function Profile({ participantId, onOk }) {
  const [form, setForm] = useState({
    age_band:"25-34", gender:"m", ethnicity:"", nationality:"PT", education:"Licenciatura",
    income_band:"1000-1500", tenure:"tenant", rent_stress_pct:30,
    lives_in_lisbon:true, parish_home:"Arroios", years_in_lisbon_band:"3-5",
    works_in_lisbon:true, parish_work:"Avenidas Novas", studies_in_lisbon:false,
    pt_use:"often", main_mode:"pt",
    belonging_1_5:4, safety_day_1_5:4, safety_night_1_5:3
  });

  const save = async () => {
    await axios.post(`${API}/profile`, form, { params: { participant_id: participantId }});
    onOk();
  };

  return (
    <div>
      <h2>Perfil (resumo)</h2>
      <div>
        <label>Faixa etária:
          <select value={form.age_band} onChange={e=>setForm({...form, age_band:e.target.value})}>
            <option>18-24</option><option>25-34</option><option>35-44</option>
            <option>45-54</option><option>55-64</option><option>65+</option>
          </select>
        </label>
      </div>
      <div>
        <label>Género:
          <select value={form.gender} onChange={e=>setForm({...form, gender:e.target.value})}>
            <option value="f">Feminino</option>
            <option value="m">Masculino</option>
            <option value="o">Outro</option>
            <option value="na">Prefiro não dizer</option>
          </select>
        </label>
      </div>
      {/* acrescentar mais campos depois */}
      <div style={{marginTop:10}}>
        <label>Pertença (1-5):{" "}
          <input type="number" min="1" max="5" value={form.belonging_1_5}
            onChange={e=>setForm({...form, belonging_1_5:+e.target.value})}/>
        </label>
      </div>
      <button onClick={save} style={{marginTop:10}}>Continuar</button>
    </div>
  );
}

function ThemeGentrification({ participantId }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState([]); // {osm_id, display_name, importance_1_5, comment}

  const search = async () => {
    if (!q.trim()) return;
    const r = await axios.get(`${API}/geocode`, { params: { q }});
    setResults(r.data.results || []);
  };

  const addPick = (r) => {
    if (picked.find(p => p.osm_id === r.osm_id)) return; // sem duplicar
    setPicked([...picked, {
      osm_id: r.osm_id,
      display_name: r.display_name,
      importance_1_5: 3,
      comment: ''
    }]);
  };

  const submit = async () => {
    if (picked.length < 3 || picked.length > 5) {
      alert("Selecione entre 3 e 5 marcos para 'gentrificação'.");
      return;
    }
    const payload = {
      participant_id: participantId,
      selections: picked.map(p => ({
        theme_code: "gentrification",
        osm_id: p.osm_id,
        importance_1_5: p.importance_1_5,
        comment: p.comment
      }))
    };
    await axios.post(`${API}/submit`, payload);
    alert("Obrigado! Submissão concluída.");
  };

  return (
    <div>
      <h2>Tema: Gentrificação</h2>
      <p>Pesquise e adicione 3–5 marcos que, para si, expressam gentrificação.</p>

      <div style={{display:"flex", gap:"8px"}}>
        <input
          value={q}
          onChange={e=>setQ(e.target.value)}
          placeholder="ex: Alfama, Baixa-Chiado, Miradouro..."
          style={{flex:1}}
        />
        <button onClick={search}>Pesquisar</button>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"2fr 1fr", gap:"1rem", marginTop:"1rem"}}>
        <div>
          <MapContainer center={[38.72, -9.14]} zoom={12} style={{height: "420px"}}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap contributors"/>
            {results.map((r, i) => (
              r.geojson && r.geojson.type==="Point" ? (
                <Marker key={i} position={[r.geojson.coordinates[1], r.geojson.coordinates[0]]}>
                  <Popup>
                    <div style={{maxWidth:240}}>
                      <strong>{r.display_name}</strong><br/>
                      <button onClick={()=>addPick(r)}>Adicionar</button>
                    </div>
                  </Popup>
                </Marker>
              ) : null
            ))}
          </MapContainer>
        </div>

        <div>
          <h3>Selecionados ({picked.length})</h3>
          {picked.map((p, idx)=>(
            <div key={idx} style={{border:"1px solid #ddd", padding:"8px", marginBottom:"8px"}}>
              <div style={{fontSize:".9rem"}}>{p.display_name}</div>
              <label>Importância (1–5):{" "}
                <input type="number" min="1" max="5" value={p.importance_1_5}
                  onChange={e=>{
                    const v=[...picked]; v[idx].importance_1_5=+e.target.value; setPicked(v);
                  }}/>
              </label>
              <br/>
              <label>Comentário:
                <input value={p.comment} onChange={e=>{
                  const v=[...picked]; v[idx].comment=e.target.value; setPicked(v);
                }}/>
              </label>
              <div><button onClick={()=>{
                const v=[...picked]; v.splice(idx,1); setPicked(v);
              }}>Remover</button></div>
            </div>
          ))}
          <button onClick={submit}>Submeter</button>
        </div>
      </div>
    </div>
  );
}

export default function App(){
  const [step, setStep] = useState(0);
  const [pid, setPid] = useState(null);

  return (
    <div style={{maxWidth: 900, margin:"0 auto", padding: "1rem"}}>
      <h1>Percepções Urbanas – Lisboa</h1>
      {step===0 && <Consent onOk={()=>setStep(1)} setPid={setPid} />}
      {step===1 && pid && <Profile participantId={pid} onOk={()=>setStep(2)} />}
      {step===2 && pid && <ThemeGentrification participantId={pid} />}
    </div>
  );
}
