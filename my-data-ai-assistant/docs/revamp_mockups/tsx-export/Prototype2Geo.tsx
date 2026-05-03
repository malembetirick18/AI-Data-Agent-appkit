// Prototype 2 — Explorateur Géo (Geoficiency). Mantine + Vite + React + TypeScript.
//
// JOB: Answer geo-anchored questions ("which IDF suppliers have >25% variance?")
// with a map-first canvas. Click a region → drill-down into KPIs, ranked list, evidence.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppShell, Stack, Group, Card, Text, Title, Button, ActionIcon, Textarea,
  Badge, Skeleton, Table, ScrollArea, Box, SimpleGrid, ThemeIcon, UnstyledButton, Paper,
} from '@mantine/core';
import { IconSparkles, IconSend, IconX, IconDownload, IconFilter } from '@tabler/icons-react';
import { ShellHeader } from './Shell';
import { FOURNISSEURS, CONVERSATION_SNIPPETS, fmtCA, type Fournisseur } from './mockData';

const GEO_PROMPTS = [
  "Quels fournisseurs en Île-de-France présentent des écarts >25 % vs. 2024 ?",
  "Cartographier les doublons potentiels par région.",
  "Quelles régions concentrent le plus de fournisseurs inactifs ?",
];

type Territory = { id: string; nom: string; x: number; y: number; ca: number; fournisseurs: number; alerts: number };
const TERRITORIES: Territory[] = [
  { id: 'idf', nom: 'Île-de-France', x: 51, y: 18, ca: 1937700, fournisseurs: 2, alerts: 2 },
  { id: 'ara', nom: 'Auvergne-Rhône-Alpes', x: 60, y: 50, ca: 905200, fournisseurs: 1, alerts: 0 },
  { id: 'paca', nom: "Provence-Alpes-Côte d'Azur", x: 64, y: 75, ca: 358700, fournisseurs: 1, alerts: 1 },
  { id: 'occ', nom: 'Occitanie', x: 45, y: 75, ca: 412600, fournisseurs: 1, alerts: 1 },
  { id: 'hdf', nom: 'Hauts-de-France', x: 47, y: 7, ca: 191500, fournisseurs: 1, alerts: 0 },
  { id: 'bre', nom: 'Bretagne', x: 18, y: 26, ca: 9800, fournisseurs: 1, alerts: 1 },
  { id: 'ge', nom: 'Grand Est', x: 72, y: 22, ca: 1138900, fournisseurs: 1, alerts: 0 },
];

type Msg = { role: 'user' | 'agent'; text: string; timestamp?: string };
type OutState = 'empty' | 'loading' | 'loaded';

