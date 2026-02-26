# Tally Dashboard

A **local, pluggable Tally→Dashboard** application that ingests Tally ERP XML exports (Master.xml and Transactions.xml), stores normalised accounting data in SQLite, and serves a responsive React dashboard.

All data stays on your machine. No cloud. No external dependencies beyond Python and Node.js.

---

## Project Structure

```
.
├── backend/                  # FastAPI + SQLite backend
│   ├── app/
│   │   ├── api/routes.py     # All REST endpoints
│   │   ├── core/             # Config, DB, logging
│   │   ├── etl/              # Sanitizer, parser, importer, watcher
│   │   ├── models/           # SQLModel DB models
│   │   └── schemas/          # Pydantic response schemas
│   ├── tests/                # pytest unit + integration tests
│   ├── data/
│   │   └── tally_inbox/      # Drop XML files here
│   ├── requirements.txt
│   └── .env.example
├── frontend/                 # React + Vite + TypeScript + Tailwind
│   ├── src/
│   │   ├── api/              # Axios client + API endpoints
│   │   ├── components/       # Layout, KPICard, VoucherModal
│   │   ├── pages/            # Dashboard, Vouchers, Customers, Items, Import, Settings
│   │   ├── types/            # TypeScript interfaces
│   │   └── utils/            # Formatters
│   └── package.json
├── sample_data/
│   ├── Master.xml            # 5 ledgers, 5 items, units, company
│   └── Transactions.xml      # 6 vouchers (Sales, Purchase, Receipt)
├── scripts/
│   ├── dev.sh                # Linux/Mac: start both servers
│   ├── dev.bat               # Windows: start both servers
│   ├── import_sample.sh      # Import sample data via API
│   └── import_sample.bat
├── docker-compose.yml
├── Dockerfile.backend
├── Dockerfile.frontend
└── nginx.conf
```

---

## Quick Start (Local Dev)

### Prerequisites

- Python 3.11+
- Node.js 18+ (with npm)
- (Optional) curl for sample import scripts

### Windows

```bat
scripts\dev.bat
```

### Linux / macOS

```bash
chmod +x scripts/dev.sh scripts/import_sample.sh
./scripts/dev.sh
```

Both servers start in separate windows/processes:

| Service  | URL                          |
|----------|------------------------------|
| Frontend | http://localhost:5173        |
| Backend  | http://localhost:8000        |
| API Docs | http://localhost:8000/docs   |

---

## Manual Setup

### Backend

