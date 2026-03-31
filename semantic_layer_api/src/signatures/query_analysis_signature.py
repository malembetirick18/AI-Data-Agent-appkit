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
       - "solde anormal": debit on credit account vs statistical outlier vs prior year variance
       - "doublon": same amount+date vs same invoice ref vs same supplier+amount
       - "récent" / "dernièrement": no absolute date given
       - "transaction atypique": outlier by amount vs frequency vs counterpart
       - "tiers actif fournisseur et client": same SIREN vs same account vs same name
    4. Return a concise note describing any findings. Return empty string if the query is
       unambiguous and has no apparent contradictions.
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
            "is logically contradictory; or empty string if the query is straightforward."
        )
    )
