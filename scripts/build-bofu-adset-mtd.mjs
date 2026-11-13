// Builds src/data/bofu-adset-mtd.json — the MTD ad set split of the BOFU campaign, the FALLBACK
// for days that fb_adset_daily_api does not cover yet. Source: the /gm 4c12 Meta MCP dump
// ppcos/goolets/context/fb-dashboard/raw/adsets.json (+ _window.json). Values are MTD totals, so
// any split built from them is an ESTIMATE and is flagged as such in the API.
// USAGE: node scripts/build-bofu-adset-mtd.mjs [/path/to/fb-dashboard/raw]
import fs from 'node:fs'
import path from 'node:path'
const RAW = process.argv[2] || '/Users/dejansmodis/Projects/brain/ppcos/goolets/context/fb-dashboard/raw'
const BOFU_ID = '120230443711160087'
const ent = (f) => { const d = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); const e = d.ad_entities ?? d; return typeof e === 'string' ? JSON.parse(e) : e }
const win = JSON.parse(fs.readFileSync(path.join(RAW, '_window.json'), 'utf8'))
const v = (x) => (x && typeof x === 'object' ? Number(x.value) : Number(x)) || 0
const adsets = ent('adsets.json').filter((a) => a.campaign_id === BOFU_ID).map((a) => ({
  id: a.id, name: a.name, spend: v(a.amount_spent), impressions: v(a.impressions), linkClicks: v(a.link_click),
}))
const out = { campaignId: BOFU_ID, since: win.since, until: win.until, builtAt: new Date().toISOString(), source: 'fb-dashboard/raw/adsets.json', adsets }
fs.writeFileSync(new URL('../src/data/bofu-adset-mtd.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log(`bofu-adset-mtd.json: ${adsets.length} ad sets · ${win.since}…${win.until} · spend €${adsets.reduce((n, a) => n + a.spend, 0).toFixed(2)}`)
