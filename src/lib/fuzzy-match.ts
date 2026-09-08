// Streak source_placement (utm_content) -> FB campaign matching rules.
// SOURCE OF TRUTH for FB QL attribution in the live bta dashboard.
//
// KEEP IN SYNC with code/goolets/mtd-fuzzy-match.js — the two files must carry an
// IDENTICAL rule set (only the module syntax differs). Change one, change the other.
//
// Rulebook: Dejan-confirmed utm→campaign rules, 2026-08-07 / 2026-08-08
// (memory: project_goolets_utm_coverage_gap; analysis:
//  ppcos/goolets/context/analysis/2026-08-07-placement-campaign-mapping-todo.md).
// Measured on streak-sync.json (2026-08-08 pull): July 2026 1949/1956 FB leads (99.6%),
// 1.-7. 8. 2026 450/451 (99.8%). The residue is structurally unresolvable: empty utm,
// bare ids that are not campaign ids, `Facebook`, `ig / instagram_stories`.
//
// ORDER MATTERS: first matching rule wins, specific before general. In particular
//   - `-cro-lux` suffix BEFORE any ad-name startsWith rule
//   - `tosca_interesi_onur-*` (TURKEY Creative Test) BEFORE `tosca_*` (Tosca - Cold)
//   - `-jul` ad-set suffixes (base decides the campaign) BEFORE the bare nocturno rule
//   - `rare-ops_<vessel>-form<N>` (Prava forma clone) BEFORE `rare-ops_<vessel>`
// No fuzzy logic — exact / prefix / suffix / substring only.

type Rule = {
  campaignTarget: string;
  matches: (sourceFlat: string, sourceRaw: string) => boolean;
  /** Campaign optimises for Complete Registration, not Lead — exclude from QL/CPQL. */
  metric?: 'complete_registration';
};

/** lowercase + strip diacritics (DALMATINČKI exists precomposed AND combining) + drop
 *  replacement chars + collapse whitespace. Used for campaign-name comparisons. */
const normalize = (s: unknown) =>
  String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** normalize() + punctuation unification: every run of space / underscore / slash /
 *  hyphen / en-dash / em-dash becomes a single `_`. This is what ALL rules match on,
 *  so `landing gulet carousel`, `landing-gulet-carousel` and `landing_gulet_carousel`
 *  are the same key (3 July leads were "noise" purely because of this), and campaign
 *  names written with en-dashes (`ASSET – TOSCA – RareOps – ABO`) resolve too. */
const flatten = (s: unknown) =>
  normalize(s)
    .replace(/[\s_/\u2010-\u2015-]+/g, '_')
    .replace(/^_+|_+$/g, '');

// Verbose per-rule logging — opt-in via env var so the audit script doesn't drown.
const FUZZY_DEBUG = typeof process !== 'undefined' && process.env.FUZZY_MATCH_DEBUG === '1';
function debugMatch(sourcePlacement: string, ruleName: string, matched: boolean) {
  if (!FUZZY_DEBUG) return;
  console.log('INPUT:', sourcePlacement, '→ FLAT:', flatten(sourcePlacement), 'RULE:', ruleName, 'MATCH:', matched);
}

const isRareOps = (s: string) => s.startsWith('rare_ops');
const isFormClone = (s: string) => /_form\d/.test(s);

