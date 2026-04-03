# Couche 1 — Client (React / TypeScript)

**Dossier :** `client/`  
**Point d'entrée :** `client/src/main.tsx`

## Responsabilités

- Interface de chat IA (drawer latéral)
- Rendu générative UI via JSON Render
- Visualisations interactives (AG Charts, AG Grid)
- Formulaires de clarification dynamiques
- Streaming SSE des réponses Genie

---

## Composant principal : `ai-chat-drawer.tsx`

Ce fichier (~3 400 lignes) concentre toute la logique du chat IA et du rendu des résultats.

### Types de messages

```typescript
type Message = {
  role: 'user' | 'assistant'
  blocks: ContentBlock[]         // Texte, titres, listes, tableaux
  thinking?: boolean             // Loader "en cours de réflexion"
  spec?: GenericUiSpec           // Spec JSON Render pour rendu dynamique
  attachments?: QueryResultAttachment[]  // Résultats Genie bruts
  queryResults?: Record<string, unknown>[]  // Données pour auto-chart
  genieStatement?: GenieStatementResult
}
```

### Pipeline de décision côté client

```
handleSubmit()
  ├─ POST /api/controller
  │   └─ parseControllerResponse() → ControllerApiResponse
  │       ├─ decision='proceed' ∧ conf≥0.90 → sendToGenie() [auto]
  │       ├─ decision='proceed' ∧ 0.70≤conf<0.90 → bouton "Envoyer quand même"
  │       ├─ decision='clarify' → affichage PendingClarification (formulaire)
  │       ├─ decision='guide' → affichage message + suggestion
  │       └─ decision='error' → message d'erreur
  └─ (si approuvé) POST /api/chat-controller/:alias/messages
       └─ SSE stream → renderGenieResult()
            └─ [si attachments] uiStream.send(prompt, { genieResult })
                 └─ POST /api/spec-stream (JSONL RFC 6902 patches)
                      └─ useUIStream reconstruit spec progressivement → <Renderer>
                      └─ (fallback) buildSpecFromGenieStatement() si spec indisponible
```

### Fonctions helper clés

| Fonction | Rôle |
|----------|------|
| `isControllerApproved()` | `decision==='proceed' && confidence>=0.90` |
| `transformStatementToChartData()` | Convertit résultat SQL Genie en données chart |
| `buildSpecFromGenieStatement()` | Fallback — auto-génère un `GenericUiSpec` depuis les colonnes Genie |
| `formatColumnLabel()` | `snake_case` → `Title Case` |
| `buildGenieResultPayload()` | Construit le payload `genieResult` pour `uiStream.send()` |
| `blocksToPlainText()` | Convertit les blocs de message en texte pour le prompt spec |

### Seuils de confiance

```typescript
const HIGH_CONFIDENCE_THRESHOLD = 0.90   // Approbation automatique
const LOW_CONFIDENCE_THRESHOLD  = 0.70   // Approbation manuelle requise
```

---

## Composant `InteractiveChart`

Composant de visualisation interactif wrappant AG Charts Enterprise v12.

### Props

```typescript
{
  data: Record<string, unknown>[]   // Données tabulaires
  initialXKey: string               // Colonne axe X
  initialYKeys: string[]            // Colonnes axe Y (max 2 présélectionnées)
  initialType: ChartVizType         // 'line'|'bar'|'area'|'bubble'|'radar'|'pie'|'donut'
  initialLabelKey?: string          // Pour types radiaux
  initialValueKey?: string          // Pour types radiaux
  initialSizeKey?: string           // Pour bubble
  title?: string
  yLabel?: string
  source?: string
}
```

### Types de graphiques supportés

| Type | Usage | Multi-séries |
|------|-------|-------------|
| `line` | Séries temporelles, tendances | ✅ MultiSelect (max 5) |
| `area` | Tendances avec remplissage | ✅ MultiSelect (max 5) |
| `bar` | Comparaison catégorielle | ✗ Série unique |
| `radar` | Vue multivariée | ✅ MultiSelect (max 5) |
| `pie` | Répartition partie/tout | ✗ |
| `donut` | Répartition avec KPI central | ✗ |
| `bubble` | Corrélation 3D | ✗ |

### Palette de couleurs

```typescript
const CHART_PALETTE = [
  '#4C78A8', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
  '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
]
```
Chaque série reçoit une couleur distincte par position dans `numericColumns`.

### Formatage des dates françaises

Colonnes ISO 8601 (`YYYY-MM-DD` ou `YYYY-MM-DDTHH:mm:ss`) détectées automatiquement et formatées en `DD/MM/YYYY` via `fr-FR` locale.

```typescript
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T|$)/
const frDateFormatter = ({ value }) =>
  new Date(value).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' })
```

### Description explicative (panel droit)

Chaque graphique génère automatiquement une description contextuelle en français affichée à droite du graphique (160px, séparée par une bordure). Exemples :

