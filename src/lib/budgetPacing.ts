// src/lib/budgetPacing.ts
import { Budget, BudgetPacingData, PacingStatus, SpendEntry } from './types'

const STORAGE_KEY = 'bta_budgets'

// Local Storage Operations
export function saveBudgets(budgets: Budget[]): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(budgets))
  }
}

export function loadBudgets(): Budget[] {
  if (typeof window === 'undefined') return []
  
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return []
  
  try {
    return JSON.parse(stored)
  } catch (error) {
    console.error('Error parsing budgets from localStorage:', error)
    return []
  }
}

export function addBudget(budget: Budget): Budget[] {
  const budgets = loadBudgets()
  budgets.push(budget)
  saveBudgets(budgets)
  return budgets
}

export function updateBudget(budgetId: string, updates: Partial<Budget>): Budget[] {
  const budgets = loadBudgets()
  const index = budgets.findIndex(b => b.id === budgetId)
  
  if (index !== -1) {
    budgets[index] = { ...budgets[index], ...updates, updatedAt: new Date().toISOString() }
    saveBudgets(budgets)
  }
  
  return budgets
}

export function deleteBudget(budgetId: string): Budget[] {
  const budgets = loadBudgets().filter(b => b.id !== budgetId)
  saveBudgets(budgets)
  return budgets
}

// Date Calculations
export function getDaysInPeriod(startDate: string, endDate: string): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffTime = Math.abs(end.getTime() - start.getTime())
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1 // +1 to include both start and end
}

export function getDaysElapsed(startDate: string): number {
  const start = new Date(startDate)
  const today = new Date()
  start.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  
  const diffTime = today.getTime() - start.getTime()
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1)
}

export function getDaysRemaining(endDate: string): number {
  const end = new Date(endDate)
  const today = new Date()
  end.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  
  const diffTime = end.getTime() - today.getTime()
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)))
}

// Spend Calculations
export function getTotalSpend(spendEntries: SpendEntry[]): number {
  return spendEntries.reduce((sum, entry) => sum + entry.amount, 0)
}

export function getSpendForDateRange(spendEntries: SpendEntry[], startDate: string, endDate?: string): number {
  const start = new Date(startDate)
  const end = endDate ? new Date(endDate) : new Date()
  
  return spendEntries
    .filter(entry => {
      const entryDate = new Date(entry.date)
      return entryDate >= start && entryDate <= end
    })
    .reduce((sum, entry) => sum + entry.amount, 0)
}

export function getAverageDailySpend(spendEntries: SpendEntry[], daysElapsed: number): number {
  if (daysElapsed === 0) return 0
  const totalSpend = getTotalSpend(spendEntries)
  return totalSpend / daysElapsed
}

// Overspend Events (days with 2x+ target daily spend)
export function countOverspendEvents(spendEntries: SpendEntry[], targetDailySpend: number): number {
  return spendEntries.filter(entry => entry.amount >= targetDailySpend * 2).length
}

// Pacing Calculations
export function calculatePacingStatus(percentBudgetSpent: number, percentTimeElapsed: number): PacingStatus {
  const deviation = Math.abs(percentBudgetSpent - percentTimeElapsed)
  
  if (deviation <= 10) return 'on-track'
  if (deviation <= 20) return 'slight-off'
  if (deviation <= 40) return 'moderate-off'
  return 'critical'
}

export function calculatePacingDeviation(percentBudgetSpent: number, percentTimeElapsed: number): number {
  return percentBudgetSpent - percentTimeElapsed
}

export function calculateProjectedSpend(averageDailySpend: number, totalDays: number): number {
  return averageDailySpend * totalDays
}

export function calculateDailyBudgetNeeded(remainingBudget: number, daysRemaining: number): number {
  if (daysRemaining === 0) return 0
  return remainingBudget / daysRemaining
}

