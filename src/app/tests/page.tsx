'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { FlaskConical, Hourglass, Trophy } from 'lucide-react'

import type { TestTrackerRow } from '@/lib/sheetsData'
import { cn } from '@/lib/utils'

type Summary = {
  activeCount: number
  runningCount: number
  analyzingCount: number
  staleCount: number
  recentWinners: number
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-100 text-blue-800',
  analyzing: 'bg-amber-100 text-amber-800',
  done: 'bg-green-100 text-green-800',
  killed: 'bg-red-100 text-red-800',
  backlog: 'bg-gray-100 text-gray-800',
  prioritized: 'bg-slate-100 text-slate-800',
}

const WINNER_COLORS: Record<string, string> = {
  a: 'bg-green-100 text-green-800 border-green-200',
  b: 'bg-green-100 text-green-800 border-green-200',
  inconclusive: 'bg-orange-100 text-orange-800 border-orange-200',
  'too early': 'bg-gray-100 text-gray-700 border-gray-200',
}

function parseNumber(val?: string | number | null): number | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  const cleaned = val.replace(/[^\d.,-]/g, '').replace(',', '.')
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function parseTarget(successCriteria?: string): number | null {
  if (!successCriteria) return null
  const match = successCriteria.match(/([\d.,]+)/)
  if (!match) return null
  return parseNumber(match[1])
}

function formatValue(value: number | null, kpiName: string): string {
  if (value === null || Number.isNaN(value)) return '—'
  const lower = kpiName.toLowerCase()
  if (lower.includes('€') || lower.includes('eur')) {
    return `€${value.toFixed(2)}`
  }
  if (lower.includes('%')) {
    return `${value.toFixed(1)}%`
  }
  return value.toFixed(2)
}

function barColor(value: number | null, target: number | null) {
  if (value === null || target === null) return 'bg-gray-200'
  if (value < target) return 'bg-green-500'
  if (value < target * 1.5) return 'bg-yellow-400'
  if (value < target * 2) return 'bg-orange-500'
  return 'bg-red-500'
}

