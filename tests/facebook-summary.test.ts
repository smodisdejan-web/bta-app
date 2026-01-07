import assert from 'node:assert';
import test from 'node:test';

import { getFacebookSummaryLast30d } from '../src/lib/metrics/facebook';

const makeSheetsClient = (raw: any[][], enriched: any[][]) => ({
  readRange: async (tab: string) => (tab === 'fb_ads_raw' ? raw : enriched),
});

test('dedupes spend by date + campaign + adset', async () => {
  const raw = [
    ['date_start', 'campaign_name', 'adset_name', 'spend'],
    ['2024-02-01', 'Camp A', 'Set 1', '100'],
    ['2024-02-01', 'Camp A', 'Set 1', '50'], // duplicate key
    ['2024-02-02', 'Camp A', 'Set 2', '25'],
  ];
  const enriched = [['date_start', 'lp_views', 'clicks', 'fb_form_leads', 'landing_leads']];

  const summary = await getFacebookSummaryLast30d(makeSheetsClient(raw, enriched));
  assert.strictEqual(summary.spend, 175);
});

test('anchors 30d window on max date across tabs', async () => {
  const raw = [['date_start', 'campaign_name', 'adset_name', 'spend'], ['2024-01-10', 'Camp A', 'Set 1', '10']];
  const enriched = [['date_start', 'lp_views', 'clicks', 'fb_form_leads', 'landing_leads'], ['2024-02-05', 5, 3, 1, 2]];

  const summary = await getFacebookSummaryLast30d(makeSheetsClient(raw, enriched));
  assert.strictEqual(summary.end, '2024-02-05');
  assert.strictEqual(summary.start, '2024-01-07');
  assert.strictEqual(summary.lpViews, 5);
  assert.strictEqual(summary.leads, 3);
});

test('guards division by zero for CPL and CPLPV', async () => {
  const raw = [['date_start', 'campaign_name', 'adset_name', 'spend']];
  const enriched = [['date_start', 'lp_views', 'clicks', 'fb_form_leads', 'landing_leads']];

  const summary = await getFacebookSummaryLast30d(makeSheetsClient(raw, enriched));
  assert.strictEqual(summary.cpl, 0);
  assert.strictEqual(summary.cplpv, 0);
});