// Main Pacing Data Calculator
export function calculateBudgetPacing(budget: Budget): BudgetPacingData {
  const totalDays = getDaysInPeriod(budget.startDate, budget.endDate)
  const daysElapsed = Math.min(getDaysElapsed(budget.startDate), totalDays)
  const daysRemaining = getDaysRemaining(budget.endDate)
  
  const totalSpend = getTotalSpend(budget.spendEntries)
  const remainingBudget = Math.max(0, budget.totalBudget - totalSpend)
  
  const percentTimeElapsed = totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0
  const percentBudgetSpent = budget.totalBudget > 0 ? (totalSpend / budget.totalBudget) * 100 : 0
  
  const targetDailySpend = totalDays > 0 ? budget.totalBudget / totalDays : 0
  const averageDailySpend = getAverageDailySpend(budget.spendEntries, daysElapsed)
  
  const projectedEndSpend = calculateProjectedSpend(averageDailySpend, totalDays)
  const dailyBudgetNeeded = calculateDailyBudgetNeeded(remainingBudget, daysRemaining)
  
  const pacingDeviation = calculatePacingDeviation(percentBudgetSpent, percentTimeElapsed)
  const pacingStatus = calculatePacingStatus(percentBudgetSpent, percentTimeElapsed)
  
  const overspendEvents = countOverspendEvents(budget.spendEntries, targetDailySpend)
  
  return {
    budget,
    totalSpend,
    remainingBudget,
    daysElapsed,
    totalDays,
    percentTimeElapsed,
    percentBudgetSpent,
    pacingStatus,
    pacingDeviation,
    projectedEndSpend,
    dailyBudgetNeeded,
    daysRemaining,
    overspendEvents,
    averageDailySpend,
    targetDailySpend
  }
}

// Pacing Status Colors
export function getPacingStatusColor(status: PacingStatus): string {
  switch (status) {
    case 'on-track':
      return 'text-green-600 bg-green-50 border-green-200'
    case 'slight-off':
      return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    case 'moderate-off':
      return 'text-orange-600 bg-orange-50 border-orange-200'
    case 'critical':
      return 'text-red-600 bg-red-50 border-red-200'
  }
}

export function getPacingProgressColor(pacingDeviation: number): string {
  const absDeviation = Math.abs(pacingDeviation)
  
  if (absDeviation <= 10) return 'from-green-500 to-green-600'
  if (absDeviation <= 20) return 'from-yellow-500 to-yellow-600'
  if (absDeviation <= 40) return 'from-orange-500 to-orange-600'
  return 'from-red-500 to-red-600'
}

// CSV Parsing
export interface CSVParseResult {
  budgets?: Budget[]
  spendEntries?: { campaignName: string; entries: SpendEntry[] }[]
  error?: string
}

export function parseCSV(csvText: string, type: 'budget' | 'spend'): CSVParseResult {
  try {
    const lines = csvText.trim().split('\n')
    if (lines.length < 2) {
      return { error: 'CSV file is empty or has no data rows' }
    }
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    const rows = lines.slice(1)
    
    if (type === 'budget') {
      return parseBudgetCSV(headers, rows)
    } else {
      return parseSpendCSV(headers, rows)
    }
  } catch (error) {
    return { error: `Error parsing CSV: ${error}` }
  }
}

