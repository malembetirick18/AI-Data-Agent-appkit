from fastapi import FastAPI, HTTPException
import dspy
from pydantic import BaseModel
import mlflow
import os
import asyncio
import json
import re
from typing import Any, Union

from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
from src.logger import Logger
from src.controller_decision import ControllerDecision
from src.genui_spec_generator import GenUiSpecGenerator

from dotenv import load_dotenv


# ── Request / response models ─────────────────────────────────────────────────

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


# ── Bootstrap ─────────────────────────────────────────────────────────────────

load_dotenv(override=True)

logger = Logger()

catalog_path = os.path.join(os.path.dirname(__file__), "catalogs", "genie_knowledge_store.json")
with open(catalog_path, "r", encoding="utf-8") as f:
    genie_knowledge_store = json.load(f)
default_catalog_info = json.dumps(genie_knowledge_store)

genui_catalog_prompt_path = os.path.join(os.path.dirname(__file__), "catalogs", "genui_catalog_prompt.txt")
with open(genui_catalog_prompt_path, "r", encoding="utf-8") as f:
    default_genui_catalog_prompt = f.read()

log_traces = os.getenv("MLFLOW_LOG_TRACES", "true") == "true"
silent = os.getenv("MLFLOW_SILENT", "true") == "true"

mlflow.dspy.autolog(log_traces=log_traces, silent=silent)
mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "databricks"))
mlflow.set_experiment(os.getenv("MLFLOW_SEMANTIC_LAYER_TRACING_EXPERIMENT", "semantic-layer-experiment"))

_AZURE_API_KEY = os.getenv("AZURE_API_KEY")
_AZURE_API_BASE = os.getenv("AZURE_API_BASE")
if not _AZURE_API_KEY:
    raise RuntimeError("Missing required environment variable: AZURE_API_KEY")
if not _AZURE_API_BASE:
    raise RuntimeError("Missing required environment variable: AZURE_API_BASE")

lm = dspy.LM(
    model="azure/gpt-5.3-codex",
    api_key=_AZURE_API_KEY,
    api_base=_AZURE_API_BASE,
    api_version="2025-04-01-preview",
    model_type="responses",
    cache=True,
    num_retries=3,
)

# GenUI spec uses its own LM instance with the catalog as system prompt.
# No JSONAdapter — output is raw JSONL patches, not structured JSON.
genui_lm = dspy.LM(
    model="azure/gpt-5.3-codex",
    api_key=_AZURE_API_KEY,
    api_base=_AZURE_API_BASE,
    api_version="2025-04-01-preview",
    model_type="responses",
    system_prompt=default_genui_catalog_prompt,
    cache=True,
    num_retries=3,
)

# Instantiate agents once at startup — DSPy modules are stateless per-call
with dspy.settings.context(lm=lm, adapter=dspy.JSONAdapter(), track_usage=True):
    controller_agent = ControllerDecision()

with dspy.settings.context(lm=genui_lm, track_usage=True):
    genui_spec_generator = GenUiSpecGenerator()

logger.info(
    "Semantic Layer API ready — model=%s catalog=%d chars genui-catalog=%d chars reflection=%s",
    "azure/gpt-5.3-codex",
    len(default_catalog_info),
    len(default_genui_catalog_prompt),
    os.getenv("ENABLE_CONTROLLER_REFLECTION", "false"),
)


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(root_path="/api", title="Semantic layer API", version="0.0.1")

_allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "")
_allowed_origins: list[str] = (
    [o.strip() for o in _allowed_origins_raw.split(",") if o.strip()]
    if _allowed_origins_raw
    else ["*"]
)
# CORS: combining allow_origins=["*"] with allow_credentials=True violates the CORS spec
# and browsers will reject such responses. When explicit origins are configured we enable
# credentials; when falling back to wildcard we disable credentials.
_allow_credentials = _allowed_origins != ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", status_code=200)
async def health():
    return {"status": "healthy"}


@app.post("/chat/stream")
async def stream_chat(request: ControllerRequest) -> StreamingResponse:
    catalog_source = "payload" if request.catalog_info else "default"
    logger.info("[chat/stream] prompt=%r catalog=%s", request.source_text[:80], catalog_source)

    catalog = request.catalog_info or default_catalog_info
    conversation_context = (
        json.dumps(request.conversation_context) if request.conversation_context else ""
    )

    def _run_controller() -> dspy.Prediction:
        with dspy.settings.context(lm=lm, adapter=dspy.JSONAdapter(), track_usage=True):
            return controller_agent(
                source_text=request.source_text,
                catalog_info=catalog,
                conversation_context=conversation_context,
            )

    try:
        result: dspy.Prediction = await asyncio.to_thread(_run_controller)
    except Exception as exc:
        logger.error("[chat/stream] LLM call failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"LLM controller error: {exc}") from exc

    response = ControllerResponse(
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
        reasoning=result.get("reasoning", ""),
    )

    logger.info("[chat/stream] → decision=%s confidence=%.2f classification=%s questions=%d",
                response.decision, response.confidence,
                response.queryClassification or "-", len(response.questions))

    async def event_generator():
        try:
            payload = {"role": "controller", "data": response.model_dump()}
            yield f"event: controller_decision\ndata: {json.dumps(payload)}\n\n"
        except Exception as exc:
            logger.error("[chat/stream] event_generator failed: %s", exc, exc_info=True)
            yield f"event: error\ndata: {json.dumps({'error': 'Stream generation failed'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/spec/generate")
async def generate_spec(request: SpecRequest) -> StreamingResponse:
    if not request.prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    logger.info("[spec/generate] prompt=%r has_data=%s", request.prompt[:80], bool(request.genie_result))

    user_content = request.prompt
    if request.genie_result:
        try:
            genie_data = (
                json.dumps(request.genie_result)
                if not isinstance(request.genie_result, str)
                else request.genie_result
            )
        except (TypeError, ValueError) as exc:
            logger.error("[spec/generate] genie_result serialization failed: %s", exc)
            raise HTTPException(status_code=400, detail="genie_result contains non-serializable data") from exc
        user_content += f"\n\nData:\n{genie_data}"

    def _run_genui() -> dspy.Prediction:
        with dspy.settings.context(lm=genui_lm, track_usage=True):
            return genui_spec_generator(user_prompt=user_content)

    try:
        result = await asyncio.to_thread(_run_genui)
    except Exception as exc:
        logger.error("[spec/generate] LLM call failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"LLM spec generation error: {exc}") from exc

    raw = result.spec_patches or ""
    # Strip optional markdown code fences
    fenced = re.search(r"```(?:json[lL]?)?\s*([\s\S]*?)```", raw.strip())
    if fenced:
        raw = fenced.group(1)

    # Collect only valid RFC 6902 "add" patch lines (op + path + value required)
    _REQUIRED_PATCH_KEYS = {"op", "path", "value"}
    patch_lines: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            patch = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(patch, dict) and patch.get("op") == "add":
            if _REQUIRED_PATCH_KEYS.issubset(patch.keys()):
                patch_lines.append(line)
            else:
                logger.warning("[spec/generate] incomplete patch ignored (missing path/value): %r", patch)

    if not patch_lines:
        logger.error("[spec/generate] LLM produced no valid patches — raw=%r", raw[:300])
        raise HTTPException(status_code=502, detail="LLM produced no valid UI spec patches.")

    logger.info("[spec/generate] → %d patches", len(patch_lines))

    async def event_generator():
        for line in patch_lines:
            yield line + "\n"

    return StreamingResponse(event_generator(), media_type="text/plain; charset=utf-8")




