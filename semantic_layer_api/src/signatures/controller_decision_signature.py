import dspy

class ControllerDecisionSignature(dspy.Signature):
    """Act as a Databricks SQL supervisor using only the provided Genie knowledge store metadata.

    You must choose one decision among: clarify, guide, proceed, error.

    IMPORTANT: Default to 'clarify' whenever there is any doubt about the user's intent,
    missing parameters, or ambiguous terms. Only use 'proceed' when the query is fully
    unambiguous AND all required numeric thresholds/parameters are explicitly stated.
    Genie can resolve column mappings internally, but it cannot invent business rule
    parameters (thresholds, periods, amounts) — those MUST come from the user.

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
            - "soldes créditeurs anormaux en comptes clients (411)" or any "solde anormal"
              query without a minimum threshold amount — even if the direction (débiteur/
              créditeur) is specified, the threshold defining "anormal" is still missing.
              Ask: seuil montant minimum (e.g. inputType number, min 0, max 100000, step 100),
              and optionally a date range for the analysis period.
            - "écritures de clôture suspectes" or any "suspect/atypique/anormal" pattern
              without a numeric criterion that defines the boundary.
            In these cases: set clarify with needsParams: true, and generate targeted questions
            using inputType 'number' (for thresholds/amounts/periods) with appropriate min/max/step
            bounds, 'select' (for category choices), or 'toggle' (for boolean filters).
            Do NOT use needsParams for cases (a)(b)(c) above — those are disambiguation cases.
        (e) SCOPE_UNDEFINED: the user's question does not explicitly specify the analysis scope.
            This rule applies UNCONDITIONALLY — even when all other parameters are clear and the
            decision would otherwise be 'proceed'. If neither "groupe" nor "filiale" (or a
            sp_folder_id value) appears in the user's question or in the conversation context,
            ALWAYS set decision to 'clarify' and include the scope_level + sp_folder_id questions
            as the first two questions in the response.
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
    - When in doubt between 'clarify' and 'proceed', choose 'clarify'
    - Only choose 'proceed' when the query is complete: intent is unambiguous AND all
      required business parameters (thresholds, amounts, periods) are explicitly stated

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

    MANDATORY SCOPE QUESTION — unconditional rule:
    Every time the user's question does not explicitly mention "groupe", "filiale", or a
    sp_folder_id value (in the current message OR in the conversation_context), you MUST:
      1. Set decision to 'clarify'.
      2. Place the two scope questions below as the FIRST two questions in the response.
      3. Append any other relevant questions (parametric, disambiguation, etc.) after them.
    This rule overrides 'proceed' and 'guide' decisions — scope must always be confirmed before
    sending a query to Genie, unless it was already established in the conversation context.

    When scope IS already known from context (e.g. user previously answered "filiale" and
    provided a sp_folder_id), do NOT ask again and proceed normally.

    Use this exact structure (two questions, always together as the first two):
    {
      "id": "scope_level",
      "label": "Périmètre d'analyse",
      "inputType": "select",
      "required": true,
      "options": [
        {"value": "group", "label": "Groupe (toutes les filiales)"},
        {"value": "filiale", "label": "Filiale spécifique"}
      ]
    },
    {
      "id": "sp_folder_id",
      "label": "Identifiant de la filiale (sp_folder_id)",
      "inputType": "text",
      "required": false,
      "placeholder": "Ex: 12345 — requis si périmètre = Filiale spécifique"
    }
    The rewrittenPrompt must incorporate the chosen scope and sp_folder_id value when present.
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
            "PARAMETRIC: intent is clear but a required numeric threshold, date range, or "
            "business rule parameter is missing — ALWAYS clarify with needsParams: true. "
            "Empty string if the query is fully unambiguous and all parameters are present."
        )
    )
    decision_json = dspy.OutputField(desc="JSON object string containing the supervisor decision")