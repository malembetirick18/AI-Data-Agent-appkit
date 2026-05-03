# Implementation Reference — `feat/experiment-react-agents`

End-to-end implementation notes for the AI Data Agent. Four layers cooperate over a single SSE/HTTP contract: **Python semantic layer → Node.js controller proxy → React assistant hook → JSON-render canvas**. Each layer below documents its public surface, its internal contracts, and the invariants that other layers depend on.

---

## Layer 1 — Python (`semantic_layer_api/`)

FastAPI service running DSPy on Azure OpenAI. Two endpoints emit streaming responses; one is a synchronous lookup.

### 1.1 Entrypoint — `main.py`

| Symbol | Kind | Purpose |
|---|---|---|
| `app` | `FastAPI` | Service root. CORS configured from `CORS_ALLOWED_ORIGINS`. |
| `lm` | `dspy.LM` | Single Azure LM instance shared by both pipelines. `JSONAdapter` + `track_usage=True`. |
| `controller_agent` | `ControllerDecision` | DSPy ReAct agent (see 1.2). |
| `genui_spec_generator` | `GenUiSpecGenerator` | DSPy module that emits JSONL JSON-Patch lines for the canvas. |
| `stream_controller` | streamified callable | `dspy.streamify(controller_agent, stream_listeners=[…react.extract], status_message_provider=ControllerStatusProvider())`. |
| `stream_spec` | streamified callable | `dspy.streamify(genui_spec_generator, stream_listeners=[…spec_patches], status_message_provider=SpecStatusProvider())`. |

### 1.2 ReAct controller — `src/modules/controller_decision.py`

The controller is a `dspy.Module` wrapping `dspy.ReAct(ControllerAgentSignature, tools=[...], max_iters=8)`.

**Tools** (registered at import time — `dspy.streamify`-compatible because they are module-level functions):

| Tool | Side effects | Returns |
|---|---|---|
| `check_scope_coverage(text)` | None | `{ scope_established: bool, questions: list[dict] }`. Reads `_SCOPE_QUESTIONS`. |
| `check_temporal_coverage(text)` | None | `{ temporal_ambiguous: bool, questions: list[dict] }`. Reads `_TEMPORAL_QUESTIONS`. |
| `classify_intent(prompt)` | LLM call (`QueryAnalysisSignature`) | `{ classification, required_columns, sql_functions, coherence_note }`. |
| `rewrite_query(prompt, classification)` | LLM call (`RephraseQuerySignature`) | `{ rewritten_prompt }`. |
| `lookup_catalog(intent, kind)` | None | Top-K matches from the request-scoped catalog (`difflib`). |
| `validate_catalog_names(...)` | None | `{ valid_*, removed_*, guidance }`. Strips hallucinations against the catalog. |

**Request-scoped state** — the per-request catalog is parked in a module-level `contextvars.ContextVar`:

```python
_request_ctx: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "controller_request_ctx", default=_EMPTY_CTX
)
```

`ControllerDecision.forward()` sets this var before calling `self.react(...)` and resets it in `finally`. Tools read the var via `_request_ctx.get()`. ContextVars propagate through `dspy.ReAct`'s synchronous tool dispatch — verified safe in the current async-iterator integration.

**Guardrail constants** (live in this file, not the prompt):

- `_SCOPE_QUESTIONS` — 4 entries: `scope_level` (select), `sp_folder_id` (text), `session_id` (text), `row_limit` (number). The `sp_folder_id` and `session_id` fields are conditionally visible (`scope_level == 'filiale'`); the prompt-side hint is added in `main._serialize_questions`.
- `_TEMPORAL_QUESTIONS` — 2 entries: `period_type` (select calendar/fiscal), `period_year` (number, conditional on `period_type` having a value).
- `_HIGH_CONFIDENCE_THRESHOLD = 0.85` — when LLM confidence ≥ this and stripping would empty `suggestedTables`/`suggestedFunctions`/`predictiveFunctions`, the strip is skipped (catalog may be incomplete).

### 1.3 Signatures — `src/signatures/`

