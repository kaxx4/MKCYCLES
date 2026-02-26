"""Unit tests for the Tally XML parser."""
import pytest
from datetime import date
from xml.etree import ElementTree as ET
from app.etl.parser import (
    parse_voucher,
    parse_ledger,
    parse_unit,
    parse_stock_item,
    parse_company,
    parse_xml_file,
    _date,
    _infer_ledger_type,
)


SAMPLE_MASTER_XML = b"""<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <BODY>
    <IMPORTDATA>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <COMPANY NAME="Test Co">
            <BASICCOMPANYNAME>Test Co</BASICCOMPANYNAME>
            <GSTIN>29AABCT9999Z1Z1</GSTIN>
          </COMPANY>
          <UNIT NAME="Nos">
            <ORIGINALNAME>Nos</ORIGINALNAME>
            <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
          </UNIT>
          <LEDGER NAME="ABC Corp">
            <PARENT>Sundry Debtors</PARENT>
            <PARTYGSTIN>27AABCA1234B1Z5</PARTYGSTIN>
            <OPENINGBALANCE>10000</OPENINGBALANCE>
          </LEDGER>
          <STOCKITEM NAME="Product A">
            <BASEUNITS>Nos</BASEUNITS>
            <HSNCODE>8543</HSNCODE>
            <TAXRATE>18</TAXRATE>
            <OPENINGBALANCE>50</OPENINGBALANCE>
          </STOCKITEM>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""

SAMPLE_TXN_XML = b"""<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <BODY>
    <IMPORTDATA>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <VOUCHER VOUCHERTYPENAME="Sales" VOUCHERNUMBER="SI/001" DATE="20240115">
            <DATE>20240115</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>SI/001</VOUCHERNUMBER>
            <PARTYNAME>ABC Corp</PARTYNAME>
            <IRN>aabbccdd1122334455667788aabbccdd1122334455667788aabbccdd11223344</IRN>
            <NARRATION>Test sale</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>ABC Corp</LEDGERNAME>
              <AMOUNT>-11800</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Sales</LEDGERNAME>
              <AMOUNT>10000</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>CGST</LEDGERNAME>
              <AMOUNT>900</AMOUNT>
              <TAXTYPE>CGST</TAXTYPE>
              <TAXRATE>9</TAXRATE>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>SGST</LEDGERNAME>
              <AMOUNT>900</AMOUNT>
              <TAXTYPE>SGST</TAXTYPE>
              <TAXRATE>9</TAXRATE>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""


class TestDateParser:
    def test_yyyymmdd(self):
        assert _date("20240115") == date(2024, 1, 15)

    def test_yyyy_mm_dd(self):
        assert _date("2024-01-15") == date(2024, 1, 15)

    def test_dd_mm_yyyy(self):
        assert _date("15-01-2024") == date(2024, 1, 15)

    def test_invalid_returns_none(self):
        assert _date("not-a-date") is None

    def test_whitespace_stripped(self):
        assert _date("  20240115  ") == date(2024, 1, 15)


class TestLedgerTypeInference:
    def test_debtor(self):
        assert _infer_ledger_type("Sundry Debtors") == "Debtor"

    def test_creditor(self):
        assert _infer_ledger_type("Sundry Creditors") == "Creditor"

    def test_bank(self):
        assert _infer_ledger_type("Bank Accounts") == "Bank"

    def test_tax(self):
        assert _infer_ledger_type("Duties & Taxes") == "Tax"

    def test_unknown(self):
        assert _infer_ledger_type("Other Liabilities") == "Other"


class TestParseLedger:
    def test_basic_fields(self):
        xml = '<LEDGER NAME="Test Party"><PARENT>Sundry Debtors</PARENT><OPENINGBALANCE>5000</OPENINGBALANCE></LEDGER>'
        el = ET.fromstring(xml)
        result = parse_ledger(el)
        assert result["name"] == "Test Party"
        assert result["parent_group"] == "Sundry Debtors"
        assert result["opening_balance"] == 5000.0
        assert result["ledger_type"] == "Debtor"

    def test_gstin_extracted(self):
        xml = '<LEDGER NAME="Vendor"><PARENT>Sundry Creditors</PARENT><PARTYGSTIN>29AABCV1234X1Z1</PARTYGSTIN></LEDGER>'
        el = ET.fromstring(xml)
        result = parse_ledger(el)
        assert result["gstin"] == "29AABCV1234X1Z1"


class TestParseUnit:
    def test_simple_unit(self):
        xml = '<UNIT NAME="Nos"><ORIGINALNAME>Nos</ORIGINALNAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>'
        el = ET.fromstring(xml)
        result = parse_unit(el)
        assert result["name"] == "Nos"
        assert result["is_simple_unit"] is True


