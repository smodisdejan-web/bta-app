// src/lib/overview-data.ts
// Data fetching and aggregation for Overview page

import { FacebookAdRecord, HubSpotDeal, HubSpotContact, MarketingFunnelRecord, OverviewFilters, OverviewMetrics, DailyMetric, CampaignPerformance } from './overview-types'
import { useSettings } from './contexts/SettingsContext'
import { fetchFbEnriched, fetchSheet, FbEnrichedRow, totalsFb, fetchTab } from './sheetsData'
import { coerceNumber, coerceDateISO, inRange, SHEETS_FETCH_OPTS } from './parsers'
import { fetchJson } from './fetch-json'
import { requireSheetsUrl, getSheetsUrl, DEFAULT_WEB_APP_URL } from './config'

const DEFAULT_SHEET_URL = DEFAULT_WEB_APP_URL // Alias for consistency

// Types for spend series
type SpendSeries = { total: number; byDate: Map<string, number> }

// Helper for tracking min/max dates
function trackMinMax(min: string | null, max: string | null, d: string | null) {
  if (!d) return { min, max }
  if (!min || d < min) min = d
  if (!max || d > max) max = d
  return { min, max }
}

// Helper to pick first available column from aliases
const pick = (row: any, aliases: string[], fallback: any = undefined) => {
  for (const a of aliases) {
    if (a in row && row[a] != null && row[a] !== "") return row[a];
  }
  return fallback;
};

// Helper to parse ISO dates from various formats
const parseIso = (v: any): string | null => {
  // accepts "YYYY-MM-DD", native Date, or serial numbers (GS)
  try {
    if (!v && v !== 0) return null;
    if (typeof v === "string") {
      // trim and take first 10 if longer
      const s = v.trim();
      const m = s.match(/\d{4}-\d{2}-\d{2}/);
      if (m) return m[0];
      // handle "29. 8. 2025" etc: try Date.parse after replacement
      const trySwap = s.replaceAll(".", "-").replace(/\s+/g, " ").trim();
      const d1 = new Date(trySwap);
      if (!isNaN(+d1)) return d1.toISOString().slice(0,10);
      const d2 = new Date(s);
      if (!isNaN(+d2)) return d2.toISOString().slice(0,10);
      return null;
    }
    if (typeof v === "number") {
      // treat as Google serial date
      // 25569 is 1970-01-01 in Excel/GS epoch, 86400000 is ms/day
      const ms = (v - 25569) * 86400000;
      const d = new Date(ms);
      if (!isNaN(+d)) return d.toISOString().slice(0,10);
      return null;
    }
    if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0,10);
    return null;
  } catch { return null; }
};

// Helper to fetch tab rows with robust error handling
async function getTabRows(tab: string, sheetUrl?: string): Promise<{ headers: string[]; rows: any[][]; __error: string | null }> {
  let base: string;
  if (sheetUrl) {
    base = sheetUrl;
  } else if (typeof window !== 'undefined') {
    // Client-side: use getSheetsUrl (non-throwing)
    base = getSheetsUrl() || DEFAULT_SHEET_URL;
  } else {
    // Server-side: use requireSheetsUrl (throws if missing)
    try {
      base = requireSheetsUrl();
    } catch {
      base = DEFAULT_SHEET_URL;
    }
  }
  
  if (!base) {
    return { headers: [], rows: [], __error: 'SHEETS_URL missing' };
  }

  const url = `${base}?tab=${encodeURIComponent(tab)}`;
  const r = await fetchJson(url, {}, 8000);

  if (!r.ok) {
    const errorMsg = `Fetch ${tab} failed: ${r.status} ${r.statusText}${r.bodySnippet ? ` (${r.bodySnippet.slice(0, 100)})` : ''}`;
    return { headers: [], rows: [], __error: errorMsg };
  }

  // Parse response - could be array of objects or 2D array
  let data = r.json;
  if (!data) {
    try {
      data = JSON.parse(r.text || '[]');
    } catch {
      return { headers: [], rows: [], __error: `Invalid JSON for ${tab}` };
    }
  }

    if (!Array.isArray(data)) {
    return { headers: [], rows: [], __error: `Response is not an array for ${tab}` };
  }

  if (data.length === 0) {
    return { headers: [], rows: [], __error: null }; // Empty but valid
  }

  // Convert array of objects to 2D array if needed
  let sheet: any[][];
  if (typeof data[0] === 'object' && !Array.isArray(data[0])) {
    const headers = Object.keys(data[0]);
    const rows = [headers, ...data.map(row => headers.map(h => row[h]))];
    sheet = rows;
  } else {
    sheet = data;
  }

  if (!sheet || sheet.length === 0) {
    return { headers: [], rows: [], __error: null };
  }

  const headers = sheet[0] || [];
  const rows = sheet.slice(1) || [];

  return { headers, rows, __error: null };
}

