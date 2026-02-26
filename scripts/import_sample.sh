#!/usr/bin/env bash
# Import sample data via the API
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

API="http://localhost:8000/api"

echo "Importing Master.xml..."
curl -s -X POST "$API/import" \
  -F "file=@$ROOT/sample_data/Master.xml" | python3 -m json.tool

echo ""
echo "Importing Transactions.xml..."
curl -s -X POST "$API/import" \
  -F "file=@$ROOT/sample_data/Transactions.xml" | python3 -m json.tool

echo ""
echo "Done! Dashboard KPIs:"
curl -s "$API/kpis" | python3 -m json.tool
