import type { ReactNode } from 'react'
import {
  Modal, Stack, Box, Text, TextInput, Textarea, Select, Group, Button,
  Divider, Switch, Badge, Alert, ScrollArea, Avatar,
} from '@mantine/core'
import {
  IconDeviceFloppy, IconCheck, IconAlertTriangle, IconRobot, IconUsers,
  IconShieldCheck, IconEye, IconPencil,
} from '@tabler/icons-react'
import { RUBRIQUES } from '../lib/spec-utils'
import type { SavedControl, UserRight } from '../types/chat'

type DossierUser = { id: string; name: string; email: string; initials: string; role: string }

const RIGHT_OPTIONS: { value: UserRight; label: string; icon: ReactNode; color: string }[] = [
  { value: 'modification', label: 'Modification', icon: <IconPencil size={14} />, color: '#0c8599' },
  { value: 'lecture', label: 'Lecture seule', icon: <IconEye size={14} />, color: '#f59f00' },
  { value: 'aucun', label: 'Aucun accès', icon: <IconShieldCheck size={14} />, color: '#868e96' },
]

interface SaveControlModalProps {
  opened: boolean
  onClose: () => void
  saveForm: { name: string; description: string; results: string; rubriqueId: string }
  setSaveForm: React.Dispatch<React.SetStateAction<{ name: string; description: string; results: string; rubriqueId: string }>>
  aiSuggestedRubrique: string | null
  rubriqueAlert: boolean
  setRubriqueAlert: (v: boolean) => void
  saved: boolean
  applyToGroup: boolean
  setApplyToGroup: (v: boolean) => void
  dossierUsers: DossierUser[]
  userRights: Record<string, UserRight>
  setUserRights: React.Dispatch<React.SetStateAction<Record<string, UserRight>>>
  onSubmit: () => void
}

