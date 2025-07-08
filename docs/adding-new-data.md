# Adding New Data to BTA App: Developer Guide

This guide will walk you through the complete process of adding new data to the BTA App. We'll cover updating the Google Ads script, modifying the existing data pipeline in the Next.js application, adding the new data type, and building a new page to display the data.

## Table of Contents

1. [Overview of the Existing System](#overview-of-the-existing-system)
2. [Updating the Google Ads Script](#updating-the-google-ads-script)
3. [Modifying the App to Fetch New Data](#modifying-the-app-to-fetch-new-data)
4. [Creating a Feature Page](#creating-a-feature-page)
5. [Conclusion](#conclusion)

## Overview of the Existing System

The BTA App is a Next.js application that visualizes Google Ads data. Here's how the system currently works:

1. A Google Ads Script (`scripts/new-with-adgroups.js`) extracts data from your Google Ads account
2. The script writes data to specific tabs in a Google Sheet
3. A Google Apps Script (`deploy-sheet.js`) exposes the Sheet data as a JSON API
4. The Next.js app fetches data from this API and displays it in various visualizations

Currently, the system handles three types of data:
- **Daily campaign data**: Daily performance metrics for each campaign
- **Search terms data**: Performance metrics for search terms
- **Ad group performance data**: Performance metrics for ad groups

We'll be adding a new data type to this pipeline, for example, **Audience Performance Data**.

## Updating the Google Ads Script

We'll modify the existing `scripts/new-with-adgroups.js` to include our new data type.

### Step 1: Define Your New GAQL Query and Data Processing

First, determine the GAQL query needed for your new data - expect the user to provide this

**Example: Adding Audience Performance Data**

```javascript
// --- At the top of scripts/new-with-adgroups.js ---
const AUDIENCE_TAB = 'Audience'; // New tab name

// --- Add new GAQL query for audience data ---
const AUDIENCE_QUERY = `
SELECT
FROM
WHERE
`;

// --- Modify main() function ---
function main() {
  try {
    // ... existing sheet access ...

    // ... existing processTab calls for SearchTerms, Daily, AdGroups ...

    // Process Audiences tab (new)
    processTab(
      ss,
      AUDIENCE_TAB,
      // VERY IMPORTANT: Headers are camelCase and must match what your Next.js app expects
      ["campaignName", "adGroupName", "audienceName", "date", "clicks", "impressions", "cost", "conversions", "conversionsValue"], 
      AUDIENCE_QUERY,
      processAudienceData // New processing function
    );

  } catch (e) {
    Logger.log("Error in main function: " + e);
  }
}

// --- Add new processing function for audience data ---
function processAudienceData(rows) {
  const data = [];
  while (rows.hasNext()) {
    const row = rows.next();
    const costMicros = parseInt(row['metrics.cost_micros'], 10) || 0;

    // Create a new row with the data, ensuring keys match the headers array above
    const newRow = [
      String(row['campaign.name'] || ''),
      String(row['ad_group.name'] || ''),
      String(row['audience.audience'] || ''), // Adjust field name as per your query
      // etc
    ];
    data.push(newRow);
  }
  return data;
}

// ... existing processTab, calculateSearchTermsMetrics, processDailyData, processAdGroupData functions ...
```

**Key considerations for the Google Ads Script:**
- **Headers Array:** The `headers` array passed to `processTab` (e.g., `["campaignName", "adGroupName", ...]`) defines the exact column headers written to the Google Sheet. **These headers MUST be camelCase** and will become the JSON keys when the Next.js app fetches the data.
- **Data Order:** The order of data in the `newRow` array within your `processAudienceData` (or equivalent) function must exactly match the order of your `headers` array.
- **Calculated Metrics:** If you want pre-calculated metrics like CPC, CTR in your sheet, add them to the `headers` array and compute them within your `process[NewData]Data` function, then add them to the `newRow` array.

### Step 2: Update and Run the Script in Google Ads

1. Replace the code in your Google Ads account's `new-with-adgroups.js` script with your updated version.
2. Run the script manually to populate the new tab (e.g., "Audiences") in your Google Sheet.
3. Verify the new tab is created with the correct camelCase headers and data.
4. Ensure the script is scheduled to run regularly (e.g., daily).

## Modifying the App to Fetch New Data

Now, update the Next.js app to fetch and use this new data.

### Step 1: Update Types (`src/lib/types.ts`)

Define a TypeScript interface for your new data structure and add it to `TabData`.

```typitten
// src/lib/types.ts

// ... existing imports and interfaces (AdMetric, SearchTermMetric, AdGroupMetric, etc.) ...

// Add the new AudienceMetric interface (example)
export interface AudienceMetric {
  campaignName: string;    // camelCase, matching sheet header
  adGroupName: string;     // camelCase, matching sheet header
  audienceName: string;    // camelCase, matching sheet header
  date: string;
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  // Add any calculated metrics if they are part of the data from the sheet
}

// Update the TabData type
export type TabData = {
  daily: AdMetric[];
  searchTerms: SearchTermMetric[];
  adGroups: AdGroupMetric[];
  audiences?: AudienceMetric[]; // Add new optional property for audience data
};

// ... existing type guards and other types ...
```

### Step 2: Update Configuration (`src/lib/config.ts`)

Add your new tab to `SHEET_TABS` and configure its metrics in `TAB_CONFIGS`.

```typescript
// src/lib/config.ts
import type { MetricOptions } from './types'; // Ensure TabConfig is also imported or defined if needed

// ... existing COLORS, DEFAULT_WEB_APP_URL ...

// Update the SHEET_TABS array
export const SHEET_TABS = ['daily', 'searchTerms', 'adGroups', 'audiences'] as const; // Added 'audiences'
export type SheetTab = typeof SHEET_TABS[number];

export interface TabConfig { // If not already fully defined or imported
    name: SheetTab;
    metrics: MetricOptions;
}

// Update TAB_CONFIGS
export const TAB_CONFIGS: Record<SheetTab, TabConfig> = {
  daily: { /* ... */ },
  searchTerms: { /* ... */ },
  adGroups: { /* ... */ },
  audiences: { // New configuration for audiences tab
    name: 'audiences',
    metrics: { // Define metrics relevant for the audiences page/display
      impressions: { label: 'Impr', format: (val: number) => val.toLocaleString() },
      clicks: { label: 'Clicks', format: (val: number) => val.toLocaleString() },
      cost: { label: 'Cost', format: (val: number) => `$${val.toFixed(2)}` }, // Assuming default currency format
      conversions: { label: 'Conv', format: (val: number) => val.toFixed(1) },
      conversionsValue: { label: 'Value', format: (val: number) => `$${val.toFixed(2)}` }
      // Add CPC, CTR etc. if they are part of AudienceMetric and you want to display them
    }
  }
};
```

### Step 3: Update Data Fetching Logic (`src/lib/sheetsData.ts`)

Create a new dedicated asynchronous function to fetch and parse your new data type. Then, update `fetchAllTabsData`.

```typescript
// src/lib/sheetsData.ts
import { AdMetric, Campaign, SearchTermMetric, TabData, AdGroupMetric, AudienceMetric } from './types'; // Added AudienceMetric
import { SHEET_TABS, SheetTab, TAB_CONFIGS, DEFAULT_WEB_APP_URL } from './config';

// ... existing fetchAndParseSearchTerms, fetchAndParseAdGroups, fetchAndParseDaily ...

// Helper to fetch and parse Audience data (New Function)
async function fetchAndParseAudiences(sheetUrl: string): Promise<AudienceMetric[]> {
  const tab: SheetTab = 'audiences';
  try {
    const urlWithTab = `${sheetUrl}?tab=${tab}`;
    const response = await fetch(urlWithTab);
    if (!response.ok) {
      throw new Error(`Failed to fetch data for tab ${tab}`);
    }
    const rawData = await response.json();
    if (!Array.isArray(rawData)) {
      console.error(`Response is not an array for ${tab}:`, rawData);
      return [];
    }
    // Map the audience data - keys here (e.g., row['campaignName']) MUST match
    // the camelCase headers in your Google Sheet for the 'Audiences' tab.
    return rawData.map((row: any) => ({
      campaignName: String(row['campaignName'] || ''),
      adGroupName: String(row['adGroupName'] || ''),
      audienceName: String(row['audienceName'] || ''),
      date: String(row['date'] || ''),
      clicks: Number(row['clicks'] || 0),
      impressions: Number(row['impressions'] || 0),
      cost: Number(row['cost'] || 0),
      conversions: Number(row['conversions'] || 0),
      conversionsValue: Number(row['conversionsValue'] || 0),
    }));
  } catch (error) {
    console.error(`Error fetching ${tab} data:`, error);
    return [];
  }
}

export async function fetchAllTabsData(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<TabData> {
  const [
    dailyData,
    searchTermsData,
    adGroupsData,
    audienceData // Added audienceData
  ] = await Promise.all([
    fetchAndParseDaily(sheetUrl),
    fetchAndParseSearchTerms(sheetUrl),
    fetchAndParseAdGroups(sheetUrl),
    fetchAndParseAudiences(sheetUrl) // Added call to new function
  ]);

  return {
    daily: dailyData || [],
    searchTerms: searchTermsData || [],
    adGroups: adGroupsData || [],
    audiences: audienceData || [], // Added new data to the result
  } as TabData;
}

// ... existing getCampaigns, getMetricsByDate, getMetricOptions, swrConfig ...
```

### Step 4: Test Fetching Functionality

You can verify data is being fetched correctly by temporarily logging it, perhaps in your `SettingsContext.tsx` where `fetchedData` is available

Example: in a component that uses `useSettings()`:
```tsx
const { fetchedData } = useSettings();
useEffect(() => {
  if (fetchedData?.audiences) {
    console.log('Fetched Audiences Data (first 5):', fetchedData.audiences.slice(0,5));
  }
}, [fetchedData]);
```

## Creating a Feature Page

Once data fetching is confirmed, you can build a new page (e.g., `src/app/audiences/page.tsx`) to display this data. This process will be similar to how the `AdGroupsPage` (`src/app/adgroups/page.tsx`) or `TermsPage` (`src/app/terms/page.tsx`) are structured:

1. Use the `useSettings` hook from `SettingsContext` to access `fetchedData`, `isDataLoading`, and `dataError`.
2. Extract your specific data (e.g., `fetchedData.audiences`).
3. Use ShadCN UI components (`Table`, `Card`, etc.) for display.
4. Implement any necessary calculations or formatting using functions from `src/lib/metrics.ts` and `src/lib/utils.ts`.
5. Add links to your new page in `src/components/Navigation.tsx`.

Refer to existing pages like `src/app/adgroups/page.tsx` or `src/app/terms/page.tsx` as a template for structure, data handling, loading/error states, and styling.

The "Designing Your New Feature with LLMs" section from the previous version of this guide remains relevant for planning the UI/UX of your new page.

## Conclusion

This updated guide reflects the refactored data pipeline and emphasizes the critical importance of consistent camelCase naming for headers in the Google Sheet, which then directly translate to JSON keys used by the Next.js application. By following these steps, adding new data sources should be a more predictable process. The key is ensuring the Google Ads Script correctly prepares and writes data with the exact headers your Next.js parsing functions expect.