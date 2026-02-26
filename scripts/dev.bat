@echo off
REM ============================================================
REM dev.bat - Start backend and frontend in development mode (Windows)
REM Usage: scripts\dev.bat
REM ============================================================

SET ROOT=%~dp0..

REM ── Backend setup ─────────────────────────────────────────
cd /d "%ROOT%\backend"

IF NOT EXIST ".venv" (
    echo Creating Python virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat

echo Installing backend dependencies...
pip install -q -r requirements.txt

IF NOT EXIST ".env" (
    copy .env.example .env
    echo Created backend\.env from .env.example - edit as needed.
)

IF NOT EXIST "data\tally_inbox" mkdir data\tally_inbox
IF NOT EXIST "data\raw_backup" mkdir data\raw_backup
IF NOT EXIST "logs" mkdir logs

echo.
echo Starting FastAPI backend on http://localhost:8000 ...
start "Tally Backend" cmd /k "uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

REM ── Frontend setup ─────────────────────────────────────────
cd /d "%ROOT%\frontend"

IF NOT EXIST "node_modules" (
    echo Installing frontend dependencies...
    npm install
)

echo.
echo Starting Vite frontend on http://localhost:5173 ...
start "Tally Frontend" cmd /k "npm run dev"

echo.
echo ===========================================
echo   Tally Dashboard running!
echo   Backend:  http://localhost:8000
echo   API docs: http://localhost:8000/docs
echo   Frontend: http://localhost:5173
echo ===========================================
echo.
echo Drop Tally XML files into:
echo   %ROOT%\backend\data\tally_inbox
echo.
echo Two new windows opened - close them to stop servers.
pause
