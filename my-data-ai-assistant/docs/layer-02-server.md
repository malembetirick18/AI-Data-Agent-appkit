# Couche 2 — Serveur (Express.js / AppKit)

**Dossier :** `server/`  
**Point d'entrée :** `server/server.ts`

## Responsabilités

- Création de l'application AppKit avec ses plugins
- Enregistrement des routes HTTP
- Proxy SSE vers Genie
- Gestion du store de cookies d'approbation
- Troncature des résultats Genie pour le SSE

---

## Architecture Express

```
AppKit App
├── Plugin: server          — routes Express de base (AppKit)
├── Plugin: controllerAiAgent — /api/controller, /api/spec
└── Plugin: genie           — espace Genie (DATABRICKS_GENIE_SPACE_ID)
```

---

## Routes enregistrées

| Méthode | Route | Rôle |
|---------|-------|------|
| `POST` | `/api/controller` | Décision contrôleur (plugin `controllerAiAgent`) |
| `POST` | `/api/spec` | Génération spec GenUI (plugin `controllerAiAgent`) |
| `POST` | `/api/chat-controller/:alias/messages` | Envoi message Genie + stream SSE résultats |
| `GET` | `/api/chat-controller/:alias/conversations/:conversationId` | Historique conversation Genie |

---

## Flux Genie (SSE)

```typescript
const MAX_SSE_ROWS = 2000  // Limite de lignes pour éviter payloads trop lourds

POST /api/chat-controller/:alias/messages
  ├─ Vérifie cookie d'approbation (controllerApprovalStore)
  ├─ Appelle Genie.sendMessage() (AppKit hook)
  ├─ Stream SSE : event: genie_message_chunk
  │   data: { role, content, statementResult? }
  └─ Troncature : rows.slice(0, MAX_SSE_ROWS)
```

### Événements SSE émis

| Événement | Contenu |
|-----------|---------|
| `genie_message_chunk` | `{ role, content, statementResult?, truncated? }` |
| `genie_done` | Signal de fin de stream |
| `genie_error` | `{ error: string }` |

---

## Store d'approbation (`controller-approval-store.ts`)

Mécanisme de sécurité empêchant l'envoi direct de requêtes à Genie sans validation contrôleur.

```typescript
// Émission d'un token côté plugin (après décision 'proceed')
setApprovalCookie(res, token)

// Vérification côté serveur avant Genie
const approved = checkApprovalCookie(req)
if (!approved) return res.status(403).json({ error: 'Approbation requise' })
```

Les tokens sont des UUIDs signés, valides pour **une seule requête** (invalidés après usage).

---

## Configuration

| Variable d'environnement | Valeur par défaut | Description |
|--------------------------|-------------------|-------------|
| `DATABRICKS_HOST` | — | URL workspace Databricks |
| `DATABRICKS_APP_PORT` | `8000` | Port de l'application |
| `DATABRICKS_GENIE_SPACE_ID` | — | Identifiant de l'espace Genie |
| `SEMANTIC_LAYER_API_URL` | `http://localhost:8001/api` | URL API sémantique |
