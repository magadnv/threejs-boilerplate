// THE TAP — ein Moment im Brazilian Jiu-Jitsu: das Abklopfen.
// Keine Niederlage, sondern der Augenblick, in dem man lernt.
//
// Aufbau:
//   1. Partikelmatte (THREE.Points + eigenes ShaderMaterial): atmet, trägt Schockwellen,
//      kann sich zu einem Gürtel umformen (Morph auf zweite Position im Attribut aBelt).
//   2. Hand (Low-Poly, extrudierte Silhouette) schlägt auf, GSAP steuert den Fall.
//   3. Aufprall als Tap-Tap-Tap: Matte saugt sich zur Hand, Handabdruck glüht nach,
//      Partikel spritzen hoch, Wellen überlagern sich, Shake, Zoom-Ruck, 0,2 s Slow-Motion,
//      Luftzug und Mattensound (Web Audio).
//   4. Wörter per SplitText: Tap. → Learn. → Repeat. → Ego: 0, danach der Gürtel.
//   5. Taste R: Record-Modus, 12 s automatisch im Hochformat 1080×1350.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText.js";

gsap.registerPlugin(SplitText);

// ---------------------------------------------------------------------------
// Grundwerte
// ---------------------------------------------------------------------------

const IS_TOUCH = matchMedia("(pointer: coarse)").matches;
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

const GRID = IS_TOUCH ? 170 : 200; // 28.900 bzw. 40.000 Partikel
const MAT = 9; // Kantenlänge der Matte in Welteinheiten
const PANEL = 1.5; // Puzzlematten-Raster für die feinen Fugen
const BELT_Y = 1.5; // Höhe, auf der der Gürtel schwebt
const FOV = 35;
const WORDS = ["Tap.", "Learn.", "Repeat.", "Ego: 0"];

const COLORS = {
  mat: new THREE.Color("#edebe6"),
  accent: new THREE.Color("#6b2fbf"),
  // Gürtelfolge laut Briefing; der schwarze Gürtel bekommt den roten Balken wie im echten Graduierungssystem
  belts: ["#f2f0eb", "#1f4fd1", "#6b2fbf", "#6b3f22", "#141414"].map((c) => new THREE.Color(c)),
  bars: ["#0d0d0d", "#0d0d0d", "#0d0d0d", "#0d0d0d", "#cf1830"].map((c) => new THREE.Color(c)),
};

// Laufzeit-Zustand, den GSAP tweenen kann
const state = {
  speed: 1, // Simulationstempo (Slow-Motion beim Aufprall)
  shake: 0, // Kamera-Shake-Stärke
  camMix: 0, // 0 = Blick auf die Matte, 1 = frontal auf den Gürtel
  kick: 0, // kurzer Zoom-Ruck beim Aufprall
};

let simTime = 0;
let step = 0; // wie viele Taps in dieser Runde
let busy = false; // während der Gürtel-Sequenz keine Taps
let recording = false;
let stageScale = 1;

// ---------------------------------------------------------------------------
// Renderer, Szene, Kamera
// ---------------------------------------------------------------------------

const stage = document.querySelector("#stage");
const canvas = document.querySelector("#scene");
const wordEl = document.querySelector("#word");
const taglineEl = document.querySelector("#tagline");
const creditEl = document.querySelector("#credit");
const muteBtn = document.querySelector("#mute");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setClearColor(0x0a0a0a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);

scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1a1a, 1.4));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(-2, 6, 4);
scene.add(keyLight);

// Zwei Kamera-Posen, abhängig vom Seitenverhältnis (Hochformat braucht mehr Abstand)
const poses = {
  mat: { pos: new THREE.Vector3(), target: new THREE.Vector3() },
  belt: { pos: new THREE.Vector3(), target: new THREE.Vector3() },
};

function computePoses(aspect) {
  const portrait = aspect < 1 ? 1 + (1 - aspect) * 0.55 : 1;
  poses.mat.pos.set(0, 6.4 * portrait, 7.2 * portrait);
  poses.mat.target.set(0, 0.4, -1.2);

  // Gürtel (≈ 3,4 breit) soll mit Rand ins Bild passen
  const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const dist = Math.max(6.2, 4.5 / (2 * halfTan * aspect));
  poses.belt.target.set(0, BELT_Y - 0.5, 0);
  poses.belt.pos.set(0, BELT_Y - 0.1, dist);
}

// ---------------------------------------------------------------------------
// Gürtel-Form: Band, Knoten, zwei Enden; Balken am rechten Ende
// ---------------------------------------------------------------------------

