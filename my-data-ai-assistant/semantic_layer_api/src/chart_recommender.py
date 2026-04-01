import dspy
from src.signatures.chart_recommendation_signature import ChartRecommendationSignature


class ChartRecommender(dspy.Module):
    def __init__(self):
        self.recommend = dspy.Predict(ChartRecommendationSignature)

    def forward(self, column_metadata: str, query_prompt: str, required_columns: str = "[]") -> dspy.Prediction:
        return self.recommend(
            column_metadata=column_metadata,
            query_prompt=query_prompt,
            required_columns=required_columns,
        )
