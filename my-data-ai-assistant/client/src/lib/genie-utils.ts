import type { GenieStatementResponse } from '@databricks/appkit-ui/react'
import type { GenericUiSpec, Message } from '../types/chat'

// Keep in sync with semantic_layer_api/main.py _NUMERIC_TYPES
const _NUMERIC_DB_TYPES = new Set(['INT', 'INTEGER', 'BIGINT', 'LONG', 'SHORT', 'TINYINT', 'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'NUMBER'])
const _STRING_DB_TYPES = new Set(['STRING', 'VARCHAR', 'CHAR', 'DATE', 'TIMESTAMP', 'BOOLEAN', 'BINARY', 'ARRAY', 'MAP', 'STRUCT', 'INTERVAL'])

export interface ChartDataRow {
  [key: string]: string | number
}

export function toGenieStatementResponse(data: unknown): GenieStatementResponse | null {
  if (!data || typeof data !== 'object') return null

  const maybeStatement = data as Partial<GenieStatementResponse>
  const hasManifest = Boolean(maybeStatement.manifest?.schema?.columns)
  const hasResult = Boolean(maybeStatement.result?.data_array)
  if (hasManifest && hasResult) return maybeStatement as GenieStatementResponse

  const wrapped = (data as { statement_response?: unknown }).statement_response
  if (wrapped && typeof wrapped === 'object') {
    const nested = wrapped as Partial<GenieStatementResponse>
    if (nested.manifest?.schema?.columns && nested.result?.data_array) {
      return nested as GenieStatementResponse
    }
  }

  return null
}

export function transformStatementToChartData(statement: GenieStatementResponse): {
  columns: { name: string; type: string }[]
  categoryColumn: string | null
  numericColumns: string[]
  data: ChartDataRow[]
} {
  const columns = (statement.manifest?.schema?.columns ?? []).map((col) => ({
    name: col.name,
    type: col.type_name ?? 'STRING',
  }))
  const rawRows = statement.result?.data_array ?? []

  const numericColumns: string[] = []
  const stringColumns: string[] = []
  for (const col of columns) {
    const upperType = (col.type ?? 'STRING').toUpperCase()
    if (_NUMERIC_DB_TYPES.has(upperType) || upperType.startsWith('DECIMAL')) {
      numericColumns.push(col.name)
    } else {
      if (_STRING_DB_TYPES.has(upperType)) {
        stringColumns.push(col.name)
      } else {
        const colIdx = columns.findIndex((c) => c.name === col.name)
        const sample = rawRows.slice(0, 10).map((row) => row[colIdx])
        const allNumeric = sample.length > 0 && sample.every((v) => v != null && v !== '' && !isNaN(Number(v)))
        if (allNumeric) {
          numericColumns.push(col.name)
        } else {
          stringColumns.push(col.name)
        }
      }
    }
  }

  const categoryColumn = stringColumns[0] ?? null

  const numericSet = new Set(numericColumns)
  const data: ChartDataRow[] = rawRows.map((row) => {
    const obj: ChartDataRow = {}
    columns.forEach((col, idx) => {
      const raw = row[idx]
      if (numericSet.has(col.name)) {
        obj[col.name] = raw != null && raw !== '' ? Number(raw) : 0
      } else {
        obj[col.name] = raw ?? ''
      }
    })
    return obj
  })

  return { columns, categoryColumn, numericColumns, data }
}

export function buildSpecFromGenieStatement(
  statement: GenieStatementResponse,
  title?: string,
): GenericUiSpec {
  const { columns, categoryColumn, numericColumns, data } = transformStatementToChartData(statement)
  const headers = columns.map((c) => c.name)
  const MAX_SPEC_ROWS = 2000
  const allRows = statement.result?.data_array ?? []
  const rawRows = allRows.slice(0, MAX_SPEC_ROWS)
  const isTruncated = allRows.length > MAX_SPEC_ROWS

  const elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }> = {}
  const rootId = 'root'
  elements[rootId] = { type: 'Stack', props: { gap: 6 }, children: [] }

  if (title) {
    elements['title'] = { type: 'TextContent', props: { content: title, size: 'sm', weight: 600 }, children: [] }
    elements[rootId].children.push('title')
  }

  if (categoryColumn && numericColumns.length > 0) {
    if (numericColumns.length === 1) {
      elements['chart'] = {
        type: 'BarChartViz',
        props: { data, xKey: categoryColumn, yKey: numericColumns[0] },
        children: [],
      }
    } else {
      elements['chart'] = {
        type: 'LineChartViz',
        props: {
          data,
          xKey: categoryColumn,
          series: numericColumns.map((col) => ({
            yKey: col,
            yName: col.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          })),
        },
        children: [],
      }
    }
    elements[rootId].children.push('chart')
  } else {
    const reason = numericColumns.length === 0
      ? 'Aucune colonne numérique détectée — visualisation graphique non disponible.'
      : 'Aucune colonne catégorielle détectée — visualisation graphique non disponible.'
    elements['no-chart-note'] = {
      type: 'TextContent',
      props: { content: reason, size: 'xs', c: 'dimmed' },
      children: [],
    }
    elements[rootId].children.push('no-chart-note')
  }

  elements['table'] = {
    type: 'DataTable',
    props: {
      headers,
      rows: rawRows,
      caption: isTruncated
        ? `${rawRows.length.toLocaleString('fr-FR')} premières lignes sur ${allRows.length.toLocaleString('fr-FR')} au total`
        : undefined,
    },
    children: [],
  }
  elements[rootId].children.push('table')

  return { root: rootId, elements } as GenericUiSpec
}


export const GENUI_MAX_ROWS = 1000

export function _truncateStatementResult(value: unknown): unknown {
  const statement = toGenieStatementResponse(value)
  if (!statement?.result?.data_array) return value
  const full = statement.result.data_array
  if (full.length <= GENUI_MAX_ROWS) return statement
  return {
    ...statement,
    result: {
      ...statement.result,
      data_array: full.slice(0, GENUI_MAX_ROWS),
      _truncated: true,
      _total_rows: full.length,
    },
  }
}

export function specIsValid(spec: GenericUiSpec | undefined | null): spec is GenericUiSpec {
  return (
    spec != null &&
    typeof spec.root === 'string' &&
    spec.root.length > 0 &&
    spec.elements != null &&
    typeof spec.elements === 'object' &&
    spec.root in spec.elements &&
    // Guard: root element must be a non-null object (LLM can emit null values)
    (spec.elements as Record<string, unknown>)[spec.root] != null &&
    typeof (spec.elements as Record<string, unknown>)[spec.root] === 'object'
  )
}

const FORM_INPUT_TYPES = new Set(['SelectInputField', 'TextInputField', 'NumberInputField', 'ToggleField'])

/** Returns true when the spec contains at least one interactive form input. */
export function specHasFormInputs(spec: GenericUiSpec | undefined | null): boolean {
  if (!specIsValid(spec)) return false
  return Object.values(spec.elements as Record<string, unknown>).some((el) => {
    if (!el || typeof el !== 'object') return false
    return FORM_INPUT_TYPES.has((el as Record<string, string>).type)
  })
}

// ── Chart spec validation safety net ────────────────────────────────────────
// Validates LLM-generated chart specs: ensures numeric-only props reference actual
// numeric columns.  Silently remaps or replaces invalid charts with DataTable.

const CHART_TYPES = new Set([
  'LineChartViz', 'AreaChartViz', 'BarChartViz',
  'PieChartViz', 'DonutChartViz', 'BubbleChartViz', 'RadarChartViz',
])

/** Build a column→isNumeric cache from the first 10 rows of data. */
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

    // Validate a numeric-only prop and remap if needed; returns true if unfixable
    const fixNumericProp = (propName: string, exclude: Set<string>): boolean => {
      const val = origProps[propName] as string | undefined
      if (!val) return false
      if (numCache.get(val)) return false // valid
      const replacement = _firstNumericCol(cols, numCache, exclude)
      if (replacement) {
        console.warn(`[validateChartSpec] ${key}.${propName}: "${val}" is not numeric, remapping to "${replacement}"`)
        getProps()[propName] = replacement
        return false
      }
      return true // no numeric col available
    }

    let unfixable = false
    const usedCols = new Set<string>()
    let seriesCloned = false

    // Helper: check that a categorical prop (xKey, labelKey, angleKey) exists in the data
    const checkCategoricalProp = (propName: string): boolean => {
      const val = origProps[propName] as string | undefined
      if (!val) return true // missing prop handled downstream by renderer defaults
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
      // xKey can be string or numeric for bubble, just verify it exists
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
      // Props were cloned and mutated — write the new element
      if (!elements) elements = { ...rawElements }
      elements[key] = { ...el, props }
    }
  }

  if (!elements) return spec
  return { ...spec, elements: elements as unknown as GenericUiSpec['elements'] }
}


export function buildGenieResultPayload(message: Message): unknown {
  const queryResults = message.queryResults
    ? Object.fromEntries(
        Array.from(message.queryResults.entries()).map(([k, v]) => [k, _truncateStatementResult(v)])
      )
    : undefined

  const attachments = (message.attachments ?? []).map((a) => ({
    attachmentId: a.attachmentId,
    query: a.query
      ? { title: a.query.title, description: a.query.description }
      : undefined,
  }))

  return { attachments, queryResults }
}
