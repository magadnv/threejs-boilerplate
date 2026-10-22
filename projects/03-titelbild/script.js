import * as THREE from "three/webgpu";
import {
  Fn,
  instancedArray,
  instanceIndex,
  uniform,
  float,
  vec3,
  vec4,
  hash,
  mx_noise_vec3,
  mix,
  smoothstep,
  uv,
  max,
  pow,
  length,
} from "three/tsl";

// Tinte als LinkedIn-Titelbild: eine Million Partikel schreiben den Leitsatz
// in 1584 × 396. Ein Windstoß lässt einen Teil rot glühen, dann wird das Bild
// mit Papierkorn und Beschriftung als PNG in doppelter Größe gespeichert.

const W = 1584;
const H = 396;
const PR = 2; // Export 3168 × 792

const hasWebGPU = !!navigator.gpu;
const COUNT = hasWebGPU ? 1024 * 1024 : 256 * 1024;
const DUST = 0.03;
const BOX = { w: 16, h: 4 }; // Weltmaß des ganzen Titelbilds

const LINES = [
  { text: "Manche Dinge verdienen eine Bühne.", scale: 1, ink: 1 },
  { text: "Ich widme mich ihnen und setze sie ins Licht.", scale: 0.48, ink: 0.25 },
];
// Rechte Kante des Satzes; links unten liegt das Profilbild
const RIGHT = 0.94;
const MAX_WIDTH = 0.6;

// --- Ziele aus Schrift rastern ------------------------------------------------

await document.fonts.load('italic 200px "Instrument Serif"');
await document.fonts.load('500 15px "Geist"');

const layout = (() => {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = 'italic 100px "Instrument Serif"';
  const size = (W * PR * MAX_WIDTH * 100) / ctx.measureText(LINES[0].text).width;
  const gap = size * 0.18;
  const heights = LINES.map((l) => size * l.scale);
  const total = heights.reduce((a, b) => a + b, 0) + gap;
  let y = (H * PR) / 2 - total / 2 - size * 0.06;
  return LINES.map((l, i) => {
    const h = heights[i];
    const out = { ...l, px: size * l.scale, baseline: y + h * 0.78 };
    y += h + gap;
    return out;
  });
})();

function sampleSentence() {
  const cw = W * PR;
  const ch = H * PR;
  const cvs = document.createElement("canvas");
  cvs.width = cw;
  cvs.height = ch;
  const ctx = cvs.getContext("2d", { willReadFrequently: true });
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  for (const l of layout) {
    // Kleine Schrift bekommt weniger Tinte, sonst läuft sie zu
    ctx.fillStyle = `rgba(0, 0, 0, ${l.ink})`;
    ctx.font = `italic ${l.px}px "Instrument Serif"`;
    ctx.fillText(l.text, cw * RIGHT, l.baseline);
  }

  const { data } = ctx.getImageData(0, 0, cw, ch);
  const filled = [];
  for (let i = 0; i < cw * ch; i++) if (data[i * 4 + 3] > 40) filled.push(i);

  const out = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const o = i * 4;
    if (Math.random() < DUST) {
      out[o] = (Math.random() - 0.5) * BOX.w * 1.05;
      out[o + 1] = (Math.random() - 0.5) * BOX.h * 1.1;
      out[o + 2] = (Math.random() - 0.5) * 1.5;
      out[o + 3] = 1; // Staub
      continue;
    }
    let p;
    do p = filled[(Math.random() * filled.length) | 0];
    while (Math.random() * 255 > data[p * 4 + 3]);
    const x = (p % cw) + Math.random();
    const y = Math.floor(p / cw) + Math.random();
    out[o] = (x / cw - 0.5) * BOX.w;
    out[o + 1] = -(y / ch - 0.5) * BOX.h;
    out[o + 2] = (Math.random() - 0.5) * 0.08;
    out[o + 3] = 0;
  }
  return out;
}

const target = instancedArray(sampleSentence(), "vec4");

// Weltkoordinaten der ersten Zeile, für den Windstoß über „Bühne.“
const toWorldX = (px) => (px / (W * PR) - 0.5) * BOX.w;
const toWorldY = (py) => -(py / (H * PR) - 0.5) * BOX.h;
const line1 = layout[0];
const gustPath = {
  x0: toWorldX(W * PR * (RIGHT - MAX_WIDTH * 0.24)),
  x1: toWorldX(W * PR * RIGHT) + 0.4,
  y: toWorldY(line1.baseline - line1.px * 0.3),
};

