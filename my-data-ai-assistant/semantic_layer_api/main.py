"""Semantic Layer API — FastAPI + DSPy streaming refactor.

Refactored based on:
  • https://fastapi.tiangolo.com/advanced/stream-data/
  • https://github.com/stanfordnlp/dspy/blob/main/docs/docs/tutorials/streaming/index.md

Key changes
───────────
1. Endpoints use `response_class=StreamingResponse` with `yield` directly
   from the path-operation function (FastAPI ≥ 0.134 pattern) instead of
   manually constructing StreamingResponse with an inner generator.
2. DSPy streaming uses typed chunk dispatch (`StreamResponse`, `Prediction`,
   `StatusMessage`) instead of raw string buffering.
3. A `StatusMessageProvider` gives real-time observability into LM calls.
4. The controller endpoint is also streamified for consistency, so it can
   emit status messages while the LM is thinking.
"""
from __future__ import annotations

import json
import os
from collections.abc import AsyncIterable

import dspy
import mlflow
from dspy.streaming import StatusMessage, StreamListener, StreamResponse
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from src.logger import Logger
from src.modules.controller_decision import ControllerDecision
from src.modules.genui_spec_generator import GenUiSpecGenerator


# ── Request / Response models ─────────────────────────────────────────────────

class ControllerResponse(BaseModel):
    decision: str
    confidence: float
    message: str
    rewrittenPrompt: str | None = None
    suggestedTables: list[str] = []
    suggestedFunctions: list[str] = []
    requiredColumns: list[str] = []
    predictiveFunctions: list[str] = []
    questions: list[dict] = []
    queryClassification: str | None = None
    coherenceNote: str = ""
    needsParams: bool = False
    reasoning: str = ""
    guardrailSource: str | None = None


class ControllerRequest(BaseModel):
    source_text: str
    catalog_info: str = ""
    conversation_context: dict | None = None


class SpecRequest(BaseModel):
    prompt: str
    genie_result: dict | None = None
    questions: list[dict] | None = None  # ControllerQuestion[] from client (for clarification specs)


# ── Helpers ───────────────────────────────────────────────────────────────────

_INPUT_TYPE_LABELS = {
    "select": "select (single-choice dropdown)",
    "number": "number (numeric input)",
    "toggle": "boolean toggle (true/false)",
    "text": "text input",
}


def _serialize_questions(questions: list[dict]) -> str:
    """Format a ControllerQuestion[] list as a structured prompt section."""
    lines = [
        "Generate a FormPanel spec with one input per question listed below.",
        "CRITICAL RULES:",
        "  • Use the question id VERBATIM as the top-level $bindState path: id='foo' → \"$bindState\": \"/foo\"",
        "  • NEVER nest state under a parent key (e.g. /analysis/foo is FORBIDDEN — use /foo directly)",
        "  • NEVER rename or merge question ids",
        "  • Add a /state/<id> patch for every question with its default value (use first option value for select, \"\" for text, 0 for number, false for toggle)",
        "",
        "Questions:",
    ]
    for i, q in enumerate(questions, 1):
        if not isinstance(q, dict):
            continue
        q_id = q.get("id", "")
        q_label = q.get("label", "")
        q_type = _INPUT_TYPE_LABELS.get(q.get("inputType", "text"), "text input")
        q_required = " (required)" if q.get("required") else " (optional)"
        parts = [f"{i}. [id={q_id}, type={q_type}, $bindState=/{q_id}] {q_label}{q_required}"]
        raw_options = q.get("options")
        if isinstance(raw_options, list) and raw_options:
            opts = ", ".join(
                o.get("label", o.get("value", "")) for o in raw_options if isinstance(o, dict)
            )
            if opts:
                parts.append(f"   options: {opts}")
        if q.get("min") is not None or q.get("max") is not None:
            bounds = f"   bounds: min={q.get('min', 'none')} max={q.get('max', 'none')}"
            if q.get("step") is not None:
                bounds += f" step={q['step']}"
            parts.append(bounds)
        if q_id == "sp_folder_id":
            parts.append("   visibility: only show when scope_level = 'filiale'")
        if q_id == "period_year":
            parts.append("   visibility: only show when period_type has a value")
        lines.extend(parts)
    return "\n".join(lines)


_NUMERIC_TYPES = frozenset({
    "INT", "INTEGER", "BIGINT", "LONG", "SHORT", "TINYINT",
    "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC", "NUMBER",
})


def _is_numeric_type(type_name: str) -> bool:
    upper = (type_name or "STRING").upper()
    return upper in _NUMERIC_TYPES or upper.startswith("DECIMAL")


