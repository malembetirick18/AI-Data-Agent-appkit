import dspy 

class RephraseQuerySignature(dspy.Signature):

    prompt = dspy.InputField(desc="User query")
    query_classification = dspy.InputField(desc="Classification result")
    rewritten_prompt = dspy.OutputField(desc="Clear rewritten prompt")