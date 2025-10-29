Product Requirements Document: Data Insights Page
Version: 1.0 Date: August 4 2025 Author: Mike Rhodes

1. Introduction
The Data Insights page serves as an interactive workspace for users to explore, analyze, and derive qualitative insights from their advertising data. Users can select various datasets, apply filters to refine their view, examine summarized statistics, and leverage Large Language Models (LLMs) to generate textual analysis based on their data and specific prompts. This document outlines the requirements for building a robust and user-friendly Data Insights page.

2. Goals
Data Exploration: Enable users to easily select and view different data sources (e.g., Search Terms, Ad Groups, Daily performance metrics).
Targeted Analysis: Provide powerful and intuitive filtering capabilities to allow users to drill down into specific segments of their data.
Quick Understanding: Offer a concise statistical summary of the currently filtered dataset to highlight key figures and distributions.
AI-Powered Insights: Allow users to generate contextual, qualitative insights from their data by interacting with various LLMs through custom prompts.
Usability: Ensure a clear, intuitive, and responsive user interface that guides the user through the analysis process.
3. Target Users
Data Analysts: Users who need to perform ad-hoc analysis, identify trends, and understand the nuances within their advertising campaign data.
Marketing Professionals: Marketers looking to understand campaign performance, identify optimization opportunities, and generate reports or narratives based on data.
Account Managers: Individuals who need to quickly understand data for client reporting or strategic decision-making.
4. Key Features & Functional Requirements
4.1. Data Source Selection
FR4.1.1: A dropdown menu shall allow users to select an active data source.
Examples: "SearchTerms", "AdGroups", "Daily", "CampaignStatus", etc. (configurable list).
FR4.1.2: Upon selecting a new data source, the system shall:
Retrieve the corresponding raw data.
Automatically derive columns and their types (see 4.2).
Reset any existing filters, summaries, and AI insights.
Update the data preview table (see 4.3).
FR4.1.3: The list of data sources in the dropdown should be dynamically populated based on available data tabs or a predefined configuration.
FR4.1.4: A default data source (e.g., "SearchTerms") should be selected and loaded when the page is first visited, if data is available.
4.2. Column Derivation and Management
FR4.2.1: When a data source is loaded, the system must parse the data and derive a list of columns.
FR4.2.2: Each derived column must be assigned a data type (e.g., 'metric', 'dimension', 'date'). This typing is crucial for:
Determining available filter operators.
Formatting values in the preview table.
Performing appropriate calculations in the summary section.
FR4.2.3: Column names should be user-friendly (e.g., "Ad Group ID" instead of "adGroupId").
4.3. Data Preview Table
FR4.3.1: A table shall display a preview of the currently selected and filtered data.
FR4.3.2: A dropdown control shall allow users to select the number of rows to display in the preview table (e.g., options: 5, 10, 30, 50, 100 rows).
FR4.3.3: Table columns shall be sortable. Clicking a column header should sort the data in ascending order; a subsequent click should sort in descending order.
FR4.3.4: The table should clearly indicate the current sort column and direction.
FR4.3.5: If the dataset is empty after filtering, the table area should display a message like "No data matches your current filters."
4.4. Filtering System
FR4.4.1: Users must be able to add one or more dynamic filters to the selected dataset.
FR4.4.2: An "Add Filter" button shall append a new filter row to the filter configuration area.
FR4.4.3: Each filter row shall consist of three components:
Column Dropdown: Lists all derivable columns from the current data source.
Operator Dropdown: Lists filter operators relevant to the selected column's data type.
Text/Dimension: "contains", "does not contain", "equals", "not equals", "starts with", "ends with" (case-insensitive and case-sensitive options).
Numeric/Metric: "equals", "not equals", "greater than", "less than", "greater than or equals", "less than or equals".
Date: "equals", "not equals", "after", "before", "on or after", "on or before".
Value Input: A text field, number input, or date picker, appropriate for the selected column and operator.
FR4.4.4: Users must be able to remove individual filters using a "Remove" or "X" button on each filter row.
FR4.4.5: All applied filters shall be combined using AND logic.
FR4.4.6: The Data Preview Table (4.3) and Data Summary Section (4.5) must update automatically and immediately reflect changes to the filter configuration.
FR4.4.7: When a filter's selected column is changed, the operator should reset to a sensible default for the new column type, and the value input should be cleared.
4.5. Data Summary Section
FR4.5.1: This section shall display a statistical overview of the data currently shown in the Data Preview Table (i.e., after filters are applied).
FR4.5.2: The summary must include:
Total Row Count: The number of rows in the filtered dataset.
FR4.5.3: For each column identified as a 'metric':
Minimum value.
Maximum value.
Average value.
Sum of values.
FR4.5.4: For each column identified as a 'dimension' or 'date':
Count of unique values.
(Optional, if performant) A list of the top N (e.g., 5) most frequent values along with their respective counts and aggregated key metrics (e.g., sum of 'cost', sum of 'clicks' for each of these top dimension values).
FR4.5.5: If the filtered dataset is empty, the summary should indicate this (e.g., "No data to summarize").
4.6. AI Insights Generation
FR4.6.1: A multi-line text input field shall be provided for the user to enter a natural language prompt.
FR4.6.2: A dropdown menu shall allow users to select the LLM provider and/or model to be used for generating insights (e.g., "Gemini Pro", "OpenAI GPT-4", "Anthropic Claude 3 Sonnet"). This list should be configurable.
FR4.6.3: A "Generate Insights" button shall trigger the insight generation process.
This button should be disabled if no prompt is entered or if no data is available for analysis.
FR4.6.4: While insights are being generated, a visible loading indicator (e.g., spinner, progress message) must be displayed. The "Generate Insights" button may be disabled during this time.
FR4.6.5: The AI-generated textual response shall be displayed in a designated read-only area. This area should handle formatted text (e.g., paragraphs, lists) if the API returns it.
FR4.6.6: If the LLM API provides token usage information (e.g., input tokens, output tokens, total tokens), this information shall be displayed near the generated insights.
FR4.6.7: If an error occurs during insight generation (API error, network issue), a user-friendly error message must be displayed in the insights area or as a notification.
FR4.6.8: The payload sent to the AI insights API must include:
The user's prompt.
The currently filtered data (or a representative sample if the dataset is very large, respecting API limits like MAX_RECOMMENDED_INSIGHT_ROWS).
Contextual information about the data:
Name of the data source.
A summary of applied filters.
Total rows in the original unfiltered source vs. rows analyzed.
Currency setting.
5. Data Handling and State Management
FR5.1: A dedicated React hook (e.g., useDataInsights) should encapsulate the majority of the page's state and logic. This includes:
Selected data source ID.
Derived column definitions (name, type).
List of active filters (column, operator, value).
Sort configuration for the preview table.
Selected preview row count.
Calculated local insights summary.
User prompt for AI.
Selected LLM model.
Generated AI insights text.
Token usage data.
All relevant loading states (data loading, insights generating).
Error messages (data loading error, API error).
FR5.2: The page will retrieve raw data for each selectable tab from a global state management solution (e.g., Zustand store, via useDataStore).
FR5.3: All data transformations (filtering, sorting, client-side summarization) should be performed efficiently, re-calculating only when necessary dependencies change (e.g., using useMemo).
FR5.4: API calls for generating AI insights will be made to the generateInsightsWithProvider function (expected to be in src/lib/api-router.ts), passing the appropriate payload as defined in FR4.6.8.
FR5.5: Types from src/lib/types/models.ts (e.g., LLMProvider, TokenUsage, LLMResponse) will be used for interacting with the AI services.
6. UI/UX Considerations
Clarity & Layout: The page layout should be intuitive, with distinct sections for data source selection, filtering controls, data preview, data summary, and AI insights generation.
Feedback: Provide clear visual feedback for user actions, loading states (e.g., data fetching, insights generation), and error conditions.
Responsiveness: While not a primary focus for a complex data tool, the page should remain usable on reasonably sized desktop screens. Extreme responsiveness for small mobile devices is a lower priority for this version.
Consistency: UI elements (buttons, dropdowns, tables, cards) should maintain a consistent look and feel with the rest of the application, leveraging existing UI component libraries if available.
7. Non-Goals (For This Iteration)
The following features are explicitly out of scope for this version to simplify initial development:

Automatic outlier detection and highlighting/exclusion.
Side-by-side comparison of insights generated by different LLM models simultaneously.
Saving/loading of filter configurations or insight generation history.
Direct chart visualizations embedded within this specific Data Insights page (charts are handled by other dedicated components/pages).
User-configurable column visibility in the preview table.
This PRD should provide a clear path for a developer to recreate the core functionality of the Data Insights page.