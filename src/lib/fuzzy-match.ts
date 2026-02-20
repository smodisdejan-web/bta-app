// Explicit prefix-based matching rules for Streak source_placement -> FB campaign
// Order matters: first matching rule wins. No fuzzy logic.

type Rule = {
  campaignTarget: string;
  matches: (sourceNorm: string, sourceRaw: string) => boolean;
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

// Temporary debug logging for mapping issues
function debugMatch(sourcePlacement: string, ruleName: string, matched: boolean) {
  const srcNorm = normalize(sourcePlacement);
  console.log('INPUT:', sourcePlacement, '→ NORMALIZED:', srcNorm, 'RULE:', ruleName, 'MATCH:', matched);
}

const findCampaign = (campaigns: string[], target: string): string | null => {
  const targetNorm = normalize(target);
  for (const campaign of campaigns) {
    const campNorm = normalize(campaign);
    if (campNorm.includes(targetNorm) || campNorm.startsWith(targetNorm)) {
      return campaign;
    }
  }
  return null;
};

const RULES: Rule[] = [
  // Most specific first
  {
    campaignTarget: 'Belgin Sultan - Turkey - CBO',
    matches: (src) =>
      src.startsWith('landing_turkey_belgin_sultan') || src.startsWith('belgin_sultan'),
  },
  {
    campaignTarget: 'Landing Turkey - Scaling - CBO',
    matches: (src) => src.startsWith('landing_turkey') && !src.includes('belgin_sultan'),
  },
  {
    campaignTarget: 'Landing Attainable Luxury - Prospecting - Lead - CBO',
    matches: (src) =>
      (src.startsWith('landing_attainable-luxury') ||
        src.startsWith('landing_attainable_luxury')) &&
      !src.includes('warm'),
  },
  {
    campaignTarget: 'Landing Gulets - Scaling - CBO 150',
    matches: (src) => src.startsWith('landing_gulet'),
  },
  {
    campaignTarget: 'Landing Luxury yacht charters - Scaling - CBO 150',
    matches: (src) => src.startsWith('landing_luxury_yacht'),
  },
  {
    campaignTarget: 'Dalmatinčki - SCALE - Tier 1 + Tier 2 - CBO 200',
    matches: (src) => src.startsWith('dalmatincki_scale_tier1 tier2_cbo'),
  },
  {
    campaignTarget: 'Dalmatinčki - SCALE - Tier 2 - CBO',
    matches: (src) => src.startsWith('dalmatincki_scale_tier2') || src === 'dalmatincki_scale_lookalike',
  },
  {
    campaignTarget: 'BOFU - Landing Attainable Luxury - Objections crusher',
    matches: (src) => src.startsWith('landing_attainable_luxury_warm'),
  },
  {
    campaignTarget: 'Early Booking - Croatia 2027 - CBO',
    matches: (src) => src.startsWith('earlybook2027') || src.startsWith('early-booking') || src.includes('earlybook2027'),
  },
  {
    campaignTarget: 'Anima Maris + Maxita TEST - ABO',
    matches: (src) => (src.startsWith('anima-maris') || src.startsWith('maxita')) && !src.includes('dalmatincki'),
  },
  {
    campaignTarget: 'BOOST - 2026 - Engagement',
    matches: (src) => src === 'awareness_landing' || src === 'charter_a_dream_interior' || src === 'new_videos',
  },
  {
    campaignTarget: 'Last Minute - Croatia 2026 - CBO',
    matches: (src) => src.startsWith('lastminute2026') || src.startsWith('landing_last-minute'),
  },
  {
    campaignTarget: 'Dalmatinčki - TEST Angle - Tier1 - LP',
    matches: (src) => src.startsWith('dalmatincki_test_tier1') || src.includes('dalmatincki_mofu'),
  },
  {
    campaignTarget: 'Dalmatinčki - TEST Angle - Tier1 - Lead Form',
    matches: (src) =>
      src.includes('dalmatincki - test angle - tier1 - lead form') ||
      src.startsWith('test - lead form dalmatincki') ||
      src.startsWith('test - dalmatincki - test angle') ||
      src.includes('dalmatincki - test angle - tier2 - lead form'),
  },
  // Broader fallbacks / new patterns
  {
    campaignTarget: 'Landing Mega Yachts',
    matches: (src) => src.startsWith('landing_mega-yachts'),
  },
  {
    campaignTarget: 'Individual Yachts',
    matches: (src) => src.startsWith('lp_individual-yachts'),
  },
  {
    campaignTarget: 'Lead Form - All - All Creatives - Scaling',
    matches: (src) => src.includes('lead form - all - all creatives'),
  },
  {
    campaignTarget: 'Instagram Stories',
    matches: (src) => src.includes('instagram_stories') || src.includes('ig / instagram'),
  },
  {
    campaignTarget: 'Unknown',
    matches: (src, raw) =>
      !raw ||
      src.trim() === '' ||
      src === 'landing_b' ||
      src.includes('lead form - all - higher intent - retargeting') ||
      src.includes('launch campaign - bofu - lead form - cbo') ||
      src === 'paid / facebook' ||
      src === 'facebook',
  },
];

export function matchSourceToCampaign(
  sourcePlacement: string,
  campaigns: string[],
  _threshold: number = 70
): string | null {
  const src = sourcePlacement || '';
  const normSrc = normalize(src);
  const normalizedCampaigns = campaigns.map((c) => ({
    raw: c,
    norm: normalize(c),
  }));
  for (const rule of RULES) {
    const matched = rule.matches(src);
    debugMatch(src, rule.campaignTarget, matched);
    if (matched) {
      const target = rule.campaignTarget;
      const targetNorm = normalize(target);
      const found = normalizedCampaigns.find(
        (c) => c.norm.includes(targetNorm) || c.norm.startsWith(targetNorm)
      );
      if (found) return found.raw;
    }
  }
  // Fallback: Unknown bucket
  const unknown = normalizedCampaigns.find((c) => c.norm.includes('unknown'));
  return unknown ? unknown.raw : 'Unknown Facebook';
}

export function matchLeadsToCampaigns(
  leads: { source_placement: string }[],
  campaigns: string[]
): Map<string, string> {
  const mapping = new Map<string, string>();
  const uniqueSources = [...new Set(leads.map((l) => l.source_placement))];

  let matched = 0;
  let unmatched = 0;

  for (const source of uniqueSources) {
    const match = matchSourceToCampaign(source, campaigns);
    if (match) {
      mapping.set(source, match);
      matched++;
    } else {
      unmatched++;
      console.log('[Matching] Unmatched:', source);
    }
  }

  console.log(`[Matching] Matched ${matched}/${uniqueSources.length} sources (${unmatched} unmatched)`);

  return mapping;
}
