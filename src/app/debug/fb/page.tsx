import 'server-only';
import { fetchFbEnriched, fetchSheet, FbEnrichedRow } from '@/lib/sheetsData';

function fmtEUR(n: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(n);
}

export default async function FbDebugPage() {
  let rows: FbEnrichedRow[] = [];
  let error: string | null = null;

  try {
    rows = await fetchFbEnriched(fetchSheet);
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  // Calculate totals from enriched rows
  const totals = rows.reduce(
    (acc, r) => {
      acc.lp += r.lp_views
      acc.formLeads += r.fb_form_leads
      acc.landingLeads += r.landing_leads
      acc.spend += r.spend
      return acc
    },
    { lp: 0, formLeads: 0, landingLeads: 0, spend: 0 }
  );

  const dates = rows
    .map(r => r.date_iso || r.date_start)
    .filter(Boolean)
    .sort();

  const firstDay = dates[0] ?? '—';
  const lastDay  = dates[dates.length - 1] ?? '—';

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">FB Data Smoke-Test</h1>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <div className="font-medium text-red-700">Error loading fb_ads_enriched</div>
          <pre className="mt-2 text-sm whitespace-pre-wrap text-red-800">{error}</pre>
        </div>
      ) : (
        <>
          <div className="rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-gray-500">LP Views</div>
              <div className="text-xl font-semibold">{totals.lp.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Leads (FB Forms)</div>
              <div className="text-xl font-semibold">{totals.formLeads.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Leads (Landing)</div>
              <div className="text-xl font-semibold">{totals.landingLeads.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Spend</div>
              <div className="text-xl font-semibold">{fmtEUR(totals.spend)}</div>
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <div className="text-sm text-gray-500">Detected Date Range</div>
            <div className="text-lg">{firstDay} → {lastDay}</div>
          </div>

          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer font-medium">Sample rows (first 10)</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-gray-600">
                    <th className="px-2 py-1 text-left">Date</th>
                    <th className="px-2 py-1 text-left">Campaign</th>
                    <th className="px-2 py-1 text-right">LP Views</th>
                    <th className="px-2 py-1 text-right">FB Form</th>
                    <th className="px-2 py-1 text-right">Landing Lead</th>
                    <th className="px-2 py-1 text-right">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1">{r.date_iso || r.date_start}</td>
                      <td className="px-2 py-1">{r.campaign_name}</td>
                      <td className="px-2 py-1 text-right">{r.lp_views.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right">{r.fb_form_leads.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right">{r.landing_leads.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right">{fmtEUR(r.spend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer font-medium">Raw vs Parsed Spend Check (first 5 rows)</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-gray-600">
                    <th className="px-2 py-1 text-left">Campaign</th>
                    <th className="px-2 py-1 text-left">Raw Spend Cell</th>
                    <th className="px-2 py-1 text-right">Parsed Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1">{r.campaign_name}</td>
                      <td className="px-2 py-1 font-mono text-xs">{r.spend}</td>
                      <td className="px-2 py-1 text-right font-semibold">{fmtEUR(r.spend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </main>
  );
}

