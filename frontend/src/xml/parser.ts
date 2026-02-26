// ══ fast-xml-parser Configuration ══════════════════════════════════════════
// Tally XML uses wrapper tags for lists; we must configure isArray for each.

import { XMLParser, type X2jOptions } from 'fast-xml-parser';

/**
 * Complete list of Tally list wrapper tags that must be treated as arrays.
 * Even if they contain only one child element, fast-xml-parser must parse them as arrays.
 */
const TALLY_LIST_TAGS = [
  // Top-level collections
  'LEDGER.LIST',
  'STOCKITEM.LIST',
  'UNIT.LIST',
  'VCHTYPE.LIST',
  'VOUCHER.LIST',
  'STOCKGROUP.LIST',

  // Voucher sub-elements
  'ALLLEDGERENTRIES.LIST',
  'INVENTORYENTRIES.LIST',
  'LEDGERENTRIES.LIST',
  'ALLINVENTORYENTRIES.LIST',

  // Bill allocations
  'BILLALLOCATIONS.LIST',

  // Batch/accounting allocations (rare, but exist)
  'BATCHALLOCATIONS.LIST',
  'ACCOUNTINGALLOCATIONS.LIST',

  // Category allocations (for cost centers)
  'CATEGORYALLOCATIONS.LIST',

  // Address/contact lists (in LEDGER)
  'ADDRESS.LIST',
  'BASICBANKDETAILS.LIST',

  // Alternate units (in STOCKITEM)
  'GSTDETAILS.LIST',
  'LANGUAGENAME.LIST',
  'BATCHNAME.LIST',
  'GODOWNNAME.LIST',
];

/**
 * fast-xml-parser options for Tally XML.
 * - ignoreAttributes: false → parse attributes (e.g., NAME, PARENT)
 * - attributeNamePrefix: "@" → attributes become {@NAME: "value"}
 * - textNodeName: "#text" → text content becomes {#text: "value"}
 * - isArray: function → force array for Tally list tags
 * - parseTagValue: false → keep all values as strings (we parse manually)
 * - parseAttributeValue: false → keep attributes as strings
 * - trimValues: true → strip leading/trailing whitespace
 * - ignoreDeclaration: true → skip <?xml?> (we already stripped it)
 * - ignorePiTags: true → ignore processing instructions
 */
export const TALLY_PARSER_OPTIONS: Partial<X2jOptions> = {
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,

  // Force array for all known Tally list tags
  isArray: (tagName: string): boolean => {
    return TALLY_LIST_TAGS.includes(tagName);
  },
};

/**
 * Create a pre-configured XMLParser instance for Tally XML.
 */
export function createTallyParser(): XMLParser {
  return new XMLParser(TALLY_PARSER_OPTIONS);
}

/**
 * Parse sanitized Tally XML string into JS object.
 * Throws if XML is malformed.
 */
export function parseTallyXml(sanitizedXml: string): any {
  const parser = createTallyParser();
  return parser.parse(sanitizedXml);
}
