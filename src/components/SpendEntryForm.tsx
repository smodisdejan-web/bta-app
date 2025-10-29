'use client'

import { useState } from 'react'
import { SpendEntry } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface SpendEntryFormProps {
  budgetId: string
  campaignName: string
  onSubmit: (budgetId: string, spendEntry: SpendEntry) => void
  trigger?: React.ReactNode
}

export function SpendEntryForm({ budgetId, campaignName, onSubmit, trigger }: SpendEntryFormProps) {
  const [open, setOpen] = useState(false)
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: ''
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    const spendEntry: SpendEntry = {
      date: new Date(formData.date).toISOString(),
      amount: parseFloat(formData.amount)
    }
    
    onSubmit(budgetId, spendEntry)
    setOpen(false)
    
    // Reset form
    setFormData({
      date: new Date().toISOString().split('T')[0],
      amount: ''
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button size="sm" variant="outline">Add Spend</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Add Spend Entry</DialogTitle>
          <p className="text-sm text-muted-foreground">{campaignName}</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="date">Date *</Label>
            <Input
              id="date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (EUR) *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              required
              placeholder="0.00"
            />
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Spend</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

