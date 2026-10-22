/* Newsletter signups → the Rabble & Rouse Mailchimp audience (the one behind join.rabbleandrouse.com).
   With MAILCHIMP_API_KEY set it uses the Mailchimp API (and tags the source); without it, it posts
   to the audience's public signup endpoint, the same one the hosted form uses.

   Optional env: MAILCHIMP_API_KEY (xxxx-us16), MAILCHIMP_LIST_ID (default below),
                 MAILCHIMP_DOUBLE_OPTIN ("true" sends a confirm email first), MAILCHIMP_FORM_URL */
import { HttpError } from './store.js';

const FORM = 'https://mc.us16.list-manage.com/subscribe/post-json?u=ce1b58add8c1efd13b6b9c915&id=b9fe5c7621&f_id=008ec2e1f0';
const LIST = 'b9fe5c7621';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = s => String(s || '').replace(/<[^>]+>/g, '').replace(/^\d+ - /, '').trim();

export async function subscribe(env, email, source = 'website') {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'That email address looks off. Check it and try again.');
  const tag = String(source || 'website').replace(/[^\w -]/g, '').slice(0, 40) || 'website';

  if (env.MAILCHIMP_API_KEY) {
    const dc = env.MAILCHIMP_API_KEY.split('-')[1];
    const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${env.MAILCHIMP_LIST_ID || LIST}/members`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + btoa('rr:' + env.MAILCHIMP_API_KEY), 'content-type': 'application/json' },
      body: JSON.stringify({ email_address: email, status: String(env.MAILCHIMP_DOUBLE_OPTIN) === 'true' ? 'pending' : 'subscribed', tags: ['website', tag] })
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { status: 'new' };
    if (body.title === 'Member Exists') return { status: 'already' };
    if (res.status === 400) throw new HttpError(400, clean(body.detail) || 'Mailchimp turned that one down.');
    throw new HttpError(502, 'Mailchimp is not answering right now');
  }

  const url = (env.MAILCHIMP_FORM_URL || FORM) + '&EMAIL=' + encodeURIComponent(email) + '&c=rr';
  const res = await fetch(url, { headers: { accept: 'application/javascript, application/json' } });
  const text = await res.text();
  const m = text.match(/^\s*rr\((.*)\)\s*;?\s*$/s);
  let data = null;
  try { data = JSON.parse(m ? m[1] : text); } catch (_) {}
  if (!data) { const e = new HttpError(502, 'Mailchimp is not answering right now'); e.detail = `${res.status} ${res.headers.get('content-type')} ${text.slice(0, 300)}`; throw e; }
  if (data.result === 'success') return { status: 'new' };
  const msg = clean(data.msg);
  if (/already subscribed|is already a list member/i.test(msg)) return { status: 'already' };
  if (/too many/i.test(msg)) throw new HttpError(429, 'Too many tries from this address. Give it a few minutes.');
  throw new HttpError(400, msg || 'Mailchimp turned that one down.');
}
