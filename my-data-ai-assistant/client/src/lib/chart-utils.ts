import type { OptionsFilter } from '@mantine/core'

export type ChartVizType = 'line' | 'bar' | 'area' | 'bubble' | 'radar' | 'pie' | 'donut'

export const RADIAL_TYPES = new Set<ChartVizType>(['pie', 'donut', 'radar'])

export const CHART_TYPE_LABELS: Record<ChartVizType, string> = {
  line: 'Line', bar: 'Bar', area: 'Area', bubble: 'Bubble',
  radar: 'Radar', pie: 'Pie', donut: 'Donut',
}

export const CHART_PALETTE = [
  '#4C78A8', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
  '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
]

export const categoryColor = (index: number) => CHART_PALETTE[index % CHART_PALETTE.length]

export const formatColumnLabel = (col: string) =>
  col.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export const numberLabelFormatter = ({ value }: { value: number }) => {
  const abs = Math.abs(value)
  if (abs >= 1e9) return (value / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (abs >= 1e6) return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (abs >= 1e3) return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(value)
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T|$)/

export const isIsoDateColumn = (data: Record<string, unknown>[], key: string): boolean => {
  const samples = data.slice(0, 5).map(r => r[key])
  return samples.length > 0 && samples.every(v => typeof v === 'string' && ISO_DATE_RE.test(v))
}

export const frDateFormatter = ({ value }: { value: string }) =>
  new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

// MultiSelect filter: always keeps the full option list in `data` so every column is
// searchable, but renders only the first 8 entries when the search field is empty.
export const msFilter: OptionsFilter = ({ options, search }) => {
  const q = search.toLowerCase().trim()
  if (!q) return options.slice(0, 8)
  return options.filter(o => 'label' in o && (o as { label: string }).label.toLowerCase().includes(q))
}