export function SaveControlModal({
  opened, onClose,
  saveForm, setSaveForm,
  aiSuggestedRubrique, rubriqueAlert, setRubriqueAlert,
  saved, applyToGroup, setApplyToGroup,
  dossierUsers,
  userRights, setUserRights,
  onSubmit,
}: SaveControlModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconDeviceFloppy size={18} color="#0c8599" />
          <Text fw={600} size="sm">Enregistrer un nouveau contrôle</Text>
        </Group>
      }
      size="xl" radius="md" centered
      overlayProps={{ backgroundOpacity: 0.25, blur: 3 }}
    >
      <Stack gap="md">
        <Box>
          <Text size="xs" fw={500} mb={4}>Nom du contrôle</Text>
          <TextInput
            value={saveForm.name}
            onChange={(e) => setSaveForm((f) => ({ ...f, name: e.currentTarget.value }))}
            size="sm" radius="sm"
            placeholder="Ex: Vérification des fournisseurs inactifs"
            rightSection={saveForm.name ? <Badge size="xs" color="teal" variant="light" mr={4}>Auto-rempli</Badge> : null}
            rightSectionWidth={saveForm.name ? 90 : undefined}
          />
        </Box>

        <Box>
          <Text size="xs" fw={500} mb={4}>Description du contrôle</Text>
          <Textarea
            value={saveForm.description}
            onChange={(e) => setSaveForm((f) => ({ ...f, description: e.currentTarget.value }))}
            size="sm" radius="sm" minRows={3} autosize
            placeholder={'Décrivez l\'objectif et le périmètre du contrôle...'}
          />
          {saveForm.description && <Badge size="xs" color="teal" variant="light" mt={4}>{'Auto-rempli par l\'IA'}</Badge>}
        </Box>

        <Box>
          <Text size="xs" fw={500} mb={4}>Résultats</Text>
          <Textarea
            value={saveForm.results}
            onChange={(e) => setSaveForm((f) => ({ ...f, results: e.currentTarget.value }))}
            size="sm" radius="sm" minRows={5} maxRows={10} autosize
            placeholder={'Résultats de l\'analyse...'}
          />
          {saveForm.results && <Badge size="xs" color="teal" variant="light" mt={4}>{'Auto-rempli par l\'IA'}</Badge>}
        </Box>

        <Box>
          <Text size="xs" fw={500} mb={4}>{'Rubrique d\'affectation'}</Text>
          <Select
            value={saveForm.rubriqueId}
            onChange={(val) => {
              if (val) {
                setSaveForm((f) => ({ ...f, rubriqueId: val }))
                if (aiSuggestedRubrique && val !== aiSuggestedRubrique) {
                  setRubriqueAlert(true)
                } else {
                  setRubriqueAlert(false)
                }
              }
            }}
            data={RUBRIQUES} size="sm" radius="sm" allowDeselect={false}
            rightSection={saveForm.rubriqueId === aiSuggestedRubrique ? <Badge size="xs" color="teal" variant="light" mr={24}>{'Suggestion IA'}</Badge> : null}
            rightSectionWidth={saveForm.rubriqueId === aiSuggestedRubrique ? 110 : undefined}
          />
          {saveForm.rubriqueId === aiSuggestedRubrique && (
            <Group gap={4} mt={4}>
              <IconRobot size={13} color="#0c8599" />
              <Text size="xs" c="teal">{'Rubrique suggérée automatiquement par l\'IA en fonction du contenu du contrôle'}</Text>
            </Group>
          )}
        </Box>

        {rubriqueAlert && aiSuggestedRubrique && (
          <Alert
            icon={<IconAlertTriangle size={18} />} color="orange" variant="light" radius="md"
            title="Correction de rubrique détectée"
            styles={{ title: { fontSize: 13, fontWeight: 600 }, message: { fontSize: 12 } }}
          >
            <Text size="xs">
              {'L\'IA a initialement suggéré la rubrique '}
              <Text span fw={600}>{RUBRIQUES.find((r) => r.value === aiSuggestedRubrique)?.label}</Text>
              {' pour ce contrôle. Vous avez sélectionné une rubrique différente. '}
            </Text>
            <Group gap="xs" mt={8}>
              <Button size="xs" variant="light" color="orange" leftSection={<IconRobot size={14} />}
                onClick={() => { setSaveForm((f) => ({ ...f, rubriqueId: aiSuggestedRubrique })); setRubriqueAlert(false) }}>
                {'Rétablir la suggestion IA'}
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setRubriqueAlert(false)}>
                {'Conserver ma sélection'}
              </Button>
            </Group>
          </Alert>
        )}

        <Divider />
        <Box>
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <IconUsers size={18} color="#0c8599" />
              <Box>
                <Text size="sm" fw={600}>{'Activer sur toutes les sociétés du groupe'}</Text>
                <Text size="xs" c="dimmed">{'Déployer ce contrôle sur l\'ensemble des entités du groupe'}</Text>
              </Box>
            </Group>
            <Switch checked={applyToGroup} onChange={(e) => setApplyToGroup(e.currentTarget.checked)} color="teal" size="md" aria-label="Activer sur toutes les sociétés du groupe" />
          </Group>
        </Box>

        {applyToGroup && (
          <Box style={{ border: '1px solid #e9ecef', borderRadius: 8, overflow: 'hidden' }}>
            <Box px="sm" py="xs" style={{ backgroundColor: '#f0fdf9', borderBottom: '1px solid #e9ecef' }}>
              <Group gap="xs">
                <IconShieldCheck size={15} color="#0c8599" />
                <Text size="xs" fw={600} c="#0c8599">{'Utilisateurs ayant accès au dossier'}</Text>
                <Badge size="xs" color="teal" variant="light" ml="auto">{dossierUsers.length} utilisateurs</Badge>
              </Group>
            </Box>
            <Box px="sm" py={6} style={{ display: 'flex', backgroundColor: '#f8f9fa', borderBottom: '1px solid #f1f3f5' }}>
              <Text size="xs" fw={600} c="dimmed" style={{ flex: 1 }}>Utilisateur</Text>
              <Text size="xs" fw={600} c="dimmed" style={{ width: 130, textAlign: 'center' }}>{'Rôle'}</Text>
              <Text size="xs" fw={600} c="dimmed" style={{ width: 160, textAlign: 'center' }}>{'Droit d\'accès au contrôle'}</Text>
            </Box>
            <ScrollArea.Autosize mah={260}>
              {dossierUsers.map((user) => {
                const currentRight = userRights[user.id] || 'lecture'
                const rightDef = RIGHT_OPTIONS.find((r) => r.value === currentRight) || RIGHT_OPTIONS[0]
                return (
                  <Box key={user.id} px="sm" py="xs" style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f1f3f5' }}>
                    <Group gap="sm" style={{ flex: 1 }}>
                      <Avatar size="sm" radius="xl" color="teal" styles={{ placeholder: { fontSize: 10, fontWeight: 600 } }}>
                        {user.initials}
                      </Avatar>
                      <Box>
                        <Text size="xs" fw={500} style={{ lineHeight: 1.3 }}>{user.name}</Text>
                        <Text size="xs" c="dimmed" style={{ lineHeight: 1.3 }}>{user.email}</Text>
                      </Box>
                    </Group>
                    <Text size="xs" c="dimmed" style={{ width: 130, textAlign: 'center' }}>{user.role}</Text>
                    <Box style={{ width: 160, display: 'flex', justifyContent: 'center' }}>
                      <Select
                        value={currentRight}
                        onChange={(val) => { if (val) setUserRights((prev) => ({ ...prev, [user.id]: val as UserRight })) }}
                        data={RIGHT_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
                        size="xs" radius="sm" allowDeselect={false}
                        styles={{
                          input: { fontSize: 11, fontWeight: 500, color: rightDef.color, borderColor: rightDef.color + '44', backgroundColor: rightDef.color + '08', textAlign: 'center', paddingLeft: 8, paddingRight: 24 },
                          dropdown: { fontSize: 11 },
                        }}
                        w={140}
                      />
                    </Box>
                  </Box>
                )
              })}
            </ScrollArea.Autosize>
            <Box px="sm" py={6} style={{ backgroundColor: '#f8f9fa', borderTop: '1px solid #e9ecef', display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              {RIGHT_OPTIONS.map((r) => {
                const count = Object.values(userRights).filter((v) => v === r.value).length
                return (
                  <Group key={r.value} gap={4}>
                    <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.color }} />
                    <Text size="xs" c="dimmed">{r.label}: <b>{count}</b></Text>
                  </Group>
                )
              })}
            </Box>
          </Box>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" size="sm" onClick={onClose}>Annuler</Button>
          <Button
            size="sm" color="teal"
            leftSection={saved ? <IconCheck size={16} /> : <IconDeviceFloppy size={16} />}
            onClick={onSubmit} disabled={!saveForm.name.trim()}
            style={saved ? { backgroundColor: '#2b8a3e' } : { background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}
          >
            {saved ? 'Enregistré !' : 'Enregistrer le contrôle'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

export type { SavedControl, DossierUser }
