'use client'

import { useState } from 'react'
import {
  Box,
  Group,
  Text,
  Badge,
  Button,
  Progress,
  ActionIcon,
  Collapse,
  Paper,
  ThemeIcon,
  Tooltip,
} from '@mantine/core'
import {
  IconChevronRight,
  IconChevronDown,
  IconCheck,
  IconDots,
  IconCircleFilled,
  IconFile,
  IconInfoCircle,
  IconSparkles,
} from '@tabler/icons-react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SavedControlItem {
  id: string
  name: string
  description: string
  results: string
  rubriqueId: string
}

interface ControlRow {
  id: string
  label: string
  status: string
  statusColor: string
  progress: number
  progressColor: string
  checkCount: number
  moreCount: number
}

interface SubControl {
  id: string
  name: string
  status: 'green' | 'orange' | 'gray'
  ponderation: number | null
  ecritures: string | null
  lignes: string | null
  montant: string | null
  impact: string | null
  investigations: string | null
  aiGenerated?: boolean
}

interface SubCategory {
  title: string
  controls: SubControl[]
}

/* ------------------------------------------------------------------ */
/*  Static sub-category data for Cartographies Generales               */
/* ------------------------------------------------------------------ */

const cartoSubCategories: SubCategory[] = [
  {
    title: '01. Volumétries comptables',
    controls: [
      {
        id: '0001',
        name: '0001. Cartographie complète des flux comptables',
        status: 'green',
        ponderation: 0,
        ecritures: '70 105',
        lignes: '298 131',
        montant: '410 600 583,36',
        impact: '0',
        investigations: null,
      },
    ],
  },
  {
    title: '02. Ratios financiers généraux',
    controls: [
      {
        id: '0394',
        name: '0394. BFR',
        status: 'green',
        ponderation: 0,
        ecritures: '63 333',
        lignes: '275 975',
        montant: '301 284 701,31',
        impact: '1 042 516,89',
        investigations: null,
      },
      {
        id: '2009',
        name: '2009. Analyse du BFR intragroupe',
        status: 'gray',
        ponderation: 0,
        ecritures: null,
        lignes: null,
        montant: null,
        impact: null,
        investigations: null,
      },
      {
        id: '2610',
        name: '2610. Analyse du BFR hors intragroupe',
        status: 'gray',
        ponderation: null,
        ecritures: null,
        lignes: null,
        montant: null,
        impact: null,
        investigations: null,
      },
    ],
  },
]

/* ------------------------------------------------------------------ */
/*  Main data                                                          */
/* ------------------------------------------------------------------ */

const controlsData: ControlRow[] = [
  {
    id: '01',
    label: '01. CARTOGRAPHIES GÉNÉRALES',
    status: 'Non débuté',
    statusColor: 'teal',
    progress: 0,
    progressColor: 'gray',
    checkCount: 0,
    moreCount: 4,
  },
  {
    id: '02',
    label: "02. COMPLÉTUDE DE L'INFORMATION COMPTABLE",
    status: 'Non débuté',
    statusColor: 'teal',
    progress: 63,
    progressColor: 'blue',
    checkCount: 10,
    moreCount: 7,
  },
  {
    id: '03',
    label: '03. CONFORMITÉ COMPTABLE',
    status: 'Non débuté',
    statusColor: 'teal',
    progress: 48,
    progressColor: 'orange',
    checkCount: 14,
    moreCount: 21,
  },
  {
    id: '04',
    label: '04. OPÉRATIONS DIVERSES',
    status: 'Non débuté',
    statusColor: 'teal',
    progress: 88,
    progressColor: 'blue',
    checkCount: 14,
    moreCount: 5,
  },
  {
    id: '05',
    label: '05. ACHATS',
    status: 'Non débuté',
    statusColor: 'teal',
    progress: 75,
    progressColor: 'blue',
    checkCount: 45,
    moreCount: 17,
  },
  {
    id: '06',
    label: '06. VENTES',
    status: 'Non débuté',
    statusColor: 'teal',
    progress: 73,
    progressColor: 'blue',
    checkCount: 45,
    moreCount: 19,
  },
  {
    id: '07',
    label: '07. TVA',
    status: 'Non débuté',
    statusColor: 'teal',
    progress: 43,
    progressColor: 'orange',
    checkCount: 10,
    moreCount: 13,
  },
  {
    id: '08',
    label: '08. RÉSULTAT ET IS',
    status: 'Non débuté',
    statusColor: 'teal',
    progress: 25,
    progressColor: 'orange',
    checkCount: 3,
    moreCount: 10,
  },
  {
    id: '09',
    label: '09. ÉCRITURES COMPLEXES',
    status: 'Non débuté',
    statusColor: 'teal',
    progress: 67,
    progressColor: 'blue',
    checkCount: 2,
    moreCount: 1,
  },
]