// --- Renderer, Szene, Kamera ---------------------------------------------------

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
renderer.setPixelRatio(PR);
renderer.setSize(W, H, false);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f8f4f4");

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
camera.position.set(0, 0, BOX.h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
camera.lookAt(0, 0, 0);

// --- Partikel-Zustand auf der GPU ---------------------------------------------

const positions = instancedArray(COUNT, "vec4"); // xyz + Hitze
const velocities = instancedArray(COUNT, "vec4");

const uTime = uniform(0);
const uDelta = uniform(1 / 60);
const uPointer = uniform(new THREE.Vector3(99, 99, 0));
const uPointerVel = uniform(new THREE.Vector3());
const uPointerSpeed = uniform(0);
const uRadius = uniform(0.6);

const init = Fn(() => {
  const i = instanceIndex;
  const spread = vec3(hash(i.add(11)), hash(i.add(23)), hash(i.add(37)))
    .sub(0.5)
    .mul(vec3(BOX.w * 1.6, BOX.h * 3, 5));
  positions.element(i).assign(vec4(spread, 0));
  velocities.element(i).assign(vec4(0));
})().compute(COUNT);

const update = Fn(() => {
  const i = instanceIndex;
  const p = positions.element(i);
  const v = velocities.element(i);
  const t = target.element(i);

  const pos = p.xyz.toVar();
  const vel = v.xyz.toVar();
  const seed = hash(i);
  const isDust = t.w;

  // Feder zum Ziel – jeder Partikel mit eigener Steifigkeit, Staub weicher
  const stiffness = mix(seed.mul(9).add(7), float(1.5), isDust);
  vel.addAssign(t.xyz.sub(pos).mul(stiffness).mul(uDelta));

  // Rauschfeld: die Schrift atmet
  const n = mx_noise_vec3(pos.mul(0.55).add(vec3(0, 0, uTime.mul(0.12))));
  vel.addAssign(n.mul(float(0.08).add(isDust.mul(0.25))).mul(uDelta));

  // Luftzug vom Cursor: mitreißen und leicht nach außen drücken
  const d = pos.xy.sub(uPointer.xy);
  const dist = length(d);
  const infl = float(1).sub(smoothstep(0, uRadius, dist)).pow(2);
  const away = d.div(dist.add(0.0001));
  const push = uPointerVel.xy.mul(1.6).add(away.mul(uPointerSpeed.mul(1.4)));
  vel.addAssign(vec3(push.mul(infl).mul(seed.add(0.5)), infl.mul(uPointerSpeed).mul(seed.sub(0.5)).mul(4)).mul(uDelta.mul(60)));

  vel.mulAssign(pow(float(0.9), uDelta.mul(60)));
  pos.addAssign(vel.mul(uDelta));

  // Hitze: bewegte Tinte glüht rot und kühlt langsam ab
  const heat = max(p.w.mul(pow(float(0.985), uDelta.mul(60))), infl.mul(uPointerSpeed.mul(1.5).min(1)));

  p.assign(vec4(pos, heat));
  v.assign(vec4(vel, 0));
})().compute(COUNT);

renderer.compute(init);

// --- Darstellung -------------------------------------------------------------

const ink = uniform(new THREE.Color("#16130f"));
const signal = uniform(new THREE.Color("#cf1830"));
const uSize = uniform(0.018);

const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
const state = positions.toAttribute();
const heat = state.w;
const r = hash(instanceIndex);

material.positionNode = state.xyz;
material.scaleNode = uSize.mul(r.mul(0.9).add(0.45)).mul(heat.mul(0.8).add(1));
material.colorNode = mix(ink, signal, smoothstep(0.04, 0.5, heat));
const disc = float(1).sub(uv().sub(0.5).length().mul(2)).clamp(0, 1);
material.opacityNode = disc.mul(mix(float(0.24), float(0.7), smoothstep(0.04, 0.5, heat)));

const particles = new THREE.Sprite(material);
particles.count = COUNT;
particles.frustumCulled = false;
scene.add(particles);

// --- Eingabe -----------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
const lastHit = new THREE.Vector3(99, 99, 0);
let pointerActive = false;

canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  pointerActive = true;
});
canvas.addEventListener("pointerleave", () => (pointerActive = false));

