'use client'

import { useState, useRef } from 'react'
import { Budget, SpendEntry } from '@/lib/types'
import { parseCSV } from '@/lib/budgetPacing'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'

interface CSVUploadProps {
  type: 'budget' | 'spend'
  onBudgetsImported?: (budgets: Budget[]) => void
  onSpendImported?: (spendData: { campaignName: string; entries: SpendEntry[] }[]) => void
  trigger?: React.ReactNode
}

export function CSVUpload({ type, onBudgetsImported, onSpendImported, trigger }: CSVUploadProps) {
  const [open, setOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const handleFileSelect = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a CSV file',
        variant: 'destructive'
      })
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const result = parseCSV(text, type)

      if (result.error) {
        toast({
          title: 'Error parsing CSV',
          description: result.error,
          variant: 'destructive'
        })
        return
      }

      if (type === 'budget' && result.budgets) {
        onBudgetsImported?.(result.budgets)
        toast({
          title: 'Success',
          description: `Imported ${result.budgets.length} budget(s)`
        })
      } else if (type === 'spend' && result.spendEntries) {
        onSpendImported?.(result.spendEntries)
        toast({
          title: 'Success',
          description: `Imported spend data for ${result.spendEntries.length} campaign(s)`
        })
      }

      setOpen(false)
    }

    reader.readAsText(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const expectedFormat = type === 'budget'
    ? 'Campaign Name, Budget, Period, Start Date, End Date, Account Name (optional)'
    : 'Campaign Name, Date, Cost (or Spend)'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button variant="outline">Import CSV</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import {type === 'budget' ? 'Budgets' : 'Spend Data'} from CSV</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Expected Format</Label>
            <p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">
              {expectedFormat}
            </p>
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileInputChange}
              className="hidden"
            />
            
            <div className="space-y-2">
              <svg
                className="mx-auto h-12 w-12 text-muted-foreground"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              
              <p className="text-sm text-muted-foreground">
                Drag and drop your CSV file here, or
              </p>
              
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse Files
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            <p>• CSV file must have headers in the first row</p>
            <p>• Dates should be in standard format (YYYY-MM-DD, MM/DD/YYYY, etc.)</p>
            <p>• Budget amounts should be numeric values</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

