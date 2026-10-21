/* Rabble & Rouse store: Printful makes and ships, Stripe takes payment.
   Plain fetch + Web Crypto, so it runs on Cloudflare Pages Functions (or any fetch-based runtime).

   Environment variables:
     PRINTFUL_TOKEN         Printful private API token (developers.printful.com)
     PRINTFUL_STORE_ID      optional, only if the token covers more than one Printful store
     PRINTFUL_AUTO_CONFIRM  "true" sends paid orders straight to production; anything else leaves them as drafts to review
     STRIPE_SECRET_KEY      sk_live_… or sk_test_…
     STRIPE_WEBHOOK_SECRET  whsec_… from the Stripe webhook endpoint
     SITE_URL               e.g. https://www.rabbleandrouse.com (used for return links)
     ALLOWED_ORIGIN         optional, extra origin allowed to call the API (e.g. https://radcatdesign.github.io)
     SHIP_COUNTRIES         optional, comma list of ISO codes (default "US")
     SHIPPING_CENTS         optional flat shipping per order in cents (default 600)
     FREE_SHIP_CENTS        optional subtotal in cents that unlocks free shipping (default off)
*/

const PF = 'https://api.printful.com';
const MAX_LINES = 20, MAX_QTY = 10;

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

export function cors(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = [env.SITE_URL, env.ALLOWED_ORIGIN].filter(Boolean).map(s => s.replace(/\/$/, ''));
  if (!origin || !allowed.includes(origin)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' };
}

let apiStoreId = null; // found once per instance when the token can see several stores

async function printful(env, path, init = {}, retried = false) {
  if (!env.PRINTFUL_TOKEN) throw new HttpError(503, 'Store is not connected yet');
  const headers = { authorization: `Bearer ${env.PRINTFUL_TOKEN}`, 'content-type': 'application/json' };
  const storeId = env.PRINTFUL_STORE_ID || apiStoreId;
  if (storeId) headers['x-pf-store-id'] = String(storeId);
  const res = await fetch(PF + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || body.result || `Printful ${res.status}`;
    // an account-wide token defaults to another store: find the Manual order / API one and try again
    if (!retried && !env.PRINTFUL_STORE_ID && /Manual Order \/ API|store_id/i.test(String(msg))) {
      const id = await findApiStore(env);
      if (id) { apiStoreId = id; return printful(env, path, init, true); }
      throw new HttpError(502, 'No Manual order / API store found for this Printful token');
    }
    throw new HttpError(res.status === 404 ? 404 : 502, msg);
  }
  return body.result;
}

async function findApiStore(env) {
  const res = await fetch(PF + '/stores', { headers: { authorization: `Bearer ${env.PRINTFUL_TOKEN}` } });
  const body = await res.json().catch(() => ({}));
  const stores = Array.isArray(body.result) ? body.result : [];
  const api = stores.find(s => /native|api|manual/i.test(String(s.type)));
  if (api) return api.id;
  // say what the token can see, so the fix is obvious from the error
  const seen = stores.map(s => `${s.name} (${s.type})`).join(', ');
  throw new HttpError(502, `This Printful token only reaches ${seen || (body.error && body.error.message) || 'no stores it can list'}. It needs a Manual order / API store.`);
}

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const cents = v => Math.round(parseFloat(v) * 100);
const variantImage = v => {
  const preview = (v.files || []).find(f => f.type === 'preview' && (f.preview_url || f.thumbnail_url));
  return (preview && (preview.preview_url || preview.thumbnail_url)) || (v.product && v.product.image) || '';
};

/* ---------- products: everything synced in the Printful store, shaped for the Merch page ---------- */
export async function listProducts(env) {
  const list = await printful(env, '/store/products?limit=100');
  const full = await Promise.all((list || []).filter(p => !p.is_ignored).map(p => printful(env, `/store/products/${p.id}`)));
  return full.map(({ sync_product: p, sync_variants: vs }) => {
    const variants = (vs || [])
      .filter(v => !v.is_ignored && v.availability_status !== 'discontinued')
      .map(v => ({
        id: v.id,
        name: v.name,
        size: v.size || '',
        color: v.color || '',
        price: cents(v.retail_price),
        currency: (v.currency || 'USD').toLowerCase(),
        image: variantImage(v),
        available: !v.availability_status || v.availability_status === 'active'
      }))
      .filter(v => v.price > 0);
    return { id: p.id, name: p.name, image: p.thumbnail_url || (variants[0] && variants[0].image) || '', variants };
  }).filter(p => p.variants.length);
}

/* ---------- checkout: prices come from Printful, never from the browser ---------- */
export function cleanCart(items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Your bag is empty');
  const merged = new Map();
  for (const it of items.slice(0, MAX_LINES)) {
    const id = parseInt(it && it.id, 10), qty = parseInt(it && it.qty, 10);
    if (!(id > 0) || !(qty > 0)) throw new HttpError(400, 'Something in your bag looks off');
    merged.set(id, Math.min(MAX_QTY, (merged.get(id) || 0) + qty));
  }
  return [...merged].map(([id, qty]) => ({ id, qty }));
}

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

async function stripe(env, path, params, method = 'POST') {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, 'Checkout is not connected yet');
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: params ? form(params).toString() : undefined
  });
  const body = await res.json();
  if (!res.ok) throw new HttpError(502, (body.error && body.error.message) || `Stripe ${res.status}`);
  return body;
}

