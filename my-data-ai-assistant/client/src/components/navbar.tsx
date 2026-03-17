'use client'

import {
  Group,
  Text,
  Avatar,
  ActionIcon,
  Anchor,
  Box,
} from '@mantine/core'
import {
  IconGridDots,
  IconHelp,
} from '@tabler/icons-react'

const navLinks = [
  { label: 'Pilotage', href: '#' },
  { label: 'Dossiers', href: '#' },
  { label: 'Dashboards comparatifs', href: '#' },
  { label: 'Imports', href: '#' },
  { label: 'Documents', href: '#' },
]

export function Navbar() {
  return (
    <Box
      component="header"
      style={{
        borderBottom: '1px solid #e9ecef',
        backgroundColor: '#fff',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <Group
        justify="space-between"
        px="lg"
        py="xs"
        style={{ height: 52 }}
      >
        <Group gap="md">
          <ActionIcon variant="subtle" color="gray" size="lg">
            <IconGridDots size={20} />
          </ActionIcon>
          <Group gap={6}>
            <Box
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #12b886 0%, #087f5b 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text size="xs" fw={700} c="white">G</Text>
            </Box>
            <Text fw={600} size="md" c="dark">
              Geoficiency
            </Text>
          </Group>
        </Group>

        <Group gap="xl" visibleFrom="md">
          {navLinks.map((link) => (
            <Anchor
              key={link.label}
              href={link.href}
              underline="never"
              c="dark"
              size="sm"
              fw={500}
            >
              {link.label}
            </Anchor>
          ))}
        </Group>

        <Group gap="md">
          <ActionIcon variant="subtle" color="gray" size="lg">
            <IconHelp size={20} />
          </ActionIcon>
          <Avatar color="teal" radius="xl" size="sm">
            RM
          </Avatar>
          <Text size="sm" fw={500} c="dark" visibleFrom="sm">
            00 LAST GROUP
          </Text>
        </Group>
      </Group>
    </Box>
  )
}
