// scripts/use-this-for-week3.js
const SHEET_URL = '';                     // add your sheet url here
const SEARCH_TERMS_TAB = 'searchTerms';
const DAILY_TAB = 'daily';

      calculateSearchTermsMetrics // Still use this, but it will be simplified
    );

    // Process Daily tab - Simplified headers
    processTab(
      ss,
      DAILY_TAB,
      // Headers: Only core metrics + identifiers
      ["date", "campaign", "campaignId", "impr", "clicks", "cost", "conv", "value"],
      DAILY_QUERY,
      processDailyData // This function already returns data mostly in this format
    );

  } catch (e) {
    Logger.log("Error in main function: " + e);
  }
}

function processTab(ss, tabName, headers, query, dataProcessor) {
  try {
    // Get or create the tab
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
    } else {
      // Clear existing data
      sheet.clearContents();
    }

    // Set headers
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");

    // Run the query
    const report = AdsApp.report(query);
    const rows = report.rows();

    // Process data
    const data = dataProcessor(rows);

    // Write data to sheet (only if we have data)
    if (data.length > 0) {
      sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
      Logger.log("Successfully wrote " + data.length + " rows to the " + tabName + " sheet.");
    } else {
      Logger.log("No data found for " + tabName + ".");
    }
  } catch (e) {
    Logger.log("Error in processTab function for " + tabName + ": " + e);
  }
}

function calculateSearchTermsMetrics(rows) {
  const data = [];
  while (rows.hasNext()) {
    const row = rows.next();
    const searchTerm = row['search_term_view.search_term'];
    const keywordText = row['segments.keyword.info.text'];
    const campaign = row['campaign.name'];
    const adGroup = row['ad_group.name'];
    const impr = parseInt(row['metrics.impressions'], 10) || 0;
    const clicks = parseInt(row['metrics.clicks'], 10) || 0;
    const costMicros = parseInt(row['metrics.cost_micros'], 10) || 0;
    const conv = parseFloat(row['metrics.conversions']) || 0;
    const value = parseFloat(row['metrics.conversions_value']) || 0;

    const cost = costMicros / 1000000;

    const newRow = [searchTerm, keywordText, campaign, adGroup, impr, clicks, cost, conv, value];

    data.push(newRow);
  }
  return data;
}

function processDailyData(rows) {
  const data = [];
  while (rows.hasNext()) {
    const row = rows.next();

    // Extract data according to the simplified headers
    const campaign = String(row['campaign.name'] || '');
    const campaignId = String(row['campaign.id'] || '');
    const impr = Number(row['metrics.impressions'] || 0);
    const clicks = Number(row['metrics.clicks'] || 0);
    const costMicros = Number(row['metrics.cost_micros'] || 0);
    const cost = costMicros / 1000000;  // Convert micros to actual currency
    const conv = Number(row['metrics.conversions'] || 0);
    const value = Number(row['metrics.conversions_value'] || 0);
    const date = String(row['segments.date'] || '');

    // Create a new row matching the simplified Daily headers
    const newRow = [date, campaign, campaignId, impr, clicks, cost, conv, value];

    // Push new row to the data array
    data.push(newRow);
  }
  return data;
}
