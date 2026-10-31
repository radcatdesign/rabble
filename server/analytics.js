/* First-party analytics: collection, presence, dashboard data and the daily job.
   Postgres through Neon (DATABASE_URL, added by Vercel's Neon integration). Tables create themselves.
   Env: DATABASE_URL, ANALYTICS_PASSWORD (staff sign-in), ANALYTICS_SECRET (optional, signs sessions),
        CRON_SECRET (Vercel cron), ANALYTICS_TZ (default America/New_York), ANALYTICS_ORIGINS (extra hosts, comma separated)
   Nothing here stores a raw IP or user agent, except IPs the team adds to its own exclusion list. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { storeInfo } from './store.js';
import { SUBSCRIBER_SCHEMA, saveSubscriber, subscribersData, subscribersCsv, subscribersAction } from './subscribers.js';

export const RETENTION_DAYS = 400;
const LIVE_SECONDS = 100;          // a heartbeat every 45 s, so two missed beats means gone
const VISIT_IDLE_MIN = 30;
const BOUNCE_MS = 10000;
const MAX_BODY = 16000;

/* ---------- database ---------- */
let query = null, ready = null;
export function useQuery(fn) { query = fn; ready = null; }   // tests plug in a local Postgres
async function db(env) {
  if (!query) {
    const url = dbUrl(env);
    if (!url) return null;
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    query = (text, params = []) => sql.query(text, params);
  }
  if (!ready) ready = migrate().catch(e => { ready = null; throw e; });
  await ready;
  return query;
}
const SCHEMA = [
  `create table if not exists analytics_events (
    id bigserial primary key, kind text not null, name text, label text, path text not null,
    visit_id text not null, view_id text, browser_id text, visitor_hash text not null,
    referrer_host text, source text, utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
    device text, browser text, os text, language text, country text, region text, city text,
    active_ms integer, scroll_pct smallint, is_returning boolean not null default false,
    created_at timestamptz not null default now())`,
  `create index if not exists analytics_events_created on analytics_events (created_at)`,
  `create index if not exists analytics_events_path on analytics_events (path, created_at)`,
  `create index if not exists analytics_events_visit on analytics_events (visit_id)`,
  `create index if not exists analytics_events_browser on analytics_events (browser_id) where browser_id is not null`,
  `create index if not exists analytics_events_kind on analytics_events (kind, created_at)`,
  `create table if not exists analytics_presence (
    key text primary key, visit_id text not null, browser_id text, path text, started_at timestamptz not null default now(),
    last_seen timestamptz not null default now(), left_at timestamptz, source text, device text,
    country text, region text, city text, lat real, lon real)`,
  `create table if not exists analytics_heat (
    page text not null, device text not null, kind text not null, cx smallint not null, cy integer not null,
    sel text not null default '', day date not null, count integer not null default 0,
    primary key (page, device, kind, cx, cy, sel, day))`,
  `create table if not exists analytics_daily (
    day date not null, path text not null, source text not null, views integer not null default 0, visits integer not null default 0,
    visitors integer not null default 0, bounces integer not null default 0, active_ms bigint not null default 0,
    primary key (day, path, source))`,
  `create table if not exists analytics_salts (day date primary key, salt text not null)`,
  `create table if not exists analytics_settings (key text primary key, value jsonb not null)`,
  `create table if not exists analytics_shots (page text not null, width integer not null, image text not null, captured_at timestamptz not null default now(), primary key (page, width))`,
  `create table if not exists analytics_people (browser_id text primary key, email text not null, linked_at timestamptz not null default now())`,
  `create table if not exists analytics_counters (day date not null, name text not null, count integer not null default 0, primary key (day, name))`
];
// Neon through Vercel can add a prefix (STORAGE_DATABASE_URL, NEON_POSTGRES_URL...), so look for any of them
export const dbUrl = env => env.DATABASE_URL || env.POSTGRES_URL || env.DATABASE_URL_UNPOOLED ||
  Object.keys(env).filter(k => /(^|_)(DATABASE_URL|POSTGRES_URL)$/.test(k)).sort().map(k => env[k]).find(v => /^postgres(ql)?:\/\//.test(v || '')) || '';
async function migrate() {
  for (const s of [...SCHEMA, ...SUBSCRIBER_SCHEMA]) await query(s);
  // one time: pages recorded before clean URLs (/episode-1.html) fold into their clean paths
  const done = await query(`select 1 from analytics_settings where key = 'clean_urls'`);
  if (!done.length) {
    await query(`update analytics_events set path = regexp_replace(path, '\\.html$', '') where path like '%.html'`);
    await query(`update analytics_presence set path = regexp_replace(path, '\\.html$', '') where path like '%.html'`);
    await query(`update subscribers set page = regexp_replace(page, '\\.html$', '') where page like '%.html'`);
    await query(`insert into analytics_heat (page, device, kind, cx, cy, sel, day, count)
                 select regexp_replace(page, '\\.html$', ''), device, kind, cx, cy, sel, day, count from analytics_heat where page like '%.html'
                 on conflict (page, device, kind, cx, cy, sel, day) do update set count = analytics_heat.count + excluded.count`);
    await query(`delete from analytics_heat where page like '%.html'`);
    await query(`insert into analytics_settings (key, value) values ('clean_urls', 'true'::jsonb) on conflict (key) do nothing`);
  }
}
export const ensure = env => db(env);

/* ---------- request helpers ---------- */
const tzOf = env => env.ANALYTICS_TZ || 'America/New_York';
export const ipOf = req => (req.headers.get('x-real-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const empty = (status = 204) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
const sha = s => createHash('sha256').update(s).digest('hex');

const hits = new Map();   // best effort, per server instance
function limited(key, max, windowMs) {
  const now = Date.now(), h = hits.get(key);
  if (!h || now - h.t > windowMs) { hits.set(key, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; }
  return ++h.n > max;
}
function sameSite(req, env) {
  const host = (req.headers.get('host') || '').toLowerCase();
  const from = req.headers.get('origin') || req.headers.get('referer') || '';
  let h = ''; try { h = new URL(from).host.toLowerCase(); } catch (_) { return false; }
  const extra = String(env.ANALYTICS_ORIGINS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  return h === host || extra.includes(h) || /(^|\.)rabbleandrouse\.com$/.test(h) || h === 'rabble-rouse.vercel.app';
}

const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|slack|skype|vkshare|redditbot|headless|phantom|puppeteer|playwright|selenium|webdriver|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|python|curl|wget|httpclient|axios|node-fetch|undici|go-http|java\/|okhttp|scrapy|preview|validator|feedfetcher|mediapartners|adsbot|apis-google|petalbot|yandex|baidu|semrush|ahrefs|mj12|dotbot|bytespider|gptbot|claudebot|perplexity|ccbot/i;
export const isBot = (ua, env) => !ua || ua.length < 20 || (BOT.test(ua) && !(env.ANALYTICS_ALLOW_HEADLESS === '1' && /HeadlessChrome|Playwright/i.test(ua) && !/bot|crawl|spider/i.test(ua)));
export function parseUA(ua) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /iPhone|iPod/.test(ua) ? 'iOS' : /iPad/.test(ua) ? 'iPadOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  return { browser, os };
}
const EU = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH'.split(' '));
function geo(req) {
  const h = k => { const v = req.headers.get(k); try { return v ? decodeURIComponent(v) : null; } catch (_) { return v; } };
  const lat = parseFloat(h('x-vercel-ip-latitude')), lon = parseFloat(h('x-vercel-ip-longitude'));
  return { country: clip(h('x-vercel-ip-country'), 2), region: clip(h('x-vercel-ip-country-region'), 40), city: clip(h('x-vercel-ip-city'), 80),
           lat: isFinite(lat) ? Math.round(lat * 10) / 10 : null, lon: isFinite(lon) ? Math.round(lon * 10) / 10 : null };
}

/* where a visit came from: campaign source, a ?ref= tag, a known site, any other site, or nothing */
const SOURCES = [[/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/duckduckgo\.com$/, 'DuckDuckGo'], [/(^|\.)yahoo\./, 'Yahoo'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.facebook\.com|l\.facebook\.com)$/, 'Facebook'], [/instagram\.com$/, 'Instagram'], [/^(t\.co|twitter\.com|x\.com)$/, 'X'],
  [/(linkedin\.com|lnkd\.in)$/, 'LinkedIn'], [/(youtube\.com|youtu\.be)$/, 'YouTube'], [/tiktok\.com$/, 'TikTok'], [/reddit\.com$/, 'Reddit'],
  [/threads\.(net|com)$/, 'Threads'], [/bsky\.app$/, 'Bluesky'], [/(chatgpt\.com|openai\.com)$/, 'ChatGPT'], [/perplexity\.ai$/, 'Perplexity'],
  [/claude\.ai$/, 'Claude'], [/gemini\.google\.com$/, 'Gemini'], [/spotify\.com$/, 'Spotify'], [/podcasts\.apple\.com$/, 'Apple Podcasts'], [/music\.amazon\./, 'Amazon Music'],
  [/(mail\.google\.com|outlook\.|mail\.yahoo|list-manage\.com|mailchimp)/, 'Email']];
export function sourceOf(ref, utm, tag) {
  if (utm && utm.source) return clip(utm.source, 60);
  if (tag) return clip(tag, 60);
  if (!ref) return 'Direct';
  const hit = SOURCES.find(([re]) => re.test(ref));
  return hit ? hit[1] : ref;
}

/* ---------- the daily salt: one random value per day, the old one deleted ---------- */
let saltCache = null;
async function salt(q, env) {
  const [{ day }] = await q(`select (now() at time zone $1)::date::text as day`, [tzOf(env)]);
  if (saltCache && saltCache.day === day) return saltCache.salt;
  await q(`insert into analytics_salts (day, salt) values ($1, $2) on conflict (day) do nothing`, [day, randomBytes(32).toString('hex')]);
  await q(`delete from analytics_salts where day < $1`, [day]);
  const [row] = await q(`select salt from analytics_salts where day = $1`, [day]);
  saltCache = { day, salt: row.salt };
  return row.salt;
}

/* ---------- settings ---------- */
const DEFAULTS = { excluded_ips: [], heat_pages: 'all', benchmarks: {} };
let settingsCache = null;
export async function settings(q, fresh = false) {
  if (!fresh && settingsCache && Date.now() - settingsCache.t < 60000) return settingsCache.v;
  const rows = await q(`select key, value from analytics_settings`);
  const v = { ...DEFAULTS };
  rows.forEach(r => { v[r.key] = r.value; });
  settingsCache = { t: Date.now(), v };
  return v;
}
async function saveSetting(q, key, value) {
  await q(`insert into analytics_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
  settingsCache = null;
}
// IPv4 matches exactly; IPv6 matches the whole /64
export const ipKey = ip => ip.includes(':') ? ip.toLowerCase().split(':').slice(0, 4).join(':') + '::/64' : ip;
async function bump(q, env, name) {
  await q(`insert into analytics_counters (day, name, count) values ((now() at time zone $1)::date, $2, 1)
           on conflict (day, name) do update set count = analytics_counters.count + 1`, [tzOf(env), name]).catch(() => {});
}

/* ---------- collection ---------- */
const ID = /^[a-z0-9]{12,40}$/;
// clean URLs: /episode-1.html and /episode-1 are the same page, stored as /episode-1
const cleanPath = p => { p = String(p || '/').split('?')[0].split('#')[0].slice(0, 300) || '/'; return p.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '') || '/'; };
const DEVICES = ['phone', 'tablet', 'desktop'];

export async function collect(req, env) {
  const q = await db(env);
  const gate = await gatekeep(req, env, q, 240);
  if (gate) return gate;
  let body;
  try { body = JSON.parse(await req.text()); } catch (_) { return empty(400); }
  const { ua, ip, events, base } = await context(req, env, q, body);
  if (!events) return empty();
  const rows = [], heat = [];
  for (const e of events.slice(0, 40)) {
    const kind = e.t;
    if (kind === 'heat') { heat.push(e); continue; }
    if (!['view', 'leave', 'action'].includes(kind)) continue;
    const ref = kind === 'view' ? clip(String(e.ref || '').toLowerCase().replace(/^www\./, ''), 120) || null : null;
    const utm = kind === 'view' && e.u && typeof e.u === 'object' ? e.u : {};
    rows.push([kind, kind === 'action' ? clip(e.n, 80) : null, kind === 'action' ? clip(e.lb, 160) : null, cleanPath(e.p), base.visit, ID.test(e.pv || '') ? e.pv : null,
      base.browser, base.hash, ref, kind === 'view' ? sourceOf(ref, utm, e.ref_tag) : null,
      clip(utm.source, 80), clip(utm.medium, 80), clip(utm.campaign, 120), clip(utm.term, 120), clip(utm.content, 120),
      base.device, base.ua.browser, base.ua.os, base.lang, base.geo.country, base.geo.region, base.geo.city,
      kind === 'leave' ? Math.max(0, Math.min(3.6e6, Math.round(+e.a || 0))) : null,
      kind === 'leave' ? Math.max(0, Math.min(100, Math.round(+e.s || 0))) : null, !!body.r && !!base.browser]);
  }
  if (rows.length) {
    const cols = 'kind,name,label,path,visit_id,view_id,browser_id,visitor_hash,referrer_host,source,utm_source,utm_medium,utm_campaign,utm_term,utm_content,device,browser,os,language,country,region,city,active_ms,scroll_pct,is_returning';
    const n = cols.split(',').length, params = [];
    const values = rows.map((r, i) => { params.push(...r); return '(' + r.map((_, j) => '$' + (i * n + j + 1)).join(',') + ')'; }).join(',');
    await q(`insert into analytics_events (${cols}) values ${values}`, params);
    // a page view also marks the person as here right now
    const view = rows.find(r => r[0] === 'view');
    if (view) await touchPresence(q, base, view[3], view[9]);
  }
  if (heat.length) await saveHeat(q, env, base, heat);
  return empty();
}

export async function presence(req, env) {
  const q = await db(env);
  const gate = await gatekeep(req, env, q, 120);
  if (gate) return gate;
  let body;
  try { body = JSON.parse(await req.text()); } catch (_) { return empty(400); }
  const { base } = await context(req, env, q, body);
  if (!base) return empty();
  const key = base.browser || base.visit;
  if (body.gone) await q(`update analytics_presence set left_at = now() where key = $1 and visit_id = $2`, [key, base.visit]);
  else await touchPresence(q, base, cleanPath(body.p), null);
  return empty();
}

async function touchPresence(q, base, path, source) {
  const key = base.browser || base.visit, g = base.geo;
  await q(`insert into analytics_presence (key, visit_id, browser_id, path, source, device, country, region, city, lat, lon)
           values ($1,$2,$3,$4,coalesce($5,'Direct'),$6,$7,$8,$9,$10,$11)
           on conflict (key) do update set path = excluded.path, last_seen = now(), left_at = null, device = excluded.device,
             started_at = case when analytics_presence.visit_id = excluded.visit_id then analytics_presence.started_at else now() end,
             source = case when analytics_presence.visit_id = excluded.visit_id or $5 is null then coalesce(analytics_presence.source, excluded.source) else excluded.source end,
             visit_id = excluded.visit_id, country = excluded.country, region = excluded.region, city = excluded.city, lat = excluded.lat, lon = excluded.lon`,
    [key, base.visit, base.browser, path, source, base.device, g.country, g.region, g.city, g.lat, g.lon]);
}

async function saveHeat(q, env, base, batches) {
  const s = await settings(q);
  const cells = new Map();
  for (const b of batches) {
    const page = cleanPath(b.p);
    if (s.heat_pages !== 'all' && !(Array.isArray(s.heat_pages) && s.heat_pages.includes(page))) continue;
    for (const c of (Array.isArray(b.c) ? b.c : []).slice(0, 600)) {
      const [k, cx, cy, n, sel] = c;
      if (!['click', 'move', 'scroll', 'el'].includes(k)) continue;
      if (k === 'move' && base.device !== 'desktop') continue;
      const x = Math.max(0, Math.min(39, k === 'scroll' || k === 'el' ? 0 : cx | 0)), y = Math.max(0, Math.min(k === 'scroll' ? 100 : 5000, cy | 0));
      const id = [page, k, x, y, k === 'el' ? clip(sel, 80) || '' : ''].join('\u0001');
      cells.set(id, (cells.get(id) || 0) + Math.max(1, Math.min(500, n | 0)));
    }
  }
  if (!cells.size) return;
  const params = [base.device, tzOf(env)], values = [];
  for (const [id, n] of [...cells].slice(0, 800)) {
    const [page, k, x, y, sel] = id.split('\u0001');
    params.push(page, k, +x, +y, sel, n);
    const i = params.length;
    values.push(`($${i - 5}, $1, $${i - 4}, $${i - 3}, $${i - 2}, $${i - 1}, (now() at time zone $2)::date, $${i})`);
  }
  await q(`insert into analytics_heat (page, device, kind, cx, cy, sel, day, count) values ${values.join(',')}
           on conflict (page, device, kind, cx, cy, sel, day) do update set count = analytics_heat.count + excluded.count`, params);
}

// shared checks for both public endpoints
async function gatekeep(req, env, q, perMinute) {
  if (!q) return empty();                                    // no database yet: accept and drop
  if (+(req.headers.get('content-length') || 0) > MAX_BODY) return empty(413);
  if (!sameSite(req, env)) return empty(403);
  const ip = ipOf(req);
  if (limited('c:' + ip, perMinute, 60000)) return empty(429);
  const ua = req.headers.get('user-agent') || '';
  if (isBot(ua, env)) { await bump(q, env, 'bot_ua'); return empty(); }
  const s = await settings(q);
  if (ip && (s.excluded_ips || []).some(x => x.ip === ipKey(ip))) { await bump(q, env, 'excluded_ip'); return empty(); }
  return null;
}
async function context(req, env, q, body) {
  if (!body || typeof body !== 'object' || !ID.test(body.v || '')) return {};
  // no time zone or screen width means no JavaScript ran: not a person
  if (!body.z || !(+body.w > 0)) { await bump(q, env, 'no_js'); return {}; }
  const ua = req.headers.get('user-agent') || '', ip = ipOf(req), g = geo(req);
  const gpc = req.headers.get('sec-gpc') === '1' || req.headers.get('dnt') === '1';
  const browser = !gpc && !EU.has(g.country || '') && ID.test(body.b || '') ? body.b : null;
  const hash = sha((await salt(q, env)) + '|' + ip + '|' + ua).slice(0, 32);
  const base = { visit: body.v, browser, hash, geo: g, ua: parseUA(ua), lang: clip(body.l, 16), device: DEVICES.includes(body.d) ? body.d : 'desktop' };
  return { ua, ip, base, events: Array.isArray(body.e) ? body.e : null };
}

/* ---------- staff sign-in ---------- */
const COOKIE = 'rr_staff';
const secretOf = env => env.ANALYTICS_SECRET || (env.ANALYTICS_PASSWORD ? sha('rr-analytics|' + env.ANALYTICS_PASSWORD) : '');
const sign = (env, exp) => createHmac('sha256', secretOf(env)).update(String(exp)).digest('hex');
export function isStaff(req, env) {
  if (!secretOf(env)) return false;
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)rr_staff=(\d+)\.([a-f0-9]{64})/);
  if (!m || +m[1] < Date.now()) return false;
  const a = Buffer.from(m[2]), b = Buffer.from(sign(env, m[1]));
  return a.length === b.length && timingSafeEqual(a, b);
}
async function login(req, env) {
  if (!env.ANALYTICS_PASSWORD) return json({ error: 'Set ANALYTICS_PASSWORD in your hosting settings first.' }, 503);
  const ip = ipOf(req);
  if (limited('l:' + ip, 8, 15 * 60000)) return json({ error: 'Too many tries. Wait 15 minutes.' }, 429);
  const { password } = await req.json().catch(() => ({}));
  const a = Buffer.from(sha(String(password || ''))), b = Buffer.from(sha(env.ANALYTICS_PASSWORD));
  if (!timingSafeEqual(a, b)) { await new Promise(r => setTimeout(r, 600)); return json({ error: "That passcode didn't match." }, 401); }
  const exp = Date.now() + 30 * 864e5;
  return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=${exp}.${sign(env, exp)}; Path=/api/analytics; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 86400}` });
}

/* ---------- dashboard data ---------- */
async function bounds(q, env, url) {
  const tz = tzOf(env), r = url.searchParams.get('range') || '7d';
  const days = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 }[r];
  let from, to, hourly = false;
  if (r === '24h') { [{ from, to }] = await q(`select now() - interval '24 hours' as from, now() as to`); hourly = true; }
  else if (r === 'custom') {
    const a = url.searchParams.get('from'), b = url.searchParams.get('to');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b || '')) throw Object.assign(new Error('Pick two dates.'), { status: 400 });
    [{ from, to }] = await q(`select greatest(least($1::date, $2::date)::timestamp at time zone $3, now() - interval '${RETENTION_DAYS} days') as from,
                                    least((greatest($1::date, $2::date) + 1)::timestamp at time zone $3, now()) as to`, [a, b, tz]);
    hourly = (new Date(to) - new Date(from)) <= 2 * 864e5 + 1;
  } else {
    [{ from, to }] = await q(`select ((now() at time zone $1)::date - ${(days || 7) - 1})::timestamp at time zone $1 as from, now() as to`, [tz]);
  }
  const span = new Date(to) - new Date(from);
  return { from: new Date(from), to: new Date(to), prevFrom: new Date(new Date(from) - span), prevTo: new Date(from), hourly, tz, range: r };
}

