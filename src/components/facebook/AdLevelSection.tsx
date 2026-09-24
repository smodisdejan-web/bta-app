'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { fetchFbAdsLevel, fetchFbAdCopy, bucketTotals, creativeHighlights, copyByAd, copyLibrary, adsManagerLink, type FbAdLevel, type FbBucket, type FbCopyRow, type CopyVariation, type CopyType } from '@/lib/facebook-ads-level'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Layers, Search, Trophy, AlertTriangle, Flame, ArrowUpRight, ArrowDownRight, Film, ExternalLink, Image as ImageIcon, ChevronDown, ChevronRight, Type as TypeIcon, BookText } from 'lucide-react'

const eur = (n: number, d = 0) => `€${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const pct = (n: number, d = 1) => `${n.toFixed(d)}%`

const BUCKET_META: Record<FbBucket, { label: string; note: string; color: string; bg: string }> = {
  LEAD: { label: 'LEAD', note: 'main report · CPQL zone', color: '#3D7C4D', bg: '#f0f7f1' },
  BOOST: { label: 'BOOST', note: 'awareness · reach/engagement', color: '#C7930A', bg: '#fdf8ec' },
  MATCHMAKER: { label: 'MATCHMAKER', note: 'quiz/registration · excluded from CPQL', color: '#8B7355', bg: '#f6f2ec' },
}

type SortField = 'spend' | 'landingLead' | 'cpl' | 'ctr' | 'hookRate' | 'holdRate' | 'impressions'

export function AdLevelSection() {
  const [ads, setAds] = useState<FbAdLevel[]>([])
  const [copy, setCopy] = useState<FbCopyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bucket, setBucket] = useState<FbBucket>('LEAD')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [libType, setLibType] = useState<CopyType>('primary')
  const [libAll, setLibAll] = useState(false)
  const [libCampaign, setLibCampaign] = useState<string>('all')
  const [libAd, setLibAd] = useState<string>('all')
  const [openCopy, setOpenCopy] = useState<Set<string>>(new Set())
  const toggleCopy = (t: string) => setOpenCopy((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })

  useEffect(() => {
    Promise.all([
      fetchFbAdsLevel().then(setAds),
      fetchFbAdCopy().then(setCopy).catch(() => setCopy([])),
    ])
      .catch((e) => setError(e?.message || 'Failed to load fb_ads_level'))
      .finally(() => setLoading(false))
  }, [])

  const totals = useMemo(() => bucketTotals(ads), [ads])
  const highlights = useMemo(() => creativeHighlights(ads), [ads])
  const qlPending = useMemo(() => ads.length > 0 && ads.every((a) => a.ql === null), [ads])
  const copyMap = useMemo(() => copyByAd(copy), [copy])

  const rows = useMemo(() => {
    let r = ads.filter((a) => a.bucket === bucket)
    if (search) { const t = search.toLowerCase(); r = r.filter((a) => a.adName.toLowerCase().includes(t) || a.campaign.toLowerCase().includes(t)) }
    return [...r].sort((a, b) => {
      const av = a[sortField] as number, bv = b[sortField] as number
      // CPL: lower is better, push 0 (no leads) to bottom
      if (sortField === 'cpl') { const x = av || Infinity, y = bv || Infinity; return sortDir === 'desc' ? x - y : y - x }
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [ads, bucket, search, sortField, sortDir])

  useEffect(() => { setShowAll(false) }, [bucket, search, sortField, sortDir])
  const visible = showAll ? rows : rows.slice(0, 10)

  // Keep the top ad open by default so the copy panel is always visible on load.
  // Picks the first row that actually has copy variations (an ad with no copy would
  // expand to nothing). Re-fires on data load + bucket/sort/search change; manual
  // toggling still works afterwards (rows/copyMap unchanged → effect doesn't override).
  useEffect(() => {
    const first = rows.find((a) => {
      const cp = copyMap.get(a.adId)
      return cp && cp.primary.length + cp.headline.length > 0
    })
    setExpanded(first ? first.adId : null)
  }, [rows, copyMap])

  const sort = (f: SortField) => { if (sortField === f) setSortDir(sortDir === 'desc' ? 'asc' : 'desc'); else { setSortField(f); setSortDir('desc') } }
  const SortIcon = ({ f }: { f: SortField }) => sortField !== f ? null : (sortDir === 'desc' ? <ArrowDownRight className="h-3 w-3 ml-1 inline" /> : <ArrowUpRight className="h-3 w-3 ml-1 inline" />)
  const Th = ({ f, children }: { f: SortField; children: React.ReactNode }) => (
    <TableHead className="text-right cursor-pointer hover:bg-gray-50 whitespace-nowrap" onClick={() => sort(f)}>
      <span className="inline-flex items-center justify-end">{children}<SortIcon f={f} /></span>
    </TableHead>
  )

  const cplColor = (cpl: number) => cpl === 0 ? 'text-gray-300' : cpl < 96 ? 'text-green-600 font-semibold' : cpl < 150 ? 'text-yellow-600' : cpl < 240 ? 'text-orange-600' : 'text-red-600'

  if (loading) return <Card><CardContent className="p-6 text-sm text-gray-500">Loading ad-level data…</CardContent></Card>
  if (error) return <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-red-700 text-sm">{error}</CardContent></Card>

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-3 pt-2">
        <div className="w-10 h-10 rounded-xl bg-[#B39262]/10 flex items-center justify-center">
          <Layers className="h-5 w-5 text-[#B39262]" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-2xl tracking-tight text-gray-900">Ad-Level Deep-Dive</h2>
            <span className="text-[10px] uppercase tracking-[0.25em] text-[#B39262] font-medium mt-1">all live ads</span>
          </div>
          <p className="text-sm text-gray-500">Every live creative — spend, Landing Leads, CPL, Hook/Hold. Exact per ad from Meta export.</p>
        </div>
      </div>

      {qlPending && (
        <div className="flex items-start gap-2 rounded-lg border border-[#e8d5b0]/60 bg-[#fdf8f3] px-4 py-3 text-xs text-[#8B7355]">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-[#b48e49]" />
          <span><strong>QL / CPQL pending</strong> — Meta won't export the UTM that bridges an ad to its Streak quality leads. CPL (Spend ÷ Landing Lead) stands in until the join is added. Quality columns intentionally blank.</span>
        </div>
      )}

      {/* 3-bucket cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {totals.map((t) => {
          const m = BUCKET_META[t.bucket]
          const active = bucket === t.bucket
          return (
            <button key={t.bucket} onClick={() => setBucket(t.bucket)} className="text-left">
              <Card style={{ borderColor: active ? m.color : '#e5e7eb', borderLeftWidth: 3, backgroundColor: active ? m.bg : '#fff' }} className="transition-all hover:shadow-md h-full">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide text-white" style={{ backgroundColor: m.color }}>{m.label}</span>
                    <span className="text-xs text-gray-400">{t.ads} ads</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{eur(t.spend)}</div>
                  <div className="text-xs text-gray-500 mt-1">{t.landingLead} Landing Leads · CPL {t.cpl ? eur(t.cpl) : '—'}</div>
                  <div className="text-[10px] text-gray-400 mt-1">{m.note}</div>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>

      {/* Creative highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <HL icon={Trophy} tint="#3D7C4D" bg="from-green-50 to-emerald-50" label="Best CPL" name={highlights.bestCpl?.adName} value={highlights.bestCpl ? `${eur(highlights.bestCpl.cpl)} · ${highlights.bestCpl.landingLead} LL` : null} />
        <HL icon={Flame} tint="#C7930A" bg="from-amber-50 to-yellow-50" label="Best Hook Rate" name={highlights.bestHook?.adName} value={highlights.bestHook ? `${pct(highlights.bestHook.hookRate * 100)} · ${eur(highlights.bestHook.spend)}` : null} />
        <HL icon={AlertTriangle} tint="#B83C3C" bg="from-red-50 to-rose-50" label="Top spend · 0 leads" name={highlights.topSpendNoLead?.adName} value={highlights.topSpendNoLead ? `${eur(highlights.topSpendNoLead.spend)} · 0 LL` : 'none'} />
      </div>

      {/* Ad table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2"><Film className="h-5 w-5" />{BUCKET_META[bucket].label} ads</CardTitle>
              <CardDescription>{rows.length} live creatives · sorted by {sortField}</CardDescription>
            </div>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Search ad or campaign…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[52px]"></TableHead>
                  <TableHead className="min-w-[220px]">Ad</TableHead>
                  <Th f="spend">Spend</Th>
                  <Th f="impressions">Impr</Th>
                  <Th f="ctr">CTR</Th>
                  <Th f="landingLead">Leads</Th>
                  <Th f="cpl">CPL</Th>
                  <Th f="hookRate">Hook</Th>
                  <Th f="holdRate">Hold</Th>
                  <TableHead className="text-right whitespace-nowrap text-gray-400">QL</TableHead>
                  <TableHead className="text-right whitespace-nowrap text-gray-400">CPQL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-gray-500">No ads</TableCell></TableRow>
                ) : visible.map((a) => {
                  const cp = copyMap.get(a.adId)
                  const nVar = (cp?.primary.length || 0) + (cp?.headline.length || 0)
                  const isOpen = expanded === a.adId
                  return (
                  <React.Fragment key={a.adId}>
                  <TableRow className={`hover:bg-gray-50 ${nVar ? 'cursor-pointer' : ''} ${isOpen ? 'bg-[#fdf8f3]' : ''}`} onClick={() => nVar && setExpanded(isOpen ? null : a.adId)}>
                    <TableCell className="pr-0">
                      <Thumb url={a.thumbUrl} href={adsManagerLink(a.adId)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {nVar > 0 && <ChevronRight className={`h-3.5 w-3.5 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                        <span className="font-medium text-gray-900 truncate max-w-[240px]" title={a.adName}>{a.adName}</span>
                        <a href={adsManagerLink(a.adId)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-gray-300 hover:text-[#B39262] shrink-0" title="Open in Ads Manager"><ExternalLink className="h-3.5 w-3.5" /></a>
                      </div>
                      <div className="text-[11px] text-gray-400 truncate max-w-[280px] flex items-center gap-2" title={a.campaign}>
                        <span className="truncate">{a.campaign}</span>
                        {nVar > 0 && <span className="text-[10px] text-[#B39262] shrink-0">{cp!.primary.length}P · {cp!.headline.length}H copy</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{eur(a.spend)}</TableCell>
                    <TableCell className="text-right text-gray-600">{a.impressions.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-gray-600">{pct(a.ctr)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={a.landingLead > 0 ? 'default' : 'secondary'}>{a.landingLead}</Badge>
                    </TableCell>
                    <TableCell className={`text-right font-mono text-sm ${cplColor(a.cpl)}`}>{a.cpl ? eur(a.cpl) : '—'}</TableCell>
                    <TableCell className="text-right text-gray-600">{pct(a.hookRate * 100)}</TableCell>
                    <TableCell className="text-right text-gray-600">{pct(a.holdRate * 100)}</TableCell>
                    <TableCell className="text-right text-gray-300">—</TableCell>
                    <TableCell className="text-right text-gray-300">—</TableCell>
                  </TableRow>
                  {isOpen && cp && (
                    <TableRow className="bg-[#fdf8f3] hover:bg-[#fdf8f3]">
                      <TableCell colSpan={11} className="py-4">
                        <CopyPanel primary={cp.primary} headline={cp.headline} />
                      </TableCell>
                    </TableRow>
                  )}
                  </React.Fragment>
                )})}
              </TableBody>
            </Table>
          </div>
          {rows.length > 10 && (
            <div className="flex justify-center pt-4">
              <button onClick={() => setShowAll((v) => !v)} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#B39262] hover:text-[#96743c] transition">
                {showAll ? 'Show less' : `See more (${rows.length - 10})`}
                <ChevronDown className={`h-4 w-4 transition-transform ${showAll ? 'rotate-180' : ''}`} />
              </button>
            </div>
          )}
          <p className="text-[11px] text-gray-400 pt-3">Click any ad to expand its primary texts + headlines with per-variation delivery. Leads aren’t available per copy (Meta) — copy signal is delivery-share + CTR.</p>
        </CardContent>
      </Card>

      {/* Copy Library — unique copy aggregated across ads, scoped by campaign → ad (the copywriter's "what works") */}
      {copy.length > 0 && (() => {
        // ad_id → {campaign, name}; only ads that actually have copy
        const adIdsWithCopy = new Set(copy.map((c) => c.adId))
        const adInfo = ads.filter((a) => adIdsWithCopy.has(a.adId))
        const campaigns = Array.from(new Set(adInfo.map((a) => a.campaign))).sort()
        const adsForCampaign = adInfo.filter((a) => libCampaign === 'all' || a.campaign === libCampaign).sort((a, b) => b.spend - a.spend)
        // allowed ad_ids from the two filters
        const allowed = new Set(
          adInfo.filter((a) => (libCampaign === 'all' || a.campaign === libCampaign) && (libAd === 'all' || a.adId === libAd)).map((a) => a.adId)
        )
        const scoped = copy.filter((c) => allowed.has(c.adId))
        const lib = copyLibrary(scoped, libType)
        const vis = libAll ? lib : lib.slice(0, 12)
        const scopeNote = libCampaign === 'all' ? 'across all ads' : libAd === 'all' ? `in ${libCampaign}` : 'in 1 ad'
        return (
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2"><BookText className="h-5 w-5 text-[#B39262]" />Copy Library</CardTitle>
                    <CardDescription>{lib.length} unique {libType === 'primary' ? 'primary texts' : 'headlines'} {scopeNote} — ranked by total delivery · {libAd !== 'all' ? 'full copy shown' : 'click a row for full copy'}</CardDescription>
                  </div>
                  <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-sm self-start">
                    {(['primary', 'headline'] as CopyType[]).map((t) => (
                      <button key={t} onClick={() => { setLibType(t); setLibAll(false) }} className={`px-3 py-1 rounded-md transition ${libType === t ? 'bg-[#B39262] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                        {t === 'primary' ? 'Primary text' : 'Headline'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Filters: campaign → ad */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <Select value={libCampaign} onValueChange={(v) => { setLibCampaign(v); setLibAd('all'); setLibAll(false) }}>
                    <SelectTrigger className="w-full sm:w-[320px]"><SelectValue placeholder="All campaigns" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All campaigns</SelectItem>
                      {campaigns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={libAd} onValueChange={(v) => { setLibAd(v); setLibAll(false) }}>
                    <SelectTrigger className="w-full sm:w-[320px]"><SelectValue placeholder="All ads" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All ads{libCampaign !== 'all' ? ` (${adsForCampaign.length})` : ''}</SelectItem>
                      {adsForCampaign.map((a) => <SelectItem key={a.adId} value={a.adId}>{a.adName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[380px]">{libType === 'primary' ? 'Primary text' : 'Headline'}</TableHead>
                      <TableHead className="text-right">Ads</TableHead>
                      <TableHead className="text-right">Impr</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">CPC</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vis.map((c, i) => {
                      const top = lib[0]?.ctr || 1
                      return (
                        <TableRow key={i} className="hover:bg-gray-50 align-top">
                          <TableCell className="max-w-[560px] cursor-pointer py-3" onClick={() => toggleCopy(c.text)}>
                            {(libAd !== 'all' || openCopy.has(c.text)) ? (
                              <p className="text-[13px] text-gray-800 whitespace-pre-line">{c.text}</p>
                            ) : (
                              <p className="text-sm text-gray-800 truncate" title="Click to expand full copy">{c.text.split('\n').map((l) => l.trim()).find((l) => l) || c.text}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-gray-600">{c.ads}</TableCell>
                          <TableCell className="text-right text-gray-700">{c.impr.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-gray-600">{c.clicks.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <span className={`font-mono text-sm ${c.ctr >= top * 0.9 ? 'text-green-600 font-semibold' : c.ctr >= top * 0.5 ? 'text-gray-700' : 'text-gray-400'}`}>{pct(c.ctr)}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-gray-600">{c.cpc ? eur(c.cpc, 2) : '—'}</TableCell>
                          <TableCell className="text-right text-gray-600">{eur(c.spend)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              {lib.length > 12 && (
                <div className="flex justify-center pt-4">
                  <button onClick={() => setLibAll((v) => !v)} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#B39262] hover:text-[#96743c] transition">
                    {libAll ? 'Show less' : `See all ${lib.length}`}
                    <ChevronDown className={`h-4 w-4 transition-transform ${libAll ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })()}
    </div>
  )
}

// Per-ad expandable: primary texts + headlines with per-variation delivery share + CTR.
function CopyPanel({ primary, headline }: { primary: CopyVariation[]; headline: CopyVariation[] }) {
  const Block = ({ title, icon: Icon, list, isPrimary }: { title: string; icon: any; list: CopyVariation[]; isPrimary: boolean }) => (
    <div className="flex-1 min-w-[300px]">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-[#8B7355]"><Icon className="h-3.5 w-3.5" />{title} <span className="text-gray-400 font-normal normal-case">({list.length})</span></div>
      {list.length === 0 ? <p className="text-xs text-gray-400">none</p> : (
        <div className="space-y-2">
          {list.map((v, i) => (
            <div key={i} className={`rounded-lg border p-2.5 ${i === 0 ? 'border-[#B39262]/40 bg-white' : 'border-gray-100 bg-white/60'}`}>
              <p className={`text-[13px] text-gray-800 ${isPrimary ? 'whitespace-pre-line' : 'font-medium'}`}>{v.text}</p>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-gray-500">
                {i === 0 && <span className="px-1.5 py-0.5 rounded bg-[#B39262] text-white text-[9px] font-bold tracking-wide">WINNER</span>}
                <span className="text-gray-600 font-medium">{v.share.toFixed(0)}% delivery</span>
                <span>{v.impr.toLocaleString()} impr</span>
                <span>{v.clicks.toLocaleString()} clicks</span>
                <span className="font-mono">{pct(v.ctr)} CTR</span>
                <span className="font-mono">{v.cpc ? eur(v.cpc, 2) : '—'} CPC</span>
                <span>{eur(v.spend)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
  return (
    <div className="flex flex-wrap gap-6">
      <Block title="Primary texts" icon={TypeIcon} list={primary} isPrimary />
      <Block title="Headlines" icon={TypeIcon} list={headline} isPrimary={false} />
    </div>
  )
}

function Thumb({ url, href }: { url: string; href: string }) {
  const [err, setErr] = useState(false)
  if (!url || err) {
    return <div className="w-10 h-10 rounded-md bg-gray-100 flex items-center justify-center"><ImageIcon className="h-4 w-4 text-gray-300" /></div>
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block">
      <img src={url} alt="" width={40} height={40} referrerPolicy="no-referrer" onError={() => setErr(true)}
        className="w-10 h-10 rounded-md object-cover ring-1 ring-black/5 hover:ring-[#B39262] transition" />
    </a>
  )
}

function HL({ icon: Icon, tint, bg, label, name, value }: { icon: any; tint: string; bg: string; label: string; name?: string; value: string | null }) {
  return (
    <Card className={`bg-gradient-to-br ${bg} border-0 ring-1 ring-black/5`}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-md bg-white/70"><Icon className="h-4 w-4" style={{ color: tint }} /></div>
          <span className="text-sm font-medium" style={{ color: tint }}>{label}</span>
        </div>
        {name ? (
          <>
            <div className="font-semibold text-gray-900 truncate mb-1" title={name}>{name}</div>
            <div className="text-lg font-bold" style={{ color: tint }}>{value}</div>
          </>
        ) : <div className="text-gray-400 text-sm">No data</div>}
      </CardContent>
    </Card>
  )
}
