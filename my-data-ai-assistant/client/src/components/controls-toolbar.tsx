'use client'

import {
  Group,
  Text,
  Button,
  Switch,
  RangeSlider,
  TextInput,
  Box,
} from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'

export function ControlsToolbar() {
  return (
    <Box px="lg" py="sm">
      <Group justify="space-between" wrap="wrap" gap="md">
        <Group gap="md">
          <Button variant="subtle" color="gray" size="xs" fw={500}>
            Tout afficher
          </Button>
          <Button variant="subtle" color="gray" size="xs" fw={500}>
            Tout fermer
          </Button>
        </Group>

        <Group gap="md">
          <Switch label="Mes contrôles" size="xs" />
        </Group>

        <Group gap="sm">
          <Text size="xs" c="dimmed">{'Filtre par pondération'}</Text>
          <RangeSlider
            defaultValue={[0, 10]}
            min={0}
            max={10}
            step={1}
            w={180}
            size="xs"
            color="gray"
            styles={{
              track: { backgroundColor: '#e9ecef' },
            }}
          />
          <Text size="xs" c="dimmed">{'0 – 10'}</Text>
        </Group>

        <Group gap="xs">
          <Text size="xs" c="dimmed">Rechercher un contrôle</Text>
          <TextInput
            placeholder=""
            size="xs"
            w={200}
            leftSection={<IconSearch size={14} />}
            styles={{
              input: { borderColor: '#dee2e6' },
            }}
          />
        </Group>
      </Group>
    </Box>
  )
}
