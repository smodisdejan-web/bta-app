// src/lib/sheetsData.ts
// Robust data loaders with aliasing, date parsing, and error handling

import { AdMetric, Campaign, SearchTermMetric, TabData, AdGroupRecord } from './types'
import { SheetTab, TAB_CONFIGS, DEFAULT_WEB_APP_URL, SHEETS_TABS, getSheetsUrl } from './config'
import { fetchJson } from './fetch-json'

// ============================================================================
// Utility Functions
// ============================================================================

type Row = Record<string, any>;

/**
 * Normalize headers to lowercase and trimmed
 */
export function normalizeHeaders(row: any[]): string[] {
  return row.map(c => String(c || '').trim().toLowerCase());
}

/**
 * Find column index by checking multiple aliases (case-insensitive)
 */
export function pickIdx(headers: string[], aliases: string[]): number {
  const normalized = headers.map(h => h.toLowerCase().trim());
  for (const alias of aliases) {
    const normalizedAlias = alias.toLowerCase().trim();
    const idx = normalized.indexOf(normalizedAlias);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Pick first matching value from row by alias list (for object rows)
 */
function pick(row: Row, aliases: string[]): any {
  for (const k of aliases) {
    const val = row[k];
    if (val !== undefined && val !== null && val !== '') return val;
    // Also try lowercase
    const lk = k.toLowerCase();
    const keys = Object.keys(row);
    for (const rk of keys) {
      if (rk.toLowerCase() === lk && row[rk] !== undefined && row[rk] !== null && row[rk] !== '') {
        return row[rk];
      }
    }
  }
  return undefined;
}

/**
 * Convert any date value to ISO day string (YYYY-MM-DD)
 * Supports: ISO strings, Excel serials, JS Date, EU formats (DD.MM.YYYY), US formats (MM/DD/YYYY)
 */
export function toIsoDay(value: any): string | null {
  if (value == null || value === '') return null;

  // Handle Date objects
  if (value instanceof Date && !isNaN(+value)) {
    return value.toISOString().slice(0, 10);
  }

  // Handle numbers (Excel serial or epoch ms)
  if (typeof value === 'number') {
    if (value > 10_000_000_000) {
      // Epoch milliseconds
      const d = new Date(value);
      if (!isNaN(+d)) return d.toISOString().slice(0, 10);
    } else if (value > 1 && value < 100000) {
      // Excel serial date (days since 1899-12-30)
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(excelEpoch.getTime() + value * 86400_000);
      if (!isNaN(+d)) return d.toISOString().slice(0, 10);
    }
    return null;
  }

  // Handle strings
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Try ISO format first: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return isoMatch[0];
    }

    // Try EU format: DD.MM.YYYY or D.M.YYYY (with spaces: "5. 12. 2025")
    const euMatch = trimmed.match(/^(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/);
    if (euMatch) {
      const [, d, m, y] = euMatch;
      const dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      const date = new Date(dateStr + 'T00:00:00Z');
      if (!isNaN(+date)) return date.toISOString().slice(0, 10);
    }

    // Try US format: MM/DD/YYYY
    const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usMatch) {
      const [, m, d, y] = usMatch;
      const dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      const date = new Date(dateStr + 'T00:00:00Z');
      if (!isNaN(+date)) return date.toISOString().slice(0, 10);
    }

    // Try DD/MM/YYYY (common in EU)
    const euSlashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (euSlashMatch) {
      const [, d, m, y] = euSlashMatch;
      const dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      const date = new Date(dateStr + 'T00:00:00Z');
      if (!isNaN(+date)) return date.toISOString().slice(0, 10);
    }

    // Try standard Date parsing as fallback
    const parsed = new Date(trimmed);
    if (!isNaN(+parsed)) {
      const iso = parsed.toISOString().slice(0, 10);
      // Validate reasonable year (1990-2100)
      const year = parseInt(iso.slice(0, 4));
      if (year >= 1990 && year <= 2100) return iso;
    }
  }

  return null;
}

/**
 * Convert any number value to number with robust EU/US format support
 * Supports: EU format (1.234,56), US format (1,234.56), plain numbers
 * Aggressively strips currency symbols (€$£¥₹), whitespace, NBSP (\u00A0), narrow NBSP (\u202F)
 */
export function toNumberEUorUS(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;

  // Convert to string
  let trimmed = String(value)
    .replace(/[€$£¥₹\s\u00A0\u202F\u2009]/g, '') // currency, spaces, NBSP, narrow NBSP
    .replace(/[^\d.,-]/g, '') // keep only digits, dots, commas, minus
    .trim();
  
  if (!trimmed) return 0;

  // Count dots and commas
  const dotCount = (trimmed.match(/\./g) || []).length;
  const commaCount = (trimmed.match(/,/g) || []).length;

  let cleaned = trimmed;

  if (dotCount > 0 && commaCount > 0) {
    // Mixed format - determine which is decimal separator
    const lastDot = trimmed.lastIndexOf('.');
    const lastComma = trimmed.lastIndexOf(',');
    if (lastDot > lastComma) {
      // US format: "1,234.56"
      cleaned = trimmed.replace(/,/g, '');
    } else {
      // EU format: "1.234,56"
      cleaned = trimmed.replace(/\./g, '').replace(',', '.');
    }
  } else if (commaCount === 1 && dotCount === 0) {
    // Single comma - check if decimal separator
    const afterComma = trimmed.slice(trimmed.indexOf(',') + 1);
    if (afterComma.length <= 3 && /^\d+$/.test(afterComma)) {
      // Likely decimal separator (EU format like "88,98")
      cleaned = trimmed.replace(',', '.');
    } else {
      // Likely thousands separator
      cleaned = trimmed.replace(',', '');
    }
  } else if (dotCount === 1 && commaCount === 0) {
    // Single dot - likely decimal, keep as is
    cleaned = trimmed;
  } else if (commaCount > 1) {
    // Multiple commas = thousands separators
    cleaned = trimmed.replace(/,/g, '');
  } else if (dotCount > 1) {
    // Multiple dots = EU thousands separators
    cleaned = trimmed.replace(/\./g, '');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Alias for backward compatibility
export const toNumber = toNumberEUorUS;

/**
 * Safer spend parser that filters out date-like values and Excel serials.
 */
function toSpendNumber(val: any): number {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // Skip if the string looks like a date (YYYY-MM-DD) or contains time
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || trimmed.includes(':')) {
      console.warn('[FB] Skipping date string in spend:', val);
      return 0;
    }
  }

  const num = toNumber(val);

  // Excel date serials for recent years ~44000-47000; also guard unrealistic spend > €5000/day
  if (num > 5000 && num < 50000) {
    console.warn('[FB] Skipping likely Excel date serial in spend:', num, 'raw:', val);
    return 0;
  }

  return num;
}

/**
 * Safe aggregation utility - adds to map only if day is valid and inc is finite
 */
export function sumInto(map: Record<string, number>, day: string, inc: number): void {
  if (!day) return;
  map[day] = (map[day] ?? 0) + (Number.isFinite(inc) ? inc : 0);
}

