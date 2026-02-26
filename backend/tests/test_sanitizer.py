"""Unit tests for the XML sanitiser."""
import pytest
from app.etl.sanitizer import sanitize_xml, _strip_invalid_chars, _fix_encoding


class TestStripInvalidChars:
    def test_clean_xml_unchanged(self):
        text = "<ROOT><CHILD>Hello World</CHILD></ROOT>"
        clean, warnings = _strip_invalid_chars(text)
        assert clean == text
        assert warnings == []

    def test_null_byte_removed(self):
        text = "<ROOT>Hello\x00World</ROOT>"
        clean, warnings = _strip_invalid_chars(text)
        assert "\x00" not in clean
        assert len(warnings) == 1
        assert "invalid XML control character" in warnings[0]

    def test_multiple_control_chars_removed(self):
        # Include several C0 control chars: BEL, BS, VT, FF
        text = "<ROOT>\x07\x08\x0BTest\x0C\x1FValue</ROOT>"
        clean, warnings = _strip_invalid_chars(text)
        for char in ["\x07", "\x08", "\x0B", "\x0C", "\x1F"]:
            assert char not in clean
        assert len(warnings) == 1

    def test_tab_newline_carriage_return_preserved(self):
        """Tab (0x09), LF (0x0A), and CR (0x0D) are valid XML chars."""
        text = "<ROOT>\tHello\nWorld\r</ROOT>"
        clean, warnings = _strip_invalid_chars(text)
        assert "\t" in clean
        assert "\n" in clean
        assert "\r" in clean
        assert warnings == []

    def test_no_control_chars_no_warning(self):
        text = "<DATA><NAME>GST: 18%</NAME></DATA>"
        _, warnings = _strip_invalid_chars(text)
        assert warnings == []


class TestFixEncoding:
    def test_utf8_passthrough(self):
        raw = b"<ROOT>Hello</ROOT>"
        result, enc = _fix_encoding(raw)
        assert b"Hello" in result
        assert enc in ("utf-8", "utf-8-sig")

    def test_windows1252_converted(self):
        # Windows-1252 curly quote (0x93)
        raw = b"<ROOT>\x93Windows Quote\x94</ROOT>"
        result, enc = _fix_encoding(raw)
        assert enc in ("windows-1252", "latin-1")
        assert b"Windows Quote" in result

    def test_bom_stripped(self):
        # UTF-8 BOM
        raw = b"\xef\xbb\xbf<ROOT>BOM</ROOT>"
        result, enc = _fix_encoding(raw)
        assert not result.startswith(b"\xef\xbb\xbf")
        assert b"BOM" in result


class TestSanitizeXml:
    def test_valid_xml_passes(self):
        raw = b'<?xml version="1.0" encoding="utf-8"?><ROOT><CHILD>Test</CHILD></ROOT>'
        clean, warnings = sanitize_xml(raw, source_path="test.xml")
        assert b"Test" in clean
        assert b"<ROOT>" in clean

    def test_control_char_in_xml(self):
        raw = b'<?xml version="1.0"?><ROOT><V>Bad\x01Char</V></ROOT>'
        clean, warnings = sanitize_xml(raw, source_path="test.xml")
        assert b"\x01" not in clean
        assert any("control character" in w for w in warnings)

    def test_encoding_declaration_fixed(self):
        # Declare windows-1252 but data is actually UTF-8
        raw = b'<?xml version="1.0" encoding="windows-1252"?><ROOT>Hello</ROOT>'
        clean, warnings = sanitize_xml(raw, source_path="test.xml")
        assert b'encoding="utf-8"' in clean

    def test_empty_input_handled(self):
        raw = b""
        clean, warnings = sanitize_xml(raw, source_path="empty.xml")
        # Should not crash, just return empty bytes or whitespace
        assert isinstance(clean, bytes)
