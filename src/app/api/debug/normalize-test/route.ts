import { NextResponse } from 'next/server'
import { matchSourceToCampaign } from '@/lib/fuzzy-match'
import { fetchFbEnriched, fetchSheet } from '@/lib/sheetsData'

const TEST_CAMPAIGNS = [
  'Landing Gulets - Scaling - CBO 150',
  'Landing Turkey - Scaling - CBO',
  'Landing Attainable Luxury - Prospecting - Lead - CBO',
]

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()

export async function GET() {
  const inputs = [
    'landing_gulet_video3',
    'landing_turkey_esma-sultan-kids',
    'landing_attainable-luxury_lead',
  ]

  const fbRows = await fetchFbEnriched(fetchSheet)
  const realCampaigns = fbRows.map((r: any) => r.campaign_name)

  const tests = inputs.map((input) => ({
    input,
    normalized: normalize(input),
    rule_matched_dummy: matchSourceToCampaign(input, TEST_CAMPAIGNS),
    rule_matched_real: matchSourceToCampaign(input, realCampaigns),
  }))

  return NextResponse.json({
    tests,
    actual_campaigns: realCampaigns,
  })
}