| Path | Class | Output |
|---|---|---|
| `controller_agent/controller_agent_signature.py` | `ControllerAgentSignature` | `result: ControllerDecisionResult` (pydantic). |
| `controller_agent/controller_agent_signature.py` | `ControllerDecisionResult` | Typed payload: `decision`, `confidence`, `message`, `rewrittenPrompt`, `suggestedTables/Functions`, `requiredColumns`, `predictiveFunctions`, `questions`, `queryClassification`, `coherenceNote`, `needsParams`, `guardrailSource`. |
| `controller_agent/controller_agent_prompt.md` | — | ReAct developer prompt (loaded via `prompt_utils.load_controller_agent_developer_prompt`). |
| `query_analysis/` | `QueryAnalysisSignature` | Combined classification + columns + functions + coherence in one LM call. |
| `rephrase_query/` | `RephraseQuerySignature` | Rewrites SQL Function / Predictive SQL / General Information prompts for Genie. |
| `genui_spec/` | `GenUiSpecSignature` | Emits a JSONL stream of RFC-6902 JSON Patches (`/elements/<id>`, `/root`, `/state/<id>`). |
| `reasoning_summary/` | `ReasoningSummarySignature` | Used internally by spec generator. |

**Deleted in this branch** — `controller_decision/`, `controller_correction/`, `controller_self_reflection/` (the DSPy Reflexion pipeline was replaced by ReAct).

### 1.4 Endpoints

#### `POST /chat/stream` — controller decision (SSE)

**Request body**: `ControllerRequest { source_text, catalog_info?, conversation_context? }`.

**Response**: `text/event-stream`. Events emitted:
- `event: status` — `{"message": "Vérification du périmètre…"}` from `ControllerStatusProvider.tool_start_status_message` (mapped via `_TOOL_STATUS_FR`).
- `event: reasoning_token` — `{"chunk": "..."}` from `react.extract.reasoning` field.
- `event: controller_decision` — final `{"role": "controller", "data": ControllerResponse}`.
- `event: error` — non-recoverable LM/network failure.

**Implementation**: async generator using FastAPI's native `AsyncIterable[str]` pattern. Iterates `stream_controller(...)`, dispatches `StatusMessage` / `StreamResponse` / `dspy.Prediction` chunks. Honours `http_request.is_disconnected()` to short-circuit on client cancel.

#### `POST /spec/generate` — canvas spec patches (JSONL)

**Request body**: `SpecRequest { prompt, product?, genie_result?, questions? }`.

**Response**: `text/plain` JSONL — one JSON Patch per line, terminated by an empty line. Errors emit `{"error": "..."}` on a single line.

**Prompt assembly** (`_build_spec_prompt`):
- If `questions` present → form-generation mode. `_serialize_questions` lists every question with id, type, options, bounds, and visibility hints. Visibility hints fire for `sp_folder_id`, `session_id` (`scope_level == 'filiale'`) and `period_year` (`period_type` set).
- `_PRODUCT_CONTEXT[product]` (geo / closing) is appended for product-aware output.
- `_extract_column_metadata(genie_result)` injects a `## Column Metadata` markdown table so the LLM picks correct numeric vs categorical chart props.

#### `GET /suggestions?app_type=geo|closing`

Returns `{ suggestions: string[] }`. Defaults from `DEFAULT_SUGGESTIONS_GEO` / `DEFAULT_SUGGESTIONS_CLOSING`. Per-product override env vars: `SUGGESTIONS_GEO`, `SUGGESTIONS_CLOSING` (JSON arrays, validated).

### 1.5 Status providers

| Class | Implements | Behaviour |
|---|---|---|
| `ControllerStatusProvider` | `tool_start_status_message`, `lm_start_status_message` | Per-tool French status from `_TOOL_STATUS_FR`; `"Raisonnement en cours…"` for inner LM calls. `tool_end` and `lm_end` are silent. |
| `SpecStatusProvider` | `lm_start_status_message`, `lm_end_status_message` | `"Génération du rapport…"` / silent. |

### 1.6 Critical invariants

