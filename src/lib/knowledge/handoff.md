# GOOLETS — KOMPLETNI HANDOFF DOKUMENT
## Zadnjič posodobljeno: 13. marec 2026

---

# 1. O GOOLETSIH

Goolets je premium yacht charter agencija iz Slovenije (CEO: Mitja Mirtič, Marketing Manager: Aymen Boulehmi, tim: Dijana, Nika, Alex). 20+ let izkušenj, 2,800+ charterjev, 30,000+ gostov. Pozicionirajo se kot "accessible luxury" — superyachti za skupine (do 36 gostov), price range €18K-€180K/teden. Ključni differentiator: 1,000+ family reunions, experience-first matching, Yacht Matchmaker quiz. Glavni destinaciji: Hrvaška in Turčija.

**Competitors:** Fraser Yachts (ultra-premium €700K+/teden), Edmiston, Burgess, HELM (personal shopper model), YachtCharterFleet (marketplace). Goolets ima "white space" v affordable luxury + groups segmentu.

**Messaging:** "Architects of Joy" / "The Goolets Way". Priporočeno je owning "group celebrations" territory — reunion, milestone, tribe. Izogibaj se vodenju z "value" ali "lower price" (triggers budget-brand perception).

---

# 2. TRACKING & ATTRIBUTION SISTEM

## 2.1 Orodja
- **GA4** — session-level tracking na goolets.net
- **HubSpot** — form tracking, contact attribution, email marketing
- **Streak CRM** — lead qualification (AI Score), pipeline management, booking tracking
- **Facebook Ads Manager** — campaign management & reporting
- **Google Ads** — campaign management & reporting
- **Mixed Analytics API Connector** — GA4 → Google Sheets data pull (add-on)

## 2.2 Website tech stack
- CMS: **WordPress** (migracija iz prejšnjega CMS v sredini decembra 2025)
- Form embed: **IFRAME** (is-eu1.hsforms.net)
- HubSpot tracking koda: nameščena (hs-script)
- Cookie consent: **Complianz** (Functional, Preferences, Statistics, Marketing)
- GA4 consent mode: aktiven
- reCAPTCHA: vklopljen na formah
- Po submit redirect: external URL → https://www.goolets.net/thank-you

## 2.3 UTM Attribution — REŠENO (13. feb 2026)
**Problem:** HubSpot forme niso zajemale UTM parametrov. Paid traffic kontakti so se prikazovali kot "direct".

**Rešitev:** HubSpot forme z `{{ request.query_dict.utm_source }}` sintakso. Deluje ČEPRAV je forma v iframe embedu.

**Hidden fields na formi "Landing pages Goolets.net (Multi)":**

| Property | Internal name | Default value |
|----------|---------------|---------------|
| UTM Source | utm_source | `{{ request.query_dict.utm_source }}` |
| UTM Medium | utm_medium | `{{ request.query_dict.utm_medium }}` |
| UTM Campaign | utm_campaign | `{{ request.query_dict.utm_campaign }}` |
| UTM Content | utm_content | `{{ request.query_dict.utm_content }}` |
| UTM Term | utm_term | `{{ request.query_dict.utm_term }}` |

**Rezultat po 3 dneh:** 77 kontaktov z UTM podatki, 6 brez (92.8% capture rate). Tisti 6 so prišli čez yacht-specific forme ki so bile fixane naknadno.

**GCLID:** Deluje avtomatsko čez iframe ker ga HubSpot tracking koda (hs-script) zajame neodvisno od forme.

## 2.4 Form View Tracking — ŠE NEREŠENO
**Problem:** Po WordPress migraciji (dec 2025) se form views ne štejejo pravilno.
- Pred migracijo: 25,000-65,000/mesec
- Po migraciji: ~5,000-8,000 views/mesec
- Submissions stabilne → CVR prikazuje nerealne številke (97%+ namesto ~2%)

**Možni vzroki:** Complianz blokira hs-script, iframe lazy load, manjkajoč hs-script na nekaterih straneh.

**Status:** Developer mora debuggati. Debug koraki: `window._hsq` v Console, Network tab filter 'hs-script'.