// Jedes Teil ist ein (gedrehtes) Rechteck. u = quer, v = längs.
const BELT_PARTS = [
  { kind: "band", x: 0, y: 0, w: 3.4, h: 0.32, rot: 0, z: 0 },
  { kind: "knot", x: 0, y: -0.02, w: 0.46, h: 0.44, rot: 0, z: 0.07 },
  { kind: "tail", x: -0.1, y: -0.18, w: 0.3, h: 1.15, rot: 0.34, z: 0.04 },
  { kind: "tail", x: 0.1, y: -0.18, w: 0.3, h: 1.15, rot: -0.4, z: 0.04, bar: [0.58, 0.84] },
];
BELT_PARTS.forEach((p) => (p.area = p.w * p.h));
const BELT_AREA = BELT_PARTS.reduce((sum, p) => sum + p.area, 0);

function sampleBelt(out) {
  // Teil nach Fläche wählen, damit die Dichte überall gleich ist
  let r = Math.random() * BELT_AREA;
  let part = BELT_PARTS[0];
  for (const p of BELT_PARTS) {
    if ((r -= p.area) <= 0) { part = p; break; }
  }

  const u = (Math.random() - 0.5) * part.w;
  let lx, ly, distToEdge, bar = 0, stitch = 0;

  if (part.kind === "tail") {
    // Enden hängen vom Knoten aus nach unten
    const v = Math.random() * part.h;
    lx = u;
    ly = -v;
    distToEdge = Math.min(part.w / 2 - Math.abs(u), v, part.h - v);
    const t = v / part.h;
    if (part.bar && t > part.bar[0] && t < part.bar[1]) bar = 1;
    // Steppnähte längs des Gürtels
    stitch = Math.abs(((u / part.w + 0.5) * 5) % 1 - 0.5) < 0.06 ? 1 : 0;
  } else {
    const v = (Math.random() - 0.5) * part.h;
    lx = u;
    ly = v;
    distToEdge = Math.min(part.w / 2 - Math.abs(u), part.h / 2 - Math.abs(v));
    if (part.kind === "band") stitch = Math.abs(((v / part.h + 0.5) * 5) % 1 - 0.5) < 0.06 ? 1 : 0;
  }

  const c = Math.cos(part.rot);
  const s = Math.sin(part.rot);
  out.x = part.x + lx * c - ly * s;
  out.y = BELT_Y + part.y + lx * s + ly * c;
  out.z = part.z + (Math.random() - 0.5) * 0.04;

  const outline = distToEdge < 0.018 ? 1 : 0;
  out.edge = Math.max(outline, stitch * 0.6);
  out.bar = bar;
}

// ---------------------------------------------------------------------------
// Partikelmatte
// ---------------------------------------------------------------------------

function buildParticles() {
  const count = GRID * GRID;
  const position = new Float32Array(count * 3);
  const belt = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  const bar = new Float32Array(count);
  const edge = new Float32Array(count);
  const seam = new Float32Array(count);

  const cell = MAT / GRID;
  const sample = {};
  let i = 0;

  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++, i++) {
      // Raster mit leichtem Versatz, damit es nach Material und nicht nach Pixel aussieht
      const x = -MAT / 2 + (gx + 0.5) * cell + (Math.random() - 0.5) * cell * 0.6;
      const z = -MAT / 2 + (gz + 0.5) * cell + (Math.random() - 0.5) * cell * 0.6;
      position.set([x, 0, z], i * 3);

      // Fugen zwischen den Mattenteilen
      const du = Math.abs((((x + MAT / 2) / PANEL) % 1) - 0.5);
      const dv = Math.abs((((z + MAT / 2) / PANEL) % 1) - 0.5);
      seam[i] = Math.max(du, dv) > 0.485 ? 1 : 0;

      sampleBelt(sample);
      belt.set([sample.x, sample.y, sample.z], i * 3);
      bar[i] = sample.bar;
      edge[i] = sample.edge;
      rand[i] = Math.random();
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("aBelt", new THREE.BufferAttribute(belt, 3));
  geometry.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
  geometry.setAttribute("aBar", new THREE.BufferAttribute(bar, 1));
  geometry.setAttribute("aEdge", new THREE.BufferAttribute(edge, 1));
  geometry.setAttribute("aSeam", new THREE.BufferAttribute(seam, 1));
  // Gürtel liegt außerhalb der Mattenbox, daher die Bounding Sphere großzügig setzen
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 10);

  return geometry;
}