// ============================================================================
// Tab Data Fetching Helpers
// ============================================================================

export type DateRange = { from: string; to: string }; // YYYY-MM-DD in UTC

/**
 * Fetch tab data as array of objects or 2D array
 */
async function getTabRows(tab: string): Promise<{ rows: Row[]; headers: string[]; __error?: string }> {
  const base = getSheetsUrl();
  if (!base) {
    return { rows: [], headers: [], __error: 'SHEETS_URL missing' };
  }

  const res = await fetchJson(`${base}?tab=${encodeURIComponent(tab)}`);

  if (!res.ok) {
    return { rows: [], headers: [], __error: `fetch ${tab} failed: ${res.status}` };
  }

  if (typeof res.body !== 'object') {
    return { rows: [], headers: [], __error: `${tab}: response is not object` };
  }

  // Handle array of objects
  if (Array.isArray(res.body) && res.body.length > 0) {
    if (typeof res.body[0] === 'object' && !Array.isArray(res.body[0])) {
      const headers = Object.keys(res.body[0]);
      return { rows: res.body as Row[], headers };
    }
    // Handle 2D array
    if (Array.isArray(res.body[0])) {
      const headers = (res.body[0] as any[]).map(h => String(h || ''));
      const rows = res.body.slice(1).map((row: any[]) => {
        const obj: Row = {};
        headers.forEach((h, i) => {
          obj[h] = row[i];
        });
        return obj;
      });
      return { rows, headers };
    }
  }

  // Handle wrapped responses
  if (Array.isArray((res.body as any).rows)) {
    const r = (res.body as any).rows;
    if (r.length > 0 && typeof r[0] === 'object') {
      return { rows: r, headers: Object.keys(r[0]) };
    }
  }
  if (Array.isArray((res.body as any).data)) {
    const r = (res.body as any).data;
    if (r.length > 0 && typeof r[0] === 'object') {
      return { rows: r, headers: Object.keys(r[0]) };
    }
  }

  return { rows: [], headers: [], __error: `${tab}: unexpected response format` };
}

/**
 * Fetch tab data as 2D array with headers
 */
async function getTab2D(tab: string): Promise<{ data: any[][]; headers: string[]; __error?: string }> {
  const base = getSheetsUrl();
  if (!base) {
    return { data: [], headers: [], __error: 'SHEETS_URL missing' };
  }

  const res = await fetchJson(`${base}?tab=${encodeURIComponent(tab)}`);

  if (!res.ok) {
    return { data: [], headers: [], __error: `fetch ${tab} failed: ${res.status}` };
  }

  if (!Array.isArray(res.body)) {
    return { data: [], headers: [], __error: `${tab}: response is not array` };
  }

  // Handle array of objects -> convert to 2D
  if (res.body.length > 0 && typeof res.body[0] === 'object' && !Array.isArray(res.body[0])) {
    const headers = Object.keys(res.body[0]);
    const data = [headers, ...res.body.map((row: any) => headers.map(h => row[h]))];
    return { data, headers };
  }

  // Already 2D array
  if (res.body.length > 0 && Array.isArray(res.body[0])) {
    const headers = (res.body[0] as any[]).map(h => String(h || ''));
    return { data: res.body as any[][], headers };
  }

  return { data: [], headers: [], __error: `${tab}: empty or invalid format` };
}

// ============================================================================
// OVERVIEW LOADERS
// ============================================================================

// Column aliases for each data source
const GOOGLE_DATE_ALIASES = ['date_iso', 'date', 'day', 'date_start'];
const GOOGLE_CLICKS_ALIASES = ['clicks', 'ga_clicks', 'click'];
const GOOGLE_COST_ALIASES = ['cost', 'spend', 'ga_cost'];

const FB_DATE_ALIASES = ['date_iso', 'date_start', 'date'];
const FB_SPEND_ALIASES = ['spend', 'cost', 'amount_spent'];
const FB_LPVIEWS_ALIASES = ['lp_views', 'landing_page_views', 'landing_page_view'];

const CONTACT_DATE_ALIASES = ['date_iso', 'created_iso', 'created_at', 'createdate', 'results.properties.createdate'];
const CONTACT_ACTIVITY_ALIASES = ['lastmodified_at', 'activity_date', 'updated_at', 'hs_lastmodifieddate', 'results.properties.hs_lastmodifieddate'];
const CONTACT_LIFECYCLE_ALIASES = ['lifecyclestage', 'results.properties.lifecyclestage'];
const CONTACT_LEADSTATUS_ALIASES = ['hs_lead_status', 'lead_status', 'results.properties.hs_lead_status'];

const DEAL_CREATED_ALIASES = ['created_iso', 'created_at', 'results.properties.createdate', 'createdate'];
const DEAL_CLOSED_ALIASES = ['closed_iso', 'closed_at', 'closedate', 'results.properties.closedate'];
const DEAL_STAGE_ALIASES = ['stage', 'dealstage', 'results.properties.dealstage'];
const DEAL_AMOUNT_ALIASES = ['amount_effective', 'amount_home', 'amount', 'results.properties.amount'];

const LEAD_STAGES = new Set([
  'lead', 'subscriber', 'marketingqualifiedlead', 'salesqualifiedlead',
  'salesqualified', 'opportunity', 'customer'
]);

export interface GoogleTrafficResult {
  ok: boolean;
  gaSpendByDate: Record<string, number>;
  gaClicksByDate: Record<string, number>;
  gaConvByDate: Record<string, number>;
  rows: number;
  tab: 'daily';
  found: { idxDate: number | null; idxCost: number | null; idxClicks: number | null; idxConv: number | null };
  dateRange?: { min?: string; max?: string };
  error?: string;
}

export interface FbTrafficResult {
  ok: boolean;
  fbSpendByDate: Record<string, number>;
  fbLpViewsByDate: Record<string, number>;
  rows: number;
  found: { idxDate: number | null; idxSpend: number | null; idxLp: number | null };
  dateRange?: { min?: string; max?: string };
  error?: string;
}

/**
 * Result from loading FB spend from fb_ads_raw tab
 */
export interface FbSpendResult {
  ok: boolean;
  fbSpendByDate: Record<string, number>;
  rows: number;
  found: { idxDate: number | null; idxSpend: number | null };
  dateRange?: { min?: string; max?: string };
  error?: string;
}

export interface ContactsResult {
  leads: number;
  sql: number;
  __debug: {
    tab: string;
    rows: number;
    minDate?: string;
    maxDate?: string;
    foundColumns: { date: string | null; activityDate: string | null; lifecycle: string | null; leadStatus: string | null };
    usedDate: 'activity' | 'created' | null;
    error?: string;
  };
}

export interface DealsResult {
  wonDeals: number;
  createdDeals: number;
  revenue: number;
  avgDealSize: number;
  revenueByDate: Record<string, number>;
  __debug: {
    tab: string;
    rows: number;
    minDate?: string;
    maxDate?: string;
    foundColumns: { created: string | null; closed: string | null; stage: string | null; amount: string | null };
    error?: string;
  };
}

