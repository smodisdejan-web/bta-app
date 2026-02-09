import { DEFAULT_WEB_APP_URL, getSheetsUrl } from './config'
import { fetchTab } from './sheetsData'

const SHEET_URL = getSheetsUrl() || DEFAULT_WEB_APP_URL

export interface GA4LandingPage {
  date: string
  landingPage: string
  sourcemedium: string
  device: string
  sessions: number
  users: number
  bounceRate: number
  avgEngagementTime: number
  conversions: number
  conversionRate: number
}

export interface GA4LandingPageTotals {
  totalSessions: number
  totalUsers: number
  totalConversions: number
  conversionRate: number
  avgBounceRate: number
  avgEngagementTime: number
}

const EXCLUDE_PATTERNS = ['/thank-you', '/thanks', '/confirmation', '/success']

export function isRelevantPage(landingPage: string): boolean {
  if (landingPage === '/' || landingPage === '' || landingPage === '(not set)') return false
  return !EXCLUDE_PATTERNS.some((pattern) => landingPage.toLowerCase().includes(pattern))
}

export async function fetchGA4LandingPages(sheetUrl = SHEET_URL): Promise<GA4LandingPage[]> {
  console.log('[fetchGA4LandingPages] Fetching from tab: ga4_landing_pages')

  const { headers, rows } = await fetchTab('ga4_landing_pages', sheetUrl)

  console.log('[GA4 DEBUG] Headers:', JSON.stringify(headers))
  console.log('[GA4 DEBUG] First row keys:', rows[0] ? Object.keys(rows[0]) : 'no rows')
  console.log('[GA4 DEBUG] First row values:', rows[0] ? JSON.stringify(rows[0]) : 'no rows')

  console.log('[fetchGA4LandingPages] Raw rows count:', rows?.length || 0)
  if (headers?.length) {
    console.log('[fetchGA4LandingPages] Headers:', headers)
  }
  if (rows?.length > 0) {
    console.log('[fetchGA4LandingPages] First row:', JSON.stringify(rows[0]))
  }
  if (rows?.length > 0) {
    console.log('[GA4] Available fields in first row:', Object.keys(rows[0]))
    console.log('[GA4] Bounce rate field check:', {
      bounceRate: rows[0]?.bounceRate,
      bounce_rate: rows[0]?.bounce_rate,
      bouncerate: rows[0]?.bouncerate,
    })
  }
  console.log(
    '[GA4] Sample bounceRate values:',
    rows.slice(0, 5).map((r) => r[headers.findIndex((h) => String(h).toLowerCase() === 'bouncerate')]),
  )

  const colIndex = (name: string) => headers.findIndex((h) => String(h).toLowerCase() === name.toLowerCase())

  return rows.map((row: any[]) => {
    const sessions = Number(row[colIndex('sessions')]) || 0
    const conversions = Number(row[colIndex('conversions')]) || 0

    const dateRaw = String(row[colIndex('date')] || '')
    const date =
      dateRaw.length === 8
        ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
        : dateRaw

    // Bounce rate fix: GA4 might return 0-1 or already 0-100
    let bounceRate =
      Number(row[colIndex('bounceRate')]) || Number(row[colIndex('bounce_rate')]) || Number(row[colIndex('bouncerate')]) || 0
    if (bounceRate > 0 && bounceRate <= 1) {
      bounceRate = bounceRate * 100
    } else if (bounceRate > 100) {
      // guard against accidental scaling; keep as-is otherwise
      bounceRate = bounceRate / 100
    }

    // Engagement fix: if absurdly high, treat as microseconds
    let avgEngagementTime = Number(row[colIndex('averageSessionDuration')]) || 0
    if (avgEngagementTime > 86400) {
      avgEngagementTime = avgEngagementTime / 1_000_000
    }

    return {
      date,
      landingPage: row[colIndex('landingPage')] || '',
      sourcemedium: row[colIndex('sessionSourceMedium')] || '',
      device: row[colIndex('deviceCategory')] || '',
      sessions,
      users: Number(row[colIndex('totalUsers')]) || 0,
      bounceRate,
      avgEngagementTime,
      conversions,
      conversionRate: sessions > 0 ? (conversions / sessions) * 100 : 0,
    }
  })
}

export function calculateGA4Totals(data: GA4LandingPage[]): GA4LandingPageTotals {
  const totalSessions = data.reduce((sum, d) => sum + d.sessions, 0)
  const totalUsers = data.reduce((sum, d) => sum + d.users, 0)
  const totalConversions = data.reduce((sum, d) => sum + d.conversions, 0)
  const totalSessionsForBounce = data.reduce((sum, d) => sum + d.sessions, 0)
  const avgBounceRate =
    totalSessionsForBounce > 0 ? data.reduce((sum, d) => sum + d.bounceRate * d.sessions, 0) / totalSessionsForBounce : 0
  const avgEngagementTime =
    data.length > 0 ? data.reduce((sum, d) => sum + d.avgEngagementTime, 0) / data.length : 0

  return {
    totalSessions,
    totalUsers,
    totalConversions,
    conversionRate: totalSessions > 0 ? (totalConversions / totalSessions) * 100 : 0,
    avgBounceRate,
    avgEngagementTime,
  }
}

