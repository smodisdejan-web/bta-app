"use strict";
/* Web Funnel CRO tower — renderers ported from the approved demo
   (ppcos/goolets/created/cro-control-tower-demo/index.html), fed by /api/cro-tower.
   Rule: a null is rendered "n/a" with a tooltip, never 0. */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let D = null;            // current CroTowerResponse
let cur = 'month';       // period chip
let anchor = '';         // YYYY-MM for a picked full month
let reqSeq = 0;

/* ── formatting (null-safe) ───────────────────────────────── */
function flagFor(re){
  const f = D && D.meta && D.meta.flags ? D.meta.flags.find(x => re.test(x)) : null;
  return f || 'No data for this period';
}
const NA = (title) => '<span class="na" title="' + esc(title || 'No data for this period') + '">n/a</span>';
const nf = (n, t) => n == null ? NA(t) : Math.round(n).toLocaleString('en-US');
const pf = (v, d, t) => v == null ? NA(t) : v.toFixed(d === undefined ? (v < 10 ? 2 : 1) : d) + '%';
const ef = (n, t) => n == null ? NA(t) : '€' + Math.round(n).toLocaleString('en-US');
const xf = (n, t) => n == null ? NA(t) : n.toFixed(2) + '×';
const T_PREV = () => flagFor(/previous period|YoY|prev/i);
const T_BK = () => flagFor(/month-granular|paid-only/i);
const T_PAID = () => flagFor(/Paid funnel|paid funnel/i);

/* Arrow always shows the real direction of travel; colour shows whether that is
   good. For cost metrics (inv) a fall is the good outcome, so the two diverge. */
