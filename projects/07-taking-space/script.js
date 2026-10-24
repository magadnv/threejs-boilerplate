import * as THREE from "three";

// Sätze aus der Ausstellung, als Ikat in den Stoff gewebt
const STATEMENTS = [
  { lines: ["TAKING", "SPACE"], caption: "Textildesign bezieht Stellung zu Krieg, Klimakrise und Rechtsruck." },
  { lines: ["NIE", "NEUTRAL"], caption: "Jeder Stoff trägt Erzählungen, Herkunft und politische Aushandlungen in sich." },
  { lines: ["STELLUNG", "BEZIEHEN"], caption: "Textile Stellungnahmen: Fragen stellen, Räume für Diskussion öffnen." },
  { lines: ["BERÜHREN", "HEISST", "KONTAKT"], caption: "„Berühren bedeutet, in Kontakt zu treten.“" },
];

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canvas = document.querySelector("#scene");
const captionEl = document.querySelector("#caption");
const dotsEl = document.querySelector("#dots");

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 12);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ---------- Stoffmaße passend zum Bildschirm ----------
const size = new THREE.Vector2();
function measure() {
  const visH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const visW = visH * camera.aspect;
  size.set(visW * (camera.aspect < 1 ? 0.9 : 0.84), visH * 0.8);
}
measure();

// ---------- Muster-Masken (Schrift + Ikat-Rauten) ----------
function drawMask(lines) {
  const cw = 2048;
  const ch = Math.round(Math.min(cw * (size.y / size.x), 4096));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);
  ctx.fillStyle = "#fff";

  // Rautenband oben und unten
  const band = ch * 0.07;
  const n = Math.round(cw / band);
  const step = cw / n;
  for (const y of [ch * 0.09, ch * 0.91]) {
    for (let i = 0; i < n; i++) {
      const x = step * (i + 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y - band / 2);
      ctx.lineTo(x + step * 0.42, y);
      ctx.lineTo(x, y + band / 2);
      ctx.lineTo(x - step * 0.42, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(0, y - band * 0.85, cw, band * 0.08);
    ctx.fillRect(0, y + band * 0.77, cw, band * 0.08);
  }

  // Schrift, so groß wie der Platz erlaubt
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const areaW = cw * 0.86;
  const areaH = ch * 0.6;
  let fs = areaH / lines.length / 0.92;
  ctx.font = `${fs}px Anton`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  fs = Math.min(fs, fs * (areaW / widest));
  ctx.font = `${fs}px Anton`;
  const lh = fs * 0.98;
  const y0 = ch / 2 - (lh * (lines.length - 1)) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cw / 2, y0 + i * lh));

  // weiche Kanten, die der Shader zu Ikat-Fransen ausfranst
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const octx = out.getContext("2d");
  octx.filter = "blur(5px)";
  octx.drawImage(c, 0, 0);

  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// ---------- Stoff ----------