const uniforms = {
  uTime: { value: 0 },
  uMorph: { value: 0 },
  uSize: { value: IS_TOUCH ? 0.03 : 0.026 },
  uScale: { value: 1 },
  uHalf: { value: MAT / 2 },
  // bis zu vier Wellen gleichzeitig: x, z, Startzeit, Stärke
  uWaves: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, -100, 0)) },
  // Handschatten: x, z, Nähe (0…1), sichtbar
  uHand: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSuck: { value: 0 }, // Matte hebt sich der fallenden Hand entgegen
  // Handabdruck des letzten Taps: x, z, Startzeit, Stärke + Drehung der Hand
  uImprint: { value: new THREE.Vector4(0, 0, -100, 0) },
  uImprintYaw: { value: 0 },
  uMatColor: { value: COLORS.mat.clone() },
  uAccent: { value: COLORS.accent.clone() },
  uBeltColor: { value: COLORS.belts[0].clone() },
  uBarColor: { value: COLORS.bars[0].clone() },
};

// 3D-Simplex-Noise (Ashima Arts, MIT) für das Atmen der Matte
const NOISE = /* glsl */ `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);
    const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));
    vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);
    vec3 l=1.0-g;
    vec3 i1=min(g.xyz,l.zxy);
    vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;
    vec3 x2=x0-i2+C.yyy;
    vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;
    vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z);
    vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy;
    vec4 y=y_*ns.x+ns.yyyy;
    vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);
    vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0;
    vec4 s1=floor(b1)*2.0+1.0;
    vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
    vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);
    vec3 p1=vec3(a0.zw,h.y);
    vec3 p2=vec3(a1.xy,h.z);
    vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
    m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
`;

const HAND_SCALE = 1.35;

