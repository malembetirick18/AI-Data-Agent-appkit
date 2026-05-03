import type { GenericUiSpec } from '../types/chat'

export function specIsValid(spec: GenericUiSpec | undefined | null): spec is GenericUiSpec {
  return (
    spec != null &&
    typeof spec.root === 'string' &&
    spec.root.length > 0 &&
    spec.elements != null &&
    typeof spec.elements === 'object' &&
    spec.root in spec.elements &&
    (spec.elements as Record<string, unknown>)[spec.root] != null &&
    typeof (spec.elements as Record<string, unknown>)[spec.root] === 'object'
  )
}

// ── Chart spec validation safety net ────────────────────────────────────────
// Validates LLM-generated chart specs: ensures numeric-only props reference actual
// numeric columns. Silently remaps or replaces invalid charts with DataTable.

const CHART_TYPES = new Set([
  'LineChartViz', 'AreaChartViz', 'BarChartViz',
  'PieChartViz', 'DonutChartViz', 'BubbleChartViz', 'RadarChartViz',
])

function _buildNumericCache(data: Record<string, unknown>[], cols: string[]): Map<string, boolean> {
  const cache = new Map<string, boolean>()
  const sampleRows = data.slice(0, 10)
  for (const col of cols) {
    const nonEmpty = sampleRows.map(r => r[col]).filter(v => v !== null && v !== '' && v !== undefined)
    cache.set(col, nonEmpty.length > 0 && nonEmpty.every(v => !isNaN(Number(v))))
  }
  return cache
}

function _firstNumericCol(cols: string[], numCache: Map<string, boolean>, exclude: Set<string>): string | null {
  for (const col of cols) {
    if (!exclude.has(col) && numCache.get(col)) return col
  }
  return null
}

/**
 * Validate a GenericUiSpec: ensure chart elements reference correct column types.
 * Returns a new spec if any chart elements needed fixing; returns the original otherwise.
 * Never mutates the input spec.
 */
export function validateChartSpec(spec: GenericUiSpec): GenericUiSpec {
  if (!specIsValid(spec)) return spec

  const rawElements = spec.elements as unknown as Record<string, Record<string, unknown>>
  const specState = (spec as unknown as Record<string, unknown>).state as Record<string, unknown> | undefined
  // Deferred copy: only spread when first mutation is needed
  let elements: Record<string, Record<string, unknown>> | null = null

  for (const [key, el] of Object.entries(rawElements)) {
    if (!el || typeof el !== 'object' || !CHART_TYPES.has(el.type as string)) continue

    const origProps = el.props as Record<string, unknown> | undefined
    if (!origProps) continue

    // Resolve $state bindings: LLM may put chart data in spec.state and reference
    // it via {"$state": "/chartData"}.  The validator must read the actual array.
    let data = origProps.data as Record<string, unknown>[] | undefined
    if (data && !Array.isArray(data) && typeof data === 'object' && '$state' in data) {
      const statePath = (data as Record<string, string>).$state
      if (specState && typeof statePath === 'string') {
        const resolved = statePath.startsWith('/')
          ? specState[statePath.slice(1)]
          : specState[statePath]
        if (Array.isArray(resolved)) {
          data = resolved as Record<string, unknown>[]
        }
      }
    }
    if (!Array.isArray(data) || data.length === 0) {
      console.warn(`[validateChartSpec] ${key}: empty data array, replacing with DataTable`)
      if (!elements) elements = { ...rawElements }
      elements[key] = {
        type: 'DataTable',
        props: { headers: [], rows: [], caption: 'Aucune donnée disponible' },
        children: [],
      }
      continue
    }

    const cols = Object.keys(data[0])
    const numCache = _buildNumericCache(data, cols)
    const type = el.type as string

    // Clone props so the original spec is never mutated
    let props: Record<string, unknown> | null = null
    const getProps = () => { if (!props) props = { ...origProps }; return props }

    const fixNumericProp = (propName: string, exclude: Set<string>): boolean => {
      const val = origProps[propName] as string | undefined
      if (!val) return false
      if (numCache.get(val)) return false
      const replacement = _firstNumericCol(cols, numCache, exclude)
      if (replacement) {
        console.warn(`[validateChartSpec] ${key}.${propName}: "${val}" is not numeric, remapping to "${replacement}"`)
        getProps()[propName] = replacement
        return false
      }
      return true
    }

    let unfixable = false
    const usedCols = new Set<string>()
    let seriesCloned = false

    const checkCategoricalProp = (propName: string): boolean => {
      const val = origProps[propName] as string | undefined
      if (!val) return true
      if (!cols.includes(val)) {
        console.warn(`[validateChartSpec] ${key}.${propName}: "${val}" not found in data columns`)
        return false
      }
      return true
    }

    if (type === 'LineChartViz' || type === 'AreaChartViz') {
      if (!checkCategoricalProp('xKey')) { unfixable = true }
      const origSeries = origProps.series as Array<{ yKey: string }> | undefined
      if (!unfixable && Array.isArray(origSeries)) {
        for (let i = 0; i < origSeries.length; i++) {
          const s = origSeries[i]
          if (s.yKey && numCache.get(s.yKey)) {
            usedCols.add(s.yKey)
          } else {
            const rep = _firstNumericCol(cols, numCache, usedCols)
            if (rep) {
              if (!seriesCloned) {
                getProps().series = origSeries.map(entry => ({ ...entry }))
                seriesCloned = true
              }
              ;(getProps().series as Array<{ yKey: string }>)[i].yKey = rep
              usedCols.add(rep)
            } else { unfixable = true }
          }
        }
      }
    } else if (type === 'BarChartViz') {
      if (!checkCategoricalProp('xKey')) { unfixable = true }
      if (!unfixable) unfixable = fixNumericProp('yKey', new Set([origProps.xKey as string || '']))
    } else if (type === 'PieChartViz' || type === 'DonutChartViz') {
      if (!checkCategoricalProp('labelKey')) { unfixable = true }
      if (!unfixable) unfixable = fixNumericProp('angleKey', new Set([origProps.labelKey as string || '']))
    } else if (type === 'RadarChartViz') {
      if (!checkCategoricalProp('angleKey')) { unfixable = true }
      if (!unfixable) unfixable = fixNumericProp('radiusKey', new Set([origProps.angleKey as string || '']))
    } else if (type === 'BubbleChartViz') {
      const xk = origProps.xKey as string || ''
      if (xk && !cols.includes(xk)) { unfixable = true }
      if (!unfixable) unfixable = fixNumericProp('yKey', new Set([xk]))
      if (!unfixable) unfixable = fixNumericProp('sizeKey', new Set([xk, (props ?? origProps).yKey as string || '']))
    }

    if (unfixable) {
      console.warn(`[validateChartSpec] ${key}: no numeric columns available, replacing with DataTable`)
      const rows = data.slice(0, 100).map(row =>
        cols.map(h => {
          const v = row[h]
          if (v == null) return ''
          if (typeof v === 'object') return JSON.stringify(v)
          return String(v as string | number | boolean)
        })
      )
      if (!elements) elements = { ...rawElements }
      elements[key] = { type: 'DataTable', props: { headers: cols, rows }, children: [] }
    } else if (props) {
      if (!elements) elements = { ...rawElements }
      elements[key] = { ...el, props }
    }
  }

  if (!elements) return spec
  return { ...spec, elements: elements as unknown as GenericUiSpec['elements'] }
}
