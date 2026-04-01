#!/bin/bash
set -euo pipefail

# ── Install Python deps (Databricks Apps provides pip, not conda) ──────────────
echo "[start.sh] Installing Python dependencies..."
pip install --quiet -r semantic_layer_api/requirements.txt

# ── Start FastAPI on 0.0.0.0:8001 in background ───────────────────────────────
echo "[start.sh] Starting semantic layer API on 0.0.0.0:8001..."
uvicorn main:app \
  --app-dir semantic_layer_api \
  --host 0.0.0.0 \
  --port 8001 \
  --no-access-log \
  &
UVICORN_PID=$!

# ── Wait for uvicorn to be ready (max 30 s) ───────────────────────────────────
echo "[start.sh] Waiting for semantic layer API..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8001/ > /dev/null 2>&1 || \
     curl -sf http://localhost:8001/api/ > /dev/null 2>&1 || \
     curl -sf http://localhost:8001/docs > /dev/null 2>&1; then
    echo "[start.sh] Semantic layer API is ready."
    break
  fi
  if ! kill -0 $UVICORN_PID 2>/dev/null; then
    echo "[start.sh] ERROR: uvicorn died." >&2
    exit 1
  fi
  sleep 1
done

# ── Start Node.js server (foreground — Databricks Apps tracks this process) ────
echo "[start.sh] Starting Node.js server..."
exec npm run start
