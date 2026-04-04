import dspy

class ControllerDecisionSignature(dspy.Signature):

    prompt = dspy.InputField(desc="Original user query")
    catalog_info = dspy.InputField(desc="Genie knowledge store metadata")
    query_classification = dspy.InputField(desc="Normal SQL or SQL Function or General Information")
    sql_functions_json = dspy.InputField(desc="JSON array of relevant SQL functions")
    required_columns_json = dspy.InputField(desc="JSON array of required columns")
    rewritten_prompt = dspy.InputField(desc="Rewritten clear query")
    conversation_context = dspy.InputField(desc="Recent chat context")
    coherence_note = dspy.InputField(
        desc=(
            "Semantic coherence analysis from Phase 1. "
            "AUDIT_PATTERN: apparent contradiction that is a valid audit finding. "
            "POLYSEMOUS: key term with multiple incompatible accounting interpretations. "
            "INCOHERENT: logically contradictory request. "
            "PARAMETRIC: intent is clear but a required numeric threshold, date range, or "
            "business rule parameter is missing — ALWAYS clarify with needsParams: true. "
            "Empty string if the query is fully unambiguous and all parameters are present."
        )
    )
    decision_json = dspy.OutputField(desc="JSON object string containing the Controller decision")