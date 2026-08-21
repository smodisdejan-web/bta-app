/**
 * AI TRAFFIC — promet in leadi iz AI asistentov (ChatGPT, Gemini, Claude, Perplexity, Copilot).
 *
 * Zakaj svoj modul in ne razširitev business-funnel.ts:
 *   AI nima impressions, clicks ne spenda. Vsiljevanje v 6-koračni funnel bi zahtevalo
 *   lažne ničle. Zato ločen 4-koračni funnel z lastnimi viri.
 *
 * VIRI (vsi v sheetu):
 *   - `ga4_ai_sessions`   → AI seje po `hostName` (`code/ga4/sync-goolets-ai-sessions.js`)
 *   - `ga4_host_sessions` → vse seje po hostu = imenovalec za "delež AI prometa te strani"
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
 * OBSEG (popravljen 21. 8. 2026): seje IN leadi pokrivajo VSE Goolets domene — goolets.net,
 * croatialuxurygulet.com, turkeyluxurygulet.com, guletexpert.com in ladijske mikrostrani.
 * Prej so seje pokrivale samo goolets.net, zato je bilo razmerje sessions→leads označeno kot
 * neprimerljivo (`scopeMismatch`); polje ostaja za primer, da se obsega spet razideta.
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

/** Ponedeljek ISO tedna, v katerem leži `day`. */
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(+d)) return day
  const dow = d.getUTCDay() || 7 // nedelja = 7, ne 0
  d.setUTCDate(d.getUTCDate() - (dow - 1))
  return d.toISOString().slice(0, 10)
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "18–24 Aug" oziroma "28 Jul – 3 Aug", kadar teden prelomi mesec. */
function weekLabel(start: string, end: string): string {
  const [, sm, sd] = start.split('-')
  const [, em, ed] = end.split('-')
  const d = (x: string) => String(Number(x))
  const m = (x: string) => MONTHS[Number(x) - 1]
  return sm === em ? `${d(sd)}–${d(ed)} ${m(em)}` : `${d(sd)} ${m(sm)} – ${d(ed)} ${m(em)}`
}

/** "www.X" in "X" sta ista stran — GA4 ju poroča ločeno, HubSpot pa tudi. */
function normHost(raw?: string | null): string {
  return String(raw ?? '').trim().toLowerCase().replace(/^www\./, '') || '(not set)'
}

/** Host brez "www." iz polne prve-obiskane strani. */
function domainOf(url?: string | null): string | null {
  const raw = String(url ?? '').trim()
  if (!raw) return null
  const host = raw.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0]
  return host ? normHost(host) : null
}

const HUBSPOT_PORTAL = '143360943'

/** EU portal — Goolets HubSpot živi na app-eu1, ne na app.hubspot.com. */
const HUBSPOT_RECORD_URL = (id: string) =>
  `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL}/record/0-1/${id}`

// ─────────────────────────────────────────────────────────────────────────────
// Loaderji
// ─────────────────────────────────────────────────────────────────────────────

interface SessionRow {
  day: string
  /** Domena brez "www." — goolets.net, croatialuxurygulet.com, guletexpert.com … */
  host: string
  lp: string
  vendor: Vendor
  sessions: number
  keyEvents: number
}

/**
 * GA4 AI seje, razrezane po `hostName`.
 *
 * ⚠️ ENA PROPERTY (311674241), NE TRI. Vse Goolets domene — goolets.net, obe satelitski
 * strani in ~20 ladijskih mikrostrani — merijo v isto property prek enega GTM containerja;
 * ločuje jih `hostName`. Propertyja 435237078 (CLG) in 311670855 (Turkey) sta legacy dvojni
 * tagging: seštevanje vseh treh je 21. 8. 2026 dopoldne dalo 1.859 namesto 1.608, ker sta se
 * CLG in Turkey šteli dvakrat.
 *
 * Bere namenski tab `ga4_ai_sessions`, ne `ga4_landing_pages`: tam je `landingPage` samo pot
 * brez hosta, tab pa berejo business-funnel (lpViews), /ga4-landing-pages, lp-attribution in
 * /api/turkey-kpis, ki po hostu ne filtrirajo. ~2.000 vrstic namesto 27 MB.
 */
