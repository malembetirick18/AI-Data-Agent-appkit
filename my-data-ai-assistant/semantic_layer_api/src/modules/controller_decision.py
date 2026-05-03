"""
controller_decision.py — Tool-based agentic controller using `dspy.ReAct`.

Follows the DSPy module conventions documented at
https://dspy.ai/learn/programming/modules/ and the ReAct tutorial at
https://dspy.ai/tutorials/agents/:

  • `ControllerDecision` subclasses `dspy.Module`.
  • `__init__` defines a single submodule `self.react = dspy.ReAct(...)`.
  • `forward(**signature_inputs)` is a thin pass-through that returns a
    `dspy.Prediction` whose typed `result` field is a `ControllerDecisionResult`.

Tools are plain Python functions with descriptive docstrings — DSPy reads the
docstring as the tool description. Catalog state is request-scoped via a
`ContextVar` so the tools stay pickle-friendly for `dspy.streamify`.

Exports:
  - ControllerDecision: the `dspy.Module` exposed to the rest of the backend.
"""
from __future__ import annotations

import contextvars
import difflib
import json
from typing import Any, Literal

import dspy

from src.logger import Logger
from src.signatures.controller_agent.controller_agent_signature import (
    ControllerAgentSignature,
    ControllerDecisionResult,
)
from src.signatures.query_analysis.query_analysis_signature import QueryAnalysisSignature
from src.signatures.rephrase_query.rephrase_query_signature import RephraseQuerySignature
from src.signatures.utils.prompt_utils import (
    load_controller_agent_developer_prompt,
    load_query_analysis_developer_prompt,
    load_rephrase_query_developer_prompt,
)

logger = Logger("semantic-layer-api").child("controller")

controller_agent_developer_prompt = load_controller_agent_developer_prompt()
query_analysis_developer_prompt = load_query_analysis_developer_prompt()
rephrase_query_developer_prompt = load_rephrase_query_developer_prompt()

# High-confidence carve-out: when the LLM is very confident and catalog stripping
# would empty a field, trust the LLM — the catalog index may be incomplete.
_HIGH_CONFIDENCE_THRESHOLD = 0.85

# ── Guardrail constants ───────────────────────────────────────────────────────

_SCOPE_QUESTIONS: list[dict] = [
    {
        "id": "scope_level",
        "label": "Périmètre d'analyse",
        "inputType": "select",
        "required": True,
        "options": [
            {"value": "group", "label": "Groupe (toutes les filiales)"},
            {"value": "filiale", "label": "Filiale spécifique"},
        ],
    },
    {
        "id": "sp_folder_id",
        "label": "Identifiant de la filiale (sp_folder_id)",
        "inputType": "text",
        "required": False,
        "placeholder": "Ex: 12345 — requis si périmètre = Filiale spécifique",
    },
    {
        "id": "row_limit",
        "label": "Limite en nombre de lignes",
        "inputType": "number",
        "required": False,
        "min": 1,
        "max": 1000,
        "step": 1,
        "placeholder": "Ex: 100",
    },
]

_TEMPORAL_KEYWORDS = {"année", "annee", "exercice", "year", "fiscal", "trimestre", "semestre"}
_TEMPORAL_DISAMBIGUATED = {"année civile", "annee civile", "exercice comptable", "fiscal year", "calendar year"}

_TEMPORAL_QUESTIONS: list[dict] = [
    {
        "id": "period_type",
        "label": "Type de période",
        "inputType": "select",
        "required": True,
        "options": [
            {"value": "calendar_year", "label": "Année civile (janvier → décembre)"},
            {"value": "fiscal_year", "label": "Exercice comptable (dates d'ouverture/clôture de l'entité)"},
        ],
    },
    {
        "id": "period_year",
        "label": "Année",
        "inputType": "number",
        "required": False,
        "min": 2020,
        "max": 2030,
        "step": 1,
        "placeholder": "Ex: 2025",
    },
]


