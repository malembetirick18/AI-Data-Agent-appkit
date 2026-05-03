// Shared shell — Mantine AppShell header with app switcher.
import { AppShell, Group, Text, Menu, ActionIcon, Avatar, Breadcrumbs, Anchor, Divider } from '@mantine/core';
import { IconApps, IconBell, IconSearch } from '@tabler/icons-react';

type Product = 'geo' | 'closing';

export function ShellHeader({ product, crumbs }: { product: Product; crumbs: string[] }) {
  return (
    <AppShell.Header>
      <Group h="100%" px="md" gap="sm">
        <Menu shadow="md" width={220}>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" aria-label="Vos applications">
              <IconApps size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Vos applications</Menu.Label>
            <Menu.Item component="a" href="/geo">Geoficiency</Menu.Item>
            <Menu.Item component="a" href="/closing">Closing</Menu.Item>
            <Menu.Divider />
            <Menu.Item component="a" href="/console">Console agent</Menu.Item>
          </Menu.Dropdown>
        </Menu>

        <Group gap={8}>
          <BrandMark variant={product === 'closing' ? 'pink' : 'teal'} />
          <Text fw={600} size="lg" c={product === 'closing' ? 'closingPink.6' : 'teal.7'}>
            {product === 'closing' ? 'Closing' : 'Geoficiency'}
          </Text>
        </Group>

        <Divider orientation="vertical" />

        <Breadcrumbs separator="/" c="dimmed">
          {crumbs.map((c, i) => (
            <Anchor key={i} c={i === crumbs.length - 1 ? 'dark' : 'dimmed'} fw={i === crumbs.length - 1 ? 500 : 400}>
              {c}
            </Anchor>
          ))}
        </Breadcrumbs>

        <Group ml="auto" gap="xs">
          <ActionIcon variant="subtle" color="gray" aria-label="Recherche"><IconSearch size={18} /></ActionIcon>
          <ActionIcon variant="subtle" color="gray" aria-label="Notifications"><IconBell size={18} /></ActionIcon>
          <Avatar size="sm" color="gray" radius="xl">MA</Avatar>
        </Group>
      </Group>
    </AppShell.Header>
  );
}

function BrandMark({ variant }: { variant: 'teal' | 'pink' }) {
  const fill = variant === 'teal' ? 'var(--mantine-color-teal-5)' : 'var(--mantine-color-closingPink-5)';
  return (
    <svg width={28} height={28} viewBox="0 0 32 32">
      <path d="M16 2 L28 9 L28 23 L16 30 L4 23 L4 9 Z" fill={fill} />
      <path d="M16 9 L22 12.5 L22 19.5 L16 23 L10 19.5 L10 12.5 Z" fill="#fff" />
      <circle cx={16} cy={16} r={2.4} fill={fill} />
    </svg>
  );
}