function deltaChip(d, vs, inv, neutral){
  if (d == null) return '<span class="delta flat" title="' + esc(T_PREV()) + '">&ndash; n/a' + (vs ? ' <span class="vs">' + vs + '</span>' : '') + '</span>';
  const good = inv ? -d : d;
  const cls = neutral ? 'flat' : (good > 0.2 ? 'up' : (good < -0.2 ? 'down' : 'flat'));
  const ar = d > 0.2 ? '▲' : (d < -0.2 ? '▼' : '–');
  return '<span class="delta ' + cls + '">' + ar + ' ' + Math.abs(d).toFixed(1) + '%' +
         (vs ? ' <span class="vs">' + vs + '</span>' : '') + '</span>';
}
function deltaCell(d){
  if (d == null) return '<span class="delta flat" title="' + esc(T_PREV()) + '">n/a</span>';
  const cls = d > 0.2 ? 'up' : (d < -0.2 ? 'down' : 'flat');
  const ar = d > 0.2 ? '▲' : (d < -0.2 ? '▼' : '–');
  return '<span class="delta ' + cls + '">' + ar + ' ' + Math.abs(d).toFixed(1) + '%</span>';
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dl = s => MONTHS[Number(s.slice(5,7)) - 1] + ' ' + Number(s.slice(8,10));
/* A 401 from the AI routes means the cro_unlock cookie is stale (password rotated): go to the
   password page instead of rendering an error. Returns true when it redirected. */
function authRedirect(res){
  if (res.status !== 401) return false;
  location.replace('/cro-tower/unlock?next=' + encodeURIComponent(location.pathname));
  return true;
}
/* **bold** → <b>, after escaping */
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/* ── sparkline ─────────────────────────────────────────────── */
let sparkPts = [], sparkLabels = [];
function drawSpark(){
  const pts = D.hero.series.points.filter(p => p.crPct != null);
  const svg = $('spark');
  $('sparkUnit').textContent = D.hero.series.unit + ' · ' + pts.length + ' pts';
  if (pts.length < 2){
    svg.innerHTML = ''; sparkPts = [];
    $('sparkFirst').innerHTML = NA('Not enough GA4 coverage for a trend'); $('sparkLast').innerHTML = NA();
    $('sparkRange').textContent = '';
    return;
  }
  const data = pts.map(p => p.crPct), n = data.length;
  const X0 = 10, X1 = 330, Y0 = 8, Y1 = 58;
  const lo = Math.min.apply(null, data), hi = Math.max.apply(null, data);
  const pad = (hi - lo) * 0.25 || 0.1;
  const min = lo - pad, max = hi + pad;
  const x = i => X0 + (X1 - X0) * (i / (n - 1));
  const y = v => Y1 - (Y1 - Y0) * ((v - min) / (max - min));
  sparkPts = data.map((v, i) => ({x:x(i), y:y(v), v:v}));
  sparkLabels = pts.map(p => p.start === p.end ? dl(p.start) : dl(p.start) + '–' + dl(p.end));
  const line = sparkPts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
  const area = line + ' L' + X1 + ' ' + Y1 + ' L' + X0 + ' ' + Y1 + ' Z';
  const first = sparkPts[0], last = sparkPts[n - 1];
  svg.innerHTML =
    '<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--gold)" stop-opacity="0.30"/>' +
      '<stop offset="100%" stop-color="var(--gold)" stop-opacity="0.02"/>' +
    '</linearGradient></defs>' +
    '<line x1="' + X0 + '" y1="' + first.y.toFixed(1) + '" x2="' + X1 + '" y2="' + first.y.toFixed(1) +
      '" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3" fill="none"/>' +
    '<path d="' + area + '" fill="url(#sg)"/>' +
    '<path d="' + line + '" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<line id="spx" x1="0" y1="' + Y0 + '" x2="0" y2="' + Y1 + '" stroke="var(--gold-rail)" stroke-width="1" fill="none" opacity="0"/>' +
    '<circle id="sph" r="4" fill="var(--gold)" stroke="var(--surface)" stroke-width="2" opacity="0" cx="0" cy="0"/>' +
    '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="4.5" fill="var(--gold)" stroke="var(--surface)" stroke-width="2"/>';
  $('sparkFirst').textContent = data[0].toFixed(2) + '%';
  $('sparkLast').textContent = data[n - 1].toFixed(2) + '%';
  $('sparkRange').textContent = dl(pts[0].start) + ' → ' + dl(pts[n - 1].end);
}
(function sparkHover(){
  const wrap = $('sparkWrap'), svg = $('spark'), tip = $('sparkTip');
  function move(ev){
    if (!sparkPts.length) return;
    const r = svg.getBoundingClientRect();
    const vx = (ev.clientX - r.left) / r.width * 340;
    let best = 0;
    for (let i = 1; i < sparkPts.length; i++){
      if (Math.abs(sparkPts[i].x - vx) < Math.abs(sparkPts[best].x - vx)) best = i;
    }
    const p = sparkPts[best];
    const px = svg.querySelector('#spx'), ph = svg.querySelector('#sph');
    px.setAttribute('x1', p.x); px.setAttribute('x2', p.x); px.setAttribute('opacity', '1');
    ph.setAttribute('cx', p.x); ph.setAttribute('cy', p.y); ph.setAttribute('opacity', '1');
    tip.style.display = 'block';
    tip.textContent = sparkLabels[best] + ' · ' + p.v.toFixed(2) + '%';
    tip.style.left = (r.left - wrap.getBoundingClientRect().left + p.x / 340 * r.width) + 'px';
    tip.style.top = (p.y / 68 * r.height) + 'px';
  }
  function out(){
    tip.style.display = 'none';
    const px = svg.querySelector('#spx'), ph = svg.querySelector('#sph');
    if (px) px.setAttribute('opacity', '0');
    if (ph) ph.setAttribute('opacity', '0');
  }
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', out);
})();

/* ── renderers ─────────────────────────────────────────────── */
function renderHero(){
  const h = D.hero;
  $('heroVal').innerHTML = h.visitorToQlPct.value == null ? NA(flagFor(/ga4_host_lp|streak_all/)) : h.visitorToQlPct.value.toFixed(2) + '%';
  $('heroDelta').innerHTML = deltaChip(h.visitorToQlPct.deltaPct, 'vs previous period');
  $('heroQL').innerHTML = nf(h.ql.value) + ' QL &divide; ' + nf(h.visitors.value) + ' visitors';
  $('heroMets').innerHTML =
    '<span class="hm"><span class="hk">QL &rarr; Booking</span><span class="hv">' + pf(h.qlToBookingPct.value, 2, T_BK()) + '</span></span>' +
    '<span class="hm"><span class="hk">Revenue / visitor</span><span class="hv">' + (h.revenuePerVisitor.value == null ? NA(T_BK()) : '€' + h.revenuePerVisitor.value.toFixed(2)) + '</span></span>' +
    '<span class="hm"><span class="hk">Revenue / QL</span><span class="hv">' + ef(h.revenuePerQl.value, T_BK()) + '</span></span>';
  drawSpark();
}

function renderStrip(){
  const s = D.strip;
  const y = s.ytdPaidRevenue;
  const ytdPct = y.pctOfTarget;
  const tiles = [
    {k:'Spend (paid)', v:ef(s.spend.value, T_PAID()),
     c:'Meta ' + ef(s.spend.meta) + ' &middot; Google ' + ef(s.spend.google) + (s.spend.bing ? ' &middot; Bing ' + ef(s.spend.bing) : '') + (s.spend.chatgpt ? ' &middot; ChatGPT ' + ef(s.spend.chatgpt) : ''),
     d:s.spend.deltaPct, neutral:true},
    {k:'Bookings', v:nf(s.bookings.value, T_BK()), c:(s.bookings.paid == null ? 'paid' : nf(s.bookings.paid) + ' paid') + ' &middot; other channels <span title="' + esc(flagFor(/paid-only/)) + '">n/a</span>', d:s.bookings.deltaPct},
    {k:'Revenue (RVC)', v:ef(s.revenue.value, T_BK()), c:'paid bookings, close month', d:s.revenue.deltaPct},
    {k:'ROAS', v:xf(s.roas.value, T_BK()), c:'paid channels only', d:s.roas.deltaPct, hi:true},
    {k:'CPL', v:s.cpl.value == null ? NA(T_PAID()) : '€' + s.cpl.value.toFixed(2), c:nf(s.cpl.paidLeads) + ' paid leads &middot; incl. lead forms', d:s.cpl.deltaPct, inv:true},
    {k:'CPQL', v:s.cpql.value == null ? NA(T_PAID()) : '€' + s.cpql.value.toFixed(2), c:nf(s.cpql.paidQl) + ' paid qualified leads', d:s.cpql.deltaPct, inv:true},
    {k:'Avg booking', v:ef(s.avgBooking.value, T_BK()), c:'paid bookings', d:s.avgBooking.deltaPct},
    {k:'YTD paid revenue', v:ef(y.value, T_PAID()),
     c: ytdPct == null ? dl(y.range.from) + ' – ' + dl(y.range.to) + ' &middot; <span title="' + esc(flagFor(/target/)) + '">no annual target set</span>'
                       : ytdPct.toFixed(1) + '% of the ' + ef(y.target) + ' annual target',
     meter: ytdPct == null ? undefined : Math.min(100, ytdPct), done: ytdPct != null && ytdPct >= 100, noDelta: ytdPct == null}
  ];
  $('strip').innerHTML = tiles.map(t =>
    '<div class="tile' + (t.hi ? ' hi' : '') + '">' +
      '<div class="tk">' + t.k + '</div>' +
      '<div class="tv">' + t.v + '</div>' +
      '<div class="tc">' + t.c + '</div>' +
      (t.meter !== undefined
        ? '<span class="meter' + (t.done ? ' done' : '') + '"><i style="width:' + t.meter + '%"></i></span>'
        : (t.noDelta ? '' : '<div class="td">' + deltaChip(t.d, 'vs prev', t.inv, t.neutral) + '</div>')) +
    '</div>'
  ).join('');
}

const SRC = {visitors:'GA4 &middot; SESSIONS &middot; 4 MAIN DOMAINS', engaged:'GA4 &middot; ENGAGED SESSIONS',
             inquiries:'HUBSPOT &middot; WEBSITE FORMS', ql:'STREAK &middot; AI&ge;50 &middot; EXCL. ASSET', bookings:'PAID BOOKINGS &middot; CLOSE MONTH'};
function renderFunnel(){
  const steps = D.funnel.steps;
  const widths = [100, 80, 60, 44, 34];
  let h = '';
  steps.forEach((s, i) => {
    const isBk = s.key === 'bookings';
    const t = isBk ? T_BK() : flagFor(new RegExp(s.key === 'inquiries' ? 'hubspot' : s.key === 'ql' ? 'streak' : 'ga4_host_lp', 'i'));
    h += '<div class="fstep' + (s.key === 'ql' ? ' last' : (isBk ? ' book' : '')) + '" style="width:max(' + widths[i] + '%,240px)"' + (s.note ? ' title="' + esc(s.note) + '"' : '') + '>' +
           '<span class="src">' + (SRC[s.key] || esc(s.source)) + '</span>' +
           '<span class="fname">' + esc(s.label) + '</span>' +
           '<span class="fnum">' + nf(s.metric.value, t) + '</span>' +
           (isBk && s.revenue && s.revenue.value != null ? '<span class="frev">' + ef(s.revenue.value) + ' RVC</span>' : '') +
           '<span class="fmeta">' + deltaChip(s.metric.deltaPct, 'vs prev period') +
             (s.key === 'ql' ? '<span class="flag asset">ASSET leads excluded</span>' : '') +
             (isBk ? '<span class="flag">paid only</span>' : '') +
           '</span>' +
         '</div>';
    if (i < steps.length - 1){
      const c = s.cvrToNextPct;
      const v = c ? c.value : null, p = c ? c.prev : null;
      const cl = v == null || p == null ? 'a' : (v >= p ? 'g' : (v >= p * 0.9 ? 'a' : 'r'));
      h += '<div class="gut">' +
             '<span class="cr ' + cl + '">&darr; ' + (v == null ? NA(t) : v.toFixed(2) + '%') + (i === 3 ? ' QL&rarr;booking' : '') + '</span>' +
             '<span class="bm">prev ' + (p == null ? NA(T_PREV()) : p.toFixed(2) + '%') + '</span>' +
             (cl === 'r' ? '<span class="leak">down vs prev</span>' : '') +
           '</div>';
    }
  });
  const u = D.funnel.unattributedBookings;
  if (u.count != null && u.count > 0){
    h += '<p class="fsub">&#43;<b>' + nf(u.count) + '</b> paid bookings / <b>' + ef(u.revenue) + '</b> could not be placed on a domain &mdash; they are inside the total above.</p>';
  }
  h += '<p class="fnote">Booking month = the month the deal closed, not the month the inquiry came in.</p>';
  $('funnel').innerHTML = h;
  $('fflags').innerHTML = (D.meta.flags || []).map(f => '<li>' + esc(f) + '</li>').join('');
}

let shipsOpen = false;
function renderDomains(){
  const rows = D.domains.rows;
  const maxV = Math.max.apply(null, rows.map(r => r.visitors.value || 0).concat([1]));
  const tb = $('tblDomain').querySelector('tbody');
  let h = '';
  rows.forEach(r => {
    const web = r.kind === 'main' || r.kind === 'ships';
    const why = web ? undefined : (r.flags[0] || 'Not a website row');
    const flags = web ? r.flags.map(f => '<span class="flag" title="' + esc(f) + '">&#9888; ' + esc(f.replace(/ vs previous period/, '')) + '</span>').join('') : '';
    h += '<tr' + (web ? '' : ' class="offrow"') + '>' +
      '<td><span class="dname">' + (r.kind === 'ships'
          ? '<button class="expander" type="button" id="shipBtn" aria-expanded="' + shipsOpen + '" aria-controls="shipRows"><span class="cv">&#9656;</span>' + esc(r.label) + '</button>'
          : '<span' + (web ? '' : ' title="' + esc(why) + '"') + '>' + esc(r.label) + '</span>') +
        flags + '</span>' +
        (web ? '<span class="bartrack" style="width:100%"><span class="bar" style="width:' + Math.max(1.5, (r.visitors.value || 0) / maxV * 100) + '%"></span></span>' : '') + '</td>' +
      '<td>' + nf(r.visitors.value, why) + '</td><td>' + nf(r.engaged.value, why) + '</td><td>' + nf(r.inquiries.value, why) + '</td><td>' + nf(r.ql.value) + '</td>' +
      '<td class="cr">' + pf(r.crPct.value, 2, why) + '</td>' +
      '<td>' + nf(r.bookings, why || T_BK()) + '</td>' +
      '<td class="' + (r.revenue ? 'money' : 'na') + '">' + (r.revenue == null ? NA(why || T_BK()) : (r.revenue ? ef(r.revenue) : '&mdash;')) + '</td>' +
      '<td>' + (web ? deltaCell(r.crPct.deltaPct) : '') + '</td></tr>';
    if (r.kind === 'ships'){
      D.domains.ships.forEach(s => {
        h += '<tr class="shiprow" data-ship="1"' + (shipsOpen ? '' : ' hidden') + '>' +
             '<td>' + esc(s.host) + '</td><td>' + nf(s.visitors) + '</td>' +
             '<td colspan="7" style="text-align:right;color:var(--muted)">rolled up in the row above</td></tr>';
      });
    }
  });
  const t = D.domains.mainTotal;
  h += '<tr class="tot"><td>4 main domains</td><td>' + nf(t.visitors.value) + '</td><td>' + nf(t.engaged.value) + '</td><td>' + nf(t.inquiries.value) +
       '</td><td>' + nf(t.ql.value) + '</td><td>' + pf(t.crPct.value, 2) + '</td>' +
       '<td>' + nf(t.bookings, T_BK()) + '</td><td class="money">' + ef(t.revenue, T_BK()) + '</td><td>' + deltaCell(t.crPct.deltaPct) + '</td></tr>';
  tb.innerHTML = h;
  const btn = $('shipBtn');
  if (btn) btn.addEventListener('click', () => {
    shipsOpen = !shipsOpen;
    btn.setAttribute('aria-expanded', String(shipsOpen));
    tb.querySelectorAll('tr[data-ship]').forEach(tr => { tr.hidden = !shipsOpen; });
  });
  const m = D.meta.matchRates.qlEmailToHubspot;
  $('domainNote').innerHTML = 'Ship micro-sites sit outside the ' + nf(D.hero.visitors.value) + ' headline visitors &mdash; counted, not blended into the main-domain CR. ' +
    'QL are placed on a domain by their email &rarr; HubSpot first page (' + (m.ratePct == null ? 'n/a' : m.ratePct + '%') + ' matched); the rest stay in the total as &ldquo;No website entry&rdquo; / &ldquo;Unmatched&rdquo;.';
}

let sortKey = 'v', sortDir = -1;
function channelRows(){
  return D.channels.rows.map(r => ({
    n:r.label, key:r.key, v:r.visitors.value, i:r.inquiries.value, q:r.ql.value, cr:r.crPct.value, dcr:r.crPct.deltaPct,
    sp:r.spend, bk:r.bookings, rvc:r.revenue, epl:r.revenuePerInquiry, roas:r.roas
  }));
}
function renderChannels(){
  const rows = channelRows();
  const sv = r => (r[sortKey] == null ? -1 : r[sortKey]);
  rows.sort((a, b) => (sv(a) - sv(b)) * sortDir);
  const maxV = Math.max.apply(null, rows.map(r => r.v || 0).concat([1]));
  const paid = k => k === 'Paid social' || k === 'Paid search';
  let h = '';
  rows.forEach(r => {
    const nb = paid(r.key) ? T_BK() : flagFor(/paid-only/);
    h += '<tr' + (r.key === 'unmapped' ? ' class="offrow" title="Traffic no channel rule could place; see the mapping in lib/cro-channel-map.ts"' : '') + '><td><span class="dname">' + esc(r.n) + '</span>' +
      '<span class="bartrack" style="width:100%"><span class="bar" style="width:' + Math.max(1.5, (r.v || 0) / maxV * 100) + '%"></span></span></td>' +
      '<td>' + nf(r.v) + '</td><td>' + nf(r.i) + '</td><td>' + nf(r.q) + '</td>' +
      '<td class="cr">' + pf(r.cr, 2) + '</td>' +
      '<td class="' + (r.sp ? 'money' : 'na') + '"' + (r.sp == null ? ' title="no ad spend"' : '') + '>' + (r.sp == null ? '&mdash;' : ef(r.sp)) + '</td>' +
      '<td>' + nf(r.bk, nb) + '</td>' +
      '<td class="' + (r.rvc ? 'money' : 'na') + '">' + ef(r.rvc, nb) + '</td>' +
      '<td>' + (r.epl == null ? NA(nb) : '€' + r.epl.toFixed(0)) + '</td>' +
      '<td class="' + (r.roas == null ? 'na' : 'roas') + '"' + (r.roas == null ? ' title="no ad spend"' : '') + '>' + (r.roas == null ? '&mdash;' : xf(r.roas)) + '</td>' +
      '<td>' + deltaCell(r.dcr) + '</td></tr>';
  });
  const t = D.channels.total;
  h += '<tr class="tot"><td>All channels</td><td>' + nf(t.visitors) + '</td><td>' + nf(t.inquiries) + '</td><td>' + nf(t.ql) +
       '</td><td>' + pf(t.ql != null && t.visitors ? t.ql / t.visitors * 100 : null, 2) + '</td>' +
       '<td class="money">' + ef(t.spend, T_PAID()) + '</td><td>' + nf(t.bookings, T_BK()) + '</td><td class="money">' + ef(t.revenue, T_BK()) + '</td>' +
       '<td>' + (t.revenue != null && t.inquiries ? '€' + (t.revenue / t.inquiries).toFixed(0) : NA(T_BK())) + '</td>' +
       '<td class="roas" title="paid channels only — non-paid bookings are not charged against ad spend">' + xf(D.strip.roas.value, T_BK()) + '</td>' +
       '<td>' + deltaCell(D.hero.visitorToQlPct.deltaPct) + '</td></tr>';
  $('tblChannel').querySelector('tbody').innerHTML = h;
  $('tblChannel').querySelectorAll('th.sortable').forEach(th => {
    th.setAttribute('aria-sort', th.dataset.k === sortKey ? (sortDir === -1 ? 'descending' : 'ascending') : 'none');
    th.querySelector('.ar').innerHTML = sortDir === -1 ? '&darr;' : '&uarr;';
  });
  const u = D.meta.unmapped;
  $('channelNote').innerHTML = 'Visitors: 4 main domains. Inquiries: whitelisted domains. QL: all Streak boxes. Unmapped share: GA4 ' +
    (u.ga4.share == null ? 'n/a' : u.ga4.share + '%') + ', HubSpot ' + (u.hubspot.share == null ? 'n/a' : u.hubspot.share + '%') + ', Streak ' + (u.streak.share == null ? 'n/a' : u.streak.share + '%') +
    '. Non-paid bookings are n/a: only paid bookings are loaded. Channel mapping to be confirmed with Tadej / Aymen.';
}
$('tblChannel').querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = -1; }
    if (D) renderChannels();
  });
});

