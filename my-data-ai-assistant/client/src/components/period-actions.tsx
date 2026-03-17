'use client'

import { Group, Button, Box } from '@mantine/core'
import { IconDownload } from '@tabler/icons-react'

export function PeriodActions() {
  return (
    <Box px="lg" pb="xs" style={{ backgroundColor: '#fff' }}>
      <Group justify="flex-end" gap="sm">
        <Button
          variant="filled"
          color="coral.6"
          size="xs"
          radius="xl"
          fw={600}
        >
          {'Clôturer la période'}
        </Button>
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<IconDownload size={15} />}
          fw={500}
        >
          {'Télécharger la synthèse'}
        </Button>
      </Group>
    </Box>
  )
}
