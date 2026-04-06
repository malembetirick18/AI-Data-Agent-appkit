import { useState, useEffect, useRef, useEffectEvent } from 'react'
import {
  Box, Text, Group, Button, TextInput, Select, ScrollArea,
  Table, Checkbox, Badge, Tooltip, ThemeIcon, Transition, Paper,
} from '@mantine/core'
import {
  IconX, IconSearch, IconFilter, IconSparkles, IconListDetails,
  IconCheck,
} from '@tabler/icons-react'
import type { TeamControl } from '../types/chat'
import { RUBRIQUES } from '../lib/spec-utils'

function usePublishedTimerCleanup(publishedTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  const clearPublishedTimer = useEffectEvent(() => {
    if (publishedTimerRef.current !== null) clearTimeout(publishedTimerRef.current)
  })

  useEffect(() => {
    return () => {
      clearPublishedTimer()
    }
  }, [])
}

const statusColors: Record<string, string> = {
  brouillon: 'gray',
  'validé': 'green',
  'en revue': 'orange',
}

export function TeamControlsPanel({
  teamControls,
  onBack,
  onPublish,
}: {
  teamControls: TeamControl[]
  onBack: () => void
  onPublish: (controls: TeamControl[]) => void
}) {
  const [search, setSearch] = useState('')
  const [filterRubrique, setFilterRubrique] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [published, setPublished] = useState(false)
  const publishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  usePublishedTimerCleanup(publishedTimerRef)

  const filtered = teamControls.filter((tc) => {
    const matchSearch =
      !search ||
      tc.name.toLowerCase().includes(search.toLowerCase()) ||
      tc.createdBy.toLowerCase().includes(search.toLowerCase()) ||
      tc.description.toLowerCase().includes(search.toLowerCase())
    const matchRubrique = !filterRubrique || tc.rubriqueId === filterRubrique
    return matchSearch && matchRubrique
  })

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((tc) => selected.has(tc.id))

  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((tc) => tc.id)))
    }
  }

  const handlePublish = () => {
    const toPublish = teamControls.filter((tc) => selected.has(tc.id))
    onPublish(toPublish)
    setPublished(true)
    if (publishedTimerRef.current !== null) clearTimeout(publishedTimerRef.current)
    publishedTimerRef.current = setTimeout(() => setPublished(false), 2500)
    setSelected(new Set())
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box px="md" py="sm" style={{ borderBottom: '1px solid #e9ecef', backgroundColor: '#fff', flexShrink: 0 }}>
        <Group justify="space-between" mb="xs">
          <Group gap="xs">
            <ThemeIcon size="sm" radius="sm" style={{ background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}>
              <IconListDetails size={14} color="#fff" />
            </ThemeIcon>
            <Text size="sm" fw={600}>{"Contrôles de l'équipe"}</Text>
          </Group>
          <Button size="xs" variant="subtle" color="gray" onClick={onBack} leftSection={<IconX size={14} />}>
            Retour
          </Button>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            placeholder="Rechercher un contrôle..."
            size="xs" radius="sm"
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Select
            placeholder="Rubrique" size="xs" radius="sm" clearable
            leftSection={<IconFilter size={14} />}
            data={RUBRIQUES} value={filterRubrique} onChange={setFilterRubrique} w={220}
          />
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }}>
        <Box px="md" py="xs">
          <Table
            highlightOnHover striped withTableBorder withColumnBorders={false}
            styles={{
              table: { fontSize: 12 },
              th: { fontSize: 11, fontWeight: 600, color: '#495057', padding: '8px 10px', backgroundColor: '#f8f9fa' },
              td: { padding: '8px 10px', verticalAlign: 'top' },
            }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 36 }}>
                  <Checkbox
                    size="xs" checked={allFilteredSelected}
                    indeterminate={selected.size > 0 && filtered.some((tc) => selected.has(tc.id)) && !allFilteredSelected}
                    onChange={toggleAll} aria-label="Tout sélectionner" color="teal"
                  />
                </Table.Th>
                <Table.Th>Contrôle</Table.Th>
                <Table.Th style={{ width: 90 }}>Rubrique</Table.Th>
                <Table.Th style={{ width: 90 }}>{"Créé par"}</Table.Th>
                <Table.Th style={{ width: 80 }}>Date</Table.Th>
                <Table.Th style={{ width: 80 }}>Statut</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text size="xs" c="dimmed" ta="center" py="md">
                      Aucun contrôle ne correspond aux critères de recherche.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                filtered.map((tc) => (
                  <Table.Tr
                    key={tc.id}
                    style={{ cursor: 'pointer', backgroundColor: selected.has(tc.id) ? '#f0fdf4' : undefined }}
                    onClick={() => toggleSelect(tc.id)}
                  >
                    <Table.Td>
                      <Checkbox
                        size="xs" checked={selected.has(tc.id)} onChange={() => toggleSelect(tc.id)}
                        color="teal" aria-label={`Sélectionner ${tc.name}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap" align="flex-start">
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" fw={500} style={{ lineHeight: 1.4 }}>{tc.name}</Text>
                          <Text size="xs" c="dimmed" lineClamp={2} style={{ lineHeight: 1.4 }}>{tc.description}</Text>
                        </Box>
                        <Tooltip label={"Généré par l'IA"} withArrow position="top">
                          <Badge size="xs" color="teal" variant="light" leftSection={<IconSparkles size={9} />} styles={{ root: { textTransform: 'none', flexShrink: 0 } }}>
                            IA
                          </Badge>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color="gray" styles={{ root: { textTransform: 'none' } }}>
                        {RUBRIQUES.find((r) => r.value === tc.rubriqueId)?.value || tc.rubriqueId}
                      </Badge>
                    </Table.Td>
                    <Table.Td><Text size="xs">{tc.createdBy}</Text></Table.Td>
                    <Table.Td><Text size="xs">{tc.createdAt}</Text></Table.Td>
                    <Table.Td>
                      <Badge size="xs" color={statusColors[tc.status] || 'gray'} variant="light" styles={{ root: { textTransform: 'capitalize' } }}>
                        {tc.status}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Box>
      </ScrollArea>

      <Box px="md" py="sm" style={{ borderTop: '1px solid #e9ecef', backgroundColor: '#fff', flexShrink: 0 }}>
        <Transition mounted={published} transition="slide-up" duration={300}>
          {(styles) => (
            <Paper p="xs" mb="xs" radius="sm" style={{ ...styles, backgroundColor: '#d3f9d8', border: '1px solid #b2f2bb' }}>
              <Group gap="xs">
                <IconCheck size={14} color="#2b8a3e" />
                <Text size="xs" c="green" fw={500}>
                  {selected.size} contrôle(s) publié(s) avec succès.
                </Text>
              </Group>
            </Paper>
          )}
        </Transition>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {selected.size > 0 ? `${selected.size} contrôle(s) sélectionné(s)` : 'Aucune sélection'}
          </Text>
          <Button
            size="xs" color="teal" disabled={selected.size === 0}
            leftSection={<IconCheck size={14} />}
            onClick={handlePublish}
            style={selected.size > 0 ? { background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' } : undefined}
          >
            Publier la sélection
          </Button>
        </Group>
      </Box>
    </Box>
  )
}
