'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Eye, Heart, Users, Trophy, ExternalLink, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import data from './data.json'

/* ============================================================
   TYPES
   ============================================================ */

type Source = string

interface ContentPiece {
  id: string
  platform: 'youtube' | 'instagram' | 'tiktok' | string
  type: 'video' | 'reel' | 'post' | 'story' | 'story_batch' | string
  title?: string | null
  url?: string | null
  postedDate?: string
  storyCount?: number
  impressions?: number
  reach?: { value: number | null; source?: Source }
  engagement?: {
    likes?: number | null
    comments?: number | null
    shares?: number | null
    saves?: number | null
    rate?: number | null
    source?: Source
  }
  activation?: {
    visits?: { value: number | null; source?: Source }
    leads?: { value: number | null; source?: Source }
    newFollowers?: { value: number | null; source?: Source }
  }
  roi?: {
    bookings?: { value: number | null; source?: Source }
    rvc?: { value: number | null; currency?: string; source?: Source }
  }
}

interface Creator {
  id: string
  name: string
  handle: string
  icpFit: 'HIGH' | 'MED' | 'LOW'
  followers: { ig: number; yt: number }
  audienceOverlap: number | null
  deliverables: string
  content: ContentPiece[]
}

interface FollowerSnapshot {
  asOf: string
  value: number
}

interface FollowerSeries {
  account?: string
  channel?: string
  channelId?: string
  source?: string
  current?: number
  tripDelta?: number | null
  tripNetDelta?: number | null
  tripLiftVsBaseline?: number | null
  asOf?: string
  snapshots?: FollowerSnapshot[]
  trip?: {
    startDate?: string
    endDate?: string
    days?: number
    views?: number
    subscribersGained?: number
    subscribersLost?: number
    netSubscribers?: number
    minutesWatched?: number
    averageViewDuration?: number
  }
  baseline?: {
    startDate?: string
    endDate?: string
    days?: number
    views?: number
    subscribersGained?: number
    subscribersLost?: number
    netSubscribers?: number
    minutesWatched?: number
  }
  baselinePeriod?: unknown
  deltas?: {
    views?: number
    subscribersGained?: number
    netSubscribers?: number
    minutesWatched?: number
  }
  dailySeries?: { date: string; views: number; subscribersGained: number; subscribersLost: number; netSubscribers: number }[]
  trafficSources?: unknown
}

interface VisitsBlock {
  source?: string
  trip?: { startDate?: string; endDate?: string; sessions: number; users: number }
  baseline?: { startDate?: string; endDate?: string; sessions: number; users: number }
  organicTrip?: number
  organicBaseline?: number
  organicLift?: number
  breakdown?: { category: string; trip: number; baseline: number; delta: number; organic: boolean }[]
  daily?: { date: string; sessions: number; users: number }[]
  asOf?: string
}

interface AggregateBlock {
  leads?: {
    direct?: { value: number; source?: string; note?: string | null }
    halo?: {
      organicTrip: number
      organicBaseline: number
      organicLift: number
      tripStart?: string
      baselineStart?: string
      tripDays?: number
      source?: string
      breakdown?: { source: string; trip: number; baseline: number; delta: number; organic: boolean }[]
    }
    asOf?: string
  }
  visits?: VisitsBlock
  followers?: {
    ig?: FollowerSeries
    yt?: FollowerSeries
  }
}

/* ============================================================
   HELPERS
   ============================================================ */

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toString()
}

function fmtEUR(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return '€' + (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return '€' + (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return '€' + n.toLocaleString()
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return (n * 100).toFixed(2) + '%'
}

function sumOr(arr: (number | null | undefined)[]): number | null {
  const nums = arr.filter((v): v is number => typeof v === 'number')
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0)
}

function totalEngagement(c: ContentPiece): number | null {
  return sumOr([
    c.engagement?.likes ?? null,
    c.engagement?.comments ?? null,
    c.engagement?.shares ?? null,
    c.engagement?.saves ?? null,
  ])
}

function platformLabel(p: string, t: string): string {
  if (p === 'youtube') return 'YouTube'
  if (p === 'instagram') {
    if (t === 'reel') return 'IG Reel'
    if (t === 'post') return 'IG Post'
    if (t === 'story') return 'IG Story'
    if (t === 'story_batch') return 'IG Stories'
  }
  if (p === 'tiktok') return 'TikTok'
  return p
}

/* ============================================================
   COMPONENTS
   ============================================================ */

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white p-6 shadow-sm', className)}>
      {children}
    </div>
  )
}

