import type { Request, Response } from 'express'

const SEMANTIC_LAYER_API_URL = process.env.SEMANTIC_LAYER_API_URL ?? 'http://localhost:8000'

export interface ChartRecommendRequest {
  columns: Array<{ name: string; type_name: string }>
  sampleData: Array<Array<string | null>>
  queryPrompt: string
  requiredColumns?: string[]
}

export interface ChartRecommendation {
  chartType: 'line' | 'bar' | 'area' | 'pie' | 'donut' | 'radar' | 'bubble' | 'table'
  xKey: string
  yKey: string
  labelKey: string
  valueKey: string
  description: string
}

export async function handleChartRecommendRequest(req: Request, res: Response): Promise<void> {
  const body = req.body as ChartRecommendRequest
  try {
    const response = await fetch(`${SEMANTIC_LAYER_API_URL}/chart/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columns: body.columns,
        sample_data: body.sampleData,
        query_prompt: body.queryPrompt,
        required_columns: body.requiredColumns ?? [],
      }),
    })
    if (!response.ok) {
      res.status(502).json({ error: 'Recommender unavailable' })
      return
    }
    res.status(200).json(await response.json())
  } catch {
    res.status(502).json({ error: 'Recommender error' })
  }
}
