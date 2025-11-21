// src/components/overview/AiSummary.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { AISummaryResponse } from '@/lib/overview-types'

interface AiSummaryProps {
  bullets: string[]
  onRegenerate: () => Promise<void>
  isRegenerating?: boolean
}

export function AiSummary({ bullets, onRegenerate, isRegenerating }: AiSummaryProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Executive Summary</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={onRegenerate}
          disabled={isRegenerating}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
          Regenerate
        </Button>
      </CardHeader>
      <CardContent>
        {bullets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No summary available</p>
        ) : (
          <ul className="space-y-2">
            {bullets.map((bullet, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <span className="text-primary mt-1">•</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