const vertexShader = /* glsl */ `
  uniform vec2 uSize;
  uniform float uTime;
  uniform float uUnroll;
  uniform float uRelease;
  uniform float uWind;
  uniform vec3 uPointer;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;

  vec3 clothPos(vec2 uv) {
    float W = uSize.x;
    float H = uSize.y;
    float x = (uv.x - 0.5) * W;
    float s = (1.0 - uv.y) * H;         // Weg von der Stange nach unten
    float f = uUnroll * H;              // so weit ist abgerollt
    float top = H * 0.5;
    float t = uTime;

    float k = s / H;
    float settle = clamp((f - s) / (0.25 * H) + uRelease, 0.0, 1.0);
    float w = sin(x * 0.9 + s * 0.6 - t * 1.7) * 0.26
            + sin(x * 1.7 - s * 1.1 + t * 1.2) * 0.11
            + sin(x * 0.33 + s * 0.2 - t * 0.6) * 0.5;
    w *= k * uWind * settle;

    // die Hand drückt in den Stoff
    vec2 flatP = vec2(x, top - s);
    float d = distance(flatP, uPointer.xy);
    float bulge = -uPointer.z * 0.9 * exp(-d * d / 1.1) * settle;

    if (s <= f) {
      float sway = sin(s * 0.8 - t * 1.3) * 0.05 * k * uWind * settle;
      return vec3(x + sway, top - s, w + bulge);
    }

    // Rest steckt noch in der Rolle (Spirale)
    float dd = s - f;
    float r0 = 0.24;
    float r = max(r0 * (1.0 - dd / (H * 1.3)), 0.05);
    float th = dd / r;
    float yc = top - f;
    return vec3(x, yc - r * sin(th), -r + r * cos(th));
  }

  void main() {
    vUv = uv;
    vec3 p = clothPos(uv);
    vec3 pu = clothPos(uv + vec2(0.002, 0.0));
    vec3 pv = clothPos(uv + vec2(0.0, 0.002));
    vNormal = normalize(cross(pu - p, pv - p));
    vec4 world = modelMatrix * vec4(p, 1.0);
    vPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMaskA;
  uniform sampler2D uMaskB;
  uniform float uSwap;
  uniform vec2 uThreads;
  uniform vec3 uRed;
  uniform vec3 uWarp;
  uniform vec3 uWeft;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;

  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

  void main() {
    vec2 g = vUv * uThreads;
    vec2 id = floor(g);
    vec2 fr = fract(g);
    float h = hash(id.x);

    // Fransen unten: nur Kettfäden, ungleich lang
    float fringe = 0.03;
    if (vUv.y < fringe) {
      if (abs(fr.x - 0.5) > 0.32) discard;
      if (vUv.y < fringe * (0.15 + 0.6 * h)) discard;
    }

    // Ikat: jeder Kettfaden ist beim Färben leicht verrutscht
    float off = (h - 0.5) * 0.024 + sin(vUv.y * 13.0 + h * 6.283) * 0.006;
    vec2 muv = vec2((id.x + 0.5) / uThreads.x, vUv.y + off);

    // neues Muster wird Schussreihe für Schussreihe eingewebt
    float row = id.y / uThreads.y;
    float dir = mod(id.y, 2.0) < 1.0 ? vUv.x : 1.0 - vUv.x;
    float order = row * 0.9 + dir * 0.1;
    float useB = step(order, uSwap);
    float m = mix(texture2D(uMaskA, muv).r, texture2D(uMaskB, muv).r, useB);
    float thr = 0.3 + 0.4 * hash2(vec2(id.x, floor(vUv.y * uThreads.y * 0.35)));
    float dyed = step(thr, m);

    vec3 red = uRed * (0.82 + 0.3 * h);
    vec3 warpCol = mix(uWarp, red, dyed);

    // Köper 3/1: Kette liegt drei von vier Mal oben
    bool warpTop = mod(id.x - id.y, 4.0) > 0.5 || vUv.y < fringe;
    float across = warpTop ? fr.x : fr.y;
    float shade = 0.7 + 0.3 * sin(3.14159 * across);
    vec3 col = (warpTop ? warpCol : uWeft) * shade;

    // zu fein für den Bildschirm: auf Mittelwert ausblenden
    float fw = max(fwidth(g.x), fwidth(g.y));
    vec3 avg = mix(uWeft, warpCol, 0.75) * 0.9;
    col = mix(col, avg, smoothstep(0.35, 0.9, fw));

    // das Schiffchen: aktive Schussreihe leuchtet rot
    float live = step(0.001, uSwap) * step(uSwap, 0.999);
    col = mix(col, uRed * 1.2, exp(-abs(order - uSwap) * 140.0) * live * 0.9);

    // Licht wie auf Wolle: weich, mit Glanz an den Falten
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 L = normalize(vec3(-0.45, 0.6, 0.75));
    vec3 V = normalize(cameraPosition - vPos);
    float diff = max(dot(n, L), 0.0) * 0.95 + 0.2;
    float sheen = pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.22;
    col = col * diff + sheen;
    if (!gl_FrontFacing) col *= 0.78;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const uniforms = {
  uSize: { value: size },
  uTime: { value: 0 },
  uUnroll: { value: reduceMotion ? 1 : 0 },
  uRelease: { value: reduceMotion ? 1 : 0 },
  uWind: { value: reduceMotion ? 0.3 : 1 },
  uPointer: { value: new THREE.Vector3(0, 0, 0) },
  uMaskA: { value: null },
  uMaskB: { value: null },
  uSwap: { value: 0 },
  uThreads: { value: new THREE.Vector2() },
  uRed: { value: new THREE.Color("#cf1830") },
  uWarp: { value: new THREE.Color("#f2eee6") },
  uWeft: { value: new THREE.Color("#e9e3d8") },
};

function setThreads() {
  const warp = camera.aspect < 1 ? 120 : 190;
  uniforms.uThreads.value.set(warp, Math.round(warp * (size.y / size.x)));
}
setThreads();

const cloth = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1, 220, 180),
  new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide })
);
cloth.frustumCulled = false;
scene.add(cloth);

// Stange
const rod = new THREE.Mesh(
  new THREE.CylinderGeometry(0.06, 0.06, 1, 24),
  new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.6 })
);
rod.rotation.z = Math.PI / 2;
scene.add(rod);
function placeRod() {
  rod.scale.y = size.x * 1.08;
  rod.position.set(0, size.y / 2 + 0.04, 0.02);
}
placeRod();
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(-3, 4, 5);
scene.add(sun);

// ---------- Sätze & Neu-Weben ----------
let masks = [];
let current = 0;
let weaving = null; // { to, start }
const WEAVE_TIME = 2.6;

STATEMENTS.forEach(() => dotsEl.appendChild(document.createElement("li")));
function showStatement(i) {
  [...dotsEl.children].forEach((d, j) => d.classList.toggle("on", j === i));
  captionEl.classList.add("out");
  setTimeout(() => {
    captionEl.textContent = STATEMENTS[i].caption;
    captionEl.classList.remove("out");
  }, 350);
}

function buildMasks() {
  masks.forEach((t) => t.dispose());
  masks = STATEMENTS.map((s) => drawMask(s.lines));
  uniforms.uMaskA.value = masks[current];
  uniforms.uMaskB.value = masks[current];
}

let lastWeave = 0;
function weaveNext() {
  if (weaving) return;
  const to = (current + 1) % STATEMENTS.length;
  uniforms.uMaskB.value = masks[to];
  weaving = { to, start: clock.elapsedTime };
  gust = 1;
  showStatement(to);
}

// ---------- Zeiger ----------
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2();
const target = new THREE.Vector3();
let touchStrength = 0;
let lastMove = -10;

window.addEventListener("pointermove", (e) => {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  raycaster.ray.intersectPlane(plane, target);
  lastMove = clock.elapsedTime;
});
canvas.addEventListener("click", () => {
  weaveNext();
  lastWeave = clock.elapsedTime;
});

let resizeTimer;
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  measure();
  setThreads();
  placeRod();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(buildMasks, 200);
});

// ---------- Loop ----------
const clock = new THREE.Clock();
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
let gust = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  uniforms.uTime.value = t;

  if (!reduceMotion) {
    // Banner fällt nach 0,4 s von der Stange
    const u = THREE.MathUtils.clamp((t - 0.4) / 2.2, 0, 1);
    uniforms.uUnroll.value = 1 - Math.pow(1 - u, 3);
    uniforms.uRelease.value = THREE.MathUtils.clamp((t - 2.6) / 1.2, 0, 1);
    gust = Math.max(0, gust - dt * 0.6);
    uniforms.uWind.value = 1 + gust * 1.6 + Math.sin(t * 0.37) * 0.25;
  }

  // Zeiger: gedämpft folgen, nach Stillstand loslassen
  const p = uniforms.uPointer.value;
  p.x += (target.x - p.x) * 0.12;
  p.y += (target.y - p.y) * 0.12;
  const wanted = t - lastMove < 1.2 ? 1 : 0;
  touchStrength += (wanted - touchStrength) * 0.06;
  p.z = touchStrength;

  // leichte Parallaxe
  camera.position.x += (p.x * 0.06 * touchStrength - camera.position.x) * 0.05;
  camera.position.y += (p.y * 0.04 * touchStrength - camera.position.y) * 0.05;
  camera.lookAt(0, 0, 0);

  // Weben: neues Muster läuft Reihe für Reihe ein
  if (weaving) {
    const k = THREE.MathUtils.clamp((t - weaving.start) / WEAVE_TIME, 0, 1);
    uniforms.uSwap.value = easeInOut(k);
    if (k >= 1) {
      current = weaving.to;
      uniforms.uMaskA.value = masks[current];
      uniforms.uSwap.value = 0;
      weaving = null;
      lastWeave = t;
    }
  } else if (t > 4 && t - lastWeave > 7 && t - lastMove > 3) {
    weaveNext();
  }

  renderer.render(scene, camera);
}

await document.fonts.load("200px Anton");
buildMasks();
showStatement(0);
lastWeave = 1;
animate();
