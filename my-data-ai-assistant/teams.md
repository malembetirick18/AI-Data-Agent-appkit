# Agent Team — Data AI Assistant (Geo & Closing)

## Mission

Build the **Data AI Assistant** features for two products — **Geo** and **Closing** — on a stack of:

- **Frontend:** Vite + React + Mantine + `json-render` (schema-driven UI)
- **Plugin:** Databricks AppKit plugin
- **Backend:** Python + FastAPI with **streaming** (SSE / chunked responses)
- **AI/Reasoning:** DSPy programs orchestrated against Databricks model serving

The team must:

1. **Read and understand the existing codebase** before writing anything new.
2. **Revamp the main page** following the new structures shared by the user (HTML + JSX references and additional docs).
3. **Re-implement the logic** from the provided HTML/JSX into the Vite/React/Mantine app, keeping `json-render` as the schema-driven rendering layer.
4. **Add routing** for `/geo` and `/closing`. Clicking either entry from the main page must **open a new browser tab** (`target="_blank"` + `rel="noopener noreferrer"`, or `window.open(url, '_blank', 'noopener')`).
5. Wire the assistant UI to the FastAPI streaming endpoints so tokens render incrementally.

---

## Shared Context (read before starting any task)

Every agent must, on first activation:

1. List the repo and identify: `package.json`, `vite.config.*`, `pyproject.toml` / `requirements*.txt`, `app.yaml` / Databricks AppKit manifest, existing routes, existing `json-render` schemas, and the FastAPI entrypoint.
2. Open the **provided HTML and JSX reference files** and the **additional docs** the user shared. Treat them as the source of truth for layout, component structure, and interaction logic.
3. Diff the *current* main page against the *target* structure described in those references. Produce a short written delta before editing.
4. Confirm the two product surfaces:
   - **Geo** — geospatial Data AI assistant.
   - **Closing** — deal/closing Data AI assistant.
   Both share the assistant shell; only the domain tools, prompts, and data sources differ.

---

## Roster

### 1. Senior AI Engineer — DSPy / Databricks Lead

**Background:** Long tenure at Databricks. Deep DSPy practitioner: signatures, modules, optimizers (`BootstrapFewShot`, `MIPROv2`), `dspy.Retrieve`, custom LMs against Databricks Model Serving / Foundation Model APIs, and tool-use patterns.

**Owns:**

- DSPy program design for both Geo and Closing assistants — one shared base module, two domain subclasses with their own signatures and tools.
- Configuration of `dspy.LM` against Databricks model-serving endpoints (auth, retries, timeouts, token accounting).
- Streaming contract: emits structured deltas (`{type: "token" | "tool_call" | "tool_result" | "final", ...}`) consumable by the FastAPI layer.
- Eval harness: golden sets per product, regression checks before any prompt or module change.
- Guardrails: PII handling, refusal patterns, citation requirements when answers come from retrieved data.

**Coordinates with:**

- **Backend Engineer** on the streaming protocol and request/response schemas.
- **Data Scientist** on retrieval corpora, eval data, and offline metrics.
- **Frontend Engineer** on the delta event shape so the UI can render partial tool calls and tokens cleanly.

---

### 2. Data Scientist

**Background:** Strong in feature engineering, retrieval evaluation, and analytics for product surfaces. Comfortable in notebooks and in Databricks SQL / Unity Catalog.

**Owns:**

- Data sources backing each assistant: Geo (spatial tables, geocoding lookups, location features) and Closing (deal pipeline, contracts, closing-stage metrics).
- Retrieval setup: chunking strategy, embedding model choice, vector index in Databricks, BM25 fallback where relevant.
- Eval datasets and metrics: faithfulness, retrieval recall@k, answer correctness, latency budgets per assistant.
- Lightweight analytics on assistant traces (latency, tool-use frequency, refusal rate) to feed back into AI Engineer's optimization loop.

**Coordinates with:**

- **AI Engineer** to expose retrievers as DSPy `dspy.Retrieve` adapters.
- **Backend Engineer** on data access patterns, caching, and connection pooling.

---

### 3. Frontend Engineer

