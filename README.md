# Rabble & Rouse

Website for *Rabble & Rouse with Katie Martell*, a web series of real conversations with real people.

Static pages: `index.html` (home), `episode-1.html` and `episode-2.html` (episode details, video, credits, signup), plus the `media/` folder (season preview, Episode 1 first look, set photos, host cutout). Open it from any static host; no build step.

Libraries load from jsDelivr: GSAP + ScrollTrigger, Lenis, and Three.js (curtain loader and footer sign).

Merch: `store.html` plus the store routes in `api/` (Vercel) and `functions/api/` (Cloudflare). See `STORE-SETUP.md` to connect Printful and Stripe.

Live site: https://rabble-rouse.vercel.app (the GitHub Pages copy forwards there).

## Analytics

First-party, cookie-free analytics with a staff dashboard at `/admin`. Setup, definitions and the custom action snippet: `docs/analytics.md`. Privacy policy text: `docs/analytics-privacy.md`.
