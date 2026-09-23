// src/lib/streak-leads.ts
//
// ONE lead loader for the whole dashboard.
//
// WHY THIS EXISTS (2026-09-21)
// Two pages of the same dashboard disagreed about how many leads September had:
//   /api/funnel        — `streak_full` (the full daily Streak API scan) UNIONed with
//                        `streak_sync`, days bucketed with toDay() (+4h, so a 22:00Z stamp
//                        lands on the right Ljubljana day)  →  Meta 999 / Google 184
//   / (Overview) and /api/freshness
//                      — `streak_sync` ALONE (the Zapier-fed tab, which was missing boxes
//                        Streak had not pushed yet), days bucketed with toIsoDay() (plain
//                        first-10-chars, no shift)          →  Meta 997 / Google 184
// Same window, same client, two numbers. The funnel's rule is the verified-correct one
// (checked row for row against the Streak API on 2026-09-21), so this module lifts it out of
// business-funnel.ts and both other call sites now import it.
//
// THE RULE, in one place:
//   rows   = streak_full ∪ (streak_sync rows OUTSIDE streak_full's coverage)
//            streak_full is a ~19-minute full pipeline scan, so it runs on a schedule and
//            always lags the newest hours; streak_sync is Zapier-fed and always current.
//            A union rather than a fallback means a stale scan can never clip the window
//            back to its own last day.
//   day    = toDay(inquiry_date) — lib/day.ts, Europe/Ljubljana
//   channel= SOURCE DETAIL first, then platform (see leadChannelOf)
//   QL     = AI >= QL_THRESHOLD (50)
//
// NOT applied here: the funnel's ASSET/RareOps exclusion from master QL. That is a funnel-only
// rule (the umbrella's Streak AI score is inflated); the Overview has always counted every
// paid lead, and this change is about the SOURCE and the DAY, not about redefining QL.

import { DEFAULT_WEB_APP_URL, getSheetsUrl, SHEETS_TABS } from './config'
import { toDay } from './day'
import { mapStreakLeads, type StreakLeadRow } from './sheetsData'

/** The four paid channels the dashboard reports. Mirrors PAID_CHANNELS in business-funnel.ts. */
export type PaidLeadChannel = 'meta' | 'google' | 'bing' | 'chatgpt'

/** AI score at or above this is a Quality Lead. Same threshold as business-funnel.QL_THRESHOLD. */
export const QL_MIN_AI = 50

/** The Europe/Ljubljana day a Streak lead belongs to, or '' when it carries no usable date. */
export function streakLeadDay(l: Pick<StreakLeadRow, 'inquiry_date'>): string {
  return toDay(l.inquiry_date)
}

/**
 * Which paid channel a Streak lead belongs to.
 *
 * SOURCE DETAIL IS READ FIRST, AND THAT ORDER IS THE WHOLE POINT. Streak tags Bing AND ChatGPT
 * leads with LATEST SOURCE CATEGORY = PAID_SEARCH, which the sync writes out as
 * platform = "google" — so reading `platform` first counts every Bing and ChatGPT lead as a
 * Google lead, and Google's CPQL gets measured against leads it never bought. Verified
 * 2026-09-14: Bing leads carry `ms - search - croatia - en`, the live ChatGPT lead carries
 * `chatgpt-intl-croatia-sep26`. The channel tag lives in SOURCE DETAIL and nowhere else.
 */
export function leadChannelOf(
  l: Pick<StreakLeadRow, 'source_detail' | 'platform'>
): PaidLeadChannel | null {
  const d = (l.source_detail || '').toLowerCase()
  if (d.startsWith('ms - ') || d.startsWith('ms_')) return 'bing'
  if (d.startsWith('chatgpt')) return 'chatgpt'
  const p = (l.platform || '').toLowerCase()
  if (p.includes('facebook') || p.includes('meta') || p.includes('instagram')) return 'meta'
  if (p.includes('google') || p.includes('adwords')) return 'google'
  return null
}

/** Is this lead a Quality Lead? */
export const isQualityLead = (l: Pick<StreakLeadRow, 'ai_score'>): boolean =>
  (l.ai_score || 0) >= QL_MIN_AI

/** First and last day a set of leads covers, '' / '' when it covers nothing. */
export function streakCoverage(rows: StreakLeadRow[]): { min: string; max: string } {
  let min = ''
  let max = ''
  for (const r of rows) {
    const d = streakLeadDay(r)
    if (!d) continue
    if (!min || d < min) min = d
    if (!max || d > max) max = d
  }
  return { min, max }
}

/**
 * streak_full ∪ streak_sync, the SAME union loadStreak() in business-funnel.ts performs:
 * streak_full supplies every day it covers, streak_sync fills only what falls outside that
 * coverage. Either side missing degrades to the other rather than to an empty list.
 */
export function unionStreakRows(full: StreakLeadRow[], sync: StreakLeadRow[]): StreakLeadRow[] {
  if (!full.length) return sync
  if (!sync.length) return full
  const cov = streakCoverage(full)
  if (!cov.min || !cov.max) return sync
  return full.concat(
    sync.filter((r) => {
      const d = streakLeadDay(r)
      return !!d && (d < cov.min || d > cov.max)
    })
  )
}

/** Leads whose Ljubljana day falls inside [fromIso, toIso], both inclusive, both YYYY-MM-DD. */
export function filterStreakByDay<T extends Pick<StreakLeadRow, 'inquiry_date'>>(
  rows: T[],
  fromIso: string,
  toIso: string
): T[] {
  return rows.filter((r) => {
    const d = streakLeadDay(r)
    return !!d && d >= fromIso && d <= toIso
  })
}

/**
 * The dashboard's lead set: streak_full unioned with streak_sync, mapped to StreakLeadRow.
 * A failed streak_full read degrades to streak_sync alone (with a console warning) — exactly
 * how business-funnel.loadStreak() behaves — so the page still renders, just on the older rule.
 */
export async function fetchStreakLeadsUnion(
  fetchSheetFn: (args: { sheetUrl: string; tab: string }) => Promise<any[][]>,
  sheetUrl?: string
): Promise<StreakLeadRow[]> {
  const url = sheetUrl || getSheetsUrl() || DEFAULT_WEB_APP_URL
  const [full, sync] = await Promise.all([
    fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.STREAK_FULL })
      .then(mapStreakLeads)
      .catch((e) => {
        console.warn('[streak-leads] streak_full unavailable, using streak_sync only', e?.message || e)
        return [] as StreakLeadRow[]
      }),
    fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.STREAK_SYNC })
      .then(mapStreakLeads)
      .catch((e) => {
        console.warn('[streak-leads] streak_sync unavailable, using streak_full only', e?.message || e)
        return [] as StreakLeadRow[]
      }),
  ])
  return unionStreakRows(full, sync)
}