async function loadAiSessions(): Promise<SessionRow[]> {
  return cached('ai-ga4', async () => {
    const raw = await fetchRows(SHEETS_TABS.GA4_AI_SESSIONS)
    const agg = new Map<string, { sessions: number; keyEvents: number }>()
    for (const r of raw) {
      // Tab je že filtriran pri viru; to je obramba, če bi kdo v sheet nalil kaj drugega.
      const source = String(r.sessionSource ?? '')
      const medium = String(r.sessionMedium ?? '')
      if (!isAiSource(source, medium)) continue
      const day = toDay(r.date)
      if (!day) continue
      const host = normHost(r.host)
      const lp = String(r.landingPage ?? '(not set)')
      const vendor = vendorOf(source)
      const k = JSON.stringify([day, vendor, host, lp])
      const cur = agg.get(k) || { sessions: 0, keyEvents: 0 }
      cur.sessions += num(r.sessions)
      cur.keyEvents += num(r.keyEvents)
      agg.set(k, cur)
    }
    const rows: SessionRow[] = []
    for (const [k, v] of agg) {
      const [day, vendor, host, lp] = JSON.parse(k) as string[]
      rows.push({ day, vendor: vendor as Vendor, host, lp, sessions: v.sessions, keyEvents: v.keyEvents })
    }
    return rows
  })
}

/** VSE seje po host × dan — imenovalec za "kolikšen delež prometa te strani je AI". */
async function loadHostSessions(): Promise<{ day: string; host: string; sessions: number }[]> {
  return cached('ai-hosts', async () => {
    const raw = await fetchRows(SHEETS_TABS.GA4_HOST_SESSIONS)
    const agg = new Map<string, number>()
    for (const r of raw) {
      const day = toDay(r.date)
      if (!day) continue
      const k = JSON.stringify([day, normHost(r.host)])
      agg.set(k, (agg.get(k) || 0) + num(r.sessions))
    }
    return [...agg.entries()].map(([k, sessions]) => {
      const [day, host] = JSON.parse(k) as string[]
      return { day, host, sessions }
    })
  })
}

interface AiContact {
  day: string
  stage: string | null
  rank: number
  country: string | null
  vendor: string
  conversion: string | null
  budgetRange: string | null
  id: string | null
  email: string | null
  name: string | null
  /** Prva stran seje — edino polje, ki pove, s KATERE domene je lead prišel. */
  firstUrl: string | null
}

interface SourceStat {
  source: string
  contacts: number
  sqlPlus: number
  opportunityPlus: number
  oppRate: number
  sqlRate: number
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
  /** Vsebina "i" balončka: kaj točno se šteje v ta korak. */
  info?: { title: string; lines: string[] }
}

/**
 * Streakovi stagi, ki v Goolets pipelineu veljajo za kvalificirane — `handoff.md §3.2`.
 * Tu so SAMO za orientacijo v balončku: koraki funnela se štejejo iz HubSpota, ne iz
 * Streaka, in mapiranje ni 1:1. ⚠️ Streakov `Stage` NI linearna lestvica: MQL, CQL in
 * AI Robot Handled so tam NEkvalificirani, Standard pa kvalificiran.
 */
const STREAK_QUALIFIED =
  'Standard, SQL, SQL Prime, VIP, Ultra VIP, Paper Work, Start Finalisation, Won'
const STREAK_CLOSING = 'Paper Work, Start Finalisation, Won'

