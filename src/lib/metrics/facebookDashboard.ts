export type FBSummary = {
  preset: string;
  windowStartISO: string;
  windowEndISO: string;
  spend: number;
  lpViews: number;
  clicks: number;
  leads: number;
  cplpv: number;
  cpl: number;
};

const SHEET_ID = process.env.GOOGLE_SHEETS_ID!;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY!;

function toNum(v: any) {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export async function getFBSummaryFromSheet(): Promise<FBSummary> {
  const ranges = [
    'dashboard_fb!B2',  // preset
    'dashboard_fb!B5',  // start
    'dashboard_fb!B1',  // end
    'dashboard_fb!B6',  // spend
    'dashboard_fb!B7',  // lp views
    'dashboard_fb!B8',  // clicks
    'dashboard_fb!B9',  // leads
    'dashboard_fb!B10', // cplpv
    'dashboard_fb!B11', // cpl
  ];

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${ranges
    .map((r) => `ranges=${encodeURIComponent(r)}`)
    .join('&')}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&key=${API_KEY}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    console.error('Sheets fetch failed', await res.text());
    return { preset: '-', windowStartISO: '-', windowEndISO: '-', spend: 0, lpViews: 0, clicks: 0, leads: 0, cplpv: 0, cpl: 0 };
  }
  const json = await res.json();
  const v = (i: number) => json.valueRanges?.[i]?.values?.[0]?.[0];

  return {
    preset: String(v(0) ?? '-'),
    windowStartISO: String(v(1) ?? '-'),
    windowEndISO: String(v(2) ?? '-'),
    spend: toNum(v(3)),
    lpViews: toNum(v(4)),
    clicks: toNum(v(5)),
    leads: toNum(v(6)),
    cplpv: toNum(v(7)),
    cpl: toNum(v(8)),
  };
}