```bash
cd backend

# Create & activate virtual environment
python -m venv .venv
# Linux/Mac:
source .venv/bin/activate
# Windows:
.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy and edit config
cp .env.example .env

# Create directories
mkdir -p data/tally_inbox data/raw_backup logs

# Start the server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## How to Import Tally XML Files

### Method 1: Drop into inbox (automatic)

Copy your Tally XML export files into:

```
backend/data/tally_inbox/
```

The file watcher detects new or modified `.xml` files and triggers ETL automatically. Check the Import page in the dashboard to see status.

### Method 2: Upload via dashboard

Go to **Import** page → drag-and-drop or browse for XML files.

### Method 3: Copy sample data and import

```bash
# Copy sample files to inbox
cp sample_data/*.xml backend/data/tally_inbox/

# Or import via API directly:
./scripts/import_sample.sh      # Linux/Mac
scripts\import_sample.bat       # Windows
```

### Method 4: API (curl)

```bash
# Upload file
curl -X POST http://localhost:8000/api/import \
  -F "file=@sample_data/Master.xml"

curl -X POST http://localhost:8000/api/import \
  -F "file=@sample_data/Transactions.xml"

# Or provide a server-side path
curl -X POST "http://localhost:8000/api/import?path=/absolute/path/Master.xml"
```

---

## API Reference

### Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/import` | Manual file import |
| GET | `/api/vouchers` | List vouchers with filters |
| GET | `/api/vouchers/{id}` | Voucher detail + raw XML |
| GET | `/api/kpis` | Dashboard KPI metrics |
| GET | `/api/kpis/monthly` | Monthly sales/purchase/GST series |
| GET | `/api/reports/top-customers` | Top N customers |
| GET | `/api/items/top` | Top selling items |
| GET | `/api/export/csv` | CSV download |
| GET | `/api/ledgers` | Ledger master list |
| GET | `/api/items` | Stock item master list |
| GET | `/api/import-logs` | Import history |
| GET | `/api/settings` | Current config |
| POST | `/api/settings/rescan` | Trigger inbox rescan |
| GET | `/api/companies` | Company list |
| GET | `/api/voucher-types` | Distinct voucher types |

### Query Parameters

**GET /api/vouchers**
```
date_from=2024-01-01
date_to=2024-12-31
voucher_type=Sales
ledger=Acme Corp
search=INV/001
company_id=1
page=1
page_size=50
```

**GET /api/kpis**
```
date_from=2024-01-01
date_to=2024-12-31
company_id=1
```

**GET /api/export/csv**
```
voucher_type=Sales
date_from=2024-01-01
date_to=2024-12-31
```

### Example curl Commands

```bash
# Health
curl http://localhost:8000/api/health

# KPIs
curl http://localhost:8000/api/kpis

# Vouchers (filtered)
curl "http://localhost:8000/api/vouchers?voucher_type=Sales&page=1&page_size=10"

# Voucher detail
curl http://localhost:8000/api/vouchers/1

# Top customers
curl "http://localhost:8000/api/reports/top-customers?n=5"

# CSV export
curl "http://localhost:8000/api/export/csv?voucher_type=Sales" -o sales.csv

# Monthly KPIs for 2024
curl "http://localhost:8000/api/kpis/monthly?year=2024"
```

---

## Running Tests

### Backend (pytest)

```bash
cd backend

# Activate venv first
source .venv/bin/activate    # Linux/Mac
.venv\Scripts\activate       # Windows

# Run all tests
pytest -v

# Run specific test files
pytest tests/test_sanitizer.py -v
pytest tests/test_parser.py -v
pytest tests/test_integration.py -v
```

### Frontend (Vitest)

```bash
cd frontend
npm test
```

---

## Docker (Optional)

Build and run everything with Docker Compose:

```bash
# Build and start
docker-compose up --build

# Access:
#   Frontend: http://localhost:3000
#   Backend:  http://localhost:8000

# Drop XML files into ./data/tally_inbox/ (auto-mounted)

# Stop
docker-compose down
```

---

## Configuration (.env)

Create `backend/.env` (copy from `.env.example`):

```env
# Path to watch for XML files
TALLY_INBOX=/absolute/path/to/tally_inbox

# SQLite database location
DATABASE_URL=sqlite:///./tally_dashboard.db

# API
API_HOST=0.0.0.0
API_PORT=8000

# Auth (set AUTH_ENABLED=true for production)
AUTH_ENABLED=false
AUTH_USERNAME=admin
AUTH_PASSWORD=changeme

# Logging
LOG_LEVEL=INFO

# Frontend URL(s) for CORS
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Polling interval (seconds) for file watcher fallback
WATCHER_POLL_INTERVAL=5
```

---

## Data Mapping (Tally XML → DB)

### Vouchers (Transactions.xml)

| Tally XML | DB Column | Notes |
|-----------|-----------|-------|
| `VOUCHER[DATE]` or `<DATE>` | `voucher_date` | Parsed as YYYYMMDD, YYYY-MM-DD, or DD-MM-YYYY |
| `VOUCHER[VOUCHERNUMBER]` | `voucher_number` | |
| `VOUCHER[VOUCHERTYPENAME]` | `voucher_type` | Sales, Purchase, Receipt, Payment, Journal… |
| `<PARTYNAME>` | `party_name` | |
| `<PARTYLEDGERNAME>` | `party_ledger` | Falls back to party_name |
| `<IRN>` | `irn` | Used as unique dedup key when present |
| `<VOUCHERTOTAL>` or computed | `amount` | Sum of debit-side ledger entries |
| `<BILLTOPLACE>` | `billing_city` | |
| `<GSTREGISTRATIONNUMBER>` | `gstin` | |
| `<PLACEOFSUPPLY>` | `place_of_supply` | |
| `ALLLEDGERENTRIES.LIST` | `voucher_lines` | One row per entry |

### Deduplication Logic

1. **If `<IRN>` is present** → use IRN as the unique identifier.
2. **If no IRN** → composite key: `{voucher_type}|{voucher_number}|{company}|{date}`
3. On re-import: **UPDATE** existing record (not duplicate insert). Differences are logged at DEBUG level.

### Masters (Master.xml)

| Node | DB Table | Key Fields |
|------|----------|------------|
| `<COMPANY>` | `companies` | name, gstin, address, state |
| `<LEDGER>` | `ledgers` | name, parent_group, gstin, opening_balance |
| `<UNIT>` | `units` | name, symbol, is_simple_unit |
| `<STOCKITEM>` | `stock_items` | name, unit, hsn_code, gst_rate, opening_balance |

---

## XML Pre-sanitisation

Before parsing, the sanitiser:

1. **Detects encoding** – tries UTF-8, UTF-8-BOM, Windows-1252, Latin-1
2. **Fixes XML declaration** – replaces declared encoding with `utf-8`
3. **Strips invalid XML 1.0 characters** – C0 control bytes (0x00–0x08, 0x0B–0x0C, 0x0E–0x1F, 0x7F) that are illegal in XML 1.0
4. **Saves raw backup** – original bytes saved to `data/raw_backup/` with a timestamp suffix
5. **Logs warnings** – line offsets of removed characters, encoding changes

---

## Ambiguous Choices & Design Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| DB engine | SQLite | Zero-config, single-file, works offline; can be swapped for Postgres |
| Amount sign | Stored as-is from Tally (negative = credit) | Matches Tally's double-entry convention |
| Outstanding receivables | Simplified to total sales amount | Full AR aging needs bill-by-bill matching; documented in KPI response |
| Auth | Disabled by default | App is local; enable via `AUTH_ENABLED=true` |
| GST detection | Any ledger whose name or `TAXTYPE` contains cgst/sgst/igst/tax/cess | Works for standard Tally setups; customise `_TAX_HEADS` in `parser.py` |
| File watcher | Watchdog with PollingObserver fallback | PollingObserver works on Docker bind mounts and Windows where inotify is unavailable |
| Voucher amount | `VOUCHERTOTAL` if present, else max of debit/credit side of ledger entries | Tally doesn't always write `VOUCHERTOTAL` |
| Multi-company | Company auto-detected from `<COMPANY>` node; all data keyed by company_id | Supports multiple companies in one DB |

---

## Dashboard Features

| Page | Features |
|------|----------|
| Dashboard | 8 KPI cards, monthly revenue area chart, monthly GST bar chart, top customers table, top items table |
| Vouchers | Server-side pagination, date/type/party/search filters, CSV export, voucher detail modal (ledger entries + raw XML) |
| Customers | Bar chart + ranked table with average invoice value |
| Items | Ranked table of top selling stock items |
| Import | Drag-and-drop upload, import history, inbox rescan button |
| Settings | Inbox path, DB path, watcher status, auth status |

---

## Changelog

- **v1.0.0** – Initial release
  - FastAPI backend with SQLModel/SQLite
  - Full ETL pipeline: sanitise → parse → upsert (idempotent)
  - Watchdog file watcher with PollingObserver fallback
  - React+Vite+Tailwind dashboard with Recharts
  - Sample data with 5 masters sets + 6 vouchers
  - pytest unit + integration tests
  - Docker Compose for local container deployment
