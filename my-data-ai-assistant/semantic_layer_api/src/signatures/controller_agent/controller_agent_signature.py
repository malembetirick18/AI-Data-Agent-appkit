from typing import Literal

import dspy
import pydantic


class ControllerDecisionResult(pydantic.BaseModel):
    decision: Literal["proceed", "guide", "clarify", "error"]
    confidence: float = pydantic.Field(ge=0.0, le=1.0)
    message: str
    rewrittenPrompt: str | None = None
    suggestedTables: list[str] = []
    suggestedFunctions: list[str] = []
    requiredColumns: list[str] = []
    predictiveFunctions: list[str] = []
    questions: list[dict] = []
    queryClassification: Literal[
        "Normal SQL", "SQL Function", "Predictive SQL", "General Information"
    ] | None = None
    coherenceNote: str = ""
    needsParams: bool = False
    guardrailSource: Literal["scope", "temporal"] | None = None


class ControllerAgentSignature(dspy.Signature):
    prompt: str = dspy.InputField(desc="Original user query")
    catalog_info: str = dspy.InputField(desc="Genie knowledge store JSON metadata")
    conversation_context: str = dspy.InputField(
        desc="Recent chat context JSON string, or empty when no prior turns"
    )
    result: ControllerDecisionResult = dspy.OutputField(
        desc="Final controller decision as a structured object"
    )
