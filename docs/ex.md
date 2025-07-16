# Negative Keywords Suggestion Feature PRD

## Project Overview
Adding a new feature to the existing React app that analyzes search terms data to suggest potential negative keywords. This feature will help users identify poorly performing search terms that should be excluded from their Google Ads campaigns.

## Problem Statement
Users need to regularly review search terms to identify queries that are generating clicks and spend but not conversions. Currently, this process requires manual analysis of search terms data. This feature will automate the identification of potential negative keywords, saving time and improving campaign efficiency.

## Core Features
- **Spend Filter Slider**: Filter search terms by minimum spend amount (default: $10)
- **Conversion Filter Slider**: Filter by conversion thresholds (0, <1, <2 conversions)
- **Data Display**: Show filtered search terms with key metrics (spend, conversions, clicks)
- **Suggestion Engine**: Generate negative keyword recommendations from filtered data
- **Export Capability**: Allow users to copy or export suggested negative keywords

## User Flow
1. User navigates to "Negative Keywords" tab in the app
2. User adjusts spend filter slider (minimum spend threshold)
3. User adjusts conversion filter slider (maximum conversions)
4. System displays filtered search terms that meet both criteria
5. User clicks "Generate Suggestions" button
6. System analyzes data and presents suggested negative keywords
7. User reviews suggestions and can copy/export selected keywords

## Success Criteria
- Feature correctly filters search terms based on spend and conversion criteria
- Suggested negative keywords are relevant and actionable
- Interface is intuitive and matches existing app design
- Data loads and filters perform smoothly with 30 days of search terms data
- Export functionality works reliably

## Technical Requirements
- Built as new tab/page in existing React app
- Reads search terms data from Google Sheets (last 30 days)
- Uses existing data structure and API setup
- Responsive design consistent with current app styling
- Client-side filtering for performance

## Data Sources
- **Primary**: Search terms data from Google Sheets
- **Required fields**: Search term, spend, conversions, clicks, impressions
- **Date range**: Last 30 days (as configured in existing script)
- **Data structure**: Existing search terms tab format

## Timeline & Phases

### Phase 1: Basic Filtering & Display
- [x] Create new "Negative Keywords" page/tab
- [x] Add navigation to new page
- [ ] Implement spend filter slider ($0-$100 range)
- [ ] Implement conversion filter slider (0, <1, <2 options)
- [ ] Display filtered search terms in table format
- [ ] Add basic styling consistent with app

### Phase 2: Suggestion Engine
- [ ] Implement suggestion algorithm (search terms that meet filter criteria)
- [ ] Consider n-gram analysis for broader match suggestions
- [ ] Display suggested negative keywords in organized format
- [ ] Add explanation/reasoning for each suggestion

### Phase 3: Export & Polish
- [ ] Add copy-to-clipboard functionality
- [ ] Add export to CSV option
- [ ] Implement loading states and error handling
- [ ] Add help text/tooltips for user guidance
- [ ] Performance optimization for large datasets

## Out of Scope
- **Version 1 Exclusions**:
  - Automatic negative keyword application to campaigns
  - Integration with Google Ads API for direct upload
  - Historical trend analysis
  - Machine learning-based suggestion improvements
  - Custom date range selection (using existing 30-day default)
  - Advanced n-gram analysis (unless simple implementation proves effective)

## Design Notes
- Use existing app's color scheme and layout patterns
- Sliders should have clear value indicators
- Table should be sortable by key metrics
- Suggestion format should be clear and actionable
- Consider using same chart/visualization style as existing features

## Technical Implementation Notes
- Filter operations should happen client-side for responsiveness
- Consider debouncing slider changes to avoid excessive re-filtering
- Ensure data format matches existing search terms structure
- Use existing utility functions for data fetching and processing

---

*This PRD should be updated as development progresses. Each completed item should be checked off, and new requirements or scope changes should be documented.*