# ── Request-scoped context (catalog) ──────────────────────────────────────────
#
# Tools are module-level functions so that `dspy.ReAct` can bind them once at
# import time (compatible with `dspy.streamify` / `StreamListener`).  Each
# request's catalog is stashed into a `ContextVar` by `ControllerDecision.forward`
# before invoking the agent, and read back inside the tools.

_EMPTY_CTX: dict[str, Any] = {"catalog_info": "", "catalog_raw": None, "catalog_index": {}}
_request_ctx: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "controller_request_ctx", default=_EMPTY_CTX
)


def _build_catalog_index(catalog_info: str) -> dict:
    """Parse the catalog JSON and return sets of valid names for O(1) lookup."""
    try:
        catalog = json.loads(catalog_info) if catalog_info else None
    except (json.JSONDecodeError, ValueError):
        return {}
    if not isinstance(catalog, dict):
        return {}
    return {
        "tables": {t["name"] for t in catalog.get("tables", []) if isinstance(t, dict)},
        "columns": {
            c["name"]
            for t in catalog.get("tables", [])
            if isinstance(t, dict)
            for c in t.get("columns", [])
            if isinstance(c, dict)
        },
        "functions": {f["name"] for f in catalog.get("functions", []) if isinstance(f, dict)},
    }


def _parse_catalog_raw(catalog_info: str) -> dict | None:
    """Parse the catalog JSON once for descriptive lookups (tables/columns/functions)."""
    try:
        catalog = json.loads(catalog_info) if catalog_info else None
    except (json.JSONDecodeError, ValueError):
        return None
    return catalog if isinstance(catalog, dict) else None


# ── Tool 1 & 2 — Deterministic guardrails ────────────────────────────────────

def check_scope_coverage(_text: str) -> dict:
    """Check whether the analysis scope (groupe / filiale / sp_folder_id) is specified.

    ALWAYS call this FIRST — before classification, before any other tool — because
    scope ambiguity short-circuits the entire decision. The input `text` should be
    the user prompt concatenated with the conversation_context.

    Returns:
      {
        "scope_established": bool,
        "questions": list[dict],       # 3 scope questions when NOT established; [] otherwise
        "guardrail_source": "scope" | None
      }

    If scope_established is false you MUST set decision='clarify', copy the returned
    questions VERBATIM into your final decision, set guardrailSource='scope', cap
    confidence at 0.35, and STOP calling other tools.
    """
    # Scope (sp_folder_id + session) is always pre-established via the folder
    # picker in the UI — no keyword check needed.
    return {"scope_established": True, "questions": [], "guardrail_source": None}


def check_temporal_coverage(text: str) -> dict:
    """Check whether the temporal period (année civile vs exercice comptable) is disambiguated.

    ALWAYS call this SECOND (right after check_scope_coverage) for any query that
    might involve temporal reasoning. The input `text` should be the user prompt
    concatenated with the conversation_context.

    Returns:
      {
        "temporal_ambiguous": bool,
        "questions": list[dict],       # 2 temporal questions when ambiguous; [] otherwise
        "guardrail_source": "temporal" | None
      }

    If temporal_ambiguous is true you MUST set decision='clarify', copy the returned
    questions VERBATIM into your final decision, set guardrailSource='temporal', cap
    confidence at 0.40, and STOP.
    """
    lowered = (text or "").lower()
    has_temporal = any(kw in lowered for kw in _TEMPORAL_KEYWORDS)
    disambiguated = any(term in lowered for term in _TEMPORAL_DISAMBIGUATED)
    if not has_temporal or disambiguated:
        return {"temporal_ambiguous": False, "questions": [], "guardrail_source": None}
    return {
        "temporal_ambiguous": True,
        "questions": [dict(q) for q in _TEMPORAL_QUESTIONS],
        "guardrail_source": "temporal",
    }


# ── Tool 3 — classify_intent (LLM) ────────────────────────────────────────────