function renderPages(){
  const rows = D.pages.rows;
  let h = '';
  if (!rows.length) h = '<tr><td colspan="7">' + NA(flagFor(/ga4_host_lp/)) + '</td></tr>';
  rows.forEach(r => {
    h += '<tr><td><span class="dname">' + esc(r.host + r.path) +
      (r.asset ? '<span class="flag asset">ASSET &middot; QL n/a</span>' : '') + '</span></td>' +
      '<td>' + nf(r.visitors) + '</td><td>' + nf(r.inquiries) + '</td>' +
      '<td>' + (r.ql == null ? '<span style="color:var(--muted)" title="' + (r.asset ? 'ASSET page: QL n/a by rule' : '') + '">n/a</span>' : nf(r.ql)) + '</td>' +
      '<td class="cr">' + (r.crPct == null ? '<span style="color:var(--muted)">&mdash;</span>' : r.crPct.toFixed(2) + '%') + '</td>' +
      '<td>' + (r.bookings == null ? NA(r.asset ? 'ASSET page' : T_BK()) : (r.bookings ? nf(r.bookings) : '<span style="color:var(--muted)">0</span>')) + '</td>' +
      '<td class="' + (r.revenue ? 'money' : 'na') + '">' + (r.revenue == null ? NA(r.asset ? 'ASSET page' : T_BK()) : (r.revenue ? ef(r.revenue) : '&mdash;')) + '</td></tr>';
  });
  $('tblPage').querySelector('tbody').innerHTML = h;
  $('pageNote').innerHTML = D.pages.bookingsTotal == null
    ? 'Top 8 landing pages &middot; bookings ' + NA(T_BK()) + ' for this period.'
    : 'Top 8 landing pages &middot; <b>' + nf(D.pages.bookingsOnTopPages) + ' of ' + nf(D.pages.bookingsTotal) +
      '</b> paid bookings land on them (booker email &rarr; HubSpot first page). The remainder is spread across the long tail of entry pages.';
}