const material = new THREE.ShaderMaterial({
  uniforms,
  defines: { HAND_SCALE: HAND_SCALE.toFixed(2) },
  transparent: true,
  depthWrite: false,
  vertexShader: /* glsl */ `
    uniform float uTime, uMorph, uSize, uScale, uHalf;
    uniform vec4 uWaves[4];
    uniform vec4 uHand;
    uniform float uSuck;
    uniform vec4 uImprint;
    uniform float uImprintYaw;
    uniform vec3 uMatColor, uAccent, uBeltColor, uBarColor;

    attribute vec3 aBelt;
    attribute float aRand, aBar, aEdge, aSeam;

    varying vec3 vColor;
    varying float vAlpha;

    ${NOISE}

    float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
      vec2 pa = p - a, ba = b - a;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      return length(pa - ba * h) - r;
    }

    float sdRoundBox(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    // Abstandsfeld der Hand, deckungsgleich mit der Mesh-Silhouette (siehe buildHand)
    float handSDF(vec2 w) {
      vec2 d = w - uImprint.xy;
      float c = cos(uImprintYaw), s = sin(uImprintYaw);
      vec2 l = vec2(d.x * c - d.y * s, d.x * s + d.y * c) / HAND_SCALE;
      vec2 sp = vec2(l.x, 0.42 - l.y); // zurück in Shape-Koordinaten
      float h = sdRoundBox(sp - vec2(0.0, 0.36), vec2(0.36), 0.14);
      h = min(h, sdCapsule(sp, vec2(-0.26, 0.675), vec2(-0.26, 1.025), 0.075));
      h = min(h, sdCapsule(sp, vec2(-0.085, 0.695), vec2(-0.085, 1.105), 0.075));
      h = min(h, sdCapsule(sp, vec2(0.085, 0.685), vec2(0.085, 1.055), 0.075));
      h = min(h, sdCapsule(sp, vec2(0.26, 0.635), vec2(0.26, 0.885), 0.075));
      h = min(h, sdCapsule(sp, vec2(-0.357, 0.156), vec2(-0.573, 0.365), 0.08));
      return h * HAND_SCALE;
    }

    void main() {
      vec3 p = position;

      // Atmen: langsames Noise-Wabern plus ein ruhiger Gesamt-Atemzug
      float n = snoise(vec3(p.xz * 0.32, uTime * 0.11));
      float breath = sin(uTime * 0.7) * 0.5 + 0.5;
      p.y += n * 0.13 + breath * 0.05 * (1.0 - length(p.xz) / 7.0);

      // Schockwellen: Ring läuft nach außen, klingt mit Zeit und Abstand ab
      float glow = 0.0;
      for (int i = 0; i < 4; i++) {
        vec4 w = uWaves[i];
        float age = uTime - w.z;
        if (age < 0.0 || w.w <= 0.0) continue;
        vec2 dir = p.xz - w.xy;
        float d = length(dir);
        float ring = exp(-pow((d - age * 3.4) * 2.6, 2.0));
        float env = exp(-age * 1.15) * w.w / (1.0 + d * 0.35);
        p.y += ring * env * 0.85;
        p.xz += dir / max(d, 0.001) * ring * env * 0.12;
        // Delle direkt unter der Hand
        float dent = exp(-d * d * 2.2) * exp(-age * 5.0) * w.w;
        p.y -= dent * 0.45;
        glow += ring * env + dent * 0.6;
      }

      // Schatten der Hand: wird dunkler, je näher sie kommt; beim Fall saugt sie die Matte an
      float shadow = uHand.w * uHand.z * smoothstep(1.2, 0.0, distance(p.xz, uHand.xy));
      p.y += uSuck * shadow * 0.32;

      // Handabdruck: Form drückt sich ein, glüht nach; am Rand spritzen Partikel hoch
      float imprint = 0.0, rim = 0.0, air = 0.0;
      float iAge = uTime - uImprint.z;
      if (uImprint.w > 0.0 && iAge >= 0.0 && iAge < 7.0) {
        float sd = handSDF(position.xz);
        float life = exp(-iAge * 0.45) * uImprint.w;
        float inside = 1.0 - smoothstep(-0.03, 0.03, sd);
        imprint = inside * life;
        rim = exp(-pow(sd / 0.035, 2.0)) * life;
        p.y -= inside * 0.22 * exp(-iAge * 1.3);

        if (sd > 0.0 && sd < 0.5 && aRand < 0.5) {
          float k = 1.0 - sd / 0.5;
          float v = (1.6 + aRand * 6.0) * k * uImprint.w; // Startgeschwindigkeit nach oben
          float land = 2.0 * v / 9.0; // Flugzeit bei g = 9
          float t = min(iAge, land);
          vec2 away = normalize(position.xz - uImprint.xy + 1e-4);
          float back = 1.0 - smoothstep(land, land + 0.8, iAge); // nach der Landung zurückgleiten
          p.y += v * t - 4.5 * t * t;
          p.xz += away * t * (0.6 + aRand * 1.2) * back;
          air = step(iAge, land) * k;
        }
      }

      // Morph zur Gürtelform, jedes Teilchen mit eigener Verzögerung und einem Bogen in die Luft
      float m = smoothstep(0.0, 1.0, clamp(uMorph * 1.6 - aRand * 0.6, 0.0, 1.0));
      vec3 beltP = aBelt + vec3(0.0, 0.0, sin(uTime * 1.3 + aRand * 6.2831) * 0.012);
      vec3 pos = mix(p, beltP, m);
      float arc = sin(m * 3.14159);
      pos.y += arc * (0.5 + aRand * 1.4);
      pos.x += arc * (aRand - 0.5) * 1.2;

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * (1.0 + glow * 0.6 + air * 0.9 + imprint * 0.35) * mix(1.0, 1.2, m) * uScale / -mv.z;

      // Farbe Matte: Mattenweiß mit Noise-Schattierung, Fugen, Handschatten, Lila im Wellenkamm
      float shade = 0.55 + n * 0.22 + breath * 0.08;
      vec3 matCol = uMatColor * shade * (1.0 - aSeam * 0.6) * (1.0 - shadow * 0.8);
      matCol = mix(matCol, uAccent * 1.7, clamp(glow, 0.0, 1.0) * 0.85);
      matCol = mix(matCol, uAccent * 2.8 + 0.12, clamp(imprint, 0.0, 1.0));
      matCol += vec3(0.85, 0.8, 1.0) * rim * 0.9;
      matCol = mix(matCol, vec3(1.0), air * 0.8);

      // Farbe Gürtel: Grundfarbe, Balken, Kontur und Steppnaht (heben sich auf hell wie dunkel ab)
      vec3 beltCol = mix(uBeltColor, uBarColor, aBar);
      beltCol = mix(beltCol, beltCol * 0.7 + 0.2, aEdge);

      vColor = mix(matCol, beltCol, m);

      // Matte läuft zu den Rändern weich aus
      vec2 q = abs(position.xz) / uHalf;
      float fade = 1.0 - smoothstep(0.7, 1.0, max(q.x, q.y));
      vAlpha = mix(fade * min(0.85 + glow + air + rim, 1.0), 1.0, m);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      gl_FragColor = vec4(vColor, smoothstep(0.5, 0.28, d) * vAlpha);
      #include <colorspace_fragment>
    }
  `,
});

const particles = new THREE.Points(buildParticles(), material);
scene.add(particles);

// ---------------------------------------------------------------------------
// Hand: abstrahierte, flache Low-Poly-Silhouette (rechte Hand, Handrücken nach oben).
// Dunkel gehalten, damit sie vor den hellen Partikeln als Schattenriss liest.
// ---------------------------------------------------------------------------