// visits in a window, with the bot-like ones left out (no leave beacon, no action, and over 30 minutes old)
const VISITS = (a, b) => `
  ev as (select * from analytics_events where created_at >= ${a} and created_at < ${b}),
  vs as (
    select visit_id,
      min(created_at) as started, max(created_at) as last,
      count(*) filter (where kind = 'view') as views,
      count(*) filter (where kind = 'action') as actions,
      count(*) filter (where kind = 'action' and name in ('Newsletter signup', 'Form submitted')) as forms,
      coalesce(sum(active_ms) filter (where kind = 'leave'), 0) as active,
      bool_or(kind in ('leave', 'action')) as engaged,
      (array_agg(path order by created_at) filter (where kind = 'view'))[1] as landing,
      (array_agg(path order by created_at desc) filter (where kind = 'view'))[1] as exit_page,
      (array_agg(source order by created_at) filter (where kind = 'view'))[1] as source,
      (array_agg(referrer_host order by created_at) filter (where kind = 'view'))[1] as referrer,
      (array_agg(utm_campaign order by created_at) filter (where kind = 'view'))[1] as campaign,
      (array_agg(utm_medium order by created_at) filter (where kind = 'view'))[1] as medium,
      (array_agg(device order by created_at) filter (where kind = 'view'))[1] as device,
      (array_agg(browser order by created_at) filter (where kind = 'view'))[1] as browser,
      (array_agg(os order by created_at) filter (where kind = 'view'))[1] as os,
      (array_agg(language order by created_at) filter (where kind = 'view'))[1] as language,
      (array_agg(country order by created_at) filter (where kind = 'view'))[1] as country,
      (array_agg(region order by created_at) filter (where kind = 'view'))[1] as region,
      (array_agg(city order by created_at) filter (where kind = 'view'))[1] as city,
      bool_or(is_returning) filter (where kind = 'view') as ret,
      max(browser_id) as browser_id
    from ev group by visit_id),
  gv as (select *, (views <= 1 and actions = 0 and active < ${BOUNCE_MS}) as bounce from vs
         where views > 0 and (engaged or last > now() - interval '${VISIT_IDLE_MIN} minutes')),
  gev as (select ev.* from ev join gv using (visit_id))`;

