from fastapi import FastAPI, HTTPException
import dspy
from pydantic import BaseModel
import mlflow
import os
import asyncio
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _apply_json_pointer_add(target: dict, path: str, value: Any) -> None:
    """Apply a single RFC 6901 JSON Pointer add operation to *target* in-place."""
    parts = [p for p in path.split("/") if p]
    if not parts:
        return
    obj: Any = target
    for i, part in enumerate(parts[:-1]):
        next_key = parts[i + 1]
        if isinstance(obj, list):
            idx = int(part)
            while len(obj) <= idx:
                obj.append(None)
            obj = obj[idx]
        else:
            if part not in obj or obj[part] is None:
                try:
                    int(next_key)
                    obj[part] = []
                except ValueError:
                    obj[part] = {}
            obj = obj[part]
    last = parts[-1]
    if isinstance(obj, list):
        idx = int(last)
        while len(obj) <= idx:
            obj.append(None)
        obj[idx] = value
    else:
        obj[last] = value


def _assemble_spec_from_patches(text: str) -> dict:
    """Convert LLM output into a {root, elements, state} spec dict.

    Handles two formats:
    - JSONL RFC 6902 patch lines (preferred, as instructed in the catalog prompt)
    - A single JSON object (fallback, when the LLM ignores the JSONL instruction)
    """
    # Strip optional markdown code fences
    fenced = re.search(r"```(?:json[lL]?)?\s*([\s\S]*?)```", text.strip())
    if fenced:
        text = fenced.group(1)

    text = text.strip()
    if not text:
        return {}

    # Try JSONL patch assembly first
    spec: dict = {}
    patch_found = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            patch = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(patch, dict) or patch.get("op") != "add":
            continue
        patch_found = True
        _apply_json_pointer_add(spec, patch.get("path", ""), patch.get("value"))

    if patch_found and spec.get("root") and spec.get("elements"):
        return spec

    # Fallback: try to parse as a single JSON object
    try:
        candidate = json.loads(text)
        if isinstance(candidate, dict) and candidate.get("root") and candidate.get("elements"):
            return candidate
    except json.JSONDecodeError:
        pass

    return spec


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

    def _run_controller() -> dspy.Prediction:
        with dspy.settings.context(lm=lm, adapter=dspy.JSONAdapter(), track_usage=True):
            return controller_agent(
                source_text=request.source_text,
                catalog_info=catalog,
                conversation_context=conversation_context,
            )

    result: dspy.Prediction = await asyncio.to_thread(_run_controller)

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
        payload = {"role": "controller", "data": response.model_dump()}
        yield f"event: controller_decision\ndata: {json.dumps(payload)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/spec/generate")
async def generate_spec(request: SpecRequest) -> StreamingResponse:
    """Generate a json-render UI spec.

    Uses ``catalogs/genui_catalog_prompt.txt`` as the LLM system message by
    default (loaded once at startup).  An optional ``catalog_prompt`` field in
    the request body overrides the file when provided.
    """
    if not request.prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    user_content = request.prompt
    if request.genie_result:
        genie_data = (
            json.dumps(request.genie_result)
            if not isinstance(request.genie_result, str)
            else request.genie_result
        )
        user_content += f"\n\nData:\n{genie_data}"

    messages = [
        {"role": "system", "content": default_genui_catalog_prompt},
        {"role": "user", "content": user_content},
    ]

    response = await asyncio.to_thread(lm, messages=messages)
    spec = _assemble_spec_from_patches(response[0] if response else "")
    spec_text = json.dumps(spec)

    async def event_generator():
        yield f"event: spec\ndata: {spec_text}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


