import {
  Text, Box, List, Paper, Stack, Accordion,
  Select, TextInput, NumberInput,
} from '@mantine/core'
import { AgGridReact } from 'ag-grid-react'
import { AllEnterpriseModule, ModuleRegistry, themeQuartz } from 'ag-grid-enterprise'
import { defineRegistry } from '@json-render/react'
import { chatUiCatalog } from '../../../shared/genui-catalog'
import InteractiveChart from '../components/InteractiveChart'
import { BoundSelectInput, BoundNumberInput, BoundTextInput, BoundToggle, BoundSubmitButton } from './bound-inputs'

ModuleRegistry.registerModules([AllEnterpriseModule])

// Components passed to defineRegistry MUST be pure render functions with no hooks.
// defineRegistry calls them as plain functions (not via JSX), so any hook call
// would attach to the outer registry-wrapper fiber — an anti-pattern.
// All state, memoization, and streaming belong exclusively in ai-chat-drawer.tsx.
const VISIBLE_COLS = 4
const LARGE_TABLE_THRESHOLD = 200

const { registry: chatUiRegistry } = defineRegistry(chatUiCatalog, {
  components: {
    Stack: function StackRenderer({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
      return <Stack gap={(props.gap as number | undefined) ?? 6}>{children}</Stack>
    },

    TextContent: function TextContentRenderer({ props }: { props: Record<string, unknown> }) {
      return (
        <Text size={(props.size as 'xs' | 'sm' | 'md' | 'lg' | 'xl' | undefined) ?? 'sm'} fw={props.weight as number | undefined} c={props.c as string | undefined} style={{ lineHeight: 1.55 }}>
          {props.content as React.ReactNode}
        </Text>
      )
    },

    BulletList: function BulletListRenderer({ props }: { props: Record<string, unknown> }) {
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
    },

    DataTable: function DataTableRenderer({ props }: { props: { headers?: unknown; rows?: unknown; caption?: string } }) {
      const headers = Array.isArray(props.headers) ? (props.headers as string[]) : []
      const rows = Array.isArray(props.rows) ? (props.rows as string[][]) : []
      const columnDefs = headers.map((h: string, i: number) => ({
        field: h, headerName: h, sortable: true, filter: true, resizable: true, flex: 1, minWidth: 100,
        hide: i >= VISIBLE_COLS,
      }))
      const rowData = rows.map((row: string[]) =>
        Object.fromEntries(headers.map((h: string, i: number) => [h, row[i] ?? '']))
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
    },

    LineChartViz: function LineChartVizRenderer({ props }: { props: Record<string, unknown> }) {
      const data = Array.isArray(props.data) ? props.data as Record<string, unknown>[] : []
      const yKeys = Array.isArray(props.series) ? (props.series as Array<{ yKey: string }>).map(s => s.yKey) : []
      return <InteractiveChart data={data} initialXKey={props.xKey as string ?? ''} initialYKeys={yKeys} initialType="line" title={props.title && props.title !== 'Title' ? props.title as string : undefined} yLabel={props.yLabel as string | undefined} source={props.source as string | undefined} />
    },

    BarChartViz: function BarChartVizRenderer({ props }: { props: Record<string, unknown> }) {
      const data = Array.isArray(props.data) ? props.data as Record<string, unknown>[] : []
      const yKeys = props.yKey ? [props.yKey as string] : []
      return <InteractiveChart data={data} initialXKey={props.xKey as string ?? ''} initialYKeys={yKeys} initialType="bar" title={props.title && props.title !== 'Title' ? props.title as string : undefined} />
    },

    AreaChartViz: function AreaChartVizRenderer({ props }: { props: Record<string, unknown> }) {
      const p = props as { data?: unknown; xKey?: string; series?: Array<{ yKey: string }>; title?: string; yLabel?: string; source?: string }
      const data = Array.isArray(p.data) ? p.data as Record<string, unknown>[] : []
      const yKeys = Array.isArray(p.series) ? p.series.map(s => s.yKey) : []
      return <InteractiveChart data={data} initialXKey={p.xKey ?? ''} initialYKeys={yKeys} initialType="area" title={p.title && p.title !== 'Title' ? p.title : undefined} yLabel={p.yLabel} source={p.source} />
    },

    PieChartViz: function PieChartVizRenderer({ props }: { props: Record<string, unknown> }) {
      const data = Array.isArray(props.data) ? props.data as Record<string, unknown>[] : []
      return <InteractiveChart data={data} initialXKey="" initialYKeys={[]} initialType="pie" initialLabelKey={props.labelKey as string ?? ''} initialValueKey={props.angleKey as string ?? ''} title={props.title && props.title !== 'Title' ? props.title as string : undefined} />
    },

    DonutChartViz: function DonutChartVizRenderer({ props }: { props: Record<string, unknown> }) {
      const data = Array.isArray(props.data) ? props.data as Record<string, unknown>[] : []
      return <InteractiveChart data={data} initialXKey="" initialYKeys={[]} initialType="donut" initialLabelKey={props.labelKey as string ?? ''} initialValueKey={props.angleKey as string ?? ''} title={props.title && props.title !== 'Title' ? props.title as string : undefined} />
    },

    RadarChartViz: function RadarChartVizRenderer({ props }: { props: Record<string, unknown> }) {
      const data = Array.isArray(props.data) ? props.data as Record<string, unknown>[] : []
      return <InteractiveChart data={data} initialXKey="" initialYKeys={[]} initialType="radar" initialLabelKey={props.angleKey as string ?? ''} initialValueKey={props.radiusKey as string ?? ''} title={props.title && props.title !== 'Title' ? props.title as string : undefined} />
    },

    BubbleChartViz: function BubbleChartVizRenderer({ props }: { props: Record<string, unknown> }) {
      const data = Array.isArray(props.data) ? props.data as Record<string, unknown>[] : []
      const yKeys = props.yKey ? [props.yKey as string] : []
      return <InteractiveChart data={data} initialXKey={props.xKey as string ?? ''} initialYKeys={yKeys} initialType="bubble" initialSizeKey={props.sizeKey as string ?? ''} title={props.title && props.title !== 'Title' ? props.title as string : undefined} />
    },
    
    QueryDataTable: function QueryDataTableRenderer({ props }) {
      return (
        <Box mt="xs" mb="xs">
          {props.caption && <Text size="xs" c="dimmed" mb={4} fs="italic">{props.caption}</Text>}
        </Box>
      )
    },

    AccordionGroup: function AccordionGroupRenderer({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
      return (
        <Accordion variant={(props.variant as 'default' | 'contained' | 'separated' | undefined) ?? 'separated'}>
          {children}
        </Accordion>
      )
    },

    AccordionSection: function AccordionSectionRenderer({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) {
      return (
        <Accordion.Item value={props.value as string}>
          <Accordion.Control>{props.title as string}</Accordion.Control>
          <Accordion.Panel>{children}</Accordion.Panel>
        </Accordion.Item>
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

    SelectInputField: ({ props, bindings }) => (
      <BoundSelectInput
        label={props.label} placeholder={props.placeholder} data={props.options}
        value={props.value} bindingPath={bindings?.value}
        required={props.required} disabled={props.disabled}
      />
    ),

    TextInputField: ({ props, bindings }) => (
      <BoundTextInput
        label={props.label} placeholder={props.placeholder} value={props.value}
        bindingPath={bindings?.value}
        required={props.required} disabled={props.disabled}
      />
    ),

    NumberInputField: ({ props, bindings }) => (
      <BoundNumberInput
        label={props.label} placeholder={props.placeholder} value={props.value}
        min={props.min} max={props.max} step={props.step}
        bindingPath={bindings?.value}
        required={props.required} disabled={props.disabled}
      />
    ),

    ToggleField: ({ props, bindings }) => (
      <BoundToggle
        label={props.label} description={props.description}
        checked={props.checked} bindingPath={bindings?.checked}
        disabled={props.disabled}
      />
    ),

    SubmitButton: function SubmitButtonRenderer({ props }: { props: Record<string, unknown> }) {
      return <BoundSubmitButton label={props.label} />
    },

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
                  <Stack gap="xs">
                    <Select label="Champ" data={fieldOptions} value={rule.field ?? null} readOnly size="xs" radius="sm" />
                    <Select label="Règle" data={operators.map((operator) => ({ value: operator, label: operator }))} value={rule.operator ?? null} readOnly size="xs" radius="sm" />
                    {rule.valueType === 'number' ? (
                      <NumberInput label="Valeur" value={rule.valueNumber} readOnly size="xs" radius="sm" />
                    ) : (
                      <TextInput label="Valeur" value={rule.valueText ?? ''} readOnly size="xs" radius="sm" />
                    )}
                  </Stack>
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
