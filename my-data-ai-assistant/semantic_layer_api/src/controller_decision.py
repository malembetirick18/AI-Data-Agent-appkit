"""
controller_decision.py — DSPy agent pipeline for the semantic layer API.

Exports:
  - ControllerDecision: multi-step controller agent implementing the Reflexion pattern
    (Actor → Evaluator → Self-Reflection → Corrector)
"""
import json
import os
from typing import Any

import dspy

from src.logger import Logger
from src.signatures.controller_decision_signature import ControllerDecisionSignature
from src.signatures.rephrase_query_signature import RephraseQuerySignature
from src.signatures.query_analysis_signature import QueryAnalysisSignature

# Reflexion signatures — imported unconditionally so type checkers can resolve them;
# the DSPy modules are only instantiated when _REFLECTION_ENABLED is True.
from src.signatures.controller_self_reflection_signature import ControllerSelfReflectionSignature
from src.signatures.controller_correction_signature import ControllerCorrectionSignature

# Child of the root "semantic-layer-api" logger — propagates to its handler, no double output.
_logger = Logger("semantic-layer-api").child("controller")

# Self-reflection + correction passes are gated behind an env flag.
# In dev they add two extra LLM calls per request; keeping them off avoids latency overhead.
# Pattern: Programmatic Evaluator (3b) → Self-Reflection LLM (3c) → Corrector LLM (4).
_REFLECTION_ENABLED = os.getenv("ENABLE_CONTROLLER_REFLECTION", "false").lower() == "true"

# Catalog validation: when Phase-3 confidence is at or above this threshold, trust the LLM's
# table choice even if it is absent from the catalog index. Catalog may be incomplete.
_HIGH_CONFIDENCE_THRESHOLD = 0.85


# ── Catalog validation helpers ────────────────────────────────────────────────

def _build_catalog_index(catalog_info: str) -> dict:
    """Parse the catalog JSON string and return sets of valid names for O(1) lookup."""
    try:
        catalog = json.loads(catalog_info)
    except Exception:
        return {}
    return {
        "tables":    {t["name"] for t in catalog.get("tables", [])},
        "columns":   {c["name"] for t in catalog.get("tables", []) for c in t.get("columns", [])},
        "functions": {f["name"] for f in catalog.get("functions", [])},
    }


def _validate_against_catalog(
    decision: dict, index: dict, phase3_confidence: float = 0.0
) -> tuple[dict, dict]:
    """Strip names not present in the catalog index.

    Returns (cleaned_decision, removed_by_field) where removed_by_field maps
    field name → list of hallucinated values that were stripped.
    """
    removed: dict[str, list] = {}
    for key, valid_set in [
        ("suggestedTables",     index.get("tables",    set())),
        ("requiredColumns",     index.get("columns",   set())),
        ("predictiveFunctions", index.get("functions", set())),
        ("suggestedFunctions",  index.get("functions", set())),
    ]:
        if not valid_set:
            continue
        original = decision.get(key, [])
        if not isinstance(original, list):
            continue
        cleaned = [v for v in original if v in valid_set]
        if len(cleaned) != len(original):
            # High-confidence trust: if Phase-3 was very confident and stripping would
            # empty suggestedTables, trust the LLM — the catalog may be incomplete.
            if key == "suggestedTables" and not cleaned and phase3_confidence >= _HIGH_CONFIDENCE_THRESHOLD:
                continue
            removed[key] = [v for v in original if v not in valid_set]
            decision[key] = cleaned
    # Generalized hallucination penalty — applies to any decision type.
    #
    # Rule 1 (hardest): suggestedTables stripped to empty under ANY decision
    #   → 'clarify' (confidence ≤ 0.45).  No valid data source means the model
    #   cannot guide the user; asking for clarification is the only safe path.
    #
    # Rule 2 (heavy): other fields hallucinated but at least one valid table remains,
    #   AND the original decision was 'proceed' or 'guide'
    #   → 'guide' (confidence ≤ 0.70).  The data source is known but the model
    #   fabricated details, so a direct execute is unsafe.
    #
    # 'clarify' and 'error' decisions that already have hallucinations are left at
    # their decision value — they are already conservative.
    if removed:
        tables_now_empty = (
            "suggestedTables" in removed and not decision.get("suggestedTables")
        )
        if tables_now_empty:
            decision["decision"] = "clarify"
            decision["confidence"] = min(float(decision.get("confidence", 0.0)), 0.45)
        elif decision.get("decision") in {"proceed", "guide"}:
            decision["decision"] = "guide"
            decision["confidence"] = min(float(decision.get("confidence", 0.0)), 0.70)
    return decision, removed