_analyze = dspy.ChainOfThought(
    QueryAnalysisSignature.with_instructions(query_analysis_developer_prompt)
)


def classify_intent(prompt: str) -> dict:
    """Classify the user query and extract required columns, SQL functions, and a coherence note.

    Call this once BOTH scope and temporal coverage have been confirmed. Uses the
    catalog_info from the current request context.

    Returns:
      {
        "classification": "Normal SQL" | "SQL Function" | "Predictive SQL" | "General Information",
        "required_columns": list[str],
        "sql_functions": list[str],
        "coherence_note": str
      }

    Use `classification` to decide whether to call rewrite_query next. If
    `coherence_note` is non-empty (AUDIT_PATTERN / POLYSEMOUS / INCOHERENT /
    PARAMETRIC), weigh it heavily — POLYSEMOUS or INCOHERENT often warrant
    decision='clarify'.
    """
    ctx = _request_ctx.get()
    catalog_info = ctx.get("catalog_info", "")
    try:
        out = _analyze(prompt=prompt, catalog_info=catalog_info)
    except Exception as exc:
        logger.warning("classify_intent failed: %s", exc, exc_info=True)
        return {
            "classification": "Normal SQL",
            "required_columns": [],
            "sql_functions": [],
            "coherence_note": "",
        }
    raw_class = (out.classification or "").strip()
    valid = {"Normal SQL", "SQL Function", "Predictive SQL", "General Information"}
    classification = raw_class if raw_class in valid else "Normal SQL"
    try:
        required_columns = json.loads(out.required_columns_json or "[]")
        required_columns = required_columns if isinstance(required_columns, list) else []
    except (json.JSONDecodeError, ValueError):
        required_columns = []
    try:
        sql_functions = json.loads(out.sql_functions_json or "[]")
        sql_functions = sql_functions if isinstance(sql_functions, list) else []
    except (json.JSONDecodeError, ValueError):
        sql_functions = []
    return {
        "classification": classification,
        "required_columns": required_columns,
        "sql_functions": sql_functions,
        "coherence_note": out.coherence_note or "",
    }


# ── Tool 4 — rewrite_query (LLM) ──────────────────────────────────────────────

_rephrase = dspy.ChainOfThought(
    RephraseQuerySignature.with_instructions(rephrase_query_developer_prompt)
)

_REPHRASE_CLASSIFICATIONS = {"SQL Function", "Predictive SQL", "General Information"}


def rewrite_query(prompt: str, query_classification: str) -> dict:
    """Rewrite the user query into a clearer Genie-friendly prompt.

    Only call this when classification is 'SQL Function', 'Predictive SQL', or
    'General Information'. Do NOT call for 'Normal SQL' — the original prompt is
    already Genie-friendly.

    Returns: { "rewritten_prompt": str }

    Put the returned rewritten_prompt into the `rewrittenPrompt` field of your
    final decision.
    """
    if query_classification not in _REPHRASE_CLASSIFICATIONS:
        return {"rewritten_prompt": prompt}
    try:
        out = _rephrase(prompt=prompt, query_classification=query_classification)
    except Exception as exc:
        logger.warning("rewrite_query failed: %s", exc, exc_info=True)
        return {"rewritten_prompt": prompt}
    rewritten = (out.rewritten_prompt or "").strip() or prompt
    return {"rewritten_prompt": rewritten}


# ── Tool 5 — lookup_catalog (programmatic fuzzy match) ───────────────────────

