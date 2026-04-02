# Couche 4 — Plugin ControllerAiAgent

**Dossier :** `plugins/controller-ai-agent/`  
**Fichier principal :** `controller-ai-agent.ts`

## Responsabilités

- Exposition des endpoints `/api/controller` et `/api/spec` dans AppKit
- Proxy SSE vers l'API Sémantique Python
- Calcul du flag `canSendDirectly` et gestion du cookie d'approbation
- Timeout et gestion des erreurs de l'API Sémantique

---

## Exports publics

```typescript
export class ControllerAiAgent { ... }
export function controllerAiAgent(): Plugin  // factory
export function handleControllerRequest(req, res): Promise<void>
export function handleSpecRequest(req, res): Promise<void>
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
     canSendDirectly = isApproved() || isLowConfidenceProceed() || decision==='guide'
     isLowConfidenceProceed = decision==='proceed' && 0.70 ≤ conf < 0.90
  4. Émission du cookie d'approbation si canSendDirectly

Sortie  : ControllerApiResponse
```

### Seuils de décision

```typescript
const HIGH_CONFIDENCE_THRESHOLD = 0.90
const LOW_CONFIDENCE_THRESHOLD  = 0.70

isApproved()           = decision==='proceed' && confidence >= 0.90
isLowConfidenceProceed = decision==='proceed' && confidence >= 0.70 && confidence < 0.90
canSendDirectly        = isApproved || isLowConfidenceProceed || decision==='guide'
```

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

## Endpoint `/api/spec`

**Handler :** `handleSpecRequest()`

```
Entrée  : { prompt, genieResult? }
          (SpecRequest)

Traitement :
  1. Appel SSE vers SEMANTIC_LAYER_API_URL/spec/generate
     timeout = 45 secondes
  2. Parsing de l'événement SSE : event: spec
     data: { root, elements, state }  (GenericUiSpec)

Sortie  : { spec: GenericUiSpec, model?: string }
          (SpecResponse)
```

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
