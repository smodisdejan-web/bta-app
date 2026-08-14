/**
 * AI TRAFFIC — promet in leadi iz AI asistentov (ChatGPT, Gemini, Claude, Perplexity, Copilot).
 *
 * Zakaj svoj modul in ne razširitev business-funnel.ts:
 *   AI nima impressions, clicks ne spenda. Vsiljevanje v 6-koračni funnel bi zahtevalo
 *   lažne ničle. Zato ločen 4-koračni funnel z lastnimi viri.
 *
 * VIRA (oba že v sheetu, brez novega vodovoda):
 *   - `ga4_landing_pages`  → seje (stolpec `sessionSourceMedium`)
 *   - `hubspot-ai-latest.json` → leadi + lifecycle, iz namenskega sync-a
 *                            (`code/hubspot/sync-goolets-ai-contacts.js`)
 *
 * ⚠️ ZAKAJ NE `hubspot_contacts` TAB: filtriran je na MULTISTEP forme in ga poleg tega
 * odreže HubSpotov 10.000-zapisni strop. Izmerjeno 14. 8. 2026: tab pokaže 10 AI leadov,
 * resnica je 39. Zato ima AI korak svoj vir, ki dela po datumskih rezinah.
 *
 * ZAKAJ NE STREAK: `streak_sync` je pri viru PAID-ONLY (StreakSync.gs filtrira ne-paid
 * kategorije — vidna sta samo PAID_SOCIAL in PAID_SEARCH). AI leadov tam ni in ne bo.
 *
 * ⚠️ OBSEG SE MED VIROMA RAZLIKUJE — glej `scopeMismatch` v odgovoru:
 *   seje = SAMO goolets.net (GA4 sync teče na property 311674241)
 *   leadi = goolets.net + croatialuxurygulet + turkey (HubSpot portal 143360943 pokriva vse tri)
 *   Zato je sessions→leads razmerje IZRAČUNANO, a označeno kot neprimerljivo. Ne prikazuj
 *   ga kot navadno konverzijo.
 */

import { SHEETS_TABS } from '@/lib/config'
import { getSheetsUrl } from '@/lib/config'
import { toDay } from '@/lib/business-funnel'
import aeoLatest from '@/data/aeo-latest.json'
import hubspotAi from '@/data/hubspot-ai-latest.json'

const DEFAULT_WEB_APP_URL =
  process.env.NEXT_PUBLIC_SHEETS_URL || process.env.NEXT_PUBLIC_SHEET_API_URL || ''
const SHEET_URL = () => getSheetsUrl() || DEFAULT_WEB_APP_URL

// ─────────────────────────────────────────────────────────────────────────────
// AI detekcija
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kanonski vzorec AI asistentov. Mora ostati sinhroniziran z
 * `code/goolets/ai-traffic-report.js` v brainu.
 *
 * NAMERNO IZPUŠČENO: openai.com / anthropic.com (korporativni strani, ne citat),
 * google.com / bing.com (zajela bi navaden organic).
 */
const AI_HOSTS =
  /^(chatgpt\.com|chat\.openai\.com|claude\.ai|perplexity\.ai|www\.perplexity\.ai|perplexity|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|copilot\.com|deepseek\.com|grok\.com|x\.ai|meta\.ai|you\.com|poe\.com|kagi\.com|phind\.com|mistral\.ai|openai)$/i

/** GA4 nativni medium (Google ga je uvedel 13. 5. 2026). Zajame ~92 % AI prometa sam. */
const AI_MEDIUM = /^ai-assistant$/i

export function isAiSource(source?: string | null, medium?: string | null): boolean {
  const s = String(source ?? '').trim()
  const m = String(medium ?? '').trim()
  return AI_HOSTS.test(s) || AI_MEDIUM.test(m)
}

/** `sessionSourceMedium` prihaja kot "chatgpt.com / referral". */
export function isAiSourceMedium(sourceMedium?: string | null): boolean {
  const raw = String(sourceMedium ?? '')
  const [source, medium] = raw.split('/').map((x) => x.trim())
  return isAiSource(source, medium)
}

export type Vendor =
  | 'ChatGPT' | 'Gemini' | 'Claude' | 'Perplexity' | 'Copilot'
  | 'Grok' | 'DeepSeek' | 'Meta AI' | 'Kagi' | 'Drugo'

