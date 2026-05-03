// Prototype 1 — Atelier de contrôles (Closing)
// Layout: 2-column split. Left = prompt + suggested questions + thread.
// Right = streamed agent output (synthesis text → table → chart → evidence).

const { useState, useEffect, useRef, useMemo } = React;

const PINK_PROMPTS = window.SUGGESTED_PROMPTS;

// ─────────────────────────────────────────────────────────────────
// LEFT — Conversation panel
// ─────────────────────────────────────────────────────────────────
function ConversationPanel({ messages, onSend, busy, onPickPrompt, onVisualize, activeMessageId, onShare }) {
  const [text, setText] = useState('');
  const taRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <aside className="m-stack" style={{
      borderRight: '1px solid var(--gray-2)',
      background: '#fff',
      width: 480, minWidth: 480, height: '100%'
    }} data-screen-label="Conversation">
      {/* Header */}
      <div className="m-group" style={{
        padding: '14px 20px', gap: 10,
        borderBottom: '1px solid var(--gray-2)',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'var(--pink-0)', color: 'var(--pink-6)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
        }}>{Icons.spark}</div>
        <div className="m-stack" style={{ gap: 0, flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Assistant Closing</div>
          <div style={{ fontSize: 12, color: 'var(--gray-6)' }}>Génération de contrôles · session #4271</div>
        </div>
        <Tooltip label="Partager la conversation"><button className="m-btn icon subtle" onClick={() => onShare && onShare()}>{Icons.share || Icons.copy}</button></Tooltip>
        <Tooltip label="Nouvelle session"><button className="m-btn icon subtle">{Icons.plus}</button></Tooltip>
        <Tooltip label="Réduire"><button className="m-btn icon subtle">{Icons.expand}</button></Tooltip>
      </div>

      {/* Intro card (matches your "Bonnes pratiques" panel) */}
      <div ref={scrollRef} className="m-scroll" style={{ flex: 1, padding: 20 }}>
        {messages.length === 0 && (
          <>
            <div style={{
              background: 'var(--pink-0)',
              borderRadius: 10,
              padding: 16,
              border: '1px solid var(--pink-1)',
              marginBottom: 20,
            }}>
              <div className="m-group" style={{ gap: 8, marginBottom: 8, color: 'var(--pink-6)' }}>
                {Icons.bulb}
                <strong style={{ fontSize: 14 }}>Atelier IA de génération de contrôles</strong>
              </div>
              <p style={{ fontSize: 13, color: 'var(--gray-8)', marginBottom: 10 }}>
                Décrivez en langage naturel un contrôle à exécuter sur vos données comptables. L'agent croise vos écritures, conversations et conventions internes pour produire un rapport structuré.
              </p>
              <div style={{ fontSize: 13, color: 'var(--gray-7)', fontWeight: 600, marginBottom: 4 }}>Bonnes pratiques :</div>
              <ul style={{ fontSize: 13, color: 'var(--gray-7)', margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                <li>Soyez précis : périmètre comptable, seuils, période</li>
                <li>Utilisez le vocabulaire métier (CA, écritures, tiers)</li>
                <li>Posez des questions de suivi pour affiner</li>
                <li>Les résultats incluent textes, tableaux et graphiques</li>
              </ul>
            </div>

            <div style={{ fontSize: 12, color: 'var(--gray-6)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Exemples de questions
            </div>
            <div className="m-stack" style={{ gap: 8 }}>
              {PINK_PROMPTS.map((p, i) => (
                <button key={i}
                  onClick={() => onPickPrompt(p)}
                  className="m-btn outline"
                  style={{
                    height: 'auto', padding: '12px 14px',
                    textAlign: 'left', whiteSpace: 'normal',
                    fontSize: 13, lineHeight: 1.5, color: 'var(--gray-8)',
                    fontWeight: 400, justifyContent: 'flex-start',
                  }}
                >{p}</button>
              ))}
            </div>
          </>
        )}

        {messages.map((m, i) => <Message key={i} m={m} onVisualize={onVisualize} active={m.id && m.id === activeMessageId} />)}
        {busy && <ThinkingIndicator />}
      </div>

      {/* Composer */}
      <div style={{ borderTop: '1px solid var(--gray-2)', padding: 16, background: 'var(--gray-0)' }}>
        <div style={{ position: 'relative' }}>
          <textarea
            ref={taRef}
            className="m-textarea pink"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder="Décrivez le contrôle à exécuter…"
            rows={2}
            style={{ paddingRight: 50 }}
          />
          <button
            className="m-btn primary-pink icon"
            onClick={submit}
            disabled={!text.trim() || busy}
            style={{ position: 'absolute', right: 8, bottom: 8 }}
            aria-label="Envoyer"
          >{Icons.send}</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--gray-5)', marginTop: 8, textAlign: 'center' }}>
          Vérifiez toujours l'exactitude des réponses · Entrée pour envoyer · Shift+Entrée pour saut de ligne
        </div>
      </div>
    </aside>
  );
}

function Message({ m, onVisualize, active }) {
  if (m.role === 'user') {
    return (
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          background: 'var(--pink-5)', color: '#fff',
          padding: '10px 14px', borderRadius: 12, borderBottomRightRadius: 4,
          maxWidth: '85%', fontSize: 13.5, lineHeight: 1.5
        }}>{m.text}</div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="m-group" style={{ gap: 8, marginBottom: 6, color: 'var(--gray-6)', fontSize: 12 }}>
        <span style={{ color: 'var(--pink-6)', display: 'inline-flex' }}>{Icons.spark}</span>
        Assistant · <span>{m.timestamp || 'à l\'instant'}</span>
        {active && (
          <span className="m-badge pink" style={{ marginLeft: 'auto' }}>{Icons.check}<span>Affiché</span></span>
        )}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--gray-8)', lineHeight: 1.6 }}>{m.text}</div>
      {m.cta === 'visualize' && !active && (
        <Tooltip label="Recharger ce résultat dans le panneau de droite">
          <button
            className="m-btn outline"
            onClick={() => onVisualize && onVisualize(m)}
            style={{ marginTop: 8, gap: 6, height: 28, fontSize: 12, whiteSpace: 'nowrap' }}
          >
            {Icons.refresh}
            <span>Recharger ce résultat</span>
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="m-group" style={{ gap: 10, color: 'var(--gray-6)', fontSize: 13, padding: '6px 0' }}>
      <span style={{ color: 'var(--pink-6)', display: 'inline-flex' }}>{Icons.spark}</span>
      <span>L'agent analyse vos données</span>
      <span className="m-group" style={{ gap: 3 }}>
        <span className="dot-ani" style={{ animationDelay: '0s' }} />
        <span className="dot-ani" style={{ animationDelay: '0.15s' }} />
        <span className="dot-ani" style={{ animationDelay: '0.3s' }} />
      </span>
      <style>{`
        .dot-ani {
          width: 5px; height: 5px; border-radius: 50%;
          background: var(--pink-5); display: inline-block;
          animation: dot-bounce 1s infinite ease-in-out;
        }
        @keyframes dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// RIGHT — Output canvas
// ─────────────────────────────────────────────────────────────────

function OutputCanvas({ state, output, query, onRegen }) {
  if (state === 'empty') return <EmptyState />;
  if (state === 'loading') return <LoadingState />;
  return <LoadedOutput output={output} query={query} onRegen={onRegen} />;
}

function EmptyState() {
  return (
    <div className="m-stack" style={{
      flex: 1, alignItems: 'center', justifyContent: 'center',
      padding: 40, textAlign: 'center', color: 'var(--gray-6)'
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: 'var(--pink-0)', color: 'var(--pink-5)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16
      }}><Icon size={32}>{Icons.chart.props.children}</Icon></div>
      <h2 style={{ color: 'var(--gray-8)', marginBottom: 6 }}>Aucun contrôle généré</h2>
      <p style={{ maxWidth: 360, fontSize: 13.5 }}>
        Posez une question dans le panneau de gauche ou choisissez un exemple. Le résultat structuré (synthèse, tableau, graphique) apparaîtra ici.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="m-stack m-scroll" style={{ flex: 1, padding: 32, gap: 24 }}>
      <Skeleton width={260} height={28} />
      <div className="m-stack" style={{ gap: 10 }}>
        <Skeleton height={12} />
        <Skeleton height={12} width="92%" />
        <Skeleton height={12} width="78%" />
      </div>
      <div className="m-group" style={{ gap: 12 }}>
        {[0,1,2,3].map(i => (
          <div key={i} className="m-card" style={{ flex: 1, padding: 16 }}>
            <Skeleton width={80} height={11} style={{ marginBottom: 10 }} />
            <Skeleton width={120} height={22} />
          </div>
        ))}
      </div>
      <Skeleton height={220} radius={8} />
      <Skeleton height={180} radius={8} />
    </div>
  );
}

// Streaming markdown-ish renderer for paragraphs with **bold** and *italic*
function FormattedPara({ text }) {
  const parts = useMemo(() => {
    const out = [];
    const rest = text || '';
    if (!rest) return out;
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let m;
    let last = 0;
    while ((m = regex.exec(rest)) !== null) {
      if (m.index > last) out.push({ k: 't', v: rest.slice(last, m.index) });
      const tok = m[0];
      if (tok.startsWith('**')) out.push({ k: 'b', v: tok.slice(2, -2) });
      else out.push({ k: 'i', v: tok.slice(1, -1) });
      last = m.index + tok.length;
    }
    if (last < rest.length) out.push({ k: 't', v: rest.slice(last) });
    return out;
  }, [text]);
  return (
    <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--gray-8)', marginBottom: 12 }}>
      {parts.map((p, i) =>
        p.k === 'b' ? <strong key={i}>{p.v}</strong> :
        p.k === 'i' ? <em key={i} style={{ color: 'var(--gray-7)' }}>{p.v}</em> :
        <React.Fragment key={i}>{p.v}</React.Fragment>
      )}
    </p>
  );
}

function LoadedOutput({ output, query, onRegen }) {
  const [tab, setTab] = useState('synthese');
  return (
    <div className="m-stack m-scroll" style={{ flex: 1 }}>
      {/* Header strip */}
      <div className="m-group" style={{
        padding: '16px 24px', gap: 12,
        borderBottom: '1px solid var(--gray-2)', background: '#fff'
      }}>
        <div className="m-stack" style={{ gap: 2, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--pink-6)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Contrôle généré
          </div>
          <h1 style={{ fontSize: 18 }}>Analyse écarts fournisseurs · Q1 2026</h1>
          <div style={{ fontSize: 12, color: 'var(--gray-6)' }}>
            Question : <em>{query}</em>
          </div>
        </div>
        <span className="m-badge green">{Icons.check}<span>Terminé</span></span>
        <Tooltip label="Régénérer"><button className="m-btn icon outline" onClick={onRegen}>{Icons.refresh}</button></Tooltip>
        <Tooltip label="Copier"><button className="m-btn icon outline">{Icons.copy}</button></Tooltip>
        <Tooltip label="Exporter"><button className="m-btn icon outline">{Icons.download}</button></Tooltip>
      </div>

      {/* Tabs */}
      <div style={{ padding: '0 24px', background: '#fff', borderBottom: '1px solid var(--gray-2)' }}>
        <div className="m-tabs">
          {[
            { k: 'synthese', l: 'Synthèse' },
            { k: 'tableau', l: 'Tableau' },
            { k: 'graphique', l: 'Graphique' },
            { k: 'sources', l: 'Sources & évidences' },
          ].map(t => (
            <button key={t.k}
              onClick={() => setTab(t.k)}
              className={`m-tab ${tab === t.k ? 'active pink' : ''}`}
            >{t.l}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 24, background: 'var(--gray-0)' }}>
        {tab === 'synthese' && <Synthese output={output} />}
        {tab === 'tableau' && <Tableau />}
        {tab === 'graphique' && <Graphique />}
        {tab === 'sources' && <Sources />}
      </div>
    </div>
  );
}

function Synthese({ output }) {
  return (
    <>
      {/* KPI strip */}
      <div className="m-group" style={{ gap: 12, marginBottom: 20 }}>
        {KPIS.map((k, i) => (
          <div key={i} className="m-card" style={{ flex: 1, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--gray-6)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
              {k.label}
            </div>
            <div className="m-group" style={{ gap: 8 }}>
              <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>{k.value}</div>
              {k.delta && <span className={`m-badge ${k.deltaTone || 'gray'}`}>{k.delta}</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray-6)', marginTop: 4 }}>{k.hint}</div>
          </div>
        ))}
      </div>

      {/* Synthesis paragraphs (streamed) */}
      <div className="m-card" style={{ padding: 24, marginBottom: 20 }}>
        <div className="m-group" style={{ gap: 8, marginBottom: 14 }}>
          <span style={{ color: 'var(--pink-6)', display: 'inline-flex' }}>{Icons.spark}</span>
          <h3>Synthèse de l'agent</h3>
          <span className="m-badge pink">v1 · 4,2 s</span>
        </div>
        {output.paras.map((p, i) => <FormattedPara key={i} text={p} />)}
        {output.streaming && <span className="caret" style={{ color: 'var(--gray-7)' }} />}
      </div>

      {/* Risk callouts */}
      <div className="m-stack" style={{ gap: 10 }}>
        <h3 style={{ marginBottom: 4 }}>Cas signalés</h3>
        <RiskRow title="Logistique Voltaire SAS" subtitle="3 doublons potentiels · +29,1 % CA" tone="red" />
        <RiskRow title="Numéris Conseil" subtitle="+67,3 % CA · justifié par renouvellement contrat (C-1)" tone="green" />
        <RiskRow title="Cabinet Arènes" subtitle="+63,0 % CA · justification manquante" tone="yellow" />
        <RiskRow title="Imprimerie Quentin" subtitle="Inactif · 3 règlements détectés en 2025" tone="yellow" />
      </div>
    </>
  );
}

function RiskRow({ title, subtitle, tone }) {
  const toneMap = {
    red:    { bg: 'var(--red-0)',    bd: '#ffd6d6', fg: 'var(--red-5)' },
    yellow: { bg: 'var(--yellow-0)', bd: '#ffe2b8', fg: 'var(--yellow-5)' },
    green:  { bg: 'var(--green-0)',  bd: '#c5f1cf', fg: 'var(--green-5)' },
  }[tone];
  return (
    <div className="m-group" style={{
      padding: 14, borderRadius: 8,
      background: toneMap.bg, border: `1px solid ${toneMap.bd}`,
      gap: 12
    }}>
      <div style={{ color: toneMap.fg, display: 'inline-flex' }}>{Icons.alert}</div>
      <div className="m-stack" style={{ gap: 2, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--gray-9)' }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--gray-7)' }}>{subtitle}</div>
      </div>
      <button className="m-btn outline" style={{ height: 30 }}>Voir</button>
    </div>
  );
}

function Tableau() {
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => {
    if (filter === 'risk') return FOURNISSEURS.filter(f => f.risque === 'high');
    if (filter === 'inactive') return FOURNISSEURS.filter(f => f.ecart === 'inactif');
    return FOURNISSEURS;
  }, [filter]);
  return (
    <div className="m-card flush">
      <div className="m-group" style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-2)', gap: 8 }}>
        <h3>Détails par fournisseur</h3>
        <span className="m-badge">{rows.length} lignes</span>
        <div style={{ flex: 1 }} />
        <div className="m-group" style={{ gap: 6 }}>
          {[
            { k: 'all', l: 'Tous' },
            { k: 'risk', l: 'Risque élevé' },
            { k: 'inactive', l: 'Inactifs' },
          ].map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className={`m-btn ${filter === f.k ? 'primary-pink' : 'outline'}`}
              style={{ height: 30, fontSize: 13 }}
            >{f.l}</button>
          ))}
        </div>
      </div>
      <table className="m-table">
        <thead>
          <tr>
            <th>Fournisseur</th>
            <th>Catégorie</th>
            <th className="num">CA 2024</th>
            <th className="num">CA 2025</th>
            <th className="num">Variation</th>
            <th>Statut</th>
            <th className="num">Doublons</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(f => (
            <tr key={f.id}>
              <td>
                <div style={{ fontWeight: 500 }}>{f.nom}</div>
                <div style={{ fontSize: 11, color: 'var(--gray-6)' }}>{f.id} · {f.region}</div>
              </td>
              <td style={{ color: 'var(--gray-7)' }}>{f.categorie}</td>
              <td className="num" style={{ color: 'var(--gray-7)' }}>{fmtCA(f.ca2024)}</td>
              <td className="num" style={{ fontWeight: 500 }}>{fmtCA(f.ca2025)}</td>
              <td className="num" style={{ color: f.variation > 25 ? 'var(--red-5)' : f.variation < -50 ? 'var(--yellow-5)' : 'var(--gray-7)' }}>
                {f.variation > 0 ? '+' : ''}{f.variation.toFixed(1)} %
              </td>
              <td>
                <span className={`m-badge ${f.risque === 'high' ? 'red' : f.risque === 'medium' ? 'yellow' : 'green'}`}>
                  {f.risque === 'high' ? 'Risque' : f.risque === 'medium' ? 'À vérifier' : 'OK'}
                </span>
              </td>
              <td className="num">{f.doublons || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Graphique() {
  const max = Math.max(...FOURNISSEURS.map(f => f.ca2025));
  return (
    <div className="m-card">
      <h3 style={{ marginBottom: 16 }}>CA 2024 → 2025 par fournisseur</h3>
      <div className="m-stack" style={{ gap: 14 }}>
        {FOURNISSEURS.map(f => {
          const w24 = (f.ca2024 / max) * 100;
          const w25 = (f.ca2025 / max) * 100;
          return (
            <div key={f.id}>
              <div className="m-group" style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{f.nom}</span>
                <span style={{ fontSize: 12, color: f.variation > 25 ? 'var(--red-5)' : f.variation < -50 ? 'var(--yellow-5)' : 'var(--gray-6)' }}>
                  {f.variation > 0 ? '+' : ''}{f.variation.toFixed(1)} %
                </span>
              </div>
              <div style={{ position: 'relative', height: 12, background: 'var(--gray-1)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${w24}%`, background: 'var(--gray-4)' }} />
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${w25}%`, background: f.risque === 'high' ? 'var(--pink-5)' : 'var(--pink-3)', mixBlendMode: 'multiply' }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="m-group" style={{ gap: 16, marginTop: 18, fontSize: 12, color: 'var(--gray-6)' }}>
        <span className="m-group" style={{ gap: 6 }}><span style={{ width: 12, height: 12, background: 'var(--gray-4)', borderRadius: 2 }} />2024</span>
        <span className="m-group" style={{ gap: 6 }}><span style={{ width: 12, height: 12, background: 'var(--pink-3)', borderRadius: 2 }} />2025</span>
        <span className="m-group" style={{ gap: 6 }}><span style={{ width: 12, height: 12, background: 'var(--pink-5)', borderRadius: 2 }} />Risque élevé</span>
      </div>
    </div>
  );
}

function Sources() {
  return (
    <div className="m-stack" style={{ gap: 12 }}>
      <h3>Évidences conversationnelles</h3>
      <p style={{ fontSize: 13, color: 'var(--gray-7)', marginBottom: 8 }}>
        Chaque insight de l'agent est traçable jusqu'à sa source. Cliquez pour ouvrir la conversation complète.
      </p>
      {CONVERSATION_SNIPPETS.map(s => (
        <div key={s.id} className="m-card" style={{ padding: 16 }}>
          <div className="m-group" style={{ gap: 8, marginBottom: 10 }}>
            <span className="m-badge pink">{s.id}</span>
            <strong style={{ fontSize: 13 }}>{s.speaker}</strong>
            <span style={{ fontSize: 12, color: 'var(--gray-6)' }}>· {s.timestamp}</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--gray-6)' }}>{s.source}</span>
          </div>
          <div className="evidence pink" style={{ marginBottom: 10 }}>
            « {s.quote} »
          </div>
          <div className="m-group" style={{ gap: 6, flexWrap: 'wrap' }}>
            {s.tags.map(t => <span key={t} className="m-badge">{t}</span>)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────
function App() {
  const [messages, setMessages] = useState([]);
  const [outState, setOutState] = useState('empty'); // empty | loading | loaded
  const [output, setOutput] = useState({ paras: [], streaming: false });
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState(null);
  const [toast, setToast] = useState(null);

  const msgIdRef = useRef(0);

  const runQuery = (q) => {
    const id = ++msgIdRef.current;
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setBusy(true);
    setQuery(q);
    setActiveMessageId(id);
    setOutState('loading');
    // Simulate latency, then load the right pane AND post a brief commentary in chat.
    setTimeout(() => {
      setBusy(false);
      setOutState('loaded');
      streamParagraphs(CONTROL_RESPONSE_PARAS);
      setMessages(prev => [...prev, {
        id,
        role: 'agent',
        cta: 'visualize',
        query: q,
        text: "Synthèse, tableau, graphique et évidences sources affichés à droite. 3 cas à risque détectés sur 8 fournisseurs analysés.",
        timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      }]);
    }, 1100);
  };

  // Reload an old message's result into the right pane
  const onVisualize = (m) => {
    if (m.id === activeMessageId) return;
    setQuery(m.query);
    setActiveMessageId(m.id);
    setOutState('loading');
    setTimeout(() => {
      setOutState('loaded');
      streamParagraphs(CONTROL_RESPONSE_PARAS);
    }, 500);
  };

  const onShare = () => {
    const url = `${location.origin}${location.pathname}#share=${msgIdRef.current}-${Date.now().toString(36)}`;
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    setToast('Lien de conversation copié dans le presse-papiers');
    setTimeout(() => setToast(null), 2400);
  };

  const streamParagraphs = (paras) => {
    setOutput({ paras: [], streaming: true });
    let i = 0;
    const next = () => {
      const idx = i;
      if (idx >= paras.length) {
        setOutput(o => ({ ...o, streaming: false }));
        return;
      }
      setOutput(o => ({ paras: [...o.paras, paras[idx]], streaming: idx + 1 < paras.length }));
      i++;
      setTimeout(next, 700);
    };
    setTimeout(next, 80);
  };

  const onRegen = () => {
    setOutState('loading');
    setBusy(true);
    setTimeout(() => {
      setOutState('loaded');
      setBusy(false);
      streamParagraphs(CONTROL_RESPONSE_PARAS);
    }, 700);
  };

  return (
    <div className="m-stack" style={{ height: '100vh', overflow: 'hidden' }}>
      <ShellHeader
        product="closing"
        crumbs={['Liste des groupes', '00 LAST GROUP', 'Atelier de contrôles']}
      />
      <div className="m-group" style={{ flex: 1, alignItems: 'stretch', minHeight: 0 }}>
        <ConversationPanel
          messages={messages}
          onSend={runQuery}
          busy={busy}
          onPickPrompt={runQuery}
          onVisualize={onVisualize}
          activeMessageId={activeMessageId}
          onShare={onShare}
        />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--gray-0)' }}
              data-screen-label="Output">
          <OutputCanvas
            state={outState}
            output={output}
            query={query}
            onRegen={onRegen}
          />
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
