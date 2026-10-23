/* Rabble & Rouse first-party analytics. No cookies, no third parties, fails silently.
   window.analytics.track(name, label) records a custom action. Details: docs/analytics.md */
(function () {
  var W = window, D = document, N = navigator, L = location, noop = { track: function () {} };
  if (W.analytics && W.analytics.__rr) return;
  try {
    var host = L.hostname, q = new URLSearchParams(L.search);
    var on = /(^|\.)rabbleandrouse\.com$|^rabble-rouse\.vercel\.app$|^localhost$|^127\.0\.0\.1$/.test(host);
    var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
    var ss = function (k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } };
    // not counted: other hosts, the heatmap viewer's frame, and any browser signed in to the dashboard
    if (!on || q.has('rr-heatmap') || ls('rr-staff') === '1') { W.analytics = noop; return; }

    var EP = '/api/analytics/', now = function () { return Date.now(); };
    var rid = function () { var a = new Uint8Array(16), s = ''; (W.crypto || W.msCrypto).getRandomValues(a); for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36); return s; };
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var gpc = N.globalPrivacyControl === true || N.doNotTrack === '1' || W.doNotTrack === '1';
    var eu = /^(Europe\/|Arctic\/|Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe)|Asia\/(Nicosia|Famagusta)|Africa\/Ceuta)/.test(tz);
    var dev = function () { var w = W.innerWidth || 1024; return w < 768 ? 'phone' : w < 1100 ? 'tablet' : 'desktop'; };

    // visit: one tab, renewed after 30 minutes with no page view or action
    var visit = function (touch) {
      var v = null; try { v = JSON.parse(ss('rr-visit') || 'null'); } catch (e) {}
      if (!v || !v.id || now() - v.t > 18e5) v = { id: rid(), t: now(), n: 1 };
      if (touch) v.t = now();
      ss('rr-visit', JSON.stringify(v)); return v.id;
    };
    var vid = visit(true);
    // browser ID: localStorage, 13 months, never under GPC, Do Not Track or EU/EEA/UK/Swiss time zones
    var bid = null, ret = false;
    if (gpc || eu) ls('rr-bid', null);
    else {
      var b = null; try { b = JSON.parse(ls('rr-bid') || 'null'); } catch (e) {}
      if (!b || !b.id || now() - b.c > 342e8) b = { id: rid(), c: now(), lv: '' };
      ret = !!b.lv && b.lv !== vid; if (b.lv !== vid) { b.pv = b.lv; b.lv = vid; } else ret = !!b.pv;
      bid = b.id; ls('rr-bid', JSON.stringify(b));
    }

    var path = function () { return L.pathname.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '') || '/'; };
    var base = function () { return { v: vid, b: bid, r: ret, d: dev(), l: N.language || '', z: tz, w: W.innerWidth || 0 }; };
    var post = function (op, body, beacon) {
      try {
        var s = JSON.stringify(body);
        if (beacon && N.sendBeacon && N.sendBeacon(EP + op, new Blob([s], { type: 'text/plain' }))) return;
        if (W.fetch) fetch(EP + op, { method: 'POST', body: s, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(function () {});
      } catch (e) {}
    };
    var send = function (events, beacon) { var b = base(); b.e = events; post('collect', b, beacon); };

    // active time: visible, and some sign of a person in the last 2 minutes (opening the page counts)
    var lastAct = now(), active = 0, tick = now(), maxScroll = 0, viewId = '', sentScroll = false, pageAt = now();
    var poke = function () { lastAct = now(); };
    var count = function () { var t = now(); if (D.visibilityState === 'visible' && t - lastAct < 12e4) active += Math.min(t - tick, 5000); tick = t; };
    var scroll = function () {
      var h = Math.max(D.documentElement.scrollHeight, D.body ? D.body.scrollHeight : 0) || 1;
      var p = Math.min(100, Math.round(((W.scrollY || 0) + W.innerHeight) / h * 100)); if (p > maxScroll) maxScroll = p;
    };
    ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'].forEach(function (e) { W.addEventListener(e, poke, { passive: true, capture: true }); });
    W.addEventListener('mousemove', function () { if (now() - lastAct > 1000) poke(); }, { passive: true });
    W.addEventListener('scroll', scroll, { passive: true });
    setInterval(count, 1000);

    // heatmaps: clicks and cursor (desktop) on a 40-column grid with 20 px rows; scroll reach once per page
    var heat = {}, heatN = 0, lastMove = 0;
    var cell = function (k, x, y, sel) { if (heatN > 500) return; var key = k + '|' + x + '|' + y + '|' + (sel || ''); if (!heat[key]) heatN++; heat[key] = (heat[key] || 0) + 1; };
    var grid = function (e) { var w = Math.max(D.documentElement.scrollWidth, 1); return [Math.min(39, Math.floor(e.pageX / w * 40)), Math.floor(e.pageY / 20)]; };
    var selOf = function (el) {
      el = el && el.closest ? (el.closest('a,button,input,select,textarea,label,summary,[role=button],[data-cursor]') || el) : null;
      if (!el || !el.tagName) return '';
      var s = el.tagName.toLowerCase();
      if (el.id) return s + '#' + el.id;
      var c = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(function (x) { return x && !/^(is-|rv|magnetic)/.test(x); })[0];
      return (s + (c ? '.' + c : '')).slice(0, 80);
    };
    D.addEventListener('click', function (e) { try { var g = grid(e); cell('click', g[0], g[1]); cell('el', 0, 0, selOf(e.target)); } catch (x) {} }, true);
    D.addEventListener('mousemove', function (e) { if (dev() !== 'desktop') return; var t = now(); if (t - lastMove < 100) return; lastMove = t; var g = grid(e); cell('move', g[0], g[1]); }, { passive: true });
    var flushHeat = function (beacon) {
      var c = []; for (var k in heat) { var p = k.split('|'); c.push([p[0], +p[1], +p[2], heat[k], p[3]]); }
      heat = {}; heatN = 0;
      if (c.length) send([{ t: 'heat', p: path(), c: c }], beacon);
    };
    setInterval(function () { if (D.visibilityState === 'visible') flushHeat(false); }, 1e4);

    // page views (and in-app navigation, if the site ever becomes a single-page app)
    var lastPath = '';
    var view = function () {
      var p = path(); if (p === lastPath) return; lastPath = p;
      vid = visit(true); viewId = rid(); active = 0; tick = now(); maxScroll = 0; sentScroll = false; pageAt = now(); scroll();
      var ref = ''; try { var r = D.referrer ? new URL(D.referrer) : null; if (r && r.host !== L.host) ref = r.hostname; } catch (e) {}
      var u = {}, any = false;
      ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (k) { var v = q.get('utm_' + k); if (v) { u[k] = v.slice(0, 120); any = true; } });
      send([{ t: 'view', p: p, pv: viewId, ref: ref, u: any ? u : null, ref_tag: q.get('ref') || '' }]);
    };
    var lastLeave = 0;
    var leave = function (beacon) {
      count(); scroll();
      if (now() - lastLeave < 1500 && !active) return; lastLeave = now();
      var ev = [{ t: 'leave', p: path(), pv: viewId, a: active, s: maxScroll }]; active = 0;
      send(ev, beacon);
      if (!sentScroll) { sentScroll = true; cell('scroll', 0, Math.floor(maxScroll / 5) * 5); }
      flushHeat(beacon);
    };
    ['pushState', 'replaceState'].forEach(function (m) {
      var o = history[m]; if (!o) return;
      history[m] = function () { var r = o.apply(this, arguments); try { if (path() !== lastPath) { leave(false); q = new URLSearchParams(L.search); view(); } } catch (e) {} return r; };
    });
    W.addEventListener('popstate', function () { if (path() !== lastPath) { leave(false); q = new URLSearchParams(L.search); view(); } });

    // actions
    var act = function (name, label, beacon) {
      if (!name) return; vid = visit(true);
      send([{ t: 'action', p: path(), n: String(name).slice(0, 80), lb: label == null ? '' : String(label).slice(0, 160) }], beacon);
    };
    D.addEventListener('click', function (e) {
      try {
        var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
        var h = a.getAttribute('href') || '', u = new URL(a.href, L.href);
        if (/^mailto:/i.test(h)) act('Email click', h.replace(/^mailto:/i, '').split('?')[0], true);
        else if (/^tel:/i.test(h)) act('Phone click', h.replace(/^tel:/i, ''), true);
        else if (/\.(pdf|zip|docx?|xlsx?|pptx?|csv|txt|rtf|key|pages|numbers|mp3|wav|mov|mp4|dmg|exe)$/i.test(u.pathname) || a.hasAttribute('download')) act('Download', u.pathname.split('/').pop(), true);
        else if (/^https?:$/.test(u.protocol) && u.host !== L.host) act('Outbound link', u.hostname.replace(/^www\./, ''), true);
      } catch (x) {}
    }, true);
    D.addEventListener('submit', function (e) { try { var f = e.target; act('Form submitted', f.getAttribute('name') || f.id || f.getAttribute('aria-label') || 'form', true); } catch (x) {} }, true);

    // presence: a heartbeat every 45 s while visible and someone's been around in the last 10 minutes
    var beat = function () { if (D.visibilityState === 'visible' && now() - lastAct < 6e5) { var b = base(); b.p = path(); post('presence', b); } };
    setInterval(beat, 45000);
    D.addEventListener('visibilitychange', function () { if (D.visibilityState === 'hidden') leave(true); else { tick = now(); poke(); beat(); } });
    W.addEventListener('pagehide', function () { leave(true); var b = base(); b.gone = 1; post('presence', b, true); });

    W.analytics = { __rr: true, track: function (name, label) { try { act(name, label); } catch (e) {} }, browserId: function () { return bid; } };
    view();
  } catch (e) { W.analytics = noop; }
})();
