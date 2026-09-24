import { NextResponse } from 'next/server'
import {
  fetchTab,
  fetchHubspotContacts,
  fetchStreakSync,
  fetchBookings,
  fetchEmailHealth,
  fetchEmailGrowth,
} from '@/lib/sheetsData'
import {
  joinHubspotStreak,
  filterByDateRange,
  isAttributableLP,
  computeEmailFunnel,
} from '@/lib/lp-attribution'

export const dynamic = 'force-dynamic'

/**
 * Email Marketing tab data.
 *  - health: account-wide marketing-email snapshot (email_health tab)
 *  - funnel: engaged-vs-non-engaged conversion over a FIXED trailing-12-month lead
 *    window. Booking is a lagging metric (a lead can't book within days), so a short
 *    range would render a meaningless 0-vs-0 comparison — we ignore any range here.
 */
export async function GET() {
  try {
    const fetchSheetFn = async ({ sheetUrl, tab }: { sheetUrl: string; tab: string }) => {
      const res = await fetchTab(tab, sheetUrl)
      return [res.headers, ...res.rows]
    }

    const [hsContacts, streakLeads, bookings, health, growth] = await Promise.all([
      fetchHubspotContacts(fetchSheetFn),
      fetchStreakSync(fetchSheetFn),
      fetchBookings(fetchSheetFn),
      fetchEmailHealth(fetchSheetFn),
      fetchEmailGrowth(fetchSheetFn),
    ])

    const joined = joinHubspotStreak(hsContacts, streakLeads)

    const toISO = new Date().toISOString()
    const fromISO = new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString()
    const leads = filterByDateRange(joined, fromISO, toISO).filter(l => isAttributableLP(l.first_url_path))

    const bookedEmails = new Set(
      bookings.map(b => (b.client_email || '').toLowerCase().trim()).filter(Boolean)
    )
    const funnel = computeEmailFunnel(leads, bookedEmails)

    // "Are our buyers email-engaged?" — of bookers we can match to a tracked contact,
    // how many opened/clicked ≥1 marketing email. (Bookers not in hubspot_contacts —
    // phone/referral — can't be measured, so we report matched + engaged separately.)
    const engagedByEmail = new Map(joined.map(l => [l.email, l.is_email_engaged]))
    let bookersMatched = 0, bookersEngaged = 0
    for (const e of bookedEmails) {
      if (engagedByEmail.has(e)) {
        bookersMatched++
        if (engagedByEmail.get(e)) bookersEngaged++
      }
    }

    return NextResponse.json({
      health,
      growth,
      funnel,
      buyers: {
        total: bookedEmails.size,
        matched: bookersMatched,
        engaged: bookersEngaged,
        engaged_pct: bookersMatched > 0 ? (bookersEngaged / bookersMatched) * 100 : 0,
      },
      meta: {
        window: { fromISO, toISO },
        leadsInWindow: leads.length,
        hsContactsTotal: hsContacts.length,
        bookingsTotal: bookings.length,
      },
    })
  } catch (error: any) {
    console.error('[email-marketing API] error:', error)
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 })
  }
}
