# AI Assistant Instructions

<!-- appkit-instructions-start -->
## Databricks AppKit

This project uses Databricks AppKit packages. For AI assistant guidance on using these packages, refer to:

- **@databricks/appkit** (Backend SDK): [./node_modules/@databricks/appkit/CLAUDE.md](./node_modules/@databricks/appkit/CLAUDE.md)
- **@databricks/appkit-ui** (UI Integration, Charts, Tables, SSE, and more.): [./node_modules/@databricks/appkit-ui/CLAUDE.md](./node_modules/@databricks/appkit-ui/CLAUDE.md)

### Databricks Skills

For enhanced AI assistance with Databricks CLI operations, authentication, data exploration, and app development, install the Databricks skills:

```bash
databricks experimental aitools skills install
```
<!-- appkit-instructions-end -->

---

## Project: My Data AI Assistant

Multi-layer Databricks app for AI-driven data exploration. Stack:
- **Client** — React 19 + Mantine UI v7 + AG Charts/Grid Enterprise + JSON Render (split across `components/`, `hooks/`, `registry/`, `lib/`, `types/`)
- **Server** — Express.js + AppKit (`server/server.ts`, `plugins/controller-ai-agent/`)
- **Semantic Layer API** — FastAPI + DSPy + MLflow (`semantic_layer_api/`)
- **Shared** — `shared/genui-catalog.ts`

---

## Bugs Fixed (April 2026)

### Bug 1 — Duplicate `normalizeApiSpec` (client diverged from shared)
`ai-chat-drawer.tsx` had a 140-line local copy of `normalizeApiSpec`. **This function and `shared/normalize-spec.ts` have since been deleted** — the spec pipeline was refactored so Python `/spec/generate` streams raw JSONL patches, `useUIStream` assembles them on the client, and no normalization layer is needed. Do not re-add `normalizeApiSpec` or `shared/normalize-spec.ts`.

### Bug 2 — `activeYKeys`/`yOptions` created new arrays on every render
In `InteractiveChart`, `yOptions` was computed inline (no `useMemo`), causing `activeYKeys` and `sortedData` to recompute every render → AG Charts re-rendered constantly. Fixed by wrapping `allColOptions`, `numColOptions`, `yOptions`, `sizeOptions`, and `activeYKeys` in `useMemo`.

### Bug 3 — `DataTable` `columnDefs`/`rowData` recomputed every render
`headers` and `rows` were computed inline (`const headers = Array.isArray(...)`) — new references each render broke the `useMemo` deps for `columnDefs`/`rowData`, forcing AG Grid to reinitialize on every parent render. Fixed by wrapping `headers` and `rows` in `useMemo`.

### Bug 4 — `RenderBlock` used `JSON.stringify(block)` as React key
Serializing entire block objects (including all rows) as keys is expensive and causes remounting. Fixed: use `blockIndex` instead.

### Bug 5 — `BulletList` used item content as React key
Duplicate items (e.g., two "N/A" entries) caused React key conflicts. Fixed: use `itemIndex`.

### Bug 6 — Wrong TypeScript type for `conversationContext`
`plugins/controller-ai-agent/controller-ai-agent.ts` typed it as `Record<string, unknown>[] | null` (array). The client sends a **single object**. Fixed: `Record<string, unknown> | null`.

### Bug 7 — Phase 4 corrector JSON not validated as `dict`
`semantic_layer_api/src/controller_decision.py`: after `json.loads(raw_correction.corrected_decision_json)`, the code immediately accessed dict keys. If the LLM returned an array/null, this caused `TypeError`. Added: `if not isinstance(corrected, dict): raise ValueError(...)`.

### Bug 8 — `generate_spec` was synchronous, blocking FastAPI threadpool
`semantic_layer_api/main.py`: the `/spec/generate` endpoint was `def generate_spec(...)` — a sync FastAPI handler that blocks a threadpool worker for 10–30s per DSPy call. Fixed: made it `async def generate_spec(...)` with `result = await asyncio.to_thread(_run_genui)`.