1. Tools are **module-level functions** so `dspy.streamify` can pickle the agent.
2. Catalog is read via `_request_ctx.get()` inside tools — never as a closure capture.
3. `stream_controller` listener targets `react.extract` (not `react.react`) — the per-iteration noisy predictor would flood the UI.
4. When `clarify` is returned, `questions` MUST NOT be empty unless the Fallback case (mandated in `controller_agent_prompt.md`).
5. `validate_catalog_names` MUST be called before `finish` (mandated in Step 7 of the prompt).

---

## Layer 2 — Node.js (`server/`, `plugins/`)

Express app powered by `@databricks/appkit`. Acts as a streaming proxy between the React client and the Python service, while owning the controller-approval cookie lifecycle.

### 2.1 Server bootstrap — `server/server.ts`

```ts
createApp({
  plugins: [
    server({ autoStart: false }),
    controllerAiAgent(),
    genie(Object.keys(genieSpaces).length > 0 ? { spaces: genieSpaces } : {}),
  ],
})
```

**Multi-space Genie registration**:

```ts
const genieSpaces: Record<string, string> = {};
if (process.env.DATABRICKS_GENIE_SPACE_ID_GEO)     genieSpaces.geo     = process.env.DATABRICKS_GENIE_SPACE_ID_GEO;
if (process.env.DATABRICKS_GENIE_SPACE_ID_CLOSING) genieSpaces.closing = process.env.DATABRICKS_GENIE_SPACE_ID_CLOSING;
```

Only spaces whose env var is set are registered — AppKit rejects undefined IDs.

### 2.2 Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/controller` | POST | Streaming proxy for Python `/chat/stream` (see 2.3). |
| `/api/chat/stream` | POST | Unified Genie chat. Requires controller approval cookie. |
| `/api/spec-stream` | POST | Streams Python `/spec/generate` JSONL chunks back. |
| `/api/suggestions` | GET | Forwards to Python `/suggestions?app_type=...`. |
| `/api/chat-controller/:alias/messages` | POST | Legacy per-alias Genie endpoint (kept for compatibility). |
| `/api/chat-controller/:alias/conversations/:conversationId` | GET | Conversation lookup. |

### 2.3 Controller plugin — `plugins/controller-ai-agent/controller-ai-agent.ts`

The plugin is the most subtle part of this layer. It:

1. **Pre-issues** an approval token with `approvedPrompt: '__pending__'` so the `Set-Cookie` header rides the initial response.
2. Sets SSE response headers (`text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`) and calls `res.flushHeaders()`.
3. Opens a streaming POST to Python `/chat/stream`.
4. Iterates the upstream `ReadableStreamDefaultReader<Uint8Array>`:
   - Forwards `status`, `reasoning_token` events **verbatim** to the client.
   - For `controller_decision`: parses the payload, computes `canSendDirectly = isApproved(decision, confidence) || decision === 'guide'`, then either `updateControllerApproval(token, { approvedPrompt: rewrittenPrompt })` or `invalidateControllerApproval(token)`. The re-emitted event includes the computed `canSendDirectly` flag.
5. Aborts the upstream reader on `req.on('close')`.
6. In `finally`, invalidates the token if `controller_decision` was never seen.

**Helpers**:
- `splitSseEvents(buffer)` — splits SSE chunks on `\n\n`, returns `{ events, rest }` so partial trailing events are preserved across chunks.
- `extractControllerDecision(ev)` — unwraps the `{ role: 'controller', data: ... }` envelope.
- `coerceControllerResponse(raw, fallbackPrompt, canSendDirectly)` — defensive type coercion at the boundary.

### 2.4 Approval store — `server/controller-approval-store.ts`

In-memory single-use token store. Public API:

| Function | Use |
|---|---|
| `issueControllerApproval({ approvedPrompt, traceId? })` | Mints a token and stores `{ token, approvedPrompt: normalized, expiresAt }`. |
| `updateControllerApproval(token, { approvedPrompt })` | Rewrites the approved prompt of an existing token (stream-finalisation path). Returns `false` if expired. |
| `invalidateControllerApproval(token)` | Hard-deletes a token immediately. |
| `consumeControllerApproval({ token, content })` | Single-use validator for `/api/chat/stream`. Returns `{ ok: true }` or `{ ok: false, reason }`. |
| `setControllerApprovalCookie(res, token)` / `clearControllerApprovalCookie(res)` | `httpOnly` `SameSite=Strict` cookie helpers. |
| `parseCookieValue(cookieHeader, name)` | Extracts the cookie value from the request header. |