def _build_validation_feedback(removed: dict, decision: dict) -> str:
    """Convert the programmatic validation diff into a verbal feedback string.

    This is the evaluator's output (Reflexion 'semantic gradient signal') that is
    passed explicitly to the self-reflection LLM so it does not have to re-discover
    problems from scratch.
    """
    if not removed:
        return "No hallucinations detected. Decision is structurally consistent with the catalog."
    parts = []
    for field, names in removed.items():
        parts.append(f"  - {field}: {names} do not exist in the catalog and were removed.")
    if not decision.get("suggestedTables") and "suggestedTables" in removed:
        parts.append(
            "  - suggestedTables is now empty after stripping hallucinations — decision downgraded to "
            "'clarify' (confidence ≤ 0.45). No valid data source remains; the user must specify "
            "the correct table or view before any query can be attempted."
        )
    elif decision.get("decision") == "guide" and removed:
        parts.append(
            "  - Hallucinated names were stripped but at least one valid table remains — "
            "decision downgraded to 'guide' (confidence ≤ 0.70). "
            "Direct execution is unsafe; user confirmation is required."
        )
    return "Programmatic catalog validation found the following issues:\n" + "\n".join(parts)

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
    Multi-step controller agent implementing the full Reflexion pattern (Shinn et al., 2023):

    1. Phase 1:   combined analysis (classify + columns + functions) — 1 LLM call  [Actor]
    2. Phase 2:   rephrase query — only for SQL Function / Predictive SQL / General Info  [Actor]
    3. Phase 3:   controller decision (proceed / guide / clarify / error)  [Actor]
    3b. Eval:    programmatic catalog validation — strips hallucinations, builds feedback  [Evaluator]
    3c. Reflect: self-reflection LLM — diagnoses WHY the decision failed (verbal)  [Self-Reflection]
    4. Phase 4:  correction LLM — applies self_reflection_text to produce corrected JSON  [Actor retry]
                 Gated behind ENABLE_CONTROLLER_REFLECTION (off in dev, on in production)

    Reflexion roles: Actor (Phases 1–3) → Evaluator (3b) → Self-Reflection (3c) → Actor retry (4).
    Single-pass (no memory accumulation) — one correction cycle per request.
    DSPy's LM num_retries handles API-level retries. JSONAdapter guarantees structured JSON output.
    """

    def __init__(self):
        super().__init__()
        self.analyze_query = dspy.ChainOfThought(QueryAnalysisSignature)
        self.rephrase_query = dspy.ChainOfThought(RephraseQuerySignature)
        self.controller_decision = dspy.ChainOfThought(ControllerDecisionSignature)
        self.self_reflect: dspy.ChainOfThought | None = None
        self.correct_decision: dspy.ChainOfThought | None = None
        if _REFLECTION_ENABLED:
            self.self_reflect = dspy.ChainOfThought(ControllerSelfReflectionSignature)
            self.correct_decision = dspy.ChainOfThought(ControllerCorrectionSignature)

    def forward(
        self,
        source_text: str,
        catalog_info: str = "",
        conversation_context: str = "",
    ) -> dspy.Prediction:
        # Phase 1: single combined analysis — replaces 3 sequential calls
        analysis = self.analyze_query(prompt=source_text, catalog_info=catalog_info)

        raw_class = analysis.classification.strip()
        query_classification = raw_class if raw_class in _VALID_CLASSIFICATIONS else "Normal SQL"

        required_columns_json: str = analysis.required_columns_json or "[]"
        sql_functions_json: str = analysis.sql_functions_json or "[]"
        coherence_note: str = analysis.coherence_note or ""

        _logger.info("Phase-1 classification=%r columns=%s functions=%s",
                     query_classification,
                     required_columns_json[:80],
                     sql_functions_json[:80])
        if coherence_note:
            _logger.info("Phase-1 coherence note: %s", coherence_note[:120])

        # Phase 2: conditional rephrase — skip for clear Normal SQL queries
        if query_classification in _REPHRASE_CLASSIFICATIONS:
            _logger.info("Phase-2 rephrasing prompt for classification=%r", query_classification)
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

        try:
            decision: dict[str, Any] = json.loads(raw.decision_json)
            if not isinstance(decision, dict):
                raise ValueError(f"Expected dict, got {type(decision).__name__}")
        except (json.JSONDecodeError, ValueError) as exc:
            _logger.error("Phase-3 decision_json parse failed: %s — raw=%r", exc, raw.decision_json)
            decision = {"decision": "error", "confidence": 0.0, "message": "Réponse du contrôleur invalide."}

        # Enrich with pipeline metadata not always returned by the LLM
        decision.setdefault("rewrittenPrompt", rewritten_prompt)
        decision.setdefault("queryClassification", query_classification)
        decision.setdefault("suggestedTables", [])
        decision.setdefault("suggestedFunctions", [])
        decision.setdefault("questions", [])
        decision.setdefault("confidence", 0.0)
        decision.setdefault("message", "")
        decision.setdefault("needsParams", False)
        try:
            decision["requiredColumns"] = json.loads(required_columns_json) if required_columns_json else []
            if not isinstance(decision["requiredColumns"], list):
                decision["requiredColumns"] = []
        except (json.JSONDecodeError, ValueError):
            decision["requiredColumns"] = []
        try:
            decision["predictiveFunctions"] = json.loads(sql_functions_json) if sql_functions_json else []
            if not isinstance(decision["predictiveFunctions"], list):
                decision["predictiveFunctions"] = []
        except (json.JSONDecodeError, ValueError):
            decision["predictiveFunctions"] = []
        decision.setdefault("coherenceNote", coherence_note)

        _logger.info("Phase-3 decision=%r confidence=%.2f tables=%s needsParams=%s",
                     decision.get("decision"),
                     float(decision.get("confidence", 0.0)),
                     decision.get("suggestedTables", []),
                     decision.get("needsParams", False))

        # ── Phase 3b — Programmatic evaluator (always runs, zero cost) ─────────────────────────
        # Strips hallucinated table/column/function names against the catalog index and builds
        # a verbal feedback string. This output is passed explicitly to the LLM corrector in
        # Phase 4 so it does not have to re-derive what went wrong from scratch.
        catalog_index = _build_catalog_index(catalog_info)
        removed: dict[str, list] = {}
        validation_feedback = ""
        if catalog_index:
            phase3_confidence = float(decision.get("confidence", 0.0))
            decision, removed = _validate_against_catalog(decision, catalog_index, phase3_confidence)
            validation_feedback = _build_validation_feedback(removed, decision)
            if removed:
                _logger.info(
                    "Phase-3b stripped %d hallucinated names from fields: %s → decision now=%r confidence=%.2f",
                    sum(len(v) for v in removed.values()),
                    list(removed.keys()),
                    decision.get("decision"),
                    float(decision.get("confidence", 0.0)),
                )
            else:
                _logger.debug("Phase-3b catalog validation clean")

        # ── Scope guardrail ──────────────────────────────────────────────────
        # Runs before Reflexion so scope-forced clarify decisions never enter
        # the costly Phase 3c+4 path.
        if not _scope_established(source_text, conversation_context):
            raw_questions = decision.get("questions", [])
            existing_questions: list[dict] = raw_questions if isinstance(raw_questions, list) else []
            has_scope = any(isinstance(q, dict) and q.get("id") == "scope_level" for q in existing_questions)
            if not has_scope:
                _logger.info("Scope guardrail fired — overriding to 'clarify', injecting %d scope questions",
                             len(_SCOPE_QUESTIONS))
                decision["decision"] = "clarify"
                decision["questions"] = _SCOPE_QUESTIONS + existing_questions
                if not decision.get("message"):
                    decision["message"] = "Veuillez préciser le périmètre d'analyse avant de continuer."
                decision["confidence"] = min(float(decision.get("confidence", 0.0)), 0.35)

        # ── Phases 3c + 4 — Full Reflexion cycle (production only) ──────────────────────────
        # Reflexion pattern (Shinn et al., 2023):
        #   Phase 3c — Self-Reflection LLM: reads evaluator feedback and produces a verbal
        #              diagnosis of WHY the decision was wrong (not just WHAT is wrong).
        #   Phase 4  — Correction LLM: uses both the evaluator feedback (3b) and the verbal
        #              diagnosis (3c) to produce a corrected, structurally consistent JSON.
        # Only fires for proceed/guide — clarify/error are already conservative.
        # Only fires when there is a real signal (hallucinations found OR coherence issue).
        # Single reflection+correction cycle per request (synchronous latency constraint).
        # A second programmatic validation after correction closes the evaluation loop.
        _has_reflection_signal = bool(removed) or bool(coherence_note)
        if (
            self.self_reflect is not None
            and self.correct_decision is not None
            and decision.get("decision") in {"proceed", "guide"}
            and _has_reflection_signal
        ):
            try:
                # Phase 3c — Self-Reflection: verbal diagnosis of the decision's flaws
                _logger.info("Phase-3c self-reflection triggered for decision=%r", decision.get("decision"))
                raw_reflection = self.self_reflect(
                    prompt=source_text,
                    coherence_note=coherence_note,
                    original_decision_json=json.dumps(decision),
                    validation_feedback=validation_feedback,
                )
                self_reflection_text: str = raw_reflection.self_reflection_text or ""
                _logger.info("Phase-3c self-reflection: %s", self_reflection_text)

                # Phase 4 — Correction: apply evaluator feedback + verbal diagnosis
                raw_correction = self.correct_decision(
                    prompt=source_text,
                    catalog_info=catalog_info,
                    coherence_note=coherence_note,
                    original_decision_json=json.dumps(decision),
                    validation_feedback=validation_feedback,
                    self_reflection_text=self_reflection_text,
                )
                try:
                    corrected = json.loads(raw_correction.corrected_decision_json)
                except json.JSONDecodeError as parse_exc:
                    _logger.error(
                        "Phase-4 corrected_decision_json parse failed: %s — raw=%r",
                        parse_exc,
                        raw_correction.corrected_decision_json[:200],
                    )
                    raise
                if not isinstance(corrected, dict):
                    raise ValueError(
                        f"Corrector returned {type(corrected).__name__} instead of dict — "
                        f"raw={raw_correction.corrected_decision_json[:120]!r}"
                    )
                # Preserve pipeline-injected fields — the corrector must not override these
                corrected["rewrittenPrompt"]     = decision.get("rewrittenPrompt", rewritten_prompt)
                corrected["queryClassification"] = decision.get("queryClassification", query_classification)
                corrected["coherenceNote"]       = coherence_note
                # Preserve questions: corrector focuses on structure/confidence, not UX questions.
                # If it returned none but the original had questions, keep the originals.
                if not corrected.get("questions") and decision.get("questions"):
                    corrected["questions"] = decision["questions"]
                # Second evaluation cycle: re-run programmatic validator on corrected output
                if catalog_index:
                    corrected, _ = _validate_against_catalog(corrected, catalog_index)
                _logger.info("Phase-4 corrected decision=%r confidence=%.2f",
                             corrected.get("decision"), float(corrected.get("confidence", 0.0)))
                decision = corrected
            except Exception as exc:
                _logger.warning(
                    "Reflexion cycle (3c+4) failed (non-fatal) — keeping Phase 3b decision. Error: %s",
                    exc,
                    exc_info=True,
                )

        # Return dspy.Prediction to enable MLflow LM usage tracking.
        # Prediction.get() is dict-compatible — callers need no changes.
        return dspy.Prediction(**decision)
