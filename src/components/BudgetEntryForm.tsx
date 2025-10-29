'use client'

import { useState } from 'react'
import { Budget, BudgetPeriod } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface BudgetEntryFormProps {
  onSubmit: (budget: Budget) => void
  trigger?: React.ReactNode
}

export function BudgetEntryForm({ onSubmit, trigger }: BudgetEntryFormProps) {
  const [open, setOpen] = useState(false)
  const [formData, setFormData] = useState({
    campaignName: '',
    accountName: '',
    totalBudget: '',
    budgetPeriod: 'monthly' as BudgetPeriod,
    startDate: new Date().toISOString().split('T')[0],
    endDate: getDefaultEndDate()
  })

  function getDefaultEndDate(): string {
    const date = new Date()
    date.setMonth(date.getMonth() + 1)
    return date.toISOString().split('T')[0]
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    const budget: Budget = {
      id: `budget_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      campaignName: formData.campaignName,
      accountName: formData.accountName || undefined,
      totalBudget: parseFloat(formData.totalBudget),
      budgetPeriod: formData.budgetPeriod,
      startDate: new Date(formData.startDate).toISOString(),
      endDate: new Date(formData.endDate).toISOString(),
      spendEntries: [],
      budgetHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    onSubmit(budget)
    setOpen(false)
    
    // Reset form
    setFormData({
      campaignName: '',
      accountName: '',
      totalBudget: '',
      budgetPeriod: 'monthly',
      startDate: new Date().toISOString().split('T')[0],
      endDate: getDefaultEndDate()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button>Add Budget</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Campaign Budget</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="campaignName">Campaign Name *</Label>
            <Input
              id="campaignName"
              value={formData.campaignName}
              onChange={(e) => setFormData({ ...formData, campaignName: e.target.value })}
              required
              placeholder="Enter campaign name"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="accountName">Account Name (optional)</Label>
            <Input
              id="accountName"
              value={formData.accountName}
              onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
              placeholder="Enter account name"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="totalBudget">Total Budget (EUR) *</Label>
            <Input
              id="totalBudget"
              type="number"
              step="0.01"
              min="0"
              value={formData.totalBudget}
              onChange={(e) => setFormData({ ...formData, totalBudget: e.target.value })}
              required
              placeholder="0.00"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="budgetPeriod">Budget Period *</Label>
            <Select
              value={formData.budgetPeriod}
              onValueChange={(value) => setFormData({ ...formData, budgetPeriod: value as BudgetPeriod })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date *</Label>
              <Input
                id="startDate"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date *</Label>
              <Input
                id="endDate"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                required
                min={formData.startDate}
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Budget</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

