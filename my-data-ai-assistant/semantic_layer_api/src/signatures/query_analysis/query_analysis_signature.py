import dspy


class QueryAnalysisSignature(dspy.Signature):

    prompt = dspy.InputField(desc="User query")
    catalog_info = dspy.InputField(desc="Genie knowledge store metadata and schema information")

    classification = dspy.OutputField(
        desc="Exact classification string: Normal SQL | SQL Function | Predictive SQL | General Information"
    )
    required_columns_json = dspy.OutputField(
        desc="JSON array string of required column names"
    )
    sql_functions_json = dspy.OutputField(
        desc="JSON array string from fn_vendor_typology, fn_customer_typology, or []"
    )
    coherence_note = dspy.OutputField(
        desc=(
            "Semantic coherence analysis. Format: 'AUDIT_PATTERN: <explanation>' if the apparent "
            "contradiction is a valid audit finding; 'POLYSEMOUS: <term> — <interpretations>' if a key "
            "term has multiple incompatible accounting meanings; 'INCOHERENT: <reason>' if the request "
            "is logically contradictory; 'PARAMETRIC: <missing parameter>' if the intent is clear but "
            "a required numeric threshold, date range, or business rule parameter is absent; "
            "or empty string if the query is fully unambiguous and all parameters are present."
        )
    )
