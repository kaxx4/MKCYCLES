#!/usr/bin/env bash
# ============================================================
# dev.sh – Start backend and frontend in development mode
# Usage: ./scripts/dev.sh
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Backend setup ────────────────────────────────────────────
cd "$ROOT/backend"

if [ ! -d ".venv" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "Installing backend dependencies..."
pip install -q -r requirements.txt

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Created backend/.env from .env.example – edit as needed."
fi

mkdir -p data/tally_inbox data/raw_backup logs

echo ""
echo "Starting FastAPI backend on http://localhost:8000 ..."
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# ── Frontend setup ───────────────────────────────────────────
cd "$ROOT/frontend"

if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo ""
echo "Starting Vite frontend on http://localhost:5173 ..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "==========================================="
echo "  Tally Dashboard running!"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo "  Frontend: http://localhost:5173"
echo "==========================================="
echo ""
echo "Drop Tally XML files into: $ROOT/backend/data/tally_inbox"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" INT TERM
wait $BACKEND_PID $FRONTEND_PID
