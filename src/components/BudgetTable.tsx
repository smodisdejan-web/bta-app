'use client'

import { BudgetPacingData, SpendEntry } from '@/lib/types'
import { getPacingStatusColor } from '@/lib/budgetPacing'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { SpendEntryForm } from './SpendEntryForm'

interface BudgetTableProps {
  pacingData: BudgetPacingData[]
  onAddSpend: (budgetId: string, spendEntry: SpendEntry) => void
  onDelete?: (budgetId: string) => void
}

export function BudgetTable({ pacingData, onAddSpend, onDelete }: BudgetTableProps) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[200px]">Campaign</TableHead>
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Budget</TableHead>
            <TableHead className="text-right">Spent</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead className="text-center">Progress</TableHead>
            <TableHead className="text-center">Status</TableHead>
            <TableHead className="text-right">Pacing</TableHead>
            <TableHead className="text-right">Days Left</TableHead>
            <TableHead className="text-right">Daily Needed</TableHead>
            <TableHead className="text-right">Projected</TableHead>
            <TableHead className="text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pacingData.length === 0 ? (
            <TableRow>
              <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                No budgets found. Add a budget to get started.
              </TableCell>
            </TableRow>
          ) : (
            pacingData.map((pd) => {
              const { budget, totalSpend, remainingBudget, percentBudgetSpent, percentTimeElapsed, pacingStatus, pacingDeviation, daysRemaining, dailyBudgetNeeded, projectedEndSpend, overspendEvents } = pd
              const isOverpacing = pacingDeviation > 0
              const statusColors = getPacingStatusColor(pacingStatus)

              return (
                <TableRow key={budget.id}>
                  <TableCell className="font-medium">
                    <div>
                      {budget.campaignName}
                      {overspendEvents > 0 && (
                        <span className="ml-2 text-orange-600" title={`${overspendEvents} day(s) with 2x+ overspend`}>
                          ⚠️
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {budget.accountName || '-'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    €{budget.totalBudget.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    €{totalSpend.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    €{remainingBudget.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden min-w-[80px]">
                        <div
                          className={`h-full ${isOverpacing ? 'bg-gradient-to-r from-red-500 to-red-600' : 'bg-gradient-to-r from-green-500 to-green-600'}`}
                          style={{ width: `${Math.min(percentBudgetSpent, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {percentBudgetSpent.toFixed(1)}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge className={statusColors} variant="outline">
                      {pacingStatus.replace('-', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className={`text-right font-medium ${isOverpacing ? 'text-red-600' : percentBudgetSpent < percentTimeElapsed - 10 ? 'text-yellow-600' : 'text-green-600'}`}>
                    {isOverpacing ? '+' : ''}{pacingDeviation.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {daysRemaining}
                  </TableCell>
                  <TableCell className="text-right">
                    €{dailyBudgetNeeded.toFixed(2)}
                  </TableCell>
                  <TableCell className={`text-right font-medium ${projectedEndSpend > budget.totalBudget ? 'text-red-600' : 'text-green-600'}`}>
                    €{projectedEndSpend.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <SpendEntryForm
                        budgetId={budget.id}
                        campaignName={budget.campaignName}
                        onSubmit={onAddSpend}
                        trigger={
                          <button className="px-2 py-1 text-xs font-medium border rounded hover:bg-muted transition-colors">
                            Add Spend
                          </button>
                        }
                      />
                      {onDelete && (
                        <button
                          onClick={() => onDelete(budget.id)}
                          className="px-2 py-1 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors"
                          title="Delete budget"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}

