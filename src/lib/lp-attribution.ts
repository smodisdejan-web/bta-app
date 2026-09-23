/**
 * Landing Page Attribution — joins HubSpot contacts (from form submissions)
 * with Streak quality scoring and aggregates per landing page.
 *
 * Powers the `/ga4-landing-pages` (LP Funnel) dashboard.
 *
 * Data flow:
 *   hubspot_contacts (LP + form metadata)
 *     ↓  email match
 *   streak_sync (AI score → QL classification)
 *     ↓  optional join (when bookings tab adds landing_page field)
 *   bookings (RVC)
 */

import type { HubSpotContactRow, StreakLeadRow, BookingRecord, GA4LandingRow } from './sheetsData'

// ============================================================================
// TYPES
// ============================================================================

export interface JoinedLead {
  hs_object_id: string
  email: string
  createdate: string
  country: string
  first_url_path: string
  last_url_path: string
  recent_conversion_event_name: string
  first_conversion_event_name: string
  hs_analytics_source: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  ai_score: number | null     // null = not in Streak
  streak_stage: string | null  // null = not in Streak
  is_ql: boolean              // ai_score >= 50
  is_matched: boolean         // exists in Streak
  email_open: number          // marketing emails opened
  email_click: number         // marketing emails clicked
  email_delivered: number     // marketing emails delivered
  is_email_engaged: boolean   // opened or clicked ≥1 marketing email
}

export interface LPAggregate {
  path: string
  leads: number
  matched_in_streak: number   // transparency for AI-based metrics
  ql: number                  // matched && ai_score >= 50
  ql_rate: number             // ql / matched (%) — Quality Rate is over Streak-matched leads, NOT all leads
  avg_ai_score: number        // over matched subset only
  top_channel: string         // most common hs_analytics_source
  channel_breakdown: Record<string, number>  // channel → lead count
  top_campaign: string
  top_form: string            // most common conversion event
  // GA4 fields (populated when ga4_landing_pages tab joined)
  sessions?: number
  users?: number
  cvr?: number                // leads / sessions × 100
  // Booking fields (joined from bookings tab via email match)
  bookings?: number           // count of bookings from leads on this LP
  revenue?: number            // sum of rvc across matched bookings (EUR)
  booking_rate?: number       // bookings / leads × 100
  roas?: number               // revenue / spend (TODO when spend per LP available)
}

export interface LPFunnelTotals {
  total_leads: number
  total_matched: number
  total_ql: number
  avg_ql_rate: number       // overall ql / matched (Streak-matched leads, NOT all leads). Coverage shown separately.
  avg_ai_score: number      // over matched subset
  unique_lps: number
  date_range: { from: string; to: string }
  // GA4 totals (only populated when ga4_landing_pages data available)
  total_sessions?: number
  total_users?: number
  overall_cvr?: number      // leads / sessions × 100
  // Booking totals (joined from bookings tab via email match)
  total_bookings?: number
  total_revenue?: number
  avg_deal_size?: number
}

/**
 * Aggregate GA4 rows by landing page within date range.
 * Returns Map<path, { sessions, users, conversions }> for fast join.
 */
export function aggregateGA4ByLP(
  rows: GA4LandingRow[],
  fromISO: string,
  toISO: string,
): Map<string, { sessions: number; users: number; conversions: number }> {
  const from = new Date(fromISO).getTime()
  const to = new Date(toISO).getTime()
  const map = new Map<string, { sessions: number; users: number; conversions: number }>()
  for (const r of rows) {
    if (!r.date || !r.landingPage) continue
    const t = new Date(r.date).getTime()
    if (Number.isNaN(t) || t < from || t > to) continue
    const path = normaliseLpPath(r.landingPage)
    if (!path) continue
    if (!map.has(path)) map.set(path, { sessions: 0, users: 0, conversions: 0 })
    const s = map.get(path)!
    s.sessions += r.sessions
    s.users += r.totalUsers || 0
    s.conversions += r.conversions
  }
  return map
}

