/* "How you compare" benchmarks. Edit the numbers and sources here; the Overview reads this file.
   Units: pct is a share from 0 to 1, ms is milliseconds. A metric is rated only when the range has 30+ visits.
   Status: "At goal" when the goal is met, "Typical" when inside the typical range, otherwise "Behind typical".
   Our bounce matches GA4's definition (one page, no action, under 10 seconds), so GA4 figures compare directly. */
window.RR_BENCHMARKS = {
  site: 'Media and entertainment: a video show and podcast site',
  note: 'Public figures for small media sites are thin, so these mix all-industry GA4 medians with media-specific ranges. Treat them as a rough guide, and watch your own trend first.',
  metrics: [
    {
      key: 'bounceRate', label: 'Bounce rate', unit: 'pct', lowerIsBetter: true,
      typical: [0.44, 0.75], goal: 0.44,
      means: 'The share of visits that saw one page, did nothing and left within 10 seconds. Media sites run high because many people come for one thing.',
      moves: 'Fast first load, a clear next step above the fold (watch, listen, sign up), and links between episodes. Social traffic bounces more than email or search.',
      sources: [
        { name: 'Databox GA4 benchmarks: median bounce rate 44.04% (Sept 2024)', url: 'https://databox.com/content-marketing-benchmarks-by-industry' },
        { name: 'ConversionBench, from Contentsquare 2024: media and publishing 60–80%', url: 'https://conversionbench.com/guide/bounce-rate-benchmarks-by-industry' }
      ]
    },
    {
      key: 'avgVisitMs', label: 'Average visit', unit: 'ms',
      typical: [60000, 158000], goal: 158000,
      means: 'Active time per visit. Watching an embedded episode counts while the page stays on screen and the person is around.',
      moves: 'Embedded episodes and clips people can play right away, related episodes after each one, and pages that load fast on phones.',
      sources: [
        { name: 'Databox GA4 benchmarks: median session 2m 38s (Sept 2024)', url: 'https://databox.com/content-marketing-benchmarks-by-industry' },
        { name: 'Sleek web analytics benchmarks: media and news 1–3 minutes per visit', url: 'https://getsleek.io/blog/web-analytics-benchmarks-2026' }
      ]
    },
    {
      key: 'pagesPerVisit', label: 'Pages per visit', unit: 'x',
      typical: [1.5, 3], goal: 2.5,
      means: 'How many pages a visit opens on average.',
      moves: 'Links from each episode to the next, merch next to the episodes it relates to, and a menu that shows everything at a glance. Phones see fewer pages than desktops.',
      sources: [
        { name: 'Sleek web analytics benchmarks: general sites 1.5–3 pages', url: 'https://getsleek.io/blog/web-analytics-benchmarks-2026' },
        { name: 'Contentsquare 2024 benchmark: desktop sessions see about 1.5 more pages than mobile', url: 'https://csquad.contentsquare.com/benchmark24-explorer' }
      ]
    },
    {
      key: 'returningShare', label: 'Returning visitors', unit: 'pct',
      typical: [0.25, 0.5], goal: 0.4,
      means: 'The share of visits from browsers that came before. Visitors without a browser ID (privacy signals, EU and UK) always count as new, so this reads a bit low.',
      moves: 'A steady release schedule, the newsletter, and reminders on social when a new episode drops.',
      sources: [
        { name: 'Contentsquare 2024 benchmark: new and returning traffic split about 50/50 across industries', url: 'https://csquad.contentsquare.com/benchmark24-explorer' }
      ]
    },
    {
      key: 'formRate', label: 'Visit-to-signup', unit: 'pct',
      typical: [0.01, 0.02], goal: 0.02,
      means: 'The share of visits that sent a form, like the newsletter signup.',
      moves: 'One clear signup ask on every page, a reason to join (first look at new episodes), and a short form.',
      sources: [
        { name: 'Klipfolio: newsletter signup rate, 2% healthy, 5% strong, under 1% weak', url: 'https://www.klipfolio.com/resources/kpi-examples/digital-marketing/newsletter-signup-conversion-rate' }
      ]
    }
  ]
};
