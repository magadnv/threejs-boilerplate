import * as THREE from "three";

// 12.350 Drachen – Weltrekord der Kinder von Gaza, Al-Waha Beach, 28.07.2011.
// Ein Drache ist rot: der von Refaat Alareer („If I Must Die“).
const COUNT = 12350;

const canvas = document.querySelector("#scene");
const zahl = document.querySelector("#zahl");
const zeilen = [...document.querySelectorAll("#gedicht p, #gedicht cite")];

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 1.6, 16);
const ziel = new THREE.Vector3(0, 13, -30);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const uniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2() },
  uSunDir: { value: new THREE.Vector3(-0.25, 0.04, -1).normalize() },
};

// ---------- Himmel (wird auch fürs Meer gespiegelt) ----------

const skyGLSL = /* glsl */ `
  uniform vec3 uSunDir;
  const vec3 TOP = vec3(0.07, 0.09, 0.15);
  const vec3 MID = vec3(0.38, 0.36, 0.48);
  const vec3 HOR = vec3(0.98, 0.79, 0.64);
  vec3 sky(vec3 d) {
    float h = max(d.y, 0.0);
    vec3 c = mix(HOR, MID, smoothstep(0.0, 0.2, h));
    c = mix(c, TOP, smoothstep(0.16, 0.7, h));
    float s = max(dot(d, uSunDir), 0.0);
    c += vec3(1.0, 0.62, 0.42) * pow(s, 6.0) * 0.5;
    c += vec3(1.0, 0.93, 0.85) * pow(s, 900.0) * 3.0;
    return c;
  }
`;

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 48, 24),
  new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGLSL}
      varying vec3 vDir;
      void main() { gl_FragColor = vec4(sky(normalize(vDir)), 1.0); }
    `,
  })
);
sky.renderOrder = -1;
scene.add(sky);

// ---------- Meer und Strand ----------

const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000, 1, 1).rotateX(-Math.PI / 2),
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGLSL}
      uniform float uTime;
      varying vec3 vWorld;
      void main() {
        vec2 q = vWorld.xz;
        float dist = distance(vWorld, cameraPosition);
        float amp = 0.09 / (1.0 + dist * 0.015);
        vec2 g = vec2(
          cos(q.x * 0.21 + uTime * 0.7) + 0.6 * cos((q.x + q.y) * 0.53 + uTime * 1.4),
          cos(q.y * 0.33 - uTime * 0.9) + 0.6 * cos((q.x + q.y) * 0.53 + uTime * 1.4) + 0.4 * cos(q.y * 1.1 - uTime * 2.0)
        ) * amp;
        vec3 N = normalize(vec3(g.x, 1.0, g.y));
        vec3 V = normalize(vWorld - cameraPosition);
        vec3 R = reflect(V, N);
        R.y = abs(R.y);
        float fres = 0.25 + 0.75 * pow(1.0 - max(dot(-V, N), 0.0), 4.0);
        vec3 col = mix(vec3(0.05, 0.07, 0.11), sky(R), fres);

        // Strand: alles Richtung Kamera ab der Wasserlinie
        float shore = 3.0 + sin(q.x * 0.25 + uTime * 0.8) * 0.45 + sin(q.x * 0.07 - uTime * 0.3) * 0.6;
        vec3 sand = vec3(0.30, 0.25, 0.23) + sky(vec3(0.0, 0.3, -1.0)) * 0.06;
        float wet = smoothstep(shore, shore + 2.5, q.y);
        col = mix(col, mix(sand * 0.7, sand, wet), step(shore, q.y));
        col += vec3(1.0, 0.95, 0.9) * 0.35 * (1.0 - smoothstep(0.0, 0.35, abs(q.y - shore)));

        col = mix(col, HOR * 0.92, smoothstep(120.0, 900.0, dist));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
scene.add(sea);

// ---------- Drachen-Daten ----------

const rand = (a, b) => a + Math.random() * (b - a);
const offsets = new Float32Array(COUNT * 3);
const params = new Float32Array(COUNT * 4); // phase, delay, scale, rot
const delays = [];

for (let i = 0; i < COUNT; i++) {
  const depth = Math.pow(Math.random(), 0.7);
  const z = -10 - depth * 380;
  const spread = 22 + depth * 300;
  let x = rand(-spread, spread);
  // Höhe über den Blickwinkel verteilen, damit der ganze Himmel voll wird
  const elev = 0.06 + Math.pow(Math.random(), 1.6) * 0.95;
  let y = 4 + Math.tan(elev) * (16 - z) * 0.85;
  let delay = 0.3 + Math.pow(Math.random(), 0.8) * 3.0;
  let scale = rand(0.55, 0.95);
  let red = 0;

  if (i === 0) {
    x = 3.2; y = 10; delay = 0.15; scale = 1.4; red = 1;
    offsets.set([x, y, -13], 0);
  } else {
    offsets.set([x, y, z], i * 3);
  }
  params.set([Math.random() * Math.PI * 2, delay, scale, red], i * 4);
  delays.push(delay);
}
delays.sort((a, b) => a - b);

const kiteCommon = /* glsl */ `
  uniform float uTime;
  uniform vec2 uWind;
  vec3 anchorPos(vec3 o, float ph) {
    return vec3(o.x * 0.3, 0.0, 4.0 + fract(ph * 3.17) * 8.0);
  }
  vec3 kitePos(vec3 o, float ph, float delay, out float rise) {
    float k = clamp((uTime - delay) / 2.4, 0.0, 1.0);
    rise = k * k * (3.0 - 2.0 * k);
    vec3 p = o;
    p.x += sin(uTime * 0.35 + ph) * 0.9 + uWind.x * o.y * 0.12;
    p.y += sin(uTime * 0.6 + ph * 1.7) * 0.45 + uWind.y * 0.8;
    p.z += cos(uTime * 0.3 + ph) * 0.6;
    vec3 a = anchorPos(o, ph) + vec3(0.0, 0.8, 0.0);
    return mix(a, p, rise);
  }