function renderFooter(){
  const L = {fb_lead_ads:'Facebook lead forms', matchmaker_start:'quiz starts', offline_or_empty:'offline / empty form', account_forms:'login / register', job_applications:'job applications'};
  const ex = D.meta.inquiryExclusions.map(x => (L[x.key] || esc(x.label)) + ' ' + nf(x.count) + (x.proposed ? '*' : '')).join(' &middot; ');
  const o = D.meta.inquiriesOutsideWhitelist;
  $('exclLine').innerHTML = '<span class="k">Excluded from inquiries:</span> ' + ex +
    ' &middot; forms on non-whitelisted hosts ' + nf(o.count) + '. <span title="Proposed rules, to confirm with Tadej / Aymen">* proposed, to confirm</span>';
  const f = D.meta.freshness.map(t => '<code>' + esc(t.tab) + '</code> ' + (t.error ? '<span style="color:var(--bad)" title="' + esc(t.error) + '">unavailable</span>' : 'to ' + esc(t.maxDate || 'n/a'))).join(' &middot; ');
  $('freshLine').innerHTML = '<span class="k">Data:</span> ' + f + ' &middot; built ' + new Date(D.meta.generatedAt).toLocaleString('en-GB', {dateStyle:'medium', timeStyle:'short'});
}