async function totals(q, from, to) {
  const [t] = await q(`with ${VISITS('$1', '$2')}
    select (select count(distinct visitor_hash) from gev where kind = 'view')::int as visitors,
           (select count(*) from gev where kind = 'view')::int as views,
           (select count(*) from gv)::int as visits,
           (select count(*) filter (where bounce) from gv)::int as bounces,
           (select coalesce(sum(active), 0) from gv)::bigint as active,
           (select count(*) filter (where ret) from gv)::int as ret_visits,
           (select count(*) from gev where kind = 'action')::int as actions,
           (select count(*) filter (where actions > 0) from gv)::int as action_visits,
           (select count(*) filter (where forms > 0) from gv)::int as form_visits,
           (select avg(m) from (select max(scroll_pct) as m from gev where kind = 'leave' and view_id is not null group by view_id) x)::float as avg_scroll`, [from, to]);
  const n = x => +x || 0;
  return { visitors: n(t.visitors), views: n(t.views), visits: n(t.visits), bounceRate: t.visits ? n(t.bounces) / n(t.visits) : null,
           avgVisitMs: t.visits ? n(t.active) / n(t.visits) : null, pagesPerVisit: t.visits ? n(t.views) / n(t.visits) : null,
           returning: n(t.ret_visits), new: n(t.visits) - n(t.ret_visits), returningShare: t.visits ? n(t.ret_visits) / n(t.visits) : null,
           actions: n(t.actions), actionRate: t.visits ? n(t.action_visits) / n(t.visits) : null, formRate: t.visits ? n(t.form_visits) / n(t.visits) : null, avgScroll: t.avg_scroll == null ? null : t.avg_scroll / 100 };
}
const top = (q, sql, params) => q(sql, params).then(rows => rows.map(r => ({ ...r, n: +r.n, u: r.u == null ? undefined : +r.u })));

