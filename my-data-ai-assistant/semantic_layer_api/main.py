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
from typing import Any, Union

import dspy
import mlflow
from dspy.streaming import StatusMessage, StreamListener, StreamResponse
from fastapi import FastAPI, HTTPException
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
    questions: list[Any] = []
    queryClassification: str | None = None
    coherenceNote: str = ""
    needsParams: bool = False
    reasoning: str = ""


class ControllerRequest(BaseModel):
    source_text: str
    catalog_info: str = ""
    conversation_context: dict | None = None


class SpecRequest(BaseModel):
    prompt: str
    genie_result: Union[dict, list, str, None] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_spec_prompt(request: SpecRequest) -> str:
    """Combine prompt text with optional Genie result data."""
    if not request.genie_result:
        return request.prompt
    try:
        genie_data = (
            json.dumps(request.genie_result)
            if not isinstance(request.genie_result, str)
            else request.genie_result
        )
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="genie_result contains non-serializable data",
        ) from exc
    return f"{request.prompt}\n\nData:\n{genie_data}"


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    suggestions = os.getenv("SUGGESTIONS", "")
    suggestions: list[str] = json.loads(suggestions) if suggestions else []
    if not isinstance(suggestions, list):
        suggestions = DEFAULT_SUGGESTIONS
    suggestions: list[str] = [str(q) for q in suggestions if str(q).strip()] or DEFAULT_SUGGESTIONS
        
    return {"suggestions": suggestions}


# ── Controller endpoint (SSE) ────────────────────────────────────────────────

@app.post("/chat/stream", response_class=StreamingResponse)
async def stream_chat(request: ControllerRequest) -> AsyncIterable[str]:
    """Stream controller decision as Server-Sent Events.

    Yields status messages while the LM is running, then emits the final
    controller_decision event once the Prediction is ready.
    """
    catalog_source = "payload" if request.catalog_info else "default"
    logger.info(
        "[chat/stream] prompt=%r catalog=%s",
        request.source_text[:80],
        catalog_source,
    )

    catalog = request.catalog_info or default_catalog_info
    conversation_context = (
        json.dumps(request.conversation_context)
        if request.conversation_context
        else ""
    )

    reasoning_parts: list[str] = []

    try:
         async for chunk in stream_controller(
                source_text=request.source_text,
                catalog_info=catalog,
                conversation_context=conversation_context,
            ):
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
        error_payload = json.dumps({"error": f"LLM controller error: {exc}"})
        yield f"event: error\ndata: {error_payload}\n\n"
           


# ── Spec generation endpoint (JSONL stream) ──────────────────────────────────

@app.post("/spec/generate", response_class=StreamingResponse)
async def generate_spec(request: SpecRequest) -> AsyncIterable[str]:
    """Stream GenUI spec patches as JSONL lines.

    Each line is a complete JSON patch object. Status messages are emitted
    as SSE-style comments (lines prefixed with `#`) so they don't break
    JSONL consumers but can be consumed by aware clients.
    """
    if not request.prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    user_content = _build_spec_prompt(request)
    logger.info(
        "[spec/generate] prompt=%r has_data=%s",
        request.prompt[:80],
        bool(request.genie_result),
    )

    try:
        async for chunk in stream_spec(
            user_prompt=user_content,
        ):
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

    except Exception as exc:
        logger.error("[spec/generate] failed during streaming: %s", exc, exc_info=True)
        yield f"# error: {exc}\n"
            