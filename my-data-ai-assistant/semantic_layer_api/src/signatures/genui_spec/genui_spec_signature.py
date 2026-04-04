import dspy
import os


class GenUiSpecSignature(dspy.Signature):
    user_prompt: str = dspy.InputField(
        desc="User query and optional Genie query result data"
    )
    spec_patches: str = dspy.OutputField()
