'use client'

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import {
  Drawer,
  Text,
  TextInput,
  ActionIcon,
  Group,
  Box,
  ScrollArea,
  Paper,
  ThemeIcon,
  Stack,
  Divider,
  Table,
  List,
  Accordion,
  UnstyledButton,
  Tooltip,
  Button,
  Modal,
  Textarea,
  Select,
  NumberInput,
  Badge,
  Progress,
  Loader,
  Switch,
  Avatar,
  Alert,
  Checkbox,
  Transition,
} from '@mantine/core'
import {
  IconSparkles,
  IconSend,
  IconArrowsMaximize,
  IconTrash,
  IconX,
  IconBulb,
  IconChevronDown,
  IconCopy,
  IconCheck,
  IconDeviceFloppy,
  IconCalendar,
  IconUsers,
  IconShieldCheck,
  IconEye,
  IconPencil,
  IconAlertTriangle,
  IconRobot,
  IconListDetails,
  IconSearch,
  IconUpload,
  IconFilter,
} from '@tabler/icons-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Tooltip as RechartTooltip,
} from 'recharts'
import { type Spec } from '@json-render/core'
import { JSONUIProvider, Renderer, defineRegistry } from '@json-render/react'
import { chatUiCatalog } from '../../../shared/genui-catalog'

import { useGenieChat, GenieQueryVisualization, DataTable as AppKitDataTable } from '@databricks/appkit-ui/react'
import type { GenieAttachmentResponse, GenieStatementResponse } from '@databricks/appkit-ui/react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TextBlock {
  type: 'text'
  content: string
}

interface BoldBlock {
  type: 'bold'
  content: string
}

interface HeadingBlock {
  type: 'heading'
  content: string
}

interface BulletBlock {
  type: 'bullets'
  items: string[]
}

interface TableBlock {
  type: 'table'
  caption?: string
  headers: string[]
  rows: string[][]
}

interface LineChartBlock {
  type: 'lineChart'
  title: string
  data: Record<string, string | number>[]
  lines: { key: string; color: string; name: string }[]
  xKey: string
  yLabel?: string
  source?: string
}

interface BarChartBlock {
  type: 'barChart'
  title: string
  data: Record<string, string | number>[]
  barKey: string
  xKey: string
  color: string
}

type ContentBlock =
  | TextBlock
  | BoldBlock
  | HeadingBlock
  | BulletBlock
  | TableBlock
  | LineChartBlock
  | BarChartBlock

type GenericUiSpec = Spec

interface GenerateSpecApiResponse {
  spec: GenericUiSpec
  traceId?: string
  model?: string
}

interface SupervisorQuestionOption {
  value: string
  label: string
}

interface SupervisorQuestion {
  id: string
  label: string
  inputType?: 'select' | 'text' | 'number' | 'toggle'
  required?: boolean
  placeholder?: string
  options?: SupervisorQuestionOption[]
}

interface SupervisorApiResponse {
  decision: 'clarify' | 'guide' | 'proceed' | 'error'
  message: string
  rewrittenPrompt?: string
  enrichedPrompt?: string
  suggestedTables?: string[]
  suggestedFunctions?: string[]
  questions?: SupervisorQuestion[]
  confidence?: number
  requiredColumns?: string[]
  predictiveFunctions?: string[]
  queryClassification?: string
  traceId?: string
  model?: string
  catalogSource?: 'payload' | 'env-json' | 'env-file' | 'empty'
}

interface SupervisorConversationContext {
  conversationId: string
  sessionId: string
  source: 'ai-chat-drawer'
  messages: Array<{ role: 'assistant' | 'user'; content: string }>
}

interface PendingClarification {
  originalPrompt: string
  message: string
  decision: 'clarify' | 'guide' | 'proceed' | 'error'
  rewrittenPrompt?: string
  enrichedPrompt?: string
  questions: SupervisorQuestion[]
  suggestedTables: string[]
  suggestedFunctions: string[]
  traceId?: string
  /** When true, the supervisor already approved — user just needs to confirm before Genie */
  canSendDirectly?: boolean
}

function isSupervisorApproved(decision: SupervisorApiResponse['decision'], confidence?: number): boolean {
  return decision === 'proceed' && typeof confidence === 'number' && confidence >= 0.90
}

interface Message {
  id: number | string
  role: 'assistant' | 'user'
  content: string
  blocks?: ContentBlock[]
  timestamp?: string
  attachments?: GenieAttachmentResponse[]
  queryResults?: Map<string, unknown>
  thinking?: boolean
  /** If true, this assistant msg shows period-confirmation buttons */
  periodPrompt?: boolean
  /** If true, show loading state */
  loading?: boolean
  /** Used to auto-fill save form */
  controlName?: string
  controlDescription?: string
}

/* ------------------------------------------------------------------ */
/*  Suggestions                                                        */
/* ------------------------------------------------------------------ */

const suggestions = [
  'Les variations de dépenses par fournisseur ou catégorie sont-elles cohérentes avec les tendances historiques et les volumes d\'activité ?',
  'Existe-t-il des transactions d\'achats présentant des montants, fréquences ou dates atypiques (ex. fractionnement de factures, achats en fin de période, doublons potentiels) ?',
  'Des fournisseurs inactifs continuent-ils à être réglés ?',
  'Quels tiers ont une activité à la fois fournisseur et client ?',
  'Y a-t-il des écarts significatifs entre les soldes comptables fournisseurs et les balances auxiliaires ?',
]

/* ------------------------------------------------------------------ */
/*  Period options for "fournisseurs inactifs" workflow                 */
/* ------------------------------------------------------------------ */

const periodOptions = [
  { label: '3 derniers mois (Jul - Sep 2020)', value: '3m' },
  { label: '6 derniers mois (Avr - Sep 2020)', value: '6m' },
  { label: '12 derniers mois (Oct 2019 - Sep 2020)', value: '12m' },
  { label: 'Exercice complet (01/10/2019 - 30/09/2020)', value: 'full' },
]

/* ------------------------------------------------------------------ */
/*  Mocked rich responses                                              */
/* ------------------------------------------------------------------ */

const lineChartData = [
  { mois: 1, a: 52, b: 18, c: 45 },
  { mois: 2, a: 38, b: 22, c: 62 },
  { mois: 3, a: 42, b: 20, c: 80 },
  { mois: 4, a: 35, b: 25, c: 75 },
  { mois: 5, a: 30, b: 19, c: 68 },
  { mois: 6, a: 28, b: 17, c: 55 },
  { mois: 7, a: 10, b: 15, c: 8 },
  { mois: 8, a: 5, b: 12, c: 2 },
  { mois: 9, a: 8, b: 14, c: 0 },
  { mois: 10, a: 20, b: 35, c: 10 },
  { mois: 11, a: 38, b: 18, c: 25 },
  { mois: 12, a: 45, b: 22, c: 35 },
]

const barChartData = [
  { statut: 'Cohérents', count: 19465 },
  { statut: 'Fortes var.', count: 2185 },
  { statut: 'Hausses prix', count: 132 },
  { statut: 'Baisses prix', count: 81 },
]

function _buildRichResponse(): ContentBlock[] {
  return [
    {
      type: 'bold',
      content:
        'Les variations de dépenses par fournisseur présentent une cohérence globale avec les volumes d\'activité, mais 213 cas nécessitent une attention particulière.',
    },
    {
      type: 'text',
      content:
        'L\'analyse révèle que 86% des fournisseurs (19 465 sur 22 858) présentent des variations cohérentes entre leurs dépenses et leurs volumes de transactions. Cependant, des incohérences significatives ont été identifiées pour 213 fournisseurs, principalement liées à des hausses de prix sans augmentation de volume.',
    },
    { type: 'heading', content: 'Cohérence globale avec les tendances historiques' },
    {
      type: 'text',
      content:
        'Les dépenses fournisseurs suivent des tendances mensuelles relativement stables pour la plupart des dossiers analysés. Le dossier 363-vw3sul04 montre une forte chute en avril-mai 2020 (de 28,7M\u20ac à 8,6M\u20ac), cohérente avec une baisse du volume de transactions de 73 208 à 13 708 entrées, reflétant probablement l\'impact de la pandémie COVID-19.',
    },
    {
      type: 'lineChart',
      title: 'Évolution des dépenses fournisseurs par mois',
      data: lineChartData,
      xKey: 'mois',
      yLabel: 'Dépenses totales (M\u20ac)',
      lines: [
        { key: 'a', color: '#1c7ed6', name: '363-vw3sul04' },
        { key: 'b', color: '#f08c00', name: '3kmctw701a4k' },
        { key: 'c', color: '#2b8a3e', name: 'cv0zqy89z9xo' },
      ],
      source: 'Tendances mensuelles pour visualisation (3 dossiers principaux)',
    },
    { type: 'heading', content: 'Analyse de la cohérence dépenses-volumes' },
    {
      type: 'bold',
      content:
        'Fournisseurs cohérents (96%) : La majorité des fournisseurs (21 650 sur 22 858) présentent des variations alignées entre dépenses et volumes d\'activité :',
    },
    {
      type: 'bullets',
      items: [
        '19 465 fournisseurs avec variations cohérentes (variance moyenne: 100%)',
        '2 185 fournisseurs avec fortes variations cohérentes (dépenses +642%, volume +253%)',
      ],
    },
    {
      type: 'bold',
      content: 'Incohérences détectées (1%) : 213 fournisseurs montrent des variations de dépenses non expliquées par les volumes :',
    },
    {
      type: 'bullets',
      items: [
        '132 hausses de prix anormales (variance dépenses: +4 258% en moyenne, volume: +12% seulement)',
        '81 baisses de prix (variance dépenses: -73%, volume: -34%)',
      ],
    },
    {
      type: 'barChart',
      title: 'Répartition des fournisseurs par statut de cohérence',
      data: barChartData,
      barKey: 'count',
      xKey: 'statut',
      color: '#1c7ed6',
    },
  ]
}

function _buildTableResponse(): ContentBlock[] {
  return [
    {
      type: 'bold',
      content:
        'Oui, plusieurs transactions d\'achats présentent des caractéristiques atypiques nécessitant une investigation approfondie.',
    },
    {
      type: 'text',
      content:
        'L\'analyse a identifié 847 transactions suspectes parmi les 3,4M d\'écritures du dossier, réparties en trois catégories principales :',
    },
    {
      type: 'heading',
      content: 'Transactions atypiques identifiées',
    },
    {
      type: 'table',
      caption: 'Résumé des anomalies détectées',
      headers: ['Type d\'anomalie', 'Nombre', 'Montant total', 'Risque'],
      rows: [
        ['Fractionnement de factures', '312', '4,2 M\u20ac', 'Élevé'],
        ['Doublons potentiels', '189', '2,8 M\u20ac', 'Élevé'],
        ['Achats fin de période', '215', '6,1 M\u20ac', 'Moyen'],
        ['Montants ronds suspects', '131', '1,5 M\u20ac', 'Faible'],
      ],
    },
    { type: 'heading', content: 'Détail : Fractionnement de factures' },
    {
      type: 'text',
      content:
        '312 séquences de factures fractionnées ont été détectées, principalement chez 45 fournisseurs récurrents. Le montant unitaire moyen est maintenu juste en-dessous du seuil de validation (4 999\u20ac pour un seuil de 5 000\u20ac).',
    },
    {
      type: 'table',
      caption: 'Top 5 fournisseurs – fractionnement',
      headers: ['Fournisseur', 'Nb factures', 'Montant moyen', 'Période'],
      rows: [
        ['FOURNI-2847', '28', '4 987\u20ac', 'Jan-Sep 2020'],
        ['FOURNI-1293', '22', '4 995\u20ac', 'Mar-Août 2020'],
        ['FOURNI-0567', '19', '4 890\u20ac', 'Fév-Jul 2020'],
        ['FOURNI-3421', '17', '4 950\u20ac', 'Jan-Jun 2020'],
        ['FOURNI-0891', '15', '4 975\u20ac', 'Avr-Sep 2020'],
      ],
    },
    {
      type: 'bullets',
      items: [
        'Recommandation : Vérifier les autorisations d\'achat et les seuils de délégation',
        'Priorité : 45 fournisseurs à investiguer en priorité',
        'Action suggérée : Créer un contrôle de suivi mensuel automatisé',
      ],
    },
  ]
}

function _buildInactiveResponse(): ContentBlock[] {
  return [
    {
      type: 'bold',
      content: 'Oui, 37 fournisseurs classés comme inactifs ont reçu des règlements durant la période analysée.',
    },
    {
      type: 'text',
      content:
        'Sur les 39 000 tiers référencés, 4 215 sont marqués comme inactifs (dernière facture datant de plus de 12 mois). Parmi ceux-ci, 37 ont reçu au moins un paiement entre le 01/10/2019 et le 30/09/2020.',
    },
    {
      type: 'table',
      caption: 'Fournisseurs inactifs ayant reçu des règlements',
      headers: ['Fournisseur', 'Dernière facture', 'Nb règlements', 'Montant total', 'Statut'],
      rows: [
        ['FOURNI-8834', '15/03/2018', '12', '156 200\u20ac', 'À investiguer'],
        ['FOURNI-2190', '22/07/2017', '8', '89 400\u20ac', 'À investiguer'],
        ['FOURNI-5567', '01/11/2018', '5', '42 100\u20ac', 'À investiguer'],
        ['FOURNI-9012', '30/06/2018', '4', '38 750\u20ac', 'En cours'],
        ['FOURNI-3345', '15/01/2019', '3', '27 300\u20ac', 'En cours'],
      ],
    },
    {
      type: 'bullets',
      items: [
        'Montant total des paiements aux fournisseurs inactifs : 892 450\u20ac',
        'Risque principal : Paiements frauduleux ou erreurs de routage bancaire',
        'Action recommandée : Vérification des coordonnées bancaires et rapprochement avec les bons de commande',
      ],
    },
  ]
}

