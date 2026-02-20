import { NextResponse } from 'next/server'
import { matchSourceToCampaign } from '@/lib/fuzzy-match'
import { fetchFbEnriched, fetchSheet } from '@/lib/sheetsData'

const TEST_CAMPAIGNS = [
  'Landing Gulets - Scaling - CBO 150',
  'Landing Turkey - Scaling - CBO',
  'Landing Attainable Luxury - Prospecting - Lead - CBO',
]

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()

const findCampaignSnippet = `const findCampaign = (campaigns: string[], target: string): string | null => {
  const targetNorm = normalize(target).replace(/\\s+/g, ' ');
  for (const campaign of campaigns) {
    const campNorm = normalize(campaign).replace(/\\s+/g, ' ');
    if (campNorm.includes(targetNorm) || campNorm.startsWith(targetNorm)) {
      return campaign;
    }
  }
  return null;
};`

export async function GET() {
  const inputs = [
    'landing_gulet_video3',
    'landing_turkey_esma-sultan-kids',
    'landing_attainable-luxury_lead',
  ]

  const fbRows = await fetchFbEnriched(fetchSheet)
  const realCampaigns = fbRows.map((r: any) => r.campaign_name)
  const realGulets = realCampaigns.find((c) => c.toLowerCase().includes('gulets')) || ''

  const tests = inputs.map((input) => ({
    input,
    normalized: normalize(input),
    rule_matched_dummy: matchSourceToCampaign(input, TEST_CAMPAIGNS),
    rule_matched_real: matchSourceToCampaign(input, realCampaigns),
    findCampaign_result: null,
  }))

  // Inline whitespace test
  const target = 'Landing Gulets - Scaling - CBO 150'
  const campaign = 'Landing Gulets  - Scaling - CBO 150'
  const targetNorm = target.toLowerCase().replace(/\s+/g, ' ')
  const campNorm = campaign.toLowerCase().replace(/\s+/g, ' ')
  const inlineResult = campNorm.includes(targetNorm)

  const inlineTest = {
    targetNorm,
    campNorm,
    target_chars: [...target].map((c) => c.charCodeAt(0)),
    campaign_chars: [...campaign].map((c) => c.charCodeAt(0)),
    includes_result: inlineResult,
  }

  const realGuletsChars = [...realGulets].map((c) => c.charCodeAt(0))

  return NextResponse.json({
    tests,
    actual_campaigns: realCampaigns,
    findCampaign_whitespace_test: {
      target,
      campaign,
      match_result: matchSourceToCampaign('landing_gulet_video3', [campaign]),
    },
    inline_test: inlineTest,
    real_gulets: realGulets,
    real_gulets_chars: realGuletsChars,
    findCampaign_code: findCampaignSnippet,
  })
}
