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

// Eine Million Tintenpartikel schreiben einen Satz. Jede Bewegung läuft als
// Compute-Shader auf der GPU: Feder zum Ziel, Rauschfeld, Luftzug vom Cursor.

const hasWebGPU = !!navigator.gpu;
const COUNT = hasWebGPU ? 1024 * 1024 : 256 * 1024;
const DUST = 0.04; // Anteil, der als Staub über dem Papier liegt

const narrow = innerWidth / innerHeight < 1;
const BOX = narrow ? { w: 6, h: 8 } : { w: 9, h: 9 * 9 / 16 };

const SENTENCES = narrow
  ? [
      ["Manche", "Dinge", "verdienen", "eine Bühne."],
      ["Ich setze", "sie ins", "Licht."],
      ["made", "by maga"],
    ]
  : [
      ["Manche Dinge", "verdienen eine Bühne."],
      ["Ich widme mich ihnen", "und setze sie ins Licht."],
      ["madebymaga"],
    ];

// --- Ziele aus Schrift rastern ------------------------------------------------

await document.fonts.load('italic 200px "Instrument Serif"');

function sampleSentence(lines) {
  const W = 1600;
  const H = Math.round((W * BOX.h) / BOX.w);
  const cvs = document.createElement("canvas");
  cvs.width = W;
  cvs.height = H;
  const ctx = cvs.getContext("2d", { willReadFrequently: true });

  ctx.font = 'italic 100px "Instrument Serif"';
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const size = Math.min((W * 0.88 * 100) / widest, (H * 0.8) / lines.length / 0.95);
  ctx.font = `italic ${size}px "Instrument Serif"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  const lead = size * 0.95;
  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lead);
  });

  const { data } = ctx.getImageData(0, 0, W, H);
  const filled = [];
  for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] > 110) filled.push(i);

  const out = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const o = i * 4;
    if (Math.random() < DUST) {
      out[o] = (Math.random() - 0.5) * BOX.w * 1.6;
      out[o + 1] = (Math.random() - 0.5) * BOX.h * 1.6;
      out[o + 2] = (Math.random() - 0.5) * 2.5;
      out[o + 3] = 1; // Staub
      continue;
    }
    const p = filled[(Math.random() * filled.length) | 0];
    const x = (p % W) + Math.random();
    const y = Math.floor(p / W) + Math.random();
    out[o] = (x / W - 0.5) * BOX.w;
    out[o + 1] = -(y / H - 0.5) * BOX.h;
    out[o + 2] = (Math.random() - 0.5) * 0.12;
    out[o + 3] = 0;
  }
  return out;
}

const targets = SENTENCES.map((s) => instancedArray(sampleSentence(s), "vec4"));

// --- Renderer, Szene, Kamera ---------------------------------------------------

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f3efe6");

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);

function fitCamera() {
  camera.aspect = innerWidth / innerHeight;
  const h = Math.max(BOX.h, BOX.w / camera.aspect) * 1.18;
  camera.userData.dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.updateProjectionMatrix();
}
fitCamera();
camera.position.set(0, 0, camera.userData.dist);

// --- Partikel-Zustand auf der GPU ---------------------------------------------

const positions = instancedArray(COUNT, "vec4"); // xyz + Hitze
const velocities = instancedArray(COUNT, "vec4");

const uTime = uniform(0);
const uDelta = uniform(1 / 60);
const uGather = uniform(1); // 1 = Satz, 0 = aufgelöst
const uPointer = uniform(new THREE.Vector3(99, 99, 0));
const uPointerVel = uniform(new THREE.Vector3());
const uPointerSpeed = uniform(0);
const uRadius = uniform(narrow ? 0.9 : 0.75);

const init = Fn(() => {
  const i = instanceIndex;
  const spread = vec3(hash(i.add(11)), hash(i.add(23)), hash(i.add(37)))
    .sub(0.5)
    .mul(vec3(BOX.w * 2.2, BOX.h * 2.2, 6));
  positions.element(i).assign(vec4(spread, 0));
  velocities.element(i).assign(vec4(0));
})().compute(COUNT);

const makeUpdate = (target) =>
  Fn(() => {
    const i = instanceIndex;
    const p = positions.element(i);
    const v = velocities.element(i);
    const t = target.element(i);

    const pos = p.xyz.toVar();
    const vel = v.xyz.toVar();
    const seed = hash(i);
    const isDust = t.w;

    // Feder zum Ziel – jeder Partikel mit eigener Steifigkeit, Staub weicher
    const stiffness = mix(seed.mul(9).add(7), float(1.5), isDust).mul(uGather);
    vel.addAssign(t.xyz.sub(pos).mul(stiffness).mul(uDelta));

    // Rauschfeld: im Satz ein Atmen, beim Auflösen ein Strom
    const flow = mix(float(5.5), float(0.08), uGather).add(isDust.mul(0.25));
    const n = mx_noise_vec3(pos.mul(mix(float(1.4), float(0.55), uGather)).add(vec3(0, 0, uTime.mul(0.12))));
    vel.addAssign(n.mul(flow).mul(uDelta));

    // Luftzug vom Cursor: mitreißen und leicht nach außen drücken
    const d = pos.xy.sub(uPointer.xy);
    const dist = length(d);
    const infl = float(1).sub(smoothstep(0, uRadius, dist)).pow(2);
    const away = d.div(dist.add(0.0001));
    const push = uPointerVel.xy.mul(1.6).add(away.mul(uPointerSpeed.mul(1.4)));
    vel.addAssign(vec3(push.mul(infl).mul(seed.add(0.5)), infl.mul(uPointerSpeed).mul(seed.sub(0.5)).mul(4)).mul(uDelta.mul(60)));

    // Dämpfung unabhängig von der Bildrate
    vel.mulAssign(pow(float(0.9), uDelta.mul(60)));
    pos.addAssign(vel.mul(uDelta));

    // Hitze: bewegte Tinte glüht rot und kühlt langsam ab
    const heat = max(p.w.mul(pow(float(0.985), uDelta.mul(60))), infl.mul(uPointerSpeed.mul(1.5).min(1)));

    p.assign(vec4(pos, heat));
    v.assign(vec4(vel, 0));
  })().compute(COUNT);

const updates = targets.map(makeUpdate);
let current = 0;

renderer.compute(init);

// --- Darstellung -------------------------------------------------------------

const ink = uniform(new THREE.Color("#16130f"));
const signal = uniform(new THREE.Color("#cf1830"));
const uSize = uniform(narrow ? 0.022 : 0.016);

const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
const state = positions.toAttribute();
const heat = state.w;
const r = hash(instanceIndex);

material.positionNode = state.xyz;
material.scaleNode = uSize.mul(r.mul(0.9).add(0.45)).mul(heat.mul(0.8).add(1));
material.colorNode = mix(ink, signal, smoothstep(0.04, 0.5, heat));
const disc = float(1).sub(uv().sub(0.5).length().mul(2)).clamp(0, 1);
material.opacityNode = disc.mul(mix(float(0.28), float(0.7), smoothstep(0.04, 0.5, heat)));

const particles = new THREE.Sprite(material);
particles.count = COUNT;
particles.frustumCulled = false;
scene.add(particles);

// --- Eingabe -----------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2(0, 0);
const hit = new THREE.Vector3();
const lastHit = new THREE.Vector3(99, 99, 0);
let pointerActive = false;
let down = null;

addEventListener("pointermove", (e) => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  pointerActive = true;
});
addEventListener("pointerleave", () => (pointerActive = false));
canvas.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
canvas.addEventListener("pointerup", (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  if (moved < 6 && performance.now() - down.t < 400) nextSentence();
  down = null;
});
addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowRight") nextSentence();
});

// Satzwechsel: auflösen, Ziel tauschen, sammeln
let transition = null;
function nextSentence() {
  if (transition) return;
  transition = { start: performance.now(), swapped: false };
}

function stepTransition(now) {
  if (!transition) return;
  const t = (now - transition.start) / 1000;
  if (t < 0.9) {
    uGather.value = 1 - easeOut(t / 0.9);
  } else {
    if (!transition.swapped) {
      current = (current + 1) % updates.length;
      transition.swapped = true;
    }
    const k = Math.min((t - 0.9) / 1.6, 1);
    uGather.value = easeInOut(k);
    if (k >= 1) transition = null;
  }
}
const easeOut = (x) => 1 - (1 - x) ** 3;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// --- HUD ---------------------------------------------------------------------

document.querySelector("#count").textContent = COUNT.toLocaleString("de-DE");
document.querySelector("#backend").textContent = renderer.backend.isWebGPUBackend ? "WebGPU Compute" : "WebGL 2";
const fpsEl = document.querySelector("#fps");
let frames = 0;
let fpsT = performance.now();

addEventListener("resize", () => {
  fitCamera();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Schleife ----------------------------------------------------------------

const timer = new THREE.Timer();
const tilt = new THREE.Vector2();
const ZERO = new THREE.Vector2();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  timer.update();
  const dt = Math.min(timer.getDelta(), 1 / 30);
  uDelta.value = dt;
  uTime.value += dt;

  // Leichtes Neigen zeigt die Tiefe der Tinte
  tilt.lerp(pointerActive ? ndc : ZERO, 0.04);
  camera.position.set(tilt.x * 0.9, tilt.y * 0.6, camera.userData.dist);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  raycaster.setFromCamera(ndc, camera);
  if (pointerActive && raycaster.ray.intersectPlane(plane, hit)) {
    const vx = (hit.x - lastHit.x) / Math.max(dt, 1e-3);
    const vy = (hit.y - lastHit.y) / Math.max(dt, 1e-3);
    const jump = Math.hypot(vx, vy) > 400; // erster Kontakt, kein echter Zug
    uPointerVel.value.lerp(new THREE.Vector3(jump ? 0 : vx, jump ? 0 : vy, 0), 0.35);
    uPointer.value.copy(hit);
    lastHit.copy(hit);
  } else {
    uPointerVel.value.multiplyScalar(0.85);
  }
  uPointerSpeed.value = Math.min(uPointerVel.value.length() * 0.25, 2);

  stepTransition(now);
  renderer.compute(updates[current]);
  renderer.render(scene, camera);

  frames++;
  if (now - fpsT > 500) {
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - fpsT))} fps`;
    frames = 0;
    fpsT = now;
  }
});
