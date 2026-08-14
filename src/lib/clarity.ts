/**
 * Microsoft Clarity behaviour data for the GA4 Landing Pages dashboard.
 *
 * WHERE THE DATA COMES FROM
 * -------------------------
 * Not from the Clarity API at request time — that API allows 10 calls per project
 * per day and only serves the last 3 days, so a live call would burn the budget in
 * one page load. The brain snapshots Clarity daily
 * (`code/clarity/fetch-clarity-snapshot.js`) and pushes the history into two tabs
 * of the Goolets production sheet (`code/clarity/push-clarity-to-sheet.js`):
 *
 *   clarity_site    Device-level, FULL coverage — the benchmark
 *   clarity_paths   per landing page, ~9% sampled coverage — see below
 *
 * This module reads those tabs through the same Web App every other dataset uses.
 * It deliberately does NOT read a file bundled into the app: a bundled file is
 * baked into the Next build, so the daily cron would refresh it locally while
 * production stayed frozen on the last deployed day.
 *
 * WHAT CLARITY CANNOT GIVE US
 * ---------------------------
 * First clicks / first tap, attention heatmaps and the recording analysis are
 * UI-only — they are absent from the export API. The dashboard links out to
 * Clarity for those instead of inventing numbers (see clarityHeatmapUrl below).
 *
 * COVERAGE — READ BEFORE QUOTING ANY PER-PATH NUMBER
 * --------------------------------------------------
 * The per-URL export is capped at 1000 unsorted rows with no pagination, and on
 * goolets.net most rows are single-session utm/fbclid variants, so the cap
 * truncates the tail. Measured coverage 2026-08-14: 8.7% of sessions.
 *
 * The consequence for the UI: RATES are usable, TOTALS are not.
 *  - scrollDepth / engagementTime are averages over a paid-traffic-dominated
 *    sample (pilot landing sampled 70 gclid + 47 fbclid sessions), so they are
 *    fair directional signal.
 *  - dead clicks / rage clicks / quick-backs are exposed as INCIDENCE (% of
 *    sessions in which the behaviour occurred), which is Clarity's own unit and
 *    the same one the site-level benchmark uses, so the two compare directly.
 *    Raw event counts are never displayed: on a ~9% sample they understate
 *    reality, and "events per 100 sessions" is a different quantity that reads
 *    as a finding when set beside the site percentage.
 * `coveragePct` rides along on every result so the card can say so out loud.
 * Once the query string is stripped before Clarity init in GTM-P3QGD55 the row
 * cap stops biting and coverage should approach 100%.
 */

import { fetchTab } from './sheetsData'

export const CLARITY_PROJECT_ID = 'q81u03b3ab'

/** Clarity's device labels. "PC" is what it calls desktop. */
export type ClarityDevice = 'Mobile' | 'PC' | 'Tablet'

export interface ClarityDeviceStats {
  sessions: number
  scrollDepth: number | null
  engagementTime: number | null
  /** Incidence: % of sessions in which the behaviour occurred at least once. */
  deadClicksPct: number | null
  rageClicksPct: number | null
  quickbacksPct: number | null
  scriptErrorsPct: number | null
  /** Raw event counts — kept for debugging, never displayed (see module header). */
  deadClicks: number
  rageClicks: number
  quickbacks: number
  errorClicks: number
  scriptErrors: number
}

interface ClaritySiteStats {
  sessions: number
  scrollDepth: number | null
  engagementTime: number | null
  deadClicksPct: number | null
  rageClicksPct: number | null
  quickbacksPct: number | null
  scriptErrorsPct: number | null
}

interface ClarityDay {
  day: string
  numOfDays: number
  fetchedAt: string
  coveragePct: number | null
  rowCapHit: boolean
  site: Record<string, ClaritySiteStats>
  perPath: Record<string, Record<string, ClarityDeviceStats>>
}

interface ClarityHistory {
  dayCount: number
  firstDay: string | null
  lastDay: string | null
  days: ClarityDay[]
}

