import { NextResponse } from 'next/server'
import { matchSourceToCampaign } from '@/lib/fuzzy-match'

const TEST_CAMPAIGNS = [
  'Landing Gulets - Scaling - CBO 150',
  'Landing Turkey - Scaling - CBO',
  'Landing Attainable Luxury - Prospecting - Lead - CBO',
]

export async function GET() {
  const inputs = [
    'landing_gulet_video3',
    'landing_turkey_esma-sultan-kids',
    'landing_attainable-luxury_lead',
  ]

  const tests = inputs.map((input) => ({
    input,
    normalized: input.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim(),
    rule_matched: matchSourceToCampaign(input, TEST_CAMPAIGNS),
  }))

  return NextResponse.json({ tests })
}
