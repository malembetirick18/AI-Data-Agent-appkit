import dspy

class ControllerDecisionSignature(dspy.Signature):
    """Act as a Databricks SQL supervisor using only the provided Genie knowledge store metadata.

    You must choose one decision among: clarify, guide, proceed, error.

    IMPORTANT: Default to 'proceed' whenever the user intent is understandable and at least one
    table in catalog_info can plausibly answer the question. Genie is capable of resolving column
    mappings and performing joins on its own — you do NOT need perfect certainty.

    - proceed: use when the rewritten prompt is clear enough for Genie to generate a SQL query.
      Prefer this decision when the user question maps to known tables, even if the exact columns
      are not spelled out. Genie handles column resolution internally.
    - guide: use when the request is valid but would benefit from a simpler reformulation or
      explicit table/function hints before sending to Genie
    - clarify: use ONLY when the user request is truly ambiguous (e.g. multiple incompatible
      interpretations), or when no table in catalog_info is even remotely relevant.
      IMPORTANT — also use clarify in these specific cases even if the intent is broadly clear:
        (a) coherence_note contains AUDIT_PATTERN AND a polysemous term: the contradiction is a
            valid audit finding but the key term (e.g. "inactif") has multiple incompatible
            accounting interpretations — always clarify which interpretation the user means,
            because different interpretations produce fundamentally different SQL queries.
            Example: "fournisseurs inactifs réglés" — valid audit concern (inactive supplier
            receiving payments = fraud indicator) but "inactif" could mean no accounting entries,
            no invoices/orders, or master file status. Ask for the definition AND the period.
        (b) coherence_note contains POLYSEMOUS for terms like "inactif", "récent", "doublon",
            "solde anormal", "transaction atypique" — always ask for the precise interpretation.
        (c) The query involves fn_vendor_typology or fn_customer_typology and no inactivity
            period is specified — ask for the period (3m / 6m / 12m / full year) before proceeding.
        (d) PARAMETRIC_QUERY: the intent is clear but the query requires numeric thresholds,
            date ranges, amounts, or business rule parameters that the user has NOT explicitly
            stated. Examples:
            - "fournisseurs avec un solde anormal" without defining the threshold amount
            - "retards de paiement importants" without defining the number of days
            - "transactions atypiques" without defining the amount or frequency threshold
            - "tiers inactifs depuis longtemps" without defining the inactivity period
            - "factures avec écart significatif" without defining the tolerance percentage
            In these cases: set clarify with needsParams: true, and generate targeted questions
            using inputType 'number' (for thresholds/amounts/periods) with appropriate min/max/step
            bounds, 'select' (for category choices), or 'toggle' (for boolean filters).
            Do NOT use needsParams for cases (a)(b)(c) above — those are disambiguation cases.
    - error: use when the request is completely outside the supported data scope.
      NOTE: do NOT use error when coherence_note is AUDIT_PATTERN — an apparent contradiction
      that is a valid audit finding is a coherent request, not an error.

    Confidence scoring rules (CRITICAL — follow strictly):
    - confidence is a float between 0.0 and 1.0
    - When decision is 'proceed' and the user intent clearly maps to one or more tables in catalog_info,
      set confidence >= 0.90. Most 'proceed' decisions should have confidence between 0.90 and 0.98.
    - When decision is 'proceed' but the mapping is less obvious (e.g. requires assumptions),
      set confidence between 0.70 and 0.89.
    - When decision is 'guide', set confidence between 0.40 and 0.69.
    - When decision is 'clarify', set confidence between 0.10 and 0.39.
    - When decision is 'error', set confidence to 0.0.
    - Do NOT default to low confidence values like 0.5 or 0.7 for clear 'proceed' cases.
      If the intent is clear and tables exist, confidence MUST be >= 0.90.

    Constraints:
    - Never invent tables, columns, functions, or business rules
    - Use only metadata available in catalog_info
    - Suggested tables and functions must come only from catalog_info
    - Favor low-complexity queries and minimal joins
    - If the best answer requires clarification, ask short structured questions
    - When in doubt between 'clarify' and 'proceed', choose 'proceed'

    Return ONLY a JSON object string with this shape:
    {
      "decision": "clarify|guide|proceed|error",
      "message": "short user-facing message",
      "rewrittenPrompt": "optional rewritten prompt",
      "needsParams": false,
      "suggestedTables": ["table1", "table2"],
      "suggestedFunctions": ["fn1"],
      "questions": [
        {
          "id": "scope",
          "label": "question text",
          "inputType": "select|text|number|toggle",
          "required": true,
          "placeholder": "optional",
          "options": [{"value": "v1", "label": "label 1"}],
          "min": 0,
          "max": 100000,
          "step": 100
        }
      ],
      "confidence": 0.0
    }

    Rules for the questions schema:
    - inputType "number": use for thresholds, amounts, counts, durations.
      Always set min (>= 0 for monetary/duration values), max, and step.
      Omit options. Example: seuil montant (min: 0, max: 1000000, step: 500).
    - inputType "select": use for categorical choices. Provide options array.
      Omit min/max/step.
    - inputType "toggle": use for binary (yes/no, include/exclude) filters.
      Omit options and min/max/step.
    - inputType "text": use only for free-form values not covered by the above.
    - needsParams: set to true ONLY for PARAMETRIC_QUERY clarifications (case d above).
      Leave false or omit for disambiguation clarifications (cases a, b, c).
    """

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
            "Empty string if the query is straightforward."
        )
    )
    decision_json = dspy.OutputField(desc="JSON object string containing the supervisor decision")