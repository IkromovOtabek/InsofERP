/* eslint-disable -- dizayn paketidan (design_handoff_insof_landing/insof-world.js) deyarli o'zgarishsiz: faqat three importi, logotip yo'li va kanvas shrifti (FONT). */
import * as THREE from 'three';

export const CYCLE = 16;

/** Kanvas yozuvlari shrifti — `mountWorld(el, { font })` (Next `next/font` oilasi nomi), standart Archivo. */
let FONT = 'Archivo, Helvetica, sans-serif';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const STATIONS = [
  { t: [26, 0, 12], s: 56, az: 0.78, el: 0.32, steps: [V(-29, 12, 41), V(-36, 22, -9), V(60, 14, 48), V(298, 30, 6)] },
  { t: [-27.9, 1.5, 55.5], s: 18, az: 0.85, el: 0.42, steps: [V(-17, 4.2, 58), V(-23.6, 0.9, 47.95), V(-23.6, 4.6, 47.95), V(-23.6, 7.6, 47.95), V(-23.6, 10.9, 47.95)] },
  { t: [-42, 5, -4], s: 21, az: 0.62, steps: [V(-40, 4, 12), V(-46, 17, -20), V(-36, 6, -9), V(-24, 3, -9)] },
  { t: [4, 3, -7], s: 18, az: 0.95, steps: [V(-7, 3, -9), V(-1, 3, -5), V(6, 3, -5), V(16, 5, -5)] },
  { t: [42, 4, -3], s: 20, az: 0.7, steps: [V(34, 3, 6), V(42, 3, -2), V(42, 3, -2), V(40, 4, -13)] },
  { t: [58, 3, 50], s: 27, az: 0.85, steps: [V(47, 5, 56), V(82, 9, 44), V(62, 13, 48), V(40, 5, 68)] },
  { t: [313, 8, 15], s: 24, az: 0.72, el: 0.48, steps: [V(314, 6.5, 14.5), V(300, 24, 6), V(290, 13, 28), V(317.5, 8.5, 14.8)] },
];

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const seg = (c, a, b) => clamp01((c - a) / (b - a));
const lerp = (a, b, u) => a + (b - a) * u;
const RAIL_X = -91;

