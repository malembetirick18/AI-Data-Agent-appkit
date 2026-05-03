// Shared shell components: AppShell header, app switcher, breadcrumbs.
// Mantine-faithful — visual + behavioral 1:1 with @mantine/core.

const { useState, useRef, useEffect } = React;

// Icon helpers — minimal, in the spirit of Tabler icons (Mantine's default set).
const Icon = ({ d, size = 18, stroke = 1.6, fill = 'none', children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
       stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    {d ? <path d={d} /> : children}
  </svg>
);

const Icons = {
  send: <Icon><path d="M10 14l11 -11" /><path d="M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5" /></Icon>,
  sparkle: <Icon><path d="M16 18a2 2 0 0 1 2 2" /><path d="M16 18a2 2 0 0 0 2 -2" /><path d="M20 18a2 2 0 0 1 -2 2" /><path d="M20 18a2 2 0 0 0 -2 -2" /><path d="M5 10a4 4 0 0 1 4 4" /><path d="M5 10a4 4 0 0 0 4 -4" /><path d="M13 10a4 4 0 0 1 -4 4" /><path d="M13 10a4 4 0 0 0 -4 -4" /></Icon>,
  bulb: <Icon><path d="M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7" /><path d="M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3" /><path d="M9.7 17l4.6 0" /></Icon>,
  search: <Icon><circle cx="10" cy="10" r="7" /><path d="M21 21l-6 -6" /></Icon>,
  bell: <Icon><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" /><path d="M9 17v1a3 3 0 0 0 6 0v-1" /></Icon>,
  filter: <Icon><path d="M5.5 5h13a1 1 0 0 1 .5 1.5l-5 5.5l0 7l-4 -3l0 -4l-5 -5.5a1 1 0 0 1 .5 -1.5" /></Icon>,
  refresh: <Icon><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></Icon>,
  download: <Icon><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><path d="M7 11l5 5l5 -5" /><path d="M12 4l0 12" /></Icon>,
  copy: <Icon><path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-2" /><path d="M9 3m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" /></Icon>,
  check: <Icon><path d="M5 12l5 5l10 -10" /></Icon>,
  alert: <Icon><path d="M12 9v4" /><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" /><path d="M12 16h.01" /></Icon>,
  pin: <Icon><path d="M9 4v6l-2 4v2h10v-2l-2 -4v-6" /><path d="M12 16l0 5" /><path d="M8 4l8 0" /></Icon>,
  trash: <Icon><path d="M4 7l16 0" /><path d="M10 11l0 6" /><path d="M14 11l0 6" /><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" /><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" /></Icon>,
  expand: <Icon><path d="M4 8v-2a2 2 0 0 1 2 -2h2" /><path d="M4 16v2a2 2 0 0 0 2 2h2" /><path d="M16 4h2a2 2 0 0 1 2 2v2" /><path d="M16 20h2a2 2 0 0 0 2 -2v-2" /></Icon>,
  close: <Icon><path d="M18 6l-12 12" /><path d="M6 6l12 12" /></Icon>,
  plus: <Icon><path d="M12 5l0 14" /><path d="M5 12l14 0" /></Icon>,
  chevDown: <Icon><path d="M6 9l6 6l6 -6" /></Icon>,
  chevRight: <Icon><path d="M9 6l6 6l-6 6" /></Icon>,
  table: <Icon><path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z" /><path d="M3 10h18" /><path d="M10 3v18" /></Icon>,
  chart: <Icon><path d="M3 3v18h18" /><path d="M20 18v3" /><path d="M16 16v5" /><path d="M12 13v8" /><path d="M8 16v5" /><path d="M3 11c6 0 5 -5 9 -5s3 5 9 5" /></Icon>,
  map: <Icon><path d="M3 7l6 -3l6 3l6 -3v13l-6 3l-6 -3l-6 3v-13" /><path d="M9 4v13" /><path d="M15 7v13" /></Icon>,
  threads: <Icon><path d="M8 9h8" /><path d="M8 13h6" /><path d="M9 18l-1 3l-3 -3h-2a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-7l-3 3z" /></Icon>,
  doc: <Icon><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" /><path d="M9 9l1 0" /><path d="M9 13l6 0" /><path d="M9 17l6 0" /></Icon>,
  brain: <Icon><path d="M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8" /><path d="M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8" /><path d="M17.5 16a3.5 3.5 0 0 0 0 -7h-.5" /><path d="M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0" /><path d="M6.5 16a3.5 3.5 0 0 1 0 -7h.5" /><path d="M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10" /></Icon>,
  spark: <Icon><path d="M12 3l1.755 4.245l4.245 1.755l-4.245 1.755l-1.755 4.245l-1.755 -4.245l-4.245 -1.755l4.245 -1.755z" /><path d="M19 15l.5 2l2 .5l-2 .5l-.5 2l-.5 -2l-2 -.5l2 -.5z" /></Icon>,
  share: <Icon><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M8.7 10.7l6.6 -3.4" /><path d="M8.7 13.3l6.6 3.4" /></Icon>,
  link: <Icon><path d="M9 15l6 -6" /><path d="M11 6l.464 -.464a5 5 0 0 1 7.071 7.071l-.534 .464" /><path d="M13 18l-.397 .397a5.068 5.068 0 0 1 -7.127 -7.127l.524 -.524" /></Icon>,
};

// App switcher (matches the dropdown in the user's screenshot)
function AppSwitcher({ current = 'geo', onSwitch }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  return (
    <div className="app-switcher" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-label="Vos applications">
        <span className="app-grid">
          <span /><span /><span /><span />
        </span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-label">Vos applications</div>
          <a className="menu-item" href="prototype-2-geo.html" role="menuitem">
            <span className="dot teal" /> Geoficiency
          </a>
          <a className="menu-item" href="prototype-1-closing.html" role="menuitem">
            <span className="dot pink" /> Closing
          </a>
          <hr className="m-divider" style={{margin: '6px 4px'}} />
          <a className="menu-item" href="prototype-3-console.html" role="menuitem">
            <span style={{width: 8, height: 8, borderRadius: 2, background: 'var(--gray-7)'}} /> Console agent
          </a>
          <a className="menu-item" href="index.html" role="menuitem">
            <span style={{width: 8, height: 8, borderRadius: 2, background: 'var(--gray-4)'}} /> Tous les prototypes
          </a>
        </div>
      )}
    </div>
  );
}

