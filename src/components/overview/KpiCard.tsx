// src/components/overview/KpiCard.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricDelta } from '@/lib/overview-types'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface KpiCardProps {
  title: string
  metric: MetricDelta
  format?: (value: number) => string
  sparklineData?: Array<{ date: string; value: number }>
  isPositiveIncrease?: boolean // true if higher is better (e.g., revenue), false if lower is better (e.g., CAC)
}

export function KpiCard({ 
  title, 
  metric, 
  format = (v) => formatCurrency(v, 'EUR'),
  sparklineData = [],
  isPositiveIncrease = true
}: KpiCardProps) {
  const delta = metric.deltaPct
  const hasDelta = delta !== null && Math.abs(delta) >= 1
  
  let deltaColor = 'text-muted-foreground'
  let DeltaIcon = Minus
  
  if (hasDelta) {
    const isGood = isPositiveIncrease ? delta > 0 : delta < 0
    deltaColor = isGood ? 'text-green-600' : 'text-red-600'
    DeltaIcon = delta > 0 ? TrendingUp : TrendingDown
  }
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold mb-2">
          {format(metric.value)}
        </div>
        {hasDelta && (
          <div className={`flex items-center gap-1 text-sm ${deltaColor}`}>
            <DeltaIcon className="h-4 w-4" />
            <span>{Math.abs(delta).toFixed(1)}%</span>
            <span className="text-muted-foreground text-xs">vs previous</span>
          </div>
        )}
        {sparklineData.length > 0 && (
          <div className="mt-4 h-[40px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData}>
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke={deltaColor.includes('green') ? '#3D7C4D' : deltaColor.includes('red') ? '#B83C3C' : '#6B7280'}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