## 2.5 Direct Traffic razčlenitev
- **GA4 (12 mesecev):** Direct = 16.33% (141,080 sessions) — normalno
- **HubSpot session-level:** Direct = 19% — skoraj enako kot GA4
- **Legitimni direct ("dark social"):** WhatsApp/Viber/iMessage deljenje yacht linkov. 89% direct traffica pristane na specifične `/yacht-rentals/` strani. Normalno za luxury yacht biznis.

## 2.6 GA4 Traffic Breakdown (mar 2025 - feb 2026)

| Kanal | Sessions | Delež |
|-------|----------|-------|
| Paid Social | 325,098 | 37.6% |
| Organic Search | 163,754 | 19.0% |
| Direct | 141,080 | 16.3% |
| Cross-network | 81,000 | 9.4% |
| Paid Search | 60,132 | 7.0% |
| Organic Social | 40,386 | 4.7% |
| Referral | 25,226 | 2.9% |

---

# 3. LEAD QUALIFICATION & STREAK CRM

## 3.1 AI Score sistem
Streak ima polje **"AI"** (ne "Exit - AI Score") ki je numerični quality score 0-100.
- **QL (Quality Lead):** AI Score ≥ 50
- **EX (Excellent Lead):** AI Score ≥ 70

## 3.2 Streak Pipeline Stages — kvalifikacija

**Qualified (dober lead):** Standard, SQL, SQL Prime, VIP, Ultra VIP, Paper Work, Start Finalisation, Won

**Pending:** First Reply

**Unqualified:** MQL, AI Robot Handled, CQL

**Disqualified:** Black Listed

**Other:** Agency Archive, Unassigned

## 3.3 Streak Data Fields
streak_sync tab v Google Sheets vsebuje: Inquiry Received, SOURCE PLACEMENT, AI, Country, Stage, LATEST SOURCE CATEGORY, SOURCE DETAIL, Budget Range, platform, Name, Size of Group, Destination, When, Vessel, Why NOT Segment.

**SOURCE PLACEMENT** = UTM campaign identifier iz Facebook (npr. `dalmatincki_scale_tier1 tier2_cbo`, `landing_attainable_luxury_warm`, `landing_gulet`, `belgin_sultan-5`).

**SOURCE DETAIL** = za Google Ads kamr. `us - sem - tofu - 20.07.2023`, `search - latam`, `perfromance max - top 17 drzav`).

## 3.4 Campaign → Streak UTM Mapping (Facebook)

| Campaign | Streak SOURCE PLACEMENT (starts with) |
|----------|---------------------------------------|
| Dalmatinčki SCALE T1+T2 CBO | `dalmatincki_scale_tier1 tier2_cbo` |
| BOFU Landing Attainable Luxury - Objections Crusher | `landing_attainable_luxury_warm` |
| Landing Gulets Scaling CBO 150 | `landing_gulet` |
| Landing Luxury Yacht Charters Scaling CBO 150 | `landing_luxury_yacht_charters-scaling-cbo` |
| Landing Turkey campaigns | `turkey` ali `belgin` ali `esma` ali `la-bella` |
| Early Booking Croatia 2027 | `earlybook` |
| Last Minute 2026 | `lastminute` ali `last_minute` |
| Attainable Luxury Prospecting | `landing_attainable-luxury_lead` |
| LP Individual Yachts | `lp_individual` |
| LF Individual Yachts | `lf - individual` ali `lf_individual` |

**UTM opomba:** Nekatere kreative znotraj Dalmatinčki SCALE nimajo kreative v UTM-ju (samo `dalmatincki_scale_tier1 tier2_cbo`). Anima Maris ima svojega (`dalmatincki_scale_tier1 tier2_cbo-anima-maris-value-for-money`). Ostale kreative (Alessandro, Nocturno, 6 cabin, Yacht Experience) so pod "other creatives" brez ločitve.

---

# 4. SCALING DECISION FRAMEWORK

## 4.1 CPQL Zone Framework

