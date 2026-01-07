import { DateTime } from 'luxon';

export type FBRowRaw = {
  date_start: string;
  campaign_name?: string;
  adset_name?: string;
  spend?: number | string;
};

export type FBRowEnriched = {
  date_start: string;
  lp_views?: number | string;
  clicks?: number | string;
  fb_form_leads?: number | string;
  landing_leads?: number | string;
};

export type FacebookSummary = {
  spend: number;
  lpViews: number;
  clicks: number;
  leads: number;
  cplpv: number;
  cpl: number;
  start: string | null;
  end: string | null;
  tz: string;
};

type SheetsClient = {
  readRange: (tabName: string) => Promise<any[][]>;
};

type AnyRow = Record<string, any>;

const TZ = process.env.ACCOUNT_TZ || 'UTC';

const toNum = (v: any) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();

  // strip currency & spaces
  s = s.replace(/[^\d,.\-]/g, '');

  // If it has a comma but no dot, assume EU decimal: "1.234,56" or "123,45"
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(/\./g, '');   // remove thousands dots
    s = s.replace(',', '.');    // decimal comma -> dot
  } else {
    // otherwise just remove thousands commas
    s = s.replace(/,/g, '');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const toDay = (v: any): any => DateTime.fromJSDate(new Date(v)).setZone(TZ).startOf('day');

function pickKey(obj: AnyRow, candidates: string[]) {
  const keys = Object.keys(obj || {});
  for (const k of candidates) {
    if (keys.includes(k)) return k;
  }
  return undefined;
}

function getDateKeySample(rows: AnyRow[]) {
  const cands = ['date_start', 'date', 'date_iso', 'reporting_starts', 'reporting_starts_utc'];
  for (const r of rows) {
    const k = pickKey(r, cands);
    if (k) return k;
  }
  return undefined;
}

function getSpendKeySample(rows: AnyRow[]) {
  const cands = ['spend', 'amount_spent', 'amount', 'cost'];
  for (const r of rows) {
    const k = pickKey(r, cands);
    if (k) return k;
  }
  return undefined;
}

function getStr(r: AnyRow, k?: string) {
  return (k ? String(r[k] ?? '') : '').trim();
}

function headerMap<T = any>(rows: any[][]): T[] {
  if (!rows?.length) return [];
  const [head, ...rest] = rows;
  const keys = head.map((h) =>
    String(h || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^\w]/g, '_'),
  );
  return rest.map((r) => {
    const o: any = {};
    keys.forEach((k, i) => {
      o[k] = r[i];
    });
    return o as T;
  });
}

