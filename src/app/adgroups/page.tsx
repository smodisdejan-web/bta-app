'use client'

import { useEffect, useState, useMemo } from 'react'
import { useSettings } from '@/lib/contexts/SettingsContext'
import { AdGroupMetric } from '@/lib/types'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import {
    TrendingUp,
    MousePointer,
    DollarSign,
    Target,
    Eye,
    BarChart3,
    ArrowUpDown,
    Sparkles
} from "lucide-react"

type SortField = 'campaign' | 'adGroup' | 'impr' | 'clicks' | 'cost' | 'conv' | 'value' | 'cpc' | 'ctr' | 'convRate' | 'cpa' | 'roas';
type SortDirection = 'asc' | 'desc';

interface ChartData {
    date: string;
    clicks: number;
    cost: number;
    impressions: number;
    conv: number;
    value: number;
}

interface AggregatedAdGroup {
    campaign: string;
    adGroup: string;
    impr: number;
    clicks: number;
    cost: number;
    conv: number;
    value: number;
    cpc: number;
    ctr: number;
    convRate: number;
    cpa: number;
    roas: number;
}

export default function AdGroupsPage() {
    const { settings, fetchedData, dataError, isDataLoading } = useSettings()

    const [allAdGroupsData, setAllAdGroupsData] = useState<AdGroupMetric[]>([]);
    const [sortField, setSortField] = useState<SortField>('cost');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    useEffect(() => {
        if (fetchedData?.adGroups) {
            setAllAdGroupsData(fetchedData.adGroups);
        }
    }, [fetchedData]);

    // Aggregate data by campaign-adGroup pairs
    const aggregatedAdGroups = useMemo(() => {
        const grouped: Record<string, AggregatedAdGroup> = {};

        allAdGroupsData.forEach(item => {
            const key = `${item.campaign}|${item.adGroup}`;

            if (!grouped[key]) {
                grouped[key] = {
                    campaign: item.campaign,
                    adGroup: item.adGroup,
                    impr: 0,
                    clicks: 0,
                    cost: 0,
                    conv: 0,
                    value: 0,
                    cpc: 0,
                    ctr: 0,
                    convRate: 0,
                    cpa: 0,
                    roas: 0
                };
            }

            grouped[key].impr += item.impr;
            grouped[key].clicks += item.clicks;
            grouped[key].cost += item.cost;
            grouped[key].conv += item.conv;
            grouped[key].value += item.value;
        });

        // Calculate derived metrics for each aggregated group
        return Object.values(grouped).map(group => ({
            ...group,
            cpc: group.clicks > 0 ? group.cost / group.clicks : 0,
            ctr: group.impr > 0 ? group.clicks / group.impr : 0,
            convRate: group.clicks > 0 ? group.conv / group.clicks : 0,
            cpa: group.conv > 0 ? group.cost / group.conv : 0,
            roas: group.cost > 0 ? group.value / group.cost : 0
        }));
    }, [allAdGroupsData]);

    const sortedAdGroups = useMemo(() => {
        return [...aggregatedAdGroups].sort((a, b) => {
            const aVal = a[sortField];
            const bVal = b[sortField];

            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return aVal.localeCompare(bVal) * (sortDirection === 'asc' ? 1 : -1);
            }
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return (aVal - bVal) * (sortDirection === 'asc' ? 1 : -1);
            }
            return 0;
        });
    }, [aggregatedAdGroups, sortField, sortDirection]);

    const scorecardMetrics = useMemo(() => {
        return aggregatedAdGroups.reduce((acc, item) => {
            acc.impressions += item.impr;
            acc.clicks += item.clicks;
            acc.cost += item.cost;
            acc.conversions += item.conv;
            acc.value += item.value;
            return acc;
        }, { impressions: 0, clicks: 0, cost: 0, conversions: 0, value: 0 });
    }, [aggregatedAdGroups]);

    const chartData = useMemo(() => {
        const dailyData: Record<string, ChartData> = {};
        allAdGroupsData.forEach(item => {
            const dateStr = item.date.substring(0, 10);
            if (!dailyData[dateStr]) {
                dailyData[dateStr] = { date: dateStr, clicks: 0, cost: 0, impressions: 0, conv: 0, value: 0 };
            }
            dailyData[dateStr].clicks += item.clicks;
            dailyData[dateStr].cost += item.cost;
            dailyData[dateStr].impressions += item.impr;
            dailyData[dateStr].conv += item.conv;
            dailyData[dateStr].value += item.value;

        });
        return Object.values(dailyData).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }, [allAdGroupsData]);

    if (dataError) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center">
                <Card className="max-w-md mx-auto shadow-xl border-red-200">
                    <CardContent className="p-8 text-center">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Target className="w-8 h-8 text-red-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-red-900 mb-2">Error Loading Data</h3>
                        <p className="text-red-700">{dataError.message || 'Unknown error occurred'}</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (isDataLoading && allAdGroupsData.length === 0) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
                <Card className="max-w-md mx-auto shadow-xl border-blue-200">
                    <CardContent className="p-8 text-center">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                            <BarChart3 className="w-8 h-8 text-blue-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-blue-900 mb-2">Loading Ad Groups</h3>
                        <p className="text-blue-700">Fetching your performance data...</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const handleSort = (field: SortField) => {
        const isStringField = ['campaign', 'adGroup'].includes(field);
        const defaultDirection = isStringField ? 'asc' : 'desc';

        if (field === sortField) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection(defaultDirection);
        }
    };

    const SortButton = ({ field, children }: { field: SortField, children: React.ReactNode }) => (
        <Button
            variant="ghost"
            onClick={() => handleSort(field)}
            className="h-8 px-2 lg:px-3 hover:bg-blue-50 transition-colors"
        >
            {children}
            <ArrowUpDown className="ml-2 h-3 w-3 opacity-50" />
            {sortField === field && (
                <span className="ml-1 text-blue-600 font-bold">
                    {sortDirection === 'asc' ? '↑' : '↓'}
                </span>
            )}
        </Button>
    );

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
            <div className="container mx-auto px-4 py-12 mt-16">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="flex items-center justify-center mb-4">
                        <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center mr-4 shadow-lg">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                            Ad Groups Performance
                        </h1>
                    </div>
                    <p className="text-gray-600 text-lg max-w-2xl mx-auto">
                        Comprehensive insights into your ad group performance with advanced filtering and analytics
                    </p>
                </div>

                {/* Scorecards */}
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5 mb-12">
                    <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-blue-500 to-blue-600">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-blue-100">Total Impressions</CardTitle>
                            <Eye className="h-5 w-5 text-blue-200" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-white">{formatNumber(scorecardMetrics.impressions)}</div>
                            <p className="text-blue-200 text-sm mt-1">Views generated</p>
                        </CardContent>
                    </Card>

                    <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-green-500 to-green-600">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-green-100">Total Clicks</CardTitle>
                            <MousePointer className="h-5 w-5 text-green-200" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-white">{formatNumber(scorecardMetrics.clicks)}</div>
                            <p className="text-green-200 text-sm mt-1">User interactions</p>
                        </CardContent>
                    </Card>

                    <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-red-500 to-red-600">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-red-100">Total Cost</CardTitle>
                            <DollarSign className="h-5 w-5 text-red-200" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-white">{formatCurrency(scorecardMetrics.cost, settings.currency)}</div>
                            <p className="text-red-200 text-sm mt-1">Ad spend</p>
                        </CardContent>
                    </Card>

                    <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-purple-500 to-purple-600">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-purple-100">Total Conversions</CardTitle>
                            <Target className="h-5 w-5 text-purple-200" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-white">{formatNumber(scorecardMetrics.conversions)}</div>
                            <p className="text-purple-200 text-sm mt-1">Goals achieved</p>
                        </CardContent>
                    </Card>

                    <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-orange-500 to-orange-600">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-orange-100">Total Value</CardTitle>
                            <TrendingUp className="h-5 w-5 text-orange-200" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-white">{formatCurrency(scorecardMetrics.value, settings.currency)}</div>
                            <p className="text-orange-200 text-sm mt-1">Revenue generated</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Chart */}
                <Card className="mb-12 border-0 shadow-xl bg-white/80 backdrop-blur-sm">
                    <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b">
                        <div className="flex items-center">
                            <BarChart3 className="w-6 h-6 text-blue-600 mr-3" />
                            <CardTitle className="text-xl text-gray-800">Performance Over Time</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="p-8">
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={400}>
                                <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                    <XAxis
                                        dataKey="date"
                                        stroke="#64748b"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <YAxis
                                        yAxisId="left"
                                        stroke="#64748b"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <YAxis
                                        yAxisId="right"
                                        orientation="right"
                                        stroke="#64748b"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <Tooltip
                                        formatter={(value: any, name: any) => typeof value === 'number' ? (name === 'cost' || name === 'value' ? formatCurrency(value, settings.currency) : formatNumber(value)) : value}
                                        contentStyle={{
                                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                            border: 'none',
                                            borderRadius: '12px',
                                            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
                                        }}
                                    />
                                    <Legend />
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="clicks"
                                        stroke="#3b82f6"
                                        strokeWidth={3}
                                        dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                                        activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
                                        name="Clicks"
                                    />
                                    <Line
                                        yAxisId="right"
                                        type="monotone"
                                        dataKey="cost"
                                        stroke="#10b981"
                                        strokeWidth={3}
                                        dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
                                        activeDot={{ r: 6, stroke: '#10b981', strokeWidth: 2, fill: '#fff' }}
                                        name="Cost"
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="text-center py-20">
                                <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                                <h3 className="text-lg font-medium text-gray-600 mb-2">No Chart Data Available</h3>
                                <p className="text-gray-500">No data available for the selected period to display chart.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Table */}
                {(!isDataLoading && sortedAdGroups.length === 0) ? (
                    <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
                        <CardContent className="p-12 text-center">
                            <Target className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-gray-600 mb-2">No Data Found</h3>
                            <p className="text-gray-500">No ad group data available.</p>
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm overflow-hidden">
                        <CardHeader className="bg-gradient-to-r from-gray-50 to-blue-50 border-b">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                    <Target className="w-6 h-6 text-gray-600 mr-3" />
                                    <CardTitle className="text-xl text-gray-800">Ad Groups Data</CardTitle>
                                </div>
                                <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                                    {sortedAdGroups.length} ad groups
                                </div>
                            </div>
                        </CardHeader>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gray-50/50">
                                        <TableHead className="w-[200px] font-semibold"><SortButton field="campaign">Campaign</SortButton></TableHead>
                                        <TableHead className="w-[200px] font-semibold"><SortButton field="adGroup">Ad Group</SortButton></TableHead>
                                        <TableHead className="text-right font-semibold"><SortButton field="impr">Impr.</SortButton></TableHead>
                                        <TableHead className="text-right font-semibold"><SortButton field="clicks">Clicks</SortButton></TableHead>
                                        <TableHead className="text-right font-semibold"><SortButton field="cost">Cost</SortButton></TableHead>
                                        <TableHead className="text-right font-semibold"><SortButton field="conv">Conv.</SortButton></TableHead>
                                        <TableHead className="text-right font-semibold"><SortButton field="value">Value</SortButton></TableHead>
                                        <TableHead className="text-right font-semibold"><SortButton field="cpc">CPC</SortButton></TableHead>
                                        <TableHead className="text-right font-semibold"><SortButton field="ctr">CTR</SortButton></TableHead>
                                        <TableHead className="text-right font-semibold"><SortButton field="convRate">CvR</SortButton></TableHead>
                                        <TableHead className="text-right font-semibold"><SortButton field="cpa">CPA</SortButton></TableHead>
                                        <TableHead className="text-right font-semibold"><SortButton field="roas">ROAS</SortButton></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedAdGroups.map((row, index) => (
                                        <TableRow
                                            key={`${row.campaign}-${row.adGroup}-${index}`}
                                            className="hover:bg-blue-50/50 transition-colors border-b border-gray-100"
                                        >
                                            <TableCell className="font-medium text-gray-900">{row.campaign}</TableCell>
                                            <TableCell className="text-gray-700">{row.adGroup}</TableCell>
                                            <TableCell className="text-right font-medium">{formatNumber(row.impr)}</TableCell>
                                            <TableCell className="text-right font-medium text-blue-600">{formatNumber(row.clicks)}</TableCell>
                                            <TableCell className="text-right font-medium text-red-600">{formatCurrency(row.cost, settings.currency)}</TableCell>
                                            <TableCell className="text-right font-medium text-purple-600">{formatNumber(row.conv)}</TableCell>
                                            <TableCell className="text-right font-medium text-green-600">{formatCurrency(row.value, settings.currency)}</TableCell>
                                            <TableCell className="text-right text-gray-600">{formatCurrency(row.cpc, settings.currency)}</TableCell>
                                            <TableCell className="text-right text-gray-600">{formatPercent(row.ctr)}</TableCell>
                                            <TableCell className="text-right text-gray-600">{formatPercent(row.convRate)}</TableCell>
                                            <TableCell className="text-right text-gray-600">{formatCurrency(row.cpa, settings.currency)}</TableCell>
                                            <TableCell className="text-right font-medium">
                                                {(row.roas && isFinite(row.roas)) ? (
                                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${row.roas > 1
                                                        ? 'bg-green-100 text-green-800'
                                                        : 'bg-gray-100 text-gray-800'
                                                        }`}>
                                                        {row.roas.toFixed(2)}x
                                                    </span>
                                                ) : '-'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
} 