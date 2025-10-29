'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface DataInsightsChartProps {
  data: any[]
  columns: Array<{ name: string; key: string; type: string }>
  currency: string
}

export function DataInsightsChart({ data, columns, currency }: DataInsightsChartProps) {
  const metricColumns = useMemo(() => {
    return columns.filter(col => col.type === 'metric').slice(0, 3)
  }, [columns])

  const chartData = useMemo(() => {
    if (data.length === 0 || metricColumns.length === 0) return []
    
    // Take first 10 rows for chart
    return data.slice(0, 10).map((row, idx) => {
      const point: any = { index: `Row ${idx + 1}` }
      metricColumns.forEach(col => {
        point[col.name] = Number(row[col.key]) || 0
      })
      return point
    })
  }, [data, metricColumns])

  if (chartData.length === 0) return null

  const colors = ['#B39262', '#3D7C4D', '#C7930A']

  return (
    <Card className="bg-gradient-to-br from-background to-muted/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          Data Visualization
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="index" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'rgba(0,0,0,0.8)', 
                border: 'none',
                borderRadius: '8px',
                color: 'white'
              }}
            />
            <Legend />
            {metricColumns.map((col, idx) => (
              <Bar 
                key={col.key} 
                dataKey={col.name} 
                fill={colors[idx % colors.length]}
                radius={[8, 8, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}


