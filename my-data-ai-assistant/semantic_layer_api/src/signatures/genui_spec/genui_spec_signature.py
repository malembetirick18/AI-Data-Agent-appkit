import dspy


class GenUiSpecSignature(dspy.Signature):
    user_prompt: str = dspy.InputField(
        desc="User query and optional Genie query result data"
    )
    spec_patches: str = dspy.OutputField(
        desc=(
            "JSONL output (one RFC 6902 JSON Patch object per line, no markdown/fences). "
            "First line: {\"op\":\"add\",\"path\":\"/root\",\"value\":\"<key>\"}. "
            "Then /elements/<key> patches, then /state/<key> patches. "
            "Chart numeric props (yKey, series[].yKey, angleKey, radiusKey, sizeKey) "
            "MUST reference numeric columns from the data. "
            "xKey/labelKey may be any column type."
        )
    )