**TTL & sweep**: every public call invokes `sweepExpiredApprovals(now)` first, so expired tokens are purged opportunistically.

### 2.5 `/api/chat/stream` — guarded Genie proxy

Body: `{ content, appType: 'geo' | 'closing', conversationId? }`.

Pre-flight:
1. Validates `appType` is exactly `'geo'` or `'closing'`.
2. Reads the approval cookie via `parseCookieValue`. Missing cookie → 403.
3. Calls `consumeControllerApproval({ token, content })`. The token is single-use — even on success the cookie is cleared with `clearControllerApprovalCookie(res)`.
4. On approval success: opens an SSE stream and pipes `appKit.genie.asUser(req).sendMessage(appType, content, conversationId)` through `writeSseEventSafe`.

### 2.6 Critical invariants

1. The approval cookie is **single-use**. The plugin never re-uses tokens; the client must call `/api/controller` again to get a fresh one.
2. The pre-issued `__pending__` token is invalidated in `finally` if `controller_decision` was never observed — preventing a stale cookie from authorising a Genie call against an unfinished decision.
3. `updateControllerApproval` returns `false` on expired tokens; `consumeControllerApproval` will then reject because `'__pending__' !== normalizePrompt(content)`.
4. `genieSpaces` registration is conditional — production deployments must set both `DATABRICKS_GENIE_SPACE_ID_GEO` and `..._CLOSING`. Missing env vars silently skip the alias.

---

## Layer 3 — React (`client/src/`)

Two-route Mantine UI driven by a single orchestrator hook. The canvas is rendered exclusively by `@json-render/react`.

### 3.1 Routing — `App.tsx`

```tsx
<Routes>
  <Route path="/"        element={<LandingPage />} />
  <Route path="/geo"     element={<ProductPage product="geo" />} />
  <Route path="/closing" element={<ProductPage product="closing" />} />
  <Route path="*"        element={<Navigate to="/" replace />} />
</Routes>
```

`LicenseManagerAgCharts` and `LicenseManagerAgGrid` are configured at import time before any route renders.

### 3.2 Pages

- **`LandingPage.tsx`** — product tiles + folder examples table. Static, no network calls.
- **`ProductPage.tsx`** — two-column layout: `<ConversationPanel>` (left, fixed 520px) + `<OutputCanvas>` (right, flex). Owns the `useProductAssistant(product)` hook and propagates its surface to both panels.

### 3.3 Orchestrator hook — `hooks/useProductAssistant.ts`

The single source of truth for assistant state. ~560 lines, no transitive effects beyond the network calls and `useUIStream` integration.

**State**:

| State | Purpose |
|---|---|
| `messages: AssistantMessage[]` | Chat transcript (user / agent / Q-R summary cards). |
| `specsHistory: Record<string, GenericUiSpec>` | Completed specs keyed by id; the canvas resolves visible spec from this map. |
| `displayedSpecId: string \| null` | Which historical spec is currently shown. |
| `clarificationSpec: GenericUiSpec \| null` | Streamed/fallback FormPanel for the canvas. |
| `clarificationQuestions: ControllerQuestion[]` | Normalized question list for fallback rendering and submit payload. |
| `selectedFolder: SelectedFolder \| null` | The active `{ spFolderId, sessionId }` context. Mirrored in `selectedFolderRef` for stale-closure-free async access. |
| `controllerInfo` | Decision badge + confidence shown while streaming. |
| `statusText`, `reasoningText` | Live SSE status + token accumulation. |
| `stage: 'idle' \| 'running' \| 'spec'` | Coarse-grained phase used by the entry guard. |
| `hasError: boolean` | Toggles `<ErrorState>` in the canvas. |

**Folder guard** (input requirement before any analysis):

```ts
if (
  !trimmed ||
  stage !== 'idle' ||
  !folder ||
  !folder.spFolderId.trim() ||
  !folder.sessionId.trim()
) {
  return
}
```

