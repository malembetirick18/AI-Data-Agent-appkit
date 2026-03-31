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

        # Return dspy.Prediction to enable MLflow LM usage tracking.
        # Prediction.get() is dict-compatible — callers need no changes.
        return dspy.Prediction(**decision)
