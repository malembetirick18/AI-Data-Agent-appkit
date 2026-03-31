import dspy


class QueryAnalysisSignature(dspy.Signature):
    """Analyse a user query for Databricks workloads in one step.

    Classification — return exactly one of:
    - Normal SQL
    - SQL Function: queries that involve fn_vendor_typology or fn_customer_typology,
      including any mention of inactive suppliers/customers, vendor typology,
      concentration risk, customer activity analysis, or supplier balances by account type.
    - Predictive SQL
    - General Information

    Required columns — return ONLY a JSON array of column names (no table names).

    SQL functions — return ONLY a JSON array using these allowed values only:
    fn_vendor_typology, fn_customer_typology
    Return [] if none apply.

    Coherence note — analyse the semantic coherence of the query:
    1. Identify apparent contradictions (e.g. "inactive supplier + still paid").
    2. For each contradiction, determine if it is:
       a) A valid audit/control pattern — the contradiction IS the anomaly being detected
          (e.g. inactive supplier receiving payments = potential fraud indicator). Mark as AUDIT_PATTERN.
       b) A genuinely incoherent request where the question cannot logically be answered. Mark as INCOHERENT.
    3. Identify polysemous accounting terms — key terms that have multiple incompatible
       interpretations in accounting context that would produce fundamentally different SQL:
       - "inactif": no entries vs no invoices/orders vs master file status
       - "solde anormal" / "solde créditeur anormal" / "solde débiteur anormal": even when
         the direction (créditeur/débiteur) is specified, "anormal" still requires a numeric
         threshold — any amount vs above a minimum amount vs statistical outlier
       - "doublon": same amount+date vs same invoice ref vs same supplier+amount
       - "récent" / "dernièrement": no absolute date given
       - "transaction atypique" / "écriture atypique" / "écriture suspecte": outlier by amount
         vs frequency vs counterpart
       - "tiers actif fournisseur et client": same SIREN vs same account vs same name
    4. Additionally, flag PARAMETRIC when a query's intent is clear but a required numeric
       parameter is missing: e.g. "soldes créditeurs anormaux" without a threshold amount,
       "retards importants" without a number of days, "écarts significatifs" without a
       tolerance percentage. Mark as: 'PARAMETRIC: <missing parameter description>'.
    5. Return a concise note describing any findings. Return empty string if the query is
       unambiguous, has no apparent contradictions, and all required parameters are present.
    """

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
