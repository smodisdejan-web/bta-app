// src/lib/utils.ts 
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  ZAR: 'R' // South African Rand
}

export const CURRENCY_OPTIONS = [
  { value: '$', label: 'USD ($)' },
  { value: 'A$', label: 'AUD (A$)' },
  { value: 'C$', label: 'CAD (C$)' },
  { value: '€', label: 'EUR (€)' },
  { value: '£', label: 'GBP (£)' },
  { value: 'R', label: 'ZAR (R)' } // South African Rand
] as const

export function formatCurrency(value: number, currency: string): string {
  if (value == null || typeof value !== 'number' || isNaN(value)) {
    return `${currency}0.00`;
  }
  return `${currency}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatCurrencyForAxis(value: number, currency: string): string {
  return `${currency}${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function formatNumber(value: number): string {
  if (value == null || typeof value !== 'number' || isNaN(value)) {
    return '-';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })
}

export function formatPercent(value: number): string {
  if (value == null || typeof value !== 'number' || isNaN(value)) {
    return '-';
  }
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

export function formatConversions(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function formatConversionsForAxis(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function parseMetric(value: unknown): number {
  // Accept number or string, return a safe number (NaN -> 0)
  if (typeof value === "number") return isFinite(value) ? value : 0;
  if (value == null) return 0;

  let s = String(value).trim();

  // Remove currency symbols and spaces
  s = s.replace(/[€$£¥\s]/g, "");

  // If it already looks like a pure number (optional minus, digits, optional dot, digits), use it
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }

  // Handle EU formats like "8.273,54" or "4,128.94" with mixed separators.
  // Strategy:
  // 1) Determine the last separator (dot or comma) — we treat it as the decimal separator.
  // 2) Remove all other separators.
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  const lastSep = Math.max(lastDot, lastComma);

  if (lastSep >= 0) {
    const decSep = s[lastSep];
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, ""); // drop all seps in int part
    const fracPart = s.slice(lastSep + 1).replace(/[.,]/g, ""); // drop all in frac
    const normalized = `${intPart}.${fracPart}`;
    const n = Number(normalized);
    return isFinite(n) ? n : 0;
  }

  // Fallback: strip non-digits except minus, then Number
  const cleaned = s.replace(/[^0-9-]/g, "");
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

export function parseIntMetric(value: unknown): number {
  // For counts like leads; allow strings-with-commas
  if (typeof value === "number") return isFinite(value) ? value : 0;
  if (value == null) return 0;
  const s = String(value).trim().replace(/[^\d-]/g, "");
  const n = Number(s);
  return isFinite(n) ? n : 0;
}