function parseBudgetCSV(headers: string[], rows: string[]): CSVParseResult {
  const budgets: Budget[] = []
  
  // Expected headers: Campaign Name, Budget, Period, Start Date, End Date, Account Name (optional)
  const campaignIdx = headers.findIndex(h => h.includes('campaign'))
  const budgetIdx = headers.findIndex(h => h.includes('budget'))
  const periodIdx = headers.findIndex(h => h.includes('period'))
  const startDateIdx = headers.findIndex(h => h.includes('start'))
  const endDateIdx = headers.findIndex(h => h.includes('end'))
  const accountIdx = headers.findIndex(h => h.includes('account'))
  
  if (campaignIdx === -1 || budgetIdx === -1) {
    return { error: 'CSV must include Campaign Name and Budget columns' }
  }
  
  for (const row of rows) {
    const cols = row.split(',').map(c => c.trim())
    
    if (cols.length < 2) continue
    
    const campaignName = cols[campaignIdx]
    const totalBudget = parseFloat(cols[budgetIdx])
    
    if (!campaignName || isNaN(totalBudget)) continue
    
    const budget: Budget = {
      id: `budget_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      campaignName,
      totalBudget,
      budgetPeriod: (periodIdx !== -1 && cols[periodIdx]) ? cols[periodIdx] as any : 'monthly',
      startDate: (startDateIdx !== -1 && cols[startDateIdx]) ? new Date(cols[startDateIdx]).toISOString() : new Date().toISOString(),
      endDate: (endDateIdx !== -1 && cols[endDateIdx]) ? new Date(cols[endDateIdx]).toISOString() : getDefaultEndDate(),
      accountName: accountIdx !== -1 ? cols[accountIdx] : undefined,
      spendEntries: [],
      budgetHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    budgets.push(budget)
  }
  
  return { budgets }
}

function parseSpendCSV(headers: string[], rows: string[]): CSVParseResult {
  // Expected headers: Campaign Name, Date, Cost (or Spend)
  const campaignIdx = headers.findIndex(h => h.includes('campaign'))
  const dateIdx = headers.findIndex(h => h.includes('date'))
  const costIdx = headers.findIndex(h => h.includes('cost') || h.includes('spend'))
  
  if (campaignIdx === -1 || dateIdx === -1 || costIdx === -1) {
    return { error: 'CSV must include Campaign Name, Date, and Cost/Spend columns' }
  }
  
  const spendMap = new Map<string, SpendEntry[]>()
  
  for (const row of rows) {
    const cols = row.split(',').map(c => c.trim())
    
    if (cols.length < 3) continue
    
    const campaignName = cols[campaignIdx]
    const date = new Date(cols[dateIdx]).toISOString()
    const amount = parseFloat(cols[costIdx])
    
    if (!campaignName || isNaN(amount)) continue
    
    if (!spendMap.has(campaignName)) {
      spendMap.set(campaignName, [])
    }
    
    spendMap.get(campaignName)!.push({ date, amount })
  }
  
  const spendEntries = Array.from(spendMap.entries()).map(([campaignName, entries]) => ({
    campaignName,
    entries
  }))
  
  return { spendEntries }
}

function getDefaultEndDate(): string {
  const date = new Date()
  date.setMonth(date.getMonth() + 1)
  return date.toISOString()
}

// Export to CSV
export function exportBudgetsToCSV(pacingData: BudgetPacingData[]): string {
  const headers = [
    'Campaign Name',
    'Account Name',
    'Total Budget',
    'Budget Period',
    'Start Date',
    'End Date',
    'Total Spend',
    'Remaining Budget',
    'Days Elapsed',
    'Days Remaining',
    'Total Days',
    '% Time Elapsed',
    '% Budget Spent',
    'Pacing Status',
    'Pacing Deviation',
    'Avg Daily Spend',
    'Target Daily Spend',
    'Daily Budget Needed',
    'Projected End Spend',
    'Overspend Events'
  ]
  
  const rows = pacingData.map(pd => [
    pd.budget.campaignName,
    pd.budget.accountName || '',
    pd.budget.totalBudget.toFixed(2),
    pd.budget.budgetPeriod,
    new Date(pd.budget.startDate).toLocaleDateString(),
    new Date(pd.budget.endDate).toLocaleDateString(),
    pd.totalSpend.toFixed(2),
    pd.remainingBudget.toFixed(2),
    pd.daysElapsed.toString(),
    pd.daysRemaining.toString(),
    pd.totalDays.toString(),
    pd.percentTimeElapsed.toFixed(1) + '%',
    pd.percentBudgetSpent.toFixed(1) + '%',
    pd.pacingStatus,
    pd.pacingDeviation.toFixed(1) + '%',
    pd.averageDailySpend.toFixed(2),
    pd.targetDailySpend.toFixed(2),
    pd.dailyBudgetNeeded.toFixed(2),
    pd.projectedEndSpend.toFixed(2),
    pd.overspendEvents.toString()
  ])
  
  const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
  return csv
}