const RULES: Rule[] = [
  // ── 1. CRO LUX GULET — `-cro-lux` suffix. MUST precede every ad-name startsWith rule.
  // Cannot separate "Avgust 2026" (PAUSED) from the "– Nova konverzija" clone: same ads.
  {
    campaignTarget: 'CRO LUX GULET',
    matches: (src) => src.endsWith('_cro_lux') || src.includes('_cro_lux_'),
  },

  // ── 2. Bare numeric source_placement that IS a known campaign id (checked before the
  // "numeric = noise" Unknown rule at the bottom).
  {
    campaignTarget: 'Landing Gulets - Scaling - CBO 150',
    matches: (src) => src === '120238914531570087',
  },
  {
    campaignTarget: 'Belgin Sultan - Turkey - Cold - ABO - LF',
    matches: (src) => src === '120247328449180087',
  },

  // ── 3. Yacht Matchmaker – Lead Magnet: does NOT tag utm_content, Streak leads arrive
  // as the `ig|fb / <campaign name>` fallback. Optimises for Complete Registration —
  // exclude from QL / CPQL comparisons.
  {
    campaignTarget: 'Yacht Matchmaker - Lead Magnet - CBO',
    matches: (src) => src.includes('yacht_matchmaker'),
    metric: 'complete_registration',
  },

  // ── 4. Alessandro — three separate namespaces (Smarter / Discount / Dalmatinčki ad).
  {
    campaignTarget: 'Alessandro - Discount - CBO - Lead Form',
    matches: (src) => src === 'alessandro_discount_cbo_lead_form',
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
    // `alessandro-1-onetake_…-dalmatinčki` is a Dalmatinčki – Julij 2026 ad
    // (also runs under CRO LUX — cross-funnel leak, flagged separately).
    campaignTarget: 'Dalmatinčki - Julij 2026',
    matches: (src) => src.startsWith('alessandro_1_onetake'),
  },

  // ── 5. Dalmatinčki – Julij 2026: utm = ad name verbatim (5 ad sets = 5 ads).
  {
    campaignTarget: 'Dalmatinčki - Julij 2026',
    matches: (src) => src.startsWith('social_best_anima_maris'),
  },
  {
    campaignTarget: 'Dalmatinčki - Julij 2026',
    matches: (src) => src.startsWith('dalmatino_sales_'),
  },
  {
    campaignTarget: 'Dalmatinčki - Julij 2026',
    matches: (src) => src.startsWith('maxita_onetake'),
  },

  // ── 6. `-jul` ad-set suffix family. The SUFFIX is the ad set, the BASE decides the
  // campaign (`-jul` alone is not enough — both campaigns use it).
  {
    campaignTarget: 'Dalmatino - Julij 2026',
    matches: (src) => src.startsWith('dalmatino_official'),
  },
  {
    // covers `-warm-jul`, `-int-jul`, `-lookalike-jul` and their `-v4-` twins
    campaignTarget: 'Nocturno - Julij 2026',
    matches: (src) => src.startsWith('nocturno_onetake') && /_jul$/.test(src),
  },
  {
    // `nocturno-onetake_…-v4` (no -jul) is the Dalmatinčki – Julij ad
    campaignTarget: 'Dalmatinčki - Julij 2026',
    matches: (src) => src.startsWith('nocturno_onetake') && /_v4$/.test(src),
  },
  {
    // bare `nocturno-onetake_…` (no -v4, no -jul) — 96.5% of the spend sits here
    campaignTarget: 'Test - Dalmatinčki - Sail Smarter - CRO-001 Test',
    matches: (src) => src.startsWith('nocturno_onetake'),
  },

  // ── 7. Turkey.
  {
    // TRAP: Onur's creatives live in the Creative Test campaign, NOT in Tosca.
    campaignTarget: 'TURKEY - Creative Test - ABO',
    matches: (src) => src.startsWith('tosca_interesi_onur'),
  },
  {
    campaignTarget: 'Tosca - Turkey - Cold - ABO - LF',
    matches: (src) => src.startsWith('tosca') && src.endsWith('_lf'),
  },
  {
    campaignTarget: 'Tosca - Turkey - Cold - ABO',
    matches: (src) => src.startsWith('tosca'),
  },
  {
    campaignTarget: 'TURKEY - Creative Test - ABO',
    matches: (src) => src.startsWith('turkey_general'),
  },
  {
    campaignTarget: 'TURKEY - Calculator - ABO',
    matches: (src) => src.startsWith('turkey_calculator'),
  },
  {
    campaignTarget: 'Belgin Sultan - Turkey - Cold - ABO - LF',
    matches: (src) => src.startsWith('belgin') && src.endsWith('_lf'),
  },
  {
    campaignTarget: 'Belgin Sultan - Turkey - Cold - ABO',
    matches: (src) => src.startsWith('belgin'),
  },
  {
    // COLD ad set (`landing_turkey_cold_<ad>`, 94% of the campaign's spend) and the
    // `last-minute_miha-sever_*` ad sets both belong to Last Minute.
    // TRAP: `landing_turkey_la-bella-vita` (without cold_onetake) is Scaling.
    campaignTarget: 'Landing Turkey - Last Minute - CBO',
    matches: (src) =>
      src.startsWith('landing_turkey_last_minute') || src.startsWith('landing_turkey_cold'),
  },
  {
    campaignTarget: 'Landing Turkey - Scaling - CBO',
    matches: (src) => src.startsWith('landing_turkey'),
  },

  // ── 8. ASSET / RareOps. `-form<N>` marker = the CRO-004 "Prava forma" clone; the base
  // campaign never carries the marker, so the form rule must come first per vessel.
  {
    campaignTarget: 'Prava forma - ASSET - Anima Maris - RareOps - ABO',
    matches: (src) => isRareOps(src) && src.includes('anima_maris') && isFormClone(src),
  },
  {
    campaignTarget: 'ASSET - Anima Maris - RareOps - ABO',
    matches: (src) => isRareOps(src) && src.includes('anima_maris'),
  },
  {
    campaignTarget: 'Prava forma - ASSET - TOSCA - RareOps - ABO',
    matches: (src) => isRareOps(src) && src.includes('tosca') && isFormClone(src),
  },
  {
    campaignTarget: 'ASSET - TOSCA - RareOps - ABO',
    matches: (src) => isRareOps(src) && src.includes('tosca'),
  },
  {
    campaignTarget: 'Prava forma - ASSET - Dalmatino - RareOps - ABO',
    matches: (src) => isRareOps(src) && src.includes('_dalmatino_') && isFormClone(src),
  },
  {
    campaignTarget: 'ASSET - Dalmatino - RareOps - ABO',
    matches: (src) => isRareOps(src) && src.includes('_dalmatino_'),
  },

  // ── 9. BOFU – Attainable Luxury: three ad-set families + the bare angle-name variant.
  {
    campaignTarget: 'BOFU - Landing Attainable Luxury - Objections crusher',
    matches: (src) =>
      src.startsWith('landing_attainable_luxury_warm') ||
      src.startsWith('interesi_bella') ||
      src.startsWith('warm_bella') ||
      src.startsWith('interesi_riva') ||
      src.startsWith('warm_riva') ||
      src.startsWith('interesi_ohana') ||
      src.startsWith('warm_ohana') ||
      src.startsWith('risk_reversal_eleganza'),
  },
  {
    campaignTarget: 'Landing Attainable Luxury - Prospecting - Lead - CBO',
    matches: (src) => src.startsWith('landing_attainable_luxury') && !src.includes('warm'),
  },

  // ── 10. Landing-page campaigns.
  {
    // must precede 'Landing Gulets - Scaling - CBO 150' so v2 doesn't fall through
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
    campaignTarget: 'Landing Mega Yachts',
    matches: (src) => src.startsWith('landing_mega_yachts'),
  },
  {
    campaignTarget: 'Individual Yachts',
    matches: (src) => src.startsWith('lp_individual_yachts'),
  },
  {
    campaignTarget: 'LF - Individual Yachts - ABO',
    matches: (src) => src === 'lf_individual_yachts_abo',
  },
  {
    campaignTarget: 'Landing Unmatched Value - Objections crusher ads',
    matches: (src) => src.startsWith('landing_unmatched_value_1_'),
  },
  {
    campaignTarget: 'Test - Landing Unmatched Value Forma 2 - Objections crusher ads',
    matches: (src) => src.startsWith('landing_unmatched_value_2_'),
  },

  // ── 11. Dalmatinčki CRO / SCALE / TEST families.
  {
    campaignTarget: 'Test - Dalmatinčki - Sail Smarter - CRO-001 Test',
    matches: (src) => src.startsWith('dalmatincki_smart_luxury_sailing'),
  },
  {
    campaignTarget: 'Dalmatinčki - Sail Smarter - CRO-001 Control',
    matches: (src) => src.startsWith('dalmatincki_sail_smarter'),
  },
  {
    campaignTarget: 'Dalmatinčki - Exclusive Seasonal Selection - Last minute - CBO',
    matches: (src) =>
      src.startsWith('dalmatincki_angle') ||
      (src.includes('dalmatincki') && src.includes('exclusive_seasonal_selection')),
  },
  {
    campaignTarget: 'Dalmatinčki - SCALE - Tier 1 + Tier 2 - CBO 200',
    matches: (src) => src.startsWith('dalmatincki_scale_tier1_tier2_cbo'),
  },
  {
    campaignTarget: 'Dalmatinčki - SCALE - Tier 2 - CBO',
    matches: (src) => src.startsWith('dalmatincki_scale_tier2') || src === 'dalmatincki_scale_lookalike',
  },
  {
    campaignTarget: 'Dalmatinčki - TEST Angle - Tier1 - LP',
    matches: (src) => src.startsWith('dalmatincki_test_tier1') || src.includes('dalmatincki_mofu'),
  },
  {
    campaignTarget: 'Dalmatinčki - TEST Angle - Tier1 - Lead Form',
    matches: (src) =>
      src.includes('dalmatincki_test_angle_tier1_lead_form') ||
      src.startsWith('test_lead_form_dalmatincki') ||
      src.startsWith('test_dalmatincki_test_angle') ||
      src.includes('dalmatincki_test_angle_tier2_lead_form'),
  },

  // ── 12. Single-vessel / seasonal campaigns.
  {
    campaignTarget: 'Smart Spirit - 25 Off - CBO - LF',
    matches: (src) => src === 'smart_spirit_25_off_cbo_lf',
  },
  {
    campaignTarget: 'Smart Spirit - 25 Off - CBO',
    matches: (src) => src.startsWith('smart_spirit_') && src.includes('25off'),
  },
  {
    campaignTarget: 'Test - Smart Spirit - Family - CBO - LF',
    matches: (src) => src === 'test_smart_spirit_family_cbo_lf',
  },
  {
    campaignTarget: 'Test - Smart Spirit - Family - CBO',
    matches: (src) => src.startsWith('smart_spirit_') && src.includes('family'),
  },
  {
    campaignTarget: 'Freedom ONE WEEK LEFT - CBO - Lead Form',
    matches: (src) => src === 'freedom_one_week_left_cbo_lead_form',
  },
  {
    campaignTarget: 'Freedom ONE WEEK LEFT - CBO - Copy',
    matches: (src) => src.startsWith('freedom_warm_') || src.startsWith('freedom_interesi_'),
  },
  {
    campaignTarget: 'YOLO Last Minute - CBO - Copy',
    matches: (src) => src.startsWith('yolo_last_minute_'),
  },
  {
    // August 2026 relaunch. Its ad sets are tagged `yolo_short9_<audience>-aug` where the audience
    // is abbreviated: warm / int(erests) / lla(=lookalike, the account's standing convention).
    // Without this the campaign showed Leads 0 / QL – / TOO EARLY while actually running 10 leads
    // and 6 QL at EUR 91.79 CPQL (SCALE) — its leads sat in the "fix your ad naming" row instead.
    campaignTarget: 'YOLO - August 2026',
    matches: (src) => src.startsWith('yolo_short9') || (src.startsWith('yolo_') && /-aug$/.test(src)),
  },
  {
    // Same shape, same month: `alessandro_add_august-<audience>-aug` (lookalike / int / warm).
    // These three sources are 21 August leads and 17 QL against EUR 1,985 (CPQL EUR 117); without
    // the rule the campaign reads "0 leads" and looks dead while it is the account's newest test.
    campaignTarget: 'Alessandro - August 2026',
    matches: (src) => src.startsWith('alessandro_add_august'),
  },

  // ── 13. Evergreen / seasonal umbrella campaigns.
  {
    // CORE 7 Social Proof: the ad NAME is written backwards relative to the utm
    // (`ad3-why-cnn - AVGUST_CORE7_MITJA_VERTICAL_MASSIVE_SOCIAL_PROOF_Long`), so neither the
    // ad-name resolver nor any prefix rule could reach it and the campaign rendered 0 leads
    // over 5 real leads / 3 QL on EUR 313 (caught 2026-09-08). The `core7` prefix is unique to
    // this campaign in the account, so the whole family maps on it.
    campaignTarget: 'CORE 7 Social Proof - Croatia 2027 - ABO',
    matches: (src) => src.startsWith('core7'),
  },
  {
    // all 11 Dobrik creatives run only here — 100% clean
    campaignTarget: 'DOBRIK x CRISTAL - Croatia 2027 - CBO',
    matches: (src) => src.startsWith('dobrik_'),
  },
  {
    // single utm `earlybook2027_tier1` — ad-set split is impossible
    campaignTarget: 'Early Booking - Croatia 2027 - CBO',
    matches: (src) => src.startsWith('earlybook2027') || src.startsWith('early_booking') || src.includes('earlybook2027'),
  },
  {
    // legacy `lastminute2026_tier1/2` = the same campaign (ad sets keep the EB name)
    campaignTarget: 'Last Minute - Croatia 2026 - CBO',
    matches: (src) =>
      src.startsWith('lastminute2026') ||
      src.startsWith('last_minute_2026') ||
      src.startsWith('landing_last_minute'),
  },
  {
    campaignTarget: 'Anima Maris + Maxita TEST - ABO',
    matches: (src) => (src.startsWith('anima_maris') || src.startsWith('maxita')) && !src.includes('dalmatincki'),
  },
  {
    campaignTarget: 'BOOST - 2026 - Engagement',
    matches: (src) => src === 'awareness_landing' || src === 'charter_a_dream_interior' || src === 'new_videos',
  },
  {
    campaignTarget: 'Lead Form - All - All Creatives - Scaling',
    matches: (src) => src.includes('lead_form_all_all_creatives'),
  },
  {
    campaignTarget: 'Instagram Stories',
    matches: (src) => src.includes('instagram_stories'),
  },

  // ── 14. Explicitly ignored — dead campaigns, legacy/agency-split sources, IG referrals,
  // bare-id noise. Low volume (<1% of leads). Add new entries here when audit-attribution
  // flags a one-off legacy string rather than creating a rule.
  {
    campaignTarget: 'Unknown',
    matches: (src, raw) =>
      raw == null ||
      raw === '' ||
      src === '' ||
      src === 'landing_b' ||
      src.includes('lead_form_all_higher_intent_retargeting') ||
      src.includes('launch_campaign_bofu_lead_form_cbo') ||
      src === 'paid_facebook' ||
      src === 'facebook' ||
      // legacy / inactive (confirmed by Dejan 2026-05-04)
      src.startsWith('rainbowyachts') ||
      src.startsWith('andeo_') ||
      src === 'cta_test_nocturno_lead_form' ||
      src === 'dalmatincki_warm_social_proof_maxita_video_carousel' ||
      // non-FB / referrer / bare-id noise (confirmed 2026-06-16)
      src === 'google' ||
      // Microsoft/Bing Ads — imported Google campaigns carry the `MS - ` prefix in
      // utm_campaign (set 2026-09-02). Not Facebook, so explicitly Unknown here.
      src.startsWith('ms_') ||
      src === 'instagram' ||
      src === 'instagram_referrer' ||
      src.startsWith('landing_cnn') ||
      /^\d+$/.test(src),
  },
];