export function computeFacebookSummary(rawRows: AnyRow[], enrichedRows: AnyRow[]): FacebookSummary {
  // ---- detect keys per sheet ----
  const rawDateKey = getDateKeySample(rawRows);
  const rawSpendKey = getSpendKeySample(rawRows);
  const rawCampKey = (rawRows[0] && pickKey(rawRows[0], ['campaign_name', 'campaign', 'campaignid', 'campaign_id'])) || 'campaign_name';
  const rawAdsetKey = (rawRows[0] && pickKey(rawRows[0], ['adset_name', 'ad_set_name', 'ad_set', 'adset', 'adset_id'])) || 'adset_name';

  const enrDateKey = getDateKeySample(enrichedRows);
  const lpKey = enrichedRows[0] && pickKey(enrichedRows[0], ['lp_views', 'landing_page_views']);
  const clkKey = enrichedRows[0] && pickKey(enrichedRows[0], ['clicks', 'link_clicks']);
  const fblKey = enrichedRows[0] && pickKey(enrichedRows[0], ['fb_form_leads', 'fb_leads', 'form_leads']);
  const landKey = enrichedRows[0] && pickKey(enrichedRows[0], ['landing_leads', 'site_leads']);

  // ---- build date window from both tabs ----
  const allDates: any[] = [];
  if (rawDateKey) for (const r of rawRows) { const d = toDay(r[rawDateKey]); if (d.isValid) allDates.push(d); }
  if (enrDateKey) for (const r of enrichedRows) { const d = toDay(r[enrDateKey]); if (d.isValid) allDates.push(d); }

  if (!allDates.length) {
    console.warn('[FB] No valid dates found in raw or enriched.');
    return { spend: 0, lpViews: 0, clicks: 0, leads: 0, cplpv: 0, cpl: 0, start: null, end: null, tz: TZ };
  }

  const end = DateTime.max(...allDates);
  const start = end.minus({ days: 29 }).startOf('day');
  const inWindow = (d: any) => d >= start && d <= end;

  // ---- spend from RAW (deduped by day+campaign+adset) ----
  let spend = 0;
  if (!rawDateKey || !rawSpendKey) {
    console.warn('[FB] Missing raw keys:', { rawDateKey, rawSpendKey });
  } else {
    const spendByKey = new Map<string, number>();
    for (const r of rawRows) {
      const d = toDay(r[rawDateKey]);
      if (!d.isValid || !inWindow(d)) continue;
      const rawValue = r[rawSpendKey];

      // Skip if raw value looks like a date string (e.g., "2025-11-06 00:00:00")
      if (typeof rawValue === 'string' && rawValue.includes('-') && rawValue.includes(':')) {
        console.warn('[FB] Skipping invalid spend (date string):', rawValue);
        continue;
      }

      const s = toNum(rawValue);

      // Skip unrealistic spend values (likely Excel date serials ~44k-47k)
      // No single campaign should spend more than €5000/day
      if (s > 5000) {
        console.warn('[FB] Skipping invalid spend (too high, likely Excel date):', s, 'raw:', rawValue);
        continue;
      }

      if (s === 0) continue;
      const camp = getStr(r, rawCampKey) || '(no-campaign)';
      const adst = getStr(r, rawAdsetKey) || '(no-adset)';
      const key = `${d.toISODate()}|${camp}|${adst}`;
      spendByKey.set(key, (spendByKey.get(key) || 0) + s);
    }
    spend = Array.from(spendByKey.values()).reduce((a, b) => a + b, 0);
    if (spend === 0) {
      console.warn('[FB] Spend summed to 0. Check raw headers/sample:', {
        rawDateKey, rawSpendKey, rawCampKey, rawAdsetKey,
        sampleRow: rawRows[0]
      });
    }
  }

  // ---- metrics from ENRICHED ----
  let lpViews = 0; let clicks = 0; let leads = 0;
  if (!enrDateKey) console.warn('[FB] Missing enriched date key.');
  for (const r of enrichedRows) {
    const d = toDay(r[enrDateKey!]);
    if (!d.isValid || !inWindow(d)) continue;
    if (lpKey) lpViews += toNum(r[lpKey]);
    if (clkKey) clicks += toNum(r[clkKey]);
    const fbl = fblKey ? toNum(r[fblKey]) : 0;
    const lnd = landKey ? toNum(r[landKey]) : 0;
    leads += fbl + lnd;
  }

  const cplpv = lpViews > 0 ? spend / lpViews : 0;
  const cpl = leads > 0 ? spend / leads : 0;

  // helpful logs in dev
  if (process.env.NODE_ENV !== 'production') {
    console.log('[FB] Keys:', { rawDateKey, rawSpendKey, rawCampKey, rawAdsetKey, enrDateKey });
    console.log('fb_ads_raw first row:', rawRows[0]);
    console.log('fb_ads_enriched first row:', enrichedRows[0]);
    console.log('[FB] Window:', { start: start.toISODate(), end: end.toISODate(), tz: TZ });
    console.log('[FB] Totals:', { spend, lpViews, clicks, leads, cplpv, cpl });
  }

  return { spend, lpViews, clicks, leads, cplpv, cpl, start: start.toISODate(), end: end.toISODate(), tz: TZ };
}

export async function getFacebookSummaryLast30d(sheets: SheetsClient): Promise<FacebookSummary> {
  const safeRead = async (tab: string) => {
    try {
      return await sheets.readRange(tab);
    } catch {
      return [];
    }
  };

  const rawRows = headerMap<FBRowRaw>(await safeRead('fb_ads_raw'));
  const enrRows = headerMap<FBRowEnriched>(await safeRead('fb_ads_enriched'));

  return computeFacebookSummary(rawRows, enrRows);
}

