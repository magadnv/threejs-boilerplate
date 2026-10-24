import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createSound } from "./sound.js";

// Weiße Orchidee — Hintergrund fürs gemeinsame Frühstück.
// Eine Phalaenopsis-Rispe öffnet sich im Morgenlicht, Pollen aus Licht
// sammeln sich immer wieder zu einem Herz, dazu der Dank.

const LINES = [
  "Guten Morgen, mein Herz.",
  "Jeder Morgen mit dir ist ein Geschenk.",
  "Wie die weiße Orchidee: still, rein, wunderschön.",
  "Für dein Lachen, deine Wärme, dein Herz.",
  "Mit dir schmeckt sogar der Kaffee nach Glück.",
  "Ich bin dankbar für dich. Jeden Tag.",
];

const canvas = document.querySelector("#scene");
const titleEl = document.querySelector("#title");
const lineEl = document.querySelector("#line");
const hintEl = document.querySelector("#hint");
const soundEl = document.querySelector("#sound");
const sound = createSound();

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 8);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// ---------- Himmel: tiefes Rosé, Morgensonne oben rechts mit Strahlen ----------

const sky = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uDeep: { value: new THREE.Color("#14040c") },
      uRose: { value: new THREE.Color("#4a1226") },
      uSun: { value: new THREE.Color("#ffc9a0") },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.999, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAspect;
      uniform vec3 uDeep, uRose, uSun;
      varying vec2 vUv;
      void main() {
        vec2 p = vec2(vUv.x * uAspect, vUv.y);
        vec2 sun = vec2(uAspect * 0.84, 1.08);
        vec2 dir = p - sun;
        float d = length(dir);
        float a = atan(dir.y, dir.x);

        vec3 col = mix(uDeep, uRose, smoothstep(-0.1, 1.3, vUv.y * 0.75 + vUv.x * 0.45));
        float glow = exp(-d * 1.7);
        float rays = (0.5 + 0.5 * sin(a * 9.0 + uTime * 0.05)) * (0.5 + 0.5 * sin(a * 17.0 - uTime * 0.08));
        rays = pow(rays, 2.5) * exp(-d * 0.9);
        float breathe = 0.9 + 0.1 * sin(uTime * 0.2);
        col += uSun * (glow * 0.42 + rays * 0.16) * breathe;

        vec2 q = vUv - 0.5;
        col *= 1.0 - dot(q, q) * 1.1;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthWrite: false,
    depthTest: false,
  })
);
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);

// ---------- Licht ----------

scene.add(new THREE.HemisphereLight("#ffeee4", "#3a1022", 1.1));
const sunLight = new THREE.DirectionalLight("#ffd4ac", 2.6);
sunLight.position.set(4, 5, 4);
scene.add(sunLight);
const roseLight = new THREE.PointLight("#ff8db4", 18, 14, 2);
roseLight.position.set(-3, -1.2, 3);
scene.add(roseLight);

// ---------- Texturen: Adern, Hauch von Rosa, gelb-magenta Lippe ----------

function canvasTexture(draw) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  draw(c.getContext("2d"));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const petalTex = canvasTexture((g) => {
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 256);
  const blush = g.createRadialGradient(128, 256, 0, 128, 256, 190);
  blush.addColorStop(0, "rgba(222, 140, 180, 0.38)");
  blush.addColorStop(1, "rgba(255, 255, 255, 0)");
  g.fillStyle = blush;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(205, 170, 195, 0.22)";
  g.lineWidth = 1.2;
  for (let i = 0; i < 24; i++) {
    const t = i / 23 - 0.5;
    g.beginPath();
    g.moveTo(128, 256);
    g.quadraticCurveTo(128 + t * 110, 140, 128 + t * 300, 0);
    g.stroke();
  }
});

const lipTex = canvasTexture((g) => {
  g.fillStyle = "#fff4f7";
  g.fillRect(0, 0, 256, 256);
  const gold = g.createRadialGradient(128, 190, 0, 128, 190, 110);
  gold.addColorStop(0, "#ffcf4d");
  gold.addColorStop(0.55, "rgba(255, 190, 80, 0.6)");
  gold.addColorStop(1, "rgba(255, 255, 255, 0)");
  g.fillStyle = gold;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 180; i++) {
    const x = 128 + (Math.random() - 0.5) * 140;
    const y = 120 + Math.random() * 136;
    g.fillStyle = `rgba(190, 40, 105, ${0.3 + Math.random() * 0.4})`;
    g.beginPath();
    g.arc(x, y, 1 + Math.random() * 2.5, 0, Math.PI * 2);
    g.fill();
  }
});

