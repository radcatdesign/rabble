/* Rabble & Rouse analytics dashboard. Staff only; data from /api/analytics/*. Docs: docs/analytics.md */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app'), bubble = $('#bubble');
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} }
  };
  const state = { range: LS.get('rr-a-range') || '7d', from: LS.get('rr-a-from') || '', to: LS.get('rr-a-to') || '', sample: LS.get('rr-a-sample') === '1', me: null, timers: [] };
  const RANGES = [['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['12m', 'Last 12 months'], ['custom', 'Custom dates']];
  const NAV = [['overview', 'Overview'], ['live', 'Live'], ['pages', 'Pages'], ['heatmaps', 'Heatmaps'], ['audience', 'Audience'], ['visitors', 'Visitors'], ['actions', 'Actions'], ['subscribers', 'Subscribers'], ['settings', 'Settings']];

  /* ---------- formatting ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = n => n == null || isNaN(n) ? '–' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k' : Math.round(n).toLocaleString('en-US');
  const pct = (x, d = 0) => x == null || isNaN(x) ? '–' : (x * 100).toFixed(d) + '%';
  const dur = ms => { if (ms == null || isNaN(ms)) return '–'; const s = Math.round(ms / 1000); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's'; return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
  const ago = t => { const s = Math.max(0, (Date.now() - new Date(t)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'; };
  const clock = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(t).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  const when = t => day(t) + ', ' + clock(t);
  let regions = null; try { regions = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) {}
  let langs = null; try { langs = new Intl.DisplayNames(['en'], { type: 'language' }); } catch (_) {}
  const flag = c => /^[A-Z]{2}$/.test(c || '') ? String.fromCodePoint(...[...c].map(ch => 127397 + ch.charCodeAt(0))) : '';
  const country = c => !c || c === '??' ? 'Unknown' : (regions && regions.of(c)) || c;
  const place = r => [r.city, r.region, country(r.country)].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
  const delta = (cur, prev, lowerIsBetter) => {
    if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return '';
    if (prev === 0) return cur === 0 ? '<span class="delta flat">no change</span>' : '<span class="delta up' + (lowerIsBetter ? ' bad' : '') + '">new</span>';
    const d = (cur - prev) / prev, cls = Math.abs(d) < .005 ? 'flat' : d > 0 ? 'up' : 'down';
    return `<span class="delta ${cls}${lowerIsBetter ? ' bad' : ''}">${cls === 'flat' ? '±0%' : (d > 0 ? '↑ ' : '↓ ') + Math.abs(d * 100).toFixed(Math.abs(d) < .1 ? 1 : 0) + '%'}</span>`;
  };
  const pageName = p => p === '/' ? 'Home' : p;

  /* ---------- "?" explanations ---------- */
  const TIPS = {
    visitors: 'People who opened at least one page. Each person counts once per day, using a daily code made from their connection that resets every midnight and is never stored in their browser. Someone who comes back on three different days counts three times.',
    views: 'Every page opened. Reloading a page counts again.',
    visits: 'A visit runs from the first page until the tab closes or 30 minutes pass with no activity. Visits that never showed a sign of a person (no scroll, click or time on page, and over 30 minutes old) are left out as likely bots.',
    bounce: 'A bounce is a visit that saw one page, did no action and left within 10 seconds of active time. Bounce rate is bounces divided by visits.',
    avgVisit: 'Active time per visit, added up across its pages. Time only counts while the page is on screen and the person has scrolled, clicked, tapped, typed or moved the mouse in the last 2 minutes. Opening a page counts as activity.',
    ppv: 'Page views divided by visits.',
    returning: 'A returning visit comes from a browser that has visited before. Browsers that send Global Privacy Control or Do Not Track, and visitors in the EU, EEA, UK or Switzerland, get no browser ID, so they always count as new.',
    actions: 'Everything recorded as an action: outbound links, email and phone clicks, downloads, form sends, and custom actions like "Added to bag" or "Played video".',
    chart: 'Visitors and page views per day, or per hour for ranges of two days or less. Times are in the site time zone.',
    sources: 'Where each visit started: the utm_source of a campaign link, a ?ref= tag, the site that linked here, or Direct when there was no referrer.',
    campaigns: 'Visits that arrived through links tagged with utm_campaign.',
    devices: 'Based on the width of the browser window: phone under 768 px, tablet under 1100 px, desktop above.',
    countries: 'Approximate location from the visitor’s connection, looked up by our host at the edge. The IP address itself is never stored.',
    live: 'People with the site open right now: a page visible on screen and some activity in the last 10 minutes. Browsers check in every 45 seconds, so this runs up to about a minute behind. Each browser counts once, even with several tabs; visitors without a browser ID count once per tab.',
    left: 'Visits that ended in the last 30 minutes, newest first.',
    activeTime: 'Average active time on the page per view. See Average visit for how active time is measured.',
    scroll: 'How far down the page people got, on average. 100% means they reached the bottom.',
    entries: 'Visits that started on this page.',
    exits: 'Visits that ended on this page.',
    hours: 'When people open pages, by weekday and hour in the site time zone. Darker squares mean more page views.',
    repeat: 'Browsers with more than one visit, where at least one visit falls in the range. Only browsers with a browser ID can show up here.',
    actionU: 'Unique visitors who did this action, counted once per day.',
    heat: 'Clicks and cursor movement are grouped into a grid of 40 columns and 20 px rows per page, device and day. Cursor movement is sampled at most every 100 ms and only on desktop. Nothing typed is ever recorded.',
    scrollmap: 'The share of page views that reached each depth of the page. Depth counts the bottom of the screen, so the first screenful is always 100%.',
    bench: 'Your numbers against published figures for similar sites. A number is only rated when the range has at least 30 visits.',
    subsTotal: 'Everyone who has signed up for the newsletter on this site, all time. One row per email; signing up again counts once.',
    subsNew: 'New emails that signed up in this range, compared with the same stretch just before.',
    subsNotSent: 'Signups we saved but Mailchimp didn’t accept when they came in (usually Mailchimp having a bad moment). Retry sends them again.',
    subsRate: 'New subscribers divided by visits in the range. A visit is one tab from first page until 30 minutes of quiet.',
    subsPending: 'Waiting for the person to click the confirm link in their email. Only happens with double opt-in turned on in Mailchimp.',
    filtered: 'Requests the filters dropped in the last 30 days. Known bots by browser signature, requests that showed no sign of JavaScript, likely bots (visits with no activity at all), and traffic from excluded IPs.'
  };
  const tip = k => TIPS[k] ? `<button class="tip" type="button" data-tip="${k}" aria-label="How this is measured">?</button>` : '';
  let tipOpen = null;
  const showTip = btn => {
    bubble.textContent = TIPS[btn.dataset.tip] || '';
    const r = btn.getBoundingClientRect(); bubble.classList.add('on');
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let x = Math.min(innerWidth - bw - 12, Math.max(12, r.left + r.width / 2 - bw / 2)), y = r.bottom + 10;
    if (y + bh > innerHeight - 12) y = r.top - bh - 10;
    bubble.style.left = x + 'px'; bubble.style.top = y + 'px';
    if (tipOpen && tipOpen !== btn) tipOpen.setAttribute('aria-expanded', 'false');
    tipOpen = btn; btn.setAttribute('aria-expanded', 'true');
  };
  const hideTip = () => { bubble.classList.remove('on'); if (tipOpen) tipOpen.setAttribute('aria-expanded', 'false'); tipOpen = null; };
  document.addEventListener('pointerover', e => { const b = e.target.closest('.tip'); if (b && e.pointerType === 'mouse') showTip(b); });
  document.addEventListener('pointerout', e => { if (e.pointerType === 'mouse' && e.target.closest('.tip')) hideTip(); });
  document.addEventListener('click', e => { const b = e.target.closest('.tip'); if (b) { e.preventDefault(); tipOpen === b ? hideTip() : showTip(b); } else if (tipOpen) hideTip(); });
  document.addEventListener('focusin', e => { const b = e.target.closest('.tip'); if (b) showTip(b); });
  addEventListener('scroll', () => { if (tipOpen) hideTip(); }, { passive: true });

  /* ---------- data ---------- */
  const rangeParams = () => state.range === 'custom' ? { range: 'custom', from: state.from, to: state.to } : { range: state.range };
  async function api(op, params = {}, body) {
    if (state.sample) return Sample[op] ? Sample[op](params, body) : {};
    const qs = new URLSearchParams({ ...rangeParams(), ...params });
    const res = await fetch(`/api/analytics/${op}?${qs}`, body ? { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-rr-staff': '1' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { gate(); throw Object.assign(new Error('Sign in first.'), { quiet: true }); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { nodb: data.nodb });
    return data;
  }

  /* ---------- sign in ---------- */
  function gate(msg) {
    stopTimers();
    const cfg = state.me && !state.me.configured;
    app.innerHTML = `<main class="gate"><form class="card" id="gateForm" novalidate>
      <a class="ad-logo" href="/" aria-label="Rabble &amp; Rouse home"></a>
      <p class="label"><svg aria-hidden="true"><use href="#spark"/></svg>Staff only</p>
      <h1>Site <span class="grad-text">analytics</span></h1>
      ${cfg ? `<p class="form-note">Sign-in isn't set up yet. Add <b>ANALYTICS_PASSWORD</b> in your hosting settings and redeploy. You can look around with sample data in the meantime.</p>` : `<label class="sr-only" for="pw">Team passcode</label>
      <div class="field"><input id="pw" name="pw" type="password" autocomplete="current-password" placeholder="Team passcode" required><button class="btn btn-primary" type="submit">Sign in</button></div>`}
      <p class="form-note${msg ? ' err' : ''}" id="gateNote" role="status" aria-live="polite">${esc(msg || '')}</p>
      <button class="btn btn-ghost btn-sm" type="button" id="trySample">Look around with sample data</button>
    </form></main>`;
    const f = $('#gateForm'), note = $('#gateNote');
    $('#trySample').addEventListener('click', () => { state.sample = true; LS.set('rr-a-sample', '1'); shell(); });
    f.addEventListener('submit', async e => {
      e.preventDefault(); const pw = $('#pw'); if (!pw || !pw.value) return;
      note.className = 'form-note'; note.textContent = 'Checking…';
      const res = await fetch('/api/analytics/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { note.className = 'form-note err'; note.textContent = d.error || 'That didn’t work.'; return; }
      LS.set('rr-staff', '1');            // this browser stops counting as a visitor
      state.sample = false; LS.set('rr-a-sample', null);
      boot();
    });
  }

  /* ---------- shell: header, range picker, nav ---------- */
  function shell() {
    const opts = RANGES.map(([v, l]) => `<option value="${v}"${state.range === v ? ' selected' : ''}>${l}</option>`).join('');
    const today = new Date().toISOString().slice(0, 10), min = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    app.innerHTML = `<div class="ad">
      <header class="ad-top"><div class="wrap">
        <a class="ad-logo" href="/" aria-label="Rabble &amp; Rouse home"></a>
        <div class="ad-name"><span class="label"><svg aria-hidden="true"><use href="#spark"/></svg>Staff</span><b>Analytics</b></div>
        <div class="ad-tools">
          ${state.sample ? '<span class="sample-flag" title="Made-up numbers. Nothing is saved."><i></i>Sample data</span>' : ''}
          <label class="pill-select"><span class="sr-only">Date range</span><select id="range">${opts}</select></label>
          <span class="custom-range" id="custom"${state.range === 'custom' ? '' : ' hidden'}>
            <input class="ad-input" type="date" id="from" min="${min}" max="${today}" value="${esc(state.from)}" aria-label="From">
            <span>to</span>
            <input class="ad-input" type="date" id="to" min="${min}" max="${today}" value="${esc(state.to)}" aria-label="To">
          </span>
          <button class="btn btn-ghost btn-sm" type="button" id="out">${state.sample && !(state.me && state.me.staff) ? 'Exit sample' : 'Sign out'}</button>
        </div>
      </div></header>
      <nav class="ad-nav" aria-label="Analytics"><div class="wrap">${NAV.map(([k, l]) => `<a class="chip" href="#/${k}" data-nav="${k}">${l}</a>`).join('')}</div></nav>
      <main class="wrap" id="view"></main>
    </div>`;
    $('#range').addEventListener('change', e => {
      state.range = e.target.value; LS.set('rr-a-range', state.range);
      $('#custom').hidden = state.range !== 'custom';
      if (state.range === 'custom' && (!state.from || !state.to)) { const t = new Date(); state.to = t.toISOString().slice(0, 10); state.from = new Date(t - 13 * 864e5).toISOString().slice(0, 10); $('#from').value = state.from; $('#to').value = state.to; }
      route();
    });
    ['from', 'to'].forEach(id => $('#' + id).addEventListener('change', e => { state[id] = e.target.value; LS.set('rr-a-' + id, e.target.value); if (state.from && state.to) route(); }));
    $('#out').addEventListener('click', async () => {
      if (state.sample) { state.sample = false; LS.set('rr-a-sample', null); }
      if (state.me && state.me.staff) await fetch('/api/analytics/logout', { credentials: 'same-origin' }).catch(() => {});
      boot();
    });
    route();
  }
  addEventListener('hashchange', () => { if ($('#view')) route(); });

  const stopTimers = () => { state.timers.forEach(clearInterval); state.timers = []; };
  let ticket = 0;
  async function route() {
    stopTimers(); hideTip();
    const view = $('#view'); if (!view) return;
    const [, name = 'overview', arg] = (location.hash.match(/^#\/([\w-]+)(?:\/(.+))?/) || []);
    $$('[data-nav]').forEach(a => a.toggleAttribute('aria-current', a.dataset.nav === name || (name === 'visitor' && a.dataset.nav === 'visitors') || (name === 'action' && a.dataset.nav === 'actions')));
    $$('[data-nav]').forEach(a => { if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page'); });
    const cur = $('[data-nav][aria-current]'); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    const fn = Views[name] || Views.overview, my = ++ticket;
    view.innerHTML = '<div class="skeleton">Loading</div>';
    try { await fn(view, arg ? decodeURIComponent(arg) : null, () => my === ticket); }
    catch (err) {
      if (err.quiet || my !== ticket) return;
      view.innerHTML = err.nodb
        ? `<div class="notice" style="margin-top:32px"><div><b>No database yet.</b> Add Neon Postgres in your Vercel project (Storage, then Create Database), redeploy, and data starts landing. Until then you can explore with sample data.</div><button class="btn btn-primary btn-sm" type="button" id="goSample">Use sample data</button></div>`
        : `<div class="notice err-box" style="margin-top:32px">${esc(err.message)}</div>`;
      const g = $('#goSample'); if (g) g.addEventListener('click', () => { state.sample = true; LS.set('rr-a-sample', '1'); shell(); });
    }
  }
  const head = (label, title, sub = '', back = '') => `<div class="ad-head"><div>${back ? `<a class="ad-back" href="${back[0]}">← ${esc(back[1])}</a>` : ''}<p class="label"><svg aria-hidden="true"><use href="#spark"/></svg>${label}</p><h1 class="ad-title">${title}</h1>${sub ? `<p class="ad-sub">${sub}</p>` : ''}</div></div>`;
  const rangeLabel = () => state.range === 'custom' ? `${day(state.from + 'T12:00')} to ${day(state.to + 'T12:00')}` : RANGES.find(r => r[0] === state.range)[1].replace('Last', 'the last');

  /* ---------- charts and lists ---------- */
  function lineChart(series, keys, hourly) {
    const W = innerWidth < 700 ? 520 : 1000, H = innerWidth < 700 ? 300 : 280, L = 44, R = 12, T = 14, B = 30;
    if (!series.length) return '<p class="empty">No data in this range.</p>';
    const max = Math.max(1, ...series.flatMap(p => keys.map(k => +p[k.k] || 0)));
    const step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
    const x = i => L + (series.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (series.length - 1)), y = v => T + (H - T - B) * (1 - v / top);
    const grid = [0, .25, .5, .75, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${y(top * f)}" y2="${y(top * f)}" stroke="rgba(226,214,255,.08)"/><text x="${L - 8}" y="${y(top * f) + 3}" text-anchor="end">${num(top * f)}</text>`).join('');
    const every = Math.max(1, Math.ceil(series.length / (innerWidth < 700 ? 4 : 8)));
    const labels = series.map((p, i) => i % every ? '' : `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${hourly ? new Date(p.t).toLocaleTimeString('en-US', { hour: 'numeric' }) : new Date(p.t + (p.t.length === 10 ? 'T12:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</text>`).join('');
    const lines = keys.map((k, n) => {
      const pts = series.map((p, i) => [x(i), y(+p[k.k] || 0)]);
      const d = 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(',')).join('L');
      return (n === 0 ? `<path d="${d}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="url(#fillA)"/>` : '') + `<path d="${d}" fill="none" stroke="${k.color}" stroke-width="${n === 0 ? 2.5 : 1.6}" stroke-linejoin="round" stroke-linecap="round"${n ? ' stroke-dasharray="5 5"' : ''}/>`;
    }).join('');
    const hits = series.map((p, i) => `<rect x="${x(i) - (W - L - R) / series.length / 2}" y="${T}" width="${Math.max(2, (W - L - R) / series.length)}" height="${H - T - B}" fill="transparent" data-i="${i}"/>`).join('');
    return `<div class="legend">${keys.map(k => `<span><i style="background:${k.swatch || k.color}"></i>${k.label}</span>`).join('')}</div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${keys.map(k => k.label).join(' and ')} over time" data-chart>
        <defs><linearGradient id="fillA" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff2d95" stop-opacity=".28"/><stop offset="1" stop-color="#2f86ff" stop-opacity="0"/></linearGradient>
        <linearGradient id="strokeA" x1="0" x2="1"><stop offset="0" stop-color="#ff2d95"/><stop offset=".5" stop-color="#b44cff"/><stop offset="1" stop-color="#2f86ff"/></linearGradient></defs>
        ${grid}${lines}${labels}<line class="hover-line" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.35)" visibility="hidden"/>${hits}
      </svg>`;
  }
  function wireChart(root, series, keys, hourly) {
    const svg = $('[data-chart]', root); if (!svg) return;
    const line = $('.hover-line', svg);
    svg.addEventListener('pointermove', e => {
      const r = e.target.closest('rect[data-i]'); if (!r) return;
      const p = series[+r.dataset.i], cx = +r.getAttribute('x') + +r.getAttribute('width') / 2;
      line.setAttribute('x1', cx); line.setAttribute('x2', cx); line.setAttribute('visibility', 'visible');
      bubble.innerHTML = `<b>${hourly ? when(p.t) : day(p.t + (p.t.length === 10 ? 'T12:00' : ''))}</b><br>${keys.map(k => `${k.label}: ${num(+p[k.k] || 0)}`).join('<br>')}`;
      bubble.classList.add('on'); bubble.style.left = Math.min(innerWidth - bubble.offsetWidth - 12, e.clientX + 14) + 'px'; bubble.style.top = (e.clientY - bubble.offsetHeight - 14) + 'px';
    });
    svg.addEventListener('pointerleave', () => { line.setAttribute('visibility', 'hidden'); bubble.classList.remove('on'); });
  }
  const spark = (pts, w = 120, h = 30) => {
    if (!pts.length) return '';
    const max = Math.max(1, ...pts), x = i => pts.length === 1 ? w / 2 : i * w / (pts.length - 1);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="M${pts.map((v, i) => x(i).toFixed(1) + ',' + (h - 2 - (h - 4) * v / max).toFixed(1)).join('L')}" fill="none" stroke="url(#sparkG)" stroke-width="2" stroke-linecap="round"/><defs><linearGradient id="sparkG" x1="0" x2="1"><stop offset="0" stop-color="#ff2d95"/><stop offset="1" stop-color="#2f86ff"/></linearGradient></defs></svg>`;
  };
  const bars = (list, { label = r => esc(r.k), href = null, sub = null, total = null } = {}) => {
    if (!list || !list.length) return '<p class="empty">Nothing yet in this range.</p>';
    const max = Math.max(...list.map(r => +r.n || 0), 1), sum = total || list.reduce((a, r) => a + (+r.n || 0), 0);
    return `<ul class="bars">${list.map(r => `<li style="--w:${(r.n / max * 100).toFixed(1)}%">${href ? `<a class="name" href="${href(r)}">${label(r)}</a>` : `<span class="name">${label(r)}</span>`}<span class="num">${num(r.n)}<small>${sub ? sub(r) : pct(r.n / sum)}</small></span></li>`).join('')}</ul>`;
  };
  const card = (title, body, tipKey = '', extra = '') => `<section class="card"><h3>${title}${tipKey ? tip(tipKey) : ''}<span class="grow"></span>${extra}</h3>${body}</section>`;

  // sortable, searchable table; turns into a sideways-scrolling box on phones
  function table(el, cols, rows, { sort = cols[1] && cols[1].k, dir = 'desc', search = true, empty = 'Nothing yet in this range.', limit = 200 } = {}) {
    let q = '', key = sort, d = dir;
    const draw = () => {
      let list = rows.filter(r => !q || cols.some(c => String(c.text ? c.text(r) : r[c.k] ?? '').toLowerCase().includes(q)));
      const c = cols.find(c => c.k === key);
      if (c) list = list.slice().sort((a, b) => { const va = c.sortv ? c.sortv(a) : a[key], vb = c.sortv ? c.sortv(b) : b[key]; const r = (va ?? -Infinity) > (vb ?? -Infinity) ? 1 : (va ?? -Infinity) < (vb ?? -Infinity) ? -1 : 0; return d === 'asc' ? r : -r; });
      $('tbody', el).innerHTML = list.length ? list.slice(0, limit).map(r => `<tr>${cols.map(c => `<td class="${c.cls || ''}">${c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.k], r) : r[c.k])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="dim" style="text-align:left">${empty}</td></tr>`;
      $$('th', el).forEach(th => th.dataset.k === key ? th.setAttribute('aria-sort', d === 'asc' ? 'ascending' : 'descending') : th.removeAttribute('aria-sort'));
    };
    el.innerHTML = `${search ? `<div class="tbl-tools"><input class="ad-input" type="search" placeholder="Search" aria-label="Search this table"></div>` : ''}
      <div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map(c => `<th scope="col" data-k="${c.k}"><button type="button">${c.label}</button>${c.tip ? tip(c.tip) : ''}</th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
    $$('th button', el).forEach(b => b.addEventListener('click', () => { const k = b.parentElement.dataset.k; if (key === k) d = d === 'asc' ? 'desc' : 'asc'; else { key = k; d = k === cols[0].k ? 'asc' : 'desc'; } draw(); }));
    const s = $('input[type=search]', el); if (s) s.addEventListener('input', () => { q = s.value.trim().toLowerCase(); draw(); });
    draw();
  }

  /* ---------- views ---------- */
  const Views = {};

  Views.overview = async (view, _, alive) => {
    const d = await api('overview'); if (!alive()) return;
    const c = d.cur, p = d.prev, B = window.RR_BENCHMARKS;
    const kpi = (k, v, dl, s, t, bk, bv) => `<section class="card kpi"><span class="k">${k}${tip(t)}</span><span class="v">${v}</span><span class="s">${dl} ${s || ''}</span>${bk ? meter(bk, bv, c.visits) : ''}</section>`;
    view.innerHTML = head('Overview', `How the site <span class="grad-text">is doing</span>`, `${rangeLabel()}, compared with the same stretch of time just before.`) + `
      <div class="kpis">
        ${kpi('Visitors', num(c.visitors), delta(c.visitors, p.visitors), '', 'visitors')}
        ${kpi('Page views', num(c.views), delta(c.views, p.views), '', 'views')}
        ${kpi('Visits', num(c.visits), delta(c.visits, p.visits), '', 'visits')}
        ${kpi('Bounce rate', pct(c.bounceRate), delta(c.bounceRate, p.bounceRate, true), '', 'bounce', 'bounceRate', c.bounceRate)}
        ${kpi('Average visit', dur(c.avgVisitMs), delta(c.avgVisitMs, p.avgVisitMs), '', 'avgVisit', 'avgVisitMs', c.avgVisitMs)}
        ${kpi('Pages per visit', c.pagesPerVisit == null ? '–' : c.pagesPerVisit.toFixed(1), delta(c.pagesPerVisit, p.pagesPerVisit), '', 'ppv', 'pagesPerVisit', c.pagesPerVisit)}
        ${kpi('Returning visits', pct(c.returningShare), delta(c.returningShare, p.returningShare), `<span class="dim">${num(c.new)} new · ${num(c.returning)} returning</span>`, 'returning', 'returningShare', c.returningShare)}
        ${kpi('Actions', num(c.actions), delta(c.actions, p.actions), '', 'actions')}
      </div>
      <div class="grid" style="margin-top:clamp(12px,1.4vw,18px)">
        ${B ? card('How you compare', benchHtml(c), 'bench') : ''}
        ${card('Visitors and page views', lineChart(d.series, [{ k: 'visitors', label: 'Visitors', color: 'url(#strokeA)', swatch: 'var(--grad)' }, { k: 'views', label: 'Page views', color: '#86d3ff' }], d.hourly), 'chart')}
        <div class="grid g3">
          ${card('Top pages', bars(d.pages, { label: r => esc(pageName(r.k)) }), 'views', '<a class="ad-back" href="#/pages">All pages →</a>')}
          ${card('Top sources', bars(d.sources), 'sources', '<a class="ad-back" href="#/audience">More →</a>')}
          ${card('Top campaigns', bars(d.campaigns), 'campaigns')}
          ${card('Devices', bars(d.devices, { label: r => esc(r.k[0].toUpperCase() + r.k.slice(1)) }), 'devices')}
          ${card('Top countries', bars(d.countries, { label: r => `${flag(r.k)} ${esc(country(r.k))}` }), 'countries')}
          ${card('Top actions', bars(d.actions, { href: r => '#/action/' + encodeURIComponent(r.k) }), 'actions', '<a class="ad-back" href="#/actions">All actions →</a>')}
        </div>
      </div>`;
    wireChart(view, d.series, [{ k: 'visitors', label: 'Visitors' }, { k: 'views', label: 'Page views' }], d.hourly);
  };

  /* benchmarks: rate a number against admin/analytics/benchmarks.js, and draw where it sits */
  const RATING = { ok: 'Good', mid: 'OK', low: 'Needs work' };
  const metric = key => (window.RR_BENCHMARKS && window.RR_BENCHMARKS.metrics.find(m => m.key === key)) || null;
  const showM = (m, v) => v == null || isNaN(v) ? '–' : m.unit === 'pct' ? pct(v, v < .1 ? 1 : 0) : m.unit === 'ms' ? dur(v) : v.toFixed(1);
  const rate = (m, v) => {
    if (!m || v == null || isNaN(v)) return '';
    const better = (a, b) => m.lowerIsBetter ? a <= b : a >= b;
    if (better(v, m.goal)) return 'ok';
    return (m.lowerIsBetter ? v <= m.typical[1] : v >= m.typical[0]) ? 'mid' : 'low';
  };
  function meter(key, v, visits) {
    const m = metric(key); if (!m) return '';
    const enough = visits == null || visits >= 30, cls = enough ? rate(m, v) : '';
    const pts = [m.typical[0], m.typical[1], m.goal, v].filter(x => x != null && !isNaN(x));
    const lo = Math.min(...pts) * .6, hi = Math.max(...pts) * 1.25, x = n => Math.max(0, Math.min(100, (n - lo) / (hi - lo) * 100));
    // the bar reads left to right from worse to better
    const pos = n => m.lowerIsBetter ? 100 - x(n) : x(n);
    const a = pos(m.typical[0]), b = pos(m.typical[1]);
    return `<span class="bm" title="Typical ${showM(m, m.typical[0])}–${showM(m, m.typical[1])}, goal ${m.lowerIsBetter ? 'under' : 'over'} ${showM(m, m.goal)}">
        <span class="bm-bar"><i class="band" style="left:${Math.min(a, b)}%;width:${Math.abs(b - a)}%"></i><i class="goal" style="left:${pos(m.goal)}%"></i>${v != null && !isNaN(v) ? `<i class="dot ${cls || 'none'}" style="left:${pos(v)}%"></i>` : ''}</span>
        <span class="bm-row">${cls ? `<span class="tag ${cls}">${RATING[cls]}</span>` : `<span class="tag">${enough ? 'No data' : 'Too few visits'}</span>`}<span class="bm-t">Typical ${showM(m, m.typical[0])}–${showM(m, m.typical[1])}</span></span></span>`;
  }

  // a small colored dot for table cells, with the rating in its tooltip
  const pip = (key, v, n) => { const m = metric(key), cls = m && n >= 30 ? rate(m, v) : ''; return cls ? `<i class="pip ${cls}" title="${RATING[cls]} · typical ${showM(m, m.typical[0])}–${showM(m, m.typical[1])}"></i>` : ''; };

  function benchHtml(c) {
    const B = window.RR_BENCHMARKS; if (!B) return '';
    const enough = c.visits >= 30;
    const val = { bounceRate: c.bounceRate, avgVisitMs: c.avgVisitMs, pagesPerVisit: c.pagesPerVisit, returningShare: c.returningShare, actionRate: c.actionRate, formRate: c.formRate, avgScroll: c.avgScroll };
    const show = showM;
    return `<p class="dim" style="margin:0 0 10px;font-size:14px">${enough ? '<span class="tag ok">Good</span> at or past the goal · <span class="tag mid">OK</span> inside the typical range · <span class="tag low">Needs work</span> below typical. Tap a row for what it means and what moves it.' : `Ratings start at 30 visits in the range. This range has ${num(c.visits)}, so the ranges below are for context only.`}</p>
      <div class="bench">${B.metrics.map(m => {
        const v = val[m.key];
        const cls = enough ? rate(m, v) : '', status = cls ? RATING[cls] : '';
        return `<details><summary><span class="bn">${esc(m.label)}</span><span class="bv">${show(m, v)}</span>
          <span class="br">Typical ${show(m, m.typical[0])}–${show(m, m.typical[1])}</span><span class="br">Goal ${m.lowerIsBetter ? 'under' : 'over'} ${show(m, m.goal)}</span>
          <span>${status ? `<span class="tag ${cls}">${status}</span>` : '<span class="tag">Not rated yet</span>'}</span></summary>
          <div class="note"><p style="margin:0">${esc(m.means)}</p><p style="margin:0"><b style="color:var(--text)">What moves it:</b> ${esc(m.moves)}</p>
          <p style="margin:0">Sources: ${m.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(', ')}</p></div></details>`;
      }).join('')}</div>
      <p class="dim" style="margin:12px 0 0;font-size:13px">${esc(B.note || '')}</p>`;
  }

  Views.pages = async (view, _, alive) => {
    const d = await api('pages'); if (!alive()) return;
    view.innerHTML = head('Pages', `What people <span class="grad-text">read</span>`, rangeLabel()) + `
      <div class="grid">
        <section class="card" id="ptable"></section>
        <div class="grid g2">
          ${card('Landing pages', bars(d.table.filter(r => r.entries).sort((a, b) => b.entries - a.entries).slice(0, 10).map(r => ({ k: r.path, n: r.entries, b: r.bounces })), { label: r => esc(pageName(r.k)), sub: r => pct(r.b / r.n) + ' bounce' }), 'entries')}
          ${card('Exit pages', bars(d.table.filter(r => r.exits).sort((a, b) => b.exits - a.exits).slice(0, 10).map(r => ({ k: r.path, n: r.exits })), { label: r => esc(pageName(r.k)) }), 'exits')}
        </div>
        ${card('When people visit', `<div class="tbl-wrap">${hourmap(d.heat)}</div>`, 'hours')}
      </div>`;
    table($('#ptable'), [
      { k: 'path', label: 'Page', html: r => `<a href="${esc(r.path)}" target="_blank" rel="noopener">${esc(pageName(r.path))}</a>`, cls: 'wrap-cell' },
      { k: 'views', label: 'Views', fmt: num, tip: 'views' }, { k: 'visitors', label: 'Visitors', fmt: num, tip: 'visitors' },
      { k: 'avg_active', label: 'Active time', fmt: dur, tip: 'activeTime' }, { k: 'avg_scroll', label: 'Scroll', html: r => r.avg_scroll == null ? '–' : `${Math.round(r.avg_scroll)}% ${pip('avgScroll', r.avg_scroll / 100, r.views)}`, tip: 'scroll' },
      { k: 'entries', label: 'Entries', fmt: num, tip: 'entries' }, { k: 'bounce', label: 'Bounce', fmt: v => v == null ? '–' : pct(v), sortv: r => r.entries ? r.bounces / r.entries : null, tip: 'bounce', html: r => r.entries ? `${pct(r.bounces / r.entries)} ${pip('bounceRate', r.bounces / r.entries, r.entries)}` : '–' },
      { k: 'exits', label: 'Exits', fmt: num, tip: 'exits' }
    ], d.table);
  };
  function hourmap(rows) {
    const g = {}; let max = 1; rows.forEach(r => { g[r.d + '-' + r.h] = r.n; max = Math.max(max, r.n); });
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return `<div class="hourmap"><span></span>${Array.from({ length: 24 }, (_, h) => `<span>${h % 3 ? '' : (h % 12 || 12) + (h < 12 ? 'a' : 'p')}</span>`).join('')}
      ${days.map((dn, i) => `<span>${dn}</span>` + Array.from({ length: 24 }, (_, h) => { const n = g[(i + 1) + '-' + h] || 0; return `<i style="--a:${(n / max).toFixed(2)}" title="${dn} ${(h % 12 || 12)}${h < 12 ? 'am' : 'pm'}: ${n} views"></i>`; }).join('')).join('')}</div>`;
  }

  Views.audience = async (view, _, alive) => {
    const d = await api('audience'); if (!alive()) return;
    const cap = s => esc(s[0].toUpperCase() + s.slice(1));
    view.innerHTML = head('Audience', `Who <span class="grad-text">shows up</span>`, rangeLabel() + '. Counts are visits.') + `
      <div class="grid g3">
        ${card('Sources', bars(d.sources), 'sources')}
        ${card('Referring sites', bars(d.referrers, { label: r => `<span>${esc(r.k)}</span>` }), 'sources')}
        ${card('Devices', bars(d.devices, { label: r => cap(r.k) }), 'devices')}
        ${card('Browsers', bars(d.browsers))}
        ${card('Operating systems', bars(d.oses))}
        ${card('Languages', bars(d.languages, { label: r => esc((langs && r.k !== '??' && langs.of(r.k)) || r.k) }))}
        ${card('Countries (approximate)', bars(d.countries, { label: r => `${flag(r.k)} ${esc(country(r.k))}` }), 'countries')}
        ${card('Regions (approximate)', bars(d.regions, { label: r => { const [c, rg] = r.k.split(' / '); return `${flag(c)} ${esc(rg === '?' ? country(c) : rg + ', ' + c)}`; } }), 'countries')}
        <section class="card" id="camps" style="grid-column:1/-1"></section>
      </div>`;
    const el = $('#camps');
    el.innerHTML = `<h3>Campaigns${tip('campaigns')}</h3><div></div>`;
    table($('div', el), [{ k: 'k', label: 'Campaign', cls: 'wrap-cell' }, { k: 's', label: 'Source' }, { k: 'm', label: 'Medium' }, { k: 'n', label: 'Visits', fmt: num }], d.campaigns, { sort: 'n', search: false, empty: 'No tagged campaign links in this range. Add utm_source, utm_medium and utm_campaign to links you share.' });
  };

  Views.actions = async (view, _, alive) => {
    const d = await api('actions'); if (!alive()) return;
    const prev = Object.fromEntries(d.prev.map(r => [r.name, r.n]));
    view.innerHTML = head('Actions', `What people <span class="grad-text">do</span>`, rangeLabel() + '. Click an action to see the visits that included it.') + `<section class="card" id="atable"></section>`;
    const unit = state.range === '24h' ? 'hour' : 'day';
    table($('#atable'), [
      { k: 'name', label: 'Action', html: r => `<a href="#/action/${encodeURIComponent(r.name)}">${esc(r.name)}</a>`, cls: 'wrap-cell' },
      { k: 'n', label: 'Count', html: r => `${num(r.n)} ${delta(r.n, prev[r.name] || 0)}` },
      { k: 'u', label: 'Visitors', fmt: num, tip: 'actionU' },
      { k: 'trend', label: 'Trend', html: r => spark(trendFor(d.trend.filter(t => t.name === r.name), unit)), sortv: r => r.n },
      { k: 'pages', label: 'Where', html: r => d.where.filter(w => w.name === r.name).slice(0, 3).map(w => `<span class="tag">${esc(pageName(w.path))} · ${w.n}</span>`).join(' '), sortv: r => r.n, cls: 'wrap-cell' }
    ], d.list, { sort: 'n', empty: 'No actions in this range yet.' });
  };
  function trendFor(rows, unit) {
    const m = Object.fromEntries(rows.map(r => [r.t, r.n])), keys = Object.keys(m).sort();
    if (!keys.length) return [];
    const out = [], step = unit === 'hour' ? 36e5 : 864e5;
    for (let t = new Date(keys[0] + 'Z').getTime(); t <= new Date(keys[keys.length - 1] + 'Z').getTime() && out.length < 400; t += step) out.push(m[new Date(t).toISOString().slice(0, 16)] || 0);
    return out.length > 1 ? out : [0, out[0] || 0];
  }
  Views.action = async (view, name, alive) => {
    const rows = await api('action-visits', { name }); if (!alive()) return;
    view.innerHTML = head('Action', esc(name), `${rows.length} visit${rows.length === 1 ? '' : 's'} with this action, ${rangeLabel()}.`, ['#/actions', 'All actions']) + `<section class="card" id="vt"></section>`;
    table($('#vt'), [
      { k: 'started', label: 'When', fmt: when, sortv: r => +new Date(r.started) },
      { k: 'who', label: 'Visitor', html: r => r.browser_id ? `<a href="#/visitor/${r.browser_id}">${esc(r.email || r.browser_id.slice(0, 8))}</a>` : '<span class="dim">No browser ID</span>', sortv: r => r.email || r.browser_id || '' },
      { k: 'labels', label: 'Details', html: r => (r.labels || []).filter(Boolean).slice(0, 3).map(l => `<span class="tag">${esc(l)}</span>`).join(' ') || '<span class="dim">–</span>', sortv: r => (r.labels || []).join(), cls: 'wrap-cell' },
      { k: 'landing', label: 'Landed on', fmt: v => pageName(v || '') }, { k: 'source', label: 'Source' }, { k: 'device', label: 'Device' },
      { k: 'views', label: 'Pages', fmt: num }, { k: 'active', label: 'Active', fmt: dur }
    ], rows, { sort: 'started' });
  };

  /* live: who's here now, with each visit's page-by-page log */
  const logHtml = (log, liveNow) => `<ol class="log">${log.map((l, i) => l.kind === 'view'
    ? `<li class="${liveNow && i === log.map(x => x.kind).lastIndexOf('view') ? 'now' : ''}"><time>${clock(l.at)}</time><span class="p">${esc(pageName(l.path))}</span><span class="m">${l.active ? dur(l.active) : liveNow && i === log.map(x => x.kind).lastIndexOf('view') ? 'reading now' : '–'}${l.scroll ? ' · ' + l.scroll + '% down' : ''}</span></li>`
    : `<li class="act"><time>${clock(l.at)}</time><span class="p">${esc(l.name)}</span>${l.label ? `<span class="m">${esc(l.label)}</span>` : ''}</li>`).join('')}</ol>`;
  const personHtml = (r, liveNow) => `<article class="card person">
      <div class="person-top"><span class="who">${r.browser_id ? `<a href="#/visitor/${r.browser_id}">${esc(r.email || 'Visitor ' + r.browser_id.slice(0, 6))}</a>` : 'Visitor (no ID)'}</span>
        ${liveNow ? '<span class="rec"><i></i>Here now</span>' : `<span class="tag">Left ${ago(r.left_at || r.last_seen)}</span>`}</div>
      <div class="pmeta"><span>${liveNow ? 'On ' + esc(pageName(r.path)) : 'Last on ' + esc(pageName(r.path))}</span><span>${dur(r.on_site * 1000)} this visit</span><span>${esc(r.source || 'Direct')}</span><span>${esc(r.device || '')}</span><span>${flag(r.country)} ${esc(place(r) || 'Unknown')}</span></div>
      ${r.log && r.log.length ? `<details class="more"${liveNow ? ' open' : ''}><summary>This visit</summary>${logHtml(r.log, liveNow)}</details>` : ''}
    </article>`;
  Views.live = async (view, _, alive) => {
    const draw = async () => {
      const d = await api('live'); if (!alive()) return;
      const dots = d.live.filter(r => r.lat != null && r.lon != null);
      view.innerHTML = head('Live', `Right <span class="grad-text">now</span>`, 'Refreshes every 12 seconds.') + `
        <div class="grid">
          <div class="grid g2">
            <section class="card"><div class="live-count"><b>${d.live.length}</b><span>live visitor${d.live.length === 1 ? '' : 's'} ${tip('live')}<br><span class="rec"><i></i>Updated ${clock(Date.now())}</span></span></div></section>
            <section class="card"><div class="map"><svg viewBox="0 0 360 180" preserveAspectRatio="xMidYMid meet" aria-label="Where live visitors are, approximately"><path class="land" d="${window.RR_WORLD || ''}"/>
              ${dots.map(r => { const x = (r.lon + 180), y = (90 - r.lat); return `<circle class="ring" cx="${x}" cy="${y}" r="2.4"/><circle class="dot" cx="${x}" cy="${y}" r="1.6"><title>${esc(place(r))}</title></circle>`; }).join('')}</svg></div>
              <p class="dim" style="margin:10px 0 0;font-size:13px">Locations are approximate.</p></section>
          </div>
          <div class="people">${d.live.length ? d.live.map(r => personHtml(r, true)).join('') : '<section class="card"><p class="empty">Nobody on the site right now.</p></section>'}</div>
          <div class="ad-head" style="margin-top:20px"><div><p class="label"><svg aria-hidden="true"><use href="#spark"/></svg>Left in the last 30 minutes ${tip('left')}</p></div></div>
          <div class="people">${d.left.length ? d.left.map(r => personHtml(r, false)).join('') : '<section class="card"><p class="empty">No one left in the last 30 minutes.</p></section>'}</div>
        </div>`;
    };
    await draw();
    state.timers.push(setInterval(() => { if (document.visibilityState === 'visible') draw().catch(() => {}); }, 12000));
  };

  Views.visitors = async (view, _, alive) => {
    const d = await api('visitors'); if (!alive()) return;
    view.innerHTML = head('Visitors', `People who <span class="grad-text">come back</span>`, rangeLabel() + '. Browsers with more than one visit.') + `<section class="card" id="vt"></section>
      <p class="dim" style="font-size:13px;margin:12px 0 0">Visitors who sent Global Privacy Control or Do Not Track, and visitors in the EU, EEA, UK or Switzerland, never appear here. ${tip('repeat')}</p>`;
    table($('#vt'), [
      { k: 'browser_id', label: 'Visitor', html: r => `<a href="#/visitor/${r.browser_id}">${esc(r.email || 'Visitor ' + r.browser_id.slice(0, 6))}</a>`, sortv: r => r.email || r.browser_id },
      { k: 'visits', label: 'Visits', fmt: num }, { k: 'pages', label: 'Pages', fmt: num }, { k: 'actions', label: 'Actions', fmt: num },
      { k: 'first_seen', label: 'First seen', fmt: day, sortv: r => +new Date(r.first_seen) }, { k: 'last_seen', label: 'Last seen', fmt: ago, sortv: r => +new Date(r.last_seen) },
      { k: 'top_pages', label: 'Top pages', html: r => (r.top_pages || []).map(p => `<span class="tag">${esc(pageName(p))}</span>`).join(' '), sortv: r => r.pages, cls: 'wrap-cell' },
      { k: 'top_actions', label: 'Top actions', html: r => (r.top_actions || []).map(p => `<span class="tag">${esc(p)}</span>`).join(' ') || '<span class="dim">–</span>', sortv: r => r.actions, cls: 'wrap-cell' }
    ], d.rows, { sort: 'visits', empty: 'No repeat visitors in this range yet.' });
  };
  Views.visitor = async (view, id, alive) => {
    const d = await api('visitor', { id }); if (!alive()) return;
    const t = d.totals;
    view.innerHTML = head('Visitor', esc(d.email || 'Visitor ' + id.slice(0, 6)), `First came from ${esc(d.firstSource || 'Direct')}. Browser ID <span class="mono">${esc(id)}</span>`, ['#/visitors', 'All visitors']) + `
      ${d.live ? `<div class="notice"><span class="rec"><i></i>On the site now</span><div>Reading <b>${esc(pageName(d.live.path))}</b>${logHtml(d.live.log, true)}</div></div>` : ''}
      <div class="kpis">
        <section class="card kpi"><span class="k">Visits</span><span class="v">${num(t.visits)}</span></section>
        <section class="card kpi"><span class="k">Pages</span><span class="v">${num(t.pages)}</span></section>
        <section class="card kpi"><span class="k">Active time${tip('avgVisit')}</span><span class="v">${dur(t.active)}</span></section>
        <section class="card kpi"><span class="k">Actions</span><span class="v">${num(t.actions)}</span><span class="s">First seen ${t.first ? day(t.first) : '–'} · last ${t.last ? ago(t.last) : '–'}</span></section>
      </div>
      <div class="people" style="margin-top:16px">${d.visits.map(v => `<article class="card person"><div class="person-top"><span class="who">${when(v.started)}</span><span class="tag">${dur(v.active)} active</span></div>
        <div class="pmeta"><span>${esc(v.source || 'Direct')}</span><span>${esc(v.device || '')}</span><span>${flag(v.country)} ${esc([v.city, country(v.country)].filter(Boolean).join(', '))}</span></div>${logHtml(v.log, false)}</article>`).join('')}</div>`;
  };

  /* heatmaps: the live page in a frame at the device width, with the heat painted over it */
  const WIDTHS = { desktop: [1440, 900], tablet: [820, 1180], phone: [390, 844] };
  Views.heatmaps = async (view, _, alive) => {
    const saved = JSON.parse(LS.get('rr-a-heat') || '{}');
    let page = saved.page || '/', device = saved.device || 'desktop', kind = saved.kind || 'click';
    view.innerHTML = head('Heatmaps', `Where eyes and <span class="grad-text">clicks land</span>`, rangeLabel() + '. The page shows live, at the width of the device you pick.') + `
      <section class="card"><div class="heat-bar">
        <label class="pill-select"><span class="sr-only">Page</span><select id="hp"></select></label>
        <div class="chips" id="hd">${Object.keys(WIDTHS).map(k => `<button class="chip" type="button" data-v="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
        <div class="chips" id="hk">${[['click', 'Clicks'], ['move', 'Cursor'], ['scroll', 'Scroll']].map(([k, l]) => `<button class="chip" type="button" data-v="${k}">${l}</button>`).join('')}</div>
        ${tip('heat')}<span class="grow" style="flex:1"></span><span class="ramp" id="ramp"><span>Fewer</span><i></i><span>More</span></span>
      </div><p class="dim" id="hinfo" style="margin:0 0 12px;font-size:13px"></p><div class="viewer" id="viewer"></div></section>
      <section class="card" style="margin-top:16px"><h3>Most clicked elements</h3><div id="els"></div></section>`;
    const sel = $('#hp');
    const load = async () => {
      LS.set('rr-a-heat', JSON.stringify({ page, device, kind }));
      $$('#hd .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === device));
      $$('#hk .chip').forEach(b => { b.setAttribute('aria-pressed', b.dataset.v === kind); b.disabled = b.dataset.v === 'move' && device !== 'desktop'; });
      if (kind === 'move' && device !== 'desktop') { kind = 'click'; return load(); }
      const d = await api('heat', { page, device }); if (!alive()) return;
      const pages = [...new Set(['/', '/episode-1.html', '/episode-2.html', '/store.html', ...d.pages.map(p => p.page)])];
      sel.innerHTML = pages.map(p => `<option value="${esc(p)}"${p === page ? ' selected' : ''}>${esc(pageName(p))}</option>`).join('');
      const cells = d.cells.filter(c => c.kind === kind);
      $('#hinfo').textContent = `${num(d.views)} page view${d.views === 1 ? '' : 's'} on ${device}. ${kind === 'scroll' ? 'Shaded areas were seen by fewer people.' : num(cells.reduce((a, c) => a + c.n, 0)) + (kind === 'click' ? ' clicks.' : ' cursor samples.')} Screenshot: the live page at ${WIDTHS[device][0]} px wide.`;
      $('#ramp').hidden = kind === 'scroll';
      $('#els').innerHTML = bars(d.elements.map(e => ({ k: e.sel, n: e.n })), { label: r => `<span class="mono">${esc(r.k)}</span>` });
      paint($('#viewer'), page, device, kind, cells);
    };
    sel.addEventListener('change', () => { page = sel.value; load(); });
    $('#hd').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { device = b.dataset.v; load(); } });
    $('#hk').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b && !b.disabled) { kind = b.dataset.v; load(); } });
    await load();
  };
  function paint(viewer, page, device, kind, cells) {
    const [W, VH] = WIDTHS[device];
    const cs = getComputedStyle(viewer.parentElement), avail = viewer.parentElement.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2, s = Math.min(1, avail / W);
    viewer.style.width = W * s + 'px'; viewer.style.height = VH * s + 'px';
    const src = page + (page.includes('?') ? '&' : '?') + 'rr-heatmap=1';
    let frame = $('iframe', viewer);
    const same = frame && frame.dataset.src === src && frame.dataset.w == W;
    if (!same) {
      viewer.innerHTML = `<iframe title="Page preview" loading="eager" scrolling="yes"></iframe><canvas></canvas><div class="scroll-marks"></div>`;
      frame = $('iframe', viewer); frame.dataset.src = src; frame.dataset.w = W;
      frame.style.width = W + 'px'; frame.style.height = VH + 'px'; frame.style.transform = `scale(${s})`;
      frame.src = src;
    }
    const canvas = $('canvas', viewer), marks = $('.scroll-marks', viewer);
    const draw = () => {
      let doc; try { doc = frame.contentDocument; } catch (_) { return; }
      if (!doc || !doc.documentElement) return;
      const H = Math.min(30000, Math.max(VH, doc.documentElement.scrollHeight));
      const sy = (frame.contentWindow.scrollY || 0);
      canvas.width = Math.round(W * s); canvas.height = Math.round(H * s);
      canvas.style.transform = `translateY(${-sy * s}px)`; marks.style.transform = `translateY(${-sy * s}px)`; marks.style.height = H * s + 'px';
      canvas.className = kind === 'scroll' ? 'scroll' : '';
      const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
      marks.innerHTML = '';
      if (kind === 'scroll') {
        const total = cells.reduce((a, c) => a + c.n, 0) || 1;
        for (let dpt = 0; dpt <= 100; dpt += 5) {
          const reached = cells.filter(c => c.cy >= dpt).reduce((a, c) => a + c.n, 0) / total;
          const y0 = (dpt - 5) / 100 * H * s, y1 = dpt / 100 * H * s;
          ctx.fillStyle = `rgba(7,6,12,${(.82 * (1 - reached)).toFixed(3)})`; ctx.fillRect(0, Math.max(0, y0), canvas.width, y1 - Math.max(0, y0));
        }
        [25, 50, 75, 100].forEach(dpt => {
          const reached = cells.filter(c => c.cy >= dpt).reduce((a, c) => a + c.n, 0) / total;
          marks.insertAdjacentHTML('beforeend', `<div class="mark" style="top:${dpt / 100 * H * s - (dpt === 100 ? 2 : 0)}px"><span>${dpt}% down · ${cells.length ? pct(reached) : '–'} reached</span></div>`);
        });
        return;
      }
      // heat: soft blobs on an alpha layer, then colored through the ramp
      const off = document.createElement('canvas'); off.width = canvas.width; off.height = canvas.height;
      const o = off.getContext('2d'); const max = Math.max(1, ...cells.map(c => c.n));
      const r = Math.max(10, (kind === 'click' ? 26 : 34) * s);
      cells.forEach(c => {
        const x = (c.cx + .5) / 40 * W * s, y = (c.cy * 20 + 10) * s;
        const g = o.createRadialGradient(x, y, 0, x, y, r); const a = Math.min(1, .12 + .55 * c.n / max) * (kind === 'move' ? .45 : .7);
        g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); o.fillStyle = g; o.fillRect(x - r, y - r, r * 2, r * 2);
      });
      const img = o.getImageData(0, 0, off.width, off.height), px = img.data;
      const stops = [[28, 43, 255], [180, 76, 255], [255, 45, 149], [255, 209, 102], [255, 255, 255]];
      for (let i = 3; i < px.length; i += 4) {
        const a = px[i] / 255; if (!a) continue;
        const t = Math.min(.999, a * 1.15) * (stops.length - 1), k = Math.floor(t), f = t - k, A = stops[k], Bc = stops[k + 1];
        px[i - 3] = A[0] + (Bc[0] - A[0]) * f; px[i - 2] = A[1] + (Bc[1] - A[1]) * f; px[i - 1] = A[2] + (Bc[2] - A[2]) * f; px[i] = Math.min(255, 60 + a * 230);
      }
      ctx.putImageData(img, 0, 0);
    };
    const hook = () => {
      try {
        const w = frame.contentWindow;
        // a still copy: links and buttons in the preview do nothing
        w.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); }, true);
        w.addEventListener('submit', e => e.preventDefault(), true);
        w.addEventListener('scroll', () => { canvas.style.transform = `translateY(${-w.scrollY * s}px)`; marks.style.transform = `translateY(${-w.scrollY * s}px)`; }, { passive: true });
        draw(); setTimeout(draw, 1500); setTimeout(draw, 4000);
      } catch (_) {}
    };
    if (same) draw(); else frame.addEventListener('load', hook, { once: true });
  }

  Views.subscribers = async (view, _, alive) => {
    let d = await api('subscribers'); if (!alive()) return;
    const STATUS = { subscribed: ['Subscribed', 'ok'], pending: ['Confirming', 'mid'], not_sent: ['Not sent yet', 'low'], unsubscribed: ['Unsubscribed', ''], cleaned: ['Bounced', ''] };
    let rows = d.rows.slice(), page = 0, act = null;
    if (!view.__subs) view.__subs = true, view.addEventListener('click', e => {
      const r = e.target.closest('[data-retry]'), x = e.target.closest('[data-del]'), act = view.__act;
      if (r && act) act({ retry: r.dataset.retry }, 'Sending to Mailchimp…');
      if (x && act && confirm(`Remove ${x.dataset.del} from this list? This doesn't unsubscribe them in Mailchimp.`)) act({ delete: x.dataset.del }, 'Removing…');
    });
    const draw = () => {
      view.innerHTML = head('Subscribers', `The <span class="grad-text">list</span>`, `Everyone who signed up for the newsletter on the site. Mailchimp sends the emails; this copy is yours. ${rangeLabel()}.`) + `
        <div class="kpis">
          <section class="card kpi"><span class="k">Subscribers${tip('subsTotal')}</span><span class="v">${num(d.total)}</span><span class="s">all time</span></section>
          <section class="card kpi"><span class="k">New${tip('subsNew')}</span><span class="v">${num(d.now)}</span><span class="s">${delta(d.now, d.prev)}</span></section>
          <section class="card kpi"><span class="k">Not sent yet${tip('subsNotSent')}</span><span class="v">${num(d.notSent)}</span><span class="s">${d.notSent ? '<button class="btn btn-ghost btn-sm" type="button" id="retryAll">Retry all</button>' : 'All in Mailchimp'}</span></section>
          <section class="card kpi"><span class="k">Signup rate${tip('subsRate')}</span><span class="v">${d.visits ? pct(d.now / d.visits, 1) : '–'}</span><span class="s">${num(d.now)} of ${num(d.visits)} visits${d.pending ? ` · ${num(d.pending)} confirming` : ''}</span>${meter('formRate', d.visits ? d.now / d.visits : null, d.visits)}</section>
        </div>
        <div class="grid" style="margin-top:clamp(12px,1.4vw,18px)">
          ${card('Signups', lineChart(d.series, [{ k: 'signups', label: 'Signups', color: 'url(#strokeA)', swatch: 'var(--grad)' }], d.hourly))}
          <div class="grid g2">${card('Signed up from', bars(d.sources))}${card('On page', bars(d.pages, { label: r => esc(pageName(r.k)) }))}</div>
          <section class="card"><h3>Everyone<span class="grow"></span>
            <button class="btn btn-ghost btn-sm" type="button" id="subImport">Import from Mailchimp</button>
            <button class="btn btn-ghost btn-sm" type="button" id="subCsv">Download CSV</button></h3>
            <p class="form-note" id="subNote" role="status"></p><div id="subTable"></div>
            ${rows.length >= (page + 1) * 100 ? '<div class="row" style="margin-top:12px"><button class="btn btn-ghost btn-sm" type="button" id="subMore">Load more</button></div>' : ''}</section>
        </div>`;
      wireChart(view, d.series, [{ k: 'signups', label: 'Signups' }], d.hourly);
      table($('#subTable'), [
        { k: 'email', label: 'Email', html: r => r.browser_id ? `<a href="#/visitor/${esc(r.browser_id)}">${esc(r.email)}</a>` : esc(r.email), cls: 'wrap-cell' },
        { k: 'created_at', label: 'Joined', fmt: when, sortv: r => +new Date(r.created_at) },
        { k: 'source', label: 'From', fmt: v => v || 'website' }, { k: 'page', label: 'Page', fmt: v => v ? pageName(v) : '–' },
        { k: 'place', label: 'Where', html: r => `${flag(r.country)} ${esc([r.city, r.region].filter(Boolean).join(', ') || country(r.country))}`, sortv: r => r.country || '' },
        { k: 'status', label: 'Status', html: r => { const s = STATUS[r.status] || [r.status, '']; return `<span class="tag ${s[1]}" title="${esc(r.mailchimp || '')}">${esc(s[0])}</span>`; } },
        { k: 'act', label: '', html: r => `${r.status === 'not_sent' ? `<button class="btn btn-ghost btn-sm" type="button" data-retry="${esc(r.email)}">Retry</button> ` : ''}<button class="btn btn-ghost btn-sm" type="button" data-del="${esc(r.email)}">Remove</button>`, sortv: r => r.email }
      ], rows, { sort: 'created_at', empty: 'No signups yet. They show up here the moment someone joins.' });
      const note = $('#subNote');
      view.__act = act = async (body, msg) => {
        const note = $('#subNote');
        if (state.sample) { note.textContent = 'Sample data is on, so nothing changes.'; return; }
        note.className = 'form-note'; note.textContent = msg;
        try { d = await api('subscribers', {}, body); rows = d.rows.slice(); page = 0; draw(); const n = $('#subNote'); const r = d.done || {};
          n.className = 'form-note' + (r.error ? ' err' : ''); n.textContent = r.error || (body.import ? `Imported ${num(r.added)} new of ${num(r.seen)} in Mailchimp.` : body.retry ? `${num(r.ok)} sent, ${num(r.failed)} still failing.` : 'Done.'); }
        catch (e) { note.className = 'form-note err'; note.textContent = e.message; }
      };
      const ra = $('#retryAll'); if (ra) ra.addEventListener('click', () => act({ retry: 'all' }, 'Sending everyone to Mailchimp…'));
      $('#subImport').addEventListener('click', () => act({ import: true }, 'Importing from Mailchimp. Big lists take a minute…'));
      $('#subCsv').addEventListener('click', () => { if (state.sample) { note.textContent = 'Sample data is on. Turn it off to download the real list.'; return; } location.href = '/api/analytics/subscribers-export'; });
      const more = $('#subMore'); if (more) more.addEventListener('click', async () => { page++; const n = await api('subscribers', { page }); rows = rows.concat(n.rows); draw(); });
    };
    draw();
  };

  Views.settings = async (view, _, alive) => {
    const d = await api('settings'); if (!alive()) return;
    const staff = LS.get('rr-staff') === '1';
    const heatAll = d.heat_pages === 'all';
    view.innerHTML = head('Settings', `Keep it <span class="grad-text">clean</span>`) + `
      <div class="grid g2">
        <section class="card set"><h3>Sample data</h3>
          <label class="switch"><input type="checkbox" id="sw"${state.sample ? ' checked' : ''}> Show sample data</label>
          <p>Fills every page with realistic made-up numbers, for demos or before real traffic arrives. Nothing is saved while it's on.</p></section>
        <section class="card set"><h3>This browser</h3>
          <p id="staffNote" class="${staff ? 'ok-note' : ''}">${staff ? 'This browser isn’t counted. Anything you do on the site from here stays out of the numbers.' : 'This browser is counted like any visitor.'}</p>
          <div class="row">${staff ? '<button class="btn btn-ghost btn-sm" type="button" id="countAgain">Count it again</button>' : '<button class="btn btn-ghost btn-sm" type="button" id="stopCount">Stop counting this browser</button>'}</div></section>
        <section class="card set"><h3>Excluded IP addresses</h3>
          <p>Traffic from these addresses is dropped before it's stored. IPv6 addresses exclude the whole /64 network.</p>
          ${(d.excluded_ips || []).length ? `<ul class="bars">${d.excluded_ips.map(x => `<li><span class="name mono">${esc(x.ip)}${x.label ? ` <span class="dim">${esc(x.label)}</span>` : ''}</span><button class="btn btn-ghost btn-sm" type="button" data-rm="${esc(x.ip)}">Remove</button></li>`).join('')}</ul>` : '<p class="dim">None yet.</p>'}
          <div class="row"><button class="btn btn-primary btn-sm" type="button" id="addMine">Exclude my current IP</button>${d.myIp ? `<span class="mono dim">${esc(d.myIp)}</span>` : ''}</div>
          <form class="row" id="ipForm"><input class="ad-input" name="ip" placeholder="Another IP address" aria-label="IP address to exclude"><input class="ad-input" name="label" placeholder="Label (optional)" aria-label="Label"><button class="btn btn-ghost btn-sm" type="submit">Add</button></form></section>
        <section class="card set"><h3>Filtered out${tip('filtered')}</h3>
          <div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">
            <div class="kpi"><span class="k">Known bots</span><span class="v">${num(d.filtered.bot_ua)}</span></div>
            <div class="kpi"><span class="k">Likely bots</span><span class="v">${num(d.filtered.likely_bots)}</span></div>
            <div class="kpi"><span class="k">No JavaScript</span><span class="v">${num(d.filtered.no_js)}</span></div>
            <div class="kpi"><span class="k">Excluded IPs</span><span class="v">${num(d.filtered.excluded_ip)}</span></div>
          </div><p>Last 30 days.</p></section>
        <section class="card set" style="grid-column:1/-1"><h3>Custom actions</h3>
          <p>Record anything people do with one line of JavaScript, anywhere on the site. The name groups it in Actions; the label is optional detail.</p>
          <div class="row"><pre class="code" id="snip">window.analytics.track('Booked a call', 'Footer button');</pre><button class="btn btn-ghost btn-sm" type="button" id="copySnip">Copy</button></div>
          <p>Recorded automatically: outbound links, email and phone clicks, downloads and form sends (the form's name only, never what's typed).</p>
          ${d.custom.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Custom action</th><th>Count</th><th>Last seen</th></tr></thead><tbody>${d.custom.map(c => `<tr><td><a href="#/action/${encodeURIComponent(c.name)}">${esc(c.name)}</a></td><td>${num(c.n)}</td><td>${ago(c.last)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dim">No custom actions recorded yet.</p>'}</section>
        <section class="card set"><h3>Heatmap pages</h3>
          <label class="switch"><input type="checkbox" id="heatAll"${heatAll ? ' checked' : ''}> Record every page</label>
          <div class="checks" id="heatPages"${heatAll ? ' hidden' : ''}>${[...new Set(['/', ...d.pages])].map(p => `<label><input type="checkbox" value="${esc(p)}"${!heatAll && (d.heat_pages || []).includes(p) ? ' checked' : ''}> ${esc(pageName(p))}</label>`).join('')}</div>
          <div class="row"><button class="btn btn-ghost btn-sm" type="button" id="saveHeat"${heatAll ? ' hidden' : ''}>Save pages</button></div></section>
        <section class="card set"><h3>Data kept</h3>
          <p>Raw events are deleted after ${d.retentionDays} days by a daily job. Daily totals stay. Today’s daily code for counting visitors is deleted at midnight (${esc(d.tz)}).</p>
          <h3 style="margin-top:8px">Export</h3>
          <div class="row"><label class="pill-select"><span class="sr-only">Table</span><select id="exT"><option value="events">Events</option><option value="daily">Daily totals</option><option value="heat">Heatmap cells</option><option value="presence">Live presence</option></select></label>
          <button class="btn btn-ghost btn-sm" type="button" id="exGo">Download CSV</button></div><p>Uses the date range at the top.</p></section>
        <section class="card set"><h3>Delete a visitor</h3>
          <p>Removes every event, live record and linked email for one browser ID. This can't be undone.</p>
          <form class="row" id="delForm"><input class="ad-input" name="id" placeholder="Browser ID" aria-label="Browser ID" pattern="[a-z0-9]{12,40}" required><button class="btn btn-ghost btn-sm" type="submit">Delete</button></form>
          <p class="form-note" id="delNote" role="status"></p></section>
      </div>`;
    const save = async body => { if (state.sample) { alert('Sample data is on, so nothing is saved.'); return; } await api('settings', {}, body); route(); };
    $('#sw').addEventListener('change', e => { state.sample = e.target.checked; LS.set('rr-a-sample', state.sample ? '1' : null); shell(); location.hash = '#/settings'; });
    const ca = $('#countAgain'); if (ca) ca.addEventListener('click', () => { LS.set('rr-staff', null); route(); });
    const sc = $('#stopCount'); if (sc) sc.addEventListener('click', () => { LS.set('rr-staff', '1'); route(); });
    $('#addMine').addEventListener('click', () => save({ addIp: 'mine', label: 'Added from Settings' }));
    $$('[data-rm]').forEach(b => b.addEventListener('click', () => save({ removeIp: b.dataset.rm })));
    $('#ipForm').addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.target); if (f.get('ip')) save({ addIp: f.get('ip'), label: f.get('label') }); });
    $('#copySnip').addEventListener('click', e => { navigator.clipboard && navigator.clipboard.writeText($('#snip').textContent); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1400); });
    $('#heatAll').addEventListener('change', e => { if (e.target.checked) save({ heat_pages: 'all' }); else { $('#heatPages').hidden = false; $('#saveHeat').hidden = false; } });
    $('#saveHeat').addEventListener('click', () => save({ heat_pages: $$('#heatPages input:checked').map(i => i.value) }));
    $('#exGo').addEventListener('click', () => {
      if (state.sample) { alert('Sample data is on. Turn it off to export real data.'); return; }
      location.href = '/api/analytics/export?' + new URLSearchParams({ ...rangeParams(), table: $('#exT').value });
    });
    $('#delForm').addEventListener('submit', async e => {
      e.preventDefault(); const id = new FormData(e.target).get('id').trim();
      if (!confirm(`Delete everything recorded for browser ${id}? This can't be undone.`)) return;
      await save({ deleteVisitor: id }); const n = $('#delNote'); if (n) n.textContent = 'Deleted.';
    });
  };

  /* ---------- sample data: made up on the fly, never saved ---------- */
  const Sample = (() => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pick = (list) => { const t = list.reduce((a, x) => a + x[1], 0); let r = rnd() * t; for (const x of list) { if ((r -= x[1]) <= 0) return x[0]; } return list[0][0]; };
    const PAGES = [['/', 46], ['/episode-1.html', 22], ['/store.html', 16], ['/episode-2.html', 12], ['/404.html', 1]];
    const SOURCES = [['Direct', 30], ['Instagram', 18], ['Google', 14], ['newsletter', 10], ['YouTube', 8], ['TikTok', 7], ['Facebook', 5], ['LinkedIn', 4], ['ChatGPT', 2], ['Bluesky', 2]];
    const COUNTRIES = [['US', 74], ['CA', 8], ['GB', 5], ['AU', 3], ['DE', 2], ['IE', 2], ['NL', 1], ['MX', 1], ['IN', 1]];
    const DEVICES = [['phone', 61], ['desktop', 33], ['tablet', 6]];
    const ACTIONS = [['Played video', 40], ['Outbound link', 22], ['Newsletter signup', 9], ['Added to bag', 8], ['Email click', 6], ['Started checkout', 4], ['Order placed', 2], ['Form submitted', 9]];
    const CITIES = { US: [['Boston', 'MA', 42.36, -71.06], ['New York', 'NY', 40.7, -74], ['Austin', 'TX', 30.3, -97.7], ['Los Angeles', 'CA', 34.05, -118.24], ['Chicago', 'IL', 41.9, -87.6], ['Portland', 'OR', 45.5, -122.7]], CA: [['Toronto', 'ON', 43.7, -79.4]], GB: [['London', 'ENG', 51.5, -.1]], AU: [['Sydney', 'NSW', -33.9, 151.2]], DE: [['Berlin', 'BE', 52.5, 13.4]], IE: [['Dublin', 'L', 53.3, -6.3]], NL: [['Amsterdam', 'NH', 52.4, 4.9]], MX: [['Mexico City', 'CMX', 19.4, -99.1]], IN: [['Mumbai', 'MH', 19.1, 72.9]] };
    const spanDays = () => ({ '24h': 1, '7d': 7, '30d': 30, '90d': 90, '12m': 365 })[state.range] || Math.max(1, Math.round((new Date(state.to) - new Date(state.from)) / 864e5) + 1);
    const top = (list, total, n = 8) => list.map(([k, w]) => ({ k, n: Math.round(total * w / list.reduce((a, x) => a + x[1], 0) * (.85 + rnd() * .3)) })).filter(r => r.n > 0).sort((a, b) => b.n - a.n).slice(0, n);
    const totals = f => { const days = spanDays(), visits = Math.round(days * 128 * f), views = Math.round(visits * 2.3), r = .24 + rnd() * .06;
      return { visitors: Math.round(visits * .82), views, visits, bounceRate: .41 + rnd() * .08, avgVisitMs: 96000 + rnd() * 40000, pagesPerVisit: views / visits, returning: Math.round(visits * r), new: Math.round(visits * (1 - r)), returningShare: r, actions: Math.round(visits * .62), actionRate: .27 + rnd() * .05, formRate: .012 + rnd() * .012, avgScroll: .44 + rnd() * .14 }; };
    const series = () => { const hourly = state.range === '24h' || (state.range === 'custom' && spanDays() <= 2); const n = hourly ? 24 : spanDays(); const now = Date.now();
      return Array.from({ length: n }, (_, i) => { const t = new Date(now - (n - 1 - i) * (hourly ? 36e5 : 864e5)); const h = t.getHours(), dow = t.getDay();
        const base = hourly ? (h > 7 && h < 23 ? 9 + 6 * Math.sin((h - 7) / 16 * Math.PI) : 2) : 120 * (dow === 0 || dow === 6 ? .8 : 1) * (1 + i / n * .4);
        const v = Math.max(0, Math.round(base * (.8 + rnd() * .4))); return { t: hourly ? t.toISOString().slice(0, 13) + ':00' : t.toISOString().slice(0, 10), visitors: v, views: Math.round(v * (2.1 + rnd() * .6)) }; }); };
    const log = (start) => { const out = []; let t = +start; const n = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) { const p = pick(PAGES.slice(0, 4)); const a = 15000 + rnd() * 140000; out.push({ kind: 'view', path: p, at: new Date(t).toISOString(), active: i === n - 1 ? 0 : a, scroll: i === n - 1 ? 0 : 20 + Math.round(rnd() * 80) });
        if (rnd() < .4) out.push({ kind: 'action', name: pick(ACTIONS), label: '', path: p, at: new Date(t + a / 2).toISOString() }); t += a; }
      return out; };
    const person = (liveNow, i) => { const c = pick(COUNTRIES), city = (CITIES[c] || CITIES.US)[Math.floor(rnd() * (CITIES[c] || CITIES.US).length)];
      const on = 60 + rnd() * 900, start = Date.now() - on * 1000, l = log(start), hasId = rnd() < .8;
      return { key: 's' + i, visit_id: 'v' + i, browser_id: hasId ? 'sample' + String(1e9 + Math.floor(rnd() * 8e9)) : null, email: hasId && rnd() < .2 ? ['jules@example.com', 'sam@example.com', 'dana@example.com'][i % 3] : null,
        path: l.filter(x => x.kind === 'view').pop().path, on_site: Math.round(on), source: pick(SOURCES), device: pick(DEVICES), country: c, city: city[0], region: city[1], lat: city[2] + (rnd() - .5), lon: city[3] + (rnd() - .5),
        last_seen: new Date(Date.now() - (liveNow ? rnd() * 40000 : 120000 + rnd() * 1.5e6)).toISOString(), left_at: liveNow ? null : new Date(Date.now() - 120000 - rnd() * 1.5e6).toISOString(), log: l }; };
    const reset = () => { seed = 7 + state.range.length * 31 + (state.from || '').length; };
    return {
      overview() { reset(); const cur = totals(1), prev = totals(.88); const v = cur.views;
        const sr = series(); return { cur, prev, hourly: sr[0] && sr[0].t.length > 10, series: sr, pages: top(PAGES, v).map(r => ({ ...r, u: Math.round(r.n * .7) })), sources: top(SOURCES, cur.visits), campaigns: [{ k: 'ep1-launch', n: Math.round(cur.visits * .07) }, { k: 'fall-newsletter', n: Math.round(cur.visits * .05) }, { k: 'merch-drop', n: Math.round(cur.visits * .03) }],
          devices: top(DEVICES, cur.visits), countries: top(COUNTRIES, cur.visits), actions: top(ACTIONS, cur.actions).map(r => ({ ...r, u: Math.round(r.n * .8) })) }; },
      pages() { reset(); const t = totals(1);
        const table = PAGES.map(([p, w]) => { const views = Math.round(t.views * w / 97), entries = Math.round(t.visits * w / 97 * (p === '/' ? 1.4 : .8));
          return { path: p, views, visitors: Math.round(views * .72), avg_active: p === '/404.html' ? 8000 : 40000 + rnd() * 90000, avg_scroll: 35 + rnd() * 50, entries, bounces: Math.round(entries * (.3 + rnd() * .25)), exits: Math.round(views * (.3 + rnd() * .3)) }; });
        const heat = []; for (let d = 1; d <= 7; d++) for (let h = 0; h < 24; h++) heat.push({ d, h, n: Math.round((h > 7 && h < 24 ? 10 + 18 * Math.sin((h - 7) / 17 * Math.PI) : 2) * (d > 5 ? 1.2 : 1) * (.7 + rnd() * .6)) });
        return { table, heat }; },
      audience() { reset(); const t = totals(1), v = t.visits;
        return { sources: top(SOURCES, v, 12), referrers: [{ k: 'instagram.com', n: Math.round(v * .17) }, { k: 'google.com', n: Math.round(v * .13) }, { k: 'youtube.com', n: Math.round(v * .08) }, { k: 'tiktok.com', n: Math.round(v * .06) }, { k: 'linkedin.com', n: Math.round(v * .04) }, { k: 'chatgpt.com', n: Math.round(v * .02) }],
          campaigns: [{ k: 'ep1-launch', s: 'instagram', m: 'social', n: Math.round(v * .07) }, { k: 'fall-newsletter', s: 'newsletter', m: 'email', n: Math.round(v * .05) }, { k: 'merch-drop', s: 'tiktok', m: 'social', n: Math.round(v * .03) }],
          devices: top(DEVICES, v), browsers: top([['Safari', 44], ['Chrome', 38], ['Edge', 6], ['Firefox', 4], ['Samsung Internet', 4], ['Other', 2]], v), oses: top([['iOS', 46], ['Android', 16], ['macOS', 20], ['Windows', 15], ['Other', 3]], v),
          languages: top([['en', 92], ['es', 4], ['fr', 2], ['de', 2]], v), countries: top(COUNTRIES, v, 12), regions: [['US / MA', 30], ['US / NY', 12], ['US / CA', 10], ['US / TX', 7], ['CA / ON', 5], ['US / IL', 4], ['GB / ENG', 4]].map(([k, w]) => ({ k, n: Math.round(v * w / 100) })) }; },
      actions() { reset(); const t = totals(1), s = series();
        const list = ACTIONS.map(([name, w]) => { const n = Math.round(t.actions * w / 100); return { name, n, u: Math.round(n * .8), visits: Math.round(n * .85) }; });
        return { list, prev: list.map(r => ({ name: r.name, n: Math.round(r.n * (.7 + rnd() * .5)) })), trend: list.flatMap(r => s.map(p => ({ name: r.name, t: p.t.length === 10 ? p.t + 'T00:00' : p.t, n: Math.round(r.n / s.length * (.5 + rnd())) }))),
          where: list.flatMap(r => [{ name: r.name, path: r.name.includes('bag') || r.name.includes('checkout') || r.name.includes('Order') ? '/store.html' : '/', n: Math.round(r.n * .6) }, { name: r.name, path: '/episode-1.html', n: Math.round(r.n * .3) }]) }; },
      'action-visits'(p) { reset(); return Array.from({ length: 14 }, (_, i) => { const x = person(false, i); return { visit_id: 'v' + i, started: new Date(Date.now() - rnd() * spanDays() * 864e5).toISOString(), landing: pick(PAGES), source: x.source, device: x.device, country: x.country, views: 1 + Math.floor(rnd() * 5), active: 20000 + rnd() * 300000, browser_id: x.browser_id, email: x.email, labels: [p.name === 'Played video' ? 'Episode 1: Cheryl Katon' : p.name === 'Added to bag' ? 'Rabble Sweatshirt (Unisex)' : ''] }; }); },
      live() { reset(); seed += Math.floor(Date.now() / 12000) % 50; const n = 3 + Math.floor(rnd() * 5); return { live: Array.from({ length: n }, (_, i) => person(true, i)), left: Array.from({ length: 4 }, (_, i) => person(false, i + 20)) }; },
      visitors() { reset(); return { page: 0, rows: Array.from({ length: 18 }, (_, i) => { const p = person(false, i); const visits = 2 + Math.floor(rnd() * 9); return { browser_id: p.browser_id || 'sample' + (1e9 + i), email: p.email, visits, pages: visits * 2 + Math.floor(rnd() * 8), actions: Math.floor(rnd() * 6), first_seen: new Date(Date.now() - (30 + rnd() * 200) * 864e5).toISOString(), last_seen: new Date(Date.now() - rnd() * 6 * 864e5).toISOString(), top_pages: ['/', '/episode-1.html', '/store.html'].slice(0, 1 + Math.floor(rnd() * 3)), top_actions: rnd() < .6 ? ['Played video'] : [] }; }) }; },
      visitor(p) { reset(); const x = person(true, 1); const visits = Array.from({ length: 4 }, (_, i) => { const start = Date.now() - (i * 9 + 1) * 864e5 - rnd() * 864e5; const l = log(start); return { visit_id: 'v' + i, started: new Date(start).toISOString(), source: i === 3 ? 'Instagram' : pick(SOURCES), device: x.device, country: x.country, city: x.city, active: l.reduce((a, y) => a + (y.active || 0), 0), log: l }; });
        return { browser_id: p.id, email: x.email, firstSource: 'Instagram', visits, live: rnd() < .5 ? { path: x.path, since: new Date().toISOString(), log: x.log } : null,
          totals: { visits: 4, pages: visits.reduce((a, v) => a + v.log.filter(y => y.kind === 'view').length, 0), actions: visits.reduce((a, v) => a + v.log.filter(y => y.kind === 'action').length, 0), active: visits.reduce((a, v) => a + v.active, 0), first: visits[3].started, last: visits[0].started } }; },
      heat(p) { reset(); const dev = p.device, cells = [], W = WIDTHS[dev][0];
        const spots = dev === 'phone' ? [[20, 30, 60], [20, 75, 40], [20, 160, 30], [30, 6, 25], [10, 240, 20]] : [[8, 32, 60], [12, 32, 35], [30, 3, 30], [20, 70, 45], [24, 140, 25], [16, 210, 20]];
        spots.forEach(([cx, cy, n]) => { for (let i = 0; i < n * 3; i++) cells.push({ kind: 'click', cx: Math.max(0, Math.min(39, Math.round(cx + (rnd() - .5) * 8))), cy: Math.max(0, Math.round(cy + (rnd() - .5) * 8)), n: 1 + Math.floor(rnd() * 4) }); });
        if (dev === 'desktop') for (let i = 0; i < 600; i++) cells.push({ kind: 'move', cx: Math.floor(rnd() * 40), cy: Math.floor(Math.pow(rnd(), 1.6) * 260), n: 1 + Math.floor(rnd() * 6) });
        for (let d = 10; d <= 100; d += 5) cells.push({ kind: 'scroll', cx: 0, cy: d, n: Math.round(60 * Math.exp(-d / 45) + 4) });
        return { page: p.page, device: dev, views: 340, pages: PAGES.map(([pg]) => ({ page: pg, n: 10 })), cells, elements: [{ sel: 'button.ep-media', n: 120 }, { sel: 'a.btn', n: 88 }, { sel: 'button.menu-btn', n: 61 }, { sel: 'a.chip', n: 40 }, { sel: 'a.plat', n: 33 }] }; },
      subscribers() { reset(); const s = series().map(p => ({ t: p.t, signups: Math.round(p.visitors * (.012 + rnd() * .02)) })); const now = s.reduce((a, p) => a + p.signups, 0);
        const names = ['jules', 'sam.r', 'dana.k', 'mo', 'priya', 'alex.t', 'casey', 'river', 'nico', 'jo.m', 'tasha', 'ben'], hosts = ['gmail.com', 'outlook.com', 'icloud.com', 'yahoo.com', 'proton.me'];
        const rows = Array.from({ length: 40 }, (_, i) => { const c = pick(COUNTRIES), city = (CITIES[c] || CITIES.US)[0]; return { email: names[i % names.length] + (i > 11 ? i : '') + '@' + hosts[i % hosts.length], source: pick([['join-home', 40], ['ep-notify', 25], ['join-episode-1', 20], ['join-store', 10], ['mailchimp import', 5]]), page: pick(PAGES.slice(0, 4)), status: rnd() < .93 ? 'subscribed' : rnd() < .5 ? 'pending' : 'not_sent', mailchimp: 'new via api', browser_id: rnd() < .6 ? 'sample' + (1e9 + i) : null, country: c, region: city[1], city: city[0], signups: 1, created_at: new Date(Date.now() - i * 1.7 * 864e5 * rnd()).toISOString() }; });
        return { visits: Math.round(spanDays() * 128), total: 1240 + now, now, prev: Math.round(now * .82), notSent: rows.filter(r => r.status === 'not_sent').length, pending: rows.filter(r => r.status === 'pending').length, series: s, hourly: s[0] && s[0].t.length > 10,
          sources: [{ k: 'join-home', n: Math.round(now * .45) }, { k: 'ep-notify', n: Math.round(now * .27) }, { k: 'join-episode-1', n: Math.round(now * .18) }, { k: 'join-store', n: Math.round(now * .1) }], pages: [{ k: '/', n: Math.round(now * .5) }, { k: '/episode-1.html', n: Math.round(now * .3) }, { k: '/episode-2.html', n: Math.round(now * .12) }, { k: '/store.html', n: Math.round(now * .08) }], rows, page: 0 }; },
      settings() { return { excluded_ips: [{ ip: '203.0.113.7', label: 'Studio wifi', added: new Date().toISOString() }], heat_pages: 'all', filtered: { bot_ua: 412, no_js: 37, likely_bots: 58, excluded_ip: 96 },
        custom: [{ name: 'Played video', n: 380, last: new Date().toISOString() }, { name: 'Newsletter signup', n: 41, last: new Date(Date.now() - 36e5).toISOString() }, { name: 'Added to bag', n: 36, last: new Date(Date.now() - 72e5).toISOString() }],
        pages: PAGES.map(p => p[0]), myIp: '203.0.113.7', retentionDays: 400, tz: 'America/New_York' }; }
    };
  })();

  /* ---------- start ---------- */
  async function boot() {
    try { state.me = await fetch('/api/analytics/me', { credentials: 'same-origin' }).then(r => r.json()); }
    catch (_) { state.me = { staff: false, configured: true }; }
    if (state.me.staff || state.sample) shell(); else gate();
  }
  boot();
})();
