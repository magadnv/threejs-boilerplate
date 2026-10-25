import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// NAZA – Studie zur Bildsprache des Films: Nacht über der Stadt, die Wolkendecke
// vom Stadtlicht grün und mauve gefärbt, ein Licht am Himmel. Wo man hinsieht,
// wird das Bild verfremdet – wie die 24 Stimmen und Gesichter im Film.

const canvas = document.querySelector("#scene");
const nr = document.querySelector("#nr");
const wellePfad = document.querySelector("#welle");

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 30, 0);
const ziel = new THREE.Vector3(0, 70, -400);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const uniforms = {
  uTime: { value: 0 },
  uRes: { value: new THREE.Vector2() },
};

// ---------- Wolkendecke, von unten durch die Stadt beleuchtet ----------

const sky = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uRes;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        float aspect = uRes.x / uRes.y;
        // Wolken als Decke: nach oben hin näher, zum Horizont flacher
        float h = uv.y + 0.18;
        vec2 q = vec2((uv.x - 0.5) * aspect / h, 1.0 / h);
        q += vec2(uTime * 0.012, -uTime * 0.02);
        float n = fbm(q * 1.3);
        float n2 = fbm(q * 0.6 + 40.0);

        vec3 dark = vec3(0.035, 0.04, 0.04);
        vec3 mauve = vec3(0.62, 0.53, 0.58);
        vec3 pink = vec3(0.74, 0.58, 0.66);
        vec3 olive = vec3(0.26, 0.36, 0.14);
        vec3 lit = mix(mauve, pink, smoothstep(0.4, 0.8, n2));
        lit = mix(lit, olive, smoothstep(0.55, 0.0, uv.x + n2 * 0.4 - 0.15) * 0.85);

        float cover = smoothstep(0.28, 0.7, n);
        float glow = 0.35 + 0.65 * exp(-max(uv.y - 0.3, 0.0) * 1.8);
        vec3 col = mix(dark, lit, cover) * glow;
        col += vec3(0.14, 0.10, 0.12) * exp(-max(uv.y - 0.36, 0.0) * 9.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);

// ---------- Skyline mit Fenstern ----------

const rand = (a, b) => a + Math.random() * (b - a);
const towers = [];

// hinten die dichte Stadt, vorne einzelne Hochhäuser wie im Standbild
for (let i = 0; i < 420; i++) {
  const z = rand(-1000, -480);
  const tall = Math.random() < 0.1 && Math.abs(z) < 800;
  const h = tall ? rand(75, 125) : rand(14, 45);
  towers.push({ x: rand(-900, 900) * (tall ? 0.55 : 1), z, w: rand(14, 30), d: rand(14, 28), h, tall });
}
for (let i = 0; i < 260; i++) {
  const z = rand(-470, -50);
  towers.push({ x: rand(-420, 420), z, w: rand(8, 22), d: rand(8, 22), h: rand(4, 20), tall: false });
}

const towerGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const seeds = new Float32Array(towers.length);
const sizes = new Float32Array(towers.length * 3);
const towerMat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: /* glsl */ `
    attribute float aSeed;
    attribute vec3 aSize;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vSize;
    varying float vSeed;
    varying float vDist;
    varying float vY;
    void main() {
      vUv = uv;
      vNormal = normal;
      vSize = aSize;
      vSeed = aSeed;
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vY = wp.y;
      vec4 mv = viewMatrix * wp;
      vDist = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vSize;
    varying float vSeed;
    varying float vDist;
    varying float vY;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
    void main() {
      vec3 col = vec3(0.018, 0.017, 0.022);
      float face = abs(vNormal.z) > 0.5 ? 1.0 : (abs(vNormal.x) > 0.5 ? 0.6 : 0.0);
      if (face > 0.0) {
        float width = abs(vNormal.z) > 0.5 ? vSize.x : vSize.z;
        vec2 grid = vec2(width / 1.5, vSize.y / 1.15);
        vec2 cell = floor(vUv * grid);
        vec2 f = fract(vUv * grid);
        float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.25, f.y) * step(f.y, 0.75);
        float r = hash(cell + vSeed * 97.0 + vNormal.xz * 13.0);
        float on = step(0.8 - vSeed * 0.14, r);
        // vereinzelt gehen Lichter an und aus
        on *= step(0.02, fract(r * 31.0 + floor(uTime * 0.15 + r * 9.0) * 0.37));
        vec3 warm = vec3(1.0, 0.72, 0.42);
        vec3 cool = vec3(0.78, 0.88, 1.0);
        vec3 wc = mix(warm, cool, step(0.6, fract(r * 7.13)));
        wc = mix(wc, vec3(0.45, 1.0, 0.55), step(0.985, fract(r * 3.7)));
        col += wc * win * on * face * (0.6 + 0.4 * fract(r * 11.0));
        // grüne Krone auf einzelnen Türmen, wie im Standbild
        float crown = step(0.955, vUv.y) * step(vUv.y, 0.97) * step(vSeed, 0.035) * step(90.0, vSize.y);
        col += vec3(0.35, 1.0, 0.45) * crown * 1.4 * face;
      }
      float haze = smoothstep(120.0, 900.0, vDist);
      col = mix(col, vec3(0.16, 0.13, 0.15), haze * 0.55 * (1.0 - smoothstep(20.0, 120.0, vY) * 0.5));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

const city = new THREE.InstancedMesh(towerGeo, towerMat, towers.length);
const m = new THREE.Matrix4();
towers.forEach((t, i) => {
  m.compose(new THREE.Vector3(t.x, -14, t.z), new THREE.Quaternion(), new THREE.Vector3(t.w, t.h + 14, t.d));
  city.setMatrixAt(i, m);
  seeds[i] = Math.random();
  sizes.set([t.w, t.h + 14, t.d], i * 3);
});
towerGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
towerGeo.setAttribute("aSize", new THREE.InstancedBufferAttribute(sizes, 3));
scene.add(city);

const boden = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 2000).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x0a0809 })
);
boden.position.set(0, -2, -1000);
scene.add(boden);

// ---------- Lichter: rote Warnlampen auf den hohen Türmen + das Licht am Himmel ----------

const dotMat = (color) =>
  new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uColor: { value: new THREE.Color(color) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      varying float vOn;
      void main() {
        vOn = smoothstep(0.55, 0.6, fract(uTime * 0.5 + aPhase)) * (1.0 - smoothstep(0.8, 0.85, fract(uTime * 0.5 + aPhase)));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vOn;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = exp(-d * d * 30.0) + exp(-d * 9.0) * 0.25;
        gl_FragColor = vec4(uColor * a * vOn, 1.0);
      }
    `,
  });

const tallOnes = towers.filter((t) => t.tall);
const warnPos = new Float32Array(tallOnes.length * 3);
const warnPhase = new Float32Array(tallOnes.length);
const warnSize = new Float32Array(tallOnes.length).fill(9);
tallOnes.forEach((t, i) => {
  warnPos.set([t.x, t.h + 0.6, t.z + t.d / 2], i * 3);
  warnPhase[i] = Math.random();
});
const warnGeo = new THREE.BufferGeometry();
warnGeo.setAttribute("position", new THREE.BufferAttribute(warnPos, 3));
warnGeo.setAttribute("aPhase", new THREE.BufferAttribute(warnPhase, 1));
warnGeo.setAttribute("aSize", new THREE.BufferAttribute(warnSize, 1));
scene.add(new THREE.Points(warnGeo, dotMat(0xff2a2a)));

// Das Licht am Himmel: zwei Lampen, die abwechselnd blinken, und ein ruhiges Grundlicht
const flugGeo = new THREE.BufferGeometry();
flugGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 5, 0, 0, 2.5, 0, 0]), 3));
flugGeo.setAttribute("aPhase", new THREE.BufferAttribute(new Float32Array([0, 0.25, 0.6]), 1));
flugGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([26, 26, 14]), 1));
const flug = new THREE.Points(flugGeo, dotMat(0xfff4e8));
scene.add(flug);

// ---------- Dachgeländer im Vordergrund ----------

const railMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
const rail = new THREE.Group();
const top = new THREE.Mesh(new THREE.BoxGeometry(30, 0.05, 0.05), railMat);
top.position.y = 1.05;
rail.add(top);
const mid = top.clone();
mid.position.y = 0.55;
rail.add(mid);
for (let x = -15; x <= 15; x += 1.4) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.1, 0.04), railMat);
  post.position.set(x, 0.5, 0);
  rail.add(post);
}
rail.position.set(0, 28.6, -4.5);
scene.add(rail);

