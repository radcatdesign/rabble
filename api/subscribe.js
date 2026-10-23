import { json, cors } from '../server/store.js';
import { subscribe } from '../server/newsletter.js';
import { linkEmail } from '../server/analytics.js';

export async function POST(request) {
  const h = cors(request, process.env);
  try {
    const body = await request.json().catch(() => ({}));
    const out = await subscribe(process.env, body.email, body.source);
    await linkEmail(process.env, request, body.bid, body.email);   // shows this browser by email in the analytics dashboard
    return json(out, 200, h);
  } catch (err) {
    return json({ error: err.status && err.status < 500 ? err.message : 'Signups hit a snag. Try again in a minute.' }, err.status || 500, h);
  }
}
export const OPTIONS = request => new Response(null, { status: 204, headers: cors(request, process.env) });
