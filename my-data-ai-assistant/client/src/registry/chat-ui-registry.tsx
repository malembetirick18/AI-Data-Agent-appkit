import { memo, useState, useMemo, useEffect } from 'react'
import {
  Text, Box, List, Paper, Stack, Group, Loader,
  Select, TextInput, NumberInput, Switch,
} from '@mantine/core'
import { AgGridReact } from 'ag-grid-react'
import { AllEnterpriseModule, ModuleRegistry, themeQuartz } from 'ag-grid-enterprise'
import { JSONUIProvider, Renderer, defineRegistry, useUIStream } from '@json-render/react'
import { chatUiCatalog } from '../../../shared/genui-catalog'
import InteractiveChart from '../components/InteractiveChart'
import type { GenericUiSpec } from '../types/chat'

ModuleRegistry.registerModules([AllEnterpriseModule])

const { registry: chatUiRegistry } = defineRegistry(chatUiCatalog, {
  components: {
    Stack: memo(function StackRenderer({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
      return <Stack gap={(props.gap as number | undefined) ?? 6}>{children}</Stack>
    }),

    TextContent: memo(function TextContent({ props }: { props: Record<string, unknown> }) {
      return (
        <Text size={(props.size as 'xs' | 'sm' | 'md' | 'lg' | 'xl' | undefined) ?? 'sm'} fw={props.weight as number | undefined} c={props.c as string | undefined} style={{ lineHeight: 1.55 }}>
          {props.content as React.ReactNode}
        </Text>
      )
    }),

    BulletList: memo(function BulletList({ props }: { props: Record<string, unknown> }) {
      return (
        <List size="sm" mt={4} mb={4} spacing={2} withPadding>
          {(props.items as string[]).map((item, itemIndex) => (
            // eslint-disable-next-line react/no-array-index-key
            <List.Item key={itemIndex}>
              <Text size="xs" style={{ lineHeight: 1.55 }}>{item}</Text>
            </List.Item>
          ))}
        </List>
      )
    }),

    DataTable: memo(function DataTable({ props }: { props: { headers?: unknown; rows?: unknown; caption?: string } }) {
      const VISIBLE_COLS = 4
      const LARGE_TABLE_THRESHOLD = 200

      const headers = useMemo(
        () => Array.isArray(props.headers) ? (props.headers as string[]) : [],
        [props.headers]
      )
      const rows = useMemo(
        () => Array.isArray(props.rows) ? (props.rows as string[][]) : [],
        [props.rows]
      )
      const columnDefs = useMemo(() => headers.map((h: string, i: number) => ({
        field: h, headerName: h, sortable: true, filter: true, resizable: true, flex: 1, minWidth: 100,
        hide: i >= VISIBLE_COLS,
      })), [headers])
      const rowData = useMemo(() =>
        rows.map((row: string[]) =>
          Object.fromEntries(headers.map((h: string, i: number) => [h, row[i] ?? '']))
        ),
        [headers, rows]
      )

      const isLarge = rowData.length > LARGE_TABLE_THRESHOLD
      const gridHeight = isLarge ? 640 : Math.min(440, 56 + rowData.length * 42)
      const hasHiddenCols = headers.length > VISIBLE_COLS

      return (
        <Box mt="xs" mb="xs" style={{ width: '100%', overflow: 'hidden' }}>
          {props.caption && <Text size="xs" c="dimmed" mb={4} fs="italic">{props.caption}</Text>}
          {rowData.length === 0 || headers.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">Aucune donnée à afficher</Text>
          ) : (
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
          )}
        </Box>
      )
    }),

    LineChartViz: memo(function LineChartViz({ props }: { props: Record<string, unknown> }) {
      const data = useMemo(() => Array.isArray(props.data) ? props.data as Record<string, unknown>[] : [], [props.data])
      const yKeys = useMemo(() => Array.isArray(props.series) ? (props.series as Array<{ yKey: string }>).map(s => s.yKey) : [], [props.series])
      return <InteractiveChart data={data} initialXKey={props.xKey as string ?? ''} initialYKeys={yKeys} initialType="line" title={props.title && props.title !== 'Title' ? props.title as string : undefined} yLabel={props.yLabel as string | undefined} source={props.source as string | undefined} />
    }),

    BarChartViz: memo(function BarChartViz({ props }: { props: Record<string, unknown> }) {
      const data = useMemo(() => Array.isArray(props.data) ? props.data as Record<string, unknown>[] : [], [props.data])
      const yKeys = useMemo(() => props.yKey ? [props.yKey as string] : [], [props.yKey])
      return <InteractiveChart data={data} initialXKey={props.xKey as string ?? ''} initialYKeys={yKeys} initialType="bar" title={props.title && props.title !== 'Title' ? props.title as string : undefined} />
    }),

    AreaChartViz: memo(function AreaChartViz({ props }: { props: Record<string, unknown> }) {
      const p = props as { data?: unknown; xKey?: string; series?: Array<{ yKey: string }>; title?: string; yLabel?: string; source?: string }
      const data = useMemo(() => Array.isArray(p.data) ? p.data as Record<string, unknown>[] : [], [p.data])
      const yKeys = useMemo(() => Array.isArray(p.series) ? p.series.map(s => s.yKey) : [], [p.series])
      return <InteractiveChart data={data} initialXKey={p.xKey ?? ''} initialYKeys={yKeys} initialType="area" title={p.title && p.title !== 'Title' ? p.title : undefined} yLabel={p.yLabel} source={p.source} />
    }),

    PieChartViz: memo(function PieChartViz({ props }: { props: Record<string, unknown> }) {
      const data = useMemo(() => Array.isArray(props.data) ? props.data as Record<string, unknown>[] : [], [props.data])
      return <InteractiveChart data={data} initialXKey="" initialYKeys={[]} initialType="pie" initialLabelKey={props.labelKey as string ?? ''} initialValueKey={props.angleKey as string ?? ''} title={props.title && props.title !== 'Title' ? props.title as string : undefined} />
    }),

    DonutChartViz: memo(function DonutChartViz({ props }: { props: Record<string, unknown> }) {
      const data = useMemo(() => Array.isArray(props.data) ? props.data as Record<string, unknown>[] : [], [props.data])
      return <InteractiveChart data={data} initialXKey="" initialYKeys={[]} initialType="donut" initialLabelKey={props.labelKey as string ?? ''} initialValueKey={props.angleKey as string ?? ''} title={props.title && props.title !== 'Title' ? props.title as string : undefined} />
    }),

    RadarChartViz: memo(function RadarChartViz({ props }: { props: Record<string, unknown> }) {
      const data = useMemo(() => Array.isArray(props.data) ? props.data as Record<string, unknown>[] : [], [props.data])
      return <InteractiveChart data={data} initialXKey="" initialYKeys={[]} initialType="radar" initialLabelKey={props.angleKey as string ?? ''} initialValueKey={props.radiusKey as string ?? ''} title={props.title && props.title !== 'Title' ? props.title as string : undefined} />
    }),

    BubbleChartViz: memo(function BubbleChartViz({ props }: { props: Record<string, unknown> }) {
      const data = useMemo(() => Array.isArray(props.data) ? props.data as Record<string, unknown>[] : [], [props.data])
      const yKeys = useMemo(() => props.yKey ? [props.yKey as string] : [], [props.yKey])
      return <InteractiveChart data={data} initialXKey={props.xKey as string ?? ''} initialYKeys={yKeys} initialType="bubble" initialSizeKey={props.sizeKey as string ?? ''} title={props.title && props.title !== 'Title' ? props.title as string : undefined} />
    }),

    QueryDataTable: memo(function QueryDataTable({ props }) {
      const [error, setError] = useState<string | null>(null)
      const paramsKey = JSON.stringify(props.parameters ?? {})
      const uiStream = useUIStream({
        api: '/api/spec-stream',
        onError: () => setError('Erreur de chargement'),
      })

      useEffect(() => {
        if (!props.queryKey) return
        void uiStream.send(props.queryKey, { genieResult: props.parameters ?? {} })
      }, [props.queryKey, paramsKey]) // eslint-disable-line react-hooks/exhaustive-deps

      const spec = uiStream.spec as GenericUiSpec | undefined
      // Suppress stale error while a new stream is in progress
      const displayError = uiStream.isStreaming ? null : error

      return (
        <Box mt="xs" mb="xs">
          {props.caption && <Text size="xs" c="dimmed" mb={4} fs="italic">{props.caption}</Text>}
          {!spec && !displayError && (
            <Group gap="xs">
              <Loader size="xs" color="teal" type="dots" />
              <Text size="xs" c="dimmed">Chargement...</Text>
            </Group>
          )}
          {displayError && <Text size="xs" c="red">{displayError}</Text>}
          {spec && (
            <JSONUIProvider registry={chatUiRegistry}>
              <Renderer spec={spec} registry={chatUiRegistry} />
            </JSONUIProvider>
          )}
        </Box>
      )
    }),

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
        label={props.label} placeholder={props.placeholder} data={props.options}
        value={props.value ?? null} required={props.required} disabled={props.disabled}
        readOnly size="sm" radius="sm"
      />
    ),

    TextInputField: ({ props }) => (
      <TextInput
        label={props.label} placeholder={props.placeholder} value={props.value ?? ''}
        required={props.required} disabled={props.disabled} readOnly size="sm" radius="sm"
      />
    ),

    NumberInputField: ({ props }) => (
      <NumberInput
        label={props.label} placeholder={props.placeholder} value={props.value}
        min={props.min} max={props.max} step={props.step}
        required={props.required} disabled={props.disabled} readOnly size="sm" radius="sm"
      />
    ),

    ToggleField: ({ props }) => (
      <Switch
        label={props.label} description={props.description}
        checked={Boolean(props.checked)} disabled={props.disabled ?? true}
        readOnly color="teal" size="md"
      />
    ),

    WorkflowRuleBuilder: ({ props }) => {
      const operators = props.operators ?? ['is equal to', 'is not equal', 'contains', 'superior to', 'inferior to', 'strictly inferior']
      return (
        <Paper p="sm" withBorder radius="md" style={{ backgroundColor: '#ffffff' }}>
          {(props.title || props.description) && (
            <Box mb="sm">
              {props.title && <Text size="sm" fw={600}>{props.title}</Text>}
              {props.description && <Text size="xs" c="dimmed" mt={2}>{props.description}</Text>}
            </Box>
          )}
          <Stack gap="sm">
            {(props.rules ?? []).map((rule, index) => {
              const fieldOptions = (props.fields ?? []).map((field) => ({ value: field.value, label: field.label }))
              const ruleKey = [rule.field ?? 'field', rule.operator ?? 'operator', rule.valueText ?? '', String(rule.valueNumber ?? '')].join('|') || `rule-${index}`
              return (
                <Paper key={ruleKey} p="xs" radius="sm" style={{ backgroundColor: '#f8f9fa' }}>
                  <Group grow align="flex-start">
                    <Select label="Champ" data={fieldOptions} value={rule.field ?? null} readOnly size="xs" radius="sm" />
                    <Select label="Règle" data={operators.map((operator) => ({ value: operator, label: operator }))} value={rule.operator ?? null} readOnly size="xs" radius="sm" />
                    {rule.valueType === 'number' ? (
                      <NumberInput label="Valeur" value={rule.valueNumber} readOnly size="xs" radius="sm" />
                    ) : (
                      <TextInput label="Valeur" value={rule.valueText ?? ''} readOnly size="xs" radius="sm" />
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

export { chatUiRegistry }