/* ------------------------------------------------------------------ */
/*  Status dot helper                                                  */
/* ------------------------------------------------------------------ */

function StatusDot({ color }: { color: 'green' | 'orange' | 'gray' }) {
  const colorMap = { green: '#40c057', orange: '#f08c00', gray: '#adb5bd' }
  return <IconCircleFilled size={8} color={colorMap[color]} />
}

/* ------------------------------------------------------------------ */
/*  Expanded row for Cartographies Generales                           */
/* ------------------------------------------------------------------ */

function CartoExpandedContent({ savedControls }: { savedControls: SavedControlItem[] }) {
  const allCategories = [...cartoSubCategories]

  // Add saved AI controls as a new sub-category if any
  if (savedControls.length > 0) {
    const aiControls: SubControl[] = savedControls.map((sc, idx) => ({
      id: `AI-${String(idx + 1).padStart(4, '0')}`,
      name: `AI-${String(idx + 1).padStart(4, '0')}. ${sc.name}`,
      status: 'green' as const,
      ponderation: 0,
      ecritures: '-',
      lignes: '-',
      montant: '-',
      impact: '-',
      investigations: '-',
      aiGenerated: true,
    }))
    allCategories.push({
      title: 'Contrôles générés par IA',
      controls: aiControls,
    })
  }

  return (
    <Box style={{ backgroundColor: '#fafafa' }}>
      {/* Column headers */}
      <Box px="lg" py={6} style={{ borderBottom: '1px solid #e9ecef' }}>
        <Group justify="flex-end" gap={0} wrap="nowrap">
          <Text
            size="xs"
            c="dimmed"
            fw={500}
            ta="center"
            style={{ width: 90 }}
          >
            Pondération
          </Text>
          <Text
            size="xs"
            c="dimmed"
            fw={500}
            ta="center"
            style={{ width: 110 }}
          >
            {"Nb d'écritures"}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            fw={500}
            ta="center"
            style={{ width: 110 }}
          >
            Nb de lignes
          </Text>
          <Text
            size="xs"
            c="dimmed"
            fw={500}
            ta="center"
            style={{ width: 120 }}
          >
            Montant
          </Text>
          <Text
            size="xs"
            c="dimmed"
            fw={500}
            ta="center"
            style={{ width: 80 }}
          >
            Impact
          </Text>
          <Text
            size="xs"
            c="dimmed"
            fw={500}
            ta="center"
            style={{ width: 100 }}
          >
            Investigations
          </Text>
        </Group>
      </Box>

      {allCategories.map((cat) => (
        <Box key={cat.title}>
          {/* Sub-category title */}
          <Box px="lg" py={8} style={{ borderBottom: '1px solid #f1f3f5' }}>
            <Group gap="xs" wrap="nowrap">
              {cat.title === 'Contrôles générés par IA' && (
                <ThemeIcon size={16} radius="xl" variant="light" color="teal">
                  <IconSparkles size={10} />
                </ThemeIcon>
              )}
              <Text size="sm" fw={600} c="dark">
                {cat.title}
              </Text>
            </Group>
          </Box>

          {/* Control rows */}
          {cat.controls.map((ctrl) => (
            <Box
              key={ctrl.id}
              px="lg"
              py={6}
              style={{
                borderBottom: '1px solid #f1f3f5',
                backgroundColor: ctrl.aiGenerated ? '#f0fdf4' : 'transparent',
                transition: 'background-color 500ms ease',
              }}
            >
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs" style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
                  <StatusDot color={ctrl.status} />
                  <Text size="xs" c="dark" truncate>
                    {ctrl.name}
                  </Text>
                  {ctrl.aiGenerated && (
                    <Tooltip label="Généré par IA" position="top" withArrow>
                      <Badge
                        size="xs"
                        color="teal"
                        variant="light"
                        leftSection={<IconSparkles size={10} />}
                        styles={{ root: { textTransform: 'none' } }}
                      >
                        IA
                      </Badge>
                    </Tooltip>
                  )}
                </Group>

                <Group gap={0} wrap="nowrap">
                  <Text size="xs" c="dimmed" ta="center" style={{ width: 90 }}>
                    {ctrl.ponderation != null ? ctrl.ponderation : '-'}
                  </Text>
                  <Text size="xs" c="dimmed" ta="center" style={{ width: 110 }}>
                    {ctrl.ecritures ?? '-'}
                  </Text>
                  <Text size="xs" c="dimmed" ta="center" style={{ width: 110 }}>
                    {ctrl.lignes ?? '-'}
                  </Text>
                  <Text size="xs" c="dimmed" ta="center" style={{ width: 120 }}>
                    {ctrl.montant ?? '-'}
                  </Text>
                  <Text size="xs" c="dimmed" ta="center" style={{ width: 80 }}>
                    {ctrl.impact ?? '-'}
                  </Text>
                  <Group gap={4} justify="center" style={{ width: 100 }} wrap="nowrap">
                    <ActionIcon variant="subtle" size="xs" color="gray">
                      <IconFile size={14} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" size="xs" color="gray">
                      <IconInfoCircle size={14} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Group>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/*  Expanded content for AI controls in non-Carto rubriques            */
/* ------------------------------------------------------------------ */

function AiControlsExpandedContent({
  savedControls,
}: {
  savedControls: SavedControlItem[]
}) {
  if (savedControls.length === 0) return null

  return (
    <Box style={{ backgroundColor: '#fafafa' }}>
      {/* Column headers */}
      <Box px="lg" py={6} style={{ borderBottom: '1px solid #e9ecef' }}>
        <Group justify="flex-end" gap={0} wrap="nowrap">
          <Text size="xs" c="dimmed" fw={500} ta="center" style={{ width: 90 }}>
            Pondération
          </Text>
          <Text size="xs" c="dimmed" fw={500} ta="center" style={{ width: 110 }}>
            {"Nb d'écritures"}
          </Text>
          <Text size="xs" c="dimmed" fw={500} ta="center" style={{ width: 110 }}>
            Nb de lignes
          </Text>
          <Text size="xs" c="dimmed" fw={500} ta="center" style={{ width: 120 }}>
            Montant
          </Text>
          <Text size="xs" c="dimmed" fw={500} ta="center" style={{ width: 80 }}>
            Impact
          </Text>
          <Text size="xs" c="dimmed" fw={500} ta="center" style={{ width: 100 }}>
            Investigations
          </Text>
        </Group>
      </Box>

      {/* AI sub-category */}
      <Box px="lg" py={8} style={{ borderBottom: '1px solid #f1f3f5' }}>
        <Group gap="xs" wrap="nowrap">
          <ThemeIcon size={16} radius="xl" variant="light" color="teal">
            <IconSparkles size={10} />
          </ThemeIcon>
          <Text size="sm" fw={600} c="dark">
            {'Contrôles générés par IA'}
          </Text>
        </Group>
      </Box>

      {savedControls.map((sc, idx) => (
        <Box
          key={sc.id}
          px="lg"
          py={6}
          style={{
            borderBottom: '1px solid #f1f3f5',
            backgroundColor: '#f0fdf4',
            transition: 'background-color 500ms ease',
          }}
        >
          <Group justify="space-between" wrap="nowrap">
            <Group gap="xs" style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
              <StatusDot color="green" />
              <Text size="xs" c="dark" truncate>
                {`AI-${String(idx + 1).padStart(4, '0')}. ${sc.name}`}
              </Text>
              <Tooltip label="Généré par IA" position="top" withArrow>
                <Badge
                  size="xs"
                  color="teal"
                  variant="light"
                  leftSection={<IconSparkles size={10} />}
                  styles={{ root: { textTransform: 'none' } }}
                >
                  IA
                </Badge>
              </Tooltip>
            </Group>
            <Group gap={0} wrap="nowrap">
              <Text size="xs" c="dimmed" ta="center" style={{ width: 90 }}>0</Text>
              <Text size="xs" c="dimmed" ta="center" style={{ width: 110 }}>-</Text>
              <Text size="xs" c="dimmed" ta="center" style={{ width: 110 }}>-</Text>
              <Text size="xs" c="dimmed" ta="center" style={{ width: 120 }}>-</Text>
              <Text size="xs" c="dimmed" ta="center" style={{ width: 80 }}>-</Text>
              <Group gap={4} justify="center" style={{ width: 100 }} wrap="nowrap">
                <ActionIcon variant="subtle" size="xs" color="gray">
                  <IconFile size={14} />
                </ActionIcon>
                <ActionIcon variant="subtle" size="xs" color="gray">
                  <IconInfoCircle size={14} />
                </ActionIcon>
              </Group>
            </Group>
          </Group>
        </Box>
      ))}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/*  Single control item                                                */
/* ------------------------------------------------------------------ */

function ControlItem({
  control,
  savedControls,
}: {
  control: ControlRow
  savedControls: SavedControlItem[]
}) {
  const [opened, setOpened] = useState(false)
  const myControls = savedControls.filter((sc) => sc.rubriqueId === control.id)
  const hasAI = myControls.length > 0
  const isCarto = control.id === '01'
  const isOpened = opened || hasAI

  const displayStatus = hasAI ? 'En cours' : control.status
  const displayStatusColor = hasAI ? 'orange' : control.statusColor
  const displayProgress = hasAI
    ? Math.min(control.progress + myControls.length * 10, 99)
    : control.progress
  const displayProgressColor = hasAI ? 'orange' : control.progressColor
  const displayCheckCount = control.checkCount + myControls.length

  return (
    <Box>
      <Paper
        radius={0}
        style={{
          borderBottom: '1px solid #e9ecef',
          cursor: 'pointer',
        }}
        px="lg"
        py="sm"
        onClick={() => setOpened((o) => !o)}
      >
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" style={{ flex: '0 0 380px' }} wrap="nowrap">
            <ActionIcon variant="subtle" color="gray" size="xs">
              {isOpened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            </ActionIcon>
            <Text size="sm" fw={600} c="dark">
              {control.label}
            </Text>
          </Group>

          <Group gap="sm" style={{ flex: '0 0 200px' }} wrap="nowrap">
            <Badge
              color={displayStatusColor}
              variant="filled"
              size="sm"
              radius="sm"
              styles={{
                root: {
                  textTransform: 'none',
                  fontWeight: 500,
                },
              }}
            >
              {displayStatus}
            </Badge>
            <Button
              variant="outline"
              color="gray"
              size="xs"
              styles={{
                root: {
                  borderColor: '#dee2e6',
                  color: '#495057',
                  fontWeight: 400,
                },
              }}
            >
              Terminer
            </Button>
          </Group>

          <Group gap="sm" style={{ flex: '0 0 300px' }} wrap="nowrap" justify="flex-end">
            <Box style={{ flex: 1, maxWidth: 200 }}>
              <Group justify="space-between" mb={4}>
                <Text size="xs" c="dimmed">Avancement</Text>
                <Text size="xs" c="dimmed">{displayProgress}%</Text>
              </Group>
              <Progress
                value={displayProgress}
                color={displayProgressColor}
                size="sm"
                radius="xl"
              />
            </Box>
          </Group>

          <Group gap="sm" style={{ flex: '0 0 80px' }} wrap="nowrap" justify="flex-end">
            {displayCheckCount > 0 && (
              <Group gap={2} wrap="nowrap">
                <IconCheck size={14} color="#40c057" />
                <Text size="xs" c="dimmed">{displayCheckCount}</Text>
              </Group>
            )}
            <Group gap={2} wrap="nowrap">
              <IconDots size={14} color="#adb5bd" />
              <Text size="xs" c="dimmed">{control.moreCount}</Text>
            </Group>
          </Group>
        </Group>
      </Paper>

      <Collapse in={isOpened}>
        {isCarto ? (
          <CartoExpandedContent savedControls={myControls} />
        ) : hasAI ? (
          <AiControlsExpandedContent savedControls={myControls} />
        ) : (
          <Box px="xl" py="md" style={{ backgroundColor: '#f8f9fa' }}>
            <Text size="sm" c="dimmed">
              {'Détails des contrôles pour la section "' + control.label + '"'}
            </Text>
          </Box>
        )}
      </Collapse>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/*  Exported list                                                      */
/* ------------------------------------------------------------------ */

export function ControlsList({
  savedControls = [],
}: {
  savedControls?: SavedControlItem[]
}) {
  return (
    <Box
      mx="lg"
      mb="lg"
      style={{
        border: '1px solid #e9ecef',
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#fff',
      }}
    >
      {controlsData.map((control) => (
        <ControlItem
          key={control.id}
          control={control}
          savedControls={savedControls}
        />
      ))}
    </Box>
  )
}
