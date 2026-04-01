'use client'

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import {
  Drawer,
  Text,
  TextInput,
  ActionIcon,
  Group,
  Box,
  ScrollArea,
  Paper,
  ThemeIcon,
  Stack,
  Divider,
  Table,
  List,
  Accordion,
  UnstyledButton,
  Tooltip,
  Button,
  Modal,
  Textarea,
  Select,
  MultiSelect,
  NumberInput,
  Badge,
  Progress,
  Loader,
  Switch,
  Avatar,
  Alert,
  Checkbox,
  Transition,
} from '@mantine/core'
import {
  IconSparkles,
  IconSend,
  IconArrowsMaximize,
  IconTrash,
  IconX,
  IconBulb,
  IconChevronDown,
  IconCopy,
  IconCheck,
  IconDeviceFloppy,
  IconCalendar,
  IconUsers,
  IconShieldCheck,
  IconEye,
  IconPencil,
  IconAlertTriangle,
  IconRobot,
  IconListDetails,
  IconSearch,
  IconUpload,
  IconFilter,
} from '@tabler/icons-react'
import { AgGridReact } from 'ag-grid-react'
import { AgCharts } from 'ag-charts-react'
import { AllEnterpriseModule, ModuleRegistry, themeQuartz } from 'ag-grid-enterprise'
import 'ag-charts-enterprise'

ModuleRegistry.registerModules([AllEnterpriseModule])
import { type Spec } from '@json-render/core'
import { JSONUIProvider, Renderer, defineRegistry } from '@json-render/react'
import { chatUiCatalog } from '../../../shared/genui-catalog'

import { useGenieChat } from '@databricks/appkit-ui/react'
import type { GenieAttachmentResponse, GenieStatementResponse } from '@databricks/appkit-ui/react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TextBlock {
  type: 'text'
  content: string
}

interface BoldBlock {
  type: 'bold'
  content: string
}

interface HeadingBlock {
  type: 'heading'
  content: string
}

interface BulletBlock {
  type: 'bullets'
  items: string[]
}

interface TableBlock {
  type: 'table'
  caption?: string
  headers: string[]
  rows: string[][]
}

interface LineChartBlock {
  type: 'lineChart'
  title: string
  data: Record<string, string | number>[]
  xKey: string
  series: { yKey: string; yName: string; stroke?: string }[]
  yLabel?: string
  source?: string
}

interface BarChartBlock {
  type: 'barChart'
  title: string
  data: Record<string, string | number>[]
  yKey: string
  xKey: string
  color: string
}

type ContentBlock =
  | TextBlock
  | BoldBlock
  | HeadingBlock
  | BulletBlock
  | TableBlock
  | LineChartBlock
  | BarChartBlock

type GenericUiSpec = Spec

interface GenerateSpecApiResponse {
  spec: GenericUiSpec
  model?: string
}

interface ControllerQuestionOption {
  value: string
  label: string
}

interface ControllerQuestion {
  id: string
  label: string
  inputType?: 'select' | 'text' | 'number' | 'toggle'
  required?: boolean
  placeholder?: string
  options?: ControllerQuestionOption[]
  min?: number
  max?: number
  step?: number
}

interface ControllerApiResponse {
  decision: 'clarify' | 'guide' | 'proceed' | 'error'
  message: string
  rewrittenPrompt?: string
  enrichedPrompt?: string
  suggestedTables?: string[]
  suggestedFunctions?: string[]
  questions?: ControllerQuestion[]
  confidence?: number
  requiredColumns?: string[]
  predictiveFunctions?: string[]
  queryClassification?: string
  model?: string
  catalogSource?: 'payload' | 'env-json' | 'env-file' | 'empty'
  /** True when the agent needs runtime parameters (thresholds, amounts, filters) rather than disambiguation */
  needsParams?: boolean
}

interface ControllerConversationContext {
  conversationId: string
  sessionId: string
  source: 'ai-chat-drawer'
  messages: Array<{ role: 'assistant' | 'user'; content: string }>
}

interface PendingClarification {
  originalPrompt: string
  message: string
  decision: 'clarify' | 'guide' | 'proceed' | 'error'
  rewrittenPrompt?: string
  enrichedPrompt?: string
  questions: ControllerQuestion[]
  suggestedTables: string[]
  suggestedFunctions: string[]
  /** When true, the Controller already approved — user just needs to confirm before Genie */
  canSendDirectly?: boolean
  /** When true, the agent is collecting runtime parameters (thresholds, amounts, filters) */
  needsParams?: boolean
}

function isControllerApproved(decision: ControllerApiResponse['decision'], confidence?: number): boolean {
  return decision === 'proceed' && typeof confidence === 'number' && confidence >= 0.90
}

interface Message {
  id: number | string
  role: 'assistant' | 'user'
  content: string
  blocks?: ContentBlock[]
  timestamp?: string
  attachments?: GenieAttachmentResponse[]
  queryResults?: Map<string, unknown>
  thinking?: boolean
  /** If true, this assistant msg shows period-confirmation buttons */
  periodPrompt?: boolean
  /** If true, show loading state */
  loading?: boolean
  /** Used to auto-fill save form */
  controlName?: string
  controlDescription?: string
  /** Internal controller message — never shown in the chat UI */
  type?: 'controller'
}

/* ------------------------------------------------------------------ */
/*  Suggestions                                                        */
/* ------------------------------------------------------------------ */

const suggestions = [
  'Les variations de dépenses par fournisseur ou catégorie sont-elles cohérentes avec les tendances historiques et les volumes d\'activité ?',
  'Existe-t-il des transactions d\'achats présentant des montants, fréquences ou dates atypiques (ex. fractionnement de factures, achats en fin de période, doublons potentiels) ?',
  'Des fournisseurs inactifs continuent-ils à être réglés ?',
  'Quels tiers ont une activité à la fois fournisseur et client ?',
  'Y a-t-il des écarts significatifs entre les soldes comptables fournisseurs et les balances auxiliaires ?',
]

/* ------------------------------------------------------------------ */
/*  Period options for "fournisseurs inactifs" workflow                 */
/* ------------------------------------------------------------------ */

const periodOptions = [
  { label: '3 derniers mois (Jul - Sep 2020)', value: '3m' },
  { label: '6 derniers mois (Avr - Sep 2020)', value: '6m' },
  { label: '12 derniers mois (Oct 2019 - Sep 2020)', value: '12m' },
  { label: 'Exercice complet (01/10/2019 - 30/09/2020)', value: 'full' },
]



/* ------------------------------------------------------------------ */
/*  Shared chart helpers                                               */
/* ------------------------------------------------------------------ */

type ChartVizType = 'line' | 'bar' | 'area' | 'bubble' | 'radar' | 'pie' | 'donut'

const RADIAL_TYPES = new Set<ChartVizType>(['pie', 'donut', 'radar'])
const CHART_TYPE_LABELS: Record<ChartVizType, string> = {
  line: 'Line', bar: 'Bar', area: 'Area', bubble: 'Bubble',
  radar: 'Radar', pie: 'Pie', donut: 'Donut',
}

