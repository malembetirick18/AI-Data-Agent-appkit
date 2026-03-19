import json
import os
import sys
from dataclasses import asdict, dataclass
from typing import Any, Dict, Literal

import dspy
import mlflow


RenderMode = Literal["text_only", "table_only", "chart_only", "combo"]

ALL_COMPONENTS = {
    "Stack": {"props": ["gap"]},
    "TextContent": {"props": ["content", "weight", "size"]},
    "BulletList": {"props": ["items"]},
    "DataTable": {"props": ["caption", "headers", "rows"]},
    "LineChartViz": {
        "props": ["title", "data", "lines", "xKey", "yLabel", "source"],
    },
    "BarChartViz": {
        "props": ["title", "data", "barKey", "xKey", "color"],
    },
    "FormPanel": {"props": ["title", "description"]},
    "SelectInputField": {
        "props": ["label", "placeholder", "value", "required", "disabled", "options"],
    },
    "TextInputField": {
        "props": ["label", "placeholder", "value", "required", "disabled"],
    },
    "NumberInputField": {
        "props": ["label", "placeholder", "value", "min", "max", "step", "required", "disabled"],
    },
    "ToggleField": {
        "props": ["label", "description", "checked", "disabled"],
    },
    "WorkflowRuleBuilder": {
        "props": ["title", "description", "fields", "operators", "rules"],
    },
}

ALLOWED_COMPONENTS_BY_MODE: Dict[RenderMode, set[str]] = {
    "text_only": {"Stack", "TextContent", "BulletList", "FormPanel", "SelectInputField", "TextInputField", "NumberInputField", "ToggleField", "WorkflowRuleBuilder"},
    "table_only": {"Stack", "DataTable", "FormPanel", "SelectInputField", "TextInputField", "NumberInputField", "ToggleField", "WorkflowRuleBuilder"},
    "chart_only": {"Stack", "LineChartViz", "BarChartViz"},
    "combo": set(ALL_COMPONENTS.keys()),
}


@dataclass
class RunnerConfig:
    model: str
    api_base: str | None
    api_key: str | None
    temperature: float
    api_version: str | None
    max_tokens: int
    cache: str
    num_retries: str


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _load_config() -> RunnerConfig:
    model = os.getenv("GENUI_DSPY_MODEL", "openai/gpt-4o-mini")
    api_base = os.getenv("AZURE_API_BASE")
    api_key = os.getenv("AZURE_API_KEY")
    temperature = float(os.getenv("TEMPERATURE", "0.0"))
    max_tokens = int(os.getenv("MAX_TOKENS", "20000"))
    dspy_cache = os.getenv("DSPY_CACHE", "true")
    num_retries = os.getenv("DSPY_RETRY_ATTEMPTS", "3")
    model_version = os.getenv("AZURE_OPENAI_API_VERSION")
    return RunnerConfig(
        model=model, 
        api_base=api_base, 
        api_key=api_key, 
        temperature=temperature,
        api_version=model_version, 
        max_tokens=max_tokens, 
        cache=dspy_cache,
        num_retries=num_retries,
    )


def _setup_dspy_and_mlflow() -> None:
    mlflow_tracking_uri = os.getenv("MLFLOW_TRACKING_URI")
    if mlflow_tracking_uri:
        mlflow.set_tracking_uri(mlflow_tracking_uri)

    experiment_name = os.getenv("MLFLOW_EXPERIMENT_NAME", "/genui-dspy")
    # Databricks-backed MLflow requires an absolute workspace path
    if mlflow_tracking_uri == "databricks" and not experiment_name.startswith("/"):
        try:
            from databricks.sdk import WorkspaceClient
            w = WorkspaceClient()
            user_name = w.current_user.me().user_name
            experiment_name = f"/Users/{user_name}/{experiment_name}"
        except Exception:
            experiment_name = f"/Shared/{experiment_name}"
    mlflow.set_experiment(experiment_name)

    mlflow.dspy.autolog(
        log_traces=_env_bool("MLFLOW_LOG_TRACES", True),
        silent=_env_bool("MLFLOW_SILENT", True),
    )


class GenUiSignature(dspy.Signature):
    """Generate a valid JSON object with top-level keys: root, elements.
    Each element must include: type, props, children.
    Use only catalog component types.
    Return JSON only without markdown or explanations.
    """

    prompt = dspy.InputField(desc="User question or requested analysis")
    genie_result = dspy.InputField(desc="Structured Genie result payload")
    spec_json = dspy.OutputField(desc="JSON string that can be parsed into a json-render spec")