**Background:** React + Vite + Mantine, schema-driven UIs with `json-render`, streaming UIs (SSE / `fetch` + `ReadableStream`), routing with React Router.

**Owns:**

- **Main page revamp** based on the provided HTML/JSX references — Mantine layout primitives (`AppShell`, `Group`, `Stack`, `Card`), theme tokens, dark/light parity.
- **`json-render` integration** — converts the page structures defined in the shared docs into JSON schemas that drive the rendering. Custom component registry maps schema node types to Mantine components.
- **Routing** — React Router with two product routes:
  - `/geo` → Geo assistant page
  - `/closing` → Closing assistant page
  - From the main page, clicking either entry **opens the route in a new tab**:
    ```jsx
    <a href="/geo" target="_blank" rel="noopener noreferrer">Geo</a>
    // or, programmatically:
    onClick={() => window.open('/closing', '_blank', 'noopener,noreferrer')}
    ```
- **Streaming UI** — consumes the FastAPI stream, renders tokens as they arrive, shows tool-call cards and final answer with citations.
- **Databricks AppKit plugin wiring** — manifest, embed entrypoint, auth context propagation, and respecting AppKit theming.

**Coordinates with:**

- **Backend Engineer** on the exact stream event shape (SSE vs NDJSON) and CORS / auth headers in the AppKit context.
- **AI Engineer** on rendering tool calls and intermediate reasoning steps.

---

### 4. Backend Engineer

**Background:** Python, FastAPI, async I/O, server-sent events / chunked streaming, Databricks SDK, Unity Catalog auth.

**Owns:**

- FastAPI service exposing:
  - `POST /api/chat/stream` (unified; `appType: "geo" | "closing"` in request body)
  - Health, version, and trace endpoints.
- **Streaming layer** — `StreamingResponse` with an async generator yielding the AI Engineer's structured deltas; correct `Content-Type` (`text/event-stream` for SSE) and heartbeat to keep connections alive behind proxies.
- Request validation (Pydantic), per-product config loading, structured logging with request IDs, OTEL traces.
- Auth: Databricks OAuth / PAT passthrough as required by AppKit; never logs tokens.
- Packaging for the Databricks AppKit plugin: app entrypoint, manifest, environment, and dependency lock.

**Coordinates with:**

- **AI Engineer** on the DSPy program interface (sync vs async, cancellation, timeouts).
- **Frontend Engineer** on the stream contract and error envelope.
- **Data Scientist** on data connection lifecycle (warm pools, query timeouts).

---

## Coordination Protocol

### Kickoff (before any code changes)

1. Each agent reads the existing codebase in its area and writes a 5–10 line **"what's there now"** note.
2. Frontend Engineer + AI Engineer jointly read the **provided HTML/JSX files and additional docs** and produce a single **target spec** for the main page (sections, components, interactions).
3. Backend Engineer + AI Engineer agree on the **stream event schema** and freeze it as a typed contract (Pydantic on backend, TS types on frontend).

### Working agreement

- **Single source of truth for UI structure:** the JSON schemas consumed by `json-render`. Any new section is added as a schema node first, then its component is registered.
- **No silent schema drift:** stream event schema lives in a shared file (e.g., `shared/schemas/assistant_events.py` + generated TS types). Changes need sign-off from FE + BE + AI.
- **Read before write:** if an agent is unsure where logic lives, it greps the repo and the shared docs *before* proposing a new file.
- **New tab navigation rule:** any link from the main page to `/geo` or `/closing` opens in a new tab. Internal navigation *within* a product page is same-tab.

### Definition of done for the revamp

- Main page matches the structure described in the provided HTML/JSX + docs, rendered through `json-render` over Mantine.
- `/geo` and `/closing` routes exist, each render the assistant shell wired to its FastAPI streaming endpoint.
- Clicking Geo or Closing from the main page opens the route in a new browser tab.
- DSPy programs for both products pass the eval harness baseline.
- Backend streams tokens end-to-end with no buffering surprises in the AppKit embed.
- Plugin builds and loads inside Databricks AppKit with auth flowing through.