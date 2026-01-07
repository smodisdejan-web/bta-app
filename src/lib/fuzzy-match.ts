// Manual mapping: Streak SOURCE PLACEMENT -> FB Campaign Name
// Exact matches first, then prefix patterns
const MANUAL_MAPPING: [string, string][] = [
  // Exact matches (normalized - will match both č and ƒç variants)
  ["landing_attainable-luxury_lead", "Landing Attainable Luxury  - Prospecting - Lead - CBO"],
  ["dalmatincki - test angle - tier2 - lead form", "Dalmatinčki - TEST Angle - Tier2 - Lead Form"],
  ["test - lead form dalmatincki - mofu - angle test - tier 1", "Test - Lead Form Dalmatinčki - MOFU - Angle test - Tier 1"],
  ["test - dalmatincki - bofu - lead form", "Test - Dalmatinčki - BOFU - Lead form"],
  ["landing_attainable-luxury-spanish_la", "P1: Landing Attainable Luxury ES  - LATIN AMERICA"],
  ["lead form - all - higher intent - retargeting", "Lead Form - All - Higher intent - RETARGETING"],
  ["launch campaign - bofu - lead form - cbo", "Launch Campaign - BOFU - Lead Form - CBO"],
  ["test - dalmatincki - test angle - tier1 - lead form", "Test - Dalmatinčki - TEST Angle - Tier1 - Lead Form"],
  ["dalmatincki - test angle - tier1 - lead form", "Dalmatinčki - TEST Angle - Tier1 - Lead Form"],
  ["landing_attainable-luxury", "Landing Attainable Luxury  - Prospecting - Lead - CBO"],
];

// Prefix patterns (if source STARTS WITH pattern, map to campaign)
const PREFIX_MAPPING: [string, string][] = [
  ["landing_attainable_luxury_warm", "BOFU - Landing Attainable Luxury - Objections crusher"],
  ["dalmatincki_scale_tier2", "Dalmatinčki - SCALE - Tier 2 - CBO"],
  ["dalmatincki_scale_tier1", "Dalmatinčki - SCALE - Tier 1 - CBO"],
  ["landing_attainable-luxury-brazil", "P1: Landing Attainable Luxury - Brazil"],
  ["test_tier1", "TEST Angle - Tier1 - LP"],
  ["dalmatincki_mofu", "Landing Dalmatinčki - MOFU - Angle test - Tier 1"],
  ["landing-cnn", "Landing CNN - Videos - Old Campaign"],
  ["dalmatincki_test_tier1_nocturno", "Dalmatinčki - Nocturno - Tier 1 - PRO - CBO"],
  ["dalmatincki_test_tier1_alessandro", "Dalmatinčki - Alessandro - Tier 1 - PRO - CBO"],
  ["dalmatincki_test_tier1_maxita", "Dalmatinčki - Maxita - Tier 1 - PRO - CBO"],
  ["dalmatincki_test_tier1_dalmatino", "Dalmatinčki - Dalmatino - Tier 1 - PRO - CBO"],
  ["dalmatincki_warm", "BOFU - Landing Attainable Luxury - Objections crusher"],
  ["nocturno", "Dalmatinčki - Nocturno - Tier 1 - PRO - CBO"],
  ["dalmatino", "Dalmatinčki - Dalmatino - Tier 1 - PRO - CBO"],
  ["alessandro", "Dalmatinčki - Alessandro - Tier 1"],
];

// Normalize string for matching (handle encoding issues)
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ƒç/g, 'c')  // Fix encoding: ƒç -> c
    .replace(/[čćç]/g, 'c')
    .replace(/[šś]/g, 's')
    .replace(/[žź]/g, 'z')
    .replace(/[đ]/g, 'd')
    .replace(/[\s\-_]+/g, ' ')
    .trim();
}

// Normalize for prefix matching (remove all separators)
function normalizeForPrefix(s: string): string {
  return normalize(s).replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Match single source to campaign using manual mapping
export function matchSourceToCampaign(
  sourcePlacement: string,
  campaigns: string[],
  threshold: number = 70
): string | null {
  const sourceNorm = normalize(sourcePlacement);
  const sourcePrefix = normalizeForPrefix(sourcePlacement);
  
  // 1. Try exact matches first
  for (const [pattern, campaign] of MANUAL_MAPPING) {
    if (normalize(pattern) === sourceNorm) {
      // Verify campaign exists in list
      const match = campaigns.find(c => c === campaign);
      if (match) return match;
    }
  }
  
  // 2. Try prefix matches
  for (const [prefix, campaign] of PREFIX_MAPPING) {
    if (sourcePrefix.startsWith(normalizeForPrefix(prefix))) {
      const match = campaigns.find(c => c === campaign);
      if (match) return match;
    }
  }
  
  // 3. Fallback: try fuzzy matching (contains logic)
  for (const campaign of campaigns) {
    const campNorm = normalize(campaign);
    
    // Check if key identifying words match
    const sourceWords = new Set(sourceNorm.split(' ').filter(w => w.length > 3));
    const campWords = new Set(campNorm.split(' ').filter(w => w.length > 3));
    
    const intersection = [...sourceWords].filter(w => campWords.has(w));
    if (intersection.length >= 2) {
      return campaign;
    }
  }
  
  return null;
}

// Batch match all leads to campaigns
export function matchLeadsToCampaigns(
  leads: { source_placement: string }[],
  campaigns: string[]
): Map<string, string> {
  const mapping = new Map<string, string>();
  const uniqueSources = [...new Set(leads.map(l => l.source_placement))];
  
  let matched = 0;
  let unmatched = 0;
  
  for (const source of uniqueSources) {
    const match = matchSourceToCampaign(source, campaigns);
    if (match) {
      mapping.set(source, match);
      matched++;
    } else {
      unmatched++;
      // Log unmatched for debugging
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Fuzzy] Unmatched source: "${source}"`);
      }
    }
  }
  
  console.log(`[Fuzzy] Matched ${matched}/${uniqueSources.length} sources (${unmatched} unmatched)`);
  
  return mapping;
}

