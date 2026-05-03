// Prototype 3 — Console multi-threads (agent state inspector)
// Layout: 3-column. Left = threads sidebar. Middle = prompt + reasoning trace.
// Right = tabbed output canvas (Tableau / Graphique / Sources / Agent state JSON).

const { useState, useEffect, useRef, useMemo } = React;

const REASONING_STEPS = [
  { t: 'Plan', d: "Décomposer la requête en 4 sous-tâches : périmètre comptable, écritures, conversations, agrégation.", ms: 240 },
  { t: 'Données', d: "Chargement de 8 fournisseurs (CA 2024–2025) depuis le module Achats. 142 conversations indexées sur la période.", ms: 680 },
  { t: 'Croisement', d: "Rapprochement écritures ↔ conversations sur 3 fournisseurs. 6 doublons potentiels détectés via clé (BL, montant, date).", ms: 1240 },
  { t: 'Synthèse', d: "Génération du rapport structuré : KPI strip, tableau détaillé, graphique CA 24→25, 3 évidences traçables.", ms: 420 },
];

const AGENT_STATE = {
  status: "completed",
  thread_id: "t-01",
  agent: "controls-generator-v2",
  iterations: 4,
  data_sources: [
    "ecritures_comptables_2025",
    "balance_auxiliaire_fournisseurs",
    "conversations_indexees",
    "referentiel_tiers"
  ],
  fournisseurs_analyses: 8,
  ca_total_2025: 5321800,
  cas_a_risque: 3,
  doublons_potentiels: 6,
  last_updated: "2026-04-12T14:34:22Z",
  evidence_refs: ["C-1", "C-2", "C-3"],
  high_risk_fournisseurs: [
    { id: "F-1042", nom: "Logistique Voltaire SAS", risk_score: 0.91, doublons: 3 },
    { id: "F-3317", nom: "Numéris Conseil",        risk_score: 0.62, justified_by: "C-1" },
    { id: "F-5103", nom: "Cabinet Arènes",          risk_score: 0.78, missing_evidence: true }
  ]
};

// ─────────────────────────────────────────────────────────────────
// LEFT — Threads sidebar
// ─────────────────────────────────────────────────────────────────
function ThreadsSidebar({ activeId, onSelect, onNew }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return THREADS;
    return THREADS.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
  }, [search]);
  const pinned = filtered.filter(t => t.pinned);
  const others = filtered.filter(t => !t.pinned);
  return (
    <aside style={{
      width: 280, minWidth: 280, height: '100%',
      borderRight: '1px solid var(--gray-2)', background: '#fafbfc',
      display: 'flex', flexDirection: 'column'
    }} data-screen-label="Threads">
      <div className="m-group" style={{
        padding: '12px 14px', gap: 8, borderBottom: '1px solid var(--gray-2)'
      }}>
        <div style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Conversations</div>
        <Tooltip label="Nouveau thread"><button className="m-btn icon outline" onClick={onNew}>{Icons.plus}</button></Tooltip>
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--gray-5)' }}>{Icons.search}</span>
          <input className="m-input" value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Rechercher…" style={{ paddingLeft: 32, height: 34, fontSize: 13 }} />
        </div>
      </div>
      <div className="m-scroll" style={{ flex: 1, padding: '0 8px 12px' }}>
        {pinned.length > 0 && (
          <>
            <div style={{ fontSize: 10.5, color: 'var(--gray-5)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 10px' }}>
              Épinglés
            </div>
            {pinned.map(t => <ThreadRow key={t.id} t={t} active={activeId === t.id} onClick={() => onSelect(t.id)} />)}
          </>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--gray-5)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '10px 10px 6px' }}>
          Récents
        </div>
        {others.map(t => <ThreadRow key={t.id} t={t} active={activeId === t.id} onClick={() => onSelect(t.id)} />)}
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--gray-2)', fontSize: 11, color: 'var(--gray-6)' }}>
        <div className="m-group" style={{ gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green-5)' }} />
          Agent en ligne · v2.4.1
        </div>
      </div>
    </aside>
  );
}

