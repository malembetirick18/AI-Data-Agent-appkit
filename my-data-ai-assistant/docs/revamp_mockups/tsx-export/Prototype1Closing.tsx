// Prototype 1 — Atelier de contrôles (Closing). Mantine + Vite + React + TypeScript.
//
// JOB: Generate a financial control from a natural-language question. Stream the agent's
// synthesis paragraph by paragraph, expose the data behind it, keep evidence traceable.
// PRIMARY ACTION: send a question. SECONDARY: save / export the generated control.

import { useEffect, useRef, useState } from 'react';
import {
  AppShell, Stack, Group, Card, Text, Title, Button, ActionIcon, Textarea,
  Badge, Skeleton, Tabs, Table, ScrollArea, Tooltip, Box, SimpleGrid,
  ThemeIcon, UnstyledButton, Alert, Paper,
} from '@mantine/core';
import {
  IconSparkles, IconBulb, IconSend, IconRefresh, IconCopy, IconDownload,
  IconPin, IconCheck, IconAlertTriangle, IconChartBar,
} from '@tabler/icons-react';
import { ShellHeader } from './Shell';
import {
  SUGGESTED_PROMPTS, FOURNISSEURS, CONVERSATION_SNIPPETS, CONTROL_RESPONSE_PARAS,
  fmtCA, type Fournisseur,
} from './mockData';

type Msg = { role: 'user' | 'agent'; text: string; timestamp?: string };
type OutState = 'empty' | 'loading' | 'loaded';

const KPIS = [
  { label: 'Fournisseurs analysés', value: '8',     hint: 'sur 247 actifs' },
  { label: 'CA cumulé 2025',        value: '5,32 M€', delta: '+18,4 %', deltaColor: 'yellow' as const, hint: 'vs. 2024' },
  { label: 'Cas à risque détectés', value: '3',     delta: '+2', deltaColor: 'red' as const, hint: 'depuis dernier audit' },
  { label: 'Doublons potentiels',   value: '6',     hint: 'à rapprocher' },
];