/**
 * Normalise an LP path so HubSpot and GA4 representations join cleanly:
 *   lowercase, strip query string, strip trailing slash (except root).
 * Matches the same cleaning applied in code/hubspot/sync-goolets-contacts.js.
 */
function normaliseLpPath(raw: string): string {
  if (!raw) return ''
  let p = raw.split('?')[0].split('#')[0].toLowerCase().trim()
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

// ============================================================================
// JOIN
// ============================================================================

/**
 * Derive channel from UTM parameters, fallback to HubSpot session attribution.
 *
 * HubSpot's `hs_analytics_source` is unreliable on Goolets (WP migration bug +
 * multi-session journey misclassification — paid leads often tagged ORGANIC_SEARCH
 * when they returned via Google before submit). UTM source/medium are more
 * authoritative because they're captured at form-submit time from URL query string.
 */
function deriveChannel(
  utm_source: string,
  utm_medium: string,
  hs_analytics_source: string
): string {
  const src = (utm_source || '').toLowerCase()
  const med = (utm_medium || '').toLowerCase()
  // Paid social: FB/IG/Meta with paid medium (or default for fb/ig)
  if (/^(facebook|instagram|fb|ig|meta)$/.test(src)) return 'PAID_SOCIAL'
  // Paid search: Google Ads / adwords with cpc/ppc/paid medium
  if (/^(adwords|google|gads|googleads)$/.test(src) && /^(cpc|ppc|paid)$/.test(med)) return 'PAID_SEARCH'
  // Email
  if (med === 'email' || src === 'newsletter' || /mailchimp|hubspot/.test(src)) return 'EMAIL_MARKETING'
  // Fallback to HubSpot session attribution (organic, direct, referral, etc.)
  return hs_analytics_source || 'UNKNOWN'
}

/**
 * Join HubSpot contacts to Streak leads on email.
 *
 * NB: streak_sync column J is labelled "Name" but actually contains the email
 * (verified from production sheet 2026-05-17). The mapStreakLeads function
 * exposes it as `name`.
 */
export function joinHubspotStreak(
  hsContacts: HubSpotContactRow[],
  streakLeads: StreakLeadRow[]
): JoinedLead[] {
  // Build email → Streak map (last occurrence wins if duplicates)
  const streakMap = new Map<string, StreakLeadRow>()
  for (const lead of streakLeads) {
    const email = (lead.name || '').toLowerCase().trim()
    if (email) streakMap.set(email, lead)
  }

  return hsContacts.map(c => {
    const streak = streakMap.get(c.email)
    const ai_score = streak ? streak.ai_score : null
    const channel = deriveChannel(c.utm_source, c.utm_medium, c.hs_analytics_source)
    return {
      hs_object_id: c.hs_object_id,
      email: c.email,
      createdate: c.createdate,
      country: c.country,
      first_url_path: c.first_url_path,
      last_url_path: c.last_url_path,
      recent_conversion_event_name: c.recent_conversion_event_name,
      first_conversion_event_name: c.first_conversion_event_name,
      hs_analytics_source: channel, // Override: UTM-derived channel takes precedence
      utm_source: c.utm_source,
      utm_medium: c.utm_medium,
      utm_campaign: c.utm_campaign,
      ai_score,
      streak_stage: streak ? streak.stage : null,
      is_ql: ai_score !== null && ai_score >= 50,
      is_matched: streak !== undefined,
      email_open: c.email_open || 0,
      email_click: c.email_click || 0,
      email_delivered: c.email_delivered || 0,
      is_email_engaged: (c.email_open || 0) > 0 || (c.email_click || 0) > 0,
    }
  })
}

// ============================================================================
// EMAIL MARKETING (section B): do email-engaged leads convert better?
// ============================================================================

export interface EmailFunnelBucket {
  label: 'engaged' | 'non_engaged'
  leads: number
  matched: number       // in Streak (denominator for QL rate)
  ql: number
  ql_rate: number       // ql / matched (%)
  bookings: number      // leads in this bucket whose email shows up in bookings
  booking_rate: number  // bookings / leads (%)
}

/**
 * Split in-range leads into email-engaged vs non-engaged and compare QL + booking
 * rates. "Engaged" = opened or clicked ≥1 marketing email. Booking is lead-cohort
 * here (did THIS lead's email ever book) — the question is whether nurturing a lead
 * lifts its own conversion, so booking month is irrelevant.
 *
 * NB: correlation, not proven causation — engaged leads are self-selected (more
 * interested prospects open more email). Surfaced as a signal, labelled as such.
 */
export function computeEmailFunnel(
  leads: JoinedLead[],
  bookedEmails: Set<string>,
): { engaged: EmailFunnelBucket; non_engaged: EmailFunnelBucket; booking_lift: number } {
  const make = (label: 'engaged' | 'non_engaged'): EmailFunnelBucket =>
    ({ label, leads: 0, matched: 0, ql: 0, ql_rate: 0, bookings: 0, booking_rate: 0 })
  const eng = make('engaged')
  const non = make('non_engaged')

  for (const l of leads) {
    const b = l.is_email_engaged ? eng : non
    b.leads++
    if (l.is_matched) b.matched++
    if (l.is_ql) b.ql++
    if (l.email && bookedEmails.has(l.email)) b.bookings++
  }
  for (const b of [eng, non]) {
    b.ql_rate = b.matched > 0 ? (b.ql / b.matched) * 100 : 0
    b.booking_rate = b.leads > 0 ? (b.bookings / b.leads) * 100 : 0
  }
  const booking_lift = non.booking_rate > 0 ? eng.booking_rate / non.booking_rate : 0
  return { engaged: eng, non_engaged: non, booking_lift }
}

// ============================================================================
// FILTER
// ============================================================================

export function filterByDateRange(
  leads: JoinedLead[],
  fromISO: string,
  toISO: string
): JoinedLead[] {
  const from = new Date(fromISO).getTime()
  const to = new Date(toISO).getTime()
  return leads.filter(l => {
    if (!l.createdate) return false
    const d = new Date(l.createdate).getTime()
    return d >= from && d <= to
  })
}

/**
 * Strip non-LP pages (admin, blog, generic content). Tune for Goolets reality.
 */
export function isAttributableLP(path: string): boolean {
  if (!path) return false
  // Always include known LP patterns
  const isLP = /^\/(luxury|private|charter|sail|smart|bella|alessandro|riva|ohana|maxita|anima|early|last-minute|destination|yacht-rentals|plan-your-charter|sail-charter|yacht-matchmaker|the-perfect|family)/i.test(path)
  if (isLP) return true
  // Exclude utility / known non-LPs
  if (/^\/(blog|about|contact|privacy|terms|wp-|admin|search|thank-you|404)/i.test(path)) return false
  // Default: include — Goolets has many vessel-specific LPs we may not anticipate
  return true
}

// ============================================================================
// AGGREGATE
// ============================================================================

function topByCount(items: string[]): string {
  if (items.length === 0) return ''
  const counts = new Map<string, number>()
  for (const x of items) {
    if (!x) continue
    counts.set(x, (counts.get(x) || 0) + 1)
  }
  let top = ''
  let max = 0
  for (const [k, v] of counts.entries()) {
    if (v > max) { top = k; max = v }
  }
  return top
}

export const UNATTRIBUTED_LP = '(unattributed)'

/**
 * Booking attribution model — BOOKING-DATE (locked 2026-06-15, replaced lead-cohort).
 *
 * A booking counts in the month it HAPPENED (booking_date), not the month its lead
 * arrived. "Booking in June → shows in June." Simpler and matches how Dejan reads the
 * dashboard. (Old lead-cohort model hid a June booking that came from a May lead.)
 *
 * Bookings still credit the landing page their booker first arrived on, via a global
 * email→LP map built from ALL leads (any date) — so attribution survives even when the
 * booker's lead predates the selected range.
 */
export function filterBookingsByBookingMonth(
  bookings: BookingRecord[],
  fromISO: string,
  toISO: string,
): BookingRecord[] {
  // booking_date is month-granular ("YYYY-MM"); compare on a year*12+month index.
  const from = new Date(fromISO)
  const to = new Date(toISO)
  const fromIdx = from.getFullYear() * 12 + from.getMonth()
  const toIdx = to.getFullYear() * 12 + to.getMonth()
  return bookings.filter(b => {
    const [y, m] = String(b.booking_date || '').split('-').map(Number)
    if (!y || !m) return false
    const idx = y * 12 + (m - 1)
    return idx >= fromIdx && idx <= toIdx
  })
}

/**
 * Booking / HubSpot email hygiene. The bookings sheet is typed by hand, so client_email
 * carries typos (".comm") and sometimes two addresses in one cell ("a@x.net/b@y.com.au").
 * Returns the candidate addresses in order: lowercased, trimmed, split on / , ; and
 * whitespace, stripped of wrapping punctuation, with the non-existent TLD typos .comm, .con
 * and .cmo fixed to .com. Used on BOTH sides of the booking → LP join so they agree.
 */
export function normalizeEmailCandidates(raw: string | null | undefined): string[] {
  const s = String(raw ?? '').toLowerCase().trim()
  if (!s) return []
  const out: string[] = []
  for (const piece of s.split(/[\/,;\s]+/)) {
    let e = piece.replace(/^[<(\['"]+/, '').replace(/[>)\]'".]+$/, '')
    if (!e.includes('@')) continue
    e = e.replace(/\.(comm|con|cmo)$/, '.com')
    if (!out.includes(e)) out.push(e)
  }
  return out
}

/** First candidate address of `raw` that exists in `emailToLp`, or null. */
export function lookupLpByEmail(
  raw: string | null | undefined,
  emailToLp: Map<string, string>,
): string | null {
  for (const e of normalizeEmailCandidates(raw)) {
    const lp = emailToLp.get(e)
    if (lp) return lp
  }
  return null
}

/**
 * email → first landing page, across ALL leads (any date). First landing wins.
 * Lets a booking attach to the LP its booker originally arrived on even when that
 * lead is outside the selected range.
 */
export function buildEmailToLpMap(allLeads: JoinedLead[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const l of allLeads) {
    if (!l.first_url_path) continue
    for (const email of normalizeEmailCandidates(l.email)) {
      if (!map.has(email)) map.set(email, l.first_url_path)
    }
  }
  return map
}

/**
 * Aggregate booking-date-filtered bookings per LP path via the global email→LP map.
 * Bookings whose booker has no tracked lead fall into UNATTRIBUTED_LP so per-LP totals
 * reconcile with the headline.
 */
export function aggregateBookingsByLp(
  bookingsInRange: BookingRecord[],
  emailToLp: Map<string, string>,
): Map<string, { count: number; revenue: number }> {
  const map = new Map<string, { count: number; revenue: number }>()
  for (const b of bookingsInRange) {
    const path = lookupLpByEmail(b.client_email, emailToLp) || UNATTRIBUTED_LP
    if (!map.has(path)) map.set(path, { count: 0, revenue: 0 })
    const s = map.get(path)!
    s.count++
    s.revenue += b.rvc || 0
  }
  return map
}

export function aggregateByLP(
  leads: JoinedLead[],
  ga4Map?: Map<string, { sessions: number; users: number; conversions: number }>,
  bookingsByLp?: Map<string, { count: number; revenue: number }>,
): LPAggregate[] {
  const byPath = new Map<string, JoinedLead[]>()
  for (const l of leads) {
    if (!l.first_url_path) continue
    const path = l.first_url_path
    if (!byPath.has(path)) byPath.set(path, [])
    byPath.get(path)!.push(l)
  }

  const aggregates: LPAggregate[] = []
  for (const [path, group] of byPath.entries()) {
    const matched = group.filter(l => l.is_matched)
    const ql = group.filter(l => l.is_ql).length
    const aiScores = matched.map(l => l.ai_score || 0).filter(s => s > 0)
    const avg_ai_score = aiScores.length > 0
      ? aiScores.reduce((a, b) => a + b, 0) / aiScores.length
      : 0

    // Channel breakdown
    const channels = group.map(l => l.hs_analytics_source || 'UNKNOWN')
    const channel_breakdown: Record<string, number> = {}
    for (const c of channels) channel_breakdown[c] = (channel_breakdown[c] || 0) + 1
    const top_channel = topByCount(channels)

    // Top campaign is computed FROM the top channel's leads (coherent attribution).
    // Without this constraint, a rarely-occurring channel with high-concentration
    // utm_campaign (e.g., a single Google Ads campaign with many leads) can dominate
    // the count while top_channel is something else (e.g., PAID_SOCIAL with many
    // ad-set-level utm_campaigns, none of which individually wins).
    const topChannelLeads = group.filter(l => (l.hs_analytics_source || 'UNKNOWN') === top_channel)
    const top_campaign = topByCount(topChannelLeads.map(l => l.utm_campaign).filter(Boolean))

    const ga4 = ga4Map?.get(path)
    const sessions = ga4?.sessions
    const users = ga4?.users
    const cvr = sessions && sessions > 0 ? (group.length / sessions) * 100 : undefined

    // Bookings credited to this LP by booking-date (booker first landed here).
    const bk = bookingsByLp?.get(path)
    const bookings = bk?.count ?? 0
    const revenue = bk?.revenue ?? 0
    const booking_rate = bookings > 0 && group.length > 0 ? (bookings / group.length) * 100 : undefined

    aggregates.push({
      path,
      leads: group.length,
      matched_in_streak: matched.length,
      ql,
      // Quality Rate = QL ÷ Streak-matched leads (locked model). Leads not in Streak
      // are coverage, not failed-QL — dividing by all leads understated the rate.
      ql_rate: matched.length > 0 ? (ql / matched.length) * 100 : 0,
      avg_ai_score,
      top_channel,
      channel_breakdown,
      top_campaign,
      top_form: topByCount(group.map(l => l.recent_conversion_event_name).filter(Boolean)),
      sessions,
      users,
      cvr,
      ...(bookingsByLp ? { bookings, revenue, booking_rate } : {}),
    })
  }

  // Orphan LPs: got booking-date bookings this range but have no in-range leads
  // (their leads came earlier, or the booker was never a tracked lead → UNATTRIBUTED_LP).
  // Surface as zero-lead rows so per-LP booking/revenue totals reconcile with the headline.
  if (bookingsByLp) {
    for (const [path, bk] of bookingsByLp.entries()) {
      if (byPath.has(path)) continue
      aggregates.push({
        path,
        leads: 0,
        matched_in_streak: 0,
        ql: 0,
        ql_rate: 0,
        avg_ai_score: 0,
        top_channel: '',
        channel_breakdown: {},
        top_campaign: '',
        top_form: '',
        bookings: bk.count,
        revenue: bk.revenue,
        booking_rate: undefined,
      })
    }
  }

  return aggregates.sort((a, b) => b.leads - a.leads)
}

export function computeTotals(leads: JoinedLead[], aggregates: LPAggregate[], fromISO: string, toISO: string): LPFunnelTotals {
  const matched = leads.filter(l => l.is_matched)
  const aiScores = matched.map(l => l.ai_score || 0).filter(s => s > 0)
  const ql = leads.filter(l => l.is_ql).length

  // Sum GA4 sessions/users across all attributed LPs (only LPs we surface)
  let total_sessions = 0
  let total_users = 0
  let any_ga4 = false
  let total_bookings = 0
  let total_revenue = 0
  let any_bookings = false
  for (const a of aggregates) {
    if (a.sessions !== undefined) {
      any_ga4 = true
      total_sessions += a.sessions
      total_users += a.users || 0
    }
    if (a.bookings !== undefined) {
      any_bookings = true
      total_bookings += a.bookings
      total_revenue += a.revenue || 0
    }
  }

  return {
    total_leads: leads.length,
    total_matched: matched.length,
    total_ql: ql,
    // Quality Rate = QL ÷ Streak-matched leads (locked model), NOT ÷ all leads.
    // 16% of leads aren't in Streak (coverage gap, surfaced separately) and would
    // otherwise depress the rate as if they were non-QL.
    avg_ql_rate: matched.length > 0 ? (ql / matched.length) * 100 : 0,
    avg_ai_score: aiScores.length > 0 ? aiScores.reduce((a, b) => a + b, 0) / aiScores.length : 0,
    unique_lps: aggregates.length,
    date_range: { from: fromISO, to: toISO },
    ...(any_ga4 ? {
      total_sessions,
      total_users,
      overall_cvr: total_sessions > 0 ? (leads.length / total_sessions) * 100 : 0,
    } : {}),
    ...(any_bookings ? {
      total_bookings,
      total_revenue,
      avg_deal_size: total_bookings > 0 ? total_revenue / total_bookings : 0,
    } : {}),
  }
}

// ============================================================================
// DERIVED VIEWS
// ============================================================================

// Winners + Leaky use zone thresholds from zones.ts (QL_RATE_THRESHOLDS):
//   SCALE   ≥55%   → genuine winners
//   MAINTAIN 45-55 → middling, in neither bucket
//   OPTIMIZE 35-45 → middling, in neither bucket
//   CUT     <35%   → leaky
// This avoids the same LP appearing in both panels (e.g., a 40% LP showing up
// as both "top winner among ≥20 leads" and "top leaky among ≥50 leads").
export function getQualityWinners(aggregates: LPAggregate[], minLeads = 20, limit = 5): LPAggregate[] {
  return aggregates
    .filter(a => a.leads >= minLeads && a.ql_rate >= 55)
    .sort((a, b) => b.ql_rate - a.ql_rate)
    .slice(0, limit)
}

export function getLeakyPages(aggregates: LPAggregate[], minLeads = 50, limit = 5): LPAggregate[] {
  return aggregates
    .filter(a => a.leads >= minLeads && a.ql_rate < 35)
    .sort((a, b) => a.ql_rate - b.ql_rate)
    .slice(0, limit)
}

export function aggregateByChannel(leads: JoinedLead[]): { channel: string; leads: number; matched: number; ql: number; ql_rate: number }[] {
  const map = new Map<string, { leads: number; matched: number; ql: number }>()
  for (const l of leads) {
    const ch = l.hs_analytics_source || 'UNKNOWN'
    if (!map.has(ch)) map.set(ch, { leads: 0, matched: 0, ql: 0 })
    const s = map.get(ch)!
    s.leads++
    if (l.is_matched) s.matched++
    if (l.is_ql) s.ql++
  }
  return Array.from(map.entries())
    .map(([channel, v]) => ({
      channel,
      leads: v.leads,
      matched: v.matched,
      ql: v.ql,
      ql_rate: v.matched > 0 ? (v.ql / v.matched) * 100 : 0,  // ÷ matched (locked model)
    }))
    .sort((a, b) => b.leads - a.leads)
}

export function aggregateByForm(leads: JoinedLead[]): { form: string; leads: number; matched: number; ql: number; ql_rate: number }[] {
  const map = new Map<string, { leads: number; matched: number; ql: number }>()
  for (const l of leads) {
    const f = l.recent_conversion_event_name || 'UNKNOWN'
    if (!map.has(f)) map.set(f, { leads: 0, matched: 0, ql: 0 })
    const s = map.get(f)!
    s.leads++
    if (l.is_matched) s.matched++
    if (l.is_ql) s.ql++
  }
  return Array.from(map.entries())
    .map(([form, v]) => ({
      form,
      leads: v.leads,
      matched: v.matched,
      ql: v.ql,
      ql_rate: v.matched > 0 ? (v.ql / v.matched) * 100 : 0,  // ÷ matched (locked model)
    }))
    .sort((a, b) => b.leads - a.leads)
}
