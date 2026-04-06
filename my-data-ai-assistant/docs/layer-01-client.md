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

Ce fichier (~600 lignes) orchestre la logique du chat IA après refactor en modules. Les modules fils sont dans `types/chat.ts`, `lib/`, `components/`, `hooks/`, `registry/`.

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
  │       ├─ decision='clarify' → pendingClarification → ClarificationPanel
  │       │     └─ triggerClarificationSpec(pendingClarification)
  │       │           └─ POST /api/spec-stream { prompt, questions[] }
  │       │                └─ LLM → FormPanel JSONL → JSONUIProvider + Renderer
  │       │                └─ (fallback) questionsToSpec() → même pipeline
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

## Intégration `useUIStream` — deux instances (`hooks/useSpecStreaming.ts`)

`useUIStream` (de `@json-render/react`) gère le streaming de specs JSONL RFC 6902. Les deux instances vivent exclusivement dans `hooks/useSpecStreaming.ts`.

| Instance | Rôle | Déclencheur |
|----------|------|-------------|
| `uiStream` | Spec résultat Genie | Après `renderGenieResult()` avec attachments |
| `clarificationStream` | Spec formulaire clarification | Quand `pendingClarification` devient non-null |

### Pattern de double tracking (ref + state) — instance `uiStream`

`onComplete` et `onError` sont des closures définies à l'instantiation — elles capturent les valeurs au moment de la définition. Pour éviter les stale closures :

- **`streamingSpecMessageIdRef`** (useRef) — toujours à jour, lu dans `onComplete`/`onError`
- **`streamingSpecMessageId`** (useState) — déclenche les re-renders React pour l'affichage du loader

Ne jamais fusionner ces deux en un seul. Ne pas remplacer le ref par un accès direct à la state.

### Résolution de spec Genie à l'affichage

```typescript
const resolvedSpec =
  generatedSpecs[msgId] ??                                          // spec complète (historique)
  (streamingSpecMessageId === msgId && uiStream.spec               // spec en cours de streaming
    ? uiStream.spec as GenericUiSpec
    : undefined)
```

Si `resolvedSpec` est `undefined`, le fallback `buildSpecFromGenieStatement()` génère une spec automatique depuis les données Genie brutes.

### Résolution de spec clarification à l'affichage

`ClarificationPanel` reçoit `spec`, `isStreaming`, `hasStreamError` props.

```typescript
// ClarificationPanel (interne) :
const resolvedSpec = spec ?? questionsToSpec(pendingClarification)
// resolvedSpec est null uniquement si la liste de questions est vide/invalide
```

`questionsToSpec()` (dans `lib/clarification-spec.ts`) produit un `GenericUiSpec` valide pour tout sous-ensemble de questions — le même `JSONUIProvider` + `Renderer` pipeline que pour les specs Genie.

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

## Composant `ClarificationPanel`

Affiche les questions de clarification générées par le contrôleur. Depuis avril 2026, tous les inputs du formulaire passent par `JSONUIProvider` + `Renderer` — plus aucun input Mantine brut.

### Props

```typescript
interface ClarificationPanelProps {
  pendingClarification: PendingClarification
  spec?: GenericUiSpec | null    // LLM-generated via clarificationStream
  isStreaming?: boolean
  hasStreamError?: boolean
  onSubmit: (answers: Record<string, string>) => void
}
```

### Logique de rendu

