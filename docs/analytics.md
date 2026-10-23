# Site analytics

First-party analytics for rabble-rouse.vercel.app (and rabbleandrouse.com once the domain moves). No cookies, no third parties, no cookie banner. The dashboard is at **/admin/analytics** and only the team can sign in.

## Setup

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Postgres connection string. Adding Neon Postgres in Vercel (Storage) sets it for you. The tables create themselves on the first request. |
| `ANALYTICS_PASSWORD` | The team passcode for the dashboard. Pick something long. Changing it signs everyone out. |
| `ANALYTICS_SECRET` | Optional. Signs dashboard sessions. If it's missing, a key is derived from the passcode. |
| `CRON_SECRET` | Lets Vercel's daily job run. Any long random string. Vercel sends it automatically. |
| `ANALYTICS_TZ` | Optional. The time zone for days and hours in the dashboard. Default `America/New_York`. |
| `ANALYTICS_ORIGINS` | Optional. Extra hostnames allowed to send data, comma separated (the site's own domains are already allowed). |

After adding or changing any of these, redeploy.

The daily job (`vercel.json`, 9:17 UTC) rotates the visitor salt, rolls up yesterday into `analytics_daily`, clears stale live rows and deletes raw events older than 400 days.

## How it fits together

- `a.js`: the tracker, on every public page (under 4 KB gzipped, loaded with `defer`). It does nothing on other hosts, inside the heatmap viewer, or in a browser signed in to the dashboard.
- `api/analytics.js` → `server/analytics.js`: one serverless function for everything (`/api/analytics/collect`, `/presence`, the dashboard data, `/cron`).
- `admin/analytics/`: the dashboard (`index.html` is built from `admin.tpl.html` with the site's own styles; `app.js` is the app; `benchmarks.js` holds the comparison figures; `world.js` is the map outline).

## What's collected

**Page views:** path (no query string), the referring site if it's another site, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, a `?ref=` tag, device (from window width), language, time zone, the visit ID, the browser ID when allowed, and whether the browser has visited before.

**Leaving a page:** active time and how far down the page the person got. Sent with `sendBeacon` when the page is hidden or closed.

**Actions:** recorded automatically for outbound links, `mailto:` and `tel:` links, file downloads and form sends (the form's name or id only, never what's typed). The site also records: *Played video*, *Newsletter signup*, *Added to bag*, *Started checkout*, *Order placed*.

**Presence:** a heartbeat every 45 seconds while a page is on screen and someone has been active in the last 10 minutes, and a "gone" signal when the page closes.

**Heatmaps:** clicks (grid position plus a short element selector like `button.menu-btn`, no text), cursor movement on desktop (at most one point every 100 ms) and the furthest scroll point. Sent in batches every 10 seconds and when the page closes. Stored as counts per grid cell, page, device and day, never as raw streams.

On the server: the browser and operating system names are read from the user agent, and approximate country, region and city come from Vercel's edge lookup. The IP address and full user agent are never stored.

## Definitions

- **Visitors:** people who opened at least one page, counted once per day with `hash(daily salt + IP + user agent)`. The salt changes every day and the old one is deleted, so the same person on three days counts three times.
- **Visit:** from the first page until the tab closes or 30 minutes pass with no page view or action. One tab, one visit.
- **Bounce:** a visit that saw one page, did no action and left within 10 seconds of active time.
- **Active time:** counted while the page is on screen and the person scrolled, clicked, tapped, typed or moved the mouse in the last 2 minutes. Opening the page counts as activity.
- **Average visit:** active time per visit, added up across its pages.
- **Pages per visit:** page views divided by visits.
- **Returning:** a visit from a browser that has visited before. Only browsers with a browser ID can be returning.
- **Live:** a heartbeat in the last 100 seconds. Each browser counts once; visitors without a browser ID count once per tab.
- **Likely bots:** visits that never sent a leave signal or an action and are over 30 minutes old. They're left out of every number and counted in Settings.
- **Visit-to-signup:** visits with a *Newsletter signup* or *Form submitted* action, divided by visits.

## Filters

- Known bots and crawlers by user agent, headless browsers, and requests without JavaScript signals (no time zone or screen width) are dropped and counted.
- Browsers signed in to the dashboard set `rr-staff` in localStorage and stop sending anything, on any network. Settings has *Count it again*.
- Excluded IPs (Settings). IPv6 excludes the whole /64.
- Only the site's own origins can send data. Each endpoint has a 16 KB size cap and a per-IP rate limit.

## Add a custom action

```js
window.analytics.track('Booked a call', 'Footer button');
```

The first value is the action name (it groups the action in the dashboard), the second is an optional label. Call it anywhere after the page loads. It never throws, and it does nothing in a browser that isn't counted.

## Settings

- **Sample data:** fills every page with made-up numbers. Nothing is saved while it's on.
- **This browser:** whether the browser you're on is counted.
- **Excluded IP addresses:** add your current IP or any other.
- **Filtered out:** what the bot and team filters dropped in the last 30 days.
- **Custom actions:** the snippet and the list of custom actions seen.
- **Heatmap pages:** every page (default) or a chosen list.
- **Data kept and Export:** CSV per table for the selected date range (up to 100,000 rows).
- **Delete a visitor:** removes every event, live row and linked email for one browser ID.

## Heatmap screenshots

Vercel's serverless functions can't run a headless browser cheaply, so the heatmap viewer loads the live page in a frame at 1440, 820 or 390 px wide (`?rr-heatmap=1` turns off the curtains, animations and tracking inside the frame) and paints the heat over it. The `analytics_shots` table is there in case stored screenshots are added later.

## Database tables

`analytics_events`, `analytics_presence`, `analytics_heat`, `analytics_daily`, `analytics_salts`, `analytics_settings`, `analytics_shots`, `analytics_people` (browser ID to email, set when someone signs up for the newsletter from a browser with an ID) and `analytics_counters` (filter counts). Schema: top of `server/analytics.js`.