export function filterByDateRange(data: GA4LandingPage[], days: number): GA4LandingPage[] {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  cutoff.setHours(0, 0, 0, 0)

  return data.filter((d) => {
    const date = new Date(d.date)
    return date >= cutoff
  })
}

export function getTopPerformers(data: GA4LandingPage[], limit = 5): GA4LandingPage[] {
  const aggregated = aggregateByLandingPage(data)

  const excludePatterns = ['/thank-you', '/thanks', '/confirmation', '/success']

  return aggregated
    .filter((d) => d.sessions >= 100)
    .filter((d) => !excludePatterns.some((pattern) => d.landingPage.toLowerCase().includes(pattern)))
    .map((d) => ({ ...d, conversionRate: Math.min(d.conversionRate, 100) }))
    .sort((a, b) => b.conversionRate - a.conversionRate)
    .slice(0, limit)
}

export function getLeakyBuckets(data: GA4LandingPage[], limit = 5): GA4LandingPage[] {
  const aggregated = aggregateByLandingPage(data)

  console.log(
    '[getLeakyBuckets] Sample data:',
    aggregated.slice(0, 5).map((d) => ({
      page: d.landingPage,
      sessions: d.sessions,
      convRate: d.conversionRate,
    })),
  )

  const leaky = aggregated
    .filter((d) => d.sessions >= 100)
    .filter((d) => d.conversionRate < 1)
    .filter((d) => d.landingPage !== '/' && d.landingPage !== '')
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit)

  console.log(
    '[getLeakyBuckets] Result:',
    leaky.map((d) => ({
      page: d.landingPage,
      convRate: d.conversionRate,
    })),
  )

  return leaky
}

export function aggregateByLandingPage(data: GA4LandingPage[]): GA4LandingPage[] {
  const map = new Map<string, GA4LandingPage>()

  data
    .filter((d) => isRelevantPage(d.landingPage))
    .forEach((d) => {
    const key = d.landingPage
    const existing = map.get(key)

    if (existing) {
      existing.sessions += d.sessions
      existing.users += d.users
      existing.conversions += d.conversions
      existing.bounceRate = (existing.bounceRate + d.bounceRate) / 2
      existing.avgEngagementTime = (existing.avgEngagementTime + d.avgEngagementTime) / 2
    } else {
      map.set(key, { ...d })
    }
  })

  return Array.from(map.values()).map((d) => ({
    ...d,
    conversionRate: d.sessions > 0 ? (d.conversions / d.sessions) * 100 : 0,
  }))
}

export function aggregateBySource(
  data: GA4LandingPage[],
): { source: string; sessions: number; conversions: number; conversionRate: number }[] {
  const KNOWN_SOURCES = [
    'facebook',
    'google',
    'direct',
    'email',
    'instagram',
    'bing',
    'linkedin',
    'twitter',
    'tiktok',
    'youtube',
    'organic',
  ]
  const map = new Map<string, { sessions: number; conversions: number }>()

  data.forEach((d) => {
    const parts = d.sourcemedium.split(' / ')
    let source = parts[0]?.trim()?.toLowerCase() || 'other'

    if (source.includes('facebook') || source.includes('fb') || source === 'meta') {
      source = 'facebook'
    } else if (source.includes('google')) {
      source = 'google'
    } else if (source === '(direct)' || source === 'direct') {
      source = 'direct'
    } else if (source.includes('email') || source.includes('hs_email') || source.includes('hubspot')) {
      source = 'email'
    } else if (source.includes('instagram') || source === 'ig') {
      source = 'instagram'
    } else if (source.includes('bing')) {
      source = 'bing'
    } else if (source === '(not set)' || source === '') {
      source = 'other'
    } else if (!KNOWN_SOURCES.some((known) => source.includes(known))) {
      source = 'other'
    }

    const existing = map.get(source) || { sessions: 0, conversions: 0 }
    existing.sessions += d.sessions
    existing.conversions += d.conversions
    map.set(source, existing)
  })

  return Array.from(map.entries())
    .map(([source, data]) => ({
      source,
      sessions: data.sessions,
      conversions: data.conversions,
      conversionRate: data.sessions > 0 ? (data.conversions / data.sessions) * 100 : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 6)
}

export function aggregateByDevice(
  data: GA4LandingPage[],
): { device: string; sessions: number; conversions: number; conversionRate: number }[] {
  const map = new Map<string, { sessions: number; conversions: number }>()

  data.forEach((d) => {
    const device = d.device || 'unknown'
    const existing = map.get(device) || { sessions: 0, conversions: 0 }
    existing.sessions += d.sessions
    existing.conversions += d.conversions
    map.set(device, existing)
  })

  return Array.from(map.entries())
    .map(([device, data]) => ({
      device,
      sessions: data.sessions,
      conversions: data.conversions,
      conversionRate: data.sessions > 0 ? (data.conversions / data.sessions) * 100 : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions)
}

