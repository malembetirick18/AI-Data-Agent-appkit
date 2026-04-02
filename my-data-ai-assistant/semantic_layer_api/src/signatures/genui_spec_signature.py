import dspy


class GenUiSpecSignature(dspy.Signature):
    """Generate a JSON Render UI spec as JSONL RFC 6902 patch operations."""

    user_prompt: str = dspy.InputField(
        desc="User query and optional Genie query result data"
    )
    spec_patches: str = dspy.OutputField(
        desc="JSONL RFC 6902 patch operations building a UI spec tree (one JSON object per line)"
    )
