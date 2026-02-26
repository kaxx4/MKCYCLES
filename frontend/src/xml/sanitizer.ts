// ══ XML Sanitization: BOM detection, encoding, control char removal ════════

/**
 * Detects encoding from BOM and decodes raw buffer to string.
 * - UTF-16 LE: FF FE → decode as utf-16le
 * - UTF-8 BOM: EF BB BF → decode as utf-8 (BOM is stripped automatically)
 * - No BOM: decode as utf-8
 */
export function detectEncodingAndDecode(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);

  // Check for UTF-16 LE BOM (FF FE)
  if (view.length >= 2 && view[0] === 0xFF && view[1] === 0xFE) {
    const decoder = new TextDecoder('utf-16le');
    return decoder.decode(buffer);
  }

  // Check for UTF-8 BOM (EF BB BF) - TextDecoder strips it automatically
  if (view.length >= 3 && view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(buffer);
  }

  // Default: UTF-8 without BOM
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(buffer);
}

/**
 * Strips XML declaration (<?xml ...?>) if present.
 * Required because fast-xml-parser v4 barfs on encoding="UTF-16" mismatches.
 */
export function stripXmlDeclaration(xml: string): string {
  return xml.replace(/^<\?xml\s+.*?\?>\s*/i, '');
}

/**
 * Removes illegal XML character references: &#N; where N < 0x20 (except tab, LF, CR).
 * Tally XML often contains &#1;, &#2;, etc. which are not valid XML 1.0 chars.
 */
export function stripIllegalControlChars(xml: string): string {
  // Matches &#<number>; where number is 1..31 excluding 9 (tab), 10 (LF), 13 (CR)
  return xml.replace(/&#([0-9]+);/g, (match, numStr) => {
    const code = parseInt(numStr, 10);
    // Keep tab (9), LF (10), CR (13)
    if (code === 9 || code === 10 || code === 13) return match;
    // Remove control chars (0..8, 11..12, 14..31)
    if (code >= 0 && code < 32) return '';
    // Keep everything else
    return match;
  });
}

/**
 * Escapes unescaped ampersands in text content.
 * Tally exports sometimes have bare & in NARRATION, etc.
 * This regex looks for & NOT followed by a valid entity.
 */
export function fixUnescapedAmpersands(xml: string): string {
  // Match & that is NOT followed by: #<digits>; or <word>; (entity references)
  return xml.replace(/&(?!(?:[a-zA-Z]+|#[0-9]+);)/g, '&amp;');
}

/**
 * Master sanitization pipeline.
 * Call this on the decoded string before passing to fast-xml-parser.
 */
export function sanitizeXml(xml: string): string {
  let clean = stripXmlDeclaration(xml);
  clean = stripIllegalControlChars(clean);
  clean = fixUnescapedAmpersands(clean);
  return clean;
}

/**
 * One-shot: read file buffer, detect encoding, decode, sanitize.
 */
export function loadAndSanitizeXmlFile(buffer: ArrayBuffer): string {
  const decoded = detectEncodingAndDecode(buffer);
  return sanitizeXml(decoded);
}