export default function Prototype2Geo() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [outState, setOutState] = useState<OutState>('empty');
  const [scope, setScope] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const runQuery = (q: string) => {
    setQuery(q); setMessages((m) => [...m, { role: 'user', text: q }]);
    setBusy(true); setOutState('loading');
    setScope(q.toLowerCase().includes('île-de-france') ? 'idf' : 'all');
    setTimeout(() => {
      setOutState('loaded'); setBusy(false);
      setMessages((m) => [...m, { role: 'agent',
        text: 'Analyse terminée. 5 alertes, dont 2 critiques en IDF.',
        timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }]);
    }, 1200);
  };

  return (
    <AppShell header={{ height: 56 }} padding={0}>
      <ShellHeader product="geo" crumbs={['Liste des groupes', '00 LAST GROUP', 'Explorateur Géo']} />
      <AppShell.Main style={{ height: 'calc(100vh - 56px)', display: 'flex', overflow: 'hidden' }}>
        <PromptRail messages={messages} busy={busy} onSend={runQuery} onPickPrompt={runQuery} />
        <Box style={{ flex: 1, minWidth: 0, background: 'var(--mantine-color-gray-0)', overflow: 'auto' }}>
          {outState === 'empty' && <Empty />}
          {outState === 'loading' && <Loading />}
          {outState === 'loaded' && <Loaded scope={scope} setScope={setScope} query={query} />}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

function PromptRail({ messages, busy, onSend, onPickPrompt }: {
  messages: Msg[]; busy: boolean; onSend: (q: string) => void; onPickPrompt: (q: string) => void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [messages]);
  const submit = () => { if (!text.trim() || busy) return; onSend(text.trim()); setText(''); };
  return (
    <Stack gap={0} style={{ width: 420, minWidth: 420, borderRight: '1px solid var(--mantine-color-gray-2)', background: '#fff' }}>
      <Group p="md" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
        <ThemeIcon variant="light" color="teal" size="lg"><IconSparkles size={18} /></ThemeIcon>
        <Stack gap={0}><Text fw={600}>Explorateur Géo</Text><Text size="xs" c="dimmed">Agent géo-comptable</Text></Stack>
      </Group>
      <ScrollArea viewportRef={ref} style={{ flex: 1 }} p="md">
        {messages.length === 0 ? (
          <>
            <Text size="sm" c="dimmed" mb="md">Posez une question géo-anchored. L'agent croise écritures, conversations achats et données territoriales.</Text>
            <Text size="xs" tt="uppercase" c="dimmed" mb={8}>Suggestions</Text>
            <Stack gap={8}>
              {GEO_PROMPTS.map((p, i) => (
                <UnstyledButton key={i} onClick={() => onPickPrompt(p)} p="sm"
                  style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6, fontSize: 13, lineHeight: 1.5 }}>{p}</UnstyledButton>
              ))}
            </Stack>
          </>
        ) : (
          <Stack gap="md">
            {messages.map((m, i) => m.role === 'user' ? (
              <Group key={i} justify="flex-end"><Paper bg="teal.5" c="white" p="xs" px="sm" radius="md" maw="90%"><Text size="sm">{m.text}</Text></Paper></Group>
            ) : (
              <Stack key={i} gap={4}>
                <Group gap={6}><IconSparkles size={14} /><Text size="xs" c="dimmed">Agent · {m.timestamp}</Text></Group>
                <Text size="sm">{m.text}</Text>
              </Stack>
            ))}
          </Stack>
        )}
      </ScrollArea>
      <Box p="md" style={{ borderTop: '1px solid var(--mantine-color-gray-2)', background: 'var(--mantine-color-gray-0)' }}>
        <Box style={{ position: 'relative' }}>
          <Textarea value={text} onChange={(e) => setText(e.currentTarget.value)} placeholder="Posez une question géo-comptable…"
            minRows={2} autosize onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <ActionIcon color="teal" size="lg" onClick={submit} disabled={!text.trim() || busy}
            style={{ position: 'absolute', right: 8, bottom: 8 }}><IconSend size={16} /></ActionIcon>
        </Box>
      </Box>
    </Stack>
  );
}

