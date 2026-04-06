# Couche 4 — Plugin ControllerAiAgent

**Dossier :** `plugins/controller-ai-agent/`  
**Fichier principal :** `controller-ai-agent.ts`

## Responsabilités

- Exposition de l'endpoint `/api/controller` dans AppKit
- Proxy SSE vers l'API Sémantique Python
- Calcul du flag `canSendDirectly` et gestion du cookie d'approbation
- Timeout et gestion des erreurs de l'API Sémantique

---

## Exports publics

```typescript
export class ControllerAiAgent { ... }
export function controllerAiAgent(): Plugin  // factory
export function handleControllerRequest(req, res): Promise<void>
```

### Type `ControllerRequest`

```typescript
type ControllerRequest = {
  prompt: string
  catalogInfo?: string
  conversationContext?: Record<string, unknown> | null  // objet unique, pas un tableau
}
```

---

## Endpoint `/api/controller`

**Handler :** `handleControllerRequest()`

```
Entrée  : { prompt, catalogInfo?, conversationContext? }
          (ControllerRequest)

Traitement :
  1. Appel SSE vers SEMANTIC_LAYER_API_URL/chat/stream
     timeout = 45 secondes
  2. Parsing de l'événement SSE : event: controller_decision
     data: { role: "controller", data: ControllerResponse }
  3. Calcul des flags :
     canSendDirectly = isApproved() || decision==='guide'
     (isApproved = decision==='proceed' && confidence >= 0.90)
  4. Émission du cookie d'approbation si canSendDirectly

Sortie  : ControllerApiResponse
```

### Seuils de décision

```typescript
const HIGH_CONFIDENCE_THRESHOLD = 0.90

isApproved()    = decision==='proceed' && confidence >= 0.90
canSendDirectly = isApproved || decision==='guide'
```

> La plage basse de confiance (0.70–0.89) ne déclenche **pas** `canSendDirectly` automatiquement — elle affiche un bouton "Envoyer quand même" côté client pour confirmation manuelle.

### Type `ControllerApiResponse`

```typescript
type ControllerApiResponse = {
  decision: 'proceed' | 'guide' | 'clarify' | 'error'
  confidence: number
  message: string
  rewrittenPrompt?: string
  enrichedPrompt?: string
  suggestedTables: string[]
  suggestedFunctions: string[]
  requiredColumns: string[]
  predictiveFunctions: string[]
  questions: ControllerQuestion[]
  queryClassification?: string
  canSendDirectly: boolean         // calculé côté plugin
  isLowConfidenceProceed: boolean  // calculé côté plugin
  needsParams?: boolean
  coherenceNote?: string
  model?: string
}
```

---

## Endpoint spec streaming

La génération de spec n'est plus exposée via `/api/spec` dans le plugin.
Le flux JSONL de spec passe par la route serveur `/api/spec-stream` (dans `server/server.ts`), consommée par `useUIStream` côté client.

---

## Type `ControllerQuestion`

Questions structurées retournées par le contrôleur pour collecte de paramètres :

```typescript
type ControllerQuestion = {
  id: string
  label: string
  inputType: 'select' | 'text' | 'number' | 'toggle'
  required?: boolean
  placeholder?: string
  options?: ControllerQuestionOption[]  // pour inputType='select'
  min?: number                          // pour inputType='number'
  max?: number
  step?: number
}
```

---

## Configuration

| Variable d'environnement | Valeur par défaut | Description |
|--------------------------|-------------------|-------------|
| `SEMANTIC_LAYER_API_URL` | `http://localhost:8001/api` | URL API sémantique |

---

## Gestion des erreurs

- Timeout SSE (45s) → réponse `500` avec message explicite
- Parsing SSE échoué → réponse `502` avec détail
- API sémantique indisponible → réponse `503`
- Cookie manquant sur route Genie → réponse `403` (géré dans `server.ts`)