const petalMat = new THREE.MeshPhysicalMaterial({
  map: petalTex,
  emissive: "#ffffff",
  emissiveMap: petalTex,
  emissiveIntensity: 0.14,
  roughness: 0.6,
  sheen: 1,
  sheenColor: new THREE.Color("#ffd6e6"),
  sheenRoughness: 0.45,
  side: THREE.DoubleSide,
});

const lipMat = new THREE.MeshPhysicalMaterial({
  map: lipTex,
  emissive: "#ffffff",
  emissiveMap: lipTex,
  emissiveIntensity: 0.1,
  roughness: 0.5,
  sheen: 1,
  sheenColor: new THREE.Color("#ffc0d8"),
  side: THREE.DoubleSide,
});

const budMat = new THREE.MeshStandardMaterial({ color: "#e4efd6", roughness: 0.55 });
const stemMat = new THREE.MeshStandardMaterial({ color: "#4d5c2c", roughness: 0.5 });

// ---------- Blütenblatt: Ebene, zur Blattform gebogen und gewölbt ----------

function petalGeometry({ length, width, cup = 0.1, curl = -0.1, peak = 1.4, round = 0.55 }) {
  const geo = new THREE.PlaneGeometry(1, 1, 18, 28);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i) - 0.5;
    const v = uv.getY(i);
    const w = width * Math.pow(Math.sin(Math.PI * Math.pow(v, peak)), round);
    const z = cup * 4 * u * u * w + curl * v * v * length + Math.sin(u * 18 + v * 9) * 0.005 * v;
    pos.setXYZ(i, u * w, v * length, z);
  }
  geo.computeVertexNormals();
  return geo;
}

const sepalGeo = petalGeometry({ length: 0.5, width: 0.22, cup: 0.14, curl: -0.14, peak: 1.2, round: 0.6 });
const wingGeo = petalGeometry({ length: 0.46, width: 0.5, cup: 0.1, curl: -0.12, peak: 1.6, round: 0.45 });
const lipGeo = petalGeometry({ length: 0.27, width: 0.21, cup: 0.5, curl: 0.12, peak: 1.0, round: 0.8 });
const columnGeo = new THREE.SphereGeometry(1, 16, 12);
const budGeo = new THREE.SphereGeometry(0.1, 24, 16);

function createFlower() {
  const flower = new THREE.Group();
  const parts = [];
  const add = (geo, mat, angleDeg, z, fold) => {
    const pivot = new THREE.Group();
    pivot.rotation.z = THREE.MathUtils.degToRad(angleDeg - 90);
    pivot.position.z = z;
    const mesh = new THREE.Mesh(geo, mat);
    pivot.add(mesh);
    flower.add(pivot);
    parts.push({ mesh, fold });
  };
  add(sepalGeo, petalMat, 90, 0, 1.25);
  add(sepalGeo, petalMat, 228, 0, 1.25);
  add(sepalGeo, petalMat, 312, 0, 1.25);
  add(wingGeo, petalMat, 8, 0.02, 1.5);
  add(wingGeo, petalMat, 172, 0.02, 1.5);
  add(lipGeo, lipMat, 270, 0.06, 0.9);

  const column = new THREE.Mesh(columnGeo, petalMat);
  column.scale.set(0.035, 0.06, 0.04);
  column.position.set(0, 0.03, 0.08);
  flower.add(column);

  flower.userData.parts = parts;
  return flower;
}

function setOpen(flower, o) {
  for (const { mesh, fold } of flower.userData.parts) mesh.rotation.x = (1 - o) * fold;
}

const easeOut = (x) => 1 - Math.pow(1 - x, 3);

// ---------- Rispe: Bogen von unten rechts nach links oben ----------

const world = new THREE.Group();
scene.add(world);

const stemCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(2.7, -3.4, -0.6),
  new THREE.Vector3(2.25, -1.3, -0.3),
  new THREE.Vector3(1.75, 0.85, 0),
  new THREE.Vector3(0.65, 1.75, 0.15),
  new THREE.Vector3(-0.8, 1.72, 0.2),
  new THREE.Vector3(-2.0, 1.05, 0.3),
  new THREE.Vector3(-2.65, 0.2, 0.35),
]);
world.add(new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 220, 0.022, 8), stemMat));

