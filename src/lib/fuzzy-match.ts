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
    .replace(/\s+/g, ' ')
    .trim();

// Verbose per-rule logging — opt-in via env var so the audit script doesn't drown.
const FUZZY_DEBUG = typeof process !== 'undefined' && process.env.FUZZY_MATCH_DEBUG === '1';
function debugMatch(sourcePlacement: string, ruleName: string, matched: boolean) {
  if (!FUZZY_DEBUG) return;
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

  // --- Explicit campaign mappings (mirrors STREAK_PREFIX_MAP in test-tracker) ---
  {
    campaignTarget: 'Alessandro - Discount - CBO - Lead Form',
    matches: (src) => src === 'alessandro - discount - cbo - lead form',
  },
  {
    campaignTarget: 'Alessandro I - The Smarter Way - CBO - New',
    matches: (src) => src.startsWith('alessandro_smarter_'),
  },
  {
    campaignTarget: 'Alessandro I Discount - CBO - New',
    matches: (src) => src.startsWith('alessandro_tier') || src.startsWith('alessandro_warm_'),
  },
  {
    campaignTarget: 'Test - Dalmatinčki - Sail Smarter - CRO-001 Test',
    matches: (src) => src.startsWith('dalmatincki_smart-luxury-sailing_'),
  },
  {
    campaignTarget: 'Dalmatinčki - Sail Smarter - CRO-001 Control',
    matches: (src) => src.startsWith('dalmatincki_sail-smarter_'),
  },
  {
    campaignTarget: 'Landing Unmatched Value - Objections crusher ads',
    matches: (src) => src.startsWith('landing_unmatched_value_1_'),
  },
  {
    campaignTarget: 'Test - Landing Unmatched Value Forma 2 - Objections crusher ads',
    matches: (src) => src.startsWith('landing_unmatched_value_2_'),
  },
  {
    campaignTarget: 'Smart Spirit - 25 Off - CBO - LF',
    matches: (src) => src === 'smart spirit - 25 off - cbo - lf',
  },
  {
    campaignTarget: 'Smart Spirit - 25 Off - CBO',
    matches: (src) => src.startsWith('smart_spirit_') && src.includes('25off'),
  },
  {
    campaignTarget: 'Test - Smart Spirit - Family - CBO - LF',
    matches: (src) => src === 'test - smart spirit - family - cbo - lf',
  },
  {
    campaignTarget: 'Test - Smart Spirit - Family - CBO',
    matches: (src) => src.startsWith('smart_spirit_') && src.includes('family'),
  },
  {
    campaignTarget: 'Freedom ONE WEEK LEFT - CBO - Lead Form',
    matches: (src) => src === 'freedom one week left - cbo - lead form',
  },
  {
    campaignTarget: 'Freedom ONE WEEK LEFT - CBO - Copy',
    matches: (src) => src.startsWith('freedom_warm_') || src.startsWith('freedom_interesi_'),
  },
  {
    campaignTarget: 'YOLO Last Minute - CBO - Copy',
    matches: (src) => src.startsWith('yolo_last-minute_'),
  },

  {
    // Reserved for future Belgin Sultan standalone campaign (June 2026 plan).
    // While that campaign doesn't exist in fb_ads_enriched, this rule falls through
    // (findCampaign returns null) and lead lands in Landing Turkey - Scaling - CBO below.
    // Keep `belgin_sultan`-only prefix (without 'landing_turkey_' parent) — that one
    // would only appear if Belgin gets its own UTM root convention.
    campaignTarget: 'Belgin Sultan - Turkey - CBO',
    matches: (src) => src.startsWith('belgin_sultan'),
  },
  {
    // Must come BEFORE the general 'Landing Turkey - Scaling - CBO' rule
    campaignTarget: 'Landing Turkey - Last Minute - CBO',
    matches: (src) => src.startsWith('landing_turkey_last-minute'),
  },
  {
    // Convention: all `landing_turkey_*` (esma-sultan, belgin_sultan, img, la-bella-vita,
    // ...) are ad creatives inside the Scaling parent campaign — no exclusions for
    // specific yacht names.
    campaignTarget: 'Landing Turkey - Scaling - CBO',
    matches: (src) => src.startsWith('landing_turkey') && !src.includes('last-minute'),
  },
  {
    campaignTarget: 'Landing Attainable Luxury - Prospecting - Lead - CBO',
    matches: (src) =>
      (src.startsWith('landing_attainable-luxury') ||
        src.startsWith('landing_attainable_luxury')) &&
      !src.includes('warm'),
  },
  {
    // Must come BEFORE 'Landing Gulets - Scaling - CBO 150' so v2 doesn't fall through to main
    campaignTarget: 'Test - Landing Gulets - Scaling - CBO 150',
    matches: (src) => src.startsWith('landing_gulet_v2'),
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
    matches: (src) =>
      src.startsWith('landing_attainable_luxury_warm') ||
      src.startsWith('interesi_bella_') ||
      src.startsWith('warm_bella_') ||
      src.startsWith('interesi_riva-') ||
      src.startsWith('warm_riva-') ||
      src.startsWith('interesi_ohana-') ||
      src.startsWith('warm_ohana-'),
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
    campaignTarget: 'LF - Individual Yachts - ABO',
    matches: (src) => src === 'lf - individual yachts - abo',
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
    // Explicitly ignored — dead campaigns, legacy/agency-split sources, IG referrals,
    // test sources from killed campaigns. Low volume (<1% of leads). Add new entries
    // here when audit-attribution flags one-off legacy strings rather than creating rules.
    campaignTarget: 'Unknown',
    matches: (src, raw) =>
      !raw ||
      src.trim() === '' ||
      src === 'landing_b' ||
      src.includes('lead form - all - higher intent - retargeting') ||
      src.includes('launch campaign - bofu - lead form - cbo') ||
      src === 'paid / facebook' ||
      src === 'facebook' ||
      // legacy / inactive (confirmed by Dejan 2026-05-04)
      src.startsWith('rainbowyachts') ||
      src.startsWith('andeo_') ||
      src === 'cta test - nocturno - lead form' ||
      src === 'dalmatincki_warm_social_proof_maxita-video_carousel' ||
      src.startsWith('ig / yacht matchmaker'),
  },
];

