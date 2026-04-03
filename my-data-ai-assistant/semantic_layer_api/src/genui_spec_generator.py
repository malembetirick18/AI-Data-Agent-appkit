import dspy
from src.logger import Logger
from src.signatures.genui_spec_signature import GenUiSpecSignature

# Child of the root "semantic-layer-api" logger — propagates to its handler, no double output.
_logger = Logger("semantic-layer-api").child("genui")


class GenUiSpecGenerator(dspy.Module):
    def __init__(self):
        self.generate = dspy.Predict(GenUiSpecSignature)

    def forward(self, developer_prompt: str, user_prompt: str) -> dspy.Prediction:
        _logger.info("Generating UI spec — prompt=%r", user_prompt[:80])
        try:
            result = self.generate(developer_prompt=developer_prompt, user_prompt=user_prompt)
        except Exception as exc:
            _logger.error("GenUI DSPy predict failed: %s", exc, exc_info=True)
            raise
        _logger.info("UI spec prediction done — output=%d chars", len(result.spec_patches or ""))
        return result
