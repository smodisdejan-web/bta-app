'use client'

import React, { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  Mail, Users, Sparkles, MousePointerClick, AlertCircle, Send, Loader2, RefreshCw,
  TrendingUp, Flame, ShieldAlert,
} from 'lucide-react'

const ACCENT = '#B39262'
const IVORY = '#f8f7f2'

type Bucket = { label: string; leads: number; matched: number; ql: number; ql_rate: number; bookings: number; booking_rate: number }
type EmailResponse = {
  health: {
    as_of: string; marketable: number; ever_delivered: number; sent_this_month: number
    opened_last30d: number; clicked_ever: number; optout: number; bounced: number; highly_engaged: number
    open_rate_pct: number; optout_rate_pct: number; bounce_rate_pct: number
    seg_hot: number; seg_warm: number; seg_cooling: number; seg_dormant: number; seg_never: number; seg_unsub: number
  } | null
  growth: { month: string; new_contacts: number }[]
  funnel: { engaged: Bucket; non_engaged: Bucket; booking_lift: number }
  buyers: { total: number; matched: number; engaged: number; engaged_pct: number }
  meta: { leadsInWindow: number; hsContactsTotal: number; bookingsTotal: number }
}

function Card({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`rounded-xl border border-[#e1d8c7] bg-white shadow-sm ${className}`} style={style}>{children}</div>
}

function Tile({ title, value, subtitle, icon, accent }: { title: string; value: string; subtitle?: string; icon: React.ReactNode; accent?: string }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-600">{title}</div>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#fbf9f4]" style={{ color: accent || ACCENT }}>{icon}</div>
      </div>
      <div className="text-2xl font-semibold" style={{ color: accent || '#111827' }}>{value}</div>
      <div className="min-h-[18px] text-xs text-gray-500">{subtitle}</div>
    </Card>
  )
}

const fmt = (n: number) => n.toLocaleString()
const pct = (n: number) => `${n.toFixed(1)}%`

// Engagement spectrum definition (sums to ever_delivered).
const SEGMENTS = [
  { key: 'seg_hot', label: 'Hot', meaning: 'opened ≤30d', color: '#1f7a3d' },
  { key: 'seg_warm', label: 'Warm', meaning: 'opened 30–90d', color: '#6aa84f' },
  { key: 'seg_cooling', label: 'Cooling', meaning: 'opened 90–180d', color: '#d6a01a' },
  { key: 'seg_dormant', label: 'Dormant', meaning: 'last open >180d', color: '#c2740a' },
  { key: 'seg_never', label: 'Never opened', meaning: 'delivered, 0 opens', color: '#b04632' },
] as const