def lookup_catalog(
    intent: str, kind: Literal["table", "column", "function"], limit: int = 8
) -> dict:
    """Fuzzy-match an intent phrase against catalog entries of a specific kind.

    Use this when you need to discover which tables, columns, or functions are
    relevant to the user query before committing them to your decision.

    Args:
      intent: natural-language phrase describing what you are looking for
      kind: "table", "column", or "function"
      limit: maximum number of candidates to return (default 8)

    Returns:
      {
        "candidates": [
          { "name": str, "description": str, "score": float },
          ...
        ]
      }
    """
    ctx = _request_ctx.get()
    catalog = ctx.get("catalog_raw")
    if not isinstance(catalog, dict):
        return {"candidates": []}

    intent_lower = (intent or "").lower()

    if kind == "table":
        entries = [
            (t.get("name", ""), t.get("description", "") or "")
            for t in catalog.get("tables", []) if isinstance(t, dict)
        ]
    elif kind == "column":
        entries = [
            (c.get("name", ""), c.get("description", "") or "")
            for t in catalog.get("tables", []) if isinstance(t, dict)
            for c in t.get("columns", []) if isinstance(c, dict)
        ]
    elif kind == "function":
        entries = [
            (f.get("name", ""), f.get("description", "") or "")
            for f in catalog.get("functions", []) if isinstance(f, dict)
        ]
    else:
        return {"candidates": []}

    names = [n for n, _ in entries if n]
    description_by_name = {n: d for n, d in entries if n}

    # Combine two signals: (1) difflib ratio on names, (2) substring match in description.
    scored: dict[str, float] = {}
    for name in names:
        ratio = difflib.SequenceMatcher(None, intent_lower, name.lower()).ratio()
        desc = description_by_name.get(name, "").lower()
        substr_bonus = 0.25 if intent_lower and intent_lower in desc else 0.0
        scored[name] = max(scored.get(name, 0.0), ratio + substr_bonus)

    # Also boost names matched directly against intent tokens
    for token in intent_lower.split():
        if len(token) < 3:
            continue
        for name in difflib.get_close_matches(token, [n.lower() for n in names], n=5, cutoff=0.6):
            original = next((n for n in names if n.lower() == name), None)
            if original:
                scored[original] = max(scored.get(original, 0.0), 0.65)

    ranked = sorted(scored.items(), key=lambda it: it[1], reverse=True)[: max(1, int(limit))]
    return {
        "candidates": [
            {"name": name, "description": description_by_name.get(name, ""), "score": round(score, 3)}
            for name, score in ranked
            if score > 0.0
        ]
    }


# ── Tool 6 — validate_catalog_names (programmatic — last line of defence) ────

def _compute_guidance(
    invalid: dict, provided_tables: list[str], remaining_valid_tables: list[str]
) -> str:
    if not invalid["tables"] and not invalid["columns"] and not invalid["functions"]:
        return "All supplied names are valid. Proceed with your planned decision — no penalty."

    parts: list[str] = []
    if provided_tables and not remaining_valid_tables:
        parts.append(
            "All suggested tables are invalid. Set decision='clarify' and confidence ≤ 0.45 "
            "(Rule 1). Empty the suggestedTables list. Explain to the user that no valid "
            "data source matches their query."
        )
    elif invalid["tables"] or invalid["columns"] or invalid["functions"]:
        parts.append(
            "Some names are invalid but at least one valid table remains. If your planned "
            "decision was 'proceed' or 'guide', downgrade to 'guide' with confidence ≤ 0.70 "
            "(Rule 2). Strip the invalid names from the corresponding fields."
        )
    parts.append(
        "HIGH-CONFIDENCE CARVE-OUT: if your own confidence was already ≥ 0.85 AND stripping "
        "invalid names would empty suggestedTables/suggestedFunctions/predictiveFunctions, "
        "trust yourself — keep the original names, proceed without penalty. The catalog index "
        "may be incomplete (e.g. materialized views not registered)."
    )
    return " ".join(parts)