/**
 * Load Google Ads traffic data (clicks and spend by date)
 * Only reads from the 'daily' tab - no fallbacks to other tabs
 * Uses toNumber() to strip currency symbols (€) from cost values
 * Does NOT compute grand totals - caller computes from date-filtered series
 */
export async function loadGoogleTraffic(sheetsUrl?: string): Promise<GoogleTrafficResult> {
  const tab = 'daily' as const;
  const base = sheetsUrl || getSheetsUrl();

  if (!base) {
    return {
      ok: false,
      gaSpendByDate: {},
      gaClicksByDate: {},
      gaConvByDate: {},
      rows: 0,
      tab,
      found: { idxDate: null, idxCost: null, idxClicks: null, idxConv: null },
      error: 'SHEETS_URL missing'
    };
  }

  const res = await fetchJson(`${base}?tab=${encodeURIComponent(tab)}`);

  if (!res.ok) {
    return {
      ok: false,
      gaSpendByDate: {},
      gaClicksByDate: {},
      gaConvByDate: {},
      rows: 0,
      tab,
      found: { idxDate: null, idxCost: null, idxClicks: null, idxConv: null },
      error: `fetch daily failed: ${res.status}`
    };
  }

  // Accept 2D arrays or array of objects
  const body: any = res.body;
  let rows: any[] = [];

  if (Array.isArray(body?.values)) {
    rows = body.values;
  } else if (Array.isArray(body)) {
    // Could be array of objects or 2D array
    if (body.length > 0 && typeof body[0] === 'object' && !Array.isArray(body[0])) {
      // Array of objects - convert to 2D
      const headers = Object.keys(body[0]);
      rows = [headers, ...body.map((r: any) => headers.map(h => r[h]))];
    } else {
      rows = body;
    }
  } else if (body?.data && Array.isArray(body.data)) {
    rows = body.data;
  }

  if (!rows?.length) {
    return {
      ok: true,
      gaSpendByDate: {},
      gaClicksByDate: {},
      gaConvByDate: {},
      rows: 0,
      tab,
      found: { idxDate: null, idxCost: null, idxClicks: null, idxConv: null }
    };
  }

  // Parse headers (2D array)
  const hdr = normalizeHeaders(rows[0]);
  const idxDate = pickIdx(hdr, ['date', 'day', 'date_iso']);
  const idxCost = pickIdx(hdr, ['cost', 'spend']);
  const idxClicks = pickIdx(hdr, ['clicks']);
  const idxConv = pickIdx(hdr, ['conv', 'conversions']);

  const parseConv = (v: any): number => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const s = String(v).trim().replace(/[€$£\s\u00A0\u202F]/g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const spendByDate: Record<string, number> = {};
  const clicksByDate: Record<string, number> = {};
  const convByDate: Record<string, number> = {};
  let minDay: string | undefined;
  let maxDay: string | undefined;
  let convTotal = 0;

  // Guard: drop dates more than 400 days from now
  const now = new Date();
  const maxValidDate = new Date(now.getTime() + 400 * 86400_000).toISOString().slice(0, 10);
  const minValidDate = new Date(now.getTime() - 400 * 86400_000).toISOString().slice(0, 10);

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const day = toIsoDay(idxDate !== -1 ? r[idxDate] : undefined);
    
    // Skip rows with invalid or out-of-range dates
    if (!day || day < minValidDate || day > maxValidDate) continue;

    const cost = toNumber(idxCost !== -1 ? r[idxCost] : undefined);
    const clicks = toNumber(idxClicks !== -1 ? r[idxClicks] : undefined);
    const conv = parseConv(idxConv !== -1 ? r[idxConv] : undefined);

    if (idxConv !== -1 && i <= 20) {
      console.log(
        `[google-traffic] Row ${i}: date=${day} convRaw="${r[idxConv]}" parsed=${conv}`
      );
    }

    if (!minDay || day < minDay) minDay = day;
    if (!maxDay || day > maxDay) maxDay = day;

    if (Number.isFinite(cost)) {
      sumInto(spendByDate, day, cost);
    }

    if (Number.isFinite(clicks)) {
      sumInto(clicksByDate, day, clicks);
    }

    if (Number.isFinite(conv)) {
      sumInto(convByDate, day, conv);
      convTotal += conv;
    }
  }

  console.log('[google-traffic] Total conversions parsed:', convTotal);

  return {
    ok: true,
    gaSpendByDate: spendByDate,
    gaClicksByDate: clicksByDate,
    gaConvByDate: convByDate,
    rows: rows.length - 1,
    tab,
    found: { idxDate, idxCost, idxClicks, idxConv },
    dateRange: { min: minDay, max: maxDay }
  };
}

/**
 * Load Facebook traffic data (LP views and spend by date)
 * Uses deduplication by date+campaign to handle duplicate rows from appended sheets
 * Date aliases in priority order: ['date', 'date_iso', 'date_start']
 * Does NOT compute grand totals - caller computes from date-filtered series
 */
