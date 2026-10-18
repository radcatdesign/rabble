import { listProducts, json, cors } from '../../server/store.js';

export async function onRequestGet({ request, env }) {
  const h = cors(request, env);
  try {
    return json({ products: await listProducts(env) }, 200, { ...h, 'cache-control': 'public, max-age=60, s-maxage=300' });
  } catch (err) {
    return json({ products: [], error: err.message }, err.status || 500, h);
  }
}
export const onRequestOptions = ({ request, env }) => new Response(null, { status: 204, headers: cors(request, env) });
