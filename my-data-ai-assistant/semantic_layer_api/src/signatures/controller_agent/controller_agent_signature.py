from typing import Literal

import dspy
import pydantic


class ControllerQuestionOption(pydantic.BaseModel):
    """One choice in a `select` question."""
    value: str
    label: str


class ControllerQuestion(pydantic.BaseModel):
    """Structured question rendered as a form field by the client.

    Every clarification a user must answer MUST be expressed as one of these.
    The frontend's `buildClarificationSpec` maps each entry to the matching
    json-render input component (Select / Number / Text / Toggle).
    """
    id: str = pydantic.Field(min_length=1, description="Unique snake_case identifier — used as form state key.")
    label: str = pydantic.Field(min_length=1, description="French-language label rendered above the input.")
    inputType: Literal["select", "text", "number", "toggle"] = "text"
    required: bool = False
    placeholder: str | None = None
    options: list[ControllerQuestionOption] | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None

    @pydantic.model_validator(mode="after")
    def _validate_select_has_options(self) -> "ControllerQuestion":
        if self.inputType == "select" and not self.options:
            raise ValueError(
                f"Question '{self.id}' has inputType='select' but no options. "
                "Provide a non-empty `options` list."
            )
        return self


class ControllerDecisionResult(pydantic.BaseModel):
    decision: Literal["proceed", "guide", "clarify", "error"]
    confidence: float = pydantic.Field(ge=0.0, le=1.0)
    message: str
    rewrittenPrompt: str | None = None
    suggestedTables: list[str] = []
    suggestedFunctions: list[str] = []
    requiredColumns: list[str] = []
    predictiveFunctions: list[str] = []
    questions: list[ControllerQuestion] = []
    queryClassification: Literal[
        "Normal SQL", "SQL Function", "Predictive SQL", "General Information"
    ] | None = None
    coherenceNote: str = ""
    needsParams: bool = False
    guardrailSource: Literal["scope", "temporal"] | None = None

    @pydantic.model_validator(mode="after")
    def _validate_clarify_has_questions(self) -> "ControllerDecisionResult":
        """Hard contract: every non-guardrail `clarify` decision MUST include
        at least one structured question. Returning prose-only with
        `questions: []` is forbidden — it produces an unusable form."""
        if (
            self.decision == "clarify"
            and not self.questions
            and self.guardrailSource is None
        ):
            raise ValueError(
                "Invalid ControllerDecisionResult: decision='clarify' requires a "
                "non-empty `questions` array (unless guardrailSource is set). "
                "Translate every parameter mentioned in `message` into a structured "
                "ControllerQuestion entry — the frontend cannot render a form from "
                "prose alone."
            )
        return self


class ControllerAgentSignature(dspy.Signature):
    prompt: str = dspy.InputField(desc="Original user query")
    catalog_info: str = dspy.InputField(desc="Genie knowledge store JSON metadata")
    conversation_context: str = dspy.InputField(
        desc="Recent chat context JSON string, or empty when no prior turns"
    )
    result: ControllerDecisionResult = dspy.OutputField(
        desc="Final controller decision as a structured object"
    )
