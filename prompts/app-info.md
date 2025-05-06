# Build The Agent - Campaign Performance Dashboard

## Project Structure

src/
├── app/                    # Next.js 13+ app directory
│   ├── page.tsx           # Main dashboard - displays metrics & charts
│   ├── settings/          # Settings route
│   │   └── page.tsx       # Settings config (Sheet URL, currency)
│   └── terms/             # Search terms route
│       └── page.tsx       # Search terms analysis table
├── components/            # Reusable UI components
│   ├── providers/         # Provider components
│   │   └── ClientProviders.tsx  # Client-side providers wrapper
│   ├── ui/                # shadcn/ui components
│   ├── CalculatedMetrics.tsx  # Metrics calculation component
│   ├── CampaignSelect.tsx  # Campaign filter dropdown
│   ├── DashboardPage.tsx  # Main dashboard layout
│   ├── MetricCard.tsx     # Individual metric display cards
│   ├── MetricsChart.tsx   # D3-based chart component
│   ├── MetricsScorecard.tsx  # Metrics summary scorecard
│   ├── MetricComparisonList.tsx  # Metric comparison component
│   └── Navigation.tsx     # App navigation component
├── lib/                   # Core logic and utilities
│   ├── contexts/         
│   │   └── SettingsContext.tsx  # Global settings state
│   ├── sheetsData.ts     # Google Sheets data fetching
│   ├── metrics.ts        # Metric calculations (Core & Derived)
│   ├── types.ts          # TypeScript definitions
│   ├── utils.ts          # Formatting helpers
│   └── config.ts         # App constants

## Metrics Structure

### Primary Metrics
- impr: Impressions
- clicks: Total Clicks
- cost: Total Cost
- conv: Conversions
- value: Conversion Value

### Calculated Metrics (Calculated on Frontend)
- CTR: Click-Through Rate (clicks/impr)
- CPC: Cost per Click (cost/clicks)
- CvR: Conversion Rate (conv/clicks)
- ROAS: Return on Ad Spend (value/cost)
- CPA: Cost per Acquisition (cost/conv)

## Data Flow
1. Data source: Google Sheet published as web app (outputs only core metrics)
2. Frontend fetches data via sheetsData.ts
3. Core metrics processed and derived metrics calculated in metrics.ts
4. UI updates via React state/context

## Key Features
- Real-time metric dashboard
- Interactive metric cards
- Dual-metric comparison charts
- Campaign filtering
- Configurable currency display
- Settings persistence in localStorage

## Tech Stack
- Next.js 13+ (App Router)
- TypeScript
- D3.js for charts
- shadcn/ui components
- Local storage for settings

## Development Notes
- All pages must live in src/app/
- Follow metric naming conventions strictly
- Use TypeScript for type safety
- Keep components focused and reusable
