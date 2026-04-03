import { defineCatalog } from '@json-render/core'
import { schema as jsonRenderSchema } from '@json-render/react/schema'
import { z } from 'zod'

export const chatUiCatalog = defineCatalog(jsonRenderSchema, {
  components: {
    Stack: {
      props: z.object({ gap: z.number().optional() }),
      slots: ['default'],
      description: 'Vertical layout container for assistant blocks.',
    },
    TextContent: {
      props: z.object({
        content: z.string(),
        weight: z.number().optional(),
        size: z.string().optional(),
        c: z.string().optional(),
      }),
      slots: [],
      description: 'Plain text or emphasized text content.',
    },
    BulletList: {
      props: z.object({ items: z.array(z.string()) }),
      slots: [],
      description: 'Bulleted list content.',
    },
    DataTable: {
      props: z.object({
        caption: z.string().optional(),
        headers: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      }),
      slots: [],
      description: 'Tabular content with headers and rows.',
    },
    LineChartViz: {
      props: z.object({
        title: z.string(),
        data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
        xKey: z.string(),
        series: z.array(z.object({
          yKey: z.string(),
          yName: z.string(),
          stroke: z.string().optional(),
        })),
        yLabel: z.string().optional(),
        source: z.string().optional(),
      }),
      slots: [],
      description: 'Line chart using AgCharts. series is an array of {yKey, yName, stroke?}.',
    },
    AreaChartViz: {
      props: z.object({
        title: z.string(),
        data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
        xKey: z.string(),
        series: z.array(z.object({
          yKey: z.string(),
          yName: z.string(),
          stroke: z.string().optional(),
        })),
        yLabel: z.string().optional(),
        source: z.string().optional(),
      }),
      slots: [],
      description: 'Area chart using AgCharts. series is an array of {yKey, yName, stroke?}.',
    },
    BarChartViz: {
      props: z.object({
        title: z.string(),
        data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
        xKey: z.string(),
        yKey: z.string(),
        color: z.string().optional(),
      }),
      slots: [],
      description: 'Bar chart using AgCharts.',
    },
    PieChartViz: {
      props: z.object({
        title: z.string(),
        data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
        angleKey: z.string(),
        labelKey: z.string(),
      }),
      slots: [],
      description: 'Pie chart using AgCharts. angleKey is the numeric value column; labelKey is the category label column.',
    },
    DonutChartViz: {
      props: z.object({
        title: z.string(),
        data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
        angleKey: z.string(),
        labelKey: z.string(),
      }),
      slots: [],
      description: 'Donut chart using AgCharts. Same props as PieChartViz.',
    },
    BubbleChartViz: {
      props: z.object({
        title: z.string(),
        data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
        xKey: z.string(),
        yKey: z.string(),
        sizeKey: z.string(),
      }),
      slots: [],
      description: 'Bubble chart using AgCharts. xKey and yKey are numeric axes; sizeKey controls bubble radius.',
    },
    RadarChartViz: {
      props: z.object({
        title: z.string(),
        data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
        angleKey: z.string(),
        radiusKey: z.string(),
      }),
      slots: [],
      description: 'Radar/spider chart using AgCharts. angleKey is the category spoke label; radiusKey is the numeric value.',
    },
    QueryDataTable: {
      props: z.object({
        queryKey: z.string(),
        parameters: z.record(z.string(), z.any()).optional(),
        filterColumn: z.string().optional(),
        filterPlaceholder: z.string().optional(),
        pageSize: z.number().optional(),
        caption: z.string().optional(),
      }),
      slots: [],
      description: 'Query-driven data table powered by Databricks Analytics plugin. Uses queryKey to fetch data from a SQL warehouse with built-in pagination, sorting, and filtering.',
    },
    FormPanel: {
      props: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
      }),
      slots: ['default'],
      description: 'Form container used to group interactive supervisor inputs.',
    },
    AccordionGroup: {
      props: z.object({
        variant: z.enum(['default', 'contained', 'separated']).optional(),
      }),
      slots: ['default'],
      description: 'Accordion container for grouped collapsible sections. Children must be AccordionSection elements.',
    },
    AccordionSection: {
      props: z.object({
        title: z.string(),
        value: z.string(),
      }),
      slots: ['default'],
      description: 'Single accordion item with a title header and collapsible content. value must be unique within its parent AccordionGroup.',
    },
    SelectInputField: {
      props: z.object({
        label: z.string(),
        placeholder: z.string().optional(),
        value: z.string().optional(),
        required: z.boolean().optional(),
        disabled: z.boolean().optional(),
        options: z.array(
          z.object({
            value: z.string(),
            label: z.string(),
          }),
        ),
      }),
      slots: [],
      description: 'Mantine select input for categorical choices.',
    },
    TextInputField: {
      props: z.object({
        label: z.string(),
        placeholder: z.string().optional(),
        value: z.string().optional(),
        required: z.boolean().optional(),
        disabled: z.boolean().optional(),
      }),
      slots: [],
      description: 'Mantine text input for free-form user clarification.',
    },
    NumberInputField: {
      props: z.object({
        label: z.string(),
        placeholder: z.string().optional(),
        value: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        required: z.boolean().optional(),
        disabled: z.boolean().optional(),
      }),
      slots: [],
      description: 'Mantine numeric input for thresholds and tolerances.',
    },
    ToggleField: {
      props: z.object({
        label: z.string(),
        description: z.string().optional(),
        checked: z.boolean().optional(),
        disabled: z.boolean().optional(),
      }),
      slots: [],
      description: 'Mantine toggle switch for binary workflow choices.',
    },
    WorkflowRuleBuilder: {
      props: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        fields: z.array(
          z.object({
            value: z.string(),
            label: z.string(),
          }),
        ),
        operators: z.array(z.string()).optional(),
        rules: z.array(
          z.object({
            field: z.string().optional(),
            operator: z.string().optional(),
            valueText: z.string().optional(),
            valueNumber: z.number().optional(),
            valueType: z.enum(['text', 'number']).optional(),
          }),
        ),
      }),
      slots: [],
      description: 'Workflow input builder for conditions such as equals, contains, greater than, or strictly lower than.',
    },
  },
  actions: {},
})