function _buildDualActivityResponse(): ContentBlock[] {
  return [
    {
      type: 'bold',
      content: '156 tiers présentent une double activité fournisseur et client sur la période.',
    },
    {
      type: 'text',
      content:
        'L\'analyse croisée des comptes fournisseurs (401x) et clients (411x) identifie 156 tiers avec des flux dans les deux sens, totalisant 12,3M\u20ac en achats et 8,7M\u20ac en ventes.',
    },
    {
      type: 'table',
      caption: 'Top tiers à double activité par volume',
      headers: ['Tiers', 'Achats', 'Ventes', 'Solde net', 'Nb opérations'],
      rows: [
        ['TIERS-4521', '2 450 000\u20ac', '1 890 000\u20ac', '560 000\u20ac', '342'],
        ['TIERS-1287', '1 120 000\u20ac', '980 000\u20ac', '140 000\u20ac', '215'],
        ['TIERS-7834', '890 000\u20ac', '1 250 000\u20ac', '-360 000\u20ac', '178'],
        ['TIERS-0923', '670 000\u20ac', '540 000\u20ac', '130 000\u20ac', '124'],
        ['TIERS-5561', '430 000\u20ac', '780 000\u20ac', '-350 000\u20ac', '96'],
      ],
    },
    {
      type: 'bullets',
      items: [
        '23 tiers présentent un solde net proche de zéro (< 5%) — potentiel circuit de compensation',
        '8 tiers avec des opérations réciproques le même jour — risque d\'opérations fictives',
        'Recommandation : Audit approfondi des 23 tiers à solde net proche de zéro',
      ],
    },
  ]
}

const ecartsBarData = [
  { categorie: 'Solde > 50k\u20ac', count: 18 },
  { categorie: '10k-50k\u20ac', count: 47 },
  { categorie: '5k-10k\u20ac', count: 63 },
  { categorie: '1k-5k\u20ac', count: 129 },
  { categorie: '< 1k\u20ac', count: 285 },
]

const ecartsLineData = [
  { mois: 'Oct', ecart: 1.2, volume: 42 },
  { mois: 'Nov', ecart: 0.9, volume: 38 },
  { mois: 'Dec', ecart: 2.8, volume: 55 },
  { mois: 'Jan', ecart: 1.5, volume: 40 },
  { mois: 'Fev', ecart: 1.1, volume: 36 },
  { mois: 'Mar', ecart: 0.7, volume: 31 },
  { mois: 'Avr', ecart: 1.9, volume: 44 },
  { mois: 'Mai', ecart: 3.4, volume: 61 },
  { mois: 'Jun', ecart: 2.1, volume: 48 },
  { mois: 'Jul', ecart: 1.6, volume: 35 },
  { mois: 'Aou', ecart: 0.5, volume: 22 },
  { mois: 'Sep', ecart: 4.2, volume: 72 },
]

function _buildEcartsResponse(): ContentBlock[] {
  return [
    {
      type: 'bold',
      content:
        'Oui, des écarts significatifs ont été identifiés entre les soldes comptables fournisseurs et les balances auxiliaires pour 542 comptes sur 39 000 tiers analysés.',
    },
    {
      type: 'text',
      content:
        'Le rapprochement systématique entre les comptes collectifs fournisseurs (401x) et les balances auxiliaires individuelles révèle un écart global net de 2,34 M\u20ac. Si la majorité des comptes (98,6%) présentent des soldes parfaitement réconciliés, 542 comptes affichent des différences nécessitant une investigation.',
    },
    { type: 'heading', content: 'Synthèse des écarts détectés' },
    {
      type: 'table',
      caption: 'Répartition des écarts par nature',
      headers: ['Nature de l\'écart', 'Nb comptes', 'Montant total', 'Impact'],
      rows: [
        ['Écritures non lettrées', '218', '1 120 000\u20ac', 'Élevé'],
        ['Erreurs d\'imputation', '87', '456 000\u20ac', 'Élevé'],
        ['Écarts de change', '63', '312 000\u20ac', 'Moyen'],
        ['Avoirs non rapprochés', '112', '289 000\u20ac', 'Moyen'],
        ['Arrondis & ajustements', '62', '163 000\u20ac', 'Faible'],
      ],
    },
    { type: 'heading', content: 'Évolution des écarts sur la période' },
    {
      type: 'text',
      content:
        'Les écarts fluctuent au cours de l\'exercice, avec des pics notables en décembre (clôture semestrielle), mai (congés / retards de lettrage) et surtout en septembre (pré-clôture annuelle) où l\'écart atteint 4,2 M\u20ac avant régularisations.',
    },
    {
      type: 'lineChart',
      title: 'Évolution mensuelle des écarts (M\u20ac) et volume de comptes impactés',
      data: ecartsLineData,
      xKey: 'mois',
      yLabel: 'Écart (M\u20ac)',
      lines: [
        { key: 'ecart', color: '#e8590c', name: 'Écart (M\u20ac)' },
        { key: 'volume', color: '#1c7ed6', name: 'Nb comptes impactés' },
      ],
      source: 'Rapprochement collectif / auxiliaire — période 01/10/2019 au 30/09/2020',
    },
    { type: 'heading', content: 'Répartition des écarts par tranche de montant' },
    {
      type: 'barChart',
      title: 'Nombre de comptes par tranche d\'écart',
      data: ecartsBarData,
      barKey: 'count',
      xKey: 'categorie',
      color: '#e8590c',
    },
    { type: 'heading', content: 'Top 5 comptes fournisseurs avec les écarts les plus élevés' },
    {
      type: 'table',
      caption: 'Comptes à investiguer en priorité',
      headers: ['Compte', 'Fournisseur', 'Solde comptable', 'Solde auxiliaire', 'Écart', 'Cause probable'],
      rows: [
        ['401-78234', 'FOURNI-2847', '892 000\u20ac', '745 000\u20ac', '147 000\u20ac', 'Écritures non lettrées'],
        ['401-12098', 'FOURNI-5567', '1 230 000\u20ac', '1 098 000\u20ac', '132 000\u20ac', 'Erreur d\'imputation'],
        ['401-45612', 'FOURNI-9012', '567 000\u20ac', '452 000\u20ac', '115 000\u20ac', 'Avoirs en attente'],
        ['401-33890', 'FOURNI-1293', '345 000\u20ac', '248 000\u20ac', '97 000\u20ac', 'Écart de change'],
        ['401-67421', 'FOURNI-0891', '789 000\u20ac', '701 000\u20ac', '88 000\u20ac', 'Double comptabilisation'],
      ],
    },
    {
      type: 'bullets',
      items: [
        'Action prioritaire : Lettrage des 218 comptes avec écritures en suspens (1,12 M\u20ac)',
        'Recommandation : Mise en place d\'un contrôle mensuel automatisé de rapprochement collectif / auxiliaire',
        'Alerte : 87 erreurs d\'imputation détectées — révision des processus de saisie recommandée',
        'Délai suggéré : Régularisation avant clôture au 30/09/2020',
      ],
    },
  ]
}

void [_buildRichResponse, _buildTableResponse, _buildInactiveResponse, _buildDualActivityResponse, _buildEcartsResponse]

/* ------------------------------------------------------------------ */
/*  json-render catalog + registry for generative UI                   */
/* ------------------------------------------------------------------ */

const { registry: chatUiRegistry } = defineRegistry(chatUiCatalog, {
  components: {
    Stack: ({ props, children }) => <Stack gap={props.gap ?? 6}>{children}</Stack>,
    TextContent: ({ props }) => (
      <Text size={(props.size as 'xs' | 'sm' | 'md' | 'lg' | 'xl' | undefined) ?? 'sm'} fw={props.weight} style={{ lineHeight: 1.55 }}>
        {props.content}
      </Text>
    ),
    BulletList: ({ props }) => (
      <List size="sm" mt={4} mb={4} spacing={2} withPadding>
        {props.items.map((item) => (
          <List.Item key={item}>
            <Text size="xs" style={{ lineHeight: 1.55 }}>{item}</Text>
          </List.Item>
        ))}
      </List>
    ),
    DataTable: ({ props }) => {
      const stmtData = toStatementResponseFromTable(props.headers, props.rows)
      return (
        <Box mt="xs" mb="xs">
          {props.caption && <Text size="xs" c="dimmed" mb={4} fs="italic">{props.caption}</Text>}
          <GenieQueryVisualization data={stmtData} />
        </Box>
      )
    },
    LineChartViz: ({ props }) => (
      <Box mt="md" mb="sm">
        <Text size="xs" fw={600} mb="xs">{props.title}</Text>
        <Paper p="xs" withBorder radius="sm" style={{ backgroundColor: '#fff' }}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={props.data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
              <XAxis dataKey={props.xKey} tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
              <YAxis
                tick={{ fontSize: 10 }}
                axisLine={{ stroke: '#dee2e6' }}
                label={props.yLabel ? { value: props.yLabel, angle: -90, position: 'insideLeft', fontSize: 10, dx: -5 } : undefined}
              />
              <RechartTooltip contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: '#dee2e6' }} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" />
              {props.lines.map((line) => (
                <Line key={line.key} type="monotone" dataKey={line.key} stroke={line.color} strokeWidth={2} dot={false} name={line.name} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          {props.source && (
            <Text size="xs" c="dimmed" ta="right" mt={4} fs="italic">
              {'Source : ' + props.source}
            </Text>
          )}
        </Paper>
      </Box>
    ),
    BarChartViz: ({ props }) => (
      <Box mt="md" mb="sm">
        <Text size="xs" fw={600} mb="xs">{props.title}</Text>
        <Paper p="xs" withBorder radius="sm" style={{ backgroundColor: '#fff' }}>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={props.data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
              <XAxis dataKey={props.xKey} tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
              <YAxis tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
              <RechartTooltip contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: '#dee2e6' }} />
              <Bar dataKey={props.barKey} fill={props.color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Paper>
      </Box>
    ),
    QueryDataTable: ({ props }) => (
      <Box mt="xs" mb="xs">
        {props.caption && <Text size="xs" c="dimmed" mb={4} fs="italic">{props.caption}</Text>}
        <AppKitDataTable
          queryKey={props.queryKey}
          parameters={props.parameters ?? {}}
          filterColumn={props.filterColumn}
          filterPlaceholder={props.filterPlaceholder}
          pageSize={props.pageSize ?? 10}
        />
      </Box>
    ),
    FormPanel: ({ props, children }) => (
      <Paper p="sm" withBorder radius="md" style={{ backgroundColor: '#ffffff' }}>
        {(props.title || props.description) && (
          <Box mb="sm">
            {props.title && <Text size="sm" fw={600}>{props.title}</Text>}
            {props.description && <Text size="xs" c="dimmed" mt={2}>{props.description}</Text>}
          </Box>
        )}
        <Stack gap="sm">{children}</Stack>
      </Paper>
    ),
    SelectInputField: ({ props }) => (
      <Select
        label={props.label}
        placeholder={props.placeholder}
        data={props.options}
        value={props.value ?? null}
        required={props.required}
        disabled={props.disabled}
        readOnly
        size="sm"
        radius="sm"
      />
    ),
    TextInputField: ({ props }) => (
      <TextInput
        label={props.label}
        placeholder={props.placeholder}
        value={props.value ?? ''}
        required={props.required}
        disabled={props.disabled}
        readOnly
        size="sm"
        radius="sm"
      />
    ),
    NumberInputField: ({ props }) => (
      <NumberInput
        label={props.label}
        placeholder={props.placeholder}
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        required={props.required}
        disabled={props.disabled}
        readOnly
        size="sm"
        radius="sm"
      />
    ),
    ToggleField: ({ props }) => (
      <Switch
        label={props.label}
        description={props.description}
        checked={Boolean(props.checked)}
        disabled={props.disabled ?? true}
        readOnly
        color="teal"
        size="md"
      />
    ),
    WorkflowRuleBuilder: ({ props }) => {
      const operators = props.operators ?? [
        'is equal to',
        'is not equal',
        'contains',
        'superior to',
        'inferior to',
        'strictly inferior',
      ]

      return (
        <Paper p="sm" withBorder radius="md" style={{ backgroundColor: '#ffffff' }}>
          {(props.title || props.description) && (
            <Box mb="sm">
              {props.title && <Text size="sm" fw={600}>{props.title}</Text>}
              {props.description && <Text size="xs" c="dimmed" mt={2}>{props.description}</Text>}
            </Box>
          )}

          <Stack gap="sm">
            {props.rules.map((rule, index) => {
              const fieldOptions = props.fields.map((field) => ({
                value: field.value,
                label: field.label,
              }))
              const ruleKey = [rule.field ?? 'field', rule.operator ?? 'operator', rule.valueText ?? '', String(rule.valueNumber ?? '')]
                .join('|') || `rule-${index}`

              return (
                <Paper key={ruleKey} p="xs" radius="sm" style={{ backgroundColor: '#f8f9fa' }}>
                  <Group grow align="flex-start">
                    <Select
                      label="Champ"
                      data={fieldOptions}
                      value={rule.field ?? null}
                      readOnly
                      size="xs"
                      radius="sm"
                    />
                    <Select
                      label="Règle"
                      data={operators.map((operator) => ({ value: operator, label: operator }))}
                      value={rule.operator ?? null}
                      readOnly
                      size="xs"
                      radius="sm"
                    />
                    {rule.valueType === 'number' ? (
                      <NumberInput
                        label="Valeur"
                        value={rule.valueNumber}
                        readOnly
                        size="xs"
                        radius="sm"
                      />
                    ) : (
                      <TextInput
                        label="Valeur"
                        value={rule.valueText ?? ''}
                        readOnly
                        size="xs"
                        radius="sm"
                      />
                    )}
                  </Group>
                </Paper>
              )
            })}
          </Stack>
        </Paper>
      )
    },
    ChartProposal: ({ props }) => <ChartProposalPanel proposals={props.proposals} title={props.title} description={props.description} />,
  },
})

/**
 * Convert plain headers + rows (from catalog DataTable or legacy blocks)
 * into a GenieStatementResponse so GenieQueryVisualization can render
 * with auto chart inference + table tabs.
 */
function toStatementResponseFromTable(
  headers: string[],
  rows: string[][],
): GenieStatementResponse {
  return {
    manifest: {
      schema: {
        columns: headers.map((name) => ({
          name,
          type_name: 'STRING',
          type_text: 'STRING',
          position: 0,
        })),
      },
    },
    result: {
      data_array: rows,
    },
  } as GenieStatementResponse
}

/* ------------------------------------------------------------------ */
/*  ChartProposalPanel — interactive chart type selector                */
/* ------------------------------------------------------------------ */

interface ChartProposalItem {
  chartType: string
  label: string
  rationale: string
}

interface ChartProposalApiResponse {
  chartProposals: ChartProposalItem[]
  recommendation: string | null
  analysisNote?: string
  traceId?: string
}

const CHART_TYPE_ICONS: Record<string, string> = {
  bar: '📊',
  line: '📈',
  area: '📉',
  donut: '🍩',
  radar: '🕸️',
}

function ChartProposalPanel({
  proposals,
  title,
  description,
  selected,
  onSelect,
}: {
  proposals: ChartProposalItem[]
  title?: string
  description?: string
  selected?: string | null
  onSelect?: (chartType: string) => void
}) {
  if (!proposals || proposals.length === 0) return null

  return (
    <Paper p="sm" withBorder radius="md" mt="xs" mb="xs" style={{ backgroundColor: '#fefefe' }}>
      {title && <Text size="sm" fw={600} mb={4}>{title}</Text>}
      {description && <Text size="xs" c="dimmed" mb="sm">{description}</Text>}

      <Group gap="sm" grow>
        {proposals.map((proposal) => {
          const isSelected = selected === proposal.chartType
          return (
            <Paper
              key={proposal.chartType}
              p="sm"
              radius="sm"
              withBorder
              style={{
                cursor: 'pointer',
                borderColor: isSelected ? '#228be6' : '#dee2e6',
                backgroundColor: isSelected ? '#e7f5ff' : '#fff',
                transition: 'all 150ms ease',
              }}
              onClick={() => onSelect?.(proposal.chartType)}
            >
              <Group gap={6} mb={4}>
                <Text size="lg">{CHART_TYPE_ICONS[proposal.chartType] ?? '📊'}</Text>
                <Text size="xs" fw={600}>{proposal.label}</Text>
              </Group>
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.4 }}>
                {proposal.rationale}
              </Text>
              {isSelected && (
                <Badge size="xs" variant="light" color="blue" mt={6}>
                  Sélectionné
                </Badge>
              )}
            </Paper>
          )
        })}
      </Group>
    </Paper>
  )
}