export default function Prototype1Closing() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [outState, setOutState] = useState<OutState>('empty');
  const [paras, setParas] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const runQuery = (q: string) => {
    setQuery(q);
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setBusy(true); setOutState('loading'); setParas([]); setStreaming(true);
    setTimeout(() => { setOutState('loaded'); streamParas(); }, 1100);
  };

  const streamParas = () => {
    let i = 0;
    const tick = () => {
      if (i >= CONTROL_RESPONSE_PARAS.length) {
        setStreaming(false); setBusy(false);
        setMessages((m) => [...m, { role: 'agent',
          text: "Synthèse générée. 3 cas à risque identifiés — je peux ouvrir les contrôles ciblés ?",
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }]);
        return;
      }
      setParas((p) => [...p, CONTROL_RESPONSE_PARAS[i]]);
      i++; setTimeout(tick, 700);
    };
    tick();
  };

  return (
    <AppShell header={{ height: 56 }} padding={0}>
      <ShellHeader product="closing" crumbs={['Liste des groupes', '00 LAST GROUP', 'Atelier de contrôles']} />
      <AppShell.Main style={{ height: 'calc(100vh - 56px)', display: 'flex', overflow: 'hidden' }}>
        <ConversationPanel messages={messages} busy={busy} onSend={runQuery} onPickPrompt={runQuery} />
        <Box style={{ flex: 1, minWidth: 0, background: 'var(--mantine-color-gray-0)', overflow: 'auto' }}>
          {outState === 'empty'   && <EmptyState />}
          {outState === 'loading' && <LoadingState />}
          {outState === 'loaded'  && <Loaded query={query} paras={paras} streaming={streaming} onRegen={() => { setParas([]); setStreaming(true); streamParas(); }} />}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

// ─── Left panel ────────────────────────────────────────────────────────────────
function ConversationPanel({ messages, busy, onSend, onPickPrompt }: {
  messages: Msg[]; busy: boolean; onSend: (q: string) => void; onPickPrompt: (q: string) => void;
}) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);
  const submit = () => { if (!text.trim() || busy) return; onSend(text.trim()); setText(''); };

  return (
    <Stack gap={0} style={{ width: 480, minWidth: 480, borderRight: '1px solid var(--mantine-color-gray-2)', background: '#fff' }}>
      <Group p="md" gap="sm" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
        <ThemeIcon variant="light" color="closingPink" size="lg" radius="md"><IconSparkles size={18} /></ThemeIcon>
        <Stack gap={0} style={{ flex: 1 }}>
          <Text fw={600}>Assistant Closing</Text>
          <Text size="xs" c="dimmed">Génération de contrôles · session #4271</Text>
        </Stack>
      </Group>

      <ScrollArea viewportRef={scrollRef} style={{ flex: 1 }} p="md">
        {messages.length === 0 ? (
          <>
            <Alert variant="light" color="closingPink" radius="md" icon={<IconBulb size={18} />} title="Atelier IA de génération de contrôles" mb="md">
              <Text size="sm" mb={8}>
                Décrivez en langage naturel un contrôle à exécuter sur vos données comptables. L'agent croise vos écritures, conversations et conventions internes pour produire un rapport structuré.
              </Text>
              <Text size="sm" fw={600} mb={4}>Bonnes pratiques :</Text>
              <Text size="sm" component="ul" pl="md">
                <li>Soyez précis : périmètre comptable, seuils, période</li>
                <li>Utilisez le vocabulaire métier (CA, écritures, tiers)</li>
                <li>Posez des questions de suivi pour affiner</li>
                <li>Les résultats incluent textes, tableaux et graphiques</li>
              </Text>
            </Alert>
            <Text size="xs" tt="uppercase" c="dimmed" mb={8}>Exemples de questions</Text>
            <Stack gap={8}>
              {SUGGESTED_PROMPTS.map((p, i) => (
                <UnstyledButton key={i} onClick={() => onPickPrompt(p)}
                  p="sm" style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6, fontSize: 13, lineHeight: 1.5 }}>
                  {p}
                </UnstyledButton>
              ))}
            </Stack>
          </>
        ) : (
          <Stack gap="md">
            {messages.map((m, i) => <Message key={i} m={m} />)}
            {busy && <Text size="sm" c="dimmed"><IconSparkles size={14} /> L'agent analyse vos données…</Text>}
          </Stack>
        )}
      </ScrollArea>

      <Box p="md" style={{ borderTop: '1px solid var(--mantine-color-gray-2)', background: 'var(--mantine-color-gray-0)' }}>
        <Box style={{ position: 'relative' }}>
          <Textarea value={text} onChange={(e) => setText(e.currentTarget.value)}
            placeholder="Décrivez le contrôle à exécuter…" minRows={2} autosize
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <ActionIcon color="closingPink" size="lg" onClick={submit} disabled={!text.trim() || busy}
            style={{ position: 'absolute', right: 8, bottom: 8 }} aria-label="Envoyer">
            <IconSend size={16} />
          </ActionIcon>
        </Box>
        <Text ta="center" size="xs" c="dimmed" mt={8}>Vérifiez toujours l'exactitude des réponses</Text>
      </Box>
    </Stack>
  );
}

function Message({ m }: { m: Msg }) {
  if (m.role === 'user') {
    return <Group justify="flex-end">
      <Paper bg="closingPink.5" c="white" p="xs" px="sm" radius="md" maw="85%"><Text size="sm">{m.text}</Text></Paper>
    </Group>;
  }
  return <Stack gap={4}>
    <Group gap={6}><IconSparkles size={14} /><Text size="xs" c="dimmed">Agent · {m.timestamp}</Text></Group>
    <Text size="sm">{m.text}</Text>
  </Stack>;
}