def _extract_column_metadata(genie_result: dict | list | str | None) -> str:
    """Extract a markdown table of column names and types from a Genie result payload.

    Walks queryResults → values → manifest.schema.columns to surface column metadata
    that is otherwise buried in the raw JSON blob.  Returns an empty string when no
    column information can be found (e.g. clarification-only requests).
    """
    if not isinstance(genie_result, dict):
        return ""

    # The client sends { queryResults: { [queryId]: GenieStatementResponse } }
    query_results = genie_result.get("queryResults")
    if not isinstance(query_results, dict):
        return ""

    columns: list[tuple[str, str, bool]] = []  # (name, type, is_numeric)
    for statement in query_results.values():
        if not isinstance(statement, dict):
            continue
        manifest = statement.get("manifest")
        if not isinstance(manifest, dict):
            continue
        schema = manifest.get("schema")
        if not isinstance(schema, dict):
            continue
        for col in schema.get("columns", []):
            if not isinstance(col, dict):
                continue
            name = col.get("name", "")
            type_name = col.get("type_name", "STRING")
            if name:
                columns.append((name, type_name, _is_numeric_type(type_name)))
        if columns:
            break  # use first statement with columns

    if not columns:
        return ""

    lines = [
        "## Column Metadata",
        "IMPORTANT: When generating chart specs, only assign numeric columns (Numeric? = Yes) "
        "to yKey, series[].yKey, angleKey, radiusKey, sizeKey. "
        "Use string/date columns for xKey, labelKey.",
        "",
        "| Column | Type | Numeric? |",
        "|--------|------|----------|",
    ]
    for name, type_name, is_num in columns:
        lines.append(f"| {name} | {type_name} | {'Yes' if is_num else 'No'} |")
    return "\n".join(lines)


def _build_spec_prompt(request: SpecRequest) -> str:
    """Combine prompt text with optional Genie result data and/or clarification questions.

    When questions are present the form instruction leads the prompt so the LLM treats
    the task as 'build a FormPanel' rather than 'display this message as text'.
    """
    if request.questions:
        # Lead with the explicit form-generation instruction so it anchors the task.
        # The context message follows as supplementary information only.
        parts = [_serialize_questions(request.questions)]
        parts.append(f"Context (do NOT render as TextContent — render only the FormPanel above): {request.prompt}")
        if request.genie_result:
            try:
                genie_data = json.dumps(request.genie_result)
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=400,
                    detail="genie_result contains non-serializable data",
                ) from exc
            parts.append(f"Data:\n{genie_data}")
        return "\n\n".join(parts)

    # No questions — standard data-viz spec generation
    parts = [request.prompt]
    if request.genie_result:
        # Surface column metadata so the LLM knows which columns are numeric
        col_meta = _extract_column_metadata(request.genie_result)
        if col_meta:
            parts.append(col_meta)
        try:
            genie_data = json.dumps(request.genie_result)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400,
                detail="genie_result contains non-serializable data",
            ) from exc
        parts.append(f"Data:\n{genie_data}")
    return "\n\n".join(parts)


def _prediction_to_controller_response(result: dspy.Prediction) -> ControllerResponse:
    """Map a DSPy Prediction to the typed API response."""
    return ControllerResponse(
        decision=result.get("decision", "error"),
        confidence=float(result.get("confidence", 0.0)),
        message=result.get("message", ""),
        rewrittenPrompt=result.get("rewrittenPrompt"),
        suggestedTables=result.get("suggestedTables", []),
        suggestedFunctions=result.get("suggestedFunctions", []),
        requiredColumns=result.get("requiredColumns", []),
        predictiveFunctions=result.get("predictiveFunctions", []),
        questions=result.get("questions", []),
        queryClassification=result.get("queryClassification"),
        coherenceNote=result.get("coherenceNote", ""),
        needsParams=bool(result.get("needsParams", False)),
        guardrailSource=result.get("guardrailSource"),
    )


# ── Status message providers (DSPy streaming observability) ───────────────────

class ControllerStatusProvider(dspy.streaming.StatusMessageProvider):
    """Emits human-readable status updates while the controller LM runs."""

    def lm_start_status_message(self, instance, inputs):
        return "Analyzing query against catalog…"

    def lm_end_status_message(self, outputs):
        return "Controller decision ready."


class SpecStatusProvider(dspy.streaming.StatusMessageProvider):
    """Emits status updates while the GenUI spec LM runs."""

    def lm_start_status_message(self, instance, inputs):
        return "Generating UI spec…"

    def lm_end_status_message(self, outputs):
        return "Spec generation complete."


