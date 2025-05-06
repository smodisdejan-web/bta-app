# BTA Campaign Performance Dashboard - AI Rules

## General Code Style & Naming
- Use relatively short but legible names for functions & variables
- Don't change existing variable names unless necessary
- Ensure proper TypeScript typing for all files
- Keep components focused and reusable
- Follow Next.js 13+ App Router conventions

## Google Ads Metric Naming Conventions
### Primary Metrics
- Use `impr` for Impressions
- Use `clicks` for Total Clicks
- Use `cost` for Total Cost
- Use `conv` for Conversions
- Use `value` for Conversion Value

### Calculated Metrics
- Use `CPC` for Cost per Click
- Use `CTR` for Click-Through Rate
- Use `CvR` for Conversion Rate
- Use `ROAS` for Return on Ad Spend
- Use `CPA` for Cost per Acquisition

## Data Type Handling
- Parse numeric fields with `Number()` or `parseFloat()`
- Handle all string fields appropriately
- Format dates from YYYY-MM-DD strings as needed
- Format percentages with 0 decimal places
- Format currency values according to account settings

## Component Guidelines
- Keep UI components in `src/components/`
- Place reusable UI elements in `src/components/ui/`
- Put providers in `src/components/providers/`
- Maintain clear separation of concerns between components

## Core Logic
- Keep business logic in `src/lib/`
- Place type definitions in `src/lib/types.ts`
- Store constants in `src/lib/config.ts`
- Handle data fetching in `src/lib/sheetsData.ts`
- Process metrics (core & derived) in `src/lib/metrics.ts`

## File References
@file:src/lib/types.ts
@file:src/lib/metrics.ts
@file:src/lib/config.ts

## Project Structure
Follow the established directory structure:
```
src/
├── app/                    # Next.js 13+ app directory
├── components/            # Reusable UI components
└── lib/                   # Core logic and utilities
```

## Error Handling
- Implement checks for missing/null values
- Handle API errors gracefully
- Provide user feedback for data loading states
- Validate data types before processing

## Performance Guidelines
- Optimize component re-renders
- Implement proper data caching
- Use appropriate loading states
- Follow React best practices for memoization 