| Zona | CPQL Range | Akcija |
|------|-----------|--------|
| SCALE | < €96 | Povečaj budget 15-20% tedensko |
| MAINTAIN | €96 - €150 | Ohrani budget, optimiziraj kreative |
| OPTIMIZE | €150 - €240 | Zmanjšaj budget, testiraj nove pristope |
| CUT | > €240 | Pausaj ali drastično spremeni |

## 4.2 Budget Baseline — Marec 2026
- **Total:** €30,000/mesec
- **Facebook:** €18,000 (60%) — target: ~55%
- **Google:** €12,000 (40%) — target: ~45%
- Cilj za channel split: **55% FB / 45% Google** (Google ima višjo QL rate 61.5% vs FB 43.8%)

## 4.3 FB Campaign Prioritization (na podlagi jan/feb 2026 data)

**SCALE:**
- Lead Form - Higher Intent (41.9x ROAS, €294/booking, 19% EX — best volume + quality)
- Dalmatinčki BOFU (18.9x ROAS)
- Early Booking Croatia 2027 (55% QL, 14% EX)
- Last Minute 2026 (82% QL, 45% EX — highest quality campaign, scale opportunity)
- Australia targeting (16.3x ROAS)

**OPTIMIZE:**
- BOFU Attainable Luxury (37% QL v feb — needs audience refinement)
- Turkey campaigns (34% QL — volume driver ampak low quality)
- Landing Attainable Luxury Prospecting (32% QL)

**TEST:**
- LP vs LF Individual Yachts (LP: 67% QL ampak €89 CPL; LF: 12% QL ampak €34 CPL — LP delivers 18x better EX rate)

**CUT/PAUSED:**
- Luxury Yacht Charters (2.8% SQL rate)
- UK targeting (€732/SQL, 5.1% SQL rate — worst market)

## 4.4 Google Campaign Structure
- Search - Croatia EN / Turkey EN (proven converters)
- Search - LATAM (86% QL, 71% EX — massive scale opportunity, €624 spend)
- Search - Brand (defensive)
- PMax - US / UK,CA,AUS
- YouTube/Demand Gen - EU

## 4.5 Country Priorities
1. Australia — €71k revenue, 15.7% SQL rate
2. US — Volume driver
3. Brazil — Best CPL/ROAS ratio in LATAM
4. Canada — High value bookings (€26.7k avg)
5. Italy — 2 bookings, high deal size
6. UK — CUT ali major restructure (5.1% SQL rate, 0 bookings, €4,500 spend)

---

# 5. BTA AGENT DASHBOARD

## 5.1 Tech Stack
- **Frontend:** Next.js App Router dashboard
- **Data source:** Google Sheets via Apps Script doGet() JSON endpoint
- **GA4 data:** Mixed Analytics API Connector (Google Sheets add-on) pulls GA4 → Sheet
- **Deployment:** Vercel (gooletsaiagent.vercel.app ali lokalno localhost:3000)
- **Pages:** Overview, Facebook Ads, Google Ads, GA4 Landing Pages, (planned: Vessel Funnel)

## 5.2 Apps Script doGet() API
- Endpoint: `https://script.google.com/macros/s/AKfycby4WR2b5WyZ7qKcJvNUtYjGQPPVpJzFWAnF5SyJntvtNGwGaob-hCu4hAdECHmnRVfn/exec`
- Params: `?tab=<sheet_name>&sort=<header>&dir=asc|desc&limit=<n>`
- Vrne JSON array of objects (key = header name)
- Podpira Named Ranges in Sheet names

## 5.3 Sheet Tabi
- `daily` — dnevni FB/Google spend in metrics
- `fb_ads_enriched` — FB campaign data
- `streak_sync` — unified Streak CRM data (15 stolpcev, daily sync ob 5:30 via StreakSync.gs Apps Script)
- `ga4_landing_pages` — GA4 landing page data via Mixed Analytics (limit: 20,000 vrstic, 90 dni)
- `bookings` — booking data z vessel, revenue, source
- `dashboard_fb` — FB dashboard presets (B2 = preset, B3 = custom start date)