/* ------------------------------------------------------------------ */
/*  Chart data transformation + rendering from GenieStatementResponse  */
/* ------------------------------------------------------------------ */

const CHART_COLORS = ['#228be6', '#40c057', '#fab005', '#fa5252', '#7950f2', '#15aabf', '#e64980', '#82c91e']

interface ChartDataRow {
  [key: string]: string | number
}

/**
 * Transform GenieStatementResponse into Recharts-friendly data.
 * Returns column metadata + converted rows (numeric columns parsed as numbers).
 */
function transformStatementToChartData(statement: GenieStatementResponse): {
  columns: { name: string; type: string }[]
  categoryColumn: string | null
  numericColumns: string[]
  data: ChartDataRow[]
} {
  const columns = (statement.manifest?.schema?.columns ?? []).map((col) => ({
    name: col.name,
    type: col.type_name ?? 'STRING',
  }))
  const rawRows = statement.result?.data_array ?? []

  const numericTypes = new Set(['INT', 'INTEGER', 'BIGINT', 'LONG', 'SHORT', 'TINYINT', 'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'NUMBER'])

  // Detect numeric columns: use type metadata, but also check actual values
  const numericColumns: string[] = []
  const stringColumns: string[] = []
  for (const col of columns) {
    const upperType = (col.type ?? 'STRING').toUpperCase()
    if (numericTypes.has(upperType) || upperType.startsWith('DECIMAL')) {
      numericColumns.push(col.name)
    } else {
      // Known string-like types should never be promoted to numeric,
      // even if their values look like numbers (e.g. years: "2020", "2021")
      const knownStringTypes = new Set(['STRING', 'VARCHAR', 'CHAR', 'DATE', 'TIMESTAMP', 'BOOLEAN', 'BINARY', 'ARRAY', 'MAP', 'STRUCT', 'INTERVAL'])
      if (knownStringTypes.has(upperType)) {
        stringColumns.push(col.name)
      } else {
        // Unknown/ambiguous type — sample first few rows to decide
        const colIdx = columns.findIndex((c) => c.name === col.name)
        const sample = rawRows.slice(0, 10).map((row) => row[colIdx])
        const allNumeric = sample.length > 0 && sample.every((v) => v != null && v !== '' && !isNaN(Number(v)))
        if (allNumeric) {
          numericColumns.push(col.name)
        } else {
          stringColumns.push(col.name)
        }
      }
    }
  }

  const categoryColumn = stringColumns[0] ?? null

  const data: ChartDataRow[] = rawRows.map((row) => {
    const obj: ChartDataRow = {}
    columns.forEach((col, idx) => {
      const raw = row[idx]
      if (numericColumns.includes(col.name)) {
        obj[col.name] = raw != null && raw !== '' ? Number(raw) : 0
      } else {
        obj[col.name] = raw ?? ''
      }
    })
    return obj
  })

  return { columns, categoryColumn, numericColumns, data }
}

/**
 * Renders the selected chart type using Recharts, consuming Genie statement data.
 */
function SelectedChartRenderer({
  chartType,
  statement,
}: {
  chartType: string
  statement: GenieStatementResponse
}) {
  const { categoryColumn, numericColumns, data } = useMemo(
    () => transformStatementToChartData(statement),
    [statement],
  )

  if (data.length === 0 || numericColumns.length === 0) {
    return (
      <Text size="xs" c="dimmed" ta="center" mt="xs">
        Données insuffisantes pour générer un graphique.
      </Text>
    )
  }

  const xKey = categoryColumn ?? numericColumns[0]
  const valueKeys = categoryColumn ? numericColumns : numericColumns.slice(1)

  if (valueKeys.length === 0) {
    return (
      <Text size="xs" c="dimmed" ta="center" mt="xs">
        Pas assez de colonnes numériques pour ce type de graphique.
      </Text>
    )
  }

  if (chartType === 'bar') {
    return (
      <Paper p="xs" withBorder radius="sm" mt="sm" style={{ backgroundColor: '#fff' }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
            <YAxis tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
            <RechartTooltip contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: '#dee2e6' }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {valueKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Paper>
    )
  }

  if (chartType === 'line') {
    return (
      <Paper p="xs" withBorder radius="sm" mt="sm" style={{ backgroundColor: '#fff' }}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
            <YAxis tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
            <RechartTooltip contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: '#dee2e6' }} />
            <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" />
            {valueKeys.map((key, i) => (
              <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Paper>
    )
  }

  if (chartType === 'area') {
    return (
      <Paper p="xs" withBorder radius="sm" mt="sm" style={{ backgroundColor: '#fff' }}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
            <YAxis tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
            <RechartTooltip contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: '#dee2e6' }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {valueKeys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </Paper>
    )
  }

  if (chartType === 'donut') {
    // For donut/pie, use the first numeric column as value and category column as name
    const valueKey = valueKeys[0]
    const pieData = data.map((row) => ({
      name: String(row[xKey] ?? ''),
      value: Number(row[valueKey]) || 0,
    }))
    return (
      <Paper p="xs" withBorder radius="sm" mt="sm" style={{ backgroundColor: '#fff' }}>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={90}
              paddingAngle={3}
              dataKey="value"
              nameKey="name"
              label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
              labelLine={{ strokeWidth: 1 }}
              style={{ fontSize: 10 }}
            >
              {pieData.map((entry) => (
                <Cell key={`${entry.name}-${entry.value}`} fill={CHART_COLORS[pieData.indexOf(entry) % CHART_COLORS.length]} />
              ))}
            </Pie>
            <RechartTooltip contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: '#dee2e6' }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      </Paper>
    )
  }

  if (chartType === 'radar') {
    // For radar, each row is a subject and each numeric column is a metric
    return (
      <Paper p="xs" withBorder radius="sm" mt="sm" style={{ backgroundColor: '#fff' }}>
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke="#e9ecef" />
            <PolarAngleAxis dataKey={xKey} tick={{ fontSize: 10 }} />
            <PolarRadiusAxis tick={{ fontSize: 9 }} />
            {valueKeys.map((key, i) => (
              <Radar
                key={key}
                name={key}
                dataKey={key}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                fillOpacity={0.15}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <RechartTooltip contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: '#dee2e6' }} />
          </RadarChart>
        </ResponsiveContainer>
      </Paper>
    )
  }

  // Fallback: bar chart
  return (
    <Paper p="xs" withBorder radius="sm" mt="sm" style={{ backgroundColor: '#fff' }}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
          <YAxis tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
          <RechartTooltip contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: '#dee2e6' }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {valueKeys.map((key, i) => (
            <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Paper>
  )
}

async function requestChartProposal(params: {
  prompt: string
  statementResponse: unknown
}): Promise<ChartProposalApiResponse | null> {
  try {
    const response = await fetch('/api/genUiDspy/chart-proposal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.prompt,
        statementResponse: params.statementResponse,
      }),
    })
    if (!response.ok) return null
    return (await response.json()) as ChartProposalApiResponse
  } catch {
    return null
  }
}

function buildGenerativeUiSpec(blocks: ContentBlock[]): GenericUiSpec | null {
  if (blocks.length === 0) return null

  const elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }> = {}
  const rootId = 'root'

  elements[rootId] = {
    type: 'Stack',
    props: { gap: 6 },
    children: [],
  }

  blocks.forEach((block, index) => {
    const id = `block-${index}`
    let element: { type: string; props: Record<string, unknown>; children: string[] } | null = null

    if (block.type === 'text') {
      element = { type: 'TextContent', props: { content: block.content, size: 'sm' }, children: [] }
    } else if (block.type === 'bold') {
      element = { type: 'TextContent', props: { content: block.content, size: 'sm', weight: 700 }, children: [] }
    } else if (block.type === 'heading') {
      element = { type: 'TextContent', props: { content: block.content, size: 'sm', weight: 700 }, children: [] }
    } else if (block.type === 'bullets') {
      element = { type: 'BulletList', props: { items: block.items }, children: [] }
    } else if (block.type === 'table') {
      element = {
        type: 'DataTable',
        props: { caption: block.caption, headers: block.headers, rows: block.rows },
        children: [],
      }
    } else if (block.type === 'lineChart') {
      element = {
        type: 'LineChartViz',
        props: {
          title: block.title,
          data: block.data,
          lines: block.lines,
          xKey: block.xKey,
          yLabel: block.yLabel,
          source: block.source,
        },
        children: [],
      }
    } else if (block.type === 'barChart') {
      element = {
        type: 'BarChartViz',
        props: {
          title: block.title,
          data: block.data,
          barKey: block.barKey,
          xKey: block.xKey,
          color: block.color,
        },
        children: [],
      }
    }

    if (element) {
      elements[id] = element
      elements[rootId].children.push(id)
    }
  })

  return {
    root: rootId,
    elements,
  } as GenericUiSpec
}

function isGenericUiSpec(value: unknown): value is GenericUiSpec {
  if (!value || typeof value !== 'object') return false
  const spec = value as { root?: unknown; elements?: unknown }
  return typeof spec.root === 'string' && Boolean(spec.elements && typeof spec.elements === 'object')
}

const GENUI_MAX_ROWS = 100

function _truncateStatementResult(value: unknown): unknown {
  const statement = toGenieStatementResponse(value)
  if (!statement?.result?.data_array) return value
  const full = statement.result.data_array
  if (full.length <= GENUI_MAX_ROWS) return statement
  return {
    ...statement,
    result: {
      ...statement.result,
      data_array: full.slice(0, GENUI_MAX_ROWS),
      _truncated: true,
      _total_rows: full.length,
    },
  }
}

function buildGenieResultPayload(message: Message): unknown {
  const queryResults = message.queryResults
    ? Object.fromEntries(
        Array.from(message.queryResults.entries()).map(([k, v]) => [k, _truncateStatementResult(v)])
      )
    : undefined

  // Keep only lightweight attachment metadata (no inline blobs)
  const attachments = (message.attachments ?? []).map((a) => ({
    attachmentId: a.attachmentId,
    query: a.query
      ? { title: a.query.title, description: a.query.description }
      : undefined,
  }))

  return { attachments, queryResults }
}

async function generateUiSpecForMessage(params: {
  prompt: string
  genieResult: unknown
}): Promise<GenericUiSpec | null> {
  try {
    const response = await fetch('/api/genUiDspy/spec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.prompt,
        genieResult: params.genieResult,
      }),
    })

    if (!response.ok) return null
    const parsed = (await response.json()) as GenerateSpecApiResponse
    if (!isGenericUiSpec(parsed?.spec)) return null
    return parsed.spec
  } catch {
    return null
  }
}

