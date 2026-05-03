// Prototype 2 — Explorateur Géo (Geoficiency)
// Layout: 2-column split. Left = compact prompt + history.
// Right = map + KPI strip + ranked list. Click a territory to drill in.

const { useState, useEffect, useRef, useMemo } = React;

const GEO_PROMPTS = [
  "Quels fournisseurs en Île-de-France présentent des écarts >25 % vs. 2024 ?",
  "Cartographier les doublons potentiels par région.",
  "Quelles régions concentrent le plus de fournisseurs inactifs ?",
  "Comparer le CA fournisseur transport entre PACA et Occitanie.",
];

function PromptRail({ messages, onSend, busy, onPickPrompt, onVisualize, activeMessageId, onShare }) {
  const [text, setText] = useState('');
  const scrollRef = useRef(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);
  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <aside className="m-stack" style={{
      borderRight: '1px solid var(--gray-2)',
      background: '#fff', width: 420, minWidth: 420, height: '100%'
    }} data-screen-label="Prompt rail">
      <div className="m-group" style={{
        padding: '14px 20px', gap: 10, borderBottom: '1px solid var(--gray-2)',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'var(--teal-0)', color: 'var(--teal-6)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
        }}>{Icons.spark}</div>
        <div className="m-stack" style={{ gap: 0, flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Explorateur Géo</div>
          <div style={{ fontSize: 12, color: 'var(--gray-6)' }}>Agent géo-comptable · territoire FR</div>
        </div>
        <Tooltip label="Partager la conversation"><button className="m-btn icon subtle" onClick={() => onShare && onShare()}>{Icons.share || Icons.copy}</button></Tooltip>
        <Tooltip label="Nouvelle requête"><button className="m-btn icon subtle">{Icons.plus}</button></Tooltip>
      </div>

      <div ref={scrollRef} className="m-scroll" style={{ flex: 1, padding: 18 }}>
        {messages.length === 0 ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--gray-7)', marginBottom: 16, lineHeight: 1.55 }}>
              Posez une question géo-anchored. L'agent croise vos écritures, conversations achats et données territoriales pour faire ressortir les zones à risque.
            </p>
            <div style={{ fontSize: 11, color: 'var(--gray-6)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Suggestions
            </div>
            <div className="m-stack" style={{ gap: 8 }}>
              {GEO_PROMPTS.map((p, i) => (
                <button key={i} onClick={() => onPickPrompt(p)}
                  className="m-btn outline"
                  style={{
                    height: 'auto', padding: '11px 13px', textAlign: 'left',
                    whiteSpace: 'normal', fontSize: 13, lineHeight: 1.5,
                    color: 'var(--gray-8)', fontWeight: 400, justifyContent: 'flex-start',
                  }}
                >{p}</button>
              ))}
            </div>
          </>
        ) : (
          messages.map((m, i) => (
            m.role === 'user' ? (
              <div key={i} style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  background: 'var(--teal-5)', color: '#fff',
                  padding: '9px 12px', borderRadius: 12, borderBottomRightRadius: 4,
                  maxWidth: '90%', fontSize: 13, lineHeight: 1.5
                }}>{m.text}</div>
              </div>
            ) : (
              <div key={i} style={{ marginBottom: 12 }}>
                <div className="m-group" style={{ gap: 8, marginBottom: 6, color: 'var(--gray-6)', fontSize: 12 }}>
                  <span style={{ color: 'var(--teal-6)', display: 'inline-flex' }}>{Icons.spark}</span>
                  Agent · {m.timestamp}
                  {m.id && m.id === activeMessageId && (
                    <span className="m-badge teal" style={{ marginLeft: 'auto' }}>{Icons.check}<span>Affiché</span></span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--gray-8)', lineHeight: 1.55 }}>{m.text}</div>
                {m.cta === 'visualize' && m.id !== activeMessageId && (
                  <Tooltip label="Recharger ce résultat dans le panneau de droite">
                    <button
                      className="m-btn outline"
                      onClick={() => onVisualize && onVisualize(m)}
                      style={{ marginTop: 8, gap: 6, height: 26, fontSize: 12, whiteSpace: 'nowrap' }}
                    >
                      {Icons.refresh}
                      <span>Recharger ce résultat</span>
                    </button>
                  </Tooltip>
                )}
              </div>
            )
          ))
        )}
        {busy && (
          <div className="m-group" style={{ gap: 8, color: 'var(--gray-6)', fontSize: 12, marginTop: 6 }}>
            <span style={{ color: 'var(--teal-6)', display: 'inline-flex' }}>{Icons.spark}</span>
            <span>Analyse spatiale en cours…</span>
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--gray-2)', padding: 14, background: 'var(--gray-0)' }}>
        <div style={{ position: 'relative' }}>
          <textarea
            className="m-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Posez une question géo-comptable…"
            rows={2}
            style={{ paddingRight: 50 }}
          />
          <button className="m-btn primary icon" onClick={submit} disabled={!text.trim() || busy}
                  style={{ position: 'absolute', right: 8, bottom: 8 }} aria-label="Envoyer">{Icons.send}</button>
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────
// MAP — stylised hex map of France
// ─────────────────────────────────────────────────────────────────
function FranceMap({ selected, onSelect, loading }) {
  return (
    <div className="m-card" style={{ position: 'relative', minHeight: 380, padding: 0, overflow: 'hidden' }}>
      <div className="m-group" style={{
        position: 'absolute', top: 14, left: 14, right: 14, zIndex: 5, gap: 8
      }}>
        <h3 style={{ background: '#fff', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--gray-2)' }}>
          Cartographie risque · Q1 2026
        </h3>
        <div style={{ flex: 1 }} />
        <div className="m-group" style={{ gap: 6, background: '#fff', padding: '4px 6px', borderRadius: 6, border: '1px solid var(--gray-2)' }}>
          <span style={{ fontSize: 11, color: 'var(--gray-6)' }}>Couche :</span>
          <button className="m-btn primary" style={{ height: 24, fontSize: 12, padding: '0 8px' }}>Risque</button>
          <button className="m-btn subtle" style={{ height: 24, fontSize: 12, padding: '0 8px' }}>CA</button>
          <button className="m-btn subtle" style={{ height: 24, fontSize: 12, padding: '0 8px' }}>Doublons</button>
        </div>
      </div>
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: 460, display: 'block', background: 'linear-gradient(180deg, #f5fcfb, #fff)' }}>
        {/* France outline approximation */}
        <path d="M 30 8 L 50 4 L 65 8 L 78 16 L 82 30 L 80 48 L 76 62 L 72 75 L 60 85 L 50 88 L 36 86 L 22 78 L 14 64 L 12 48 L 14 32 L 20 18 Z"
              fill="var(--teal-0)" stroke="var(--teal-3)" strokeWidth="0.4" />
        {/* Inner hex grid */}
        {[...Array(8)].map((_, r) => [...Array(7)].map((_, c) => {
          const x = 18 + c * 9 + (r % 2 ? 4.5 : 0);
          const y = 12 + r * 9;
          if (x < 14 || x > 80 || y < 8 || y > 84) return null;
          return <circle key={`${r}-${c}`} cx={x} cy={y} r={1.2} fill="var(--teal-2)" opacity="0.35" />;
        }))}
        {/* Territory pins */}
        {TERRITORIES.map(t => {
          const isSelected = selected === t.id;
          const r = isSelected ? 4.5 : 3.4;
          const fill = t.alerts >= 2 ? 'var(--red-5)' : t.alerts === 1 ? 'var(--yellow-5)' : 'var(--teal-5)';
          return (
            <g key={t.id} onClick={() => onSelect(t.id)} style={{ cursor: 'pointer' }}>
              {isSelected && <circle cx={t.x} cy={t.y} r={r + 3} fill={fill} opacity={0.18} />}
              <circle cx={t.x} cy={t.y} r={r} fill={fill} stroke="#fff" strokeWidth="0.6" />
              {t.alerts > 0 && (
                <text x={t.x} y={t.y + 1.3} textAnchor="middle" fontSize="3" fill="#fff" fontWeight="700">{t.alerts}</text>
              )}
              {isSelected && (
                <text x={t.x} y={t.y - 5.5} textAnchor="middle" fontSize="3" fontWeight="600" fill="var(--gray-9)">
                  {t.nom}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12
        }}>
          <div className="agent-shimmer" style={{ width: 200, height: 8, borderRadius: 4 }} />
          <div style={{ fontSize: 13, color: 'var(--gray-7)' }}>Calcul des couches…</div>
        </div>
      )}
      {/* Legend */}
      <div className="m-group" style={{
        position: 'absolute', bottom: 14, left: 14,
        background: '#fff', padding: '6px 10px', borderRadius: 6,
        border: '1px solid var(--gray-2)', gap: 12, fontSize: 11, color: 'var(--gray-7)'
      }}>
        <span className="m-group" style={{ gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red-5)' }} /> Risque élevé</span>
        <span className="m-group" style={{ gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--yellow-5)' }} /> À vérifier</span>
        <span className="m-group" style={{ gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--teal-5)' }} /> Conforme</span>
      </div>
    </div>
  );
}

function GeoKpis({ scope }) {
  const data = useMemo(() => {
    if (!scope || scope === 'all') {
      return [
        { l: 'Régions actives', v: '7', s: 'sur 13 métropolitaines' },
        { l: 'CA cumulé 2025', v: '5,32 M€', s: '+18,4 % vs. 2024', tone: 'yellow' },
        { l: 'Alertes territoriales', v: '5', s: 'dont 2 critiques', tone: 'red' },
        { l: 'Conversations indexées', v: '142', s: 'sur 30 derniers jours' },
      ];
    }
    const t = TERRITORIES.find(x => x.id === scope);
    return [
      { l: 'Région', v: t.nom, s: '' },
      { l: 'CA 2025', v: fmtCA(t.ca), s: '' },
      { l: 'Fournisseurs', v: t.fournisseurs, s: 'actifs' },
      { l: 'Alertes', v: t.alerts, s: t.alerts >= 2 ? 'critiques' : t.alerts === 1 ? 'à vérifier' : 'aucune', tone: t.alerts >= 2 ? 'red' : t.alerts === 1 ? 'yellow' : 'green' },
    ];
  }, [scope]);
  return (
    <div className="m-group" style={{ gap: 12 }}>
      {data.map((k, i) => (
        <div key={i} className="m-card" style={{ flex: 1, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--gray-6)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{k.l}</div>
          <div className="m-group" style={{ gap: 8 }}>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{k.v}</div>
            {k.tone && <span className={`m-badge ${k.tone}`}>•</span>}
          </div>
          {k.s && <div style={{ fontSize: 12, color: 'var(--gray-6)', marginTop: 4 }}>{k.s}</div>}
        </div>
      ))}
    </div>
  );
}

function RankedList({ scope }) {
  const rows = useMemo(() => {
    const all = FOURNISSEURS;
    const t = scope && scope !== 'all' ? TERRITORIES.find(x => x.id === scope) : null;
    const filtered = t ? all.filter(f => f.region === t.nom) : all;
    return [...filtered].sort((a, b) => Math.abs(b.variation) - Math.abs(a.variation));
  }, [scope]);
  return (
    <div className="m-card flush">
      <div className="m-group" style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-2)', gap: 8 }}>
        <h3>Fournisseurs · classés par écart</h3>
        <span className="m-badge teal">{rows.length}</span>
        <div style={{ flex: 1 }} />
        <button className="m-btn outline" style={{ height: 30, fontSize: 13 }}>{Icons.filter} Filtres</button>
        <button className="m-btn outline" style={{ height: 30, fontSize: 13 }}>{Icons.download}</button>
      </div>
      <table className="m-table">
        <thead>
          <tr>
            <th>Fournisseur</th>
            <th>Région</th>
            <th className="num">CA 2025</th>
            <th className="num">Variation</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan="5" style={{ textAlign: 'center', padding: 32, color: 'var(--gray-6)' }}>
              Aucun fournisseur dans ce périmètre.
            </td></tr>
          ) : rows.slice(0, 6).map(f => (
            <tr key={f.id}>
              <td>
                <div style={{ fontWeight: 500 }}>{f.nom}</div>
                <div style={{ fontSize: 11, color: 'var(--gray-6)' }}>{f.categorie}</div>
              </td>
              <td style={{ color: 'var(--gray-7)' }}>{f.region}</td>
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
  );
}

function ConversationFeed({ scope }) {
  return (
    <div className="m-card">
      <div className="m-group" style={{ marginBottom: 12 }}>
        <h3>Évidences conversationnelles</h3>
        <span className="m-badge teal" style={{ marginLeft: 8 }}>{CONVERSATION_SNIPPETS.length}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--gray-6)' }}>traçabilité agent</span>
      </div>
      <div className="m-stack" style={{ gap: 10 }}>
        {CONVERSATION_SNIPPETS.map(s => (
          <div key={s.id} style={{ padding: 12, border: '1px solid var(--gray-2)', borderRadius: 8 }}>
            <div className="m-group" style={{ gap: 8, marginBottom: 8 }}>
              <span className="m-badge teal">{s.id}</span>
              <strong style={{ fontSize: 13 }}>{s.speaker}</strong>
              <span style={{ fontSize: 11, color: 'var(--gray-6)' }}>· {s.timestamp}</span>
            </div>
            <div className="evidence" style={{ fontSize: 12.5 }}>« {s.quote} »</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GeoOutput({ state, scope, query, onSelectScope, loadingMap }) {
  if (state === 'empty') {
    return (
      <div className="m-stack m-scroll" style={{ flex: 1, padding: 32, gap: 20 }}>
        <GeoKpis scope="all" />
        <FranceMap selected={null} onSelect={() => {}} loading={false} />
        <div className="m-card" style={{ textAlign: 'center', padding: 40, color: 'var(--gray-6)' }}>
          <h3 style={{ color: 'var(--gray-8)', marginBottom: 6 }}>Posez une question pour démarrer</h3>
          <p style={{ fontSize: 13 }}>Le territoire affichera les couches d'analyse, le classement et les évidences associées.</p>
        </div>
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div className="m-stack m-scroll" style={{ flex: 1, padding: 32, gap: 20 }}>
        <div className="m-group" style={{ gap: 12 }}>
          {[0,1,2,3].map(i => (
            <div key={i} className="m-card" style={{ flex: 1 }}>
              <Skeleton width={80} height={11} style={{ marginBottom: 10 }} />
              <Skeleton width={120} height={22} />
            </div>
          ))}
        </div>
        <Skeleton height={420} radius={8} />
        <div className="m-group" style={{ gap: 16 }}>
          <Skeleton height={220} radius={8} style={{ flex: 1.4 }} />
          <Skeleton height={220} radius={8} style={{ flex: 1 }} />
        </div>
      </div>
    );
  }
  return (
    <div className="m-stack m-scroll" style={{ flex: 1 }}>
      <div className="m-group" style={{
        padding: '14px 24px', gap: 12, borderBottom: '1px solid var(--gray-2)', background: '#fff'
      }}>
        <div className="m-stack" style={{ gap: 2, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--teal-7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Analyse géo · Q1 2026
          </div>
          <h1 style={{ fontSize: 17 }}>{scope && scope !== 'all' ? TERRITORIES.find(t=>t.id===scope).nom : 'Toutes régions'}</h1>
          <div style={{ fontSize: 12, color: 'var(--gray-6)' }}>
            <em>{query}</em>
          </div>
        </div>
        {scope && scope !== 'all' && (
          <button className="m-btn outline" onClick={() => onSelectScope('all')} style={{ height: 30 }}>
            {Icons.close} Effacer le filtre
          </button>
        )}
        <button className="m-btn outline" style={{ height: 30 }}>{Icons.download} Exporter</button>
      </div>

      <div className="m-stack" style={{ padding: 24, gap: 20, background: 'var(--gray-0)' }}>
        <GeoKpis scope={scope} />
        <FranceMap selected={scope} onSelect={onSelectScope} loading={loadingMap} />
        <div className="m-group" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1.5 }}><RankedList scope={scope} /></div>
          <div style={{ flex: 1 }}><ConversationFeed scope={scope} /></div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [messages, setMessages] = useState([]);
  const [outState, setOutState] = useState('empty');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [busy, setBusy] = useState(false);
  const [loadingMap, setLoadingMap] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState(null);
  const [toast, setToast] = useState(null);

  const msgIdRef = useRef(0);

  const runQuery = (q) => {
    const id = ++msgIdRef.current;
    setQuery(q);
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setBusy(true);
    setActiveMessageId(id);
    const targetScope = (q.toLowerCase().includes('île-de-france') || q.toLowerCase().includes('idf')) ? 'idf' : 'all';
    setScope(targetScope);
    setOutState('loading');
    setTimeout(() => {
      setBusy(false);
      setOutState('loaded');
      setMessages(prev => [...prev, {
        id,
        role: 'agent',
        cta: 'visualize',
        query: q,
        scope: targetScope,
        text: "Carte filtrée à droite. 5 alertes territoriales détectées, dont 2 critiques en Île-de-France. Cliquez une région pour drill-down.",
        timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      }]);
    }, 1100);
  };

  const onVisualize = (m) => {
    if (m.id === activeMessageId) return;
    setQuery(m.query);
    setActiveMessageId(m.id);
    setOutState('loading');
    setLoadingMap(true);
    setTimeout(() => {
      setScope(m.scope || 'all');
      setOutState('loaded');
      setLoadingMap(false);
    }, 500);
  };

  const onShare = () => {
    const url = `${location.origin}${location.pathname}#share=${msgIdRef.current}-${Date.now().toString(36)}`;
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    setToast('Lien de conversation copié dans le presse-papiers');
    setTimeout(() => setToast(null), 2400);
  };

  const onSelectScope = (id) => {
    if (id === scope) return;
    setLoadingMap(true);
    setTimeout(() => {
      setScope(id);
      setLoadingMap(false);
    }, 350);
  };

  return (
    <div className="m-stack" style={{ height: '100vh', overflow: 'hidden' }}>
      <ShellHeader product="geo" crumbs={['Liste des groupes', '00 LAST GROUP', 'Explorateur Géo']} />
      <div className="m-group" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        <PromptRail messages={messages} onSend={runQuery} busy={busy} onPickPrompt={runQuery}
                    onVisualize={onVisualize} activeMessageId={activeMessageId} onShare={onShare} />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--gray-0)' }}
              data-screen-label="Geo output">
          <GeoOutput state={outState} scope={scope} query={query} onSelectScope={onSelectScope} loadingMap={loadingMap} />
        </main>
      </div>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--gray-9)', color: '#fff', padding: '10px 16px',
          borderRadius: 8, fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          zIndex: 1000, display: 'flex', alignItems: 'center', gap: 8
        }}>
          {Icons.check}<span>{toast}</span>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
