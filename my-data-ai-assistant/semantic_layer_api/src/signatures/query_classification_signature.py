import dspy

class QueryClassificationSignature(dspy.Signature):
    """Classify a user query for Databricks workloads.

    Return one of these exact strings only:
    - Normal SQL
    - SQL Function
    - General Information
    """

    prompt = dspy.InputField(desc="User query")
    catalog_info = dspy.InputField(desc="Genie knowledge store metadata")
    classification = dspy.OutputField(desc="Exact classification string")