export async function loadFbTraffic(sheetsUrl?: string): Promise<FbTrafficResult> {
  const tab = "fb_ads_enriched";
  const base = sheetsUrl || getSheetsUrl();
  const isValidSpend = (spend: number) => {
    // Filter out obvious Excel date serials (≈44k-46k) and unrealistic values
    if (!Number.isFinite(spend)) return false;
    if (spend > 5000 && spend < 50000) return false; // likely Excel serial
    return spend >= 0 && spend <= 500000; // upper bound sanity
  };
  
  if (!base) {
    return { 
      ok: false, 
      fbSpendByDate: {}, 
      fbLpViewsByDate: {}, 
      rows: 0,
      found: { idxDate: null, idxSpend: null, idxLp: null },
      error: 'SHEETS_URL missing'
    };
  }

  const res = await fetchJson(`${base}?tab=${encodeURIComponent(tab)}`);
  
  // Handle various response formats
  let rows: any[][] = [];
  
  if (!res.ok) {
    return { 
      ok: false, 
      fbSpendByDate: {}, 
      fbLpViewsByDate: {}, 
      rows: 0,
      found: { idxDate: null, idxSpend: null, idxLp: null },
      error: `fetch fb_ads_enriched failed: ${res.status}`
    };
  }

  // Parse response body - could be array of objects or 2D array
  if (Array.isArray(res.body)) {
    if (res.body.length > 0 && typeof res.body[0] === 'object' && !Array.isArray(res.body[0])) {
      // Array of objects - convert to 2D array
      const headers = Object.keys(res.body[0]);
      rows = [headers, ...res.body.map((r: any) => headers.map(h => r[h]))];
    } else if (res.body.length > 0 && Array.isArray(res.body[0])) {
      // Already 2D array
      rows = res.body;
    }
  } else if (res.body && Array.isArray((res.body as any).values)) {
    rows = (res.body as any).values;
  }

  if (!rows.length) {
    return { 
      ok: true, 
      fbSpendByDate: {}, 
      fbLpViewsByDate: {}, 
      rows: 0,
      found: { idxDate: null, idxSpend: null, idxLp: null }
    };
  }

  const headers = rows[0].map((h: any) => String(h || ''));
  const headersNorm = normalizeHeaders(headers);

  // Date aliases in priority order: ['date', 'date_iso', 'date_start']
  const idxDate = pickIdx(headersNorm, ['date', 'date_iso', 'date_start']);
  // Spend aliases: ['spend', 'cost']
  const idxSpend = pickIdx(headersNorm, ['spend', 'cost']);
  // LP views aliases: ['lp_views', 'landing_page_views']
  const idxLp = pickIdx(headersNorm, ['lp_views', 'landing_page_views']);
  // Campaign for deduplication
  const idxCamp = pickIdx(headersNorm, ['campaign_name', 'campaign']);

  const fbSpendByDate: Record<string, number> = {};
  const fbLpViewsByDate: Record<string, number> = {};

  // Dedupe key: date + campaign (avoid double counting on append)
  // For repeated identical rows, take the **max** per metric for that key, then sum across campaigns per day
  const byKey: Record<string, { day: string; spend: number; lp: number }> = {};

  let minD: string | undefined;
  let maxD: string | undefined;
  let skippedInvalidSpend = 0;

  // Guard: drop dates more than 400 days from now
  const now = new Date();
  const maxValidDate = new Date(now.getTime() + 400 * 86400_000).toISOString().slice(0, 10);
  const minValidDate = new Date(now.getTime() - 400 * 86400_000).toISOString().slice(0, 10);

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const day = toIsoDay(idxDate !== -1 ? r[idxDate] : null);
    
    // Skip rows with invalid or out-of-range dates (400+ days from now)
    if (!day || day < minValidDate || day > maxValidDate) continue;

    const camp = (idxCamp !== -1 ? String(r[idxCamp] || '') : '').trim();
    const spendRaw = toNumber(idxSpend !== -1 ? r[idxSpend] : 0);
    const spend = isValidSpend(spendRaw) ? spendRaw : 0;
    if (spendRaw !== spend) skippedInvalidSpend++;
    const lp = toNumber(idxLp !== -1 ? r[idxLp] : 0);

    minD = !minD || day < minD ? day : minD;
    maxD = !maxD || day > maxD ? day : maxD;

    const key = `${day}__${camp}`;
    const cur = byKey[key] ?? { day, spend: 0, lp: 0 };

    // Take max to collapse true duplicates (appended identical rows)
    cur.spend = Math.max(cur.spend, Number.isFinite(spend) ? spend : 0);
    cur.lp = Math.max(cur.lp, Number.isFinite(lp) ? lp : 0);

    byKey[key] = cur;
  }

  // Aggregate by day using sumInto
  Object.values(byKey).forEach(({ day, spend, lp }) => {
    sumInto(fbSpendByDate, day, spend);
    sumInto(fbLpViewsByDate, day, lp);
  });

  if (skippedInvalidSpend > 0) {
    console.warn(`[fb_ads_enriched] Skipped ${skippedInvalidSpend} rows with invalid spend (likely Excel serials)`);
  }

  return {
    ok: true,
    fbSpendByDate,
    fbLpViewsByDate,
    rows: rows.length - 1,
    found: { idxDate, idxSpend, idxLp },
    dateRange: { min: minD, max: maxD }
  };
}

/**
 * Load Facebook spend from fb_ads_raw tab
 * Uses deduplication by (date, campaign) - takes MAX spend per key to handle duplicate rows
 * Uses toNumberEUorUS for robust number parsing
 */
export async function loadFbSpendFromRaw(url?: string, tab = 'fb_ads_raw'): Promise<FbSpendResult> {
  const base = url || getSheetsUrl();
  
  if (!base) {
    return {
      ok: false,
      fbSpendByDate: {},
      rows: 0,
      found: { idxDate: null, idxSpend: null },
      error: 'SHEETS_URL missing'
    };
  }

  try {
    const res = await fetchJson(`${base}?tab=${encodeURIComponent(tab)}`);
    
    if (!res.ok) {
      return {
        ok: false,
        fbSpendByDate: {},
        rows: 0,
        found: { idxDate: null, idxSpend: null },
        error: `HTTP ${res.status}`
      };
    }

    const data = Array.isArray(res.body) ? res.body : ((res.body as any)?.rows || []);
    
    if (!Array.isArray(data) || data.length === 0) {
      return {
        ok: true,
        fbSpendByDate: {},
        rows: 0,
        found: { idxDate: null, idxSpend: null }
      };
    }

    // Accept 2D arrays or array of objects
    const first = data[0];
    let rows: any[] = data;
    let headers: string[] = [];

    if (Array.isArray(first)) {
      headers = (data[0] || []).map(String);
      rows = data.slice(1);
    } else if (first && typeof first === 'object') {
      headers = Object.keys(first);
    }

    const norm = (s: string) => s?.toString().trim().toLowerCase();
    const idx = (aliases: string[]) =>
      headers.findIndex(h => aliases.map(a => norm(a)).includes(norm(h)));

    // fb_ads_raw expected aliases (supports nested data.* columns)
    const idxDate = idx(['data.date_start', 'date', 'date_start', 'date_iso']);
    const idxSpend = idx(['data.spend', 'spend', 'amount_spent']);
    const idxCamp = idx(['data.campaign_name', 'campaign_name', 'campaign']);

    if (idxDate < 0 || idxSpend < 0) {
      return {
        ok: false,
        fbSpendByDate: {},
        rows: 0,
        found: { idxDate, idxSpend },
        error: `Missing date/spend columns. Found headers: ${headers.slice(0, 10).join(', ')}`
      };
    }

    // Guard: drop dates more than 400 days from now
    const now = new Date();
    const maxValidDate = new Date(now.getTime() + 400 * 86400_000).toISOString().slice(0, 10);
    const minValidDate = new Date(now.getTime() - 400 * 86400_000).toISOString().slice(0, 10);

    // Dedupe by (date, campaign) - take MAX spend per key to handle duplicate rows
    const byKey: Record<string, { day: string; spend: number }> = {};
    let minDay: string | undefined;
    let maxDay: string | undefined;

    for (const r of rows) {
      const row = Array.isArray(r) ? r : headers.map(h => r[h]);
      const rawDay = row[idxDate];
      const rawSpend = row[idxSpend];
      const campaign = idxCamp >= 0 ? String(row[idxCamp] || '').trim() : '';

      const day = toIsoDay(rawDay);
      if (!day || day < minValidDate || day > maxValidDate) continue;

      const amt = toNumberEUorUS(rawSpend);
      if (!Number.isFinite(amt)) continue;

      if (!minDay || day < minDay) minDay = day;
      if (!maxDay || day > maxDay) maxDay = day;

      // Dedupe key: date + campaign
      const key = `${day}__${campaign}`;
      const cur = byKey[key] ?? { day, spend: 0 };
      // Take MAX to collapse duplicate rows (appended identical data)
      cur.spend = Math.max(cur.spend, amt);
      byKey[key] = cur;
    }

    // Aggregate deduped values by day
    const perDay: Record<string, number> = {};
    Object.values(byKey).forEach(({ day, spend }) => {
      sumInto(perDay, day, spend);
    });

    return {
      ok: true,
      fbSpendByDate: perDay,
      rows: rows.length,
      found: { idxDate, idxSpend },
      dateRange: { min: minDay, max: maxDay }
    };
  } catch (e: any) {
    return {
      ok: false,
      fbSpendByDate: {},
      rows: 0,
      found: { idxDate: null, idxSpend: null },
      error: String(e?.message || e)
    };
  }
}