// Windstoß: ein unsichtbarer Cursor streicht über „Bühne.“
let gust = null;
function startGust() {
  gust = { start: performance.now() };
  lastHit.set(99, 99, 0);
}
function gustPoint(now) {
  const k = (now - gust.start) / 700;
  if (k > 1) {
    gust = null;
    return null;
  }
  const e = k * k * (3 - 2 * k);
  return new THREE.Vector3(
    THREE.MathUtils.lerp(gustPath.x0, gustPath.x1, e),
    gustPath.y + Math.sin(k * Math.PI * 2) * 0.12,
    0,
  );
}

const gustBtn = document.querySelector("#gust");
gustBtn.addEventListener("click", startGust);
setTimeout(startGust, 3200);

const avatar = document.querySelector(".banner__avatar");
document.querySelector("#avatar").addEventListener("change", (e) => (avatar.hidden = !e.target.checked));

// --- Export ------------------------------------------------------------------

const grain = (() => {
  const g = document.createElement("canvas");
  g.width = g.height = 256;
  const gctx = g.getContext("2d");
  const img = gctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.random() * 55;
    img.data[i] = v;
    img.data[i + 1] = v * 0.97;
    img.data[i + 2] = v * 0.95;
    img.data[i + 3] = 255;
  }
  gctx.putImageData(img, 0, 0);
  return g;
})();

let wantShot = false;
const saveBtn = document.querySelector("#save");
saveBtn.addEventListener("click", () => (wantShot = true));
addEventListener("keydown", (e) => {
  if (e.code === "KeyS") wantShot = true;
  if (e.code === "Space") {
    e.preventDefault();
    startGust();
  }
});

function shoot() {
  const out = document.createElement("canvas");
  out.width = W * PR;
  out.height = H * PR;
  const ctx = out.getContext("2d");
  ctx.drawImage(renderer.domElement, 0, 0, out.width, out.height);

  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = ctx.createPattern(grain, "repeat");
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  ctx.scale(PR, PR);
  ctx.textBaseline = "top";
  ctx.font = '500 15px "Geist"';
  ctx.fillStyle = "#16130f";
  ctx.fillText("madebymaga", 36, 30);
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.font = '400 15px "Geist"';
  ctx.fillStyle = "rgba(22, 19, 15, .5)";
  ctx.fillText("Tinte · eine Million Partikel", W - 36, H - 28);

  saveBtn.disabled = true;
  out.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "madebymaga-linkedin-titelbild.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    saveBtn.disabled = false;
  }, "image/png");
}

// --- Bühne an die Fensterbreite anpassen ---------------------------------------

function fit() {
  const pad = innerWidth > 640 ? 64 : 32;
  document.documentElement.style.setProperty("--scale", Math.min(1, (innerWidth - pad) / W));
}
fit();
addEventListener("resize", fit);

// --- Schleife ----------------------------------------------------------------

const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 1 / 30);
  uDelta.value = dt;
  uTime.value += dt;

  let point = null;
  if (gust) point = gustPoint(performance.now());
  if (!point && pointerActive) {
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(plane, hit)) point = hit.clone();
  }

  if (point) {
    const vx = (point.x - lastHit.x) / Math.max(dt, 1e-3);
    const vy = (point.y - lastHit.y) / Math.max(dt, 1e-3);
    const jump = Math.hypot(vx, vy) > 400; // erster Kontakt, kein echter Zug
    uPointerVel.value.lerp(new THREE.Vector3(jump ? 0 : vx, jump ? 0 : vy, 0), 0.35);
    uPointer.value.copy(point);
    lastHit.copy(point);
  } else {
    uPointerVel.value.multiplyScalar(0.85);
  }
  uPointerSpeed.value = Math.min(uPointerVel.value.length() * 0.25, 2);

  renderer.compute(update);
  renderer.render(scene, camera);

  // Im selben Takt wie das Rendern lesen, sonst ist der Puffer leer
  if (wantShot) {
    wantShot = false;
    shoot();
  }
});