function roundedRect(x, y, w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function buildHand() {
  // Wenige Kurvensegmente und eine einzige Fase: bewusst facettiert
  const extrude = (shape) =>
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.09,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 1,
      curveSegments: 2,
    });

  const parts = [extrude(roundedRect(-0.36, 0, 0.72, 0.72, 0.14))];

  // Zeige-, Mittel-, Ring-, kleiner Finger: [x-Mitte, Länge, Startversatz]
  [[-0.26, 0.5, 0], [-0.085, 0.56, 0.02], [0.085, 0.52, 0.01], [0.26, 0.4, -0.04]].forEach(([cx, len, dy]) => {
    parts.push(extrude(roundedRect(cx - 0.075, 0.6 + dy, 0.15, len, 0.07)));
  });

  const thumb = extrude(roundedRect(-0.08, 0, 0.16, 0.46, 0.075));
  thumb.rotateZ(0.8);
  thumb.translate(-0.3, 0.1, 0);
  parts.push(thumb);

  const geo = mergeGeometries(parts);
  geo.translate(0, -0.42, 0); // Handflächenmitte in den Ursprung
  geo.rotateX(-Math.PI / 2); // flach legen, Finger zeigen von der Kamera weg
  geo.translate(0, 0.03, 0); // Unterkante auf y = 0
  return geo;
}

const hand = new THREE.Mesh(
  buildHand(),
  new THREE.MeshStandardMaterial({
    color: "#161616",
    roughness: 0.55,
    metalness: 0,
    flatShading: true,
    transparent: true,
    opacity: 0,
  })
);
hand.scale.setScalar(HAND_SCALE);
hand.renderOrder = 1;
hand.visible = false;
scene.add(hand);

// ---------------------------------------------------------------------------
// Sound: dumpfer Schlag auf die Matte, komplett synthetisiert
// ---------------------------------------------------------------------------

const audio = { ctx: null, master: null, noise: null, muted: false };

function ensureAudio() {
  if (!audio.ctx) {
    const ctx = new AudioContext();
    audio.ctx = ctx;
    audio.master = ctx.createGain();
    audio.master.gain.value = audio.muted ? 0 : 0.9;
    audio.master.connect(ctx.destination);

    // Rauschpuffer einmalig anlegen
    const len = Math.floor(ctx.sampleRate * 0.3);
    audio.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = audio.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (audio.ctx.state === "suspended") audio.ctx.resume();
}

function playThud(strength = 1) {
  const { ctx, master } = audio;
  if (!ctx || audio.muted) return;
  const t = ctx.currentTime;

  // Körper: tiefer Sinus mit Pitch-Abfall, das „Gewicht“
  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(115, t);
  body.frequency.exponentialRampToValueAtTime(40, t + 0.2);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, t);
  bodyGain.gain.exponentialRampToValueAtTime(0.95 * strength, t + 0.006);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  body.connect(bodyGain).connect(master);
  body.start(t);
  body.stop(t + 0.55);

  // Klatschen: gefiltertes Rauschen, satt statt spitz
  const slap = ctx.createBufferSource();
  slap.buffer = audio.noise;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(1100, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + 0.16);
  const slapGain = ctx.createGain();
  slapGain.gain.setValueAtTime(0.0001, t);
  slapGain.gain.exponentialRampToValueAtTime(0.7 * strength, t + 0.004);
  slapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  slap.connect(lp).connect(slapGain).connect(master);
  slap.start(t);
  slap.stop(t + 0.25);
}

// Luftzug beim Fall: Rauschen, dessen Bandpass nach oben zieht
function playWhoosh(duration) {
  const { ctx, master } = audio;
  if (!ctx || audio.muted) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noise;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(260, t);
  bp.frequency.exponentialRampToValueAtTime(1400, t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + duration * 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.02);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  src.stop(t + duration + 0.05);
}

function setMuted(muted) {
  audio.muted = muted;
  if (audio.master) audio.master.gain.setTargetAtTime(muted ? 0 : 0.9, audio.ctx.currentTime, 0.02);
  muteBtn.textContent = muted ? "Sound off" : "Sound on";
  muteBtn.setAttribute("aria-pressed", String(muted));
}

// ---------------------------------------------------------------------------
// Text: ein Wort, per SplitText ein- und ausgeblendet
// ---------------------------------------------------------------------------

let split = null;
let currentWord = "";
let wordToken = 0; // verhindert, dass ein alter Ausblend-Tween später noch ein Wort einblendet

// „Aufleuchten“: kurz Lila mit Glow, dann zurück zu Mattenweiß
function glow(chars) {
  gsap.fromTo(
    chars,
    { color: "#b48cff", textShadow: "0 0 0.35em rgba(107, 47, 191, 1)" },
    { color: "#edebe6", textShadow: "0 0 0em rgba(107, 47, 191, 0)", duration: 1.4, ease: "power2.out", stagger: 0.03 }
  );
}

