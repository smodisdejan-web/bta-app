# Data Insights Setup Guide

## Overview
The Data Insights page allows you to explore and analyze your advertising data with AI-powered insights using various Large Language Models (LLMs).

## Features
- **Data Source Selection**: Choose from Search Terms, Ad Groups, or Daily performance data
- **Dynamic Filtering**: Apply multiple filters to narrow down your analysis
- **Data Preview**: Sortable table view with configurable row count
- **Statistical Summary**: Automatic calculation of metrics (min, max, avg, sum) and dimension analysis
- **AI-Powered Insights**: Generate contextual insights using Gemini, GPT-4, or Claude

## API Keys Setup

To use the AI Insights feature, you need to configure at least one LLM provider API key.

### Option 1: Google Gemini (Recommended for getting started)
1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create an API key
3. Add to your `.env.local` file:
   ```
   NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key_here
   ```

### Option 2: OpenAI GPT-4
1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create an API key
3. Add to your `.env.local` file:
   ```
   NEXT_PUBLIC_OPENAI_API_KEY=your_openai_api_key_here
   ```

### Option 3: Anthropic Claude
1. Visit [Anthropic Console](https://console.anthropic.com/)
2. Create an API key
3. Add to your `.env.local` file:
   ```
   NEXT_PUBLIC_ANTHROPIC_API_KEY=your_anthropic_api_key_here
   ```

## Usage

### 1. Select Data Source
Choose which dataset you want to analyze from the dropdown menu:
- **Search Terms**: User search query data with performance metrics
- **Ad Groups**: Ad group level performance data
- **Daily**: Daily campaign performance data

### 2. Apply Filters (Optional)
Add one or more filters to refine your analysis:
- Click "Add Filter" to create a new filter
- Select the column, operator, and value
- Filters use AND logic (all filters must match)

### 3. Review Data Preview
- View a sortable table of your filtered data
- Click column headers to sort
- Adjust the number of rows displayed using the dropdown

### 4. Check Data Summary
View automatic statistical summaries:
- **Metrics**: Min, max, average, and sum for numeric columns
- **Dimensions**: Unique value counts and top values for categorical columns

### 5. Generate AI Insights
1. Select your preferred AI model
2. Enter a natural language prompt describing what you want to know
3. Click "Generate Insights"
4. View the AI-generated analysis and recommendations

### Example Prompts
- "What are the top performing search terms and why?"
- "Identify any patterns or trends in the data"
- "What optimization recommendations would you make?"
- "Which ad groups are underperforming and what could be improved?"

## Technical Details

### Data Handling
- Maximum of 100 rows are sent to the AI API to prevent overload
- All filtering and sorting happens client-side for performance
- Data summaries are calculated in real-time

### Filter Operators
- **Text/Dimension**: contains, does not contain, equals, not equals, starts with, ends with
- **Numeric/Metric**: equals, not equals, greater than, less than, >=, <=
- **Date**: equals, not equals, after, before, on or after, on or before

### File Structure
```
src/
├── app/insights/
│   └── page.tsx              # Main Data Insights page component
├── hooks/
│   └── use-data-insights.ts  # Custom hook for state management
└── lib/
    ├── api-router.ts         # LLM API integration
    └── types.ts              # TypeScript type definitions
```

## Troubleshooting

### "API key not configured" error
Make sure you have added the appropriate API key to your `.env.local` file and restarted your development server.

### No data available
Ensure your Google Sheets data is properly connected in Settings and that data has been fetched successfully.

### Slow AI response
- Try reducing the number of filters to analyze more or less data
- Some models (like GPT-4) may take longer to respond
- Check your internet connection

## Cost Considerations
- Each AI model has different pricing structures
- Gemini typically offers a generous free tier
- Token usage is displayed after each insight generation
- Consider limiting the amount of data analyzed for cost efficiency