---

## Feature: `useUIStream` Integration (April 2026)

Replaced the polling/fetch-based `generateUiSpecForMessage()` with the `useUIStream` hook from `@json-render/react`. This connects `useGenieChat` output directly to streaming spec generation via `/api/spec-stream`.

### Pattern

```typescript
// 1. Dual-tracking: ref for callbacks (always fresh), state for rendering
const streamingSpecMessageIdRef = useRef<string | null>(null)
const [streamingSpecMessageId, setStreamingSpecMessageId] = useState<string | null>(null)

// 2. Hook instantiation — onComplete/onError MUST read from ref (not state) to avoid stale closure
const uiStream = useUIStream({
  api: '/api/spec-stream',
  onComplete: (spec) => {
    const id = streamingSpecMessageIdRef.current  // ref, not state
    if (id) {
      setGeneratedSpecs((prev) => (prev[id] ? prev : { ...prev, [id]: spec as GenericUiSpec }))
      streamingSpecMessageIdRef.current = null
      setStreamingSpecMessageId(null)
    }
  },
  onError: () => {
    streamingSpecMessageIdRef.current = null
    setStreamingSpecMessageId(null)
  },
})

// 3. Trigger: called after Genie attaches results
streamingSpecMessageIdRef.current = messageId
setStreamingSpecMessageId(messageId)
void uiStream.send(promptText, { genieResult: buildGenieResultPayload(msg) })

// 4. Rendering: historical specs in generatedSpecs[], live spec via uiStream.spec
const resolvedSpec =
  generatedSpecs[msgId] ??
  (streamingSpecMessageId === msgId && uiStream.spec ? uiStream.spec as GenericUiSpec : undefined)
```

### `/api/spec-stream` endpoint (server.ts)

Forwards raw JSONL RFC 6902 patches from Python `/spec/generate` directly to the client (`text/plain`). No normalization — `useUIStream` assembles patches into a spec on the client side. Example patch lines:
```
{"op":"add","path":"/elements","value":{...}}
{"op":"add","path":"/root","value":"stack-1"}
```

### Key invariants to preserve

1. **`shared/normalize-spec.ts` has been deleted** — do not recreate it. Normalization is no longer needed.
2. **`/api/spec` endpoint has been deleted** — `handleSpecRequest` and `assembleSpecFromPatches` are gone. `QueryDataTable` now uses `useUIStream` + `/api/spec-stream` directly. Do not re-add a separate `/api/spec` route.
3. **`useUIStream` tracks one spec at a time.** `generatedSpecs` map stores completed specs; `uiStream.spec` holds the in-progress one. Always resolve in that order.
4. **Dual-tracking ref+state is intentional.** The ref prevents stale closures in `onComplete`/`onError`; the state triggers React re-renders. Do not collapse them into one.
5. **`attemptedSpecIdsRef`** prevents triggering `uiStream.send()` more than once per message ID. Do not remove it.
6. **Fallback `buildSpecFromGenieStatement()`** still runs when `resolvedSpec` is undefined. On `useUIStream` error, the fallback renders the raw Genie data.

---

## Memoization Rules (React)

- **`InteractiveChart`**: `allColOptions`, `numColOptions`, `yOptions`, `sizeOptions`, `activeYKeys` — all must be in `useMemo`. Never compute them inline.
- **`DataTable`**: `headers` and `rows` — must be in `useMemo([props.headers])` / `useMemo([props.rows])`. Never compute them inline.
- **React keys**: use index (`blockIndex`, `itemIndex`) for `RenderBlock` and `BulletList` items. Never use `JSON.stringify(block)` as a key.

---

## Architecture Decisions

