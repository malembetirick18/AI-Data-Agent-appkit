import dspy
import os


class GenUiSpecSignature(dspy.Signature):
    developer_prompt: str = dspy.InputField(desc="Developer-facing prompt describing the task and expected output")
    user_prompt: str = dspy.InputField(
        desc="User query and optional Genie query result data"
    )
    spec_patches: str = dspy.OutputField()
