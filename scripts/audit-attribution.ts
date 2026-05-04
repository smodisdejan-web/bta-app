/**
 * Audit FB campaign attribution: streak_sync source_placement → fuzzy-match.ts → fb_ads_enriched campaign.
 *
 * Catches:
 *   1. source_placement strings that fail to match any rule (Unknown bucket grows)
 *   2. campaigns with active spend that receive 0 quality leads (rule routes leads elsewhere)
 *   3. sources matched to a campaign whose name shares no tokens (likely wrong target)
 *
 * Run:    npx tsx scripts/audit-attribution.ts
 * Exits 1 on red flags, 0 if clean. CI/pre-deploy hook.
 *
 * Reads via Apps Script Web App (DEFAULT_WEB_APP_URL) — same path as the dashboard, so
 * findings reflect what users see. Reads campaigns from fb_ads_enriched (last 90d).
 */

import { diagnoseSource } from '../src/lib/fuzzy-match'
import { DEFAULT_WEB_APP_URL, SHEETS_TABS } from '../src/lib/config'

type Row = Record<string, any>

async function fetchTab(tab: string): Promise<Row[]> {
  const url = `${DEFAULT_WEB_APP_URL}?tab=${encodeURIComponent(tab)}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetch ${tab} failed: ${res.status}`)
  return (await res.json()) as Row[]
}