- `resolvedSpec = spec ?? questionsToSpec(pendingClarification)` — les deux chemins utilisent `JSONUIProvider` + `Renderer`
- `answersRef` — snapshot des réponses, mis à jour par `onStateChange` (évite les stale closures)
- `computeMissingRequired` — vérifie les champs obligatoires y.c. la règle `sp_folder_id` (visible uniquement si `scope_level === 'filiale'`)
- Soumission explicite uniquement via le bouton « Relancer avec ces précisions » (pas d'auto-submit)
- Le wrapper Mantine (header, icon, message, Divider, Alert, bouton) reste inchangé

### RFC 6901 dans `handleStateChange`

Les paths envoyés par `onStateChange` sont des JSON Pointers RFC 6901. `handleStateChange` doit unescaper avant de les utiliser comme clés d'objet :

```typescript
const key = (path.startsWith('/') ? path.slice(1) : path)
  .replace(/~1/g, '/').replace(/~0/g, '~')
```

### `clarificationRetryCount` comme clé React

`<ClarificationPanel key={controller.clarificationRetryCount} .../>` — force un remount complet (et donc un reset de `answersRef`) à chaque nouvelle tentative.

### Limite de 3 itérations et message de fin de boucle

Le compteur `clarificationRetryCount` est géré dans `hooks/useControllerState.ts` :

- **Reset sur nouvelle demande** : dès le début de `submitPromptThroughController`, si `options.suppressControllerBubble` est falsy (= prompt utilisateur frais), le compteur est remis à 0. Les re-runs de clarification (flag `suppressControllerBubble: true`) ne remettent pas le compteur à zéro.
- **Limite à 3** : quand `newRetryCount >= 3`, la boucle s'arrête sans afficher de formulaire. Un message assistant ordinaire est injecté dans `localUserMessages` :

  > *Désolé, nous n'avons pas pu traiter votre demande après plusieurs tentatives de clarification. Veuillez reformuler votre demande ou contacter le support pour obtenir de l'aide.*

  Ce message s'affiche comme une bulle de chat normale — pas de badge, pas de carte, pas de bouton "Fermer et réessayer". Ne pas remplacer ce chemin par `setControllerHint`.

---

---

## Composant `MessageContent`

`client/src/components/MessageContent.tsx` — rendu memoïsé d'un message unique.

### Chaîne de rendu

1. `specIsValid(generatedSpec)` → `JSONUIProvider` + `Renderer` (spec LLM)
2. Streaming en cours → préserve uniquement le texte/blocs déjà reçus
3. Blocs de contenu (`RenderBlock`) + texte brut
4. Pièces jointes Genie → `JSONUIProvider` + `Renderer` par pièce
5. Fallback → spinner de chargement (ou `null` si `hideText`)

### `RenderErrorBoundary`

Chaque site `JSONUIProvider`+`Renderer` est enveloppé par `RenderErrorBoundary` (class component défini dans `MessageContent.tsx`). En cas d'erreur de rendu (spec malformée, crash dans un composant du registre) :

- Seul le bloc de message concerné est remplacé par : *"Une erreur est survenue lors de l'affichage de ce contenu."*
- Le reste du chat reste fonctionnel.
- Le `ErrorBoundary` global (racine de l'app) n'est plus sollicité pour les erreurs de spec.

Ne pas supprimer ces wrappers — ils sont la seule protection contre les specs invalides générées par le LLM qui feraient crasher toute l'interface.

---

## Catalogue GenUI et registre JSON Render

Le registre `chatUiRegistry` associe chaque composant du catalogue à sa implémentation React (20 composants) :

```typescript
const { registry: chatUiRegistry } = defineRegistry(chatUiCatalog, {
  components: {
    Stack, TextContent, BulletList, DataTable,
    LineChartViz, BarChartViz, AreaChartViz, PieChartViz,
    DonutChartViz, RadarChartViz, BubbleChartViz,
    QueryDataTable, FormPanel, SelectInputField,
    TextInputField, NumberInputField, ToggleField,
    WorkflowRuleBuilder, AccordionGroup, AccordionSection,
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

---

## Évaluation qualité code (Avril 2026)

- **Score global:** 8.7/10
- **Lisibilité:** forte progression grâce à l'extraction des effets en hooks nommés (`useAutoScrollToBottom`, `useGeneratedSpecTrigger`, `useClarificationSpecSync`).
- **Gestion d'état:** fiabilisée sur les formulaires de clarification (source unique `JSONUIProvider`, suppression des états locaux dérivés dans `bound-inputs`).
- **Hygiène hooks React:** `useEffect` réduit au strict nécessaire (synchronisation externe uniquement) ; remplacement des subscriptions manuelles par `useSyncExternalStore` pour le toast store.
- **Robustesse UI:** clarification CTA unifié (« Relancer avec ces précisions »), suppression des doubles boutons injectés par spec (`SubmitButton` filtré), smoke test aligné sur l'UI réelle.

### Risques résiduels

- Le cache de promesse des suggestions (`getDynamicSuggestionsPromise`) est volontairement singleton pendant la durée de vie de la page ; si un rafraîchissement runtime des suggestions est requis, prévoir une stratégie d'invalidation explicite.
- Le calcul de `messages` dans `ai-chat-drawer.tsx` reste dense et mérite une extraction supplémentaire en utilitaires purs si le composant continue de grossir.
