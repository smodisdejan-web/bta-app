// Before/after of the hubspot_contacts → hubspot_contacts_all switch for the Ask facts (funnel-facts),
// the Turkey campaign enrichment and the email-marketing denominators. Read-only.
import { fetchHubspotContacts, fetchHubspotContactsAll, fetchStreakSync, fetchBookings, fetchTab } from '../src/lib/sheetsData'
import { joinHubspotStreak, filterByDateRange, isAttributableLP, computeEmailFunnel } from '../src/lib/lp-attribution'
const fetchSheetFn = async ({ sheetUrl, tab }: { sheetUrl: string; tab: string }) => { const r = await fetchTab(tab, sheetUrl); return [r.headers, ...r.rows] }
;(async () => {
  const [oldC, newC, streak, bookings] = await Promise.all([fetchHubspotContacts(fetchSheetFn), fetchHubspotContactsAll(fetchSheetFn), fetchStreakSync(fetchSheetFn), fetchBookings(fetchSheetFn)])
  const today = new Date().toISOString()
  const win = (d: number) => new Date(Date.now() - d * 86400000).toISOString()
  const report = (lbl: string, C: any[]) => {
    const j = joinHubspotStreak(C, streak)
    const out: any = { contacts: C.length }
    for (const [k, from] of [['this_month', '2026-11-01T00:00:00.000Z'], ['3m', '2026-08-01T00:00:00.000Z'], ['ytd', '2026-01-01T00:00:00.000Z']] as const) {
      const a = filterByDateRange(j, from, today).filter((l) => isAttributableLP(l.first_url_path))
      out[k] = { lpLeads: a.length, matchedInStreak: a.filter((l) => l.is_matched).length, ql: a.filter((l) => l.is_ql).length }
    }
    // Turkey enrichment: Streak leads (Turkey creative / campaign) whose email is in HubSpot
    const emails = new Set(C.map((c) => String(c.email || '').toLowerCase().trim()).filter(Boolean))
    const tk = streak.filter((l: any) => /turkey|tosca|belgin|esma|makri/i.test(`${l.source_placement} ${l.source_detail}`))
    out.turkeyStreakLeads = tk.length
    out.turkeyHubspotMatched = tk.filter((l: any) => emails.has(String(l.email || l.name || '').toLowerCase().trim())).length
    // email-marketing denominators (1 year back, as the route)
    const em = filterByDateRange(j, win(365), today).filter((l) => isAttributableLP(l.first_url_path))
    const booked = new Set(bookings.map((b: any) => (b.client_email || '').toLowerCase().trim()).filter(Boolean))
    const eng = new Map(j.map((l) => [l.email, l.is_email_engaged]))
    let bm = 0, be = 0
    for (const e of booked) if (eng.has(e)) { bm++; if (eng.get(e)) be++ }
    out.emailMarketing = { leads1y: em.length, buckets: computeEmailFunnel(em, booked), bookersMatched: bm, bookersEngaged: be, bookers: booked.size }
    console.log(lbl, JSON.stringify(out))
  }
  report('BEFORE hubspot_contacts    ', oldC)
  report('AFTER  hubspot_contacts_all', newC)
})()
