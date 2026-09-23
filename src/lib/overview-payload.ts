// src/lib/overview-payload.ts
//
// The shape /api/overview-data hands to the Overview page, and the row mappers both sides use.
//
// WHY THIS EXISTS (2026-09-23). The Overview used to open eight `?tab=` requests straight at the
// Apps Script web app from the browser, plus /api/dashboard-totals and /api/insights/summary.
// Apps Script caps at ~30 simultaneous executions and a fat tab takes 3-40 s, so with two people
// on the page it queued behind itself and "Preparing your insights..." sat there for 50-150 s.
// The data behind those tabs moves once a day (/gm) and Meta once a week, so a browser has no
// business reading the sheet at all: one server route reads every tab through the shared 10-min
// tab cache in lib/sheetsData.ts and the CDN shares that one build across every viewer.
//
// THE CONTRACT THIS FILE CARRIES: every tab is `T[] | null`. null means the read failed and
// there was no stale copy — NO MEASUREMENT. It is never `[]` pretending to be data and never 0.
// The page already renders "n/a" for an empty feed through its coverage guards, so null flows
// into exactly those paths. See the 2026-09-08 (FB spend EUR 0) and 2026-09-14 (Google spend
// EUR 0) incidents in the bta memory: both were a dead source rendered as a measured zero.
//
// The mappers below were lifted VERBATIM out of app/page.tsx so the server produces byte-identical
// rows to what the client used to build itself. Do not "improve" them here without re-running the
// before/after comparison in scripts/verify-overview-data.ts.

import type { BookingRecord, FbEnrichedRow, SheetTabMeta } from './sheetsData'

export type { SheetTabMeta }

/** A row of any `date | … | cost | clicks | conv | value` daily tab (daily_api, bing, chatgpt). */
export type DailyRow = {
  date: string
  cost: number
  clicks: number
  conv: number
  value: number
}

/** Rows of the `fb_ads_api` tab: one (date, campaign, spend) triple straight from Meta. */
export type FbSpendApiRow = {
  date: string
  campaign: string
  spend: number
}

/**
 * The only Streak columns the Overview reads: the day, the AI score, the market, and the two
 * fields leadChannelOf() needs. streak_full carries the whole year, so shipping the other nine
 * columns would triple the payload for nothing.
 */
export type OverviewLeadRow = {
  inquiry_date: string
  ai_score: number
  country: string
  source_detail: string
  platform: string
}

/** What /api/dashboard-totals answers, kept verbatim so the fallback paths cannot shift. */
export type OverviewApiTotals = {
  fb: Record<string, any>
  google: Record<string, any>
  combined: { leads: number; spend: number }
}

export type OverviewPayload = {
  /** The window the caller asked for; only `apiTotals` depends on it, the tabs are whole. */
  range: { start: string; end: string }
  generatedAt: string
  /** true when the caller passed ?nocache=1 — the tab cache was bypassed for this build. */
  nocache: boolean
  /** Per-tab provenance, keyed by tab name. Read this before trusting a null. */
  meta: Record<string, SheetTabMeta>
  /** daily_api — Google Ads */
  google: DailyRow[] | null
  /** bing_ads_api — Microsoft Advertising (flat channel) */
  bing: DailyRow[] | null
  /** chatgpt_ads_api — OpenAI Ads Manager (flat channel) */
  chatgpt: DailyRow[] | null
  /** fb_ads_api — daily Meta spend */
  fbSpendApi: FbSpendApiRow[] | null
  /** fb_ads_enriched — Meta clicks / LP views / platform leads */
  fbEnriched: FbEnrichedRow[] | null
  /** streak_full ∪ streak_sync, the union /api/funnel counts. null only if BOTH tabs failed. */
  streakLeads: OverviewLeadRow[] | null
  /** bookings_api — booking_date is a MONTH string ("2026-09"), not a day. */
  bookings: BookingRecord[] | null
  /** The /api/dashboard-totals answer for this window, computed from the same cached tabs. */
  apiTotals: OverviewApiTotals | null
}

export function mapDailyRows(headers: string[], rows: any[][]): DailyRow[] {
  if (!headers?.length || !rows?.length) return []
  const norm = (s: any) => String(s || '').trim().toLowerCase()
  const col = (name: string) => headers.findIndex((h) => norm(h) === name)
  const idx = {
    date: col('date') !== -1 ? col('date') : col('day'),
    cost: col('cost'),
    clicks: col('clicks'),
    conv: col('conv'),
    value: col('value')
  }
  return rows.map((r) => ({
    date: String(r[idx.date] || ''),
    cost: Number(r[idx.cost]) || 0,
    clicks: Number(r[idx.clicks]) || 0,
    conv: Number(r[idx.conv]) || 0,
    value: Number(r[idx.value]) || 0
  }))
}

export function mapFbSpendApiRows(headers: string[], rows: any[][]): FbSpendApiRow[] {
  if (!headers?.length || !rows?.length) return []
  const norm = (v: any) => String(v || '').trim().toLowerCase()
  const col = (name: string) => headers.findIndex((h) => norm(h) === name)
  const idx = { date: col('date'), campaign: col('campaign'), spend: col('spend') }
  if (idx.date === -1 || idx.spend === -1) return []
  return rows
    .map((r) => ({
      date: String(r[idx.date] || '').slice(0, 10),
      campaign: idx.campaign === -1 ? '' : String(r[idx.campaign] || ''),
      spend: Number(r[idx.spend]) || 0
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
}
