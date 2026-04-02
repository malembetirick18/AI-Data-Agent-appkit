import dspy
from src.logger import Logger
from src.signatures.genui_spec_signature import GenUiSpecSignature

# Child of the root "semantic-layer-api" logger — propagates to its handler, no double output.
_logger = Logger("semantic-layer-api").child("genui")


class GenUiSpecGenerator(dspy.Module):
    def __init__(self):
        self.predict = dspy.Predict(GenUiSpecSignature)

    def forward(self, user_prompt: str) -> dspy.Prediction:
        _logger.info("Generating UI spec — prompt=%r", user_prompt[:80])
        result = self.predict(user_prompt=user_prompt)
        _logger.info("UI spec prediction done — output=%d chars", len(result.spec_patches or ""))
        return result