const formatColumnLabel = (col: string) =>
  col.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const numberLabelFormatter = ({ value }: { value: number }) => {
  const abs = Math.abs(value)
  if (abs >= 1e9) return (value / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (abs >= 1e6) return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (abs >= 1e3) return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(value)
}

function InteractiveChart({
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
  const allColumns = useMemo(() => data.length > 0 ? Object.keys(data[0]) : [], []) // eslint-disable-line react-hooks/exhaustive-deps

  const numericColumns = useMemo(
    () => allColumns.filter(col => {
      const samples = data.slice(0, 10).map(row => row[col])
      const nonEmpty = samples.filter(v => v !== null && v !== '' && v !== undefined)
      return nonEmpty.length > 0 && nonEmpty.every(v => !isNaN(Number(v)))
    }),
    [allColumns] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const stringColumns = useMemo(
    () => allColumns.filter(c => !numericColumns.includes(c)),
    [allColumns, numericColumns]
  )

  const [chartType, setChartType] = useState<ChartVizType>(initialType)
  // Cartesian axes
  const [xKey, setXKey] = useState(initialXKey)
  const [yKeys, setYKeys] = useState<string[]>(() => initialYKeys.filter(k => k !== initialXKey))
  const [sizeKey, setSizeKey] = useState(initialSizeKey ?? '')
  // Radial axes (pie, donut, radar)
  const [labelKey, setLabelKey] = useState(initialLabelKey ?? '')
  const [valueKey, setValueKey] = useState(initialValueKey ?? '')

  const isRadial = RADIAL_TYPES.has(chartType)
  const isBubble = chartType === 'bubble'

  // Ensure radial defaults are populated lazily from data
  const activeLabelKey = labelKey || stringColumns[0] || allColumns[0] || ''
  const activeValueKey = valueKey || numericColumns[0] || ''
  const activeSizeKey = sizeKey || numericColumns.find(c => c !== xKey && !yKeys.includes(c)) || numericColumns[0] || ''

  // Column option lists
  const allColOptions = allColumns.map(col => ({ value: col, label: formatColumnLabel(col) }))
  const numColOptions = numericColumns.map(col => ({ value: col, label: formatColumnLabel(col) }))
  const yOptions = numericColumns.filter(col => col !== xKey).map(col => ({ value: col, label: formatColumnLabel(col) }))
  const sizeOptions = numericColumns.filter(col => col !== xKey && !yKeys.includes(col)).map(col => ({ value: col, label: formatColumnLabel(col) }))
  const maxYValues = chartType === 'bar' ? 1 : 5
  const activeYKeys = yKeys.length > 0 ? yKeys : (yOptions[0] ? [yOptions[0].value] : [])

  const handleTypeChange = (type: ChartVizType) => {
    setChartType(type)
    if (type === 'bar') setYKeys(prev => prev.slice(0, 1))
    // Initialise radial keys on first switch if not yet set
    if (RADIAL_TYPES.has(type)) {
      if (!labelKey) setLabelKey(stringColumns[0] || allColumns[0] || '')
      if (!valueKey) setValueKey(numericColumns[0] || '')
    }
    if (type === 'bubble' && !sizeKey) {
      setSizeKey(numericColumns.find(c => c !== xKey && !yKeys.includes(c)) || numericColumns[0] || '')
    }
  }

  // Sort for visual coherence
  const sortedData = useMemo(() => {
    if (data.length === 0) return data
    if (isRadial) {
      // Radial: descending by value so largest slice is first
      return [...data].sort((a, b) => Number(b[activeValueKey] ?? 0) - Number(a[activeValueKey] ?? 0))
    }
    if (activeYKeys.length === 0) return data
    if (chartType === 'bar') {
      return [...data].sort((a, b) => Number(b[activeYKeys[0]] ?? 0) - Number(a[activeYKeys[0]] ?? 0))
    }
    // line / area / bubble — sort ascending by X
    const xIsNumeric = !isNaN(Number(data[0][xKey]))
    return [...data].sort((a, b) => {
      const va = xIsNumeric ? Number(a[xKey]) : String(a[xKey] ?? '')
      const vb = xIsNumeric ? Number(b[xKey]) : String(b[xKey] ?? '')
      return typeof va === 'number' ? (va as number) - (vb as number) : (va as string).localeCompare(vb as string)
    })
  }, [data, chartType, xKey, activeYKeys, activeValueKey, isRadial])

  const chartTitle = title ? { text: title, fontSize: 12, fontWeight: 'bold' as const } : undefined

  // Build AG Charts options per type
  let options: object
  if (chartType === 'pie') {
    options = {
      data: sortedData,
      title: chartTitle,
      series: [{ type: 'pie' as const, angleKey: activeValueKey, legendItemKey: activeLabelKey }],
      height: 220,
      legend: { position: 'right' as const },
    }
  } else if (chartType === 'donut') {
    options = {
      data: sortedData,
      title: chartTitle,
      series: [{ type: 'donut' as const, angleKey: activeValueKey, legendItemKey: activeLabelKey, innerRadiusRatio: 0.6 }],
      height: 220,
      legend: { position: 'right' as const },
    }
  } else if (chartType === 'radar') {
    options = {
      data: sortedData,
      title: chartTitle,
      series: [{ type: 'radar-line' as const, angleKey: activeLabelKey, radiusKey: activeValueKey }],
      axes: [
        { type: 'angle-category' as const },
        { type: 'radius-number' as const, label: { formatter: numberLabelFormatter } },
      ],
      height: 240,
    }
  } else if (chartType === 'bubble') {
    options = {
      data: sortedData,
      title: chartTitle,
      series: activeYKeys.map(yKey => ({
        type: 'bubble' as const,
        xKey,
        yKey,
        sizeKey: activeSizeKey,
        yName: formatColumnLabel(yKey),
      })),
      axes: [
        { type: 'number' as const, position: 'bottom' as const, label: { formatter: numberLabelFormatter } },
        { type: 'number' as const, position: 'left' as const, title: yLabel ? { text: yLabel } : undefined, label: { formatter: numberLabelFormatter } },
      ],
      height: 220,
      legend: { position: 'bottom' as const },
      zoom: { enabled: true },
    }
  } else {
    // line | bar | area
    options = {
      data: sortedData,
      title: chartTitle,
      series: activeYKeys.map(yKey => ({
        type: chartType as 'line' | 'bar' | 'area',
        xKey,
        yKey,
        yName: formatColumnLabel(yKey),
        ...(chartType !== 'bar' ? { marker: { enabled: false } } : {}),
      })),
      axes: [
        { type: 'category' as const, position: 'bottom' as const },
        { type: 'number' as const, position: 'left' as const, title: yLabel ? { text: yLabel } : undefined, label: { formatter: numberLabelFormatter } },
      ],
      height: 200,
      legend: { position: 'bottom' as const },
      zoom: { enabled: true },
    }
  }

  return (
    <Box mt="md" mb="sm" style={{ width: '100%' }}>
      <Paper p="xs" withBorder radius="sm" style={{ backgroundColor: '#fff' }}>
        {/* Type toggle */}
        <Group gap={2} mb={6} wrap="wrap">
          {(Object.keys(CHART_TYPE_LABELS) as ChartVizType[]).map(type => (
            <Button key={type} size="compact-xs" variant={chartType === type ? 'filled' : 'outline'} color="teal" onClick={() => handleTypeChange(type)}>
              {CHART_TYPE_LABELS[type]}
            </Button>
          ))}
        </Group>
        {/* Axis selectors — adapt to type group */}
        <Group gap={6} mb={8} wrap="wrap" align="center">
          {isRadial ? (
            <>
              <Select size="xs" placeholder="Label" data={allColOptions} value={activeLabelKey} onChange={v => v && setLabelKey(v)} style={{ width: 130 }} comboboxProps={{ withinPortal: false, maxDropdownHeight: 200 }} />
              <Select size="xs" placeholder="Valeur" data={numColOptions} value={activeValueKey} onChange={v => v && setValueKey(v)} style={{ width: 130 }} comboboxProps={{ withinPortal: false, maxDropdownHeight: 200 }} />
            </>
          ) : (
            <>
              <Select size="xs" placeholder="Axe X" data={allColOptions} value={xKey} onChange={v => { if (!v) return; setXKey(v); setYKeys(prev => prev.filter(k => k !== v)) }} style={{ width: 130 }} comboboxProps={{ withinPortal: false, maxDropdownHeight: 200 }} />
              <MultiSelect size="xs" placeholder="Axes Y" data={yOptions} value={yKeys} onChange={setYKeys} style={{ width: 160 }} maxValues={maxYValues} comboboxProps={{ withinPortal: false, maxDropdownHeight: 200 }} clearable />
              {isBubble && (
                <Select size="xs" placeholder="Taille" data={sizeOptions} value={activeSizeKey} onChange={v => v && setSizeKey(v)} style={{ width: 120 }} comboboxProps={{ withinPortal: false, maxDropdownHeight: 200 }} />
              )}
            </>
          )}
        </Group>
        <AgCharts options={options} />
        {source && <Text size="xs" c="dimmed" ta="right" mt={4} fs="italic">{'Source : ' + source}</Text>}
      </Paper>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/*  json-render catalog + registry for generative UI                   */
/* ------------------------------------------------------------------ */

const { registry: chatUiRegistry } = defineRegistry(chatUiCatalog, {
  components: {
    Stack: ({ props, children }) => <Stack gap={props.gap ?? 6}>{children}</Stack>,
    TextContent: ({ props }) => (
      <Text size={(props.size as 'xs' | 'sm' | 'md' | 'lg' | 'xl' | undefined) ?? 'sm'} fw={props.weight} style={{ lineHeight: 1.55 }}>
        {props.content}
      </Text>
    ),
    BulletList: ({ props }) => (
      <List size="sm" mt={4} mb={4} spacing={2} withPadding>
        {props.items.map((item) => (
          <List.Item key={item}>
            <Text size="xs" style={{ lineHeight: 1.55 }}>{item}</Text>
          </List.Item>
        ))}
      </List>
    ),
    DataTable: ({ props }) => {
      const VISIBLE_COLS = 4
      const LARGE_TABLE_THRESHOLD = 200

      const columnDefs = useMemo(() => props.headers.map((h: string, i: number) => ({
        field: h,
        headerName: h,
        sortable: true,
        filter: true,
        resizable: true,
        flex: 1,
        minWidth: 100,
        hide: i >= VISIBLE_COLS,
      })), [props.headers])

      const rowData = useMemo(() =>
        props.rows.map((row: string[]) =>
          Object.fromEntries(props.headers.map((h: string, i: number) => [h, row[i] ?? '']))
        ),
        [props.headers, props.rows]
      )

      const isLarge = rowData.length > LARGE_TABLE_THRESHOLD
      const gridHeight = isLarge ? 500 : Math.min(300, 48 + rowData.length * 42)
      const hasHiddenCols = props.headers.length > VISIBLE_COLS

      return (
        <Box mt="xs" mb="xs" style={{ width: '100%', overflow: 'hidden' }}>
          {props.caption && <Text size="xs" c="dimmed" mb={4} fs="italic">{props.caption}</Text>}
          <div style={{ height: gridHeight, width: '100%' }}>
            <AgGridReact
              theme={themeQuartz}
              columnDefs={columnDefs}
              rowData={rowData}
              domLayout="normal"
              suppressMovableColumns
              rowBuffer={20}
              animateRows={!isLarge}
              pagination={rowData.length > 10}
              paginationPageSize={isLarge ? 50 : 10}
              sideBar={hasHiddenCols ? { toolPanels: [{ id: 'columns', labelDefault: 'Colonnes', labelKey: 'columns', iconKey: 'columns', toolPanel: 'agColumnsToolPanel', toolPanelParams: { suppressRowGroups: true, suppressValues: true, suppressPivots: true, suppressPivotMode: true } }] } : undefined}
            />
          </div>
        </Box>
      )
    },
    LineChartViz: ({ props }) => (
      <InteractiveChart
        data={props.data as Record<string, unknown>[]}
        initialXKey={props.xKey as string}
        initialYKeys={(props.series as Array<{ yKey: string }>).map(s => s.yKey)}
        initialType="line"
        title={props.title && props.title !== 'Title' ? props.title as string : undefined}
        yLabel={props.yLabel as string | undefined}
        source={props.source as string | undefined}
      />
    ),
    BarChartViz: ({ props }) => (
      <InteractiveChart
        data={props.data as Record<string, unknown>[]}
        initialXKey={props.xKey as string}
        initialYKeys={[props.yKey as string]}
        initialType="bar"
        title={props.title && props.title !== 'Title' ? props.title as string : undefined}
      />
    ),
    PieChartViz: ({ props }) => (
      <InteractiveChart
        data={props.data as Record<string, unknown>[]}
        initialXKey=""
        initialYKeys={[]}
        initialType="pie"
        initialLabelKey={props.labelKey as string}
        initialValueKey={props.angleKey as string}
        title={props.title && props.title !== 'Title' ? props.title as string : undefined}
      />
    ),
    DonutChartViz: ({ props }) => (
      <InteractiveChart
        data={props.data as Record<string, unknown>[]}
        initialXKey=""
        initialYKeys={[]}
        initialType="donut"
        initialLabelKey={props.labelKey as string}
        initialValueKey={props.angleKey as string}
        title={props.title && props.title !== 'Title' ? props.title as string : undefined}
      />
    ),
    RadarChartViz: ({ props }) => (
      <InteractiveChart
        data={props.data as Record<string, unknown>[]}
        initialXKey=""
        initialYKeys={[]}
        initialType="radar"
        initialLabelKey={props.angleKey as string}
        initialValueKey={props.radiusKey as string}
        title={props.title && props.title !== 'Title' ? props.title as string : undefined}
      />
    ),
    BubbleChartViz: ({ props }) => (
      <InteractiveChart
        data={props.data as Record<string, unknown>[]}
        initialXKey={props.xKey as string}
        initialYKeys={[props.yKey as string]}
        initialType="bubble"
        initialSizeKey={props.sizeKey as string}
        title={props.title && props.title !== 'Title' ? props.title as string : undefined}
      />
    ),
    QueryDataTable: ({ props }) => {
      const [spec, setSpec] = useState<GenericUiSpec | null>(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState<string | null>(null)
      const paramsKey = JSON.stringify(props.parameters ?? {})

      useEffect(() => {
        setLoading(true)
        setError(null)
        fetch('/api/spec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: props.queryKey, genieResult: props.parameters ?? {} }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return res.json() as Promise<GenerateSpecApiResponse>
          })
          .then(({ spec: fetchedSpec }) => {
            setSpec(fetchedSpec)
            setLoading(false)
          })
          .catch((err: Error) => {
            setError(err.message)
            setLoading(false)
          })
      }, [props.queryKey, paramsKey]) // eslint-disable-line react-hooks/exhaustive-deps

      return (
        <Box mt="xs" mb="xs">
          {props.caption && <Text size="xs" c="dimmed" mb={4} fs="italic">{props.caption}</Text>}
          {loading && (
            <Group gap="xs">
              <Loader size="xs" color="teal" type="dots" />
              <Text size="xs" c="dimmed">Chargement...</Text>
            </Group>
          )}
          {error && <Text size="xs" c="red">{error}</Text>}
          {spec && (
            <JSONUIProvider registry={chatUiRegistry}>
              <Renderer spec={spec} registry={chatUiRegistry} />
            </JSONUIProvider>
          )}
        </Box>
      )
    },
    FormPanel: ({ props, children }) => (
      <Paper p="sm" withBorder radius="md" style={{ backgroundColor: '#ffffff' }}>
        {(props.title || props.description) && (
          <Box mb="sm">
            {props.title && <Text size="sm" fw={600}>{props.title}</Text>}
            {props.description && <Text size="xs" c="dimmed" mt={2}>{props.description}</Text>}
          </Box>
        )}
        <Stack gap="sm">{children}</Stack>
      </Paper>
    ),
    SelectInputField: ({ props }) => (
      <Select
        label={props.label}
        placeholder={props.placeholder}
        data={props.options}
        value={props.value ?? null}
        required={props.required}
        disabled={props.disabled}
        readOnly
        size="sm"
        radius="sm"
      />
    ),
    TextInputField: ({ props }) => (
      <TextInput
        label={props.label}
        placeholder={props.placeholder}
        value={props.value ?? ''}
        required={props.required}
        disabled={props.disabled}
        readOnly
        size="sm"
        radius="sm"
      />
    ),
    NumberInputField: ({ props }) => (
      <NumberInput
        label={props.label}
        placeholder={props.placeholder}
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        required={props.required}
        disabled={props.disabled}
        readOnly
        size="sm"
        radius="sm"
      />
    ),
    ToggleField: ({ props }) => (
      <Switch
        label={props.label}
        description={props.description}
        checked={Boolean(props.checked)}
        disabled={props.disabled ?? true}
        readOnly
        color="teal"
        size="md"
      />
    ),
    WorkflowRuleBuilder: ({ props }) => {
      const operators = props.operators ?? [
        'is equal to',
        'is not equal',
        'contains',
        'superior to',
        'inferior to',
        'strictly inferior',
      ]

      return (
        <Paper p="sm" withBorder radius="md" style={{ backgroundColor: '#ffffff' }}>
          {(props.title || props.description) && (
            <Box mb="sm">
              {props.title && <Text size="sm" fw={600}>{props.title}</Text>}
              {props.description && <Text size="xs" c="dimmed" mt={2}>{props.description}</Text>}
            </Box>
          )}

          <Stack gap="sm">
            {props.rules.map((rule, index) => {
              const fieldOptions = props.fields.map((field) => ({
                value: field.value,
                label: field.label,
              }))
              const ruleKey = [rule.field ?? 'field', rule.operator ?? 'operator', rule.valueText ?? '', String(rule.valueNumber ?? '')]
                .join('|') || `rule-${index}`

              return (
                <Paper key={ruleKey} p="xs" radius="sm" style={{ backgroundColor: '#f8f9fa' }}>
                  <Group grow align="flex-start">
                    <Select
                      label="Champ"
                      data={fieldOptions}
                      value={rule.field ?? null}
                      readOnly
                      size="xs"
                      radius="sm"
                    />
                    <Select
                      label="Règle"
                      data={operators.map((operator) => ({ value: operator, label: operator }))}
                      value={rule.operator ?? null}
                      readOnly
                      size="xs"
                      radius="sm"
                    />
                    {rule.valueType === 'number' ? (
                      <NumberInput
                        label="Valeur"
                        value={rule.valueNumber}
                        readOnly
                        size="xs"
                        radius="sm"
                      />
                    ) : (
                      <TextInput
                        label="Valeur"
                        value={rule.valueText ?? ''}
                        readOnly
                        size="xs"
                        radius="sm"
                      />
                    )}
                  </Group>
                </Paper>
              )
            })}
          </Stack>
        </Paper>
      )
    },
  },
})


/* ------------------------------------------------------------------ */
/*  Chart data transformation + rendering from GenieStatementResponse  */
/* ------------------------------------------------------------------ */


interface ChartDataRow {
  [key: string]: string | number
}

/**
 * Transform GenieStatementResponse into Recharts-friendly data.
 * Returns column metadata + converted rows (numeric columns parsed as numbers).
 */
function transformStatementToChartData(statement: GenieStatementResponse): {
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

  // Detect numeric columns: use type metadata, but also check actual values
  const numericColumns: string[] = []
  const stringColumns: string[] = []
  for (const col of columns) {
    const upperType = (col.type ?? 'STRING').toUpperCase()
    if (numericTypes.has(upperType) || upperType.startsWith('DECIMAL')) {
      numericColumns.push(col.name)
    } else {
      // Known string-like types should never be promoted to numeric,
      // even if their values look like numbers (e.g. years: "2020", "2021")
      const knownStringTypes = new Set(['STRING', 'VARCHAR', 'CHAR', 'DATE', 'TIMESTAMP', 'BOOLEAN', 'BINARY', 'ARRAY', 'MAP', 'STRUCT', 'INTERVAL'])
      if (knownStringTypes.has(upperType)) {
        stringColumns.push(col.name)
      } else {
        // Unknown/ambiguous type — sample first few rows to decide
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

/**
 * Build a GenericUiSpec from a GenieStatementResponse using catalog components.
 * Auto-detects chart type from column metadata; always includes a DataTable.
 */
function buildSpecFromGenieStatement(
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

function buildGenerativeUiSpec(blocks: ContentBlock[]): GenericUiSpec | null {
  if (blocks.length === 0) return null

  const elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }> = {}
  const rootId = 'root'

  elements[rootId] = {
    type: 'Stack',
    props: { gap: 6 },
    children: [],
  }

  blocks.forEach((block, index) => {
    const id = `block-${index}`
    let element: { type: string; props: Record<string, unknown>; children: string[] } | null = null

    if (block.type === 'text') {
      element = { type: 'TextContent', props: { content: block.content, size: 'sm' }, children: [] }
    } else if (block.type === 'bold') {
      element = { type: 'TextContent', props: { content: block.content, size: 'sm', weight: 700 }, children: [] }
    } else if (block.type === 'heading') {
      element = { type: 'TextContent', props: { content: block.content, size: 'sm', weight: 700 }, children: [] }
    } else if (block.type === 'bullets') {
      element = { type: 'BulletList', props: { items: block.items }, children: [] }
    } else if (block.type === 'table') {
      element = {
        type: 'DataTable',
        props: { caption: block.caption, headers: block.headers, rows: block.rows },
        children: [],
      }
    } else if (block.type === 'lineChart') {
      element = {
        type: 'LineChartViz',
        props: {
          title: block.title,
          data: block.data,
          series: block.series,
          xKey: block.xKey,
          yLabel: block.yLabel,
          source: block.source,
        },
        children: [],
      }
    } else if (block.type === 'barChart') {
      element = {
        type: 'BarChartViz',
        props: {
          title: block.title,
          data: block.data,
          yKey: block.yKey,
          xKey: block.xKey,
          color: block.color,
        },
        children: [],
      }
    }

    if (element) {
      elements[id] = element
      elements[rootId].children.push(id)
    }
  })

  return {
    root: rootId,
    elements,
  } as GenericUiSpec
}

function isGenericUiSpec(value: unknown): value is GenericUiSpec {
  if (!value || typeof value !== 'object') return false
  const spec = value as { root?: unknown; elements?: unknown }
  return typeof spec.root === 'string' && Boolean(spec.elements && typeof spec.elements === 'object')
}

const GENUI_MAX_ROWS = 100

function _truncateStatementResult(value: unknown): unknown {
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

function buildGenieResultPayload(message: Message): unknown {
  const queryResults = message.queryResults
    ? Object.fromEntries(
        Array.from(message.queryResults.entries()).map(([k, v]) => [k, _truncateStatementResult(v)])
      )
    : undefined

  // Keep only lightweight attachment metadata (no inline blobs)
  const attachments = (message.attachments ?? []).map((a) => ({
    attachmentId: a.attachmentId,
    query: a.query
      ? { title: a.query.title, description: a.query.description }
      : undefined,
  }))

  return { attachments, queryResults }
}

async function generateUiSpecForMessage(params: {
  prompt: string
  genieResult: unknown
}): Promise<GenericUiSpec | null> {
  try {
    const response = await fetch('/api/spec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.prompt,
        genieResult: params.genieResult,
      }),
    })

    if (!response.ok) return null
    const parsed = (await response.json()) as GenerateSpecApiResponse
    if (!isGenericUiSpec(parsed?.spec)) return null
    return parsed.spec
  } catch {
    return null
  }
}

async function runControllerPreflight(params: {
  prompt: string
  conversationContext: ControllerConversationContext
}): Promise<ControllerApiResponse | null> {
  try {
    const response = await fetch('/api/controller', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.prompt,
        conversationContext: params.conversationContext,
      }),
    })

    if (!response.ok) {
      // Try to parse the error body — the server may return a valid
      // ControllerApiResponse even on 502 (e.g. decision:'error').
      try {
        const errorBody = (await response.json()) as ControllerApiResponse
        if (errorBody && errorBody.decision) return errorBody
      } catch { /* body not parseable — fall through */ }
      return null
    }
    return (await response.json()) as ControllerApiResponse
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  Helper: serialize blocks to copyable plain text                    */
/* ------------------------------------------------------------------ */

function blocksToPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'text':
        case 'bold':
          return b.content
        case 'heading':
          return `\n${b.content}`
        case 'bullets':
          return b.items.map((i) => `  \u2022 ${i}`).join('\n')
        case 'table': {
          const header = b.headers.join(' | ')
          const sep = b.headers.map(() => '---').join(' | ')
          const rows = b.rows.map((r) => r.join(' | ')).join('\n')
          return [b.caption, header, sep, rows].filter(Boolean).join('\n')
        }
        case 'lineChart':
        case 'barChart':
          return `[Graphique : ${b.title}]`
        default:
          return ''
      }
    })
    .join('\n')
}

/* ------------------------------------------------------------------ */
/*  Label sanitisation + Q/R answer formatting                        */
/* ------------------------------------------------------------------ */

/** Strip trailing parenthetical technical IDs from a question label.
 *  e.g. "Identifiant de la filiale (sp_folder_id)" → "Identifiant de la filiale" */
function sanitizeLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

/** Format answered questions as a Q/R block for display in the chat. */
function formatQRAnswers(
  questions: ControllerQuestion[],
  answers: Record<string, string>
): string {
  return questions
    .map((q) => {
      const raw = answers[q.id]?.trim()
      if (!raw) return null
      const label = sanitizeLabel(q.label)
      const display =
        q.inputType === 'select' && q.options
          ? (q.options.find((o) => o.value === raw)?.label ?? raw)
          : raw
      return `Q : ${label}<br>R : ${display}`
    })
    .filter(Boolean)
    .join('<br><br>')
}

/* ------------------------------------------------------------------ */
/*  Memoised message content (avoids re-running fallback spec on       */
/*  every parent render)                                               */
/* ------------------------------------------------------------------ */

const MessageContent = memo(function MessageContent({
  msg,
  messageId,
  generatedSpec,
  registry,
  hideText,
}: {
  msg: Message
  messageId: string
  generatedSpec: GenericUiSpec | undefined
  registry: typeof chatUiRegistry
  hideText?: boolean
}) {
  const fallbackSpec = useMemo(
    () => (msg.blocks && msg.blocks.length > 0 ? buildGenerativeUiSpec(msg.blocks) : null),
    [msg.blocks]
  )

  /* Plugin-generated spec available → render via json-render */
  if (generatedSpec) {
    return (
      <>
        <JSONUIProvider key={messageId} registry={registry}>
          <Renderer spec={generatedSpec} registry={registry} />
        </JSONUIProvider>
      </>
    )
  }

  /* Fallback: legacy block-based + Genie query table rendering */
  return (
    <>
      {!hideText && msg.content && (
        <Text size="sm" style={{ lineHeight: 1.55 }}>
          {msg.content}
        </Text>
      )}
      {msg.blocks && msg.blocks.length > 0 && (
        <Box>
          {fallbackSpec ? (
            <JSONUIProvider key={`fallback-${messageId}`} registry={registry}>
              <Renderer spec={fallbackSpec} registry={registry} />
            </JSONUIProvider>
          ) : (
            msg.blocks.map((block) => (
              <RenderBlock key={JSON.stringify(block)} block={block} />
            ))
          )}
        </Box>
      )}
      {msg.attachments
        ?.filter((attachment) => Boolean(attachment.attachmentId))
        .map((attachment) => {
          const attachmentId = attachment.attachmentId
          if (!attachmentId || !msg.queryResults) return null

          const queryData = msg.queryResults.get(attachmentId)
          const statement = toGenieStatementResponse(queryData)
          if (!statement) return null

          const attachmentSpec = buildSpecFromGenieStatement(statement, attachment.query?.title)
          return (
            <Box key={attachmentId} mt="sm">
              <JSONUIProvider key={`genie-${attachmentId}`} registry={registry}>
                <Renderer spec={attachmentSpec} registry={registry} />
              </JSONUIProvider>
            </Box>
          )
        })}
    </>
  )
})

/* ------------------------------------------------------------------ */
/*  Copy button                                                        */
/* ------------------------------------------------------------------ */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard not available */
    }
  }

  return (
    <Tooltip label={copied ? 'Copié !' : 'Copier la réponse'} position="top" withArrow>
      <ActionIcon
        variant="subtle"
        color={copied ? 'teal' : 'gray'}
        size="xs"
        onClick={() => {
          void handleCopy()
        }}
        aria-label="Copier la réponse"
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </ActionIcon>
    </Tooltip>
  )
}

