import dspy


class ControllerSelfReflectionSignature(dspy.Signature):

    prompt = dspy.InputField(desc="Original user query")
    coherence_note = dspy.InputField(desc="Semantic coherence analysis from Phase 1")
    original_decision_json = dspy.InputField(desc="Decision JSON produced by Phase 3")
    validation_feedback = dspy.InputField(
        desc=(
            "Verbal output from the programmatic catalog validator — lists hallucinated names "
            "that were removed and structural issues found. This is the evaluator signal."
        )
    )
    self_reflection_text = dspy.OutputField(
        desc=(
            "Concise verbal diagnosis explaining why the decision needs correction and what "
            "the corrector must specifically change. Plain text, 3–6 sentences."
        )
    )