async function overview(q, B) {
  const [cur, prev] = await Promise.all([totals(q, B.from, B.to), totals(q, B.prevFrom, B.prevTo)]);
  const unit = B.hourly ? 'hour' : 'day';
  const P = [B.from, B.to];
  const [series, pages, sources, campaigns, devices, countries, actions] = await Promise.all([
    q(`with ${VISITS('$1', '$2')}, b as (select generate_series(date_trunc('${unit}', $1::timestamptz at time zone $3), date_trunc('${unit}', $2::timestamptz at time zone $3), interval '1 ${unit}') as t)
       select to_char(b.t, 'YYYY-MM-DD"T"HH24:MI') as t,
              (select count(*) from gev where kind = 'view' and date_trunc('${unit}', created_at at time zone $3) = b.t)::int as views,
              (select count(distinct visitor_hash) from gev where kind = 'view' and date_trunc('${unit}', created_at at time zone $3) = b.t)::int as visitors
       from b order by b.t`, [...P, B.tz]),
    top(q, `with ${VISITS('$1', '$2')} select path as k, count(*) as n, count(distinct visitor_hash) as u from gev where kind = 'view' group by path order by n desc limit 8`, P),
    top(q, `with ${VISITS('$1', '$2')} select coalesce(source, 'Direct') as k, count(*) as n from gv group by 1 order by n desc limit 8`, P),
    top(q, `with ${VISITS('$1', '$2')} select campaign as k, count(*) as n from gv where campaign is not null group by 1 order by n desc limit 8`, P),
    top(q, `with ${VISITS('$1', '$2')} select coalesce(device, 'desktop') as k, count(*) as n from gv group by 1 order by n desc`, P),
    top(q, `with ${VISITS('$1', '$2')} select coalesce(country, '??') as k, count(*) as n from gv group by 1 order by n desc limit 8`, P),
    top(q, `with ${VISITS('$1', '$2')} select name as k, count(*) as n, count(distinct visitor_hash) as u from gev where kind = 'action' group by name order by n desc limit 8`, P)
  ]);
  return { cur, prev, hourly: B.hourly, series, pages, sources, campaigns, devices, countries, actions };
}

