// src/components/overview/RevenueSpendChart.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DailyMetric } from '@/lib/overview-types'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface RevenueSpendChartProps {
  data: DailyMetric[]
}

export function RevenueSpendChart({ data }: RevenueSpendChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue vs Spend</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="date" 
              tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            />
            <YAxis 
              yAxisId="left"
              tickFormatter={(value) => formatCurrency(value, 'EUR')}
            />
            <Tooltip 
              formatter={(value: number) => formatCurrency(value, 'EUR')}
              labelFormatter={(label) => new Date(label).toLocaleDateString()}
            />
            <Legend />
            <Line 
              yAxisId="left"
              type="monotone" 
              dataKey="revenue" 
              stroke="#3D7C4D" 
              strokeWidth={2}
              name="Revenue"
            />
            <Line 
              yAxisId="left"
              type="monotone" 
              dataKey="spend" 
              stroke="#B83C3C" 
              strokeWidth={2}
              name="Spend"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}