export default function EmailMarketingPage() {
  const [data, setData] = useState<EmailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/email-marketing?_=${nonce}`)
      .then(r => r.json())
      .then(j => { if (j.error) throw new Error(j.error); setData(j) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [nonce])

  const h = data?.health
  const spectrumTotal = h ? h.seg_hot + h.seg_warm + h.seg_cooling + h.seg_dormant + h.seg_never : 0
  const activePct = h && spectrumTotal > 0 ? ((h.seg_hot + h.seg_warm) / spectrumTotal) * 100 : 0
  const neverPct = h && spectrumTotal > 0 ? (h.seg_never / spectrumTotal) * 100 : 0

  return (
    <div className="min-h-screen" style={{ backgroundColor: IVORY }}>
      {/* Sticky header */}
      <div className="sticky top-16 z-30 border-b border-[#e1d8c7]/60 bg-[#f8f7f2]/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-[#B39262] mb-2">Command Center</p>
            <h1 className="font-serif text-3xl md:text-4xl font-medium text-gray-900 tracking-tight leading-tight">Email Marketing</h1>
            <div className="mt-2 flex items-center gap-3">
              <span className="h-px w-8 bg-[#B39262]" />
              <p className="text-sm text-gray-600">List health · engagement segments · does email lift conversion</p>
            </div>
          </div>
          <button onClick={() => setNonce(n => n + 1)} className="p-2 rounded-md border border-[#e1d8c7] bg-white text-gray-700 hover:bg-[#f2ede3]" aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 space-y-8">
        {loading && <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>}
        {error && <Card className="p-4 text-red-700 bg-red-50 border-red-200">{error}</Card>}

        {data && h && (
          <>
            {/* SECTION 1 — North-star header */}
            <section className="space-y-3">
              <SectionTitle n="01" title="Program at a glance" sub={`whole ${Math.round(h.marketable / 1000)}K list · snapshot`} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Tile title="Marketable List" value={fmt(h.marketable)} subtitle={`${fmt(h.ever_delivered)} ever emailed`} icon={<Users className="h-4 w-4" />} />
                <Tile title="Sent This Month" value={fmt(h.sent_this_month)} subtitle="marketing emails" icon={<Send className="h-4 w-4" />} />
                <Tile title="Open Rate" value={pct(h.open_rate_pct)} subtitle={`${fmt(h.opened_last30d)} opened (30d)`} icon={<Sparkles className="h-4 w-4" />} />
                <Tile title="Highly Engaged" value={fmt(h.highly_engaged)} subtitle="opened ≥5 emails" icon={<Flame className="h-4 w-4" />} accent="#1f7a3d" />
                <Tile title="Bounce Rate" value={pct(h.bounce_rate_pct)} subtitle={`${fmt(h.bounced)} bounced`} icon={<ShieldAlert className="h-4 w-4" />} accent={h.bounce_rate_pct >= 5 ? '#b04632' : undefined} />
                <Tile title="Unsub Rate" value={pct(h.optout_rate_pct)} subtitle={`${fmt(h.optout)} opted out`} icon={<AlertCircle className="h-4 w-4" />} />
              </div>
            </section>

            {/* SECTION 2 — List growth */}
            <section className="space-y-3">
              <SectionTitle n="02" title="List growth" sub="new contacts per month (last 12)" />
              <Card className="p-6">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.growth} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee5d4" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9b8a6a' }} tickFormatter={(m) => m.slice(2)} />
                      <YAxis tick={{ fontSize: 11, fill: '#9b8a6a' }} width={40} />
                      <Tooltip formatter={(v: any) => [fmt(Number(v)), 'New contacts']} contentStyle={{ borderRadius: 8, border: '1px solid #e1d8c7', fontSize: 12 }} />
                      <Bar dataKey="new_contacts" fill={ACCENT} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">New contacts added to the database each month. Total marketable list: {fmt(h.marketable)} · {fmt(h.highly_engaged)} highly engaged.</p>
              </Card>
            </section>

            {/* SECTION 3 — Engagement segmentation (the strategic view) */}
            <section className="space-y-3">
              <SectionTitle n="03" title="Engagement segments" sub="who's actually reading — and who's dead weight" />
              <Card className="p-6 space-y-5">
                {/* Stacked bar */}
                <div className="space-y-2">
                  <div className="flex h-6 w-full overflow-hidden rounded-md">
                    {SEGMENTS.map(s => {
                      const v = (h as any)[s.key] as number
                      const w = spectrumTotal > 0 ? (v / spectrumTotal) * 100 : 0
                      return <div key={s.key} title={`${s.label}: ${fmt(v)} (${w.toFixed(0)}%)`} style={{ width: `${w}%`, backgroundColor: s.color }} />
                    })}
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-400">
                    <span>{fmt(spectrumTotal)} contacts ever delivered</span>
                    <span>{activePct.toFixed(0)}% actively engaged · {neverPct.toFixed(0)}% never opened</span>
                  </div>
                </div>

                {/* Legend grid */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {SEGMENTS.map(s => {
                    const v = (h as any)[s.key] as number
                    const w = spectrumTotal > 0 ? (v / spectrumTotal) * 100 : 0
                    return (
                      <div key={s.key} className="rounded-lg border border-[#e1d8c7] p-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="text-sm font-semibold text-gray-800">{s.label}</span>
                        </div>
                        <div className="text-xl font-semibold text-gray-900 mt-1">{fmt(v)}</div>
                        <div className="text-[11px] text-gray-500">{w.toFixed(0)}% · {s.meaning}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Insight callout */}
                <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: '#e6c9c0', backgroundColor: '#fcf3f0' }}>
                  <span className="font-semibold" style={{ color: '#b04632' }}>{neverPct.toFixed(0)}% of the delivered list ({fmt(h.seg_never)}) has never opened a single email.</span>{' '}
                  <span className="text-gray-600">Prime sunset / re-permission candidates — they hurt deliverability and inflate send costs. Only {activePct.toFixed(0)}% ({fmt(h.seg_hot + h.seg_warm)}) are actively engaged (opened in 90 days). Focus nurture there; consider a win-back flow for {fmt(h.seg_cooling + h.seg_dormant)} cooling/dormant before sunsetting.</span>
                </div>
              </Card>
            </section>

            {/* SECTION 4 — Conversion proof */}
            <section className="space-y-3">
              <SectionTitle n="04" title="Does email engagement convert?" sub="trailing 12 months of leads" />
              <Card className="p-6 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm text-gray-500">Leads split by whether they opened/clicked ≥1 marketing email</p>
                  {data.funnel.booking_lift > 1 && (
                    <span className="px-3 py-1.5 rounded-md text-sm font-semibold" style={{ backgroundColor: '#e7f5ec', color: '#1f7a3d' }}>
                      ▲ Engaged leads book {data.funnel.booking_lift.toFixed(1)}× more
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { b: data.funnel.engaged, title: 'Email-engaged', note: 'opened or clicked', tint: '#1f7a3d', bg: '#f1f9f4' },
                    { b: data.funnel.non_engaged, title: 'Not engaged', note: 'no open / click', tint: '#9a6a00', bg: '#fbf7ee' },
                  ].map(({ b, title, note, tint, bg }) => (
                    <div key={title} className="rounded-lg border border-[#e1d8c7] p-4" style={{ backgroundColor: bg }}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold" style={{ color: tint }}>{title}</span>
                        <span className="text-[11px] text-gray-500">{note}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <div><div className="text-2xl font-semibold text-gray-900">{fmt(b.leads)}</div><div className="text-[10px] uppercase tracking-wide text-gray-500">Leads</div></div>
                        <div><div className="text-2xl font-semibold text-gray-900">{pct(b.ql_rate)}</div><div className="text-[10px] uppercase tracking-wide text-gray-500">QL rate</div></div>
                        <div><div className="text-2xl font-semibold" style={{ color: tint }}>{pct(b.booking_rate)}</div><div className="text-[10px] uppercase tracking-wide text-gray-500">Booking rate</div></div>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-2">{b.bookings} bookings · {b.matched} in Streak</div>
                    </div>
                  ))}
                </div>

                {/* Buyers engaged */}
                {data.buyers.matched > 0 && (
                  <div className="rounded-lg border border-[#cfe6d6] bg-[#f1f9f4] px-4 py-3 text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 shrink-0" style={{ color: '#1f7a3d' }} />
                    <span><span className="font-semibold" style={{ color: '#1f7a3d' }}>{data.buyers.engaged_pct.toFixed(0)}% of clients who booked</span> <span className="text-gray-600">were email-engaged ({data.buyers.engaged} of {data.buyers.matched} matched buyers opened/clicked our marketing email). Email isn&apos;t winning new leads — it&apos;s keeping warm the ones who become clients.</span></span>
                  </div>
                )}

                <p className="text-[11px] text-gray-400 italic">
                  Signal, not proven cause — engaged leads are self-selected. Booking is lead-cohort. Per-email performance &amp; true open/click trends unlock once the HubSpot key gets the <code className="text-[10px]">content</code> scope.
                </p>
              </Card>
            </section>

            <div className="text-xs text-gray-400 text-center py-2">
              {fmt(data.meta.leadsInWindow)} leads in 12-mo window · {fmt(data.meta.bookingsTotal)} bookings · snapshot as of {new Date(h.as_of).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SectionTitle({ n, title, sub }: { n: string; title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-xs" style={{ color: ACCENT }}>{n}</span>
      <h2 className="font-serif text-xl text-gray-900">{title}</h2>
      {sub && <span className="text-xs text-gray-400">· {sub}</span>}
    </div>
  )
}