async function pages(q, B) {
  const P = [B.from, B.to];
  const [table, heat] = await Promise.all([
    q(`with ${VISITS('$1', '$2')},
         pv as (select path, view_id, max(scroll_pct) as scroll, sum(active_ms) as active from gev where kind = 'leave' and view_id is not null group by path, view_id)
       select p.path, p.views::int, p.visitors::int,
              (select avg(active) from pv where pv.path = p.path)::float as avg_active,
              (select avg(scroll) from pv where pv.path = p.path)::float as avg_scroll,
              (select count(*) from gv where landing = p.path)::int as entries,
              (select count(*) filter (where bounce) from gv where landing = p.path)::int as bounces,
              (select count(*) from gv where exit_page = p.path)::int as exits
       from (select path, count(*) as views, count(distinct visitor_hash) as visitors from gev where kind = 'view' group by path) p
       order by p.views desc limit 500`, P),
    q(`with ${VISITS('$1', '$2')} select extract(isodow from created_at at time zone $3)::int as d, extract(hour from created_at at time zone $3)::int as h, count(*)::int as n
       from gev where kind = 'view' group by 1, 2`, [...P, B.tz])
  ]);
  return { table, heat };
}

async function audience(q, B) {
  const P = [B.from, B.to];
  const g = (col, extra = '') => top(q, `with ${VISITS('$1', '$2')} select ${col} as k, count(*) as n, count(distinct browser_id) as u from gv ${extra} group by 1 order by n desc limit 25`, P);
  const [sources, referrers, campaigns, devices, browsers, oses, languages, countries, regions] = await Promise.all([
    g(`coalesce(source, 'Direct')`), g('referrer', 'where referrer is not null'),
    top(q, `with ${VISITS('$1', '$2')} select coalesce(campaign, '(none)') as k, coalesce(source, 'Direct') as s, coalesce(medium, '') as m, count(*) as n from gv where campaign is not null group by 1, 2, 3 order by n desc limit 25`, P),
    g(`coalesce(device, 'desktop')`), g(`coalesce(browser, 'Other')`), g(`coalesce(os, 'Other')`), g(`coalesce(split_part(language, '-', 1), '??')`),
    g(`coalesce(country, '??')`), g(`coalesce(country, '??') || ' / ' || coalesce(region, '?')`)
  ]);
  return { sources, referrers, campaigns, devices, browsers, oses, languages, countries, regions };
}

async function actionsData(q, B) {
  const P = [B.from, B.to], unit = B.hourly ? 'hour' : 'day';
  const [list, prev, trend, where] = await Promise.all([
    q(`with ${VISITS('$1', '$2')} select name, count(*)::int as n, count(distinct visitor_hash)::int as u, count(distinct visit_id)::int as visits from gev where kind = 'action' group by name order by n desc`, P),
    q(`with ${VISITS('$1', '$2')} select name, count(*)::int as n from gev where kind = 'action' group by name`, [B.prevFrom, B.prevTo]),
    q(`with ${VISITS('$1', '$2')} select name, to_char(date_trunc('${unit}', created_at at time zone $3), 'YYYY-MM-DD"T"HH24:MI') as t, count(*)::int as n from gev where kind = 'action' group by 1, 2`, [...P, B.tz]),
    q(`with ${VISITS('$1', '$2')} select name, path, count(*)::int as n from gev where kind = 'action' group by 1, 2 order by n desc`, P)
  ]);
  return { list, prev, trend, where };
}

