# Architecture — My Data AI Assistant

## Vue d'ensemble

**My Data AI Assistant** est une application Databricks permettant l'exploration de données par IA. Elle orchestre une chaîne de composants répartis sur cinq couches applicatives :

```
┌──────────────────────────────────────────────────────────────────┐
│  COUCHE 1 — CLIENT (React / TypeScript)                          │
│  Drawer de chat, rendu GenUI, visualisations AG Charts           │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP / SSE
┌────────────────────────────▼─────────────────────────────────────┐
│  COUCHE 2 — SERVEUR (Express.js / AppKit)                        │
│  Routes API, injection de plugins, proxy Genie                   │
└──────────┬──────────────────────────────┬────────────────────────┘
           │ POST /api/controller          │ POST /api/chat-controller
           │ POST /api/spec                │ (flux Genie SSE)
┌──────────▼──────────────┐  ┌────────────▼────────────────────────┐
│  COUCHE 4 — PLUGIN       │  │  DATABRICKS GENIE                   │
│  ControllerAiAgent       │  │  Exécution SQL + retour résultats   │
└──────────┬──────────────┘  └─────────────────────────────────────┘
           │ HTTP / SSE
┌──────────▼──────────────────────────────────────────────────────┐
│  COUCHE 3 — API SÉMANTIQUE (FastAPI / DSPy / Python)            │
│  Pipeline agents : Analyse → Rephrase → Décision → Réflexion    │
│  Génération de spécifications GenUI (RFC 6902 JSONL)            │
└─────────────────────────────────────────────────────────────────┘
           │ schemas, types
┌──────────▼──────────────────────────────────────────────────────┐
│  COUCHE 5 — PARTAGÉ (shared/)                                   │
│  Catalogue GenUI, types Zod, contrats TypeScript                │
└─────────────────────────────────────────────────────────────────┘
```

## Flux principal : Requête utilisateur → Réponse

```
1. L'utilisateur tape une question dans le chat drawer (Couche 1)
   ↓
2. POST /api/controller (Couche 2 → Plugin Couche 4)
   ↓
3. Pipeline DSPy dans l'API Sémantique (Couche 3) :
   Phase 1  QueryAnalysis      — classification + colonnes + cohérence
   Phase 2  RephraseQuery      — réécriture conditionnelle
   Phase 3  ControllerDecision — décision : proceed / guide / clarify / error
   Phase 3b Validation catalog — nettoyage des hallucinations
   Phase 4  Réflexion (opt.)   — correction LLM sur signal évaluateur
   ↓
4. Retour JSON { decision, confidence, rewrittenPrompt, questions… }
   ↓
5a. decision='proceed' ∧ confidence ≥ 0.90 → approbation automatique
    POST /api/chat-controller/:alias/messages → Genie exécute le SQL
    → Résultats → POST /api/spec-stream → useUIStream consomme les JSONL RFC 6902 patches
    → GenUI spec → <Renderer> rendu UI chart/tableau
    
5b. decision='clarify' | 'guide' → affichage des questions de clarification
    → Réponses de l'utilisateur → retour en 2.
    
5c. decision='error' → message d'erreur affiché
```

## Stack technique

| Couche | Technologie principale |
|--------|----------------------|
| Client | React 19, TypeScript, Vite, Mantine UI v7, AG Charts Enterprise v12, AG Grid Enterprise, JSON Render |
| Serveur | Express.js, Node.js, Databricks AppKit |
| API Sémantique | FastAPI (Python), DSPy, MLflow tracing |
| LLM | Azure OpenAI (gpt-4.1) via DSPy avec JSONAdapter |
| Tests | Vitest (unitaire), Playwright (E2E) |
| Déploiement | Databricks Asset Bundles |

## Fichiers clés par couche

| Couche | Fichier | Rôle |
|--------|---------|------|
| Client | `client/src/components/ai-chat-drawer.tsx` | Interface chat, rendu charts, GenUI |
| Serveur | `server/server.ts` | Routes Express, proxy SSE Genie |
| Serveur | `server/controller-approval-store.ts` | Gestion cookies d'approbation |
| Plugin | `plugins/controller-ai-agent/controller-ai-agent.ts` | Endpoints `/api/controller` et `/api/spec` |
| API Sém. | `semantic_layer_api/main.py` | Application FastAPI, bootstrap DSPy |
| API Sém. | `semantic_layer_api/src/controller_decision.py` | Pipeline agent multi-étapes |
| API Sém. | `semantic_layer_api/src/genui_spec_generator.py` | Génération specs GenUI |
| Partagé | `shared/genui-catalog.ts` | Catalogue de composants JSON Render |
| Partagé | `shared/normalize-spec.ts` | Normalisation des specs GenUI — source unique partagée entre serveur et client |
| Données | `catalog_schemas_description/genie_knowledge_store.json` | Métadonnées Genie (tables, colonnes, fonctions) |