export type RuleDiagnosis =
  | { kind: 'matched'; ruleTarget: string; resolvedCampaign: string }
  | { kind: 'stale'; ruleTarget: string } // rule matched but target campaign not in active list
  | { kind: 'explicit-unknown'; ruleTarget: 'Unknown' }
  | { kind: 'unmatched' };

/**
 * Returns the matching rule's diagnosis for a given source. Useful for audit tooling
 * to distinguish "explicitly intended Unknown" (e.g. brand search noise) from
 * "no rule covers this, attribution is broken".
 */
export function diagnoseSource(
  sourcePlacement: string,
  campaigns: string[]
): RuleDiagnosis {
  const src = sourcePlacement || '';
  const normSrc = normalize(src);
  const normalizedCampaigns = campaigns.map((c) => ({ raw: c, norm: normalize(c) }));
  for (const rule of RULES) {
    if (!rule.matches(normSrc, src)) continue;
    if (rule.campaignTarget === 'Unknown') return { kind: 'explicit-unknown', ruleTarget: 'Unknown' };
    const targetNorm = normalize(rule.campaignTarget);
    const found =
      normalizedCampaigns.find((c) => c.norm === targetNorm) ||
      normalizedCampaigns.find((c) => c.norm.includes(targetNorm) || c.norm.startsWith(targetNorm));
    if (found) return { kind: 'matched', ruleTarget: rule.campaignTarget, resolvedCampaign: found.raw };
    // Rule matched but target campaign not active (e.g. killed/historical) — fall through
    // to next rule as before, but remember the last stale match.
    return { kind: 'stale', ruleTarget: rule.campaignTarget };
  }
  return { kind: 'unmatched' };
}

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
    const matched = rule.matches(normSrc, src);
    debugMatch(src, rule.campaignTarget, matched);
    if (matched) {
      const target = rule.campaignTarget;
      const targetNorm = normalize(target);
      // Prefer exact match; fall back to includes/startsWith so short targets
      // don't accidentally match longer campaign names (e.g. "...- CBO" vs "...- CBO - LF").
      const found =
        normalizedCampaigns.find((c) => c.norm === targetNorm) ||
        normalizedCampaigns.find(
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