async function actionVisits(q, B, name) {
  return q(`with ${VISITS('$1', '$2')}
    select gv.visit_id, gv.started, gv.landing, gv.source, gv.device, gv.country, gv.views::int, gv.active::int, gv.browser_id, p.email,
           (select array_agg(coalesce(label, '') order by created_at) from gev e where e.visit_id = gv.visit_id and e.kind = 'action' and e.name = $3) as labels
    from gv left join analytics_people p on p.browser_id = gv.browser_id
    where exists (select 1 from gev e where e.visit_id = gv.visit_id and e.kind = 'action' and e.name = $3)
    order by gv.started desc limit 200`, [B.from, B.to, name]);
}

async function visitLogs(q, ids) {
  if (!ids.length) return {};
  const rows = await q(`select visit_id, kind, name, label, path, view_id, active_ms, scroll_pct, created_at from analytics_events
                        where visit_id = any($1) and kind <> 'presence' order by created_at limit 4000`, [ids]);
  const out = {};
  for (const r of rows) (out[r.visit_id] = out[r.visit_id] || []).push(r);
  for (const id in out) out[id] = foldLog(out[id]);
  return out;
}
// one line per page opened (with its active time and scroll), actions in between
function foldLog(rows) {
  const lines = [], byView = new Map();
  for (const r of rows) {
    if (r.kind === 'view') { const l = { kind: 'view', path: r.path, at: r.created_at, active: 0, scroll: 0 }; lines.push(l); if (r.view_id) byView.set(r.view_id, l); }
    else if (r.kind === 'leave') { const l = byView.get(r.view_id) || [...lines].reverse().find(x => x.kind === 'view' && x.path === r.path); if (l) { l.active += +r.active_ms || 0; l.scroll = Math.max(l.scroll, +r.scroll_pct || 0); } }
    else if (r.kind === 'action') lines.push({ kind: 'action', name: r.name, label: r.label, path: r.path, at: r.created_at });
  }
  return lines;
}

async function live(q) {
  const rows = await q(`select p.*, extract(epoch from now() - p.started_at)::int as on_site, (p.left_at is null and p.last_seen > now() - interval '${LIVE_SECONDS} seconds') as live, pe.email
                        from analytics_presence p left join analytics_people pe on pe.browser_id = p.browser_id
                        where coalesce(p.left_at, p.last_seen) > now() - interval '30 minutes' order by p.last_seen desc limit 300`);
  const logs = await visitLogs(q, rows.map(r => r.visit_id));
  rows.forEach(r => { r.log = logs[r.visit_id] || []; });
  return { live: rows.filter(r => r.live), left: rows.filter(r => !r.live) };
}

async function visitors(q, B, url) {
  const page = Math.max(0, +url.searchParams.get('page') || 0), search = clip(url.searchParams.get('q') || '', 80);
  const rows = await q(`
    with b as (select browser_id, count(distinct visit_id)::int as visits, min(created_at) as first_seen, max(created_at) as last_seen,
                      count(*) filter (where kind = 'view')::int as pages, count(*) filter (where kind = 'action')::int as actions
               from analytics_events where browser_id is not null group by browser_id
               having count(distinct visit_id) > 1 and max(created_at) >= $1 and min(created_at) < $2)
    select b.*, p.email,
      (select array_agg(path) from (select path from analytics_events e where e.browser_id = b.browser_id and kind = 'view' group by path order by count(*) desc limit 3) t) as top_pages,
      (select array_agg(name) from (select name from analytics_events e where e.browser_id = b.browser_id and kind = 'action' group by name order by count(*) desc limit 3) t) as top_actions
    from b left join analytics_people p using (browser_id)
    where $3 = '' or p.email ilike '%' || $3 || '%' or b.browser_id like $3 || '%'
    order by b.visits desc, b.last_seen desc limit 50 offset $4`, [B.from, B.to, search, page * 50]);
  return { rows, page };
}

async function visitor(q, bid) {
  const ev = await q(`select * from analytics_events where browser_id = $1 order by created_at limit 5000`, [bid]);
  const [person] = await q(`select email from analytics_people where browser_id = $1`, [bid]);
  const [pres] = await q(`select *, (left_at is null and last_seen > now() - interval '${LIVE_SECONDS} seconds') as live from analytics_presence where key = $1`, [bid]);
  const visits = new Map();
  for (const e of ev) { if (!visits.has(e.visit_id)) visits.set(e.visit_id, []); visits.get(e.visit_id).push(e); }
  const list = [...visits].map(([id, rows]) => {
    const first = rows.find(r => r.kind === 'view') || rows[0];
    return { visit_id: id, started: rows[0].created_at, source: first.source, device: first.device, country: first.country, city: first.city,
             active: rows.filter(r => r.kind === 'leave').reduce((a, r) => a + (+r.active_ms || 0), 0), log: foldLog(rows) };
  }).reverse();
  const firstView = ev.find(r => r.kind === 'view');
  return { browser_id: bid, email: person ? person.email : null, visits: list, firstSource: firstView ? firstView.source : null,
           totals: { visits: list.length, pages: ev.filter(r => r.kind === 'view').length, actions: ev.filter(r => r.kind === 'action').length,
                     active: list.reduce((a, v) => a + v.active, 0), first: ev[0] && ev[0].created_at, last: ev.length ? ev[ev.length - 1].created_at : null },
           live: pres && pres.live ? { path: pres.path, since: pres.started_at, log: (await visitLogs(q, [pres.visit_id]))[pres.visit_id] || [] } : null };
}

