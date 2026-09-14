/**
 * bookings_api row → paid channel. ONE rule, used by the funnel API (business-funnel.ts) and by
 * the Overview page (page.tsx), so a booking can never be Bing on one screen and Google on another.
 *
 * PHASE 2 (2026-09-14). Phase 1 could not answer this at all: `bookings_api.source` carried only
 * `fb_landing` / `fb_lead` / `google`, so every Bing and ChatGPT booking would have been counted
 * as a Google booking, and both channels reported bookings/revenue/ROAS as "n/a (faza 2)".
 *
 * Two signals, in this order:
 *
 *  1. `source` — the upstream writers (brain: code/sheets/reconcile-goolets-bookings-acq.js and
 *     code/sheets/sync-goolets-bookings.js) now emit `bing` / `chatgpt` directly, derived from the
 *     Acq Channel sheet's Campaign column. That is the authoritative path.
 *  2. `campaign` — the same prefix rule the Streak lead split uses (`leadChannel()`), applied to
 *     rows whose source is still the generic `google`. The flat `bookings` tab is ALSO hand-edited,
 *     and a hand-typed row bypasses both scripts; without this fallback such a row would land in
 *     Paid Google. The prefixes are the live campaign names, verified 2026-09-14 against the
 *     bing_ads_api feed ("MS - Search - Croatia - EN", "MS - All - Search - Brand Campaign") and
 *     the chatgpt_ads_api feed ("CGA INTL/US/ALL Croatia Crewed Yacht …"), plus the ChatGPT
 *     utm_campaign form ("chatgpt-all-croatia-ocpc-sep26") the Acq sheet may carry instead.
 *
 * NOTHING IS GUESSED. A source that matches no rule returns null and stays unattributed — the same
 * contract the lead split has. Checked against all 144 rows of the live feed on 2026-09-14: no
 * existing campaign name starts with `ms -`, `cga ` or `chatgpt`, so no historical booking is
 * reclassified by this (the nearest neighbour, "CLG - Search - Croatia - EN", is `clg`, not `cga`).
 */

export type BookingPaidChannel = 'meta' | 'google' | 'bing' | 'chatgpt'

/** "MS - Search - Croatia - EN", "ms_search_croatia_en" — Microsoft Advertising. */
const BING_CAMPAIGN = /^ms\s*[-_]/
/** "CGA ALL Croatia Crewed Yacht oCPC 2026-09" (campaign name) or "chatgpt-…" (utm_campaign). */
const CHATGPT_CAMPAIGN = /^(chatgpt|cga[\s-])/

export function bookingChannelOf(b: { source: string; campaign?: string }): BookingPaidChannel | null {
  const s = String(b.source ?? '').trim().toLowerCase()
  if (s.startsWith('fb')) return 'meta'
  if (s === 'bing') return 'bing'
  if (s === 'chatgpt') return 'chatgpt'
  if (s !== 'google') return null
  // Paid search at source. Which engine is in the campaign name and nowhere else.
  const c = String(b.campaign ?? '').trim().toLowerCase()
  if (BING_CAMPAIGN.test(c)) return 'bing'
  if (CHATGPT_CAMPAIGN.test(c)) return 'chatgpt'
  return 'google'
}
