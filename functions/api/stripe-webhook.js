import { verifyStripe, fulfil, json } from '../../server/store.js';

export async function onRequestPost({ request, env }) {
  let event;
  try {
    event = await verifyStripe(env, await request.text(), request.headers.get('stripe-signature'));
  } catch (err) {
    return json({ error: err.message }, err.status || 400);
  }
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return json({ ignored: event.type });
  try {
    return json(await fulfil(env, event.data.object));
  } catch (err) {
    // Stripe retries on errors; a repeat of an order Printful already has is fine
    if (/external.?id|already exists|duplicate/i.test(err.message)) return json({ duplicate: true });
    return json({ error: err.message }, 500);
  }
}