function Empty()   { return <Stack align="center" justify="center" h="100%" p="xl"><Title order={3}>Posez une question</Title><Text c="dimmed">La carte s'animera dès la première requête.</Text></Stack>; }
function Loading() { return <Stack p="xl" gap="md"><Skeleton h={420} radius="md" /><Skeleton h={220} radius="md" /></Stack>; }

function Loaded({ scope, setScope, query }: { scope: string; setScope: (s: string) => void; query: string; }) {
  const t = scope === 'all' ? null : TERRITORIES.find((x) => x.id === scope) ?? null;
  const rows = useMemo<Fournisseur[]>(() => {
    const all = FOURNISSEURS;
    return t ? all.filter((f) => f.region === t.nom) : all;
  }, [t]);

  return (
    <Stack gap={0}>
      <Group p="md" justify="space-between" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', background: '#fff' }}>
        <Stack gap={2}>
          <Text size="xs" c="teal.7" fw={600} tt="uppercase">Analyse géo · Q1 2026</Text>
          <Title order={3}>{t ? t.nom : 'Toutes régions'}</Title>
          <Text size="xs" c="dimmed"><em>{query}</em></Text>
        </Stack>
        <Group>
          {scope !== 'all' && <Button variant="default" leftSection={<IconX size={14} />} onClick={() => setScope('all')}>Effacer le filtre</Button>}
          <Button variant="default" leftSection={<IconDownload size={14} />}>Exporter</Button>
        </Group>
      </Group>

      <Stack p="md" gap="md">
        <KpiStrip t={t} />
        <FranceMap selected={scope} onSelect={setScope} />
        <Group align="flex-start">
          <Card p={0} style={{ flex: 1.5 }}>
            <Group p="sm" justify="space-between" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
              <Group><Title order={4}>Fournisseurs · classés par écart</Title><Badge variant="light" color="teal">{rows.length}</Badge></Group>
              <Button variant="default" size="xs" leftSection={<IconFilter size={14} />}>Filtres</Button>
            </Group>
            <Table verticalSpacing="sm">
              <Table.Thead><Table.Tr><Table.Th>Fournisseur</Table.Th><Table.Th>Région</Table.Th><Table.Th ta="right">CA 2025</Table.Th><Table.Th ta="right">Variation</Table.Th><Table.Th>Statut</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {rows.map((f) => (
                  <Table.Tr key={f.id}>
                    <Table.Td><Text fw={500}>{f.nom}</Text><Text size="xs" c="dimmed">{f.categorie}</Text></Table.Td>
                    <Table.Td c="dimmed">{f.region}</Table.Td>
                    <Table.Td ta="right" fw={500}>{fmtCA(f.ca2025)}</Table.Td>
                    <Table.Td ta="right" c={f.variation > 25 ? 'red' : f.variation < -50 ? 'yellow' : 'dimmed'}>
                      {f.variation > 0 ? '+' : ''}{f.variation.toFixed(1)} %
                    </Table.Td>
                    <Table.Td><Badge variant="light" color={f.risque === 'high' ? 'red' : f.risque === 'medium' ? 'yellow' : 'green'}>{f.risque === 'high' ? 'Risque' : f.risque === 'medium' ? 'À vérifier' : 'OK'}</Badge></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
          <Card p="md" style={{ flex: 1 }}>
            <Title order={4} mb="sm">Évidences conversationnelles</Title>
            <Stack gap="xs">
              {CONVERSATION_SNIPPETS.map((s) => (
                <Box key={s.id} p="xs" style={{ border: '1px solid var(--mantine-color-gray-2)', borderRadius: 6 }}>
                  <Group gap={6} mb={4}><Badge variant="light" color="teal">{s.id}</Badge><Text fw={600} size="sm">{s.speaker}</Text></Group>
                  <Paper p="xs" bg="teal.0" style={{ borderLeft: '3px solid var(--mantine-color-teal-4)' }}><Text size="xs">« {s.quote} »</Text></Paper>
                </Box>
              ))}
            </Stack>
          </Card>
        </Group>
      </Stack>
    </Stack>
  );
}

function KpiStrip({ t }: { t: Territory | null }) {
  const data = t
    ? [{ l: 'Région', v: t.nom }, { l: 'CA 2025', v: fmtCA(t.ca) }, { l: 'Fournisseurs', v: String(t.fournisseurs) }, { l: 'Alertes', v: String(t.alerts) }]
    : [{ l: 'Régions', v: '7' }, { l: 'CA 2025', v: '5,32 M€' }, { l: 'Alertes', v: '5' }, { l: 'Conversations', v: '142' }];
  return <SimpleGrid cols={4}>{data.map((k, i) => (
    <Card key={i} p="md"><Text size="xs" tt="uppercase" c="dimmed" mb={4}>{k.l}</Text><Text size="xl" fw={600}>{k.v}</Text></Card>
  ))}</SimpleGrid>;
}

function FranceMap({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <Card p={0} style={{ overflow: 'hidden' }}>
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: 460, background: 'linear-gradient(180deg, #f5fcfb, #fff)' }}>
        <path d="M 30 8 L 50 4 L 65 8 L 78 16 L 82 30 L 80 48 L 76 62 L 72 75 L 60 85 L 50 88 L 36 86 L 22 78 L 14 64 L 12 48 L 14 32 L 20 18 Z"
          fill="var(--mantine-color-teal-0)" stroke="var(--mantine-color-teal-3)" strokeWidth="0.4" />
        {TERRITORIES.map((t) => {
          const isSel = selected === t.id;
          const r = isSel ? 4.5 : 3.4;
          const fill = t.alerts >= 2 ? '#e03131' : t.alerts === 1 ? '#f08c00' : 'var(--mantine-color-teal-5)';
          return (
            <g key={t.id} onClick={() => onSelect(t.id)} style={{ cursor: 'pointer' }}>
              {isSel && <circle cx={t.x} cy={t.y} r={r + 3} fill={fill} opacity={0.18} />}
              <circle cx={t.x} cy={t.y} r={r} fill={fill} stroke="#fff" strokeWidth="0.6" />
              {t.alerts > 0 && <text x={t.x} y={t.y + 1.3} textAnchor="middle" fontSize="3" fill="#fff" fontWeight={700}>{t.alerts}</text>}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
