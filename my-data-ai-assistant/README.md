# Minimal Databricks App

A minimal Databricks App powered by Databricks AppKit, featuring React, TypeScript, and Tailwind CSS.

## Prerequisites

- Node.js v22+ and npm
- Databricks CLI (for deployment)
- Access to a Databricks workspace

## Databricks Authentication

### Local Development

For local development, configure your environment variables by creating a `.env` file:

```bash
cp env.example .env
```

Edit `.env` and set the environment variables you need:

```env
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_APP_PORT=8000
# ... other environment variables, depending on the plugins you use
```

### CLI Authentication

The Databricks CLI requires authentication to deploy and manage apps. Configure authentication using one of these methods:

#### OAuth U2M

Interactive browser-based authentication with short-lived tokens:

```bash
databricks auth login --host https://your-workspace.cloud.databricks.com
```

This will open your browser to complete authentication. The CLI saves credentials to `~/.databrickscfg`.

#### Configuration Profiles

Use multiple profiles for different workspaces:

```ini
[DEFAULT]
host = https://dev-workspace.cloud.databricks.com

[production]
host = https://prod-workspace.cloud.databricks.com
client_id = prod-client-id
client_secret = prod-client-secret
```

Deploy using a specific profile:

```bash
databricks bundle deploy -t prod --profile production
```

**Note:** Personal Access Tokens (PATs) are legacy authentication. OAuth is strongly recommended for better security.

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development

Run the app in development mode with hot reload:

```bash
npm run dev
```

The app will be available at the URL shown in the console output.

### Build

Build both client and server for production:

```bash
npm run build
```

This creates:

- `dist/server/` - Compiled server code
- `client/dist/` - Bundled client assets

### Production

Run the production build:

```bash
npm start
```

## Code Quality

There are a few commands to help you with code quality:

```bash
# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:fix
```

## DSPy + MLflow GenUI Plugin Setup

This app includes a custom AppKit plugin endpoint at `POST /api/spec` that runs a local Python DSPy script and traces each generation with MLflow.

### Install Python dependencies

```bash
python -m pip install -r server/python/requirements-dspy.txt
```

### Environment variables

Add these to your `.env` when using the plugin:

```env
# Optional Python executable path (defaults to "python")
GENUI_PYTHON_EXECUTABLE=python

# Optional runner override (defaults to server/python/dspy_genui_runner.py)
GENUI_DSPY_RUNNER_PATH=server/python/dspy_genui_runner.py

# Generated Genie knowledge store path
GENIE_KNOWLEDGE_STORE_PATH=catalog_schemas_description/genie_knowledge_store.json

# DSPy/LLM settings
GENUI_DSPY_MODEL=gpt-4o-mini
GENUI_DSPY_API_BASE=
GENUI_DSPY_API_KEY=

# MLflow tracing settings
MLFLOW_TRACKING_URI=
MLFLOW_EXPERIMENT_NAME=genui-dspy
```

### Genie knowledge store JSON

The supervisor reads schema and function metadata from a generated JSON file located at [catalog_schemas_description/genie_knowledge_store.json](c:/Users/r.malembeti/Documents/AI-Data-Agent-appkit/my-data-ai-assistant/catalog_schemas_description/genie_knowledge_store.json).

This file was generated from:

- [catalog_schemas_description/mv_table_description_csv.csv](c:/Users/r.malembeti/Documents/AI-Data-Agent-appkit/my-data-ai-assistant/catalog_schemas_description/mv_table_description_csv.csv)
- [catalog_schemas_description/mv_table_columns_description_csv.csv](c:/Users/r.malembeti/Documents/AI-Data-Agent-appkit/my-data-ai-assistant/catalog_schemas_description/mv_table_columns_description_csv.csv)
- [catalog_schemas_description/functions_defined.csv](c:/Users/r.malembeti/Documents/AI-Data-Agent-appkit/my-data-ai-assistant/catalog_schemas_description/functions_defined.csv)

The configured path is now exposed through `GENIE_KNOWLEDGE_STORE_PATH` in both local development and app deployment config.

To regenerate this file from the CSV metadata sources, run:

```bash
npm run generate:knowledge-store
```

### Example request

```bash
curl -X POST http://localhost:8000/api/spec \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Summarize this as a chart and table","genieResult":{"rows":[]}}'
```

## Deployment with Databricks Asset Bundles

### 1. Configure Bundle

Update `databricks.yml` with your workspace settings:

```yaml
targets:
  dev:
    workspace:
      host: https://your-workspace.cloud.databricks.com
    variables:
      warehouse_id: your-warehouse-id
```

### 2. Validate Bundle

```bash
databricks bundle validate
```

### 3. Deploy

Deploy to the development target:

```bash
databricks bundle deploy -t dev
```

### 4. Run

Start the deployed app:

```bash
databricks bundle run <APP_NAME> -t dev
```

### Deploy to Production

1. Configure the production target in `databricks.yml`
2. Deploy to production:

```bash
databricks bundle deploy -t prod
```

## Project Structure

```
* client/          # React frontend
  * src/           # Source code
  * public/        # Static assets
* server/          # Express backend
  * server.ts      # Server entry point
  * routes/        # Routes
* shared/          # Shared types
* databricks.yml   # Bundle configuration
* app.yaml         # App configuration
* .env.example     # Environment variables example
```

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: React.js, TypeScript, Vite, Tailwind CSS, React Router
- **UI Components**: Radix UI, shadcn/ui
- **Databricks**: AppKit SDK