/**
 * The two tabs are fetched over HTTP, so results are memoised per process for a
 * few minutes. Without this every landing page a user clicks would re-pull the
 * whole history; with it, opening ten pages in a row costs one fetch.
 */
const CACHE_TTL_MS = 5 * 60 * 1000
let cache: { at: number; value: ClarityHistory } | null = null

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Blank cells mean "not measured" and must stay null — 0 is a real measurement. */
function optNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function loadHistory(): Promise<ClarityHistory> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

  const [siteTab, pathsTab] = await Promise.all([
    fetchTab('clarity_site'),
    fetchTab('clarity_paths'),
  ])

  // fetchTab returns positional arrays plus a separate headers array, so columns
  // are resolved by name here. Reading by fixed index would break silently the
  // first time a column is inserted in the sheet.
  const indexer = (headers: string[]) => {
    const map = new Map(headers.map((h, i) => [String(h).trim(), i]))
    return (row: unknown[], name: string): unknown => {
      const i = map.get(name)
      return i === undefined ? undefined : row[i]
    }
  }
  const siteAt = indexer(siteTab.headers)
  const pathAt = indexer(pathsTab.headers)

  const byDay = new Map<string, ClarityDay>()
  const dayOf = (d: string): ClarityDay => {
    if (!byDay.has(d)) {
      byDay.set(d, {
        day: d,
        numOfDays: 0,
        fetchedAt: '',
        coveragePct: null,
        rowCapHit: false,
        site: {},
        perPath: {},
      })
    }
    return byDay.get(d)!
  }

  for (const row of siteTab.rows) {
    const day = String(siteAt(row, 'day') ?? '').slice(0, 10)
    const device = String(siteAt(row, 'device') ?? '')
    if (!day || !device) continue
    dayOf(day).site[device] = {
      sessions: num(siteAt(row, 'sessions')),
      scrollDepth: optNum(siteAt(row, 'scroll_depth')),
      engagementTime: optNum(siteAt(row, 'engagement_time')),
      deadClicksPct: optNum(siteAt(row, 'dead_clicks_pct')),
      rageClicksPct: optNum(siteAt(row, 'rage_clicks_pct')),
      quickbacksPct: optNum(siteAt(row, 'quickbacks_pct')),
      scriptErrorsPct: optNum(siteAt(row, 'script_errors_pct')),
    }
  }

  for (const row of pathsTab.rows) {
    const day = String(pathAt(row, 'day') ?? '').slice(0, 10)
    const host = String(pathAt(row, 'host') ?? '')
    const rowPath = String(pathAt(row, 'path') ?? '')
    const device = String(pathAt(row, 'device') ?? '')
    if (!day || !host || !rowPath || !device) continue

    const d = dayOf(day)
    // Host stays in the key so goolets.net and croatialuxurygulet.com never merge
    // silently — they genuinely share paths (verified 2026-08-14).
    const key = `${host}|${rowPath}`
    if (!d.perPath[key]) d.perPath[key] = {}
    d.perPath[key][device] = {
      sessions: num(pathAt(row, 'sessions')),
      scrollDepth: optNum(pathAt(row, 'scroll_depth')),
      engagementTime: optNum(pathAt(row, 'engagement_time')),
      deadClicksPct: optNum(pathAt(row, 'dead_clicks_pct')),
      rageClicksPct: optNum(pathAt(row, 'rage_clicks_pct')),
      quickbacksPct: optNum(pathAt(row, 'quickbacks_pct')),
      scriptErrorsPct: optNum(pathAt(row, 'script_errors_pct')),
      deadClicks: 0,
      rageClicks: 0,
      quickbacks: 0,
      errorClicks: 0,
      scriptErrors: 0,
    }
    // Coverage is per snapshot, repeated on every row of that day.
    const cov = optNum(pathAt(row, 'coverage_pct'))
    if (cov !== null) d.coveragePct = cov
    if (!d.fetchedAt) d.fetchedAt = String(pathAt(row, 'fetched_at') ?? '')
  }

  const days = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
  const value: ClarityHistory = {
    dayCount: days.length,
    firstDay: days[0]?.day ?? null,
    lastDay: days[days.length - 1]?.day ?? null,
    days,
  }
  cache = { at: Date.now(), value }
  return value
}