function InfoIcon({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group ml-1">
      <Info className="h-3.5 w-3.5 text-gray-400" aria-label={text} />
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden w-max max-w-[240px] -translate-x-1/2 transform whitespace-normal rounded-md bg-[#1A1A2E] px-3 py-2 text-xs font-medium text-white shadow-lg group-hover:block"
        role="tooltip"
      >
        {text}
        <span className="absolute top-full left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 transform bg-[#1A1A2E]" />
      </span>
    </span>
  )
}

function StageCard({
  step,
  title,
  value,
  sub,
  icon,
  hint,
}: {
  step: number
  title: string
  value: string
  sub: React.ReactNode
  icon: React.ReactNode
  hint: string
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-gray-500 inline-flex items-center">
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#B39262]/10 text-[10px] font-semibold text-[#B39262]">
              {step}
            </span>
            {title}
            <InfoIcon text={hint} />
          </p>
          <div className="mt-1 text-2xl font-semibold text-gray-900 truncate">{value}</div>
          <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
        </div>
        <div className="ml-3 shrink-0 text-[#B39262]">{icon}</div>
      </div>
    </Card>
  )
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    'PRE-BASELINE': 'bg-amber-50 text-amber-700 border-amber-200',
    LIVE: 'bg-green-50 text-green-700 border-green-200',
    POST: 'bg-blue-50 text-blue-700 border-blue-200',
  }
  const cls = styles[status] || styles['PRE-BASELINE']
  return (
    <span className={cn('inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-wide', cls)}>
      {status === 'LIVE' && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />}
      {status}
    </span>
  )
}

/* ============================================================
   PAGE
   ============================================================ */