The guard is duplicated **before** the Genie call (`folderNow = selectedFolderRef.current`) to catch a race where the user clears the folder while the controller stream is in flight. Both checks emit the user-visible message: *"Contexte de dossier manquant (sp_folder_id et session_id requis). Sélectionnez un dossier et réessayez."*

**Three-phase `send(promptText, displayText?)`**:

1. **Phase 1 — Controller**: POST `/api/controller` with `{ prompt, conversationContext: { sp_folder_id, session_id } }` — both keys in snake_case match the Python `_SCOPE_QUESTIONS` ids. SSE iteration via `readSseStream(reader)`. Updates `controllerInfo`, accumulates `reasoningText`, captures the final `controller_decision` payload.

   - If `!canSendDirectly || isGuide`: render the clarification — `normalizeClarificationQuestions(...)` + `buildClarificationSpec(questions, message, title)` → `setClarificationSpec`. Title is `'Paramètres optionnels'` (guide w/ questions), `'Requête optimisée'` (guide w/o questions), or `'Précision requise'` (clarify).

2. **Phase 2 — Genie**: re-checks the folder, then POST `/api/chat/stream` with `{ content: rewrittenPrompt, appType: product }`. Iterates SSE for `query_result` events, throws on `error`.

3. **Phase 3 — Spec**: `uiStream.send(rewrittenPrompt, { product, genieResult })`. The `useUIStream` `onComplete` callback runs `validateChartSpec`, mints a `specId`, appends `{ ...agentMsg('Analyse terminée. Canvas mis à jour.'), specId }` and switches the canvas.

**`displayText` sentinel** — `null` suppresses the user bubble (used by `submitClarification` so the original query stays in history without duplication); `string` overrides the bubble text; `undefined` uses `trimmed`.

**`submitClarification(answers)`** — builds Q/R pairs, emits a structured agent bubble with `metadata: { type: 'qr_summary', pairs }` for `<QRSummaryCard>`, then re-runs `send(enriched, null)`.

**Internal helpers**:

- `readSseStream(reader)` — async generator yielding `{ event, data }` objects. Splits on `\n\n`, drops empty `data:` records, releases the lock in `finally`.
- `normalizeClarificationQuestions(questions)` — dedup by `id`, merge stricter flags (`required` OR-merged, first non-null wins for type/placeholder/options/bounds).
- `buildClarificationSpec(questions, message, title)` — deterministic FormPanel spec used as a fallback when the LLM-streamed spec fails. Stores `_message` and `_guide` flags for `OutputCanvas.ClarificationState` to read.

### 3.4 `ConversationPanel.tsx`

Three vertical sections: header, scrollable transcript / folder picker / empty-state, input. Sub-components:

- `FolderPicker` — required two-input form (`spFolderId` + `sessionId`) with `canConfirm = folderId.trim() !== '' && sessionId.trim() !== ''`. Below: a quick-select table of `FOLDER_EXAMPLES` rows (clicking a row populates the inputs but does NOT auto-confirm).
- `EmptyState` — best-practice tips + clickable suggestion list.
- `Message` — handles both text bubbles and `QRSummaryCard` rendering. Casts `m.metadata` via a local `_Meta` type to bypass an ESLint stale-type false positive.
- Streaming indicator — combined badge (decision + confidence) + reasoning token panel, both visible only while `busy` is true.

### 3.5 `OutputCanvas.tsx`

State machine: `EmptyState | LoadingState | ErrorState | LoadedState | ClarificationState`. Resolution priority:

```ts
hasError && !showLoaded   → ErrorState
showLoading               → LoadingState (skeleton)
showLoaded && spec        → LoadedState (Renderer + spec)
clarificationSpec         → ClarificationState (Renderer + spec, with submit form)
otherwise                 → EmptyState
```

