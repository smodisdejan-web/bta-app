import { fetchBookings, fetchFbAdsets, fetchStreakSync } from './sheetsData'
import type { BookingRecord, FbAdsetRow, StreakLeadRow } from './sheetsData'
import { fetchSheet } from './sheetsData'
import { VESSEL_PROFILES, VesselProfile, CampaignSub } from './vessel-profiles'

export type FunnelCounts = {
  leads: number
  ql: number
  vesselQl: number
  assigned: number
  bookings: number
  revenue: number
}

export type FunnelRates = {
  leadToQl: number
  qlToVesselQl: number
  vesselQlToBooking: number
  revenuePerLead: number
}

export type VesselLead = {
  source: string
  inquiry_date: string
  name?: string
  country?: string
  ai_score: number
  budget_range?: string
  size_of_group?: number
  destination?: string
  stage?: string
  why_not_segment?: string
  vessel_assigned?: string
  vesselQl: boolean
  assigned: boolean
}

export type WhyNotBreakdown = { reason: string; count: number }

export type CampaignBreakdownRow = {
  key: string
  label: string
  leads: number
  ql: number
  vesselQl: number
  bookings: number
  revenue: number
  leadToQl: number
  vesselQlToBooking: number
}

export type VesselFunnelResult = {
  profile: VesselProfile
  counts: FunnelCounts
  rates: FunnelRates
  funnelSteps: { label: string; value: number }[]
  whyNot: WhyNotBreakdown[]
  leads: VesselLead[]
  allVesselBookings: number
  allVesselRevenue: number
  campaignBreakdown?: CampaignBreakdownRow[]
}

function parseBudgetMin(budgetRange: string): number {
  if (!budgetRange) return 0
  if (budgetRange.includes('Up to €10,000')) return 0
  if (budgetRange.includes('Up to €20,000')) return 10000
  if (budgetRange.includes('€10,000 to €20,000')) return 10000
  if (budgetRange.includes('€20,000 to €30,000')) return 20000
  if (budgetRange.includes('€30,000 to €60,000')) return 30000
  if (budgetRange.includes('€60,000 to €100,000')) return 60000
  if (budgetRange.includes('€100,000 to €250,000')) return 100000
  if (budgetRange.includes('€250,000 to €500,000')) return 250000
  if (budgetRange.includes('More than €500,000')) return 500000
  return 0
}

function normalize(str: string): string {
  return (str || '').toLowerCase()
}

function leadMatchesProfile(lead: StreakLeadRow, profile: VesselProfile): boolean {
  const sp = normalize(lead.source_placement)
  const name = profile.name.toLowerCase()
  // Match on source_placement only (campaign origin), not vessel field (CRM assignment)
  // Normalize separators: campaigns use mixed formats (underscores, hyphens, spaces)
  return sp.includes(profile.utmPattern.toLowerCase())
    || sp.includes(name)
    || sp.includes(name.replace(/\s+/g, '-'))
}

function adsetMatchesProfile(adset: FbAdsetRow, profile: VesselProfile): boolean {
  const name = normalize(adset.adset_name)
  return name.includes(profile.name.toLowerCase())
}

function inRange(day: string, days: number): boolean {
  if (!day) return false
  const d = new Date(day)
  if (Number.isNaN(+d)) return false
  const today = new Date()
  const start = new Date(today)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  const end = new Date(today)
  end.setUTCHours(23, 59, 59, 999)
  return d >= start && d <= end
}

function matchesDestination(dest: string | undefined, allowed: string[]): boolean {
  if (!dest) return false
  const d = dest.trim()
  if (!d) return false
  if (d.toLowerCase() === 'flexible') return true
  return allowed.some(a => a.toLowerCase() === d.toLowerCase())
}

function vesselAssigned(lead: StreakLeadRow, profile: VesselProfile): boolean {
  const vesselField = lead.vessel || ''
  return vesselField.toUpperCase().includes(profile.bookingPattern.toUpperCase())
}

function filterBookings(bookings: BookingRecord[], profile: VesselProfile, days: number): BookingRecord[] {
  return bookings.filter((b) => {
    const vessel = (b.vessel || '').toUpperCase()
    if (!vessel.includes(profile.bookingPattern.toUpperCase())) return false
    const dateStr = b.booking_date || b.inquiry_date
    if (!dateStr) return false
    // booking_date may be YYYY-MM; normalize to first of month
    const normalized = dateStr.length === 7 ? `${dateStr}-01` : dateStr
    return inRange(normalized, days)
  })
}