/**
 * Load HubSpot contacts and count leads/SQL
 * Leads = lifecyclestage in LEAD_STAGES OR hs_lead_status exists and != 'unqualified'
 * SQL = lifecyclestage === 'salesqualifiedlead'
 */
export async function loadContacts(range: DateRange): Promise<ContactsResult> {
  const emptyResult = (error: string): ContactsResult => ({
    leads: 0,
    sql: 0,
    __debug: {
      tab: 'hubspot_contacts_enriched',
      rows: 0,
      foundColumns: { date: null, activityDate: null, lifecycle: null, leadStatus: null },
      usedDate: null,
      error
    }
  });

  const { rows, headers, __error } = await getTabRows('hubspot_contacts_enriched');

  if (__error || rows.length === 0) {
    return emptyResult(__error || 'hubspot_contacts_enriched empty');
  }

  const headersNorm = headers.map(h => h.toLowerCase().trim());

  const iDate = pickIdx(headersNorm, CONTACT_DATE_ALIASES);
  const iActivity = pickIdx(headersNorm, CONTACT_ACTIVITY_ALIASES);
  const iLifecycle = pickIdx(headersNorm, CONTACT_LIFECYCLE_ALIASES);
  const iLeadStatus = pickIdx(headersNorm, CONTACT_LEADSTATUS_ALIASES);

  const dateCol = iActivity !== -1 ? headers[iActivity] : (iDate !== -1 ? headers[iDate] : null);
  const usedDate = iActivity !== -1 ? 'activity' : (iDate !== -1 ? 'created' : null);

  let leads = 0;
  let sql = 0;
  let minD: string | undefined;
  let maxD: string | undefined;

  for (const row of rows) {
    // Get date - prefer activity date, fallback to created
    const dateValue = iActivity !== -1 ? row[headers[iActivity]] : (iDate !== -1 ? row[headers[iDate]] : null);
    const day = toIsoDay(dateValue);

    // Filter by date range
    if (!day || day < range.from || day > range.to) continue;

    minD = !minD || day < minD ? day : minD;
    maxD = !maxD || day > maxD ? day : maxD;

    const lifecycle = String(iLifecycle !== -1 ? row[headers[iLifecycle]] || '' : '').toLowerCase().trim();
    const leadStatus = String(iLeadStatus !== -1 ? row[headers[iLeadStatus]] || '' : '').toLowerCase().trim();

    // Lead qualification
    const qualifiesByLifecycle = lifecycle && LEAD_STAGES.has(lifecycle);
    const qualifiesByLeadStatus = leadStatus && leadStatus !== 'unqualified';

    if (qualifiesByLifecycle || qualifiesByLeadStatus) {
      leads++;
    }

    // SQL = salesqualifiedlead specifically
    if (lifecycle === 'salesqualifiedlead') {
      sql++;
    }
  }

  return {
    leads,
    sql,
    __debug: {
      tab: 'hubspot_contacts_enriched',
      rows: rows.length,
      minDate: minD,
      maxDate: maxD,
      foundColumns: {
        date: iDate !== -1 ? headers[iDate] : null,
        activityDate: iActivity !== -1 ? headers[iActivity] : null,
        lifecycle: iLifecycle !== -1 ? headers[iLifecycle] : null,
        leadStatus: iLeadStatus !== -1 ? headers[iLeadStatus] : null
      },
      usedDate
    }
  };
}

/**
 * Load HubSpot deals and compute revenue metrics
 * Won = stage contains 'won' (case-insensitive) or equals 'closedwon'
 * Revenue = sum of amount for won deals
 */
export async function loadDeals(range: DateRange): Promise<DealsResult> {
  const emptyResult = (error: string): DealsResult => ({
    wonDeals: 0,
    createdDeals: 0,
    revenue: 0,
    avgDealSize: 0,
    revenueByDate: {},
    __debug: {
      tab: 'hubspot_deals_enriched',
      rows: 0,
      foundColumns: { created: null, closed: null, stage: null, amount: null },
      error
    }
  });

  const { rows, headers, __error } = await getTabRows('hubspot_deals_enriched');

  if (__error || rows.length === 0) {
    return emptyResult(__error || 'hubspot_deals_enriched empty');
  }

  const headersNorm = headers.map(h => h.toLowerCase().trim());

  const iCreated = pickIdx(headersNorm, DEAL_CREATED_ALIASES);
  const iClosed = pickIdx(headersNorm, DEAL_CLOSED_ALIASES);
  const iStage = pickIdx(headersNorm, DEAL_STAGE_ALIASES);
  const iAmount = pickIdx(headersNorm, DEAL_AMOUNT_ALIASES);

  let wonDeals = 0;
  let createdDeals = 0;
  let revenue = 0;
  const revenueByDate: Record<string, number> = {};
  let minD: string | undefined;
  let maxD: string | undefined;

  for (const row of rows) {
    // For revenue by date, use closed_at. For funnel, use created_at
    const closedValue = iClosed !== -1 ? row[headers[iClosed]] : null;
    const createdValue = iCreated !== -1 ? row[headers[iCreated]] : null;

    const closedDay = toIsoDay(closedValue);
    const createdDay = toIsoDay(createdValue);

    // Count created deals in range
    if (createdDay && createdDay >= range.from && createdDay <= range.to) {
      createdDeals++;
    }

    // Use closed date for won deal revenue
    const dayForRevenue = closedDay || createdDay;
    if (!dayForRevenue || dayForRevenue < range.from || dayForRevenue > range.to) continue;

    minD = !minD || dayForRevenue < minD ? dayForRevenue : minD;
    maxD = !maxD || dayForRevenue > maxD ? dayForRevenue : maxD;

    const stage = String(iStage !== -1 ? row[headers[iStage]] || '' : '').toLowerCase();
    const isWon = stage.includes('won'); // includes 'closedwon', 'won', etc.

    if (!isWon) continue;

    const amount = iAmount !== -1 ? toNumber(row[headers[iAmount]]) : 0;
    if (amount > 0) {
      revenue += amount;
      wonDeals++;
      revenueByDate[dayForRevenue] = (revenueByDate[dayForRevenue] || 0) + amount;
    }
  }

  const avgDealSize = wonDeals > 0 ? revenue / wonDeals : 0;

  return {
    wonDeals,
    createdDeals,
    revenue,
    avgDealSize,
    revenueByDate,
    __debug: {
      tab: 'hubspot_deals_enriched',
      rows: rows.length,
      minDate: minD,
      maxDate: maxD,
      foundColumns: {
        created: iCreated !== -1 ? headers[iCreated] : null,
        closed: iClosed !== -1 ? headers[iClosed] : null,
        stage: iStage !== -1 ? headers[iStage] : null,
        amount: iAmount !== -1 ? headers[iAmount] : null
      }
    }
  };
}

