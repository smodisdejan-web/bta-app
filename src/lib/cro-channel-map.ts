/**
 * cro-channel-map.ts — ONE place that maps the three traffic taxonomies onto the 11 channels of
 * the Acquisition-Channel-Dashboard (the Acq sheet), for the Web Funnel CRO tower (/api/cro-tower).
 *
 * STATUS: written 2026-09-23 by Dejan's build, TO CONFIRM WITH TADEJ / AYMEN (SOP 2026-09-11,
 * "Kanalski mapping potrdita Tadej/Aymen, ko ga napišem"). Change a rule here and nowhere else.
 *
 * The three taxonomies:
 *   GA4      ga4_host_lp.channel_group + source_medium + host          → visitors / engaged
 *   HubSpot  hubspot_contacts_all.hs_analytics_source (+ data_1/2, utm) + first_host → inquiries
 *   Streak   streak_all.source_category + source_detail (+ joined host, `page`)      → QL
 *
 * Shared rules:
 *   - "SEO" is split by HOST: organic search on goolets.net = Goolets SEO, on guletexpert.com =
 *     Expert SEO, on croatialuxurygulet.com = Cro lux SEO, on turkeyluxurygulet.com = Tur lux SEO.
 *     Organic search on a ship micro-site, or with no host, is UNMAPPED (reported, never guessed).
 *   - "AI traffic" = the canonical AI-assistant source list of lib/ai-traffic.ts (isAiSource):
 *     chatgpt / openai / claude / perplexity / gemini / copilot / … plus GA4's ai-assistant medium.
 *     It is checked BEFORE every other rule, so a chatgpt.com referral is AI, not Referral.
 *   - "Paid search" = every Google Ads network (Search, PMax/Cross-network, Display, YouTube
 *     Paid Video, adwords/ppc) plus Bing and ChatGPT Ads — the Acq sheet has no separate row.
 *   - Meta's broken-UTM traffic (source fb/ig/an/th/msg with a CAMPAIGN NAME in the medium, e.g.
 *     "ig / Yacht Matchmaker - Lead Magnet - CBO", or the raw "{{site_source_name}}" macro) is
 *     Paid social, not Organic social: GA4 files it under Organic Social / Unassigned only because
 *     the medium is not "paid".
 *   - Anything that matches no rule returns UNMAPPED so its size can be reported.
 */

import { isAiSource, isAiSourceMedium } from './ai-traffic'

export const CRO_CHANNELS = [
  'Paid social',
  'Paid search',
  'Goolets SEO',
  'Organic social',
  'Direct',
  'Mailing',
  'Expert SEO',
  'Referral',
  'AI traffic',
  'Cro lux SEO',
  'Tur lux SEO',
] as const

export type CroChannel = (typeof CRO_CHANNELS)[number]
export const UNMAPPED = 'unmapped' as const
export type CroChannelOrUnmapped = CroChannel | typeof UNMAPPED

/** Organic search → SEO channel by host. null = no SEO channel for that host (ship site / none). */
export const SEO_BY_HOST: Record<string, CroChannel> = {
  'goolets.net': 'Goolets SEO',
  'guletexpert.com': 'Expert SEO',
  'croatialuxurygulet.com': 'Cro lux SEO',
  'turkeyluxurygulet.com': 'Tur lux SEO',
}

export function seoChannelForHost(host: string | null | undefined): CroChannel | null {
  const h = normHost(host)
  return h ? SEO_BY_HOST[h] ?? null : null
}