function canvasTex(size, fn, rx = 1, ry = rx, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  fn(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(ctx, s, base, amp, blobs, ba) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < blobs; i++) {
    const x = rnd() * s, y = rnd() * s, r = s * (0.02 + rnd() * 0.12), d = rnd() < 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, d ? `rgba(0,0,0,${ba})` : `rgba(255,255,255,${ba})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const im = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < im.data.length; i += 4) { const n = (rnd() - 0.5) * amp; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; }
  ctx.putImageData(im, 0, 0);
}

const OW = { t: [-27.9, 1.5, 55.5], s: 18, az: 0.85, el: 0.42 }, OC = { t: [-29, 5.5, 41], s: 11.5, az: 0.62, el: 0.34 };
export function mountWorld(el, opts = {}) {
  if (opts.font) FONT = opts.font;
  const LITE = opts.lite ?? ((matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900) || (navigator.deviceMemory || 8) <= 4);
  const SHADOW = LITE ? 1024 : 2048;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !LITE, powerPreference: 'high-performance' });
  const PR_MAX = Math.min(devicePixelRatio, LITE ? 1.25 : 2), PR_MIN = LITE ? 0.85 : 1.25; let pr = PR_MAX; renderer.setPixelRatio(pr);
  let slowFrames = 0, fastFrames = 0;
  renderer.setSize(el.clientWidth || 1, el.clientHeight || 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = LITE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.domElement.style.display = 'block';
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const HORIZON = '#e8e6d8';
  const skyCanvas = document.createElement('canvas'); skyCanvas.width = 4; skyCanvas.height = 256;
  const skyTex = new THREE.CanvasTexture(skyCanvas); skyTex.colorSpace = THREE.SRGBColorSpace;
  const paintSky = (top, mid, hor) => { const x = skyCanvas.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, top); g.addColorStop(0.45, mid); g.addColorStop(0.75, hor); g.addColorStop(1, hor); x.fillStyle = g; x.fillRect(0, 0, 4, 256); skyTex.needsUpdate = true; };
  paintSky('#5f9ad8', '#aacbe8', HORIZON);
  scene.background = skyTex;
  scene.fog = new THREE.Fog(new THREE.Color(HORIZON), 200, 500);
  const cam = new THREE.PerspectiveCamera(28, 1, 1, 3000);

  // environment for reflections
  {
    const pm = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    const sg = new THREE.SphereGeometry(50, 32, 16);
    const cols = [];
    const pa = sg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const y = pa.getY(i) / 50; const c = new THREE.Color(y > 0 ? '#cfe0ee' : '#8d8a80').lerp(new THREE.Color('#f4f1ea'), 1 - Math.abs(y)); cols.push(c.r, c.g, c.b); }
    sg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    es.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    sb.position.set(20, 40, 10); sb.lookAt(0, 0, 0); es.add(sb);
    scene.environment = pm.fromScene(es, 0.04).texture;
  }

  const hemi = new THREE.HemisphereLight('#e4eefb', '#8a8577', 0.65);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d8', 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW, SHADOW);
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 500 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.08;
  scene.add(sun, sun.target);

  // textures
  const T = {
    bump: canvasTex(256, (c, s) => { const d = c.createImageData(s, s); for (let i = 0; i < d.data.length; i += 4) { const v = 110 + Math.random() * 90; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } c.putImageData(d, 0, 0); c.filter = 'blur(1px)'; c.globalAlpha = 0.6; c.drawImage(c.canvas, 0, 0); }, 1, 1, false),
    scratch: canvasTex(512, (c, s) => { c.fillStyle = '#d8d8d8'; c.fillRect(0, 0, s, s); for (let i = 0; i < 900; i++) { const g = (170 + Math.random() * 85) | 0, x = Math.random() * s, y = Math.random() * s, a = Math.random() * Math.PI, l = 6 + Math.random() * 40; c.strokeStyle = 'rgba(' + g + ',' + g + ',' + g + ',0.55)'; c.lineWidth = 0.3 + Math.random() * 1.2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); } }, 2, 2, false),
    wood: canvasTex(256, (c, s) => { c.fillStyle = '#8a6744'; c.fillRect(0, 0, s, s); for (let y = 0; y < s; y++) { const v = Math.sin(y * 0.35 + Math.sin(y * 0.05) * 3) * 0.5 + 0.5; c.fillStyle = 'rgba(60,38,20,' + (0.08 + v * 0.18) + ')'; c.fillRect(0, y, s, 1); } for (let i = 0; i < 40; i++) { c.fillStyle = 'rgba(255,230,200,0.05)'; c.fillRect(0, Math.random() * s, s, 1 + Math.random() * 2); } }),
    rim: canvasTex(128, (c) => { c.fillStyle = '#b9bec2'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#5b6066'; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; c.beginPath(); c.arc(64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36, 8, 0, Math.PI * 2); c.fill(); } c.fillStyle = '#8b9096'; c.beginPath(); c.arc(64, 64, 18, 0, Math.PI * 2); c.fill(); c.fillStyle = '#3d4247'; for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; c.beginPath(); c.arc(64 + Math.cos(a) * 11, 64 + Math.sin(a) * 11, 2.5, 0, Math.PI * 2); c.fill(); } }),
    alloy: canvasTex(128, (c) => { c.fillStyle = '#2a2d31'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#c3c8cc'; c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill(); c.fillStyle = '#25282c'; for (let k = 0; k < 5; k++) { const a0 = (k / 5) * Math.PI * 2 + 0.28, a1 = a0 + 0.7; c.beginPath(); c.moveTo(64 + Math.cos(a0) * 18, 64 + Math.sin(a0) * 18); c.arc(64, 64, 54, a0, a1); c.lineTo(64 + Math.cos(a1) * 18, 64 + Math.sin(a1) * 18); c.closePath(); c.fill(); } c.fillStyle = '#9aa0a5'; c.beginPath(); c.arc(64, 64, 12, 0, Math.PI * 2); c.fill(); }),
    concrete: canvasTex(512, (c, s) => speckle(c, s, '#b7b5af', 8, 30, 0.025)),
    gravel: canvasTex(512, (c, s) => speckle(c, s, '#aaa397', 18, 50, 0.03), 36),
    grass: canvasTex(512, (c, s) => speckle(c, s, '#98995a', 14, 60, 0.035), 180),
    asphalt: canvasTex(512, (c, s) => speckle(c, s, '#505254', 12, 20, 0.025)),
    sand: canvasTex(256, (c, s) => speckle(c, s, '#c4ad84', 26, 40, 0.06), 2),
    stone: canvasTex(256, (c, s) => speckle(c, s, '#8f8b84', 34, 40, 0.07), 2),
    corr: canvasTex(256, (c, s) => {
      for (let x = 0; x < s; x++) { const v = 200 + Math.round(Math.sin((x / s) * Math.PI * 16) * 34); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, 0, 1, s); }
    }),
    curtain: canvasTex(256, (c, s) => {
      const g = c.createLinearGradient(0, 0, s, s); g.addColorStop(0, '#5b7080'); g.addColorStop(1, '#2a3944');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
      c.fillStyle = '#c9cfd2'; for (let x = 0; x < s; x += 32) c.fillRect(x, 0, 3, s); for (let y = 0; y < s; y += 64) c.fillRect(0, y, s, 5);
    }),
    lit: canvasTex(256, (c, s) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 32) for (let y = 0; y < s; y += 64) if (rnd() > 0.35) { c.fillStyle = rnd() > 0.5 ? '#ffd9a0' : '#fff1d6'; c.fillRect(x + 4, y + 7, 26, 54); }
    }),
    dot: canvasTex(64, (c, s) => { const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, s, s); }, 1, 1, false),
  };

  const allMats = [], accentClones = [];
  const mk = (o) => { const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.8, metalness: 0, envMapIntensity: 0.8 }, o)); allMats.push(m); return m; };
  const texMat = (tex, rx, ry, o) => { const t = tex.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return mk(Object.assign({ map: t }, o)); };
  const M = {
    acc: mk({ color: '#e8622a', roughness: 0.45, metalness: 0.25 }),
    concrete: mk({ color: '#ffffff', map: T.concrete, roughness: 0.92 }),
    concreteDk: mk({ color: '#d6d4cf', map: T.concrete, roughness: 0.92 }),
    steel: mk({ color: '#7d848a', roughness: 0.42, metalness: 0.75 }),
    steelDk: mk({ color: '#4a5056', roughness: 0.5, metalness: 0.7 }),
    galv: mk({ color: '#c9ced3', roughness: 0.32, metalness: 0.85 }),
    dark: mk({ color: '#26292c', roughness: 0.7, metalness: 0.2 }),
    tire: mk({ color: '#1c1d1f', roughness: 0.9, side: THREE.DoubleSide }),
    rim: mk({ color: '#b9bec2', roughness: 0.35, metalness: 0.8 }),
    glass: mk({ color: '#22303a', roughness: 0.06, metalness: 0.9, envMapIntensity: 1.2 }),
    white: mk({ color: '#ecebe7', roughness: 0.5, metalness: 0.1 }),
    rust: mk({ color: '#7e5440', roughness: 0.75, metalness: 0.4 }),
    yellow: mk({ color: '#d9a21b', roughness: 0.5, metalness: 0.2 }),
    sand: mk({ color: '#ffffff', map: T.sand, roughness: 1 }),
    stone: mk({ color: '#ffffff', map: T.stone, roughness: 1 }),
    lamp: mk({ color: '#eeeeee', emissive: '#fff4dc', emissiveIntensity: 0 }),
    wet: mk({ color: '#8f8c86', map: T.concrete, roughness: 0.25, metalness: 0.05 }),
  };
  const curtainMat = mk({ color: '#ffffff', map: T.curtain, roughness: 0.12, metalness: 0.7, emissive: '#ffffff', emissiveMap: T.lit, emissiveIntensity: 0, envMapIntensity: 1.3 });
  const corrC = T.corr.clone(); corrC.repeat.set(5, 1); corrC.needsUpdate = true;
  const contAcc = mk({ color: '#e8622a', map: corrC, roughness: 0.55, metalness: 0.3 }); accentClones.push(contAcc);
  const contCols = [contAcc, ...['#2f3d49', '#8b9198', '#6b4a3a', '#d7d9db'].map((c) => mk({ color: c, map: corrC, roughness: 0.55, metalness: 0.3 }))];

  const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat, x, y, z, p = scene) => { const m = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y + h / 2, z); p.add(m); return m; };
  const cyl = (rt, rb, h, mat, x, y, z, p = scene, seg = 28) => { const m = sh(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)); m.position.set(x, y + h / 2, z); p.add(m); return m; };
  const beamBetween = (a, b, r, mat, p = scene) => { const d = b.clone().sub(a), L = d.length(); const m = sh(new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 10), mat)); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); p.add(m); return m; };
  const updaters = [];
  const nightOnly = [];
  const reveals = [];
  const reveal = (st, min, meshes) => { meshes.forEach((m) => { m.material.transparent = true; m.material.needsUpdate = true; }); reveals.push({ st, min, meshes, vis: 0, op: 1 }); };
  const aoTex = canvasTex(128, (c, s) => { const g = c.createRadialGradient(s / 2, s / 2, s * 0.08, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, s, s); }, 1, 1, false);
  aoTex.wrapS = aoTex.wrapT = THREE.ClampToEdgeWrapping;
  const aoMat = new THREE.MeshBasicMaterial({ map: aoTex, color: '#000000', transparent: true, opacity: 0.36, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const ao = (w, d, x, z, y = 0.23, p = scene, op) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.45, d * 1.45), op ? aoMat.clone() : aoMat); if (op) m.material.opacity = op; m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.renderOrder = 1; p.add(m); return m; };

  // particles
  const VS = 'attribute float aA; attribute float aS; varying float vA; uniform float scale; void main(){ vA=aA; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=aS*scale/(-mv.z); gl_Position=projectionMatrix*mv; }';
  const FS = 'uniform sampler2D map; uniform vec3 color; varying float vA; void main(){ vec4 t=texture2D(map,gl_PointCoord); if(t.a*vA<0.01) discard; gl_FragColor=vec4(color,t.a*vA); }';
  const systems = [];
  function particles(n, color, size, { additive = false, peak = 1, grav = 0, grow = 0, drag = 0 } = {}) {
    const pos = new Float32Array(n * 3), a = new Float32Array(n), s = new Float32Array(n), vel = new Float32Array(n * 3), life = new Float32Array(n), age = new Float32Array(n).fill(1e9);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aA', new THREE.BufferAttribute(a, 1)); g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
    const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: T.dot }, color: { value: new THREE.Color(color) }, scale: { value: 300 } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
    let k = 0;
    const sys = {
      mat,
      spawn(x, y, z, vx, vy, vz, l) { const i = k++ % n; pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz; life[i] = l; age[i] = 0; },
      update(dt) {
        const dk = Math.exp(-drag * dt);
        for (let i = 0; i < n; i++) {
          if (age[i] >= life[i]) { a[i] = 0; continue; }
          age[i] += dt; vel[i * 3 + 1] -= grav * dt; vel[i * 3] *= dk; vel[i * 3 + 1] *= dk; vel[i * 3 + 2] *= dk;
          pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
          const t = age[i] / life[i]; a[i] = peak * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85); s[i] = size * (1 + grow * t);
        }
        g.attributes.position.needsUpdate = g.attributes.aA.needsUpdate = g.attributes.aS.needsUpdate = true;
      },
    };
    systems.push(sys); return sys;
  }
  const steam = particles(320, '#f4f4f2', 2.6, { peak: 0.32, grow: 2.2, drag: 0.6 });
  const dust = particles(300, '#cdbf9f', 1.6, { peak: 0.28, grow: 1.6, drag: 1.2 });
  const sparks = particles(400, '#ffb15a', 0.22, { additive: true, grav: 9, drag: 0.4 });
  const pour = particles(220, '#8a8781', 0.55, { peak: 0.95, grav: 9 });
  const burst = (sys, p, n, spd, up, life) => { for (let i = 0; i < n; i++) sys.spawn(p.x, p.y, p.z, (rnd() - 0.5) * spd, rnd() * up, (rnd() - 0.5) * spd, life * (0.6 + rnd() * 0.6)); };

  // ground
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), mk({ color: '#ffffff', map: T.grass, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; scene.add(grass);
  box(190, 0.1, 112, mk({ color: '#ffffff', map: T.gravel, roughness: 1 }), 2, 0, 8).castShadow = false;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1800, 260), mk({ color: '#3e5b66', roughness: 0.1, metalness: 0.2, envMapIntensity: 1.4 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.4, 228); water.receiveShadow = true; scene.add(water);
  box(1800, 1.2, 4, M.concreteDk, 0, -1, 97);
  const pad = (x0, x1, z0, z1) => { const m = box(x1 - x0, 0.18, z1 - z0, texMat(T.concrete, (x1 - x0) / 16, (z1 - z0) / 16, { roughness: 0.9, color: '#e9e7e2' }), (x0 + x1) / 2, 0, (z0 + z1) / 2); m.castShadow = false; };
  pad(-64, -22, -26, 18); pad(-16, 26, -22, 6); pad(28, 64, -22, 12); pad(36, 88, 30, 62); pad(-48, -10, 28, 56);

  // road
  const loop = new THREE.CatmullRomCurve3([[-76, -30], [0, -34], [78, -30], [86, 16], [40, 22], [0, 20], [-40, 23], [-80, 15]].map(([x, z]) => V(x, 0, z)), true, 'centripetal');
  const clientRoad = new THREE.CatmullRomCurve3([[84, 17], [100, 17], [126, 17], [142, 17.6], [158, 22.5], [172, 31], [188, 37], [204, 34], [218, 24], [232, 13.5], [247, 9.5], [260, 13], [268, 16.6], [280, 17]].map(([x, z]) => V(x, 0, z)), false, 'centripetal');
  const roadLane = (u, side) => { const p = clientRoad.getPointAt(u), t = clientRoad.getTangentAt(u); return V(p.x - t.z * 1.75 * side, 0.21, p.z + t.x * 1.75 * side); };
  const roadU = (x) => { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (clientRoad.getPointAt(m).x < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  {
    const N = 600, W = 7, pos = [], uv = [], idx = [], L = loop.getLength();
    const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.03, 2), M.white, 200); let dn = 0; const o = new THREE.Object3D();
    for (let i = 0; i <= N; i++) {
      const u = (i / N) % 1, p = loop.getPointAt(u), tg = loop.getTangentAt(u), nx = -tg.z, nz = tg.x;
      pos.push(p.x + nx * W / 2, 0.21, p.z + nz * W / 2, p.x - nx * W / 2, 0.21, p.z - nz * W / 2);
      uv.push(0, (i / N) * L / 7, 1, (i / N) * L / 7);
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      if (i % 3 === 0 && dn < 200) { o.position.set(p.x, 0.23, p.z); o.lookAt(p.x + tg.x, 0.23, p.z + tg.z); o.updateMatrix(); dashes.setMatrixAt(dn++, o.matrix); }
    }
    dashes.count = dn; scene.add(dashes);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mk({ color: '#ffffff', map: T.asphalt, roughness: 0.95, side: THREE.DoubleSide })); m.receiveShadow = true; scene.add(m);
    // street lamps
    for (let i = 0; i < 26; i++) {
      const u = i / 26, p = loop.getPointAt(u), tg = loop.getTangentAt(u), nx = -tg.z, nz = tg.x;
      const x = p.x + nx * 5, z = p.z + nz * 5;
      cyl(0.09, 0.12, 7, M.steelDk, x, 0, z, scene, 8);
      const arm = box(0.12, 0.12, 1.8, M.steelDk, x, 6.9, z); arm.lookAt(p.x, 7, p.z); arm.position.set(x - nx * 0.8, 6.96, z - nz * 0.8);
      const head = box(0.5, 0.16, 0.9, M.lamp, x - nx * 1.6, 6.85, z - nz * 1.6); head.lookAt(p.x, 6.9, p.z);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ map: T.dot, color: '#ffcf8a', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(x - nx * 2, 0.26, z - nz * 2); glow.visible = false; scene.add(glow); nightOnly.push(glow);
    }
  }

  // vehicles
  const G = { wheel: new THREE.LatheGeometry([[0.3, -0.21], [0.43, -0.21], [0.5, -0.19], [0.52, -0.14], [0.52, 0.14], [0.5, 0.19], [0.43, 0.21], [0.3, 0.21]].map(([r, y]) => new THREE.Vector2(r, y)), 28), rim: new THREE.CylinderGeometry(0.3, 0.3, 0.06, 16), hub: new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12), rail: new THREE.CylinderGeometry(0.5, 0.5, 0.2, 18) };
  const redLamp = mk({ color: '#b3261e', emissive: '#ff3b2f', emissiveIntensity: 0.3, roughness: 0.4 });
  const rimM = mk({ color: '#ffffff', map: T.rim, roughness: 0.38, metalness: 0.75 });
  const truckPaint = LITE ? new THREE.MeshStandardMaterial({ color: '#ecebe7', roughness: 0.3, metalness: 0.15, envMapIntensity: 1.1 }) : new THREE.MeshPhysicalMaterial({ color: '#ecebe7', roughness: 0.32, metalness: 0.15, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1.1 }); allMats.push(truckPaint);
  const wheels = (g, zs, w = 1.2) => zs.forEach((z) => [-w, w].forEach((x) => {
    const s = Math.sign(x), wg = new THREE.Group(); wg.position.set(x, 0.52, z); g.add(wg); (g.userData.wheels = g.userData.wheels || []).push(wg); g.userData.wr = 0.52;
    const t = sh(new THREE.Mesh(G.wheel, M.tire)); t.rotation.z = Math.PI / 2; wg.add(t);
    const r = new THREE.Mesh(G.rim, rimM); r.rotation.z = Math.PI / 2; r.position.x = s * 0.21; wg.add(r);
    const h = new THREE.Mesh(G.hub, M.steelDk); h.rotation.z = Math.PI / 2; h.position.x = s * 0.25; wg.add(h);
  }));
  // vehicle dynamics: wheels roll with distance, body pitches on acceleration/braking and leans in corners
  const _dvT = V(0, 0, 0), clampS = (v, m) => Math.max(-m, Math.min(m, v));
  const drive = (v, dt) => {
    const u = v.userData; v.getWorldDirection(_dvT);
    if (!u.dyn) { u.dyn = { px: v.position.x, pz: v.position.z, sp: 0, yaw: Math.atan2(_dvT.x, _dvT.z), pitch: 0, roll: 0 }; return; }
    const d = u.dyn, dx = v.position.x - d.px, dz = v.position.z - d.pz; d.px = v.position.x; d.pz = v.position.z;
    if (Math.hypot(dx, dz) > 8 || dt <= 0) { d.sp = 0; d.yaw = Math.atan2(_dvT.x, _dvT.z); return; }
    const sd = dx * _dvT.x + dz * _dvT.z, sp = sd / dt, acc = (sp - d.sp) / dt; d.sp += (sp - d.sp) * 0.5;
    if (u.wheels) for (const wh of u.wheels) wh.rotation.x += sd / u.wr;
    const yaw = Math.atan2(_dvT.x, _dvT.z); let dy = yaw - d.yaw; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI; d.yaw = yaw;
    const k = 1 - Math.exp(-dt * 4);
    d.pitch += (clampS(-acc * 0.004, 0.03) - d.pitch) * k; d.roll += (clampS((dy / dt) * sp * 0.0025, 0.03) - d.roll) * k;
    v.rotateX(d.pitch); v.rotateZ(d.roll);
  };
  const rbCache = {};
  const roundBox = (w, h, d, mat, x, y, z, p, r) => {
    const key = w + ',' + h + ',' + d + ',' + r; let geo = rbCache[key];
    if (!geo) {
      const b = r * 0.5, rr = r - b, dd = d / 2 - b, hh = h / 2 - b, s = new THREE.Shape();
      s.moveTo(-dd, -hh + rr); s.lineTo(-dd, hh - rr); s.quadraticCurveTo(-dd, hh, -dd + rr, hh); s.lineTo(dd - rr, hh); s.quadraticCurveTo(dd, hh, dd, hh - rr); s.lineTo(dd, -hh + rr); s.quadraticCurveTo(dd, -hh, dd - rr, -hh); s.lineTo(-dd + rr, -hh); s.quadraticCurveTo(-dd, -hh, -dd, -hh + rr);
      geo = new THREE.ExtrudeGeometry(s, { depth: w - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 5 }); geo.translate(0, 0, -(w - 2 * b) / 2); geo.rotateY(Math.PI / 2); rbCache[key] = geo;
    }
    const m = sh(new THREE.Mesh(geo, mat)); m.position.set(x, y + h / 2, z); p.add(m); return m;
  };
  function cab(g, z, color = truckPaint) {
    roundBox(2.5, 2.4, 2.2, color, 0, 0.9, z, g, 0.16);
    box(2.36, 0.95, 0.05, M.glass, 0, 2.1, z + 1.1, g);
    box(2.52, 0.95, 1.2, M.glass, 0, 2.1, z + 0.3, g);
    box(2.54, 0.14, 2.22, M.acc, 0, 1.55, z, g);
    box(2.5, 0.35, 0.2, M.dark, 0, 0.6, z + 1.12, g);
    box(1.5, 0.5, 0.06, M.dark, 0, 1.0, z + 1.12, g);
    [0.92, 1.08, 1.24, 1.4].forEach((y) => box(1.4, 0.03, 0.07, M.galv, 0, y, z + 1.13, g));
    [-0.95, 0.95].forEach((x) => box(0.38, 0.18, 0.06, M.lamp, x, 1.05, z + 1.12, g));
    [-1.38, 1.38].forEach((x) => { box(0.05, 0.05, 0.5, M.dark, x, 2.35, z + 0.75, g); box(0.1, 0.36, 0.22, M.dark, x, 2.1, z + 1.0, g); });
    box(2.4, 0.12, 0.5, color, 0, 3.3, z + 0.95, g);
    [-0.7, 0, 0.7].forEach((x) => box(0.25, 0.1, 0.1, M.lamp, x, 3.32, z + 0.5, g));
    cyl(0.07, 0.07, 2.4, M.galv, 1.15, 0.9, z - 1.2, g, 10);
    [-1.05, 1.05].forEach((x) => box(0.55, 0.08, 0.5, M.galv, x, 0.42, z + 0.4, g));
    const tank = cyl(0.3, 0.3, 1.3, M.galv, -1.3, 0.55, z - 1.9, g, 14); tank.rotation.x = Math.PI / 2;
  }
  function mixer() {
    const g = new THREE.Group();
    box(2.2, 0.45, 7.2, M.dark, 0, 0.6, -0.4, g); cab(g, 2.5);
    [-1.3, 1.3].forEach((x) => box(0.3, 0.12, 2.9, M.dark, x, 1.06, -2.0, g));
    const piv = new THREE.Group(); piv.position.set(0, 2.55, -1.2); piv.rotation.x = Math.PI / 2 - 0.2; g.add(piv);
    const prof = [[0.35, -2.4], [0.95, -1.9], [1.3, -0.7], [1.3, 0.3], [0.95, 1.6], [0.5, 2.2], [0.45, 2.4]].map(([r, y]) => new THREE.Vector2(r, y));
    const drum = sh(new THREE.Mesh(new THREE.LatheGeometry(prof, 36), truckPaint)); piv.add(drum);
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.07, 8, 40), M.acc); band.rotation.x = Math.PI / 2; band.position.y = -0.2; drum.add(band);
    const band2 = band.clone(); band2.position.y = 0.3; drum.add(band2);
    const band3 = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 8, 40), M.steelDk); band3.rotation.x = Math.PI / 2; band3.position.y = -1.6; drum.add(band3);
    const tank = cyl(0.45, 0.45, 1.1, M.white, 0, 2.2, 1.0, g, 16); tank.rotation.x = Math.PI / 2;
    box(2.2, 2.0, 0.15, M.steelDk, 0, 1.05, -4.0, g);
    cyl(0.04, 0.04, 2.2, M.galv, -0.9, 1.0, -4.12, g, 8); cyl(0.04, 0.04, 2.2, M.galv, -0.5, 1.0, -4.12, g, 8);
    for (let y = 1.3; y < 3.1; y += 0.35) box(0.4, 0.04, 0.04, M.galv, -0.7, y, -4.12, g);
    const chute = box(0.5, 0.1, 1.4, M.galv, 0.6, 1.5, -4.5, g); chute.rotation.x = -0.6;
    box(0.7, 0.3, 1.2, M.steelDk, 0, 2.6, -3.9, g).rotation.x = 0.5;
    [-0.9, 0.9].forEach((x) => box(0.2, 0.12, 0.06, redLamp, x, 0.7, -4.1, g));
    wheels(g, [2.3, -1.4, -2.7]);
    g.userData.drum = drum; return g;
  }
  function flatbed(load) {
    const g = new THREE.Group();
    box(2.2, 0.45, 9, M.dark, 0, 0.6, 0, g); cab(g, 3.3, load === 'c' ? M.white : mk({ color: '#c9ccce', roughness: 0.4, metalness: 0.4 }));
    box(2.5, 0.25, 6.4, M.steelDk, 0, 1.05, -1.2, g);
    box(2.5, 1.2, 0.08, M.steelDk, 0, 1.3, 2.0, g);
    [-1.22, 1.22].forEach((x) => box(0.06, 0.3, 6.4, M.steelDk, x, 1.3, -1.2, g));
    let top = 1.3;
    if (load === 'steel') { for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) box(0.5, 0.5, 6, M.steel, -0.8 + i * 0.53, 1.3 + j * 0.52, -1.2, g); top = 2.34; }
    else if (load === 'panel') { for (let j = 0; j < 4; j++) box(2.3, 0.3, 6, M.concrete, 0, 1.3 + j * 0.32, -1.2, g); top = 2.56; }
    else if (load === 'c') { box(2.45, 2.6, 6.1, contCols[(rnd() * 5) | 0], 0, 1.3, -1.2, g); top = 3.9; }
    if (load === 'steel' || load === 'panel') [-3.4, -1.2, 1.0].forEach((z) => { box(2.56, 0.04, 0.08, M.dark, 0, top, z, g); [-1.26, 1.26].forEach((x) => box(0.04, top - 1.05, 0.08, M.dark, x, 1.05, z, g)); });
    [-1.2, 1.2].forEach((x) => box(0.35, 0.5, 0.04, M.dark, x, 0.2, -4.45, g));
    [-0.9, 0.9].forEach((x) => box(0.2, 0.12, 0.06, redLamp, x, 0.75, -4.5, g));
    wheels(g, [3.3, -2.6, -3.8]); return g;
  }
  function craneRig(C, mastH, jibLen, cjLen, mat, parent = scene) {
    box(3.6, 1.2, 3.6, M.concreteDk, C.x, 0.18, C.z, parent);
    const m = 0.6;
    for (let i = 0; i < 4; i++) box(0.16, mastH, 0.16, mat, C.x + (i % 2 ? m : -m), 1.4, C.z + (i < 2 ? m : -m), parent);
    for (let y = 2; y < mastH; y += 1.5) {
      box(2 * m, 0.08, 0.08, mat, C.x, y, C.z + m, parent); box(2 * m, 0.08, 0.08, mat, C.x, y, C.z - m, parent); box(0.08, 0.08, 2 * m, mat, C.x + m, y, C.z, parent); box(0.08, 0.08, 2 * m, mat, C.x - m, y, C.z, parent);
      beamBetween(V(C.x - m, y, C.z + m), V(C.x + m, y + 1.5, C.z + m), 0.035, mat, parent); beamBetween(V(C.x - m, y, C.z - m), V(C.x + m, y + 1.5, C.z - m), 0.035, mat, parent);
      beamBetween(V(C.x + m, y, C.z - m), V(C.x + m, y + 1.5, C.z + m), 0.035, mat, parent); beamBetween(V(C.x - m, y, C.z - m), V(C.x - m, y + 1.5, C.z + m), 0.035, mat, parent);
    }
    const jib = new THREE.Group(); jib.position.set(C.x, mastH + 1.4, C.z); parent.add(jib);
    cyl(0.9, 0.9, 0.3, M.steelDk, 0, -0.3, 0, jib, 20);
    box(1.6, 1.5, 1.6, M.glass, 1.1, 0, 1.2, jib); box(1.7, 0.15, 1.7, M.white, 1.1, 1.5, 1.2, jib);
    box(0.5, 4.5, 0.5, mat, 0, 1.2, 0, jib);
    const bw = 0.5, th = 1.0;
    box(jibLen, 0.14, 0.14, mat, jibLen / 2, 1.2, bw, jib); box(jibLen, 0.14, 0.14, mat, jibLen / 2, 1.2, -bw, jib); box(jibLen, 0.14, 0.14, mat, jibLen / 2, 1.2 + th, 0, jib);
    for (let x = 0.5; x < jibLen - 0.6; x += 1.2) {
      beamBetween(V(x, 1.27, bw), V(x + 0.6, 1.2 + th, 0), 0.035, mat, jib); beamBetween(V(x, 1.27, -bw), V(x + 0.6, 1.2 + th, 0), 0.035, mat, jib);
      beamBetween(V(x, 1.27, bw), V(x + 0.6, 1.27, -bw), 0.03, mat, jib);
    }
    box(cjLen, 0.3, 1.2, mat, -cjLen / 2, 1.2, 0, jib);
    for (let i = 0; i < 3; i++) box(0.5, 1.6, 1.4, M.concreteDk, -cjLen + 0.5 + i * 0.6, 0.3, 0, jib);
    beamBetween(V(0, 5.6, 0), V(jibLen * 0.6, 1.2 + th, 0), 0.04, mat, jib); beamBetween(V(0, 5.6, 0), V(-cjLen + 0.6, 1.5, 0), 0.04, mat, jib);
    const troll = box(1, 0.45, 1.3, M.dark, 10, 0.95, 0, jib);
    const hookBlock = new THREE.Group(); parent.add(hookBlock); box(0.5, 0.6, 0.3, M.yellow, 0, 0, 0, hookBlock);
    const hk = sh(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 8, 16, Math.PI * 1.5), M.steelDk)); hk.position.set(0, -0.1, 0); hk.rotation.z = Math.PI * 0.75; hookBlock.add(hk);
    const cables = [box(0.05, 1, 0.05, M.dark, 0, 0, 0, parent), box(0.05, 1, 0.05, M.dark, 0, 0, 0, parent)];
    const top = mastH + 1.4 + 0.95;
    const setHook = (hx, hy, hz) => {
      hookBlock.position.set(hx, hy + 0.3, hz);
      cables.forEach((cb, i) => { const off = i ? 0.18 : -0.18; cb.position.set(hx + off * Math.cos(jib.rotation.y), (hy + 0.6 + top) / 2, hz - off * Math.sin(jib.rotation.y)); cb.scale.y = Math.max(0.1, top - hy - 0.6); });
    };
    return { jib, troll, setHook, hookBlock };
  }
  const fleet = [mixer(), flatbed('steel'), mixer(), flatbed('panel'), flatbed('steel'), mixer(), flatbed('c'), flatbed('panel')];
  const LOOP_V = 0.009 * loop.getLength();
  const laneAt = (u) => { const p = loop.getPointAt(u), q = loop.getPointAt((u + 0.002) % 1), tg = q.clone().sub(p).normalize(); return { p: V(p.x - tg.z * 1.7, 0.21, p.z + tg.x * 1.7), tg }; };
  const findU = (cost) => { let best = 0, bd = Infinity; for (let i = 0; i < 1600; i++) { const uu = i / 1600, d = cost(loop.getPointAt(uu)); if (d < bd) { bd = d; best = uu; } } return best; };
  const uExit = findU((p) => (p.x < 70 ? Infinity : Math.abs(p.z - 4) + Math.abs(p.x - 85) * 0.2));
  const uBack = findU((p) => (p.z < 12 || p.x > 80 ? Infinity : Math.abs(p.x - 74) + Math.abs(p.z - 18.5) * 0.2));
  const du = (uBack - uExit + 1) % 1, LE = laneAt(uExit), LB = laneAt(uBack), GX = 112;
  const cr = (pts) => new THREE.CatmullRomCurve3(pts.map(([x, z]) => V(x, 0.21, z)), false, 'centripetal');
  const exA = cr([[LE.p.x, LE.p.z], [LE.p.x + LE.tg.x * 4, LE.p.z + LE.tg.z * 4], [88.6, 14.6], [94, 18.5], [100, 18.75], [GX - 4.1, 18.75]]);
  const lanePts = (x0, x1, side, n = 8) => { const a = roadU(x0), b = roadU(x1), out = []; for (let k = 0; k <= n; k++) { const q = roadLane(a + (b - a) * (k / n), side); out.push([q.x, q.z]); } return out; };
  const exB = cr([[GX - 4.1, 18.75], ...lanePts(122, 178, 1)]);
  const bkA = cr([...lanePts(178, 122, -1), [GX + 4.1, 15.25]]);
  const bkB = cr([[GX + 4.1, 15.25], [100, 15.25], [90, 15.5], [LB.p.x - LB.tg.x * 5, LB.p.z - LB.tg.z * 5], [LB.p.x, LB.p.z]]);
  const T1 = (2 * exA.getLength()) / LOOP_V, T2 = 13, T3 = 12, T4 = (2 * bkB.getLength()) / LOOP_V, S1 = 3, S2 = 3;
  const TH = Math.max(0, (1 + du) / 0.009 - (T1 + S1 + T2 + T3 + S2 + T4));
  const eOut = (s) => 1 - (1 - s) * (1 - s), eIn = (s) => s * s;
  const excursion = (te, pos, dv) => {
    let c, u;
    if (te < T1) { c = exA; u = eOut(te / T1); }
    else if ((te -= T1) < S1) { c = exA; u = 1; }
    else if ((te -= S1) < T2) { c = exB; u = eIn(te / T2); }
    else if ((te -= T2) < TH) return false;
    else if ((te -= TH) < T3) { c = bkA; u = eOut(te / T3); }
    else if ((te -= T3) < S2) { c = bkA; u = 1; }
    else { te -= S2; c = bkB; u = eIn(Math.min(1, te / T4)); }
    c.getPointAt(u, pos); c.getTangentAt(Math.min(0.999, Math.max(0.001, u)), dv); return true;
  };
  fleet.forEach((v, i) => {
    scene.add(v); const slot = i / fleet.length, gate = i === 0 || i === 2 || i === 5; const p = V(0, 0, 0), q = V(0, 0, 0), tg = V(0, 0, 0), dv = V(0, 0, 0);
    updaters.push((t, dt) => {
      const sAbs = slot + 0.009 * t;
      if (gate) {
        const cyc = (((sAbs - uExit) % 2) + 2) % 2;
        if (cyc < 1 + du) {
          const ok = excursion(cyc / 0.009, p, dv); v.visible = ok;
          if (ok) { v.position.set(p.x, 0.21, p.z); v.lookAt(p.x + dv.x, 0.21, p.z + dv.z); drive(v, dt); }
          if (v.userData.drum) v.userData.drum.rotation.y += dt * 1.5;
          return;
        }
        v.visible = true;
      }
      const u = ((sAbs % 1) + 1) % 1; loop.getPointAt(u, p); loop.getPointAt((u + 0.002) % 1, q); tg.copy(q).sub(p).normalize();
      v.position.set(p.x - tg.z * 1.7, 0.21, p.z + tg.x * 1.7); v.lookAt(v.position.x + tg.x, 0.21, v.position.z + tg.z); drive(v, dt);
      if (v.userData.drum) v.userData.drum.rotation.y += dt * 1.5;
    });
  });

  // ---------- CONCRETE PLANT ----------
  {
    const TX = -36, TZ = -9;
    for (let i = 0; i < 4; i++) {
      const x = -53 + i * 5.4, z = -20;
      [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]].forEach(([a, b]) => box(0.3, 5, 0.3, M.steelDk, x + a, 0, z + b));
      cyl(2.3, 0.35, 2.6, M.galv, x, 4, z); cyl(2.3, 2.3, 10, M.galv, x, 6.6, z); cyl(1.2, 2.3, 0.9, M.galv, x, 16.6, z);
      box(0.4, 0.4, 0.4, M.acc, x, 17.5, z);
      beamBetween(V(x, 7, z + 1.8), V(TX - 2 + i * 0.6, 15, TZ - 3.6), 0.28, M.steel);
    }
    [[-3.2, -3.2], [3.2, -3.2], [-3.2, 3.2], [3.2, 3.2]].forEach(([a, b]) => box(0.6, 6.5, 0.6, M.steelDk, TX + a, 0, TZ + b));
    box(7.4, 0.5, 7.4, M.steelDk, TX, 6.2, TZ);
    const tBody = box(7, 12.5, 7, texMat(T.corr, 6, 1, { color: '#dfe2e3', roughness: 0.45, metalness: 0.5 }), TX, 6.7, TZ);
    const tBandM = M.acc.clone(); allMats.push(tBandM); accentClones.push(tBandM);
    const tGlassM = M.glass.clone(); allMats.push(tGlassM); const tTopM = M.dark.clone(); allMats.push(tTopM);
    const tBand = box(7.15, 1.1, 7.15, tBandM, TX, 14.6, TZ), tGlass = box(7.1, 1.6, 7.1, tGlassM, TX, 16.3, TZ), tTop = box(7.4, 0.5, 7.4, tTopM, TX, 19.2, TZ);
    reveal(2, 0.12, [tBody, tBand, tGlass, tTop]);
    box(4.4, 1.7, 2.4, M.steelDk, TX, 6.95, TZ); box(4.5, 0.25, 2.5, M.acc, TX, 8.65, TZ);
    [-2.45, 2.45].forEach((dx) => { const mo = cyl(0.45, 0.45, 0.9, M.galv, TX + dx, 7.4, TZ, scene, 14); mo.rotation.z = Math.PI / 2; });
    [-1.8, 0, 1.8].forEach((dx) => { cyl(1.0, 0.3, 1.4, M.galv, TX + dx, 9.9, TZ - 1.2, scene, 18); box(1.9, 1.8, 1.9, M.galv, TX + dx, 11.3, TZ - 1.2); });
    box(6.6, 0.12, 2.2, M.steel, TX, 13.2, TZ + 2.3); cyl(0.85, 0.85, 1.7, M.white, TX + 2.2, 13.32, TZ + 2.3, scene, 18);
    box(6.6, 0.12, 1.6, M.steel, TX, 9.6, TZ + 2.6);
    cyl(1.4, 0.4, 1.6, M.steel, TX, 4.6, TZ + 1);
    for (let y = 0; y < 19; y += 0.6) box(0.05, 0.05, 1.2, M.steelDk, TX + 3.9, y, TZ + 2.4);
    // aggregate bins
    const bins = [[-48, M.sand], [-41, M.stone], [-34, M.sand], [-27, M.stone]];
    bins.forEach(([x, mat], i) => { box(0.6, 3, 9, M.concreteDk, x - 3.5, 0, 13); const pile = sh(new THREE.Mesh(new THREE.ConeGeometry(4.2, 3.8 + (i % 2) * 0.6, 18, 1), mat)); pile.position.set(x, 1.9, 13.5); pile.scale.z = 1.1; scene.add(pile); });
    box(0.6, 3, 9, M.concreteDk, -23.5, 0, 13); box(28, 3, 0.6, M.concreteDk, -37.5, 0, 17.7);
    // hopper + conveyor
    const cs = V(TX, 2.2, 6.5), ce = V(TX, 15.5, TZ + 3.6);
    box(3.4, 2, 3.4, M.steel, TX, 1.6, 7.5); cyl(1.8, 0.7, 1.6, M.acc, TX, 3.4, 7.5);
    const cd = ce.clone().sub(cs), cl = cd.length();
    const belt = sh(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, cl), M.dark)); belt.position.copy(cs).addScaledVector(cd, 0.5); belt.lookAt(ce); scene.add(belt);
    const hood = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, cl, 12, 1, true, 0, Math.PI), texMat(T.corr, 1, 8, { color: '#d9dcde', side: THREE.DoubleSide, metalness: 0.5, roughness: 0.4 })));
    hood.position.copy(belt.position); hood.quaternion.setFromUnitVectors(V(0, 1, 0), cd.clone().normalize()); hood.rotateY(Math.PI / 2); scene.add(hood);
    [0.25, 0.5, 0.75].forEach((f) => { const p = cs.clone().addScaledVector(cd, f); box(0.25, p.y, 0.25, M.steelDk, TX - 0.9, 0, p.z); box(0.25, p.y, 0.25, M.steelDk, TX + 0.9, 0, p.z); });
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.22), M.stone, 46); rocks.castShadow = true; scene.add(rocks);
    const ro = new THREE.Object3D();
    updaters.push((t) => { for (let i = 0; i < 46; i++) { const f = ((t * 0.09 + i / 46) % 1); ro.position.copy(cs).addScaledVector(cd, f); ro.position.y += 0.32; ro.rotation.set(i, i * 2, 0); ro.updateMatrix(); rocks.setMatrixAt(i, ro.matrix); } rocks.instanceMatrix.needsUpdate = true; });
    // wheel loader
    const ld = new THREE.Group(); scene.add(ld);
    box(2.2, 1.5, 3, M.yellow, 0, 0.7, -0.6, ld); box(1.7, 1.5, 1.6, M.glass, 0, 2.2, -0.3, ld); box(1.8, 0.15, 1.8, M.yellow, 0, 3.7, -0.3, ld);
    box(0.25, 0.25, 2.4, M.yellow, -0.8, 1.4, 1.6, ld); box(0.25, 0.25, 2.4, M.yellow, 0.8, 1.4, 1.6, ld);
    const bucket = box(2.7, 0.9, 1, M.steelDk, 0, 0.3, 2.9, ld);
    for (let i = 0; i < 6; i++) box(0.12, 0.12, 0.3, M.steelDk, -1.1 + i * 0.44, -0.45, 0.5, bucket);
    cyl(0.07, 0.07, 1.1, M.galv, 0.8, 2.2, -1.3, ld, 8); box(1.8, 0.8, 0.5, M.dark, 0, 0.6, -2.3, ld);
    [[-0.85, -1.1], [0.85, -1.1], [-0.85, 0.5], [0.85, 0.5]].forEach(([x, z]) => box(0.1, 1.5, 0.1, M.yellow, x, 2.2, z, ld));
    beamBetween(V(-0.95, 1.2, 0.2), V(-0.95, 1.0, 2.2), 0.08, M.galv, ld); beamBetween(V(0.95, 1.2, 0.2), V(0.95, 1.0, 2.2), 0.08, M.galv, ld);
    [[-1.1, 1], [1.1, 1], [-1.1, -1.4], [1.1, -1.4]].forEach(([x, z]) => { const w = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.6, 16), M.tire)); w.rotation.z = Math.PI / 2; w.position.set(x, 0.75, z); ld.add(w); });
    updaters.push((t) => {
      const c = t % 8, a = V(-42, 0.18, 7.5), b = V(TX - 3.2, 0.18, 4.2);
      let u = c < 3.5 ? ease(seg(c, 0.5, 3.5)) : 1 - ease(seg(c, 4.5, 7.5));
      ld.position.lerpVectors(a, b, u);
      ld.rotation.y = c < 4 ? Math.PI * 0.82 + u * 0.5 : Math.PI * 0.82 + u * 0.5;
      bucket.position.y = 0.75 + (c > 3 && c < 4.5 ? 1.6 : u * 1.4);
      if (c > 3.6 && c < 4.1) burst(dust, V(TX - 1.5, 3.4, 6.5), 2, 2, 1.5, 2);
    });
    // mixer at loading bay
    const mt = mixer(); scene.add(mt);
    const chute = V(TX, 4.2, TZ + 1);
    updaters.push((t, dt) => {
      const c = t % CYCLE;
      const x = c < 4 ? lerp(-72, TX, ease(seg(c, 0, 3.6))) : c < 12 ? TX : lerp(TX, -14, ease(seg(c, 12, 16)));
      mt.position.set(x, 0.18, TZ + 2.2); mt.rotation.y = Math.PI / 2;
      mt.userData.drum.rotation.y += dt * (c > 8 && c < 12 ? 7 : 1.5);
      mt.visible = c > 0.15 && c < 15.85;
      if (c > 8.2 && c < 11.8) for (let i = 0; i < 3; i++) pour.spawn(chute.x + (rnd() - 0.5) * 0.3, chute.y, chute.z + (rnd() - 0.5) * 0.3, 0, -1, 0, 0.35);
      if (c > 4 && c < 8 && rnd() < 0.3) steam.spawn(TX + (rnd() - 0.5) * 3, 19.8, TZ + (rnd() - 0.5) * 3, 0.3, 1.2, 0, 3.5);
      if (c > 4 && c < 8 && rnd() < 0.15) dust.spawn(-53 + ((rnd() * 4) | 0) * 5.4, 17.8, -20, 0.4, 0.6, 0, 2.5);
    });
  }

  // ---------- METAL WORKS ----------
  {
    const X = 5, Z = -8;
    const wall = (w, h, mat, x, y, z, ry = 0) => { const m = box(w, h, 0.35, mat, x, y, z); m.rotation.y = ry; return m; };
    wall(36, 11, texMat(T.corr, 24, 1, { color: '#d4d8da', metalness: 0.55, roughness: 0.4 }), X, 0, Z - 10);
    wall(20, 11, texMat(T.corr, 14, 1, { color: '#c7cccf', metalness: 0.55, roughness: 0.4 }), X - 18, 0, Z, Math.PI / 2);
    box(36, 1.6, 0.4, M.acc, X, 9.4, Z - 9.75);
    for (let x = -18; x <= 18; x += 6) { box(0.5, 11, 0.5, M.steelDk, X + x, 0, Z + 10); box(0.5, 11, 0.5, M.steelDk, X + x, 0, Z - 9.6); const tr = box(0.35, 1, 20, M.steel, X + x, 11, Z); tr.rotation.z = 0; }
    box(36.4, 0.7, 0.5, M.acc, X, 11, Z + 10); box(36.4, 0.5, 0.5, M.steelDk, X, 11.3, Z - 9.6);
    reveal(3, 0.15, [box(36, 0.35, 7, texMat(T.corr, 24, 1, { color: '#bfc4c7', metalness: 0.5, roughness: 0.45 }), X, 12, Z - 6.5)]);
    box(36.2, 0.4, 0.5, M.steelDk, X, 8.4, Z - 9); box(36.2, 0.4, 0.5, M.steelDk, X, 8.4, Z + 9);
    const floor = box(35.6, 0.06, 19.6, texMat(T.concrete, 4, 2, { color: '#a9adaf', roughness: 0.35 }), X, 0.18, Z); floor.castShadow = false;
    box(36, 0.02, 0.25, M.yellow, X, 0.24, Z + 5.3); box(36, 0.02, 0.25, M.yellow, X, 0.24, Z + 0.7);
    const ibeam = (len, mat, p) => { const g = new THREE.Group(); box(len, 0.08, 0.5, mat, 0, 0, 0, g); box(len, 0.44, 0.08, mat, 0, 0.08, 0, g); box(len, 0.08, 0.5, mat, 0, 0.52, 0, g); g.traverse((m) => m.isMesh && (m.castShadow = true)); p.add(g); return g; };
    for (let l = 0; l < 4; l++) for (let k = 0; k < 4; k++) { const b = ibeam(7, M.steelDk, scene); b.position.set(-9, 0.2 + l * 0.62, -15 + k * 0.7); }
    for (let b = 0; b < 3; b++) for (let i = 0; i < 12; i++) { const c = cyl(0.09, 0.09, 10, M.rust, 0, 0, 0, scene, 6); c.rotation.z = Math.PI / 2; c.position.set(X + 10, 0.3 + Math.floor(i / 4) * 0.19, Z - 6 + b * 1.4 + (i % 4) * 0.2); }
    // roller line
    box(27, 0.9, 1.4, M.steelDk, 7, 0.2, -5);
    const rollers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 10), M.rim, 54); const o = new THREE.Object3D();
    for (let i = 0; i < 54; i++) { o.position.set(-6.2 + i * 0.5, 1.18, -5); o.rotation.set(Math.PI / 2, 0, 0); o.updateMatrix(); rollers.setMatrixAt(i, o.matrix); } scene.add(rollers);
    // saw
    box(2.2, 2.6, 1.8, M.acc, -1, 0.2, -7.2); box(0.6, 0.6, 3, M.steelDk, -1, 2.8, -5.9);
    const blade = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.05, 32), M.rim)); blade.rotation.x = Math.PI / 2; blade.rotation.z = Math.PI / 2; blade.position.set(-1, 2.2, -5); scene.add(blade);
    // welding robots
    const robot = (x, z, dir) => {
      const g = new THREE.Group(); g.position.set(x, 0.2, z); scene.add(g);
      cyl(0.5, 0.6, 0.6, M.dark, 0, 0, 0, g); const turret = new THREE.Group(); turret.position.y = 0.6; g.add(turret);
      cyl(0.35, 0.35, 0.5, M.acc, 0, 0, 0, turret);
      const sh1 = new THREE.Group(); sh1.position.y = 0.5; turret.add(sh1); box(0.3, 1.6, 0.3, M.acc, 0, 0, 0, sh1);
      const el2 = new THREE.Group(); el2.position.y = 1.6; sh1.add(el2); box(0.25, 1.3, 0.25, M.acc, 0, 0, 0, el2);
      turret.rotation.y = dir; return { turret, sh1, el2 };
    };
    const r1 = robot(6, -7.4, 0), r2 = robot(6.5, -2.6, Math.PI);
    const spark = new THREE.PointLight('#ffad5c', 0, 16, 1.6); scene.add(spark);
    const work = ibeam(7, M.steel.clone(), scene); const workMat = work.children[0].material; allMats.push(workMat);
    work.children.forEach((m) => (m.material = workMat));
    // overhead crane
    const bridge = new THREE.Group(); scene.add(bridge);
    box(0.9, 1, 19, M.acc, 0, 8.7, Z, bridge); box(0.4, 0.6, 19, M.yellow, 0, 9.7, Z, bridge);
    const trolley = box(1.8, 0.9, 1.8, M.dark, 0, 7.9, 0, bridge);
    const cable = box(0.07, 1, 0.07, M.dark, 0, 0, 0, scene);
    const steelC = new THREE.Color('#7d848a'), primerC = new THREE.Color('#6d7a6f');
    updaters.push((t, dt) => {
      const c = t % CYCLE;
      let x, y = 1.25, z = -5;
      if (c < 4) { const u = ease(seg(c, 0.3, 3.6)); x = lerp(-9, -5, u); z = lerp(-14, -5, u); y = lerp(2.6, 1.25, seg(c, 3, 3.8)) + Math.sin(Math.PI * u) * 3.2; }
      else if (c < 8) x = lerp(-5, 0.5, ease(seg(c, 4, 7.6)));
      else if (c < 12) x = lerp(0.5, 6.5, ease(seg(c, 8, 9.2)));
      else x = lerp(6.5, 16.5, ease(seg(c, 12, 15.5)));
      work.position.set(x, y, z);
      workMat.color.copy(steelC).lerp(primerC, seg(x, 13, 16));
      const bx = c < 4 ? x : lerp(-5, -9, ease(seg(c, 4, 6)));
      bridge.position.x = bx;
      const tz = c < 4 ? z : lerp(-5, -14, ease(seg(c, 4, 6))); trolley.position.z = tz;
      const hy = c < 4 ? y + 0.6 : 5;
      cable.position.set(bx, hy, tz); cable.scale.y = Math.max(0.1, 7.9 - hy);
      blade.rotation.y += dt * (c > 4.5 && c < 8 ? 30 : 2);
      const cutting = c > 5.2 && c < 7.8, welding = c > 9.2 && c < 11.9 && Math.sin(t * 31) > -0.2;
      if (cutting) burst(sparks, V(-1, 1.6, -5), 5, 5, 4, 0.6);
      const wp = V(lerp(4, 9, (c - 9.2) / 2.7), 1.6, (Math.sin(t * 2) > 0 ? -5.3 : -4.7));
      if (welding) burst(sparks, wp, 4, 3.5, 3, 0.45);
      spark.position.copy(cutting ? V(-1, 1.8, -5) : wp); spark.intensity = cutting || welding ? 24 + rnd() * 20 : 0;
      [r1, r2].forEach((r, i) => { r.turret.rotation.y = (i ? Math.PI : 0) + Math.sin(t * 1.3 + i) * 0.5; r.sh1.rotation.x = 0.5 + Math.sin(t * 1.7 + i) * 0.25 * (c > 9 && c < 12 ? 1 : 0.2); r.el2.rotation.x = 1.1 + Math.sin(t * 2.3) * 0.2; });
      if (c > 13 && c < 15.8 && rnd() < 0.5) steam.spawn(16 + (rnd() - 0.5) * 5, 2 + rnd() * 2, -5 + (rnd() - 0.5) * 3, 0, 0.3, 0, 2);
    });
    // paint booth
    box(7.5, 4.6, 0.25, texMat(T.corr, 5, 1, { color: '#e3e5e6', metalness: 0.4 }), 16.5, 0.2, -8.2); box(7.5, 4.6, 0.25, texMat(T.corr, 5, 1, { color: '#e3e5e6', metalness: 0.4 }), 16.5, 0.2, -1.8);
    box(7.7, 0.3, 6.7, M.acc, 16.5, 4.8, -5);
  }

  // ---------- PRECAST ----------
  {
    const C = V(48, 0, 2), A = V(33, 0, 6), B = V(53, 0, 7), Mo = V(42, 0, -2), S = V(40, 0, -13);
    // mould
    box(10.4, 0.9, 4.4, M.steelDk, Mo.x, 0.18, Mo.z);
    box(10.4, 0.5, 0.2, M.acc, Mo.x, 1.08, Mo.z - 2.1); box(10.4, 0.5, 0.2, M.acc, Mo.x, 1.08, Mo.z + 2.1); box(0.2, 0.5, 4.4, M.acc, Mo.x - 5.1, 1.08, Mo.z); box(0.2, 0.5, 4.4, M.acc, Mo.x + 5.1, 1.08, Mo.z);
    const mkCage = () => { const g = new THREE.Group(); for (let i = 0; i < 10; i++) cyl(0.04, 0.04, 3.6, M.rust, -4.5 + i, 0, 0, g, 5).rotation.x = Math.PI / 2; for (let j = 0; j < 4; j++) { const r = cyl(0.04, 0.04, 9.4, M.rust, 0, 0, -1.5 + j, g, 5); r.rotation.z = Math.PI / 2; r.position.set(0, 0.12, -1.5 + j); } g.children.forEach((m) => { if (m.rotation.x) m.position.y = 0.05; }); return g; };
    for (let k = 0; k < 4; k++) { const cg = mkCage(); cg.position.set(A.x, 0.25 + k * 0.2, A.z); scene.add(cg); }
    const cage = mkCage(); scene.add(cage);
    const slab = sh(new THREE.Mesh(new THREE.BoxGeometry(9.8, 1, 3.8), M.wet)); scene.add(slab);
    const panelMat = M.concrete;
    for (let k = 0; k < 8; k++) box(9.8, 0.32, 3.8, panelMat, S.x, 0.2 + k * 0.34, S.z);
    for (let r = 0; r < 2; r++) { box(12, 0.3, 1.6, M.steelDk, 34, 0.2, -19 + r * 3.4); for (let i = 0; i < 6; i++) box(1.6, 3.6 + (i % 2) * 0.4, 0.28, panelMat, 29.5 + i * 1.8, 0.5, -19 + r * 3.4); }
    [[0, 0], [2.6, 0], [5.2, 0], [1.3, 2.25], [3.9, 2.25], [2.6, 4.5]].forEach(([a, b]) => { const p = sh(new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 3.4, 24, 1, true), mk({ color: '#ffffff', map: T.concrete, side: THREE.DoubleSide, roughness: 0.95 }))); p.rotation.x = Math.PI / 2; p.position.set(52 + a, 1.45 + b, -16); scene.add(p); });
    const bucketG = new THREE.Group(); scene.add(bucketG); cyl(0.9, 0.5, 1.6, M.steelDk, 0, -1.7, 0, bucketG, 16); cyl(0.95, 0.95, 0.15, M.acc, 0, -0.2, 0, bucketG, 16);
    const panelCarry = sh(new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.32, 3.8), panelMat)); scene.add(panelCarry);
    // tower crane
    const mastH = 24;
    const { jib, troll, setHook } = craneRig(C, mastH, 22, 7, M.acc);
    const KF = [[0, S, 3.4, 0], [0.8, A, 6, 0], [1.2, A, 1.6, 0], [1.25, A, 1.6, 1], [1.7, A, 6, 1], [3.4, Mo, 6, 1], [4.0, Mo, 1.5, 1], [4.05, Mo, 1.5, 0], [4.9, B, 6, 0], [5.3, B, 2.4, 0], [5.35, B, 2.4, 2], [5.8, B, 6, 2], [6.7, Mo, 4.4, 2], [8.0, Mo, 4.4, 2], [9.3, B, 6, 2], [9.7, B, 2.4, 2], [9.75, B, 2.4, 0], [11.6, Mo, 6, 0], [12.2, Mo, 1.8, 0], [12.25, Mo, 1.8, 3], [12.9, Mo, 6, 3], [15.0, S, 6, 3], [15.8, S, 3.4, 3], [15.85, S, 3.4, 0], [16, S, 3.4, 0]];
    const polar = (p) => ({ a: Math.atan2(-(p.z - C.z), p.x - C.x), r: Math.hypot(p.x - C.x, p.z - C.z) });
    updaters.push((t) => {
      const c = t % CYCLE; let i = 0; while (i < KF.length - 2 && KF[i + 1][0] <= c) i++;
      const k0 = KF[i], k1 = KF[i + 1], u = ease(seg(c, k0[0], k1[0]));
      const p0 = polar(k0[1]), p1 = polar(k1[1]); let da = p1.a - p0.a; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
      const ang = p0.a + da * u, r = lerp(p0.r, p1.r, u), hy = lerp(k0[2], k1[2], u), item = k0[3];
      jib.rotation.y = ang; troll.position.x = r;
      const hx = C.x + Math.cos(ang) * r, hz = C.z - Math.sin(ang) * r;
      setHook(hx, hy + 0.2, hz);
      cage.visible = item === 1 || (c >= 4.0 && c < 12.25);
      if (item === 1) { cage.position.set(hx, hy - 0.6, hz); cage.rotation.y = ang; } else { cage.position.set(Mo.x, 1.05, Mo.z); cage.rotation.y = 0; }
      if (item === 2) bucketG.position.set(hx, hy + 0.2, hz); else bucketG.position.set(B.x, 2.0, B.z);
      const fill = c < 6.7 ? 0 : c < 12.25 ? seg(c, 6.7, 8) : 0;
      slab.visible = fill > 0.01; slab.scale.y = Math.max(0.01, fill * 0.42); slab.position.set(Mo.x, 1.0 + slab.scale.y / 2, Mo.z);
      M.wet.roughness = c > 8 ? lerp(0.25, 0.9, seg(c, 8, 12)) : 0.25;
      panelCarry.visible = item === 3; panelCarry.position.set(hx, hy - 0.4, hz); panelCarry.rotation.y = ang;
      if (c > 6.8 && c < 7.9) for (let n = 0; n < 4; n++) pour.spawn(hx + (rnd() - 0.5) * 0.4, hy - 1.9, hz + (rnd() - 0.5) * 0.4, (rnd() - 0.5), -1, (rnd() - 0.5), 0.4);
      if (c > 8.2 && c < 12 && rnd() < 0.9) steam.spawn(Mo.x + (rnd() - 0.5) * 9, 1.6, Mo.z + (rnd() - 0.5) * 3.5, 0.2, 0.9, 0, 3.2);
    });
  }

  // ---------- LOGISTICS ----------
  {
    box(4.4, 0.4, 660, mk({ color: '#ffffff', map: T.stone, roughness: 1 }), RAIL_X, 0, 0);
    const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.18, 0.4), mk({ color: '#7e766b', roughness: 0.9 }), 412); const o = new THREE.Object3D();
    for (let i = 0; i < 412; i++) { o.position.set(RAIL_X, 0.48, -329 + i * 1.6); o.updateMatrix(); sl.setMatrixAt(i, o.matrix); } sl.receiveShadow = true; scene.add(sl);
    [-0.75, 0.75].forEach((d) => box(0.14, 0.16, 660, M.steel, RAIL_X + d, 0.56, 0));
    const train = new THREE.Group(); train.rotation.y = -Math.PI / 2; scene.add(train);
    box(15, 3.2, 2.9, M.acc, 0, 1.4, 0, train); box(15.1, 0.4, 2.95, M.dark, 0, 1.0, 0, train); box(14.4, 0.4, 2.6, M.dark, 0, 4.6, 0, train);
    box(0.1, 1.2, 2.5, M.glass, 7.52, 3.1, 0, train); box(14.6, 0.9, 2.94, M.glass, -0.4, 3.2, 0, train); box(1, 0.4, 1, M.dark, -3, 5.0, 0, train);
    [-0.8, 0.8].forEach((z) => box(0.1, 0.3, 0.3, M.lamp, 7.55, 2.2, z, train));
    const bogie = (x) => { box(3.2, 0.5, 2.4, M.dark, x, 0.9, 0, train); [-1, 1].forEach((dx) => [-1.25, 1.25].forEach((z) => { const wh = sh(new THREE.Mesh(G.rail, M.steelDk)); wh.rotation.x = Math.PI / 2; wh.position.set(x + dx, 1.1, z); train.add(wh); })); };
    bogie(-4.8); bogie(4.8);
    for (let i = 0; i < 10; i++) { const x = -16 - i * 14.6; box(14, 0.5, 2.6, M.steelDk, x, 1.1, 0, train); bogie(x - 5); bogie(x + 5); box(1.2, 0.2, 0.2, M.dark, x + 7.3, 1.2, 0, train); box(6.1, 2.6, 2.45, contCols[(i * 3) % 5], x - 3.3, 1.6, 0, train); if (i % 3) box(6.1, 2.6, 2.45, contCols[(i * 2 + 1) % 5], x + 3.3, 1.6, 0, train); else for (let j = 0; j < 4; j++) box(0.5, 0.5, 6, M.steel, x + 3.3 - 0.8 + j * 0.53, 1.6, 0, train).rotation.y = Math.PI / 2; }
    updaters.push((t) => { train.position.set(RAIL_X, 0, ((t * 7) % 660) - 330); });
    const X = 60, Z = 46;
    const stacks = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) { const h = 1 + ((r * 7 + c * 3) % 3); for (let k = 0; k < h; k++) stacks.push(box(6.1, 2.6, 2.45, contCols[(r + c + k) % 5], X - 18 + c * 6.6, 0.2 + k * 2.6, Z - 10 + r * 3)); }
    const target = box(6.1, 2.6, 2.45, contCols[0], 0, 0, 0);
    const gan = new THREE.Group(); scene.add(gan);
    [Z - 14, Z + 12].forEach((z) => {
      box(0.9, 13, 0.9, M.acc, -4, 0.2, z, gan); box(0.9, 13, 0.9, M.acc, 4, 0.2, z, gan); box(9, 0.8, 0.9, M.acc, 0, 0.4, z, gan);
      beamBetween(V(-3.6, 1.2, z), V(3.6, 12.6, z), 0.06, M.acc, gan); beamBetween(V(3.6, 1.2, z), V(-3.6, 12.6, z), 0.06, M.acc, gan);
      [-4, 4].forEach((x) => [-0.9, 0.9].forEach((dx) => { const wh = sh(new THREE.Mesh(G.rail, M.steelDk)); wh.rotation.z = Math.PI / 2; wh.position.set(x + dx, 0.5, z); gan.add(wh); }));
      box(60, 0.15, 0.2, M.steel, X, 0.2, z);
    });
    box(1.6, 1.4, 1.6, M.glass, -5.3, 10.6, Z - 1, gan); box(1.7, 0.15, 1.7, M.white, -5.3, 12.0, Z - 1, gan);
    box(9.6, 1.2, 1, M.acc, 0, 13.2, Z - 14, gan); box(9.6, 1.2, 1, M.acc, 0, 13.2, Z + 12, gan);
    box(1, 1, 27, M.acc, -4, 13.2, Z - 1, gan); box(1, 1, 27, M.acc, 4, 13.2, Z - 1, gan);
    const gt = box(3, 1.4, 3, M.dark, 0, 11.9, 0, gan); const gc = box(0.08, 1, 0.08, M.dark, 0, 0, 0, gan); const spreader = box(6.3, 0.35, 2.5, M.yellow, 0, 0, 0, gan);
    [[-2.9, -1.1], [2.9, -1.1], [-2.9, 1.1], [2.9, 1.1]].forEach(([a, b]) => box(0.3, 0.3, 0.3, M.dark, a, -0.45, b, spreader));
    const truck = flatbed('none'); scene.add(truck);
    const tz = Z + 8;
    updaters.push((t, dt) => {
      const c = t % CYCLE;
      const px = X - 18 + 2 * 6.6, pz = Z - 10 + 1 * 3, dx = X + 6, top = 5.4;
      let gx, z, y, carry = false;
      if (c < 1.2) { gx = px; z = pz; y = lerp(11, top + 2.8, ease(seg(c, 0, 1.2))); }
      else if (c < 2.4) { gx = px; z = pz; y = lerp(top + 2.8, 11, ease(seg(c, 1.2, 2.4))); carry = true; }
      else if (c < 4.6) { const u = ease(seg(c, 2.4, 4.6)); gx = lerp(px, dx, u); z = lerp(pz, tz, u); y = 11; carry = true; }
      else if (c < 5.8) { gx = dx; z = tz; y = lerp(11, 4.1, ease(seg(c, 4.6, 5.8))); carry = true; }
      else if (c < 7) { gx = dx; z = tz; y = lerp(4.1, 11, ease(seg(c, 5.8, 7))); }
      else { const u = ease(seg(c, 7, 11)); gx = lerp(dx, px, u); z = lerp(tz, pz, u); y = 11; }
      gan.position.x = gx; gt.position.z = z; gc.position.set(0, (y + 11.9) / 2 + 0.2, z); gc.scale.y = Math.max(0.1, 11.9 - y); spreader.position.set(0, y, z);
      const sTop = stacks.filter((s) => Math.abs(s.position.x - px) < 0.1 && Math.abs(s.position.z - pz) < 0.1).sort((a, b) => b.position.y - a.position.y)[0];
      if (sTop) sTop.visible = c < 1.2;
      let trx = c < 8 ? dx : lerp(dx, 110, ease(seg(c, 8, 12)));
      if (c >= 12) trx = lerp(10, dx, ease(seg(c, 12, 16)));
      truck.position.set(trx, 0.18, tz); truck.rotation.set(0, Math.PI / 2, 0); drive(truck, dt); truck.visible = c < 11.8 || c > 12.2;
      target.visible = carry || (c >= 5.8 && c < 12);
      if (carry) target.position.set(gx, y - 2.7, z); else target.position.set(trx - 1.2, 1.5, tz);
    });
    const WX = X + 22, WZ = Z - 2, wallM = () => texMat(T.corr, 14, 1, { color: '#dcdfe0', metalness: 0.5, roughness: 0.4 });
    box(20, 8, 0.3, wallM(), WX, 0.2, WZ - 6.35); box(0.3, 8, 13, wallM(), WX - 9.85, 0.2, WZ);
    const wRight = box(0.3, 8, 13, wallM(), WX + 9.85, 0.2, WZ), fm = wallM();
    const wF1 = box(7.7, 8, 0.3, fm, WX - 6.15, 0.2, WZ + 6.35), wF2 = box(8.7, 8, 0.3, fm, WX + 5.65, 0.2, WZ + 6.35), wF3 = box(3.6, 3.6, 0.3, fm, WX - 0.5, 4.6, WZ + 6.35);
    const roofM = M.acc.clone(); allMats.push(roofM); accentClones.push(roofM);
    const wRoof = box(20.4, 0.7, 13.4, roofM, WX, 8.2, WZ);
    box(19.4, 0.06, 12.4, texMat(T.concrete, 4, 3, { color: '#b9bcbe', roughness: 0.4 }), WX, 0.2, WZ).castShadow = false;
    reveal(5, 0.12, [wRoof, wRight, wF1, wF2, wF3]);
    [0, 2].forEach((i) => box(3.6, 4.4, 0.2, M.dark, X + 15.5 + i * 6, 0.2, Z + 4.55));
    box(3.9, 0.3, 0.4, M.yellow, WX - 0.5, 4.5, WZ + 6.6);
    box(7, 3.2, 4, M.white, X - 13, 0.2, Z + 10); box(7.1, 1, 4.1, M.glass, X - 13, 1.6, Z + 10); box(7.3, 0.3, 4.3, M.acc, X - 13, 3.4, Z + 10);
  }

  const treeQ = [];
  // ---------- PEOPLE (proportioned figures: shaped torso, jointed limbs with knees/elbows, faces, hair, clothing) ----------
  const phys = (o) => { const p = Object.assign({ envMapIntensity: 0.6 }, o); if (LITE) ['sheen', 'sheenRoughness', 'sheenColor', 'clearcoat', 'clearcoatRoughness'].forEach((k) => delete p[k]); const m = LITE ? new THREE.MeshStandardMaterial(p) : new THREE.MeshPhysicalMaterial(p); allMats.push(m); return m; };
  const cloth = (c, r = 0.86) => phys({ color: c, roughness: r, sheen: 0.7, sheenRoughness: 0.75, sheenColor: new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.35) });
  const skinMats = ['#e2b898', '#d4a07c', '#c48b66', '#b07656', '#e8c6aa'].map((c) => phys({ color: c, roughness: 0.5, sheen: 0.35, sheenRoughness: 0.45, sheenColor: new THREE.Color('#ff9c7a'), clearcoat: 0.08, clearcoatRoughness: 0.6 }));
  const hairMats = ['#1b1512', '#2b1f17', '#3b2a1f', '#121212', '#4a3526'].map((c) => phys({ color: c, roughness: 0.48, sheen: 0.6, sheenRoughness: 0.35, sheenColor: new THREE.Color('#7a6a5c') }));
  const shirtMats = ['#f2f2ef', '#3d5a80', '#2b2f36', '#8a9aa8', '#5c6b4f', '#a63d3d', '#d9c6a3', '#c9d6e3'].map((c) => cloth(c, 0.82));
  const pantsMats = ['#23262b', '#3a3f48', '#5b5247', '#2d3442'].map((c) => cloth(c, 0.85));
  const jacketMats = ['#262a31', '#2f3b52', '#4a4d52'].map((c) => cloth(c, 0.8));
  const tieMats = ['#7a1f2b', '#1f3a6e', '#2a2a2a'].map((c) => mk({ color: c, roughness: 0.5 }));
  const vest = phys({ color: '#ff7a1a', roughness: 0.65, sheen: 0.5, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ffb27a') });
  const vestStripe = mk({ color: '#e6e6e6', roughness: 0.35, metalness: 0.3, emissive: '#ffffff', emissiveIntensity: 0.15 });
  const shoeMat = mk({ color: '#1c1b1a', roughness: 0.45, metalness: 0.1 }), bootMat = mk({ color: '#4a3424', roughness: 0.8 });
  const faceMat = mk({ color: '#1d1611', roughness: 0.5 }), helmetMat = mk({ color: '#f4f4f1', roughness: 0.35 });
  const MX = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz));
  const mergeG = (parts) => {
    const pos = [], nor = [];
    parts.forEach(([g, m]) => { let q = g.clone(); if (m) q.applyMatrix4(m); if (q.index) q = q.toNonIndexed(); const a = q.attributes.position.array, b = q.attributes.normal.array; for (let i = 0; i < a.length; i++) { pos.push(a[i]); nor.push(b[i]); } });
    const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return out;
  };
  const SPH = new THREE.SphereGeometry(1, 16, 12), SPHs = new THREE.SphereGeometry(1, 10, 8);
  const cap = (th) => new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * th);
  const taperCyl = (r0, r1, len, seg = 12) => { const g = new THREE.CylinderGeometry(r0, r1, len, seg, 1, true); g.translate(0, -len / 2, 0); return g; };
  const lathe = (pts, dz) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 22); g.scale(1, 1, dz); return g; };
  const hairCap = (th, tilt, s = 1) => [cap(th), MX(0, 0.026, -0.008, 0.099 * s, 0.118 * s, 0.109 * s, tilt, 0, 0)];
  const beard = [[SPH, MX(0, -0.049, 0.025, 0.083, 0.073, 0.085)], [new THREE.BoxGeometry(0.044, 0.012, 0.012), MX(0, -0.029, 0.101)]];
  const G2 = {
    thigh: mergeG([[SPH, MX(0, 0, 0, 0.082, 0.082, 0.082)], [taperCyl(0.08, 0.057, 0.45)]]),
    shin: mergeG([[SPH, MX(0, 0, 0, 0.057, 0.057, 0.057)], [taperCyl(0.056, 0.04, 0.42)]]),
    shoe: mergeG([[SPH, MX(0, -0.02, 0, 0.042, 0.042, 0.042)], [SPH, MX(0, -0.045, 0.045, 0.05, 0.035, 0.12)], [new THREE.BoxGeometry(0.1, 0.022, 0.26), MX(0, -0.072, 0.04)]]),
    boot: mergeG([[taperCyl(0.05, 0.056, 0.1), MX(0, 0.02, 0)], [SPH, MX(0, -0.04, 0.04, 0.058, 0.045, 0.13)], [new THREE.BoxGeometry(0.116, 0.03, 0.28), MX(0, -0.07, 0.04)]]),
    uarm: mergeG([[SPH, MX(0, 0, 0, 0.062, 0.062, 0.062)], [taperCyl(0.05, 0.041, 0.29)]]),
    farm: mergeG([[SPH, MX(0, 0, 0, 0.043, 0.043, 0.043)], [taperCyl(0.04, 0.031, 0.25)]]),
    hand: mergeG([[SPHs, MX(0, 0, 0, 0.031, 0.031, 0.031)], [SPHs, MX(0, -0.06, 0.004, 0.04, 0.068, 0.022)], [new THREE.CapsuleGeometry(0.011, 0.035, 3, 6), MX(0.03, -0.042, 0.016, 1, 1, 1, 0.3, 0, 0.5)]]),
    pelvis: mergeG([[SPH, MX(0, 0, 0, 0.165, 0.12, 0.112)]]),
    torsoM: lathe([[0.001, 0], [0.138, 0], [0.144, 0.06], [0.136, 0.14], [0.15, 0.24], [0.172, 0.33], [0.18, 0.4], [0.168, 0.46], [0.125, 0.5], [0.062, 0.525], [0.001, 0.535]], 0.6),
    torsoF: lathe([[0.001, 0], [0.15, 0], [0.142, 0.06], [0.12, 0.15], [0.13, 0.25], [0.152, 0.33], [0.152, 0.4], [0.14, 0.46], [0.1, 0.5], [0.055, 0.52], [0.001, 0.53]], 0.66),
    vest: lathe([[0.152, 0.05], [0.15, 0.14], [0.164, 0.24], [0.186, 0.33], [0.192, 0.4], [0.18, 0.445]], 0.62),
    stripes: mergeG([[lathe([[0.166, 0.2], [0.168, 0.235]], 0.625)], [lathe([[0.19, 0.31], [0.193, 0.345]], 0.625)]]),
    tie: mergeG([[new THREE.BoxGeometry(0.03, 0.2, 0.012), MX(0, -0.1, 0)], [new THREE.BoxGeometry(0.036, 0.03, 0.014), MX(0, 0.005, 0)]]),
    shirtV: mergeG([[new THREE.BoxGeometry(0.075, 0.16, 0.008), MX(0, -0.06, 0)]]),
    head: mergeG([[SPH, MX(0, 0.02, 0, 0.094, 0.114, 0.104)], [SPH, MX(0, -0.045, 0.022, 0.078, 0.07, 0.08)], [new THREE.ConeGeometry(0.017, 0.045, 8), MX(0, -0.002, 0.103, 1, 1, 1, Math.PI / 2, 0, 0)], [SPHs, MX(0.094, 0.004, -0.004, 0.012, 0.028, 0.02)], [SPHs, MX(-0.094, 0.004, -0.004, 0.012, 0.028, 0.02)], [taperCyl(0.046, 0.05, 0.12), MX(0, -0.08, -0.012)]]),
    face: mergeG([[SPHs, MX(0.035, 0.024, 0.09, 0.012, 0.009, 0.008)], [SPHs, MX(-0.035, 0.024, 0.09, 0.012, 0.009, 0.008)], [new THREE.BoxGeometry(0.036, 0.007, 0.01), MX(0.036, 0.047, 0.095, 1, 1, 1, 0, 0, -0.12)], [new THREE.BoxGeometry(0.036, 0.007, 0.01), MX(-0.036, 0.047, 0.095, 1, 1, 1, 0, 0, 0.12)], [new THREE.BoxGeometry(0.03, 0.005, 0.008), MX(0, -0.05, 0.1)]]),
    hairM: [mergeG([hairCap(0.5, -0.35)]), mergeG([hairCap(0.56, -0.25, 1.02), [SPHs, MX(0.03, 0.115, 0.05, 0.06, 0.028, 0.05)]]), mergeG([hairCap(0.5, -0.35), ...beard]), mergeG([hairCap(0.56, -0.25, 1.02), ...beard]), mergeG([hairCap(0.47, -0.4, 0.985)])],
    hairF: [mergeG([hairCap(0.55, -0.2, 1.03), [SPH, MX(0, -0.07, -0.056, 0.1, 0.17, 0.066)], [SPH, MX(0.084, -0.04, -0.018, 0.03, 0.12, 0.06)], [SPH, MX(-0.084, -0.04, -0.018, 0.03, 0.12, 0.06)]]), mergeG([hairCap(0.55, -0.2, 1.02), [SPH, MX(0, 0.075, -0.1, 0.048, 0.045, 0.048)]])],
    helmet: mergeG([[cap(0.5), MX(0, 0.045, -0.005, 0.112, 0.105, 0.124)], [new THREE.CylinderGeometry(0.14, 0.145, 0.012, 20), MX(0, 0.045, 0.012, 1, 1, 1.12)], [new THREE.BoxGeometry(0.03, 0.03, 0.2), MX(0, 0.148, -0.005)]]),
  };
  const allPeople = [];
  function person(x, z, { shirt, pants, sit = false, helmet = false, vest: hasVest = false, ry = 0, skin, hair } = {}) {
    const work = helmet || hasVest, female = !work && rnd() < 0.35, jacket = !work && !female && rnd() < 0.32 ? jacketMats[(rnd() * 3) | 0] : null;
    skin = skin || skinMats[(rnd() * skinMats.length) | 0]; hair = hair || hairMats[(rnd() * hairMats.length) | 0];
    shirt = shirt || shirtMats[(rnd() * shirtMats.length) | 0]; pants = pants || pantsMats[(rnd() * pantsMats.length) | 0];
    const top = jacket || shirt, longSleeve = !!jacket || work || rnd() < 0.6, sc = female ? 0.95 : 1;
    const g = new THREE.Group(); g.position.set(x, 0.2, z); g.rotation.y = ry; scene.add(g);
    const M2 = (geo, mat, px, py, pz, parent) => { const m = sh(new THREE.Mesh(geo, mat)); m.position.set(px, py, pz); parent.add(m); return m; };
    const hipY = sit ? 0.48 : 0.92;
    const legL = new THREE.Group(), legR = new THREE.Group(); legL.position.set(-0.092 * sc, hipY, 0); legR.position.set(0.092 * sc, hipY, 0); g.add(legL, legR);
    [legL, legR].forEach((lg) => {
      M2(G2.thigh, pants, 0, 0, 0, lg).scale.set(sc, 1, sc);
      const kn = new THREE.Group(); kn.position.y = -0.45; lg.add(kn); M2(G2.shin, pants, 0, 0, 0, kn).scale.set(sc, 1, sc);
      M2(work ? G2.boot : G2.shoe, work ? bootMat : shoeMat, 0, -0.42, 0, kn).scale.setScalar(sc);
      lg.userData.knee = kn; if (sit) { lg.rotation.x = -1.45; kn.rotation.x = 1.45; } else kn.rotation.x = 0.04;
    });
    M2(G2.pelvis, pants, 0, hipY + 0.03, 0, g).scale.set(female ? 1.04 : 1, 1, 1);
    const up = new THREE.Group(); up.position.y = hipY + 0.06; g.add(up);
    M2(female ? G2.torsoF : G2.torsoM, top, 0, 0, 0, up);
    if (hasVest) { M2(G2.vest, vest, 0, 0, 0, up); M2(G2.stripes, vestStripe, 0, 0, 0, up); }
    if (jacket) { M2(G2.shirtV, [shirtMats[0], shirtMats[7], shirtMats[3]][(rnd() * 3) | 0], 0, 0.42, 0.1, up); M2(G2.tie, tieMats[(rnd() * 3) | 0], 0, 0.42, 0.106, up); }
    else if (!female && !work && rnd() < 0.3) M2(G2.tie, tieMats[(rnd() * 3) | 0], 0, 0.42, 0.104, up);
    const shX = female ? 0.17 : 0.195;
    const armL = new THREE.Group(), armR = new THREE.Group(); armL.position.set(-shX, 0.46, 0); armR.position.set(shX, 0.46, 0); up.add(armL, armR);
    [armL, armR].forEach((a, i) => {
      M2(G2.uarm, top, 0, 0, 0, a).scale.set(sc, 1, sc);
      const fa = new THREE.Group(); fa.position.y = -0.29; a.add(fa);
      M2(G2.farm, longSleeve ? top : skin, 0, 0, 0, fa).scale.set(sc, 1, sc);
      M2(G2.hand, skin, 0, -0.25, 0, fa).rotation.y = i ? -Math.PI / 2 : Math.PI / 2;
      a.userData.fore = fa; a.rotation.z = i ? -0.07 : 0.07; fa.rotation.x = sit ? -1.0 : -0.18;
      if (sit) a.rotation.x = -0.45;
    });
    const head = new THREE.Group(); head.position.set(0, 0.62, 0.005); up.add(head); if (female) head.scale.setScalar(0.95);
    M2(G2.head, skin, 0, 0, 0, head); M2(G2.face, faceMat, 0, 0, 0, head);
    if (helmet) M2(G2.helmet, helmetMat, 0, 0, 0, head);
    else M2(female ? G2.hairF[(rnd() * 2) | 0] : G2.hairM[(rnd() * 5) | 0], hair, 0, 0, 0, head);
    g.userData = { head, torso: up, armL, armR, legL, legR, sit, baseY: 0.2 };
    ao(0.55, 0.42, 0, 0, 0.012, g, 0.3); allPeople.push(g);
    return g;
  }
  const pose = {
    walk(p, t, speed = 7) {
      const u = p.userData, ph = t * speed, s = Math.sin(ph), c = Math.cos(ph);
      u.legL.rotation.x = s * 0.5; u.legR.rotation.x = -s * 0.5;
      u.legL.userData.knee.rotation.x = 0.06 + Math.max(0, c) * 0.8; u.legR.userData.knee.rotation.x = 0.06 + Math.max(0, -c) * 0.8;
      u.armL.rotation.x = -s * 0.4; u.armR.rotation.x = s * 0.4;
      u.armL.userData.fore.rotation.x = -0.28 - Math.max(0, -s) * 0.35; u.armR.userData.fore.rotation.x = -0.28 - Math.max(0, s) * 0.35;
      u.torso.rotation.y = s * 0.06; p.position.y = u.baseY + Math.abs(c) * 0.03;
    },
    stand(p) { const u = p.userData; u.legL.rotation.x = u.legR.rotation.x = 0; u.legL.userData.knee.rotation.x = u.legR.userData.knee.rotation.x = 0.04; u.torso.rotation.y = 0; },
    type(p, t, i = 0) { const u = p.userData; u.armL.rotation.x = -0.55 + Math.sin(t * 11 + i) * 0.04; u.armR.rotation.x = -0.55 + Math.cos(t * 12 + i) * 0.04; u.armL.userData.fore.rotation.x = u.armR.userData.fore.rotation.x = -0.95; u.armL.rotation.z = 0.18; u.armR.rotation.z = -0.18; u.head.rotation.y = Math.sin(t * 0.7 + i) * 0.18; u.head.rotation.x = 0.12; },
    talk(p, t, i = 0) { const u = p.userData, b = u.sit ? -0.45 : -0.05; u.armR.rotation.x = b - 0.3 + Math.sin(t * 2.3 + i) * 0.22; u.armR.userData.fore.rotation.x = -0.95 + Math.sin(t * 3.1 + i) * 0.3; u.armL.rotation.x = b; u.armL.userData.fore.rotation.x = u.sit ? -1.0 : -0.25; u.head.rotation.y = Math.sin(t * 1.1 + i) * 0.15; u.head.rotation.x = Math.sin(t * 0.9 + i) * 0.05; },
    point(p, t) { const u = p.userData; u.armR.rotation.x = -1.45; u.armR.userData.fore.rotation.x = -0.12 + Math.sin(t * 2) * 0.08; },
    shake(p, hs) { const u = p.userData; u.armR.rotation.x = -hs * 0.95; u.armR.userData.fore.rotation.x = -0.25 - hs * 0.45; },
    work(p, t, i = 0) { const u = p.userData; u.armL.rotation.x = -0.85 + Math.sin(t * 3 + i) * 0.45; u.armR.rotation.x = -0.85 + Math.cos(t * 3 + i) * 0.45; u.armL.userData.fore.rotation.x = u.armR.userData.fore.rotation.x = -0.7; u.torso.rotation.x = 0.12 + Math.sin(t * 3 + i) * 0.04; },
  };

  updaters.push((t) => { for (let i = 0; i < allPeople.length; i++) allPeople[i].userData.torso.scale.y = 1 + Math.sin(t * 1.5 + i * 1.7) * 0.007; });

  // ---------- HEAD OFFICE TOWER (cutaway interior on approach) ----------
  renderer.localClippingEnabled = true;
  const cutPlane = new THREE.Plane(V(0, -1, 0), 80);
  const tower = { vis: 0, level: 9.85 };
  const CUT_LEVELS = [3.85, 6.85, 3.85, 9.85];
  let glassF, canopy = null;
  const floorGlass = [];
  {
    const X = -29, Z = 41, W = 18, D = 13, G0 = 3.8, FH = 3.0, NF = 3;
    const fy = (k) => 0.4 + (k === 0 ? 0 : G0 + (k - 1) * FH);
    const tm = (src, extra) => { const m = src.clone(); if (extra) Object.assign(m, extra); m.clippingPlanes = [cutPlane]; m.clipShadows = true; allMats.push(m); return m; };
    const slabMat = tm(M.white), coreMat = tm(M.acc), mullion = tm(M.galv), darkT = tm(M.dark), steelT = tm(M.steel), concT = tm(M.concrete), potT = tm(M.concreteDk);
    accentClones.push(coreMat);
    glassF = tm(M.glass, { transparent: true, opacity: 0.92, depthWrite: false });
    const tileMat = tm(mk({ color: '#ded5c4', roughness: 0.45 })), carpet = tm(mk({ color: '#6d7b8d', roughness: 0.95 })), carpet2 = tm(mk({ color: '#8c8f86', roughness: 0.95 }));
    const partMat = tm(new THREE.MeshStandardMaterial({ color: '#d6e6ef', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false }));
    const deskMat = tm(mk({ color: '#f5f5f3', roughness: 0.5 })), woodMat = tm(mk({ color: '#ffffff', map: T.wood, roughness: 0.6 })), wallT = tm(mk({ color: '#f2f1ed', roughness: 0.9 }));
    const screenT = tm(mk({ color: '#0d1420', emissive: '#9cc0ff', emissiveIntensity: 0.6, roughness: 0.3 }));
    const blue = canvasTex(256, (c, s) => { c.fillStyle = '#123a72'; c.fillRect(0, 0, s, s); c.strokeStyle = 'rgba(255,255,255,.22)'; for (let i = 0; i < s; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, s); c.moveTo(0, i); c.lineTo(s, i); c.stroke(); } c.strokeStyle = '#e8f0ff'; c.lineWidth = 3; c.strokeRect(40, 50, 176, 110); c.beginPath(); c.moveTo(40, 50); c.lineTo(128, 20); c.lineTo(216, 50); c.moveTo(80, 160); c.lineTo(80, 210); c.moveTo(176, 160); c.lineTo(176, 210); c.stroke(); for (let i = 0; i < 5; i++) c.strokeRect(56 + i * 32, 80, 20, 20); });
    const blueT = tm(mk({ color: '#ffffff', map: blue, emissive: '#ffffff', emissiveMap: blue, emissiveIntensity: 0.5 }));
    const plantT = tm(mk({ color: '#4e7a3c', roughness: 0.9 })), sofaT = tm(mk({ color: '#35506b', roughness: 0.9 }));
    box(W + 0.8, 0.4, D + 0.8, slabMat, X, 0, Z);
    for (let k = 1; k <= NF; k++) box(W + 0.1, 0.3, D + 0.1, slabMat, X, fy(k) - 0.3, Z);
    box(W + 0.4, 0.5, D + 0.4, slabMat, X, fy(NF) - 0.3, Z);
    box(W + 0.4, 0.7, 0.2, slabMat, X, fy(NF) + 0.2, Z + D / 2 + 0.1); box(W + 0.4, 0.7, 0.2, slabMat, X, fy(NF) + 0.2, Z - D / 2 - 0.1); box(0.2, 0.7, D + 0.4, slabMat, X - W / 2 - 0.1, fy(NF) + 0.2, Z);
    box(2.6, 1.2, 2, mullion, X - 4, fy(NF) + 0.2, Z - 2); box(2.6, 1.2, 2, mullion, X - 0.5, fy(NF) + 0.2, Z - 2); cyl(0.05, 0.05, 4, steelT, X - 7, fy(NF) + 0.2, Z + 3, scene, 6);
    box(3.6, fy(NF) + 0.9, D + 1, coreMat, X + 7.8, 0, Z);
    for (let k = 0; k < NF; k++) {
      const y0 = fy(k), h = (k === 0 ? G0 : FH) - 0.3;
      const fgm = tm(M.glass, { transparent: true, opacity: 0.92, depthWrite: false }), front = box(W, h, 0.05, fgm, X, y0, Z + D / 2);
      floorGlass.push({ mat: fgm, mesh: front, y0, h, o: 0 });
      [front, box(W, h, 0.05, glassF, X, y0, Z - D / 2), box(0.05, h, D, glassF, X - W / 2, y0, Z)].forEach((m) => (m.castShadow = false));
      for (let i = 0; i <= 12; i++) { const x = X - W / 2 + i * 1.5; box(0.08, h, 0.12, mullion, x, y0, Z + D / 2); box(0.08, h, 0.12, mullion, x, y0, Z - D / 2); }
      for (let i = 1; i < 10; i++) box(0.12, h, 0.08, mullion, X - W / 2, y0, Z - D / 2 + i * 1.3);
      box(W - 0.1, 0.04, D - 0.1, k === 0 ? tileMat : k === 1 ? carpet : carpet2, X, y0, Z).castShadow = false;
    }
    {
      const cx = X - 1, zb = Z + D / 2 + 0.1, dep = 3.5, wid = 7.4, yc = 3.3;
      const landM = texMat(T.concrete, 2, 1, { color: '#d9d3c6', roughness: 0.85 });
      box(wid + 0.6, 0.22, 3.2, landM, cx, 0.18, Z + D / 2 + 2.0).castShadow = false;
      box(wid + 0.6, 0.11, 0.4, landM, cx, 0.18, Z + D / 2 + 3.8).castShadow = false;
      const cg = new THREE.MeshStandardMaterial({ color: '#cfe0ea', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false }); allMats.push(cg);
      box(wid, 0.26, 0.22, slabMat, cx, yc, zb + dep - 0.11);
      box(0.22, 0.26, dep, slabMat, cx - wid / 2 + 0.11, yc, zb + dep / 2); box(0.22, 0.26, dep, slabMat, cx + wid / 2 - 0.11, yc, zb + dep / 2);
      box(wid, 0.26, 0.2, slabMat, cx, yc, zb + 0.1);
      box(wid - 0.4, 0.03, dep - 0.4, cg, cx, yc + 0.18, zb + dep / 2).castShadow = false;
      [-1, 1].forEach((sd) => { box(0.3, yc - 0.4, 0.3, slabMat, cx + sd * (wid / 2 - 0.15), 0.4, zb + dep - 0.15); box(0.42, 0.04, 0.42, steelT, cx + sd * (wid / 2 - 0.15), 0.4, zb + dep - 0.15); });
    }
    [-1.3, 0, 1.3].forEach((dx) => box(0.08, 2.6, 0.1, darkT, X - 1 + dx, 0.4, Z + D / 2 + 0.06)); box(2.7, 0.08, 0.1, darkT, X - 1, 3.0, Z + D / 2 + 0.06);
    const elevDoors = (y) => [Z - 1.1, Z + 1.1].forEach((z) => { box(0.06, 2.3, 1.0, mullion, X + 5.97, y, z); box(0.02, 2.3, 0.04, darkT, X + 5.93, y, z); });
    const desk = (x, y, z, ry = 0) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
      box(1.7, 0.05, 0.8, deskMat, 0, 0.72, 0, g); box(0.05, 0.72, 0.75, steelT, -0.8, 0, 0, g); box(0.05, 0.72, 0.75, steelT, 0.8, 0, 0, g);
      box(0.62, 0.38, 0.03, screenT, 0, 1.0, -0.28, g); box(0.04, 0.2, 0.04, darkT, 0, 0.77, -0.28, g); box(0.2, 0.08, 0.14, darkT, 0, 0.77, -0.28, g); box(0.42, 0.02, 0.15, darkT, 0, 0.77, 0.05, g);
      box(0.5, 0.06, 0.5, darkT, 0, 0.44, 0.8, g); box(0.5, 0.5, 0.06, darkT, 0, 0.5, 1.03, g); cyl(0.03, 0.03, 0.44, steelT, 0, 0, 0.8, g, 6); box(0.5, 0.04, 0.5, darkT, 0, 0, 0.8, g);
      return g;
    };
    const plant = (x, y, z) => { cyl(0.26, 0.2, 0.5, potT, x, y, z, scene, 12); const b = sh(new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), plantT)); b.position.set(x, y + 0.85, z); b.scale.set(1, 1.3, 1); scene.add(b); };
    const typing = [], meet = [];
    const y0 = fy(0);
    box(4.2, 1.05, 0.7, woodMat, X - 1, y0, Z + 2.2); box(4.4, 0.06, 0.9, deskMat, X - 1, y0 + 1.05, Z + 2.2); box(0.5, 0.3, 0.03, screenT, X - 1.6, y0 + 1.11, Z + 2.0);
    const recep = person(X - 1, Z + 1.4, { sit: true, ry: 0, shirt: shirtMats[0] }); recep.position.y = y0;
    const guest = person(X - 0.6, Z + 3.6, { ry: Math.PI, shirt: shirtMats[2] }); guest.position.y = y0;
    box(2.4, 0.42, 0.9, sofaT, X - 6.5, y0, Z + 4); box(2.4, 0.5, 0.22, sofaT, X - 6.5, y0 + 0.42, Z + 3.65); box(0.9, 0.42, 0.9, sofaT, X - 4.4, y0, Z + 4);
    box(1, 0.04, 0.6, woodMat, X - 6.5, y0 + 0.4, Z + 5.3); plant(X - 8.3, y0, Z + 5.6); plant(X + 4.6, y0, Z + 5.6);
    const waiting = person(X - 7, Z + 4.2, { sit: true, ry: 0, shirt: shirtMats[5] }); waiting.position.y = y0;
    box(0.05, 3.3, 6.2, partMat, X - 3.2, y0, Z - 3.4); box(5.8, 3.3, 0.05, partMat, X - 6.1, y0, Z - 0.3); box(0.06, 3.3, 0.06, mullion, X - 3.2, y0, Z - 0.3);
    box(1.5, 0.9, 1.0, coreMat, X - 7.5, y0, Z - 4.5); [-0.55, 0.55].forEach((dx) => box(0.14, 2.4, 0.14, steelT, X - 7.5 + dx, y0 + 0.9, Z - 4.5)); box(1.4, 0.3, 0.6, steelT, X - 7.5, y0 + 3.0, Z - 4.5);
    const piston = box(0.4, 1.0, 0.4, steelT, X - 7.5, y0 + 2.0, Z - 4.5); const cube = box(0.36, 0.36, 0.36, concT, X - 7.5, y0 + 0.9, Z - 4.5);
    box(3.2, 0.9, 0.7, deskMat, X - 5, y0, Z - 5.8); for (let k = 0; k < 6; k++) box(0.3, 0.3, 0.3, concT, X - 6.2 + k * 0.45, y0 + 0.9, Z - 5.8);
    box(0.5, 0.3, 0.03, screenT, X - 3.9, y0 + 1.1, Z - 6.0);
    box(2.2, 0.9, 0.7, deskMat, X - 5.2, y0, Z - 1.2); box(0.6, 0.04, 0.4, steelT, X - 5.5, y0 + 0.9, Z - 1.2);
    const tech = person(X - 6.3, Z - 3.6, { ry: -Math.PI / 2, shirt: shirtMats[0] }); tech.position.y = y0;
    elevDoors(y0);
    const courier = person(X, Z + 1, { shirt: shirtMats[1] }); courier.position.y = y0; courier.userData.baseY = y0;
    const path = new THREE.CatmullRomCurve3([V(X - 1, y0, Z + 5.6), V(X + 2, y0, Z + 4.6), V(X + 4.5, y0, Z + 1), V(X + 4.5, y0, Z - 4), V(X + 1.5, y0, Z - 5.2), V(X - 1.2, y0, Z - 2.8), V(X + 1.8, y0, Z + 0.6), V(X + 2.5, y0, Z + 3.5)], true);
    const cp = V(0, 0, 0), cq = V(0, 0, 0);
    const y1 = fy(1);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const dx = X - 7.2 + c * 2.6, dz = Z - 4.6 + r * 3.6;
      desk(dx, y1, dz, 0);
      if (r === 2 && c >= 2) box(1.1, 0.7, 0.03, blueT, dx, y1 + 1.15, dz - 0.3);
      const p = person(dx, dz + 0.8, { sit: true, ry: Math.PI, shirt: shirtMats[(r * 4 + c) % 7] }); p.position.y = y1; typing.push(p);
    }
    box(5.4, 2.4, 0.04, wallT, X - 3, y1 + 0.5, Z - D / 2 + 0.36); box(5.2, 2.2, 0.06, blueT, X - 3, y1 + 0.6, Z - D / 2 + 0.4);
    box(0.9, 1.1, 0.7, deskMat, X + 4.5, y1, Z - 5.5); box(0.7, 0.2, 0.5, darkT, X + 4.5, y1 + 1.1, Z - 5.5);
    plant(X - 8.3, y1, Z + 5.6); plant(X + 4.6, y1, Z + 5.6); plant(X - 8.3, y1, Z - 5.8);
    const lead = person(X - 1.4, Z + 4.6, { ry: Math.PI * 0.85, shirt: shirtMats[0] }); lead.position.y = y1;
    elevDoors(y1);
    const y2 = fy(2);
    box(0.05, 2.7, 5.6, partMat, X - 1, y2, Z - 3.6); box(8, 2.7, 0.05, partMat, X - 5, y2, Z - 0.8); box(0.06, 2.7, 0.06, mullion, X - 1, y2, Z - 0.8);
    box(5.2, 0.06, 1.5, woodMat, X - 5.2, y2 + 0.74, Z - 3.6); [[-2.3, -0.6], [2.3, -0.6], [-2.3, 0.6], [2.3, 0.6]].forEach(([a, b]) => box(0.08, 0.74, 0.08, steelT, X - 5.2 + a, y2, Z - 3.6 + b));
    [-1.8, 0, 1.8].forEach((dx, i) => { const a = person(X - 5.2 + dx, Z - 4.7, { sit: true, ry: 0, shirt: shirtMats[(i + 1) % 7] }); a.position.y = y2; meet.push(a); const b = person(X - 5.2 + dx, Z - 2.5, { sit: true, ry: Math.PI, shirt: shirtMats[(i + 4) % 7] }); b.position.y = y2; meet.push(b); });
    box(2.8, 1.7, 0.04, darkT, X - 5.2, y2 + 0.9, Z - 6.34); box(2.6, 1.5, 0.06, blueT, X - 5.2, y2 + 1.0, Z - 6.3);
    const presenter = person(X - 2.4, Z - 5.6, { ry: Math.PI * 1.25, shirt: shirtMats[0] }); presenter.position.y = y2;
    box(0.05, 2.7, 5.4, partMat, X - 3, y2, Z + 3.7); box(6, 2.7, 0.05, partMat, X - 6, y2, Z + 1);
    box(2.2, 0.06, 1, woodMat, X - 6, y2 + 0.74, Z + 3.2); box(2.0, 0.6, 0.9, woodMat, X - 6, y2, Z + 3.2); box(0.62, 0.38, 0.03, screenT, X - 6.3, y2 + 1.0, Z + 3.0);
    const director = person(X - 6, Z + 4.1, { sit: true, ry: Math.PI, shirt: shirtMats[2] }); director.position.y = y2;
    const visitor = person(X - 6, Z + 2.2, { sit: true, ry: 0, shirt: shirtMats[3] }); visitor.position.y = y2;
    box(0.4, 2.2, 3, woodMat, X - 8.7, y2, Z + 4.5); plant(X - 3.6, y2, Z + 5.8);
    desk(X + 1.5, y2, Z + 2, 0); const p2 = person(X + 1.5, Z + 2.8, { sit: true, ry: Math.PI }); p2.position.y = y2; typing.push(p2);
    desk(X + 4, y2, Z + 2, 0); const p3 = person(X + 4, Z + 2.8, { sit: true, ry: Math.PI }); p3.position.y = y2; typing.push(p3);
    box(1.6, 0.9, 0.6, deskMat, X + 3.5, y2, Z - 5.6); box(0.3, 0.4, 0.3, darkT, X + 3.3, y2 + 0.9, Z - 5.6);
    elevDoors(y2);
    for (let k = 3; k < NF; k++) {
      elevDoors(fy(k));
      const yk = fy(k);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
        const dx = X - 7.2 + c * 2.6, dz = Z - 3.8 + r * 4.2;
        desk(dx, yk, dz, 0);
        if ((r + c + k) % 2 === 0) { const p = person(dx, dz + 0.8, { sit: true, ry: Math.PI, shirt: shirtMats[(r * 4 + c + k) % 7] }); p.position.y = yk; typing.push(p); }
      }
      plant(X - 8.3, yk, Z + 5.6); plant(X + 4.6, yk, Z - 5.8);
    }
    updaters.push((t) => {
      const c = t % CYCLE;
      screenT.emissiveIntensity = night ? 1.3 : 0.6; blueT.emissiveIntensity = (night ? 0.9 : 0.5) + (c > 4 && c < 8 ? 0.35 + Math.sin(t * 3) * 0.15 : 0);
      typing.forEach((p, i) => pose.type(p, t, i));
      pose.talk(recep, t); pose.talk(guest, t, 2); pose.talk(waiting, t, 5);
      const pu = (t * 0.03) % 1; path.getPointAt(pu, cp); path.getPointAt((pu + 0.01) % 1, cq); courier.position.set(cp.x, y0, cp.z); courier.lookAt(cq.x, y0, cq.z); pose.walk(courier, t, 8);
      if (c % 8 < 4) pose.point(lead, t); else pose.talk(lead, t, 1);
      const lc = c % 4, press = seg(lc, 0.8, 3.0); piston.position.y = y0 + 2.5 - press * 1.15; cube.scale.y = lc > 3.0 ? 0.78 : 1;
      if (lc > 3.0 && lc < 3.2) burst(dust, V(X - 7.5, y0 + 1.3, Z - 4.5), 6, 1.2, 0.8, 1.2);
      tech.rotation.y = -Math.PI / 2 + Math.sin(t * 0.6) * 0.4; pose.work(tech, t);
      meet.forEach((p, i) => pose.talk(p, t, i)); pose.point(presenter, t);
      const hc = c % 8, hs = hc > 1 && hc < 4 ? Math.sin(Math.PI * seg(hc, 1, 4)) : 0;
      if (hs > 0.01) { pose.shake(director, hs); pose.shake(visitor, hs); } else { pose.type(director, t, 9); pose.talk(visitor, t, 3); }
    });
    pad(-10, 28, 32, 54);
    box(36, 0.03, 2.2, mk({ color: '#d4cfc2', roughness: 0.9 }), 9, 0.19, 43).castShadow = false;
    const benchW = mk({ color: '#ffffff', map: T.wood, roughness: 0.7 });
    [0, 8, 16, 24].forEach((x) => { box(1.8, 0.08, 0.45, benchW, x, 0.6, 45); box(1.8, 0.4, 0.06, benchW, x, 0.68, 45.22); [-0.7, 0.7].forEach((dx) => box(0.08, 0.42, 0.42, M.steelDk, x + dx, 0.18, 45)); });
    for (let i = 0; i < 3; i++) treeQ.push([8 + i * 7, 34.5, 'round']);
    const flagTex = canvasTex(300, (c) => {
      c.canvas.height = 150;
      c.fillStyle = '#0099b5'; c.fillRect(0, 0, 300, 50); c.fillStyle = '#ce1126'; c.fillRect(0, 48, 300, 5); c.fillStyle = '#ffffff'; c.fillRect(0, 53, 300, 44); c.fillStyle = '#ce1126'; c.fillRect(0, 97, 300, 5); c.fillStyle = '#1eb53a'; c.fillRect(0, 102, 300, 48);
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(30, 25, 15, 0, Math.PI * 2); c.fill(); c.fillStyle = '#0099b5'; c.beginPath(); c.arc(36, 25, 13.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffffff'; [[3, 10], [4, 25], [5, 40]].forEach(([n, y]) => { for (let i = 0; i < n; i++) { c.beginPath(); c.arc(100 - i * 13, y - 2, 3, 0, Math.PI * 2); c.fill(); } });
    });
    const logoTex = new THREE.TextureLoader().load('/media/tour/insof-mark.png'); logoTex.colorSpace = THREE.SRGBColorSpace; logoTex.anisotropy = 16;
    const wfC = document.createElement('canvas'); wfC.width = 512; wfC.height = 256; const wfX = wfC.getContext('2d'); wfX.fillStyle = '#ffffff'; wfX.fillRect(0, 0, 512, 256);
    const wfT = new THREE.CanvasTexture(wfC); wfT.colorSpace = THREE.SRGBColorSpace; wfT.anisotropy = 16;
    const wfImg = new Image(); wfImg.onload = () => { wfX.drawImage(wfImg, 256 - 88, 128 - 90, 176, 180); wfT.needsUpdate = true; }; wfImg.src = '/media/tour/insof-mark.png';
    const flagMats = [mk({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }), mk({ map: wfT, side: THREE.DoubleSide, roughness: 0.8 })];
    const flags = [];
    [0, 1, 2].forEach((i) => {
      cyl(0.07, 0.09, 10, M.galv, X - 14 + i * 2.2, 0.2, Z + 10, scene, 8);
      const g = new THREE.PlaneGeometry(2, 1, 16, 1); g.translate(1, 0, 0);
      const fm = sh(new THREE.Mesh(g, i === 1 ? flagMats[0] : flagMats[1])); fm.position.set(X - 14 + i * 2.2, 9.6, Z + 10); scene.add(fm); flags.push(fm);
    });
    updaters.push((t) => flags.forEach((fm, j) => { const p = fm.geometry.attributes.position; for (let k = 0; k < p.count; k++) { const x = p.getX(k); p.setZ(k, Math.sin(x * 2.2 - t * 4 + j) * 0.12 * x); } p.needsUpdate = true; fm.geometry.computeVertexNormals(); fm.rotation.y = 0.6; }));
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 5.4), tm(mk({ color: '#ffffff', roughness: 0.5 }))); tile.rotation.y = Math.PI / 2; tile.position.set(X + 9.7, 5.6, Z - 3.0); tile.material.polygonOffset = true; tile.material.polygonOffsetFactor = -2; tile.material.polygonOffsetUnits = -2; scene.add(tile);
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.7), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); mark.rotation.y = Math.PI / 2; mark.position.set(X + 9.78, 5.6, Z - 3.0); scene.add(mark);
  }

  // ---------- WAREHOUSE INTERIOR, FORKLIFT, CONTACT SHADOWS ----------
  {
    const rackM = M.acc.clone(); allMats.push(rackM); accentClones.push(rackM);
    const woodM = mk({ color: '#a07c52', roughness: 0.85 }), sackM = mk({ color: '#e9e4d8', roughness: 0.9 });
    const bays = [-3, -2, -1, 0, 1, 2, 3].map((i) => 81.5 + i * 2.45), levels = [0.27, 1.75, 3.35, 4.95];
    const pallet = (x, y, z, kind) => { const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g); box(1.6, 0.14, 1.1, woodM, 0, 0, 0, g);
      if (kind === 0) { for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) box(0.68, 0.5, 0.5, M.concrete, -0.36 + a * 0.72, 0.14, -0.26 + b * 0.52, g); }
      else if (kind === 1) { for (let k = 0; k < 6; k++) { const r = cyl(0.09, 0.09, 1.5, M.rust, 0, 0, 0, g, 6); r.rotation.z = Math.PI / 2; r.position.set(0, 0.24 + Math.floor(k / 3) * 0.17, -0.2 + (k % 3) * 0.2); } }
      else box(1.4, 0.6, 0.9, sackM, 0, 0.14, 0, g);
      return g; };
    [44.4, 40.4].forEach((rz, row) => {
      bays.forEach((bx) => [-1.2, 1.2].forEach((dx) => [-0.55, 0.55].forEach((dz) => box(0.08, 6, 0.08, rackM, bx + dx, 0.26, rz + dz))));
      levels.slice(1).forEach((ly) => [-0.55, 0.55].forEach((dz) => box(17.2, 0.1, 0.08, rackM, 81.5, ly - 0.1, rz + dz)));
      bays.forEach((bx, bi) => levels.forEach((ly, li) => { if (row === 0 && bi === 3 && li === 1) return; if ((bi * 7 + li * 3 + row) % 5 === 4) return; pallet(bx, ly, rz, (bi + li + row) % 3); }));
    });
    const moving = pallet(81.5, 1.75, 44.4, 0);
    const fl = new THREE.Group(); scene.add(fl);
    box(1.3, 0.9, 1.8, M.yellow, 0, 0.3, 0.25, fl); box(1.3, 0.8, 0.5, M.dark, 0, 0.3, 1.2, fl);
    [[-0.6, -0.45], [0.6, -0.45], [-0.6, 0.85], [0.6, 0.85]].forEach(([x, z]) => box(0.07, 1.25, 0.07, M.dark, x, 1.2, z, fl));
    box(1.3, 0.06, 1.4, M.dark, 0, 2.45, 0.2, fl);
    [-0.45, 0.45].forEach((x) => box(0.1, 2.6, 0.12, M.steelDk, x, 0.25, -0.8, fl));
    const carriage = new THREE.Group(); fl.add(carriage);
    box(1.1, 0.55, 0.06, M.steelDk, 0, 0, -0.9, carriage); [-0.32, 0.32].forEach((x) => box(0.12, 0.05, 1.3, M.steelDk, x, 0, -1.6, carriage));
    [[-0.62, -0.5], [0.62, -0.5], [-0.62, 0.9], [0.62, 0.9]].forEach(([x, z]) => { const wh = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.24, 14), M.tire)); wh.rotation.z = Math.PI / 2; wh.position.set(x, 0.32, z); fl.add(wh); });
    const drv = person(0, 0, { sit: true, ry: Math.PI, shirt: shirtMats[1], vest: true }); fl.add(drv); drv.position.set(0, 0.55, 0.45);
    ao(1.5, 2.6, 0, 0.05, 0.02, fl, 0.3);
    const FK = [[0, 46, 1.48, 'r'], [0.05, 46, 1.48, 'f'], [0.5, 46, 1.6, 'f'], [1.4, 47.2, 1.6, 'f'], [2.2, 47.2, 0.3, 'f'], [4.6, 50.4, 0.3, 'f'], [5.2, 50.4, 0, 'f'], [5.25, 50.4, 0, 's'], [6.3, 51.2, 0, 's'], [8.0, 51.2, 0, 's'], [8.8, 50.4, 0, 's'], [8.85, 50.4, 0, 'f'], [9.4, 50.4, 0.3, 'f'], [11.8, 47.2, 0.3, 'f'], [12.8, 47.2, 1.6, 'f'], [13.8, 46, 1.6, 'f'], [14.4, 46, 1.48, 'f'], [14.45, 46, 1.48, 'r'], [16, 46, 1.48, 'r']];
    updaters.push((t) => {
      const c = t % CYCLE; let i = 0; while (i < FK.length - 2 && FK[i + 1][0] <= c) i++;
      const a = FK[i], b = FK[i + 1], u = ease(seg(c, a[0], b[0])), z = lerp(a[1], b[1], u), fy = lerp(a[2], b[2], u);
      fl.position.set(81.5, 0.22, z); carriage.position.y = fy; drv.userData.head.rotation.y = Math.sin(t * 0.8) * 0.3;
      if (a[3] === 'f') moving.position.set(81.5, 0.27 + fy, z - 1.6); else if (a[3] === 'r') moving.position.set(81.5, 1.75, 44.4); else moving.position.set(81.5, 0.27, 48.8);
    });
    const tw = person(-37.5, -6.7, { shirt: shirtMats[2], helmet: true, vest: true, ry: Math.PI }); tw.position.y = 13.32; tw.userData.baseY = 13.32;
    updaters.push((t) => pose.work(tw, t, 2));
    ao(7.4, 7.4, -36, -9); ao(22, 6, -45, -20); ao(20, 13, 82, 44); ao(19, 14, -29, 41); ao(10, 4, 40, -13); ao(18, 12, 60, 44, 0.23, scene, 0.22);
    fleet.forEach((v) => ao(2.6, 8.6, 0, 0, 0.02, v, 0.32));
  }

  // ---------- SITE: street, gates with barriers, fence, employee parking ----------
  {
    const asphM = (rx, ry) => texMat(T.asphalt, rx, ry, { color: '#ffffff', roughness: 0.95 });
    const paveM = texMat(T.concrete, 6, 2, { color: '#d9d3c6', roughness: 0.85 });
    const slab = (x0, x1, z0, z1, mat, h = 0.24) => { const m = box(x1 - x0, h, z1 - z0, mat, (x0 + x1) / 2, 0, (z0 + z1) / 2); m.castShadow = false; return m; };
    const marks = [], mark = (cx, cz, w, d, y = 0.24) => marks.push([cx, cz, w, d, y]);
    // public street (where the old railway ran) + sidewalk
    slab(-260, 300, 78, 86, asphM(70, 1), 0.22);
    for (let x = -256; x < 296; x += 6) mark(x + 1.5, 82, 3, 0.15, 0.22);
    mark(20, 78.35, 560, 0.12, 0.22); mark(20, 85.65, 560, 0.12, 0.22);
    slab(-86, 1.6, 76.4, 78, paveM, 0.3); slab(11.4, 101, 76.4, 78, paveM, 0.3);
    // level crossing where the street meets the relocated railway
    slab(RAIL_X - 2.4, RAIL_X + 2.4, 78, 86, mk({ color: '#3a3b3d', roughness: 0.9 }), 0.71);
    const xbT = canvasTex(128, (c, s) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s); c.fillStyle = '#c62828'; c.fillRect(0, 0, s, 20); c.fillRect(0, s - 20, s, 20); });
    const xbM = mk({ map: xbT, roughness: 0.6 });
    [[RAIL_X + 4.2, 77.0, Math.PI / 2], [RAIL_X - 4.2, 87.0, -Math.PI / 2]].forEach(([x, z, ry]) => { cyl(0.05, 0.05, 2.7, M.galv, x, 0, z, scene, 8); const g = new THREE.Group(); g.position.set(x, 2.3, z); g.rotation.y = ry; scene.add(g); [0.6, -0.6].forEach((a) => { const b = box(1.4, 0.22, 0.03, xbM, 0, -0.11, 0.05, g); b.rotation.z = a; }); });
    // gate driveway, ring road around the parking, drop-off lane at the entrance
    slab(1.6, 11.4, 66.3, 78, asphM(2, 2));
    slab(6.45, 6.75, 69.4, 72.6, paveM, 0.36);
    mark(6.6, 67.8, 0.12, 2.8); mark(4.3, 71.0, 4.0, 0.3); mark(8.9, 70.0, 4.0, 0.3);
    slab(-38.5, 6.5, 51.5, 55.5, asphM(6, 1));
    slab(-38.5, -34.3, 55.5, 61.7, asphM(1, 1));
    slab(2.2, 6.4, 55.5, 61.7, asphM(1, 1));
    slab(-38.5, 11.4, 61.7, 66.3, asphM(7, 1));
    slab(-32.2, -5.2, 56.7, 61.7, asphM(4, 1));
    slab(-34.3, 2.2, 55.5, 56.7, paveM, 0.32);
    slab(-34.3, -32.2, 56.7, 61.7, paveM, 0.32);
    slab(-5.2, 2.2, 56.7, 61.7, paveM, 0.32);
    slab(-38.5, 1.6, 66.3, 67.5, paveM, 0.32);
    [52.0, 53.0, 54.0, 55.0].forEach((z) => mark(-30, z, 3.0, 0.5));
    for (let k = 0; k <= 10; k++) mark(-32.2 + k * 2.7, 59.2, 0.12, 4.6);
    for (let k = 0; k < 10; k++) box(1.5, 0.12, 0.16, M.concrete, -30.85 + k * 2.7, 0.24, 57.35);
    const mI = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.012, 1), M.white, marks.length), mo = new THREE.Object3D();
    marks.forEach(([cx, cz, w, d, y], i) => { mo.position.set(cx, y + 0.006, cz); mo.scale.set(w, 1, d); mo.updateMatrix(); mI.setMatrixAt(i, mo.matrix); }); mI.receiveShadow = true; scene.add(mI);
    // see-through welded-mesh fence on the street side and around the truck gate
    const fenceT = canvasTex(128, (c, s) => { c.clearRect(0, 0, s, s); c.fillStyle = '#ffffff'; for (let i = 0; i < s; i += 16) c.fillRect(i, 0, 3, s); for (let j = 0; j < s; j += 42) c.fillRect(0, j, s, 4); c.fillRect(0, s - 6, s, 6); });
    const fenceM = new THREE.MeshStandardMaterial({ color: '#59626a', map: fenceT, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.45, envMapIntensity: 0.8 }); allMats.push(fenceM);
    const FSEG = [[-86, 72, 1.6, 72], [11.8, 72, 101, 72], [101, 72, 101, 28], [101, 28, 116, 28], [116, 28, 116, 21.6], [116, 12.4, 116, 6], [116, 6, 101, 6], [101, 6, 101, -52]];
    const panels = [], posts = [];
    FSEG.forEach(([x0, z0, x1, z1]) => { const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 2.5)), ry = Math.atan2(-(z1 - z0), x1 - x0); for (let i = 0; i < n; i++) { const a = (i + 0.5) / n; panels.push([lerp(x0, x1, a), lerp(z0, z1, a), ry, L / n]); } for (let i = 0; i <= n; i++) { const a = i / n; posts.push([lerp(x0, x1, a), lerp(z0, z1, a)]); } });
    const pI = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1.9), fenceM, panels.length), po = new THREE.Object3D();
    panels.forEach(([x, z, ry, w], i) => { po.position.set(x, 1.1, z); po.rotation.set(0, ry, 0); po.scale.set(w, 1, 1); po.updateMatrix(); pI.setMatrixAt(i, po.matrix); }); scene.add(pI);
    const qI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 2.1, 0.07), M.steelDk, posts.length);
    posts.forEach(([x, z], i) => { po.position.set(x, 1.05, z); po.rotation.set(0, 0, 0); po.scale.set(1, 1, 1); po.updateMatrix(); qI.setMatrixAt(i, po.matrix); }); qI.castShadow = true; scene.add(qI);
    // guard booths
    const boothGlass = new THREE.MeshStandardMaterial({ color: '#b9cdd8', roughness: 0.05, metalness: 0.25, transparent: true, opacity: 0.34, depthWrite: false }); allMats.push(boothGlass);
    const scr = mk({ color: '#0d1420', emissive: '#8fb6ff', emissiveIntensity: 0.5, roughness: 0.3 });
    const signs = [];
    const booth = (cx, cz, ry) => {
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = ry; scene.add(g);
      box(3.0, 0.32, 3.0, M.concreteDk, 0, 0, 0, g);
      box(2.6, 0.9, 2.6, M.white, 0, 0.32, 0, g);
      box(2.54, 1.2, 2.54, boothGlass, 0, 1.22, 0, g).castShadow = false;
      [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]].forEach(([a, b]) => box(0.1, 1.2, 0.1, M.white, a, 1.22, b, g));
      box(2.6, 0.42, 2.6, M.white, 0, 2.42, 0, g);
      box(3.3, 0.16, 3.3, M.dark, 0, 2.84, 0, g);
      box(0.9, 2.1, 0.05, M.dark, 0.7, 0.32, -1.31, g);
      box(1.7, 0.05, 0.55, M.white, 0, 1.12, 0.95, g); box(0.5, 0.32, 0.04, scr, 0.3, 1.17, 0.9, g);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.32), new THREE.MeshBasicMaterial({ color: '#2a4aa7' })); sign.position.set(0, 2.63, 1.312); g.add(sign); signs.push(sign);
    };
    booth(13.5, 69.0, -Math.PI / 2); booth(108, 9.9, 0);
    // boom barriers: arm pivots up when a vehicle stands in its zone
    const stripeT = canvasTex(256, (c, s) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffffff' : '#d32f2f'; c.fillRect(i * 32, 0, 32, s); } });
    const armM = mk({ map: stripeT, roughness: 0.45 });
    const barriers = [];
    const barrier = (px, pz, dx, dz, len, zone) => {
      const base = new THREE.Group(); base.position.set(px, 0.24, pz); base.rotation.y = Math.atan2(-dz, dx); scene.add(base);
      box(0.42, 1.05, 0.36, M.yellow, 0, 0, 0, base); box(0.46, 0.06, 0.4, M.dark, 0, 1.05, 0, base);
      const piv = new THREE.Group(); piv.position.set(0.05, 0.92, 0.24); base.add(piv);
      box(len, 0.09, 0.07, armM, len / 2, -0.045, 0, piv);
      const b = { piv, zone, a: 0, open: false }; barriers.push(b); return b;
    };
    const bS = [barrier(1.8, 70.5, 1, 0, 4.6, [2.2, 6.4, 65.5, 74.4]), barrier(11.4, 70.5, -1, 0, 4.6, [6.8, 11.0, 66.6, 75.5])];
    const bE = [barrier(112, 21.0, 0, -1, 4.0, [106.8, 117, 17, 20.6]), barrier(112, 13.0, 0, 1, 4.0, [107, 117.2, 13.4, 17])];
    // security guards
    const navy = cloth('#22324d', 0.8);
    const guard = (x, z, ry, bars, ph) => {
      const p = person(x, z, { shirt: navy, pants: pantsMats[0], ry }); p.position.y = 0.3; p.userData.baseY = 0.3;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.148, 0.08, 18), navy); cap.position.y = 0.11; cap.castShadow = true; p.userData.head.add(cap);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.12), M.dark); visor.position.set(0, 0.078, 0.135); p.userData.head.add(visor);
      return { p, ry, bars, ph };
    };
    const guards = [guard(11.95, 67.6, -Math.PI / 2, bS, 0), guard(110.3, 11.9, 0, bE, 2)];
    // parking sign + lamps
    const pSign = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.275), mk({ color: '#1f4fa0', roughness: 0.6 })); pSign.position.set(0.6, 2.45, 57.62); pSign.castShadow = true; scene.add(pSign);
    cyl(0.045, 0.045, 2.9, M.galv, 0.6, 0.32, 57.55, scene, 8);
    const lamp = (x, z) => { cyl(0.07, 0.09, 5.2, M.steelDk, x, 0.32, z, scene, 8); box(0.12, 0.1, 1.2, M.steelDk, x, 5.45, z - 0.5); box(0.4, 0.12, 0.6, M.lamp, x, 5.35, z - 1.0); const gl = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: T.dot, color: '#ffcf8a', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending })); gl.rotation.x = -Math.PI / 2; gl.position.set(x, 0.27, z - 1.0); gl.visible = false; scene.add(gl); nightOnly.push(gl); };
    lamp(-33.25, 58.9); lamp(-1.6, 59.6); lamp(-14, 66.9); lamp(14.6, 66.6);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
      const c = document.createElement('canvas'); c.width = 1760; c.height = 256; const x = c.getContext('2d'); x.scale(2, 2);
      x.fillStyle = '#2a4aa7'; x.fillRect(0, 0, 880, 128); x.fillStyle = '#ffffff'; x.font = `700 72px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText("QO'RIQLASH", 440, 68);
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 16;
      signs.forEach((s) => { s.material.color.set('#ffffff'); s.material.map = tx; s.material.toneMapped = false; s.material.needsUpdate = true; });
      const p = document.createElement('canvas'); p.width = 512; p.height = 768; const y = p.getContext('2d'); y.scale(2, 2);
      y.fillStyle = '#ffffff'; y.fillRect(0, 0, 256, 384); y.fillStyle = '#1f4fa0'; y.fillRect(8, 8, 240, 240);
      y.fillStyle = '#ffffff'; y.font = `800 200px ${FONT}`; y.textAlign = 'center'; y.textBaseline = 'middle'; y.fillText('P', 128, 140);
      y.fillStyle = '#16181a'; y.font = `700 32px ${FONT}`; y.fillText('Xodimlar', 128, 292); y.fillText('avtoturargohi', 128, 336);
      const pt = new THREE.CanvasTexture(p); pt.colorSpace = THREE.SRGBColorSpace; pt.anisotropy = 16; pSign.material.map = pt; pSign.material.color.set('#ffffff'); pSign.material.needsUpdate = true;
    });

    // ---------- CARS (lofted bodies: plan outline x side profile x superellipse sections) ----------
    const carGlass = mk({ color: '#1a2128', roughness: 0.05, metalness: 0.85, envMapIntensity: 1.3 });
    const blackM = mk({ color: '#141516', roughness: 0.55, metalness: 0.2 });
    const chromeM = mk({ color: '#d7dadc', roughness: 0.15, metalness: 1 });
    const headM = mk({ color: '#f4f6f8', emissive: '#eaf2ff', emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.3 });
    const tailM = mk({ color: '#8f1414', emissive: '#ff2a1a', emissiveIntensity: 0.25, roughness: 0.3 });
    const amberM = mk({ color: '#e08a1e', emissive: '#ff9a2a', emissiveIntensity: 0.2, roughness: 0.3 });
    const plateM = mk({ color: '#f2f2f0', roughness: 0.5 }), alloyM = mk({ color: '#ffffff', map: T.alloy, roughness: 0.3, metalness: 0.8 });
    const tireM = mk({ color: '#1b1c1e', roughness: 0.9, side: THREE.DoubleSide });
    const tireG = new THREE.LatheGeometry([[0.6, -0.5], [0.8, -0.5], [0.94, -0.45], [1, -0.32], [1, 0.32], [0.94, 0.45], [0.8, 0.5], [0.6, 0.5]].map(([r, y]) => new THREE.Vector2(r, y)), 28); tireG.rotateZ(Math.PI / 2);
    const rimG = new THREE.CylinderGeometry(1, 1, 1, 24); rimG.rotateZ(Math.PI / 2);
    const paints = {};
    const paint = (hex, metal) => paints[hex + metal] || (paints[hex + metal] = phys({ color: hex, metalness: metal, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.15 }));
    const spline = (pts) => {
      const n = pts.length, d = []; for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
      const m = pts.map((p, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : 2 / (1 / d[i - 1] + 1 / d[i])));
      return (z) => { if (z <= pts[0][0]) return pts[0][1]; if (z >= pts[n - 1][0]) return pts[n - 1][1]; let i = 0; while (z > pts[i + 1][0]) i++; const z0 = pts[i][0], h = pts[i + 1][0] - z0, u = (z - z0) / h, u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * pts[i][1] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * pts[i + 1][1] + (u3 - u2) * h * m[i + 1]; };
    };
    const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
    // real dimensions (m); zf measured from the front bumper; lamps: [x0, x1 (fraction of half-width), y centre, height]
    const CARS = {
      spark: { L: 3.64, W: 1.6, H: 1.52, r: 0.29, ax: [0.62, 2.995], n: 4, mt: 4.5, mb: 2.8, clad: 0.06, gw: 0.9, tum: 0.17, mg: 3.6,
        bot: [[0, 0.42], [0.12, 0.3], [0.4, 0.22], [3.3, 0.22], [3.55, 0.32], [3.64, 0.46]],
        belt: [[0, 0.6], [0.1, 0.7], [0.5, 0.82], [0.98, 0.94], [2.1, 0.99], [3.2, 1.04], [3.5, 1.0], [3.6, 0.9], [3.64, 0.8]],
        gh: { zA: 0.98, zWs: 1.72, zRr: 3.18, zC: 3.5, zB: 2.02, zCp: 2.95 }, handles: [1.72, 2.62],
        lamps: { head: [0.42, 0.86, 0.68, 0.14], tail: [0.72, 0.9, 0.84, 0.28], grille: [0.34, 0.6, 0.06], intake: [0.46, 0.36, 0.12], plate: [0.42, 0.6] } },
      lacetti: { L: 4.515, W: 1.725, H: 1.445, r: 0.31, ax: [0.86, 3.46], n: 5, mt: 5, mb: 3, clad: 0.06, gw: 0.92, tum: 0.16, mg: 3.8,
        bot: [[0, 0.4], [0.15, 0.28], [0.5, 0.21], [4.05, 0.21], [4.4, 0.3], [4.515, 0.44]],
        belt: [[0, 0.62], [0.12, 0.72], [0.6, 0.83], [1.45, 0.93], [2.6, 0.97], [3.8, 1.0], [4.3, 0.99], [4.45, 0.92], [4.515, 0.8]],
        gh: { zA: 1.45, zWs: 2.18, zRr: 3.2, zC: 3.82, zB: 2.62, zCp: 3.45 }, handles: [2.35, 3.25],
        lamps: { head: [0.36, 0.84, 0.69, 0.13], tail: [0.48, 0.86, 0.8, 0.14], grille: [0.36, 0.64, 0.1], chrome: [0.38, 0.7], intake: [0.5, 0.38, 0.12], plate: [0.43, 0.6] } },
      elantra: { L: 4.675, W: 1.825, H: 1.43, r: 0.32, ax: [0.91, 3.63], n: 5.5, mt: 5.5, mb: 3, clad: 0.06, gw: 0.92, tum: 0.18, mg: 4,
        bot: [[0, 0.38], [0.15, 0.26], [0.5, 0.2], [4.2, 0.2], [4.55, 0.3], [4.675, 0.44]],
        belt: [[0, 0.58], [0.12, 0.68], [0.7, 0.8], [1.6, 0.92], [2.8, 0.98], [3.95, 1.04], [4.45, 1.03], [4.6, 0.96], [4.675, 0.84]],
        gh: { zA: 1.6, zWs: 2.42, zRr: 3.25, zC: 4.02, zB: 2.85, zCp: 3.5 }, handles: [2.55, 3.35],
        lamps: { head: [0.42, 0.88, 0.71, 0.06], tail: [0, 0.9, 0.84, 0.05], grille: [0.62, 0.47, 0.24], plate: [0.42, 0.6] } },
      chazor: { L: 4.765, W: 1.837, H: 1.495, r: 0.33, ax: [0.95, 3.668], n: 5.5, mt: 5.5, mb: 3, clad: 0.07, gw: 0.92, tum: 0.17, mg: 4,
        bot: [[0, 0.4], [0.16, 0.27], [0.5, 0.21], [4.3, 0.21], [4.62, 0.31], [4.765, 0.45]],
        belt: [[0, 0.62], [0.12, 0.72], [0.7, 0.84], [1.62, 0.95], [2.9, 1.0], [4.0, 1.05], [4.55, 1.04], [4.7, 0.97], [4.765, 0.85]],
        gh: { zA: 1.62, zWs: 2.42, zRr: 3.42, zC: 4.04, zB: 2.9, zCp: 3.62 }, handles: [2.62, 3.45],
        lamps: { head: [0.48, 0.88, 0.74, 0.07], tail: [0, 0.9, 0.86, 0.06], intake: [0.6, 0.38, 0.14], plate: [0.45, 0.62] } },
      yuan: { L: 4.31, W: 1.83, H: 1.675, r: 0.35, ax: [0.82, 3.44], n: 5, mt: 5, mb: 3, clad: 0.13, flare: 0.12, gw: 0.92, tum: 0.12, mg: 4.5, rails: true,
        bot: [[0, 0.46], [0.15, 0.33], [0.45, 0.25], [3.9, 0.25], [4.2, 0.35], [4.31, 0.5]],
        belt: [[0, 0.7], [0.12, 0.82], [0.6, 0.96], [1.25, 1.06], [2.6, 1.1], [4.0, 1.15], [4.2, 1.12], [4.28, 1.02], [4.31, 0.92]],
        gh: { zA: 1.25, zWs: 1.98, zRr: 3.82, zC: 4.18, zB: 2.45, zCp: 3.4 }, handles: [2.2, 3.05],
        lamps: { head: [0.46, 0.88, 0.86, 0.07], tail: [0, 0.9, 0.94, 0.07], intake: [0.62, 0.48, 0.16], plate: [0.52, 0.68] } },
      g: { L: 4.62, W: 1.93, H: 1.97, r: 0.4, ax: [0.82, 3.71], n: 14, mt: 10, mb: 6, clad: 0.08, flare: 0.16, gw: 0.955, tum: 0.035, mg: 12, boxy: true,
        bot: [[0, 0.5], [0.12, 0.36], [0.3, 0.3], [4.35, 0.3], [4.55, 0.38], [4.62, 0.5]],
        belt: [[0, 1.0], [0.06, 1.08], [0.4, 1.1], [1.46, 1.13], [4.4, 1.14], [4.58, 1.12], [4.62, 1.08]],
        gh: { zA: 1.46, zWs: 1.64, zRr: 4.5, zC: 4.6, zB: 2.62, zCp: 3.65 }, handles: [2.4, 3.4],
        lamps: { intake: [0.5, 0.42, 0.12], plate: [0.48, 0.55] } },
    };
    function buildCar(type, hex, opt = {}) {
      const S = CARS[type], GH = S.gh, g = new THREE.Group(), L = S.L, hw0 = S.W / 2, R = S.r + 0.06;
      const pm = paint(hex, opt.metal ?? 0.55), rm = opt.roof ? paint(opt.roof, 0.3) : pm;
      const bot0 = spline(S.bot), belt = spline(S.belt), zl = (zf) => L / 2 - zf;
      const archD = (zf) => Math.min(Math.abs(zf - S.ax[0]), Math.abs(zf - S.ax[1]));
      const bot = (zf) => { const d = archD(zf); return d < R ? Math.max(bot0(zf), S.r + Math.sqrt(R * R - d * d)) : bot0(zf); };
      const hw = (zf) => hw0 * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs((2 * zf - L) / L)), S.n)), 1 / S.n);
      const roof = spline([[GH.zA, belt(GH.zA) - 0.035], [GH.zWs, S.H - 0.03], [(GH.zWs + GH.zRr) / 2, S.H], [GH.zRr, S.H - 0.035], [GH.zC, belt(GH.zC) - 0.035]]);
      const build = (pos, sets, mats) => {
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const all = []; sets.forEach((ix, k) => { if (!ix.length) return; geo.addGroup(all.length, ix.length, k); for (let q = 0; q < ix.length; q++) all.push(ix[q]); });
        geo.setIndex(all); geo.computeVertexNormals(); const m = sh(new THREE.Mesh(geo, mats)); g.add(m); return m;
      };
      // body shell: paint above, black underside / sills / arch liners / SUV cladding
      {
        const NZ = 72, M = 36, pos = [], ip = [], ib = [], zs = [];
        for (let i = 0; i <= NZ; i++) {
          const u = i / NZ, zf = L * (0.6 * u + 0.2 * (1 - Math.cos(Math.PI * u))), y0 = bot(zf), y1 = Math.max(y0 + 0.02, belt(zf)), w = hw(zf), yc = (y0 + y1) / 2, hh = (y1 - y0) / 2; zs.push(zf);
          for (let j = 0; j < M; j++) { const t = (j / M) * Math.PI * 2 - Math.PI / 2, s = Math.sin(t), e = s > 0 ? 2 / S.mt : 2 / S.mb, ny = spow(s, e); pos.push(w * spow(Math.cos(t), e) * (1 - 0.05 * Math.max(0, ny)), yc + hh * ny, zl(zf)); }
        }
        for (let i = 0; i < NZ; i++) {
          const zf = (zs[i] + zs[i + 1]) / 2, y0 = bot(zf), y1 = Math.max(y0 + 0.02, belt(zf)), lim = Math.min(y0 + S.clad, y0 + 0.45 * (y1 - y0)), w = Math.max(0.001, hw(zf)), fl = S.flare || 0, za = S.ax[archD(zf) === Math.abs(zf - S.ax[0]) ? 0 : 1];
          for (let j = 0; j < M; j++) {
            const a = i * M + j, b = i * M + ((j + 1) % M), c = a + M, d = b + M, ya = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[d * 3 + 1]) / 4, xa = Math.abs(pos[a * 3] + pos[b * 3] + pos[c * 3] + pos[d * 3]) / 4;
            let blk = ya < lim;
            if (!blk && fl > 0 && Math.abs(pos[a * 3] + pos[b * 3]) / 2 > 0.86 * w) { const rr = Math.hypot(zf - za, ya - S.r); blk = rr < R + fl && ya < y0 + 0.75 * (y1 - y0) + 0.001 && ya < S.r + R + fl; }
            (blk ? ib : ip).push(a, c, b, b, c, d);
          }
        }
        build(pos, [ip, ib], [pm, blackM]);
      }
      // greenhouse: glass shell + body-coloured roof and pillars + black seals / B-pillar
      const ghPt = (zf, s, off = 0) => { const yb = belt(zf) - 0.035, yt = Math.max(yb + 0.001, roof(zf)), wb = hw(zf) * S.gw, wt = wb * (1 - S.tum), th = Math.PI * (1 - s), v = Math.pow(Math.abs(Math.sin(th)), 2 / S.mg); return [spow(Math.cos(th), 2 / S.mg) * (wb + (wt - wb) * v) * (1 + off), yb + (yt - yb) * v + off * 0.5 * v]; };
      const cover = (zf, s) => { const e = Math.min(s, 1 - s); if (e < 0.03) return 2; if (zf >= GH.zWs && zf <= GH.zRr && e > 0.215) return 1; if (zf < GH.zWs) return e > 0.2 && e < 0.27 ? 1 : 0; if (Math.abs(zf - GH.zB) < 0.05 && e < 0.27) return S.boxy ? 1 : 2; if (zf >= GH.zCp && e < 0.27) return 1; if (zf > GH.zRr && e > 0.215 && e < 0.27) return 1; return 0; };
      {
        const NG = 34, K = 26, pg = [], pc = [], ig = [], i1 = [], i2 = [];
        for (let i = 0; i <= NG; i++) { const zf = GH.zA + (GH.zC - GH.zA) * (i / NG); for (let k = 0; k <= K; k++) { const a = ghPt(zf, k / K), b = ghPt(zf, k / K, 0.014); pg.push(a[0], a[1], zl(zf)); pc.push(b[0], b[1], zl(zf)); } }
        for (let i = 0; i < NG; i++) for (let k = 0; k < K; k++) { const a = i * (K + 1) + k, b = a + 1, c = a + K + 1, d = c + 1, cv = cover(GH.zA + (GH.zC - GH.zA) * ((i + 0.5) / NG), (k + 0.5) / K); ig.push(a, b, c, b, d, c); if (cv === 1) i1.push(a, b, c, b, d, c); else if (cv === 2) i2.push(a, b, c, b, d, c); }
        build(pg, [ig], [carGlass]); build(pc, [i1, i2], [rm, blackM]);
      }
      // wheels (rolling groups): rounded tyre, dark barrel, alloy face
      const tw = S.boxy ? 0.28 : 0.21;
      S.ax.forEach((zf) => [-1, 1].forEach((sd) => {
        const wg = new THREE.Group(); wg.position.set(sd * (hw0 - tw / 2 - 0.035), S.r, zl(zf)); g.add(wg); (g.userData.wheels = g.userData.wheels || []).push(wg); g.userData.wr = S.r;
        const t = new THREE.Mesh(tireG, tireM); t.scale.set(tw, S.r, S.r); t.castShadow = true; wg.add(t);
        const br = new THREE.Mesh(rimG, blackM); br.scale.set(tw * 0.92, S.r * 0.62, S.r * 0.62); wg.add(br);
        const rf = new THREE.Mesh(rimG, opt.rim || alloyM); rf.scale.set(0.02, S.r * 0.64, S.r * 0.64); rf.position.x = sd * (tw / 2 - 0.012); wg.add(rf);
      }));
      // surface-hugging lamps, grilles and plates (segmented along the real outline at that height)
      const surfX = (zf, y) => { const y0 = bot(zf), y1 = Math.max(y0 + 0.02, belt(zf)), hh = (y1 - y0) / 2, q = Math.max(-1, Math.min(1, (y - (y0 + y1) / 2) / hh)), m = q > 0 ? S.mt : S.mb, sn = Math.pow(Math.abs(q), m / 2); return hw(zf) * Math.pow(Math.sqrt(Math.max(0, 1 - sn * sn)), 2 / m) * (1 - 0.05 * Math.max(0, q)); };
      const zAt = (x, front, y) => { let lo = front ? 0 : L / 2, hi = front ? L / 2 : L; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (front === surfX(mid, y) > x) hi = mid; else lo = mid; } return (lo + hi) / 2; };
      const strip = (x0, x1, y, h, mat, front, depth = 0.05, seg = 3) => [-1, 1].forEach((sd) => {
        for (let k = 0; k < seg; k++) {
          const xa = Math.max(0.002, (x0 + ((x1 - x0) * k) / seg) * hw0), xb = (x0 + ((x1 - x0) * (k + 1)) / seg) * hw0;
          const pax = sd * xa, paz = zl(zAt(xa, front, y)), pbx = sd * xb, pbz = zl(zAt(xb, front, y)), len = Math.hypot(pbx - pax, pbz - paz) + 0.004;
          let nx = (pbz - paz) / len, nz = -(pbx - pax) / len; if (nx * sd * 0.6 + nz * (front ? 1 : -1) < 0) { nx = -nx; nz = -nz; }
          const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, depth), mat); m.position.set((pax + pbx) / 2 + nx * 0.006, y, (paz + pbz) / 2 + nz * 0.006); m.rotation.y = Math.atan2(nx, nz); g.add(m);
        }
      });
      const LP = S.lamps;
      if (LP.head) strip(LP.head[0], LP.head[1], LP.head[2], LP.head[3], headM, true);
      if (LP.tail) strip(LP.tail[0], LP.tail[1], LP.tail[2], LP.tail[3], tailM, false);
      if (LP.grille) strip(0, LP.grille[0], LP.grille[1], LP.grille[2], blackM, true);
      if (LP.chrome) strip(0, LP.chrome[0], LP.chrome[1], 0.025, chromeM, true, 0.056);
      if (LP.intake) strip(0, LP.intake[0], LP.intake[1], LP.intake[2], blackM, true);
      strip(0, 0.28, LP.plate[0], 0.11, plateM, true, 0.03, 1); strip(0, 0.28, LP.plate[1], 0.11, plateM, false, 0.03, 1);
      // mirrors, handles, rails
      const zm = GH.zA + (S.boxy ? 0.12 : 0.2), ym = belt(zm) + 0.1, xm = Math.abs(ghPt(zm, 0.05)[0]);
      [-1, 1].forEach((sd) => {
        const mb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.09), pm); mb.position.set(sd * (xm + 0.14), ym, zl(zm)); mb.castShadow = true; g.add(mb);
        const gl = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.1, 0.012), chromeM); gl.position.set(sd * (xm + 0.14), ym, zl(zm) - 0.048); g.add(gl);
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.05), blackM); st.position.set(sd * (xm + 0.03), ym - 0.035, zl(zm)); g.add(st);
      });
      (S.handles || []).forEach((zf) => [-1, 1].forEach((sd) => { const y = belt(zf) - 0.1, hb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.028, 0.17), S.boxy ? blackM : chromeM); hb.position.set(sd * (surfX(zf, y) + 0.008), y, zl(zf)); g.add(hb); }));
      const rail = (s, z0, z1, dy, rad, mat) => [s, 1 - s].forEach((ss) => { const pts = []; for (let k = 0; k <= 16; k++) { const zf = z0 + ((z1 - z0) * k) / 16, p = ghPt(zf, ss, 0.014); pts.push(V(p[0], p[1] + dy, zl(zf))); } const tb = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, rad, 6), mat); tb.castShadow = true; g.add(tb); });
      if (S.rails) rail(0.3, GH.zWs + 0.12, GH.zRr - 0.08, 0.045, 0.018, opt.roof ? blackM : chromeM);
      if (S.boxy) {
        rail(0.235, GH.zWs + 0.02, GH.zRr - 0.02, 0.012, 0.013, pm);
        const fy = 0.88, fz = (x, y = fy) => zl(zAt(x, true, y)) + 0.012;
        const bk = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.32, 0.04), blackM); bk.position.set(0, 0.86, fz(0.43, 0.86)); g.add(bk);
        for (let k = 0; k <= 14; k++) { const x = -0.42 + k * 0.06, bar = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.29, 0.04), chromeM); bar.position.set(x, 0.86, fz(Math.max(0.002, Math.abs(x)), 0.86) + 0.012); g.add(bar); }
        [-1, 1].forEach((sd) => {
          const lx = 0.64, lz = fz(lx);
          const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.05, 24), headM); hl.rotation.x = Math.PI / 2; hl.position.set(sd * lx, fy, lz); g.add(hl);
          const rg = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 8, 28), chromeM); rg.position.set(sd * lx, fy, lz + 0.026); g.add(rg);
          const pod = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.1), amberM); pod.position.set(sd * 0.78, belt(0.32) + 0.02, zl(0.32)); g.add(pod);
          const rb = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, S.ax[1] - S.ax[0] - 2 * R - 0.08), blackM); rb.position.set(sd * (hw0 - 0.04), 0.42, zl((S.ax[0] + S.ax[1]) / 2)); rb.castShadow = true; g.add(rb);
          [0, 0.09].forEach((dz) => { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 12), chromeM); ex.rotation.z = Math.PI / 2; ex.position.set(sd * (hw0 - 0.03), 0.36, zl(S.ax[1] - R - 0.2 - dz)); g.add(ex); });
          const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.04), tailM); tl.position.set(sd * 0.84, 0.9, zl(zAt(0.84, false, 0.9)) - 0.012); g.add(tl);
        });
        const sp = new THREE.Mesh(tireG, tireM); sp.scale.set(0.24, 0.4, 0.4); sp.rotation.y = Math.PI / 2; sp.position.set(0.12, 1.06, -L / 2 - 0.13); sp.castShadow = true; g.add(sp);
        const cv = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 28), pm); cv.rotation.x = Math.PI / 2; cv.position.set(0.12, 1.06, -L / 2 - 0.25); g.add(cv);
      }
      ao(S.W, L, 0, 0, 0.015, g, 0.4);
      return g;
    }
    // employee parking: reverse-parked, fronts toward the aisle
    const PARK = [['chazor', '#8b9095'], ['elantra', '#15171a'], ['g', '#1f4f9f', { metal: 0.6 }], ['lacetti', '#f2f2ef', { metal: 0.15 }], ['spark', '#f3f3f0', { metal: 0.15 }], null, ['yuan', '#eef0f1', { metal: 0.15, roof: '#111317' }], ['spark', '#b8bcc0'], ['spark', '#8e2a2c'], null];
    PARK.forEach((pk, k) => { if (!pk) return; const c = buildCar(pk[0], pk[1], pk[2]); c.position.set(-30.85 + k * 2.7 + (rnd() - 0.5) * 0.12, 0.24, 59.25 + (rnd() - 0.5) * 0.15); c.rotation.y = (rnd() - 0.5) * 0.03; scene.add(c); });

    // visitor cars: street → entry barrier → drop-off at the entrance → ring → exit barrier → street
    const crv = (pts) => new THREE.CatmullRomCurve3(pts.map(([x, z]) => V(x, 0, z)), false, 'centripetal');
    const VC = [
      crv([[110, 80], [40, 80], [15, 80], [8.6, 79.4], [5.4, 77.2], [4.4, 75.0], [4.3, 73.2]]),
      crv([[4.3, 73.2], [4.3, 66.0], [4.3, 59.0], [3.8, 55.6], [1.6, 53.7], [-4, 53.5], [-18, 53.5], [-29, 53.5]]),
      crv([[-29, 53.5], [-33.3, 53.5], [-35.6, 54.6], [-36.4, 56.8], [-36.4, 60.4], [-35.5, 63.3], [-33.2, 64.0], [-10, 64.0], [5.8, 64.0], [8.2, 65.0], [8.9, 66.4], [8.9, 67.8]]),
      crv([[8.9, 67.8], [8.9, 73.5], [9.3, 77.0], [10.6, 81.0], [13.4, 83.6], [18, 84], [45, 84], [110, 84]]),
    ];
    const VS = [[0, 10, 'o'], [0, 3.2, 's'], [1, 10, 'io'], [1, 3, 's'], [2, 12, 'io'], [2, 2.8, 's'], [3, 9, 'i']], VT = VS.reduce((a, s) => a + s[1], 0);
    const visitors = [buildCar('lacetti', '#dfe1e0', { metal: 0.3 }), buildCar('spark', '#e9e3d3', { metal: 0.2 })];
    visitors.forEach((c) => scene.add(c));
    const vp = V(0, 0, 0), vd = V(0, 0, 0);
    updaters.push((t, dt) => visitors.forEach((car, k) => {
      let tt = (t + (k * VT) / 2) % VT, idx = 0;
      while (idx < VS.length - 1 && tt >= VS[idx][1]) { tt -= VS[idx][1]; idx++; }
      const [ci, dur, mode] = VS[idx], s = clamp01(tt / dur), c = VC[ci];
      const u = mode === 's' ? 1 : mode === 'o' ? 1 - (1 - s) * (1 - s) : mode === 'i' ? s * s : ease(s);
      c.getPointAt(u, vp); c.getTangentAt(Math.min(0.999, Math.max(0.001, u)), vd);
      car.position.set(vp.x, 0.235, vp.z); car.rotation.set(0, Math.atan2(vd.x, vd.z), 0); drive(car, dt);
    }));
    const tracked = visitors.concat(fleet);
    updaters.push((t, dt) => {
      barriers.forEach((b) => {
        const z = b.zone; let open = false;
        for (const v of tracked) { if (v.visible === false) continue; const p = v.position; if (p.x > z[0] && p.x < z[1] && p.z > z[2] && p.z < z[3]) { open = true; break; } }
        b.a += ((open ? 1.45 : 0) - b.a) * (1 - Math.exp(-dt * 3.2)); b.piv.rotation.z = b.a; b.open = open;
      });
      guards.forEach((gd) => {
        const busy = gd.bars.some((b) => b.open), u = gd.p.userData;
        gd.p.rotation.y += ((busy ? gd.ry : gd.ry + Math.sin(t * 0.35 + gd.ph) * 0.45) - gd.p.rotation.y) * (1 - Math.exp(-dt * 3));
        if (busy) pose.point(gd.p, t); else { u.armR.rotation.x = -0.05; u.armR.userData.fore.rotation.x = -0.25; u.head.rotation.y = Math.sin(t * 0.6 + gd.ph) * 0.3; }
      });
    });
  }

  // labels
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    const lbl = (text, w, h, color) => {
      const c = document.createElement('canvas'); c.width = 2048; c.height = Math.round(2048 * h / w);
      const x = c.getContext('2d'); x.fillStyle = color; x.font = `700 ${Math.round(c.height * 0.64)}px ${FONT}`; x.imageSmoothingQuality = 'high'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, c.width / 2, c.height * 0.54);
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 16;
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tx, transparent: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    };
    const a = lbl('INSOF.JBI', 12, 1.6, '#ffffff'); a.rotation.y = Math.PI / 2; a.position.set(-29 + 9.75, 9.7, 40); scene.add(a);
    const b = lbl('INSOF', 5.6, 1.1, '#ffffff'); b.position.set(-36, 15.15, -9 + 3.72); scene.add(b);
    const c2 = lbl('INSOF METALL', 16, 1.4, '#ffffff'); c2.position.set(5, 10.2, -17.4); scene.add(c2);
  });

  // ---------- ROAD TO CLIENT (winding) ----------
  {
    const N = 420, L = clientRoad.getLength();
    const ribbon = (wd, off, y, mat, vs, u0 = 0, u1 = 1) => {
      const pos = [], uv = [], idx = [], n = Math.max(2, Math.round(N * (u1 - u0)));
      for (let i = 0; i <= n; i++) { const u = u0 + (u1 - u0) * (i / n), p = clientRoad.getPointAt(u), t = clientRoad.getTangentAt(u), nx = -t.z, nz = t.x, cx = p.x + nx * off, cz = p.z + nz * off;
        pos.push(cx + nx * wd / 2, y, cz + nz * wd / 2, cx - nx * wd / 2, y, cz - nz * wd / 2); uv.push(0, (u * L) / vs, 1, (u * L) / vs);
        if (i < n) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); return m;
    };
    const lineW = mk({ color: '#ecebe7', roughness: 0.5, side: THREE.DoubleSide });
    ribbon(10.4, 0, 0.2, mk({ color: '#c9bfae', map: T.gravel, roughness: 1, side: THREE.DoubleSide }), 6);
    ribbon(7, 0, 0.22, mk({ color: '#ffffff', map: T.asphalt, roughness: 0.95, side: THREE.DoubleSide }), 7);
    ribbon(0.12, 3.2, 0.226, lineW, 1); ribbon(0.12, -3.2, 0.226, lineW, 1);
    const ua = roadU(128);
    ribbon(0.9, -6.6, 0.04, mk({ color: '#4d6f78', roughness: 0.15, metalness: 0.2, side: THREE.DoubleSide }), 1, ua, roadU(266));
    const dI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.03, 2), M.white, 80), o = new THREE.Object3D(); let dn = 0;
    for (let s = 3; s < L - 2 && dn < 80; s += 5) { const u = s / L, p = clientRoad.getPointAt(u), t = clientRoad.getTangentAt(u); o.position.set(p.x, 0.235, p.z); o.lookAt(p.x + t.x, 0.235, p.z + t.z); o.updateMatrix(); dI.setMatrixAt(dn++, o.matrix); }
    dI.count = dn; scene.add(dI);
    for (let s = 0; s < L; s += 4.4) { const u = s / L, p = clientRoad.getPointAt(u); if (p.x < 126 || p.x > 264 || rnd() < 0.12) continue; const t = clientRoad.getTangentAt(u), nx = -t.z, nz = t.x; treeQ.push([p.x + nx * 5.8, p.z + nz * 5.8, 'poplar']); if (rnd() > 0.1) treeQ.push([p.x - nx * 7.8, p.z - nz * 7.8, 'poplar']); }
  }
  const CLIENT_DX = 130, clientSite = new THREE.Group(); clientSite.position.x = CLIENT_DX; scene.add(clientSite);
  const _box = box, _person = person, _treeQ = treeQ;
  {
  const box = (w, h, d, mat, x, y, z, p = clientSite) => _box(w, h, d, mat, x, y, z, p);
  const person = (x, z, o) => { const g = _person(x, z, o); clientSite.add(g); return g; };
  const treeQ = { push: (a) => _treeQ.push([a[0] + CLIENT_DX, a[1], a[2]]) };
  const scene = clientSite;
  // ---------- CLIENT SITE ----------
  {
    const dirtT = T.gravel.clone(); dirtT.repeat.set(16, 14); dirtT.needsUpdate = true;
    box(80, 0.12, 70, mk({ color: '#d9cdb5', map: dirtT, roughness: 1 }), 181, 0, 22).castShadow = false;
    const asT = T.asphalt.clone(); asT.repeat.set(12, 1); asT.needsUpdate = true; const asph = mk({ color: '#ffffff', map: asT, roughness: 0.95 });
    box(48, 0.22, 7, asph, 164, 0, 17).castShadow = false;
    for (let x = 148; x < 186; x += 4) box(0.22, 0.03, 2, M.white, x, 0.22, 17).rotation.y = Math.PI / 2;
    const fenceMat = mk({ color: '#e9eaec', roughness: 0.6, metalness: 0.3 });
    box(30, 2.2, 0.12, fenceMat, 157, 0, 56.9); box(30, 2.2, 0.12, fenceMat, 205, 0, 56.9); box(0.12, 2.2, 70, fenceMat, 220.9, 0, 22);
    box(78, 2.2, 0.12, fenceMat, 181, 0, -12.9); box(0.12, 2.2, 32, fenceMat, 141.1, 0, 38); box(0.12, 2.2, 26, fenceMat, 141.1, 0, -1);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.2), new THREE.MeshBasicMaterial({ color: '#2a4aa7' })); banner.position.set(181, 1.3, 57.12); scene.add(banner);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
      const c = document.createElement('canvas'); c.width = 3600; c.height = 440; const x = c.getContext('2d');
      x.fillStyle = '#2a4aa7'; x.fillRect(0, 0, 3600, 440); x.fillStyle = '#ffffff'; x.font = `700 168px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('INSOF.JBI mahsulotlari bilan qurilmoqda', 1800, 232);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; banner.material.color.set('#ffffff'); banner.material.map = t; banner.material.toneMapped = false; banner.material.needsUpdate = true;
    });
    const resTex = canvasTex(256, (c, s) => { c.fillStyle = '#ece6da'; c.fillRect(0, 0, s, s); for (let y = 0; y < s; y += 32) for (let x = 0; x < s; x += 32) { c.fillStyle = '#3c4c5a'; c.fillRect(x + 7, y + 8, 16, 17); c.fillStyle = '#d4cbb8'; c.fillRect(x + 4, y + 25, 24, 3); } });
    const resMat = (rx, ry) => { const t = resTex.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return mk({ color: '#ffffff', map: t, roughness: 0.85 }); };
    box(16, 33, 14, resMat(4, 8), 205, 0.1, 6); box(16.4, 0.6, 14.4, M.white, 205, 33.1, 6); box(16.6, 3.2, 14.6, mk({ color: '#bfa98a', roughness: 0.9 }), 205, 0.1, 6);
    box(12, 24, 12, resMat(3, 6), 148, 0.1, -6); box(12.4, 0.6, 12.4, M.white, 148, 24.1, -6);
    ao(18, 12, 168, 6, 0.14, clientSite); ao(16.6, 14.6, 205, 6, 0.14, clientSite); ao(12, 12, 148, -6, 0.14, clientSite);
    [[216, 18], [216, 30], [214, 46], [200, 46]].forEach(([x, z]) => treeQ.push([x, z, 'round']));
    const BX = 168, BZ = 6, levels = 9, FH = 3, panelM = M.concrete;
    for (let i = 0; i < levels; i++) {
      const y = 0.1 + i * FH;
      for (let cx = -8; cx <= 8; cx += 4) for (const cz of [-5.5, 5.5]) box(0.45, FH, 0.45, M.concreteDk, BX + cx, y, BZ + cz);
      if (i < 8) box(18, 0.32, 12, panelM, BX, y + FH - 0.32, BZ);
      if (i < 6) {
        for (let k = 0; k < 4; k++) { box(4, FH - 0.32, 0.25, panelM, BX - 6 + k * 4, y, BZ + 6); box(1.4, 1.3, 0.05, M.glass, BX - 6 + k * 4, y + 0.9, BZ + 6.14); }
        for (let k = 0; k < 3; k++) { box(0.25, FH - 0.32, 4, panelM, BX + 9, y, BZ - 4 + k * 4); box(0.05, 1.3, 1.4, M.glass, BX + 9.14, y + 0.9, BZ - 4 + k * 4); }
      }
    }
    box(18, 0.32, 12, panelM, BX, 0, BZ);
    for (let k = 0; k < 3; k++) box(4, FH - 0.32, 0.25, panelM, BX - 6 + k * 4, 0.1 + 6 * FH, BZ + 6);
    const placed = box(4, FH - 0.32, 0.25, panelM, BX + 6, 0.1 + 6 * FH, BZ + 6);
    const wk = [];
    for (let i = 0; i < 5; i++) { const p = person(BX - 6 + i * 3, BZ + rnd() * 6 - 3, { vest: true, helmet: true, shirt: shirtMats[(i % 2) + 1], ry: rnd() * 6 }); p.position.y = 0.1 + 7 * FH; wk.push(p); }
    for (let i = 0; i < 4; i++) wk.push(person(150 + i * 3, 36 + (i % 2) * 2, { vest: true, helmet: true, shirt: shirtMats[(i % 3) + 1], ry: rnd() * 6 }));
    const C = V(184, 0, 6), mastH = 34;
    const { jib, troll, setHook } = craneRig(C, mastH, 26, 8, M.yellow, clientSite);
    const carried = box(4, FH - 0.32, 0.25, panelM, 0, 0, 0, scene);
    const truck = flatbed('panel'), truck2 = flatbed('panel'); scene.add(truck, truck2);
    const TP = (() => { const a = roadU(236), b = roadU(272), pts = []; for (let k = 0; k <= 7; k++) { const q = roadLane(a + (b - a) * (k / 7), 1); pts.push(V(q.x - CLIENT_DX, 0, q.z)); } pts.push(V(160, 0, 15.8), V(186, 0, 15.3)); return new THREE.CatmullRomCurve3(pts, false, 'centripetal'); })(), tpp = V(0, 0, 0), tpd = V(0, 0, 0);
    const polar = (x, z) => ({ a: Math.atan2(-(z - C.z), x - C.x), r: Math.hypot(x - C.x, z - C.z) });
    const pick = polar(186, 15.3), drop = polar(BX + 6, BZ + 6);
    const pump = new THREE.Group(); pump.position.set(160, 0.12, 28); scene.add(pump);
    box(2.5, 0.5, 10, M.dark, 0, 0.5, 0, pump); box(2.5, 2.4, 2.2, M.white, 0, 0.9, 4.2, pump); box(2.54, 0.15, 2.22, M.acc, 0, 1.6, 4.2, pump);
    wheels(pump, [4, 1, -2.5, -3.8]);
    [[1.4, 3.0], [-1.4, 3.0], [1.4, -3.6], [-1.4, -3.6]].forEach(([x, z]) => { const sx = Math.sign(x), sz = Math.sign(z); const o = box(0.25, 0.25, 2.2, M.acc, 0, 0, 0, pump); o.position.set(x + sx * 0.9, 1.05, z + sz * 0.5); o.rotation.y = -sx * sz * 0.8; cyl(0.12, 0.12, 1.0, M.steelDk, x + sx * 1.7, 0.0, z + sz * 1.1, pump, 10); box(0.9, 0.1, 0.9, M.dark, x + sx * 1.7, 0, z + sz * 1.1, pump); });
    box(1.6, 0.9, 1.3, M.steelDk, 0, 1.0, -4.5, pump); box(1.0, 0.3, 0.3, M.acc, 0, 1.9, -4.5, pump);
    const b0 = new THREE.Group(); b0.position.set(0, 3.2, -2); pump.add(b0); box(0.7, 0.9, 0.7, M.acc, 0, -0.9, 0, b0);
    const s1 = new THREE.Group(); b0.add(s1); box(0.4, 0.4, 9, M.acc, 0, -0.2, 4.5, s1);
    const s2 = new THREE.Group(); s2.position.z = 9; s1.add(s2); box(0.32, 0.32, 8, M.acc, 0, -0.16, 4, s2);
    const s3 = new THREE.Group(); s3.position.z = 8; s2.add(s3); box(0.26, 0.26, 6, M.acc, 0, -0.13, 3, s3);
    const tip = new THREE.Object3D(); tip.position.z = 6; s3.add(tip);
    const mx2 = mixer(); scene.add(mx2); mx2.position.set(160, 0.12, 41.5); mx2.rotation.y = Math.PI;
    const CI = V(192.5, 0.2, 21.5), CM = V(190.2, 0.2, 18.5), DD = V(189.3, 0.2, 16.9), DS = V(189.4, 0.2, 18.2);
    const customer = person(CI.x, CI.z, { shirt: shirtMats[0], helmet: true }), driver = person(DS.x, DS.z, { shirt: shirtMats[1], vest: true });
    const doc = box(0.26, 0.02, 0.34, mk({ color: '#f4f4f0', roughness: 0.6 }), 0, 0, 0);
    const faceTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z), _p = V(0, 0, 0);
    const walkTo = (p, A, B, u, t) => { p.position.set(lerp(A.x, B.x, u), 0.2, lerp(A.z, B.z, u)); p.rotation.y = faceTo(A, B); pose.walk(p, t, 7); };
    const still = (p) => { pose.stand(p); p.position.y = 0.2; };
    const holdAt = (p, fwd, side, y) => { const r = p.rotation.y; doc.position.set(p.position.x + Math.sin(r) * fwd + Math.cos(r) * side, y, p.position.z + Math.cos(r) * fwd - Math.sin(r) * side); doc.rotation.y = r; };
    const tp = V(0, 0, 0);
    updaters.push((t, dt) => {
      const c = t % CYCLE;
      const par = Math.floor(t / CYCLE) % 2, inT = par ? truck2 : truck, outT = par ? truck : truck2;
      if (c < 4) { const u = 1 - Math.pow(1 - seg(c, 0, 3.9), 3); TP.getPointAt(u, tpp); TP.getTangentAt(Math.min(0.999, Math.max(0.001, u)), tpd); inT.position.set(tpp.x, 0.22, tpp.z); inT.rotation.set(0, Math.atan2(tpd.x, tpd.z), 0); }
      else { inT.rotation.set(0, Math.PI / 2, 0); inT.position.set(186, 0.22, 15.3); }
      const ou = Math.pow(seg(c, 0.2, 4), 2); outT.rotation.set(0, Math.PI / 2, 0); outT.position.set(186 + ou * 52, 0.22, 15.3); outT.visible = c < 4;
      inT.visible = true; drive(inT, dt); drive(outT, dt);
      let u = 0, hy = 20, carry = false;
      if (c >= 4 && c < 5.0) hy = lerp(20, 4.6, ease(seg(c, 4, 5.0)));
      else if (c >= 5.0 && c < 6.4) { hy = lerp(4.6, 24, ease(seg(c, 5.0, 6.4))); carry = true; }
      else if (c >= 6.4 && c < 8.6) { u = ease(seg(c, 6.4, 8.6)); hy = 24; carry = true; }
      else if (c >= 8.6 && c < 9.6) { u = 1; hy = lerp(24, 0.1 + 7 * FH - 0.2, ease(seg(c, 8.6, 9.6))); carry = true; }
      else if (c >= 9.6 && c < 13) { u = 1 - ease(seg(c, 10, 13)); hy = lerp(21.8, 20, ease(seg(c, 10, 13))); }
      let da = drop.a - pick.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      const ang = pick.a + da * u, r = lerp(pick.r, drop.r, u);
      jib.rotation.y = ang; troll.position.x = r;
      const hx = C.x + Math.cos(ang) * r, hz = C.z - Math.sin(ang) * r;
      setHook(hx, hy - 1.3, hz);
      carried.visible = carry; carried.position.set(hx, hy - FH + 0.3, hz); carried.rotation.y = ang - drop.a;
      placed.visible = c >= 9.6 && c < 15.9;
      const pumpOn = seg(c, 8, 9) * (1 - seg(c, 11.5, 12.5));
      b0.rotation.y = Math.PI + 0.55 * pumpOn; s1.rotation.x = -0.9 * pumpOn - 0.05; s2.rotation.x = lerp(2.9, 0.75, pumpOn); s3.rotation.x = lerp(-2.7, 0.55, pumpOn);
      if (pumpOn > 0.95) { tip.getWorldPosition(tp); for (let k = 0; k < 3; k++) pour.spawn(tp.x + (rnd() - 0.5) * 0.3, tp.y, tp.z + (rnd() - 0.5) * 0.3, 0, -2, 0, 0.5); }
      mx2.userData.drum.rotation.y += dt * (pumpOn > 0.5 ? 6 : 1.5);
      wk.forEach((p, i) => { pose.work(p, t, i); p.rotation.y += dt * 0.15 * (i % 2 ? 1 : -1); });
      const cu = customer.userData, du = driver.userData;
      cu.head.rotation.x = 0; cu.armL.rotation.x = 0; cu.armR.rotation.x = 0; cu.armR.rotation.z = 0; du.armR.rotation.x = 0; du.armL.rotation.x = 0;
      driver.visible = c >= 4.0 && c < 14.9;
      if (c >= 4.0 && c < 4.7) walkTo(driver, DD, DS, ease(seg(c, 4.0, 4.7)), t);
      else if (c >= 14.3 && c < 14.9) walkTo(driver, DS, DD, ease(seg(c, 14.3, 14.9)), t);
      else if (driver.visible) { still(driver); driver.position.set(DS.x, 0.2, DS.z); driver.rotation.y = c < 11.6 ? 0.55 + Math.sin(t * 0.4) * 0.2 : faceTo(DS, CM); if (c < 11.6) pose.talk(driver, t, 4); }
      if (c < 2.8) walkTo(customer, CM, CI, ease(seg(c, 0.2, 2.8)), t);
      else if (c < 10.0) { still(customer); customer.position.set(CI.x, 0.2, CI.z); customer.rotation.y = -2.2 + Math.sin(t * 0.3) * 0.35; cu.head.rotation.y = Math.sin(t * 0.7) * 0.25; }
      else if (c < 12.0) walkTo(customer, CI, CM, ease(seg(c, 10.0, 12.0)), t);
      else { still(customer); customer.position.set(CM.x, 0.2, CM.z); customer.rotation.y = c < 14.4 ? faceTo(CM, DS) : lerp(faceTo(CM, DS), 0.9, ease(seg(c, 14.4, 15.0))); }
      const give = ease(seg(c, 12.0, 12.6));
      if (c >= 12.0 && c < 12.7) { du.armR.rotation.x = -1.05 * give; cu.armR.rotation.x = -0.9 * ease(seg(c, 12.2, 12.6)); }
      if (c >= 12.6 && c < 13.5) { cu.armR.rotation.x = cu.armL.rotation.x = -0.75; cu.head.rotation.x = 0.32 + (c > 13.0 ? Math.sin(seg(c, 13.0, 13.5) * Math.PI * 4) * 0.14 : 0); }
      const hs = c >= 13.5 && c < 14.3 ? Math.sin(Math.PI * seg(c, 13.5, 14.3)) : 0;
      if (hs > 0) { pose.shake(customer, hs); pose.shake(driver, hs); cu.armL.rotation.x = -0.35; }
      if (c >= 14.5 && c < 15.6) { const wv = Math.sin(Math.PI * seg(c, 14.5, 15.6)); cu.armR.rotation.x = -1.9 * wv; cu.armR.rotation.z = Math.sin(t * 9) * 0.12 * wv; cu.armL.rotation.x = -0.35; }
      doc.visible = c >= 4.0 || c < 2.8;
      if (c >= 4.0 && c < 12.0) holdAt(driver, 0.06, 0.34, 0.95);
      else if (c >= 12.0 && c < 12.6) holdAt(driver, lerp(0.06, 0.45, give), lerp(0.34, 0.16, give), lerp(0.95, 1.22, give));
      else if (c >= 12.6 && c < 13.5) holdAt(customer, 0.34, 0, 1.24);
      else holdAt(customer, 0.1, -0.32, 0.98);
    });
  }
  }
  // landscape: Uzbek farmland, poplar rows, mahalla, mountains
  {
    // realistic trees: canopy of alpha-tested leaf cards (random oriented quads with leaf-cluster texture) + tapered trunks
    const leafTex = canvasTex(256, (c, s) => {
      c.clearRect(0, 0, s, s);
      for (let i = 0; i < 160; i++) {
        const a = rnd() * 6.28, d = Math.sqrt(rnd()) * s * 0.42, x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d, r = 9 + rnd() * 14;
        const sh = 0.75 + rnd() * 0.6;
        c.fillStyle = `hsl(${100 + rnd() * 12}, ${50 + rnd() * 10}%, ${30 + rnd() * 8}%)`;
        c.beginPath(); c.ellipse(x, y, r * 1.5, r * 0.8, rnd() * Math.PI, 0, Math.PI * 2); c.fill();
      }
    }, 1, 1, true);
    leafTex.wrapS = leafTex.wrapT = THREE.ClampToEdgeWrapping;
    const needleTex = canvasTex(256, (c, s) => {
      c.clearRect(0, 0, s, s);
      for (let i = 0; i < 160; i++) {
        const x = s / 2 + (rnd() - 0.5) * s * 0.8, y = s / 2 + (rnd() - 0.5) * s * 0.8;
        c.strokeStyle = `hsl(${100 + rnd() * 20}, ${30 + rnd() * 20}%, ${22 + rnd() * 14}%)`; c.lineWidth = 2.5 + rnd() * 2;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rnd() - 0.5) * 34, y + (rnd() - 0.5) * 34); c.stroke();
      }
    }, 1, 1, true);
    needleTex.wrapS = needleTex.wrapT = THREE.ClampToEdgeWrapping;
    const barkTex = canvasTex(128, (c, s) => { speckle(c, s, '#6b5a49', 44, 30, 0.1); c.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 40; i++) c.fillRect(rnd() * s, 0, 1 + rnd() * 2, s); }, 2, 2);
    const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.95, color: '#ffffff' }); allMats.push(leafMat);
    const needleMat = new THREE.MeshStandardMaterial({ map: needleTex, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.95, color: '#ffffff' }); allMats.push(needleMat);
    const trunkMat = mk({ color: '#ffffff', map: barkTex, roughness: 1 });
    const LEAF_MAX = LITE ? 65000 : 170000, NEEDLE_MAX = LITE ? 8000 : 20000, TRUNK_MAX = LITE ? 2600 : 6000, BRANCH_MAX = LITE ? 6500 : 16000;
    const CARD = new THREE.PlaneGeometry(1, 1);
    const leaves = new THREE.InstancedMesh(CARD, leafMat, LEAF_MAX), needles = new THREE.InstancedMesh(CARD, needleMat, NEEDLE_MAX);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 1, 1, 7, 1), trunkMat, TRUNK_MAX);
    const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.45, 1, 5, 1), trunkMat, BRANCH_MAX);
    leaves.castShadow = needles.castShadow = false; trunks.castShadow = branches.castShadow = true; leaves.receiveShadow = needles.receiveShadow = true;
    leaves.frustumCulled = needles.frustumCulled = trunks.frustumCulled = branches.frustumCulled = false;
    const greens = ['#5f8a3a', '#6a9a40', '#4f7a32', '#7aa84a', '#5e8f3e'].map((c) => new THREE.Color(c));
    const popG = ['#7fae44', '#8cbb4c', '#6f9f3e'].map((c) => new THREE.Color(c));
    const o = new THREE.Object3D(); let n = 0, cn = 0, nn = 0, bn = 0;
    const up = V(0, 1, 0), tmpDir = V(0, 0, 0);
    const card = (mesh, idx, x, y, z, size, col) => { o.position.set(x, y, z); o.rotation.set((rnd() - 0.5) * 0.9, rnd() * Math.PI, (rnd() - 0.5) * 0.6); o.scale.set(size, size, 1); o.updateMatrix(); mesh.setMatrixAt(idx, o.matrix); mesh.setColorAt(idx, col); };
    const branch = (x0, y0, z0, x1, y1, z1, r) => { if (bn >= BRANCH_MAX) return; tmpDir.set(x1 - x0, y1 - y0, z1 - z0); const L = tmpDir.length(); o.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); o.quaternion.setFromUnitVectors(up, tmpDir.normalize()); o.scale.set(r, L, r); o.updateMatrix(); branches.setMatrixAt(bn++, o.matrix); };
    const tree = (x, z, kind) => {
      if (n >= TRUNK_MAX || Math.abs(x - RAIL_X) < 4.6) return;
      if (kind === 'pine' ? nn + 40 > NEEDLE_MAX : cn + 120 > LEAF_MAX) return;
      const poplar = kind === 'poplar', fruit = kind === 'fruit', pine = kind === 'pine';
      const h = poplar ? 7 + rnd() * 4 : fruit ? 1.3 + rnd() * 0.4 : pine ? 3 + rnd() * 2 : 2.2 + rnd() * 1.4;
      const r = poplar ? 1.1 + rnd() * 0.4 : fruit ? 1.3 + rnd() * 0.4 : pine ? 1.6 + rnd() * 0.6 : 2.4 + rnd() * 1.2;
      const tr = poplar ? 0.18 : fruit ? 0.12 : pine ? 0.16 : 0.24;
      o.position.set(x, h / 2, z); o.scale.set(tr, h, tr); o.rotation.set(0, rnd() * 6, 0); o.updateMatrix(); trunks.setMatrixAt(n++, o.matrix);
      const base = (poplar ? popG[(rnd() * 3) | 0] : greens[(rnd() * 5) | 0]).clone().offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.08);
      const col = new THREE.Color();
      if (poplar) {
        const ch = h * 0.78, cnt = 30 + ((rnd() * 12) | 0);
        for (let i = 0; i < cnt && cn < LEAF_MAX; i++) { const t = i / cnt, yy = h * 0.28 + t * ch, rr = r * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (0.6 + rnd() * 0.5); const a = rnd() * 6.28; col.copy(base).offsetHSL(0, 0, (rnd() - 0.5) * 0.05); card(leaves, cn++, x + Math.cos(a) * rr * 0.6, yy, z + Math.sin(a) * rr * 0.6, 2.0 + rnd() * 1.0, col); }
        for (let i = 0; i < 4; i++) branch(x, h * 0.35 + i * h * 0.12, z, x + (rnd() - 0.5) * 1.4, h * 0.55 + i * h * 0.12, z + (rnd() - 0.5) * 1.4, 0.08);
      } else if (pine) {
        const tiers = 5 + ((rnd() * 3) | 0);
        for (let i = 0; i < tiers; i++) { const t = i / tiers, yy = h * 0.35 + t * h * 0.95, rr = r * (1 - t * 0.85); for (let k = 0; k < 5 && nn < NEEDLE_MAX; k++) { const a = rnd() * 6.28, d = rr * (0.3 + rnd() * 0.7); col.copy(base).offsetHSL(0, -0.03, (rnd() - 0.5) * 0.05); card(needles, nn++, x + Math.cos(a) * d, yy + (rnd() - 0.3) * 0.5, z + Math.sin(a) * d, 1.6 + rr * 1.0, col); } }
      } else {
        const lim = 3 + ((rnd() * 2) | 0);
        for (let b = 0; b < lim; b++) {
          const a = (b / lim) * 6.28 + rnd(), bx = x + Math.cos(a) * r * 0.55, bz = z + Math.sin(a) * r * 0.55, by = h + r * 0.45 + rnd() * r * 0.3;
          branch(x, h * 0.8, z, bx, by, bz, tr * 0.6);
          const cnt = fruit ? 12 : 16 + ((rnd() * 8) | 0);
          for (let i = 0; i < cnt && cn < LEAF_MAX; i++) { const p = Math.acos(2 * rnd() - 1), q = rnd() * 6.28, d = r * 0.75 * Math.cbrt(rnd()) * (fruit ? 0.9 : 1); col.copy(base).offsetHSL(0, 0, (rnd() - 0.5) * 0.05); card(leaves, cn++, bx + Math.sin(p) * Math.cos(q) * d, by + Math.cos(p) * d * 0.8, bz + Math.sin(p) * Math.sin(q) * d, (fruit ? 1.3 : 1.9) + rnd() * r * 0.55, col); }
        }
        if (fruit && rnd() < 0.6) { /* fruit dots */ for (let i = 0; i < 6 && cn < LEAF_MAX; i++) { const a = rnd() * 6.28, d = r * 0.6 * rnd(); card(leaves, cn++, x + Math.cos(a) * d, h + r * 0.5 + (rnd() - 0.5) * r * 0.6, z + Math.sin(a) * d, 0.35, new THREE.Color('#c9402a')); } }
      }
    };
    const rows = (soil, row, extra) => canvasTex(256, (c, s) => { speckle(c, s, soil, 12, 16, 0.03); c.fillStyle = row; for (let y = 0; y < s; y += 16) c.fillRect(0, y + 3, s, 8); if (extra) { c.fillStyle = extra; for (let i = 0; i < 900; i++) c.fillRect(rnd() * s, Math.floor(rnd() * 16) * 16 + 4 + rnd() * 6, 2, 2); } });
    const FT = {
      cotton: rows('#8a6f52', '#6d8a45', '#f4f2ea'),
      wheat: canvasTex(256, (c, s) => { speckle(c, s, '#c8a65a', 12, 16, 0.03); c.fillStyle = 'rgba(120,90,30,.18)'; for (let y = 0; y < s; y += 8) c.fillRect(0, y, s, 2); }),
      green: rows('#7d8a4f', '#6a7d40'),
      soil: canvasTex(256, (c, s) => speckle(c, s, '#9c8566', 12, 16, 0.03)),
      yard: canvasTex(256, (c, s) => speckle(c, s, '#bba889', 12, 16, 0.03)),
    };
    const fieldMat = {};
    const fmat = (k, w, h, rot) => { const key = k + rot; if (!fieldMat[key]) { const t = FT[k].clone(); t.needsUpdate = true; t.center.set(0.5, 0.5); t.rotation = rot ? Math.PI / 2 : 0; t.repeat.set(4, 4); fieldMat[key] = mk({ color: '#ffffff', map: t, roughness: 1 }); } return fieldMat[key]; };
    const waterMat = mk({ color: '#4d6f78', roughness: 0.15, metalness: 0.2, envMapIntensity: 1.3 });
    const wallMat = mk({ color: '#d8c6a3', roughness: 0.95, map: T.concrete });
    const roofMat = mk({ color: '#a9967a', roughness: 0.9 });
    const gateMat = mk({ color: '#2f63a3', roughness: 0.5, metalness: 0.3 });
    const tealMat = mk({ color: '#2b8fa3', roughness: 0.3, metalness: 0.25, envMapIntensity: 1.2 });
    treeQ.forEach((a) => tree(...a));
    for (let x = -94; x < 100; x += 4.5) { tree(x, -50, 'poplar'); }
    for (let z = -48; z < 64; z += 4.5) tree(-96, z, 'poplar');
    let mosque = false;
    const CW = 46, CH = 34;
    for (let gx = -320; gx < 330; gx += CW) for (let gz = -250; gz < 92; gz += CH) {
      const x0 = gx, x1 = gx + CW, z0 = gz, z1 = Math.min(gz + CH, 93);
      if (x1 > -98 && x0 < 102 && z1 > -52 && z0 < 66) continue;
      if (x1 > 84 && x0 < 368 && z1 > 6 && z0 < 28) continue;
      if (x1 > 230 && x0 < 368 && z1 > -32 && z0 < 78) continue;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, fw = x1 - x0 - 4, fh = z1 - z0 - 4;
      if (fh < 6) continue;
      const railCut = z1 > 62 && z0 < 75;
      const r = rnd();
      let type = r < 0.32 ? 'cotton' : r < 0.52 ? 'wheat' : r < 0.7 ? 'orchard' : r < 0.84 ? 'village' : 'green';
      if (!mosque && gx < -120 && gz < -100 && gz > -200) type = 'village';
      if (railCut) type = r < 0.5 ? 'cotton' : 'wheat';
      const tex = type === 'orchard' ? 'soil' : type === 'village' ? 'yard' : type;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), fmat(tex, fw, fh, rnd() < 0.5));
      plane.rotation.x = -Math.PI / 2; plane.position.set(cx, 0.04, cz); plane.receiveShadow = true; scene.add(plane);
      if (rnd() < 0.5) { const a = box(x1 - x0, 0.05, 0.9, waterMat, cx, 0.02, z0 + 0.6); a.castShadow = false; }
      if (rnd() < 0.45 && !railCut) for (let x = x0 + 1; x < x1; x += 4.2) tree(x, z0 + 1.6, 'poplar');
      if (rnd() < 0.25 && !railCut) for (let z = z0 + 2; z < z1; z += 4.2) tree(x0 + 1.4, z, 'poplar');
      if (type === 'orchard') for (let x = x0 + 4; x < x1 - 3; x += 4.2) for (let z = z0 + 4; z < z1 - 3; z += 4.2) tree(x + (rnd() - 0.5) * 0.4, z + (rnd() - 0.5) * 0.4, 'fruit');
      if (type === 'village') {
        const placeMosque = !mosque && gx < -120 && gz < -100;
        if (placeMosque) {
          mosque = true;
          box(12, 7, 12, wallMat, cx, 0, cz); box(12.6, 0.6, 12.6, roofMat, cx, 7, cz);
          cyl(3.6, 3.6, 2.2, wallMat, cx, 7.6, cz, scene, 32);
          const dome = sh(new THREE.Mesh(new THREE.SphereGeometry(3.9, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), tealMat)); dome.position.set(cx, 9.8, cz); dome.scale.y = 1.25; scene.add(dome);
          box(4, 9, 1.2, mk({ color: '#c9b48c', roughness: 0.9 }), cx, 0, cz + 6.2); box(2.4, 6, 0.3, tealMat, cx, 0, cz + 6.85);
          cyl(1.1, 1.3, 20, wallMat, cx + 9, 0, cz + 4, scene, 20); cyl(1.5, 1.5, 1.2, tealMat, cx + 9, 20, cz + 4, scene, 20);
          const md = sh(new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), tealMat)); md.position.set(cx + 9, 21.2, cz + 4); scene.add(md);
        }
        for (let i = 0; i < 9; i++) {
          const hx = x0 + 5 + (i % 3) * ((fw - 6) / 3) + rnd() * 3, hz = z0 + 5 + Math.floor(i / 3) * ((fh - 6) / 3) + rnd() * 2;
          if (placeMosque && Math.abs(hx - cx) < 13 && Math.abs(hz - cz) < 11) continue;
          const w2 = 6 + rnd() * 3, d2 = 7 + rnd() * 3;
          box(w2, 3 + rnd() * 0.8, d2 * 0.55, wallMat, hx, 0, hz - d2 * 0.22);
          box(w2 + 0.5, 0.35, d2 * 0.55 + 0.5, roofMat, hx, 3.6, hz - d2 * 0.22);
          box(w2 + 1.4, 1.8, 0.3, wallMat, hx, 0, hz + d2 * 0.5); box(0.3, 1.8, d2, wallMat, hx - w2 / 2 - 0.7, 0, hz); box(0.3, 1.8, d2, wallMat, hx + w2 / 2 + 0.7, 0, hz);
          if (rnd() < 0.7) box(1.6, 1.7, 0.36, gateMat, hx + 1, 0, hz + d2 * 0.5);
          tree(hx - 1.5, hz + 1.5, rnd() < 0.5 ? 'fruit' : 'round');
        }
      }
    }
    leaves.count = cn; needles.count = nn; trunks.count = n; branches.count = bn;
    leaves.instanceMatrix.needsUpdate = needles.instanceMatrix.needsUpdate = trunks.instanceMatrix.needsUpdate = branches.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true; if (needles.instanceColor) needles.instanceColor.needsUpdate = true;
    scene.add(leaves, needles, trunks, branches);
    var leafMatRef = leafMat, needleMatRef = needleMat;

    // mountains (Tian Shan foothills on the horizon)
    const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v); };
    const ridge = (x, y) => { let a = 0, amp = 0.55, f = 1; for (let i = 0; i < 5; i++) { a += amp * (1 - Math.abs(vn(x * f, y * f) * 2 - 1)); amp *= 0.5; f *= 2.1; } return a; };
    const mg = new THREE.PlaneGeometry(2400, 520, 220, 50); mg.rotateX(-Math.PI / 2);
    const mp2 = mg.attributes.position, mcol = [];
    const hz = new THREE.Color(HORIZON), cLow = new THREE.Color('#a49a7a'), cRock = new THREE.Color('#7d7c74'), cSnow = new THREE.Color('#f5f6f4'), tmp = new THREE.Color();
    for (let i = 0; i < mp2.count; i++) {
      const x = mp2.getX(i), z = mp2.getZ(i), t = clamp01((260 - z) / 520);
      const h = (0.12 + 0.88 * Math.pow(t, 0.8)) * ridge(x * 0.005, z * 0.005) * 230 + t * 30;
      mp2.setY(i, h);
      const sn = h > 150 + vn(x * 0.03, z * 0.03) * 40;
      tmp.copy(h < 50 ? cLow : cRock).lerp(cRock, clamp01((h - 30) / 60)); if (sn) tmp.copy(cSnow);
      tmp.lerp(hz, 0.42 - t * 0.12); mcol.push(tmp.r, tmp.g, tmp.b);
    }
    mg.setAttribute('color', new THREE.Float32BufferAttribute(mcol, 3)); mg.computeVertexNormals();
    const mtn = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: false }));
    mtn.position.set(-470, -2, -470); mtn.rotation.y = 0.78; mtn.receiveShadow = false; scene.add(mtn);
    var mountainMat = mtn.material;
  }

  // night floodlights
  const floods = [];
  [[-36, -9], [5, -8], [44, -4], [58, 46], [-29, 41]].forEach(([x, z]) => {
    const s = new THREE.SpotLight('#ffe2b8', 0, 90, 0.75, 0.7, 1.4); s.position.set(x + 14, 26, z + 18); s.target.position.set(x, 0, z); scene.add(s, s.target); floods.push(s);
  });

  // camera loop
  const s0 = STATIONS[0];
  const cur = { x: s0.t[0], y: s0.t[1], z: s0.t[2], s: s0.s * 1.4, az: s0.az - 0.45, el: 0.22 };
  const ANIM = 0.62; let aclock = 0;
  let officeU = 0, f = 0, fs = 0, mx = 0, my = 0, dead = false, last = performance.now(), clock = 0, markerEl = null, night = false;
  let tmx = 0, tmy = 0;
  const onMove = (e) => { tmx = e.clientX / innerWidth - 0.5; tmy = e.clientY / innerHeight - 0.5; };
  addEventListener('pointermove', onMove);
  const _snap = V(0, 0, 0), _v2 = new THREE.Vector2(), dir = V(0, 0, 0), right = V(0, 0, 0), tgt = V(0, 0, 0), sunOff = V(78, 80, 40), mp = V(0, 0, 0);

  {
    const relief = new Set([T.concrete.source, T.asphalt.source, T.gravel.source, T.stone.source, T.sand.source]);
    allMats.forEach((m) => {
      if (!m || !m.isMeshStandardMaterial || m.userData.grime) return; m.userData.grime = true;
      if (m.map && relief.has(m.map.source) && !m.bumpMap) { const b = T.bump.clone(); b.repeat.copy(m.map.repeat).multiplyScalar(3); b.needsUpdate = true; m.bumpMap = b; m.bumpScale = 0.5; }
      else if (m.map && m.map.source === T.corr.source && !m.bumpMap) { m.bumpMap = m.map; m.bumpScale = 1.5; }
      if (!m.map && m.metalness > 0.3 && !m.roughnessMap && !m.transparent) m.roughnessMap = T.scratch;
      m.onBeforeCompile = (s) => {
        s.vertexShader = 'varying vec3 vGW;\nvarying vec3 vGN;\n' + s.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvec4 gwp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\ngwp = instanceMatrix * gwp;\n#endif\ngwp = modelMatrix * gwp; vGW = gwp.xyz; vGN = normalize(mat3(modelMatrix) * objectNormal);');
        s.fragmentShader = 'varying vec3 vGW;\nvarying vec3 vGN;\n' + s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat gG = (1.0 - smoothstep(0.05, 1.5, vGW.y)) * (1.0 - abs(vGN.y));\ndiffuseColor.rgb *= 1.0 - 0.28 * gG;');
      };
      m.customProgramCacheKey = () => 'grime1'; m.needsUpdate = true;
    });
  }
  let frames = 0, lastErr = null;
  function frame(now) {
    if (dead) return;
    requestAnimationFrame(frame);
    tick(now);
  }
  function tick(now, forceDt) {
    frames++;
    try {
    const cw = el.clientWidth, ch = el.clientHeight;
    if (!cw || !ch) return;
    renderer.getSize(_v2); if (_v2.x !== cw || _v2.y !== ch) renderer.setSize(cw, ch);
    const raw = forceDt != null ? forceDt : Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    if (forceDt == null) { if (raw > 0.026) { slowFrames++; fastFrames = 0; } else { fastFrames++; slowFrames = 0; } if (slowFrames > 45 && pr > PR_MIN) { pr = Math.max(PR_MIN, pr - 0.2); renderer.setPixelRatio(pr); slowFrames = 0; } else if (fastFrames > 900 && pr < PR_MAX) { pr = Math.min(pr + 0.25, PR_MAX); renderer.setPixelRatio(pr); fastFrames = 0; } }
    const dt = raw; clock += dt; aclock += dt * ANIM;
    fs += (f - fs) * (1 - Math.exp(-dt * 6));
    for (let i = 0; i < updaters.length; i++) updaters[i](aclock, dt * ANIM);
    systems.forEach((s) => { s.update(dt); s.mat.uniforms.scale.value = renderer.domElement.height * 0.5 * cam.projectionMatrix.elements[5]; });
    const i = Math.min(Math.floor(fs), STATIONS.length - 2); let u = Math.min(1, fs - i); u = u * u * (3 - 2 * u);
    { const S1 = STATIONS[1], oz = ease(clamp01((officeU * 5 - 0.55) / 0.9)); S1.t[0] = lerp(OW.t[0], OC.t[0], oz); S1.t[1] = lerp(OW.t[1], OC.t[1], oz); S1.t[2] = lerp(OW.t[2], OC.t[2], oz); S1.s = lerp(OW.s, OC.s, oz); S1.az = lerp(OW.az, OC.az, oz); S1.el = lerp(OW.el, OC.el, oz); }
    const A = STATIONS[i], B = STATIONS[i + 1];
    const d = { x: lerp(A.t[0], B.t[0], u), y: lerp(A.t[1], B.t[1], u), z: lerp(A.t[2], B.t[2], u), s: lerp(A.s, B.s, u) * (1 + Math.sin(Math.PI * u) * 0.3), az: lerp(A.az, B.az, u) + mx * 0.05 + Math.sin(clock * 0.07) * 0.03, el: lerp(A.el ?? 0.58, B.el ?? 0.58, u) };
    const k = 1 - Math.exp(-dt * 2.6);
    for (const key in d) cur[key] += (d[key] - cur[key]) * k;
    mx += (tmx - mx) * (1 - Math.exp(-dt * 4)); my += (tmy - my) * (1 - Math.exp(-dt * 4));
    const asp = cw / ch;
    const halfH = asp < 1 ? (cur.s * 0.8) / asp : cur.s, halfW = halfH * asp;
    const elev = cur.el + my * 0.025;
    dir.set(Math.sin(cur.az) * Math.cos(elev), Math.sin(elev), Math.cos(cur.az) * Math.cos(elev));
    right.set(Math.cos(cur.az), 0, -Math.sin(cur.az));
    tgt.set(cur.x, cur.y, cur.z);
    if (asp > 1.1) tgt.addScaledVector(right, -halfW * 0.24);
    const dist = halfH / Math.tan(THREE.MathUtils.degToRad(14));
    cam.aspect = asp; cam.near = Math.max(2, dist * 0.3); cam.far = dist * 14; cam.position.copy(tgt).addScaledVector(dir, dist); cam.lookAt(tgt); cam.updateProjectionMatrix();
    scene.fog.near = dist * 1.8; scene.fog.far = dist * 6;
    const tex = (sun.shadow.camera.right * 2) / SHADOW * 8; _snap.set(Math.round(tgt.x / tex) * tex, Math.round(tgt.y / tex) * tex, Math.round(tgt.z / tex) * tex);
    sun.position.copy(_snap).add(sunOff); sun.target.position.copy(_snap);
    const ext = Math.round(Math.max(36, Math.min(190, cur.s * 2.4)) / 12) * 12; const scam = sun.shadow.camera;
    if (Math.abs(scam.right - ext) > 1) { scam.left = -ext; scam.right = ext; scam.top = ext; scam.bottom = -ext; scam.updateProjectionMatrix(); }
    const vis = clamp01(1 - (Math.abs(fs - 1) - 0.1) / 0.45);
    tower.vis += (vis - tower.vis) * (1 - Math.exp(-dt * 2.5));
    cutPlane.constant = 80;
    glassF.opacity = 0.92; glassF.depthWrite = false;
    const ostep = Math.min(4, Math.floor(officeU * 5)), focus = ease(clamp01(tower.vis));
    for (let k = 0; k < floorGlass.length; k++) {
      const g = floorGlass[k], want = (ostep === 4 || ostep === k + 1 ? 1 : 0) * focus;
      g.o += (want - g.o) * (1 - Math.exp(-dt * 2.6));
      const e = ease(clamp01(g.o)), s = Math.max(0.002, 1 - e);
      g.mesh.scale.y = s; g.mesh.position.y = g.y0 + g.h * (1 - s / 2); g.mat.opacity = lerp(0.92, 0.35, e); g.mesh.visible = e < 0.995;
    }
    for (let ri = 0; ri < reveals.length; ri++) { const r = reveals[ri]; const v = clamp01(1 - (Math.abs(fs - r.st) - 0.12) / 0.5); r.vis += (v - r.vis) * (1 - Math.exp(-dt * 2.2)); const op = lerp(1, r.min, ease(r.vis)); if (Math.abs(op - r.op) > 0.002) { r.op = op; for (const m of r.meshes) { m.material.opacity = op; m.material.depthWrite = op > 0.6; m.castShadow = op > 0.6; } } }
    if (markerEl) {
      const si = Math.round(f), st = STATIONS[si], phase = si === 1 ? Math.min(4, Math.floor(officeU * 5)) : Math.floor((aclock % CYCLE) / 4);
      mp.copy(st.steps[phase]).project(cam);
      markerEl.style.opacity = mp.z < 1 ? '1' : '0';
      markerEl.style.transform = `translate3d(${(((mp.x + 1) / 2) * cw).toFixed(2)}px, ${(((1 - mp.y) / 2) * ch).toFixed(2)}px, 0)`;
    }
    renderer.render(scene, cam);
    } catch (e) { lastErr = String(e && e.stack || e); }
  }
  requestAnimationFrame(frame);

  return {
    setProgress(v) { f = Math.max(0, Math.min(STATIONS.length - 1, v)); },
    setOffice(v) { officeU = clamp01(v); },
    getPhase() { const c = aclock % CYCLE; return { step: Math.floor(c / 4), frac: (c % 4) / 4 }; },
    getDebug() { return { lite: LITE, pr, dead, clock, cw: el.clientWidth, ch: el.clientHeight, attached: el.isConnected, frames, lastErr }; },
    step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(performance.now(), dt); },
    setMarker(m) { markerEl = m; },
    setAccent(hex) { M.acc.color.set(hex); accentClones.forEach((m) => m.color.set(hex)); },
    setMood(m) {
      night = m === 'night';
      const sky = night ? '#141b29' : HORIZON;
      paintSky(night ? '#05080f' : '#5f9ad8', night ? '#0b1120' : '#aacbe8', sky); scene.fog.color.set(sky);
      mountainMat.color.set(night ? '#3a4152' : '#ffffff');
      leafMatRef.color.set(night ? '#5a6478' : '#ffffff'); needleMatRef.color.set(night ? '#5a6478' : '#ffffff');
      hemi.intensity = night ? 0.12 : 0.65;
      sun.intensity = night ? 0.45 : 3.4; sun.color.set(night ? '#7f98d6' : '#fff1de');
      renderer.toneMappingExposure = night ? 1.15 : 1.06;
      allMats.forEach((mm) => { mm.envMapIntensity = night ? 0.12 : mm === M.glass || mm === curtainMat ? 1.25 : 0.8; });
      curtainMat.emissiveIntensity = night ? 1.6 : 0;
      M.lamp.emissiveIntensity = night ? 3 : 0;
      nightOnly.forEach((o) => (o.visible = night));
      floods.forEach((s) => (s.intensity = night ? 800 : 0));
      steam.mat.uniforms.color.value.set(night ? '#9aa3b0' : '#f4f4f2');
    },
    dispose() { dead = true; removeEventListener('pointermove', onMove); renderer.dispose(); renderer.domElement.remove(); },
  };
}