// ============================================================================
// LEGACY EXPORTS (for backward compatibility)
// ============================================================================

// Helper to fetch and parse SearchTerm data
async function fetchAndParseSearchTerms(sheetUrl: string): Promise<SearchTermMetric[]> {
  const tab: SheetTab = 'searchTerms';
  try {
    const urlWithTab = `${sheetUrl}?tab=${tab}`;
    console.log(`[sheetsData] Fetching ${tab}...`);
    const response = await fetchJson(urlWithTab);
    if (!response.ok) {
      throw new Error(`Failed to fetch data for tab ${tab}: ${response.status}`);
    }
    const rawData = response.body;
    if (!Array.isArray(rawData)) {
      console.error(`Response is not an array for ${tab}:`, rawData);
      return [];
    }
    return rawData.map((row: any) => ({
      searchTerm: String(row['searchTerm'] || ''),
      keywordText: String(row['keywordText'] || ''),
      campaign: String(row['campaign'] || ''),
      adGroup: String(row['adGroup'] || ''),
      impr: Number(row['impr'] || 0),
      clicks: Number(row['clicks'] || 0),
      cost: Number(row['cost'] || 0),
      conv: Number(row['conv'] || 0),
      value: Number(row['value'] || 0),
    }));
  } catch (error) {
    console.error(`Error fetching ${tab} data:`, error);
    return [];
  }
}

// Helper to fetch and parse Daily (AdMetric) data
async function fetchAndParseDaily(sheetUrl: string): Promise<AdMetric[]> {
  const tab: SheetTab = 'daily';
  try {
    const urlWithTab = `${sheetUrl}?tab=${tab}`;
    console.log(`[sheetsData] Fetching ${tab}...`);
    const response = await fetchJson(urlWithTab);
    if (!response.ok) {
      throw new Error(`Failed to fetch data for tab ${tab}: ${response.status}`);
    }
    const rawData = response.body;
    if (!Array.isArray(rawData)) {
      console.error(`Response is not an array for ${tab}:`, rawData);
      return [];
    }
    return rawData.map((row: any) => ({
      campaign: String(row['campaign'] || ''),
      campaignId: String(row['campaignId'] || ''),
      clicks: Number(row['clicks'] || 0),
      value: toNumber(row['value']),
      conv: Number(row['conv'] || 0),
      cost: toNumber(row['cost']),
      impr: Number(row['impr'] || 0),
      date: String(row['date'] || '')
    }));
  } catch (error) {
    console.error(`Error fetching ${tab} data:`, error);
    return [];
  }
}

// Helper to fetch and parse AdGroups data
async function fetchAndParseAdGroups(sheetUrl: string): Promise<AdGroupRecord[]> {
  const tab: SheetTab = 'adGroups';
  try {
    const urlWithTab = `${sheetUrl}?tab=${tab}`;
    console.log(`[sheetsData] Fetching ${tab}...`);
    const response = await fetchJson(urlWithTab);
    if (!response.ok) {
      throw new Error(`Failed to fetch data for tab ${tab}: ${response.status}`);
    }
    const rawData = response.body;
    if (!Array.isArray(rawData)) {
      console.error(`Response is not an array for ${tab}:`, rawData);
      return [];
    }

    return rawData.map((row: any) => ({
      campaign: String(row['campaign'] || ''),
      campaignId: String(row['campaignId'] || ''),
      adGroup: String(row['adGroup'] || ''),
      adGroupId: String(row['adGroupId'] || ''),
      impr: Number(row['impr'] || 0),
      clicks: Number(row['clicks'] || 0),
      value: toNumber(row['value']),
      conv: Number(row['conv'] || 0),
      cost: toNumber(row['cost']),
      date: toIsoDay(row['date']) || '',
      cpc: toNumber(row['cpc']),
      ctr: toNumber(row['ctr']),
      convRate: toNumber(row['convRate']),
      cpa: toNumber(row['cpa']),
      roas: toNumber(row['roas'])
    }));
  } catch (error) {
    console.error(`Error fetching ${tab} data:`, error);
    return [];
  }
}

