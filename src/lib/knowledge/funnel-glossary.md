# Business Health Funnel — glossary and reading rules

This file defines what every number in the funnel facts block actually means. Read it before
answering, and use these definitions instead of the usual industry assumptions.

## The funnel steps

Impressions → Clicks → LP Views → Leads → Quality Leads → Bookings.

Every step is computed over the SAME date window. A step is null when its source cannot answer
for that window, never 0.

| Step | Source | Notes |
|---|---|---|
| Impressions | Meta + Google Ads | paid only |
| Clicks | Meta `link_click` + Google Ads clicks | `clicksAll` is Meta clicks (all) + Google clicks |
| LP Views | GA4, PAID sessions only | organic/direct/referral/email sessions are reported separately as `lpViewsOrganic` |
| Leads | Streak | a lead is a Streak box, inquiry date inside the window |
| Quality Leads (QL) | Streak | a lead whose Streak AI score is **≥ 50**. Nothing else makes a lead "quality" |
| Bookings | `bookings_api` | counted by **booking month** (the month the booking happened), `revenue` = RVC in € |

## QL

QL = Streak AI score ≥ 50. The threshold is fixed. A lead with no AI score is not a QL and is
not counted in the QL denominator either.

The ASSET / RareOps umbrella has an INFLATED Streak AI score, so master QL excludes it. When you
need the "with ASSET" number it is on the QL step as `qualityLeadsIncludingAsset`.

## Umbrella vs platform campaign

- **Umbrella** = the business grouping the portal filters by (`clg`, `caribbean`, `turkey`,
  `earlybook`, `pmax`, …). 15 of them. It is NOT a thing that exists in Meta or Google Ads.
- **Platform campaign** = the actual campaign name inside Meta Ads Manager or Google Ads, for
  example `CLG - Croatia Luxury Gulet - CBO` or `Search - Croatia - EN`. These are the sub-rows
  inside `campaignSummary[].campaigns`.

Umbrellas are mutually exclusive: umbrellas + unattributed = master. Name the umbrella when you
mean the grouping and the platform campaign name when you mean the campaign. Do not invent an
umbrella that is not in the facts.

On a MASTER view the platform campaigns sit in `funnel.campaignSummary[].campaigns`. On an
UMBRELLA view `campaignSummary` is null and the platform campaigns of the selected umbrella sit
in `funnel.campaignMembership.members` instead — use those names to name rows.

## LP views, LP table, and why totals may not tie

- **LP Views** in the funnel = GA4 **paid** sessions on the pages that belong to the selected
  umbrella (matched on the landing-page path).
- The **LP table** (`lps`) is a different attribution model: HubSpot `first_url` — the first page
  the contact ever landed on — joined to Streak for the AI score, with bookings credited by
  booking month to the LP the booker first arrived on.

So the funnel says "GA4 + Streak, this window" and the LP table says "HubSpot first-touch".
The two totals can legitimately differ. Mention this difference ONLY when the relevant totals in
your answer actually differ; do not caveat by reflex.

`matchedInStreak` is the denominator for `qlRate` and `avgAiScore` on an LP row. When it is 0,
QL and AI score for that row are null, not 0.

## Ads table

`ads` comes from the monthly Meta dumps (`fb-ads-monthly.json`), one row per ad, aggregated over
every month the selected range touches.

**Granularity is the MONTH, never the day.** Meta reports each ad per month, so a range that
starts or ends mid-month is answered with the WHOLE of that month. Rankings between ads hold;
the absolute spend, impressions and leads on an ad row are the month's, not the range's. When
`coverage.ads.partialMonths` is non-empty, say so in the answer.

Three different kinds of "not exact", and they mean different things:

- `partialMonths` — the range clips the month, so the ad numbers OVERSTATE the range.
- `incompleteMonths` — the dump does not cover the whole calendar month (2026-07 is capped at
  its top 100 ads, 2026-08 stops on the 30th, 2026-09 is month to date), so it UNDERSTATES the
  calendar month.
- `missingMonths` — a calendar month inside the range with no ad data at all. **2026-06 has no
  ad-level data.** A range that starts in June is missing June's ad spend and June's ad leads
  entirely, and you must say so before ranking anything.
- `uncoveredDays` — days of the range no dump reaches, usually the tail of the current month.

### Per-ad quality leads

`leadsStreak`, `ql`, `cpql` and `qualityRate` come from a join that reads the utm SOURCE
PLACEMENT a lead arrived with and resolves it to one ad name inside one campaign.

- `coverage.adQlJoin.matchedShare` is the fraction of the window's Meta Streak leads the join
  could place on exactly one ad (`matchedLeads` of `fbLeadsInWindow`). Per-ad QL therefore
  describes that share of Meta leads, not all of them. Quote the share when you rank by QL.
- A lead lands on exactly one ad or it lands in `coverage.adQlJoin.unmatchedBySource`. Unmatched
  leads are NEVER spread across ads and never folded into the campaign's biggest spender. When
  the unmatched pile is large, name the top SOURCE PLACEMENT values from that list — that is the
  ad-naming worklist, and it is a real finding, not a footnote.
- `ql: 0` on an ad row means the join placed no quality lead there. It does not prove the ad
  produced none, because the unmatched pile exists.

### Ranking ads

- **Ranking by CPQL requires `ql` at least 5 on the row, and you must say that you applied that
  floor.** One or two quality leads make a CPQL that swings by hundreds of euro and ranks noise.
- Ads below that floor can still be discussed by spend, CPL, CTR, hook rate or hold rate.
- Never rank by CPQL when the spend window and the lead window disagree — that is, when
  `coverage.ads.partialMonths`, `missingMonths` or `uncoveredDays` say the ad spend covers a
  different stretch of time than the leads. Say which one is out of step and rank by something
  the data supports instead.
- Ads are Meta only. A Google, Bing or ChatGPT channel view returns an empty ads array.

## Window vs cohort

- **Window** (the default everywhere): the event is counted in the window it happened in.
  Bookings by booking month, leads by inquiry date, spend by spend date.
- **Cohort** (`bookingsCohort` on the bookings step): bookings counted by the **inquiry date** of
  the lead that produced them, so they are date-exact against the leads in the same window.

The sales cycle runs 3 to 6 months, so a window's bookings are mostly produced by leads from
earlier windows. Never divide this window's bookings by this window's leads and call it a close
rate unless you are using `bookingsCohort` / `leadsToBookingCohortRate`.

## null is not 0

A null means the source cannot answer. A 0 means it answered zero. Report a null as "n/a" and say
which source is missing when the facts say so. Never substitute 0, never average a null away,
never spread a total across rows to fill a gap.

## Attribution gap

`coverage.unattributedLeadsShare` and `campaignMembership.unattributed` hold the leads, QL,
bookings, revenue and spend that could not be pinned to any umbrella. When that share is material,
say so rather than presenting the umbrella breakdown as complete.

## Channels

`meta` (Meta feeds), `google` (Google Ads), `bing` (Microsoft Advertising, test since
2026-09-14), `chatgpt` (OpenAI Ads Manager, live since 2026-09-14), plus `other`
(organic + direct) on the channel split. Bing and ChatGPT are FLAT: their spend sits in the
master total and in `unattributed`, but they never belong to an umbrella.
