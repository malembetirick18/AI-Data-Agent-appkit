import io
import json
import os
import sys
from dataclasses import asdict, dataclass
from typing import Any

# Force UTF-8 on stdin/stdout/stderr to avoid charmap encoding errors on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
if sys.stdin.encoding != 'utf-8':
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')

import dspy
import mlflow


@dataclass
class RunnerConfig:
    model: str
    api_base: str | None
    api_key: str | None
    temperature: float
    api_version: str | None
    max_tokens: int
    cache: bool
    num_retries: int


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _load_config() -> RunnerConfig:
    model = os.getenv("GENUI_DSPY_MODEL", "openai/gpt-4o-mini")
    api_base = os.getenv("AZURE_API_BASE")
    api_key = os.getenv("AZURE_API_KEY")
    temperature = float(os.getenv("SUPERVISOR_TEMPERATURE", os.getenv("TEMPERATURE", "0.0")))
    max_tokens = int(os.getenv("SUPERVISOR_MAX_TOKENS", os.getenv("MAX_TOKENS", "12000")))
    dspy_cache = _env_bool("DSPY_CACHE", True)
    num_retries = int(os.getenv("DSPY_RETRY_ATTEMPTS", "3"))
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
    if mlflow_tracking_uri == "databricks" and not experiment_name.startswith("/"):
        try:
            from databricks.sdk import WorkspaceClient

            workspace = WorkspaceClient()
            user_name = workspace.current_user.me().user_name
            experiment_name = f"/Users/{user_name}/{experiment_name}"
        except Exception:
            experiment_name = f"/Shared/{experiment_name}"
    mlflow.set_experiment(experiment_name)

    mlflow.dspy.autolog(
        log_traces=_env_bool("MLFLOW_LOG_TRACES", True),
        silent=_env_bool("MLFLOW_SILENT", True),
    )


def _safe_json_dumps(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return json.dumps({"error": "failed to serialize value"}, ensure_ascii=False)


def _parse_json_array(raw_value: str) -> list[str]:
    try:
        parsed = json.loads(raw_value)
        if isinstance(parsed, list):
            return [str(item) for item in parsed if isinstance(item, (str, int, float))]
    except Exception:
        return []
    return []


def _parse_decision_json(raw_value: str) -> dict[str, Any] | None:
    # LLMs often wrap JSON in markdown code blocks — strip them first
    cleaned = raw_value.strip()
    if cleaned.startswith("```"):
        # Remove opening ```json or ``` line
        first_newline = cleaned.find("\n")
        if first_newline >= 0:
            cleaned = cleaned[first_newline + 1:]
        # Remove closing ```
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3].rstrip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    # Fallback: try to find a JSON object in the raw string
    start = raw_value.find("{")
    end = raw_value.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(raw_value[start:end + 1])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return None


def _normalize_catalog(payload_catalog: Any) -> dict[str, Any]:
    if isinstance(payload_catalog, dict) and "catalog" in payload_catalog:
        catalog = payload_catalog.get("catalog")
        source = str(payload_catalog.get("source", "payload"))
    else:
        catalog = payload_catalog
        source = "payload"

    if not isinstance(catalog, dict):
        return {"source": source, "tables": [], "functions": [], "raw": {}}

    tables = catalog.get("tables", [])
    functions = catalog.get("functions", [])

    normalized_tables = []
    if isinstance(tables, list):
        for item in tables:
            if isinstance(item, dict):
                normalized_tables.append(item)
            elif isinstance(item, str):
                normalized_tables.append({"name": item})

    normalized_functions = []
    if isinstance(functions, list):
        for item in functions:
            if isinstance(item, dict):
                normalized_functions.append(item)
            elif isinstance(item, str):
                normalized_functions.append({"name": item})

    return {
        "source": source,
        "tables": normalized_tables,
        "functions": normalized_functions,
        "raw": catalog,
    }


def _catalog_prompt(catalog: dict[str, Any]) -> str:
    compact_catalog = {
        "source": catalog.get("source", "payload"),
        "tables": catalog.get("tables", []),
        "functions": catalog.get("functions", []),
    }
    return _safe_json_dumps(compact_catalog)


def _sanitize_mlflow_value(value: Any, max_length: int = 250) -> str:
    text = str(value).strip()
    if not text:
        return "unknown"
    if len(text) > max_length:
        return text[: max_length - 3] + "..."
    return text