async function heatData(q, B, url) {
  const page = cleanPath(url.searchParams.get('page') || '/'), device = DEVICES.includes(url.searchParams.get('device')) ? url.searchParams.get('device') : 'desktop';
  const [pageList, cells, els, views] = await Promise.all([
    q(`select page, sum(count)::int as n from analytics_heat where day >= ($1::timestamptz at time zone $3)::date and day <= ($2::timestamptz at time zone $3)::date and kind = 'click' group by page order by n desc limit 100`, [B.from, B.to, B.tz]),
    q(`select kind, cx, cy, sum(count)::int as n from analytics_heat where page = $1 and device = $2 and kind in ('click', 'move', 'scroll')
       and day >= ($3::timestamptz at time zone $5)::date and day <= ($4::timestamptz at time zone $5)::date group by 1, 2, 3`, [page, device, B.from, B.to, B.tz]),
    q(`select sel, sum(count)::int as n from analytics_heat where page = $1 and device = $2 and kind = 'el'
       and day >= ($3::timestamptz at time zone $5)::date and day <= ($4::timestamptz at time zone $5)::date group by 1 order by n desc limit 15`, [page, device, B.from, B.to, B.tz]),
    q(`select count(*)::int as n from analytics_events where kind = 'view' and path = $1 and device = $2 and created_at >= $3 and created_at < $4`, [page, device, B.from, B.to])
  ]);
  return { page, device, pages: pageList, cells, elements: els, views: views[0].n };
}

async function settingsData(q, env, req) {
  const s = await settings(q, true);
  const [counts] = await q(`select
      coalesce((select sum(count) from analytics_counters where name = 'bot_ua' and day > now() - interval '30 days'), 0)::int as bot_ua,
      coalesce((select sum(count) from analytics_counters where name = 'no_js' and day > now() - interval '30 days'), 0)::int as no_js,
      coalesce((select sum(count) from analytics_counters where name = 'excluded_ip' and day > now() - interval '30 days'), 0)::int as excluded_ip`);
  const [likely] = await q(`with ${VISITS(`now() - interval '30 days'`, 'now()')} select count(*)::int as n from vs where views > 0 and not engaged and last <= now() - interval '${VISIT_IDLE_MIN} minutes'`);
  const custom = await q(`select name, count(*)::int as n, max(created_at) as last from analytics_events where kind = 'action'
                          and name not in ('Outbound link', 'Email click', 'Phone click', 'Download', 'Form submitted') group by name order by n desc limit 50`);
  const pagesSeen = await q(`select distinct path from analytics_events where kind = 'view' and created_at > now() - interval '90 days' order by path limit 200`);
  const ip = ipOf(req);
  return { ...s, filtered: { ...counts, likely_bots: likely.n }, custom, pages: pagesSeen.map(r => r.path), myIp: ip ? ipKey(ip) : null,
           retentionDays: RETENTION_DAYS, tz: tzOf(env) };
}