/* ── review ────────────────────────────────────────────────── */
let reviewSeq = 0;
function reviewSkeleton(){
  $('review').innerHTML = [0,1,2,3].map(() => '<div class="rv"><span class="skel" style="width:74px;height:18px"></span><div><span class="skel" style="width:100%;height:12px"></span><span class="skel" style="width:78%;height:12px;margin-top:6px"></span></div></div>').join('');
}
async function loadReview(){
  const my = ++reviewSeq;
  reviewSkeleton();
  $('reviewFoot').textContent = 'Generating the review for ' + (D ? D.meta.range.label : 'this period') + '…';
  try {
    const q = 'period=' + encodeURIComponent(cur) + (anchor ? '&anchor=' + encodeURIComponent(anchor) : '');
    const res = await fetch('/api/cro-tower/review?' + q, {credentials:'same-origin', cache:'no-store'});
    if (authRedirect(res)) return;
    const j = await res.json();
    if (my !== reviewSeq) return;
    if (!res.ok) throw new Error(j.error || res.statusText);
    const RVK = {best:'Best performer', weak:'Weakest', leak:'Where the leak is', econ:'Economics', do:'Next steps'};
    $('review').innerHTML = j.items.map(it =>
      '<div class="rv"><span class="rvk ' + esc(it.type) + '" title="' + esc(it.label) + '">' + esc(RVK[it.type] || it.label) + '</span><div class="rvt">' + md(it.text) +
      (it.list && it.list.length ? '<ol>' + it.list.map(x => '<li>' + md(x) + '</li>').join('') + '</ol>' : '') + '</div></div>'
    ).join('');
    $('reviewFoot').textContent = 'Reviews only steps with data · null steps are skipped · ' + (j.cached ? 'cached ' : '') + new Date(j.generatedAt).toLocaleString('en-GB', {dateStyle:'medium', timeStyle:'short'});
  } catch (e) {
    if (my !== reviewSeq) return;
    $('review').innerHTML = '<div class="rvt">Review unavailable: ' + esc(e.message) + '</div>';
    $('reviewFoot').textContent = 'Reviews only steps with data · null steps are skipped';
  }
}