`;

// ---------- Drachen: Raute mit Knick + flatternder Schwanz ----------

function kiteGeometry() {
  const pos = [];
  const shade = [];
  const tail = []; // 0 = Segel, >0 = Position entlang des Schwanzes

  const top = [0, 0.62, 0];
  const left = [-0.42, 0.12, -0.1];
  const right = [0.42, 0.12, -0.1];
  const bottom = [0, -0.62, 0];
  pos.push(...top, ...left, ...bottom, ...top, ...bottom, ...right);
  shade.push(1, 1, 1, 0.8, 0.8, 0.8);
  tail.push(0, 0, 0, 0, 0, 0);

  const SEG = 10, LEN = 1.9, W = 0.035;
  for (let s = 0; s < SEG; s++) {
    const t0 = s / SEG, t1 = (s + 1) / SEG;
    const y0 = -0.62 - t0 * LEN, y1 = -0.62 - t1 * LEN;
    const w0 = W * (1 - t0 * 0.6), w1 = W * (1 - t1 * 0.6);
    pos.push(-w0, y0, 0, w0, y0, 0, -w1, y1, 0, w0, y0, 0, w1, y1, 0, -w1, y1, 0);
    shade.push(0.9, 0.9, 0.9, 0.9, 0.9, 0.9);
    tail.push(t0 + 1e-3, t0 + 1e-3, t1, t0 + 1e-3, t1, t1);
  }

  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aShade", new THREE.Float32BufferAttribute(shade, 1));
  g.setAttribute("aTail", new THREE.Float32BufferAttribute(tail, 1));
  g.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 3));
  g.setAttribute("aParams", new THREE.InstancedBufferAttribute(params, 4));
  g.instanceCount = COUNT;
  return g;
}

const kites = new THREE.Mesh(
  kiteGeometry(),
  new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${kiteCommon}
      attribute float aShade;
      attribute float aTail;
      attribute vec3 aOffset;
      attribute vec4 aParams;
      varying float vShade;
      varying float vRed;
      varying float vFog;
      varying float vRise;
      void main() {
        float ph = aParams.x;
        vec3 p = position;

        // Schwanz flattert, stärker zum Ende hin
        float t = aTail;
        p.x += sin(t * 6.0 - uTime * 5.0 + ph) * 0.22 * t - uWind.x * 0.5 * t * t;
        p.z += cos(t * 5.0 - uTime * 4.0 + ph) * 0.12 * t;

        p *= aParams.z * (1.0 + aParams.w * 0.4);

        float roll = sin(uTime * 0.7 + ph) * 0.22 - uWind.x * 0.35;
        float pitch = 0.45 + sin(uTime * 0.9 + ph * 2.0) * 0.08;
        mat3 rz = mat3(cos(roll), sin(roll), 0.0, -sin(roll), cos(roll), 0.0, 0.0, 0.0, 1.0);
        mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(pitch), sin(pitch), 0.0, -sin(pitch), cos(pitch));
        p = rz * rx * p;

        float rise;
        vec3 world = kitePos(aOffset, ph, aParams.y, rise) + p * mix(0.3, 1.0, rise);
        vec4 mv = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mv;

        vShade = aShade * mix(0.85, 1.0, smoothstep(5.0, 40.0, world.y));
        vRed = aParams.w;
        vFog = 1.0 - exp(-length(mv.xyz) * 0.005);
        vRise = rise;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vShade;
      varying float vRed;
      varying float vFog;
      varying float vRise;
      void main() {
        vec3 col = mix(vec3(0.97, 0.95, 0.92), vec3(0.81, 0.094, 0.188), vRed) * vShade;
        col = mix(col, vec3(0.86, 0.72, 0.66), vFog * (1.0 - vRed * 0.7));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
kites.frustumCulled = false;
scene.add(kites);

// ---------- Schnüre: von jedem Drachen zurück an den Strand ----------

const lineOffsets = new Float32Array(COUNT * 6);
const lineParams = new Float32Array(COUNT * 8);
const lineEnd = new Float32Array(COUNT * 2);
for (let i = 0; i < COUNT; i++) {
  const o = offsets.subarray(i * 3, i * 3 + 3);
  const pr = params.subarray(i * 4, i * 4 + 4);
  lineOffsets.set(o, i * 6); lineOffsets.set(o, i * 6 + 3);
  lineParams.set(pr, i * 8); lineParams.set(pr, i * 8 + 4);
  lineEnd[i * 2] = 0; lineEnd[i * 2 + 1] = 1;
}
const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 6), 3));
lineGeo.setAttribute("aOffset", new THREE.BufferAttribute(lineOffsets, 3));
lineGeo.setAttribute("aParams", new THREE.BufferAttribute(lineParams, 4));
lineGeo.setAttribute("aEnd", new THREE.BufferAttribute(lineEnd, 1));

const strings = new THREE.LineSegments(
  lineGeo,
  new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      ${kiteCommon}
      attribute vec3 aOffset;
      attribute vec4 aParams;
      attribute float aEnd;
      varying float vAlpha;
      varying float vRed;
      void main() {
        float rise;
        vec3 kite = kitePos(aOffset, aParams.x, aParams.y, rise);
        vec3 world = mix(kite, anchorPos(aOffset, aParams.x), aEnd);
        vec4 mv = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mv;
        float far = exp(-length(mv.xyz) * 0.012);
        vAlpha = (1.0 - aEnd) * 0.5 * far * rise + aParams.w * (1.0 - aEnd * 0.6) * 0.6;
        vRed = aParams.w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vRed;
      void main() {
        vec3 col = mix(vec3(1.0, 0.96, 0.92), vec3(0.81, 0.094, 0.188), vRed);
        gl_FragColor = vec4(col, vAlpha);
      }
    `,
  })
);
strings.frustumCulled = false;
scene.add(strings);

