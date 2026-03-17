'use client'

import { SimpleGrid, Paper, Text, Group, Box } from '@mantine/core'
import {
  IconDots,
  IconSearch,
  IconCheck,
  IconAlertCircle,
  IconClock,
} from '@tabler/icons-react'

export function SummaryCards() {
  return (
    <Box px="lg" py="md">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {/* Tests de volumétrie */}
        <Paper p="md" radius="md" withBorder>
          <Text size="xs" c="dimmed" fw={500} mb="xs">Tests de volumétrie</Text>
          <Text size="xl" fw={700}>100M</Text>
          <Text size="xs" c="dimmed" mt={4}>01/10/2019 - 30/09/2020</Text>
          <Text size="xs" c="dimmed" mt={2}>78,90 % de contrôles disponibles</Text>
        </Paper>

        {/* Indicateurs de volumétrie */}
        <Paper p="md" radius="md" withBorder>
          <Text size="xs" c="dimmed" fw={500} mb="xs">Indicateurs de volumétrie</Text>
          <SimpleGrid cols={2} spacing={4}>
            <Group gap={4}>
              <Text size="xs" fw={700}>1</Text>
              <Text size="xs" c="dimmed">entité</Text>
            </Group>
            <Group gap={4}>
              <Text size="xs" fw={700}>33</Text>
              <Text size="xs" c="dimmed">journaux</Text>
            </Group>
            <Group gap={4}>
              <Text size="xs" fw={700}>3,4 M</Text>
              <Text size="xs" c="dimmed">écritures</Text>
            </Group>
            <Group gap={4}>
              <Text size="xs" fw={700}>537</Text>
              <Text size="xs" c="dimmed">comptes</Text>
            </Group>
            <Group gap={4}>
              <Text size="xs" fw={700}>100 M</Text>
              <Text size="xs" c="dimmed">lignes</Text>
            </Group>
            <Group gap={4}>
              <Text size="xs" fw={700}>39 k</Text>
              <Text size="xs" c="dimmed">tiers</Text>
            </Group>
            <Group gap={4}>
              <Text size="xs" fw={700}>419 Md</Text>
              <Text size="xs" c="dimmed">montant total</Text>
            </Group>
            <Group gap={4}>
              <Text size="xs" fw={700}>48</Text>
              <Text size="xs" c="dimmed">utilisateurs</Text>
            </Group>
          </SimpleGrid>
        </Paper>

        {/* Contrôles */}
        <Paper p="md" radius="md" withBorder>
          <Text size="xs" fw={600} mb="xs">{'Contrôles :'}</Text>
          <Group gap="xs" mb={6}>
            <Box style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#f59f00' }} />
            <Text size="xs">{"27 contrôles identifiant des points d'attention"}</Text>
          </Group>
          <Group gap="xs" mb={6}>
            <Box style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#40c057' }} />
            <Text size="xs">{"161 contrôles n'identifiant aucune anomalie"}</Text>
          </Group>
          <Group gap="xs" mb={6}>
            <Box style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#228be6' }} />
            <Text size="xs">{"73 focus sur une population d'écritures"}</Text>
          </Group>
          <Group gap="xs">
            <Box style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#adb5bd' }} />
            <Text size="xs">{"70 contrôles non-réalisés"}</Text>
          </Group>
        </Paper>

        {/* Statuts d'investigation */}
        <Paper p="md" radius="md" withBorder>
          <Text size="xs" fw={600} mb="xs">{"Statuts d'investigation :"}</Text>
          <Group gap="xs" mb={4}>
            <IconDots size={14} color="#adb5bd" />
            <Text size="xs">{"170 contrôles à définir"}</Text>
          </Group>
          <Group gap="xs" mb={4}>
            <IconSearch size={14} color="#228be6" />
            <Text size="xs">{"0 contrôle à investiguer"}</Text>
          </Group>
          <Group gap="xs" mb={4}>
            <IconCheck size={14} color="#40c057" />
            <Text size="xs">{"164 contrôles sans anomalie résiduelle"}</Text>
          </Group>
          <Group gap="xs" mb={4}>
            <IconAlertCircle size={14} color="#fa5252" />
            <Text size="xs">{"0 contrôle avec anomalies identifiées"}</Text>
          </Group>
          <Group gap="xs">
            <IconClock size={14} color="#adb5bd" />
            <Text size="xs">{"0 contrôle à reconfirmer"}</Text>
          </Group>
        </Paper>
      </SimpleGrid>
    </Box>
  )
}
