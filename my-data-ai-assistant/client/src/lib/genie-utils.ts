import type { GenieStatementResponse } from '@databricks/appkit-ui/react'
import type { GenericUiSpec, Message } from '../types/chat'

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

  const numericTypes = new Set(['INT', 'INTEGER', 'BIGINT', 'LONG', 'SHORT', 'TINYINT', 'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'NUMBER'])

  const numericColumns: string[] = []
  const stringColumns: string[] = []
  for (const col of columns) {
    const upperType = (col.type ?? 'STRING').toUpperCase()
    if (numericTypes.has(upperType) || upperType.startsWith('DECIMAL')) {
      numericColumns.push(col.name)
    } else {
      const knownStringTypes = new Set(['STRING', 'VARCHAR', 'CHAR', 'DATE', 'TIMESTAMP', 'BOOLEAN', 'BINARY', 'ARRAY', 'MAP', 'STRUCT', 'INTERVAL'])
      if (knownStringTypes.has(upperType)) {
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

  const data: ChartDataRow[] = rawRows.map((row) => {
    const obj: ChartDataRow = {}
    columns.forEach((col, idx) => {
      const raw = row[idx]
      if (numericColumns.includes(col.name)) {
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
