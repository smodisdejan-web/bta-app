import { loadFbSpend, loadGoogleSpend, loadContacts, loadDeals, DateRange } from './sheetsData-new';

export type CACMode = 'leads' | 'deals';

export async function getDateRange(days = 30): Promise<DateRange> {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - (days-1)*86400_000);
  const ymd = (d:Date)=> d.toISOString().slice(0,10);
  return { from: ymd(from), to: ymd(to) };
}

export async function getOverviewData(days = 30, cacMode: CACMode = 'leads') {
  const range = await getDateRange(days);
  const [fb, ga, contacts, deals] = await Promise.all([
    loadFbSpend(range),
    loadGoogleSpend(range),
    loadContacts(range),
    loadDeals(range),
  ]);
  const spend = (fb.spend || 0) + (ga.spend || 0);
  const leads = contacts.leads || 0;
  const wonDeals = deals.wonDeals || 0;
  const revenue = deals.revenue || 0;
  const avgDealSize = deals.avgDealSize || 0;
  const cac = cacMode === 'leads'
    ? (leads > 0 ? spend / leads : 0)
    : (wonDeals > 0 ? spend / wonDeals : 0);
  const roas = spend > 0 ? revenue / spend : 0;
  return {
    kpis: { spend, leads, wonDeals, revenue, avgDealSize, cac, roas },
    range,
    __debug: {
      fb: fb.__debug, google: ga.__debug, contacts: contacts.__debug, deals: deals.__debug
    }
  };
}

