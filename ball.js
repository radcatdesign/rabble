/* The mirror ball (Merch and 404 pages): a WebGL ball of real mirror tiles hanging on a string, plus the
   light spots it throws around the room. Usage:
     hangBall({ canvas, spots, place: (w, h) => ({ cx, cy, rad }), drop: promise })
   canvas: where the ball draws (sized by CSS). spots: an optional full-screen canvas for the reflections.
   place: where the ball hangs inside the canvas, in px. drop: when it falls into place (default: right away). */
import * as THREE from './vendor/three.module.js';

export function hangBall({ canvas, spots = null, place, drop = Promise.resolve() }) {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 100);
  camera.position.set(0, 0, 14);

  // the ball: hundreds of small square mirrors on a sphere, each a hair off-angle so they catch light one by one
  const R = 2.6, rings = 30, tiles = [];
  for (let i = 1; i < rings; i++) {
    const phi = Math.PI * i / rings, count = Math.max(6, Math.round(rings * 2 * Math.sin(phi)));
    for (let j = 0; j < count; j++) tiles.push([phi, (j + (i % 2) * .5) / count * Math.PI * 2]);
  }
  const size = (Math.PI * R / rings) * .86;
  const mirrors = new THREE.InstancedMesh(
    new THREE.BoxGeometry(size, size, .05),
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: .02, envMapIntensity: 2, flatShading: true }),
    tiles.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), look = new THREE.Object3D();
  const base = [], col = new THREE.Color();
  tiles.forEach(([phi, th], k) => {
    pos.set(R * Math.sin(phi) * Math.cos(th), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(th));
    look.position.copy(pos); look.lookAt(pos.clone().multiplyScalar(2));
    e.set((Math.random() - .5) * .14, (Math.random() - .5) * .14, 0); q.setFromEuler(e);
    look.quaternion.multiply(q);
    m.compose(pos, look.quaternion, one); mirrors.setMatrixAt(k, m);
    const tint = Math.random();
    base.push(tint < .84 ? new THREE.Color(.8, .8, .84) : tint < .92 ? new THREE.Color(.95, .72, .86) : new THREE.Color(.72, .82, 1));
    mirrors.setColorAt(k, base[k]);
  });
  const ball = new THREE.Group();
  ball.add(mirrors);
  // a dark core so gaps between mirrors read as grout, not see-through
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(R * .97, 32, 24), new THREE.MeshBasicMaterial({ color: 0x0b0912 })));
  // pivot sits where the string meets the ceiling, so any sway swings from the top, not the ball's middle
  const pivot = new THREE.Group(), hang = new THREE.Group();
  hang.add(ball); pivot.add(hang);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, 1, 6), new THREE.MeshBasicMaterial({ color: 0x3a3450 }));
  pivot.add(rod);
  scene.add(pivot);

  // a painted room for the mirrors to reflect: dark club, neon in the show's colors, a few hot lamps
  scene.environment = (() => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 512);
    bg.addColorStop(0, '#4a3f66'); bg.addColorStop(.3, '#241c38'); bg.addColorStop(.55, '#120e1e'); bg.addColorStop(1, '#07060c');
    g.fillStyle = bg; g.fillRect(0, 0, 1024, 512);
    const blob = (x, y, rx, ry, color, a) => {
      g.save(); g.translate(x, y); g.scale(rx / ry, 1);
      const r = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      r.addColorStop(0, color); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = a; g.fillStyle = r; g.beginPath(); g.arc(0, 0, ry, 0, Math.PI * 2); g.fill(); g.restore();
    };
    [[120, 250, '#ff2d95'], [380, 230, '#2f86ff'], [620, 260, '#b44cff'], [880, 240, '#ff2d95'], [1010, 250, '#2f86ff'], [250, 300, '#b44cff'], [760, 300, '#2f86ff']]
      .forEach(([x, y, cc]) => blob(x, y, 190, 95, cc, 1));
    for (let x = 0; x < 1024; x += 128) blob(x + 64, 40, 60, 14, '#ffffff', .85);     // ceiling strip lights
    [[200, 150], [470, 110], [700, 160], [930, 120], [90, 120]].forEach(([x, y]) => { blob(x, y, 26, 26, '#ffffff', 1); blob(x, y, 8, 8, '#ffffff', 1); });
    blob(512, 470, 520, 60, '#3a1630', .7);                                          // stage glow off the floor
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 140; i++) {                                                   // scattered lamps: every tile catches something different
      const y = 20 + rnd() * 380, r = 3 + rnd() * 10, pick = rnd();
      blob(rnd() * 1024, y, r * 1.6, r, pick < .55 ? '#ffffff' : pick < .75 ? '#ff8cc4' : pick < .9 ? '#86b8ff' : '#d9a6ff', .55 + rnd() * .45);
    }
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(renderer);
    const out = pm.fromEquirectangular(t).texture; t.dispose(); pm.dispose();
    return out;
  })();
  scene.add(new THREE.AmbientLight(0x8a7fb0, .2));
  const lights = [[0xff2d95, 60], [0x2f86ff, 60], [0xffffff, 38], [0xb44cff, 40]].map(([c, i]) => { const l = new THREE.PointLight(c, i, 30, 1.6); scene.add(l); return l; });

  /* ---------- placement and the drop ---------- */
  let w = 0, h = 0;
  const geo = { arm: 1, s: 1 };
  let dropAt = calm ? -1e9 : Infinity;
  const dropK = () => {
    const d = (performance.now() - dropAt) / 1000;
    if (d <= 0 || !isFinite(d)) return d > 0 ? 1 : 0;
    return d > 4 ? 1 : 1 - Math.exp(-5.5 * d) * Math.cos(7.5 * d);
  };
  const hangAt = k => {
    const lift = R * geo.s * 1.15, a = -lift + (geo.arm + lift) * k, len = Math.max(.001, a - R * geo.s);
    hang.position.y = -a;
    rod.scale.set(geo.s, len, geo.s); rod.position.y = -len / 2;
  };
  const fit = force => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (force !== true && r.width === w && r.height === h) return;
    w = r.width; h = r.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const unit = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z / h;   // world units per px
    const { cx, cy, rad } = place(w, h, r);
    const s = rad * unit / R, topY = h / 2 * unit + .5, ballY = (h / 2 - cy) * unit;
    pivot.position.set((cx - w / 2) * unit, topY, 0);
    hang.scale.setScalar(s); geo.arm = topY - ballY; geo.s = s; geo.rad = rad;
    hangAt(dropK());
    sizeSpots();
  };

  /* ---------- reflections: light thrown off the mirrors, sweeping across the room as the ball turns ----------
     Each spot is a beam leaving one mirror. It lands on an imaginary wall facing you, so beams pointing at you
     sit near the ball, and beams turning away stretch out and race off the edge, just like the real thing. */
  const sctx = spots ? spots.getContext('2d') : null;
  let sw = 0, sh = 0, sdpr = 1;
  const sizeSpots = () => {
    if (!spots) return;
    sdpr = Math.min(devicePixelRatio || 1, 1.5); sw = innerWidth; sh = innerHeight;
    spots.width = Math.round(sw * sdpr); spots.height = Math.round(sh * sdpr);
  };
  const sprite = color => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.25, color); r.addColorStop(.6, color.replace(/[\d.]+\)$/, '.35)')); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return c;
  };
  const SPRITES = ['rgba(255,255,255,1)', 'rgba(255,255,255,1)', 'rgba(255,255,255,1)', 'rgba(255,140,196,1)', 'rgba(134,184,255,1)', 'rgba(217,166,255,1)'].map(sprite);
  const beams = Array.from({ length: 190 }, () => ({
    lon: Math.random() * Math.PI * 2, lat: (Math.random() * 2 - 1) * 1.05,
    s: 6 + Math.random() * 12, kind: Math.floor(Math.random() * SPRITES.length), tw: Math.random() * 6.28
  }));
  const proj = new THREE.Vector3();
  const drawSpots = (rot, t, k) => {
    if (!sctx) return;
    sctx.setTransform(sdpr, 0, 0, sdpr, 0, 0);
    sctx.clearRect(0, 0, sw, sh);
    const r = canvas.getBoundingClientRect();
    hang.getWorldPosition(proj); proj.project(camera);
    const bx = r.left + (proj.x + 1) / 2 * r.width, by = r.top + (1 - proj.y) / 2 * r.height;
    // fade with how much of the ball is on screen, and only once it has dropped in
    const vis = Math.max(0, Math.min(1, (Math.min(by + (geo.rad || 100), sh) - Math.max(by - (geo.rad || 100), 0)) / (2 * (geo.rad || 100))));
    const amt = vis * Math.max(0, (k - .6) / .4);
    if (amt <= 0) return;
    const F = Math.max(sw, sh) * .55;
    sctx.globalCompositeOperation = 'lighter';
    for (const b of beams) {
      const a = b.lon + rot * 2, cl = Math.cos(b.lat);
      const dx = cl * Math.sin(a), dy = Math.sin(b.lat), dz = cl * Math.cos(a);
      if (dz < .12) continue;
      const x = bx + dx / dz * F, y = by - dy / dz * F + F * .08;
      const stretch = Math.min(3.2, 1 / Math.sqrt(dz)), sz = b.s * (sw < 700 ? .7 : 1);
      if (x < -60 || x > sw + 60 || y < -60 || y > sh + 60) continue;
      const near = Math.hypot(x - bx, y - by) < (geo.rad || 100) * 1.05;   // spots don't land on the ball itself
      if (near) continue;
      sctx.globalAlpha = Math.min(1, amt * Math.pow(dz, .45) * (.75 + .25 * Math.sin(t * 3 + b.tw)));
      sctx.save(); sctx.translate(x, y); sctx.rotate(Math.atan2(dy, dx) * .15); sctx.scale(stretch, 1);
      sctx.drawImage(SPRITES[b.kind], -sz, -sz, sz * 2, sz * 2); sctx.restore();
    }
    sctx.globalAlpha = 1; sctx.globalCompositeOperation = 'source-over';
  };

  fit(true);
  addEventListener('resize', () => fit(true));
  if (document.fonts) document.fonts.ready.then(() => fit(true));
  setTimeout(() => fit(true), 1600);
  canvas.classList.add('on'); if (spots) spots.classList.add('on');
  Promise.resolve(drop).then(() => { if (!calm) dropAt = performance.now() + 150; });

  let px = 0, py = 0, tx = 0, ty = 0;
  addEventListener('pointermove', ev => { tx = ev.clientX / innerWidth - .5; ty = ev.clientY / innerHeight - .5; });
  let visible = true, raf = 0, last = performance.now(), t = 0;
  const at = new THREE.Vector3(), sparkle = new Set(), hot = new THREE.Color(2.6, 2.6, 2.8);
  const frame = now => {
    const dt = Math.min(.05, (now - last) / 1000); last = now; t += dt;
    ball.rotation.y += dt * .22;
    px += (tx - px) * .05; py += (ty - py) * .05;
    const k = dropK(), since = (now - dropAt) / 1000;
    hangAt(k);
    pivot.rotation.z = Math.sin(t * .5) * .012 - px * .06 + (since > 0 && since < 6 ? Math.exp(-1.6 * since) * Math.sin(since * 4.2) * .05 : 0);
    ball.rotation.x = py * .25;
    lights.forEach((l, i) => {
      const a = t * (.35 + i * .07) + i * 1.7;
      l.position.set(Math.cos(a) * 7, Math.sin(a * .8 + i) * 4 + 1, 6 + Math.sin(a) * 2);
      l.position.add(hang.getWorldPosition(at));
    });
    // a few mirrors flash white at a time
    if (Math.random() < .5) sparkle.add({ k: Math.floor(Math.random() * tiles.length), life: 1 });
    for (const sp of sparkle) {
      sp.life -= dt * 2.6;
      col.copy(base[sp.k]).lerp(hot, Math.max(0, Math.min(1, sp.life * 1.4)));
      mirrors.setColorAt(sp.k, col);
      if (sp.life <= 0) { mirrors.setColorAt(sp.k, base[sp.k]); sparkle.delete(sp); }
    }
    mirrors.instanceColor.needsUpdate = true;
    renderer.render(scene, camera);
    drawSpots(ball.rotation.y, t, k);
    if (visible && !calm) raf = requestAnimationFrame(frame);
  };
  new IntersectionObserver(([en]) => {
    visible = en.isIntersecting; fit(true);
    cancelAnimationFrame(raf);
    if (visible) { last = performance.now(); raf = requestAnimationFrame(frame); }
    else if (sctx) sctx.clearRect(0, 0, spots.width, spots.height);
  }).observe(canvas);
  requestAnimationFrame(frame);
}
