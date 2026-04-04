import { useState } from 'react'
import { Box, Text, Group, Button, Select, Paper, Divider } from '@mantine/core'
import { IconCalendar } from '@tabler/icons-react'

interface PeriodOption {
  label: string
  value: string
}

interface PeriodPickerPanelProps {
  message: string
  options: PeriodOption[]
  onConfirm: (label: string) => void
}

export function PeriodPickerPanel({ message, options, onConfirm }: PeriodPickerPanelProps) {
  const [selected, setSelected] = useState<string | null>(null)

  const selectData = options.map((o) => ({ label: o.label, value: o.value }))
  const selectedOption = options.find((o) => o.value === selected)

  return (
    <Paper p="md" radius="md" style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef', borderLeft: '3px solid #0c8599' }}>
      <Group gap="xs" mb="sm" align="flex-start">
        <IconCalendar size={14} color="#0c8599" style={{ marginTop: 2, flexShrink: 0 }} />
        <Box style={{ flex: 1 }}>
          <Text size="sm" fw={600} c="#0c8599">Sélection de la période d&apos;analyse</Text>
          <Text size="xs" c="dimmed" mt={2} style={{ lineHeight: 1.55 }}>{message}</Text>
        </Box>
      </Group>

      <Divider mb="sm" color="#dee2e6" />

      <Box mb="sm">
        <Text size="xs" fw={600} mb={6} c="dark">Période</Text>
        <Select
          data={selectData}
          value={selected}
          onChange={setSelected}
          placeholder="Sélectionnez une période"
          size="sm" radius="sm"
          styles={{ input: { borderColor: '#dee2e6', backgroundColor: '#fff' } }}
        />
      </Box>

      <Group justify="flex-end" mt="sm">
        <Button
          size="xs" color="teal" variant="filled"
          leftSection={<IconCalendar size={12} />}
          disabled={!selected}
          onClick={() => { if (selectedOption) onConfirm(selectedOption.label) }}
        >
          Confirmer la période
        </Button>
      </Group>
    </Paper>
  )
}
