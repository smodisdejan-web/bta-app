'use client'

import { BudgetPacingData } from '@/lib/types'
import { getPacingStatusColor, getPacingProgressColor } from '@/lib/budgetPacing'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SpendEntryForm } from './SpendEntryForm'
import { SpendEntry } from '@/lib/types'

interface BudgetCardProps {
  pacingData: BudgetPacingData
  onAddSpend: (budgetId: string, spendEntry: SpendEntry) => void
  onDelete?: (budgetId: string) => void
}

export function BudgetCard({ pacingData, onAddSpend, onDelete }: BudgetCardProps) {
  const { budget, totalSpend, remainingBudget, percentTimeElapsed, percentBudgetSpent, pacingStatus, pacingDeviation, daysRemaining, overspendEvents, projectedEndSpend, dailyBudgetNeeded } = pacingData

  const statusColors = getPacingStatusColor(pacingStatus)
  const progressColor = getPacingProgressColor(pacingDeviation)
  
  const isOverpacing = pacingDeviation > 0
  const isPacingCritical = Math.abs(pacingDeviation) > 40

  return (
    <Card className="p-6 hover:shadow-lg transition-shadow">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="font-semibold text-lg">{budget.campaignName}</h3>
            {budget.accountName && (
              <p className="text-sm text-muted-foreground">{budget.accountName}</p>
            )}
          </div>
          <Badge className={statusColors}>
            {pacingStatus.replace('-', ' ')}
          </Badge>
        </div>

        {/* Budget Summary */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Total Budget</p>
            <p className="font-semibold text-lg">€{budget.totalBudget.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Spent</p>
            <p className="font-semibold text-lg">€{totalSpend.toFixed(2)}</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Budget Progress</span>
            <span className={`font-medium ${isOverpacing ? 'text-red-600' : 'text-green-600'}`}>
              {percentBudgetSpent.toFixed(1)}%
            </span>
          </div>
          <div className="relative h-4 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${progressColor} transition-all duration-500`}
              style={{ width: `${Math.min(percentBudgetSpent, 100)}%` }}
            />
            {/* Time elapsed marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-gray-800 opacity-50"
              style={{ left: `${Math.min(percentTimeElapsed, 100)}%` }}
              title={`${percentTimeElapsed.toFixed(1)}% of time elapsed`}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Time: {percentTimeElapsed.toFixed(1)}%</span>
            <span>{daysRemaining} days left</span>
          </div>
        </div>

        {/* Pacing Metrics */}
        <div className="grid grid-cols-2 gap-3 text-sm border-t pt-4">
          <div>
            <p className="text-muted-foreground">Pacing</p>
            <p className={`font-medium ${isOverpacing ? 'text-red-600' : percentBudgetSpent < percentTimeElapsed - 10 ? 'text-yellow-600' : 'text-green-600'}`}>
              {isOverpacing ? '+' : ''}{pacingDeviation.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Remaining</p>
            <p className="font-medium">€{remainingBudget.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Projected End</p>
            <p className={`font-medium ${projectedEndSpend > budget.totalBudget ? 'text-red-600' : 'text-green-600'}`}>
              €{projectedEndSpend.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Daily Needed</p>
            <p className="font-medium">€{dailyBudgetNeeded.toFixed(2)}</p>
          </div>
        </div>

        {/* Overspend Indicator */}
        {overspendEvents > 0 && (
          <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 p-2 rounded">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>{overspendEvents} day(s) with 2x+ overspend</span>
          </div>
        )}

        {/* Date Range */}
        <div className="text-xs text-muted-foreground border-t pt-3">
          {new Date(budget.startDate).toLocaleDateString()} - {new Date(budget.endDate).toLocaleDateString()}
          <span className="mx-2">•</span>
          <span className="capitalize">{budget.budgetPeriod}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <SpendEntryForm
            budgetId={budget.id}
            campaignName={budget.campaignName}
            onSubmit={onAddSpend}
            trigger={
              <button className="flex-1 px-3 py-2 text-sm font-medium border rounded-md hover:bg-muted transition-colors">
                Add Spend
              </button>
            }
          />
          {onDelete && (
            <button
              onClick={() => onDelete(budget.id)}
              className="px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

