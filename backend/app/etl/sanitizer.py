"""
XML Pre-sanitizer for Tally exports.

Tally XML files often contain:
- C0 control characters (bytes 0x00-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F)
- Invalid UTF-8 byte sequences
- Bare & ampersands in text nodes (not escaped as &amp;)
- Windows-1252 encoding mislabelled as UTF-8

This module sanitises the raw bytes BEFORE feeding them to an XML parser,
and returns both a clean bytes object and a list of warning messages.
"""

import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Tuple

from loguru import logger

# Large file threshold for chunk-based sanitization (100 MB)
SANITIZE_CHUNK_THRESHOLD = 100 * 1024 * 1024

# Valid XML 1.0 character ranges (per XML spec §2.2)
# Allowed: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
# Also include \uFEFF (BOM character) which can slip through encoding detection
_INVALID_XML_CHAR_RE = re.compile(
    r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFEFF]"
)

# Invalid XML character number references (e.g. &#12; or &#x0B;)
# These point to disallowed control characters
_INVALID_CHAR_REF_RE = re.compile(
    r"&#(?:x([0-9a-fA-F]+)|([0-9]+));",
    re.IGNORECASE,
)

# XML declaration pattern (to detect / fix encoding declarations)
_XML_DECL_RE = re.compile(
    rb'<\?xml[^?]*encoding=["\']([^"\']+)["\'][^?]*\?>',
    re.IGNORECASE,
)


def _fix_encoding(raw: bytes) -> Tuple[bytes, str]:
    """
    Detect and normalise the byte stream to UTF-8.

    Returns (utf8_bytes, detected_encoding).
    """
    # Check for UTF-16 BOM first (MKCP files use UTF-16 LE)
    if raw.startswith(b"\xff\xfe"):
        # UTF-16 LE BOM
        try:
            text = raw.decode("utf-16-le")
            fixed = text.encode("utf-8")
            # Strip UTF-8 BOM if present
            if fixed.startswith(b"\xef\xbb\xbf"):
                fixed = fixed[3:]
            # Also strip Unicode BOM from the text if it slipped through
            text = fixed.decode("utf-8", errors="replace")
            if text.startswith("\ufeff"):
                text = text[1:]
            return text.encode("utf-8"), "utf-16-le"
        except (UnicodeDecodeError, LookupError):
            pass
    elif raw.startswith(b"\xfe\xff"):
        # UTF-16 BE BOM
        try:
            text = raw.decode("utf-16-be")
            fixed = text.encode("utf-8")
            if fixed.startswith(b"\xef\xbb\xbf"):
                fixed = fixed[3:]
            # Also strip Unicode BOM from the text if it slipped through
            text = fixed.decode("utf-8", errors="replace")
            if text.startswith("\ufeff"):
                text = text[1:]
            return text.encode("utf-8"), "utf-16-be"
        except (UnicodeDecodeError, LookupError):
            pass

    # Try UTF-8 and other encodings
    for enc in ("utf-8-sig", "utf-8", "utf-16", "windows-1252", "latin-1"):
        try:
            text = raw.decode(enc)
            # Re-encode to UTF-8
            fixed = text.encode("utf-8")
            # Strip BOM if present
            if fixed.startswith(b"\xef\xbb\xbf"):
                fixed = fixed[3:]
            return fixed, enc
        except (UnicodeDecodeError, LookupError):
            continue
    # Last resort: decode with replacement
    text = raw.decode("utf-8", errors="replace")
    return text.encode("utf-8"), "utf-8(replaced)"


def _strip_invalid_chars(text: str) -> Tuple[str, list[str]]:
    """
    Remove C0 control characters that are illegal in XML 1.0.

    Returns (clean_text, list_of_warning_strings).
    """
    warnings: list[str] = []
    positions: list[int] = []

    for m in _INVALID_XML_CHAR_RE.finditer(text):
        positions.append(m.start())

    if positions:
        warnings.append(
            f"Removed {len(positions)} invalid XML control character(s) "
            f"at byte offsets: {positions[:20]}"  # cap at 20 for brevity
        )

    clean = _INVALID_XML_CHAR_RE.sub("", text)
    return clean, warnings


def _strip_invalid_char_refs(text: str) -> Tuple[str, list[str]]:
    """
    Remove invalid XML character references (e.g., &#12; or &#x0B;).
    
    Character references pointing to invalid characters (control characters,
    surrogates, etc.) are stripped out.
    
    Returns (clean_text, list_of_warning_strings).
    """
    warnings: list[str] = []
    invalid_refs: list[str] = []
    
    def is_valid_xml_char(codepoint: int) -> bool:
        """Check if a codepoint is valid in XML 1.0"""
        # Valid ranges: #x9, #xA, #xD, [#x20-#xD7FF], [#xE000-#xFFFD], [#x10000-#x10FFFF]
        if codepoint == 0x9 or codepoint == 0xA or codepoint == 0xD:
            return True
        if 0x20 <= codepoint <= 0xD7FF:
            return True
        if 0xE000 <= codepoint <= 0xFFFD:
            return True
        if 0x10000 <= codepoint <= 0x10FFFF:
            return True
        return False
    
    def replace_ref(m: re.Match) -> str:
        """Replace invalid char ref with empty string"""
        hex_val = m.group(1)
        dec_val = m.group(2)
        
        try:
            if hex_val:
                codepoint = int(hex_val, 16)
            else:
                codepoint = int(dec_val, 10)
            
            if not is_valid_xml_char(codepoint):
                invalid_refs.append(m.group(0))
                return ""  # Remove invalid character reference
            return m.group(0)  # Keep valid reference
        except (ValueError, OverflowError):
            invalid_refs.append(m.group(0))
            return ""  # Remove unparseable reference
    
    clean = _INVALID_CHAR_REF_RE.sub(replace_ref, text)
    
    if invalid_refs:
        warnings.append(
            f"Removed {len(invalid_refs)} invalid character reference(s): "
            f"{invalid_refs[:10]}"  # cap at 10 for brevity
        )
    
    return clean, warnings


