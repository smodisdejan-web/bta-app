/**
 * @OnlyCurrentDoc  
 * Responds to HTTP GET requests to serve spreadsheet data as JSON.
 * @param {GoogleAppsScript.Events.AppsScriptHttpRequestEvent} e The event parameter.
 * @return {GoogleAppsScript.Content.TextOutput} JSON data from the specified tab.
 */
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = e.parameter.tab || 'daily';
  
  // Get the sheet by name
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({
      error: 'Sheet not found: ' + tabName
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }

  // Get data from the sheet
  var data = sheet.getDataRange().getValues();
  var headers = data.shift();
  var jsonData = data.map(function(row) {
    var obj = {};
    headers.forEach(function(header, index) {
      obj[header] = row[index];
    });
    return obj;
  });

  return ContentService.createTextOutput(JSON.stringify(jsonData))
    .setMimeType(ContentService.MimeType.JSON);
}