function normalize(s: string) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Campaigns that intentionally receive 0 attributed leads (recruitment, awareness,
// dead-but-still-in-fb_ads_enriched). Don't flag these as warnings.
const EXPECTED_ZERO_LEAD_CAMPAIGNS = [
  'BOOST - 2026 - Engagement',
  'Yacht Matchmaker - Lead Magnet - CBO',
  /^JOB POST -/,
  /- OLD$/,
]

// Known exceptions — sources that legitimately attribute to a campaign whose name shares no tokens.
// Document WHY in memory: feedback_kw_campaign_naming.md / reference_goolets_streak_utm_matching.md
const KNOWN_AUDIENCE_FIRST_PREFIXES = [
  'interesi_bella_',
  'warm_bella_',
  'interesi_riva-',
  'warm_riva-',
  'interesi_ohana-',
  'warm_ohana-',
  'earlybook2027',
  'lastminute2026',
  'yolo_last-minute_',
  'freedom_warm_',
  'freedom_interesi_',
  'alessandro_smarter_',
  'alessandro_tier',
  'alessandro_warm_',
  'smart_spirit_',
  'dalmatincki_',
  'landing_gulet_v2',
  'lp_individual-yachts',
  'anima-maris',
  'maxita',
  'awareness_landing',
  'charter_a_dream_interior',
  'new_videos',
  'early-booking',
]

async function main() {
  console.log('Fetching streak_sync + fb_ads_enriched via Web App...')
  const [streak, fbEnriched] = await Promise.all([
    fetchTab(SHEETS_TABS.STREAK_SYNC),
    fetchTab(SHEETS_TABS.FB_ENRICHED),
  ])

  // Active campaigns last 90 days
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  const activeCampaigns = new Set<string>()
  for (const r of fbEnriched) {
    const camp = r['campaign_name']
    const dateRaw = r['date_iso'] || r['date_start']
    const d = new Date(dateRaw)
    if (camp && !isNaN(d.getTime()) && d.getTime() >= cutoff) {
      activeCampaigns.add(camp)
    }
  }
  const campaigns = [...activeCampaigns]

  // Per source, diagnose: which rule matched, which campaign resolved
  type Acc = {
    src: string
    diagnosis: ReturnType<typeof diagnoseSource>
    count: number
    aiSum: number
  }
  const sourceMap = new Map<string, Acc>()
  for (const r of streak) {
    const src = String(r['SOURCE PLACEMENT'] ?? '').toLowerCase()
    const dateRaw = r['Inquiry Recieved']
    const ai = Number(r['AI']) || 0
    if (!src) continue
    const d = new Date(dateRaw)
    if (isNaN(d.getTime()) || d.getTime() < cutoff) continue
    const diagnosis = diagnoseSource(src, campaigns)
    const acc = sourceMap.get(src) ?? { src, diagnosis, count: 0, aiSum: 0 }
    acc.count++
    acc.aiSum += ai
    sourceMap.set(src, acc)
  }

  // Group attributions by resolved campaign
  const byCampaign = new Map<string, Acc[]>()
  for (const acc of sourceMap.values()) {
    if (acc.diagnosis.kind === 'matched') {
      const camp = acc.diagnosis.resolvedCampaign
      if (!byCampaign.has(camp)) byCampaign.set(camp, [])
      byCampaign.get(camp)!.push(acc)
    }
  }

  const red: string[] = []
  const yellow: string[] = []
  const info: string[] = []

  // Bucket by diagnosis
  const allAccs = [...sourceMap.values()]
  const unmatched = allAccs.filter((s) => s.diagnosis.kind === 'unmatched')
  const stale = allAccs.filter((s) => s.diagnosis.kind === 'stale')
  const explicitUnknown = allAccs.filter((s) => s.diagnosis.kind === 'explicit-unknown')

  // Check 1: truly unmatched FB-looking sources (real bug — needs new rule)
  const fbLooking = unmatched.filter((s) => {
    const n = normalize(s.src)
    if (/^[a-z]+_[a-z]/.test(n)) return true // adset-style with underscore
    if (n.includes(' - cbo') || n.includes(' - lf') || n.includes(' - lead form')) return true
    return false
  })
  if (fbLooking.length > 0) {
    red.push(`${fbLooking.length} FB-looking source(s) UNMATCHED — need a rule:`)
    fbLooking.sort((a, b) => b.count - a.count).forEach((s) => {
      red.push(`  ${s.count}x  AI~${(s.aiSum / s.count).toFixed(0)}  "${s.src}"`)
    })
  }

  // Check 2: campaigns with rows in fb_ads_enriched but 0 attributed sources (skip allowlist)
  const isExpectedZero = (camp: string) =>
    EXPECTED_ZERO_LEAD_CAMPAIGNS.some((p) => (typeof p === 'string' ? p === camp : p.test(camp)))
  for (const camp of campaigns) {
    const sources = byCampaign.get(camp) ?? []
    if (sources.reduce((a, s) => a + s.count, 0) === 0 && !isExpectedZero(camp)) {
      yellow.push(`Campaign active in fb_ads_enriched but 0 attributed leads (90d): "${camp}"`)
    }
  }

  // Check 3: source matched but token-mismatch with resolved campaign (allowlist excepted)
  for (const camp of campaigns) {
    const sources = byCampaign.get(camp) ?? []
    const campNorm = normalize(camp)
    const campTokens = campNorm
      .split(/[\s\-_]+/)
      .filter((t) => t.length > 3 && !['cbo', 'abo', 'test', 'copy', 'new', 'old', 'ads', 'form', 'lead'].includes(t))
    for (const s of sources) {
      const srcNorm = normalize(s.src).replace(/_/g, ' ')
      const srcTokens = srcNorm.split(/[\s\-]+/).filter((t) => t.length > 3)
      const overlap = srcTokens.filter((t) => campTokens.some((ct) => ct.includes(t) || t.includes(ct)))
      if (overlap.length === 0 && !KNOWN_AUDIENCE_FIRST_PREFIXES.some((p) => s.src.startsWith(p))) {
        red.push(`MISMATCH: "${camp}" <-- "${s.src}" (${s.count}x) — no token overlap, not in allowlist`)
      }
    }
  }

  // Info: stale rules (matched but target campaign no longer active)
  if (stale.length > 0) {
    const staleCounts = stale.reduce((a, s) => a + s.count, 0)
    info.push(`${stale.length} source(s) (${staleCounts} leads) match a rule whose target campaign is no longer active in fb_ads_enriched 90d window — historical leakage, not a bug:`)
    stale.sort((a, b) => b.count - a.count).forEach((s) => {
      const t = (s.diagnosis as any).ruleTarget
      info.push(`  ${s.count}x  AI~${(s.aiSum / s.count).toFixed(0)}  "${s.src}" → would route to "${t}"`)
    })
  }
  // Info: explicitly Unknown
  if (explicitUnknown.length > 0) {
    const cnt = explicitUnknown.reduce((a, s) => a + s.count, 0)
    info.push(`${explicitUnknown.length} source(s) (${cnt} leads) explicitly routed to Unknown bucket via Unknown rule — intentional:`)
    explicitUnknown.sort((a, b) => b.count - a.count).forEach((s) => {
      info.push(`  ${s.count}x  "${s.src}"`)
    })
  }

  // Print summary
  const matched = allAccs.filter((s) => s.diagnosis.kind === 'matched').length
  console.log(`\n=== Active FB campaigns (90d): ${campaigns.length} ===`)
  console.log(`=== Sources: ${matched} matched / ${stale.length} stale-target / ${explicitUnknown.length} explicit-unknown / ${unmatched.length} unmatched (total ${sourceMap.size}) ===`)

  if (red.length === 0 && yellow.length === 0) {
    console.log('\n✅ Attribution clean — all FB-looking sources routed to active campaigns.')
    if (info.length > 0) {
      console.log('\nℹ️  Info (no action needed):')
      info.forEach((i) => console.log(`  ${i}`))
    }
    process.exit(0)
  }
  if (yellow.length) {
    console.log('\n⚠️  Warnings:')
    yellow.forEach((y) => console.log(`  ${y}`))
  }
  if (red.length) {
    console.log('\n❌ Red flags:')
    red.forEach((r) => console.log(`  ${r}`))
  }
  if (info.length > 0) {
    console.log('\nℹ️  Info (no action needed):')
    info.forEach((i) => console.log(`  ${i}`))
  }
  process.exit(red.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Audit failed:', err)
  process.exit(2)
})
