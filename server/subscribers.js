/* Our own copy of every newsletter signup, in the site's Postgres (the same Neon database as analytics).
   Mailchimp still sends the emails; this keeps the list in our hands, records where each signup came from,
   and catches people even when Mailchimp is having a bad day (they show as "Not sent yet" with a retry). */
import { subscribe } from './newsletter.js';

export const SUBSCRIBER_SCHEMA = [
  `create table if not exists subscribers (
    email text primary key, source text, page text, status text not null default 'subscribed', mailchimp text,
    browser_id text, country text, region text, city text, signups integer not null default 1,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create index if not exists subscribers_created on subscribers (created_at)`
];

const clip = (s, n) => (s == null || s === '' ? null : String(s).slice(0, n));
const header = (req, k) => { const v = req.headers.get(k); try { return v ? decodeURIComponent(v) : null; } catch (_) { return v; } };

// called by /api/subscribe for every signup, whatever Mailchimp said
export async function saveSubscriber(q, req, { email, source, browserId, mailchimp, status }) {
  let page = null;
  try { page = new URL(req.headers.get('referer') || '').pathname.replace(/\/index\.html$/, '/'); } catch (_) {}
  await q(`insert into subscribers (email, source, page, status, mailchimp, browser_id, country, region, city)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (email) do update set signups = subscribers.signups + 1, updated_at = now(),
             status = case when excluded.status = 'not_sent' and subscribers.status <> 'not_sent' then subscribers.status else excluded.status end,
             mailchimp = excluded.mailchimp, browser_id = coalesce(excluded.browser_id, subscribers.browser_id)`,
    [email, clip(source, 40), clip(page, 200), status, clip(mailchimp, 200), browserId, clip(header(req, 'x-vercel-ip-country'), 2), clip(header(req, 'x-vercel-ip-country-region'), 40), clip(header(req, 'x-vercel-ip-city'), 80)]);
}

export async function subscribersData(q, B, url) {
  const search = clip(url.searchParams.get('q'), 120) || '', page = Math.max(0, +url.searchParams.get('page') || 0);
  const unit = B.hourly ? 'hour' : 'day';
  const [[c], series, sources, pages, rows] = await Promise.all([
    q(`select count(*)::int as total,
              count(*) filter (where created_at >= $1 and created_at < $2)::int as now,
              count(*) filter (where created_at >= $3 and created_at < $1)::int as prev,
              count(*) filter (where status = 'not_sent')::int as not_sent,
              count(*) filter (where status = 'pending')::int as pending
       from subscribers`, [B.from, B.to, B.prevFrom]),
    q(`with b as (select generate_series(date_trunc('${unit}', $1::timestamptz at time zone $3), date_trunc('${unit}', $2::timestamptz at time zone $3), interval '1 ${unit}') as t)
       select to_char(b.t, 'YYYY-MM-DD"T"HH24:MI') as t, (select count(*) from subscribers where date_trunc('${unit}', created_at at time zone $3) = b.t)::int as signups from b order by b.t`, [B.from, B.to, B.tz]),
    q(`select coalesce(source, 'website') as k, count(*)::int as n from subscribers where created_at >= $1 and created_at < $2 group by 1 order by n desc limit 12`, [B.from, B.to]),
    q(`select coalesce(page, '/') as k, count(*)::int as n from subscribers where created_at >= $1 and created_at < $2 group by 1 order by n desc limit 12`, [B.from, B.to]),
    q(`select email, source, page, status, mailchimp, browser_id, country, region, city, signups, created_at from subscribers
       where $1 = '' or email ilike '%' || $1 || '%' order by created_at desc limit 100 offset $2`, [search, page * 100])
  ]);
  return { total: c.total, now: c.now, prev: c.prev, notSent: c.not_sent, pending: c.pending, series, sources, pages, rows, page, hourly: B.hourly };
}

export async function subscribersCsv(q) {
  const cols = 'email,status,source,page,country,region,city,signups,created_at,mailchimp';
  const rows = await q(`select ${cols} from subscribers order by created_at limit 200000`);
  const cell = v => { if (v == null) return ''; const s = v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return new Response([cols, ...rows.map(r => cols.split(',').map(k => cell(r[k])).join(','))].join('\n'),
    { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="rabble-subscribers.csv"', 'cache-control': 'no-store' } });
}

export async function subscribersAction(q, env, body) {
  if (body.delete) await q(`delete from subscribers where email = $1`, [String(body.delete).toLowerCase()]);
  if (body.retry) {
    // try Mailchimp again for one email, or for everyone still marked "Not sent yet"
    const list = body.retry === 'all' ? (await q(`select email, source from subscribers where status = 'not_sent' limit 200`)) : (await q(`select email, source from subscribers where email = $1`, [String(body.retry).toLowerCase()]));
    let ok = 0, failed = 0;
    for (const s of list) {
      try {
        const r = await subscribe(env, s.email, s.source || 'website');
        await q(`update subscribers set status = $2, mailchimp = $3, updated_at = now() where email = $1`, [s.email, String(env.MAILCHIMP_DOUBLE_OPTIN) === 'true' ? 'pending' : 'subscribed', r.status + ' via ' + r.via]);
        ok++;
      } catch (e) {
        await q(`update subscribers set mailchimp = $2, updated_at = now() where email = $1`, [s.email, 'failed: ' + String(e.message).slice(0, 160)]);
        failed++;
      }
    }
    return { ok, failed };
  }
  if (body.import) return importFromMailchimp(q, env);
  return {};
}

// bring the existing Mailchimp audience in (needs MAILCHIMP_API_KEY); people already here keep their source
async function importFromMailchimp(q, env) {
  const key = (env.MAILCHIMP_API_KEY || env.MAILCHIMP_KEY || env.MAILCHIMP_API || env.MC_API_KEY || '').trim();
  if (!key) return { error: 'Add MAILCHIMP_API_KEY in Vercel to import the existing list.' };
  const dc = key.split('-')[1], list = env.MAILCHIMP_LIST_ID || 'b9fe5c7621';
  let offset = 0, added = 0, seen = 0;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${list}/members?count=1000&offset=${offset}&fields=members.email_address,members.status,members.timestamp_opt,members.timestamp_signup,members.location.country_code,total_items`,
      { headers: { authorization: 'Basic ' + btoa('rr:' + key) } });
    if (!res.ok) return { error: `Mailchimp said ${res.status}. Check the API key.`, added, seen };
    const d = await res.json();
    for (const m of d.members || []) {
      seen++;
      const when = m.timestamp_signup || m.timestamp_opt || null;
      const status = m.status === 'subscribed' ? 'subscribed' : m.status === 'pending' ? 'pending' : m.status === 'unsubscribed' ? 'unsubscribed' : m.status;
      const r = await q(`insert into subscribers (email, source, status, mailchimp, country, created_at)
                         values ($1, 'mailchimp import', $2, 'imported', $3, coalesce($4::timestamptz, now()))
                         on conflict (email) do update set status = excluded.status, updated_at = now() returning (xmax = 0) as inserted`,
        [String(m.email_address).toLowerCase(), status, m.location && m.location.country_code || null, when]);
      if (r[0] && r[0].inserted) added++;
    }
    offset += 1000;
    if (offset >= (d.total_items || 0)) break;
  }
  return { added, seen };
}
