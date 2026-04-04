from pathlib import Path

import dspy
from src.logger import Logger
from src.signatures.genui_spec.genui_spec_signature import GenUiSpecSignature
from src.signatures.utils.prompt_utils import load_genui_catalog_developer_prompt

# Child of the root "semantic-layer-api" logger — propagates to its handler, no double output.
logger = Logger("semantic-layer-api").child("genui")

developer_prompt = load_genui_catalog_developer_prompt()

class GenUiSpecGenerator(dspy.Module):
    def __init__(self):
        self.generate = dspy.Predict(GenUiSpecSignature.with_instructions(developer_prompt))

    def forward(self, user_prompt: str) -> dspy.Prediction:
        logger.info("Generating UI spec — prompt=%r", user_prompt[:80])
        try:
            result = self.generate(user_prompt=user_prompt)
        except Exception as exc:
            logger.error("GenUI DSPy predict failed: %s", exc, exc_info=True)
            raise
        logger.info("UI spec prediction done — output=%d chars", len(result.spec_patches or ""))
        return result