// Standalone functions to fetch individual tab data
export async function fetchDaily(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<AdMetric[]> {
  return fetchAndParseDaily(sheetUrl);
}

export async function fetchSearchTerms(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<SearchTermMetric[]> {
  return fetchAndParseSearchTerms(sheetUrl);
}

export async function fetchAdGroups(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<AdGroupRecord[]> {
  return fetchAndParseAdGroups(sheetUrl);
}

export async function fetchAllTabsData(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<TabData> {
  const [dailyResult, searchTermsResult, adGroupsResult] = await Promise.allSettled([
    fetchAndParseDaily(sheetUrl),
    fetchAndParseSearchTerms(sheetUrl),
    fetchAndParseAdGroups(sheetUrl)
  ]);

  const dailyData = dailyResult.status === 'fulfilled' ? dailyResult.value : [];
  const searchTermsData = searchTermsResult.status === 'fulfilled' ? searchTermsResult.value : [];
  const adGroupsData = adGroupsResult.status === 'fulfilled' ? adGroupsResult.value : [];

  if (dailyResult.status === 'rejected') console.error('Failed to fetch daily data:', dailyResult.reason);
  if (searchTermsResult.status === 'rejected') console.error('Failed to fetch search terms:', searchTermsResult.reason);
  if (adGroupsResult.status === 'rejected') console.error('Failed to fetch ad groups:', adGroupsResult.reason);

  return {
    daily: dailyData || [],
    searchTerms: searchTermsData || [],
    adGroups: adGroupsData || [],
  } as TabData;
}

export function getCampaigns(data: AdMetric[]): Campaign[] {
  const campaignMap = new Map<string, { id: string; name: string; totalCost: number }>()

  data.forEach(row => {
    if (!campaignMap.has(row.campaignId)) {
      campaignMap.set(row.campaignId, {
        id: row.campaignId,
        name: row.campaign,
        totalCost: row.cost
      })
    } else {
      const campaign = campaignMap.get(row.campaignId)!
      campaign.totalCost += row.cost
    }
  })

  return Array.from(campaignMap.values())
    .sort((a, b) => b.totalCost - a.totalCost)
}

export function getMetricsByDate(data: AdMetric[], campaignId: string): AdMetric[] {
  return data
    .filter(metric => metric.campaignId === campaignId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

export function getMetricOptions(activeTab: SheetTab = 'daily') {
  return TAB_CONFIGS[activeTab]?.metrics || {}
}

// SWR configuration
export const swrConfig = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 5000
}

// Facebook Enriched Types and Mapper (legacy)
export type FbEnrichedRow = {
  campaign_name: string
  date_start: string
  date_iso: string
  spend: number
  clicks: number
  lp_views: number
  fb_form_leads: number
  landing_leads: number
}

// Streak leads
export type StreakLeadRow = {
  inquiry_date: string
  source_placement: string
  ai_score: number
  country: string
  stage: string
  source_category: string
  source_detail: string
  budget_range: string
  platform: string
  name?: string
  size_of_group?: number
  destination?: string
  when?: string
  vessel?: string
  why_not_segment?: string
}

// Booking record
export interface BookingRecord {
  inquiry_date: string
  booking_date: string
  source: 'fb_landing' | 'fb_lead' | 'google' | string
  campaign: string
  status: string
  rvc: number
  vessel: string
  destination: string
  client_country: string
  client_email: string
  ai_score: number
  notes: string
}

export function mapFbEnriched(rows: any[][]): FbEnrichedRow[] {
  if (!rows || rows.length < 2) return []

  const [header, ...data] = rows
  const col = (n: string) => header.findIndex(h => String(h).trim().toLowerCase() === n.toLowerCase())

  const I = {
    campaign_name: col('campaign_name'),
    date_start: col('date_start'),
    date_iso: col('date_iso'),
    spend: col('spend'),
    clicks: col('clicks'),
    lp_views: col('lp_views'),
    fb_form_leads: col('fb_form_leads'),
    landing_leads: col('landing_leads'),
  }

  return data.map(r => ({
    campaign_name: String(r[I.campaign_name] ?? ''),
    date_start: String(r[I.date_start] ?? ''),
    date_iso: String(r[I.date_iso] ?? ''),
    spend: toSpendNumber(r[I.spend]),
    clicks: toNumber(r[I.clicks]),
    lp_views: toNumber(r[I.lp_views]),
    fb_form_leads: toNumber(r[I.fb_form_leads]),
    landing_leads: toNumber(r[I.landing_leads]),
  }))
}

export function mapStreakLeads(rows: any[][]): StreakLeadRow[] {
  if (!rows || rows.length < 2) return []

  const [header, ...data] = rows
  const norm = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, '_')
  const col = (n: string) => header.findIndex(h => norm(h) === n.toLowerCase())

  const I = {
    inquiry_date: col('inquiry_recieved'),
    source_placement: col('source_placement'),
    ai_score: col('ai'),
    country: col('country'),
    stage: col('stage'),
    source_category: col('latest_source_category'),
    source_detail: col('source_detail'),
    budget_range: col('budget_range'),
    platform: col('platform'),
    name: col('name'),
    size_of_group: col('size_of_group'),
    destination: col('destination'),
    when: col('when'),
    vessel: col('vessel'),
    why_not_segment: col('why_not_segment'),
  }

  return data
    .map(r => ({
      inquiry_date: String(r[I.inquiry_date] ?? ''),
      source_placement: String(r[I.source_placement] ?? '').toLowerCase(),
      ai_score: toNumber(r[I.ai_score]),
      country: String(r[I.country] ?? ''),
      stage: String(r[I.stage] ?? ''),
      source_category: String(r[I.source_category] ?? ''),
      source_detail: String(r[I.source_detail] ?? ''),
      budget_range: String(r[I.budget_range] ?? ''),
      platform: String(r[I.platform] ?? ''),
      name: I.name !== -1 ? String(r[I.name] ?? '') : undefined,
      size_of_group: I.size_of_group !== -1 ? Number(r[I.size_of_group] ?? 0) : undefined,
      destination: I.destination !== -1 ? String(r[I.destination] ?? '') : undefined,
      when: I.when !== -1 ? String(r[I.when] ?? '') : undefined,
      vessel: I.vessel !== -1 ? String(r[I.vessel] ?? '') : undefined,
      why_not_segment: I.why_not_segment !== -1 ? String(r[I.why_not_segment] ?? '') : undefined,
    }))
    .filter(row => !!row.inquiry_date)
}

// Generic fetchSheet helper
export async function fetchSheet(args: { sheetUrl: string; tab: string }): Promise<any[][]> {
  const { sheetUrl, tab } = args
  const url = `${sheetUrl}?tab=${encodeURIComponent(tab)}`
  const response = await fetch(url, { cache: 'no-store', next: { revalidate: 0 } })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${tab}: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  if (!Array.isArray(data)) {
    console.warn(`Response is not an array for ${tab}:`, data)
    return []
  }

  if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
    const headers = Object.keys(data[0])
    const rows = [headers, ...data.map(row => headers.map(h => row[h]))]
    return rows
  }

  return data
}

// Convenience wrapper that returns { headers, rows }
export async function fetchTab(tabName: string, sheetUrl?: string): Promise<{ headers: string[]; rows: any[][] }> {
  const url = sheetUrl || (typeof window !== 'undefined' ? getSheetsUrl() : undefined) || DEFAULT_WEB_APP_URL

  if (!url) {
    console.error(`[fetchTab] No sheet URL available for tab ${tabName}`)
    return { headers: [], rows: [] }
  }

  try {
    const fetchUrl = `${url}?tab=${encodeURIComponent(tabName)}`
    console.log(`[fetchTab] Fetching ${tabName} from:`, fetchUrl)

    const response = await fetch(fetchUrl, { cache: 'no-store', next: { revalidate: 0 } })
    console.log(`[fetchTab] Response status for ${tabName}:`, response.status, response.statusText)

    if (!response.ok) {
      console.error(`[fetchTab] Failed to fetch ${tabName}: ${response.status} ${response.statusText}`)
      return { headers: [], rows: [] }
    }

    const data = await response.json()
    console.log(`[fetchTab] Raw data for ${tabName}:`, Array.isArray(data) ? `${data.length} items` : typeof data)

    if (!Array.isArray(data)) {
      console.warn(`[fetchTab] Response is not an array for ${tabName}:`, data)
      return { headers: [], rows: [] }
    }

    let sheet: any[][]
    if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      const headers = Object.keys(data[0])
      const rows = [headers, ...data.map(row => headers.map(h => row[h]))]
      sheet = rows
    } else {
      sheet = data
    }

    if (!sheet || sheet.length === 0) {
      console.warn(`[fetchTab] Tab ${tabName} is empty`)
      return { headers: [], rows: [] }
    }

    const headers = sheet[0] || []
    const rows = sheet.slice(1) || []

    console.log(`[fetchTab] Tab ${tabName} parsed: ${headers.length} headers, ${rows.length} rows`)
    if (headers.length > 0) {
      console.log(`[fetchTab] First 5 headers:`, headers.slice(0, 5))
    }

    return { headers, rows }
  } catch (error) {
    console.error(`[fetchTab] Error fetching tab ${tabName}:`, error)
    return { headers: [], rows: [] }
  }
}

// Fetch Facebook Enriched data with fallback
export async function fetchFbEnriched(
  fetchSheetFn: (args: { sheetUrl: string; tab: string }) => Promise<any[][]>,
  sheetUrl?: string
): Promise<FbEnrichedRow[]> {
  const url = sheetUrl || getSheetsUrl() || DEFAULT_WEB_APP_URL

  try {
    let raw = await fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.FB_ENRICHED })

    if (!raw || raw.length === 0) {
      console.warn('fb_ads_enriched empty; falling back to fb_ads_raw')
      raw = await fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.FB_RAW })
    }

    return mapFbEnriched(raw)
  } catch (error) {
    console.error('Error fetching Facebook enriched data:', error)
    try {
      console.warn('Attempting fallback to fb_ads_raw')
      const raw = await fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.FB_RAW })
      return mapFbEnriched(raw)
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError)
      return []
    }
  }
}