async function runSupervisorPreflight(params: {
  prompt: string
  conversationContext: SupervisorConversationContext
}): Promise<SupervisorApiResponse | null> {
  try {
    const response = await fetch('/api/genUiDspy/supervisor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.prompt,
        conversationContext: params.conversationContext,
      }),
    })

    if (!response.ok) {
      // Try to parse the error body — the server may return a valid
      // SupervisorApiResponse even on 502 (e.g. decision:'error').
      try {
        const errorBody = (await response.json()) as SupervisorApiResponse
        if (errorBody && errorBody.decision) return errorBody
      } catch { /* body not parseable — fall through */ }
      return null
    }
    return (await response.json()) as SupervisorApiResponse
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  Helper: serialize blocks to copyable plain text                    */
/* ------------------------------------------------------------------ */

function blocksToPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'text':
        case 'bold':
          return b.content
        case 'heading':
          return `\n${b.content}`
        case 'bullets':
          return b.items.map((i) => `  \u2022 ${i}`).join('\n')
        case 'table': {
          const header = b.headers.join(' | ')
          const sep = b.headers.map(() => '---').join(' | ')
          const rows = b.rows.map((r) => r.join(' | ')).join('\n')
          return [b.caption, header, sep, rows].filter(Boolean).join('\n')
        }
        case 'lineChart':
        case 'barChart':
          return `[Graphique : ${b.title}]`
        default:
          return ''
      }
    })
    .join('\n')
}

/* ------------------------------------------------------------------ */
/*  Memoised message content (avoids re-running fallback spec on       */
/*  every parent render)                                               */
/* ------------------------------------------------------------------ */

const MessageContent = memo(function MessageContent({
  msg,
  messageId,
  generatedSpec,
  registry,
  chartProposals,
  selectedChart,
  onChartSelect,
}: {
  msg: Message
  messageId: string
  generatedSpec: GenericUiSpec | undefined
  registry: typeof chatUiRegistry
  chartProposals?: ChartProposalItem[]
  selectedChart?: string | null
  onChartSelect?: (messageId: string, chartType: string) => void
}) {
  const fallbackSpec = useMemo(
    () => (msg.blocks && msg.blocks.length > 0 ? buildGenerativeUiSpec(msg.blocks) : null),
    [msg.blocks]
  )

  const handleSelect = useCallback(
    (chartType: string) => onChartSelect?.(messageId, chartType),
    [messageId, onChartSelect],
  )

  // Extract the first Genie statement from attachments for chart rendering
  const firstStatement = useMemo(() => {
    if (!msg.attachments || !msg.queryResults) return null
    for (const attachment of msg.attachments) {
      if (!attachment.attachmentId) continue
      const queryData = msg.queryResults.get(attachment.attachmentId)
      const statement = toGenieStatementResponse(queryData)
      if (statement && statement.result?.data_array?.length > 0) return statement
    }
    return null
  }, [msg.attachments, msg.queryResults])

  /* Plugin-generated spec available → render via json-render */
  if (generatedSpec) {
    return (
      <>
        <JSONUIProvider registry={registry}>
          <Renderer spec={generatedSpec} registry={registry} />
        </JSONUIProvider>
        {chartProposals && chartProposals.length > 0 && (
          <ChartProposalPanel
            proposals={chartProposals}
            title="Suggestions de visualisation"
            description="Le superviseur propose ces types de graphiques pour vos résultats. Choisissez celui qui vous convient."
            selected={selectedChart}
            onSelect={handleSelect}
          />
        )}
        {selectedChart && firstStatement && (
          <SelectedChartRenderer chartType={selectedChart} statement={firstStatement} />
        )}
      </>
    )
  }

  /* Fallback: legacy block-based + Genie query table rendering */
  return (
    <>
      {msg.content && (
        <Text size="sm" style={{ lineHeight: 1.55 }}>
          {msg.content}
        </Text>
      )}
      {msg.blocks && msg.blocks.length > 0 && (
        <Box>
          {fallbackSpec ? (
            <JSONUIProvider registry={registry}>
              <Renderer spec={fallbackSpec} registry={registry} />
            </JSONUIProvider>
          ) : (
            msg.blocks.map((block) => (
              <RenderBlock key={JSON.stringify(block)} block={block} />
            ))
          )}
        </Box>
      )}
      {msg.attachments
        ?.filter((attachment) => Boolean(attachment.attachmentId))
        .map((attachment) => {
          const attachmentId = attachment.attachmentId
          if (!attachmentId || !msg.queryResults) return null

          const queryData = msg.queryResults.get(attachmentId)
          const statement = toGenieStatementResponse(queryData)
          if (!statement) return null

          return (
            <Box key={attachmentId} mt="sm">
              {attachment.query?.title && (
                <Text size="xs" fw={600} mb="xs">{attachment.query.title}</Text>
              )}
              <GenieQueryVisualization data={statement} />
            </Box>
          )
        })}
      {chartProposals && chartProposals.length > 0 && !generatedSpec && (
        <ChartProposalPanel
          proposals={chartProposals}
          title="Suggestions de visualisation"
          description="Le superviseur propose ces types de graphiques pour vos résultats. Choisissez celui qui vous convient."
          selected={selectedChart}
          onSelect={handleSelect}
        />
      )}
      {selectedChart && firstStatement && !generatedSpec && (
        <SelectedChartRenderer chartType={selectedChart} statement={firstStatement} />
      )}
    </>
  )
})

/* ------------------------------------------------------------------ */
/*  Copy button                                                        */
/* ------------------------------------------------------------------ */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard not available */
    }
  }

  return (
    <Tooltip label={copied ? 'Copié !' : 'Copier la réponse'} position="top" withArrow>
      <ActionIcon
        variant="subtle"
        color={copied ? 'teal' : 'gray'}
        size="xs"
        onClick={() => {
          void handleCopy()
        }}
        aria-label="Copier la réponse"
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </ActionIcon>
    </Tooltip>
  )
}

/* ------------------------------------------------------------------ */
/*  Block renderers                                                    */
/* ------------------------------------------------------------------ */