export async function createCheckout(env, items, origin) {
  const cart = cleanCart(items);
  const variants = await Promise.all(cart.map(c => printful(env, `/store/variants/${c.id}`)));
  const lines = variants.map((v, i) => {
    if (v.is_ignored) throw new HttpError(400, `${v.name} isn't available right now`);
    return {
      price_data: {
        currency: (v.currency || 'USD').toLowerCase(),
        unit_amount: cents(v.retail_price),
        product_data: { name: v.name, images: variantImage(v) ? [variantImage(v)] : undefined, metadata: { sync_variant_id: v.id } }
      },
      quantity: cart[i].qty
    };
  });
  const currency = lines[0].price_data.currency;
  const subtotal = lines.reduce((s, l) => s + l.price_data.unit_amount * l.quantity, 0);
  const ship = parseInt(env.SHIPPING_CENTS || '600', 10);
  const freeAt = parseInt(env.FREE_SHIP_CENTS || '0', 10);
  const shipAmount = freeAt && subtotal >= freeAt ? 0 : ship;
  const site = (env.SITE_URL || origin || '').replace(/\/$/, '');
  const countries = (env.SHIP_COUNTRIES || 'US').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const session = await stripe(env, '/checkout/sessions', {
    mode: 'payment',
    line_items: lines,
    shipping_address_collection: { allowed_countries: countries },
    shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', display_name: shipAmount ? 'Standard shipping' : 'Free shipping', fixed_amount: { amount: shipAmount, currency } } }],
    phone_number_collection: { enabled: true },
    // the webhook rebuilds the Printful order from this
    metadata: { cart: cart.map(c => `${c.id}x${c.qty}`).join(',') },
    success_url: `${site}/store.html?order=success`,
    cancel_url: `${site}/store.html?order=cancel`
  });
  return { url: session.url };
}

/* ---------- webhook: paid session becomes a Printful order ---------- */
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const safeEqual = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

export async function verifyStripe(env, raw, header, now = Date.now()) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'Webhook secret missing');
  const parts = Object.fromEntries((header || '').split(',').map(p => p.split('=')).filter(p => p.length === 2 && p[0] !== 'v1'));
  const sigs = (header || '').split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const t = parseInt(parts.t, 10);
  if (!t || !sigs.length) throw new HttpError(400, 'Bad signature header');
  if (Math.abs(now / 1000 - t) > 300) throw new HttpError(400, 'Signature too old');
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${raw}`);
  if (!sigs.some(s => safeEqual(s, expected))) throw new HttpError(400, 'Signature mismatch');
  return JSON.parse(raw);
}

async function shortId(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return 'rr' + [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 30);
}

export async function fulfil(env, session) {
  if (session.payment_status !== 'paid') return { skipped: 'not paid' };
  const cart = (session.metadata && session.metadata.cart || '').split(',').filter(Boolean).map(p => {
    const [id, qty] = p.split('x').map(n => parseInt(n, 10));
    return { sync_variant_id: id, quantity: qty };
  });
  if (!cart.length) return { skipped: 'no cart' };
  const ship = session.shipping_details || (session.collected_information && session.collected_information.shipping_details) || {};
  const a = ship.address || {}, cust = session.customer_details || {};
  const confirm = String(env.PRINTFUL_AUTO_CONFIRM) === 'true';
  const order = await printful(env, `/orders?confirm=${confirm}`, {
    method: 'POST',
    body: JSON.stringify({
      external_id: await shortId(session.id),
      shipping: 'STANDARD',
      recipient: {
        name: ship.name || cust.name || '',
        address1: a.line1 || '', address2: a.line2 || '',
        city: a.city || '', state_code: a.state || '', country_code: a.country || '', zip: a.postal_code || '',
        email: cust.email || '', phone: cust.phone || ''
      },
      items: cart
    })
  });
  return { order: order && order.id, confirmed: confirm };
}