- **Controller approval gate**: UUID token in `httpOnly` cookie, single-use, validated in `server.ts` before every Genie call. Bypassing this gate is intentional only for `guide` decision (canSendDirectly logic).
- **`canSendDirectly` formula**: `isApproved(decision, confidence) || decision === 'guide'`. The low-confidence band (0.70–0.89) requires manual user confirmation — it does NOT set `canSendDirectly = true` automatically.
- **Reflexion pipeline**: enabled via `ENABLE_CONTROLLER_REFLECTION=true`. Adds 2 LLM calls (phases 3c + 4). Only fires when there is a real signal (`bool(removed) or bool(coherence_note)`). Disabled in dev. Non-fatal — errors fall back to Phase 3b output.
- **Scope guardrail runs before Reflexion**: the scope guardrail block executes after Phase 3b validation and **before** the Reflexion block so a scope-forced `clarify` never wastes two extra LLM calls.
- **`generate_spec` async**: FastAPI threadpool exhaustion under load. Always keep `/spec/generate` as `async def` with `asyncio.to_thread`.
- **Config constants**: `SEMANTIC_LAYER_API_URL` and `REQUEST_TIMEOUT_MS` are defined once in `plugins/controller-ai-agent/controller-ai-agent.ts` and exported. `server.ts` imports them — do not redeclare locally.
- **Single spec endpoint**: Only `/api/spec-stream` exists. Both `AiChatDrawer`'s main `useUIStream` and `QueryDataTable`'s internal `useUIStream` use this endpoint. The `/api/spec` endpoint and `handleSpecRequest`/`assembleSpecFromPatches` have been deleted (April 2026).
- **React client split**: `ai-chat-drawer.tsx` was refactored from 3,568 lines into focused modules: `types/chat.ts`, `lib/{chart-utils,message-utils,spec-utils,genie-utils}.ts`, `components/{InteractiveChart,MessageContent,ClarificationPanel,TeamControlsPanel,SaveControlModal}.tsx`, `hooks/{useSpecStreaming,useControllerState,useSaveDialog}.ts`, `registry/chat-ui-registry.tsx`. The orchestration shell `ai-chat-drawer.tsx` is ~600 lines.

---

## Bugs Fixed (April 2026 — Audit Pass)

### Bug 9 — `handleSpecRequest`/`/api/spec` made redundant by `useUIStream`
`plugins/controller-ai-agent/controller-ai-agent.ts` had a `parseSpecFromSse()` parser and a `handleSpecRequest` handler serving `POST /api/spec`. Python `/spec/generate` switched to JSONL patches (`text/plain`), breaking `QueryDataTable`. Final resolution: deleted `handleSpecRequest`, `assembleSpecFromPatches`, `SpecRequest`, `SpecResponse`, and the `/api/spec` route entirely. `QueryDataTable` now uses `useUIStream({ api: '/api/spec-stream' })` directly — no intermediate server-side parse step needed. `parseSpecFromSse` also removed from `index.ts` barrel export.

### Bug 10 — Reflexion Phase 3c fired even on clean decisions (wasted LLM calls)
`semantic_layer_api/src/controller_decision.py`: Phase 3c (self-reflection) triggered for any `proceed`/`guide` decision regardless of whether catalog validation found hallucinations or a coherence issue. Fixed: added `_has_reflection_signal = bool(removed) or bool(coherence_note)` guard — Phase 3c+4 only runs when there is actual signal to reflect on.

### Bug 11 — Scope guardrail ran after Reflexion, wasting 2 LLM calls for scope-less queries
`semantic_layer_api/src/controller_decision.py`: the scope guardrail (which overrides decision to `clarify`) was placed after the Reflexion block. A scope-less `proceed` decision would run Phase 3c+4 and then be overridden to `clarify` anyway. Fixed: moved scope guardrail to before the Reflexion block.

### Bug 12 — Phase 4 corrector JSON parse error had no diagnostic logging
`semantic_layer_api/src/controller_decision.py`: `json.loads(raw_correction.corrected_decision_json)` on line ~325 had no targeted error handler. A JSONDecodeError would be caught by the outer `except Exception` with a generic message. Fixed: added inner `try/except json.JSONDecodeError` that logs the raw LLM output before re-raising.