**`ClarificationState`** is the most complex node:
- Reads `_guide` and `_message` off the spec via local cast.
- Seeds `specInitialAnswers` from `spec.state` so select/toggle defaults count toward validation (json-render does NOT fire `onStateChange` for `initialState`).
- Tracks `userOverrides` in React state; `answers = { ...specInitialAnswers, ...userOverrides }`.
- `missingRequired` is `false` for guide; for clarify it scans `questions.filter(required)` — with the `sp_folder_id`-specific carve-out (`only required when scope_level === 'filiale'`).
- `handleStateChange` filters incoming paths against `questionIds` (plus the fallback `'clarification'` field), unescapes RFC-6901 (`~1` → `/`, `~0` → `~`), and merges into `userOverrides`.

**`RenderErrorBoundary`** — class component wrapping `JSONUIProvider + Renderer` blocks with a `resetKey` so a render error doesn't permanently kill the canvas. Returns to healthy state when `resetKey` changes.

### 3.6 Registry — `client/src/registry/chat-ui-registry.tsx`

Catalog of components rendered by `<Renderer>`. Hard rules (already documented in `CLAUDE.md`):
1. **No hooks** in registry components — they are called as plain functions.
2. **No `memo()` wrappers**.
3. **No `React.lazy` / `Suspense`**.
4. **Module-level constants only** for shared values.
5. `useUIStream` lives only in `useProductAssistant.ts`.

### 3.7 Critical invariants

1. `selectedFolderRef.current` is the ground truth for folder context inside async flows; `selectedFolder` state is for rendering only.
2. `displayText === null` is the **only** way to suppress the user bubble — used exclusively by clarification re-runs.
3. Both `clearFolder` and `reset` call `abortRef.current?.abort()` before zeroing state.
4. `useUIStream`'s `onComplete` reads from `streamingSpecMessageIdRef.current` (not state) to avoid stale closures.
5. The folder guard exists at TWO sites: entry to `send()` AND immediately before the Genie call.

---

## Layer 4 — Shared (`shared/`)

### 4.1 `products.ts`

```ts
export type Product = 'geo' | 'closing'
export const PRODUCTS:           readonly Product[]
export const PRODUCT_LABELS:     Record<Product, string>          // → 'Geoficiency' | 'Closing'
export const PRODUCT_ROUTES:     Record<Product, string>          // → '/geo' | '/closing'
export const PRODUCT_GENIE_ALIAS: Record<Product, string>         // → 'geo' | 'closing'
export const PRODUCT_ACCENT:     Record<Product, 'teal' | 'closingPink'>
export function isProduct(v: unknown): v is Product
```

Used by both client (routing, theming) and server (Genie space alias matching). The single source of truth for product identifiers.

---

## Cross-Cutting — End-to-end flow

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  1. User confirms folder (FolderPicker)  →  selectedFolder = {spFolderId, sessionId}
│  2. User submits prompt                                                       │
│     ├── Entry guard: prompt + folder + stage idle  → if any missing, return.  │
│     ├── POST /api/controller {prompt, conversationContext: {sp_folder_id, session}}
│     │     │                                                                   │
│     │     │   ┌─────────────────── Node controller plugin ──────────────────┐ │
│     │     │   │ pre-issue token (__pending__) → Set-Cookie → flushHeaders   │ │
│     │     │   │ pipe upstream SSE → forward status/reasoning_token verbatim │ │
│     │     │   │ on controller_decision: compute canSendDirectly,            │ │
│     │     │   │   update or invalidate token, re-emit event with the flag   │ │
│     │     │   └─────────────────────────────────────────────────────────────┘ │
│     │     ▼                                                                   │
│     │   Python /chat/stream → ReAct loop: scope → temporal → classify →      │
│     │     rewrite → lookup → validate → finish                               │
│     │                                                                         │
│     ├── If clarify or guide: render clarification, stop.                      │
│     ├── Pre-Genie folder re-check (race-safe): if folder cleared, abort.     │
│     ├── POST /api/chat/stream {content: rewrittenPrompt, appType}             │
│     │     │   Node consumes the cookie (single-use) → Genie space alias     │
│     │     │   → SSE pipe: query_result → genieResult                         │
│     ▼     ▼                                                                   │
│  3. uiStream.send(rewrittenPrompt, {product, genieResult})                   │
│     POST /api/spec-stream → Python /spec/generate (JSONL patches)            │
│     useUIStream assembles patches → onComplete → validateChartSpec →         │
│     specsHistory[id] = validated → canvas updates                             │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Approval cookie lifecycle

