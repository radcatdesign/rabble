import { listProducts, mergeByName, json, cors } from '../server/store.js';

export async function GET(request) {
  const env = process.env, h = cors(request, env);
  try {
    return json({ products: mergeByName(await listProducts(env)) }, 200, { ...h, 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400' });
  } catch (err) {
    return json({ products: [], error: err.message }, err.status || 500, h);
  }
}
export const OPTIONS = request => new Response(null, { status: 204, headers: cors(request, process.env) });
