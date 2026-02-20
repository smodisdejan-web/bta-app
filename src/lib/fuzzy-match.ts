// Explicit prefix-based matching rules for Streak source_placement -> FB campaign
// Order matters: first matching rule wins. No fuzzy logic.

type Rule = {
  campaignTarget: string;
  matches: (source: string) => boolean;
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

// Temporary debug logging for mapping issues
function debugMatch(sourcePlacement: string, ruleName: string, matched: boolean) {
  const srcNorm = normalize(sourcePlacement);
  // Uncomment for deeper tracing:
  // console.log('[match-debug]', { raw: sourcePlacement, norm: srcNorm, rule: ruleName, matched });
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
    matches: (s) => {
      const src = normalize(s);
      return src.startsWith('landing_turkey_belgin_sultan') || src.startsWith('belgin_sultan');
    },
  },
  {
    campaignTarget: 'Landing Turkey - Scaling - CBO',
    matches: (s) => normalize(s).startsWith('landing_turkey'),
  },
  {
    campaignTarget: 'Landing Attainable Luxury - Prospecting - Lead - CBO',
    matches: (s) => {
      const src = normalize(s);
      return (
        src.startsWith('landing_attainable-luxury') ||
        src.startsWith('landing_attainable_luxury') ||
        src.startsWith('landing_attainable-luxury_audience1') ||
        src.startsWith('landing_attainable-luxury_lead') ||
        src.startsWith('landing_attainable-luxury-audience1')
      ) && !src.startsWith('landing_attainable_luxury_warm');
    },
  },
  {
    campaignTarget: 'Landing Gulets - Scaling - CBO 150',
    matches: (s) => {
      const src = normalize(s);
      return src.startsWith('landing_gulet') || src.startsWith('landing_gulet_video');
    },
  },
  {
    campaignTarget: 'Landing Luxury yacht charters - Scaling - CBO 150',
    matches: (s) => normalize(s).startsWith('landing_luxury_yacht'),
  },
  {
    campaignTarget: 'Dalmatinčki - SCALE - Tier 1 + Tier 2 - CBO 200',
    matches: (s) => normalize(s).startsWith('dalmatincki_scale_tier1 tier2_cbo'),
  },
  {
    campaignTarget: 'Dalmatinčki - SCALE - Tier 2 - CBO',
    matches: (s) => {
      const src = normalize(s);
      return src.startsWith('dalmatincki_scale_tier2') || src === 'dalmatincki_scale_lookalike';
    },
  },
  {
    campaignTarget: 'BOFU - Landing Attainable Luxury - Objections crusher',
    matches: (s) => normalize(s).startsWith('landing_attainable_luxury_warm'),
  },
  {
    campaignTarget: 'Early Booking - Croatia 2027 - CBO',
    matches: (s) => {
      const src = normalize(s);
      return src.startsWith('earlybook2027') || src.startsWith('early-booking') || src.includes('earlybook2027');
    },
  },
  {
    campaignTarget: 'Anima Maris + Maxita TEST - ABO',
    matches: (s) => {
      const src = normalize(s);
      return (src.startsWith('anima-maris') || src.startsWith('maxita')) && !src.includes('dalmatincki');
    },
  },
  {
    campaignTarget: 'BOOST - 2026 - Engagement',
    matches: (s) => {
      const src = normalize(s);
      return src === 'awareness_landing' || src === 'charter_a_dream_interior' || src === 'new_videos';
    },
  },
  {
    campaignTarget: 'Last Minute - Croatia 2026 - CBO',
    matches: (s) => {
      const src = normalize(s);
      return src.startsWith('lastminute2026') || src.startsWith('landing_last-minute');
    },
  },
  {
    campaignTarget: 'Dalmatinčki - TEST Angle - Tier1 - LP',
    matches: (s) => normalize(s).startsWith('dalmatincki_test_tier1'),
  },
  {
    campaignTarget: 'Dalmatinčki - TEST Angle - Tier1 - Lead Form',
    matches: (s) => {
      const src = normalize(s);
      return (
        src.includes('dalmatincki - test angle - tier1 - lead form') ||
        src.startsWith('test - lead form dalmatincki') ||
        src.startsWith('test - dalmatincki - test angle')
      );
    },
  },
  // Broader fallbacks / new patterns
  {
    campaignTarget: 'Landing Mega Yachts',
    matches: (s) => normalize(s).startsWith('landing_mega-yachts'),
  },
  {
    campaignTarget: 'Individual Yachts',
    matches: (s) => normalize(s).startsWith('lp_individual-yachts'),
  },
  {
    campaignTarget: 'Lead Form - All - All Creatives - Scaling',
    matches: (s) => normalize(s).includes('lead form - all - all creatives'),
  },
  {
    campaignTarget: 'Instagram Stories',
    matches: (s) => normalize(s).includes('instagram_stories') || normalize(s).includes('ig / instagram'),
  },
  {
    campaignTarget: 'Unknown',
    matches: (s) => !s || normalize(s).trim() === '',
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
