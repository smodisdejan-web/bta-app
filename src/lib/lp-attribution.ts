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
}

export interface LPAggregate {
  path: string
  leads: number
  matched_in_streak: number   // transparency for AI-based metrics
  ql: number                  // matched && ai_score >= 50
  ql_rate: number             // ql / leads (%)
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
  avg_ql_rate: number       // overall ql / leads
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
    }
  })
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

/**
 * Build email → aggregated bookings map. Multiple bookings per email collapse
 * into one entry (count + summed revenue), so an LP credits all repeat bookings.
 */
export function aggregateBookingsByEmail(
  bookings: BookingRecord[],
): Map<string, { count: number; revenue: number }> {
  const map = new Map<string, { count: number; revenue: number }>()
  for (const b of bookings) {
    const email = (b.client_email || '').toLowerCase().trim()
    if (!email) continue
    if (!map.has(email)) map.set(email, { count: 0, revenue: 0 })
    const s = map.get(email)!
    s.count++
    s.revenue += b.rvc || 0
  }
  return map
}

export function aggregateByLP(
  leads: JoinedLead[],
  ga4Map?: Map<string, { sessions: number; users: number; conversions: number }>,
  bookingMap?: Map<string, { count: number; revenue: number }>,
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

    // Bookings: count leads on this LP whose email shows up in bookings tab.
    // Sum revenue across those bookings (one contact may book multiple times).
    let bookings = 0
    let revenue = 0
    if (bookingMap) {
      for (const lead of group) {
        const b = bookingMap.get(lead.email)
        if (b) {
          bookings += b.count
          revenue += b.revenue
        }
      }
    }
    const booking_rate = bookings > 0 && group.length > 0 ? (bookings / group.length) * 100 : undefined

    aggregates.push({
      path,
      leads: group.length,
      matched_in_streak: matched.length,
      ql,
      ql_rate: group.length > 0 ? (ql / group.length) * 100 : 0,
      avg_ai_score,
      top_channel,
      channel_breakdown,
      top_campaign,
      top_form: topByCount(group.map(l => l.recent_conversion_event_name).filter(Boolean)),
      sessions,
      users,
      cvr,
      ...(bookingMap ? { bookings, revenue, booking_rate } : {}),
    })
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
    avg_ql_rate: leads.length > 0 ? (ql / leads.length) * 100 : 0,
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

export function aggregateByChannel(leads: JoinedLead[]): { channel: string; leads: number; ql: number; ql_rate: number }[] {
  const map = new Map<string, { leads: number; ql: number }>()
  for (const l of leads) {
    const ch = l.hs_analytics_source || 'UNKNOWN'
    if (!map.has(ch)) map.set(ch, { leads: 0, ql: 0 })
    const s = map.get(ch)!
    s.leads++
    if (l.is_ql) s.ql++
  }
  return Array.from(map.entries())
    .map(([channel, v]) => ({
      channel,
      leads: v.leads,
      ql: v.ql,
      ql_rate: v.leads > 0 ? (v.ql / v.leads) * 100 : 0,
    }))
    .sort((a, b) => b.leads - a.leads)
}

export function aggregateByForm(leads: JoinedLead[]): { form: string; leads: number; ql: number; ql_rate: number }[] {
  const map = new Map<string, { leads: number; ql: number }>()
  for (const l of leads) {
    const f = l.recent_conversion_event_name || 'UNKNOWN'
    if (!map.has(f)) map.set(f, { leads: 0, ql: 0 })
    const s = map.get(f)!
    s.leads++
    if (l.is_ql) s.ql++
  }
  return Array.from(map.entries())
    .map(([form, v]) => ({
      form,
      leads: v.leads,
      ql: v.ql,
      ql_rate: v.leads > 0 ? (v.ql / v.leads) * 100 : 0,
    }))
    .sort((a, b) => b.leads - a.leads)
}