// Brand mark (recreates the hex-style logo without copying any specific brand)
function BrandMark({ variant = 'teal' }) {
  return (
    <span className="brand-mark" style={{ background: 'transparent' }}>
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <path d="M16 2 L28 9 L28 23 L16 30 L4 23 L4 9 Z"
              fill={variant === 'teal' ? 'var(--teal-5)' : 'var(--pink-5)'} />
        <path d="M16 9 L22 12.5 L22 19.5 L16 23 L10 19.5 L10 12.5 Z"
              fill="#fff" />
        <circle cx="16" cy="16" r="2.4" fill={variant === 'teal' ? 'var(--teal-5)' : 'var(--pink-5)'} />
      </svg>
    </span>
  );
}

function ShellHeader({ product = 'geo', crumbs = [], onSwitch }) {
  return (
    <header className={`app-shell-header ${product}`} role="banner" data-screen-label="Header">
      <AppSwitcher current={product} onSwitch={onSwitch} />
      <div className="m-group" style={{ gap: 10 }}>
        <BrandMark variant={product === 'closing' ? 'pink' : 'teal'} />
        <span className="brand-name" style={{ color: product === 'closing' ? 'var(--pink-6)' : 'var(--teal-7)' }}>
          {product === 'closing' ? 'Closing' : 'Geoficiency'}
        </span>
      </div>
      <div style={{ width: 1, height: 24, background: 'var(--gray-2)', margin: '0 6px' }} />
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ margin: '0 8px', color: 'var(--gray-4)' }}>/</span>}
            {i === crumbs.length - 1 ? <strong>{c}</strong> : <span>{c}</span>}
          </React.Fragment>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div className="m-group" style={{ gap: 8 }}>
        <button className="m-btn icon subtle" aria-label="Recherche">{Icons.search}</button>
        <button className="m-btn icon subtle" aria-label="Notifications">{Icons.bell}</button>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'var(--gray-2)', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 600, color: 'var(--gray-7)'
        }}>MA</div>
      </div>
    </header>
  );
}

// Skeleton primitive — Mantine's Skeleton equivalent.
function Skeleton({ width = '100%', height = 12, radius = 4, style = {}, ...rest }) {
  return <div className="m-skeleton" style={{ width, height, borderRadius: radius, ...style }} {...rest} />;
}

// Tooltip (lightweight, behaves like Mantine Tooltip)
function Tooltip({ label, children }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}
          onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--gray-9)', color: '#fff',
          padding: '4px 8px', borderRadius: 4, fontSize: 12,
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 50
        }}>{label}</span>
      )}
    </span>
  );
}

Object.assign(window, { ShellHeader, Skeleton, Tooltip, Icons, Icon, BrandMark, AppSwitcher });