export function vendorOf(raw?: string | null): Vendor {
  const s = String(raw ?? '').toLowerCase()
  if (/chatgpt|openai/.test(s)) return 'ChatGPT'
  if (/perplexity/.test(s)) return 'Perplexity'
  if (/gemini|bard/.test(s)) return 'Gemini'
  if (/claude|anthropic/.test(s)) return 'Claude'
  if (/copilot/.test(s)) return 'Copilot'
  if (/grok|x\.ai/.test(s)) return 'Grok'
  if (/deepseek/.test(s)) return 'DeepSeek'
  if (/meta\.ai/.test(s)) return 'Meta AI'
  if (/kagi/.test(s)) return 'Kagi'
  return 'Drugo'
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle — KUMULATIVNO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HubSpot `lifecyclestage` pove NAJDLJE DOSEŽENO fazo, ne trenutne pozicije v procesu.
 * Surovo štetje (13 lead · 3 SQL · 9 opportunity) narisano zaporedno da 25 → 3 → 9, kar
 * izgleda kot rastoč funnel. Zato vsak korak šteje "ta faza ALI DLJE".
 */
const STAGE_RANK: Record<string, number> = {
  subscriber: 1,
  lead: 2,
  marketingqualifiedlead: 3,
  salesqualifiedlead: 4,
  opportunity: 5,
  customer: 6,
}

function rankOf(stage?: string | null): number {
  return STAGE_RANK[String(stage ?? '').trim().toLowerCase()] ?? 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch + cache (lokalna kopija — business-funnel.ts se namerno ne dotikamo)
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS = 15 * 60 * 1000
const memo = new Map<string, { at: number; data: any }>()
const inflight = new Map<string, Promise<any>>()

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const p = fn()
    .then((data) => {
      memo.set(key, { at: Date.now(), data })
      inflight.delete(key)
      return data
    })
    .catch((e) => {
      inflight.delete(key)
      if (hit) {
        console.warn(`[ai-traffic] ${key} failed, serving stale`, (e as Error).message)
        return hit.data as T
      }
      throw e
    })
  inflight.set(key, p)
  return p
}

async function fetchRows(tab: string): Promise<any[]> {
  const url = `${SHEET_URL()}?tab=${encodeURIComponent(tab)}`
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store', next: { revalidate: 0 } })
      if (!res.ok) {
        lastErr = new Error(`${tab}: ${res.status} ${res.statusText}`)
      } else {
        const data = await res.json()
        if (!Array.isArray(data) || data.length === 0) return []
        if (Array.isArray(data[0])) {
          const header = (data[0] as any[]).map((h) => String(h))
          return (data as any[][]).slice(1).map((r) => {
            const o: Record<string, any> = {}
            header.forEach((h, i) => (o[h] = r[i]))
            return o
          })
        }
        return data as any[]
      }
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch ${tab}`)
}

const num = (v: any): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const x = Number(String(v ?? '').replace(/[^\d.\-]/g, ''))
  return Number.isFinite(x) ? x : 0
}

/** ISO teden (npr. "2026-W33") — za tedenski trend. */
function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(+d)) return ''
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaderji
// ─────────────────────────────────────────────────────────────────────────────

interface SessionRow { day: string; lp: string; vendor: Vendor; sessions: number }

/** GA4 seje iz AI virov. SAMO goolets.net — sync teče na property 311674241. */
async function loadAiSessions(): Promise<SessionRow[]> {
  return cached('ai-ga4', async () => {
    const raw = await fetchRows(SHEETS_TABS.GA4_LANDING_PAGES)
    const agg = new Map<string, number>()
    for (const r of raw) {
      const sm = String(r.sessionSourceMedium ?? '')
      if (!isAiSourceMedium(sm)) continue
      const day = toDay(r.date)
      if (!day) continue
      const lp = String(r.landingPage ?? '(not set)')
      const vendor = vendorOf(sm.split('/')[0])
      // fiksna širina: 10-znakovni dan, nato vendor, nato '|' in pot
      const k = `${day}${vendor}|${lp}`
      agg.set(k, (agg.get(k) || 0) + num(r.sessions))
    }
    const rows: SessionRow[] = []
    for (const [k, sessions] of agg) {
      const sep = k.indexOf('|')
      rows.push({
        day: k.slice(0, 10),
        vendor: k.slice(10, sep) as Vendor,
        lp: k.slice(sep + 1),
        sessions,
      })
    }
    return rows
  })
}

interface AiContact {
  day: string
  stage: string | null
  rank: number
  country: string | null
  vendor: string
  conversion: string | null
}

interface SourceStat {
  source: string
  contacts: number
  sqlPlus: number
  opportunityPlus: number
  oppRate: number
  isAi: boolean
}

const AI_CONTACTS = (hubspotAi as any).aiContacts as AiContact[]
const BY_SOURCE = (hubspotAi as any).bySource as SourceStat[]
const HS_META = (hubspotAi as any)._meta as {
  generatedAt: string
  window: { start: string; end: string; days: number }
  totalContacts: number
  truncatedChunks: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Javni tip odgovora
// ─────────────────────────────────────────────────────────────────────────────

export interface AiStep {
  key: 'sessions' | 'leads' | 'sql' | 'opportunity' | 'bookings'
  label: string
  value: number | null
  /** value ÷ prejšnji korak. null, kadar razmerje ni smiselno. */
  cvrFromPrev: number | null
  source: string
  /** false = vir tega ne zna odgovoriti; UI naj pokaže "—" + badge, NE 0. */
  available: boolean
  note?: string
}

export interface AiTrafficResponse {
  meta: {
    start: string
    end: string
    generatedAt: string
    sessionScope: string
    contactScope: string
  }
  steps: AiStep[]
  /** Zakaj sessions→leads ni navadna konverzija. */
  scopeMismatch: { affects: string; reason: string }
  vendors: { vendor: Vendor; sessions: number; share: number }[]
  weekly: { week: string; sessions: number }[]
  landingPages: { lp: string; sessions: number }[]
  /** Opportunity rate po viru — AI proti ostalim kanalom računa.
   *  POZOR: velja za sync okno, NE za izbrani datumski razpon (glej benchmarkWindow). */
  benchmark: { source: string; contacts: number; opportunity: number; oppRate: number; isAi: boolean }[]
  benchmarkWindow: { start: string; end: string; totalContacts: number; generatedAt: string; truncated: string[] }
  countries: { country: string; contacts: number }[]
  /** Mesečni AEO snapshot — ROČEN, drug tempo osveževanja kot zgornje. */
  aeo: typeof aeoLatest
  blindSpots: string[]
}

const BLIND_SPOTS = [
  'AI Overviews and Google AI Mode are counted as Organic Search — the largest AI touchpoint is unmeasurable.',
  'The ChatGPT app often sends no referrer, so that traffic lands in Direct (industry estimates: 20–40%).',
  'Consent Mode v2 is not implemented — without consent nothing fires, and there are no modelled conversions.',
  'Zero-click answers (the assistant gives price and contact outright) can never be measured.',
]

// ─────────────────────────────────────────────────────────────────────────────
// Glavna funkcija
// ─────────────────────────────────────────────────────────────────────────────

export async function loadAiTraffic(opts: { start: string; end: string }): Promise<AiTrafficResponse> {
  const { start, end } = opts
  const sessionRows = await loadAiSessions()

  const inRange = (d: string) => d >= start && d <= end
  const sess = sessionRows.filter((r) => inRange(r.day))
  const aiContacts = AI_CONTACTS.filter((c) => inRange(c.day))

  const totalSessions = sess.reduce((s, r) => s + r.sessions, 0)
  const leads = aiContacts.length
  const sql = aiContacts.filter((c) => c.rank >= STAGE_RANK.salesqualifiedlead).length
  const opp = aiContacts.filter((c) => c.rank >= STAGE_RANK.opportunity).length

  const div = (a: number, b: number): number | null => (b === 0 ? null : a / b)

  const steps: AiStep[] = [
    {
      key: 'sessions',
      label: 'AI Sessions',
      value: totalSessions,
      cvrFromPrev: null,
      source: 'GA4 · goolets.net',
      available: true,
    },
    {
      key: 'leads',
      label: 'Leads',
      value: leads,
      cvrFromPrev: div(leads, totalSessions),
      source: 'HubSpot',
      available: true,
      note: 'Scope differs from sessions — see the warning below.',
    },
    {
      key: 'sql',
      label: 'Sales Qualified +',
      value: sql,
      cvrFromPrev: div(sql, leads),
      source: 'HubSpot · cumulative',
      available: true,
      note: 'SQL or beyond (includes opportunity and customer).',
    },
    {
      key: 'opportunity',
      label: 'Opportunity +',
      value: opp,
      cvrFromPrev: div(opp, leads),
      source: 'HubSpot · cumulative',
      available: true,
      note: 'Rate is off leads, not off SQL — both steps are cumulative.',
    },
    {
      key: 'bookings',
      label: 'Bookings',
      value: null,
      cvrFromPrev: null,
      source: '—',
      available: false,
      note: 'bookings_api is paid-only at source. Source in progress — not zero.',
    },
  ]

  const vendorAgg = new Map<Vendor, number>()
  for (const r of sess) vendorAgg.set(r.vendor, (vendorAgg.get(r.vendor) || 0) + r.sessions)
  const vendors = [...vendorAgg.entries()]
    .map(([vendor, sessions]) => ({
      vendor,
      sessions,
      share: totalSessions ? sessions / totalSessions : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions)

  const weekAgg = new Map<string, number>()
  for (const r of sess) {
    const w = isoWeek(r.day)
    if (w) weekAgg.set(w, (weekAgg.get(w) || 0) + r.sessions)
  }
  const weekly = [...weekAgg.entries()]
    .map(([week, sessions]) => ({ week, sessions }))
    .sort((a, b) => a.week.localeCompare(b.week))

  const lpAgg = new Map<string, number>()
  for (const r of sess) lpAgg.set(r.lp, (lpAgg.get(r.lp) || 0) + r.sessions)
  const landingPages = [...lpAgg.entries()]
    .map(([lp, sessions]) => ({ lp, sessions }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 15)

  // Benchmark pride iz sync-a in velja za NJEGOVO okno, ne za izbrani razpon.
  // Preračun na izbrani razpon bi zahteval vse kontakte, ne le AI — teh v appu nimamo.
  const benchmark = BY_SOURCE
    .filter((r) => r.contacts >= 5)
    .map((r) => ({
      source: r.source,
      contacts: r.contacts,
      opportunity: r.opportunityPlus,
      oppRate: r.oppRate,
      isAi: r.isAi,
    }))
    .sort((a, b) => b.oppRate - a.oppRate)

  // HubSpot country je prosto polje — isti trg pride kot "USA", "United States",
  // "United States of America". Brez tega se največji trg razbije na tri vrstice.
  const normCountry = (raw?: string | null): string => {
    const v = String(raw ?? '').trim()
    if (!v || /^(n\/a|na|unknown|-)$/i.test(v)) return '(unknown)'
    if (/^(usa|us|u\.s\.a?\.?|united states( of america)?)$/i.test(v)) return 'United States'
    if (/^(uk|u\.k\.|great britain|united kingdom)$/i.test(v)) return 'United Kingdom'
    if (/^(uae|united arab emirates)$/i.test(v)) return 'United Arab Emirates'
    if (/^(the )?netherlands$/i.test(v)) return 'Netherlands'
    if (/^(espa(ñ|n)a|spain)$/i.test(v)) return 'Spain'
    if (/^(deutschland|germany)$/i.test(v)) return 'Germany'
    return v
  }
  const countryAgg = new Map<string, number>()
  for (const c of aiContacts) {
    const k = normCountry(c.country)
    countryAgg.set(k, (countryAgg.get(k) || 0) + 1)
  }
  const countries = [...countryAgg.entries()]
    .map(([country, contacts]) => ({ country, contacts }))
    .sort((a, b) => b.contacts - a.contacts)
    .slice(0, 10)

  return {
    meta: {
      start,
      end,
      generatedAt: new Date().toISOString(),
      sessionScope: 'goolets.net (GA4 property 311674241)',
      contactScope: 'goolets.net + croatialuxurygulet.com + turkeyluxurygulet.com (HubSpot 143360943)',
    },
    steps,
    scopeMismatch: {
      affects: 'sessions \u2192 leads',
      reason:
        'Sessions cover goolets.net only, while leads cover all three domains (the HubSpot portal ' +
        'is shared). The rate is therefore an upper bound and is NOT comparable to other channels. ' +
        'The step counts themselves are correct.',
    },
    vendors,
    weekly,
    landingPages,
    benchmark,
    benchmarkWindow: {
      start: HS_META.window.start,
      end: HS_META.window.end,
      totalContacts: HS_META.totalContacts,
      generatedAt: HS_META.generatedAt,
      truncated: HS_META.truncatedChunks || [],
    },
    countries,
    aeo: aeoLatest,
    blindSpots: BLIND_SPOTS,
  }
}
