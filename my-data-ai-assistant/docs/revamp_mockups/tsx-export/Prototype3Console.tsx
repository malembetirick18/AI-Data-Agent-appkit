// Prototype 3 — Console agent multi-threads. Mantine + Vite + React + TypeScript.
//
// JOB: Power-user console with threads sidebar, prompt + reasoning trace, and
// a tabbed output canvas (table, chart, sources, agent state JSON).

import { useEffect, useRef, useState } from 'react';
import {
  AppShell, Stack, Group, Card, Text, Title, Button, ActionIcon, Textarea, TextInput,
  Badge, Skeleton, Tabs, Table, ScrollArea, Box, SimpleGrid, ThemeIcon, UnstyledButton, Paper, Code,
} from '@mantine/core';
import {
  IconSparkles, IconSend, IconBrain, IconPlus, IconSearch, IconCheck,
  IconTable, IconChartBar, IconFile, IconDownload, IconCopy,
} from '@tabler/icons-react';
import { ShellHeader } from './Shell';
import { FOURNISSEURS, CONVERSATION_SNIPPETS, SUGGESTED_PROMPTS, fmtCA } from './mockData';

const REASONING_STEPS = [
  { t: 'Plan',       d: 'Décomposer la requête en 4 sous-tâches.', ms: 240 },
  { t: 'Données',    d: 'Chargement de 8 fournisseurs · 142 conversations indexées.', ms: 680 },
  { t: 'Croisement', d: '6 doublons potentiels détectés via clé (BL, montant, date).', ms: 1240 },
  { t: 'Synthèse',   d: 'Génération du rapport structuré.', ms: 420 },
];

const AGENT_STATE = {
  status: 'completed', thread_id: 't-01', agent: 'controls-generator-v2',
  iterations: 4,
  data_sources: ['ecritures_comptables_2025', 'balance_auxiliaire_fournisseurs', 'conversations_indexees', 'referentiel_tiers'],
  fournisseurs_analyses: 8, ca_total_2025: 5321800, cas_a_risque: 3, doublons_potentiels: 6,
  last_updated: '2026-04-12T14:34:22Z', evidence_refs: ['C-1', 'C-2', 'C-3'],
};

const THREADS = [
  { id: 't-01', title: 'Analyse écarts fournisseurs Q1', updated: 'il y a 12 min', tag: 'CONTRÔLES', pinned: true },
  { id: 't-02', title: 'Doublons factures — Voltaire',   updated: 'il y a 2 h',   tag: 'AUDIT',      pinned: false },
  { id: 't-03', title: 'Cartographie risque fournisseurs', updated: 'il y a 5 h', tag: 'GEO',        pinned: false },
  { id: 't-04', title: 'Soldes comptables vs. auxiliaires', updated: 'hier',      tag: 'CONTRÔLES', pinned: false },
];

type Msg = { role: 'user' | 'agent'; text: string; timestamp?: string };

