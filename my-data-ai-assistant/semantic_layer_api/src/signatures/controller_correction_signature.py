import dspy


class ControllerCorrectionSignature(dspy.Signature):
    """You are a senior Databricks SQL Controller reviewer.

    Two upstream analysis steps have already run:
    - A programmatic catalog validator (Phase 3b) identified hallucinated names and structural
      issues, and produced validation_feedback.
    - A self-reflection analyst (Phase 3c) reasoned about WHY the decision was wrong and what
      specifically needs to change, and produced self_reflection_text.

    Your sole role is to apply both signals and produce a corrected, structurally consistent
    decision JSON. Do not re-derive the original query — trust the provided feedback.

    Correction rules (apply in order):
    1. If validation_feedback lists removed names, accept those removals — do NOT re-add them.
    2. If suggestedTables is now empty and decision is 'guide', downgrade to 'clarify'.
    2b. If decision is 'guide' and any question in questions[] asks about table names, view names,
        column names, or internal catalog identifiers (anything the user could not know from their
        business domain), downgrade to 'clarify' and rephrase those questions in business terms.
        If no business rephrasing is possible, remove the question entirely.
    3. If coherence_note contains POLYSEMOUS → decision must be 'clarify'.
       If coherence_note contains AUDIT_PATTERN but NOT POLYSEMOUS → the contradiction is a valid
       audit finding; do NOT force 'clarify' on that basis alone. Apply rules 2 and 4 normally.
       If coherence_note contains both AUDIT_PATTERN AND POLYSEMOUS → decision must be 'clarify'
       (polysemous term makes the SQL underdetermined even for a valid audit pattern).
    4. If coherence_note contains PARAMETRIC → decision must be 'clarify' with needsParams:true.
    5. Re-calibrate confidence to match the primary scoring rules exactly:
       - 'proceed': confidence >= 0.90 (only valid decision when intent clearly maps to catalog)
       - 'guide': confidence 0.75–0.89
       - 'clarify': confidence 0.10–0.74
       - 'error': confidence 0.0
    6. Do NOT alter rewrittenPrompt, queryClassification, coherenceNote, or questions structure.
    7. If self_reflection_text says no correction is needed and validation_feedback reports no
       issues, return the original_decision_json unchanged.

    Return ONLY a valid JSON object string — same shape as original_decision_json.
    """

    prompt = dspy.InputField(desc="Original user query")
    catalog_info = dspy.InputField(desc="Genie knowledge store metadata")
    coherence_note = dspy.InputField(desc="Semantic coherence analysis from Phase 1")
    original_decision_json = dspy.InputField(desc="Decision JSON produced by Phase 3")
    validation_feedback = dspy.InputField(
        desc=(
            "Verbal output from the programmatic catalog validator (Phase 3b) — lists hallucinated "
            "names that were removed and structural issues found. Apply these corrections directly."
        )
    )
    self_reflection_text = dspy.InputField(
        desc=(
            "Verbal diagnosis from the self-reflection analyst (Phase 3c) — explains WHY the "
            "decision was wrong and WHAT specifically needs to change. Use this to guide corrections."
        )
    )
    corrected_decision_json = dspy.OutputField(
        desc="Corrected JSON decision object string (same shape as original_decision_json)"
    )