/**
 * Below this many sampled sessions an incidence rate is noise, not signal: on 6
 * sampled desktop sessions one affected session reads as 14.29% and looks like a
 * crisis beside the 4.6% site figure, when it is a single visitor. Devices under
 * the threshold keep their session count and are marked unreliable so neither the
 * UI nor the model quotes their rates.
 */
export const MIN_RELIABLE_SESSIONS = 30

/** Per-device behaviour for one landing page over the requested range. */
export interface ClarityDeviceSummary {
  device: ClarityDevice
  /** Sampled sessions — the denominator for every rate below, NOT real traffic. */
  sampledSessions: number
  scrollDepth: number | null
  engagementTime: number | null
  /**
   * Incidence in % of sampled sessions — the SAME unit the site-level benchmark
   * uses, so the two may be compared directly. Deriving "events per 100
   * sessions" from raw counts instead yields a different quantity, and comparing
   * that against the site percentage manufactures findings that are not there.
   */
  deadClicksPct: number | null
  rageClicksPct: number | null
  quickbacksPct: number | null
  scriptErrorsPct: number | null
  /** False when sampledSessions < MIN_RELIABLE_SESSIONS — do not quote the rates. */
  reliable: boolean
}

export interface ClarityLandingSummary {
  path: string
  hosts: string[]
  devices: ClarityDeviceSummary[]
  totalSampledSessions: number
  /** Sessions-weighted scroll depth across devices. */
  overallScrollDepth: number | null
  daysCovered: number
  dateRange: { from: string; to: string }
  coveragePct: number | null
  /** True when no snapshot in range holds this path — the card must say "no data". */
  empty: boolean
  heatmapUrl: string
  recordingsUrl: string
  /** Clarity keeps recordings ~30 days; older ranges have numbers but no replay. */
  replayLikelyExpired: boolean
}

export interface ClaritySiteSummary {
  devices: Array<{ device: ClarityDevice; sessions: number } & Omit<ClaritySiteStats, 'sessions'>>
  totalSessions: number
  daysCovered: number
  dateRange: { from: string; to: string }
  empty: boolean
}

export async function clarityDataWindow(): Promise<{
  firstDay: string | null
  lastDay: string | null
  dayCount: number
}> {
  const h = await loadHistory()
  return { firstDay: h.firstDay, lastDay: h.lastDay, dayCount: h.dayCount }
}

/**
 * Clarity deep links carry the filter in the URL, so these open pre-filtered to
 * one page. This is how the dashboard covers heatmaps and recordings without an
 * API for them.
 */
export function clarityHeatmapUrl(pagePath: string, host = 'goolets.net'): string {
  const url = `https://${host}${pagePath}`
  return `https://clarity.microsoft.com/projects/view/${CLARITY_PROJECT_ID}/heatmaps?url=${encodeURIComponent(url)}`
}

export function clarityRecordingsUrl(pagePath: string, host = 'goolets.net'): string {
  const url = `https://${host}${pagePath}`
  return `https://clarity.microsoft.com/projects/view/${CLARITY_PROJECT_ID}/impressions?url=${encodeURIComponent(url)}`
}

/** GA4 paths carry no trailing slash, Clarity's do. Normalize before comparing. */
function normalizePath(p: string): string {
  if (!p) return '/'
  let out = p.split('?')[0].split('#')[0]
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out.startsWith('/') ? out : `/${out}`
}

function toDayKey(value: string): string {
  // Accept both "2026-08-01" and a full ISO timestamp.
  return value.length > 10 ? value.slice(0, 10) : value
}

function daysInRange(history: ClarityHistory, fromISO: string, toISO: string): ClarityDay[] {
  const from = toDayKey(fromISO)
  const to = toDayKey(toISO)
  return history.days.filter((d) => d.day >= from && d.day <= to)
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits))
}