const flowers = [];
const blooms = [
  { t: 0.3, size: 1.05, side: 1 },
  { t: 0.4, size: 1.0, side: -1 },
  { t: 0.5, size: 0.98, side: 1 },
  { t: 0.6, size: 0.94, side: -1 },
  { t: 0.69, size: 0.88, side: 1 },
  { t: 0.78, size: 0.8, side: -1 },
];

blooms.forEach(({ t, size, side }, k) => {
  const anchor = stemCurve.getPointAt(t);
  const at = anchor.clone().add(new THREE.Vector3(side * 0.08, -0.34 * size, 0.2));

  const pedicel = new THREE.CatmullRomCurve3([
    anchor,
    anchor.clone().lerp(at, 0.5).add(new THREE.Vector3(side * 0.06, 0.04, 0)),
    at.clone().add(new THREE.Vector3(0, 0, -0.04)),
  ]);
  world.add(new THREE.Mesh(new THREE.TubeGeometry(pedicel, 16, 0.012, 6), stemMat));

  const holder = new THREE.Group();
  holder.position.copy(at);
  holder.lookAt(at.x * 0.35, at.y * 0.3 - 0.4, 9);
  holder.rotateZ(side * 0.12);
  const flower = createFlower();
  holder.add(flower);
  world.add(holder);
  flowers.push({ flower, size, delay: 0.8 + k * 0.75, phase: Math.random() * 6.28 });
});

// Knospen an der Spitze
[0.86, 0.915, 0.96].forEach((t, k) => {
  const p = stemCurve.getPointAt(t);
  const bud = new THREE.Mesh(budGeo, budMat);
  const s = 1 - k * 0.22;
  bud.scale.set(s, s * 1.3, s);
  bud.position.copy(p).add(new THREE.Vector3(0, -0.11 * s, 0.06));
  world.add(bud);
});

// ---------- Fallende Blütenblätter ----------

const FALLING = 34;
const falling = new THREE.InstancedMesh(
  petalGeometry({ length: 0.15, width: 0.13, cup: 0.18, curl: -0.08, peak: 1.3, round: 0.55 }),
  petalMat,
  FALLING
);
const fallState = Array.from({ length: FALLING }, () => ({
  pos: new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 7 - 3.5, Math.random() * 3 - 1.5),
  rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
  spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8),
  speed: 0.12 + Math.random() * 0.18,
  phase: Math.random() * 6.28,
}));
const dummy = new THREE.Object3D();
scene.add(falling);

// ---------- Pollen aus Licht, die sich zum Herz sammeln ----------

const POLLEN = 1800;
const drift = new Float32Array(POLLEN * 3);
const heart = new Float32Array(POLLEN * 3);
const rand = new Float32Array(POLLEN * 4);
for (let i = 0; i < POLLEN; i++) {
  drift.set([(Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4], i * 3);
  const a = Math.random() * Math.PI * 2;
  const hx = 16 * Math.pow(Math.sin(a), 3);
  const hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
  const r = i % 3 === 0 ? Math.sqrt(Math.random()) : 1 - Math.random() * 0.05;
  heart.set([(hx / 17) * r * 0.85, (hy / 17) * r * 0.85 + 0.12, (Math.random() - 0.5) * 0.15], i * 3);
  rand.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
}
const pollenGeo = new THREE.BufferGeometry();
pollenGeo.setAttribute("position", new THREE.BufferAttribute(drift, 3));
pollenGeo.setAttribute("aHeart", new THREE.BufferAttribute(heart, 3));
pollenGeo.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));

const pollenMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uMix: { value: 0 },
    uPixel: { value: renderer.getPixelRatio() * window.innerHeight * 0.0016 },
    uCenter: { value: new THREE.Vector3(0, 0.15, 1.3) },
    uGold: { value: new THREE.Color("#ffd9a6") },
    uPink: { value: new THREE.Color("#ff7aa6") },
  },
  vertexShader: /* glsl */ `
    uniform float uTime, uMix, uPixel;
    uniform vec3 uCenter;
    attribute vec3 aHeart;
    attribute vec4 aRand;
    varying float vAlpha;
    varying float vMix;
    void main() {
      vec3 d = position;
      d.y = mod(position.y + uTime * (0.04 + aRand.x * 0.06) + 3.0, 6.0) - 3.0;
      d.x += sin(uTime * 0.3 + aRand.y * 6.28) * 0.15;
      d.z += cos(uTime * 0.25 + aRand.z * 6.28) * 0.1;

      float beat = 1.0 + 0.05 * pow(abs(sin(uTime * 1.7)), 10.0);
      vec3 h = uCenter + aHeart * beat
        + vec3(sin(uTime * 1.5 + aRand.y * 6.28), cos(uTime * 1.3 + aRand.x * 6.28), 0.0) * 0.012;

      float m = smoothstep(aRand.w * 0.35, aRand.w * 0.35 + 0.65, uMix);
      vec4 mv = modelViewMatrix * vec4(mix(d, h, m), 1.0);
      gl_PointSize = uPixel * (6.0 + aRand.x * 11.0) * (1.0 + m * 0.3) / -mv.z;
      gl_Position = projectionMatrix * mv;
      vAlpha = 0.35 + 0.65 * aRand.z;
      vMix = m;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uGold, uPink;
    varying float vAlpha;
    varying float vMix;
    void main() {
      float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
      gl_FragColor = vec4(mix(uGold, uPink, vMix * 0.55) * 1.6, a * a * vAlpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
scene.add(new THREE.Points(pollenGeo, pollenMat));

// ---------- Bokeh im Hintergrund ----------

const BOKEH = 36;
const bokehPos = new Float32Array(BOKEH * 3);
const bokehRand = new Float32Array(BOKEH);
for (let i = 0; i < BOKEH; i++) {
  bokehPos.set([(Math.random() - 0.5) * 16, (Math.random() - 0.5) * 9, -3 - Math.random() * 4], i * 3);
  bokehRand[i] = Math.random();
}
const bokehGeo = new THREE.BufferGeometry();
bokehGeo.setAttribute("position", new THREE.BufferAttribute(bokehPos, 3));
bokehGeo.setAttribute("aRand", new THREE.BufferAttribute(bokehRand, 1));
const bokehMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uPixel: { value: pollenMat.uniforms.uPixel.value },
    uWarm: { value: new THREE.Color("#ffc59a") },
    uRose: { value: new THREE.Color("#ff6f9c") },
  },
  vertexShader: /* glsl */ `
    uniform float uTime, uPixel;
    attribute float aRand;
    varying float vRand;
    void main() {
      vec3 p = position;
      p.x += sin(uTime * 0.05 + aRand * 20.0) * 0.6;
      p.y += cos(uTime * 0.04 + aRand * 13.0) * 0.4;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = uPixel * (140.0 + aRand * 260.0) / -mv.z;
      gl_Position = projectionMatrix * mv;
      vRand = aRand;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uWarm, uRose;
    varying float vRand;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float disc = smoothstep(0.5, 0.42, d) * (0.6 + 0.4 * smoothstep(0.3, 0.48, d));
      float pulse = 0.5 + 0.5 * sin(uTime * 0.3 + vRand * 30.0);
      gl_FragColor = vec4(mix(uWarm, uRose, vRand), disc * (0.05 + 0.07 * pulse));
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
scene.add(new THREE.Points(bokehGeo, bokehMat));

// ---------- Nachbearbeitung: weiches Leuchten ----------

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.75, 0.78);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- Schrift ----------

function reveal(el, text) {
  el.classList.remove("in", "out");
  el.textContent = "";
  let i = 0;
  text.split(" ").forEach((word, w, words) => {
    const span = document.createElement("span");
    span.className = "word";
    for (const ch of word) {
      const c = document.createElement("span");
      c.className = "char";
      c.style.setProperty("--i", i++);
      c.textContent = ch;
      span.append(c);
    }
    el.append(span);
    if (w < words.length - 1) el.append(" ");
  });
  void el.offsetWidth;
  el.classList.add("in");
}