class TestParseStockItem:
    def test_basic_fields(self):
        xml = """<STOCKITEM NAME="Widget">
            <BASEUNITS>Nos</BASEUNITS>
            <HSNCODE>8543</HSNCODE>
            <TAXRATE>18</TAXRATE>
            <GSTAPPLICABLE>Yes</GSTAPPLICABLE>
            <STANDARDRATE>1000</STANDARDRATE>
            <OPENINGBALANCE>100</OPENINGBALANCE>
        </STOCKITEM>"""
        el = ET.fromstring(xml)
        result = parse_stock_item(el)
        assert result["name"] == "Widget"
        assert result["hsn_code"] == "8543"
        assert result["gst_rate"] == 18.0
        assert result["gst_applicable"] is True
        assert result["opening_balance"] == 100.0


class TestParseVoucher:
    def test_basic_voucher(self):
        xml = """<VOUCHER VOUCHERTYPENAME="Sales" VOUCHERNUMBER="INV/001" DATE="20240301">
            <DATE>20240301</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>INV/001</VOUCHERNUMBER>
            <PARTYNAME>Customer A</PARTYNAME>
            <NARRATION>Test</NARRATION>
        </VOUCHER>"""
        el = ET.fromstring(xml)
        result = parse_voucher(el)
        assert result["voucher_number"] == "INV/001"
        assert result["voucher_type"] == "Sales"
        assert result["voucher_date"] == date(2024, 3, 1)
        assert result["party_name"] == "Customer A"

    def test_irn_extracted(self):
        xml = """<VOUCHER VOUCHERTYPENAME="Sales" VOUCHERNUMBER="INV/002" DATE="20240302">
            <DATE>20240302</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>INV/002</VOUCHERNUMBER>
            <IRN>abc123def456abc123def456abc123def456abc123def456abc123def456abc1</IRN>
        </VOUCHER>"""
        el = ET.fromstring(xml)
        result = parse_voucher(el)
        assert result["irn"] is not None
        assert len(result["irn"]) > 10

    def test_ledger_lines_parsed(self):
        xml = """<VOUCHER VOUCHERTYPENAME="Sales" VOUCHERNUMBER="INV/003" DATE="20240303">
            <DATE>20240303</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>INV/003</VOUCHERNUMBER>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Customer X</LEDGERNAME>
              <AMOUNT>-11800</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Sales</LEDGERNAME>
              <AMOUNT>10000</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>CGST</LEDGERNAME>
              <AMOUNT>900</AMOUNT>
              <TAXTYPE>CGST</TAXTYPE>
            </ALLLEDGERENTRIES.LIST>
        </VOUCHER>"""
        el = ET.fromstring(xml)
        result = parse_voucher(el)
        assert len(result["lines"]) == 3
        tax_lines = [l for l in result["lines"] if l["is_tax_line"]]
        assert len(tax_lines) == 1
        assert tax_lines[0]["ledger_name"] == "CGST"

    def test_raw_xml_stored(self):
        xml = '<VOUCHER VOUCHERTYPENAME="Journal" VOUCHERNUMBER="J/001" DATE="20240101"><DATE>20240101</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>J/001</VOUCHERNUMBER></VOUCHER>'
        el = ET.fromstring(xml)
        result = parse_voucher(el)
        assert result["raw_xml"] is not None
        assert "VOUCHER" in result["raw_xml"]


class TestParseXmlFile:
    def test_master_file_detected(self):
        result = parse_xml_file(SAMPLE_MASTER_XML)
        assert result["file_type"] == "master"
        assert result["company"] is not None
        assert result["company"]["name"] == "Test Co"
        assert len(result["ledgers"]) == 1
        assert len(result["units"]) == 1
        assert len(result["stock_items"]) == 1

    def test_transaction_file_detected(self):
        result = parse_xml_file(SAMPLE_TXN_XML)
        assert result["file_type"] == "transaction"
        assert len(result["vouchers"]) == 1
        assert result["vouchers"][0]["voucher_number"] == "SI/001"
        assert result["vouchers"][0]["voucher_date"] == date(2024, 1, 15)

    def test_voucher_lines_count(self):
        result = parse_xml_file(SAMPLE_TXN_XML)
        lines = result["vouchers"][0]["lines"]
        assert len(lines) == 4  # party + sales + cgst + sgst

    def test_tax_lines_identified(self):
        result = parse_xml_file(SAMPLE_TXN_XML)
        lines = result["vouchers"][0]["lines"]
        tax = [l for l in lines if l["is_tax_line"]]
        assert len(tax) == 2  # CGST + SGST

    def test_invalid_xml_raises(self):
        with pytest.raises(ValueError):
            parse_xml_file(b"<UNCLOSED_TAG>")