// ---------- Wind über die Maus ----------

const mouse = new THREE.Vector2();
const onMove = (x, y) => {
  mouse.set((x / window.innerWidth) * 2 - 1, -((y / window.innerHeight) * 2 - 1));
};
window.addEventListener("pointermove", (e) => onMove(e.clientX, e.clientY));
window.addEventListener("touchmove", (e) => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Ablauf ----------

const fmt = new Intl.NumberFormat("de-DE");
const zeilenZeit = [4.2, 5.6, 7.0, 8.4];
let aufgestiegen = 0;
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  uniforms.uTime.value = t;

  // Ohne Maus weht eine leichte Böe, damit sich sofort etwas bewegt
  const gust = new THREE.Vector2(Math.sin(t * 0.23) * 0.4, Math.sin(t * 0.17) * 0.2);
  uniforms.uWind.value.lerp(mouse.lengthSq() > 0 ? mouse : gust, 0.03);

  // Zähler: ein Drache zählt, sobald er fast oben ist
  while (aufgestiegen < COUNT && delays[aufgestiegen] + 2.0 < t) aufgestiegen++;
  zahl.textContent = fmt.format(aufgestiegen);

  zeilen.forEach((el, i) => el.classList.toggle("an", t > zeilenZeit[i]));

  camera.position.x += (uniforms.uWind.value.x * 1.4 - camera.position.x) * 0.03;
  camera.position.y = 1.6 + Math.sin(t * 0.4) * 0.08;
  camera.lookAt(ziel.x + uniforms.uWind.value.x * 2, ziel.y + uniforms.uWind.value.y * 1.5, ziel.z);
  sky.position.copy(camera.position);

  renderer.render(scene, camera);
}
animate();
