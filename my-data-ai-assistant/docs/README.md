# Documentation — My Data AI Assistant

Documentation technique organisée par couche applicative.

## Index

| Fichier | Description |
|---------|-------------|
| [architecture.md](architecture.md) | Vue d'ensemble, flux principal, stack technique |
| [layer-01-client.md](layer-01-client.md) | **Couche 1** — Frontend React/TypeScript : chat, graphiques, GenUI |
| [layer-02-server.md](layer-02-server.md) | **Couche 2** — Serveur Express/AppKit : routes, SSE Genie, approbation |
| [layer-03-semantic-api.md](layer-03-semantic-api.md) | **Couche 3** — API Sémantique FastAPI/DSPy : pipeline agents, règles |
| [layer-04-plugins.md](layer-04-plugins.md) | **Couche 4** — Plugin ControllerAiAgent : endpoints, flags décision |
| [layer-05-shared.md](layer-05-shared.md) | **Couche 5** — Catalogue GenUI partagé : composants, specs RFC 6902 |

## Démarrage rapide

```bash
# Variables d'environnement
cp .env.example .env
# Renseigner : DATABRICKS_HOST, DATABRICKS_GENIE_SPACE_ID, AZURE_API_KEY, AZURE_API_BASE

# Dépendances Node
npm install

# API Sémantique (Python)
cd semantic_layer_api
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
uvicorn main:app --port 8001 --reload

# Application (dans un autre terminal)
npm run dev
```

## Points d'attention

- **Périmètre d'analyse :** toute requête sans mention de `groupe`/`filiale`/`sp_folder_id` déclenche une demande de clarification obligatoire (guardrail programmatique)
- **Réflexion LLM :** activée via `ENABLE_CONTROLLER_REFLECTION=true` (1 appel LLM supplémentaire par requête — désactivé en dev)
- **Signatures legacy :** `query_classification_signature.py`, `required_columns_signature.py`, `sql_function_signature.py` sont inutilisées et peuvent être supprimées
- **Graphiques multi-séries :** Line, Area et Radar supportent jusqu'à 5 séries simultanées via MultiSelect (2 pré-sélectionnées par défaut)