function setWord(text, { flash = true } = {}) {
  const token = ++wordToken;
  if (text === currentWord && split) {
    // Gleiches Wort: nur ein schwerer Stoß nach unten und Aufleuchten
    gsap.fromTo(split.chars, { yPercent: 16 }, { yPercent: 0, duration: 0.8, ease: "power4.out", stagger: 0.02 });
    if (flash) glow(split.chars);
    return;
  }

  const show = () => {
    split?.revert();
    wordEl.textContent = text;
    currentWord = text;
    split = SplitText.create(wordEl, { type: "lines,chars", mask: "lines" });
    gsap.set(wordEl, { autoAlpha: 1 });
    gsap.from(split.chars, { yPercent: 110, duration: 0.85, ease: "power4.out", stagger: 0.035 });
    if (flash) glow(split.chars);
  };

  if (split && currentWord) {
    gsap.to(split.chars, {
      yPercent: -110,
      duration: 0.26,
      ease: "power3.in",
      stagger: 0.012,
      onComplete: () => token === wordToken && show(),
    });
  } else {
    show();
  }
}

function hideWord() {
  if (!split || !currentWord) return;
  currentWord = "";
  gsap.to(split.chars, { yPercent: -110, duration: 0.5, ease: "power4.in", stagger: 0.02 });
}

// ---------------------------------------------------------------------------
// Der Tap: Hand fällt, Aufprall, Welle, Shake, Slow-Motion, Sound
// ---------------------------------------------------------------------------

let waveSlot = 0;
let handTl = null;

function addWave(x, z, strength) {
  uniforms.uWaves.value[waveSlot].set(x, z, simTime, strength);
  waveSlot = (waveSlot + 1) % 4;
}

// Erster Schlag: volle Wucht. Nachschläge: nur Welle, Ton und ein kleiner Ruck.
function impact(x, z, strength, primary) {
  addWave(x, z, strength);
  playThud(strength);

  if (primary) {
    uniforms.uImprint.value.set(x, z, simTime, 1);
    uniforms.uImprintYaw.value = hand.rotation.y;

    // Slow-Motion nur für die Simulation (Shader), nicht für die GSAP-Zeitleiste,
    // damit der Record-Modus auf die Sekunde genau bleibt
    gsap.killTweensOf(state, "speed");
    gsap.timeline()
      .set(state, { speed: 0.12 })
      .to(state, { speed: 1, duration: 0.3, ease: "power2.inOut" }, 0.2);
  }

  if (!REDUCED_MOTION) {
    gsap.killTweensOf(state, "shake,kick");
    gsap.fromTo(state, { shake: strength }, { shake: 0, duration: 0.6, ease: "power4.out" });
    gsap.fromTo(state, { kick: strength }, { kick: 0, duration: 0.7, ease: "power4.out" });
  }
}

// Ein echter Tap ist nie einer: ein schwerer Schlag, dann zwei schnelle, leichtere hinterher
const TAPS = [
  { at: 0.22, strength: 1 },
  { at: 0.46, strength: 0.5 },
  { at: 0.66, strength: 0.32 },
];

function slam(x, z, onImpact) {
  handTl?.kill();
  const mat = hand.material;
  const yaw = (Math.random() - 0.5) * 0.7;
  const fall = TAPS[0].at;

  hand.visible = true;
  hand.position.set(x + 0.3, 3.4, z + 1.3);
  hand.rotation.set(0.55, yaw, -0.18);
  hand.scale.setScalar(HAND_SCALE);
  playWhoosh(fall);

  handTl = gsap.timeline({ onComplete: () => (hand.visible = false) })
    .to(mat, { opacity: 1, duration: 0.1, ease: "none" }, 0)
    // Schwerer Fall: beschleunigt bis zum letzten Moment, die Matte hebt sich ihm entgegen
    .to(hand.position, { x, y: 0.02, z, duration: fall, ease: "power4.in" }, 0)
    .to(hand.rotation, { x: 0, z: 0, duration: fall, ease: "power3.in" }, 0)
    .fromTo(uniforms.uSuck, { value: 0 }, { value: 1, duration: fall, ease: "power2.in" }, 0)
    .set(uniforms.uSuck, { value: 0 }, fall);

  TAPS.forEach(({ at, strength }, i) => {
    handTl.call(() => {
      impact(x, z, strength, i === 0);
      if (i === 0) onImpact?.();
    }, null, at);
    // Hand federt bei jedem Schlag kurz ein
    handTl
      .to(hand.scale, { y: HAND_SCALE * (1 - 0.3 * strength), duration: 0.04, ease: "power2.out" }, at)
      .to(hand.scale, { y: HAND_SCALE, duration: 0.12, ease: "power3.out" }, at + 0.04);
    const next = TAPS[i + 1];
    if (next) {
      // kurz anheben und wieder runter, immer weniger hoch
      const gap = next.at - at;
      handTl
        .to(hand.position, { y: 0.32 * next.strength + 0.1, duration: gap * 0.55, ease: "power2.out" }, at + 0.03)
        .to(hand.position, { y: 0.02, duration: gap * 0.42, ease: "power4.in" }, at + 0.03 + gap * 0.55);
    }
  });

  const last = TAPS[TAPS.length - 1].at;
  handTl
    .to(hand.position, { y: 1.1, z: z + 0.5, duration: 0.8, ease: "power4.out" }, last + 0.12)
    .to(mat, { opacity: 0, duration: 0.5, ease: "power2.out" }, last + 0.16);
}