class GenUiModule(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.predict = dspy.Predict(GenUiSignature)

    def forward(self, prompt: str, genie_result: str):
        return self.predict(
            prompt=prompt,
            genie_result=genie_result,
        )


def _safe_json_dumps(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return json.dumps({"error": "failed to serialize value"}, ensure_ascii=False)


def _fallback_spec(prompt: str, render_mode: RenderMode) -> Dict[str, Any]:
    if render_mode == "table_only":
        return {
            "root": "root",
            "elements": {
                "root": {
                    "type": "Stack",
                    "props": {"gap": 6},
                    "children": ["table-1"],
                },
                "table-1": {
                    "type": "DataTable",
                    "props": {
                        "caption": "Résultat de secours (table)",
                        "headers": ["Message"],
                        "rows": [[f"Generation indisponible. Prompt reçu: {prompt[:160]}"]],
                    },
                    "children": [],
                },
            },
        }

    if render_mode == "chart_only":
        return {
            "root": "root",
            "elements": {
                "root": {
                    "type": "Stack",
                    "props": {"gap": 6},
                    "children": ["chart-1"],
                },
                "chart-1": {
                    "type": "BarChartViz",
                    "props": {
                        "title": "Résultat de secours (graphique)",
                        "data": [
                            {"categorie": "A", "count": 1},
                            {"categorie": "B", "count": 2},
                        ],
                        "barKey": "count",
                        "xKey": "categorie",
                        "color": "#1c7ed6",
                    },
                    "children": [],
                },
            },
        }

    if render_mode == "combo":
        return {
            "root": "root",
            "elements": {
                "root": {
                    "type": "Stack",
                    "props": {"gap": 6},
                    "children": ["text-1", "table-1"],
                },
                "text-1": {
                    "type": "TextContent",
                    "props": {
                        "content": f"Generation indisponible. Prompt reçu: {prompt[:180]}",
                        "size": "sm",
                    },
                    "children": [],
                },
                "table-1": {
                    "type": "DataTable",
                    "props": {
                        "caption": "Résumé de secours",
                        "headers": ["Statut", "Valeur"],
                        "rows": [["Fallback", "Actif"]],
                    },
                    "children": [],
                },
            },
        }

    return {
        "root": "root",
        "elements": {
            "root": {
                "type": "Stack",
                "props": {"gap": 6},
                "children": ["text-1"],
            },
            "text-1": {
                "type": "TextContent",
                "props": {
                    "content": f"Generation indisponible. Prompt reçu: {prompt[:300]}",
                    "size": "sm",
                },
                "children": [],
            },
        },
    }


def _decode_json_pointer_token(token: str) -> str:
    return token.replace("~1", "/").replace("~0", "~")


def _set_by_json_pointer(target: Dict[str, Any], path: str, value: Any) -> None:
    if path == "":
        return
    parts = [_decode_json_pointer_token(part) for part in path.split("/") if part != ""]
    if not parts:
        return

    current: Any = target
    for part in parts[:-1]:
        if isinstance(current, dict):
            if part not in current or not isinstance(current[part], dict):
                current[part] = {}
            current = current[part]
        else:
            return

    last = parts[-1]
    if isinstance(current, dict):
        current[last] = value


def _remove_by_json_pointer(target: Dict[str, Any], path: str) -> None:
    parts = [_decode_json_pointer_token(part) for part in path.split("/") if part != ""]
    if not parts:
        return

    current: Any = target
    for part in parts[:-1]:
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return

    last = parts[-1]
    if isinstance(current, dict):
        current.pop(last, None)


def _try_parse_spec_output(raw_output: str) -> Dict[str, Any] | None:
    raw = raw_output.strip()
    if not raw:
        return None

    # 1) Direct JSON object (preferred)
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            if "spec" in parsed and isinstance(parsed.get("spec"), dict):
                parsed = parsed["spec"]
            if "root" in parsed and "elements" in parsed and isinstance(parsed.get("elements"), dict):
                return parsed
    except Exception:
        pass

    # 2) JSONL RFC6902 patch stream (from catalog.prompt default)
    spec_doc: Dict[str, Any] = {}
    saw_patch = False

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            patch = json.loads(line)
        except Exception:
            continue

        if not isinstance(patch, dict):
            continue

        op = patch.get("op")
        path = patch.get("path")
        if not isinstance(op, str) or not isinstance(path, str):
            continue

        saw_patch = True
        if op in {"add", "replace"}:
            _set_by_json_pointer(spec_doc, path, patch.get("value"))
        elif op == "remove":
            _remove_by_json_pointer(spec_doc, path)

    if saw_patch and isinstance(spec_doc.get("elements"), dict) and isinstance(spec_doc.get("root"), str):
        return spec_doc

    return None


def _validate_spec_shape(spec: Any, render_mode: RenderMode) -> bool:
    if not isinstance(spec, dict):
        return False
    if "root" not in spec or "elements" not in spec:
        return False
    if not isinstance(spec["elements"], dict):
        return False

    elements = spec["elements"]
    allowed_types = ALLOWED_COMPONENTS_BY_MODE[render_mode]
    used_types: set[str] = set()

    for element in elements.values():
        if not isinstance(element, dict):
            return False
        element_type = element.get("type")
        if not isinstance(element_type, str):
            return False
        if element_type not in allowed_types:
            return False
        used_types.add(element_type)

    if render_mode == "text_only":
        return bool({"TextContent", "BulletList"}.intersection(used_types))
    if render_mode == "table_only":
        return "DataTable" in used_types
    if render_mode == "chart_only":
        return bool({"LineChartViz", "BarChartViz"}.intersection(used_types))

    has_text = bool({"TextContent", "BulletList"}.intersection(used_types))
    has_table = "DataTable" in used_types
    has_chart = bool({"LineChartViz", "BarChartViz"}.intersection(used_types))
    represented_categories = int(has_text) + int(has_table) + int(has_chart)
    return represented_categories >= 1


def _generate_spec(payload: Dict[str, Any]) -> Dict[str, Any]:
    prompt = str(payload.get("prompt", "")).strip()
    genie_result = payload.get("genieResult")
    system_prompt = payload.get("systemPrompt", "")
    render_mode: RenderMode = "combo"

    module = GenUiModule()

    config = _load_config()

    _setup_dspy_and_mlflow()

    with mlflow.start_run(run_name="dspy-genui-spec") as run:
        lm_kwargs = {k: v for k, v in asdict(config).items() if v is not None}
        ctx_kwargs = {"lm": dspy.LM(**lm_kwargs), "adapter": dspy.JSONAdapter()}
        if system_prompt:
            ctx_kwargs["system_prompt"] = system_prompt

        with dspy.settings.context(**ctx_kwargs): 
            mlflow.log_param("dspy_model", os.getenv("GENUI_DSPY_MODEL", "openai/gpt-4o-mini"))
            mlflow.log_param("prompt_length", len(prompt))
            mlflow.log_param("render_mode", render_mode)

            prediction = module(
                prompt=prompt,
                genie_result=_safe_json_dumps(genie_result),
            )

            raw_spec_json = getattr(prediction, "spec_json", "")
            mlflow.log_metric("spec_json_length", float(len(raw_spec_json)))

            parsed = _try_parse_spec_output(raw_spec_json)
            if parsed and _validate_spec_shape(parsed, render_mode):
                mlflow.log_param("spec_parse_mode", "json-or-jsonl")
                mlflow.log_param("spec_validation", "passed")
                return {
                    "spec": parsed,
                    "traceId": run.info.run_id,
                    "model": os.getenv("GENUI_DSPY_MODEL", "openai/gpt-4o-mini"),
                }

            if parsed is None:
                mlflow.log_param("spec_parse_mode", "failed")
                mlflow.log_param("spec_validation", "skipped")
            else:
                mlflow.log_param("spec_parse_mode", "json-or-jsonl")
                mlflow.log_param("spec_validation", "failed")

            fallback = _fallback_spec(prompt, render_mode)
            mlflow.log_param("fallback", "true")
            return {
                "spec": fallback,
                "traceId": run.info.run_id,
                "model": os.getenv("GENUI_DSPY_MODEL", "openai/gpt-4o-mini"),
            }


def main() -> None:
    raw_input = sys.stdin.read()
    if not raw_input.strip():
        print(json.dumps({"error": "No input payload provided"}))
        sys.exit(1)

    try:
        payload = json.loads(raw_input)
    except Exception:
        print(json.dumps({"error": "Invalid JSON input"}))
        sys.exit(1)

    try:
        result = _generate_spec(payload)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
