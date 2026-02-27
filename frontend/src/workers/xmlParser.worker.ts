// Web Worker for parsing XML files in background thread
// This prevents UI freezing during large file processing

import { loadAndSanitizeXmlFile } from "../xml/sanitizer";
import { parseTallyXml } from "../xml/parser";
import { normalizeStockItem, normalizeLedger, normalizeUnit, normalizeVoucher } from "../xml/normalizer";
import type { ParsedData } from "../types/canonical";

export interface WorkerMessage {
  type: "parse";
  fileData: ArrayBuffer;
  fileName: string;
}

export interface WorkerResponse {
  type: "success" | "error";
  data?: ParsedData;
  error?: string;
  fileName: string;
}

// Handle messages from main thread
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, fileData, fileName } = e.data;

  if (type === "parse") {
    console.log(`[Worker] Starting parse for: ${fileName}`);
    try {
      // Step 1: Load and sanitize
      const sanitizedXml = loadAndSanitizeXmlFile(fileData);
      console.log(`[Worker] Sanitized ${fileName}, length: ${sanitizedXml.length}`);

      // Step 2: Parse XML
      const xmlObj = parseTallyXml(sanitizedXml);

      // Step 3: Extract TALLYMESSAGE arrays
      let tallyMessages: any[] = [];

      // Check for ENVELOPE > BODY > TALLYMESSAGE structure
      if (xmlObj.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE) {
        const tm = xmlObj.ENVELOPE.BODY.DATA.TALLYMESSAGE;
        tallyMessages = Array.isArray(tm) ? tm : [tm];
      } else if (xmlObj.ENVELOPE?.BODY?.TALLYMESSAGE) {
        const tm = xmlObj.ENVELOPE.BODY.TALLYMESSAGE;
        tallyMessages = Array.isArray(tm) ? tm : [tm];
      } else if (xmlObj.TALLYMESSAGE) {
        const tm = xmlObj.TALLYMESSAGE;
        tallyMessages = Array.isArray(tm) ? tm : [tm];
      } else if (xmlObj.ENVELOPE?.BODY) {
        // Fallback: treat BODY as a single message
        tallyMessages = [xmlObj.ENVELOPE.BODY];
      }

      // Step 4: Initialize ParsedData
      const parsedData: ParsedData = {
        company: null,
        ledgers: new Map(),
        stockItems: new Map(),
        units: new Map(),
        vouchers: [],
        importedAt: new Date(),
        sourceFiles: [fileName],
        warnings: [],
      };

      // Step 5: Process each TALLYMESSAGE
      for (const msg of tallyMessages) {
        // Extract company info
        if (msg.COMPANY) {
          const companies = Array.isArray(msg.COMPANY) ? msg.COMPANY : [msg.COMPANY];
          for (const companyRaw of companies) {
            if (companyRaw.NAME) {
              parsedData.company = {
                name: companyRaw.NAME,
                gstin: companyRaw.GSTIN || companyRaw.COMPANYGSTREGISTRATIONNO,
                stateName: companyRaw.STATENAME,
                financialYearBegins: companyRaw.COMPANYFISCALYEARSTARTMONTH,
              };
              break;
            }
          }
        }

        // Extract units (must be parsed first for stock items)
        const unitsList = msg['UNIT.LIST'] || [];
        for (const unitRaw of unitsList) {
          const unit = normalizeUnit(unitRaw);
          if (unit) {
            parsedData.units.set(unit.symbol, unit);
          }
        }

        // Extract ledgers
        const ledgersList = msg['LEDGER.LIST'] || [];
        for (const ledgerRaw of ledgersList) {
          const ledger = normalizeLedger(ledgerRaw);
          if (ledger) {
            parsedData.ledgers.set(ledger.nameNormalized, ledger);
          }
        }

        // Extract stock items
        const stockItemsList = msg['STOCKITEM.LIST'] || [];
        for (const itemRaw of stockItemsList) {
          const item = normalizeStockItem(itemRaw, parsedData.units);
          if (item) {
            parsedData.stockItems.set(item.nameNormalized, item);
          }
        }

        // Extract vouchers
        const vouchersList = msg['VOUCHER.LIST'] || [];
        for (const voucherRaw of vouchersList) {
          const voucher = normalizeVoucher(voucherRaw);
          if (voucher) {
            parsedData.vouchers.push(voucher);
          }
        }
      }

      // Send success response
      console.log(`[Worker] Success for ${fileName}: ${parsedData.vouchers.length} vouchers, ${parsedData.stockItems.size} items`);
      const response: WorkerResponse = {
        type: "success",
        data: parsedData,
        fileName,
      };
      self.postMessage(response);
    } catch (error) {
      // Send error response
      console.error(`[Worker] Error parsing ${fileName}:`, error);
      const response: WorkerResponse = {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
        fileName,
      };
      self.postMessage(response);
    }
  }
};

// Export empty object to make TypeScript treat this as a module
export {};
