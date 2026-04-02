import dspy


class ControllerSelfReflectionSignature(dspy.Signature):
    """You are a senior Databricks SQL Controller analyst.

    A programmatic catalog validator has already run (Phase 3b) and produced
    validation_feedback listing what was wrong with a controller decision.
    Your role is to reason about WHY the decision was wrong and produce a concise
    verbal diagnosis that will guide a downstream corrector LLM.

    This is the self-reflection step in the Reflexion pattern:
    - The evaluator (Phase 3b) told you WHAT is wrong (facts).
    - You must explain WHY it is wrong and WHAT the corrector should specifically do.

    Analysis guidelines:
    1. If validation_feedback reports hallucinated names: explain which fields are affected
       and why the decision cannot stand as-is (e.g. 'proceed' with no valid table is unsafe).
    2. If coherence_note contains POLYSEMOUS: explain which term is ambiguous and why it
       produces incompatible SQL interpretations that require user clarification.
    3. If coherence_note contains AUDIT_PATTERN alone (no POLYSEMOUS): confirm this is a
       valid audit finding and that the decision may proceed if tables are intact.
    4. If coherence_note contains both AUDIT_PATTERN and POLYSEMOUS: explain that the
       audit pattern is valid but the polysemous term makes the SQL underdetermined.
    5. If coherence_note contains PARAMETRIC: identify the missing numeric parameter and
       explain why the query cannot be executed without it.
    6. If validation_feedback reports no issues: state that the decision is structurally
       sound and no correction is needed.

    Output a concise verbal analysis (3–6 sentences). Do not output JSON.
    Focus on actionable insight for the corrector — be specific about what to change and why.
    """

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