# ── Bootstrap ─────────────────────────────────────────────────────────────────

load_dotenv(override=True)

logger = Logger()

catalog_path = os.path.join(
    os.path.dirname(__file__), "catalogs", "genie_knowledge_store.json"
)
with open(catalog_path, "r", encoding="utf-8") as f:
    genie_knowledge_store = json.load(f)
default_catalog_info = json.dumps(genie_knowledge_store)

log_traces = os.getenv("MLFLOW_LOG_TRACES", "true") == "true"
silent = os.getenv("MLFLOW_SILENT", "true") == "true"

mlflow.dspy.autolog(log_traces=log_traces, silent=silent)
mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "databricks"))
mlflow.set_experiment(
    os.getenv("MLFLOW_SEMANTIC_LAYER_TRACING_EXPERIMENT", "semantic-layer-experiment")
)

AZURE_API_KEY = os.getenv("AZURE_API_KEY")
AZURE_API_BASE = os.getenv("AZURE_API_BASE")

if not AZURE_API_KEY:
    raise RuntimeError("Missing required environment variable: AZURE_API_KEY")
if not AZURE_API_BASE:
    raise RuntimeError("Missing required environment variable: AZURE_API_BASE")

lm = dspy.LM(
    model="azure/gpt-5.3-codex",
    api_key=AZURE_API_KEY,
    api_base=AZURE_API_BASE,
    api_version="2025-04-01-preview",
    model_type="responses",
    cache=True,
    num_retries=3,
    use_developer_role=True
)

dspy.configure(lm=lm, adapter=dspy.JSONAdapter(), track_usage=True)

controller_agent = ControllerDecision()
genui_spec_generator = GenUiSpecGenerator()

# Streamified versions with typed listeners
stream_controller = dspy.streamify(
    controller_agent,
    stream_listeners=[
        StreamListener(
            signature_field_name="reasoning",
            predict=controller_agent.controller_decision,
            predict_name="controller_decision",
        ),
    ],
    status_message_provider=ControllerStatusProvider(),
)

stream_spec = dspy.streamify(
    genui_spec_generator,
    stream_listeners=[
        StreamListener(signature_field_name="spec_patches"),
    ],
    status_message_provider=SpecStatusProvider(),
)

logger.info(
    "Semantic Layer API ready — model=%s catalog=%d chars",
    "azure/gpt-5.3-codex",
    len(default_catalog_info)
)


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(root_path="/api", title="Semantic layer API", version="0.1.0")

_cors_origins_raw = os.getenv("CORS_ALLOWED_ORIGINS", "")
_cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()] if _cors_origins_raw else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
if _cors_origins == ["*"]:
    logger.warning("CORS_ALLOWED_ORIGINS not set — allowing all origins. Set this env var in production.")


DEFAULT_SUGGESTIONS: list[str] = [
    "Les variations de dépenses par fournisseur ou catégorie sont-elles cohérentes avec les tendances historiques et les volumes d'activité ?",
    "Existe-t-il des transactions d'achats présentant des montants, fréquences ou dates atypiques (ex. fractionnement de factures, achats en fin de période, doublons potentiels) ?",
    "Des fournisseurs inactifs continuent-ils à être réglés ?",
    "Quels tiers ont une activité à la fois fournisseur et client ?",
    "Y a-t-il des écarts significatifs entre les soldes comptables fournisseurs et les balances auxiliaires ?",
]


@app.get("/health", status_code=200)
async def health():
    return {"status": "healthy"}


@app.get("/suggestions")
async def get_suggestions():
    """Return the configured accounting analysis suggestion questions."""
    # Allow operators to override the default suggestions via a JSON array env var.
    # Example: SUGGESTIONS='["Question 1", "Question 2", ...]'
    raw = os.getenv("SUGGESTIONS", "")
    suggestions: list[str] = DEFAULT_SUGGESTIONS
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                suggestions = [str(q) for q in parsed if str(q).strip()] or DEFAULT_SUGGESTIONS
        except (json.JSONDecodeError, ValueError):
            logger.warning("SUGGESTIONS env var contains invalid JSON — using defaults")
        
    return {"suggestions": suggestions}


# ── Controller endpoint (SSE) ────────────────────────────────────────────────