export default function Prototype3Console() {
  const [active, setActive] = useState('t-01');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [reasoning, setReasoning] = useState<typeof REASONING_STEPS>([]);
  const [outState, setOutState] = useState<'empty' | 'loading' | 'loaded'>('empty');
  const [busy, setBusy] = useState(false);

  const runIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelRun = () => {
    runIdRef.current += 1;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const runQuery = (q: string) => {
    cancelRun();
    const myRun = runIdRef.current;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setReasoning([]); setBusy(true); setOutState('loading');
    let i = 0;
    const tick = () => {
      if (myRun !== runIdRef.current) return;
      if (i >= REASONING_STEPS.length || !REASONING_STEPS[i]) {
        setOutState('loaded'); setBusy(false);
        setMessages((m) => [...m, { role: 'agent', text: 'Analyse complète. Canvas mis à jour.',
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }]);
        return;
      }
      setReasoning((r) => [...r, REASONING_STEPS[i]]); i++; timerRef.current = setTimeout(tick, 600);
    };
    timerRef.current = setTimeout(tick, 400);
  };

  return (
    <AppShell header={{ height: 56 }} padding={0}>
      <ShellHeader product="geo" crumbs={['Console agent', 'Threads', 'Analyse écarts fournisseurs']} />
      <AppShell.Main style={{ height: 'calc(100vh - 56px)', display: 'flex', overflow: 'hidden' }}>
        <ThreadsSidebar active={active} onSelect={setActive} />
        <ConversationColumn messages={messages} reasoning={reasoning} busy={busy} onSend={runQuery} />
        <Box style={{ flex: 1, minWidth: 0, background: 'var(--mantine-color-gray-0)', display: 'flex', flexDirection: 'column' }}>
          {outState === 'empty'   && <Empty />}
          {outState === 'loading' && <Box p="md"><Skeleton h={300} /></Box>}
          {outState === 'loaded'  && <OutputCanvas />}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

function ThreadsSidebar({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const filtered = THREADS.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <Stack gap={0} style={{ width: 280, minWidth: 280, borderRight: '1px solid var(--mantine-color-gray-2)', background: 'var(--mantine-color-gray-0)' }}>
      <Group p="sm" justify="space-between" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
        <Text fw={600}>Conversations</Text>
        <ActionIcon variant="default"><IconPlus size={14} /></ActionIcon>
      </Group>
      <Box p="sm"><TextInput leftSection={<IconSearch size={14} />} placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.currentTarget.value)} /></Box>
      <ScrollArea style={{ flex: 1 }} px="xs" pb="sm">
        {filtered.map((t) => (
          <UnstyledButton key={t.id} onClick={() => onSelect(t.id)} display="block" p="xs"
            style={{ borderRadius: 6, background: active === t.id ? '#fff' : 'transparent',
                     border: active === t.id ? '1px solid var(--mantine-color-gray-2)' : '1px solid transparent', marginBottom: 2 }}>
            <Badge size="xs" variant="light" color={t.tag === 'GEO' ? 'teal' : t.tag === 'AUDIT' ? 'red' : 'closingPink'}>{t.tag}</Badge>
            <Text size="sm" mt={4} fw={active === t.id ? 500 : 400}>{t.title}</Text>
            <Text size="xs" c="dimmed">{t.updated}</Text>
          </UnstyledButton>
        ))}
      </ScrollArea>
    </Stack>
  );
}

function ConversationColumn({ messages, reasoning, busy, onSend }: {
  messages: Msg[]; reasoning: typeof REASONING_STEPS; busy: boolean; onSend: (q: string) => void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [messages, reasoning]);
  const submit = () => { if (!text.trim() || busy) return; onSend(text.trim()); setText(''); };
  return (
    <Stack gap={0} style={{ width: 460, minWidth: 460, borderRight: '1px solid var(--mantine-color-gray-2)', background: '#fff' }}>
      <ScrollArea viewportRef={ref} style={{ flex: 1 }} p="md">
        {messages.length === 0 ? (
          <>
            <Card p="md" mb="md" bg="gray.0">
              <Group gap="xs" mb="xs"><IconBrain size={16} /><Text fw={600}>Console agent multi-produits</Text></Group>
              <Text size="sm" c="dimmed">Une conversation, une session d'agent, un état inspectable.</Text>
            </Card>
            <Stack gap={6}>
              {SUGGESTED_PROMPTS.slice(0, 3).map((p, i) => (
                <UnstyledButton key={i} onClick={() => onSend(p)} p="sm"
                  style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6, fontSize: 12.5, lineHeight: 1.5 }}>{p}</UnstyledButton>
              ))}
            </Stack>
          </>
        ) : (
          <Stack gap="md">
            {messages.map((m, i) => m.role === 'user' ? (
              <Group key={i} justify="flex-end"><Paper bg="dark" c="white" p="xs" px="sm" radius="md" maw="88%"><Text size="sm">{m.text}</Text></Paper></Group>
            ) : (
              <Stack key={i} gap={4}>
                <Group gap={6}><IconSparkles size={14} /><Text size="xs" c="dimmed">Agent · {m.timestamp}</Text></Group>
                <Text size="sm">{m.text}</Text>
              </Stack>
            ))}
            {reasoning.length > 0 && (
              <Box pl="md" style={{ borderLeft: '2px solid var(--mantine-color-gray-2)' }}>
                <Group gap={6} mb="xs"><IconBrain size={14} /><Text size="xs" fw={600}>Raisonnement</Text><Badge size="xs" variant="light">{reasoning.length}/4</Badge></Group>
                <Stack gap="xs">
                  {reasoning.filter(Boolean).map((s, i) => (
                    <Box key={i}>
                      <Group gap={6}><ThemeIcon size={18} variant="light" color="teal" radius="sm">{i + 1}</ThemeIcon><Text size="xs" fw={600}>{s.t}</Text><Text size="xs" c="dimmed">{s.ms} ms</Text></Group>
                      <Text size="xs" c="dimmed" ml={26}>{s.d}</Text>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </ScrollArea>
      <Box p="md" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
        <Box style={{ position: 'relative' }}>
          <Textarea value={text} onChange={(e) => setText(e.currentTarget.value)}
            placeholder="Demandez quelque chose à l'agent…" minRows={2} autosize
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <ActionIcon color="teal" size="lg" onClick={submit} disabled={!text.trim() || busy}
            style={{ position: 'absolute', right: 8, bottom: 8 }}><IconSend size={16} /></ActionIcon>
        </Box>
      </Box>
    </Stack>
  );
}

function Empty() {
  return <Stack align="center" justify="center" h="100%" p="xl"><ThemeIcon size={64} variant="default"><IconBrain size={28} /></ThemeIcon><Title order={3}>Aucune sortie</Title><Text c="dimmed">Le canvas affichera tableau, graphique et état dès qu'une requête est envoyée.</Text></Stack>;
}

function OutputCanvas() {
  return (
    <>
      <Group p="md" justify="space-between" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', background: '#fff' }}>
        <Stack gap={2}><Text size="xs" c="dimmed" tt="uppercase">Sortie · {AGENT_STATE.iterations} itérations</Text><Title order={3}>Analyse écarts fournisseurs</Title></Stack>
        <Group><Badge color="green" leftSection={<IconCheck size={12} />}>Terminé</Badge><Button variant="default" leftSection={<IconDownload size={14} />}>Exporter</Button></Group>
      </Group>
      <Tabs defaultValue="table" color="teal" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Tabs.List px="md" bg="white" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
          <Tabs.Tab value="table" leftSection={<IconTable size={14} />}>Tableau</Tabs.Tab>
          <Tabs.Tab value="chart" leftSection={<IconChartBar size={14} />}>Graphique</Tabs.Tab>
          <Tabs.Tab value="sources" leftSection={<IconFile size={14} />}>Sources</Tabs.Tab>
          <Tabs.Tab value="state" leftSection={<IconBrain size={14} />}>État agent</Tabs.Tab>
        </Tabs.List>
        <ScrollArea style={{ flex: 1 }}>
          <Tabs.Panel value="table" p="md">
            <SimpleGrid cols={4} mb="md">
              {[{l:'Fournisseurs',v:'8'},{l:'CA 2025',v:'5,32 M€'},{l:'À risque',v:'3'},{l:'Doublons',v:'6'}].map((k,i)=>(
                <Card key={i} p="sm"><Text size="xs" tt="uppercase" c="dimmed">{k.l}</Text><Text size="xl" fw={600}>{k.v}</Text></Card>
              ))}
            </SimpleGrid>
            <Card p={0}>
              <Table verticalSpacing="sm">
                <Table.Thead><Table.Tr><Table.Th>Fournisseur</Table.Th><Table.Th ta="right">CA 2025</Table.Th><Table.Th ta="right">Variation</Table.Th><Table.Th>Statut</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {FOURNISSEURS.map((f) => (
                    <Table.Tr key={f.id}>
                      <Table.Td><Text fw={500}>{f.nom}</Text><Text size="xs" c="dimmed">{f.id}</Text></Table.Td>
                      <Table.Td ta="right">{fmtCA(f.ca2025)}</Table.Td>
                      <Table.Td ta="right" c={f.variation > 25 ? 'red' : 'dimmed'}>{f.variation > 0 ? '+' : ''}{f.variation.toFixed(1)} %</Table.Td>
                      <Table.Td><Badge variant="light" color={f.risque === 'high' ? 'red' : f.risque === 'medium' ? 'yellow' : 'green'}>{f.risque}</Badge></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          </Tabs.Panel>
          <Tabs.Panel value="chart" p="md"><Card p="md"><Title order={4} mb="md">Distribution des écarts</Title><Text c="dimmed" size="sm">Wire to your favorite chart lib (Mantine Charts, Recharts).</Text></Card></Tabs.Panel>
          <Tabs.Panel value="sources" p="md">
            <Stack gap="sm">
              {CONVERSATION_SNIPPETS.map((s) => (
                <Card key={s.id} p="md">
                  <Group gap="xs" mb="xs"><Badge variant="light" color="teal">{s.id}</Badge><Text fw={600} size="sm">{s.speaker}</Text><Text size="xs" c="dimmed">· {s.timestamp}</Text></Group>
                  <Paper p="xs" bg="teal.0" style={{ borderLeft: '3px solid var(--mantine-color-teal-4)' }}><Text size="sm">« {s.quote} »</Text></Paper>
                </Card>
              ))}
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="state" p="md">
            <Card p={0}>
              <Group p="sm" justify="space-between" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
                <Group><Title order={4}>État de l'agent</Title><Badge color="green">● live</Badge></Group>
                <Button variant="default" size="xs" leftSection={<IconCopy size={14} />}>Copier</Button>
              </Group>
              <Code block p="md">{JSON.stringify(AGENT_STATE, null, 2)}</Code>
            </Card>
          </Tabs.Panel>
        </ScrollArea>
      </Tabs>
    </>
  );
}
