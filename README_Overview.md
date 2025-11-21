# Marketing Overview Page

## Overview

The `/overview` page provides a comprehensive cross-channel marketing performance dashboard that aggregates data from multiple sources (Facebook Ads, Google Ads, HubSpot) to give executives and marketing teams a unified view of paid marketing performance.

## Data Sources

The overview page expects the following Google Sheets tabs:

### Required Tabs

1. **`fb_ads_raw`** - Facebook Ads insights by day/campaign/adset
   - Columns: `date`, `campaign`, `adset` (optional), `ad` (optional), `spend`, `impressions`, `clicks`, `landing_page_view`, `landing_page_view_unique`

2. **`hubspot_deals_raw`** - HubSpot deals data
   - Columns: `dealId` (or `deal_id` or `hs_object_id`), `dealname` (or `deal_name`), `amount` (or `deal_amount`), `closedate` (or `close_date`), `dealstage` (or `deal_stage`), `createdate` (or `create_date`), `utm_source`, `utm_medium`, `utm_campaign`

3. **`hubspot_contacts_raw`** or **`hubspot_contacts_90d`** - HubSpot contacts
   - Columns: `contactId` (or `contact_id` or `hs_object_id`), `email`, `createdate` (or `create_date`), `utm_source`, `utm_medium`, `utm_campaign`

### Optional Tabs

4. **`marketing_funnel`** or named range **`MARKETING_FUNNEL`** - Pre-aggregated funnel data
   - Columns: `date`, `lp_views`, `leads`, `sql`, `deals`, `revenue`

5. **`google ads`** or **`google_ads_raw`** - Google Ads data (if present)
   - Currently used for additional spend data if available

## Environment Variables

### Required

- `NEXT_PUBLIC_SHEET_URL` (or configured via Settings page) - Google Sheets Web App URL

### Optional (for AI Features)

- `OPENAI_API_KEY` - OpenAI API key for AI-generated insights
  - If not set, the system will use rule-based fallback summaries
  - Recommended model: `gpt-4o-mini` (cost-effective)

## Features

### 1. Executive Summary (Auto-Generated)

- Automatically generates up to 5 bullet points highlighting key changes
- Compares current period vs previous period
- Highlights notable increases/decreases in CPC, CAC, Win Rate, ROAS, Leads, SQL, Deals, Revenue
- Includes "cause hints" (e.g., cost spikes, win rate changes)
- Regeneratable via "Regenerate" button

### 2. KPI Cards

**Business Metrics (HubSpot):**
- Revenue Won (EUR)
- Won Deals
- Win Rate (Won Deals / Total Deals Created)
- Avg Deal Size (Revenue / Won Deals)

**Acquisition Metrics:**
- Spend (FB + Google)
- Leads (HubSpot contacts from paid channels)
- CAC (Spend / Leads or / Won Deals - toggleable)
- ROAS (Revenue / Spend)

Each card shows:
- Absolute value
- Δ% vs previous period
- Tiny sparkline chart for trend visualization
- Color-coded deltas (green for positive, red for negative)

### 3. Marketing Funnel

Horizontal funnel visualization:
- **LP Views** → **Leads** → **SQL** → **Deals** → **Revenue**
- Shows conversion rates between steps
- Displays Δ vs previous period below each arrow

### 4. Performance Trends

- Main chart: Revenue vs Spend (daily lines)
- Mini charts: Win Rate, CAC, ROAS trends

### 5. Top Movers

Two tables showing:
- **Top Positive Movers** - Campaigns with largest positive revenue changes
- **Top Negative Movers** - Campaigns with largest negative revenue changes

Columns: Campaign, Channel, Spend, Leads, CAC, Deals, Revenue, Δ%

### 6. AI Insights Generator

Free-form question interface:
- Ask questions about marketing performance
- Returns up to 5 bullet point answers
- Copy-to-clipboard functionality
- Uses current filters and date range as context

## Attribution Logic

The system uses HubSpot as the source of truth for Leads, SQL, Deals, and Revenue.

**Attribution:**
1. Primary: HubSpot UTM fields (`utm_source`, `utm_medium`, `utm_campaign`)
2. Fallback: Ad platform names (Facebook, Google)

**Paid Channel Detection:**
A contact is considered "paid" if:
- `utm_source` contains: `google`, `facebook`, `meta`, `cpc`, `paid`, `adwords`, `fb`
- OR `utm_medium` contains: `cpc`, `paid`, `social`, `display`

## Date Range & Comparison

- **Date Ranges:** Last 30d (default), 60d, 90d, Custom
- **Comparison:** Toggle to compare with previous period (default: ON)
- Previous period is calculated as the same number of days before the current range

## Filters

- **Channel:** All, Google Ads, Facebook Ads
- **Market/Country:** (if present in data)
- **Campaign:** Searchable campaign filter

## Technical Implementation

### Data Flow

1. Client requests data via `getOverviewMetrics()`, `getDailyMetrics()`, `getCampaignPerformance()`
2. Server-side functions fetch from Google Sheets via Web App URL
3. Data is aggregated and filtered by date range
4. Metrics are calculated (CAC, ROAS, Win Rate, etc.)
5. Comparison deltas are computed if `comparePrevious` is enabled
6. Data is returned to client for rendering

### API Routes

- **`/api/insights/summary`** - Generates executive summary
  - POST body: `{ filters, sheetUrl }`
  - Returns: `{ bullets: string[] }`
  
- **`/api/insights/ask`** - Answers free-form questions
  - POST body: `{ prompt, filters, sheetUrl }`
  - Returns: `{ bullets: string[] }`

### Components

All components are located in `src/components/overview/`:
- `TopBar.tsx` - Date range, filters, controls
- `KpiCard.tsx` - Individual KPI card with sparkline
- `Funnel.tsx` - Funnel visualization
- `RevenueSpendChart.tsx` - Main revenue/spend chart
- `MiniMetric.tsx` - Mini trend chart
- `TopMovers.tsx` - Top movers tables
- `AiSummary.tsx` - Executive summary display
- `AiAsk.tsx` - AI question interface

## Currency & Formatting

- Default currency: EUR (€)
- Formatting: `Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR' })`
- Timezone: CET/CEST
- Date granularity: Daily

## Error Handling

- Missing tabs: Returns empty arrays, page still renders
- Missing API keys: Falls back to rule-based summaries
- Network errors: Shows error messages, allows retry

## Future Enhancements

- Saved Views functionality
- Export to CSV/PDF
- Custom date range presets
- More granular channel breakdowns
- Real-time data updates
- Email report scheduling

