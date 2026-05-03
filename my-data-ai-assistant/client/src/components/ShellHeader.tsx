import {
  AppShell, Group, Text, Menu, ActionIcon, Avatar, Breadcrumbs, Anchor, Divider, Box,
} from '@mantine/core'
import { IconApps, IconBell, IconSearch } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import type { Product } from '../../../shared/products'
import { PRODUCT_LABELS, PRODUCT_ROUTES } from '../../../shared/products'

type Props = {
  product: Product
  crumbs: string[]
}

export function ShellHeader({ product, crumbs }: Props) {
  const accent = product === 'closing' ? 'closingPink.6' : 'teal.7'
  return (
    <AppShell.Header>
      <Group h="100%" px="md" gap="sm">
        <Menu shadow="md" width={220} position="bottom-start">
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" aria-label="Vos applications">
              <IconApps size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Vos applications</Menu.Label>
            <Menu.Item component="a" href={PRODUCT_ROUTES.geo} target="_blank" rel="noopener noreferrer">
              {PRODUCT_LABELS.geo}
            </Menu.Item>
            <Menu.Item component="a" href={PRODUCT_ROUTES.closing} target="_blank" rel="noopener noreferrer">
              {PRODUCT_LABELS.closing}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item component={Link} to="/">Retour à l&apos;accueil</Menu.Item>
          </Menu.Dropdown>
        </Menu>

        <Group gap={8}>
          <BrandMark variant={product === 'closing' ? 'pink' : 'teal'} />
          <Text fw={600} size="lg" c={accent}>{PRODUCT_LABELS[product]}</Text>
        </Group>

        <Divider orientation="vertical" />

        <Breadcrumbs separator="/" c="dimmed">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1
            return (
              <Anchor key={c} c={isLast ? 'dark' : 'dimmed'} fw={isLast ? 500 : 400}>
                {c}
              </Anchor>
            )
          })}
        </Breadcrumbs>

        <Group ml="auto" gap="xs">
          <ActionIcon variant="subtle" color="gray" aria-label="Recherche"><IconSearch size={18} /></ActionIcon>
          <ActionIcon variant="subtle" color="gray" aria-label="Notifications"><IconBell size={18} /></ActionIcon>
          <Avatar size="sm" color="gray" radius="xl">MA</Avatar>
        </Group>
      </Group>
    </AppShell.Header>
  )
}

function BrandMark({ variant }: { variant: 'teal' | 'pink' }) {
  const fill = variant === 'teal' ? 'var(--mantine-color-teal-5)' : 'var(--mantine-color-closingPink-5)'
  return (
    <Box component="svg" width={28} height={28} viewBox="0 0 32 32" aria-hidden>
      <path d="M16 2 L28 9 L28 23 L16 30 L4 23 L4 9 Z" fill={fill} />
      <path d="M16 9 L22 12.5 L22 19.5 L16 23 L10 19.5 L10 12.5 Z" fill="#fff" />
      <circle cx={16} cy={16} r={2.4} fill={fill} />
    </Box>
  )
}
