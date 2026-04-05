import { memo, useState, useMemo } from 'react'
import { Box, Text, Paper, Group, Button, Select, MultiSelect } from '@mantine/core'
import { AgCharts } from 'ag-charts-react'
import 'ag-charts-enterprise'
import {
  type ChartVizType,
  RADIAL_TYPES,
  CHART_TYPE_LABELS,
  CHART_PALETTE,
  categoryColor,
  formatColumnLabel,
  numberLabelFormatter,
  isIsoDateColumn,
  frDateFormatter,
  msFilter,
} from '../lib/chart-utils'

export { type ChartVizType }

// Pie/donut: beyond these limits the chart renders as a visually blank circle
const MAX_PIE_SLICES = 50       // max data rows → max slices
const MAX_PIE_CATEGORIES = 20   // max unique label values → max legend items

const InteractiveChart = memo(function InteractiveChart({
  data,
  initialXKey,
  initialYKeys,
  initialType,
  initialLabelKey,
  initialValueKey,
  initialSizeKey,
  title,
  yLabel,
  source,
}: {
  data: Record<string, unknown>[]
  initialXKey: string
  initialYKeys: string[]
  initialType: ChartVizType
  initialLabelKey?: string
  initialValueKey?: string
  initialSizeKey?: string
  title?: string
  yLabel?: string
  source?: string
}) {
  const allColumns = useMemo(() => data.length > 0 ? Object.keys(data[0]) : [], [data])

  const numericColumns = useMemo(
    () => allColumns.filter(col => {
      const samples = data.slice(0, 10).map(row => row[col])
      const nonEmpty = samples.filter(v => v !== null && v !== '' && v !== undefined)
      return nonEmpty.length > 0 && nonEmpty.every(v => !isNaN(Number(v)))
    }),
    [allColumns, data]
  )
  const stringColumns = useMemo(
    () => allColumns.filter(c => !numericColumns.includes(c)),
    [allColumns, numericColumns]
  )

  const [chartType, setChartType] = useState<ChartVizType>(initialType)
  const [xKey, setXKey] = useState(() => {
    if (initialXKey && allColumns.includes(initialXKey)) return initialXKey
    return stringColumns[0] || allColumns[0] || ''
  })
  const [yKeys, setYKeys] = useState<string[]>(() => {
    const defaultX = (initialXKey && allColumns.includes(initialXKey)) ? initialXKey : (stringColumns[0] || allColumns[0] || '')
    const fromInitial = initialYKeys.filter(k => k !== defaultX && allColumns.includes(k))
    const avail = numericColumns.filter(c => c !== defaultX)
    return fromInitial.length > 0 ? fromInitial.slice(0, 2) : (avail[0] ? [avail[0]] : [])
  })
  const [sizeKey, setSizeKey] = useState(initialSizeKey ?? '')
  const [labelKey, setLabelKey] = useState(() => {
    if (initialLabelKey && allColumns.includes(initialLabelKey)) return initialLabelKey
    if (RADIAL_TYPES.has(initialType)) return stringColumns[0] || allColumns[0] || ''
    return ''
  })
  const [valueKey, setValueKey] = useState(() => {
    if (initialValueKey && allColumns.includes(initialValueKey)) return initialValueKey
    if (RADIAL_TYPES.has(initialType)) return numericColumns[0] || ''
    return ''
  })

  const isRadial = RADIAL_TYPES.has(chartType)
  const isBubble = chartType === 'bubble'

  const activeLabelKey = labelKey || stringColumns[0] || allColumns[0] || ''
  const activeValueKey = valueKey || numericColumns.find(c => c !== activeLabelKey) || numericColumns[0] || ''
  const activeSizeKey = sizeKey || numericColumns.find(c => c !== xKey && !yKeys.includes(c)) || numericColumns[0] || ''

  const allColOptions = useMemo(() => allColumns.map(col => ({ value: col, label: formatColumnLabel(col) })), [allColumns])
  const numColOptions = useMemo(() => numericColumns.map(col => ({ value: col, label: formatColumnLabel(col) })), [numericColumns])
  const yOptions = useMemo(
    () => numericColumns.filter(col => col !== xKey).map(col => ({ value: col, label: formatColumnLabel(col) })),
    [numericColumns, xKey]
  )
  const sizeOptions = useMemo(
    () => numericColumns.filter(col => col !== xKey && !yKeys.includes(col)).map(col => ({ value: col, label: formatColumnLabel(col) })),
    [numericColumns, xKey, yKeys]
  )
  const activeYKeys = useMemo(
    () => yKeys.length > 0 ? yKeys : (yOptions[0] ? [yOptions[0].value] : []),
    [yKeys, yOptions]
  )

  const chartDescription = useMemo(() => {
    const f = formatColumnLabel
    const yk = activeYKeys.length > 0 ? activeYKeys.map(f).join(', ') : '–'
    const n = data.length
    const xIsDate = isIsoDateColumn(data, xKey)
    switch (chartType) {
      case 'line': return xIsDate
        ? `Évolution de ${yk} selon ${f(xKey)} — ${n} enregistrements`
        : `Comparaison de ${yk} par ${f(xKey)} — ${n} enregistrements`
      case 'area': return xIsDate
        ? `Tendance de ${yk} selon ${f(xKey)} — ${n} enregistrements`
        : `Comparaison de ${yk} par ${f(xKey)} — ${n} enregistrements`
      case 'bar':  return `Comparaison de ${yk} par ${f(xKey)}`
      case 'pie':  return `Répartition de ${f(activeValueKey)} par ${f(activeLabelKey)}`
      case 'donut':return `Distribution de ${f(activeValueKey)} par ${f(activeLabelKey)}`
      case 'radar':return `Vue radar de ${yk} par ${f(activeLabelKey)}`
      case 'bubble':return `Corrélation ${f(xKey)} / ${yk} — taille : ${f(activeSizeKey)}`
      default: return ''
    }
  }, [chartType, xKey, activeYKeys, activeLabelKey, activeValueKey, activeSizeKey, data])

  const handleTypeChange = (type: ChartVizType) => {
    setChartType(type)
    if (RADIAL_TYPES.has(type)) {
      if (!labelKey) setLabelKey(stringColumns[0] || allColumns[0] || '')
      if (!valueKey) setValueKey(numericColumns[0] || '')
    }
    if (type === 'bubble' && !sizeKey) {
      setSizeKey(numericColumns.find(c => c !== xKey && !yKeys.includes(c)) || numericColumns[0] || '')
    }
  }

  const sortedData = useMemo(() => {
    if (data.length === 0) return data
    if (isRadial) {
      return [...data].sort((a, b) => Number(b[activeValueKey] ?? 0) - Number(a[activeValueKey] ?? 0))
    }
    if (activeYKeys.length === 0) return data
    if (chartType === 'bar') {
      return [...data].sort((a, b) => Number(b[activeYKeys[0]] ?? 0) - Number(a[activeYKeys[0]] ?? 0))
    }
    const xIsNumeric = !isNaN(Number(data[0][xKey]))
    return [...data].sort((a, b) => {
      const va = xIsNumeric ? Number(a[xKey]) : String((a[xKey] ?? '') as string | number | boolean)
      const vb = xIsNumeric ? Number(b[xKey]) : String((b[xKey] ?? '') as string | number | boolean)
      return typeof va === 'number' ? (va) - (vb as number) : (va).localeCompare(vb as string)
    })
  }, [data, chartType, xKey, activeYKeys, activeValueKey, isRadial])

  const chartTitle = title ? { text: title, fontSize: 12, fontWeight: 'bold' as const } : undefined
  const datumColorIndex = useMemo(() => new Map(sortedData.map((d, i) => [d, i])), [sortedData])
  const bubbleXIsNumeric = numericColumns.includes(xKey)
  const bubbleData = useMemo(
    () => bubbleXIsNumeric ? sortedData : sortedData.map((d, i) => ({ ...d, _xIdx: i })),
    [sortedData, bubbleXIsNumeric]
  )
  const bubbleDatumColorIndex = useMemo(
    () => new Map(bubbleData.map((d, i) => [d, i])),
    [bubbleData]
  )

  let options: object
  if (chartType === 'pie') {
    options = {
      data: sortedData, title: chartTitle,
      series: [{ type: 'pie' as const, angleKey: activeValueKey, legendItemKey: activeLabelKey }],
      autoSize: true, legend: { position: 'right' as const },
    }
  } else if (chartType === 'donut') {
    options = {
      data: sortedData, title: chartTitle,
      series: [{ type: 'donut' as const, angleKey: activeValueKey, legendItemKey: activeLabelKey, innerRadiusRatio: 0.6 }],
      autoSize: true, legend: { position: 'right' as const },
    }
  } else if (chartType === 'radar') {
    const radarKeys = activeYKeys.length > 0 ? activeYKeys : [activeValueKey]
    options = {
      data: sortedData.slice(0, 10), title: chartTitle,
      series: radarKeys.map((rk, i) => {
        const colorIdx = numericColumns.indexOf(rk) >= 0 ? numericColumns.indexOf(rk) : i
        return {
          type: 'radar-area' as const, angleKey: activeLabelKey, radiusKey: rk,
          radiusName: formatColumnLabel(rk),
          stroke: categoryColor(colorIdx), fill: categoryColor(colorIdx), fillOpacity: 0.3,
          marker: { enabled: false },
        }
      }),
      axes: [
        { type: 'angle-category' as const, label: { formatter: ({ value }: { value: string }) => { const s = String(value); return s.length > 8 ? s.substring(0, 8) + '\u2026' : s } } },
        { type: 'radius-number' as const, label: { formatter: numberLabelFormatter } },
      ],
      autoSize: true, legend: { enabled: true, position: 'bottom' as const },
    }
  } else if (chartType === 'bubble') {
    const isSingleBubbleSeries = activeYKeys.length === 1
    const effectiveBubbleXKey = bubbleXIsNumeric ? xKey : '_xIdx'
    options = {
      data: bubbleData, title: chartTitle,
      series: activeYKeys.map(yKey => ({
        type: 'bubble' as const, xKey: effectiveBubbleXKey, yKey, sizeKey: activeSizeKey,
        yName: formatColumnLabel(yKey),
        ...(isSingleBubbleSeries ? {
          itemStyler: (params: { datum: Record<string, unknown> }) => {
            const idx = bubbleDatumColorIndex.get(params.datum) ?? 0
            return { fill: categoryColor(idx), stroke: categoryColor(idx) }
          },
        } : {}),
      })),
      axes: [
        {
          type: 'number' as const, position: 'bottom' as const,
          label: {
            formatter: bubbleXIsNumeric
              ? numberLabelFormatter
              : ({ value }: { value: number }) => {
                  const rawVal = sortedData[Math.round(value)]?.[xKey] ?? ''
                  const label = typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean' ? String(rawVal) : ''
                  return label.length > 8 ? label.substring(0, 8) + '\u2026' : label
                },
          },
        },
        { type: 'number' as const, position: 'left' as const, title: yLabel ? { text: yLabel } : undefined, label: { formatter: numberLabelFormatter } },
      ],
      autoSize: true, legend: { enabled: !isSingleBubbleSeries, position: 'bottom' as const },
      zoom: { enabled: true },
    }
  } else {
    const isSingleBarSeries = chartType === 'bar' && activeYKeys.length === 1
    const xIsDate = (chartType === 'line' || chartType === 'area') && isIsoDateColumn(sortedData, xKey)
    options = {
      data: sortedData, title: chartTitle,
      series: activeYKeys.map((yKey, i) => ({
        type: chartType, xKey, yKey, yName: formatColumnLabel(yKey),
        ...(isSingleBarSeries ? {
          itemStyler: (params: { datum: Record<string, unknown> }) => {
            const idx = datumColorIndex.get(params.datum) ?? 0
            return { fill: categoryColor(idx), stroke: categoryColor(idx) }
          },
        } : {}),
        ...(chartType !== 'bar' ? {
          stroke: categoryColor(numericColumns.indexOf(yKey) >= 0 ? numericColumns.indexOf(yKey) : i),
          fill:   categoryColor(numericColumns.indexOf(yKey) >= 0 ? numericColumns.indexOf(yKey) : i),
          marker: { enabled: false },
          ...(chartType === 'area' ? { fillOpacity: 0.3 } : {}),
        } : {}),
      })),
      axes: [
        {
          type: 'category' as const, position: 'bottom' as const,
          label: {
            rotation: -45,
            formatter: xIsDate
              ? frDateFormatter
              : ({ value }: { value: string }) => { const s = String(value); return s.length > 12 ? s.substring(0, 12) + '\u2026' : s },
          },
        },
        { type: 'number' as const, position: 'left' as const, title: yLabel ? { text: yLabel } : undefined, label: { formatter: numberLabelFormatter } },
      ],
      autoSize: true,
      legend: { enabled: chartType !== 'bar' ? true : !isSingleBarSeries, position: 'bottom' as const },
      zoom: { enabled: true },
    }
  }

  const isReadyToRender = (() => {
    if (data.length === 0) return false

    if (chartType === 'pie' || chartType === 'donut') {
      if (!activeValueKey || !activeLabelKey) return false
      // Too many rows → too many slices → visually indistinguishable from a blank circle
      if (sortedData.length > MAX_PIE_SLICES) return false
      // Too many unique label categories → unreadable legend, near-uniform arc widths
      const uniqueLabels = new Set(sortedData.map(d => String((d[activeLabelKey] as string | number | null | undefined) ?? ''))).size
      if (uniqueLabels > MAX_PIE_CATEGORIES) return false
      // Need ≥2 rows with a positive angle value (0/null produces empty arcs)
      return sortedData.filter(d => Number(d[activeValueKey]) > 0).length >= 2
    }

    if (chartType === 'radar') {
      const radarKeys = activeYKeys.length > 0 ? activeYKeys : [activeValueKey]
      if (!activeLabelKey) return false
      // Radar needs ≥3 spokes — fewer produces a degenerate line or point, not a polygon
      const uniqueSpokes = new Set(sortedData.slice(0, 10).map(d => String((d[activeLabelKey] as string | number | null | undefined) ?? ''))).size
      if (uniqueSpokes < 3) return false
      return radarKeys.some(rk =>
        sortedData.some(d => d[rk] != null && !isNaN(Number(d[rk])))
      )
    }

    if (chartType === 'bubble') {
      if (activeYKeys.length === 0 || !xKey || !activeSizeKey) return false
      const effectiveXKey = bubbleXIsNumeric ? xKey : '_xIdx'
      return bubbleData.some(d =>
        d[effectiveXKey] != null &&
        d[activeYKeys[0]] != null && !isNaN(Number(d[activeYKeys[0]])) &&
        Number(d[activeSizeKey]) > 0
      )
    }

    // line / area / bar
    if (activeYKeys.length === 0 || !xKey) return false
    // Line/area with a single distinct X value has no path to draw
    if (chartType === 'line' || chartType === 'area') {
      const distinctX = new Set(sortedData.map(d => String((d[xKey] as string | number | null | undefined) ?? ''))).size
      if (distinctX < 2) return false
    }
    return sortedData.some(d =>
      activeYKeys.some(k => d[k] != null && d[k] !== '' && !isNaN(Number(d[k])))
    )
  })()
  return (
    <Box mt="md" mb="sm" style={{ width: '100%' }}>
      <Paper p="xs" withBorder radius="sm" style={{ backgroundColor: '#fff' }}>
        <Group gap={2} mb={6} wrap="wrap">
          {(Object.keys(CHART_TYPE_LABELS) as ChartVizType[]).map(type => (
            <Button key={type} size="compact-xs" variant={chartType === type ? 'filled' : 'outline'} color="teal" onClick={() => handleTypeChange(type)}>
              {CHART_TYPE_LABELS[type]}
            </Button>
          ))}
        </Group>
        <Group gap={6} mb={8} wrap="wrap" align="center">
          {isRadial ? (
            <>
              <Select size="xs" placeholder="Label" data={allColOptions} value={activeLabelKey} onChange={v => v && setLabelKey(v)} style={{ width: 130 }} maxDropdownHeight={200} comboboxProps={{ withinPortal: false }} searchable />
              {chartType === 'radar' ? (
                <MultiSelect size="xs" placeholder="Valeurs (rechercher…)" data={numColOptions} filter={msFilter} value={activeYKeys.length > 0 ? activeYKeys : [activeValueKey]} onChange={vals => setYKeys(vals.length > 0 ? vals : activeYKeys)} style={{ minWidth: 130, maxWidth: 220 }} maxDropdownHeight={200} comboboxProps={{ withinPortal: false }} searchable maxValues={5} hidePickedOptions />
              ) : (
                <Select size="xs" placeholder="Valeur" data={numColOptions} value={activeValueKey} onChange={v => v && setValueKey(v)} style={{ width: 130 }} maxDropdownHeight={200} comboboxProps={{ withinPortal: false }} searchable />
              )}
            </>
          ) : (
            <>
              <Select size="xs" placeholder="Axe X" data={allColOptions} value={xKey} onChange={v => { if (!v) return; setXKey(v); setYKeys(prev => prev.filter(k => k !== v)) }} style={{ width: 130 }} maxDropdownHeight={200} comboboxProps={{ withinPortal: false }} searchable />
              {(chartType === 'line' || chartType === 'area') ? (
                <MultiSelect size="xs" placeholder="Axes Y (rechercher…)" data={yOptions} filter={msFilter} value={activeYKeys} onChange={vals => setYKeys(vals.length > 0 ? vals : activeYKeys)} style={{ minWidth: 130, maxWidth: 220 }} maxDropdownHeight={200} comboboxProps={{ withinPortal: false }} searchable maxValues={5} hidePickedOptions />
              ) : (
                <Select size="xs" placeholder="Axe Y" data={yOptions} value={activeYKeys[0] || null} onChange={v => v && setYKeys([v])} style={{ width: 130 }} maxDropdownHeight={200} comboboxProps={{ withinPortal: false }} searchable />
              )}
              {isBubble && (
                <Select size="xs" placeholder="Taille" data={sizeOptions} value={activeSizeKey} onChange={v => v && setSizeKey(v)} style={{ width: 120 }} maxDropdownHeight={200} comboboxProps={{ withinPortal: false }} searchable />
              )}
            </>
          )}
        </Group>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, height: 'clamp(280px, 40vh, 420px)' }}>
            {isReadyToRender ? (
              <AgCharts options={options} />
            ) : (
              <Box style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Text size="xl" c="dimmed">⊘</Text>
                <Text size="sm" c="dimmed" ta="center" style={{ lineHeight: 1.6 }}>
                  Aucune donnée à afficher<br />pour ce type de graphique.
                </Text>
                <Text size="xs" c="dimmed" ta="center">
                  Essayez un autre type ou sélectionnez d&apos;autres colonnes.
                </Text>
              </Box>
            )}
          </div>
          {isReadyToRender && chartDescription && (
            <Box style={{ width: 160, flexShrink: 0, paddingLeft: 6, paddingTop: 4, borderLeft: '1px solid #e9ecef' }}>
              <Text size="xs" c="dimmed" fs="italic" style={{ lineHeight: 1.5 }}>
                {chartDescription}
              </Text>
            </Box>
          )}
        </div>
        {source && <Text size="xs" c="dimmed" ta="right" mt={4} fs="italic">{'Source : ' + source}</Text>}
      </Paper>
    </Box>
  )
}, (prev, next) =>
  prev.data === next.data &&
  prev.initialType === next.initialType &&
  prev.initialXKey === next.initialXKey &&
  prev.initialYKeys.length === next.initialYKeys.length &&
  prev.initialYKeys.every((k, i) => k === next.initialYKeys[i]) &&
  prev.initialLabelKey === next.initialLabelKey &&
  prev.initialValueKey === next.initialValueKey &&
  prev.initialSizeKey === next.initialSizeKey &&
  prev.title === next.title
)

export default InteractiveChart

// Unused palette export kept for potential external consumers
export { CHART_PALETTE }