def _fix_xml_declaration(raw_bytes: bytes) -> bytes:
    """
    Replace the encoding declaration to utf-8 so the parser agrees
    with the byte stream we produce.
    """
    def replace_decl(m: re.Match) -> bytes:
        decl = m.group(0)
        # Replace whatever encoding is declared with utf-8
        decl = re.sub(
            rb'encoding=["\'][^"\']+["\']',
            b'encoding="utf-8"',
            decl,
            flags=re.IGNORECASE,
        )
        return decl

    return _XML_DECL_RE.sub(replace_decl, raw_bytes, count=1)


def _sanitize_large(raw: bytes, source_path: str) -> Tuple[bytes, list[str]]:
    """
    Memory-efficient sanitisation for large UTF-16 files.
    Decodes and sanitizes in a single pass to avoid double-buffering.

    Parameters
    ----------
    raw:         Raw bytes from the file (may be >100MB).
    source_path: File path for logging.

    Returns
    -------
    (clean_bytes, warnings)
    """
    warnings: list[str] = []

    # Detect encoding
    if raw.startswith(b'\xff\xfe'):
        encoding = 'utf-16-le'
        raw = raw[2:]  # strip BOM
    elif raw.startswith(b'\xfe\xff'):
        encoding = 'utf-16-be'
        raw = raw[2:]
    else:
        encoding = 'utf-8'
        # Strip UTF-8 BOM if present
        if raw.startswith(b'\xef\xbb\xbf'):
            raw = raw[3:]

    warnings.append(f"Large file mode: Re-encoded from {encoding} to UTF-8")
    logger.info(f"{source_path}: Large file mode ({len(raw):,} bytes), encoding={encoding}")

    # Decode in one pass
    text = raw.decode(encoding, errors='replace')

    # Strip BOM char if it slipped through
    if text.startswith('\ufeff'):
        text = text[1:]

    # Apply regex substitutions (these operate on the string in-place)
    text, ref_w = _strip_invalid_char_refs(text)
    warnings.extend(ref_w)
    if ref_w:
        logger.warning(f"{source_path}: {ref_w[0]}")

    text, char_w = _strip_invalid_chars(text)
    warnings.extend(char_w)
    if char_w:
        logger.warning(f"{source_path}: {char_w[0]}")

    clean_bytes = text.encode('utf-8')
    clean_bytes = _fix_xml_declaration(clean_bytes)

    return clean_bytes, warnings


def sanitize_xml(
    raw: bytes,
    *,
    source_path: str = "<unknown>",
    backup_dir: Path | None = None,
) -> Tuple[bytes, list[str]]:
    """
    Full sanitisation pipeline.

    1. Save raw backup copy.
    2. Decode to UTF-8 (auto-detect encoding), strip BOM.
    3. Strip invalid character references (&#N;).
    4. Strip raw invalid control chars (including \uFEFF BOM).
    5. Fix XML declaration.
    6. Return clean UTF-8 bytes + warnings list.

    Parameters
    ----------
    raw:         Raw bytes from the file.
    source_path: File path string (used for logging and backup naming).
    backup_dir:  If provided, the original raw bytes are saved here.

    Returns
    -------
    (clean_bytes, warnings)
    """
    warnings: list[str] = []

    # --- 1. Raw backup ---
    if backup_dir:
        backup_dir = Path(backup_dir)
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S")
        src = Path(source_path)
        backup_path = backup_dir / f"{src.stem}_{stamp}{src.suffix}.bak"
        try:
            backup_path.write_bytes(raw)
            logger.debug(f"Raw backup saved to {backup_path}")
        except OSError as e:
            warnings.append(f"Could not write raw backup: {e}")

    # --- 2. Choose sanitization path based on file size ---
    if len(raw) > SANITIZE_CHUNK_THRESHOLD:
        clean_bytes, enc_warnings = _sanitize_large(raw, source_path)
        warnings.extend(enc_warnings)
    else:
        # --- 2a. Decode to UTF-8, strip BOM ---
        utf8_bytes, detected_enc = _fix_encoding(raw)
        if detected_enc != "utf-8":
            warnings.append(f"Re-encoded from {detected_enc} to UTF-8")
            logger.info(f"{source_path}: Re-encoded from {detected_enc}")

        # --- 3. Decode to str for char-level cleaning ---
        text = utf8_bytes.decode("utf-8", errors="replace")

        # --- 4. Strip invalid &#N; character references ---
        text, ref_warnings = _strip_invalid_char_refs(text)
        warnings.extend(ref_warnings)
        if ref_warnings:
            logger.warning(f"{source_path}: {ref_warnings[0]}")

        # --- 5. Strip raw invalid control chars (includes \uFEFF BOM if any) ---
        text, char_warnings = _strip_invalid_chars(text)
        warnings.extend(char_warnings)
        if char_warnings:
            logger.warning(f"{source_path}: {char_warnings[0]}")

        # --- 6. Re-encode, fix XML declaration ---
        clean_bytes = text.encode("utf-8")
        clean_bytes = _fix_xml_declaration(clean_bytes)

    return clean_bytes, warnings