// ---------- Nachbearbeitung: Verfremdungs-Linse, Korn, Vignette ----------

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const linse = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2() },
    uLens: { value: new THREE.Vector2(0.6, 0.5) },
    uRadius: { value: 0.16 },
    uBlock: { value: 22 },
    uTime: { value: 0 },
    uPulse: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform vec2 uLens;
    uniform float uRadius;
    uniform float uBlock;
    uniform float uTime;
    uniform float uPulse;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 px = vUv * uRes;
      float aspect = uRes.x / uRes.y;
      vec2 d = (vUv - uLens) * vec2(aspect, 1.0);
      float r = uRadius * (1.0 + uPulse * 0.25);
      float inside = 1.0 - smoothstep(r * 0.92, r, length(d));

      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (inside > 0.0) {
        // Mosaik, Blockgröße zittert leicht wie eine verfremdete Stimme
        float b = uBlock * (1.0 + 0.25 * sin(uTime * 7.0) * sin(uTime * 2.3));
        vec2 cell = (floor(px / b) + 0.5) * b / uRes;
        vec3 mos = texture2D(tDiffuse, cell).rgb;
        mos = floor(mos * 10.0 + hash(floor(px / b) + floor(uTime * 6.0)) * 0.6) / 10.0;
        col = mix(col, mos * 1.15, inside);
      }
      // feiner Ring um die Linse
      col += vec3(0.69, 0.27, 0.49) * (smoothstep(r - 0.004, r, length(d)) - smoothstep(r, r + 0.002, length(d))) * 0.8;

      // Korn und Vignette wie bei einer Nachtaufnahme
      col += (hash(px + fract(uTime) * 100.0) - 0.5) * 0.07;
      vec2 v = vUv - 0.5;
      col *= 1.0 - dot(v, v) * 0.9;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
composer.addPass(linse);

// ---------- Steuerung ----------

const maus = new THREE.Vector2(-1, -1);
const lensZiel = new THREE.Vector2(0.62, 0.55);
let letzteBewegung = -10;
let stimme = 1;
let pulse = 0;
let welleTon = 1;

window.addEventListener("pointermove", (e) => {
  maus.set(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
  letzteBewegung = clock.getElapsedTime();
});

window.addEventListener("pointerdown", (e) => {
  stimme = (stimme % 24) + 1;
  nr.textContent = String(stimme).padStart(2, "0");
  linse.uniforms.uBlock.value = rand(12, 38);
  linse.uniforms.uRadius.value = rand(0.12, 0.22);
  welleTon = rand(0.6, 1.8);
  pulse = 1;
  if (e.pointerType !== "mouse") maus.set(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  const pr = renderer.getPixelRatio();
  uniforms.uRes.value.set(w * pr, h * pr);
  linse.uniforms.uRes.value.set(w * pr, h * pr);
}
window.addEventListener("resize", resize);
resize();

// Stimme als Linie: Sprachhüllkurve, abgeschnitten und gepitcht
function zeichneWelle(t) {
  const N = 120;
  let d = "";
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * 600;
    const env = Math.max(0, Math.sin(t * 1.7 + i * 0.05) * Math.sin(t * 0.9 + i * 0.021)) ** 2;
    const y = 20 + Math.sin(i * 0.9 * welleTon + t * 18) * Math.sin(i * 0.23 + t * 3) * 17 * env;
    const q = Math.round(y / 3) * 3; // grob gerastert, wie digital verzerrt
    d += (i ? "L" : "M") + x.toFixed(1) + " " + q.toFixed(1);
  }
  wellePfad.setAttribute("d", d);
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  uniforms.uTime.value = t;
  linse.uniforms.uTime.value = t;

  // Ohne Maus wandert die Linse langsam über die Stadt
  const frei = t - letzteBewegung > 4;
  if (frei) lensZiel.set(0.55 + Math.sin(t * 0.21) * 0.28, 0.42 + Math.sin(t * 0.33) * 0.14);
  else lensZiel.copy(maus);
  linse.uniforms.uLens.value.lerp(lensZiel, frei ? 0.02 : 0.12);

  pulse *= 0.92;
  linse.uniforms.uPulse.value = pulse;

  // das Licht zieht langsam über den Himmel
  const k = (0.62 + t * 0.008) % 1;
  flug.position.set(THREE.MathUtils.lerp(-600, 600, k), 270 + Math.sin(t * 0.2) * 8, -750);

  camera.position.x = Math.sin(t * 0.05) * 0.6;
  camera.lookAt(ziel);

  zeichneWelle(t);
  composer.render();
}
animate();
