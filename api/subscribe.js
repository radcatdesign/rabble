import { json, cors } from '../server/store.js';
import { subscribe } from '../server/newsletter.js';

export async function POST(request) {
  const h = cors(request, process.env);
  try {
    const body = await request.json().catch(() => ({}));
    return json(await subscribe(process.env, body.email, body.source), 200, h);
  } catch (err) {
    const debug = new URL(request.url).searchParams.has('debug') ? { detail: err.detail || String(err.message) } : {};
    return json({ error: err.status && err.status < 500 ? err.message : 'Signups hit a snag. Try again in a minute.', ...debug }, err.status || 500, h);
  }
}
export const OPTIONS = request => new Response(null, { status: 204, headers: cors(request, process.env) });