### Bug 13 — Dead expiry check in `controller-approval-store.ts`
`server/controller-approval-store.ts`: `sweepExpiredApprovals(now)` on line 55 purges all tokens with `expiresAt <= now`. The subsequent check at lines 64–65 (`if (approval.expiresAt <= now)`) was unreachable dead code — expired tokens are already gone before `.get()` is called. Deleted lines 64–65.

### Bug 14 — `genui_spec_generator.py` had no error handling in `forward()`
`semantic_layer_api/src/genui_spec_generator.py`: DSPy predict failures propagated silently with no log context. Fixed: wrapped `self.predict()` in try/except with `_logger.error()` before re-raising.

### Bug 15 — Duplicate `system_prompt` in `main.py` `_run_genui()`
`semantic_layer_api/main.py`: `system_prompt=default_genui_catalog_prompt` was passed both to the `genui_lm` LM constructor and again inside `dspy.settings.context()`. The context override was redundant. Removed from the context call.

### Bug 16 — Orphaned Python signature files
Three signature classes (`QueryClassificationSignature`, `RequiredColumnsSignature`, `SQLFunctionSignature`) were defined but imported nowhere — absorbed by `QueryAnalysisSignature` in a prior refactor. Deleted: `src/signatures/query_classification_signature.py`, `required_columns_signature.py`, `sql_function_signature.py`.

### Bug 17 — `SaveControlModal.tsx` used `React.ReactNode` without React import
`client/src/components/SaveControlModal.tsx`: `RIGHT_OPTIONS` typed `icon` as `React.ReactNode` but the file had no `React` import (using new JSX transform). Caused TypeScript error. Fixed: added `import type { ReactNode } from 'react'` and changed `React.ReactNode` → `ReactNode`.

### Bug 18 — `latestReasoningRef.current` read during render (`react-hooks/refs` violation)
`client/src/components/ai-chat-drawer.tsx`: `latestReasoningRef.current` was accessed inside `useMemo` (render path), violating the `react-hooks/refs` rule which forbids ref `.current` reads during render. Fixed with dual-tracking: added `latestReasoning` state alongside `latestReasoningRef`. The ref is kept for stale-closure-free callbacks in `useControllerState`; the state is used in `useMemo` for rendering. `useControllerState` now accepts `setLatestReasoning` and calls it alongside every `latestReasoningRef.current = ...` assignment. `latestReasoning` added to `useMemo` deps.

### Bug 19 — `lastSuggestionIndexRef` missing from `handleClear` `useCallback` deps
`client/src/components/ai-chat-drawer.tsx`: `handleClear` wrote to `lastSuggestionIndexRef.current` but `lastSuggestionIndexRef` was absent from its `useCallback` dependency array, triggering an `exhaustive-deps` warning. Fixed: added `lastSuggestionIndexRef` to deps (refs have stable identity — adding them to deps is safe and correct).

### Bug 20 — `setLocalUserMessages` called synchronously inside `useEffect` (`react-hooks/set-state-in-effect`)
`client/src/components/ai-chat-drawer.tsx`: Two `useEffect` hooks called `setLocalUserMessages` directly in their bodies — the dedup effect (removing echoed local messages) and the loading-placeholder effect (adding/removing `genie-streaming`). The `react-hooks/set-state-in-effect` rule flags synchronous setState calls in effect bodies as a performance risk (cascading renders). Fixed by converting both effects into derived state in `useMemo`: (1) dedup logic computes `genieUserContents` and filters `localUserMessages` inline; (2) loading placeholder is appended as a computed `loadingPlaceholder` array when `chatStatus !== 'idle'` and no Genie assistant message exists yet — using `Number.MAX_SAFE_INTEGER` as epoch to keep it last in sort order. Both `prevGenieCountRef` and the two `useEffect` blocks were removed.

### Bug 21 — `INITIAL_USER_RIGHTS` exported from component file (`react-refresh/only-export-components`)
`client/src/components/SaveControlModal.tsx`: exporting a non-component constant (`INITIAL_USER_RIGHTS`) from a component file breaks React fast-refresh. The export was unused — `useSaveDialog.ts` already defines its own local copy. Fixed: removed the export entirely.
