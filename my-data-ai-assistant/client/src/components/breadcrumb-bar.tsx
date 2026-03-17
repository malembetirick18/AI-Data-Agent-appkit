'use client'

import { Group, Text, Box, Anchor, SegmentedControl, Select, ActionIcon, Tooltip } from '@mantine/core'
import { IconPencil, IconInfoCircle } from '@tabler/icons-react'

const breadcrumbs = [
  { label: 'Liste des groupes', href: '#' },
  { label: '00 LAST GROUP', href: '#' },
  { label: '100M', href: '#' },
  { label: 'Modules activés pour le dossier 100M', href: '#' },
]

export function BreadcrumbBar() {
  return (
    <Box px="lg" pt="sm" pb={4} style={{ backgroundColor: '#fff' }}>
      <Group gap={4} mb={4}>
        {breadcrumbs.map((item, index) => (
          <Group key={item.label} gap={4}>
            {index > 0 && (
              <Text size="xs" c="dimmed">/</Text>
            )}
            <Anchor href={item.href} size="xs" c="dimmed" underline="hover">
              {item.label}
            </Anchor>
          </Group>
        ))}
      </Group>
      <Text size="lg" fw={600} c="dark">
        {'Synthèse des contrôles pour le module "A. 1. Général"'}
      </Text>
    </Box>
  )
}

export function PeriodBar() {
  return (
    <Box px="lg" py="sm" style={{ backgroundColor: '#fff', borderBottom: '1px solid #e9ecef' }}>
      <Group justify="space-between">
        <Group gap="md">
          <SegmentedControl
            size="xs"
            data={[
              { label: 'Cumulé', value: 'cumule' },
              { label: 'Variation', value: 'variation' },
            ]}
            defaultValue="cumule"
            styles={{
              root: { backgroundColor: '#f1f3f5' },
            }}
          />
          <Tooltip label="Information">
            <ActionIcon variant="subtle" color="gray" size="sm">
              <IconInfoCircle size={16} />
            </ActionIcon>
          </Tooltip>
          <Group gap={6}>
            <Text size="sm" c="dimmed">{'Période :'}</Text>
            <Select
              size="xs"
              defaultValue="cloture"
              data={[{ value: 'cloture', label: 'Clôture 30/09/2020' }]}
              w={200}
              styles={{
                input: { borderColor: '#dee2e6' },
              }}
            />
          </Group>
          <ActionIcon variant="subtle" color="gray" size="sm">
            <IconPencil size={16} />
          </ActionIcon>
        </Group>
      </Group>
    </Box>
  )
}
