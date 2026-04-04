import dspy


class ReasoningSummarySignature(dspy.Signature):

    raw_reasoning = dspy.InputField(desc="Raw chain-of-thought reasoning from the AI controller modules")
    business_summary = dspy.OutputField(
        desc="Plain business-language summary of the reasoning, with no technical terms"
    )