// ---------------------------------------------------------------------------
// Gürtel-Sequenz nach dem vierten Tap (feste Länge: 6,2 s)
// ---------------------------------------------------------------------------

let beltTl = null;

function beltSequence({ loop = true } = {}) {
  busy = true;
  const belt = uniforms.uBeltColor.value;
  const bar = uniforms.uBarColor.value;
  belt.copy(COLORS.belts[0]);
  bar.copy(COLORS.bars[0]);

  beltTl?.kill();
  beltTl = gsap.timeline();

  // „Ego: 0“ steht kurz, dann heben die Partikel ab
  beltTl
    .call(hideWord, null, 0.8)
    .to(uniforms.uMorph, { value: 1, duration: 1.3, ease: "expo.inOut" }, 0.8)
    .to(state, { camMix: 1, duration: 1.4, ease: "expo.inOut" }, 0.7)
    .fromTo(taglineEl, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: "power4.out" }, 1.8);

  // Weiß → Blau → Lila → Braun → Schwarz
  let t = 2.4;
  for (let i = 1; i < COLORS.belts.length; i++) {
    const c = COLORS.belts[i];
    const b = COLORS.bars[i];
    beltTl
      .to(belt, { r: c.r, g: c.g, b: c.b, duration: 0.35, ease: "expo.inOut" }, t)
      .to(bar, { r: b.r, g: b.g, b: b.b, duration: 0.35, ease: "expo.inOut" }, t);
    t += 0.55;
  }

  // Zerfall zurück zur Matte, mit einer leisen Welle beim Landen
  beltTl
    .to(taglineEl, { autoAlpha: 0, y: -16, duration: 0.6, ease: "power3.in" }, 5.0)
    .to(uniforms.uMorph, { value: 0, duration: 1.2, ease: "expo.inOut" }, 5.0)
    .to(state, { camMix: 0, duration: 1.3, ease: "expo.inOut" }, 5.0)
    .call(() => addWave(0, 0, 0.45), null, 5.9)
    .call(() => {
      step = 0;
      if (loop) {
        busy = false;
        setWord("Tap.", { flash: false });
        scheduleIdle();
      }
    }, null, 6.2);

  return beltTl;
}

// ---------------------------------------------------------------------------
// Eingabe
// ---------------------------------------------------------------------------

function doTap(x, z, { loop = true } = {}) {
  const word = WORDS[step];
  step++;
  const last = step === WORDS.length;
  if (last) busy = true;

  slam(x, z, () => {
    setWord(word);
    if (last) beltSequence({ loop });
  });
}

const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();

function pointerToMat(e) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(ground, hit)) hit.set(0, 0, 0);
  // auf den sichtbaren Teil der Matte begrenzen
  return [THREE.MathUtils.clamp(hit.x, -3.2, 3.2), THREE.MathUtils.clamp(hit.z, -3, 2.6)];
}

stage.addEventListener("pointerdown", (e) => {
  ensureAudio();
  if (busy || recording) return;
  const [x, z] = pointerToMat(e);
  doTap(x, z);
  scheduleIdle();
});

// Ohne Eingabe tippt die Matte nach ein paar Sekunden selbst, damit der Effekt sofort sichtbar ist
let idleCall = null;
function scheduleIdle() {
  idleCall?.kill();
  idleCall = gsap.delayedCall(3.2, () => {
    if (busy || recording) return;
    doTap((Math.random() - 0.5) * 3.6, (Math.random() - 0.5) * 2.6);
    scheduleIdle();
  });
}

muteBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  ensureAudio();
  setMuted(!audio.muted);
});

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (key === "r") recording ? stopRecord() : startRecord();
  else if (key === "escape" && recording) stopRecord();
  else if (key === "m") { ensureAudio(); setMuted(!audio.muted); }
});

// ---------------------------------------------------------------------------
// Record-Modus: 12 s, 1080×1350, letzter Frame mit madebymaga.de
// ---------------------------------------------------------------------------

let recTl = null;

function resetScene() {
  [recTl, beltTl, handTl, idleCall].forEach((t) => t?.kill());
  gsap.killTweensOf([state, uniforms.uMorph, taglineEl, creditEl]);
  uniforms.uMorph.value = 0;
  uniforms.uWaves.value.forEach((w) => w.set(0, 0, -100, 0));
  uniforms.uBeltColor.value.copy(COLORS.belts[0]);
  uniforms.uBarColor.value.copy(COLORS.bars[0]);
  Object.assign(state, { speed: 1, shake: 0, camMix: 0, kick: 0 });
  uniforms.uImprint.value.set(0, 0, -100, 0);
  uniforms.uSuck.value = 0;
  gsap.set([taglineEl, creditEl], { autoAlpha: 0, y: 0 });
  hand.visible = false;
  wordToken++;
  split?.revert();
  split = null;
  currentWord = "";
  gsap.set(wordEl, { autoAlpha: 0 });
  step = 0;
  busy = false;
}

function startRecord() {
  ensureAudio();
  recording = true;
  document.body.classList.add("record");
  resetScene();
  resize();
  busy = true;

  // feste Aufschlagpunkte, gut verteilt im Hochformat-Ausschnitt
  const points = [[-0.9, 0.5], [1.0, -0.3], [-0.4, -1.1], [0.15, 0.25]];
  const taps = [1.0, 2.2, 3.4, 4.6];

  recTl = gsap.timeline();
  recTl.call(() => setWord("Tap.", { flash: false }), null, 0.2);
  taps.forEach((t, i) => recTl.call(() => doTap(points[i][0], points[i][1], { loop: false }), null, t));
  // Gürtel endet bei 4,6 + 0,22 + 6,2 ≈ 11,02 s, Credit blendet davor weich ein
  recTl
    .fromTo(creditEl, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power4.out" }, 10.4)
    .to({}, { duration: 0 }, 12);
}

function stopRecord() {
  recording = false;
  document.body.classList.remove("record");
  stage.style.transform = "";
  resetScene();
  resize();
  setWord("Tap.", { flash: false });
  scheduleIdle();
}

// ---------------------------------------------------------------------------
// Größe, Loop
// ---------------------------------------------------------------------------

function resize() {
  let w = window.innerWidth;
  let h = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio, 2);

  if (recording) {
    // Bühne fix 1080×1350, ins Fenster skaliert; Puffer entspricht den echten Bildschirmpixeln
    stageScale = Math.min(w / 1080, h / 1350);
    stage.style.transform = `translate(-50%, -50%) scale(${stageScale})`;
    w = 1080;
    h = 1350;
    dpr = Math.min(window.devicePixelRatio * stageScale, 2);
  }

  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  computePoses(camera.aspect);

  // Punktgröße in Welteinheiten → Pixel
  uniforms.uScale.value = (h * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
}

window.addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  simTime += dt * state.speed;
  uniforms.uTime.value = simTime;

  // Handschatten aus der aktuellen Handposition
  uniforms.uHand.value.set(
    hand.position.x,
    hand.position.z,
    1 - THREE.MathUtils.clamp(hand.position.y / 3.4, 0, 1),
    hand.visible ? hand.material.opacity : 0
  );

  // Kamera zwischen Matten- und Gürtel-Pose, mit ruhigem Drift und Shake
  camPos.lerpVectors(poses.mat.pos, poses.belt.pos, state.camMix);
  camTarget.lerpVectors(poses.mat.target, poses.belt.target, state.camMix);
  camPos.x += Math.sin(t * 0.13) * 0.18;
  const s = state.shake * 0.09;
  camPos.x += (Math.sin(t * 53.1) + Math.sin(t * 31.7) * 0.5) * s;
  camPos.y += (Math.sin(t * 47.3 + 1.3) + Math.sin(t * 27.9) * 0.5) * s;
  camera.position.copy(camPos);
  camera.lookAt(camTarget);
  camera.fov = FOV - state.kick * 2.4;
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
});

// Intro: Matte atmet, dann erscheint „Tap.“
document.fonts.load("900 100px 'Inter Tight'").finally(() => {
  gsap.delayedCall(0.6, () => {
    if (!recording) setWord("Tap.", { flash: false });
  });
  scheduleIdle();
});
