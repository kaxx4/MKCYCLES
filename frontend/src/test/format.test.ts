import { describe, it, expect } from "vitest";
import { formatCurrency, formatDate, voucherTypeBadgeColor } from "../utils/format";

describe("formatCurrency", () => {
  it("formats positive values in INR", () => {
    const result = formatCurrency(10000);
    expect(result).toContain("10,000");
  });

  it("formats zero", () => {
    const result = formatCurrency(0);
    expect(result).toContain("0");
  });

  it("formats large values", () => {
    const result = formatCurrency(1000000);
    expect(result).toContain("10,00,000");
  });
});

describe("formatDate", () => {
  it("formats ISO date string", () => {
    const result = formatDate("2024-01-15");
    expect(result).toContain("2024");
  });

  it("returns dash for empty string", () => {
    expect(formatDate("")).toBe("—");
  });
});

describe("voucherTypeBadgeColor", () => {
  it("returns green for Sales", () => {
    expect(voucherTypeBadgeColor("Sales")).toContain("green");
  });

  it("returns blue for Purchase", () => {
    expect(voucherTypeBadgeColor("Purchase")).toContain("blue");
  });

  it("returns gray for unknown type", () => {
    expect(voucherTypeBadgeColor("Unknown")).toContain("gray");
  });
});
