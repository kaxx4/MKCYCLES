"""
Integration tests: ETL pipeline + API.

Uses an in-memory SQLite DB and the sample XML files.
"""
import json
import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

# Point to a temp DB before importing the app
_tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp_db.close()

os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_db.name}"
os.environ["TALLY_INBOX"] = tempfile.mkdtemp()

from app.main import app  # noqa: E402 – must import after env set
from app.core.database import create_db_and_tables, engine
from app.etl.importer import import_file
from app.models.transaction import Voucher, VoucherLine

SAMPLE_DIR = Path(__file__).parent.parent.parent / "sample_data"


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    create_db_and_tables()
    yield
    # Cleanup
    try:
        os.unlink(_tmp_db.name)
    except Exception:
        pass


@pytest.fixture(scope="module")
def client():
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


@pytest.fixture(scope="module", autouse=True)
def import_sample_data(setup_db):
    """Import sample XML files once for the whole module."""
    for xml_file in ["Master.xml", "Transactions.xml"]:
        path = SAMPLE_DIR / xml_file
        if path.exists():
            import_file(str(path))


class TestETLPipeline:
    def test_vouchers_inserted(self):
        with Session(engine) as s:
            vouchers = s.exec(
                __import__("sqlmodel").select(Voucher)
            ).all()
        assert len(vouchers) >= 5, f"Expected >=5 vouchers, got {len(vouchers)}"

    def test_sales_vouchers_present(self):
        from sqlmodel import select
        with Session(engine) as s:
            sales = s.exec(
                select(Voucher).where(Voucher.voucher_type == "Sales")
            ).all()
        assert len(sales) >= 3

    def test_purchase_vouchers_present(self):
        from sqlmodel import select
        with Session(engine) as s:
            purchases = s.exec(
                select(Voucher).where(Voucher.voucher_type == "Purchase")
            ).all()
        assert len(purchases) >= 2

    def test_voucher_lines_inserted(self):
        from sqlmodel import select
        with Session(engine) as s:
            lines = s.exec(select(VoucherLine)).all()
        assert len(lines) > 0

    def test_irn_deduplication(self):
        """Re-importing the same file should not duplicate vouchers."""
        from sqlmodel import select
        with Session(engine) as s:
            count_before = len(s.exec(select(Voucher)).all())

        if (SAMPLE_DIR / "Transactions.xml").exists():
            import_file(str(SAMPLE_DIR / "Transactions.xml"))

        with Session(engine) as s:
            count_after = len(s.exec(select(Voucher)).all())

        assert count_before == count_after, (
            f"Deduplication failed: {count_before} → {count_after}"
        )

    def test_tax_lines_flagged(self):
        from sqlmodel import select
        with Session(engine) as s:
            tax_lines = s.exec(
                select(VoucherLine).where(VoucherLine.is_tax_line == True)
            ).all()
        assert len(tax_lines) > 0

    def test_raw_xml_stored(self):
        from sqlmodel import select
        with Session(engine) as s:
            v = s.exec(
                select(Voucher).where(Voucher.voucher_type == "Sales")
            ).first()
        assert v is not None
        assert v.raw_xml is not None
        assert "VOUCHER" in v.raw_xml


class TestAPIEndpoints:
    def test_health(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert "db" in data

    def test_list_vouchers(self, client):
        r = client.get("/api/vouchers")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 5

    def test_list_vouchers_filter_type(self, client):
        r = client.get("/api/vouchers?voucher_type=Sales")
        assert r.status_code == 200
        data = r.json()
        for item in data["items"]:
            assert item["voucher_type"] == "Sales"

    def test_list_vouchers_pagination(self, client):
        r = client.get("/api/vouchers?page=1&page_size=2")
        assert r.status_code == 200
        data = r.json()
        assert len(data["items"]) <= 2

    def test_get_voucher_detail(self, client):
        r = client.get("/api/vouchers")
        items = r.json()["items"]
        assert len(items) > 0
        vid = items[0]["id"]

        r2 = client.get(f"/api/vouchers/{vid}")
        assert r2.status_code == 200
        detail = r2.json()
        assert detail["id"] == vid
        assert "lines" in detail

    def test_get_voucher_not_found(self, client):
        r = client.get("/api/vouchers/99999")
        assert r.status_code == 404

    def test_kpis(self, client):
        r = client.get("/api/kpis")
        assert r.status_code == 200
        data = r.json()
        assert "total_sales" in data
        assert "total_purchases" in data
        assert "gst_collected" in data
        assert data["total_sales"] > 0

    def test_kpis_monthly(self, client):
        r = client.get("/api/kpis/monthly")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_top_customers(self, client):
        r = client.get("/api/reports/top-customers")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            assert "party_name" in data[0]
            assert "total_amount" in data[0]

    def test_top_items(self, client):
        r = client.get("/api/items/top")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_csv_export(self, client):
        r = client.get("/api/export/csv?voucher_type=Sales")
        assert r.status_code == 200
        assert "text/csv" in r.headers["content-type"]
        content = r.text
        assert "voucher_number" in content  # CSV header

    def test_voucher_types(self, client):
        r = client.get("/api/voucher-types")
        assert r.status_code == 200
        types = r.json()
        assert isinstance(types, list)
        assert "Sales" in types

    def test_import_logs(self, client):
        r = client.get("/api/import-logs")
        assert r.status_code == 200
        logs = r.json()
        assert isinstance(logs, list)
        assert len(logs) >= 2  # Master + Transactions

    def test_settings(self, client):
        r = client.get("/api/settings")
        assert r.status_code == 200
        data = r.json()
        assert "inbox_path" in data
        assert "watcher_active" in data

    def test_companies(self, client):
        r = client.get("/api/companies")
        assert r.status_code == 200
        companies = r.json()
        assert isinstance(companies, list)


class TestManualImport:
    def test_upload_xml_file(self, client):
        """Upload the sample Transactions.xml via multipart."""
        path = SAMPLE_DIR / "Transactions.xml"
        if not path.exists():
            pytest.skip("Sample Transactions.xml not found")

        with open(path, "rb") as f:
            r = client.post(
                "/api/import",
                files={"file": ("Transactions.xml", f, "text/xml")},
            )
        assert r.status_code == 200
        data = r.json()
        assert data["status"] in ("success", "partial")

    def test_import_bad_path(self, client):
        r = client.post("/api/import?path=/nonexistent/file.xml")
        assert r.status_code == 404

    def test_import_no_params(self, client):
        r = client.post("/api/import")
        assert r.status_code == 400