```
issue (__pending__)        ←── POST /api/controller
        │
        ├── controller_decision arrives:
        │      ├─ approved   → updateControllerApproval(token, {approvedPrompt: rewrittenPrompt})
        │      └─ otherwise  → invalidateControllerApproval(token)
        │
        ├── upstream errors / disconnect: invalidate (finally)
        │
        └── client calls POST /api/chat/stream with cookie:
               ├─ consumeControllerApproval validates prompt match
               ├─ token deleted from store on consume
               └─ cookie cleared from response
```

### SSE protocol contract

| Source | Event | Payload |
|---|---|---|
| Python `/chat/stream` | `status` | `{"message": "..."}` |
| Python `/chat/stream` | `reasoning_token` | `{"chunk": "..."}` |
| Python `/chat/stream` | `controller_decision` | `{"role": "controller", "data": ControllerResponse}` |
| Python `/chat/stream` | `error` | `{"error": "..."}` |
| Node `/api/controller` | (forwards) + injects `canSendDirectly` into `controller_decision.data` |
| Node `/api/chat/stream` | (Genie events forwarded as `event: <type>`) |

### Tests

| File | Coverage |
|---|---|
| `client/src/test/folderGuard.test.ts` | Entry guard + pre-Genie re-check (17 cases). |
| `client/src/test/buildClarificationSpec.test.ts` | Inline mirror of `buildClarificationSpec`: root, FormPanel variant, `_guide`, `_message`, fallback field, per-question rendering (23 cases). |
| `client/src/test/submitClarification.test.ts` | `buildEnrichedPrompt` + `buildQRSummary` (11 cases). |
| `client/src/test/FolderPicker.test.tsx` | Mantine UI tests for the folder picker (14 cases). |
| `client/src/test/OutputCanvas.test.tsx` | State machine coverage (23 cases). |
| `client/src/lib/__tests__/genie-utils.test.ts` | `specIsValid` + `validateChartSpec` (8 cases). |
| `tests/smoke.spec.ts` | Playwright smoke against the new landing page (`Analyse IA pour Closing/Géo`, `Ouvrir le prototype`, `Cas de tests`). |

Run with `npx vitest run`. Current count: **96 unit tests passing**.

---

## Operational notes

### Required environment variables (production)

| Var | Layer | Purpose |
|---|---|---|
| `DATABRICKS_GENIE_SPACE_ID_GEO` | Node | Geoficiency Genie space ID. |
| `DATABRICKS_GENIE_SPACE_ID_CLOSING` | Node | Closing Genie space ID. |
| `SEMANTIC_LAYER_API_URL` | Node | Python service base URL (default `http://localhost:8001/api`). |
| `AGGRID_LICENSE_KEY` | Node→Client (exposed via `/config`) | AG Grid / AG Charts Enterprise license. |
| `AZURE_API_BASE`, `AZURE_API_KEY` | Python | DSPy LM credentials. |
| `MLFLOW_TRACKING_URI` | Python | Set to `databricks` for tracing. |
| `CORS_ALLOWED_ORIGINS` | Python | Comma-separated list (defaults to `*` with warning). |
| `DSPY_BATCH_NUM_THREADS` | Python | Default 8. |
| `SUGGESTIONS_GEO`, `SUGGESTIONS_CLOSING` | Python (optional) | JSON array overrides for default suggestions. |

### Removed in this branch (do not re-add)

- `ENABLE_CONTROLLER_REFLECTION` env var — Reflexion pipeline was deleted.
- `controller_decision/`, `controller_correction/`, `controller_self_reflection/` signature directories.
- `client/src/components/ai-chat-drawer.tsx` and the entire ui/* shadcn surface.
- `ControllerStreamEvent` type from `client/src/types/chat.ts`.
- The `questionLabel` helper from `useProductAssistant.ts`.
- `parseControllerDecisionFromSse` (replaced by `splitSseEvents` + `extractControllerDecision`).
- `shared/normalize-spec.ts` and `/api/spec` endpoint.
