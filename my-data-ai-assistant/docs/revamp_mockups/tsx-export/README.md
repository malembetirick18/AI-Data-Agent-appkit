# Mantine + Vite · AI Data Agent prototypes

Three production-ready React + TypeScript components for Vite + Mantine Core.

## Setup

```bash
npm create vite@latest geoficiency-agent -- --template react-ts
cd geoficiency-agent
npm install @mantine/core @mantine/hooks @tabler/icons-react
```

In `main.tsx`:

```tsx
import '@mantine/core/styles.css';
import { MantineProvider, createTheme } from '@mantine/core';

const theme = createTheme({
  primaryColor: 'teal',
  fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  defaultRadius: 'md',
  colors: {
    teal: ['#e6f7f5','#c9ece8','#9bdcd5','#5fc3b8','#2ba99c','#1ba098','#0f8a82','#0a6f68','#074f4a','#053632'],
    closingPink: ['#fdeaf3','#fbd0e3','#f7a3c8','#ef6ba9','#e63d8e','#d72178','#b81763','#911150','#5f0a35','#3d0824'],
  },
});

createRoot(document.getElementById('root')!).render(
  <MantineProvider theme={theme}>
    <App />
  </MantineProvider>
);
```

## Files

- `Prototype1Closing.tsx` — Atelier de contrôles (Closing, pink primary)
- `Prototype2Geo.tsx` — Explorateur Géo (Geoficiency, teal primary)
- `Prototype3Console.tsx` — Console agent multi-threads
- `mockData.ts` — French finance/audit fixtures
- `Shell.tsx` — Shared AppShell header + app switcher

## Notes

- All async surfaces use Mantine `Skeleton` matching final geometry.
- Empty / loading / loaded states implemented for every panel.
- Conversation evidences (`C-1`…`C-3`) are traceable from agent output.
- Keyboard: Enter to send, Shift+Enter for newline.
- Mantine version assumed: `@mantine/core@^7.x`.

## Tradeoffs

- The France map in Prototype 2 is a stylised hex layout — swap for `react-simple-maps` or a real geojson region map for production.
- Streaming uses `setTimeout` to simulate a token stream — wire to your real SSE/WebSocket endpoint in `runQuery`.
- `AGENT_STATE` is a snapshot — for live state, wire to your agent's WebSocket and merge updates with `useReducer`.