// ─── States ────────────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <Stack align="center" justify="center" h="100%" p="xl" ta="center">
      <ThemeIcon size={64} radius="md" variant="light" color="closingPink"><IconChartBar size={32} /></ThemeIcon>
      <Title order={2}>Aucun contrôle généré</Title>
      <Text c="dimmed" maw={360}>Posez une question dans le panneau de gauche. Le résultat structuré apparaîtra ici.</Text>
    </Stack>
  );
}

function LoadingState() {
  return (
    <Stack p="xl" gap="lg">
      <Skeleton height={28} width={260} />
      <Stack gap={10}>
        <Skeleton height={12} /><Skeleton height={12} width="92%" /><Skeleton height={12} width="78%" />
      </Stack>
      <SimpleGrid cols={4}>{[0,1,2,3].map((i) =>
        <Card key={i} p="md"><Skeleton height={11} width={80} mb={10} /><Skeleton height={22} width={120} /></Card>
      )}</SimpleGrid>
      <Skeleton height={220} radius="md" />
      <Skeleton height={180} radius="md" />
    </Stack>
  );
}

// ─── Loaded ─────────────────────────────────────────────────────────────────────
function Loaded({ query, paras, streaming, onRegen }: { query: string; paras: string[]; streaming: boolean; onRegen: () => void; }) {
  return (
    <Stack gap={0}>
      <Group p="md" justify="space-between" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', background: '#fff' }}>
        <Stack gap={2}>
          <Text size="xs" c="closingPink.6" fw={600} tt="uppercase">Contrôle généré</Text>
          <Title order={3}>Analyse écarts fournisseurs · Q1 2026</Title>
          <Text size="xs" c="dimmed">Question : <em>{query}</em></Text>
        </Stack>
        <Group gap="xs">
          <Badge color="green" leftSection={<IconCheck size={12} />}>Terminé</Badge>
          <Tooltip label="Régénérer"><ActionIcon variant="default" onClick={onRegen}><IconRefresh size={16} /></ActionIcon></Tooltip>
          <Tooltip label="Copier"><ActionIcon variant="default"><IconCopy size={16} /></ActionIcon></Tooltip>
          <Tooltip label="Exporter"><ActionIcon variant="default"><IconDownload size={16} /></ActionIcon></Tooltip>
          <Button color="closingPink" leftSection={<IconPin size={14} />}>Enregistrer</Button>
        </Group>
      </Group>

      <Tabs defaultValue="synthese" color="closingPink">
        <Tabs.List px="md" bg="white" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
          <Tabs.Tab value="synthese">Synthèse</Tabs.Tab>
          <Tabs.Tab value="tableau">Tableau</Tabs.Tab>
          <Tabs.Tab value="graphique">Graphique</Tabs.Tab>
          <Tabs.Tab value="sources">Sources & évidences</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="synthese" p="md"><Synthese paras={paras} streaming={streaming} /></Tabs.Panel>
        <Tabs.Panel value="tableau" p="md"><FournisseurTable rows={FOURNISSEURS} /></Tabs.Panel>
        <Tabs.Panel value="graphique" p="md"><ChartCard /></Tabs.Panel>
        <Tabs.Panel value="sources" p="md"><EvidenceList /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function Synthese({ paras, streaming }: { paras: string[]; streaming: boolean }) {
  return (
    <Stack gap="lg">
      <SimpleGrid cols={4}>
        {KPIS.map((k, i) => (
          <Card key={i} p="md">
            <Text size="xs" tt="uppercase" c="dimmed" mb={6}>{k.label}</Text>
            <Group gap={8} align="baseline">
              <Text size="xl" fw={600}>{k.value}</Text>
              {k.delta && <Badge color={k.deltaColor} variant="light">{k.delta}</Badge>}
            </Group>
            {k.hint && <Text size="xs" c="dimmed" mt={4}>{k.hint}</Text>}
          </Card>
        ))}
      </SimpleGrid>

      <Card p="lg">
        <Group gap="xs" mb="sm"><IconSparkles size={16} /><Title order={4}>Synthèse de l'agent</Title></Group>
        {paras.map((p, i) => <Text key={i} size="sm" mb="xs" dangerouslySetInnerHTML={{ __html: renderInlineMd(p) }} />)}
        {streaming && <Box component="span" w={7} h={14} bg="dark" display="inline-block" />}
      </Card>

      <Stack gap="xs">
        <Title order={4}>Cas signalés</Title>
        <Alert color="red"    icon={<IconAlertTriangle size={16} />} title="Logistique Voltaire SAS">3 doublons potentiels · +29,1 % CA</Alert>
        <Alert color="green"  icon={<IconCheck size={16} />}        title="Numéris Conseil">+67,3 % CA · justifié par C-1</Alert>
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title="Cabinet Arènes">+63,0 % CA · justification manquante</Alert>
      </Stack>
    </Stack>
  );
}

function renderInlineMd(s: string) {
  return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function FournisseurTable({ rows }: { rows: Fournisseur[] }) {
  return (
    <Card p={0}>
      <Table verticalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Fournisseur</Table.Th><Table.Th>Catégorie</Table.Th>
            <Table.Th ta="right">CA 2024</Table.Th><Table.Th ta="right">CA 2025</Table.Th>
            <Table.Th ta="right">Variation</Table.Th><Table.Th>Statut</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((f) => (
            <Table.Tr key={f.id}>
              <Table.Td><Text fw={500}>{f.nom}</Text><Text size="xs" c="dimmed">{f.id} · {f.region}</Text></Table.Td>
              <Table.Td c="dimmed">{f.categorie}</Table.Td>
              <Table.Td ta="right" c="dimmed">{fmtCA(f.ca2024)}</Table.Td>
              <Table.Td ta="right" fw={500}>{fmtCA(f.ca2025)}</Table.Td>
              <Table.Td ta="right" c={f.variation > 25 ? 'red' : f.variation < -50 ? 'yellow' : 'dimmed'}>
                {f.variation > 0 ? '+' : ''}{f.variation.toFixed(1)} %
              </Table.Td>
              <Table.Td>
                <Badge color={f.risque === 'high' ? 'red' : f.risque === 'medium' ? 'yellow' : 'green'} variant="light">
                  {f.risque === 'high' ? 'Risque' : f.risque === 'medium' ? 'À vérifier' : 'OK'}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

function ChartCard() {
  const max = Math.max(...FOURNISSEURS.map((f) => f.ca2025));
  return (
    <Card p="md">
      <Title order={4} mb="md">CA 2024 → 2025 par fournisseur</Title>
      <Stack gap="sm">
        {FOURNISSEURS.map((f) => (
          <Box key={f.id}>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={500}>{f.nom}</Text>
              <Text size="xs" c={f.variation > 25 ? 'red' : f.variation < -50 ? 'yellow' : 'dimmed'}>
                {f.variation > 0 ? '+' : ''}{f.variation.toFixed(1)} %
              </Text>
            </Group>
            <Box h={10} bg="gray.1" style={{ borderRadius: 5, position: 'relative' }}>
              <Box pos="absolute" h="100%" bg="closingPink.3" w={`${(f.ca2025 / max) * 100}%`} style={{ borderRadius: 5 }} />
            </Box>
          </Box>
        ))}
      </Stack>
    </Card>
  );
}

function EvidenceList() {
  return (
    <Stack gap="sm">
      {CONVERSATION_SNIPPETS.map((s) => (
        <Card key={s.id} p="md">
          <Group gap="xs" mb="xs">
            <Badge color="closingPink" variant="light">{s.id}</Badge>
            <Text fw={600} size="sm">{s.speaker}</Text>
            <Text size="xs" c="dimmed">· {s.timestamp}</Text>
          </Group>
          <Paper p="xs" bg="closingPink.0" style={{ borderLeft: '3px solid var(--mantine-color-closingPink-4)' }}>
            <Text size="sm">« {s.quote} »</Text>
          </Paper>
          <Group gap={6} mt="xs">{s.tags.map((t) => <Badge key={t} variant="default">{t}</Badge>)}</Group>
        </Card>
      ))}
    </Stack>
  );
}