## 5.4 Known Issues & Fixes
1. **bounceRate** — pokvarjen v ga4_landing_pages (Mixed Analytics bug, vrednosti tipa 7.6e+15). Popravljen s formulo v `bounceRate_clean` stolpcu v sheetu.
2. **averageSessionDuration** — ŠE VEDNO POKVARJEN (Mixed Analytics bug, nekonsistentne magnitude). Ne da se zanesljivo popraviti z formulo.
3. **/thank-you stran** — izkrivlja CVR (574 conv iz 535 sessions = 107%). Treba filtrirati iz landing page metrik.
4. **Engagement stolpec** — še ni popravljen/implementiran.
5. Dashboard spremembe: "Conversion Rate by Device" → "Conversions Trend" → "Conversions Trend".

## 5.5 Vessel Funnel — Planirano
Nov tab `/vessel-funnel` z dropdown za izbiro ladje. Funnel: Spend → Leads → QL → Vessel QL → Vessel Assigned → Booking. Vessel QL matching na podlagi budget_range + size_of_group + destination. streak_sync je unified data source (ne rabimo ločenega streak_vessels taba).

**Vessel profiles** (treba definirati za vsako ladjo): budget min/max, max guests, destination, linked campaigns.

---

# 6. REPORT PORTALI

## 6.1 Goolets Monthly Reports
- **URL:** goolets-reports.vercel.app
- **Geslo:** `multichannel`
- **Stack:** Next.js 14+ App Router, Tailwind (layout/auth), inline styles (reports), Recharts
- **Dostopni reporti:** January 2026, February 2026
- **Navigacija:** Landing page `/` → `/january-2026`, `/february-2026`
- **Design:** Navy #0F1B2D, Gold #B8952E, Background #FAFAF8, Font: Outfit

**January 2026 highlights:** €34,554 spend, €335,085 revenue, 9.7x ROAS

**February 2026 highlights:** €43K spend, quality drop, CPQL up 50% (€76→€113), 4 storna worth €85,950 (39% potential rev), channel split regressed to 67% FB (target: 55%)

## 6.2 Goolets Weekly Pulse Reports
- **URL:** goolets-reports.vercel.app/weekly/w10 (itd.)
- **W10 data:** €7,156 spend, 113 CRM leads, CPQL €130.11 (MAINTAIN zone)

## 6.3 Gasper Portal
- **URL:** gasper-portal.vercel.app (live data dashboard) + gasper-reports.vercel.app (monthly reports)
- **Geslo (reports):** `gasperplahutnik`
- **Design:** Dark #1A1A1A, Gold #B5975A, Fonts: Cormorant Garamond + DM Sans
- **Portal:** Vanilla JS fetch + Google Sheets via Apps Script. Needs completing: add fb_campaigns, creatives, settings tabs to Sheet; deploy Apps Script as Web App; set SHEETS_URL on line ~644 of index.html.

---

# 7. CAMPAIGN PERFORMANCE DATA

## 7.1 Historical Performance (Okt 2025 - Jan 2026)
- Total FB Spend: €68,192
- FB-Attributed Revenue: €457,169
- **ROAS: 6.70x**
- Bookings: 26+
- Avg Booking Value: €13,431

## 7.2 February 2026 (First 27 Days)
- Total Spend: €25,700 (FB €17,558, Google €8,142)
- Leads: 499
- Quality Leads: 235 (47%)
- Excellent Leads: 79 (16%)
- CPL: €51.46
- CPQL: €109.27 (MAINTAIN zone)

**FB Quality by Campaign:**

| Campaign | Leads | QL | QL% | EX | EX% |
|----------|-------|----|-----|----|-----|
| Dalmatinčki SCALE T1+T2 | 110 | 63 | 57% | 20 | 18% |
| Landing Turkey | 91 | 30 | 33% | 6 | 7% |
| Early Booking Croatia 2027 | 56 | 31 | 55% | 14 | 25% |
| BOFU Attainable Luxury | 55 | 21 | 38% | 5 | 9% |
| Landing Gulets | 45 | 22 | 49% | 9 | 20% |
| Last Minute 2026 | 42 | 20 | 48% | 8 | 19% |
| Attainable Luxury Prospecting | 59 | 19 | 32% | 3 | 5% |

