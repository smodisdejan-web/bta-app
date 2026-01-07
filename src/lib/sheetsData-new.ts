import { getSheetsUrl } from './config';
import { fetchJson } from './fetch-json';

type Row = Record<string, any>;

function pick(row: Row, aliases: string[]) {
  for (const k of aliases) if (k in row && row[k] !== '' && row[k] != null) return row[k];
  return undefined;
}
function parseIso(v: any): Date | undefined {
  if (v == null || v === '') return;
  if (v instanceof Date && !isNaN(+v)) return v;
  if (typeof v === 'number') { // Excel serial or epoch ms
    // Heuristic: Excel serials are ~ 45000 in 2023–2025; epoch ms are > 10^10
    if (v > 10_000_000_000) return new Date(v);
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // Excel serial 1
    const d = new Date(excelEpoch.getTime() + v * 86400_000);
    return isNaN(+d) ? undefined : d;
  }
  if (typeof v === 'string') {
    const m = v.match(/\d{4}-\d{2}-\d{2}/);
    if (m) return new Date(m[0] + 'T00:00:00Z');
    const d = new Date(v);
    if (!isNaN(+d)) return d;
  }
  return;
}
function toYmdUTC(d?: Date) { if (!d) return; return d.toISOString().slice(0,10); }

async function getTabRows(tab: string) {
  const base = getSheetsUrl();
  if (!base) return { rows: [] as Row[], __error: 'SHEETS_URL missing' };
  const res = await fetchJson(`${base}?tab=${encodeURIComponent(tab)}`);
  if (!res.ok || typeof res.body !== 'object') return { rows: [] as Row[], __error: `fetch ${tab} status ${res.status}` };
  // Handle both direct array and wrapped { rows: [...] } responses
  let rows: Row[] = [];
  if (Array.isArray(res.body)) {
    rows = res.body as Row[];
  } else if (Array.isArray((res.body as any).rows)) {
    rows = (res.body as any).rows as Row[];
  } else if (Array.isArray((res.body as any).data)) {
    rows = (res.body as any).data as Row[];
  }
  return { rows };
}

export type DateRange = { from: string; to: string }; // yyyy-mm-dd in UTC

export async function loadFbSpend(range: DateRange) {
  const { rows, __error } = await getTabRows('fb_ads_enriched');
  const spendField = ['spend','amount_spent','cost'];
  const dateField  = ['date_iso','date','day'];
  let total = 0;
  const cols = new Set<string>();
  let minD: string|undefined, maxD: string|undefined;
  for (const r of rows) {
    Object.keys(r).forEach(k => cols.add(k));
    const d = pick(r, dateField);
    const dt = toYmdUTC(parseIso(d));
    if (!dt) continue;
    if (dt < range.from || dt > range.to) continue;
    minD = !minD || dt < minD ? dt : minD;
    maxD = !maxD || dt > maxD ? dt : maxD;
    const s = Number(pick(r, spendField) ?? 0);
    if (!isNaN(s)) total += s;
  }
  return { spend: total, __debug: { tab:'fb_ads_enriched', rows: rows.length, minDate:minD, maxDate:maxD, columns:[...cols], error: __error } };
}

export async function loadGoogleSpend(range: DateRange) {
  const { rows, __error } = await getTabRows('daily');
  const spendField = ['cost','spend'];
  const dateField  = ['date_iso','date'];
  let total = 0;
  const cols = new Set<string>();
  let minD: string|undefined, maxD: string|undefined;
  for (const r of rows) {
    Object.keys(r).forEach(k => cols.add(k));
    const dt = toYmdUTC(parseIso(pick(r, dateField)));
    if (!dt || dt < range.from || dt > range.to) continue;
    minD = !minD || dt < minD ? dt : minD;
    maxD = !maxD || dt > maxD ? dt : maxD;
    const s = Number(pick(r, spendField) ?? 0);
    if (!isNaN(s)) total += s;
  }
  return { spend: total, __debug: { tab:'daily', rows: rows.length, minDate:minD, maxDate:maxD, columns:[...cols], error: __error } };
}

export async function loadContacts(range: DateRange) {
  const { rows, __error } = await getTabRows('hubspot_contacts_enriched');
  const dateField = ['date_iso','created_iso','created_at','createdate','results.properties.createdate'];
  const lcField   = ['lifecyclestage','results.properties.lifecyclestage'];
  const lsField   = ['lead_status','hs_lead_status','results.properties.hs_lead_status'];
  let leads = 0;
  const cols = new Set<string>();
  let minD: string|undefined, maxD: string|undefined;
  for (const r of rows) {
    Object.keys(r).forEach(k => cols.add(k));
    const dt = toYmdUTC(parseIso(pick(r, dateField)));
    if (!dt || dt < range.from || dt > range.to) continue;
    minD = !minD || dt < minD ? dt : minD;
    maxD = !maxD || dt > maxD ? dt : maxD;
    // treat every contact as lead (as agreed)
    leads += 1;
  }
  return { leads, __debug: { tab:'hubspot_contacts_enriched', rows: rows.length, minDate:minD, maxDate:maxD, columns:[...cols], foundColumns:{
    date: rows[0] ? dateField.filter(k => k in rows[0]) : []
  }, error: __error } };
}

export async function loadDeals(range: DateRange) {
  const { rows, __error } = await getTabRows('hubspot_deals_enriched');
  const createdField = ['created_iso','created_at','results.createdAt','results.properties.createdate'];
  const closedField  = ['closed_iso','closed_at','closedate','results.properties.closedate'];
  const stageField   = ['stage','dealstage','results.properties.dealstage'];
  const amountField  = ['amount_effective','amount_home','amount','results.properties.amount'];
  let wonDeals = 0, revenue = 0;
  const cols = new Set<string>();
  let minD: string|undefined, maxD: string|undefined;
  for (const r of rows) {
    Object.keys(r).forEach(k => cols.add(k));
    const closedDt = toYmdUTC(parseIso(pick(r, closedField) ?? pick(r, createdField)));
    if (!closedDt || closedDt < range.from || closedDt > range.to) continue;
    minD = !minD || closedDt < minD ? closedDt : minD;
    maxD = !maxD || closedDt > maxD ? closedDt : maxD;
    const stage = String(pick(r, stageField) ?? '').toLowerCase();
    const isWon = stage.includes('won'); // includes 'closedwon'
    if (!isWon) continue;
    const amt = Number(pick(r, amountField) ?? 0);
    if (!isNaN(amt) && amt > 0) {
      revenue += amt;
      wonDeals += 1;
    }
  }
  const avgDealSize = wonDeals > 0 ? revenue / wonDeals : 0;
  return { wonDeals, revenue, avgDealSize, __debug: { tab:'hubspot_deals_enriched', rows: rows.length, minDate:minD, maxDate:maxD, columns:[...cols], error: __error } };
}

