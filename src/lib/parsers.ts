// src/lib/parsers.ts
// Parsing utilities for sheet data

// --- parsing helpers ---
// Coerce EU/US formatted numbers like "€1.234,56", "1,234.56", "  123 " -> 123.56
export function coerceNumber(input: any): number {
  if (input == null) return 0;
  if (typeof input === 'number') return isFinite(input) ? input : 0;
  
  let s = String(input).trim();
  if (!s) return 0;
  
  // remove currency and spaces
  s = s.replace(/[€$£%\s]/g, '');
  
  // if it looks like EU ("1.234,56"): last comma is decimal, periods are thousands
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  
  if (hasComma && hasDot) {
    // if last comma occurs after last dot, treat comma as decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '');     // remove thousands
      s = s.replace(/,/g, '.');     // decimal
    } else {
      // US style "1,234.56"
      s = s.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    // "123,45" -> "123.45"
    s = s.replace(/,/g, '.');
  } else {
    // "1,234" thousands
    s = s.replace(/,/g, '');
  }
  
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

// Legacy alias for backwards compatibility
export function parseMoneyToNumber(input: string | number | null | undefined): number {
  return coerceNumber(input);
}

// Accepts "yyyy-mm-dd", Excel serials, or Date objects; returns "yyyy-mm-dd" or null
export function coerceDateISO(input: any): string | null {
  if (input == null || input === '') return null;
  
  if (typeof input === 'string') {
    const s = input.trim();
    
    // try yyyy-mm-dd
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    
    // try dd.mm.yyyy or dd. m. yyyy
    const m2 = s.match(/^(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{4})/);
    if (m2) {
      const d = m2[1].padStart(2, '0');
      const mo = m2[2].padStart(2, '0');
      const y = m2[3];
      return `${y}-${mo}-${d}`;
    }
    
    // fallback to Date parsing
    const t = Date.parse(s);
    if (!isNaN(t)) {
      const d = new Date(t);
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${mo}-${dd}`;
    }
    
    return null;
  }
  
  if (typeof input === 'number') {
    // Excel serial
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30
    const ms = input * 86400000;
    const d = new Date(excelEpoch.getTime() + ms);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${dd}`;
  }
  
  if (input instanceof Date) {
    const y = input.getFullYear();
    const mo = String(input.getMonth() + 1).padStart(2, '0');
    const dd = String(input.getDate()).padStart(2, '0');
    return `${y}-${mo}-${dd}`;
  }
  
  return null;
}

// Legacy alias for backwards compatibility
export function toISODate(d: any): string {
  return coerceDateISO(d) || '';
}

export function inRange(iso: string, from: string, to: string): boolean {
  if (!iso) return false;
  return iso >= from && iso <= to;
}

// Ensure we never cache the sheet request
export const SHEETS_FETCH_OPTS: RequestInit = { 
  cache: 'no-store', 
  next: { revalidate: 0 } 
}

/**
 * Parse EU currency format: "€25.929,57" -> 25929.57
 * Handles currency symbols, EU thousands/decimal separators, and falls back to US style.
 */
export function parseEuCurrency(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  let clean = String(value).trim();
  if (!clean) return 0;

  // Remove currency symbols and whitespace
  clean = clean.replace(/[€$£\s]/g, '');

  // Detect EU format (dot as thousands, comma as decimal)
  const isEuFormat = /\d\.\d{3}/.test(clean) || /,\d{1,2}$/.test(clean);
  if (isEuFormat) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else {
    // US format fallback
    clean = clean.replace(/,/g, '');
  }

  const num = parseFloat(clean);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Format Date -> "dd. mm. yyyy" (EU format for Google Sheets)
 */
export function formatDateEu(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}. ${month}. ${year}`;
}