// Loaders per tab
async function getFbMetrics(range: { from: string; to: string }, sheetUrl?: string) {
  let fbRows = 0
  let fbMin: string | null = null
  let fbMax: string | null = null
  let fbColumns: string[] = []
  let fbSpendTotal = 0
  
  let fbError: string | null = null
  
  try {
    const { headers, rows, __error } = await getTabRows('fb_ads_enriched', sheetUrl)
    fbRows = rows.length
    fbColumns = headers
    
    if (__error) {
      fbError = __error
    }
    
    if (!headers.length) {
      return {
        spend: { total: 0, byDate: new Map() } as SpendSeries,
        lpViews: 0,
        fbFormLeads: 0,
        landingLeads: 0,
        __debug: { rows: 0, minDate: null, maxDate: null, columns: [], spendTotal: 0, nanCounts: { spend: 0, lpViews: 0, fbFormLeads: 0, landingLeads: 0 }, error: fbError }
      }
    }

    const h = (name: string) => headers.findIndex(x => x.toLowerCase() === name.toLowerCase())

    const iDate = h('date_iso')
    const iSpend = h('spend')
    const iLP = h('lp_views')
    const iFF = h('fb_form_leads')
    const iLL = h('landing_leads')

    const byDate = new Map<string, number>()
    let spendTotal = 0, lpViews = 0, fbForms = 0, landingLeads = 0

    const fbRowsProcessed: any[] = []
    
    for (const r of rows) {
      const date = coerceDateISO(r[iDate])
      if (!date) continue
      
      // Track min/max dates
      const tracked = trackMinMax(fbMin, fbMax, date)
      fbMin = tracked.min
      fbMax = tracked.max
      
      if (!inRange(date, range.from, range.to)) continue

      const spend = coerceNumber(r[iSpend])
      const lpViewsVal = coerceNumber(r[iLP])
      const fbFormsVal = coerceNumber(r[iFF])
      const landingLeadsVal = coerceNumber(r[iLL])
      
      fbRowsProcessed.push({ spend, lpViews: lpViewsVal, fbForms: fbFormsVal, landingLeads: landingLeadsVal })
      
      if (isFinite(spend)) {
        spendTotal += spend
        byDate.set(date, (byDate.get(date) || 0) + spend)
      }

      if (isFinite(lpViewsVal)) lpViews += lpViewsVal
      if (isFinite(fbFormsVal)) fbForms += fbFormsVal
      if (isFinite(landingLeadsVal)) landingLeads += landingLeadsVal
    }
    
    const fbNanCounts = {
      spend: fbRowsProcessed.filter(r => !isFinite(r.spend)).length,
      lpViews: fbRowsProcessed.filter(r => !isFinite(r.lpViews)).length,
      fbFormLeads: fbRowsProcessed.filter(r => !isFinite(r.fbForms)).length,
      landingLeads: fbRowsProcessed.filter(r => !isFinite(r.landingLeads)).length,
    }
    
    fbSpendTotal = spendTotal

    return {
      spend: { total: spendTotal, byDate } as SpendSeries,
      lpViews,
      fbFormLeads: fbForms,
      landingLeads,
      __debug: { rows: fbRows, minDate: fbMin, maxDate: fbMax, columns: fbColumns, spendTotal: fbSpendTotal, nanCounts: fbNanCounts, error: fbError }
    }
  } catch (error) {
    console.error('Error loading FB metrics:', error)
    return {
      spend: { total: 0, byDate: new Map() } as SpendSeries,
      lpViews: 0,
      fbFormLeads: 0,
      landingLeads: 0,
      __debug: { rows: fbRows, minDate: fbMin, maxDate: fbMax, columns: fbColumns, spendTotal: 0, nanCounts: { spend: 0, lpViews: 0, fbFormLeads: 0, landingLeads: 0 }, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
}

async function getGoogleSpend(range: { from: string; to: string }, sheetUrl?: string): Promise<SpendSeries & { __debug?: any }> {
  let gaRows = 0
  let gaMin: string | null = null
  let gaMax: string | null = null
  let gaColumns: string[] = []
  let gaSpendTotal = 0
  let gaError: string | null = null
  
  try {
    const { headers, rows, __error } = await getTabRows('daily', sheetUrl)
    gaRows = rows.length
    gaColumns = headers
    
    if (__error) {
      gaError = __error
    }
    
    if (!headers.length) {
      return { total: 0, byDate: new Map(), __debug: { rows: 0, minDate: null, maxDate: null, columns: [], spendTotal: 0, nanCounts: { cost: 0 }, error: gaError } }
    }

    const idxDate = headers.findIndex(h => h.toLowerCase() === 'date')
    const idxCost = headers.findIndex(h => h.toLowerCase() === 'cost')
    
    if (idxDate === -1 || idxCost === -1) {
      return { total: 0, byDate: new Map(), __debug: { rows: gaRows, minDate: null, maxDate: null, columns: gaColumns, spendTotal: 0, nanCounts: { cost: 0 }, error: 'Missing date or cost column' } }
    }

    const byDate = new Map<string, number>()
    let total = 0
    const gaRowsProcessed: any[] = []

    for (const r of rows) {
      const date = coerceDateISO(r[idxDate])
      if (!date) continue
      
      // Track min/max dates
      const tracked = trackMinMax(gaMin, gaMax, date)
      gaMin = tracked.min
      gaMax = tracked.max
      
      if (!inRange(date, range.from, range.to)) continue
      
      const cost = coerceNumber(r[idxCost])
      gaRowsProcessed.push({ cost })
      
      if (isFinite(cost) && cost > 0) {
        total += cost
        byDate.set(date, (byDate.get(date) || 0) + cost)
      }
    }
    
    const gaNanCounts = {
      cost: gaRowsProcessed.filter(r => !isFinite(r.cost)).length,
    }
    
    gaSpendTotal = total

    return { total, byDate, __debug: { rows: gaRows, minDate: gaMin, maxDate: gaMax, columns: gaColumns, spendTotal: gaSpendTotal, nanCounts: gaNanCounts, error: gaError } }
  } catch (error) {
    console.error('Error loading Google spend:', error)
    return { total: 0, byDate: new Map(), __debug: { rows: gaRows, minDate: gaMin, maxDate: gaMax, columns: gaColumns, spendTotal: 0, nanCounts: { cost: 0 }, error: error instanceof Error ? error.message : 'Unknown error' } }
  }
}

async function getContacts(range: { from: string; to: string }, sheetUrl?: string) {
  let contactsRows = 0
  let contactsMin: string | null = null
  let contactsMax: string | null = null
  let contactsColumns: string[] = []
  let contactsError: string | null = null
  
  try {
    const { headers, rows, __error } = await getTabRows('hubspot_contacts_enriched', sheetUrl)
    contactsRows = rows.length
    contactsColumns = headers
    
    if (__error) {
      contactsError = __error
    }
    
    if (!headers.length || contactsRows === 0) {
      return { leads: 0, sql: 0, __debug: { rows: contactsRows, minDate: null, maxDate: null, columns: contactsColumns, error: contactsError || 'No headers or rows found' } }
    }

    // Convert rows to objects for easier access
    const rowsAsObjects = rows.map(row => {
      const obj: any = {}
      headers.forEach((h, i) => { obj[h] = row[i] })
      return obj
    })

    // Find column aliases
    const dateAliases = ["date_iso", "created_iso", "created_at", "createdate", "results.properties.createdate"]
    const lifecycleAliases = ["lifecyclestage", "results.properties.lifecyclestage"]
    const leadStatusAliases = ["lead_status", "hs_lead_status", "results.properties.hs_lead_status"]

    // Find which columns exist
    const foundDateCol = headers.find(h => dateAliases.some(a => h.toLowerCase() === a.toLowerCase()))
    const foundLifecycleCol = headers.find(h => lifecycleAliases.some(a => h.toLowerCase() === a.toLowerCase()))
    const foundLeadStatusCol = headers.find(h => leadStatusAliases.some(a => h.toLowerCase() === a.toLowerCase()))

    if (!foundDateCol) {
      return { 
        leads: 0, 
        sql: 0, 
        __debug: { 
          rows: contactsRows, 
          minDate: null, 
          maxDate: null, 
          columns: contactsColumns, 
          error: `Missing date column. Tried: ${dateAliases.join(', ')}. Found columns: ${contactsColumns.join(', ')}` 
        } 
      }
    }

    let leads = 0, sql = 0
    
    for (const row of rowsAsObjects) {
      // Use pick helper to find date value
      const dateValue = pick(row, dateAliases)
      const date = parseIso(dateValue) || coerceDateISO(dateValue)
      
      if (!date) continue
      
      // Track min/max dates
      const tracked = trackMinMax(contactsMin, contactsMax, date)
      contactsMin = tracked.min
      contactsMax = tracked.max
      
      if (!inRange(date, range.from, range.to)) continue
      
      leads += 1
      
      // Check lifecycle for SQL
      if (foundLifecycleCol) {
        const lcs = String(pick(row, lifecycleAliases, '') || '').toLowerCase()
        if (lcs.includes('sql') || lcs.includes('salesqualified')) {
          sql += 1
        }
      }
    }

    return { 
      leads, 
      sql, 
      __debug: { 
        rows: contactsRows, 
        minDate: contactsMin, 
        maxDate: contactsMax, 
        columns: contactsColumns,
        foundColumns: {
          date: foundDateCol || null,
          lifecycle: foundLifecycleCol || null,
          leadStatus: foundLeadStatusCol || null
        },
        error: contactsError 
      } 
    }
  } catch (error) {
    console.error('Error loading contacts:', error)
    return { 
      leads: 0, 
      sql: 0, 
      __debug: { 
        rows: contactsRows, 
        minDate: contactsMin, 
        maxDate: contactsMax, 
        columns: contactsColumns, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      } 
    }
  }
}

async function getDeals(range: { from: string; to: string }, sheetUrl?: string) {
  let dealsRows = 0
  let dealsMin: string | null = null
  let dealsMax: string | null = null
  let dealsColumns: string[] = []
  
  let dealsError: string | null = null
  
  try {
    const { headers, rows, __error } = await getTabRows('hubspot_deals_enriched', sheetUrl)
    dealsRows = rows.length
    dealsColumns = headers
    
    if (__error) {
      dealsError = __error
    }
    
    if (!headers.length || dealsRows === 0) {
      return {
        wonDeals: 0,
        revenue: 0,
        closedDeals: 0,
        revenueByDate: new Map<string, number>(),
        __debug: { rows: dealsRows, minDate: null, maxDate: null, columns: dealsColumns, error: dealsError || 'No headers or rows found' }
      }
    }

    // Convert rows to objects for easier access
    const rowsAsObjects = rows.map(row => {
      const obj: any = {}
      headers.forEach((h, i) => { obj[h] = row[i] })
      return obj
    })

    // Find column aliases
    const createdAliases = ["created_iso", "created_at", "results.createdAt", "results.properties.createdate"]
    const closedAliases = ["closed_iso", "closed_at", "closedate", "results.properties.closedate"]
    const stageAliases = ["stage", "dealstage", "results.properties.dealstage"]
    const amountAliases = ["amount_effective", "amount_home", "amount", "results.properties.amount"]

    // Find which columns exist
    const foundCreatedCol = headers.find(h => createdAliases.some(a => h.toLowerCase() === a.toLowerCase()))
    const foundClosedCol = headers.find(h => closedAliases.some(a => h.toLowerCase() === a.toLowerCase()))
    const foundStageCol = headers.find(h => stageAliases.some(a => h.toLowerCase() === a.toLowerCase()))
    const foundAmountCol = headers.find(h => amountAliases.some(a => h.toLowerCase() === a.toLowerCase()))

    if (!foundClosedCol) {
      return {
        wonDeals: 0,
        revenue: 0,
        closedDeals: 0,
        revenueByDate: new Map<string, number>(),
        __debug: { 
          rows: dealsRows, 
          minDate: null, 
          maxDate: null, 
          columns: dealsColumns, 
          error: `Missing closed date column. Tried: ${closedAliases.join(', ')}. Found columns: ${dealsColumns.join(', ')}` 
        }
      }
    }

    let wonDeals = 0, revenue = 0, closedDeals = 0
    const revenueByDate = new Map<string, number>()

    for (const row of rowsAsObjects) {
      // Use pick helper to find closed date value
      const closedValue = pick(row, closedAliases)
      const date = parseIso(closedValue) || coerceDateISO(closedValue)
      
      if (!date) continue
      
      // Track min/max dates
      const tracked = trackMinMax(dealsMin, dealsMax, date)
      dealsMin = tracked.min
      dealsMax = tracked.max
      
      if (!inRange(date, range.from, range.to)) continue

      // Check if won: stage contains "won" (case-insensitive) or equals "closedwon"
      let isWon = false
      if (foundStageCol) {
        const stage = String(pick(row, stageAliases, '') || '').toLowerCase()
        isWon = stage.includes('won') || stage === 'closedwon'
      }

      // Get amount
      const amountValue = pick(row, amountAliases, 0)
      const amt = coerceNumber(amountValue)

      closedDeals += 1
      
      if (isWon && isFinite(amt) && amt > 0) {
        wonDeals += 1
        revenue += amt
        revenueByDate.set(date, (revenueByDate.get(date) || 0) + amt)
      }
    }

    const avgDealSize = wonDeals > 0 ? revenue / wonDeals : 0

    return { 
      wonDeals, 
      revenue, 
      closedDeals, 
      revenueByDate,
      avgDealSize,
      __debug: { 
        rows: dealsRows, 
        minDate: dealsMin, 
        maxDate: dealsMax, 
        columns: dealsColumns,
        foundColumns: {
          created: foundCreatedCol || null,
          closed: foundClosedCol || null,
          stage: foundStageCol || null,
          amount: foundAmountCol || null
        },
        error: dealsError 
      } 
    }
  } catch (error) {
    console.error('Error loading deals:', error)
    return {
      wonDeals: 0,
      revenue: 0,
      closedDeals: 0,
      revenueByDate: new Map<string, number>(),
      avgDealSize: 0,
      __debug: { 
        rows: dealsRows, 
        minDate: dealsMin, 
        maxDate: dealsMax, 
        columns: dealsColumns, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  }
}

// Helper to add timeout to promises
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  const timeout = new Promise<T>((resolve) => 
    setTimeout(() => resolve(fallback), timeoutMs)
  )
  return Promise.race([promise, timeout])
}

// Main function to get overview data
export async function getOverviewData({ from, to, sheetUrl }: { from: string; to: string; sheetUrl?: string }) {
  console.log('[getOverviewData] Starting with:', { from, to, sheetUrl: sheetUrl ? 'configured' : 'missing' })
  
  // Load sources in parallel with individual timeouts (5 seconds each)
  const defaultFb = { 
    spend: { total: 0, byDate: new Map() } as SpendSeries, 
    lpViews: 0, 
    fbFormLeads: 0, 
    landingLeads: 0,
    __debug: { rows: 0, minDate: null, maxDate: null, columns: [], spendTotal: 0, nanCounts: { spend: 0, lpViews: 0, fbFormLeads: 0, landingLeads: 0 } }
  }
  const defaultGa = { 
    total: 0, 
    byDate: new Map(),
    __debug: { rows: 0, minDate: null, maxDate: null, columns: [], spendTotal: 0, nanCounts: { cost: 0 } }
  } as SpendSeries & { __debug?: any }
  const defaultContacts = { 
    leads: 0, 
    sql: 0,
    __debug: { rows: 0, minDate: null, maxDate: null, columns: [] }
  }
  const defaultDeals = { 
    wonDeals: 0, 
    revenue: 0, 
    closedDeals: 0, 
    revenueByDate: new Map<string, number>(),
    avgDealSize: 0,
    __debug: { rows: 0, minDate: null, maxDate: null, columns: [] }
  }
  
  const [fb, ga, contacts, deals] = await Promise.allSettled([
    withTimeout(getFbMetrics({ from, to }, sheetUrl), 5000, defaultFb),
    withTimeout(getGoogleSpend({ from, to }, sheetUrl), 5000, defaultGa),
    withTimeout(getContacts({ from, to }, sheetUrl), 5000, defaultContacts),
    withTimeout(getDeals({ from, to }, sheetUrl), 5000, defaultDeals)
  ])
  
  // Log results
  console.log('[getOverviewData] Results:', {
    fb: { status: fb.status, value: fb.status === 'fulfilled' ? { spend: fb.value.spend.total, lpViews: fb.value.lpViews } : 'rejected' },
    ga: { status: ga.status, value: ga.status === 'fulfilled' ? { total: ga.value.total } : 'rejected' },
    contacts: { status: contacts.status, value: contacts.status === 'fulfilled' ? contacts.value : 'rejected' },
    deals: { status: deals.status, value: deals.status === 'fulfilled' ? { wonDeals: deals.value.wonDeals, revenue: deals.value.revenue } : 'rejected' }
  })
  
  // Extract results, using defaults if failed
  const fbData = fb.status === 'fulfilled' ? fb.value : defaultFb
  const gaData = ga.status === 'fulfilled' ? ga.value : defaultGa
  const contactsData = contacts.status === 'fulfilled' ? contacts.value : defaultContacts
  const dealsData = deals.status === 'fulfilled' ? deals.value : defaultDeals
  
  // Collect debug info
  const fbDebug = (fbData as any).__debug || { rows: 0, minDate: null, maxDate: null, columns: [], spendTotal: 0, nanCounts: { spend: 0, lpViews: 0, fbFormLeads: 0, landingLeads: 0 }, error: null }
  const gaDebug = (gaData as any).__debug || { rows: 0, minDate: null, maxDate: null, columns: [], spendTotal: 0, nanCounts: { cost: 0 }, error: null }
  const contactsDebug = (contactsData as any).__debug || { rows: 0, minDate: null, maxDate: null, columns: [], error: null }
  const dealsDebug = (dealsData as any).__debug || { rows: 0, minDate: null, maxDate: null, columns: [], error: null }
  
  // Track errors from both rejections and __debug.error
  const errors: string[] = []
  
  if (fb.status === 'rejected') {
    console.error('[getOverviewData] FB failed:', fb.reason)
    errors.push(`FB: ${fb.reason?.message || String(fb.reason)}`)
  } else if (fbDebug.error) {
    errors.push(`FB: ${fbDebug.error}`)
  }
  
  if (ga.status === 'rejected') {
    console.error('[getOverviewData] Google Ads failed:', ga.reason)
    errors.push(`GA: ${ga.reason?.message || String(ga.reason)}`)
  } else if (gaDebug.error) {
    errors.push(`GA: ${gaDebug.error}`)
  }
  
  if (contacts.status === 'rejected') {
    console.error('[getOverviewData] Contacts failed:', contacts.reason)
    errors.push(`Contacts: ${contacts.reason?.message || String(contacts.reason)}`)
  } else if (contactsDebug.error) {
    errors.push(`Contacts: ${contactsDebug.error}`)
  }
  
  if (deals.status === 'rejected') {
    console.error('[getOverviewData] Deals failed:', deals.reason)
    errors.push(`Deals: ${deals.reason?.message || String(deals.reason)}`)
  } else if (dealsDebug.error) {
    errors.push(`Deals: ${dealsDebug.error}`)
  }
  
  const errorMsg = errors.length > 0 ? errors.join('; ') : null

  // Merge spend
  const spendTotal = (fbData.spend.total || 0) + (gaData.total || 0)
  const spendByDate = new Map<string, number>()
  for (const [d, v] of fbData.spend.byDate) {
    spendByDate.set(d, (spendByDate.get(d) || 0) + v)
  }
  for (const [d, v] of gaData.byDate) {
    spendByDate.set(d, (spendByDate.get(d) || 0) + v)
  }

  // KPIs
  const leadsTotal = contactsData.leads          // all HubSpot contacts created in range
  const wonDeals = dealsData.wonDeals            // won in range
  const revenue = dealsData.revenue               // sum amount_effective for won
  const avgDeal = (dealsData as any).avgDealSize ?? (wonDeals ? revenue / wonDeals : 0)  // Use from dealsData if available
  const winRate = dealsData.closedDeals ? (wonDeals / dealsData.closedDeals) : 0

  const cacByLeads = leadsTotal ? spendTotal / leadsTotal : 0
  const cacByDeals = wonDeals ? spendTotal / wonDeals : 0
  const roas = spendTotal ? revenue / spendTotal : 0

  // Trend: daily revenue vs daily spend
  const revenueByDate = dealsData.revenueByDate
  const allDates = Array.from(new Set([...spendByDate.keys(), ...revenueByDate.keys()])).sort()

  const trend = allDates.map(d => ({
    date: d,
    spend: spendByDate.get(d) || 0,
    revenue: revenueByDate.get(d) || 0,
  }))

  // FB-only funnel items (for now)
  const funnel = {
    lpViews: fbData.lpViews,
    leads: leadsTotal,             // HubSpot leads
    sql: contactsData.sql,
    deals: wonDeals,
  }

  return {
    kpis: {
      revenue,
      wonDeals,
      winRate,
      avgDealSize: avgDeal,
      spend: spendTotal,
      leads: leadsTotal,
      cac: { byLeads: cacByLeads, byDeals: cacByDeals },
      roas,
    },
    funnel,
    trend,
    __debug: {
      fb: fbDebug,
      ga: gaDebug,
      contacts: contactsDebug,
      deals: dealsDebug,
      env: { hasSheetsUrl: Boolean(sheetUrl || getSheetsUrl()) },
      error: errorMsg,
    },
  }
}

// Map enriched row to FacebookAdRecord for compatibility
function mapEnrichedToRecord(row: FbEnrichedRow): FacebookAdRecord {
  return {
    date: row.date_iso || row.date_start, // Prefer date_iso for filtering
    campaign: row.campaign_name,
    spend: row.spend,
    clicks: row.clicks,
    landing_page_view: row.lp_views,
    landing_page_view_unique: row.lp_views,
    impressions: 0, // Not in enriched data
  }
}

// Fetch Facebook Ads data using enriched sheet
export async function fetchFacebookAds(sheetUrl: string = DEFAULT_SHEET_URL): Promise<FacebookAdRecord[]> {
  try {
    if (!sheetUrl) {
      console.warn('No sheet URL provided for Facebook Ads')
      return []
    }
    
    const enrichedRows = await fetchFbEnriched(fetchSheet)
    return enrichedRows.map(mapEnrichedToRecord)
  } catch (error) {
    console.error('Error fetching Facebook Ads:', error)
    return []
  }
}

// Fetch HubSpot Deals
export async function fetchHubSpotDeals(sheetUrl: string = DEFAULT_SHEET_URL): Promise<HubSpotDeal[]> {
  try {
    if (!sheetUrl) {
      console.warn('No sheet URL provided for HubSpot Deals')
      return []
    }
    const url = `${sheetUrl}?tab=hubspot_deals_raw`
    const response = await fetch(url, { 
      cache: 'no-store'
    })
    if (!response.ok) {
      console.warn(`Failed to fetch hubspot_deals_raw (${response.status}): ${response.statusText}`)
      return []
    }
    const data = await response.json()
    if (!Array.isArray(data)) {
      console.warn('HubSpot Deals data is not an array')
      return []
    }
    
    return data.map((row: any) => ({
      dealId: String(row['dealId'] || row['deal_id'] || row['hs_object_id'] || ''),
      dealname: String(row['dealname'] || row['deal_name'] || ''),
      amount: Number(row['amount'] || row['deal_amount'] || 0),
      closedate: String(row['closedate'] || row['close_date'] || ''),
      dealstage: String(row['dealstage'] || row['deal_stage'] || ''),
      createdate: String(row['createdate'] || row['create_date'] || ''),
      utm_source: row['utm_source'] || undefined,
      utm_medium: row['utm_medium'] || undefined,
      utm_campaign: row['utm_campaign'] || undefined,
      ...row
    }))
  } catch (error) {
    console.error('Error fetching HubSpot Deals:', error)
    return []
  }
}

// Fetch HubSpot Contacts (prefer 90d, fallback to raw)
export async function fetchHubSpotContacts(sheetUrl: string = DEFAULT_SHEET_URL): Promise<HubSpotContact[]> {
  try {
    if (!sheetUrl) {
      console.warn('No sheet URL provided for HubSpot Contacts')
      return []
    }
    // Try 90d first
    let url = `${sheetUrl}?tab=hubspot_contacts_90d`
    let response = await fetch(url, { 
      cache: 'no-store'
    })
    
    if (!response.ok) {
      // Fallback to raw
      url = `${sheetUrl}?tab=hubspot_contacts_raw`
      response = await fetch(url, { 
        cache: 'no-store'
      })
    }
    
    if (!response.ok) {
      console.warn(`Failed to fetch HubSpot contacts (${response.status}): ${response.statusText}`)
      return []
    }
    
    const data = await response.json()
    if (!Array.isArray(data)) {
      console.warn('HubSpot Contacts data is not an array')
      return []
    }
    
    return data.map((row: any) => ({
      contactId: String(row['contactId'] || row['contact_id'] || row['hs_object_id'] || ''),
      email: String(row['email'] || ''),
      createdate: String(row['createdate'] || row['create_date'] || ''),
      utm_source: row['utm_source'] || undefined,
      utm_medium: row['utm_medium'] || undefined,
      utm_campaign: row['utm_campaign'] || undefined,
      ...row
    }))
  } catch (error) {
    console.error('Error fetching HubSpot Contacts:', error)
    return []
  }
}

// Fetch Marketing Funnel (try named range first, then tab)
export async function fetchMarketingFunnel(sheetUrl: string = DEFAULT_SHEET_URL): Promise<MarketingFunnelRecord[]> {
  try {
    // Try named range first
    let url = `${sheetUrl}?tab=MARKETING_FUNNEL`
    let response = await fetch(url)
    
    if (!response.ok) {
      // Fallback to tab
      url = `${sheetUrl}?tab=marketing_funnel`
      response = await fetch(url)
    }
    
    if (!response.ok) {
      console.warn('Marketing funnel not found, returning empty array')
      return []
    }
    
    const data = await response.json()
    if (!Array.isArray(data)) return []
    
    return data.map((row: any) => ({
      date: String(row['date'] || row['Date'] || ''),
      lp_views: Number(row['lp_views'] || row['LP Views'] || 0),
      leads: Number(row['leads'] || row['Leads'] || 0),
      sql: Number(row['sql'] || row['SQL'] || 0),
      deals: Number(row['deals'] || row['Deals'] || 0),
      revenue: Number(row['revenue'] || row['Revenue'] || 0),
      ...row
    }))
  } catch (error) {
    console.error('Error fetching Marketing Funnel:', error)
    return []
  }
}

// Helper to get date range
export function getDateRange(range: '30d' | '60d' | '90d' | 'custom', customStart?: string, customEnd?: string): { start: Date; end: Date } {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  
  if (range === 'custom' && customStart && customEnd) {
    return {
      start: new Date(customStart),
      end: new Date(customEnd)
    }
  }
  
  const days = range === '30d' ? 30 : range === '60d' ? 60 : 90
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)
  
  return { start, end }
}

// Helper to check if date is in range
export function isDateInRange(dateStr: string, start: Date, end: Date): boolean {
  const date = new Date(dateStr)
  return date >= start && date <= end
}

// Check if contact came from paid channel
export function isPaidContact(contact: HubSpotContact): boolean {
  const source = (contact.utm_source || '').toLowerCase()
  const medium = (contact.utm_medium || '').toLowerCase()
  
  const paidSources = ['google', 'facebook', 'meta', 'cpc', 'paid', 'adwords', 'fb']
  const paidMediums = ['cpc', 'paid', 'social', 'display']
  
  return paidSources.includes(source) || paidMediums.includes(medium)
}

// Aggregate metrics for date range
export async function getOverviewMetrics(
  filters: OverviewFilters,
  sheetUrl: string = DEFAULT_SHEET_URL
): Promise<OverviewMetrics> {
  const { start, end } = getDateRange(filters.dateRange, filters.customStart, filters.customEnd)
  const prevStart = new Date(start)
  const prevEnd = new Date(end)
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  prevStart.setDate(prevStart.getDate() - daysDiff)
  prevEnd.setDate(prevEnd.getDate() - daysDiff)
  
  // Fetch all data with safe defaults
  let fbAds: FacebookAdRecord[] = []
  let deals: HubSpotDeal[] = []
  let contacts: HubSpotContact[] = []
  let funnel: MarketingFunnelRecord[] = []
  
  try {
    const results = await Promise.allSettled([
      fetchFacebookAds(sheetUrl),
      fetchHubSpotDeals(sheetUrl),
      fetchHubSpotContacts(sheetUrl),
      fetchMarketingFunnel(sheetUrl)
    ])
    
    fbAds = results[0].status === 'fulfilled' ? (results[0].value || []) : []
    deals = results[1].status === 'fulfilled' ? (results[1].value || []) : []
    contacts = results[2].status === 'fulfilled' ? (results[2].value || []) : []
    funnel = results[3].status === 'fulfilled' ? (results[3].value || []) : []
  } catch (error) {
    console.error('Error fetching overview data:', error)
    // All arrays already default to []
  }
  
  // Ensure arrays are always defined
  fbAds = Array.isArray(fbAds) ? fbAds : []
  deals = Array.isArray(deals) ? deals : []
  contacts = Array.isArray(contacts) ? contacts : []
  funnel = Array.isArray(funnel) ? funnel : []
  
  // Filter by date range
  const currentFbAds = (fbAds || []).filter(ad => isDateInRange(ad.date, start, end))
  const currentDeals = (deals || []).filter(deal => {
    const closeDate = deal.closedate || deal.createdate
    return isDateInRange(closeDate, start, end)
  })
  const currentContacts = (contacts || []).filter(contact => isDateInRange(contact.createdate, start, end))
  
  // Previous period
  const prevFbAds = filters.comparePrevious ? (fbAds || []).filter(ad => isDateInRange(ad.date, prevStart, prevEnd)) : []
  const prevDeals = filters.comparePrevious ? (deals || []).filter(deal => {
    const closeDate = deal.closedate || deal.createdate
    return isDateInRange(closeDate, prevStart, prevEnd)
  }) : []
  const prevContacts = filters.comparePrevious ? (contacts || []).filter(contact => isDateInRange(contact.createdate, prevStart, prevEnd)) : []
  
  // Calculate metrics
  const wonDeals = currentDeals.filter(d => {
    const stage = (d.dealstage || '').toLowerCase()
    return stage.includes('won') || stage.includes('closed won') || stage === 'closedwon'
  })
  const revenueWon = wonDeals.reduce((sum, d) => sum + (d.amount || 0), 0)
  
  const prevWonDeals = filters.comparePrevious ? prevDeals.filter(d => {
    const stage = (d.dealstage || '').toLowerCase()
    return stage.includes('won') || stage.includes('closed won') || stage === 'closedwon'
  }) : []
  const prevRevenueWon = prevWonDeals.reduce((sum, d) => sum + (d.amount || 0), 0)
  
  const paidContacts = currentContacts.filter(isPaidContact)
  const prevPaidContacts = prevContacts.filter(isPaidContact)
  
  // Get enriched FB data and filter by date
  const allEnriched = await fetchFbEnriched(fetchSheet, sheetUrl)
  const currentEnrichedFiltered = allEnriched.filter(row => {
    const dateStr = row.date_iso || row.date_start
    return isDateInRange(dateStr, start, end)
  })
  const currentFbTotals = totalsFb(currentEnrichedFiltered)
  
  // Get enriched FB totals for previous period
  const prevEnrichedFiltered = filters.comparePrevious 
    ? allEnriched.filter(row => {
        const dateStr = row.date_iso || row.date_start
        return isDateInRange(dateStr, prevStart, prevEnd)
      })
    : []
  const prevFbTotals = totalsFb(prevEnrichedFiltered)
  
  const spend = currentFbTotals.spend
  const prevSpend = prevFbTotals.spend
  
  const lpViews = currentFbTotals.lp_views
  
  const sqlCount = currentDeals.filter(d => {
    const stage = (d.dealstage || '').toLowerCase()
    return stage.includes('sql') || stage.includes('sales qualified') || stage.includes('qualified')
  }).length
  
  const dealsCreated = currentDeals.length
  
  const winRate = dealsCreated > 0 ? (wonDeals.length / dealsCreated) * 100 : 0
  const prevDealsCreated = prevDeals.length
  const prevWinRate = prevDealsCreated > 0 ? (prevWonDeals.length / prevDealsCreated) * 100 : 0
  
  const cacByLeads = paidContacts.length > 0 ? spend / paidContacts.length : 0
  const cacByDeals = wonDeals.length > 0 ? spend / wonDeals.length : 0
  const roas = spend > 0 ? revenueWon / spend : 0
  
  const prevCacByLeads = prevPaidContacts.length > 0 ? prevSpend / prevPaidContacts.length : 0
  const prevCacByDeals = prevWonDeals.length > 0 ? prevSpend / prevWonDeals.length : 0
  const prevRoas = prevSpend > 0 ? prevRevenueWon / prevSpend : 0
  
  const avgDealSize = wonDeals.length > 0 ? revenueWon / wonDeals.length : 0
  const prevAvgDealSize = prevWonDeals.length > 0 ? prevRevenueWon / prevWonDeals.length : 0
  
  // Funnel metrics
  const leadsCount = paidContacts.length
  const dealsCount = dealsCreated
  const revenueTotal = revenueWon
  
  // Conversion rates
  const lpToLeadRate = lpViews > 0 ? (leadsCount / lpViews) * 100 : 0
  const leadToSqlRate = leadsCount > 0 ? (sqlCount / leadsCount) * 100 : 0
  const sqlToDealRate = sqlCount > 0 ? (dealsCount / sqlCount) * 100 : 0
  const dealToRevenueRate = dealsCount > 0 ? (revenueTotal / dealsCount) : 0
  
  // Previous period deltas
  const prevLpViews = prevFbTotals.lp_views
  const prevLeadsCount = prevPaidContacts.length
  const prevSqlCount = filters.comparePrevious ? prevDeals.filter(d => {
    const stage = (d.dealstage || '').toLowerCase()
    return stage.includes('sql') || stage.includes('sales qualified') || stage.includes('qualified')
  }).length : 0
  const prevDealsCount = prevDeals.length
  
  return {
    revenueWon: {
      value: revenueWon,
      deltaPct: prevRevenueWon > 0 ? ((revenueWon - prevRevenueWon) / prevRevenueWon) * 100 : null,
      previousValue: filters.comparePrevious ? prevRevenueWon : null
    },
    wonDeals: {
      value: wonDeals.length,
      deltaPct: prevWonDeals.length > 0 ? ((wonDeals.length - prevWonDeals.length) / prevWonDeals.length) * 100 : null,
      previousValue: filters.comparePrevious ? prevWonDeals.length : null
    },
    winRate: {
      value: winRate,
      deltaPct: prevWinRate > 0 ? winRate - prevWinRate : null,
      previousValue: filters.comparePrevious ? prevWinRate : null
    },
    avgDealSize: {
      value: avgDealSize,
      deltaPct: prevAvgDealSize > 0 ? ((avgDealSize - prevAvgDealSize) / prevAvgDealSize) * 100 : null,
      previousValue: filters.comparePrevious ? prevAvgDealSize : null
    },
    spend: {
      value: spend,
      deltaPct: prevSpend > 0 ? ((spend - prevSpend) / prevSpend) * 100 : null,
      previousValue: filters.comparePrevious ? prevSpend : null
    },
    leads: {
      value: leadsCount,
      deltaPct: prevLeadsCount > 0 ? ((leadsCount - prevLeadsCount) / prevLeadsCount) * 100 : null,
      previousValue: filters.comparePrevious ? prevLeadsCount : null
    },
    cac: {
      value: cacByLeads, // Default to leads-based
      deltaPct: prevCacByLeads > 0 ? ((cacByLeads - prevCacByLeads) / prevCacByLeads) * 100 : null,
      previousValue: filters.comparePrevious ? prevCacByLeads : null
    },
    roas: {
      value: roas,
      deltaPct: prevRoas > 0 ? ((roas - prevRoas) / prevRoas) * 100 : null,
      previousValue: filters.comparePrevious ? prevRoas : null
    },
    lpViews,
    leadsCount,
    sqlCount,
    dealsCount,
    revenueTotal,
    lpToLeadRate,
    leadToSqlRate,
    sqlToDealRate,
    dealToRevenueRate,
    lpViewsDelta: prevLpViews > 0 ? lpViews - prevLpViews : null,
    leadsDelta: prevLeadsCount > 0 ? leadsCount - prevLeadsCount : null,
    sqlDelta: prevSqlCount > 0 ? sqlCount - prevSqlCount : null,
    dealsDelta: prevDealsCount > 0 ? dealsCount - prevDealsCount : null
  }
}

// Get daily metrics for charts
export async function getDailyMetrics(
  filters: OverviewFilters,
  sheetUrl: string = DEFAULT_SHEET_URL
): Promise<DailyMetric[]> {
  const { start, end } = getDateRange(filters.dateRange, filters.customStart, filters.customEnd)
  
  // Fetch with safe defaults
  let fbAds: FacebookAdRecord[] = []
  let deals: HubSpotDeal[] = []
  let contacts: HubSpotContact[] = []
  
  try {
    const results = await Promise.allSettled([
      fetchFacebookAds(sheetUrl),
      fetchHubSpotDeals(sheetUrl),
      fetchHubSpotContacts(sheetUrl)
    ])
    
    fbAds = results[0].status === 'fulfilled' ? (results[0].value || []) : []
    deals = results[1].status === 'fulfilled' ? (results[1].value || []) : []
    contacts = results[2].status === 'fulfilled' ? (results[2].value || []) : []
  } catch (error) {
    console.error('Error fetching daily metrics data:', error)
    // All arrays already default to []
  }
  
  // Ensure arrays are always defined
  fbAds = Array.isArray(fbAds) ? fbAds : []
  deals = Array.isArray(deals) ? deals : []
  contacts = Array.isArray(contacts) ? contacts : []
  
  const dailyMap = new Map<string, DailyMetric>()
  
  // Initialize all days in range
  const current = new Date(start)
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0]
    dailyMap.set(dateStr, {
      date: dateStr,
      revenue: 0,
      spend: 0,
      winRate: 0,
      cac: 0,
      roas: 0
    })
    current.setDate(current.getDate() + 1)
  }
  
  // Aggregate FB ads
  fbAds.forEach(ad => {
    if (isDateInRange(ad.date, start, end)) {
      const metric = dailyMap.get(ad.date) || {
        date: ad.date,
        revenue: 0,
        spend: 0,
        winRate: 0,
        cac: 0,
        roas: 0
      }
      metric.spend += ad.spend || 0
      dailyMap.set(ad.date, metric)
    }
  })
  
  // Aggregate deals
  deals.forEach(deal => {
    const closeDate = deal.closedate || deal.createdate
    if (isDateInRange(closeDate, start, end)) {
      const dateStr = closeDate.split('T')[0]
      const metric = dailyMap.get(dateStr) || {
        date: dateStr,
        revenue: 0,
        spend: 0,
        winRate: 0,
        cac: 0,
        roas: 0
      }
      
      const stage = (deal.dealstage || '').toLowerCase()
      const isWon = stage.includes('won') || stage.includes('closed won') || stage === 'closedwon'
      if (isWon) {
        metric.revenue += deal.amount || 0
      }
      dailyMap.set(dateStr, metric)
    }
  })
  
  // Calculate derived metrics per day
  const dailyDealsMap = new Map<string, { total: number; won: number }>()
  const dailyContactsMap = new Map<string, number>()
  
  deals.forEach(deal => {
    const closeDate = deal.closedate || deal.createdate
    if (isDateInRange(closeDate, start, end)) {
      const dateStr = closeDate.split('T')[0]
      const existing = dailyDealsMap.get(dateStr) || { total: 0, won: 0 }
      existing.total += 1
      const stage = (deal.dealstage || '').toLowerCase()
      const isWon = stage.includes('won') || stage.includes('closed won') || stage === 'closedwon'
      if (isWon) {
        existing.won += 1
      }
      dailyDealsMap.set(dateStr, existing)
    }
  })
  
  (contacts || []).forEach(contact => {
    if (isDateInRange(contact.createdate, start, end) && isPaidContact(contact)) {
      const dateStr = contact.createdate.split('T')[0]
      dailyContactsMap.set(dateStr, (dailyContactsMap.get(dateStr) || 0) + 1)
    }
  })
  
  Array.from(dailyMap.values()).forEach(metric => {
    const dealsData = dailyDealsMap.get(metric.date) || { total: 0, won: 0 }
    const leads = dailyContactsMap.get(metric.date) || 0
    
    metric.winRate = dealsData.total > 0 ? (dealsData.won / dealsData.total) * 100 : 0
    metric.cac = leads > 0 ? metric.spend / leads : 0
    metric.roas = metric.spend > 0 ? metric.revenue / metric.spend : 0
  })
  
  return Array.from(dailyMap.values()).sort((a, b) => 
    a.date.localeCompare(b.date)
  )
}

// Get campaign performance for Top Movers
export async function getCampaignPerformance(
  filters: OverviewFilters,
  sheetUrl: string = DEFAULT_SHEET_URL
): Promise<CampaignPerformance[]> {
  const { start, end } = getDateRange(filters.dateRange, filters.customStart, filters.customEnd)
  const prevStart = new Date(start)
  const prevEnd = new Date(end)
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  prevStart.setDate(prevStart.getDate() - daysDiff)
  prevEnd.setDate(prevEnd.getDate() - daysDiff)
  
  // Fetch with safe defaults
  let fbAds: FacebookAdRecord[] = []
  let deals: HubSpotDeal[] = []
  let contacts: HubSpotContact[] = []
  
  try {
    const results = await Promise.allSettled([
      fetchFacebookAds(sheetUrl),
      fetchHubSpotDeals(sheetUrl),
      fetchHubSpotContacts(sheetUrl)
    ])
    
    fbAds = results[0].status === 'fulfilled' ? (results[0].value || []) : []
    deals = results[1].status === 'fulfilled' ? (results[1].value || []) : []
    contacts = results[2].status === 'fulfilled' ? (results[2].value || []) : []
  } catch (error) {
    console.error('Error fetching campaign performance data:', error)
    // All arrays already default to []
  }
  
  // Ensure arrays are always defined
  fbAds = Array.isArray(fbAds) ? fbAds : []
  deals = Array.isArray(deals) ? deals : []
  contacts = Array.isArray(contacts) ? contacts : []
  
  const currentFbAds = (fbAds || []).filter(ad => isDateInRange(ad.date, start, end))
  const prevFbAds = (fbAds || []).filter(ad => isDateInRange(ad.date, prevStart, prevEnd))
  
  const campaignMap = new Map<string, CampaignPerformance>()
  
  // Process current period
  currentFbAds.forEach(ad => {
    const key = ad.campaign || 'Unknown'
    if (!campaignMap.has(key)) {
      campaignMap.set(key, {
        campaign: key,
        channel: 'facebook',
        spend: 0,
        leads: 0,
        cac: 0,
        deals: 0,
        revenue: 0,
        deltaPct: 0,
        utmCampaign: undefined
      })
    }
    const perf = campaignMap.get(key)!
    perf.spend += ad.spend || 0
  })
  
  // Match deals and contacts by utm_campaign
  deals.forEach(deal => {
    const closeDate = deal.closedate || deal.createdate
    if (isDateInRange(closeDate, start, end)) {
      const utmCampaign = deal.utm_campaign
      if (utmCampaign) {
        // Try to match to campaign
        for (const [campaign, perf] of campaignMap.entries()) {
          if (campaign.toLowerCase().includes(utmCampaign.toLowerCase()) || 
              utmCampaign.toLowerCase().includes(campaign.toLowerCase())) {
            perf.deals += 1
            const stage = (deal.dealstage || '').toLowerCase()
            const isWon = stage.includes('won') || stage.includes('closed won') || stage === 'closedwon'
            if (isWon) {
              perf.revenue += deal.amount || 0
            }
            break
          }
        }
      }
    }
  })
  
  (contacts || []).forEach(contact => {
    if (isDateInRange(contact.createdate, start, end) && isPaidContact(contact)) {
      const utmCampaign = contact.utm_campaign
      if (utmCampaign) {
        for (const [campaign, perf] of campaignMap.entries()) {
          if (campaign.toLowerCase().includes(utmCampaign.toLowerCase()) || 
              utmCampaign.toLowerCase().includes(campaign.toLowerCase())) {
            perf.leads += 1
            break
          }
        }
      }
    }
  })
  
  // Calculate CAC
  campaignMap.forEach(perf => {
    perf.cac = perf.leads > 0 ? perf.spend / perf.leads : 0
  })
  
  // Calculate previous period for deltas
  const prevMap = new Map<string, CampaignPerformance>()
  prevFbAds.forEach(ad => {
    const key = ad.campaign || 'Unknown'
    if (!prevMap.has(key)) {
      prevMap.set(key, {
        campaign: key,
        channel: 'facebook',
        spend: 0,
        leads: 0,
        cac: 0,
        deals: 0,
        revenue: 0,
        deltaPct: 0
      })
    }
    const perf = prevMap.get(key)!
    perf.spend += ad.spend || 0
  })
  
  // Calculate deltas
  campaignMap.forEach((perf, key) => {
    const prev = prevMap.get(key)
    if (prev && prev.revenue > 0) {
      perf.deltaPct = ((perf.revenue - prev.revenue) / prev.revenue) * 100
    }
  })
  
  return Array.from(campaignMap.values())
    .filter(p => p.spend > 0 || p.revenue > 0)
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
}