**Google:** 58 AM Leads, 32 QL (55%), 14 EX (24%), CPL €140, CPQL €254

## 7.3 November 2025 Benchmark
- Total spend: €33,936
- Contacts: 706, Quality: 288
- Bookings: 10, Revenue: €121,550, ROAS: 3.58x
- FB: €23,264 spend, 4 bookings, 2.51x ROAS
- Google: €10,672 spend, 6 bookings, 5.92x ROAS

---

# 8. TURKEY CAMPAIGN SPECIFICS (Marec 2026)

**Iran War Context:** Začela se 28. feb 2026. Analiza: ~45% padec lead volumna ni bil zaradi zmanjšanega povpraševanja ampak zaradi **budget cuta 25. februarja** (3 dni PRED začetkom vojne). Torej korelacija ≠ kavzalnost.

**Key Vessels (Turkey):** Belgin Sultan, Esma Sultan, La Bella Vita

---

# 9. A/B TESTING — Sail Smarter Landing Page

**Stran:** goolets.net/sail-charter/ (trenutno 0.6% CVR)
**Alternativa:** goolets.net/plan-your-charter/

**Tracking:** GA4 za sessions, HubSpot za leads, Streak za QL (AI ≥50)

**Pomisleki:** Nizek volume (10 leads/teden, 3-4 QL) pomeni da test rabi dolgo okno za statistično signifikantnost. Priporočen leading indicator: scroll depth ali form start rate.

---

# 10. CONTENT & STRATEGY

**Unified Content System** — dokument za celoten tim (Mitja, Aymen, Dijana, Nika, Alex, Dejan):
- Content Bible: pozicioniranje, differentiatori, 3 audience segmenti, messaging toolkit
- Channel playbooks per person
- Seasonal calendar
- KPIs z north star metrikami per channel

**Competitor Intelligence Report** — pokriva Fraser, Burgess, HELM, YachtCharterFleet. Ključna ugotovitev: Goolets ima "groups & celebrations" white space ki ga nihče ne claimuje.

**Google Ads Campaign Structure Recommendation:**
1. Group Charters (Primary) — Family Reunions, Friend Group, Celebrations, Corporate
2. Destination (Secondary) — Croatia, Turkey, Mediterranean
3. Brand (Defensive) — Goolets branded terms

---

# 11. KEY CONTACTS & STAKEHOLDERS

| Oseba | Vloga |
|-------|-------|
| Mitja Mirtič | CEO Goolets |
| Aymen Boulehmi | Marketing Manager |
| Dijana | Team member (content) |
| Nika | Team member (content) |
| Alex | Team member |
| Developer (external) | WordPress + HubSpot form view tracking fix |

---

# 12. OPEN ITEMS / TODO

1. Form view tracking — developer mora debuggati po WordPress migraciji
2. averageSessionDuration — Mixed Analytics bug, ni rešitve razen zamenjave data source-a
3. /thank-you page filter — implementirati v BTA Agent dashboardu
4. Engagement stolpec — popraviti v dashboardu
5. Vessel Funnel page — implementirati v BTA Agent dashboardu (čaka vessel profile definicije)
6. Gasper Portal live data — dokončati Google Sheets + Apps Script setup
7. Channel rebalancing — FB 67% → target 55%, Google needs more budget
8. Turkey quality — 34% QL, treba izboljšati LP/targeting ali znižati budget
9. UK market decision — cut ali restructure (0 bookings, worst ROI)
10. Storno patterns — 4 cancellations v feb worth €85,950, investigirati vzroke

---

# 13. IMPORTANT TECHNICAL DETAILS

**Streak sync:** Apps Script `StreakSync.gs` synca daily ob 5:30 v `streak_sync` tab (15 stolpcev). TAG resolving za Vessel in Destination (kažeta imena namesto ID-jev).

**Mixed Analytics API Connector:** Limit povišan na 20,000 vrstic. Date range: 90daysAgo - today. 4 dimenzije: landingPage x deviceCategory x date x sessionSourceMedium.

**Git:** Branch `feature/ga4-landing-pages` v Goolets BTA Agent repo. `.cursor/rules` file vsebuje projekt kontekst.
