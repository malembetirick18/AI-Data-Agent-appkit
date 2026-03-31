from fastapi import FastAPI, HTTPException
import dspy
from pydantic import BaseModel
import mlflow
import os
import json
import re
from typing import Any

from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
from src.logger import Logger
from src.controller_decision import ControllerDecision

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


class ControllerRequest(BaseModel):
    source_text: str
    catalog_info: str = ""
    conversation_context: dict | None = None


class SpecRequest(BaseModel):
    prompt: str
    genie_result: Any = None
    catalog_prompt: str = ""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> str:
    """Strip markdown code fences if the LLM wraps JSON in ```json...```."""
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text.strip())
    if match:
        return match.group(1).strip()
    return text.strip()


# ── Bootstrap ─────────────────────────────────────────────────────────────────

load_dotenv(override=True)

logger = Logger()

catalog_path = os.path.join(os.path.dirname(__file__), "catalogs", "genie_knowledge_store.json")
with open(catalog_path, "r", encoding="utf-8") as f:
    genie_knowledge_store = json.load(f)
default_catalog_info = json.dumps(genie_knowledge_store)

log_traces = os.getenv("MLFLOW_LOG_TRACES", "true") == "true"
silent = os.getenv("MLFLOW_SILENT", "true") == "true"

mlflow.dspy.autolog(log_traces=log_traces, silent=silent)
mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "databricks"))
mlflow.set_experiment(os.getenv("MLFLOW_SEMANTIC_LAYER_TRACING_EXPERIMENT", "semantic-layer-experiment"))

lm = dspy.LM(
    model="azure/gpt-5.3-codex",
    api_key=os.getenv("AZURE_API_KEY"),
    api_base=os.getenv("AZURE_API_BASE"),
    api_version="2025-04-01-preview",
    model_type="responses",
    cache=True,
    num_retries=3,
)

# Instantiate agents once at startup — DSPy modules are stateless per-call
with dspy.settings.context(lm=lm, adapter=dspy.JSONAdapter(), track_usage=True):
    controller_agent = ControllerDecision()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(root_path="/api", title="Semantic layer API", version="0.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return "healthy!"


@app.post("/chat/stream")
async def stream_chat(request: ControllerRequest) -> StreamingResponse:
    catalog = request.catalog_info or default_catalog_info
    conversation_context = (
        json.dumps(request.conversation_context) if request.conversation_context else ""
    )

    with dspy.settings.context(lm=lm, adapter=dspy.JSONAdapter(), track_usage=True):
        result: dspy.Prediction = controller_agent(
            source_text=request.source_text,
            catalog_info=catalog,
            conversation_context=conversation_context,
        )

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
    )

    async def event_generator():
        yield f"event: controller_decision\ndata: {response.model_dump_json()}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/spec/generate")
async def generate_spec(request: SpecRequest) -> StreamingResponse:
    """Generate a json-render UI spec.

    Expects ``catalog_prompt`` to be the output of ``catalog.prompt()`` from
    the frontend json-render catalog.  This is passed directly as the LLM
    system message so all component definitions, props and rules are
    controlled by the catalog — not hardcoded here.
    """
    if not request.prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    if not request.catalog_prompt:
        raise HTTPException(status_code=400, detail="catalog_prompt is required")

    user_content = request.prompt
    if request.genie_result:
        genie_data = (
            json.dumps(request.genie_result)
            if not isinstance(request.genie_result, str)
            else request.genie_result
        )
        user_content += f"\n\nData:\n{genie_data}"

    messages = [
        {"role": "system", "content": request.catalog_prompt},
        {"role": "user", "content": user_content},
    ]

    response = lm(messages=messages)
    spec_text = _extract_json(response[0] if response else "{}")

    async def event_generator():
        yield f"event: spec\ndata: {spec_text}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