def validate_catalog_names(
    tables: list[str] | None = None,
    columns: list[str] | None = None,
    functions: list[str] | None = None,
) -> dict:
    """Verify that every supplied table, column, and function name exists in the catalog.

    ALWAYS call this as the LAST tool, immediately before returning your final
    decision, to catch any hallucinated names.

    Returns:
      {
        "valid":    { "tables": [...], "columns": [...], "functions": [...] },
        "invalid":  { "tables": [...], "columns": [...], "functions": [...] },
        "guidance": str
      }

    Apply the guidance VERBATIM — do not second-guess it.
    """
    ctx = _request_ctx.get()
    idx = ctx.get("catalog_index") or {}
    tables_list = [t for t in (tables or []) if isinstance(t, str)]
    columns_list = [c for c in (columns or []) if isinstance(c, str)]
    functions_list = [f for f in (functions or []) if isinstance(f, str)]

    valid_tables_set = idx.get("tables", set())
    valid_columns_set = idx.get("columns", set())
    valid_functions_set = idx.get("functions", set())

    # With no catalog index we cannot validate — return all names as valid.
    if not idx:
        return {
            "valid": {"tables": tables_list, "columns": columns_list, "functions": functions_list},
            "invalid": {"tables": [], "columns": [], "functions": []},
            "guidance": "Catalog index unavailable — skipping validation. Proceed with your planned decision.",
        }

    valid = {
        "tables": [t for t in tables_list if t in valid_tables_set],
        "columns": [c for c in columns_list if c in valid_columns_set],
        "functions": [f for f in functions_list if f in valid_functions_set],
    }
    invalid = {
        "tables": [t for t in tables_list if t not in valid_tables_set],
        "columns": [c for c in columns_list if c not in valid_columns_set],
        "functions": [f for f in functions_list if f not in valid_functions_set],
    }
    guidance = _compute_guidance(invalid, tables_list, valid["tables"])
    return {"valid": valid, "invalid": invalid, "guidance": guidance}


# ── The agent ────────────────────────────────────────────────────────────────

class ControllerDecision(dspy.Module):
    """ReAct controller agent.

    Routes a French accounting prompt through six tools (two deterministic
    guardrails, two LLM-backed classifiers, a catalog fuzzy-match, and a
    name-validator) and emits a typed `ControllerDecisionResult` describing
    whether to proceed, guide, clarify, or refuse.

    The agent's developer prompt (loaded from
    `signatures/controller_agent/`) explains tool ordering and decision rules
    — the tool docstrings are kept short enough to act as schema hints, with
    detailed policy living in the prompt.
    """

    def __init__(self) -> None:
        super().__init__()
        self.react = dspy.ReAct(
            ControllerAgentSignature.with_instructions(controller_agent_developer_prompt),
            tools=[
                check_scope_coverage,
                check_temporal_coverage,
                classify_intent,
                rewrite_query,
                lookup_catalog,
                validate_catalog_names,
            ],
            max_iters=8,
        )

    def forward(
        self,
        source_text: str,
        catalog_info: str = "",
        conversation_context: str = "",
    ) -> dspy.Prediction:
        """Run the ReAct loop and return a `dspy.Prediction`.

        `prediction.result` is a `ControllerDecisionResult` (typed pydantic
        model). `prediction.reasoning` carries the streamed extract reasoning
        when the call is consumed via `dspy.streamify`.

        The catalog is stashed in a request-scoped `ContextVar` so the
        module-level tools can read it without it being part of the LLM
        context.
        """
        catalog_raw = _parse_catalog_raw(catalog_info)
        catalog_index = _build_catalog_index(catalog_info)
        token = _request_ctx.set(
            {
                "catalog_info": catalog_info,
                "catalog_raw": catalog_raw,
                "catalog_index": catalog_index,
            }
        )
        try:
            return self.react(
                prompt=source_text,
                catalog_info=catalog_info,
                conversation_context=conversation_context,
            )
        finally:
            _request_ctx.reset(token)


__all__ = [
    "ControllerDecision",
    "ControllerDecisionResult",
    "check_scope_coverage",
    "check_temporal_coverage",
    "classify_intent",
    "rewrite_query",
    "lookup_catalog",
    "validate_catalog_names",
]
