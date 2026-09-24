// UTM Mapping — authoritative utm → campaign / adset / ad table.
//
// Synced from Dejan's confirmed sheet into the `utm_mapping` tab
// (brain: code/sheets/sync-goolets-utm-mapping.js). This is the join key that
// turns a Streak lead's utm_content into a concrete campaign/ad, unblocking
// per-campaign lead → QL → booking attribution (the missing bridge: Meta never
// exported url_tags, so this human-maintained table is the source of truth).
//
// Lead-form / boost / job ads have an empty UTM on purpose (their UTM carries the
// campaign name) — those rows are kept for reference but excluded from the UTM index.

import { DEFAULT_WEB_APP_URL, SHEETS_TABS, getSheetsUrl } from './config'

export interface UtmMappingRow {
  utm: string
  campaign: string
  adset: string
  ad: string
  adId: string
  adsetId: string
  campaignId: string
}

export interface UtmIndex {
  rows: UtmMappingRow[]
  byUtm: Map<string, UtmMappingRow>      // normalized utm → row (only non-empty utm)
  byAdId: Map<string, UtmMappingRow>     // ad_id → row
  byCampaignId: Map<string, UtmMappingRow[]>
  /** Resolve a lead's utm_content to its mapping row (exact, then prefix). */
  resolve: (utmContent: string | null | undefined) => UtmMappingRow | null
}

export const normalizeUtm = (s: string | null | undefined): string =>
  String(s ?? '').trim().toLowerCase()

export async function fetchUtmMapping(
  sheetUrl: string = getSheetsUrl() || DEFAULT_WEB_APP_URL,
): Promise<UtmIndex> {
  const res = await fetch(`${sheetUrl}?tab=${encodeURIComponent(SHEETS_TABS.UTM_MAPPING)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`utm_mapping fetch failed: ${res.status}`)
  const raw = await res.json()
  const rows: UtmMappingRow[] = (Array.isArray(raw) ? raw : []).map((r: any) => ({
    utm: String(r.utm || '').trim(),
    campaign: String(r.campaign || '').trim(),
    adset: String(r.adset || '').trim(),
    ad: String(r.ad || '').trim(),
    adId: String(r.ad_id || '').trim(),
    adsetId: String(r.adset_id || '').trim(),
    campaignId: String(r.campaign_id || '').trim(),
  })).filter((r: UtmMappingRow) => r.adId || r.campaign)

  const byUtm = new Map<string, UtmMappingRow>()
  const byAdId = new Map<string, UtmMappingRow>()
  const byCampaignId = new Map<string, UtmMappingRow[]>()
  for (const row of rows) {
    if (row.utm) byUtm.set(normalizeUtm(row.utm), row)
    if (row.adId) byAdId.set(row.adId, row)
    if (row.campaignId) {
      const arr = byCampaignId.get(row.campaignId) || []
      arr.push(row)
      byCampaignId.set(row.campaignId, arr)
    }
  }

  // Longest UTMs first so a prefix match prefers the most specific row.
  const utmKeysByLength = [...byUtm.keys()].sort((a, b) => b.length - a.length)

  const resolve = (utmContent: string | null | undefined): UtmMappingRow | null => {
    const key = normalizeUtm(utmContent)
    if (!key) return null
    const exact = byUtm.get(key)
    if (exact) return exact
    // Tolerate trailing variants (e.g. Meta appends `_<placement>`): match on the
    // longest configured UTM that the lead's utm_content starts with.
    for (const k of utmKeysByLength) {
      if (key.startsWith(k)) return byUtm.get(k)!
    }
    return null
  }

  return { rows, byUtm, byAdId, byCampaignId, resolve }
}