export default function DobrikTripPage() {
  const trip = data.trip
  const targets = data.targets
  const creators = data.creators as Creator[]
  const aggBlock = (data as unknown as { aggregate?: AggregateBlock }).aggregate
  const hsHalo = aggBlock?.leads?.halo ?? null
  const ytChannel = aggBlock?.followers?.yt ?? null

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }))

  const totals = useMemo(() => {
    const all = creators.flatMap((c) => c.content)
    const reach = sumOr(all.map((c) => c.reach?.value ?? null))
    const engagementTotal = sumOr(all.map((c) => totalEngagement(c)))
    const dataAny = data as unknown as { aggregate?: AggregateBlock }
    const agg = dataAny.aggregate

    // Visits: prefer aggregate GA4 organic lift, fallback to per-content sum
    const visitsAgg = agg?.visits
    const visitsOrganicLift = visitsAgg?.organicLift ?? null
    const visitsTrip = visitsAgg?.trip?.sessions ?? null
    const visitsBaseline = visitsAgg?.baseline?.sessions ?? null
    const visitsLiftPct =
      visitsAgg?.organicTrip && visitsAgg?.organicBaseline
        ? (visitsAgg.organicTrip - visitsAgg.organicBaseline) / visitsAgg.organicBaseline
        : null
    const visits = visitsOrganicLift !== null ? visitsOrganicLift : sumOr(all.map((c) => c.activation?.visits?.value ?? null))
    const leadsAgg = agg?.leads
    const leadsDirect = leadsAgg?.direct?.value ?? null
    const leadsHalo = leadsAgg?.halo?.organicLift ?? null
    const leadsTotal =
      leadsDirect !== null && leadsHalo !== null
        ? leadsDirect + Math.max(0, leadsHalo)
        : leadsDirect ?? leadsHalo ?? sumOr(all.map((c) => c.activation?.leads?.value ?? null))

    // Followers: from aggregate IG + YT
    const igDelta = agg?.followers?.ig?.tripDelta ?? null
    const ytDelta = agg?.followers?.yt?.tripDelta ?? null
    const ytNetDelta = agg?.followers?.yt?.tripNetDelta ?? null
    const ytLift = agg?.followers?.yt?.tripLiftVsBaseline ?? null
    const newFollowers =
      igDelta !== null || ytDelta !== null
        ? (igDelta ?? 0) + (ytDelta ?? 0)
        : sumOr(all.map((c) => c.activation?.newFollowers?.value ?? null))

    const bookings = sumOr(all.map((c) => c.roi?.bookings?.value ?? null))
    const rvc = sumOr(all.map((c) => c.roi?.rvc?.value ?? null))
    const engagementRate = reach && engagementTotal && reach > 0 ? engagementTotal / reach : null
    const roiMultiple = rvc && trip.investment ? rvc / trip.investment : null
    return {
      reach,
      engagementTotal,
      engagementRate,
      visits,
      leads: leadsTotal,
      leadsDirect,
      leadsHalo,
      leadsAgg,
      newFollowers,
      igDelta,
      ytDelta,
      ytNetDelta,
      ytLift,
      ytCurrent: agg?.followers?.yt?.current ?? null,
      igCurrent: agg?.followers?.ig?.current ?? null,
      visitsAgg,
      visitsTrip,
      visitsBaseline,
      visitsOrganicLift,
      visitsLiftPct,
      hubspotBreakdown: agg?.leads?.halo?.breakdown ?? null,
      bookings,
      rvc,
      roiMultiple,
      contentCount: all.length,
    }
  }, [creators, trip.investment])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {/* HEADER */}
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Goolets × Creator Trip</p>
            <h1 className="mt-1 text-3xl font-semibold text-gray-900">{trip.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-600">
              <StatusPill status={trip.status} />
              <span>
                {trip.startDate} → {trip.endDate}
              </span>
              <span className="text-gray-300">·</span>
              <span>
                Invest: <strong className="text-gray-900">€{trip.investment.toLocaleString()}</strong>
              </span>
              <span className="text-gray-300">·</span>
              <span>
                {creators.length} creators · {(trip.combinedFollowerBase / 1_000_000).toFixed(1)}M follower base
              </span>
            </div>
          </div>
        </header>

        {/* AGGREGATE FUNNEL — 4 STAGE CARDS */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StageCard
            step={1}
            title="Reach"
            value={fmtNum(totals.reach)}
            sub={`Cilj ${fmtNum(targets.reachTotal)} · ${totals.contentCount} content piece${totals.contentCount === 1 ? '' : 's'}`}
            icon={<Eye className="h-5 w-5" />}
            hint="Skupno število ljudi, ki so videli objave (posts/reels/stories) iz Dobrik tripa. Vir: Modash. Stories: 1 batch na creator = 1 unique daily audience (ne sumiramo per-story, ker je ista publika). Reels: Modash ne pošlje pravega reach, prikazujemo reelPlayCount (views, ne unique)."
          />
          <StageCard
            step={2}
            title="Engagement"
            value={fmtNum(totals.engagementTotal)}
            sub={`${fmtPct(totals.engagementRate)} ER · likes + comments`}
            icon={<Heart className="h-5 w-5" />}
            hint="Likes + comments na posts in reels iz Dobrik tripa. Stories nimajo public engagement v Modash (likeCount=0). Modash trenutno ne meri shares/saves. ER je izračunan na vse reach vključno s stories; če gledaš samo posts+reels: ~4.3%."
          />
          <ActivationCard totals={totals} />

          <StageCard
            step={4}
            title="ROI"
            value={fmtEUR(totals.rvc)}
            sub={`${fmtNum(totals.bookings)} bookings · ${
              totals.roiMultiple !== null ? totals.roiMultiple.toFixed(2) + '× invest' : '—'
            }`}
            icon={<Trophy className="h-5 w-5" />}
            hint="Confirmed bookings + revenue attributable to Dobrik creator trip. Vir: Streak CRM, filter SOURCE PLACEMENT = CREATOR_TRIP_DOBRIK. ROI multiple = RVC / €30K invest. Pipeline še ni povezan."
          />
        </div>

        {/* PER-CREATOR SECTION */}
        <div className="mt-10 mb-3 flex items-baseline justify-between">
          <div className="flex items-center gap-1">
            <h2 className="text-lg font-semibold text-gray-900">Per Creator</h2>
            <InfoIcon text="Klikni vrstico za drill-down v posamezne objave. Stories so združene v dnevne batche zaradi identičnega reach-a v Modash." />
          </div>
          <span className="text-xs text-gray-500">{creators.filter((c) => c.content.length > 0).length} aktivnih · {creators.filter((c) => c.content.length === 0).length} pending</span>
        </div>

        {/* COLUMN HEADER WITH TOOLTIPS — outside Card to avoid overflow clipping */}
        <div className="grid grid-cols-[1.4fr_repeat(6,minmax(0,1fr))] items-center gap-3 rounded-t-xl border border-b-0 border-gray-200 bg-gray-50 px-5 py-2.5 text-[10px] uppercase tracking-wide text-gray-500">
          <div>Creator</div>
          <ColHeader label="Reach" hint="Unique people, ki so videli objave tega creatorja (Modash). Stories: 1 batch = dnevni audience reach od tega avtorja. Reels: reelPlayCount (views, ne unique people)." />
          <ColHeader label="Eng." hint="Likes + comments na njegovih posts in reels. Stories nimajo public engagement v Modash. Shares/saves še niso v Modash data." />
          <ColHeader label="Visits" hint="Obiski goolets.com preko UTM linka dodeljenega temu creator-ju (utm_source=creator_<id>). Vir: GA4. Pipeline še ni povezan." />
          <ColHeader label="Leads" hint="Leadi v Streak CRM attributani temu creator-ju preko utm_source v SOURCE PLACEMENT polju. Pipeline še ni povezan." />
          <ColHeader label="Followers" hint="Novi @goolets followers, ki jih je creator prinesel. Realno merimo overall @goolets growth v času trip-a in proporcionalno pripišemo reach-u (per-creator IG attribution ni možen direktno). Pipeline še ni povezan." />
          <ColHeader label="Book/RVC" hint="Confirmed bookings + revenue (RVC) attributable temu creator-ju preko Streak CRM SOURCE PLACEMENT filter. Pipeline še ni povezan." />
        </div>
        <Card className="!p-0 !rounded-t-none overflow-hidden">
          {creators.map((c, idx) => {
            const reach = sumOr(c.content.map((p) => p.reach?.value ?? null))
            const eng = sumOr(c.content.map((p) => totalEngagement(p)))
            const visits = sumOr(c.content.map((p) => p.activation?.visits?.value ?? null))
            const leads = sumOr(c.content.map((p) => p.activation?.leads?.value ?? null))
            const newFol = sumOr(c.content.map((p) => p.activation?.newFollowers?.value ?? null))
            const bookings = sumOr(c.content.map((p) => p.roi?.bookings?.value ?? null))
            const rvc = sumOr(c.content.map((p) => p.roi?.rvc?.value ?? null))

            const isOpen = expanded[c.id] ?? false
            const hasContent = c.content.length > 0

            return (
              <div key={c.id} className={cn(idx > 0 && 'border-t border-gray-200')}>
                <button
                  type="button"
                  onClick={() => hasContent && toggle(c.id)}
                  disabled={!hasContent}
                  className={cn(
                    'w-full grid grid-cols-[1.4fr_repeat(6,minmax(0,1fr))] items-center gap-3 px-5 py-4 text-left transition',
                    hasContent ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default opacity-60',
                    isOpen && 'bg-gray-50',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {hasContent ? (
                        isOpen ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                      ) : (
                        <span className="inline-block h-4 w-4 shrink-0" />
                      )}
                      <span className="font-semibold text-sm text-gray-900 truncate">{c.name}</span>
                    </div>
                    <div className="ml-6 mt-0.5 text-[11px] text-gray-500">
                      {c.handle} · IG {fmtNum(c.followers.ig)}
                      {c.followers.yt > 0 ? ` · YT ${fmtNum(c.followers.yt)}` : ''}
                      {' · '}
                      {hasContent ? `${c.content.length} piece${c.content.length === 1 ? '' : 's'}` : 'no content yet'}
                    </div>
                  </div>
                  <MetricCell value={fmtNum(reach)} label="reach" />
                  <MetricCell value={fmtNum(eng)} label="eng." />
                  <MetricCell value={fmtNum(visits)} label="visits" />
                  <MetricCell value={fmtNum(leads)} label="leads" />
                  <MetricCell
                    value={`${newFol !== null && newFol >= 0 ? '+' : ''}${fmtNum(newFol)}`}
                    label="followers"
                  />
                  <MetricCell
                    value={
                      <>
                        {fmtNum(bookings)}
                        {rvc !== null && (
                          <span className="ml-1 text-[11px] font-normal text-gray-500">/ {fmtEUR(rvc)}</span>
                        )}
                      </>
                    }
                    label="book / RVC"
                  />
                </button>

                {isOpen && hasContent && (
                  <div className="bg-gray-50/60 border-t border-gray-200 px-5 pb-5 pt-2">
                    <table className="min-w-full text-[12px]">
                      <thead>
                        <tr className="text-left text-[10px] uppercase text-gray-500">
                          <th className="py-2 pl-6 pr-3">Content</th>
                          <th className="py-2 px-3 text-right">Reach</th>
                          <th className="py-2 px-3 text-right">Eng.</th>
                          <th className="py-2 px-3 text-right">Visits</th>
                          <th className="py-2 px-3 text-right">Leads</th>
                          <th className="py-2 px-3 text-right">+Fol</th>
                          <th className="py-2 px-3 text-right">Book/RVC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.content.map((p) => (
                          <tr key={p.id} className="border-t border-gray-200">
                            <td className="py-2 pl-6 pr-3 align-top">
                              <div className="flex items-center gap-2 font-medium text-gray-900">
                                {platformLabel(p.platform, p.type)}
                                {p.storyCount && p.storyCount > 1 && (
                                  <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[9px] font-semibold text-gray-700">
                                    ×{p.storyCount}
                                  </span>
                                )}
                                {p.postedDate && <span className="text-gray-500 font-normal">· {p.postedDate}</span>}
                              </div>
                              <div className="mt-0.5 max-w-[420px] text-[11px] text-gray-600 truncate">
                                {p.url ? (
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 hover:text-[#B39262]"
                                  >
                                    {p.title || p.url}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  p.title || '—'
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right font-medium text-gray-900">{fmtNum(p.reach?.value)}</td>
                            <td className="py-2 px-3 text-right text-gray-700">{fmtNum(totalEngagement(p))}</td>
                            <td className="py-2 px-3 text-right text-gray-400">{fmtNum(p.activation?.visits?.value)}</td>
                            <td className="py-2 px-3 text-right text-gray-400">{fmtNum(p.activation?.leads?.value)}</td>
                            <td className="py-2 px-3 text-right text-gray-400">{fmtNum(p.activation?.newFollowers?.value)}</td>
                            <td className="py-2 px-3 text-right text-gray-400">
                              {fmtNum(p.roi?.bookings?.value)}
                              {p.roi?.rvc?.value !== null && p.roi?.rvc?.value !== undefined && (
                                <span className="ml-1 text-[10px]">/ {fmtEUR(p.roi.rvc.value)}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-3 ml-6 text-[10px] text-gray-500">Deliverables: {c.deliverables}</div>
                  </div>
                )}
              </div>
            )
          })}
        </Card>

        {/* GOOLETS YOUTUBE CHANNEL — trip vs baseline (views, watch time, subs) */}
        {ytChannel?.trip && <YouTubeChannelCard yt={ytChannel} />}

        {/* DAILY SPARKLINE — GA4 sessions during trip */}
        {totals.visitsAgg?.daily && totals.visitsAgg.daily.length > 0 && totals.visitsAgg.baseline && (
          <DailySparkline
            daily={totals.visitsAgg.daily}
            baselineAvg={(totals.visitsAgg.baseline.sessions || 0) / Math.max(1, totals.visitsAgg.daily.length)}
          />
        )}

        {/* TRIP vs BASELINE BREAKDOWN */}
        {(totals.hubspotBreakdown || totals.visitsAgg?.breakdown) && (
          <BreakdownSection
            hubspotBreakdown={totals.hubspotBreakdown}
            ga4Breakdown={totals.visitsAgg?.breakdown ?? null}
            hubspotOrganicLift={totals.leadsHalo}
            ga4OrganicLift={totals.visitsOrganicLift}
            hubspotOrganicTrip={hsHalo?.organicTrip ?? null}
            hubspotOrganicBaseline={hsHalo?.organicBaseline ?? null}
            ga4OrganicTrip={totals.visitsAgg?.organicTrip ?? null}
            ga4OrganicBaseline={totals.visitsAgg?.organicBaseline ?? null}
            tripStart={trip.startDate}
            tripEnd={trip.endDate}
          />
        )}

        {/* SOURCES FOOTER */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white px-5 py-4 text-xs text-gray-600 flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="text-gray-900">Data sources:</strong> Modash (reach + engagement) · GA4 UTM (visits) ·
            Streak <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">CREATOR_TRIP_DOBRIK</code> (leads +
            bookings + RVC) · IG/YT Insights (followers)
          </div>
          <div>
            Last refreshed: <strong className="text-gray-900">{trip.lastRefreshed || 'not yet pulled'}</strong>
          </div>
        </div>

        {(data.trip as { notes?: string }).notes && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <strong>Note:</strong> {(data.trip as { notes?: string }).notes}
          </div>
        )}
      </div>
    </div>
  )
}

/* Aktivacija card — 3 metric rows: visits + leads + followers */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ActivationCard({ totals }: { totals: any }) {
  const v = totals.visitsAgg
  const visitsHint = v
    ? `VISITS: GA4 organic-channel sessions (organic search + social referrals + direct + other referrals). Paid social/search excluded. Trip ${v.organicTrip?.toLocaleString() ?? '—'} vs baseline ${v.organicBaseline?.toLocaleString() ?? '—'} = ${(v.organicLift ?? 0) >= 0 ? '+' : ''}${v.organicLift?.toLocaleString()} lift.`
    : 'VISITS via GA4 — pipeline not connected yet.'

  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs uppercase tracking-wide text-gray-500 inline-flex items-center">
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#B39262]/10 text-[10px] font-semibold text-[#B39262]">3</span>
          Aktivacija
          <InfoIcon text="3 metrike pipeline odgovora: kdo je obiskal, kdo se konvertiral, kdo je sledil. Vsaka številka primerja trip vs equal pre-trip baseline." />
        </p>
        <Users className="h-5 w-5 text-[#B39262] shrink-0" />
      </div>

      <div className="space-y-3">
        {/* Visits row */}
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-gray-900 leading-tight inline-flex items-center">
              {totals.visitsOrganicLift !== null
                ? `${totals.visitsOrganicLift >= 0 ? '+' : ''}${fmtNum(totals.visitsOrganicLift)}`
                : '—'}
              <span className="ml-1 text-[10px] uppercase tracking-wider text-gray-500 font-normal">visits lift</span>
              <InfoIcon text={visitsHint} />
            </div>
            <div className="text-[10px] text-gray-500">
              {totals.visitsTrip ? `${fmtNum(totals.visitsTrip)} trip · ${fmtNum(totals.visitsBaseline)} base` : 'GA4'}
            </div>
          </div>
        </div>

        {/* Leads row */}
        <div className="flex items-baseline justify-between gap-2 border-t border-gray-100 pt-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-gray-900 leading-tight inline-flex items-center">
              {totals.leadsHalo !== null
                ? `${totals.leadsHalo >= 0 ? '+' : ''}${totals.leadsHalo}`
                : '—'}
              <span className="ml-1 text-[10px] uppercase tracking-wider text-gray-500 font-normal">leads lift</span>
              <InfoIcon text={`LEADS: HubSpot. Direct = ${totals.leadsDirect ?? 0} contacts s utm_campaign=dobrik (creator UTM linki še niso live). Halo = ${totals.leadsHalo ?? '—'} organic-channel contactov trip vs baseline. Paid + offline izključen.`} />
            </div>
            <div className="text-[10px] text-gray-500">
              {totals.leadsDirect ?? 0} direct UTM · {totals.leadsHalo ?? '—'} organic halo
            </div>
          </div>
        </div>

        {/* Followers row */}
        <div className="flex items-baseline justify-between gap-2 border-t border-gray-100 pt-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-gray-900 leading-tight inline-flex items-center">
              {totals.ytDelta !== null ? `+${fmtNum(totals.ytDelta)}` : '—'}
              <span className="ml-1 text-[10px] uppercase tracking-wider text-gray-500 font-normal">YT new subs</span>
              <InfoIcon text="FOLLOWERS: Goolets YT subscribersGained iz YouTube Analytics API. @goolets IG: manual snapshot — še ni postavljen za ta trip." />
            </div>
            <div className="text-[10px] text-gray-500">
              {totals.ytLift !== null && totals.ytLift !== 0 && (
                <span className={totals.ytLift > 0 ? 'text-green-600' : 'text-red-600'}>
                  {totals.ytLift >= 0 ? '+' : ''}{totals.ytLift} vs base
                </span>
              )}
              {totals.ytLift !== null && totals.ytLift !== 0 && ' · '}
              {totals.igDelta !== null ? `${totals.igDelta >= 0 ? '+' : ''}${fmtNum(totals.igDelta)} IG` : '— IG'}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

function MetricCell({ value }: { value: React.ReactNode; label?: string }) {
  return (
    <div className="text-right">
      <div className="text-sm font-semibold text-gray-900 leading-tight">{value}</div>
    </div>
  )
}

function ColHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="text-right inline-flex items-center justify-end gap-0.5">
      {label}
      <InfoIcon text={hint} />
    </div>
  )
}

/* Goolets YouTube channel card — trip vs baseline (views, watch time, subs) */
function YouTubeChannelCard({ yt }: { yt: FollowerSeries }) {
  const t = yt.trip
  const b = yt.baseline
  const d = yt.deltas
  if (!t) return null

  function fmtMinutes(min?: number | null) {
    if (min == null) return '—'
    if (min < 60) return `${min}m`
    const hours = Math.floor(min / 60)
    if (hours < 1000) return `${hours}h`
    return `${(hours / 1000).toFixed(1)}k h`
  }
  function deltaBadge(value: number | undefined, formatter: (n: number) => string, inverse = false) {
    if (value == null) return null
    const positive = value > 0
    const good = inverse ? !positive : positive
    const color = value === 0 ? 'text-gray-500' : good ? 'text-green-600' : 'text-red-600'
    const sign = value > 0 ? '+' : ''
    return <span className={cn('text-xs font-medium', color)}>{sign}{formatter(value)} vs base</span>
  }

  const dailyMax = Math.max(...(yt.dailySeries?.map(d => d.views) ?? [0]), 1)
  const baselineDailyAvg = b?.views && b?.days ? Math.round(b.views / b.days) : null

  return (
    <Card className="mt-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
            <svg viewBox="0 0 24 24" fill="#FF0000" className="h-6 w-6"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Goolets YouTube channel</h3>
              <InfoIcon text="Goolets brand YT channel performance during trip vs baseline (9 days before trip). Source: YouTube Analytics API. Note: Dobrik trip video has not dropped yet — channel views during trip are naturally below baseline." />
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              {yt.current ? `${fmtNum(yt.current)} subs total` : 'subs total —'} · Trip {t.startDate} → {t.endDate} ({t.days}d)
            </div>
          </div>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800">
          Pre-Dobrik video
        </span>
      </div>

      {/* Metric grid: trip stats with baseline delta badges */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Views</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{fmtNum(t.views)}</div>
          <div className="mt-1 text-[11px] text-gray-500">
            base {fmtNum(b?.views)} · {deltaBadge(d?.views, (n) => fmtNum(Math.abs(n)))}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Watch time</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{fmtMinutes(t.minutesWatched)}</div>
          <div className="mt-1 text-[11px] text-gray-500">
            avg {t.averageViewDuration ?? '—'}s · {deltaBadge(d?.minutesWatched, fmtMinutes)}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Subs gained</div>
          <div className="mt-1 text-xl font-semibold text-green-700">+{t.subscribersGained ?? 0}</div>
          <div className="mt-1 text-[11px] text-gray-500">
            base +{b?.subscribersGained ?? 0} · {deltaBadge(d?.subscribersGained, (n) => String(Math.abs(n)))}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Net subs</div>
          <div className={cn('mt-1 text-xl font-semibold', (t.netSubscribers ?? 0) >= 0 ? 'text-green-700' : 'text-red-700')}>
            {(t.netSubscribers ?? 0) > 0 ? '+' : ''}{t.netSubscribers ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            +{t.subscribersGained ?? 0} / −{t.subscribersLost ?? 0} · {deltaBadge(d?.netSubscribers, (n) => String(Math.abs(n)))}
          </div>
        </div>
      </div>

      {/* Daily views sparkline if available */}
      {yt.dailySeries && yt.dailySeries.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-700">Daily views</span>
            {baselineDailyAvg && (
              <span className="text-[11px] text-gray-500">Baseline avg: <strong className="text-gray-900">{fmtNum(baselineDailyAvg)}</strong>/day</span>
            )}
          </div>
          <div className="relative h-20 flex items-end gap-1.5">
            {yt.dailySeries.map((day) => {
              const heightPct = (day.views / dailyMax) * 100
              const aboveBaseline = baselineDailyAvg !== null && day.views > (baselineDailyAvg ?? 0)
              return (
                <div key={day.date} className="flex-1 relative group h-full flex flex-col items-stretch justify-end">
                  <div
                    className={cn('w-full rounded-t', aboveBaseline ? 'bg-[#B39262]' : 'bg-gray-300')}
                    style={{ height: `${heightPct}%`, minHeight: '4px' }}
                  />
                  <span className="absolute -top-7 left-1/2 -translate-x-1/2 text-[10px] opacity-0 group-hover:opacity-100 whitespace-nowrap bg-gray-900 text-white px-2 py-0.5 rounded pointer-events-none z-10">
                    {day.views.toLocaleString()} views · {day.netSubscribers >= 0 ? '+' : ''}{day.netSubscribers} subs
                  </span>
                  <span className="mt-1 text-center text-[9px] text-gray-500">{day.date.slice(5)}</span>
                </div>
              )
            })}
            {baselineDailyAvg && (
              <div
                className="absolute left-0 right-0 border-t border-dashed border-gray-400 pointer-events-none"
                style={{ bottom: `${(baselineDailyAvg / dailyMax) * 100}%` }}
              />
            )}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
        <strong>Why views are below baseline:</strong> Dobrik's trip video has not been published yet. Once it drops,
        expect a spike (his videos typically pull 5–10M views in week 1). Track @goolets channel ID <code className="rounded bg-amber-100 px-1 py-0.5">{yt.channelId}</code>.
      </div>
    </Card>
  )
}

/* Daily sparkline — bar chart of GA4 sessions during trip with baseline avg line */
function DailySparkline({
  daily,
  baselineAvg,
}: {
  daily: { date: string; sessions: number; users: number }[]
  baselineAvg: number | null
}) {
  const max = Math.max(...daily.map((d) => d.sessions), baselineAvg ?? 0)
  function fmtDate(d: string) {
    // YYYYMMDD → DD MMM
    if (/^\d{8}$/.test(d)) {
      const day = d.slice(6, 8)
      const month = d.slice(4, 6)
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      return `${parseInt(day, 10)} ${monthNames[parseInt(month, 10) - 1] || month}`
    }
    return d
  }
  return (
    <Card className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-gray-900">Daily site sessions (GA4)</h3>
          <InfoIcon text="Total goolets.com sessions per day during trip. Dashed line = average daily sessions during baseline period (same number of days before trip start). Spike days often correlate with creator post drops." />
        </div>
        {baselineAvg !== null && (
          <span className="text-[11px] text-gray-500">
            Baseline avg: <strong className="text-gray-900">{Math.round(baselineAvg).toLocaleString()}</strong>/day
          </span>
        )}
      </div>
      <div>
        {/* Bars row — full height, no label inside */}
        <div className="relative h-32 flex items-end gap-1.5">
          {daily.map((d) => {
            const heightPct = max > 0 ? (d.sessions / max) * 100 : 0
            const aboveBaseline = baselineAvg !== null && d.sessions > baselineAvg
            return (
              <div key={d.date} className="flex-1 relative group h-full flex items-end">
                <div
                  className={cn(
                    'w-full rounded-t transition-all',
                    aboveBaseline ? 'bg-[#B39262]' : 'bg-gray-300'
                  )}
                  style={{ height: `${heightPct}%`, minHeight: '4px' }}
                />
                <span className="absolute -top-7 left-1/2 -translate-x-1/2 text-[10px] opacity-0 group-hover:opacity-100 whitespace-nowrap bg-gray-900 text-white px-2 py-0.5 rounded pointer-events-none z-10">
                  {d.sessions.toLocaleString()}
                </span>
              </div>
            )
          })}
          {/* Baseline line — overlays bars */}
          {baselineAvg !== null && max > 0 && (
            <div
              className="absolute left-0 right-0 border-t border-dashed border-gray-400 pointer-events-none"
              style={{ bottom: `${(baselineAvg / max) * 100}%` }}
            />
          )}
        </div>
        {/* Labels row */}
        <div className="mt-1.5 flex gap-1.5">
          {daily.map((d) => (
            <div key={d.date} className="flex-1 text-center text-[10px] text-gray-500 whitespace-nowrap">
              {fmtDate(d.date)}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

/* Trip vs Baseline — 2 side-by-side breakdown tables */
function BreakdownSection({
  hubspotBreakdown,
  ga4Breakdown,
  hubspotOrganicLift,
  ga4OrganicLift,
  hubspotOrganicTrip,
  hubspotOrganicBaseline,
  ga4OrganicTrip,
  ga4OrganicBaseline,
  tripStart,
  tripEnd,
}: {
  hubspotBreakdown: { source: string; trip: number; baseline: number; delta: number; organic: boolean }[] | null
  ga4Breakdown: { category: string; trip: number; baseline: number; delta: number; organic: boolean }[] | null
  hubspotOrganicLift: number | null
  ga4OrganicLift: number | null
  hubspotOrganicTrip: number | null
  hubspotOrganicBaseline: number | null
  ga4OrganicTrip: number | null
  ga4OrganicBaseline: number | null
  tripStart: string
  tripEnd: string
}) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-gray-900">Trip vs Baseline Breakdown</h3>
          <InfoIcon text={`Primerjava trip-period (${tripStart} → ${tripEnd}) z enako dolgim oknom pred tripom. Tabele pokažejo kateri kanali se dvigujejo — proxy za creator content impact. Paid kanali (ad spend driven) so dim-ani; organic kanali so highlighted in seštevek prikazan kot "Organic Lift".`} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {hubspotBreakdown && (
          <BreakdownTable
            title="HubSpot — Leads by source"
            rows={hubspotBreakdown.map((r) => ({ ...r, category: r.source }))}
            organicTrip={hubspotOrganicTrip}
            organicBaseline={hubspotOrganicBaseline}
            organicLift={hubspotOrganicLift}
            hint="Contacti ustvarjeni v HubSpotu, grupirani po hs_analytics_source. Organic kanali (search/social/direct/referrals/other) prispevajo k Dobrik halo lift-u. Paid social/search izključen kot ad-spend driven."
          />
        )}
        {ga4Breakdown && (
          <BreakdownTable
            title="GA4 — Site traffic by source"
            rows={ga4Breakdown}
            organicTrip={ga4OrganicTrip}
            organicBaseline={ga4OrganicBaseline}
            organicLift={ga4OrganicLift}
            hint="goolets.com sessions iz GA4, kategorizirani po session source/medium. ORGANIC_SOCIAL = referral iz IG/YT/FB/Twitter brez paid. Daleč najmočnejši Dobrik signal."
          />
        )}
      </div>
    </div>
  )
}

function BreakdownTable({
  title,
  rows,
  organicTrip,
  organicBaseline,
  organicLift,
  hint,
}: {
  title: string
  rows: { category: string; trip: number; baseline: number; delta: number; organic: boolean }[]
  organicTrip: number | null
  organicBaseline: number | null
  organicLift: number | null
  hint: string
}) {
  const sorted = [...rows].sort((a, b) => {
    if (a.organic !== b.organic) return a.organic ? -1 : 1
    return b.trip - a.trip
  })
  return (
    <Card>
      <div className="mb-3 flex items-center gap-1">
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        <InfoIcon text={hint} />
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-2">Source</th>
            <th className="py-2 px-2 text-right">Trip</th>
            <th className="py-2 px-2 text-right">Base</th>
            <th className="py-2 pl-2 text-right">Δ</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.category} className={cn('border-b last:border-0 border-gray-100', !r.organic && 'opacity-50')}>
              <td className="py-1.5 pr-2 font-medium text-gray-900">
                {r.organic && <span className="text-[#B39262] mr-1">●</span>}
                {r.category}
              </td>
              <td className="py-1.5 px-2 text-right text-gray-700">{r.trip.toLocaleString()}</td>
              <td className="py-1.5 px-2 text-right text-gray-500">{r.baseline.toLocaleString()}</td>
              <td
                className={cn(
                  'py-1.5 pl-2 text-right font-medium',
                  r.delta > 0 ? 'text-green-600' : r.delta < 0 ? 'text-red-600' : 'text-gray-400'
                )}
              >
                {r.delta >= 0 ? '+' : ''}
                {r.delta.toLocaleString()}
              </td>
            </tr>
          ))}
          {organicLift !== null && (
            <tr className="border-t-2 border-gray-300 bg-gray-50/50 font-semibold">
              <td className="py-2 pr-2 text-gray-900">ORGANIC LIFT</td>
              <td className="py-2 px-2 text-right text-gray-900">{(organicTrip ?? 0).toLocaleString()}</td>
              <td className="py-2 px-2 text-right text-gray-700">{(organicBaseline ?? 0).toLocaleString()}</td>
              <td className={cn('py-2 pl-2 text-right', organicLift >= 0 ? 'text-green-700' : 'text-red-700')}>
                {organicLift >= 0 ? '+' : ''}
                {organicLift.toLocaleString()}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mt-2 text-[10px] text-gray-400">● = organic / earned (Dobrik-attributable). Faded rows = paid / non-attributable.</div>
    </Card>
  )
}
