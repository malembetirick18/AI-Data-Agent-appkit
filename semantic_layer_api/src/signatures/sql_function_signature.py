import dspy 

class SQLFunctionSignature(dspy.Signature):
    """Classify tasks into Databricks function families.

    Return ONLY a JSON array string using these allowed values:
    fn_vendor_typology,fn_customer_typology
    """

    prompt = dspy.InputField(desc="User query")
    sql_functions_json = dspy.OutputField(desc="JSON array string of SQL function names")