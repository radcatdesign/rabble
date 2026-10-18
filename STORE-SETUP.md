# Merch store setup

The Merch page (`store.html`) sells Printful products with Stripe Checkout. Three small server routes in `functions/api/` do the work:

| Route | What it does |
| --- | --- |
| `GET /api/products` | Pulls the synced products and prices from your Printful store |
| `POST /api/checkout` | Re-prices the bag from Printful (never trusts the browser) and opens a Stripe Checkout page |
| `POST /api/stripe-webhook` | When Stripe confirms payment, creates the matching order in Printful |

GitHub Pages can't run those routes, so the store goes live on **Cloudflare Pages** (free, commercial use allowed). Until then the Merch page shows a "first drop is in the works" state with a signup.

## 1. Printful
1. In Printful, make sure the products live in a store of type **Manual order platform / API** (Stores → Add store → Manual order platform / API). Add or move the merch there and set retail prices.
2. Go to developers.printful.com → **Your tokens** → Create a private token for that store with access to **store products**, **orders** and **file library**.
3. Add a billing method in Printful (needed once orders are auto-confirmed).

## 2. Stripe (Rabble & Rouse's own account)
1. Developers → API keys → copy the **secret key** (start with the `sk_test_` one).
2. Developers → Webhooks → **Add endpoint**: `https://YOUR-SITE/api/stripe-webhook`, events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy the **signing secret** (`whsec_…`).

## 3. Cloudflare Pages
1. dash.cloudflare.com → Workers & Pages → Create → Pages → **Connect to Git** → pick `radcatdesign/rabble`.
2. Framework preset: None. Build command: leave empty. Build output directory: `/`.
3. Settings → Environment variables (Production), add:

| Name | Value |
| --- | --- |
| `PRINTFUL_TOKEN` | the Printful private token |
| `STRIPE_SECRET_KEY` | `sk_test_…` while testing, then `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
| `SITE_URL` | the site's address, e.g. `https://rabble.pages.dev` or `https://www.rabbleandrouse.com` |
| `PRINTFUL_AUTO_CONFIRM` | `false` while testing (orders land as drafts), `true` to send paid orders straight to production |
| `SHIPPING_CENTS` | optional, flat shipping per order in cents (default `600`) |
| `FREE_SHIP_CENTS` | optional, subtotal in cents that unlocks free shipping |
| `SHIP_COUNTRIES` | optional, e.g. `US,CA` (default `US`) |
| `PRINTFUL_STORE_ID` | optional, only if the token covers several Printful stores |

4. Redeploy. The site and store are now live at the `pages.dev` address.

## 4. Test, then go live
1. With the test key, add something to the bag and pay with card `4242 4242 4242 4242`, any future date, any CVC.
2. Check Stripe (payment), then Printful → Orders (a draft with the right items and address).
3. Swap in the live Stripe key and its live webhook secret, set `PRINTFUL_AUTO_CONFIRM` to `true`, redeploy.

When rabbleandrouse.com moves over, point it at the Cloudflare Pages project (Custom domains) and update `SITE_URL`. Keep the `join` subdomain and the email (MX) records as they are.