function deltaPct(value: number | null, baseline: number | null): string {
  if (value === null || baseline === null || baseline === 0) return '—'
  const pct = ((value - baseline) / baseline) * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(0)}%`
}

function statusBadge(status: string) {
  const key = status.toLowerCase()
  const cls = STATUS_COLORS[key] || 'bg-gray-100 text-gray-800'
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', cls)}>{status}</span>
}

function winnerBadge(winner: string) {
  if (!winner) return <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">No winner</span>
  const key = winner.toLowerCase()
  const cls = WINNER_COLORS[key] || 'bg-gray-100 text-gray-700 border-gray-200'
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', cls)}>
      {winner === 'A' || winner.toLowerCase() === 'a' ? 'Winner: A' : winner === 'B' || winner.toLowerCase() === 'b' ? 'Winner: B' : winner}
    </span>
  )
}

function daysSince(dateStr?: string | null) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(+d)) return null
  const diff = Date.now() - d.getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

function useSummary(tests: TestTrackerRow[]): Summary {
  return useMemo(() => {
    const active = tests.filter((t) => ['running', 'analyzing'].includes(t.status.toLowerCase()))
    const runningCount = active.filter((t) => t.status.toLowerCase() === 'running').length
    const analyzingCount = active.filter((t) => t.status.toLowerCase() === 'analyzing').length
    const staleCount = active.filter((t) => (t.days_running || 0) > 14).length
    const recentWinners = tests.filter((t) => {
      if (t.status.toLowerCase() !== 'done') return false
      const ref = t.end_date || t.start_date
      const days = daysSince(ref)
      return days !== null && days <= 30
    }).length
    return {
      activeCount: active.length,
      runningCount,
      analyzingCount,
      staleCount,
      recentWinners,
    }
  }, [tests])
}

export default function TestsPage() {
  const [tests, setTests] = useState<TestTrackerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showBacklog, setShowBacklog] = useState(false)
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch('/api/test-tracker')
        if (!res.ok) throw new Error(`Failed to load tests (${res.status})`)
        const json = (await res.json()) as TestTrackerRow[]
        setTests(json || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tests')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const summary = useSummary(tests)
  const activeTests = useMemo(
    () => tests.filter((t) => ['running', 'analyzing'].includes(t.status.toLowerCase())),
    [tests]
  )
  const backlog = useMemo(
    () => tests.filter((t) => ['backlog', 'prioritized'].includes(t.status.toLowerCase())).sort((a, b) => (b.priority || 0) - (a.priority || 0)),
    [tests]
  )
  const doneTests = useMemo(
    () => tests.filter((t) => ['done', 'killed'].includes(t.status.toLowerCase())),
    [tests]
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wide text-gray-500">Experimentation</p>
          <h1 className="text-3xl font-semibold text-gray-900">Tests</h1>
          <p className="text-sm text-gray-600">Read-only view of the Test Tracker sheet. Update details in Google Sheets.</p>
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            title="Active Tests"
            value={summary.activeCount}
            subtitle={`${summary.runningCount} running, ${summary.analyzingCount} analyzing`}
            icon={<FlaskConical className="h-5 w-5 text-[#B39262]" />}
          />
          <SummaryCard
            title="Stale Tests"
            value={summary.staleCount}
            subtitle="Running > 14 days"
            icon={<Hourglass className="h-5 w-5 text-red-500" />}
            emphasis={summary.staleCount > 0 ? 'danger' : undefined}
          />
          <SummaryCard
            title="Recent Winners"
            value={summary.recentWinners}
            subtitle="Done in last 30 days"
            icon={<Trophy className="h-5 w-5 text-green-600" />}
            emphasis={summary.recentWinners > 0 ? 'success' : undefined}
          />
        </div>

        <section className="mt-10 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Active Tests</h2>
            <span className="text-sm text-gray-500">{activeTests.length} active</span>
          </div>

          {loading ? (
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-600 shadow-sm">
              Loading tests...
            </div>
          ) : activeTests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-500 shadow-sm">
              No active tests. Add tests in the Test Tracker sheet.
            </div>
          ) : (
            <div className="space-y-4">
              {activeTests.map((test) => (
                <TestCard key={test.test_id} test={test} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Backlog & Prioritized</h2>
            <button
              onClick={() => setShowBacklog((s) => !s)}
              className="text-sm text-[#B39262] hover:underline"
            >
              {showBacklog ? 'Hide' : 'Show'}
            </button>
          </div>
          {showBacklog && (
            <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Test ID</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Test Name</th>
                    <th className="px-4 py-3">Hypothesis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {backlog.map((t) => (
                    <tr key={t.test_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-800">{t.priority ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-800">{t.test_id}</td>
                      <td className="px-4 py-3 text-gray-600">{t.category}</td>
                      <td className="px-4 py-3 text-gray-800">{t.test_name}</td>
                      <td className="px-4 py-3 text-gray-600">{t.hypothesis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-10 mb-12">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Done</h2>
            <button
              onClick={() => setShowDone((s) => !s)}
              className="text-sm text-[#B39262] hover:underline"
            >
              {showDone ? 'Hide' : 'Show'}
            </button>
          </div>
          {showDone && (
            <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Test ID</th>
                    <th className="px-4 py-3">Test Name</th>
                    <th className="px-4 py-3">Winner</th>
                    <th className="px-4 py-3">KPI A</th>
                    <th className="px-4 py-3">KPI B</th>
                    <th className="px-4 py-3">Confidence</th>
                    <th className="px-4 py-3">Learning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {doneTests.map((t) => (
                    <tr key={t.test_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-800">{t.test_id}</td>
                      <td className="px-4 py-3 text-gray-800">{t.test_name}</td>
                      <td className="px-4 py-3 text-gray-700">{winnerBadge(t.winner)}</td>
                      <td className="px-4 py-3 text-gray-700">{formatValue(t.kpi_a ?? null, t.kpi_name)}</td>
                      <td className="px-4 py-3 text-gray-700">{formatValue(t.kpi_b ?? null, t.kpi_name)}</td>
                      <td className="px-4 py-3 text-gray-700">{t.stat_confidence || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{t.learning || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function SummaryCard({
  title,
  value,
  subtitle,
  icon,
  emphasis,
}: {
  title: string
  value: number
  subtitle?: string
  icon?: React.ReactNode
  emphasis?: 'success' | 'danger'
}) {
  const tone =
    emphasis === 'success'
      ? 'border-green-200 bg-green-50'
      : emphasis === 'danger'
      ? 'border-red-200 bg-red-50'
      : 'border-gray-200 bg-white'
  return (
    <div className={cn('rounded-xl border p-5 shadow-sm', tone)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <div className="text-2xl font-semibold text-gray-900">{value}</div>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        {icon}
      </div>
    </div>
  )
}

function TestCard({ test }: { test: TestTrackerRow }) {
  const target = parseTarget(test.success_criteria)
  const baseline = parseNumber(test.baseline)
  const kpiA = parseNumber(test.kpi_a)
  const kpiB = parseNumber(test.kpi_b)
  const maxVal = Math.max(baseline ?? 0, kpiA ?? 0, kpiB ?? 0, target ?? 0, 1)
  const days = test.days_running || daysSince(test.start_date) || 0

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <span>{test.test_id}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{test.category || '—'}</span>
          {statusBadge(test.status)}
        </div>
        <div className="text-sm text-gray-500">{days} days</div>
      </div>

      <p className="mt-2 text-base font-semibold text-gray-900">{test.test_name}</p>
      <p className="mt-1 text-sm text-gray-600">{test.hypothesis}</p>

      <div className="mt-4 flex flex-wrap gap-3 text-sm text-gray-700">
        <span className="font-medium">KPI: {test.kpi_name || '—'}</span>
        <span>Baseline: {formatValue(baseline, test.kpi_name)}</span>
        <span>Target: {target ? formatValue(target, test.kpi_name) : test.success_criteria || '—'}</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <VariantCard
          label="Variant A"
          variantLabel={test.variant_a || 'Variant A'}
          value={kpiA}
          baseline={baseline}
          target={target}
          maxVal={maxVal}
        />
        <VariantCard
          label="Variant B"
          variantLabel={test.variant_b || 'Variant B'}
          value={kpiB}
          baseline={baseline}
          target={target}
          maxVal={maxVal}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-700">
        {winnerBadge(test.winner)}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
          Confidence: {test.stat_confidence || '—'}
        </span>
      </div>

      <div className="mt-3 text-sm text-gray-700">
        <span className="font-medium">Next Action: </span>
        <span>{test.next_action || '—'}</span>
      </div>
    </div>
  )
}

function VariantCard({
  label,
  variantLabel,
  value,
  baseline,
  target,
  maxVal,
}: {
  label: string
  variantLabel: string
  value: number | null
  baseline: number | null
  target: number | null
  maxVal: number
}) {
  const width = Math.max(5, Math.min(100, ((value ?? 0) / maxVal) * 100))
  const color = barColor(value, target)
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between text-sm font-semibold text-gray-800">
        <span>{label}</span>
        <span className="text-xs text-gray-600">{variantLabel}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-lg font-semibold text-gray-900">
        <span>{formatValue(value, '')}</span>
        <span className="text-xs text-gray-500">{deltaPct(value, baseline)}</span>
      </div>
      <div className="mt-3 h-3 w-full rounded-full bg-gray-100">
        <div
          className={cn('h-3 rounded-full transition-all', color)}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-gray-500">
        {target ? (
          <span>
            Target {formatValue(target, '')} · Baseline {formatValue(baseline, '')}
          </span>
        ) : (
          <span>Baseline {formatValue(baseline, '')}</span>
        )}
      </div>
    </div>
  )
}
