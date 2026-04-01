"""
controller_decision.py — DSPy agent pipeline for the semantic layer API.

Exports:
  - ControllerDecision: multi-step controller agent (analyse → rephrase → decide)
"""
import json
from typing import Any

import dspy

from src.signatures.controller_decision_signature import ControllerDecisionSignature
from src.signatures.rephrase_query_signature import RephraseQuerySignature
from src.signatures.query_analysis_signature import QueryAnalysisSignature

_VALID_CLASSIFICATIONS = {"Normal SQL", "SQL Function", "Predictive SQL", "General Information"}
# Only rephrase when the query needs enrichment — SQL Function and Predictive SQL
# require function names made explicit; General Information needs reformulation for Genie.
# Clear Normal SQL queries are sent as-is.
_REPHRASE_CLASSIFICATIONS = {"SQL Function", "Predictive SQL", "General Information"}

# ── Scope guardrail ───────────────────────────────────────────────────────────
# These keywords indicate the user has already specified the analysis scope.
# Checked case-insensitively in both the prompt and the conversation context.
_SCOPE_KEYWORDS = {"groupe", "filiale", "sp_folder_id", "group", "subsidiary"}

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


def _scope_established(source_text: str, conversation_context: str) -> bool:
    """Return True if analysis scope is already known from the prompt or conversation."""
    combined = (source_text + " " + conversation_context).lower()
    return any(kw in combined for kw in _SCOPE_KEYWORDS)


# ── Controller agent ──────────────────────────────────────────────────────────

class ControllerDecision(dspy.Module):
    """
    Multi-step controller agent:
    1. Phase 1: combined analysis (classify + columns + functions) — 1 LLM call
    2. Phase 2: rephrase query — only for SQL Function / Predictive SQL / General Information
    3. Phase 3: controller decision (proceed / guide / clarify / error)

    DSPy's LM num_retries handles API-level retries.
    JSONAdapter guarantees structured JSON output.
    """

    def __init__(self):
        super().__init__()
        self.analyse_query = dspy.ChainOfThought(QueryAnalysisSignature)
        self.rephrase_query = dspy.ChainOfThought(RephraseQuerySignature)
        self.controller_decision = dspy.ChainOfThought(ControllerDecisionSignature)

    def forward(
        self,
        source_text: str,
        catalog_info: str = "",
        conversation_context: str = "",
    ) -> dspy.Prediction:
        # Phase 1: single combined analysis — replaces 3 sequential calls
        analysis = self.analyse_query(prompt=source_text, catalog_info=catalog_info)

        raw_class = analysis.classification.strip()
        query_classification = raw_class if raw_class in _VALID_CLASSIFICATIONS else "Normal SQL"

        required_columns_json: str = analysis.required_columns_json or "[]"
        sql_functions_json: str = analysis.sql_functions_json or "[]"
        coherence_note: str = analysis.coherence_note or ""

        # Phase 2: conditional rephrase — skip for clear Normal SQL queries
        if query_classification in _REPHRASE_CLASSIFICATIONS:
            rewritten = self.rephrase_query(
                prompt=source_text, query_classification=query_classification
            )
            rewritten_prompt: str = rewritten.rewritten_prompt.strip() or source_text
        else:
            rewritten_prompt = source_text

        # Phase 3: controller decision — DSPy + JSONAdapter guarantees valid JSON output
        raw = self.controller_decision(
            prompt=source_text,
            catalog_info=catalog_info,
            query_classification=query_classification,
            sql_functions_json=sql_functions_json,
            required_columns_json=required_columns_json,
            rewritten_prompt=rewritten_prompt,
            conversation_context=conversation_context,
            coherence_note=coherence_note,
        )

        decision: dict[str, Any] = json.loads(raw.decision_json)

        # Enrich with pipeline metadata not always returned by the LLM
        decision.setdefault("rewrittenPrompt", rewritten_prompt)
        decision.setdefault("queryClassification", query_classification)
        decision.setdefault("suggestedTables", [])
        decision.setdefault("suggestedFunctions", [])
        decision.setdefault("questions", [])
        decision.setdefault("confidence", 0.0)
        decision.setdefault("message", "")
        decision.setdefault("needsParams", False)
        decision["requiredColumns"] = json.loads(required_columns_json)
        decision["predictiveFunctions"] = json.loads(sql_functions_json)
        decision.setdefault("coherenceNote", coherence_note)

        # ── Scope guardrail ──────────────────────────────────────────────────
        # If scope (groupe/filiale) is not established in the prompt or context,
        # inject the three scope questions at the top of the clarification list.
        # This is a programmatic check — the LLM rule alone is not reliable enough.
        if not _scope_established(source_text, conversation_context):
            existing_questions: list[dict] = decision.get("questions", [])
            has_scope = any(q.get("id") == "scope_level" for q in existing_questions)
            if not has_scope:
                decision["decision"] = "clarify"
                decision["questions"] = _SCOPE_QUESTIONS + existing_questions
                if not decision.get("message"):
                    decision["message"] = "Veuillez préciser le périmètre d'analyse avant de continuer."
                decision["confidence"] = min(float(decision.get("confidence", 0.0)), 0.35)

        # Return dspy.Prediction to enable MLflow LM usage tracking.
        # Prediction.get() is dict-compatible — callers need no changes.
        return dspy.Prediction(**decision)
