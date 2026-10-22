import { json, cors } from '../server/store.js';
import { subscribe } from '../server/newsletter.js';

export async function POST(request) {
  const h = cors(request, process.env);
  // temporary: probe which public Mailchimp endpoint answers (no real address is sent)
  if (new URL(request.url).searchParams.has('probe')) {
    const q = 'u=ce1b58add8c1efd13b6b9c915&id=b9fe5c7621';
    const urls = [
      `https://mc.us16.list-manage.com/subscribe/post-json?${q}&f_id=008ec2e1f0`,
      `https://mc.us16.list-manage.com/subscribe/post-json?${q}`,
      `https://rabbleandrouse.us16.list-manage.com/subscribe/post-json?${q}`,
      `https://us16.list-manage.com/subscribe/post-json?${q}`,
      `https://mc.us16.list-manage.com/subscribe/post?${q}`
    ];
    const out = [];
    for (const [i, u] of urls.entries()) {
      try { const r = await fetch(u + '&EMAIL=nobody%40invalid.invalid&c=rr', { redirect: 'manual' }); const t = await r.text(); out.push([i, r.status, (r.headers.get('content-type') || '').split(';')[0], /rr\(/.test(t), /"result"/.test(t), t.replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').slice(0, 90)]); }
      catch (e) { out.push([i, 'err', String(e).slice(0, 60)]); }
    }
    return json({ out }, 200, h);
  }
  try {
    const body = await request.json().catch(() => ({}));
    return json(await subscribe(process.env, body.email, body.source), 200, h);
  } catch (err) {
    const debug = new URL(request.url).searchParams.has('debug') ? { detail: err.detail || String(err.message) } : {};
    return json({ error: err.status && err.status < 500 ? err.message : 'Signups hit a snag. Try again in a minute.', ...debug }, err.status || 500, h);
  }
}
export const OPTIONS = request => new Response(null, { status: 204, headers: cors(request, process.env) });