function conceal(el) {
  el.classList.remove("in");
  el.classList.add("out");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let heartTarget = 0;

async function story() {
  await sleep(5500);
  let next = 0;
  for (;;) {
    heartTarget = 1;
    sound.chime();
    await sleep(1800);
    reveal(titleEl, "Danke");
    await sleep(1700);
    reveal(lineEl, "an die schönste Seele der Welt.");
    await sleep(12000);
    heartTarget = 0;
    conceal(titleEl);
    conceal(lineEl);
    await sleep(4500);
    for (let k = 0; k < 3; k++) {
      reveal(lineEl, LINES[next++ % LINES.length]);
      await sleep(8000);
      conceal(lineEl);
      await sleep(3200);
    }
  }
}
story();

// ---------- Frühstücksmodus: Vollbild, Bildschirm bleibt an, Cursor weg ----------

async function keepAwake() {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {}
}
keepAwake();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") keepAwake();
});

function toggleSound() {
  if (sound.on) sound.stop();
  else sound.start();
  soundEl.classList.toggle("muted", !sound.on);
  soundEl.setAttribute("aria-pressed", sound.on);
}

let soundStarted = false;
window.addEventListener("click", () => {
  keepAwake();
  // Browser erlauben Ton erst nach einem Klick, also beim ersten Klick an
  if (!soundStarted) {
    soundStarted = true;
    if (!sound.on) toggleSound();
  }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
});

soundEl.addEventListener("click", (e) => {
  e.stopPropagation();
  soundStarted = true;
  toggleSound();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "m" || e.key === "M") {
    soundStarted = true;
    toggleSound();
  }
});
setTimeout(() => hintEl.classList.add("gone"), 4500);

let idleTimer;
const pointer = new THREE.Vector2();
window.addEventListener("pointermove", (e) => {
  pointer.set(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5);
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("idle"), 2000);
});

// ---------- Größe ----------

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  sky.material.uniforms.uAspect.value = camera.aspect;
  pollenMat.uniforms.uPixel.value = bokehMat.uniforms.uPixel.value = renderer.getPixelRatio() * h * 0.0016;

  // Hochformat: Rispe kleiner und höher, damit Platz für die Schrift bleibt
  const fit = Math.min(1, camera.aspect / 1.45);
  world.scale.setScalar(fit);
  world.position.y = (1 - fit) * 1.3;
}
window.addEventListener("resize", resize);
resize();

// ---------- Loop ----------

const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  sky.material.uniforms.uTime.value = t;
  pollenMat.uniforms.uTime.value = t;
  bokehMat.uniforms.uTime.value = t;
  pollenMat.uniforms.uMix.value += (heartTarget - pollenMat.uniforms.uMix.value) * Math.min(dt * 0.5, 1);

  // Blüten öffnen sich nacheinander, danach atmen sie leise
  for (const f of flowers) {
    const o = easeOut(THREE.MathUtils.clamp((t - f.delay) / 3.8, 0, 1));
    setOpen(f.flower, o * (0.97 + 0.03 * Math.sin(t * 0.6 + f.phase)));
    f.flower.scale.setScalar(f.size * (0.3 + 0.7 * o));
    f.flower.rotation.z = Math.sin(t * 0.35 + f.phase) * 0.04;
  }
  world.rotation.z = Math.sin(t * 0.18) * 0.012;

  for (let i = 0; i < FALLING; i++) {
    const s = fallState[i];
    s.pos.y -= s.speed * dt;
    s.pos.x += Math.sin(t * 0.6 + s.phase) * 0.12 * dt;
    if (s.pos.y < -3.6) {
      s.pos.y = 3.6;
      s.pos.x = (Math.random() - 0.5) * 9;
    }
    s.rot.x += s.spin.x * dt;
    s.rot.y += s.spin.y * dt;
    s.rot.z += s.spin.z * dt;
    dummy.position.copy(s.pos);
    dummy.rotation.copy(s.rot);
    dummy.updateMatrix();
    falling.setMatrixAt(i, dummy.matrix);
  }
  falling.instanceMatrix.needsUpdate = true;

  // Kamera fährt am Anfang heran und schwebt dann ruhig
  const dolly = 6 + 2 * Math.pow(1 - Math.min(t / 9, 1), 3);
  camTarget.set(Math.sin(t * 0.07) * 0.25 + pointer.x * 0.4, Math.cos(t * 0.05) * 0.12 - pointer.y * 0.25, dolly);
  camera.position.lerp(camTarget, Math.min(dt * 1.5, 1));
  camera.lookAt(0, 0.1, 0);

  composer.render();
  requestAnimationFrame(animate);
}
animate();