def _extract_catalog_item_name(item: Any) -> str | None:
    if isinstance(item, dict):
        for key in ("name", "table_name", "function_name", "full_name"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    if isinstance(item, str) and item.strip():
        return item.strip()
    return None


def _build_knowledge_store_summary(catalog: dict[str, Any]) -> dict[str, Any]:
    tables = catalog.get("tables", [])
    functions = catalog.get("functions", [])

    table_names = [name for name in (_extract_catalog_item_name(item) for item in tables) if name]
    function_names = [name for name in (_extract_catalog_item_name(item) for item in functions) if name]

    tables_with_columns = 0
    total_column_count = 0
    for item in tables:
        if not isinstance(item, dict):
            continue
        columns = item.get("columns")
        if isinstance(columns, list):
            tables_with_columns += 1
            total_column_count += len(columns)

    return {
        "source": catalog.get("source", "payload"),
        "tableCount": len(tables) if isinstance(tables, list) else 0,
        "functionCount": len(functions) if isinstance(functions, list) else 0,
        "tablesWithColumns": tables_with_columns,
        "totalColumnCount": total_column_count,
        "tableNames": table_names,
        "functionNames": function_names,
        "tableNameSample": table_names[:25],
        "functionNameSample": function_names[:25],
    }


def _extract_tracking_tags(conversation_context: Any) -> dict[str, str]:
    if not isinstance(conversation_context, dict):
        return {}

    tags: dict[str, str] = {}
    tag_candidates = {
        "conversation_id": ["conversationId", "conversation_id", "threadId", "thread_id"],
        "session_id": ["sessionId", "session_id"],
        "user_id": ["userId", "user_id"],
        "request_source": ["source", "origin", "channel"],
    }

    for tag_name, candidate_keys in tag_candidates.items():
        for key in candidate_keys:
            raw_value = conversation_context.get(key)
            if raw_value is not None:
                tags[tag_name] = _sanitize_mlflow_value(raw_value)
                break

    messages = conversation_context.get("messages")
    if isinstance(messages, list):
        tags["conversation_message_count"] = str(len(messages))

    return tags


def _log_supervisor_tracking(response: dict[str, Any], conversation_context: Any) -> None:
    confidence = response.get("confidence", 0.0)
    try:
        confidence_value = float(confidence)
    except (TypeError, ValueError):
        confidence_value = 0.0

    suggested_tables = response.get("suggestedTables")
    suggested_functions = response.get("suggestedFunctions")
    questions = response.get("questions")
    required_columns = response.get("requiredColumns")
    predictive_functions = response.get("predictiveFunctions")

    mlflow.log_param("decision", _sanitize_mlflow_value(response.get("decision", "unknown")))
    mlflow.log_param(
        "query_classification",
        _sanitize_mlflow_value(response.get("queryClassification", "unknown")),
    )
    mlflow.log_metric("confidence", confidence_value)
    mlflow.log_metric("clarification_question_count", float(len(questions) if isinstance(questions, list) else 0))
    mlflow.log_metric("suggested_table_count", float(len(suggested_tables) if isinstance(suggested_tables, list) else 0))
    mlflow.log_metric(
        "suggested_function_count",
        float(len(suggested_functions) if isinstance(suggested_functions, list) else 0),
    )
    mlflow.log_metric("required_column_count", float(len(required_columns) if isinstance(required_columns, list) else 0))
    mlflow.log_metric(
        "predictive_function_count",
        float(len(predictive_functions) if isinstance(predictive_functions, list) else 0),
    )

    tracking_tags = {
        "supervisor_component": "dspy-supervisor",
        "catalog_source": _sanitize_mlflow_value(response.get("catalogSource", "unknown")),
        **_extract_tracking_tags(conversation_context),
    }
    mlflow.set_tags(tracking_tags)

    mlflow.log_dict(
        {
            "decision": response.get("decision"),
            "message": response.get("message"),
            "rewrittenPrompt": response.get("rewrittenPrompt"),
            "confidence": confidence_value,
            "queryClassification": response.get("queryClassification"),
            "catalogSource": response.get("catalogSource"),
            "suggestedTables": suggested_tables if isinstance(suggested_tables, list) else [],
            "suggestedFunctions": suggested_functions if isinstance(suggested_functions, list) else [],
            "requiredColumns": required_columns if isinstance(required_columns, list) else [],
            "predictiveFunctions": predictive_functions if isinstance(predictive_functions, list) else [],
            "questions": questions if isinstance(questions, list) else [],
        },
        "supervisor_response.json",
    )


def _log_knowledge_store_summary(catalog: dict[str, Any]) -> None:
    mlflow.log_dict(_build_knowledge_store_summary(catalog), "knowledge_store_summary.json")


class QueryClassificationSignature(dspy.Signature):
    """Classify a user query for Databricks workloads.

    Return one of these exact strings only:
    - Normal SQL
    - Predictive SQL
    - General Information
    """

    prompt = dspy.InputField(desc="User query")
    catalog_info = dspy.InputField(desc="Genie knowledge store metadata")
    classification = dspy.OutputField(desc="Exact classification string")


class PredictiveFunctionSignature(dspy.Signature):
    """Classify predictive or AI tasks into Databricks AI function families.

    Return ONLY a JSON array string using these allowed values:
    fn_vendor_typology,fn_customer_typology
    """

    prompt = dspy.InputField(desc="User query")
    predictive_functions_json = dspy.OutputField(desc="JSON array string of AI function names")


class RequiredColumnsSignature(dspy.Signature):
    """Review the available schema metadata and identify only the columns required to answer the user query.

    Return ONLY a JSON array of column names and never include table names.
    """

    prompt = dspy.InputField(desc="User query")
    schema_info = dspy.InputField(desc="Catalog schema information")
    required_columns_json = dspy.OutputField(desc="JSON array string of required column names")


class RephraseQuerySignature(dspy.Signature):
    """Rewrite the user query into a clearer Databricks/Genie-friendly question.

    Rules:
    - Preserve the original meaning
    - Make the information need explicit
    - Mention forecast only if the user query already implies forecasting
    - Mention classify only if the user query already implies classification
    - Return only the rewritten query text
    """

    prompt = dspy.InputField(desc="User query")
    query_classification = dspy.InputField(desc="Classification result")
    rewritten_prompt = dspy.OutputField(desc="Clear rewritten prompt")


class SupervisorDecisionSignature(dspy.Signature):
    """Act as a Databricks SQL supervisor using only the provided Genie knowledge store metadata.

    You must choose one decision among: clarify, guide, proceed, error.

    IMPORTANT: Default to 'proceed' whenever the user intent is understandable and at least one
    table in catalog_info can plausibly answer the question. Genie is capable of resolving column
    mappings and performing joins on its own — you do NOT need perfect certainty.

    - proceed: use when the rewritten prompt is clear enough for Genie to generate a SQL query.
      Prefer this decision when the user question maps to known tables, even if the exact columns
      are not spelled out. Genie handles column resolution internally.
    - guide: use when the request is valid but would benefit from a simpler reformulation or
      explicit table/function hints before sending to Genie
    - clarify: use ONLY when the user request is truly ambiguous (e.g. multiple incompatible
      interpretations), or when no table in catalog_info is even remotely relevant
    - error: use when the request is completely outside the supported data scope

    Confidence scoring rules (CRITICAL — follow strictly):
    - confidence is a float between 0.0 and 1.0
    - When decision is 'proceed' and the user intent clearly maps to one or more tables in catalog_info,
      set confidence >= 0.92. Most 'proceed' decisions should have confidence between 0.92 and 0.98.
    - When decision is 'proceed' but the mapping is less obvious (e.g. requires assumptions),
      set confidence between 0.70 and 0.89.
    - When decision is 'guide', set confidence between 0.40 and 0.69.
    - When decision is 'clarify', set confidence between 0.10 and 0.39.
    - When decision is 'error', set confidence to 0.0.
    - Do NOT default to low confidence values like 0.5 or 0.7 for clear 'proceed' cases.
      If the intent is clear and tables exist, confidence MUST be >= 0.92.

    Constraints:
    - Never invent tables, columns, functions, or business rules
    - Use only metadata available in catalog_info
    - Suggested tables and functions must come only from catalog_info
    - Favor low-complexity queries and minimal joins
    - If the best answer requires clarification, ask short structured questions
    - When in doubt between 'clarify' and 'proceed', choose 'proceed'

    Return ONLY a JSON object string with this shape:
    {
      "decision": "clarify|guide|proceed|error",
      "message": "short user-facing message",
      "rewrittenPrompt": "optional rewritten prompt",
      "suggestedTables": ["table1", "table2"],
      "suggestedFunctions": ["fn1"],
      "questions": [
        {
          "id": "scope",
          "label": "question text",
          "inputType": "select|text",
          "required": true,
          "placeholder": "optional",
          "options": [{"value": "v1", "label": "label 1"}]
        }
      ],
      "confidence": 0.0
    }
    """

    prompt = dspy.InputField(desc="Original user query")
    catalog_info = dspy.InputField(desc="Genie knowledge store metadata")
    query_classification = dspy.InputField(desc="Normal SQL or Predictive SQL or General Information")
    predictive_functions_json = dspy.InputField(desc="JSON array of relevant AI functions")
    required_columns_json = dspy.InputField(desc="JSON array of required columns")
    rewritten_prompt = dspy.InputField(desc="Rewritten clear query")
    conversation_context = dspy.InputField(desc="Recent chat context")
    decision_json = dspy.OutputField(desc="JSON object string containing the supervisor decision")


class ChartRecommendationSignature(dspy.Signature):
    """Analyze Genie SQL query results and recommend the 2 best chart types for visualization.

    You receive column metadata (names and types) and a sample of result rows.
    Based on the data shape, recommend exactly 2 chart types from this list:
    bar, line, area, donut, radar

    Selection rules:
    - bar: best for comparing discrete categories or single numeric columns
    - line: best for time series or ordered sequential data with multiple series
    - area: like line but emphasizes volume/magnitude — use for cumulative or stacked data
    - donut: best for part-of-whole proportions with few categories (< 8)
    - radar: best for multi-dimensional comparison across several metrics

    Return ONLY a JSON object with this shape:
    {
      "chartProposals": [
        {
          "chartType": "bar",
          "label": "Bar chart — comparaison par catégorie",
          "rationale": "Short explanation of why this chart fits the data"
        },
        {
          "chartType": "line",
          "label": "Line chart — évolution temporelle",
          "rationale": "Short explanation of why this chart fits the data"
        }
      ],
      "recommendation": "bar",
      "analysisNote": "Brief data shape analysis"
    }
    """

    prompt = dspy.InputField(desc="Original user query")
    column_metadata = dspy.InputField(desc="JSON array of column definitions with name and type")
    sample_rows = dspy.InputField(desc="JSON array of first few result rows")
    row_count = dspy.InputField(desc="Total number of result rows")
    chart_proposals_json = dspy.OutputField(desc="JSON object with chartProposals array")


class QueryClassificationModule(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.predict = dspy.Predict(QueryClassificationSignature)

    def forward(self, prompt: str, catalog_info: str):
        return self.predict(prompt=prompt, catalog_info=catalog_info)


class PredictiveFunctionModule(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.predict = dspy.Predict(PredictiveFunctionSignature)

    def forward(self, prompt: str):
        return self.predict(prompt=prompt)


class RequiredColumnsModule(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.predict = dspy.Predict(RequiredColumnsSignature)

    def forward(self, prompt: str, schema_info: str):
        return self.predict(prompt=prompt, schema_info=schema_info)


class RephraseQueryModule(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.predict = dspy.Predict(RephraseQuerySignature)

    def forward(self, prompt: str, query_classification: str):
        return self.predict(prompt=prompt, query_classification=query_classification)


class SupervisorDecisionModule(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.predict = dspy.Predict(SupervisorDecisionSignature)

    def forward(
        self,
        prompt: str,
        catalog_info: str,
        query_classification: str,
        predictive_functions_json: str,
        required_columns_json: str,
        rewritten_prompt: str,
        conversation_context: str,
    ):
        return self.predict(
            prompt=prompt,
            catalog_info=catalog_info,
            query_classification=query_classification,
            predictive_functions_json=predictive_functions_json,
            required_columns_json=required_columns_json,
            rewritten_prompt=rewritten_prompt,
            conversation_context=conversation_context,
        )


class ChartRecommendationModule(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.predict = dspy.Predict(ChartRecommendationSignature)

    def forward(
        self,
        prompt: str,
        column_metadata: str,
        sample_rows: str,
        row_count: str,
    ):
        return self.predict(
            prompt=prompt,
            column_metadata=column_metadata,
            sample_rows=sample_rows,
            row_count=row_count,
        )


class SupervisorAgent(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.classifier = QueryClassificationModule()
        self.predictive = PredictiveFunctionModule()
        self.required_columns = RequiredColumnsModule()
        self.rephraser = RephraseQueryModule()
        self.decider = SupervisorDecisionModule()

    def forward(self, prompt: str, conversation_context: str, catalog_info: str) -> dict[str, Any]:
        classification_result = self.classifier(prompt=prompt, catalog_info=catalog_info)
        query_classification = str(getattr(classification_result, "classification", "General Information")).strip()

        predictive_result = self.predictive(prompt=prompt)
        predictive_functions_json = str(
            getattr(predictive_result, "predictive_functions_json", "[]")
        ).strip()

        columns_result = self.required_columns(prompt=prompt, schema_info=catalog_info)
        required_columns_json = str(
            getattr(columns_result, "required_columns_json", "[]")
        ).strip()

        rewritten_result = self.rephraser(
            prompt=prompt,
            query_classification=query_classification,
        )
        rewritten_prompt = str(getattr(rewritten_result, "rewritten_prompt", prompt)).strip() or prompt

        decision_result = self.decider(
            prompt=prompt,
            catalog_info=catalog_info,
            query_classification=query_classification,
            predictive_functions_json=predictive_functions_json,
            required_columns_json=required_columns_json,
            rewritten_prompt=rewritten_prompt,
            conversation_context=conversation_context,
        )

        parsed_decision = _parse_decision_json(
            str(getattr(decision_result, "decision_json", ""))
        )

        if not parsed_decision:
            return {
                "decision": "guide",
                "message": "L'agent IA n'a pas pu produire une décision structurée. Envoi à Genie avec le prompt reformulé.",
                "rewrittenPrompt": rewritten_prompt,
                "suggestedTables": [],
                "suggestedFunctions": [],
                "questions": [],
                "confidence": 0.3,
                "queryClassification": query_classification,
                "requiredColumns": _parse_json_array(required_columns_json),
                "predictiveFunctions": _parse_json_array(predictive_functions_json),
            }

        parsed_decision["queryClassification"] = query_classification
        parsed_decision["requiredColumns"] = _parse_json_array(required_columns_json)
        parsed_decision["predictiveFunctions"] = _parse_json_array(predictive_functions_json)
        if not parsed_decision.get("rewrittenPrompt"):
            parsed_decision["rewrittenPrompt"] = rewritten_prompt
        return parsed_decision


def _fallback_response(prompt: str, catalog_source: str) -> dict[str, Any]:
    return {
        "decision": "clarify",
        "message": "La demande nécessite une précision supplémentaire avant l'envoi à Genie.",
        "rewrittenPrompt": prompt,
        "suggestedTables": [],
        "suggestedFunctions": [],
        "questions": [
            {
                "id": "scope",
                "label": "Quel est le périmètre exact du contrôle à analyser ?",
                "inputType": "text",
                "required": True,
                "placeholder": "Exemple : fournisseurs, écritures de clôture, comptes 401",
            }
        ],
        "confidence": 0.15,
        "catalogSource": catalog_source,
    }


def _generate_supervisor_response(payload: dict[str, Any]) -> dict[str, Any]:
    prompt = str(payload.get("prompt", "")).strip()
    conversation_context = payload.get("conversationContext")
    raw_catalog = payload.get("genieCatalog")
    catalog = _normalize_catalog(raw_catalog)
    catalog_info = _catalog_prompt(catalog)

    config = _load_config()
    _setup_dspy_and_mlflow()

    agent = SupervisorAgent()

    with mlflow.start_run(run_name="dspy-proxy-agent") as run:
        lm_kwargs = {k: v for k, v in asdict(config).items() if v is not None}
        ctx_kwargs = {"lm": dspy.LM(**lm_kwargs)}

        with dspy.settings.context(**ctx_kwargs):
            mlflow.log_param("dspy_model", os.getenv("GENUI_DSPY_MODEL", "openai/gpt-4o-mini"))
            mlflow.log_param("prompt_length", len(prompt))
            mlflow.log_param("catalog_source", catalog.get("source", "payload"))
            mlflow.log_metric("catalog_table_count", float(len(catalog.get("tables", []))))
            mlflow.log_metric("catalog_function_count", float(len(catalog.get("functions", []))))
            _log_knowledge_store_summary(catalog)

            if not prompt:
                response = _fallback_response(prompt, catalog.get("source", "payload"))
            else:
                response = agent(
                    prompt=prompt,
                    conversation_context=_safe_json_dumps(conversation_context),
                    catalog_info=catalog_info,
                )

            response["traceId"] = run.info.run_id
            response["model"] = os.getenv("GENUI_DSPY_MODEL", "openai/gpt-4o-mini")
            response["catalogSource"] = catalog.get("source", "payload")
            _log_supervisor_tracking(response, conversation_context)
            return response


def _generate_chart_proposal(payload: dict[str, Any]) -> dict[str, Any]:
    """Analyze Genie query results and propose 2 chart types for user confirmation."""
    prompt = str(payload.get("prompt", "")).strip()
    statement_response = payload.get("statementResponse")

    if not statement_response or not isinstance(statement_response, dict):
        return {
            "chartProposals": [],
            "recommendation": None,
            "analysisNote": "No query results provided for chart analysis.",
        }

    manifest = statement_response.get("manifest", {})
    result = statement_response.get("result", {})
    columns = manifest.get("schema", {}).get("columns", [])
    data_array = result.get("data_array", [])

    if not columns or not data_array:
        return {
            "chartProposals": [],
            "recommendation": None,
            "analysisNote": "Empty result set — no chart applicable.",
        }

    column_metadata = [
        {"name": col.get("name", ""), "type": col.get("type_name", "STRING")}
        for col in columns
    ]
    sample_rows = data_array[:10]
    row_count = len(data_array)

    config = _load_config()
    _setup_dspy_and_mlflow()

    chart_module = ChartRecommendationModule()

    with mlflow.start_run(run_name="dspy-chart-proposal") as run:
        lm_kwargs = {k: v for k, v in asdict(config).items() if v is not None}
        ctx_kwargs = {"lm": dspy.LM(**lm_kwargs)}

        with dspy.settings.context(**ctx_kwargs):
            mlflow.log_param("dspy_model", os.getenv("GENUI_DSPY_MODEL", "openai/gpt-4o-mini"))
            mlflow.log_param("prompt_length", len(prompt))
            mlflow.log_param("column_count", len(column_metadata))
            mlflow.log_metric("row_count", float(row_count))

            result_obj = chart_module(
                prompt=prompt,
                column_metadata=_safe_json_dumps(column_metadata),
                sample_rows=_safe_json_dumps(sample_rows),
                row_count=str(row_count),
            )

            raw_proposals = str(getattr(result_obj, "chart_proposals_json", "{}")).strip()
            parsed = _parse_decision_json(raw_proposals)

            if not parsed or not isinstance(parsed.get("chartProposals"), list):
                return {
                    "chartProposals": [],
                    "recommendation": None,
                    "analysisNote": "Chart analysis did not return valid proposals.",
                    "traceId": run.info.run_id,
                }

            parsed["traceId"] = run.info.run_id
            mlflow.log_param("recommendation", parsed.get("recommendation", "none"))
            mlflow.log_metric(
                "proposal_count",
                float(len(parsed.get("chartProposals", []))),
            )
            return parsed


def main() -> None:
    raw_input = sys.stdin.read()
    if not raw_input.strip():
        print(json.dumps({
            "decision": "error",
            "message": "No input payload provided",
            "questions": [],
            "suggestedTables": [],
            "suggestedFunctions": [],
            "confidence": 0.0,
        }))
        sys.exit(1)

    try:
        payload = json.loads(raw_input)
    except Exception:
        print(json.dumps({
            "decision": "error",
            "message": "Invalid JSON input",
            "questions": [],
            "suggestedTables": [],
            "suggestedFunctions": [],
            "confidence": 0.0,
        }))
        sys.exit(1)

    mode = str(payload.get("mode", "supervisor")).strip()

    try:
        if mode == "chart-proposal":
            result = _generate_chart_proposal(payload)
        else:
            result = _generate_supervisor_response(payload)
        # Use ensure_ascii=True to avoid encoding issues on Windows pipes
        print(json.dumps(result, ensure_ascii=True))
    except Exception as exc:
        error_msg = str(exc)
        try:
            # Sanitize to ASCII-safe
            error_msg = error_msg.encode('ascii', errors='replace').decode('ascii')
        except Exception:
            error_msg = "Unknown proxy agent error"
        print(json.dumps({
            "decision": "error",
            "message": error_msg,
            "questions": [],
            "suggestedTables": [],
            "suggestedFunctions": [],
            "confidence": 0.0,
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()