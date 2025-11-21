// src/components/overview/TopMovers.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CampaignPerformance } from '@/lib/overview-types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface TopMoversProps {
  campaigns: CampaignPerformance[]
  limit?: number
}

export function TopMovers({ campaigns, limit = 10 }: TopMoversProps) {
  const sorted = [...campaigns].sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
  const topPositive = sorted.filter(c => c.deltaPct > 0).slice(0, limit)
  const topNegative = sorted.filter(c => c.deltaPct < 0).slice(0, limit)
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Top Positive Movers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            Top Positive Movers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topPositive.length === 0 ? (
            <p className="text-sm text-muted-foreground">No positive movers found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Spend</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead>CAC</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Δ%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topPositive.map((campaign, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{campaign.campaign}</TableCell>
                    <TableCell className="capitalize">{campaign.channel}</TableCell>
                    <TableCell>{formatCurrency(campaign.spend, 'EUR')}</TableCell>
                    <TableCell>{campaign.leads}</TableCell>
                    <TableCell>{formatCurrency(campaign.cac, 'EUR')}</TableCell>
                    <TableCell>{formatCurrency(campaign.revenue, 'EUR')}</TableCell>
                    <TableCell className="text-green-600 font-semibold">
                      +{campaign.deltaPct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      
      {/* Top Negative Movers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-red-600" />
            Top Negative Movers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topNegative.length === 0 ? (
            <p className="text-sm text-muted-foreground">No negative movers found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Spend</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead>CAC</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Δ%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topNegative.map((campaign, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{campaign.campaign}</TableCell>
                    <TableCell className="capitalize">{campaign.channel}</TableCell>
                    <TableCell>{formatCurrency(campaign.spend, 'EUR')}</TableCell>
                    <TableCell>{campaign.leads}</TableCell>
                    <TableCell>{formatCurrency(campaign.cac, 'EUR')}</TableCell>
                    <TableCell>{formatCurrency(campaign.revenue, 'EUR')}</TableCell>
                    <TableCell className="text-red-600 font-semibold">
                      {campaign.deltaPct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