/**
 * Weighted mean over non-null, positive values. Averages cannot be summed, and a
 * day with 400 sessions must not count the same as one with 4.
 *
 * Positive-only is right for scroll depth and engagement time, where a reported 0
 * means "not measured". Use weightedMeanKeepZero for incidence, where 0 means the
 * behaviour genuinely did not occur and dropping it would bias the rate upward.
 */
function weightedMean(pairs: Array<[number | null, number]>): number | null {
  const valid = pairs.filter((p): p is [number, number] => p[0] !== null && p[0] > 0)
  if (!valid.length) return null
  const weight = valid.reduce((s, [, w]) => s + w, 0)
  if (weight === 0) {
    return round(valid.reduce((s, [v]) => s + v, 0) / valid.length)
  }
  return round(valid.reduce((s, [v, w]) => s + v * w, 0) / weight)
}

/**
 * Same weighting as weightedMean but a genuine 0 counts. Required for incidence:
 * a page where nobody rage-clicked reports 0%, and discarding those rows would
 * average only the bad days and overstate the problem.
 */
function weightedMeanKeepZero(pairs: Array<[number | null, number]>): number | null {
  const valid = pairs.filter((p): p is [number, number] => p[0] !== null)
  if (!valid.length) return null
  const weight = valid.reduce((s, [, w]) => s + w, 0)
  if (weight === 0) {
    return round(valid.reduce((s, [v]) => s + v, 0) / valid.length)
  }
  return round(valid.reduce((s, [v, w]) => s + v * w, 0) / weight)
}

const DEVICES: ClarityDevice[] = ['Mobile', 'PC', 'Tablet']

/** Recordings/heatmaps age out of Clarity after roughly 30 days. */
function isReplayLikelyExpired(toISO: string): boolean {
  const to = new Date(toDayKey(toISO)).getTime()
  if (Number.isNaN(to)) return false
  const ageDays = (Date.now() - to) / 86_400_000
  return ageDays > 30
}

export async function getClarityForLanding(
  pagePath: string,
  fromISO: string,
  toISO: string
): Promise<ClarityLandingSummary> {
  const wanted = normalizePath(pagePath)
  const days = daysInRange(await loadHistory(), fromISO, toISO)

  const perDevice = new Map<
    ClarityDevice,
    {
      sessions: number
      scroll: Array<[number | null, number]>
      engagement: Array<[number | null, number]>
      // Incidence percentages, weighted by the sessions of the day they came from.
      dead: Array<[number | null, number]>
      rage: Array<[number | null, number]>
      quickbacks: Array<[number | null, number]>
      scriptErrors: Array<[number | null, number]>
    }
  >()
  const hosts = new Set<string>()
  const coverages: number[] = []
  let daysWithData = 0

  for (const day of days) {
    let dayHadData = false

    for (const [key, byDevice] of Object.entries(day.perPath)) {
      const [host, rawPath] = key.split('|')
      if (normalizePath(rawPath) !== wanted) continue
      hosts.add(host)

      for (const device of DEVICES) {
        const stats = byDevice[device]
        if (!stats || stats.sessions <= 0) continue
        dayHadData = true

        if (!perDevice.has(device)) {
          perDevice.set(device, {
            sessions: 0,
            scroll: [],
            engagement: [],
            dead: [],
            rage: [],
            quickbacks: [],
            scriptErrors: [],
          })
        }
        const acc = perDevice.get(device)!
        acc.sessions += stats.sessions
        acc.scroll.push([stats.scrollDepth, stats.sessions])
        acc.engagement.push([stats.engagementTime, stats.sessions])
        acc.dead.push([stats.deadClicksPct, stats.sessions])
        acc.rage.push([stats.rageClicksPct, stats.sessions])
        acc.quickbacks.push([stats.quickbacksPct, stats.sessions])
        acc.scriptErrors.push([stats.scriptErrorsPct, stats.sessions])
      }
    }

    if (dayHadData) {
      daysWithData++
      if (typeof day.coveragePct === 'number') coverages.push(day.coveragePct)
    }
  }

  const devices: ClarityDeviceSummary[] = DEVICES.filter((d) => perDevice.has(d)).map((device) => {
    const acc = perDevice.get(device)!
    const reliable = acc.sessions >= MIN_RELIABLE_SESSIONS
    return {
      device,
      sampledSessions: acc.sessions,
      // Averages hold up better on a thin sample than incidence does, so scroll
      // and engagement survive the threshold; the event rates are withheld.
      scrollDepth: weightedMean(acc.scroll),
      engagementTime: weightedMean(acc.engagement),
      deadClicksPct: reliable ? weightedMeanKeepZero(acc.dead) : null,
      rageClicksPct: reliable ? weightedMeanKeepZero(acc.rage) : null,
      quickbacksPct: reliable ? weightedMeanKeepZero(acc.quickbacks) : null,
      scriptErrorsPct: reliable ? weightedMeanKeepZero(acc.scriptErrors) : null,
      reliable,
    }
  })

  const totalSampledSessions = devices.reduce((s, d) => s + d.sampledSessions, 0)

  return {
    path: wanted,
    hosts: Array.from(hosts).sort(),
    devices,
    totalSampledSessions,
    overallScrollDepth: weightedMean(devices.map((d) => [d.scrollDepth, d.sampledSessions])),
    daysCovered: daysWithData,
    dateRange: { from: toDayKey(fromISO), to: toDayKey(toISO) },
    coveragePct: coverages.length
      ? round(coverages.reduce((a, b) => a + b, 0) / coverages.length, 1)
      : null,
    empty: devices.length === 0,
    heatmapUrl: clarityHeatmapUrl(wanted),
    recordingsUrl: clarityRecordingsUrl(wanted),
    replayLikelyExpired: isReplayLikelyExpired(toISO),
  }
}

