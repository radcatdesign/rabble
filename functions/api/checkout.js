import { createCheckout, json, cors } from '../../server/store.js';

export async function onRequestPost({ request, env }) {
  const h = cors(request, env);
  try {
    const body = await request.json().catch(() => ({}));
    return json(await createCheckout(env, body.items, request.headers.get('origin')), 200, h);
  } catch (err) {
    return json({ error: err.status && err.status < 500 ? err.message : 'Checkout hit a snag. Try again in a minute.' }, err.status || 500, h);
  }
}
export const onRequestOptions = ({ request, env }) => new Response(null, { status: 204, headers: cors(request, env) });