/* ── chat ──────────────────────────────────────────────────── */
const CHAT = [];
const SUGGESTIONS = [
  'Which domain converts best?',
  'Where is the biggest leak this month?',
  'Which channel brings the best QL rate?',
  'How does croatialuxurygulet compare to goolets.net?'
];
function answerHtml(t){
  const lines = String(t).split(/\n+/).map(s => s.trim()).filter(Boolean);
  const bullets = lines.filter(l => /^[-*•]\s+/.test(l));
  if (bullets.length && bullets.length === lines.length){
    return '<ul class="ans">' + lines.map(l => '<li>' + md(l.replace(/^[-*•]\s+/, '')) + '</li>').join('') + '</ul>';
  }
  return lines.map(l => '<p>' + md(l.replace(/^[-*•]\s+/, '• ')) + '</p>').join('');
}
function renderChat(){
  $('chat').innerHTML = CHAT.length ? CHAT.map(m =>
    m.r === 'q' ? '<div class="msg q">' + esc(m.t) + '</div>'
                : '<div class="msg a' + (m.pending ? ' pending' : '') + '"><span class="who">Funnel assistant' + (m.label ? ' &middot; ' + esc(m.label) : '') + '</span>' + m.h + '</div>'
  ).join('') : '<div class="msg a"><span class="who">Funnel assistant</span>Ask anything about the funnel for the selected period. Answers use only the numbers on this page.</div>';
  $('chat').scrollTop = $('chat').scrollHeight;
}
$('sugg').innerHTML = SUGGESTIONS.map(s => '<button type="button">' + esc(s) + '</button>').join('');
$('sugg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) ask(b.textContent);
});
let asking = false;
async function ask(q){
  q = q.trim();
  if (!q || asking) return;
  asking = true; $('askBtn').disabled = true;
  const label = D ? D.meta.range.label : '';
  CHAT.push({r:'q', t:q});
  const a = {r:'a', h:'<span class="skel" style="width:90%;height:12px"></span><span class="skel" style="width:70%;height:12px;margin-top:6px"></span>', pending:true, label:label};
  CHAT.push(a);
  renderChat();
  try {
    const res = await fetch('/api/cro-tower/ask', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({question:q, period:cur, anchor:anchor || undefined})});
    if (authRedirect(res)) return;
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || res.statusText);
    a.h = answerHtml(j.answer || 'No answer.');
  } catch (e) {
    a.h = 'Could not answer: ' + esc(e.message);
  }
  a.pending = false; asking = false; $('askBtn').disabled = false;
  renderChat();
}
$('askForm').addEventListener('submit', e => {
  e.preventDefault();
  ask($('askInput').value);
  $('askInput').value = '';
});
function prewarm(){
  fetch('/api/cro-tower/ask', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({warm:true, period:cur, anchor:anchor || undefined})}).then(authRedirect).catch(() => {});
}