/* ------------------------------------------------------------------ */
/*  Block renderers                                                    */
/* ------------------------------------------------------------------ */

function RenderBlock({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return (
        <Text size="sm" style={{ lineHeight: 1.6 }} mt={4}>
          {block.content}
        </Text>
      )
    case 'bold':
      return (
        <Text size="sm" fw={700} style={{ lineHeight: 1.6 }} mt={8}>
          {block.content}
        </Text>
      )
    case 'heading':
      return (
        <Text size="sm" fw={700} mt="md" mb={4} c="dark" style={{ lineHeight: 1.5 }}>
          {block.content}
        </Text>
      )
    case 'bullets':
      return (
        <List size="sm" mt={4} mb={4} spacing={2} withPadding>
          {block.items.map((item) => (
            <List.Item key={item}>
              <Text size="xs" style={{ lineHeight: 1.55 }}>{item}</Text>
            </List.Item>
          ))}
        </List>
      )
    case 'table': {
      const VISIBLE_COLS = 4
      const LARGE_TABLE_THRESHOLD = 200
      const columnDefs = block.headers.map((h, i) => ({
        field: h, headerName: h, sortable: true, filter: true, resizable: true, flex: 1, minWidth: 100,
        hide: i >= VISIBLE_COLS,
      }))
      const rowData = block.rows.map((row) =>
        Object.fromEntries(block.headers.map((h, i) => [h, row[i] ?? '']))
      )
      const isLarge = rowData.length > LARGE_TABLE_THRESHOLD
      const gridHeight = isLarge ? 500 : Math.min(300, 48 + rowData.length * 42)
      const hasHiddenCols = block.headers.length > VISIBLE_COLS
      return (
        <Box mt="xs" mb="xs" style={{ width: '100%', overflow: 'hidden' }}>
          {block.caption && <Text size="xs" c="dimmed" mb={4} fs="italic">{block.caption}</Text>}
          <div style={{ height: gridHeight, width: '100%' }}>
            <AgGridReact
              theme={themeQuartz}
              columnDefs={columnDefs}
              rowData={rowData}
              domLayout="normal"
              suppressMovableColumns
              rowBuffer={20}
              animateRows={!isLarge}
              pagination={rowData.length > 10}
              paginationPageSize={isLarge ? 50 : 10}
              sideBar={hasHiddenCols ? { toolPanels: [{ id: 'columns', labelDefault: 'Colonnes', labelKey: 'columns', iconKey: 'columns', toolPanel: 'agColumnsToolPanel', toolPanelParams: { suppressRowGroups: true, suppressValues: true, suppressPivots: true, suppressPivotMode: true } }] } : undefined}
            />
          </div>
        </Box>
      )
    }
    case 'lineChart': {
      const lineOptions = {
        data: block.data,
        title: { text: block.title, fontSize: 12, fontWeight: 'bold' as const },
        series: block.series.map((s) => ({
          type: 'line' as const,
          xKey: block.xKey,
          yKey: s.yKey,
          yName: s.yName,
          stroke: s.stroke,
          marker: { enabled: false },
        })),
        axes: [
          { type: 'category' as const, position: 'bottom' as const },
          {
            type: 'number' as const,
            position: 'left' as const,
            title: block.yLabel ? { text: block.yLabel } : undefined,
          },
        ],
        height: 200,
        legend: { position: 'bottom' as const },
        zoom: { enabled: true },
      }
      return (
        <Box mt="md" mb="sm" style={{ width: '100%' }}>
          <Paper p="xs" withBorder radius="sm" style={{ backgroundColor: '#fff' }}>
            <AgCharts options={lineOptions} />
            {block.source && (
              <Text size="xs" c="dimmed" ta="right" mt={4} fs="italic">
                {'Source : ' + block.source}
              </Text>
            )}
          </Paper>
        </Box>
      )
    }
    case 'barChart': {
      const barOptions = {
        data: block.data,
        title: { text: block.title, fontSize: 12, fontWeight: 'bold' as const },
        series: [{ type: 'bar' as const, xKey: block.xKey, yKey: block.yKey, fill: block.color }],
        axes: [
          { type: 'category' as const, position: 'bottom' as const },
          { type: 'number' as const, position: 'left' as const },
        ],
        height: 160,
        legend: { enabled: false },
        zoom: { enabled: true },
      }
      return (
        <Box mt="md" mb="sm" style={{ width: '100%' }}>
          <Paper p="xs" withBorder radius="sm" style={{ backgroundColor: '#fff' }}>
            <AgCharts options={barOptions} />
          </Paper>
        </Box>
      )
    }
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/*  Genie query table (dynamic columns + per-column filters)           */
/* ------------------------------------------------------------------ */

function toGenieStatementResponse(data: unknown): GenieStatementResponse | null {
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

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export interface SavedControl {
  id: string
  name: string
  description: string
  results: string
  rubriqueId: string
}

const RUBRIQUES = [
  { value: '01', label: '01. CARTOGRAPHIES GENERALES' },
  { value: '02', label: "02. COMPLETUDE DE L'INFORMATION COMPTABLE" },
  { value: '03', label: '03. CONFORMITE COMPTABLE' },
  { value: '04', label: '04. OPERATIONS DIVERSES' },
  { value: '05', label: '05. ACHATS' },
  { value: '06', label: '06. VENTES' },
  { value: '07', label: '07. TVA' },
  { value: '08', label: '08. RESULTAT ET IS' },
  { value: '09', label: '09. ECRITURES COMPLEXES' },
]

/* AI-recommended rubrique for each known suggestion */
const suggestedRubriqueMap: Record<number, string> = {
  0: '05', // Achats
  1: '05', // Achats
  2: '05', // Achats
  3: '04', // Operations diverses
  4: '03', // Conformite comptable
}

/* Keywords to infer rubrique from free text input */
function inferRubriqueFromText(text: string): string {
  const lower = text.toLowerCase()
  if (lower.includes('achat') || lower.includes('fournisseur') || lower.includes('facture')) return '05'
  if (lower.includes('vente') || lower.includes('client') || lower.includes('chiffre d\'affaires')) return '06'
  if (lower.includes('tva') || lower.includes('taxe')) return '07'
  if (lower.includes('resultat') || lower.includes('impot') || lower.includes('is ')) return '08'
  if (lower.includes('ecriture') || lower.includes('complexe') || lower.includes('ajustement')) return '09'
  if (lower.includes('completude') || lower.includes('information comptable')) return '02'
  if (lower.includes('conformite') || lower.includes('solde') || lower.includes('balance')) return '03'
  if (lower.includes('operation') || lower.includes('diverse') || lower.includes('tiers')) return '04'
  if (lower.includes('cartographie') || lower.includes('volumetrie') || lower.includes('ratio')) return '01'
  return '01'
}

/* ------------------------------------------------------------------ */
/*  Team controls data & panel                                         */
/* ------------------------------------------------------------------ */

interface TeamControl {
  id: string
  name: string
  rubriqueId: string
  createdBy: string
  createdAt: string
  status: 'brouillon' | 'validé' | 'en revue'
  description: string
  results: string
}

const teamControls: TeamControl[] = []

const statusColors: Record<string, string> = {
  'brouillon': 'gray',
  'validé': 'green',
  'en revue': 'orange',
}

function TeamControlsPanel({
  onBack,
  onPublish,
}: {
  onBack: () => void
  onPublish: (controls: TeamControl[]) => void
}) {
  const [search, setSearch] = useState('')
  const [filterRubrique, setFilterRubrique] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [published, setPublished] = useState(false)

  const filtered = teamControls.filter((tc) => {
    const matchSearch =
      !search ||
      tc.name.toLowerCase().includes(search.toLowerCase()) ||
      tc.createdBy.toLowerCase().includes(search.toLowerCase()) ||
      tc.description.toLowerCase().includes(search.toLowerCase())
    const matchRubrique = !filterRubrique || tc.rubriqueId === filterRubrique
    return matchSearch && matchRubrique
  })

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((tc) => tc.id)))
    }
  }

  const handlePublish = () => {
    const toPublish = teamControls.filter((tc) => selected.has(tc.id))
    onPublish(toPublish)
    setPublished(true)
    setTimeout(() => setPublished(false), 2500)
    setSelected(new Set())
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box
        px="md"
        py="sm"
        style={{ borderBottom: '1px solid #e9ecef', backgroundColor: '#fff', flexShrink: 0 }}
      >
        <Group justify="space-between" mb="xs">
          <Group gap="xs">
            <ThemeIcon
              size="sm"
              radius="sm"
              style={{ background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}
            >
              <IconListDetails size={14} color="#fff" />
            </ThemeIcon>
            <Text size="sm" fw={600}>{"Contrôles de l'équipe"}</Text>
          </Group>
          <Button size="xs" variant="subtle" color="gray" onClick={onBack} leftSection={<IconX size={14} />}>
            Retour
          </Button>
        </Group>
        {/* Search + Filter */}
        <Group gap="xs" wrap="nowrap">
          <TextInput
            placeholder="Rechercher un contrôle..."
            size="xs"
            radius="sm"
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Select
            placeholder="Rubrique"
            size="xs"
            radius="sm"
            clearable
            leftSection={<IconFilter size={14} />}
            data={RUBRIQUES}
            value={filterRubrique}
            onChange={setFilterRubrique}
            w={220}
          />
        </Group>
      </Box>

      {/* Table */}
      <ScrollArea style={{ flex: 1 }}>
        <Box px="md" py="xs">
          <Table
            highlightOnHover
            striped
            withTableBorder
            withColumnBorders={false}
            styles={{
              table: { fontSize: 12 },
              th: { fontSize: 11, fontWeight: 600, color: '#495057', padding: '8px 10px', backgroundColor: '#f8f9fa' },
              td: { padding: '8px 10px', verticalAlign: 'top' },
            }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 36 }}>
                  <Checkbox
                    size="xs"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    indeterminate={selected.size > 0 && selected.size < filtered.length}
                    onChange={toggleAll}
                    aria-label="Tout sélectionner"
                    color="teal"
                  />
                </Table.Th>
                <Table.Th>Contrôle</Table.Th>
                <Table.Th style={{ width: 90 }}>Rubrique</Table.Th>
                <Table.Th style={{ width: 90 }}>{"Créé par"}</Table.Th>
                <Table.Th style={{ width: 80 }}>Date</Table.Th>
                <Table.Th style={{ width: 80 }}>Statut</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text size="xs" c="dimmed" ta="center" py="md">
                      Aucun contrôle ne correspond aux critères de recherche.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                filtered.map((tc) => (
                  <Table.Tr
                    key={tc.id}
                    style={{
                      cursor: 'pointer',
                      backgroundColor: selected.has(tc.id) ? '#f0fdf4' : undefined,
                    }}
                    onClick={() => toggleSelect(tc.id)}
                  >
                    <Table.Td>
                      <Checkbox
                        size="xs"
                        checked={selected.has(tc.id)}
                        onChange={() => toggleSelect(tc.id)}
                        color="teal"
                        aria-label={`Sélectionner ${tc.name}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap" align="flex-start">
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" fw={500} style={{ lineHeight: 1.4 }}>
                            {tc.name}
                          </Text>
                          <Text size="xs" c="dimmed" lineClamp={2} style={{ lineHeight: 1.4 }}>
                            {tc.description}
                          </Text>
                        </Box>
                        <Tooltip label={"Généré par l'IA"} withArrow position="top">
                          <Badge
                            size="xs"
                            color="teal"
                            variant="light"
                            leftSection={<IconSparkles size={9} />}
                            styles={{ root: { textTransform: 'none', flexShrink: 0 } }}
                          >
                            IA
                          </Badge>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        variant="light"
                        color="gray"
                        styles={{ root: { textTransform: 'none' } }}
                      >
                        {RUBRIQUES.find((r) => r.value === tc.rubriqueId)?.value || tc.rubriqueId}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{tc.createdBy}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{tc.createdAt}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        color={statusColors[tc.status] || 'gray'}
                        variant="light"
                        styles={{ root: { textTransform: 'capitalize' } }}
                      >
                        {tc.status}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Box>
      </ScrollArea>

      {/* Bottom action bar */}
      <Box
        px="md"
        py="sm"
        style={{ borderTop: '1px solid #e9ecef', backgroundColor: '#fff', flexShrink: 0 }}
      >
        <Transition mounted={published} transition="slide-up" duration={300}>
          {(styles) => (
            <Paper
              p="xs"
              mb="xs"
              radius="sm"
              style={{
                ...styles,
                backgroundColor: '#d3f9d8',
                border: '1px solid #b2f2bb',
              }}
            >
              <Group gap="xs" justify="center">
                <IconCheck size={14} color="#2b8a3e" />
                <Text size="xs" fw={500} c="#2b8a3e">
                  {'Contrôles publiés avec succès sur la synthèse !'}
                </Text>
              </Group>
            </Paper>
          )}
        </Transition>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {selected.size > 0
              ? `${selected.size} contrôle${selected.size > 1 ? 's' : ''} sélectionné${selected.size > 1 ? 's' : ''}`
              : `${filtered.length} contrôle${filtered.length > 1 ? 's' : ''} au total`}
          </Text>
          <Button
            size="sm"
            leftSection={<IconUpload size={16} />}
            disabled={selected.size === 0 || published}
            onClick={handlePublish}
            style={
              selected.size > 0 && !published
                ? { background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }
                : undefined
            }
            color="teal"
          >
            {`Publier (${selected.size})`}
          </Button>
        </Group>
      </Box>
    </Box>
  )
}

type UserRight = 'lecture' | 'modification' | 'aucun'

const DOSSIER_USERS: { id: string; name: string; email: string; initials: string; role: string }[] = []

const INITIAL_USER_RIGHTS: Record<string, UserRight> = {}

interface AiChatDrawerProps {
  opened: boolean
  onClose: () => void
  onSaveControl?: (control: SavedControl) => void
}

export function AiChatDrawer({ opened, onClose, onSaveControl }: AiChatDrawerProps) {
  const { messages: genieMessages, status: chatStatus, error: genieError, sendMessage, reset } = useGenieChat({
    alias: "demo",
    basePath: '/api/chat-controller',
  })
  const [localUserMessages, setLocalUserMessages] = useState<Message[]>([])

  // Track first-seen timestamps for Genie messages (they have no timestamp field)
  const genieTimestampsRef = useRef<Map<string, string>>(new Map())

  // Map enriched/rewritten prompts sent to Genie → original user prompt
  // so the UI always shows the user's original text, not the technical enriched version
  const enrichedToOriginalRef = useRef<Map<string, string>>(new Map())

  // Remove local user messages that are now echoed in genieMessages
  const prevGenieCountRef = useRef(genieMessages.length)
  useEffect(() => {
    if (genieMessages.length > prevGenieCountRef.current) {
      // Build a set of user message contents from genie for fast lookup
      // Also check enrichedToOriginal mapping so dedup works when enriched prompt was sent
      const genieUserContents = new Set(
        genieMessages
          .filter((m) => m.role === 'user')
          .map((m) => {
            const original = enrichedToOriginalRef.current.get(m.content.trim())
            return original ?? m.content.trim()
          })
      )
      setLocalUserMessages((prev) =>
        prev.filter((local) => !genieUserContents.has(local.content.trim()))
      )
    }
    prevGenieCountRef.current = genieMessages.length
  }, [genieMessages])

  // Record first-seen timestamps for new Genie messages
  useEffect(() => {
    const ts = genieTimestampsRef.current
    for (const m of genieMessages) {
      const key = String(m.id)
      if (!ts.has(key)) {
        ts.set(key, new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
      }
    }
  }, [genieMessages])

  // Inject a loading placeholder while Genie is streaming (before first assistant message arrives)
  useEffect(() => {
    if (chatStatus === 'idle') {
      setLocalUserMessages(prev => prev.filter(m => m.id !== 'genie-streaming'))
      return
    }
    const hasGenieResponse = genieMessages.some(m => m.role === 'assistant')
    if (!hasGenieResponse) {
      setLocalUserMessages(prev => {
        if (prev.some(m => m.id === 'genie-streaming')) return prev
        return [...prev, {
          id: 'genie-streaming',
          role: 'assistant' as const,
          content: '',
          loading: true,
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        }]
      })
    } else {
      setLocalUserMessages(prev => prev.filter(m => m.id !== 'genie-streaming'))
    }
  }, [chatStatus, genieMessages])

  // Simple mirror: Genie messages + any local messages not yet picked up by Genie
  // Filter out internal/empty messages that should not be shown to users
  // Sort by timestamp ascending (oldest first, newest at bottom)
  const messages: Message[] = useMemo(() => {
    const ts = genieTimestampsRef.current
    const eMap = enrichedToOriginalRef.current
    // Mark the last complete Genie assistant message for the thinking accordion
    const lastGenieAssistantId = chatStatus === 'idle'
      ? [...genieMessages].reverse().find(m =>
          m.role === 'assistant' && Boolean((m as Message).content?.trim() || (m as Message).attachments?.length)
        )?.id ?? null
      : null
    const merged: Message[] = [...genieMessages.map((gm) => {
      // Replace enriched/rewritten content with the original user prompt so
      // technical details (tables, functions, columns) are never shown in the UI
      const originalContent = gm.role === 'user' ? eMap.get(gm.content.trim()) : undefined
      return {
        ...gm,
        content: originalContent ?? gm.content,
        timestamp: (gm as Message).timestamp ?? ts.get(String(gm.id)),
        thinking: gm.id === lastGenieAssistantId,
      }
    }), ...localUserMessages]
    const filtered = merged.filter((msg) => {
      // Never show internal controller messages
      if (msg.type === 'controller') return false
      // Always show user messages
      if (msg.role === 'user') return true
      // Show assistant messages that have visible content, blocks, or attachments
      const hasContent = Boolean(msg.content?.trim())
      const hasBlocks = Boolean('blocks' in msg && msg.blocks && msg.blocks.length > 0)
      const hasAttachments = Boolean(msg.attachments && msg.attachments.length > 0)
      const isLoading = Boolean('loading' in msg && msg.loading)
      const isPeriodPrompt = Boolean('periodPrompt' in msg && msg.periodPrompt)
      return hasContent || hasBlocks || hasAttachments || isLoading || isPeriodPrompt
    })
    // Sort by timestamp ascending (HH:MM string), then by epoch extracted from id
    // as a tiebreaker to preserve insertion order within the same minute.
    filtered.sort((a, b) => {
      const ta = a.timestamp ?? ''
      const tb = b.timestamp ?? ''
      if (ta < tb) return -1
      if (ta > tb) return 1
      // Same minute — use numeric suffix of id (epoch ms for local messages)
      const ea = typeof a.id === 'number' ? a.id : parseInt(/(\d+)$/.exec(String(a.id))?.[1] ?? '0', 10)
      const eb = typeof b.id === 'number' ? b.id : parseInt(/(\d+)$/.exec(String(b.id))?.[1] ?? '0', 10)
      return ea - eb
    })
    return filtered
  }, [genieMessages, localUserMessages, chatStatus])

  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(true)
  const viewport = useRef<HTMLDivElement>(null)
  const [generatedSpecs, setGeneratedSpecs] = useState<Record<string, GenericUiSpec>>({})

  const inFlightSpecIdsRef = useRef<Set<string>>(new Set())
  const attemptedSpecIdsRef = useRef<Set<string>>(new Set())
  /** True when Genie's last response was a text-only follow-up question (no data) */
  const genieFollowUpRef = useRef(false)
  const sessionIdRef = useRef(typeof crypto !== 'undefined' ? crypto.randomUUID() : `session-${Date.now()}`)
  const conversationIdRef = useRef(typeof crypto !== 'undefined' ? crypto.randomUUID() : `conversation-${Date.now()}`)
  const [showTeamControls, setShowTeamControls] = useState(false)
  const [ControllerLoading, setControllerLoading] = useState(false)
  const [ControllerHint, setControllerHint] = useState<ControllerApiResponse | null>(null)
  const [pendingClarification, setPendingClarification] = useState<PendingClarification | null>(null)
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({})
  const [clarificationRetryCount, setClarificationRetryCount] = useState(0)

  const handlePublishTeamControls = (controls: TeamControl[]) => {
    if (onSaveControl) {
      controls.forEach((tc) => {
        onSaveControl({
          id: `team-${tc.id}-${Date.now()}`,
          name: tc.name,
          description: tc.description,
          results: tc.results,
          rubriqueId: tc.rubriqueId,
        })
      })
    }
  }

  /* Save control modal state */
  const [saveModalOpened, setSaveModalOpened] = useState(false)
  const [saveForm, setSaveForm] = useState({
    name: '',
    description: '',
    results: '',
    rubriqueId: '01',
  })
  const [aiSuggestedRubrique, setAiSuggestedRubrique] = useState<string | null>(null)
  const [rubriqueAlert, setRubriqueAlert] = useState(false)
  const [saved, setSaved] = useState(false)
  const [applyToGroup, setApplyToGroup] = useState(false)

  const [userRights, setUserRights] = useState<Record<string, UserRight>>(() => ({ ...INITIAL_USER_RIGHTS }))

  const rightOptions: { value: UserRight; label: string; icon: React.ReactNode; color: string }[] = [
    { value: 'modification', label: 'Modification', icon: <IconPencil size={14} />, color: '#0c8599' },
    { value: 'lecture', label: 'Lecture seule', icon: <IconEye size={14} />, color: '#f59f00' },
    { value: 'aucun', label: 'Aucun accès', icon: <IconShieldCheck size={14} />, color: '#868e96' },
  ]

  /* Track the last suggestion index for auto-fill */
  const lastSuggestionIndexRef = useRef(-1)

  useEffect(() => {
    if (viewport.current) {
      viewport.current.scrollTo({
        top: viewport.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages])

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const buildConversationContext = useCallback((currentUserMessage?: string) => {
    const pastMessages = messagesRef.current
      .filter((message) => Boolean(message.content?.trim()))
      .slice(-6)
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      }))
    const messages = currentUserMessage
      ? [...pastMessages, { role: 'user' as const, content: currentUserMessage }]
      : pastMessages
    return {
      conversationId: conversationIdRef.current,
      sessionId: sessionIdRef.current,
      source: 'ai-chat-drawer' as const,
      messages,
    }
  }, [])

  const submitPromptThroughController = useCallback(async (rawPrompt: string, options?: { suppressControllerBubble?: boolean }) => {
    const trimmedPrompt = rawPrompt.trim()
    if (!trimmedPrompt) return

    setShowSuggestions(false)
    setControllerLoading(true)
    setControllerHint(null)
    setInput('')

    // Only add a user bubble if no Q/R bubble was already inserted for this prompt
    // (handleClarificationSubmit pre-maps clarifiedPrompt → originalPrompt)
    if (!enrichedToOriginalRef.current.has(trimmedPrompt)) {
      setLocalUserMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: 'user' as const,
          content: trimmedPrompt,
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        },
      ])
    }

    try {
      const ControllerResponse = await runControllerPreflight({
        prompt: trimmedPrompt,
        conversationContext: buildConversationContext(trimmedPrompt),
      })

      if (!ControllerResponse) {
        setPendingClarification(null)
        setClarificationAnswers({})
        setControllerHint({
          decision: 'error',
          message: "L'agent IA n'a pas répondu. La demande est bloquée tant qu'elle n'a pas été validée.",
        })
        return
      }

      setControllerHint(ControllerResponse)

      if (ControllerResponse.decision === 'error') {
        setPendingClarification(null)
        return
      }

      if (ControllerResponse.decision === 'clarify') {
        const newRetryCount = clarificationRetryCount + 1
        setClarificationRetryCount(newRetryCount)

        if (newRetryCount >= 3) {
          setPendingClarification(null)
          setClarificationAnswers({})
          setControllerHint({
            decision: 'error',
            message: 'Après plusieurs tentatives de clarification, je ne suis pas en mesure de traiter cette demande. Veuillez contacter l\'équipe support pour obtenir de l\'aide.',
          })
          return
        }

        const questions = ControllerResponse.questions ?? []
        setPendingClarification({
          originalPrompt: trimmedPrompt,
          message: ControllerResponse.message,
          decision: ControllerResponse.decision,
          rewrittenPrompt: ControllerResponse.rewrittenPrompt,
          enrichedPrompt: ControllerResponse.enrichedPrompt,
          questions,
          suggestedTables: ControllerResponse.suggestedTables ?? [],
          suggestedFunctions: ControllerResponse.suggestedFunctions ?? [],
          canSendDirectly: false,
          needsParams: ControllerResponse.needsParams ?? false,
        })
        setClarificationAnswers(
          Object.fromEntries(questions.map((question) => [question.id, ''])) as Record<string, string>
        )
        return
      }

      // 'proceed' with high confidence → send enriched prompt to Genie
      if (isControllerApproved(ControllerResponse.decision, ControllerResponse.confidence)) {
        setPendingClarification(null)
        setClarificationAnswers({})
        setClarificationRetryCount(0)
        const promptToSend = ControllerResponse.enrichedPrompt || ControllerResponse.rewrittenPrompt?.trim() || trimmedPrompt
        if (promptToSend !== trimmedPrompt) {
          // Resolve chain: if trimmedPrompt is itself a remapped prompt, point to the ultimate original
          const ultimate = enrichedToOriginalRef.current.get(trimmedPrompt) ?? trimmedPrompt
          enrichedToOriginalRef.current.set(promptToSend.trim(), ultimate)
        }
        if (!options?.suppressControllerBubble && ControllerResponse.message?.trim()) {
          setLocalUserMessages((prev) => [
            ...prev,
            {
              id: `ctrl-${Date.now()}`,
              role: 'assistant' as const,
              content: ControllerResponse.message,
              timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
              type: 'controller' as const,
            },
          ])
        }
        sendMessage(promptToSend)
        return
      }

      // 'proceed' with low confidence or 'guide' → show confirmation with
      // option to send directly to Genie (Controller already approved via cookie)
      const questions = ControllerResponse.questions ?? []
      setPendingClarification({
        originalPrompt: trimmedPrompt,
        message: ControllerResponse.message || "L'agent IA recommande de vérifier la reformulation avant envoi à l'agent IA.",
        decision: ControllerResponse.decision,
        rewrittenPrompt: ControllerResponse.rewrittenPrompt,
        enrichedPrompt: ControllerResponse.enrichedPrompt,
        questions,
        suggestedTables: ControllerResponse.suggestedTables ?? [],
        suggestedFunctions: ControllerResponse.suggestedFunctions ?? [],
        canSendDirectly: true,
      })
      setClarificationAnswers(
        Object.fromEntries(questions.map((question) => [question.id, ''])) as Record<string, string>
      )
    } finally {
      setControllerLoading(false)
    }
  }, [buildConversationContext, clarificationRetryCount, sendMessage])

  // Track the last assistant message for which a GenUI spec was requested.
  const lastSpecCandidateIdRef = useRef<string | null>(null)

  useEffect(() => {
    // Wait until Genie finishes streaming (including all query_result events)
    // so the queryResults Map is fully populated before calling DSPy.
    if (chatStatus !== 'idle') return

    // Dismiss the controller hint once Genie has responded; keep error hints visible
    setControllerHint((prev) => (prev?.decision !== 'error' ? null : prev))

    const latestAssistantMessage = [...messages].reverse().find((message) =>
      message.role === 'assistant' &&
      !message.loading &&
      !message.periodPrompt &&
      (Boolean(message.content?.trim()) || Boolean(message.blocks && message.blocks.length > 0) || Boolean(message.attachments && message.attachments.length > 0))
    )

    if (!latestAssistantMessage) return

    // Text-only Genie messages (no attachments, no blocks) are follow-up questions or error
    // messages — show them as plain text and flag so the next user reply goes directly to Genie
    const hasGenieData = Boolean(
      (latestAssistantMessage.blocks && latestAssistantMessage.blocks.length > 0) ||
      (latestAssistantMessage.attachments && latestAssistantMessage.attachments.length > 0)
    )
    if (!hasGenieData) {
      genieFollowUpRef.current = true
      return
    }
    genieFollowUpRef.current = false

    const messageId = String(latestAssistantMessage.id)

    if (attemptedSpecIdsRef.current.has(messageId)) return
    if (inFlightSpecIdsRef.current.has(messageId)) return
    if (lastSpecCandidateIdRef.current === messageId) return

    const fallbackSpec = latestAssistantMessage.blocks ? buildGenerativeUiSpec(latestAssistantMessage.blocks) : null

    lastSpecCandidateIdRef.current = messageId
    attemptedSpecIdsRef.current.add(messageId)
    inFlightSpecIdsRef.current.add(messageId)

    void generateUiSpecForMessage({
      prompt: latestAssistantMessage.content || blocksToPlainText(latestAssistantMessage.blocks || []),
      genieResult: buildGenieResultPayload(latestAssistantMessage),
    })
      .then((spec) => {
        setGeneratedSpecs((previous) => {
          if (previous[messageId]) return previous
          if (!spec && !fallbackSpec) return previous
          return { ...previous, [messageId]: (spec || fallbackSpec)! }
        })
      })
      .finally(() => {
        inFlightSpecIdsRef.current.delete(messageId)
      })
  }, [chatStatus, messages])

  /* -------- Period confirmation handler (for "fournisseurs inactifs" workflow) -------- */
  const handlePeriodConfirm = useCallback((periodValue: string) => {
    const periodLabel = periodOptions.find((p) => p.value === periodValue)?.label ?? periodValue

    void submitPromptThroughController(`Période confirmée : ${periodLabel}`)
  }, [submitPromptThroughController])

  const handleSend = useCallback((text?: string) => {
    const msgText = text || input.trim()
    if (!msgText) return

    if (genieFollowUpRef.current) {
      // Genie asked a follow-up question — send the response directly without Controller pre-flight
      genieFollowUpRef.current = false
      setInput('')
      setShowSuggestions(false)
      setControllerHint(null)
      setPendingClarification(null)
      setLocalUserMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: 'user' as const,
          content: msgText,
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        },
      ])
      sendMessage(msgText)
      return
    }

    void submitPromptThroughController(msgText)
  }, [input, sendMessage, submitPromptThroughController])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    reset()
    setGeneratedSpecs({})
    setLocalUserMessages([])
    inFlightSpecIdsRef.current.clear()
    attemptedSpecIdsRef.current.clear()
    lastSpecCandidateIdRef.current = null
    enrichedToOriginalRef.current.clear()
    genieFollowUpRef.current = false
    setShowSuggestions(true)
    setControllerLoading(false)
    setControllerHint(null)
    setPendingClarification(null)
    setClarificationAnswers({})
    setClarificationRetryCount(0)
  }

  const handleClarificationSubmit = useCallback(() => {
    if (!pendingClarification) return

    const questionLines = pendingClarification.questions
      .map((question) => {
        const value = clarificationAnswers[question.id]?.trim()
        if (!value) return null
        return `- ${question.label}: ${value}`
      })
      .filter((value): value is string => Boolean(value))

    const basePrompt = pendingClarification.rewrittenPrompt?.trim() || pendingClarification.originalPrompt
    const clarifiedPrompt = questionLines.length > 0
      ? `${basePrompt}\nClarifications:\n${questionLines.join('\n')}`
      : basePrompt

    // Build the Q/R summary shown to the user in the chat bubble
    const qrSummary = formatQRAnswers(pendingClarification.questions, clarificationAnswers)

    setPendingClarification(null)

    if (pendingClarification.canSendDirectly) {
      const promptToSend = pendingClarification.enrichedPrompt || clarifiedPrompt
      // Map technical prompts → original so they never appear in the UI
      enrichedToOriginalRef.current.set(promptToSend.trim(), pendingClarification.originalPrompt)
      enrichedToOriginalRef.current.set(clarifiedPrompt.trim(), pendingClarification.originalPrompt)
      if (qrSummary) {
        setLocalUserMessages((prev) => [
          ...prev,
          {
            id: `qr-${Date.now()}`,
            role: 'user' as const,
            content: qrSummary,
            timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          },
        ])
        enrichedToOriginalRef.current.set(qrSummary.trim(), pendingClarification.originalPrompt)
      }
      sendMessage(promptToSend)
    } else {
      // Map the clarified prompt so submitPromptThroughController skips the duplicate bubble
      enrichedToOriginalRef.current.set(clarifiedPrompt.trim(), pendingClarification.originalPrompt)
      if (qrSummary) {
        setLocalUserMessages((prev) => [
          ...prev,
          {
            id: `qr-${Date.now()}`,
            role: 'user' as const,
            content: qrSummary,
            timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          },
        ])
        enrichedToOriginalRef.current.set(qrSummary.trim(), pendingClarification.originalPrompt)
      }
      void submitPromptThroughController(clarifiedPrompt, { suppressControllerBubble: true })
    }
  }, [clarificationAnswers, pendingClarification, sendMessage, submitPromptThroughController])

  const handleOpenSave = (msg: Message) => {
    const plainResults = msg.content + (msg.blocks ? '\n' + blocksToPlainText(msg.blocks) : '')
    /* Determine AI-suggested rubrique from suggestion index or free text */
    const sugIdx = lastSuggestionIndexRef.current
    const inferredRubrique = sugIdx >= 0 && suggestedRubriqueMap[sugIdx]
      ? suggestedRubriqueMap[sugIdx]
      : inferRubriqueFromText(msg.controlName || msg.content || '')
    setSaveForm({
      name: msg.controlName || '',
      description: msg.controlDescription || '',
      results: plainResults.trim().slice(0, 2000),
      rubriqueId: inferredRubrique,
    })
    setAiSuggestedRubrique(inferredRubrique)
    setRubriqueAlert(false)
    setSaved(false)
    setApplyToGroup(false)
    setSaveModalOpened(true)
  }

  const handleSaveSubmit = () => {
    setSaved(true)
    if (onSaveControl) {
      onSaveControl({
        id: `ai-${Date.now()}`,
        name: saveForm.name,
        description: saveForm.description,
        results: saveForm.results,
        rubriqueId: saveForm.rubriqueId,
      })
    }
    setTimeout(() => {
      setSaveModalOpened(false)
      setSaved(false)
      setApplyToGroup(false)
    }, 1500)
  }

  /* Build copyable text for a message */
  const getCopyText = (msg: Message): string => {
    let text = msg.content || ''
    if (msg.blocks && msg.blocks.length > 0) {
      text += (text ? '\n' : '') + blocksToPlainText(msg.blocks)
    }
    return text.trim()
  }

  return (
    <>
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={560}
      withCloseButton={false}
      padding={0}
      lockScroll={false}
      withOverlay={false}
      shadow="xl"
      styles={{
        body: {
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        },
        content: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        },
      }}
    >
      {showTeamControls ? (
        <TeamControlsPanel
          onBack={() => setShowTeamControls(false)}
          onPublish={handlePublishTeamControls}
        />
      ) : (
      <>
      {/* Header */}
      <Box
        px="md"
        py="sm"
        style={{
          borderBottom: '1px solid #e9ecef',
          backgroundColor: '#fff',
          flexShrink: 0,
        }}
      >
        <Group justify="space-between">
          <Group gap="xs">
            <ThemeIcon
              size="sm"
              radius="sm"
              style={{ background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}
            >
              <IconSparkles size={14} color="#fff" />
            </ThemeIcon>
            <Text size="sm" fw={600}>Assistant</Text>
          </Group>
          <Group gap={4}>
            <Tooltip label={"Contrôles de l'équipe"} position="bottom" withArrow>
              <ActionIcon
                variant="subtle"
                color="teal"
                size="sm"
                onClick={() => setShowTeamControls(true)}
                aria-label={"Contrôles de l'équipe"}
              >
                <IconListDetails size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Effacer la conversation" position="bottom" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleClear} aria-label="Effacer la conversation">
                <IconTrash size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Agrandir" position="bottom" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Agrandir">
                <IconArrowsMaximize size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Fermer" position="bottom" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose} aria-label="Fermer">
                <IconX size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>

      {/* Messages area */}
      <ScrollArea
        style={{ flex: 1 }}
        viewportRef={viewport}
      >
        <Box px="md" py="sm">
          {/* Welcome / description block */}
          {showSuggestions && messages.length === 0 && (
            <Stack gap="md">
              <Paper
                p="md"
                radius="md"
                style={{
                  backgroundColor: '#f0fdf9',
                  border: '1px solid #c3fae8',
                }}
              >
                <Group gap="xs" mb="xs">
                  <IconBulb size={16} color="#0c8599" />
                  <Text size="sm" fw={600} c="#0c8599">
                    Assistant de génération de contrôles
                  </Text>
                </Group>
                <Text size="xs" style={{ lineHeight: 1.6 }} c="dark">
                  Cet assistant vous permet de <b>générer de nouveaux contrôles personnalisés en langage naturel</b>. Décrivez simplement le type de vérification que vous souhaitez effectuer et l{"'"}assistant analysera vos données pour produire des résultats détaillés.
                </Text>
                <Divider my="xs" color="#c3fae8" />
                <Text size="xs" fw={600} mb={4} c="dark">
                  Bonnes pratiques :
                </Text>
                <List size="xs" spacing={2} withPadding>
                  <List.Item>
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
                      Soyez précis dans votre description (périmètre comptable, seuils, période)
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
                      Utilisez le vocabulaire comptable pour de meilleurs résultats
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
                      Posez des questions de suivi pour affiner l{"'"}analyse
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
                      Les résultats incluent textes, tableaux et graphiques interactifs
                    </Text>
                  </List.Item>
                </List>
              </Paper>

              <Box>
                <Text size="xs" fw={600} c="dimmed" mb="xs">
                  {'Exemples de questions d\'analyse et de contrôle'}
                </Text>
                <Stack gap={6}>
                  {suggestions.map((s, suggestionIndex) => (
                    <UnstyledButton
                      key={s}
                      onClick={() => {
                        lastSuggestionIndexRef.current = suggestionIndex
                        handleSend(s)
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #e9ecef',
                        backgroundColor: '#fff',
                        transition: 'all 150ms ease',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                        const t = e.currentTarget
                        t.style.borderColor = '#0c8599'
                        t.style.backgroundColor = '#f0fdf9'
                      }}
                      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                        const t = e.currentTarget
                        t.style.borderColor = '#e9ecef'
                        t.style.backgroundColor = '#fff'
                      }}
                    >
                      <Text size="xs" c="dark" style={{ lineHeight: 1.5 }}>
                        {s}
                      </Text>
                    </UnstyledButton>
                  ))}
                </Stack>
              </Box>
            </Stack>
          )}

          {/* Chat messages */}
          <Stack gap="md" mt={showSuggestions && messages.length === 0 ? 0 : undefined}>
            {messages.map((msg) => (
              <Box key={msg.id}>
                {msg.role === 'user' ? (
                  <Box>
                    <Paper
                      p="sm"
                      radius="md"
                      ml={40}
                      style={{
                        backgroundColor: '#1a1b25',
                        color: '#fff',
                      }}
                    >
                      {msg.content.includes('<br>') ? (
                        <span style={{ fontSize: 14, color: 'white', lineHeight: 1.55, display: 'block' }} dangerouslySetInnerHTML={{ __html: msg.content }} />
                      ) : (
                        <Text size="sm" c="white" style={{ lineHeight: 1.55 }}>
                          {msg.content}
                        </Text>
                      )}
                    </Paper>
                    <Text size="xs" c="dimmed" mt={4} ta="right" mr={4}>
                      {msg.timestamp}
                    </Text>
                  </Box>
                ) : (
                  <Group align="flex-start" gap="xs" wrap="nowrap">
                    <ThemeIcon
                      size="sm"
                      radius="xl"
                      mt={2}
                      style={{
                        flexShrink: 0,
                        background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)',
                      }}
                    >
                      <IconSparkles size={12} color="#fff" />
                    </ThemeIcon>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      {/* Loading state */}
                      {msg.loading && (
                        <Paper
                          p="sm"
                          radius="md"
                          style={{ backgroundColor: '#f8f9fa' }}
                        >
                          <Group gap="xs">
                            <Loader size="xs" color="teal" type="dots" />
                            <Text size="sm" c="dimmed">Analyse en cours...</Text>
                          </Group>
                          <Progress
                            value={65}
                            color="teal"
                            size="xs"
                            mt="xs"
                            radius="xl"
                            animated
                          />
                          <Text size="xs" c="dimmed" mt={4}>
                            Parcours des écritures et identification des fournisseurs inactifs...
                          </Text>
                        </Paper>
                      )}

                      {/* Period prompt */}
                      {msg.periodPrompt && !msg.loading && (
                        <Paper
                          p="sm"
                          radius="md"
                          style={{ backgroundColor: '#f8f9fa' }}
                        >
                          <Group gap="xs" mb="xs">
                            <IconCalendar size={14} color="#0c8599" />
                            <Text size="sm" style={{ lineHeight: 1.55 }}>
                              {msg.content}
                            </Text>
                          </Group>
                          <Stack gap={6} mt="xs">
                            {periodOptions.map((opt) => (
                              <UnstyledButton
                                key={opt.value}
                                onClick={() => handlePeriodConfirm(opt.value)}
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: 8,
                                  border: '1px solid #e9ecef',
                                  backgroundColor: '#fff',
                                  transition: 'all 150ms ease',
                                  cursor: 'pointer',
                                }}
                                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                                  const t = e.currentTarget
                                  t.style.borderColor = '#0c8599'
                                  t.style.backgroundColor = '#f0fdf9'
                                }}
                                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                                  const t = e.currentTarget
                                  t.style.borderColor = '#e9ecef'
                                  t.style.backgroundColor = '#fff'
                                }}
                              >
                                <Text size="xs" c="dark">{opt.label}</Text>
                              </UnstyledButton>
                            ))}
                          </Stack>
                        </Paper>
                      )}

                      {/* Thinking accordion */}
                      {msg.thinking && !msg.loading && (
                        <Accordion
                          variant="subtle"
                          styles={{
                            item: { borderBottom: 'none' },
                            control: { padding: '2px 0', minHeight: 24 },
                            label: { fontSize: 11, color: '#868e96' },
                            chevron: { width: 14, height: 14 },
                            content: { padding: 0 },
                          }}
                        >
                          <Accordion.Item value="thinking">
                            <Accordion.Control
                              chevron={<IconChevronDown size={12} />}
                            >
                              Analyse Genie terminée
                            </Accordion.Control>
                            <Accordion.Panel>
                              <Text size="xs" c="dimmed" fs="italic" style={{ lineHeight: 1.55 }}>
                                {msg.content || 'Analyse des données terminée.'}
                              </Text>
                            </Accordion.Panel>
                          </Accordion.Item>
                        </Accordion>
                      )}

                      {/* Regular content */}
                      {!msg.periodPrompt && !msg.loading && (
                        <Paper
                          p="sm"
                          radius="md"
                          style={{ backgroundColor: '#f8f9fa' }}
                        >
                          <MessageContent
                            msg={msg}
                            messageId={String(msg.id)}
                            generatedSpec={generatedSpecs[String(msg.id)]}
                            registry={chatUiRegistry}
                            hideText={Boolean(msg.thinking)}
                          />
                        </Paper>
                      )}

                      {/* Action row: timestamp, copy, save */}
                      {!msg.loading && (
                        <Group justify="space-between" mt={4} ml={4}>
                          <Text size="xs" c="dimmed">
                            {msg.timestamp}
                          </Text>
                          <Group gap={4}>
                            {/* Copy button */}
                            {(msg.content || (msg.blocks && msg.blocks.length > 0)) && !msg.periodPrompt && (
                              <CopyButton text={getCopyText(msg)} />
                            )}
                            {/* Save as control button */}
                            {(generatedSpecs[String(msg.id)] || (msg.blocks && msg.blocks.length > 0)) && (
                              <Tooltip label="Enregistrer comme contrôle" position="top" withArrow>
                                <ActionIcon
                                  variant="subtle"
                                  color="teal"
                                  size="xs"
                                  onClick={() => handleOpenSave(msg)}
                                  aria-label="Enregistrer comme contrôle"
                                >
                                  <IconDeviceFloppy size={14} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Group>
                        </Group>
                      )}
                    </Box>
                  </Group>
                )}
              </Box>
            ))}
          </Stack>

          {/* Controller loading / result / clarification — always at bottom after messages */}
          {ControllerLoading && (
            <Paper
              p="sm"
              radius="md"
              mt="md"
              mb="md"
              style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef' }}
            >
              <Group gap="xs">
                <Loader size="xs" color="teal" type="dots" />
                <Text size="sm" c="dimmed">L'agent IA analyse votre demande...</Text>
              </Group>
            </Paper>
          )}

          {genieError && !ControllerLoading && (
            <Alert
              variant="light"
              color="red"
              radius="md"
              mt="md"
              mb="md"
              icon={<IconAlertTriangle size={16} />}
            >
              <Text size="sm" fw={600}>Requête refusée par l'agent IA</Text>
              <Text size="xs" mt={4} style={{ lineHeight: 1.55 }}>
                {typeof genieError === 'string' ? genieError : String(genieError)}
              </Text>
            </Alert>
          )}

          {pendingClarification && !ControllerLoading && (
            <Paper
              p="sm"
              radius="md"
              mt="md"
              mb="md"
              style={{
                backgroundColor: pendingClarification.needsParams ? '#f0faf9' : '#f8f9fa',
                border: `1px solid ${pendingClarification.needsParams ? '#0c8599' : '#dee2e6'}`,
              }}
            >
              <Group gap="xs" mb="xs" align="flex-start">
                {pendingClarification.needsParams
                  ? <IconFilter size={16} color="#0c8599" />
                  : <IconAlertTriangle size={16} color="#f08c00" />
                }
                <Box style={{ flex: 1 }}>
                  <Text size="sm" fw={600}>
                    {pendingClarification.needsParams
                      ? 'Paramètres requis pour affiner la requête'
                      : 'Précision requise avant l\u2019envoi à l\u2019agent IA'
                    }
                  </Text>
                  <Text size="xs" c="dimmed" mt={2} style={{ lineHeight: 1.55 }}>
                    {pendingClarification.message}
                  </Text>
                </Box>
              </Group>

              {pendingClarification.questions.map((question) => (
                question.id === 'sp_folder_id' && clarificationAnswers['scope_level'] !== 'filiale' ? null : (
                <Box key={question.id} mb="sm">
                  <Text size="xs" fw={500} mb={4}>{sanitizeLabel(question.label)}</Text>
                  {question.inputType === 'select' && question.options && question.options.length > 0 ? (
                    <Select
                      data={question.options}
                      value={clarificationAnswers[question.id] ?? ''}
                      onChange={(value) => {
                        setClarificationAnswers((previous) => ({
                          ...previous,
                          [question.id]: value ?? '',
                        }))
                      }}
                      placeholder={question.placeholder || 'Sélectionnez une option'}
                      size="sm"
                      radius="sm"
                      allowDeselect={!question.required}
                    />
                  ) : question.inputType === 'number' ? (
                    <NumberInput
                      value={clarificationAnswers[question.id] ? Number(clarificationAnswers[question.id]) : undefined}
                      onChange={(value) => {
                        setClarificationAnswers((previous) => ({
                          ...previous,
                          [question.id]: value == null || value === '' ? '' : String(value),
                        }))
                      }}
                      placeholder={question.placeholder || 'Ajoutez une valeur numérique'}
                      min={question.min}
                      max={question.max}
                      step={question.step}
                      clampBehavior="strict"
                      allowDecimal={false}
                      allowNegative={question.min == null || question.min >= 0 ? false : true}
                      size="sm"
                      radius="sm"
                    />
                  ) : question.inputType === 'toggle' ? (
                    <Switch
                      checked={clarificationAnswers[question.id] === 'true'}
                      onChange={(event) => {
                        setClarificationAnswers((previous) => ({
                          ...previous,
                          [question.id]: String(event.currentTarget.checked),
                        }))
                      }}
                      size="md"
                      color="teal"
                      label={question.placeholder || 'Activer cette option'}
                    />
                  ) : (
                    <TextInput
                      value={clarificationAnswers[question.id] ?? ''}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setClarificationAnswers((previous) => ({
                          ...previous,
                          [question.id]: value,
                        }))
                      }}
                      placeholder={question.placeholder || 'Ajoutez une précision'}
                      size="sm"
                      radius="sm"
                    />
                  )}
                </Box>
                )
              ))}

              <Group justify="flex-end" mt="xs">
                <Button size="xs" color="teal" leftSection={pendingClarification.needsParams ? <IconFilter size={12} /> : undefined} onClick={handleClarificationSubmit}>
                  {pendingClarification.canSendDirectly ? 'Confirmer et envoyer' : pendingClarification.needsParams ? 'Appliquer les filtres' : 'Relancer avec ces précisions'}
                </Button>
              </Group>
            </Paper>
          )}

          {ControllerHint && !pendingClarification && !ControllerLoading && (
            <Paper
              p="sm"
              radius="md"
              mt="md"
              mb="md"
              style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef' }}
            >
              <Group gap="xs" align="flex-start">
                <IconRobot size={16} color="#0c8599" />
                <Box style={{ flex: 1 }}>
                  <Text size="xs" fw={600}>Pré-analyse par un agent IA</Text>
                  <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
                    {ControllerHint.message}
                  </Text>
                  <Group gap={6} mt={6}>
                    <Badge size="xs" variant="light" color={
                      ControllerHint.decision === 'error'
                        ? 'red'
                        : ControllerHint.decision === 'clarify'
                          ? 'orange'
                          : ControllerHint.decision === 'guide'
                            ? 'blue'
                            : 'teal'
                    }>
                      {({ clarify: 'Précision requise', guide: 'À affiner', proceed: 'Approuvé', error: 'Erreur' } as Record<string, string>)[ControllerHint.decision] ?? ControllerHint.decision}
                    </Badge>
                    {typeof ControllerHint.confidence === 'number' && (
                      <Badge size="xs" variant="outline" color="gray">
                        {`Confiance ${Math.round(ControllerHint.confidence * 100)}%`}
                      </Badge>
                    )}
                  </Group>
                  {ControllerHint.decision === 'error' && (
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      mt="xs"
                      onClick={() => setControllerHint(null)}
                    >
                      Fermer et réessayer
                    </Button>
                  )}
                </Box>
              </Group>
            </Paper>
          )}

          {/* Streaming indicator when Genie is actively responding */}
          {chatStatus === 'streaming' && !ControllerLoading && (
            <Box mt="md" px={4}>
              <Group align="flex-start" gap="xs" wrap="nowrap">
                <ThemeIcon
                  size="sm"
                  radius="xl"
                  mt={2}
                  style={{
                    flexShrink: 0,
                    background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)',
                  }}
                >
                  <IconSparkles size={12} color="#fff" />
                </ThemeIcon>
                <Paper
                  p="sm"
                  radius="md"
                  style={{ backgroundColor: '#f8f9fa', flex: 1 }}
                >
                  <Group gap="xs">
                    <Loader size="xs" color="teal" type="dots" />
                    <Text size="sm" c="dimmed">Analyse en cours...</Text>
                  </Group>
                </Paper>
              </Group>
            </Box>
          )}
        </Box>
      </ScrollArea>

      {/* Input */}
      <Box
        px="md"
        py="sm"
        style={{
          borderTop: '1px solid #e9ecef',
          backgroundColor: '#fff',
          flexShrink: 0,
        }}
      >
        <Group gap="xs" wrap="nowrap">
          <TextInput
            placeholder="Décrivez le contrôle à générer..."
            size="sm"
            radius="md"
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            style={{ flex: 1 }}
            styles={{
              input: {
                borderColor: '#dee2e6',
              },
            }}
          />
          <ActionIcon
            size="lg"
            radius="md"
            onClick={() => handleSend()}
            disabled={!input.trim() || chatStatus === 'streaming' || ControllerLoading}
            aria-label="Envoyer"
            style={{
              background: input.trim() && chatStatus !== 'streaming' && !ControllerLoading
                ? 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)'
                : '#e9ecef',
              border: 'none',
              color: input.trim() && chatStatus !== 'streaming' && !ControllerLoading ? '#fff' : '#adb5bd',
            }}
          >
            <IconSend size={16} />
          </ActionIcon>
        </Group>
        <Text ta="center" size="xs" c="dimmed" mt={6}>
          {'Vérifiez toujours l\'exactitude des réponses.'}
        </Text>
      </Box>
      </>
      )}
    </Drawer>

    {/* ---- Save control modal ---- */}
    <Modal
      opened={saveModalOpened}
      onClose={() => { setSaveModalOpened(false); setApplyToGroup(false) }}
      title={
        <Group gap="xs">
          <IconDeviceFloppy size={18} color="#0c8599" />
          <Text fw={600} size="sm">Enregistrer un nouveau contrôle</Text>
        </Group>
      }
      size="xl"
      radius="md"
      centered
      overlayProps={{ backgroundOpacity: 0.25, blur: 3 }}
    >
      <Stack gap="md">
        {/* --- Nom --- */}
        <Box>
          <Text size="xs" fw={500} mb={4}>Nom du contrôle</Text>
          <TextInput
            value={saveForm.name}
            onChange={(e) => setSaveForm((f) => ({ ...f, name: e.currentTarget.value }))}
            size="sm"
            radius="sm"
            placeholder="Ex: Vérification des fournisseurs inactifs"
            rightSection={
              saveForm.name ? (
                <Badge size="xs" color="teal" variant="light" mr={4}>
                  Auto-rempli
                </Badge>
              ) : null
            }
            rightSectionWidth={saveForm.name ? 90 : undefined}
          />
        </Box>
        {/* --- Description --- */}
        <Box>
          <Text size="xs" fw={500} mb={4}>Description du contrôle</Text>
          <Textarea
            value={saveForm.description}
            onChange={(e) => setSaveForm((f) => ({ ...f, description: e.currentTarget.value }))}
            size="sm"
            radius="sm"
            minRows={3}
            autosize
            placeholder={'Décrivez l\'objectif et le périmètre du contrôle...'}
          />
          {saveForm.description && (
            <Badge size="xs" color="teal" variant="light" mt={4}>
              {'Auto-rempli par l\'IA'}
            </Badge>
          )}
        </Box>
        {/* --- Résultats --- */}
        <Box>
          <Text size="xs" fw={500} mb={4}>Résultats</Text>
          <Textarea
            value={saveForm.results}
            onChange={(e) => setSaveForm((f) => ({ ...f, results: e.currentTarget.value }))}
            size="sm"
            radius="sm"
            minRows={5}
            maxRows={10}
            autosize
            placeholder={'Résultats de l\'analyse...'}
          />
          {saveForm.results && (
            <Badge size="xs" color="teal" variant="light" mt={4}>
              {'Auto-rempli par l\'IA'}
            </Badge>
          )}
        </Box>

        {/* --- Rubrique --- */}
        <Box>
          <Text size="xs" fw={500} mb={4}>{'Rubrique d\'affectation'}</Text>
          <Select
            value={saveForm.rubriqueId}
            onChange={(val) => {
              if (val) {
                setSaveForm((f) => ({ ...f, rubriqueId: val }))
                if (aiSuggestedRubrique && val !== aiSuggestedRubrique) {
                  setRubriqueAlert(true)
                } else {
                  setRubriqueAlert(false)
                }
              }
            }}
            data={RUBRIQUES}
            size="sm"
            radius="sm"
            allowDeselect={false}
            rightSection={
              saveForm.rubriqueId === aiSuggestedRubrique ? (
                <Badge size="xs" color="teal" variant="light" mr={24}>
                  {'Suggestion IA'}
                </Badge>
              ) : null
            }
            rightSectionWidth={saveForm.rubriqueId === aiSuggestedRubrique ? 110 : undefined}
          />
          {saveForm.rubriqueId === aiSuggestedRubrique && (
            <Group gap={4} mt={4}>
              <IconRobot size={13} color="#0c8599" />
              <Text size="xs" c="teal">
                {'Rubrique suggérée automatiquement par l\'IA en fonction du contenu du contrôle'}
              </Text>
            </Group>
          )}
        </Box>

        {/* --- AI correction alert --- */}
        {rubriqueAlert && aiSuggestedRubrique && (
          <Alert
            icon={<IconAlertTriangle size={18} />}
            color="orange"
            variant="light"
            radius="md"
            title="Correction de rubrique détectée"
            styles={{
              title: { fontSize: 13, fontWeight: 600 },
              message: { fontSize: 12 },
            }}
          >
            <Text size="xs">
              {'L\'IA a initialement suggéré la rubrique '}
              <Text span fw={600}>{RUBRIQUES.find((r) => r.value === aiSuggestedRubrique)?.label}</Text>
              {' pour ce contrôle. Vous avez sélectionné une rubrique différente. '}
            </Text>
            <Group gap="xs" mt={8}>
              <Button
                size="xs"
                variant="light"
                color="orange"
                leftSection={<IconRobot size={14} />}
                onClick={() => {
                  setSaveForm((f) => ({ ...f, rubriqueId: aiSuggestedRubrique }))
                  setRubriqueAlert(false)
                }}
              >
                {'Rétablir la suggestion IA'}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => setRubriqueAlert(false)}
              >
                {'Conserver ma sélection'}
              </Button>
            </Group>
          </Alert>
        )}

        {/* --- Activer sur toutes les sociétés du groupe --- */}
        <Divider />
        <Box>
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <IconUsers size={18} color="#0c8599" />
              <Box>
                <Text size="sm" fw={600}>{'Activer sur toutes les sociétés du groupe'}</Text>
                <Text size="xs" c="dimmed">{'Déployer ce contrôle sur l\'ensemble des entités du groupe'}</Text>
              </Box>
            </Group>
            <Switch
              checked={applyToGroup}
              onChange={(e) => setApplyToGroup(e.currentTarget.checked)}
              color="teal"
              size="md"
              aria-label="Activer sur toutes les sociétés du groupe"
            />
          </Group>
        </Box>

        {/* --- Liste des utilisateurs avec droits --- */}
        {applyToGroup && (
          <Box
            style={{
              border: '1px solid #e9ecef',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <Box
              px="sm"
              py="xs"
              style={{
                backgroundColor: '#f0fdf9',
                borderBottom: '1px solid #e9ecef',
              }}
            >
              <Group gap="xs">
                <IconShieldCheck size={15} color="#0c8599" />
                <Text size="xs" fw={600} c="#0c8599">
                  {'Utilisateurs ayant accès au dossier'}
                </Text>
                <Badge size="xs" color="teal" variant="light" ml="auto">
                  {DOSSIER_USERS.length} utilisateurs
                </Badge>
              </Group>
            </Box>

            {/* Table header */}
            <Box
              px="sm"
              py={6}
              style={{
                display: 'flex',
                backgroundColor: '#f8f9fa',
                borderBottom: '1px solid #f1f3f5',
              }}
            >
              <Text size="xs" fw={600} c="dimmed" style={{ flex: 1 }}>Utilisateur</Text>
              <Text size="xs" fw={600} c="dimmed" style={{ width: 130, textAlign: 'center' }}>{'Rôle'}</Text>
              <Text size="xs" fw={600} c="dimmed" style={{ width: 160, textAlign: 'center' }}>{'Droit d\'accès au contrôle'}</Text>
            </Box>

            {/* User rows */}
            <ScrollArea.Autosize mah={260}>
              {DOSSIER_USERS.map((user) => {
                const currentRight = userRights[user.id] || 'lecture'
                const rightDef = rightOptions.find((r) => r.value === currentRight) || rightOptions[0]
                return (
                  <Box
                    key={user.id}
                    px="sm"
                    py="xs"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      borderBottom: '1px solid #f1f3f5',
                    }}
                  >
                    {/* User info */}
                    <Group gap="sm" style={{ flex: 1 }}>
                      <Avatar
                        size="sm"
                        radius="xl"
                        color="teal"
                        styles={{
                          placeholder: {
                            fontSize: 10,
                            fontWeight: 600,
                          },
                        }}
                      >
                        {user.initials}
                      </Avatar>
                      <Box>
                        <Text size="xs" fw={500} style={{ lineHeight: 1.3 }}>{user.name}</Text>
                        <Text size="xs" c="dimmed" style={{ lineHeight: 1.3 }}>{user.email}</Text>
                      </Box>
                    </Group>
                    {/* Role */}
                    <Text size="xs" c="dimmed" style={{ width: 130, textAlign: 'center' }}>{user.role}</Text>
                    {/* Right selector */}
                    <Box style={{ width: 160, display: 'flex', justifyContent: 'center' }}>
                      <Select
                        value={currentRight}
                        onChange={(val) => {
                          if (val) {
                            setUserRights((prev) => ({ ...prev, [user.id]: val as UserRight }))
                          }
                        }}
                        data={rightOptions.map((r) => ({ value: r.value, label: r.label }))}
                        size="xs"
                        radius="sm"
                        allowDeselect={false}
                        styles={{
                          input: {
                            fontSize: 11,
                            fontWeight: 500,
                            color: rightDef.color,
                            borderColor: rightDef.color + '44',
                            backgroundColor: rightDef.color + '08',
                            textAlign: 'center',
                            paddingLeft: 8,
                            paddingRight: 24,
                          },
                          dropdown: {
                            fontSize: 11,
                          },
                        }}
                        w={140}
                      />
                    </Box>
                  </Box>
                )
              })}
            </ScrollArea.Autosize>

            {/* Summary bar */}
            <Box
              px="sm"
              py={6}
              style={{
                backgroundColor: '#f8f9fa',
                borderTop: '1px solid #e9ecef',
                display: 'flex',
                gap: 12,
                justifyContent: 'flex-end',
              }}
            >
              {rightOptions.map((r) => {
                const count = Object.values(userRights).filter((v) => v === r.value).length
                return (
                  <Group key={r.value} gap={4}>
                    <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.color }} />
                    <Text size="xs" c="dimmed">{r.label}: <b>{count}</b></Text>
                  </Group>
                )
              })}
            </Box>
          </Box>
        )}

        {/* --- Actions --- */}
        <Group justify="flex-end" mt="xs">
          <Button
            variant="default"
            size="sm"
            onClick={() => { setSaveModalOpened(false); setApplyToGroup(false) }}
          >
            Annuler
          </Button>
          <Button
            size="sm"
            color="teal"
            leftSection={saved ? <IconCheck size={16} /> : <IconDeviceFloppy size={16} />}
            onClick={handleSaveSubmit}
            disabled={!saveForm.name.trim()}
            style={
              saved
                ? { backgroundColor: '#2b8a3e' }
                : { background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }
            }
          >
            {saved ? 'Enregistré !' : 'Enregistrer le contrôle'}
          </Button>
        </Group>
      </Stack>
    </Modal>
    </>
  )
}