const CSV_TABLES = {
  events: ['analytics_events', 'created_at', 'id,kind,name,label,path,visit_id,view_id,browser_id,referrer_host,source,utm_source,utm_medium,utm_campaign,utm_term,utm_content,device,browser,os,language,country,region,city,active_ms,scroll_pct,is_returning,created_at'],
  daily: ['analytics_daily', 'day', 'day,path,source,views,visits,visitors,bounces,active_ms'],
  heat: ['analytics_heat', 'day', 'page,device,kind,cx,cy,sel,day,count'],
  presence: ['analytics_presence', 'last_seen', 'key,visit_id,browser_id,path,started_at,last_seen,left_at,source,device,country,region,city']
};
async function exportCsv(q, B, url) {
  const t = CSV_TABLES[url.searchParams.get('table')] || CSV_TABLES.events;
  const rows = await q(`select ${t[2]} from ${t[0]} where ${t[1]} >= $1 and ${t[1]} < $2 order by ${t[1]} limit 100000`, [B.from, B.to]);
  const cell = v => { if (v == null) return ''; const s = v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [t[2], ...rows.map(r => t[2].split(',').map(c => cell(r[c])).join(','))].join('\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="analytics-${t[0].replace('analytics_', '')}-${B.range}.csv"`, 'cache-control': 'no-store' } });
}

/* ---------- daily job: rotate the salt, roll up yesterday, clear stale presence, enforce retention ---------- */
export async function daily(q, env) {
  const tz = tzOf(env);
  await salt(q, env);
  await q(`delete from analytics_presence where coalesce(left_at, last_seen) < now() - interval '30 minutes'`);
  await q(`delete from analytics_daily where day = (now() at time zone $1)::date - 1`, [tz]);
  await q(`with ${VISITS(`(((now() at time zone '${tz.replace(/'/g, '')}')::date - 1)::timestamp at time zone '${tz.replace(/'/g, '')}')`, `(((now() at time zone '${tz.replace(/'/g, '')}')::date)::timestamp at time zone '${tz.replace(/'/g, '')}')`)}
    insert into analytics_daily (day, path, source, views, visits, visitors, bounces, active_ms)
    select (now() at time zone $1)::date - 1, p.path, p.source, p.views, coalesce(v.visits, 0), p.visitors, coalesce(v.bounces, 0), coalesce(v.active, 0)
    from (select e.path, coalesce(gv.source, 'Direct') as source, count(*)::int as views, count(distinct e.visitor_hash)::int as visitors
          from gev e join gv using (visit_id) where e.kind = 'view' group by 1, 2) p
    left join (select landing as path, coalesce(source, 'Direct') as source, count(*)::int as visits, count(*) filter (where bounce)::int as bounces, sum(active)::bigint as active
               from gv group by 1, 2) v on v.path = p.path and v.source = p.source`, [tz]);
  const [{ n }] = await q(`with d as (delete from analytics_events where created_at < now() - interval '${RETENTION_DAYS} days' returning 1) select count(*)::int as n from d`);
  await q(`delete from analytics_counters where day < now() - interval '${RETENTION_DAYS} days'`);
  await q(`update subscribers set ip_hash = null where ip_hash is not null and created_at < now() - interval '30 days'`).catch(() => {});
  await q(`delete from signup_blocks where created_at < now() - interval '90 days'`).catch(() => {});
  return { ok: true, deleted: n };
}

/* ---------- router ---------- */
export async function handle(req, env) {
  const url = new URL(req.url);
  const op = url.searchParams.get('op') || url.pathname.split('/').filter(Boolean).pop();
  try {
    if (req.method === 'POST' && op === 'collect') return await collect(req, env);
    if (req.method === 'POST' && op === 'presence') return await presence(req, env);
    if (op === 'cron') {
      if (!env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return json({ error: 'no' }, 401);
      const q = await db(env); if (!q) return json({ ok: false, error: 'no database' }, 503);
      return json(await daily(q, env));
    }
    if (op === 'login' && req.method === 'POST') return await login(req, env);
    if (op === 'logout') return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/api/analytics; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });

    // everything below is staff only
    if (op === 'me') return json({ staff: isStaff(req, env), configured: !!env.ANALYTICS_PASSWORD, database: !!(dbUrl(env) || query) });
    if (!isStaff(req, env)) return json({ error: 'Sign in first.' }, 401);
    if (req.method === 'POST' && req.headers.get('x-rr-staff') !== '1') return json({ error: 'Bad request.' }, 400);
    const q = await db(env);
    if (!q) return json({ error: 'No database yet. Add Neon Postgres in Vercel Storage, then redeploy.', nodb: true }, 503);
    const B = await bounds(q, env, url);
    switch (op) {
      case 'overview': return json(await overview(q, B));
      case 'pages': return json(await pages(q, B));
      case 'audience': return json(await audience(q, B));
      case 'actions': return json(await actionsData(q, B));
      case 'action-visits': return json(await actionVisits(q, B, clip(url.searchParams.get('name'), 80)));
      case 'live': return json(await live(q));
      case 'visitors': return json(await visitors(q, B, url));
      case 'visitor': return json(await visitor(q, clip(url.searchParams.get('id'), 40)));
      case 'heat': return json(await heatData(q, B, url));
      case 'export': return await exportCsv(q, B, url);
      case 'subscribers': {
        const done = req.method === 'POST' ? await subscribersAction(q, env, await req.json().catch(() => ({}))) : null;
        return json({ ...(await subscribersData(q, B, url)), done });
      }
      case 'subscribers-export': return await subscribersCsv(q);
      case 'merch': return json(await storeInfo(env));
      case 'settings':
        if (req.method === 'POST') {
          const body = await req.json().catch(() => ({}));
          if (body.heat_pages !== undefined) await saveSetting(q, 'heat_pages', body.heat_pages === 'all' ? 'all' : [].concat(body.heat_pages).map(cleanPath).slice(0, 100));
          if (body.addIp) {
            const s = await settings(q, true), ip = body.addIp === 'mine' ? ipKey(ipOf(req)) : ipKey(String(body.addIp).trim());
            if (ip && !s.excluded_ips.some(x => x.ip === ip)) await saveSetting(q, 'excluded_ips', [...s.excluded_ips, { ip, label: clip(body.label, 60) || '', added: new Date().toISOString() }]);
          }
          if (body.removeIp) { const s = await settings(q, true); await saveSetting(q, 'excluded_ips', s.excluded_ips.filter(x => x.ip !== body.removeIp)); }
          if (body.deleteVisitor && ID.test(body.deleteVisitor)) {
            const id = body.deleteVisitor;
            await q(`delete from analytics_events where browser_id = $1`, [id]);
            await q(`delete from analytics_presence where key = $1 or browser_id = $1`, [id]);
            await q(`delete from analytics_people where browser_id = $1`, [id]);
          }
        }
        return json(await settingsData(q, env, req));
      default: return json({ error: 'Unknown request.' }, 404);
    }
  } catch (err) {
    if (env.ANALYTICS_DEBUG === '1') console.error(op, err);
    if (op === 'collect' || op === 'presence') return empty();   // the tracker never sees an error
    return json({ error: err.status ? err.message : 'Something went wrong on our side.', detail: env.ANALYTICS_DEBUG === '1' ? String(err && err.stack) : undefined }, err.status || 500);
  }
}

/* newsletter signups link the email to this browser, when the browser has an ID (never under GPC, Do Not Track or EU rules) */
export async function linkEmail(env, req, browserId, email) {
  try {
    if (!ID.test(browserId || '') || !email) return;
    if (req.headers.get('sec-gpc') === '1' || req.headers.get('dnt') === '1' || EU.has(geo(req).country || '')) return;
    const q = await db(env); if (!q) return;
    await q(`insert into analytics_people (browser_id, email) values ($1, $2) on conflict (browser_id) do update set email = excluded.email, linked_at = now()`, [browserId, String(email).toLowerCase().slice(0, 254)]);
  } catch (_) {}
}

/* every newsletter signup lands in our own subscribers table; returns false if there's no database to save to */
export async function recordSignup(env, req, info) {
  try {
    const q = await db(env); if (!q) return false;
    const allowed = ID.test(info.browserId || '') && req.headers.get('sec-gpc') !== '1' && req.headers.get('dnt') !== '1' && !EU.has(geo(req).country || '');
    await saveSubscriber(q, req, { ...info, browserId: allowed ? info.browserId : null });
    return true;
  } catch (e) { if (env.ANALYTICS_DEBUG === '1') console.error('signup', e); return false; }
}

/* spam check for newsletter signups. Returns { block: reason } or { ipHash }.
   A scrambled IP (never the IP itself) caps signups per connection; it's cleared after 30 days by the daily job. */
export async function screenSignup(env, req, body) {
  const ua = req.headers.get('user-agent') || '', ip = ipOf(req);
  const ipHash = ip ? sha('rr-signup|' + (secretOf(env) || 'rr') + '|' + ip).slice(0, 32) : null;
  const domain = String(body.email || '').split('@')[1] || null;
  let reason = null;
  if (body.company) reason = 'hidden field filled';
  else if (!sameSite(req, env)) reason = 'not sent from the site';
  else if (isBot(ua, env)) reason = 'bot browser';
  else if (!(+body.t >= 2500)) reason = 'too fast';
  else if (ipHash && limited('s:' + ipHash, 3, 3600000)) reason = 'too many from one connection';
  let q = null;
  try { q = await db(env); } catch (_) {}
  if (!reason && q && ipHash) {
    const [r] = await q(`select count(*)::int as n from subscribers where ip_hash = $1 and created_at > now() - interval '24 hours'`, [ipHash]);
    if (r.n >= 3) reason = 'too many from one connection';
  }
  if (reason) {
    if (q) await q(`insert into signup_blocks (reason, ip_hash, email_domain) values ($1, $2, $3)`, [reason, ipHash, domain]).catch(() => {});
    return { block: reason };
  }
  return { ipHash };
}
