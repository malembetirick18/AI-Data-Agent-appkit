import {
  AppShell, Container, Stack, Title, Text, SimpleGrid, Card, Box, Group, Badge, Button, Table,
} from '@mantine/core'
import { IconExternalLink, IconChartBar, IconReportAnalytics, IconFolder } from '@tabler/icons-react'
import { PRODUCT_ROUTES, PRODUCT_LABELS } from '../../../shared/products'
import type { Product } from '../../../shared/products'
import { FOLDER_EXAMPLES } from '../data/folder-examples'
import type { FolderRow } from '../data/folder-examples'

type Tile = {
  product: Product
  title: string
  description: string
  badges: string[]
  accent: 'teal' | 'closingPink'
  Icon: typeof IconChartBar
}

const TILES: Tile[] = [
  {
    product: 'closing',
    title: '1 · Atelier de contrôles Closing',
    description:
      "Créez des contrôles comptables personnalisés en langage naturel sur vos données de clôture. " +
      "Sélectionnez un dossier, décrivez votre contrôle et obtenez un rapport structuré " +
      "(synthèse, tableau, graphique) prêt à l'utilisation.",
    badges: ['Revue analytique', 'IA générative'],
    accent: 'closingPink',
    Icon: IconChartBar,
  },
  {
    product: 'geo',
    title: '2 · Atelier de contrôles Géo',
    description:
      "Générez des contrôles d'investigation sur vos données comptables géo-localisées. " +
      "Croisez écritures, achats et données territoriales pour détecter des anomalies " +
      "et produire des analyses ciblées par entité.",
    badges: ['Analyse de données comptables', 'IA générative'],
    accent: 'teal',
    Icon: IconReportAnalytics,
  },
]

export function LandingPage() {
  return (
    <AppShell padding={0}>
      <AppShell.Main style={{ background: 'var(--mantine-color-gray-0)', minHeight: '100vh' }}>
        <Container size="lg" py={56} px={32}>
          <Stack gap={56}>
            <Stack gap={8}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: 0.5 }}>
                Geoficiency × Closing — AI Data Agent
              </Text>
              <Title order={1} fz={32} lh={1.1}>
                Création de contrôles IA sur données scoped
              </Title>
              <Text size="md" c="dimmed" maw={720} mt={8}>
                Plateforme data-first où l&apos;agent IA génère de nouveaux contrôles comptables
                personnalisés à partir d&apos;une description en langage naturel, appliqués sur
                un dossier et une session sélectionnés. Choisissez un produit pour démarrer.
              </Text>
            </Stack>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
              {TILES.map((tile) => (
                <ProductTile key={tile.product} tile={tile} />
              ))}
            </SimpleGrid>

            <Stack gap={12}>
              <Group gap={8}>
                <IconFolder size={18} color="var(--mantine-color-gray-6)" />
                <Text fw={600} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
                  Cas de tests — exemples de dossiers
                </Text>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
                <FolderExampleCard
                  product="closing"
                  accent="closingPink"
                  rows={FOLDER_EXAMPLES.closing}
                />
                <FolderExampleCard
                  product="geo"
                  accent="teal"
                  rows={FOLDER_EXAMPLES.geo}
                />
              </SimpleGrid>
            </Stack>
          </Stack>
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}

function ProductTile({ tile }: { tile: Tile }) {
  const { product, title, description, badges, accent, Icon } = tile
  const href = PRODUCT_ROUTES[product]
  const previewBg =
    accent === 'closingPink'
      ? 'linear-gradient(135deg, var(--mantine-color-closingPink-0), #fff)'
      : 'linear-gradient(135deg, var(--mantine-color-teal-0), #fff)'

  return (
    <Card
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      withBorder
      radius="lg"
      p={0}
      style={{ overflow: 'hidden', textDecoration: 'none', color: 'inherit' }}
    >
      <Box
        h={180}
        p="lg"
        style={{
          background: previewBg,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <Group justify="space-between" align="flex-start">
          <Icon size={36} color={`var(--mantine-color-${accent}-5)`} />
          <Badge variant="light" color={accent}>{PRODUCT_LABELS[product]}</Badge>
        </Group>
        <Stack gap={4}>
          <Box h={8} bg={`${accent}.2`} style={{ borderRadius: 4, width: '80%' }} />
          <Box h={8} bg="gray.2" style={{ borderRadius: 4, width: '60%' }} />
          <Box h={8} bg="gray.1" style={{ borderRadius: 4, width: '70%' }} />
        </Stack>
      </Box>
      <Stack p="lg" gap="sm">
        <Group gap={6}>
          {badges.map((b) => (
            <Badge key={b} variant="light" color={b === PRODUCT_LABELS[product] ? accent : 'gray'}>
              {b}
            </Badge>
          ))}
        </Group>
        <Title order={3} fz={18}>{title}</Title>
        <Text size="sm" c="dimmed" lh={1.55}>{description}</Text>
        <Button
          fullWidth
          color={accent}
          variant="filled"
          rightSection={<IconExternalLink size={14} />}
          mt="xs"
          component="span"
        >
          Ouvrir le prototype
        </Button>
      </Stack>
    </Card>
  )
}

function FolderExampleCard({
  product,
  accent,
  rows,
}: {
  product: Product
  accent: 'teal' | 'closingPink'
  rows: FolderRow[]
}) {
  const label = product === 'closing' ? 'Cas de tests · Closing' : 'Cas de tests · Geoficiency'

  return (
    <Card withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
      <Box
        px="lg"
        py="sm"
        style={{
          background:
            accent === 'closingPink'
              ? 'var(--mantine-color-closingPink-0)'
              : 'var(--mantine-color-teal-0)',
          borderBottom: '1px solid var(--mantine-color-gray-2)',
        }}
      >
        <Group gap={8}>
          <IconFolder size={16} color={`var(--mantine-color-${accent}-6)`} />
          <Text fw={600} size="sm" c={`${accent}.7`}>
            {label}
          </Text>
          <Badge variant="light" color={accent} size="xs" ml="auto">
            {rows.length} dossiers
          </Badge>
        </Group>
      </Box>

      <Table horizontalSpacing="lg" verticalSpacing="xs" fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ color: 'var(--mantine-color-gray-6)', fontWeight: 600 }}>
              spFolderId
            </Table.Th>
            <Table.Th style={{ color: 'var(--mantine-color-gray-6)', fontWeight: 600 }}>
              session
            </Table.Th>
            <Table.Th style={{ color: 'var(--mantine-color-gray-6)', fontWeight: 600 }}>
              description
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.spFolderId}>
              <Table.Td>
                <Text size="xs" ff="monospace" c={`${accent}.6`} fw={500}>
                  {row.spFolderId}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge variant="dot" color={accent} size="xs">
                  {row.sessionId}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="xs" c="dimmed" lh={1.4}>
                  {row.description}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  )
}