/** Campaigns that optimise for Complete Registration (lead magnet), not Lead.
 *  Exclude them from QL / CPQL comparisons. */
export const COMPLETE_REGISTRATION_TARGETS: string[] = RULES.filter(
  (r) => r.metric === 'complete_registration'
).map((r) => r.campaignTarget);

export function isCompleteRegistrationSource(sourcePlacement: string): boolean {
  const flat = flatten(sourcePlacement);
  for (const rule of RULES) {
    if (rule.matches(flat, sourcePlacement)) return rule.metric === 'complete_registration';
  }
  return false;
}

/** LF campaigns emit utm_content = the CAMPAIGN NAME (lowercased), not an ad name.
 *  Resolve those by exact name identity before any rule runs. */
function resolveByCampaignName(
  flatSrc: string,
  normalizedCampaigns: { raw: string; flat: string }[]
): string | null {
  if (flatSrc.length < 6) return null;
  const hit = normalizedCampaigns.find((c) => c.flat === flatSrc);
  return hit ? hit.raw : null;
}

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
export function diagnoseSource(sourcePlacement: string, campaigns: string[]): RuleDiagnosis {
  const src = sourcePlacement || '';
  const flatSrc = flatten(src);
  const normalizedCampaigns = campaigns.map((c) => ({ raw: c, flat: flatten(c) }));
  const byName = resolveByCampaignName(flatSrc, normalizedCampaigns);
  if (byName) return { kind: 'matched', ruleTarget: byName, resolvedCampaign: byName };
  for (const rule of RULES) {
    if (!rule.matches(flatSrc, src)) continue;
    if (rule.campaignTarget === 'Unknown') return { kind: 'explicit-unknown', ruleTarget: 'Unknown' };
    const targetFlat = flatten(rule.campaignTarget);
    const found =
      normalizedCampaigns.find((c) => c.flat === targetFlat) ||
      normalizedCampaigns.find((c) => c.flat.includes(targetFlat) || c.flat.startsWith(targetFlat));
    if (found) return { kind: 'matched', ruleTarget: rule.campaignTarget, resolvedCampaign: found.raw };
    // Rule matched but target campaign not active (e.g. killed/historical) — fall through
    // to the next rule as before, but remember the last stale match.
    return { kind: 'stale', ruleTarget: rule.campaignTarget };
  }
  return { kind: 'unmatched' };
}

