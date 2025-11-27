// src/components/overview/MiniMetric.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DailyMetric } from '@/lib/overview-types'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { formatCurrency, formatPercent } from '@/lib/utils'

interface MiniMetricProps {
  title: string
  data: DailyMetric[]
  dataKey: keyof DailyMetric
  format?: (value: number) => string
  color?: string
}

export function MiniMetric({ 
  title, 
  data, 
  dataKey, 
  format = (v) => v.toFixed(2),
  color = '#B39262'
}: MiniMetricProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data}>
            <XAxis 
              dataKey="date" 
              hide
            />
            <YAxis hide />
            <Tooltip 
              formatter={(value: number) => format(value)}
              labelFormatter={(label) => new Date(label).toLocaleDateString()}
            />
            <Line 
              type="monotone" 
              dataKey={dataKey as string} 
              stroke={color}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}



