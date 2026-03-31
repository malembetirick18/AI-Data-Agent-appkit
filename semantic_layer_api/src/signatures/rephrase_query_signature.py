import dspy 

class RephraseQuerySignature(dspy.Signature):
    """Rewrite the user query into a clearer Databricks/Genie-friendly question.

    Rules:
    - Preserve the original meaning
    - Make the information need explicit
    - Mention fn_vendor_typology only if the user query already implies analysis of vendor accounts by accounting entries, total transaction volume, recent volume, months since last activity and last activity date, account balance and total volume for each account type. It used to identify inactive suppliers, suppliers with open balances, and concentration risks. 
    - Mention fn_customer_typology only if the user query already implies analysis of customer accounts by accounting entries, total transaction volume and account balance. It is used to identify customer activity, balances, and for cross-analysis with suppliers.
    - Return only the rewritten query text
    """

    prompt = dspy.InputField(desc="User query")
    query_classification = dspy.InputField(desc="Classification result")
    rewritten_prompt = dspy.OutputField(desc="Clear rewritten prompt")