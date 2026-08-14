/**
 * Microsoft Clarity behaviour data for the GA4 Landing Pages dashboard.
 *
 * WHERE THE DATA COMES FROM
 * -------------------------
 * Not from the Clarity API at request time — that API allows 10 calls per project
 * per day and only serves the last 3 days, so a live call would burn the budget
 * in one page load. Instead the brain snapshots Clarity daily
 * (`code/clarity/fetch-clarity-snapshot.js`) and rolls the history into
 * `src/data/clarity-rollup.json` (`code/clarity/build-clarity-rollup.js`).
 * This module only reads that file.
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

import rollupJson from '@/data/clarity-rollup.json'

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

interface ClarityRollup {
  generatedAt: string
  projectId: string
  timezone: string
  dayCount: number
  firstDay: string | null
  lastDay: string | null
  avgCoveragePct: number | null
  days: ClarityDay[]
}

const rollup = rollupJson as unknown as ClarityRollup

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

export function clarityDataWindow(): { firstDay: string | null; lastDay: string | null; dayCount: number } {
  return { firstDay: rollup.firstDay, lastDay: rollup.lastDay, dayCount: rollup.dayCount }
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

function daysInRange(fromISO: string, toISO: string): ClarityDay[] {
  const from = toDayKey(fromISO)
  const to = toDayKey(toISO)
  return rollup.days.filter((d) => d.day >= from && d.day <= to)
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

export function getClarityForLanding(
  pagePath: string,
  fromISO: string,
  toISO: string
): ClarityLandingSummary {
  const wanted = normalizePath(pagePath)
  const days = daysInRange(fromISO, toISO)

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
export function getClaritySiteLevel(fromISO: string, toISO: string): ClaritySiteSummary {
  const days = daysInRange(fromISO, toISO)

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