function RenderBlock({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return (
        <Text size="sm" style={{ lineHeight: 1.6 }} mt={4}>
          {block.content}
        </Text>
      )
    case 'bold':
      return (
        <Text size="sm" fw={700} style={{ lineHeight: 1.6 }} mt={8}>
          {block.content}
        </Text>
      )
    case 'heading':
      return (
        <Text size="sm" fw={700} mt="md" mb={4} c="dark" style={{ lineHeight: 1.5 }}>
          {block.content}
        </Text>
      )
    case 'bullets':
      return (
        <List size="sm" mt={4} mb={4} spacing={2} withPadding>
          {block.items.map((item) => (
            <List.Item key={item}>
              <Text size="xs" style={{ lineHeight: 1.55 }}>{item}</Text>
            </List.Item>
          ))}
        </List>
      )
    case 'table': {
      const stmtData = toStatementResponseFromTable(block.headers, block.rows)
      return (
        <Box mt="xs" mb="xs">
          {block.caption && (
            <Text size="xs" c="dimmed" mb={4} fs="italic">{block.caption}</Text>
          )}
          <GenieQueryVisualization data={stmtData} />
        </Box>
      )
    }
    case 'lineChart':
      return (
        <Box mt="md" mb="sm">
          <Text size="xs" fw={600} mb="xs">{block.title}</Text>
          <Paper p="xs" withBorder radius="sm" style={{ backgroundColor: '#fff' }}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={block.data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis
                  dataKey={block.xKey}
                  tick={{ fontSize: 10 }}
                  axisLine={{ stroke: '#dee2e6' }}
                  label={{ value: 'Mois', position: 'insideBottomRight', offset: -5, fontSize: 10 }}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  axisLine={{ stroke: '#dee2e6' }}
                  label={
                    block.yLabel
                      ? { value: block.yLabel, angle: -90, position: 'insideLeft', fontSize: 10, dx: -5 }
                      : undefined
                  }
                />
                <RechartTooltip
                  contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: '#dee2e6' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 10 }}
                  iconType="plainline"
                />
                {block.lines.map((line) => (
                  <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    stroke={line.color}
                    strokeWidth={2}
                    dot={false}
                    name={line.name}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            {block.source && (
              <Text size="xs" c="dimmed" ta="right" mt={4} fs="italic">
                {'Source : ' + block.source}
              </Text>
            )}
          </Paper>
        </Box>
      )
    case 'barChart':
      return (
        <Box mt="md" mb="sm">
          <Text size="xs" fw={600} mb="xs">{block.title}</Text>
          <Paper p="xs" withBorder radius="sm" style={{ backgroundColor: '#fff' }}>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={block.data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey={block.xKey} tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
                <YAxis tick={{ fontSize: 10 }} axisLine={{ stroke: '#dee2e6' }} />
                <RechartTooltip contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: '#dee2e6' }} />
                <Bar dataKey={block.barKey} fill={block.color} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Box>
      )
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/*  Genie query table (dynamic columns + per-column filters)           */
/* ------------------------------------------------------------------ */

function toGenieStatementResponse(data: unknown): GenieStatementResponse | null {
  if (!data || typeof data !== 'object') return null

  const maybeStatement = data as Partial<GenieStatementResponse>
  const hasManifest = Boolean(maybeStatement.manifest?.schema?.columns)
  const hasResult = Boolean(maybeStatement.result?.data_array)
  if (hasManifest && hasResult) return maybeStatement as GenieStatementResponse

  const wrapped = (data as { statement_response?: unknown }).statement_response
  if (wrapped && typeof wrapped === 'object') {
    const nested = wrapped as Partial<GenieStatementResponse>
    if (nested.manifest?.schema?.columns && nested.result?.data_array) {
      return nested as GenieStatementResponse
    }
  }

  return null
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export interface SavedControl {
  id: string
  name: string
  description: string
  results: string
  rubriqueId: string
}

const RUBRIQUES = [
  { value: '01', label: '01. CARTOGRAPHIES GENERALES' },
  { value: '02', label: "02. COMPLETUDE DE L'INFORMATION COMPTABLE" },
  { value: '03', label: '03. CONFORMITE COMPTABLE' },
  { value: '04', label: '04. OPERATIONS DIVERSES' },
  { value: '05', label: '05. ACHATS' },
  { value: '06', label: '06. VENTES' },
  { value: '07', label: '07. TVA' },
  { value: '08', label: '08. RESULTAT ET IS' },
  { value: '09', label: '09. ECRITURES COMPLEXES' },
]

/* AI-recommended rubrique for each known suggestion */
const suggestedRubriqueMap: Record<number, string> = {
  0: '05', // Achats
  1: '05', // Achats
  2: '05', // Achats
  3: '04', // Operations diverses
  4: '03', // Conformite comptable
}

/* Keywords to infer rubrique from free text input */
function inferRubriqueFromText(text: string): string {
  const lower = text.toLowerCase()
  if (lower.includes('achat') || lower.includes('fournisseur') || lower.includes('facture')) return '05'
  if (lower.includes('vente') || lower.includes('client') || lower.includes('chiffre d\'affaires')) return '06'
  if (lower.includes('tva') || lower.includes('taxe')) return '07'
  if (lower.includes('resultat') || lower.includes('impot') || lower.includes('is ')) return '08'
  if (lower.includes('ecriture') || lower.includes('complexe') || lower.includes('ajustement')) return '09'
  if (lower.includes('completude') || lower.includes('information comptable')) return '02'
  if (lower.includes('conformite') || lower.includes('solde') || lower.includes('balance')) return '03'
  if (lower.includes('operation') || lower.includes('diverse') || lower.includes('tiers')) return '04'
  if (lower.includes('cartographie') || lower.includes('volumetrie') || lower.includes('ratio')) return '01'
  return '01'
}

/* ------------------------------------------------------------------ */
/*  Team controls data & panel                                         */
/* ------------------------------------------------------------------ */

interface TeamControl {
  id: string
  name: string
  rubriqueId: string
  createdBy: string
  createdAt: string
  status: 'brouillon' | 'validé' | 'en revue'
  description: string
  results: string
}

const teamControls: TeamControl[] = [
  {
    id: 'tc-001',
    name: 'Détection des doublons de factures fournisseurs',
    rubriqueId: '05',
    createdBy: 'S. Dupont',
    createdAt: '28/02/2026',
    status: 'validé',
    description:
      'Identification automatique des factures fournisseurs présentant des montants, dates et références identiques ou très proches, susceptibles de constituer des doublons de saisie ou de paiement.',
    results:
      '47 paires de factures potentiellement en doublon détectées sur 537 comptes fournisseurs. Montant total exposé : 1,23 M\u20ac. 12 doublons confirmés après analyse.',
  },
  {
    id: 'tc-002',
    name: 'Analyse des écritures de clôture hors cycle normal',
    rubriqueId: '09',
    createdBy: 'A. Bernard',
    createdAt: '01/03/2026',
    status: 'en revue',
    description:
      'Contrôle des écritures comptables passées en dehors des périodes habituelles de clôture (week-ends, jours fériés, après 20h), pouvant signaler des régularisations tardives ou des manipulations.',
    results:
      '89 écritures atypiques identifiées, dont 23 passées un dimanche et 14 après 22h. Montant cumulé : 3,4 M\u20ac. Principalement sur les comptes 6xx et 7xx.',
  },
  {
    id: 'tc-003',
    name: 'Vérification de la séquence de numérotation des factures de vente',
    rubriqueId: '06',
    createdBy: 'R. Martin',
    createdAt: '02/03/2026',
    status: 'validé',
    description:
      'Contrôle de la continuité et de la séquence des numéros de factures émises pour détecter des ruptures, des numéros manquants ou des anomalies dans la chaîne de facturation.',
    results:
      '15 ruptures de séquence détectées sur 12 847 factures analysées. 3 plages de numéros manquants identifiées (FA-2020-4521 à FA-2020-4525). Aucun impact sur la cohérence du CA déclaré.',
  },
  {
    id: 'tc-004',
    name: 'Contrôle de cohérence TVA collectée vs TVA déclarée',
    rubriqueId: '07',
    createdBy: 'M. Leroy',
    createdAt: '03/03/2026',
    status: 'brouillon',
    description:
      'Rapprochement entre la TVA collectée sur les ventes comptabilisées et les montants déclarés sur les CA3 mensuelles, pour identifier les écarts de déclaration ou les erreurs de taux.',
    results:
      'Écart global de 45 230\u20ac entre TVA collectée comptable (8,92 M\u20ac) et TVA déclarée (8,87 M\u20ac). 3 mois présentent des écarts > 10 000\u20ac. Cause principale : erreurs de taux sur 127 opérations intracommunautaires.',
  },
  {
    id: 'tc-005',
    name: 'Identification des provisions sans justificatif ni mouvement',
    rubriqueId: '08',
    createdBy: 'C. Moreau',
    createdAt: '03/03/2026',
    status: 'en revue',
    description:
      'Revue des comptes de provisions (15xx) pour identifier les dotations non reprises depuis plus de 12 mois, sans mouvement ni justificatif attaché, pouvant signaler des provisions obsolètes ou injustifiées.',
    results:
      '18 provisions identifiées sans mouvement depuis > 12 mois pour un total de 2,1 M\u20ac. 7 provisions datent de N-2 sans justificatif. Recommandation : revue avec le DAF pour reprise ou justification.',
  },
]

const statusColors: Record<string, string> = {
  'brouillon': 'gray',
  'validé': 'green',
  'en revue': 'orange',
}

function TeamControlsPanel({
  onBack,
  onPublish,
}: {
  onBack: () => void
  onPublish: (controls: TeamControl[]) => void
}) {
  const [search, setSearch] = useState('')
  const [filterRubrique, setFilterRubrique] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [published, setPublished] = useState(false)

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

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((tc) => tc.id)))
    }
  }

  const handlePublish = () => {
    const toPublish = teamControls.filter((tc) => selected.has(tc.id))
    onPublish(toPublish)
    setPublished(true)
    setTimeout(() => setPublished(false), 2500)
    setSelected(new Set())
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box
        px="md"
        py="sm"
        style={{ borderBottom: '1px solid #e9ecef', backgroundColor: '#fff', flexShrink: 0 }}
      >
        <Group justify="space-between" mb="xs">
          <Group gap="xs">
            <ThemeIcon
              size="sm"
              radius="sm"
              style={{ background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}
            >
              <IconListDetails size={14} color="#fff" />
            </ThemeIcon>
            <Text size="sm" fw={600}>{"Contrôles de l'équipe"}</Text>
          </Group>
          <Button size="xs" variant="subtle" color="gray" onClick={onBack} leftSection={<IconX size={14} />}>
            Retour
          </Button>
        </Group>
        {/* Search + Filter */}
        <Group gap="xs" wrap="nowrap">
          <TextInput
            placeholder="Rechercher un contrôle..."
            size="xs"
            radius="sm"
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Select
            placeholder="Rubrique"
            size="xs"
            radius="sm"
            clearable
            leftSection={<IconFilter size={14} />}
            data={RUBRIQUES}
            value={filterRubrique}
            onChange={setFilterRubrique}
            w={220}
          />
        </Group>
      </Box>

      {/* Table */}
      <ScrollArea style={{ flex: 1 }}>
        <Box px="md" py="xs">
          <Table
            highlightOnHover
            striped
            withTableBorder
            withColumnBorders={false}
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
                    size="xs"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    indeterminate={selected.size > 0 && selected.size < filtered.length}
                    onChange={toggleAll}
                    aria-label="Tout sélectionner"
                    color="teal"
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
                    style={{
                      cursor: 'pointer',
                      backgroundColor: selected.has(tc.id) ? '#f0fdf4' : undefined,
                    }}
                    onClick={() => toggleSelect(tc.id)}
                  >
                    <Table.Td>
                      <Checkbox
                        size="xs"
                        checked={selected.has(tc.id)}
                        onChange={() => toggleSelect(tc.id)}
                        color="teal"
                        aria-label={`Sélectionner ${tc.name}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap" align="flex-start">
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" fw={500} style={{ lineHeight: 1.4 }}>
                            {tc.name}
                          </Text>
                          <Text size="xs" c="dimmed" lineClamp={2} style={{ lineHeight: 1.4 }}>
                            {tc.description}
                          </Text>
                        </Box>
                        <Tooltip label={"Généré par l'IA"} withArrow position="top">
                          <Badge
                            size="xs"
                            color="teal"
                            variant="light"
                            leftSection={<IconSparkles size={9} />}
                            styles={{ root: { textTransform: 'none', flexShrink: 0 } }}
                          >
                            IA
                          </Badge>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        variant="light"
                        color="gray"
                        styles={{ root: { textTransform: 'none' } }}
                      >
                        {RUBRIQUES.find((r) => r.value === tc.rubriqueId)?.value || tc.rubriqueId}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{tc.createdBy}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{tc.createdAt}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        color={statusColors[tc.status] || 'gray'}
                        variant="light"
                        styles={{ root: { textTransform: 'capitalize' } }}
                      >
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

      {/* Bottom action bar */}
      <Box
        px="md"
        py="sm"
        style={{ borderTop: '1px solid #e9ecef', backgroundColor: '#fff', flexShrink: 0 }}
      >
        <Transition mounted={published} transition="slide-up" duration={300}>
          {(styles) => (
            <Paper
              p="xs"
              mb="xs"
              radius="sm"
              style={{
                ...styles,
                backgroundColor: '#d3f9d8',
                border: '1px solid #b2f2bb',
              }}
            >
              <Group gap="xs" justify="center">
                <IconCheck size={14} color="#2b8a3e" />
                <Text size="xs" fw={500} c="#2b8a3e">
                  {'Contrôles publiés avec succès sur la synthèse !'}
                </Text>
              </Group>
            </Paper>
          )}
        </Transition>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {selected.size > 0
              ? `${selected.size} contrôle${selected.size > 1 ? 's' : ''} sélectionné${selected.size > 1 ? 's' : ''}`
              : `${filtered.length} contrôle${filtered.length > 1 ? 's' : ''} au total`}
          </Text>
          <Button
            size="sm"
            leftSection={<IconUpload size={16} />}
            disabled={selected.size === 0 || published}
            onClick={handlePublish}
            style={
              selected.size > 0 && !published
                ? { background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }
                : undefined
            }
            color="teal"
          >
            {`Publier (${selected.size})`}
          </Button>
        </Group>
      </Box>
    </Box>
  )
}

type UserRight = 'lecture' | 'modification' | 'aucun'

const DOSSIER_USERS = [
  { id: 'u1', name: 'R. Martin', email: 'r.martin@group.com', initials: 'RM', role: 'Directeur Audit' },
  { id: 'u2', name: 'S. Dupont', email: 's.dupont@group.com', initials: 'SD', role: 'Auditeur Senior' },
  { id: 'u3', name: 'A. Bernard', email: 'a.bernard@group.com', initials: 'AB', role: 'Auditeur' },
  { id: 'u4', name: 'M. Leroy', email: 'm.leroy@group.com', initials: 'ML', role: 'Contrôleur Interne' },
  { id: 'u5', name: 'C. Moreau', email: 'c.moreau@group.com', initials: 'CM', role: 'Responsable Comptable' },
  { id: 'u6', name: 'P. Thomas', email: 'p.thomas@group.com', initials: 'PT', role: 'Consultant Externe' },
] as const

const INITIAL_USER_RIGHTS: Record<string, UserRight> = Object.fromEntries(
  DOSSIER_USERS.map((u) => [
    u.id,
    u.role === 'Consultant Externe' ? 'aucun' : u.role === 'Auditeur' ? 'lecture' : 'modification',
  ])
)

interface AiChatDrawerProps {
  opened: boolean
  onClose: () => void
  onSaveControl?: (control: SavedControl) => void
}

export function AiChatDrawer({ opened, onClose, onSaveControl }: AiChatDrawerProps) {
  const { messages: genieMessages, status: chatStatus, error: genieError, sendMessage, reset } = useGenieChat({
    alias: "demo",
    basePath: '/api/supervised-genie',
  })
  const [localUserMessages, setLocalUserMessages] = useState<Message[]>([])

  // Track first-seen timestamps for Genie messages (they have no timestamp field)
  const genieTimestampsRef = useRef<Map<string, string>>(new Map())

  // Remove local user messages that are now echoed in genieMessages
  const prevGenieCountRef = useRef(genieMessages.length)
  useEffect(() => {
    if (genieMessages.length > prevGenieCountRef.current) {
      // Build a set of user message contents from genie for fast lookup
      const genieUserContents = new Set(
        genieMessages
          .filter((m) => m.role === 'user')
          .map((m) => m.content.trim())
      )
      setLocalUserMessages((prev) =>
        prev.filter((local) => !genieUserContents.has(local.content.trim()))
      )
    }
    prevGenieCountRef.current = genieMessages.length
  }, [genieMessages])

  // Record first-seen timestamps for new Genie messages
  useEffect(() => {
    const ts = genieTimestampsRef.current
    for (const m of genieMessages) {
      const key = String(m.id)
      if (!ts.has(key)) {
        ts.set(key, new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
      }
    }
  }, [genieMessages])

  // Simple mirror: Genie messages + any local messages not yet picked up by Genie
  // Filter out internal/empty messages that should not be shown to users
  // Sort by timestamp ascending (oldest first, newest at bottom)
  const messages: Message[] = useMemo(() => {
    const ts = genieTimestampsRef.current
    const merged: Message[] = [...genieMessages.map((gm) => ({
      ...gm,
      timestamp: (gm as Message).timestamp ?? ts.get(String(gm.id)),
    })), ...localUserMessages]
    const filtered = merged.filter((msg) => {
      // Always show user messages
      if (msg.role === 'user') return true
      // Show assistant messages that have visible content, blocks, or attachments
      const hasContent = Boolean(msg.content?.trim())
      const hasBlocks = Boolean('blocks' in msg && msg.blocks && msg.blocks.length > 0)
      const hasAttachments = Boolean(msg.attachments && msg.attachments.length > 0)
      const isLoading = Boolean('loading' in msg && msg.loading)
      const isPeriodPrompt = Boolean('periodPrompt' in msg && msg.periodPrompt)
      return hasContent || hasBlocks || hasAttachments || isLoading || isPeriodPrompt
    })
    // Sort by timestamp ascending so newest messages appear at the bottom
    filtered.sort((a, b) => {
      const ta = a.timestamp ?? ''
      const tb = b.timestamp ?? ''
      if (ta < tb) return -1
      if (ta > tb) return 1
      return 0
    })
    return filtered
  }, [genieMessages, localUserMessages])

  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(true)
  const viewport = useRef<HTMLDivElement>(null)
  const [generatedSpecs, setGeneratedSpecs] = useState<Record<string, GenericUiSpec>>({})
  const [chartProposals, setChartProposals] = useState<Record<string, ChartProposalItem[]>>({})
  const [selectedCharts, setSelectedCharts] = useState<Record<string, string>>({})
  const handleChartSelect = useCallback((messageId: string, chartType: string) => {
    setSelectedCharts((prev) => ({ ...prev, [messageId]: chartType }))
  }, [])
  const attemptedChartProposalIdsRef = useRef<Set<string>>(new Set())
  const inFlightSpecIdsRef = useRef<Set<string>>(new Set())
  const attemptedSpecIdsRef = useRef<Set<string>>(new Set())
  const sessionIdRef = useRef(typeof crypto !== 'undefined' ? crypto.randomUUID() : `session-${Date.now()}`)
  const conversationIdRef = useRef(typeof crypto !== 'undefined' ? crypto.randomUUID() : `conversation-${Date.now()}`)
  const [showTeamControls, setShowTeamControls] = useState(false)
  const [supervisorLoading, setSupervisorLoading] = useState(false)
  const [supervisorHint, setSupervisorHint] = useState<SupervisorApiResponse | null>(null)
  const [pendingClarification, setPendingClarification] = useState<PendingClarification | null>(null)
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({})
  const [clarificationRetryCount, setClarificationRetryCount] = useState(0)

  const handlePublishTeamControls = (controls: TeamControl[]) => {
    if (onSaveControl) {
      controls.forEach((tc) => {
        onSaveControl({
          id: `team-${tc.id}-${Date.now()}`,
          name: tc.name,
          description: tc.description,
          results: tc.results,
          rubriqueId: tc.rubriqueId,
        })
      })
    }
  }

  /* Save control modal state */
  const [saveModalOpened, setSaveModalOpened] = useState(false)
  const [saveForm, setSaveForm] = useState({
    name: '',
    description: '',
    results: '',
    rubriqueId: '01',
  })
  const [aiSuggestedRubrique, setAiSuggestedRubrique] = useState<string | null>(null)
  const [rubriqueAlert, setRubriqueAlert] = useState(false)
  const [saved, setSaved] = useState(false)
  const [applyToGroup, setApplyToGroup] = useState(false)

  const [userRights, setUserRights] = useState<Record<string, UserRight>>(() => ({ ...INITIAL_USER_RIGHTS }))

  const rightOptions: { value: UserRight; label: string; icon: React.ReactNode; color: string }[] = [
    { value: 'modification', label: 'Modification', icon: <IconPencil size={14} />, color: '#0c8599' },
    { value: 'lecture', label: 'Lecture seule', icon: <IconEye size={14} />, color: '#f59f00' },
    { value: 'aucun', label: 'Aucun accès', icon: <IconShieldCheck size={14} />, color: '#868e96' },
  ]

  /* Track the last suggestion index for auto-fill */
  const lastSuggestionIndexRef = useRef(-1)

  useEffect(() => {
    if (viewport.current) {
      viewport.current.scrollTo({
        top: viewport.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages])

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const buildConversationContext = useCallback(() => {
    return {
      conversationId: conversationIdRef.current,
      sessionId: sessionIdRef.current,
      source: 'ai-chat-drawer' as const,
      messages: messagesRef.current
        .filter((message) => Boolean(message.content?.trim()))
        .slice(-6)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
    }
  }, [])

  const submitPromptThroughSupervisor = useCallback(async (rawPrompt: string) => {
    const trimmedPrompt = rawPrompt.trim()
    if (!trimmedPrompt) return

    setShowSuggestions(false)
    setSupervisorLoading(true)
    setSupervisorHint(null)
    setInput('')

    // Immediately show the user message in the chat
    setLocalUserMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: 'user' as const,
        content: trimmedPrompt,
        timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      },
    ])

    try {
      const supervisorResponse = await runSupervisorPreflight({
        prompt: trimmedPrompt,
        conversationContext: buildConversationContext(),
      })

      if (!supervisorResponse) {
        setPendingClarification(null)
        setClarificationAnswers({})
        setSupervisorHint({
          decision: 'error',
          message: 'L\'agent IA n’a pas répondu. L’envoi à Genie est bloqué tant que la requête n’est pas validée.',
        })
        return
      }

      setSupervisorHint(supervisorResponse)

      if (supervisorResponse.decision === 'error') {
        setPendingClarification(null)
        return
      }

      if (supervisorResponse.decision === 'clarify') {
        const newRetryCount = clarificationRetryCount + 1
        setClarificationRetryCount(newRetryCount)

        if (newRetryCount >= 3) {
          setPendingClarification(null)
          setClarificationAnswers({})
          setSupervisorHint({
            decision: 'error',
            message: 'Après plusieurs tentatives de clarification, je ne suis pas en mesure de traiter cette demande. Veuillez contacter l\'équipe support pour obtenir de l\'aide.',
          })
          return
        }

        const questions = supervisorResponse.questions ?? []
        setPendingClarification({
          originalPrompt: trimmedPrompt,
          message: supervisorResponse.message,
          decision: supervisorResponse.decision,
          rewrittenPrompt: supervisorResponse.rewrittenPrompt,
          enrichedPrompt: supervisorResponse.enrichedPrompt,
          questions,
          suggestedTables: supervisorResponse.suggestedTables ?? [],
          suggestedFunctions: supervisorResponse.suggestedFunctions ?? [],
          traceId: supervisorResponse.traceId,
          canSendDirectly: false,
        })
        setClarificationAnswers(
          Object.fromEntries(questions.map((question) => [question.id, ''])) as Record<string, string>
        )
        return
      }

      // 'proceed' with high confidence → send enriched prompt to Genie
      if (isSupervisorApproved(supervisorResponse.decision, supervisorResponse.confidence)) {
        setPendingClarification(null)
        setClarificationAnswers({})
        setClarificationRetryCount(0)
        sendMessage(supervisorResponse.enrichedPrompt || supervisorResponse.rewrittenPrompt?.trim() || trimmedPrompt)
        return
      }

      // 'proceed' with low confidence or 'guide' → show confirmation with
      // option to send directly to Genie (supervisor already approved via cookie)
      const questions = supervisorResponse.questions ?? []
      setPendingClarification({
        originalPrompt: trimmedPrompt,
        message: supervisorResponse.message || 'L\'agent IA recommande de vérifier la reformulation avant envoi à Genie.',
        decision: supervisorResponse.decision,
        rewrittenPrompt: supervisorResponse.rewrittenPrompt,
        enrichedPrompt: supervisorResponse.enrichedPrompt,
        questions,
        suggestedTables: supervisorResponse.suggestedTables ?? [],
        suggestedFunctions: supervisorResponse.suggestedFunctions ?? [],
        traceId: supervisorResponse.traceId,
        canSendDirectly: true,
      })
      setClarificationAnswers(
        Object.fromEntries(questions.map((question) => [question.id, ''])) as Record<string, string>
      )
    } finally {
      setSupervisorLoading(false)
    }
  }, [buildConversationContext, clarificationRetryCount, sendMessage])

  // Track the last assistant message for which a GenUI spec was requested.
  const lastSpecCandidateIdRef = useRef<string | null>(null)

  useEffect(() => {
    // Wait until Genie finishes streaming (including all query_result events)
    // so the queryResults Map is fully populated before calling DSPy.
    if (chatStatus !== 'idle') return

    const latestAssistantMessage = [...messages].reverse().find((message) =>
      message.role === 'assistant' &&
      !message.loading &&
      !message.periodPrompt &&
      (Boolean(message.content?.trim()) || Boolean(message.blocks && message.blocks.length > 0) || Boolean(message.attachments && message.attachments.length > 0))
    )

    if (!latestAssistantMessage) return

    const messageId = String(latestAssistantMessage.id)

    if (attemptedSpecIdsRef.current.has(messageId)) return
    if (inFlightSpecIdsRef.current.has(messageId)) return
    if (lastSpecCandidateIdRef.current === messageId) return

    const fallbackSpec = latestAssistantMessage.blocks ? buildGenerativeUiSpec(latestAssistantMessage.blocks) : null

    lastSpecCandidateIdRef.current = messageId
    attemptedSpecIdsRef.current.add(messageId)
    inFlightSpecIdsRef.current.add(messageId)

    void generateUiSpecForMessage({
      prompt: latestAssistantMessage.content || blocksToPlainText(latestAssistantMessage.blocks || []),
      genieResult: buildGenieResultPayload(latestAssistantMessage),
    })
      .then((spec) => {
        setGeneratedSpecs((previous) => {
          if (previous[messageId]) return previous
          if (!spec && !fallbackSpec) return previous
          return { ...previous, [messageId]: (spec || fallbackSpec)! }
        })
      })
      .finally(() => {
        inFlightSpecIdsRef.current.delete(messageId)
      })

    // Fire chart proposal request if the message has Genie query results
    const hasQueryResults = latestAssistantMessage.attachments?.some(
      (a) => a.attachmentId && latestAssistantMessage.queryResults?.has(a.attachmentId)
    )
    if (hasQueryResults && !attemptedChartProposalIdsRef.current.has(messageId)) {
      attemptedChartProposalIdsRef.current.add(messageId)
      const firstAttachment = latestAssistantMessage.attachments?.find(
        (a) => a.attachmentId && latestAssistantMessage.queryResults?.has(a.attachmentId)
      )
      if (firstAttachment?.attachmentId) {
        const queryData = latestAssistantMessage.queryResults?.get(firstAttachment.attachmentId)
        const statement = toGenieStatementResponse(queryData)
        if (statement && statement.result.data_array.length > 1) {
          // Truncate before sending — the backend only uses the first 10 rows
          const truncatedStatement = {
            manifest: statement.manifest,
            result: { data_array: statement.result.data_array.slice(0, 50) },
          }
          void requestChartProposal({
            prompt: latestAssistantMessage.content || 'Analyze the query results',
            statementResponse: truncatedStatement,
          }).then((result) => {
            if (result?.chartProposals && result.chartProposals.length > 0) {
              setChartProposals((prev) => ({ ...prev, [messageId]: result.chartProposals }))
            }
          })
        }
      }
    }
  }, [chatStatus, messages])

  /* -------- Period confirmation handler (for "fournisseurs inactifs" workflow) -------- */
  const handlePeriodConfirm = useCallback((periodValue: string) => {
    const periodLabel = periodOptions.find((p) => p.value === periodValue)?.label ?? periodValue

    void submitPromptThroughSupervisor(`Période confirmée : ${periodLabel}`)
  }, [submitPromptThroughSupervisor])

  const handleSend = useCallback((text?: string) => {
    const msgText = text || input.trim()
    if (!msgText) return

    void submitPromptThroughSupervisor(msgText)
  }, [input, submitPromptThroughSupervisor])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    reset()
    setGeneratedSpecs({})
    setChartProposals({})
    setSelectedCharts({})
    setLocalUserMessages([])
    inFlightSpecIdsRef.current.clear()
    attemptedSpecIdsRef.current.clear()
    attemptedChartProposalIdsRef.current.clear()
    lastSpecCandidateIdRef.current = null
    setShowSuggestions(true)
    setSupervisorLoading(false)
    setSupervisorHint(null)
    setPendingClarification(null)
    setClarificationAnswers({})
    setClarificationRetryCount(0)
  }

  const handleClarificationSubmit = useCallback(() => {
    if (!pendingClarification) return

    const questionLines = pendingClarification.questions
      .map((question) => {
        const value = clarificationAnswers[question.id]?.trim()
        if (!value) return null
        return `- ${question.label}: ${value}`
      })
      .filter((value): value is string => Boolean(value))

    const basePrompt = pendingClarification.rewrittenPrompt?.trim() || pendingClarification.originalPrompt
    const clarifiedPrompt = questionLines.length > 0
      ? `${basePrompt}\nClarifications:\n${questionLines.join('\n')}`
      : basePrompt

    setPendingClarification(null)

    if (pendingClarification.canSendDirectly) {
      // Supervisor already approved — send directly to Genie
      sendMessage(pendingClarification.enrichedPrompt || clarifiedPrompt)
    } else {
      // True clarification (decision was 'clarify') — re-submit through supervisor
      // with the enriched prompt so it gets a fresh approval cookie
      void submitPromptThroughSupervisor(clarifiedPrompt)
    }
  }, [clarificationAnswers, pendingClarification, sendMessage, submitPromptThroughSupervisor])

  const handleOpenSave = (msg: Message) => {
    const plainResults = msg.content + (msg.blocks ? '\n' + blocksToPlainText(msg.blocks) : '')
    /* Determine AI-suggested rubrique from suggestion index or free text */
    const sugIdx = lastSuggestionIndexRef.current
    const inferredRubrique = sugIdx >= 0 && suggestedRubriqueMap[sugIdx]
      ? suggestedRubriqueMap[sugIdx]
      : inferRubriqueFromText(msg.controlName || msg.content || '')
    setSaveForm({
      name: msg.controlName || '',
      description: msg.controlDescription || '',
      results: plainResults.trim().slice(0, 2000),
      rubriqueId: inferredRubrique,
    })
    setAiSuggestedRubrique(inferredRubrique)
    setRubriqueAlert(false)
    setSaved(false)
    setApplyToGroup(false)
    setSaveModalOpened(true)
  }

  const handleSaveSubmit = () => {
    setSaved(true)
    if (onSaveControl) {
      onSaveControl({
        id: `ai-${Date.now()}`,
        name: saveForm.name,
        description: saveForm.description,
        results: saveForm.results,
        rubriqueId: saveForm.rubriqueId,
      })
    }
    setTimeout(() => {
      setSaveModalOpened(false)
      setSaved(false)
      setApplyToGroup(false)
    }, 1500)
  }

  /* Build copyable text for a message */
  const getCopyText = (msg: Message): string => {
    let text = msg.content || ''
    if (msg.blocks && msg.blocks.length > 0) {
      text += (text ? '\n' : '') + blocksToPlainText(msg.blocks)
    }
    return text.trim()
  }

  return (
    <>
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={560}
      withCloseButton={false}
      padding={0}
      lockScroll={false}
      withOverlay={false}
      shadow="xl"
      styles={{
        body: {
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        },
        content: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        },
      }}
    >
      {showTeamControls ? (
        <TeamControlsPanel
          onBack={() => setShowTeamControls(false)}
          onPublish={handlePublishTeamControls}
        />
      ) : (
      <>
      {/* Header */}
      <Box
        px="md"
        py="sm"
        style={{
          borderBottom: '1px solid #e9ecef',
          backgroundColor: '#fff',
          flexShrink: 0,
        }}
      >
        <Group justify="space-between">
          <Group gap="xs">
            <ThemeIcon
              size="sm"
              radius="sm"
              style={{ background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }}
            >
              <IconSparkles size={14} color="#fff" />
            </ThemeIcon>
            <Text size="sm" fw={600}>Assistant</Text>
          </Group>
          <Group gap={4}>
            <Tooltip label={"Contrôles de l'équipe"} position="bottom" withArrow>
              <ActionIcon
                variant="subtle"
                color="teal"
                size="sm"
                onClick={() => setShowTeamControls(true)}
                aria-label={"Contrôles de l'équipe"}
              >
                <IconListDetails size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Effacer la conversation" position="bottom" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleClear} aria-label="Effacer la conversation">
                <IconTrash size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Agrandir" position="bottom" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Agrandir">
                <IconArrowsMaximize size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Fermer" position="bottom" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose} aria-label="Fermer">
                <IconX size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>

      {/* Messages area */}
      <ScrollArea
        style={{ flex: 1 }}
        viewportRef={viewport}
      >
        <Box px="md" py="sm">
          {/* Welcome / description block */}
          {showSuggestions && messages.length === 0 && (
            <Stack gap="md">
              <Paper
                p="md"
                radius="md"
                style={{
                  backgroundColor: '#f0fdf9',
                  border: '1px solid #c3fae8',
                }}
              >
                <Group gap="xs" mb="xs">
                  <IconBulb size={16} color="#0c8599" />
                  <Text size="sm" fw={600} c="#0c8599">
                    Assistant de génération de contrôles
                  </Text>
                </Group>
                <Text size="xs" style={{ lineHeight: 1.6 }} c="dark">
                  Cet assistant vous permet de <b>générer de nouveaux contrôles personnalisés en langage naturel</b>. Décrivez simplement le type de vérification que vous souhaitez effectuer et l{"'"}assistant analysera vos données pour produire des résultats détaillés.
                </Text>
                <Divider my="xs" color="#c3fae8" />
                <Text size="xs" fw={600} mb={4} c="dark">
                  Bonnes pratiques :
                </Text>
                <List size="xs" spacing={2} withPadding>
                  <List.Item>
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
                      Soyez précis dans votre description (périmètre comptable, seuils, période)
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
                      Utilisez le vocabulaire comptable pour de meilleurs résultats
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
                      Posez des questions de suivi pour affiner l{"'"}analyse
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
                      Les résultats incluent textes, tableaux et graphiques interactifs
                    </Text>
                  </List.Item>
                </List>
              </Paper>

              <Box>
                <Text size="xs" fw={600} c="dimmed" mb="xs">
                  {'Exemples de questions d\'analyse et de contrôle'}
                </Text>
                <Stack gap={6}>
                  {suggestions.map((s, suggestionIndex) => (
                    <UnstyledButton
                      key={s}
                      onClick={() => {
                        lastSuggestionIndexRef.current = suggestionIndex
                        handleSend(s)
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #e9ecef',
                        backgroundColor: '#fff',
                        transition: 'all 150ms ease',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                        const t = e.currentTarget
                        t.style.borderColor = '#0c8599'
                        t.style.backgroundColor = '#f0fdf9'
                      }}
                      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                        const t = e.currentTarget
                        t.style.borderColor = '#e9ecef'
                        t.style.backgroundColor = '#fff'
                      }}
                    >
                      <Text size="xs" c="dark" style={{ lineHeight: 1.5 }}>
                        {s}
                      </Text>
                    </UnstyledButton>
                  ))}
                </Stack>
              </Box>
            </Stack>
          )}

          {/* Chat messages */}
          <Stack gap="md" mt={showSuggestions && messages.length === 0 ? 0 : undefined}>
            {messages.map((msg) => (
              <Box key={msg.id}>
                {msg.role === 'user' ? (
                  <Box>
                    <Paper
                      p="sm"
                      radius="md"
                      ml={40}
                      style={{
                        backgroundColor: '#1a1b25',
                        color: '#fff',
                      }}
                    >
                      <Text size="sm" c="white" style={{ lineHeight: 1.55 }}>
                        {msg.content}
                      </Text>
                    </Paper>
                    <Text size="xs" c="dimmed" mt={4} ta="right" mr={4}>
                      {msg.timestamp}
                    </Text>
                  </Box>
                ) : (
                  <Group align="flex-start" gap="xs" wrap="nowrap">
                    <ThemeIcon
                      size="sm"
                      radius="xl"
                      mt={2}
                      style={{
                        flexShrink: 0,
                        background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)',
                      }}
                    >
                      <IconSparkles size={12} color="#fff" />
                    </ThemeIcon>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      {/* Loading state */}
                      {msg.loading && (
                        <Paper
                          p="sm"
                          radius="md"
                          style={{ backgroundColor: '#f8f9fa' }}
                        >
                          <Group gap="xs">
                            <Loader size="xs" color="teal" type="dots" />
                            <Text size="sm" c="dimmed">Analyse en cours...</Text>
                          </Group>
                          <Progress
                            value={65}
                            color="teal"
                            size="xs"
                            mt="xs"
                            radius="xl"
                            animated
                          />
                          <Text size="xs" c="dimmed" mt={4}>
                            Parcours des écritures et identification des fournisseurs inactifs...
                          </Text>
                        </Paper>
                      )}

                      {/* Period prompt */}
                      {msg.periodPrompt && !msg.loading && (
                        <Paper
                          p="sm"
                          radius="md"
                          style={{ backgroundColor: '#f8f9fa' }}
                        >
                          <Group gap="xs" mb="xs">
                            <IconCalendar size={14} color="#0c8599" />
                            <Text size="sm" style={{ lineHeight: 1.55 }}>
                              {msg.content}
                            </Text>
                          </Group>
                          <Stack gap={6} mt="xs">
                            {periodOptions.map((opt) => (
                              <UnstyledButton
                                key={opt.value}
                                onClick={() => handlePeriodConfirm(opt.value)}
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: 8,
                                  border: '1px solid #e9ecef',
                                  backgroundColor: '#fff',
                                  transition: 'all 150ms ease',
                                  cursor: 'pointer',
                                }}
                                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                                  const t = e.currentTarget
                                  t.style.borderColor = '#0c8599'
                                  t.style.backgroundColor = '#f0fdf9'
                                }}
                                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                                  const t = e.currentTarget
                                  t.style.borderColor = '#e9ecef'
                                  t.style.backgroundColor = '#fff'
                                }}
                              >
                                <Text size="xs" c="dark">{opt.label}</Text>
                              </UnstyledButton>
                            ))}
                          </Stack>
                        </Paper>
                      )}

                      {/* Thinking accordion */}
                      {msg.thinking && !msg.loading && (
                        <Accordion
                          variant="subtle"
                          styles={{
                            item: { borderBottom: 'none' },
                            control: { padding: '2px 0', minHeight: 24 },
                            label: { fontSize: 11, color: '#868e96' },
                            chevron: { width: 14, height: 14 },
                            content: { padding: 0 },
                          }}
                        >
                          <Accordion.Item value="thinking">
                            <Accordion.Control
                              chevron={<IconChevronDown size={12} />}
                            >
                              Thinking complete
                            </Accordion.Control>
                            <Accordion.Panel>
                              <Text size="xs" c="dimmed" fs="italic">
                                Analyse des données du dossier 100M en cours...
                              </Text>
                            </Accordion.Panel>
                          </Accordion.Item>
                        </Accordion>
                      )}

                      {/* Regular content */}
                      {!msg.periodPrompt && !msg.loading && (
                        <Paper
                          p="sm"
                          radius="md"
                          style={{ backgroundColor: '#f8f9fa' }}
                        >
                          <MessageContent
                            msg={msg}
                            messageId={String(msg.id)}
                            generatedSpec={generatedSpecs[String(msg.id)]}
                            registry={chatUiRegistry}
                            chartProposals={chartProposals[String(msg.id)]}
                            selectedChart={selectedCharts[String(msg.id)]}
                            onChartSelect={handleChartSelect}
                          />
                        </Paper>
                      )}

                      {/* Action row: timestamp, copy, save */}
                      {!msg.loading && (
                        <Group justify="space-between" mt={4} ml={4}>
                          <Text size="xs" c="dimmed">
                            {msg.timestamp}
                          </Text>
                          <Group gap={4}>
                            {/* Copy button */}
                            {(msg.content || (msg.blocks && msg.blocks.length > 0)) && !msg.periodPrompt && (
                              <CopyButton text={getCopyText(msg)} />
                            )}
                            {/* Save as control button */}
                            {(generatedSpecs[String(msg.id)] || (msg.blocks && msg.blocks.length > 0)) && (
                              <Tooltip label="Enregistrer comme contrôle" position="top" withArrow>
                                <ActionIcon
                                  variant="subtle"
                                  color="teal"
                                  size="xs"
                                  onClick={() => handleOpenSave(msg)}
                                  aria-label="Enregistrer comme contrôle"
                                >
                                  <IconDeviceFloppy size={14} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Group>
                        </Group>
                      )}
                    </Box>
                  </Group>
                )}
              </Box>
            ))}
          </Stack>

          {/* Supervisor loading / result / clarification — always at bottom after messages */}
          {supervisorLoading && (
            <Paper
              p="sm"
              radius="md"
              mt="md"
              mb="md"
              style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef' }}
            >
              <Group gap="xs">
                <Loader size="xs" color="teal" type="dots" />
                <Text size="sm" c="dimmed">L'agent IA analyse l&apos;intention et les métadonnées Genie...</Text>
              </Group>
            </Paper>
          )}

          {genieError && !supervisorLoading && (
            <Alert
              variant="light"
              color="red"
              radius="md"
              mt="md"
              mb="md"
              icon={<IconAlertTriangle size={16} />}
            >
              <Text size="sm" fw={600}>Appel Genie refusé</Text>
              <Text size="xs" mt={4} style={{ lineHeight: 1.55 }}>
                {typeof genieError === 'string' ? genieError : String(genieError)}
              </Text>
            </Alert>
          )}

          {pendingClarification && !supervisorLoading && (
            <Paper
              p="sm"
              radius="md"
              mt="md"
              mb="md"
              style={{ backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}
            >
              <Group gap="xs" mb="xs" align="flex-start">
                <IconAlertTriangle size={16} color="#f08c00" />
                <Box style={{ flex: 1 }}>
                  <Text size="sm" fw={600}>Clarification requise avant l&apos;envoi à Genie</Text>
                  <Text size="xs" c="dimmed" mt={2} style={{ lineHeight: 1.55 }}>
                    {pendingClarification.message}
                  </Text>
                </Box>
              </Group>

              {pendingClarification.rewrittenPrompt && (
                <Box mb="sm">
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Reformulation proposée</Text>
                  <Paper p="xs" radius="sm" style={{ backgroundColor: '#ffffff', border: '1px solid #e9ecef' }}>
                    <Text size="xs" style={{ lineHeight: 1.55 }}>{pendingClarification.rewrittenPrompt}</Text>
                  </Paper>
                </Box>
              )}

              {pendingClarification.questions.map((question) => (
                <Box key={question.id} mb="sm">
                  <Text size="xs" fw={500} mb={4}>{question.label}</Text>
                  {question.inputType === 'select' && question.options && question.options.length > 0 ? (
                    <Select
                      data={question.options}
                      value={clarificationAnswers[question.id] ?? ''}
                      onChange={(value) => {
                        setClarificationAnswers((previous) => ({
                          ...previous,
                          [question.id]: value ?? '',
                        }))
                      }}
                      placeholder={question.placeholder || 'Sélectionnez une option'}
                      size="sm"
                      radius="sm"
                      allowDeselect={!question.required}
                    />
                  ) : question.inputType === 'number' ? (
                    <NumberInput
                      value={clarificationAnswers[question.id] ? Number(clarificationAnswers[question.id]) : undefined}
                      onChange={(value) => {
                        setClarificationAnswers((previous) => ({
                          ...previous,
                          [question.id]: value == null || value === '' ? '' : String(value),
                        }))
                      }}
                      placeholder={question.placeholder || 'Ajoutez une valeur numérique'}
                      size="sm"
                      radius="sm"
                    />
                  ) : question.inputType === 'toggle' ? (
                    <Switch
                      checked={clarificationAnswers[question.id] === 'true'}
                      onChange={(event) => {
                        setClarificationAnswers((previous) => ({
                          ...previous,
                          [question.id]: String(event.currentTarget.checked),
                        }))
                      }}
                      size="md"
                      color="teal"
                      label={question.placeholder || 'Activer cette option'}
                    />
                  ) : (
                    <TextInput
                      value={clarificationAnswers[question.id] ?? ''}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setClarificationAnswers((previous) => ({
                          ...previous,
                          [question.id]: value,
                        }))
                      }}
                      placeholder={question.placeholder || 'Ajoutez une précision'}
                      size="sm"
                      radius="sm"
                    />
                  )}
                </Box>
              ))}

              {(pendingClarification.suggestedTables.length > 0 || pendingClarification.suggestedFunctions.length > 0) && (
                <Stack gap={6} mb="sm">
                  {pendingClarification.suggestedTables.length > 0 && (
                    <Box>
                      <Text size="xs" fw={600} c="dimmed" mb={4}>Tables suggérées par le knowledge store</Text>
                      <Group gap={6}>
                        {pendingClarification.suggestedTables.map((tableName) => (
                          <Badge key={tableName} size="xs" variant="light" color="teal">{tableName}</Badge>
                        ))}
                      </Group>
                    </Box>
                  )}
                  {pendingClarification.suggestedFunctions.length > 0 && (
                    <Box>
                      <Text size="xs" fw={600} c="dimmed" mb={4}>Fonctions suggérées par le knowledge store</Text>
                      <Group gap={6}>
                        {pendingClarification.suggestedFunctions.map((functionName) => (
                          <Badge key={functionName} size="xs" variant="outline" color="gray">{functionName}</Badge>
                        ))}
                      </Group>
                    </Box>
                  )}
                </Stack>
              )}

              <Group justify="flex-end" mt="xs">
                {pendingClarification.rewrittenPrompt && (
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => {
                      const enriched = pendingClarification.enrichedPrompt
                      const rewritten = pendingClarification.rewrittenPrompt?.trim()
                      if (!enriched && !rewritten) return
                      setPendingClarification(null)
                      if (pendingClarification.canSendDirectly) {
                        sendMessage(enriched || rewritten!)
                      } else {
                        void submitPromptThroughSupervisor(rewritten!)
                      }
                    }}
                  >
                    {pendingClarification.canSendDirectly ? 'Envoyer à Genie' : 'Utiliser la reformulation'}
                  </Button>
                )}
                <Button size="xs" color="teal" onClick={handleClarificationSubmit}>
                  {pendingClarification.canSendDirectly ? 'Confirmer et envoyer' : 'Relancer avec ces précisions'}
                </Button>
              </Group>
            </Paper>
          )}

          {supervisorHint && !pendingClarification && !supervisorLoading && (
            <Paper
              p="sm"
              radius="md"
              mt="md"
              mb="md"
              style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef' }}
            >
              <Group gap="xs" align="flex-start">
                <IconRobot size={16} color="#0c8599" />
                <Box style={{ flex: 1 }}>
                  <Text size="xs" fw={600}>Pré-analyse par un agent IA</Text>
                  <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
                    {supervisorHint.message}
                  </Text>
                  <Group gap={6} mt={6}>
                    <Badge size="xs" variant="light" color={
                      supervisorHint.decision === 'error'
                        ? 'red'
                        : supervisorHint.decision === 'clarify'
                          ? 'orange'
                          : supervisorHint.decision === 'guide'
                            ? 'blue'
                            : 'teal'
                    }>
                      {supervisorHint.decision}
                    </Badge>
                    {typeof supervisorHint.confidence === 'number' && (
                      <Badge size="xs" variant="outline" color="gray">
                        {`Confiance ${Math.round(supervisorHint.confidence * 100)}%`}
                      </Badge>
                    )}
                  </Group>
                  {supervisorHint.decision === 'error' && (
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      mt="xs"
                      onClick={() => setSupervisorHint(null)}
                    >
                      Fermer et réessayer
                    </Button>
                  )}
                </Box>
              </Group>
            </Paper>
          )}

          {/* Streaming indicator when Genie is actively responding */}
          {chatStatus === 'streaming' && !supervisorLoading && (
            <Box mt="md" px={4}>
              <Group align="flex-start" gap="xs" wrap="nowrap">
                <ThemeIcon
                  size="sm"
                  radius="xl"
                  mt={2}
                  style={{
                    flexShrink: 0,
                    background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)',
                  }}
                >
                  <IconSparkles size={12} color="#fff" />
                </ThemeIcon>
                <Paper
                  p="sm"
                  radius="md"
                  style={{ backgroundColor: '#f8f9fa', flex: 1 }}
                >
                  <Group gap="xs">
                    <Loader size="xs" color="teal" type="dots" />
                    <Text size="sm" c="dimmed">Analyse en cours...</Text>
                  </Group>
                </Paper>
              </Group>
            </Box>
          )}
        </Box>
      </ScrollArea>

      {/* Input */}
      <Box
        px="md"
        py="sm"
        style={{
          borderTop: '1px solid #e9ecef',
          backgroundColor: '#fff',
          flexShrink: 0,
        }}
      >
        <Group gap="xs" wrap="nowrap">
          <TextInput
            placeholder="Décrivez le contrôle à générer..."
            size="sm"
            radius="md"
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            style={{ flex: 1 }}
            styles={{
              input: {
                borderColor: '#dee2e6',
              },
            }}
          />
          <ActionIcon
            size="lg"
            radius="md"
            onClick={() => handleSend()}
            disabled={!input.trim() || chatStatus === 'streaming' || supervisorLoading}
            aria-label="Envoyer"
            style={{
              background: input.trim() && chatStatus !== 'streaming' && !supervisorLoading
                ? 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)'
                : '#e9ecef',
              border: 'none',
              color: input.trim() && chatStatus !== 'streaming' && !supervisorLoading ? '#fff' : '#adb5bd',
            }}
          >
            <IconSend size={16} />
          </ActionIcon>
        </Group>
        <Text ta="center" size="xs" c="dimmed" mt={6}>
          {'Vérifiez toujours l\'exactitude des réponses.'}
        </Text>
      </Box>
      </>
      )}
    </Drawer>

    {/* ---- Save control modal ---- */}
    <Modal
      opened={saveModalOpened}
      onClose={() => { setSaveModalOpened(false); setApplyToGroup(false) }}
      title={
        <Group gap="xs">
          <IconDeviceFloppy size={18} color="#0c8599" />
          <Text fw={600} size="sm">Enregistrer un nouveau contrôle</Text>
        </Group>
      }
      size="xl"
      radius="md"
      centered
      overlayProps={{ backgroundOpacity: 0.25, blur: 3 }}
    >
      <Stack gap="md">
        {/* --- Nom --- */}
        <Box>
          <Text size="xs" fw={500} mb={4}>Nom du contrôle</Text>
          <TextInput
            value={saveForm.name}
            onChange={(e) => setSaveForm((f) => ({ ...f, name: e.currentTarget.value }))}
            size="sm"
            radius="sm"
            placeholder="Ex: Vérification des fournisseurs inactifs"
            rightSection={
              saveForm.name ? (
                <Badge size="xs" color="teal" variant="light" mr={4}>
                  Auto-rempli
                </Badge>
              ) : null
            }
            rightSectionWidth={saveForm.name ? 90 : undefined}
          />
        </Box>
        {/* --- Description --- */}
        <Box>
          <Text size="xs" fw={500} mb={4}>Description du contrôle</Text>
          <Textarea
            value={saveForm.description}
            onChange={(e) => setSaveForm((f) => ({ ...f, description: e.currentTarget.value }))}
            size="sm"
            radius="sm"
            minRows={3}
            autosize
            placeholder={'Décrivez l\'objectif et le périmètre du contrôle...'}
          />
          {saveForm.description && (
            <Badge size="xs" color="teal" variant="light" mt={4}>
              {'Auto-rempli par l\'IA'}
            </Badge>
          )}
        </Box>
        {/* --- Résultats --- */}
        <Box>
          <Text size="xs" fw={500} mb={4}>Résultats</Text>
          <Textarea
            value={saveForm.results}
            onChange={(e) => setSaveForm((f) => ({ ...f, results: e.currentTarget.value }))}
            size="sm"
            radius="sm"
            minRows={5}
            maxRows={10}
            autosize
            placeholder={'Résultats de l\'analyse...'}
          />
          {saveForm.results && (
            <Badge size="xs" color="teal" variant="light" mt={4}>
              {'Auto-rempli par l\'IA'}
            </Badge>
          )}
        </Box>

        {/* --- Rubrique --- */}
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
            data={RUBRIQUES}
            size="sm"
            radius="sm"
            allowDeselect={false}
            rightSection={
              saveForm.rubriqueId === aiSuggestedRubrique ? (
                <Badge size="xs" color="teal" variant="light" mr={24}>
                  {'Suggestion IA'}
                </Badge>
              ) : null
            }
            rightSectionWidth={saveForm.rubriqueId === aiSuggestedRubrique ? 110 : undefined}
          />
          {saveForm.rubriqueId === aiSuggestedRubrique && (
            <Group gap={4} mt={4}>
              <IconRobot size={13} color="#0c8599" />
              <Text size="xs" c="teal">
                {'Rubrique suggérée automatiquement par l\'IA en fonction du contenu du contrôle'}
              </Text>
            </Group>
          )}
        </Box>

        {/* --- AI correction alert --- */}
        {rubriqueAlert && aiSuggestedRubrique && (
          <Alert
            icon={<IconAlertTriangle size={18} />}
            color="orange"
            variant="light"
            radius="md"
            title="Correction de rubrique détectée"
            styles={{
              title: { fontSize: 13, fontWeight: 600 },
              message: { fontSize: 12 },
            }}
          >
            <Text size="xs">
              {'L\'IA a initialement suggéré la rubrique '}
              <Text span fw={600}>{RUBRIQUES.find((r) => r.value === aiSuggestedRubrique)?.label}</Text>
              {' pour ce contrôle. Vous avez sélectionné une rubrique différente. '}
            </Text>
            <Group gap="xs" mt={8}>
              <Button
                size="xs"
                variant="light"
                color="orange"
                leftSection={<IconRobot size={14} />}
                onClick={() => {
                  setSaveForm((f) => ({ ...f, rubriqueId: aiSuggestedRubrique }))
                  setRubriqueAlert(false)
                }}
              >
                {'Rétablir la suggestion IA'}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => setRubriqueAlert(false)}
              >
                {'Conserver ma sélection'}
              </Button>
            </Group>
          </Alert>
        )}

        {/* --- Activer sur toutes les sociétés du groupe --- */}
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
            <Switch
              checked={applyToGroup}
              onChange={(e) => setApplyToGroup(e.currentTarget.checked)}
              color="teal"
              size="md"
              aria-label="Activer sur toutes les sociétés du groupe"
            />
          </Group>
        </Box>

        {/* --- Liste des utilisateurs avec droits --- */}
        {applyToGroup && (
          <Box
            style={{
              border: '1px solid #e9ecef',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <Box
              px="sm"
              py="xs"
              style={{
                backgroundColor: '#f0fdf9',
                borderBottom: '1px solid #e9ecef',
              }}
            >
              <Group gap="xs">
                <IconShieldCheck size={15} color="#0c8599" />
                <Text size="xs" fw={600} c="#0c8599">
                  {'Utilisateurs ayant accès au dossier'}
                </Text>
                <Badge size="xs" color="teal" variant="light" ml="auto">
                  {DOSSIER_USERS.length} utilisateurs
                </Badge>
              </Group>
            </Box>

            {/* Table header */}
            <Box
              px="sm"
              py={6}
              style={{
                display: 'flex',
                backgroundColor: '#f8f9fa',
                borderBottom: '1px solid #f1f3f5',
              }}
            >
              <Text size="xs" fw={600} c="dimmed" style={{ flex: 1 }}>Utilisateur</Text>
              <Text size="xs" fw={600} c="dimmed" style={{ width: 130, textAlign: 'center' }}>{'Rôle'}</Text>
              <Text size="xs" fw={600} c="dimmed" style={{ width: 160, textAlign: 'center' }}>{'Droit d\'accès au contrôle'}</Text>
            </Box>

            {/* User rows */}
            <ScrollArea.Autosize mah={260}>
              {DOSSIER_USERS.map((user) => {
                const currentRight = userRights[user.id] || 'lecture'
                const rightDef = rightOptions.find((r) => r.value === currentRight) || rightOptions[0]
                return (
                  <Box
                    key={user.id}
                    px="sm"
                    py="xs"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      borderBottom: '1px solid #f1f3f5',
                    }}
                  >
                    {/* User info */}
                    <Group gap="sm" style={{ flex: 1 }}>
                      <Avatar
                        size="sm"
                        radius="xl"
                        color="teal"
                        styles={{
                          placeholder: {
                            fontSize: 10,
                            fontWeight: 600,
                          },
                        }}
                      >
                        {user.initials}
                      </Avatar>
                      <Box>
                        <Text size="xs" fw={500} style={{ lineHeight: 1.3 }}>{user.name}</Text>
                        <Text size="xs" c="dimmed" style={{ lineHeight: 1.3 }}>{user.email}</Text>
                      </Box>
                    </Group>
                    {/* Role */}
                    <Text size="xs" c="dimmed" style={{ width: 130, textAlign: 'center' }}>{user.role}</Text>
                    {/* Right selector */}
                    <Box style={{ width: 160, display: 'flex', justifyContent: 'center' }}>
                      <Select
                        value={currentRight}
                        onChange={(val) => {
                          if (val) {
                            setUserRights((prev) => ({ ...prev, [user.id]: val as UserRight }))
                          }
                        }}
                        data={rightOptions.map((r) => ({ value: r.value, label: r.label }))}
                        size="xs"
                        radius="sm"
                        allowDeselect={false}
                        styles={{
                          input: {
                            fontSize: 11,
                            fontWeight: 500,
                            color: rightDef.color,
                            borderColor: rightDef.color + '44',
                            backgroundColor: rightDef.color + '08',
                            textAlign: 'center',
                            paddingLeft: 8,
                            paddingRight: 24,
                          },
                          dropdown: {
                            fontSize: 11,
                          },
                        }}
                        w={140}
                      />
                    </Box>
                  </Box>
                )
              })}
            </ScrollArea.Autosize>

            {/* Summary bar */}
            <Box
              px="sm"
              py={6}
              style={{
                backgroundColor: '#f8f9fa',
                borderTop: '1px solid #e9ecef',
                display: 'flex',
                gap: 12,
                justifyContent: 'flex-end',
              }}
            >
              {rightOptions.map((r) => {
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

        {/* --- Actions --- */}
        <Group justify="flex-end" mt="xs">
          <Button
            variant="default"
            size="sm"
            onClick={() => { setSaveModalOpened(false); setApplyToGroup(false) }}
          >
            Annuler
          </Button>
          <Button
            size="sm"
            color="teal"
            leftSection={saved ? <IconCheck size={16} /> : <IconDeviceFloppy size={16} />}
            onClick={handleSaveSubmit}
            disabled={!saveForm.name.trim()}
            style={
              saved
                ? { backgroundColor: '#2b8a3e' }
                : { background: 'linear-gradient(105deg, #0c8599 0%, #15aabf 100%)' }
            }
          >
            {saved ? 'Enregistré !' : 'Enregistrer le contrôle'}
          </Button>
        </Group>
      </Stack>
    </Modal>
    </>
  )
}