export function normHost(host: string | null | undefined): string {
  return String(host ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
}

/** Meta site_source_name tokens as they arrive in utm_source when the template is not expanded. */
const META_SOURCE_TOKEN = /^(fb|ig|an|th|msg|facebook|instagram|meta|\{\{site_source_name\}\})$/i
/** Mediums that are genuinely organic when the source is a Meta property. */
const ORGANIC_MEDIUM = /^(social|referral|organic|\(none\)|none|\(not set\))$/i
const PAID_MEDIUM = /^(paid|paid_social|paidsocial|paid-social|cpc|ppc|cpm)$/i
const GOOGLE_ADS_SOURCE = /^(google|adwords|youtube)$/i
const BING_SOURCE = /^(bing|microsoft|ms)$/i

function splitSm(sourceMedium: string): { source: string; medium: string } {
  const i = sourceMedium.indexOf(' / ')
  if (i < 0) return { source: sourceMedium.trim(), medium: '' }
  return { source: sourceMedium.slice(0, i).trim(), medium: sourceMedium.slice(i + 3).trim() }
}

// ─── GA4: channel_group + source_medium + host ──────────────────────────────
//
// | channel_group            | rule                                                     |
// |--------------------------|----------------------------------------------------------|
// | (any) AI source/medium   | AI traffic  (lib/ai-traffic isAiSourceMedium)            |
// | Paid Social              | Paid social                                              |
// | Paid Search, Cross-network, Display, Paid Video, Paid Other, Paid Shopping | Paid search |
// | Organic Social           | Paid social IF Meta source token + campaign-name medium, else Organic social |
// | Organic Video            | Organic social (YouTube referrals / influencer links)    |
// | Organic Search           | SEO by host (Goolets / Expert / Cro lux / Tur lux)        |
// | Direct                   | Direct                                                   |
// | Email                    | Mailing                                                  |
// | Referral                 | Referral                                                 |
// | Unassigned               | Meta macro / Meta token + paid-ish medium → Paid social; google+cpc → Paid search; else unmapped |
// | (excluded)               | unmapped (host __other__, never reported anyway)         |
export function mapGa4Channel(channelGroup: string, sourceMedium: string, host: string): CroChannelOrUnmapped {
  const cg = String(channelGroup ?? '').trim()
  const sm = String(sourceMedium ?? '').trim()
  const { source, medium } = splitSm(sm)

  if (isAiSourceMedium(sm) || /^ai assistant$/i.test(cg)) return 'AI traffic'

  switch (cg) {
    case 'Paid Social':
      return 'Paid social'
    case 'Paid Search':
    case 'Cross-network':
    case 'Display':
    case 'Paid Video':
    case 'Paid Other':
    case 'Paid Shopping':
      return 'Paid search'
    case 'Organic Social':
      if (META_SOURCE_TOKEN.test(source) && medium && !ORGANIC_MEDIUM.test(medium)) return 'Paid social'
      return 'Organic social'
    case 'Organic Video':
      return 'Organic social'
    case 'Organic Search':
      return seoChannelForHost(host) ?? UNMAPPED
    case 'Direct':
      return 'Direct'
    case 'Email':
      return 'Mailing'
    case 'Referral':
      return 'Referral'
    case 'Unassigned': {
      if (/\{\{site_source_name\}\}/i.test(sm)) return 'Paid social'
      if (META_SOURCE_TOKEN.test(source) && medium && !ORGANIC_MEDIUM.test(medium)) return 'Paid social'
      if ((GOOGLE_ADS_SOURCE.test(source) || BING_SOURCE.test(source)) && PAID_MEDIUM.test(medium)) return 'Paid search'
      return UNMAPPED
    }
    default:
      return UNMAPPED
  }
}

// ─── HubSpot: hs_analytics_source (+ data_1 / data_2 / utm) + first_host ─────
//
// | hs_analytics_source | rule                                                                  |
// |---------------------|-----------------------------------------------------------------------|
// | AI_REFERRALS        | AI traffic                                                            |
// | PAID_SOCIAL         | Paid social                                                           |
// | PAID_SEARCH         | Paid search (Google, Bing, ChatGPT Ads alike)                         |
// | ORGANIC_SEARCH      | SEO by first_host                                                     |
// | SOCIAL_MEDIA        | Organic social                                                        |
// | DIRECT_TRAFFIC      | Direct                                                                |
// | EMAIL_MARKETING     | Mailing                                                               |
// | REFERRALS           | AI traffic if data_1 is an AI host, else Referral                     |
// | OTHER_CAMPAIGNS     | data_2 "ig / <campaign>" (Meta token) → Paid social; youtube → Organic social; AI host → AI traffic; else unmapped |
// | OFFLINE             | only by utm: facebook/paid → Paid social, adwords|google/ppc|cpc → Paid search, hs_email → Mailing; else unmapped (calculators, integrations) |
export function mapHubspotChannel(r: {
  source: string
  data1?: string
  data2?: string
  utmSource?: string
  utmMedium?: string
  firstHost?: string
}): CroChannelOrUnmapped {
  const src = String(r.source ?? '').trim().toUpperCase()
  const d1 = String(r.data1 ?? '').trim()
  const d2 = String(r.data2 ?? '').trim()
  const us = String(r.utmSource ?? '').trim()
  const um = String(r.utmMedium ?? '').trim()

  switch (src) {
    case 'AI_REFERRALS':
      return 'AI traffic'
    case 'PAID_SOCIAL':
      return 'Paid social'
    case 'PAID_SEARCH':
      return 'Paid search'
    case 'ORGANIC_SEARCH':
      return seoChannelForHost(r.firstHost) ?? UNMAPPED
    case 'SOCIAL_MEDIA':
      return 'Organic social'
    case 'DIRECT_TRAFFIC':
      return 'Direct'
    case 'EMAIL_MARKETING':
      return 'Mailing'
    case 'REFERRALS':
      return isAiSource(normHost(d1), null) ? 'AI traffic' : 'Referral'
    case 'OTHER_CAMPAIGNS': {
      const { source, medium } = splitSm(d2)
      if (isAiSource(normHost(d1), null) || isAiSource(source, medium)) return 'AI traffic'
      if (/\{\{site_source_name\}\}/i.test(d2) || META_SOURCE_TOKEN.test(source)) return 'Paid social'
      if (/^youtube$/i.test(source)) return 'Organic social'
      return fromUtm(us, um)
    }
    case 'OFFLINE':
      return fromUtm(us, um)
    default:
      return UNMAPPED
  }
}

function fromUtm(us: string, um: string): CroChannelOrUnmapped {
  if (!us && !um) return UNMAPPED
  if (isAiSource(us, um)) return 'AI traffic'
  if (META_SOURCE_TOKEN.test(us) && PAID_MEDIUM.test(um)) return 'Paid social'
  if ((GOOGLE_ADS_SOURCE.test(us) || BING_SOURCE.test(us)) && PAID_MEDIUM.test(um)) return 'Paid search'
  if (/^(hs_email|hs_automation)$/i.test(us) || /^email$/i.test(um)) return 'Mailing'
  return UNMAPPED
}

// ─── Streak: source_category + source_detail (+ joined host, `page`) ─────────
//
// | source_category                     | rule                                           |
// |-------------------------------------|------------------------------------------------|
// | AI_REFERRALS                        | AI traffic                                     |
// | PAID_SOCIAL                         | Paid social                                    |
// | PAID_SEARCH                         | Paid search (incl. Bing "ms - …" and ChatGPT)  |
// | ORGANIC_SEARCH                      | SEO by joined HubSpot first_host, else by Streak `page` (CRO LUXURY / TURKEY|TUR LUXURY / GULET EXPERT / GOOLETS…) |
// | SOCIAL_MEDIA, ORGANIC_SOCIAL, Engagement Social | Organic social                      |
// | DIRECT_TRAFFIC                      | Direct                                         |
// | EMAIL_MARKETING                     | Mailing                                        |
// | REFERRALS                           | AI traffic if source_detail is an AI host, else Referral |
// | AGENCY, RECOMMENDED, REPEATED, CALCULATOR, CHAT, WHATSAPP, PERSONAL BRANDING, COLD OUTREACH, OFFLINE, OTHER, OTHER_CAMPAIGNS, '' | unmapped — sales-side categories with no web channel |
export function mapStreakChannel(r: {
  category: string
  detail?: string
  page?: string
  joinedHost?: string | null
}): CroChannelOrUnmapped {
  const cat = String(r.category ?? '').trim().toUpperCase()
  const detail = String(r.detail ?? '').trim()

  switch (cat) {
    case 'AI_REFERRALS':
      return 'AI traffic'
    case 'PAID_SOCIAL':
      return 'Paid social'
    case 'PAID_SEARCH':
      return 'Paid search'
    case 'ORGANIC_SEARCH':
      return seoChannelForHost(r.joinedHost) ?? seoChannelForStreakPage(r.page) ?? UNMAPPED
    case 'SOCIAL_MEDIA':
    case 'ORGANIC_SOCIAL':
    case 'ENGAGEMENT SOCIAL':
      return 'Organic social'
    case 'DIRECT_TRAFFIC':
      return 'Direct'
    case 'EMAIL_MARKETING':
      return 'Mailing'
    case 'REFERRALS':
      return isAiSource(normHost(detail), null) ? 'AI traffic' : 'Referral'
    default:
      return UNMAPPED
  }
}

/** Streak's own `page` field (which site the box came from) → SEO channel. Fallback only. */
export function seoChannelForStreakPage(page: string | null | undefined): CroChannel | null {
  const p = String(page ?? '').trim().toUpperCase()
  if (!p) return null
  if (p.startsWith('CRO LUXURY')) return 'Cro lux SEO'
  if (p.startsWith('TURKEY LUXURY') || p.startsWith('TUR LUXURY')) return 'Tur lux SEO'
  if (p.startsWith('GULET EXPERT')) return 'Expert SEO'
  if (p.startsWith('GOOLETS')) return 'Goolets SEO'
  return null
}