- Ligne : `Évolution de Revenue, Expenses selon date — 120 enregistrements`
- Radar : `Vue radar de Chiffre d'Affaires, Marge selon Catégorie`
- Bulle : `Corrélation date / Revenue — taille : Volume`

### Sélecteur de colonnes (MultiSelect)

- **Défaut :** 2 colonnes Y pré-sélectionnées maximum
- **Dropdown :** affiche les 8 premières colonnes sans recherche ; toutes les correspondances lors d'une saisie
- **maxValues :** 5 séries simultanées
- **hidePickedOptions :** les options déjà sélectionnées disparaissent du dropdown

---

## Intégration `useUIStream` + `useGenieChat`

`useUIStream` (de `@json-render/react`) remplace l'ancien polling `generateUiSpecForMessage`. Il consomme les JSONL RFC 6902 patches de `/api/spec-stream` et reconstruit progressivement un objet `Spec { root, elements }`.

### Pattern de double tracking (ref + state)

`onComplete` et `onError` sont des closures définies à l'instantiation du hook — elles capturent les valeurs au moment de la définition. Pour éviter les stale closures :

- **`streamingSpecMessageIdRef`** (useRef) — toujours à jour, lu dans `onComplete`/`onError`
- **`streamingSpecMessageId`** (useState) — déclenche les re-renders React pour l'affichage du loader

Ne jamais fusionner ces deux en un seul. Ne pas remplacer le ref par un accès direct à la state.

### Résolution de spec à l'affichage

```typescript
const resolvedSpec =
  generatedSpecs[msgId] ??                                          // spec complète (historique)
  (streamingSpecMessageId === msgId && uiStream.spec               // spec en cours de streaming
    ? uiStream.spec as GenericUiSpec
    : undefined)
```

Si `resolvedSpec` est `undefined`, le fallback `buildSpecFromGenieStatement()` génère une spec automatique depuis les données Genie brutes.

### Déduplication

`attemptedSpecIdsRef` (Set) empêche de déclencher `uiStream.send()` plus d'une fois par `messageId`. Ne pas supprimer cette garde.

---

## Règles de memoïsation React

### `InteractiveChart`

Toutes les listes d'options de colonnes doivent être dans `useMemo` :

```typescript
const allColOptions  = useMemo(() => allColumns.map(...), [allColumns])
const numColOptions  = useMemo(() => numericColumns.map(...), [numericColumns])
const yOptions       = useMemo(() => numericColumns.filter(c => c !== xKey).map(...), [numericColumns, xKey])
const sizeOptions    = useMemo(() => numericColumns.filter(...).map(...), [numericColumns, xKey, yKeys])
const activeYKeys    = useMemo(() => yKeys.length > 0 ? yKeys : (yOptions[0] ? [yOptions[0].value] : []), [yKeys, yOptions])
```

Ne **jamais** recalculer ces listes inline — cela force AG Charts à re-rendre le graphique à chaque render parent.

### `DataTable`

```typescript
const headers = useMemo(() => Array.isArray(props.headers) ? props.headers as string[] : [], [props.headers])
const rows    = useMemo(() => Array.isArray(props.rows)    ? props.rows as string[][]  : [], [props.rows])
```

Sans ces `useMemo`, `columnDefs` et `rowData` (qui en dépendent) sont recalculés à chaque render → AG Grid réinitialise entièrement la grille.

### Clés React

- `RenderBlock` : utiliser `blockIndex` (index) — **jamais** `JSON.stringify(block)`
- `BulletList` items : utiliser `itemIndex` — les items dupliqués causeraient des conflits de clés

---

## Catalogue GenUI et registre JSON Render

Le registre `chatUiRegistry` associe chaque composant du catalogue à sa implémentation React :

```typescript
const { registry: chatUiRegistry } = defineRegistry(chatUiCatalog, {
  components: {
    Stack, TextContent, BulletList, DataTable,
    LineChartViz, BarChartViz, AreaChartViz, PieChartViz,
    DonutChartViz, RadarChartViz, BubbleChartViz,
    QueryDataTable, FormPanel, SelectInputField,
    TextInputField, NumberInputField, ToggleField,
    WorkflowRuleBuilder,
  }
})
```

---

## Suggestions prédéfinies

5 questions d'audit prédéfinies en français présentées à l'utilisateur à l'ouverture du chat :

1. Tendances fournisseurs sur les 12 derniers mois
2. Transactions atypiques ou suspectes
3. Fournisseurs inactifs avec soldes ouverts
4. Risques de concentration (Pareto 80/20)
5. Écarts de paiement vs factures

---

## Dépendances principales

```json
{
  "@mantine/core": "^7.x",
  "ag-charts-enterprise": "^12.1.0",
  "ag-charts-react": "^12.1.0",
  "ag-grid-enterprise": "^33.x",
  "@json-render/core": "*",
  "@json-render/react": "*",
  "@databricks/appkit-ui": "*"
}
```
