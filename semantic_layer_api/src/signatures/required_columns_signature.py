import dspy

class RequiredColumnsSignature(dspy.Signature):
    """Review the available schema metadata and identify only the columns required to answer the user query.

    Return ONLY a JSON array of column names and never include table names.
    """

    prompt = dspy.InputField(desc="User query")
    schema_info = dspy.InputField(desc="Catalog schema information")
    required_columns_json = dspy.OutputField(desc="JSON array string of required column names")