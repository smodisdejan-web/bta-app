/**
 * Parse EU currency format: "€25.929,57" → 25929.57
 */
function parseEuCurrency(value: string | number | null | undefined): number {
  console.log('[parseEuCurrency] INPUT:', JSON.stringify(value), 'type:', typeof value);

  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    console.log('[parseEuCurrency] Already number:', value);
    return value;
  }

  let clean = String(value).trim();
  console.log('[parseEuCurrency] After trim:', clean);

  if (!clean) return 0;

  // Remove currency symbols
  clean = clean.replace(/[€$£]/g, '');
  console.log('[parseEuCurrency] After € removal:', clean);

  // Remove spaces and non-breaking spaces
  clean = clean.replace(/[\s\u00A0]/g, '');
  console.log('[parseEuCurrency] After space removal:', clean);

  // Guard against dates/invalid long strings
  if (clean.includes('GMT') || clean.includes('T') || clean.length > 20) {
    console.log('[parseEuCurrency] Looks like date/invalid, returning 0');
    return 0;
  }

  // If has comma followed by exactly 2 digits at end, assume EU decimal
  const euDecimalMatch = clean.match(/,(\d{2})$/);

  if (euDecimalMatch) {
    clean = clean.replace(/\./g, '').replace(',', '.');
    console.log('[parseEuCurrency] EU format result:', clean);
  } else if (clean.includes(',')) {
    // US format or thousands-only: just remove commas
    clean = clean.replace(/,/g, '');
    console.log('[parseEuCurrency] US format result:', clean);
  } else {
    // No commas, leave dots as-is (already decimal)
    console.log('[parseEuCurrency] No comma adjustment:', clean);
  }

  const result = parseFloat(clean) || 0;
  console.log('[parseEuCurrency] FINAL:', result);
  return result;
}

export interface FbDashboardData {
  spend: number;
  lpViews: number;
  clicks: number;
  leads: number;
  costPerLpView: number;
  cplpv: number;
  cpl: number;
  startDate: string;
  endDate: string;
  preset: string;
}

/**
 * Load pre-aggregated Facebook data from the dashboard_fb tab (key-value structure).
 */
export async function loadFbDashboard(): Promise<FbDashboardData> {
  const sheetsUrl = process.env.NEXT_PUBLIC_SHEETS_URL;
  if (!sheetsUrl) {
    console.error('[loadFbDashboard] NEXT_PUBLIC_SHEETS_URL not set');
    return getEmptyFbData();
  }

  try {
    const url = `${sheetsUrl}?tab=dashboard_fb&_ts=${Date.now()}`;
    console.log('[loadFbDashboard] Fetching:', url);

    const response = await fetch(url, {
      cache: 'no-store',
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const rows = await response.json();
    console.log('[loadFbDashboard] Raw rows:', Array.isArray(rows) ? rows.length : 0);

    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn('[loadFbDashboard] No data returned');
      return getEmptyFbData();
    }

    // Parse object format from Sheets where "End date" holds the label (col A) and another key holds the value (col B)
    const data: Record<string, string> = {};
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;

      // Prefer the "End date" column (column A) as the label
      const labelRaw = (row as any)['End date'] ?? (row as any)['end date'] ?? '';

      // Find the first key that is NOT the label column to use as value (column B)
      const valueKey = Object.keys(row).find(
        (k) => k && k.toLowerCase() !== 'end date'
      );

      const valueRaw = valueKey ? (row as any)[valueKey] : undefined;
      const label = normalizeKey(labelRaw || '');
      const value = valueRaw != null ? String(valueRaw) : '';

      if (label) {
        data[label] = value;
        console.log(`[loadFbDashboard] Parsed: "${labelRaw}" (${label}) = "${value}"`);
      }
    }

    const result: FbDashboardData = {
      spend: parseEuCurrency(data['spend']),
      lpViews: parseEuCurrency(data['lpviews']),
      clicks: parseEuCurrency(data['clicks']),
      leads: parseEuCurrency(data['leads']),
      costPerLpView: parseEuCurrency(data['costperlpview']),
      cplpv: parseEuCurrency(data['cplpv'] || data['costperlpview']),
      cpl: parseEuCurrency(data['cplleads'] || data['cpl']),
      startDate: data['startraw'] || data['start'] || '',
      endDate: data['enddate'] || '',
      preset: data['preset'] || '30d'
    };

    console.log('[loadFbDashboard] Result:', result);
    return result;
  } catch (error) {
    console.error('[loadFbDashboard] Error:', error);
    return getEmptyFbData();
  }
}

function normalizeKey(key: string): string {
  return String(key)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

function getEmptyFbData(): FbDashboardData {
  return {
    spend: 0,
    lpViews: 0,
    clicks: 0,
    leads: 0,
    costPerLpView: 0,
    cplpv: 0,
    cpl: 0,
    startDate: '',
    endDate: '',
    preset: '30d'
  };
}

