'use client'

import { Group, Button, Box } from '@mantine/core'
import {
  IconCalendar,
  IconUsers,
  IconSettings,
  IconFile,
  IconLink,
  IconShieldCheck,
  IconAdjustments,
  IconSparkles,
} from '@tabler/icons-react'

interface ActionBarProps {
  onOpenChat: () => void
}

const actions = [
  { label: 'Mon activité', icon: IconCalendar },
  { label: 'Affectation des contrôles', icon: IconUsers },
  { label: 'Personnaliser le dossier', icon: IconSettings },
  { label: 'Associer les fichiers', icon: IconFile },
  { label: 'Associer les champs', icon: IconLink },
  { label: "Critères d'exclusion des contrôles", icon: IconShieldCheck },
  { label: 'Paramètres du dossier', icon: IconAdjustments },
]

export function ActionBar({ onOpenChat }: ActionBarProps) {
  return (
    <Box px="lg" py="sm" style={{ backgroundColor: '#fff' }}>
      <Group gap="xs" wrap="wrap">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            color="gray"
            size="xs"
            leftSection={<action.icon size={15} />}
            styles={{
              root: {
                borderColor: '#dee2e6',
                color: '#495057',
                fontWeight: 500,
              },
            }}
          >
            {action.label}
          </Button>
        ))}
        <Button
          size="xs"
          leftSection={<IconSparkles size={15} />}
          onClick={onOpenChat}
          styles={{
            root: {
              fontWeight: 600,
              background: 'linear-gradient(105deg, #0c8599 0%, #1098ad 50%, #15aabf 100%)',
              border: 'none',
              color: '#fff',
              boxShadow: '0 2px 8px rgba(12, 133, 153, 0.3)',
              transition: 'box-shadow 150ms ease, transform 150ms ease',
              '&:hover': {
                boxShadow: '0 4px 14px rgba(12, 133, 153, 0.45)',
                transform: 'translateY(-1px)',
              },
            },
          }}
        >
          Générer un contrôle personnalisé
        </Button>
      </Group>
    </Box>
  )
}