export interface AiTrafficResponse {
  meta: {
    start: string
    end: string
    generatedAt: string
    sessionScope: string
    contactScope: string
  }
  steps: AiStep[]
  /** Opozorilo, kadar se obseg korakov ne ujema. null = obsegi so poravnani. */
  scopeMismatch: { affects: string; reason: string } | null
  vendors: { vendor: Vendor; sessions: number; share: number }[]
  /**
   * Ena vrstica na spletno stran: koliko AI prometa dobi, kolikšen delež njenega
   * celotnega prometa to je, in koliko leadov iz tega nastane.
   */
  sites: {
    host: string
    aiSessions: number
    /** delež vseh AI sej */
    share: number
    /** vse seje te strani v izbranem oknu */
    totalSessions: number
    /** aiSessions / totalSessions — kako AI-odvisna je stran */
    aiShareOfSite: number | null
    keyEvents: number
    leads: number
    /** leads / aiSessions. null, kadar strani ni v GA4. */
    leadRate: number | null
    sqlPlus: number
  }[]
  /** `label` je človeški datumski razpon tedna — "2026-W22" sam po sebi nikomur nič ne pove. */
  weekly: { week: string; label: string; start: string; end: string; sessions: number }[]
  /** Vsak AI lead posebej — ista logika kot tabela na /vessel-funnel. */
  leads: {
    day: string
    name: string | null
    email: string | null
    country: string | null
    vendor: string
    stage: string | null
    budgetRange: string | null
    conversion: string | null
    /** Domena prve seje (npr. croatialuxurygulet.com), izluščena iz `firstUrl`. */
    domain: string | null
    /** Globok link v HubSpot zapis, da je vrstica preverljiva pri viru. */
    hubspotUrl: string | null
  }[]
  /** `lp` je samo pot, zato brez `host` ni enolična — "/" obstaja na skoraj vsaki domeni. */
  landingPages: { host: string; lp: string; sessions: number; keyEvents: number }[]
  /** Opportunity rate po viru — AI proti ostalim kanalom računa.
   *  POZOR: velja za sync okno, NE za izbrani datumski razpon (glej benchmarkWindow). */
  benchmark: {
    source: string
    contacts: number
    sqlPlus: number
    sqlRate: number
    opportunity: number
    oppRate: number
    isAi: boolean
  }[]
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
  const [sessionRows, hostRows] = await Promise.all([loadAiSessions(), loadHostSessions()])

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
      source: 'GA4 · all sites',
      available: true,
    },
    {
      key: 'leads',
      label: 'Leads',
      value: leads,
      cvrFromPrev: div(leads, totalSessions),
      source: 'HubSpot',
      available: true,
    },
    {
      key: 'sql',
      label: 'Sales Qualified +',
      value: sql,
      cvrFromPrev: div(sql, leads),
      source: 'HubSpot · cumulative',
      available: true,
      note: 'SQL or beyond (includes opportunity and customer).',
      info: {
        title: 'What counts as Sales Qualified +',
        lines: [
          'Source: HubSpot lifecycle stage, which records the FURTHEST stage a contact reached, not where it sits today.',
          'Counted: salesqualifiedlead · opportunity · customer.',
          'Not counted: subscriber · lead · marketingqualifiedlead (MQL).',
          `Roughly equivalent in Streak: ${STREAK_QUALIFIED}.`,
          'The Streak line is for orientation only — these numbers come from HubSpot and the two are not reconciled one to one. Note that in Streak, MQL, CQL and AI Robot Handled count as UNqualified, while Standard counts as qualified.',
        ],
      },
    },
    {
      key: 'opportunity',
      label: 'Opportunity +',
      value: opp,
      cvrFromPrev: div(opp, leads),
      source: 'HubSpot · cumulative',
      available: true,
      note: 'Rate is off leads, not off SQL — both steps are cumulative.',
      info: {
        title: 'What counts as Opportunity +',
        lines: [
          'Source: HubSpot lifecycle stage, furthest stage reached.',
          'Counted: opportunity · customer. These are also inside Sales Qualified +, which is why the two boxes overlap.',
          'The rate is measured against Leads, not against Sales Qualified +, because both steps are cumulative.',
          `Roughly equivalent in Streak: ${STREAK_CLOSING} — the deal is being worked or closed, not just accepted by sales.`,
          'Orientation only: these numbers come from HubSpot, not Streak, and the two are not reconciled one to one.',
        ],
      },
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
    .map(([week, sessions]) => {
      // Ponedeljek izpeljemo iz katerega koli dneva tega tedna, ne iz številke tedna.
      const anyDay = sess.find((r) => isoWeek(r.day) === week)?.day ?? ''
      const wStart = anyDay ? mondayOf(anyDay) : ''
      const wEnd = wStart ? addDays(wStart, 6) : ''
      return {
        week,
        start: wStart,
        end: wEnd,
        label: wStart ? weekLabel(wStart, wEnd) : week,
        sessions,
      }
    })
    .sort((a, b) => a.week.localeCompare(b.week))

  // ── ena vrstica na spletno stran ────────────────────────────────────────
  // Tri neodvisni viri se srečajo tukaj: AI seje (GA4, host), vse seje (GA4, host)
  // in leadi (HubSpot, domena prve obiskane strani). Stran je lahko v enem viru in
  // ne v drugem — ladijske mikrostrani imajo leade brez GA4 hosta, če je bil prvi
  // obisk na domeni, ki je ta hip ne merimo. Zato unija, ne presek.
  type SiteAcc = { aiSessions: number; keyEvents: number; totalSessions: number; leads: number; sqlPlus: number }
  const siteAgg = new Map<string, SiteAcc>()
  const site = (h: string): SiteAcc => {
    const cur = siteAgg.get(h) || { aiSessions: 0, keyEvents: 0, totalSessions: 0, leads: 0, sqlPlus: 0 }
    siteAgg.set(h, cur)
    return cur
  }
  for (const r of sess) {
    const s = site(r.host)
    s.aiSessions += r.sessions
    s.keyEvents += r.keyEvents
  }
  for (const r of hostRows) {
    if (!inRange(r.day)) continue
    site(r.host).totalSessions += r.sessions
  }
  for (const c of aiContacts) {
    const h = domainOf(c.firstUrl)
    if (!h) continue
    const s = site(h)
    s.leads += 1
    if (c.rank >= STAGE_RANK.salesqualifiedlead) s.sqlPlus += 1
  }

  const sites = [...siteAgg.entries()]
    // Strani brez AI sej in brez AI leadov so samo šum iz imenovalca (translate.goog,
    // gtm-msr.appspot.com in podobno) — te ne sodijo na AI stran.
    .filter(([, v]) => v.aiSessions > 0 || v.leads > 0)
    .map(([host, v]) => ({
      host,
      aiSessions: v.aiSessions,
      share: totalSessions ? v.aiSessions / totalSessions : 0,
      totalSessions: v.totalSessions,
      aiShareOfSite: v.totalSessions ? v.aiSessions / v.totalSessions : null,
      keyEvents: v.keyEvents,
      leads: v.leads,
      leadRate: v.aiSessions ? v.leads / v.aiSessions : null,
      sqlPlus: v.sqlPlus,
    }))
    .sort((a, b) => b.aiSessions - a.aiSessions || b.leads - a.leads)

  // Ključ je host + pot: "/" je najmočnejša landing stran na skoraj vsaki domeni,
  // združevanje samo po poti bi jih zlilo v eno vrstico.
  const lpAgg = new Map<string, { sessions: number; keyEvents: number }>()
  for (const r of sess) {
    const k = JSON.stringify([r.host, r.lp])
    const cur = lpAgg.get(k) || { sessions: 0, keyEvents: 0 }
    cur.sessions += r.sessions
    cur.keyEvents += r.keyEvents
    lpAgg.set(k, cur)
  }
  const landingPages = [...lpAgg.entries()]
    .map(([k, v]) => {
      const [host, lp] = JSON.parse(k) as string[]
      return { host, lp, sessions: v.sessions, keyEvents: v.keyEvents }
    })
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 15)

  // Benchmark pride iz sync-a in velja za NJEGOVO okno, ne za izbrani razpon.
  // Preračun na izbrani razpon bi zahteval vse kontakte, ne le AI — teh v appu nimamo.
  const benchmark = BY_SOURCE
    .filter((r) => r.contacts >= 5)
    .map((r) => ({
      source: r.source,
      contacts: r.contacts,
      sqlPlus: r.sqlPlus,
      // Starejši snapshoti nimajo `sqlRate` — izračunaj, če manjka.
      sqlRate: r.sqlRate ?? (r.contacts ? r.sqlPlus / r.contacts : 0),
      opportunity: r.opportunityPlus,
      oppRate: r.oppRate,
      isAi: r.isAi,
    }))
    .sort((a, b) => b.sqlRate - a.sqlRate)

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

  // Vsak lead posebej, najnovejši zgoraj. Brez rezanja — 44 vrstic v izbranem oknu,
  // striženje opravi UI z gumbom "See more".
  const leadRows = aiContacts
    .slice()
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .map((c) => ({
      day: c.day,
      name: c.name ?? null,
      email: c.email ?? null,
      country: c.country ? normCountry(c.country) : null,
      vendor: c.vendor,
      stage: c.stage ?? null,
      budgetRange: c.budgetRange ?? null,
      conversion: c.conversion ?? null,
      domain: domainOf(c.firstUrl),
      hubspotUrl: c.id ? HUBSPOT_RECORD_URL(c.id) : null,
    }))

  return {
    meta: {
      start,
      end,
      generatedAt: new Date().toISOString(),
      sessionScope: 'all Goolets sites (GA4 property 311674241, split by hostname)',
      contactScope: 'all Goolets sites (HubSpot 143360943)',
    },
    steps,
    // Do 21. 8. 2026 so seje pokrivale samo goolets.net, kontakti pa vse tri domene, zato je
    // bilo razmerje sessions\u2192leads ozna\u010deno kot neprimerljivo. Zdaj sta obsega enaka.
    scopeMismatch: null,
    vendors,
    sites,
    leads: leadRows,
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
