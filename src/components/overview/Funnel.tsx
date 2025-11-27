// src/components/overview/Funnel.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OverviewMetrics } from '@/lib/overview-types'
import { ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface FunnelProps {
  metrics: OverviewMetrics
}

export function Funnel({ metrics }: FunnelProps) {
  const steps = [
    {
      label: 'LP Views',
      value: metrics.lpViews,
      delta: metrics.lpViewsDelta,
      nextRate: metrics.lpToLeadRate
    },
    {
      label: 'Leads',
      value: metrics.leadsCount,
      delta: metrics.leadsDelta,
      nextRate: metrics.leadToSqlRate
    },
    {
      label: 'SQL',
      value: metrics.sqlCount,
      delta: metrics.sqlDelta,
      nextRate: metrics.sqlToDealRate
    },
    {
      label: 'Deals',
      value: metrics.dealsCount,
      delta: metrics.dealsDelta,
      nextRate: metrics.dealToRevenueRate
    },
    {
      label: 'Revenue',
      value: metrics.revenueTotal,
      delta: null,
      nextRate: null,
      isRevenue: true
    }
  ]
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Marketing Funnel</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 overflow-x-auto pb-4">
          {steps.map((step, index) => (
            <div key={step.label} className="flex items-center gap-4 min-w-0 flex-shrink-0">
              <div className="text-center min-w-[120px]">
                <div className="text-xs text-muted-foreground mb-1">{step.label}</div>
                <div className={`text-2xl font-bold ${step.isRevenue ? 'text-primary' : ''}`}>
                  {step.isRevenue 
                    ? formatCurrency(step.value, 'EUR')
                    : step.value.toLocaleString()
                  }
                </div>
                {step.delta !== null && (
                  <div className={`flex items-center justify-center gap-1 text-xs mt-1 ${
                    step.delta > 0 ? 'text-green-600' : step.delta < 0 ? 'text-red-600' : 'text-muted-foreground'
                  }`}>
                    {step.delta > 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : step.delta < 0 ? (
                      <TrendingDown className="h-3 w-3" />
                    ) : null}
                    {step.delta !== 0 && `${step.delta > 0 ? '+' : ''}${step.delta}`}
                  </div>
                )}
              </div>
              {index < steps.length - 1 && (
                <>
                  <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  {step.nextRate !== null && (
                    <div className="text-center min-w-[80px] flex-shrink-0">
                      <div className="text-xs text-muted-foreground">
                        {step.isRevenue 
                          ? formatCurrency(step.nextRate, 'EUR')
                          : `${step.nextRate.toFixed(1)}%`
                        }
                      </div>
                    </div>
                  )}
                  <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}