export async function fetchStreakLeads(
  fetchSheetFn: (args: { sheetUrl: string; tab: string }) => Promise<any[][]>,
  sheetUrl?: string
): Promise<StreakLeadRow[]> {
  const url = sheetUrl || getSheetsUrl() || DEFAULT_WEB_APP_URL

  try {
    const raw = await fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.STREAK_LEADS })
    return mapStreakLeads(raw)
  } catch (error) {
    console.error('Error fetching Streak leads:', error)
    return []
  }
}

export async function fetchStreakSync(
  fetchSheetFn: (args: { sheetUrl: string; tab: string }) => Promise<any[][]>,
  sheetUrl?: string
): Promise<StreakLeadRow[]> {
  const url = sheetUrl || getSheetsUrl() || DEFAULT_WEB_APP_URL
  try {
    const raw = await fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.STREAK_SYNC })
    return mapStreakLeads(raw)
  } catch (error) {
    console.error('Error fetching streak_sync:', error)
    return []
  }
}

export async function fetchStreakSyncFb(
  fetchSheetFn: (args: { sheetUrl: string; tab: string }) => Promise<any[][]>,
  sheetUrl?: string
): Promise<StreakLeadRow[]> {
  const all = await fetchStreakSync(fetchSheetFn, sheetUrl)
  return all.filter(l => l.platform === 'facebook')
}

export async function fetchStreakSyncGoogle(
  fetchSheetFn: (args: { sheetUrl: string; tab: string }) => Promise<any[][]>,
  sheetUrl?: string
): Promise<StreakLeadRow[]> {
  const all = await fetchStreakSync(fetchSheetFn, sheetUrl)
  return all.filter(l => l.platform === 'google')
}

export async function fetchStreakLeadsGoogle(
  fetchSheetFn: (args: { sheetUrl: string; tab: string }) => Promise<any[][]>,
  sheetUrl?: string
): Promise<StreakLeadRow[]> {
  const url = sheetUrl || getSheetsUrl() || DEFAULT_WEB_APP_URL
  try {
    const raw = await fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.STREAK_LEADS_GOOGLE })
    return mapStreakLeads(raw)
  } catch (error) {
    console.error('Error fetching Google Streak leads:', error)
    return []
  }
}

export async function fetchBookings(
  fetchFn: typeof fetchSheet = fetchSheet
): Promise<BookingRecord[]> {
  try {
    const url = DEFAULT_WEB_APP_URL
    console.log('[fetchBookings] Fetching from URL:', url, 'tab:', SHEETS_TABS.BOOKINGS)
    const rawData = await fetchFn({
      sheetUrl: url,
      tab: SHEETS_TABS.BOOKINGS
    })

    if (!rawData || rawData.length < 2) return []

    const [header, ...rows] = rawData
    console.log('[fetchBookings] Raw rows count:', rows.length)

    const colIndex = (name: string) =>
      header.findIndex((h: string) => String(h).toLowerCase() === name.toLowerCase())

    const mapped = rows.map((row: any[]) => ({
      inquiry_date: String(row[colIndex('inquiry_date')] || ''),
      booking_date: (() => {
        const raw = row[colIndex('booking_date')] ?? row['booking_date'] ?? ''
        const str = String(raw)
        if (str.includes('T')) {
          const date = new Date(str)
          const year = date.getFullYear()
          const month = String(date.getMonth() + 1).padStart(2, '0')
          return `${year}-${month}`
        }
        return str.substring(0, 7)
      })(),
      source: String(row[colIndex('source')] || '') as BookingRecord['source'],
      campaign: String(row[colIndex('campaign')] || ''),
      status: String(row[colIndex('status')] || ''),
      rvc: Number(row[colIndex('rvc')]) || 0,
      vessel: String(row[colIndex('vessel')] || ''),
      destination: String(row[colIndex('destination')] || ''),
      client_country: String(row[colIndex('client_country')] || ''),
      client_email: String(row[colIndex('client_email')] || ''),
      ai_score: Number(row[colIndex('ai_score')]) || 0,
      notes: String(row[colIndex('notes')] || ''),
    }))
    console.log('[fetchBookings] All booking_date values:', mapped.map((m) => m.booking_date))
    return mapped
  } catch (error) {
    console.error('Error fetching bookings:', error)
    return []
  }
}

export function calculateBookingMetrics(
  bookings: BookingRecord[],
  startDate?: string,
  endDate?: string,
  sourceFilter?: 'fb' | 'google' | 'all'
) {
  let filtered = bookings

  if (startDate && endDate) {
    const start = new Date(startDate)
    const end = new Date(endDate)
    // Normalize to month boundaries for comparison with YYYY-MM booking dates
    const startMonth = new Date(start.getFullYear(), start.getMonth(), 1)
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1)
    filtered = filtered.filter(b => {
      const [year, month] = String(b.booking_date || '').split('-').map(Number)
      if (!year || !month) return false
      const bookingMonth = new Date(year, month - 1, 1)
      return bookingMonth >= startMonth && bookingMonth <= endMonth
    })
  }

  if (sourceFilter && sourceFilter !== 'all') {
    if (sourceFilter === 'fb') {
      filtered = filtered.filter(b => b.source.startsWith('fb_'))
    } else if (sourceFilter === 'google') {
      filtered = filtered.filter(b => b.source === 'google')
    }
  }

  const totalRevenue = filtered.reduce((sum, b) => sum + b.rvc, 0)
  const bookingCount = filtered.length
  const avgDealValue = bookingCount > 0 ? totalRevenue / bookingCount : 0

  return {
    totalRevenue,
    bookingCount,
    avgDealValue,
    bookings: filtered,
  }
}

// Helper to aggregate FB totals
export function totalsFb(rows: FbEnrichedRow[]) {
  return rows.reduce((a, r) => {
    a.spend += r.spend
    a.clicks += r.clicks
    a.lp_views += r.lp_views
    a.fb_form_leads += r.fb_form_leads
    a.landing_leads += r.landing_leads
    return a
  }, { spend: 0, clicks: 0, lp_views: 0, fb_form_leads: 0, landing_leads: 0 })
}

// Legacy spend loaders (for backward compatibility)
export async function loadFbSpend(range: DateRange) {
  const result = await loadFbTraffic();
  return { 
    spend: result.fbSpendTotal, 
    __debug: result.__debug 
  };
}

export async function loadGoogleSpend(range: DateRange) {
  const result = await loadGoogleTraffic();
  return { 
    spend: result.gaSpendTotal, 
    __debug: result.__debug 
  };
}