export function matchSourceToCampaign(
  sourcePlacement: string,
  campaigns: string[],
  _threshold: number = 70
): string | null {
  const src = sourcePlacement == null ? '' : sourcePlacement;
  const flatSrc = flatten(src);
  const normalizedCampaigns = campaigns.map((c) => ({ raw: c, flat: flatten(c) }));

  // LF campaigns: utm_content IS the campaign name.
  const byName = resolveByCampaignName(flatSrc, normalizedCampaigns);
  if (byName) return byName;

  for (const rule of RULES) {
    const matched = rule.matches(flatSrc, src);
    debugMatch(String(src), rule.campaignTarget, matched);
    if (matched) {
      const targetFlat = flatten(rule.campaignTarget);
      // Prefer exact match; fall back to includes/startsWith so short targets
      // don't accidentally match longer campaign names (e.g. "...- CBO" vs "...- CBO - LF").
      const found =
        normalizedCampaigns.find((c) => c.flat === targetFlat) ||
        normalizedCampaigns.find((c) => c.flat.includes(targetFlat) || c.flat.startsWith(targetFlat));
      if (found) return found.raw;
    }
  }
  // Fallback: Unknown bucket
  const unknown = normalizedCampaigns.find((c) => c.flat.includes('unknown'));
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

export { normalize, flatten, RULES };
