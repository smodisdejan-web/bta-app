'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Area, AreaChart,
} from 'recharts'
import { Loader2, AlertCircle, Bot, ExternalLink, Info } from 'lucide-react'
import type { AiTrafficResponse } from '@/lib/ai-traffic'

const ACCENT = '#B39262'
const RANGE_OPTIONS = [30, 90, 180]

const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : `${(v * 100).toFixed(digits)}%`
const int = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-US')

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
}

/** Prijazna oznaka za HubSpot source enum. */
function sourceLabel(s: string) {
  if (s === 'AI_REFERRALS') return 'AI Assistants'
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** HubSpot lifecyclestage → človeška oznaka. */
const STAGE_LABEL: Record<string, string> = {
  subscriber: 'Subscriber',
  lead: 'Lead',
  marketingqualifiedlead: 'MQL',
  salesqualifiedlead: 'Sales Qualified',
  opportunity: 'Opportunity',
  customer: 'Customer',
}
/** Poznejše faze poudarjeno — vrstica, ki je prišla daleč, mora skočiti v oči. */
const STAGE_STYLE: Record<string, string> = {
  salesqualifiedlead: 'bg-amber-50 text-amber-800 border-amber-200',
  opportunity: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  customer: 'bg-emerald-100 text-emerald-900 border-emerald-300',
}

/** "2026-08-19" → "19 Aug 2026". Brez tega je stolpec nečitljiv na hitro. */
function niceDate(iso: string): string {
  const [y, m, d] = String(iso ?? '').split('-')
  if (!y || !m || !d) return iso ?? '—'
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`
}

export default function AiTrafficPage() {
  const [days, setDays] = useState(180)
  const [data, setData] = useState<AiTrafficResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/ai-traffic?start=${daysAgo(days)}&end=${daysAgo(1)}`)
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
        return j as AiTrafficResponse
      })
      .then((j) => { if (!cancelled) setData(j) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const maxSqlRate = useMemo(
    () => Math.max(0.0001, ...(data?.benchmark ?? []).map((b) => b.sqlRate)),
    [data]
  )
  const [showAllLeads, setShowAllLeads] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading AI traffic…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto mt-16 p-6 border border-red-200 bg-red-50 rounded-lg">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <h2 className="font-semibold text-red-800">AI traffic failed to load</h2>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  const aeo = data.aeo as any
  const sov: { company: string; share: number; isUs: boolean }[] = aeo?.shareOfVoice ?? []
  const prompts: { prompt: string; visibility: number }[] = aeo?.prompts ?? []
  const maxSov = Math.max(1, ...sov.map((s) => s.share))

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">

      {/* ── header ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Bot className="w-7 h-7 mt-0.5" style={{ color: ACCENT }} />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">AI Traffic</h1>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              Visitors and leads arriving from AI assistants — ChatGPT, Gemini, Claude,
              Perplexity, Copilot. Small volume, highest quality on the account.
            </p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {RANGE_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                days === d ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </header>

      {/* ── funnel ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Funnel</h2>
          <span className="text-xs text-gray-400 font-mono">
            auto · refreshes with /gm (GA4 + HubSpot sync)
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {data.steps.map((s) => (
            <div
              key={s.key}
              className={`rounded-lg border p-4 ${
                s.available ? 'bg-white border-gray-200' : 'bg-gray-50 border-dashed border-gray-300'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-mono">
                {s.source}
              </div>
              <div className="text-sm font-medium text-gray-700 mt-1 flex items-center gap-1">
                {s.label}
                {s.info && (
                  <span className="relative group inline-flex">
                    <Info className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                    {/* balonček: pod ikono, dovolj širok za cel stavek, nad ostalo vsebino */}
                    <span className="pointer-events-none absolute left-0 top-5 z-30 hidden group-hover:block w-80 rounded-lg border border-gray-200 bg-white p-3 shadow-lg text-left">
                      <span className="block text-xs font-semibold text-gray-900 mb-1.5">
                        {s.info.title}
                      </span>
                      {s.info.lines.map((line, i) => (
                        <span key={i} className="block text-[11px] leading-relaxed text-gray-600 mb-1 last:mb-0">
                          {line}
                        </span>
                      ))}
                    </span>
                  </span>
                )}
              </div>
              <div
                className={`text-2xl font-semibold mt-1 tabular-nums ${
                  s.available ? 'text-gray-900' : 'text-gray-400'
                }`}
              >
                {s.available ? int(s.value) : '—'}
              </div>
              {s.cvrFromPrev != null && (
                <div className="text-xs font-medium mt-1" style={{ color: ACCENT }}>
                  {pct(s.cvrFromPrev, 2)}
                  {s.key === 'leads' && data.scopeMismatch && <span className="text-gray-400"> *</span>}
                </div>
              )}
              {!s.available && (
                <div className="text-[11px] text-gray-500 mt-1">source in progress</div>
              )}
            </div>
          ))}
        </div>

        {/* scope mismatch — obvezno vidno, ne skrito. null = obsega sta poravnana. */}
        {data.scopeMismatch && (
          <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              <span className="font-semibold">* {data.scopeMismatch.affects}:</span>{' '}
              {data.scopeMismatch.reason}
            </p>
          </div>
        )}

        {/* ena vrstica na stran — brez tega ne veš, katera stran AI promet dejansko unovči */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Which site wins with AI</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              All our sites report into one GA4 property and are separated by hostname. Sessions
              are the {int(data.steps[0].value)} above; leads are HubSpot contacts whose first
              visit started on that site.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2 text-left font-medium">Site</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap">AI sessions</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap">Share of AI</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap">AI % of site</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap">Leads</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap">Lead rate</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap">SQL+</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.sites.map((s) => (
                  <tr key={s.host}>
                    <td className="px-4 py-2 text-gray-700 font-mono text-xs">{s.host}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                      {s.aiSessions ? int(s.aiSessions) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                      {s.aiSessions ? pct(s.share) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                      {pct(s.aiShareOfSite)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                      {s.leads || '—'}
                    </td>
                    <td
                      className="px-4 py-2 text-right tabular-nums font-medium"
                      style={{ color: s.leadRate ? ACCENT : undefined }}
                    >
                      {s.leadRate == null ? '—' : pct(s.leadRate)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                      {s.sqlPlus || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
            <span className="font-medium">AI % of site</span> is how dependent that site is on AI
            — AI sessions divided by all of its sessions.{' '}
            <span className="font-medium">Lead rate</span> is leads divided by AI sessions, so read
            it together with the session count: a handful of sessions makes the rate jump.
          </p>
        </div>

        <p className="text-xs text-gray-500">
          Steps are <span className="font-medium">cumulative</span>: HubSpot lifecycle stage
          records the furthest stage reached, so “Sales Qualified +” includes opportunity and
          customer. Sessions cover {data.meta.sessionScope}; contacts cover {data.meta.contactScope}.
        </p>
      </section>

      {/* ── leadi po vrsticah ─────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">AI leads</h2>
            <p className="text-sm text-gray-500">
              Every contact HubSpot attributes to an AI assistant in the selected range.
              Click a row to open the record in HubSpot.
            </p>
          </div>
          <span className="text-xs text-gray-400 font-mono">
            {data.leads.length} {data.leads.length === 1 ? 'row' : 'rows'} · HubSpot{' '}
            {data.meta.start} → {data.meta.end}
          </span>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Date</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Assistant</th>
                  <th className="px-4 py-2 text-left font-medium">Contact</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Country</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Site</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Budget</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Stage</th>
                  <th className="px-4 py-2 text-left font-medium">Form</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(showAllLeads ? data.leads : data.leads.slice(0, 8)).map((l, i) => {
                  const stageKey = String(l.stage ?? '').toLowerCase()
                  const row = (
                    <>
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{niceDate(l.day)}</td>
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{l.vendor}</td>
                      <td className="px-4 py-2">
                        <div className="text-gray-900">{l.name ?? '—'}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[180px]">
                          {l.email ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{l.country ?? '—'}</td>
                      <td className="px-4 py-2 text-gray-500 font-mono text-xs whitespace-nowrap">
                        {l.domain ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-600 text-xs whitespace-nowrap">
                        {l.budgetRange ?? '—'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full border text-[11px] ${
                            STAGE_STYLE[stageKey] ?? 'bg-gray-50 text-gray-600 border-gray-200'
                          }`}
                        >
                          {STAGE_LABEL[stageKey] ?? (l.stage || '—')}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        <span className="block truncate max-w-[200px]" title={l.conversion ?? ''}>
                          {l.conversion ?? '—'}
                        </span>
                      </td>
                    </>
                  )
                  return l.hubspotUrl ? (
                    <tr
                      key={`${l.day}-${l.email ?? i}`}
                      className="hover:bg-amber-50/50 cursor-pointer"
                      onClick={() => window.open(l.hubspotUrl!, '_blank', 'noopener')}
                    >
                      {row}
                    </tr>
                  ) : (
                    <tr key={`${l.day}-${l.email ?? i}`}>{row}</tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {data.leads.length > 8 && (
            <button
              onClick={() => setShowAllLeads((v) => !v)}
              className="w-full px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 border-t border-gray-100"
            >
              {showAllLeads ? 'Show less' : `See more (${data.leads.length - 8} more)`}
            </button>
          )}
        </div>

        <p className="text-xs text-gray-500">
          <span className="font-medium">Site</span> is the first page of the visit, so it shows
          which of our websites the assistant sent the person to — including sites outside the
          three GA4 properties above (individual yacht sites, for example). Stage is the furthest
          point the contact reached, not where they are today.
        </p>
      </section>

      {/* ── sales qualified rate benchmark ────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Sales qualified rate by source
            </h2>
            <p className="text-sm text-gray-500">
              Share of contacts that reached sales qualified or beyond (SQL, opportunity,
              customer). Sources with fewer than 5 contacts are excluded as noise.
            </p>
          </div>
          <span className="text-xs text-gray-400 font-mono">
            fixed window {data.benchmarkWindow.start} → {data.benchmarkWindow.end} ·{' '}
            {int(data.benchmarkWindow.totalContacts)} contacts
          </span>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {data.benchmark.map((b) => (
            <div key={b.source} className="flex items-center gap-3 px-4 py-2.5">
              <div className={`w-40 shrink-0 text-sm ${b.isAi ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                {sourceLabel(b.source)}
              </div>
              <div className="flex-1 h-5 bg-gray-100 rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm transition-all"
                  style={{
                    width: `${(b.sqlRate / maxSqlRate) * 100}%`,
                    background: b.isAi ? ACCENT : '#D1D5DB',
                  }}
                />
              </div>
              <div className={`w-14 text-right text-sm tabular-nums ${b.isAi ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                {pct(b.sqlRate)}
              </div>
              <div className="w-44 text-right text-xs text-gray-400 tabular-nums">
                {int(b.sqlPlus)} SQL+ of {int(b.contacts)} contacts
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          Read the sample size before the rate — AI is the smallest source on the account, so a
          few contacts move it a lot. This table does <span className="font-medium">not</span> follow
          the range selector: it covers the full sync window above, because the per-source
          denominators need every contact, not just the AI ones.
          {data.benchmarkWindow.truncated.length > 0 && (
            <span className="text-amber-700 font-medium">
              {' '}⚠️ Truncated chunks: {data.benchmarkWindow.truncated.join(', ')} — counts are incomplete.
            </span>
          )}
        </p>
      </section>

      {/* ── trend + vendors ───────────────────────────────────── */}
      <section className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900">Weekly AI sessions</h3>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">
            Each point is one full week, Monday to Sunday.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} width={34} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' }}
                formatter={(v: any) => [int(v as number), 'sessions']}
                labelFormatter={(_l: any, p: any) => {
                  const w = p?.[0]?.payload
                  return w ? `${w.start} → ${w.end}  ·  ${w.week}` : ''
                }}
              />
              <Area type="monotone" dataKey="sessions" stroke={ACCENT} fill={ACCENT} fillOpacity={0.14} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Which assistant</h3>
          <div className="space-y-2">
            {data.vendors.map((v) => (
              <div key={v.vendor} className="flex items-center gap-2">
                <span className="w-20 text-xs text-gray-600 shrink-0">{v.vendor}</span>
                <div className="flex-1 h-4 bg-gray-100 rounded-sm overflow-hidden">
                  <div className="h-full rounded-sm" style={{ width: `${v.share * 100}%`, background: ACCENT }} />
                </div>
                <span className="w-16 text-right text-xs tabular-nums text-gray-500 font-mono">
                  {int(v.sessions)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── landing pages + countries ─────────────────────────── */}
      <section className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Where AI traffic lands</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Top 15 landing pages, with the key events those sessions produced.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2 text-left font-medium">Page</th>
                  <th className="px-4 py-2 text-right font-medium">Sessions</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap">Key events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.landingPages.map((p) => (
                  <tr key={`${p.host}${p.lp}`}>
                    <td className="px-4 py-2 text-gray-600 font-mono text-xs truncate max-w-0 w-full">
                      {/* "(not set)" ni pot — GA4 tako poroča seje brez landing strani */}
                      {p.lp.startsWith('/') ? (
                        <a
                          href={`https://${p.host}${p.lp}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                          style={{ textDecorationColor: ACCENT }}
                        >
                          <span className="text-gray-400">{p.host}</span>
                          {p.lp}
                        </a>
                      ) : (
                        <>
                          <span className="text-gray-400">{p.host}</span>
                          {p.lp}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900 whitespace-nowrap">{int(p.sessions)}</td>
                    <td
                      className="px-4 py-2 text-right tabular-nums whitespace-nowrap"
                      style={{ color: p.keyEvents ? ACCENT : '#9CA3AF' }}
                    >
                      {p.keyEvents || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <h3 className="text-sm font-semibold text-gray-900 px-4 py-3 border-b border-gray-100">
            AI leads by country <span className="font-normal text-gray-400">· top 10</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {data.countries.map((c) => (
                  <tr key={c.country}>
                    <td className="px-4 py-2 text-gray-600">{c.country}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900">{c.contacts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── AEO — ROČEN, drug tempo ───────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-gray-900">AI visibility (HubSpot AEO)</h2>
          <a
            href="https://app-eu1.hubspot.com/ai-visibility/143360943"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs flex items-center gap-1 hover:underline"
            style={{ color: ACCENT }}
          >
            Open AEO <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* žig svežine — ločen od funnela zgoraj */}
        <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
          <p>
            <span className="font-semibold">Manual monthly snapshot</span> — captured{' '}
            {aeo?._capture?.capturedAt}, window{' '}
            <span className="font-mono">{aeo?._capture?.window}</span>. AEO has no public API,
            so this section does <span className="font-medium">not</span> refresh with the funnel
            above. The window is a rolling ~4 weeks, not a calendar month.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-mono">Brand visibility</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">
              {aeo?.brandVisibility?.value}%
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-mono">Niche vs generic prompts</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">
              {aeo?.promptPattern?.nicheAvg}% <span className="text-gray-400 text-lg">vs</span> {aeo?.promptPattern?.genericAvg}%
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              {aeo?.promptPattern?.ratio}× — the strategy signal
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-mono">Open recommendations</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">
              {aeo?.recommendations?.total}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              {aeo?.recommendations?.assigned === 0 ? 'none assigned' : `${aeo?.recommendations?.assigned} assigned`}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Share of voice</h3>
            <div className="space-y-2">
              {sov.map((s) => (
                <div key={s.company} className="flex items-center gap-2">
                  <span className={`w-40 text-xs shrink-0 ${s.isUs ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                    {s.company}
                  </span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-sm overflow-hidden">
                    <div
                      className="h-full rounded-sm"
                      style={{ width: `${(s.share / maxSov) * 100}%`, background: s.isUs ? ACCENT : '#D1D5DB' }}
                    />
                  </div>
                  <span className={`w-10 text-right text-xs tabular-nums ${s.isUs ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                    {s.share}%
                  </span>
                </div>
              ))}
            </div>
            {aeo?._capture?.partial?.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-3">
                Partial capture: {aeo._capture.partial[0]}
              </p>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <h3 className="text-sm font-semibold text-gray-900 px-4 py-3 border-b border-gray-100">
              Visibility by prompt
            </h3>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {prompts.map((p) => (
                    <tr key={p.prompt}>
                      <td className="px-4 py-2 text-gray-600 text-xs">{p.prompt}</td>
                      <td
                        className="px-4 py-2 text-right tabular-nums whitespace-nowrap font-medium"
                        style={{ color: p.visibility === 0 ? '#B0663A' : p.visibility >= 20 ? ACCENT : '#6B7280' }}
                      >
                        {p.visibility}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500 max-w-3xl">
          {aeo?.promptPattern?.conclusion}
        </p>
      </section>

      {/* ── blind spots ───────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">What we cannot see</h2>
        <ul className="space-y-1.5">
          {data.blindSpots.map((b) => (
            <li key={b} className="text-sm text-gray-600 flex gap-2">
              <span className="text-gray-300 shrink-0">—</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm font-medium text-gray-900 pt-1">
          Every number on this page is a lower bound.
        </p>
      </section>
    </div>
  )
}