/* ── load + period switching ───────────────────────────────── */
function render(){
  $('rangeNow').textContent = D.meta.range.label;
  $('rangePrev').innerHTML = D.meta.prevRange ? esc(D.meta.prevRange.label) : NA(T_PREV());
  renderHero();
  renderStrip();
  renderFunnel();
  renderDomains();
  renderChannels();
  renderPages();
  renderFooter();
  const ga4 = D.meta.freshness.find(t => t.tab === 'ga4_host_lp');
  $('asOf').textContent = 'Data as of ' + (ga4 && ga4.maxDate ? dl(ga4.maxDate) + ', ' + ga4.maxDate.slice(0, 4) : D.meta.yesterday);
  $('liveDot').style.background = D.meta.freshness.some(t => t.error) ? 'var(--bad)' : 'var(--good)';
}
/* Prefetched period payloads (q string → CroTowerResponse), filled in the background after
   the first paint so chip switches render instantly. */
const PRE = new Map();
let prefetched = false;
async function prefetchAll(){
  if (prefetched) return;
  prefetched = true;
  for (const p of ['week', 'month', 'm3', 'm6', 'ytd']){
    const q = 'period=' + p;
    if (PRE.has(q)) continue;
    try {
      const res = await fetch('/api/cro-tower?' + q, {credentials:'same-origin'});
      if (res.ok) PRE.set(q, await res.json());
    } catch (e) {}
  }
}
async function load(nocache){
  const my = ++reqSeq;
  const qKey = 'period=' + encodeURIComponent(cur) + (anchor ? '&anchor=' + encodeURIComponent(anchor) : '');
  if (!nocache && PRE.has(qKey)){
    D = PRE.get(qKey);
    render();
    loadReview();
    return;
  }
  $('content').setAttribute('aria-busy', 'true');
  $('content').classList.add('loading');
  $('loadErr').hidden = true;
  if (nocache) $('asOf').textContent = 'Refreshing… (about 40 s)';
  try {
    const q = 'period=' + encodeURIComponent(cur) + (anchor ? '&anchor=' + encodeURIComponent(anchor) : '') + (nocache ? '&nocache=1' : '');
    const res = await fetch('/api/cro-tower?' + q, {credentials:'same-origin', cache: nocache ? 'no-store' : 'default'});
    const j = await res.json();
    if (my !== reqSeq) return;
    if (!res.ok) throw new Error(j.error || res.statusText);
    D = j;
    PRE.set(qKey, j);
    render();
    loadReview();
    setTimeout(prefetchAll, 1500);
  } catch (e) {
    if (my !== reqSeq) return;
    $('loadErr').hidden = false;
    $('loadErr').textContent = 'Could not load the funnel: ' + e.message;
    $('asOf').textContent = 'Load failed';
  } finally {
    if (my === reqSeq){ $('content').setAttribute('aria-busy', 'false'); $('content').classList.remove('loading'); }
  }
}
function setChip(p){
  document.querySelectorAll('.chip[data-p]').forEach(o => o.setAttribute('aria-pressed', String(o.dataset.p === p)));
}
document.querySelectorAll('.chip[data-p]').forEach(c => {
  c.addEventListener('click', () => {
    cur = c.dataset.p; anchor = '';
    $('monthSel').value = '';
    setChip(cur);
    load(false); prewarm();
  });
});
(function monthPicker(){
  const sel = $('monthSel');
  const now = new Date(Date.now() - 86400000);
  let h = '<option value="">Month&hellip;</option>';
  for (let m = now.getMonth(); m >= 0; m--){
    const v = now.getFullYear() + '-' + String(m + 1).padStart(2, '0');
    h += '<option value="' + v + '">' + MONTHS[m] + ' ' + now.getFullYear() + '</option>';
  }
  sel.innerHTML = h;
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    cur = 'month'; anchor = sel.value;
    setChip('');
    load(false); prewarm();
  });
})();
$('refreshBtn').addEventListener('click', () => load(true));

/* ── theme toggle ──────────────────────────────────────────── */
function themeLabel(){
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  $('themeBtn').textContent = dark ? 'Light' : 'Dark';
  return dark;
}
try { const t = localStorage.getItem('cro-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}
themeLabel();
$('themeBtn').addEventListener('click', () => {
  const dark = themeLabel();
  const next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('cro-theme', next); } catch (e) {}
  themeLabel();
  if (D) drawSpark();
});

renderChat();
load(false);
prewarm();
