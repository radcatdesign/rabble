/* Curtain Call cloth: the velvet stage curtains. One module for the home page loader and the page-to-page transition. */
import * as THREE from './vendor/three.module.js';

const COLS = 72, ROWS = 36, SEAM = .008;
// closed, the panels cross the center a little (left one in front) so no light shows through; it eases out as they part
const OVERLAP = .32, OVER_DEPTH = .85;
class Cloth {
  constructor(side, height) {
    this.side = side; this.height = height; this.count = (COLS + 1) * (ROWS + 1);
    this.positions = new Float32Array(this.count * 3); this.previous = new Float32Array(this.count * 3);
    this.rest = new Float32Array(this.count * 3); this.smooth = new Float32Array(this.count * 3);
    this.links = []; this.grabs = new Map(); this.ready = false; this.hover = null; this.wake = [];
    for (let y = 0; y <= ROWS; y++) for (let x = 0; x <= COLS; x++) {
      const a = y * (COLS + 1) + x;
      for (const [dx, dy, k] of [[1, 0, .85], [0, 1, .95], [1, 1, .45], [-1, 1, .45], [2, 0, .55], [0, 2, .6]])
        if (x + dx >= 0 && x + dx <= COLS && y + dy <= ROWS) this.links.push({ a: a * 3, b: ((y + dy) * (COLS + 1) + x + dx) * 3, k, length: 0 });
    }
  }
  setRest(halfWidth, open, reset = false) {
    const width = halfWidth * (1 - .89 * open), r = this.rest;
    const f = Math.max(0, 1 - open * 5), over = OVERLAP * f;
    this.limit = SEAM - over;
    const lift = this.side < 0 ? OVER_DEPTH * f : 0;
    for (let i = 0; i < this.count; i++) {
      const u = (i % (COLS + 1)) / COLS, v = Math.floor(i / (COLS + 1)) / ROWS, j = i * 3;
      r[j] = this.side * (halfWidth - width + u * width) + this.side * this.limit + this.side * u * over;
      r[j + 1] = this.height * (.5 - v);
      r[j + 2] = Math.sin(u * Math.PI * 18 + .08 * Math.sin(v * 3)) * .36 + Math.sin(u * Math.PI * 36) * .025 + lift * Math.max(0, 1 - u * 3);
    }
    for (const l of this.links) l.length = Math.hypot(r[l.b] - r[l.a], r[l.b + 1] - r[l.a + 1], r[l.b + 2] - r[l.a + 2]);
    if (!this.ready || reset) { this.positions.set(r); this.previous.set(r); this.wake = []; this.ready = true; }
  }
  moveHover(x, y) {
    const prev = this.hover; this.hover = { x, y };
    if (!prev || Math.hypot(x - prev.x, y - prev.y) > .08) { this.wake.push({ x, y, age: 0 }); if (this.wake.length > 7) this.wake.shift(); }
  }
  pin() { for (let j = 0; j < (COLS + 1) * 3; j++) { this.positions[j] = this.rest[j]; this.previous[j] = this.rest[j]; } }
  resolveSeam() {
    const p = this.positions, old = this.previous;
    const lim = this.limit === undefined ? SEAM : this.limit;
    for (let j = 0; j < p.length; j += 3) if (this.side * p[j] < lim) {
      const nv = this.side * (p[j] - old[j]); p[j] = this.side * lim; old[j] = p[j] - this.side * Math.max(0, nv) * .5;
    }
  }
  step(dt, time, wind, sens) {
    const p = this.positions, old = this.previous, r = this.rest;
    for (const w of this.wake) w.age += dt; this.wake = this.wake.filter(w => w.age < 1.4);
    if (!this.grabs.size) {
      for (let i = COLS + 1; i < this.count; i++) {
        const j = i * 3, v = Math.floor(i / (COLS + 1)) / ROWS;
        let brush = 0;
        if (sens > 0) {
          if (this.hover) { const d2 = (r[j] - this.hover.x) ** 2 + (r[j + 1] - this.hover.y) ** 2; brush = -.55 * Math.exp(-d2 / 1.6); }
          brush = Math.max(-1.6, Math.min(.5, brush)) * sens * Math.min(v * 6, 1);
        }
        for (let axis = 0; axis < 3; axis++) {
          const k = j + axis;
          const target = r[k] + (axis === 2 ? brush + wind * .025 * v * Math.sin(time * .8 + v * 3 + (i % (COLS + 1)) / COLS * 4) : 0);
          const vel = (p[k] - old[k]) * .85; old[k] = p[k]; p[k] += vel + (target - p[k]) * 64 * dt * dt;
        }
      }
      this.pin(); this.resolveSeam(); return;
    }
    for (let i = COLS + 1; i < this.count; i++) {
      const j = i * 3, v = Math.floor(i / (COLS + 1)) / ROWS;
      for (let axis = 0; axis < 3; axis++) {
        const k = j + axis;
        const vel = Math.max(-.45, Math.min(.45, (p[k] - old[k]) * .94)); old[k] = p[k];
        const force = (r[k] - p[k]) * (axis === 2 ? 20 : 14) + (axis === 1 ? -2.8 : 0) + (axis === 2 ? wind * (Math.sin(time * .8 + (i % (COLS + 1)) / COLS * 5) + Math.sin(time * .5 + v * 3)) * .45 : 0);
        const hf = this.hover && axis === 2 ? -14 * sens * Math.exp(-((p[j] - this.hover.x) ** 2 + (p[j + 1] - this.hover.y) ** 2) / 1.8) : 0;
        p[k] += vel + (force + hf) * dt * dt;
      }
    }
    for (let it = 0; it < 5; it++) {
      for (const l of this.links) {
        const { a, b } = l, x = p[b] - p[a], y = p[b + 1] - p[a + 1], z = p[b + 2] - p[a + 2], len = Math.hypot(x, y, z);
        if (len < 1e-7) continue;
        const wa = a < (COLS + 1) * 3 ? 0 : 1, wb = b < (COLS + 1) * 3 ? 0 : 1; if (!wa && !wb) continue;
        const f = (len - l.length) / len * l.k / (wa + wb);
        p[a] += x * f * wa; p[a + 1] += y * f * wa; p[a + 2] += z * f * wa; p[b] -= x * f * wb; p[b + 1] -= y * f * wb; p[b + 2] -= z * f * wb;
      }
      for (const g of this.grabs.values()) { const j = g.index * 3; for (let axis = 0; axis < 3; axis++) p[j + axis] += ((axis === 0 ? this.side * Math.max(this.limit === undefined ? SEAM : this.limit, this.side * g.target[axis]) : g.target[axis]) - p[j + axis]) * .78; }
      this.pin(); this.resolveSeam();
    }
    const sm = this.smooth; sm.set(p);
    for (let y = 1; y < ROWS; y++) for (let x = 1; x < COLS; x++) {
      const j = (y * (COLS + 1) + x) * 3;
      for (let axis = 0; axis < 3; axis++) {
        const k = j + axis, R = (COLS + 1) * 3;
        const avg = ((p[k - 3] - r[k - 3]) + (p[k + 3] - r[k + 3]) + (p[k - R] - r[k - R]) + (p[k + R] - r[k + R])) * .25;
        sm[k] = p[k] + (avg - (p[k] - r[k])) * .16;
      }
    }
    const rec = 1 - Math.exp(-dt * (this.grabs.size || this.hover ? 2.2 : 14));
    for (let j = (COLS + 1) * 3; j < p.length; j++) { const next = sm[j] + (r[j] - sm[j]) * rec; old[j] = next - (p[j] - old[j]) * (1 - rec); p[j] = next; }
    this.pin(); this.resolveSeam();
    for (let i = COLS + 1; i < this.count; i++) { const j = i * 3; p[j + 2] = Math.max(-3, Math.min(4, p[j + 2])); }
  }
}


