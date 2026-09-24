# GOOLETS — UTM → CAMPAIGN/AD ATTRIBUTION
## Zadnjič posodobljeno: 16. junij 2026

Kako se FB lead (Streak) poveže z FB kampanjo/oglasom. To je temelj per-campaign in per-ad lead funnelov (Published tab, vessel-funnel).

---

## 1. VIR RESNICE (kritično)

- **Pravi živi UTM = Streak `SOURCE PLACEMENT`** polje (tab `streak_sync`; FB leadi = `LATEST SOURCE CATEGORY` == PAID_SOCIAL). Lead-ov `utm_content` ≡ ta vrednost.
- **Meta NE izda `url_tags`** prek CSV niti MCP (`ads_get_creatives` ima `link_url`, NE `url_tags`). Zato je živi UTM znan SAMO iz Streaka ali od Dejana.
- **Pravilo: nikoli ne izmišljuj UTM-jev.** (Lekcija 2026-06-16: 100 generiranih UTM-jev, le 14/144 se ujemalo z živim Streakom → pobrisani.) Če UTM ni iz vira, vprašaj.

---

## 2. SP → KAMPANJA (že rešeno v kodi)

`src/lib/fuzzy-match.ts` — ~40 eksplicitnih prefix pravil `source_placement → FB kampanja`. Order matters, prvo ujemanje zmaga; obstaja eksplicitni "Unknown" bucket za šum + `diagnoseSource()` za audit.

- **Pokritost: ~105/144 različnih živih SP = ~97.4% FB leadov.**
- Dodano 2026-06-16: `dalmatincki_angle*` / `exclusive-seasonal-selection` → Exclusive Seasonal Selection; `last_minute_2026_cro*` → Last Minute Croatia 2026; šum (google/instagram/numerični-ID/landing-cnn) → Unknown.
- Grobi tagi (en UTM čez več kreativ): `earlybook2027_tier1`, `landing_gulet_video3`, `landing_turkey_esma-sultan-kids` → atribucija na tier/kampanjo, NE per-oglas. To je realnost računa, ne bug.

---

## 3. SP → POSAMEZEN OGLAS (UTM Mapping sheet)

Za per-ad granularnost obstaja ročno-vzdrževana tabela.

- **Sheet:** `1BqE5obdlIOf9LnNvkG5vpciV2Bt2UD1EDgwVt7rLntw`, tab "UTM Mapping". Stolpci: Campaign · Ad Set · Ad · **UTM** · _ad_id · _adset_id · _campaign_id · Status.
- **434 oglasov** = vsi, ki so imeli dostavo v zadnjih 90 dneh (active + paused). Vseh **153 aktivnih oglasov je pokritih** (preverjeno prek FB MCP). Edina izjema: Bellezza (kampanja pavzirana, 0 dostave v 90d).
- **UTM stolpec polni Dejan ročno** (pravi UTM = živ Streak SP). Stanje 2026-06-16: 115 vpisanih (71 potrjenih z živimi leadi), ostalo prazno. Lead-form/boost ostanejo prazni (njihov UTM nosi ime kampanje).
- **Podvojeni UTM-ji = realno stanje računa** (isti kreativ čez več tierov dobi isti UTM). Dejan potrdil: "tako je realno v računu."

### Pipeline
- Brain skripta `code/sheets/sync-goolets-utm-mapping.js` → sinhronizira sheet v tab **`utm_mapping`** v data-sheetu (`1W75XRDhZaWwv-j63ongmXQPRB_5XmO1J9fw1lF3IbM0`). **Pognati po vsakem urejanju sheeta.**
- App: `SHEETS_TABS.UTM_MAPPING` (config.ts) + loader `src/lib/utm-mapping.ts` (`fetchUtmMapping()` → `resolve(utm_content)` → kampanja/oglas).
- Razširitev univerzuma oglasov: brain skripta `code/sheets/expand-goolets-utm-90d.js` (merge-preserve UTM-jev po ad_id).

---

## 4. PRAKTIČNO

- **Campaign-level atribucija je pripravljena** (fuzzy-match 97%) → Published "vse kampanje" lahko stoji na tem.
- **Per-ad** je omejen tam, kjer so Goolets tagi grobi; kjer Dejan vpiše UTM, je per-ad mogoč.
- FB ad account: `2422256151414958`. Streak tab: `streak_sync`. Mirror tab: `utm_mapping`.