function ThreadRow({ t, active, onClick }) {
  return (
    <div onClick={onClick}
         style={{
           padding: '10px 10px',
           borderRadius: 6,
           cursor: 'pointer',
           background: active ? '#fff' : 'transparent',
           border: active ? '1px solid var(--gray-2)' : '1px solid transparent',
           boxShadow: active ? '0 1px 0 rgba(0,0,0,0.02)' : 'none',
           marginBottom: 2,
         }}>
      <div className="m-group" style={{ gap: 6, marginBottom: 4 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
          padding: '2px 6px', borderRadius: 3,
          background: t.tag === 'GEO' ? 'var(--teal-0)' : t.tag === 'AUDIT' ? 'var(--red-0)' : 'var(--pink-0)',
          color: t.tag === 'GEO' ? 'var(--teal-7)' : t.tag === 'AUDIT' ? 'var(--red-5)' : 'var(--pink-6)',
        }}>{t.tag}</span>
        {t.pinned && <span style={{ color: 'var(--gray-5)', display: 'inline-flex' }}><Icon size={12}>{Icons.pin.props.children}</Icon></span>}
      </div>
      <div style={{ fontSize: 13, color: 'var(--gray-9)', fontWeight: active ? 500 : 400, lineHeight: 1.4 }}>
        {t.title}
      </div>
      <div style={{ fontSize: 11, color: 'var(--gray-6)', marginTop: 2 }}>{t.updated}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MIDDLE — Prompt + reasoning
// ─────────────────────────────────────────────────────────────────
function ConversationColumn({ messages, reasoning, onSend, busy, onPickPrompt }) {
  const [text, setText] = useState('');
  const scrollRef = useRef(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, reasoning]);
  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <section style={{
      width: 460, minWidth: 460, height: '100%',
      borderRight: '1px solid var(--gray-2)', background: '#fff',
      display: 'flex', flexDirection: 'column'
    }} data-screen-label="Conversation">
      <div className="m-group" style={{
        padding: '12px 18px', gap: 8, borderBottom: '1px solid var(--gray-2)'
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Analyse écarts fournisseurs Q1</div>
          <div style={{ fontSize: 11, color: 'var(--gray-6)' }}>Thread #t-01 · contrôles-generator-v2</div>
        </div>
        <Tooltip label="Épingler"><button className="m-btn icon subtle">{Icons.pin}</button></Tooltip>
        <Tooltip label="Supprimer"><button className="m-btn icon subtle">{Icons.trash}</button></Tooltip>
      </div>

      <div ref={scrollRef} className="m-scroll" style={{ flex: 1, padding: 18 }}>
        {messages.length === 0 ? (
          <>
            <div style={{
              padding: 16, borderRadius: 10,
              background: 'linear-gradient(135deg, var(--teal-0), var(--pink-0))',
              border: '1px solid var(--gray-2)', marginBottom: 16,
            }}>
              <div className="m-group" style={{ gap: 8, marginBottom: 8 }}>
                <span style={{ color: 'var(--gray-9)', display: 'inline-flex' }}>{Icons.brain}</span>
                <strong style={{ fontSize: 14 }}>Console agent multi-produits</strong>
              </div>
              <p style={{ fontSize: 13, color: 'var(--gray-7)' }}>
                Une conversation, une session d'agent, un état inspectable. Posez une question — l'agent expose son raisonnement, ses données et ses sources en parallèle.
              </p>
            </div>
            <div style={{ fontSize: 11, color: 'var(--gray-6)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Démarrer
            </div>
            <div className="m-stack" style={{ gap: 6 }}>
              {SUGGESTED_PROMPTS.slice(0, 3).map((p, i) => (
                <button key={i} onClick={() => onPickPrompt(p)} className="m-btn outline"
                  style={{
                    height: 'auto', padding: '10px 12px', textAlign: 'left',
                    whiteSpace: 'normal', fontSize: 12.5, lineHeight: 1.5,
                    color: 'var(--gray-8)', fontWeight: 400, justifyContent: 'flex-start',
                  }}>{p}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            {messages.map((m, i) => (
              m.role === 'user' ? (
                <div key={i} style={{ marginBottom: 14, display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{
                    background: 'var(--gray-9)', color: '#fff',
                    padding: '9px 13px', borderRadius: 12, borderBottomRightRadius: 4,
                    maxWidth: '88%', fontSize: 13, lineHeight: 1.5
                  }}>{m.text}</div>
                </div>
              ) : (
                <div key={i} style={{ marginBottom: 14 }}>
                  <div className="m-group" style={{ gap: 6, marginBottom: 6, color: 'var(--gray-6)', fontSize: 12 }}>
                    <span style={{ color: 'var(--teal-6)', display: 'inline-flex' }}>{Icons.spark}</span>
                    Agent · {m.timestamp}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--gray-8)', lineHeight: 1.6 }}>{m.text}</div>
                </div>
              )
            ))}
            {reasoning.length > 0 && <ReasoningTrace steps={reasoning} busy={busy} />}
          </>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--gray-2)', padding: 14, background: 'var(--gray-0)' }}>
        <div style={{ position: 'relative' }}>
          <textarea className="m-textarea" value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                    placeholder="Demandez quelque chose à l'agent…"
                    rows={2} style={{ paddingRight: 50 }} />
          <button className="m-btn primary icon" onClick={submit} disabled={!text.trim() || busy}
                  style={{ position: 'absolute', right: 8, bottom: 8 }} aria-label="Envoyer">{Icons.send}</button>
        </div>
        <div className="m-group" style={{ gap: 8, marginTop: 8, fontSize: 11, color: 'var(--gray-6)' }}>
          <span className="m-badge teal" style={{ height: 18, fontSize: 9 }}>Geoficiency</span>
          <span className="m-badge pink" style={{ height: 18, fontSize: 9 }}>Closing</span>
          <div style={{ flex: 1 }} />
          <span>4 sources · contexte 12,4k tokens</span>
        </div>
      </div>
    </section>
  );
}

function ReasoningTrace({ steps, busy }) {
  const safeSteps = (steps || []).filter(Boolean);
  return (
    <div style={{
      borderLeft: '2px solid var(--gray-2)', paddingLeft: 14, margin: '12px 0 18px'
    }}>
      <div className="m-group" style={{ gap: 6, marginBottom: 10, color: 'var(--gray-6)', fontSize: 12 }}>
        {Icons.brain}<strong>Raisonnement de l'agent</strong>
        <span className="m-badge">{safeSteps.length}/4 étapes</span>
      </div>
      <div className="m-stack" style={{ gap: 10 }}>
        {safeSteps.map((s, i) => (
          <div key={i}>
            <div className="m-group" style={{ gap: 8, fontSize: 12 }}>
              <span style={{
                width: 18, height: 18, borderRadius: 4,
                background: 'var(--teal-0)', color: 'var(--teal-7)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
              }}>{i+1}</span>
              <strong style={{ fontSize: 12, color: 'var(--gray-9)' }}>{s.t}</strong>
              <span style={{ color: 'var(--gray-5)', fontSize: 11 }}>{s.ms} ms</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--gray-7)', marginTop: 4, marginLeft: 26, lineHeight: 1.5 }}>{s.d}</div>
          </div>
        ))}
        {busy && (
          <div className="m-group" style={{ gap: 8, fontSize: 12, color: 'var(--gray-6)' }}>
            <span style={{
              width: 18, height: 18, borderRadius: 4,
              background: 'var(--gray-1)', color: 'var(--gray-6)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>…</span>
            <em>en cours…</em>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// RIGHT — Output canvas (tabbed)
// ─────────────────────────────────────────────────────────────────
function OutputCanvas({ state, query }) {
  const [tab, setTab] = useState('table');
  if (state === 'empty') {
    return (
      <div className="m-stack" style={{
        flex: 1, alignItems: 'center', justifyContent: 'center',
        padding: 40, textAlign: 'center', color: 'var(--gray-6)', background: 'var(--gray-0)'
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: '#fff', border: '1px solid var(--gray-2)',
          color: 'var(--gray-5)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16
        }}><Icon size={28}>{Icons.brain.props.children}</Icon></div>
        <h2 style={{ color: 'var(--gray-8)', marginBottom: 6 }}>Aucune sortie</h2>
        <p style={{ maxWidth: 320, fontSize: 13.5 }}>Le canvas affichera tableaux, graphiques, sources et l'état de l'agent dès qu'une requête est envoyée.</p>
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div style={{ flex: 1, padding: 24, background: 'var(--gray-0)' }}>
        <Skeleton width={200} height={20} style={{ marginBottom: 16 }} />
        <Skeleton height={36} style={{ marginBottom: 20 }} />
        <Skeleton height={300} radius={8} />
      </div>
    );
  }
  return (
    <div className="m-stack" style={{ flex: 1, background: 'var(--gray-0)', minWidth: 0 }}>
      <div className="m-group" style={{
        padding: '14px 24px', gap: 12, borderBottom: '1px solid var(--gray-2)', background: '#fff'
      }}>
        <div className="m-stack" style={{ gap: 2, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--gray-6)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Sortie · {AGENT_STATE.iterations} itérations · {AGENT_STATE.fournisseurs_analyses} entités
          </div>
          <h1 style={{ fontSize: 17 }}>Analyse écarts fournisseurs</h1>
        </div>
        <span className="m-badge green">{Icons.check} Terminé</span>
        <button className="m-btn outline" style={{ height: 32 }}>{Icons.download} Exporter</button>
      </div>

      <div style={{ padding: '0 24px', background: '#fff', borderBottom: '1px solid var(--gray-2)' }}>
        <div className="m-tabs">
          {[
            { k: 'table', l: 'Tableau', i: Icons.table },
            { k: 'chart', l: 'Graphique', i: Icons.chart },
            { k: 'sources', l: 'Sources', i: Icons.doc },
            { k: 'state', l: 'État agent', i: Icons.brain },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`m-tab ${tab === t.k ? 'active' : ''}`}>
              <span className="m-group" style={{ gap: 6 }}>{t.i}{t.l}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="m-scroll" style={{ flex: 1, padding: 24 }}>
        {tab === 'table' && <TableTab />}
        {tab === 'chart' && <ChartTab />}
        {tab === 'sources' && <SourcesTab />}
        {tab === 'state' && <StateTab />}
      </div>
    </div>
  );
}

function TableTab() {
  return (
    <>
      <div className="m-group" style={{ gap: 12, marginBottom: 16 }}>
        {KPIS.map((k, i) => (
          <div key={i} className="m-card" style={{ flex: 1, padding: '12px 14px' }}>
            <div style={{ fontSize: 10.5, color: 'var(--gray-6)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
              {k.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{k.value}</div>
            {k.delta && <span className={`m-badge ${k.deltaTone || 'gray'}`} style={{ marginTop: 4 }}>{k.delta}</span>}
          </div>
        ))}
      </div>
      <div className="m-card flush">
        <div className="m-group" style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-2)' }}>
          <h3>Fournisseurs</h3>
          <div style={{ flex: 1 }} />
          <button className="m-btn outline" style={{ height: 28, fontSize: 12 }}>{Icons.filter} Filtrer</button>
        </div>
        <table className="m-table">
          <thead>
            <tr>
              <th>Fournisseur</th><th>Catégorie</th>
              <th className="num">CA 2025</th><th className="num">Variation</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {FOURNISSEURS.map(f => (
              <tr key={f.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{f.nom}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-6)' }}>{f.id}</div>
                </td>
                <td style={{ color: 'var(--gray-7)' }}>{f.categorie}</td>
                <td className="num" style={{ fontWeight: 500 }}>{fmtCA(f.ca2025)}</td>
                <td className="num" style={{ color: f.variation > 25 ? 'var(--red-5)' : f.variation < -50 ? 'var(--yellow-5)' : 'var(--gray-7)' }}>
                  {f.variation > 0 ? '+' : ''}{f.variation.toFixed(1)} %
                </td>
                <td>
                  <span className={`m-badge ${f.risque === 'high' ? 'red' : f.risque === 'medium' ? 'yellow' : 'green'}`}>
                    {f.risque === 'high' ? 'Risque' : f.risque === 'medium' ? 'À vérifier' : 'OK'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ChartTab() {
  const max = Math.max(...FOURNISSEURS.map(f => f.ca2025));
  return (
    <div className="m-card">
      <div className="m-group" style={{ marginBottom: 16 }}>
        <h3>Distribution des écarts CA 2024 → 2025</h3>
        <div style={{ flex: 1 }} />
        <span className="m-badge">8 fournisseurs</span>
      </div>
      <svg viewBox="0 0 500 240" style={{ width: '100%', height: 280 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <line key={i} x1="40" x2="490" y1={40 + i * 40} y2={40 + i * 40} stroke="var(--gray-2)" strokeWidth="1" strokeDasharray="2 3" />
        ))}
        <line x1="40" y1="120" x2="490" y2="120" stroke="var(--gray-4)" strokeWidth="1" />
        {FOURNISSEURS.map((f, i) => {
          const x = 60 + i * 55;
          const h = Math.min(80, Math.abs(f.variation) * 1.1);
          const y = f.variation > 0 ? 120 - h : 120;
          const color = f.variation > 25 ? 'var(--red-5)' : f.variation < -50 ? 'var(--yellow-5)' : 'var(--teal-5)';
          return (
            <g key={f.id}>
              <rect x={x - 16} y={y} width="32" height={h} fill={color} rx="2" />
              <text x={x} y={235} textAnchor="middle" fontSize="9" fill="var(--gray-6)">{f.id}</text>
              <text x={x} y={y - 4} textAnchor="middle" fontSize="10" fill={color} fontWeight="600">
                {f.variation > 0 ? '+' : ''}{f.variation.toFixed(0)}%
              </text>
            </g>
          );
        })}
        <text x="20" y="44" fontSize="10" fill="var(--gray-6)">+80%</text>
        <text x="20" y="124" fontSize="10" fill="var(--gray-6)">0</text>
        <text x="20" y="204" fontSize="10" fill="var(--gray-6)">-80%</text>
      </svg>
    </div>
  );
}

function SourcesTab() {
  return (
    <div className="m-stack" style={{ gap: 12 }}>
      {CONVERSATION_SNIPPETS.map(s => (
        <div key={s.id} className="m-card">
          <div className="m-group" style={{ gap: 8, marginBottom: 10 }}>
            <span className="m-badge teal">{s.id}</span>
            <strong style={{ fontSize: 13 }}>{s.speaker}</strong>
            <span style={{ fontSize: 11, color: 'var(--gray-6)' }}>· {s.timestamp}</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--gray-6)' }}>{s.source}</span>
          </div>
          <div className="evidence">« {s.quote} »</div>
        </div>
      ))}
    </div>
  );
}

function StateTab() {
  // Render JSON with syntax highlighting (CopilotKit-style state inspector)
  const json = JSON.stringify(AGENT_STATE, null, 2);
  const colored = json
    .replace(/("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (m) => {
        let cls = 'var(--blue-5)';
        if (/^"/.test(m)) cls = /:$/.test(m) ? 'var(--pink-6)' : 'var(--green-5)';
        else if (/true|false/.test(m)) cls = 'var(--yellow-5)';
        else if (/null/.test(m)) cls = 'var(--gray-5)';
        return `<span style="color:${cls}">${m}</span>`;
      });
  return (
    <div className="m-card flush">
      <div className="m-group" style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-2)' }}>
        <h3>État de l'agent</h3>
        <span className="m-badge green" style={{ marginLeft: 6 }}>● live</span>
        <div style={{ flex: 1 }} />
        <button className="m-btn outline" style={{ height: 28, fontSize: 12 }}>{Icons.copy} Copier</button>
      </div>
      <pre style={{
        margin: 0, padding: 18,
        fontFamily: 'var(--mantine-font-family-monospace)',
        fontSize: 12.5, lineHeight: 1.6, color: 'var(--gray-8)',
        background: '#fcfcfd', overflow: 'auto'
      }} dangerouslySetInnerHTML={{ __html: colored }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
function App() {
  const [activeThread, setActiveThread] = useState('t-01');
  const [messages, setMessages] = useState([]);
  const [reasoning, setReasoning] = useState([]);
  const [outState, setOutState] = useState('empty');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const runIdRef = useRef(0);
  const timerRef = useRef(null);

  const cancelRun = () => {
    runIdRef.current += 1;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const runQuery = (q) => {
    cancelRun();
    const myRun = runIdRef.current;
    setQuery(q);
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setReasoning([]);
    setBusy(true);
    setOutState('loading');

    let i = 0;
    const next = () => {
      if (myRun !== runIdRef.current) return; // superseded
      if (i >= REASONING_STEPS.length || !REASONING_STEPS[i]) {
        setOutState('loaded');
        setBusy(false);
        setMessages(prev => [...prev, {
          role: 'agent',
          text: "Analyse complète. Le canvas de droite expose le tableau, le graphique, les évidences et l'état JSON de l'agent. 3 cas à risque, 6 doublons.",
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        }]);
        return;
      }
      setReasoning(prev => [...prev, REASONING_STEPS[i]]);
      i++;
      timerRef.current = setTimeout(next, 600);
    };
    timerRef.current = setTimeout(next, 400);
  };

  const onNew = () => {
    cancelRun();
    setMessages([]); setReasoning([]); setOutState('empty'); setQuery(''); setBusy(false);
  };

  return (
    <div className="m-stack" style={{ height: '100vh', overflow: 'hidden' }}>
      <ShellHeader product="geo" crumbs={['Console agent', 'Threads', 'Analyse écarts fournisseurs']} />
      <div className="m-group" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        <ThreadsSidebar activeId={activeThread} onSelect={setActiveThread} onNew={onNew} />
        <ConversationColumn messages={messages} reasoning={reasoning} onSend={runQuery} busy={busy} onPickPrompt={runQuery} />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }} data-screen-label="Output">
          <OutputCanvas state={outState} query={query} />
        </main>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
