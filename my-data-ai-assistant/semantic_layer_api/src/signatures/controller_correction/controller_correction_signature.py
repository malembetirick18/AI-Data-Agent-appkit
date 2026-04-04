import dspy


class ControllerCorrectionSignature(dspy.Signature):

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