/* mount(host, { mode })
   mode 'intro': the home loader. Full stage, brush and pull, starts closed, open() parts and carries them off.
   mode 'transition': a fixed overlay on any page. start 'closed' (arriving) or 'open' (idle, ready to close). */
export function mount(host, { mode = 'intro', start = 'closed', before = null } = {}) {
  const intro = mode === 'intro';
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('no webgl');
  const canvas = renderer.domElement;
  canvas.className = intro ? 'cloth-canvas' : 'cloth-canvas rr-cloth';
  if (before) host.insertBefore(canvas, before); else host.appendChild(canvas);
  renderer.setPixelRatio(Math.min(devicePixelRatio, intro ? 2 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#080711');
  scene.fog = new THREE.FogExp2('#080711', .022);
  const camera = new THREE.PerspectiveCamera(39, 1, .1, 100); camera.position.set(0, 0, 20); camera.lookAt(0, 0, 0);
  const height = 15.1; let halfWidth = 1;

  // fine, irregular suede nap
  const N = 256, nd = new Uint8Array(N * N * 4); let seed = 731;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const raw = Float32Array.from({ length: N * N }, rnd);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, g = raw[i] * .65 + raw[((y + 1) % N) * N + x] * .23 + raw[((y + 2) % N) * N + x] * .12, val = Math.round(203 + g * 42);
    nd[i * 4] = nd[i * 4 + 1] = nd[i * 4 + 2] = val; nd[i * 4 + 3] = 255;
  }
  const nap = new THREE.DataTexture(nd, N, N, THREE.RGBAFormat);
  nap.wrapS = nap.wrapT = THREE.RepeatWrapping; nap.repeat.set(7, 9); nap.magFilter = THREE.LinearFilter;
  nap.minFilter = THREE.LinearMipmapLinearFilter; nap.generateMipmaps = true; nap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); nap.needsUpdate = true;
  const suede = new THREE.MeshPhysicalMaterial({ color: '#99152f', map: nap, bumpMap: nap, bumpScale: .023, roughness: 1, metalness: 0, sheen: .85,
    sheenColor: new THREE.Color('#99152f').lerp(new THREE.Color('#ffffff'), .3), sheenRoughness: 1, specularIntensity: .12, side: THREE.DoubleSide });

  const panels = [];
  for (const side of [-1, 1]) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, height, COLS, ROWS), suede);
    mesh.frustumCulled = false; scene.add(mesh);
    panels.push({ mesh, side, cloth: new Cloth(side, height) });
  }
  // the stage from Curtain Call: floor, back wall, "Late night" spots with visible beams, footlights
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 70), new THREE.MeshStandardMaterial({ color: '#181522', roughness: .28, metalness: .65 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -7.3, -12); scene.add(floor);
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(80, 35), new THREE.MeshStandardMaterial({ color: '#101323', roughness: .9 }));
  backdrop.position.z = -15; scene.add(backdrop);
  const ambient = new THREE.HemisphereLight('#b0a8d4', '#170915', .35); scene.add(ambient);
  const tints = ['#4168ff', '#e443e7', '#7355ff', '#47b7ff'], spots = [], beams = [];
  tints.forEach((c, i) => {
    const l = new THREE.SpotLight(c, 130, 0, Math.PI / 7, .9, 1);
    l.position.set((i - 1.5) * 6, 10, 8); l.target.position.set((i - 1.5) * 3, -3, 0);
    scene.add(l, l.target); spots.push(l);
    const g = new THREE.ConeGeometry(3.6, 24, 40, 1, true); g.translate(0, -12, 0);
    const m = new THREE.ShaderMaterial({ uniforms: { tint: { value: new THREE.Color(c) }, strength: { value: .055 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 tint;uniform float strength;varying vec2 vUv;void main(){float edge=pow(sin(vUv.x*3.14159265),2.);float fade=pow(vUv.y,1.5);gl_FragColor=vec4(tint,strength*edge*fade);}',
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(g, m); beam.position.set((i - 1.5) * 5, 10, -5); scene.add(beam); beams.push(beam);
  });
  for (let i = 0; i < 13; i++) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.065, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffe2af' }));
    bulb.position.set((i - 6) * 1.8, -7.05, -2.5); scene.add(bulb);
  }
  const fill = new THREE.PointLight('#4168ff', 8, 30); fill.position.set(0, -5, 4); scene.add(fill);


  const bare = () => {
    // the stage drops away so the site shows through as the panels part
    scene.background = null; scene.fog = null; renderer.setClearColor(0x000000, 0);
    [floor, backdrop, ...beams].forEach(o => { o.visible = false; });
    scene.traverse(o => { if (o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry') o.visible = false; });
  };
  if (!intro) bare();

  const away = start === 'open' && !intro;
  const state = { open: away ? 1 : 0, current: away ? 1 : 0, movement: .73, sens: intro ? 1 : 0, intensity: .8, exitT: away ? 1 : 0, gone: away, closing: null };
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
    halfWidth = Math.tan(THREE.MathUtils.degToRad(39 / 2)) * 20 * camera.aspect * 1.035;
    for (const c of panels) c.cloth.setRest(halfWidth, state.current, true);
  };
  addEventListener('resize', resize); resize();

  // brush and pull
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), touches = new Map();
  const cast = e => { ndc.set(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2); ray.setFromCamera(ndc, camera); };
  const hitTest = e => { cast(e); return ray.intersectObjects(panels.map(c => c.mesh))[0]; };
  canvas.addEventListener('pointerleave', () => { for (const c of panels) c.cloth.hover = null; });
  canvas.addEventListener('pointerdown', e => {
    for (const c of panels) c.cloth.hover = null;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const hit = hitTest(e); if (!hit) return;
    const c = panels.find(c => c.mesh === hit.object);
    const x = Math.round(hit.uv.x * COLS), y = Math.max(1, Math.round((1 - hit.uv.y) * ROWS));
    const grab = { index: y * (COLS + 1) + x, target: [hit.point.x, hit.point.y, hit.point.z + .3], plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.point.z), start: hit.point.clone() };
    c.cloth.grabs.set(e.pointerId, grab); touches.set(e.pointerId, { c, grab });
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', e => {
    const a = touches.get(e.pointerId);
    if (!a) {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        const hit = hitTest(e);
        for (const c of panels) { if (hit && hit.object === c.mesh) c.cloth.moveHover(hit.point.x, hit.point.y); else c.cloth.hover = null; }
      }
      return;
    }
    cast(e); const pt = new THREE.Vector3();
    if (ray.ray.intersectPlane(a.grab.plane, pt)) {
      const d = pt.clone().sub(a.grab.start).clampLength(0, 2.5); pt.copy(a.grab.start).add(d);
      a.grab.target = [pt.x, pt.y, a.grab.start.z + .3 + Math.min(d.length() * .12, .35)];
    }
  });
  const release = e => { const a = touches.get(e.pointerId); if (a) { a.c.cloth.grabs.delete(e.pointerId); touches.delete(e.pointerId); } };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => canvas.addEventListener(n, release));


  let raf = 0, last = performance.now() / 1000, acc = 0, t = 0, first = true, readyFn;
  const ready = new Promise(r => { readyFn = r; });
  const place = () => { const e = state.exitT * state.exitT * (3 - 2 * state.exitT); for (const c of panels) c.mesh.position.x = c.side * e * halfWidth * .5; };
  place();
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now() / 1000, dt = Math.min(now - last, .05); last = now; t += dt;
    const closing = !!state.closing;
    state.current += (state.open - state.current) * (1 - Math.exp(-dt * (closing ? 5.5 : 3.2)));
    // once the panels are mostly gathered, carry them on past the screen edges
    if (state.open === 1 && state.current > .55 && !state.gone) {
      state.exitT = Math.min(1, state.exitT + dt / 1.1); place();
      if (state.exitT >= 1) { state.gone = true; if (intro) dispatchEvent(new Event('cloth-gone')); else rest(); }
    }
    // closing runs it backwards: in from the edges, then drawn together
    if (closing) {
      state.exitT = Math.max(0, state.exitT - dt / .55); place();
      if (state.exitT === 0 && state.current < .025) { const done = state.closing; state.closing = null; state.current = 0; for (const c of panels) c.cloth.setRest(halfWidth, 0); renderer.render(scene, camera); done(); }
    }
    for (const c of panels) c.cloth.setRest(halfWidth, state.current);
    acc += dt;
    while (acc >= 1 / 60) { for (const c of panels) c.cloth.step(1 / 60, t, state.movement, state.sens); acc -= 1 / 60; }
    for (const { mesh, cloth } of panels) {
      const g = mesh.geometry; g.attributes.position.array.set(cloth.positions); g.attributes.position.needsUpdate = true; g.computeVertexNormals();
    }
    ambient.intensity = .16 + state.intensity * .24; fill.intensity = state.intensity * 10;
    spots.forEach((l, i) => {
      const aimX = (i - 1.5) * halfWidth * .45 + Math.sin(t * .6 + i * 1.8) * halfWidth * .5 * state.movement;
      l.position.x = (i - 1.5) * halfWidth * .56; l.target.position.set(aimX, Math.sin(t * .45 + i) * 2 * state.movement - 1, 0); l.intensity = state.intensity * 190;
      const beam = beams[i]; beam.position.x = (i - 1.5) * halfWidth * .6;
      const aim = new THREE.Vector3(aimX, -7, -6);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim.sub(beam.position).normalize());
      beam.material.uniforms.strength.value = state.intensity * .1;
    });
    renderer.render(scene, camera);
    if (first) { first = false; canvas.classList.add('is-live'); readyFn(); if (intro) dispatchEvent(new Event('cloth-ready')); }
  };
  // a transition overlay only draws while it's moving
  const run = () => { if (!raf) { last = performance.now() / 1000; frame(); } };
  const rest = () => { cancelAnimationFrame(raf); raf = 0; canvas.classList.remove('is-live', 'is-on'); };
  if (!away) run(); else readyFn();

  const api = {
    live: true, canvas, ready,
    open() {
      if (intro) { bare(); host.style.background = 'transparent'; }
      state.gone = false; state.closing = null;
      state.open = 1; for (const c of panels) { c.cloth.grabs.clear(); c.cloth.hover = null; } touches.clear(); run();
    },
    // draws them shut; resolves once they meet, with a still of the closed curtains for the next page to start on
    close() {
      return new Promise(res => {
        state.open = 0; state.gone = false;
        if (state.exitT === 0 && state.current < .025) { renderer.render(scene, camera); return res(); }
        state.closing = res; canvas.classList.add('is-live', 'is-on'); run();
      });
    },
    still(q = .8) { try { renderer.render(scene, camera); return canvas.toDataURL('image/jpeg', q); } catch (_) { return ''; } },
    hide() { state.closing = null; state.open = 1; state.current = 1; state.exitT = 1; state.gone = true; place(); rest(); },
    dispose() { if (this.gone) return; this.gone = true; cancelAnimationFrame(raf); removeEventListener('resize', resize); renderer.dispose(); suede.dispose(); nap.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); canvas.remove(); }
  };
  return api;
}