export async function loadVesselFunnel(vesselId: string, days: number): Promise<VesselFunnelResult> {
  const profile = VESSEL_PROFILES.find((v) => v.id === vesselId) || VESSEL_PROFILES[0]
  const streak = await fetchStreakSync(fetchSheet)
  const bookings = await fetchBookings()
  const fbAdsets = await fetchFbAdsets(fetchSheet)

  const streakInRange = streak.filter((lead) => inRange(lead.inquiry_date, days))
  const leadsForVessel = streakInRange.filter((lead) => leadMatchesProfile(lead, profile))
  const ql = leadsForVessel.filter((lead) => (lead.ai_score || 0) >= 50)
  const vesselQl = ql.filter((lead) => {
    const budgetMin = parseBudgetMin(lead.budget_range || '')
    const groupOk = lead.size_of_group ? lead.size_of_group <= profile.maxGuests : false
    const destOk = matchesDestination(lead.destination, profile.destinations)
    return budgetMin >= profile.budgetMin && groupOk && destOk
  })

  const assigned = leadsForVessel.filter((lead) => vesselAssigned(lead, profile))

  // All bookings for this vessel (regardless of campaign origin)
  const allBookingsForVessel = filterBookings(bookings, profile, days)
  const allVesselRevenue = allBookingsForVessel.reduce((sum, b) => sum + (b.rvc || 0), 0)

  // Campaign-attributed bookings: match booking email to campaign lead email
  const campaignEmails = new Set(
    leadsForVessel.map((l) => (l.name || '').toLowerCase().trim()).filter(Boolean)
  )
  const bookingsForVessel = allBookingsForVessel.filter((b) =>
    campaignEmails.has((b.client_email || '').toLowerCase().trim())
  )
  const revenue = bookingsForVessel.reduce((sum, b) => sum + (b.rvc || 0), 0)

  const whyNotMap = new Map<string, number>()
  leadsForVessel.forEach((lead) => {
    const reason = lead.why_not_segment || 'Unknown'
    whyNotMap.set(reason, (whyNotMap.get(reason) || 0) + 1)
  })

  const leads: VesselLead[] = leadsForVessel.map((lead) => {
    const assignedFlag = vesselAssigned(lead, profile)
    const vesselQlFlag = vesselQl.includes(lead)
    return {
      source: lead.source_placement,
      inquiry_date: lead.inquiry_date,
      name: lead.name,
      country: lead.country,
      ai_score: lead.ai_score,
      budget_range: lead.budget_range,
      size_of_group: lead.size_of_group,
      destination: lead.destination,
      stage: lead.stage,
      why_not_segment: lead.why_not_segment,
      vessel_assigned: lead.vessel,
      vesselQl: vesselQlFlag,
      assigned: assignedFlag,
    }
  })

  const counts: FunnelCounts = {
    leads: leadsForVessel.length,
    ql: ql.length,
    vesselQl: vesselQl.length,
    assigned: assigned.length,
    bookings: bookingsForVessel.length,
    revenue,
  }

  const safeDiv = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0)

  const rates: FunnelRates = {
    leadToQl: safeDiv(counts.ql, counts.leads),
    qlToVesselQl: safeDiv(counts.vesselQl, counts.ql),
    vesselQlToBooking: safeDiv(counts.bookings, counts.vesselQl),
    revenuePerLead: counts.leads > 0 ? revenue / counts.leads : 0,
  }

  const funnelSteps = [
    { label: 'Leads', value: counts.leads },
    { label: 'QL', value: counts.ql },
    { label: 'Vessel QL', value: counts.vesselQl },
    { label: 'Bookings', value: counts.bookings },
  ]

  const whyNot: WhyNotBreakdown[] = Array.from(whyNotMap.entries()).map(([reason, count]) => ({ reason, count }))

  // Campaign breakdown (if vessel has sub-campaigns defined)
  let campaignBreakdown: CampaignBreakdownRow[] | undefined
  if (profile.campaigns && profile.campaigns.length > 0) {
    const subs = profile.campaigns
    // Classify a lead into the first matching sub-campaign (order matters: more specific first)
    // Uses startsWith to avoid general campaigns (e.g. "landing_gulet_alessandro...")
    // matching dedicated campaign patterns (e.g. "alessandro_warm...")
    const classifyLead = (lead: StreakLeadRow): string => {
      const sp = normalize(lead.source_placement)
      for (const sub of subs) {
        if (sp.startsWith(sub.pattern.toLowerCase())) return sub.key
      }
      return '_other'
    }

    const buckets = new Map<string, StreakLeadRow[]>()
    for (const sub of subs) buckets.set(sub.key, [])
    buckets.set('_other', [])
    for (const lead of leadsForVessel) {
      const key = classifyLead(lead)
      buckets.get(key)!.push(lead)
    }

    campaignBreakdown = [...subs.map(s => s.key), '_other']
      .filter(key => (buckets.get(key)?.length ?? 0) > 0)
      .map(key => {
        const sub = subs.find(s => s.key === key)
        const bucket = buckets.get(key)!
        const bQl = bucket.filter(l => (l.ai_score || 0) >= 50)
        const bVesselQl = bQl.filter(l => {
          const budgetMin = parseBudgetMin(l.budget_range || '')
          const groupOk = l.size_of_group ? l.size_of_group <= profile.maxGuests : false
          const destOk = matchesDestination(l.destination, profile.destinations)
          return budgetMin >= profile.budgetMin && groupOk && destOk
        })
        const bEmails = new Set(bucket.map(l => (l.name || '').toLowerCase().trim()).filter(Boolean))
        const bBookings = allBookingsForVessel.filter(b => bEmails.has((b.client_email || '').toLowerCase().trim()))
        const bRevenue = bBookings.reduce((sum, b) => sum + (b.rvc || 0), 0)
        return {
          key,
          label: sub?.label || 'General',
          leads: bucket.length,
          ql: bQl.length,
          vesselQl: bVesselQl.length,
          bookings: bBookings.length,
          revenue: bRevenue,
          leadToQl: bucket.length > 0 ? (bQl.length / bucket.length) * 100 : 0,
          vesselQlToBooking: bVesselQl.length > 0 ? (bBookings.length / bVesselQl.length) * 100 : 0,
        }
      })
  }

  return {
    profile,
    counts,
    rates,
    funnelSteps,
    whyNot,
    leads,
    allVesselBookings: allBookingsForVessel.length,
    allVesselRevenue,
    campaignBreakdown,
  }
}
