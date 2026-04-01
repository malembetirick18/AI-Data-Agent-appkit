import dspy


class ChartRecommendationSignature(dspy.Signature):
    """Given tabular query result metadata and the original user query, recommend
    the best chart type and axis assignments.

    chart_type must be one of: line, bar, area, pie, donut, radar, bubble, table.
    Use 'table' only when data has no meaningful visual pattern.
    Prefer 'line' for temporal X-axes, 'bar' for categorical comparisons,
    'pie'/'donut' for part-of-whole distributions with ≤10 categories.
    Use 'area' for cumulative or stacked time-series data.
    Use 'bubble' when there are 3 numeric dimensions (x, y, size).
    Use 'radar' for multi-dimensional performance comparisons across categories.
    """

    column_metadata: str = dspy.InputField(
        desc="JSON array: [{name, type_name, is_numeric, is_temporal, sample_values}]"
    )
    query_prompt: str = dspy.InputField(desc="The user's original query")
    required_columns: str = dspy.InputField(
        desc="JSON array of column names flagged as required by the query analysis"
    )

    chart_type: str = dspy.OutputField(
        desc="Recommended chart type: line|bar|area|pie|donut|radar|bubble|table"
    )
    x_key: str = dspy.OutputField(
        desc="Column name for X-axis or category label. Prefer string or temporal columns."
    )
    y_key: str = dspy.OutputField(
        desc="Primary numeric column for Y-axis or value. Must be a numeric column."
    )
    label_key: str = dspy.OutputField(
        desc="Category label column for pie/donut/radar charts (same as x_key for radial charts)"
    )
    value_key: str = dspy.OutputField(
        desc="Numeric value column for pie/donut/radar charts (same as y_key for radial charts)"
    )
    description: str = dspy.OutputField(
        desc="One sentence in French explaining what the chart shows"
    )
