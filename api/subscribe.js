import { json, cors } from '../server/store.js';
import { subscribe } from '../server/newsletter.js';
import { linkEmail, recordSignup, screenSignup } from '../server/analytics.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Newsletter signups go to Mailchimp and into our own subscribers table. If Mailchimp is down but the
   signup is saved, the visitor still gets a thank-you; the dashboard shows them as "Not sent yet" with a retry. */
export async function POST(request) {
  const h = cors(request, process.env), env = process.env;
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'That email address looks off. Check it and try again.' }, 400, h);
    // spam: answer like a normal signup so bots learn nothing, but send nothing to Mailchimp and save nothing
    const screen = await screenSignup(env, request, { ...body, email });
    if (screen.block) return json({ status: 'pending', via: 'held' }, 200, h);
    let out = null, mcErr = null;
    try { out = await subscribe(env, email, body.source); }
    catch (err) { if (err.status && err.status < 500 && err.status !== 429) throw err; mcErr = err; }
    const status = out ? (out.status === 'pending' ? 'pending' : 'subscribed') : 'not_sent';
    const saved = await recordSignup(env, request, { email, source: body.source, browserId: body.bid, status, ipHash: screen.ipHash,
      mailchimp: out ? `${out.status} via ${out.via}` : 'failed: ' + String(mcErr && mcErr.message).slice(0, 160) });
    if (out) await linkEmail(env, request, body.bid, email);   // shows this browser by email in the analytics dashboard
    if (mcErr) { if (saved) return json({ status: 'pending', via: 'saved' }, 200, h); throw mcErr; }
    return json(out, 200, h);
  } catch (err) {
    return json({ error: err.status && err.status < 500 ? err.message : 'Signups hit a snag. Try again in a minute.' }, err.status || 500, h);
  }
}
export const OPTIONS = request => new Response(null, { status: 204, headers: cors(request, process.env) });
