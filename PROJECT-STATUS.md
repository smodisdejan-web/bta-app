 # Project Status

 ## File Structure (src/)
 ```
 src/
 ├── app/
 │   ├── adgroups/page.tsx
 │   ├── api/
 │   │   ├── ai-health/route.ts
 │   │   ├── auth/route.ts
 │   │   ├── dashboard-totals/route.ts
 │   │   ├── debug/google-matching/route.ts
 │   │   ├── diag/route.ts
 │   │   ├── fb/summary/route.ts
 │   │   ├── fb-preset/route.ts
 │   │   ├── health/route.ts
 │   │   ├── insights/
 │   │   │   ├── ask/route.ts
 │   │   │   ├── route.ts
 │   │   │   └── summary/route.ts
 │   │   ├── landing-pages/route.ts
 │   │   ├── openai-health/route.ts
 │   │   ├── overview/route.ts
 │   │   ├── sheets-probe/route.ts
 │   │   ├── test-tracker/route.ts
 │   │   └── vessel-funnel/route.ts
 │   ├── budgets/page.tsx
 │   ├── dev/test-data/page.tsx
 │   ├── error.tsx
 │   ├── facebook-ads/page.tsx
 │   ├── ga4-landing-pages/page.tsx
 │   ├── globals.css
 │   ├── google-ads/page.tsx
 │   ├── insights/page.tsx
 │   ├── landing-pages/page.tsx
 │   ├── layout.tsx
 │   ├── not-found.tsx
 │   ├── overview/page.tsx
 │   ├── overview-test/page.tsx
 │   ├── page.tsx
 │   ├── settings/page.tsx
 │   ├── terms/page.tsx
 │   ├── tests/page.tsx
 │   ├── unlock/UnlockClient.tsx
 │   ├── unlock/page.tsx
 │   └── vessel-funnel/page.tsx
 ├── components/ (cards, charts, forms, navigation, AI widgets, UI primitives)
 │   ├── ai/InsightsGenerator.tsx
 │   ├── overview/*.tsx
 │   ├── providers/ClientProviders.tsx
 │   └── ui/*.tsx
 ├── hooks/ (ad group data, insights, pagination, toast)
 ├── lib/
 │   ├── ai.ts, api-router.ts, budgetPacing.ts, config.ts
 │   ├── facebook-ads.ts, google-ads.ts, ga4-landing-pages.ts
 │   ├── loaders/fb-dashboard.ts
 │   ├── metrics/, overview-data*.ts, parsers.ts
 │   ├── sheets.ts, sheetsData*.ts, sync-fb-preset.ts
 │   ├── utils.ts, types.ts, vessel-*.ts
 │   └── contexts/SettingsContext.tsx
 ├── middleware.ts
 └── types/luxon.d.ts
 ```

 ## Pages / Routes (app/)
 - `/` (`page.tsx`): Command Center dashboard combining FB/Google spend, leads, bookings, revenue, AI summary, and funnel visuals driven by Sheets + `/api/dashboard-totals`.
 - `/adgroups`: Ad group performance explorer with filtering, sorting, pagination, and charting using Sheets ad group data.
 - `/budgets`: Budget planning/pacing with CSV upload, CRUD, sorting, and campaign filtering; uses local storage helpers in `budgetPacing`.
 - `/facebook-ads`: Facebook Ads dashboard (enriched/raw) with spend/leads trends and AI overlays (uses `facebook-ads.ts` + Sheets).
 - `/ga4-landing-pages`: GA4 landing page performance (sessions/conversions) with top/leaky pages, source/device splits.
 - `/google-ads`: Google Ads campaign explorer with AI metrics, spend/conv trends, bookings overlay from Sheets/Streak.
 - `/insights`: AI assistant surface for marketing questions (front-end to insights APIs).
 - `/landing-pages`: Landing page summaries (sessions/conversions) and breakdowns.
 - `/overview` & `/overview-test`: Legacy/alternate overview dashboards similar to `/`.
 - `/settings`: App settings + sheet URL/config controls (via `SettingsContext`).
 - `/terms`, `/error`, `/not-found`: Static/supporting pages.
 - `/tests`: Test tracker UI (aligns with test-tracker API).
 - `/unlock`: Password gate (sets `ai_unlock` cookie for middleware).
 - `/vessel-funnel`: Vessel-specific funnel metrics (uses vessel profiles).
 - `/dev/test-data`: Development view for sample/test data.

 ## API Routes (app/api)
 - `GET /api/ai-health`: Masked OPENAI key presence check.
 - `POST /api/auth`: Password check (`UNLOCK_PASSWORD` or fallback) sets `ai_unlock` cookie.
 - `GET /api/dashboard-totals?days=`: FB + Google spend/leads totals over window.
 - `GET /api/debug/google-matching`: Debug Google lead→campaign matching, spend, CPQL expectations.
 - `GET /api/diag`: Reports presence of OpenAI/Anthropic/Gemini keys.
 - `GET /api/fb/summary`: Facebook dashboard aggregates via `loadFbDashboard`.
 - `POST /api/fb-preset`: Sends preset selection to Sheets webhook (`NEXT_PUBLIC_SHEETS_URL`).
 - `GET /api/health`: Reports configured Sheets URL env var.
 - `POST /api/insights`: General AI insights (OpenAI chat) for a prompt.
 - `POST /api/insights/ask`: Builds rich marketing context (Sheets + bookings + leads) and returns OpenAI-generated bullets plus context.
 - `POST /api/insights/summary`: Similar to `/ask` but focused summary bullets/context.
 - `GET /api/landing-pages?days=`: GA4 landing page metrics (totals, top performers, leaky buckets, timeseries, breakdowns).
 - `GET /api/openai-health`: Masked OPENAI key check.
 - `GET /api/overview?days=&cacMode=`: Combined overview payload (FB + Google + overview data).
 - `GET /api/sheets-probe?tab=&from=&to=`: Probes a Sheets tab, inspects headers, counts, deduped spend/lp/clicks windows.
 - `GET /api/test-tracker`: Merges test tracker rows with FB enriched + Streak leads for variant metrics and debug info.
 - `GET /api/vessel-funnel?vesselId=&days=`: Vessel funnel metrics for a vessel profile.

 ## Google Sheets Integration
 - Base URL resolution: `NEXT_PUBLIC_SHEETS_URL` or `NEXT_PUBLIC_SHEET_API_URL`; fallback `DEFAULT_WEB_APP_URL` (Apps Script webhook). `requireSheetsUrl()` throws if absent.
 - Core tabs (`SHEET_TABS`): `daily`, `searchTerms`, `adGroups`. Extended tabs (`SHEETS_TABS`): `fb_ads_enriched`, `fb_ads_raw`, `fb_adsets_enriched`, `test_tracker`, `streak_sync`, `streak_leads`, `streak_leads_google`, `adGroups`, `daily`, `bookings`.
 - Data loaders in `sheetsData.ts` fetch tabs via `fetchJson` (2D arrays or objects), normalize headers, dedupe by date/campaign, and expose helpers: `loadGoogleTraffic`, `loadFbTraffic`, `fetchFbEnriched`, `fetchStreak*`, `fetchBookings`, `fetchTestTracker`, etc.
 - Consumers:
   - Dashboards (`/`, `/overview`, `/facebook-ads`, `/google-ads`, `/landing-pages`, `/vessel-funnel`, `/tests`, `/adgroups`) load Sheets tabs for spend/leads/GA4 sessions/bookings and render charts.
   - APIs (`dashboard-totals`, `insights/*`, `landing-pages`, `overview`, `test-tracker`, `sheets-probe`) read Sheets data to compute aggregates, insights context, and diagnostics.
 - Data flow highlights:
   - Google Ads: `daily` tab → spend/clicks/conversions by date; aggregated in API and pages.
   - Facebook Ads: `fb_ads_enriched` (fallback `fb_ads_raw`) → spend, LP views, leads; deduped by date+campaign.
   - Leads: `streak_sync` / `streak_leads(_google)` → lead + AI score streams for quality metrics.
   - Bookings: `bookings` tab → revenue/booking counts; used for ROAS and funnel steps.
   - Test tracker: `test_tracker` tab merged with FB/Streak to compute variant KPIs.

 ## Known Bugs / TODOs
 - No TODO/FIXME markers in project source; only template TODOs in `.git_backup/hooks/sendemail-validate.sample`. No tracked code issues surfaced via search.

 ## Last 10 Git Commits
 - b89d7c8 (2026-02-26) debug: include fb date samples and align matching
 - f4b18ee (2026-02-26) debug: add no-date fb match samples to test tracker
 - 7cfa8a1 (2026-02-26) debug: return campaign matching details in test tracker api
 - 5423d6b (2026-02-26) debug: log test tracker campaign matching
 - beb0a4f (2026-02-26) add funnel metrics to test tracker
 - dd3f0b9 (2026-02-26) heartbeat: overnight check 2026-02-26
 - 3dd2273 (2026-02-25) heartbeat: overnight check 2026-02-25
 - e8f0d24 (2026-02-24) redesign tests page
 - d9f435b (2026-02-24) feat: add test tracker dashboard
 - 941ac6c (2026-02-24) heartbeat: overnight check 2026-02-24

 ## package.json (key dependencies)
 - Runtime: `next ^16.1.1`, `react ^18`, `react-dom ^18`
 - UI/UX: `@tremor/react 3.18.7`, `lucide-react 0.436.0`, `@radix-ui/* 1.x/2.x`, `framer-motion 11.3.31`
 - Data/Charts: `d3 7.9.0`, `recharts 3.2.1`, `@tanstack/react-table 8.21.3`, `swr 2.3.0`
 - Forms/Validation: `react-hook-form 7.54.2`, `zod 3.24.1`, `@hookform/resolvers 3.10.0`
 - Auth/AI: `openai 6.7.0`, `firebase 10.13.0`
 - Tooling: `typescript ^5`, `tsx 4.7.1`, `eslint ^8`, `tailwindcss ^3.4.1`

 ## Environment Variables (from .cursor/.env.template)
 - `OPENAI_API_KEY`
 - `ANTHROPIC_API_KEY`
 - `GEMINI_API_KEY`
 - `DEFAULT_OPENAI_MODEL`
 - `DEFAULT_ANTHROPIC_MODEL`
 - `DEFAULT_GEMINI_MODEL`

 ## Vercel / Next Config
 - `next.config.mjs`: ignores ESLint/TypeScript errors during build; allows remote images from `https://placehold.co/**`; enables SVG with CSP sandbox; no rewrites defined.
 - `vercel.json`: not present.