/**
 * Site-wide behaviour. Unlike the per-path view this comes from the Device-only
 * export call, which is NOT row-capped — these figures are complete, so they
 * double as the benchmark a single landing gets compared against.
 */
export async function getClaritySiteLevel(
  fromISO: string,
  toISO: string
): Promise<ClaritySiteSummary> {
  const days = daysInRange(await loadHistory(), fromISO, toISO)

  const acc = new Map<
    ClarityDevice,
    {
      sessions: number
      scroll: Array<[number | null, number]>
      engagement: Array<[number | null, number]>
      dead: Array<[number | null, number]>
      rage: Array<[number | null, number]>
      quickbacks: Array<[number | null, number]>
      scriptErrors: Array<[number | null, number]>
    }
  >()

  for (const day of days) {
    for (const device of DEVICES) {
      const s = day.site[device]
      if (!s || s.sessions <= 0) continue
      if (!acc.has(device)) {
        acc.set(device, {
          sessions: 0,
          scroll: [],
          engagement: [],
          dead: [],
          rage: [],
          quickbacks: [],
          scriptErrors: [],
        })
      }
      const a = acc.get(device)!
      a.sessions += s.sessions
      a.scroll.push([s.scrollDepth, s.sessions])
      a.engagement.push([s.engagementTime, s.sessions])
      a.dead.push([s.deadClicksPct, s.sessions])
      a.rage.push([s.rageClicksPct, s.sessions])
      a.quickbacks.push([s.quickbacksPct, s.sessions])
      a.scriptErrors.push([s.scriptErrorsPct, s.sessions])
    }
  }

  const devices = DEVICES.filter((d) => acc.has(d)).map((device) => {
    const a = acc.get(device)!
    return {
      device,
      sessions: a.sessions,
      scrollDepth: weightedMean(a.scroll),
      engagementTime: weightedMean(a.engagement),
      deadClicksPct: weightedMeanKeepZero(a.dead),
      rageClicksPct: weightedMeanKeepZero(a.rage),
      quickbacksPct: weightedMeanKeepZero(a.quickbacks),
      scriptErrorsPct: weightedMeanKeepZero(a.scriptErrors),
    }
  })

  return {
    devices,
    totalSessions: devices.reduce((s, d) => s + d.sessions, 0),
    daysCovered: days.length,
    dateRange: { from: toDayKey(fromISO), to: toDayKey(toISO) },
    empty: devices.length === 0,
  }
}