@app.post("/chat/stream", response_class=StreamingResponse)
async def stream_chat(body: ControllerRequest, http_request: Request) -> AsyncIterable[str]:
    """Stream controller decision as Server-Sent Events.

    Yields status messages while the LM is running, then emits the final
    controller_decision event once the Prediction is ready.
    """
    catalog_source = "payload" if body.catalog_info else "default"
    logger.info(
        "[chat/stream] prompt=%r catalog=%s",
        body.source_text[:80],
        catalog_source,
    )

    catalog = body.catalog_info or default_catalog_info
    conversation_context = (
        json.dumps(body.conversation_context)
        if body.conversation_context
        else ""
    )

    reasoning_parts: list[str] = []

    try:
        async for chunk in stream_controller(
            source_text=body.source_text,
            catalog_info=catalog,
            conversation_context=conversation_context,
        ):
            # Stop streaming if the client disconnected — avoids wasting LLM calls.
            if await http_request.is_disconnected():
                logger.info("[chat/stream] client disconnected, stopping stream")
                break

            if isinstance(chunk, StatusMessage):
                yield f"event: status\ndata: {json.dumps({'message': chunk.message})}\n\n"

            elif isinstance(chunk, StreamResponse):
                # Accumulate reasoning tokens from controller_decision predictor
                if chunk.chunk:
                    reasoning_parts.append(chunk.chunk)
                yield (
                    f"event: reasoning_token\n"
                    f"data: {json.dumps({'chunk': chunk.chunk})}\n\n"
                )

            elif isinstance(chunk, dspy.Prediction):
                response = _prediction_to_controller_response(chunk)
                # Inject reasoning assembled from the stream, not from the Prediction
                response.reasoning = "".join(reasoning_parts)
                logger.info(
                    "[chat/stream] → decision=%s confidence=%.2f classification=%s questions=%d",
                    response.decision,
                    response.confidence,
                    response.queryClassification or "-",
                    len(response.questions),
                )
                payload = {"role": "controller", "data": response.model_dump()}
                yield f"event: controller_decision\ndata: {json.dumps(payload)}\n\n"

    except Exception as exc:
        logger.error("[chat/stream] LLM call failed: %s", exc, exc_info=True)
        error_payload = json.dumps({"error": "Une erreur interne est survenue lors de l'analyse."})
        yield f"event: error\ndata: {error_payload}\n\n"
           


# ── Spec generation endpoint (JSONL stream) ──────────────────────────────────

@app.post("/spec/generate", response_class=StreamingResponse)
async def generate_spec(body: SpecRequest, http_request: Request) -> AsyncIterable[str]:
    """Stream GenUI spec patches as JSONL lines.

    Each line is a complete JSON patch object. Status messages are emitted
    as SSE-style comments (lines prefixed with `#`) so they don't break
    JSONL consumers but can be consumed by aware clients.
    """
    if not body.prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    user_content = _build_spec_prompt(body)
    logger.info(
        "[spec/generate] prompt=%r has_data=%s has_questions=%s",
        body.prompt[:80],
        bool(body.genie_result),
        bool(body.questions),
    )

    try:
        async for chunk in stream_spec(
            user_prompt=user_content,
        ):
            # Stop streaming if the client disconnected — avoids wasting LLM calls.
            if await http_request.is_disconnected():
                logger.info("[spec/generate] client disconnected, stopping stream")
                break

            if isinstance(chunk, StatusMessage):
                # Emit as a comment — JSONL readers ignore these
                yield f"# {chunk.message}\n"

            elif isinstance(chunk, StreamResponse):
                # Individual tokens — not complete JSONL lines, skip content yield.
                # StatusMessage already covers progress; Prediction holds the full output.
                pass

            elif isinstance(chunk, dspy.Prediction):
                # dspy.Prediction is the authoritative source for spec_patches.
                # StreamResponse chunks are partial tokens and cannot be used as JSONL.
                # When the LM result is cached, StreamResponse is skipped entirely and
                # only Prediction is emitted — so this branch must always yield the patches.
                patches = getattr(chunk, "spec_patches", "") or ""
                if patches.strip():
                    logger.info("[spec/generate] streaming complete")
                    for line in patches.split("\n"):
                        stripped = line.strip()
                        if stripped:
                            yield stripped + "\n"
                else:
                    logger.error("[spec/generate] LLM produced empty spec_patches")
                    # Yield a valid JSONL error object so the client can detect the failure
                    # instead of hanging indefinitely waiting for patches.
                    yield json.dumps({"error": "LLM produced empty spec_patches"}) + "\n"

    except Exception as exc:
        logger.error("[spec/generate] failed during streaming: %s", exc, exc_info=True)
        # Yield a valid JSONL error object (not a comment) so clients can detect the failure.
        yield json.dumps({"error": "Une erreur interne est survenue lors de la génération."}) + "\n"
            