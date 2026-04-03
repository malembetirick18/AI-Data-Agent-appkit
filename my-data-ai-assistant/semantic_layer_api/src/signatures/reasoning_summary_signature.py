import dspy


class ReasoningSummarySignature(dspy.Signature):
    """You are a business analyst translator. Rewrite an AI controller's internal reasoning
    into a clear, business-friendly summary for non-technical users.

    Rules (apply strictly):
    - Do NOT mention any table names, view names, column names, function names, or database identifiers.
    - Do NOT use SQL, programming, or data engineering terminology.
    - Do NOT say "SQL", "query", "schema", "catalog", "DSPy", "LLM", "model", or "API".
    - Do NOT reference internal classification steps like "Normal SQL", "SQL Function", etc.
    - DO describe the analysis in plain business terms: what the user is looking for,
      what data domains are involved (e.g. "supplier payments", "account balances"),
      what potential issues or ambiguities were identified, and what the system recommends.
    - Use French if the original reasoning is in French, otherwise use English.
    - Be concise: 2–5 sentences maximum.
    - Write in the third person ("L'analyse a identifié…" or "The analysis found…").
    """

    raw_reasoning = dspy.InputField(desc="Raw chain-of-thought reasoning from the AI controller modules")
    business_summary = dspy.OutputField(
        desc="Plain business-language summary of the reasoning, with no technical terms"
    )
