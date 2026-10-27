// ============================================================
// 18 · TSL Post-Processing – eine Szene, fünf Looks
// ============================================================
// Post-Processing heißt: erst die Szene in eine Textur rendern, dann diese
// Textur Pixel für Pixel weiterverarbeiten (weichzeichnen, verfärben, …).
//
// Früher (WebGLRenderer) gab es dafür den EffectComposer: eine Liste von
// Passes, jeder Pass = ein eigener Vollbild-Durchgang mit eigener Textur.
// Fünf Effekte = fünf Mal das ganze Bild lesen und schreiben.
//
// Mit WebGPURenderer + TSL ist Post-Processing ein NODE-GRAPH:
// - pass(scene, camera) liefert die Szene als Node („scenePass“).
// - Jeder Effekt ist eine Funktion: Node rein → Node raus.
// - Die Kette schreibt man wie normale Mathe: color = vignette(grade(color)).
// - three.js baut daraus EINEN Shader und fasst alle Effekte, die nur den
//   eigenen Pixel brauchen (Grading, Grain, Vignette …), automatisch zusammen.
//   Nur Effekte, die Nachbarpixel lesen (Bloom, DOF, Pixelation …), brauchen
//   eine Zwischentextur.
// - Depth, Normalen & Co. sind einfach weitere Nodes desselben Passes –
//   kein extra DepthPass, kein manuelles Durchreichen von Render-Targets.
//
// Kette in diesem Projekt (Abschnitt 5 · buildChain):
//   scenePass → Outline → DOF → Bloom → Aberration → Tone Mapping
//     → Grading → Posterize → Pixel/Dither → VHS → Grain → Vignette
//     → Letterbox → Split-Vergleich → Output

import * as THREE from "three/webgpu";
import {
  Fn,
  uniform,
  pass,
  mrt,
  output,
  normalView,
  packNormalToRGB,
  unpackRGBToNormal,
  perspectiveDepthToViewZ,
  renderOutput,
  convertToTexture,
  reflector,
  posterize,
  luminance,
  rand,
  hash,
  time,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  mix,
  step,
  smoothstep,
  abs,
  max,
  floor,
  fract,
  sin,
  pow,
  dot,
  clamp,
  distance,
} from "three/tsl";
// Fertige Effekt-Nodes liegen bei den Addons, nicht direkt in three/tsl
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { chromaticAberration } from "three/addons/tsl/display/ChromaticAberrationNode.js";
import { scanlines, vignette } from "three/addons/tsl/display/CRT.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import GUI from "lil-gui";
import Stats from "stats.js";

// ============================================================
// 1 · SETUP – Renderer, Szene, Kamera
// ============================================================

const canvas = document.querySelector("#scene");

// Hat der Browser WebGPU und gibt es einen passenden Grafik-Adapter?
async function detectWebGPU() {
  if (!navigator.gpu) return false;
  try {
    return (await navigator.gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

// WebGPURenderer nimmt WebGPU, wenn möglich – sonst WebGL2 als Fallback.
// Derselbe TSL-Code wird dann einfach in GLSL statt WGSL übersetzt.
const renderer = new THREE.WebGPURenderer({
  canvas,
  antialias: true,
  forceWebGL: !(await detectWebGPU()),
});
renderer.toneMapping = THREE.ACESFilmicToneMapping;
await renderer.init(); // erst danach ist klar, welches Backend läuft

if (!renderer.backend.isWebGPUBackend) {
  const notice = document.querySelector("#notice");
  notice.textContent = "Kein WebGPU – läuft über WebGL2. Am besten in Chrome, Edge oder Safari 26 öffnen.";
  notice.hidden = false;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060608);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
camera.position.set(0.8, 2.6, 12);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.3, 0);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.maxPolarAngle = Math.PI * 0.49; // nicht unter den Boden
controls.minDistance = 4;
controls.maxDistance = 18;

// Weiche Umgebungsreflexion, damit Chrom nach Chrom aussieht
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.25;

// ============================================================
// 2 · SZENE – bewusst einfach, damit die Effekte wirken
// ============================================================

const RED = new THREE.Color(0xcf1830);
const PINK = new THREE.Color(0xff2bd6);
const CYAN = new THREE.Color(0x19e6ff);

function neon(color, intensity) {
  return new THREE.MeshStandardNodeMaterial({
    color: 0x000000,
    emissive: color,
    emissiveIntensity: intensity, // > 1 = HDR-hell → genau das greift Bloom ab
  });
}

// --- Held: TorusKnot in Chrom (auf ihn fokussiert der DOF) ---
const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(0.85, 0.27, 320, 40),
  new THREE.MeshStandardNodeMaterial({ color: 0xe6e6ee, metalness: 1, roughness: 0.18 }),
);
knot.position.set(0, 1.5, 0);
scene.add(knot);

// --- Roter Neon-Ring hinter dem Knoten ---
const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.03, 16, 240), neon(RED, 7));
ring.position.set(0, 1.5, -1.6);
scene.add(ring);

// --- Kugeln, die um den Knoten kreisen ---
const orbiters = [
  { radius: 0.22, mat: neon(CYAN, 5), orbit: 2.3, speed: 0.45, height: 1.9, phase: 0 },
  { radius: 0.16, mat: neon(PINK, 6), orbit: 2.8, speed: -0.32, height: 1.0, phase: 2 },
  {
    radius: 0.42,
    mat: new THREE.MeshStandardNodeMaterial({ color: 0x0b0b0e, metalness: 0.2, roughness: 0.08 }),
    orbit: 3.1,
    speed: 0.22,
    height: 0.6,
    phase: 4,
  },
  {
    radius: 0.3,
    mat: new THREE.MeshStandardNodeMaterial({ color: 0xf2f2f2, roughness: 0.55 }),
    orbit: 2.0,
    speed: -0.5,
    height: 2.5,
    phase: 1,
  },
].map((o) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(o.radius, 48, 24), o.mat);
  scene.add(mesh);
  return { ...o, mesh };
});

// --- Würfel, die langsam taumeln ---
const cubeMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1a1f, metalness: 0.6, roughness: 0.3 });
const cubes = [
  [-3.2, 0.45, -0.4, 0.8],
  [3.4, 0.55, 0.6, 0.9],
  [1.7, 0.3, -3.2, 0.6],
  [-1.9, 0.25, 2.2, 0.5],
].map(([x, y, z, s], i) => {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(s, s, s, 4, s * 0.12), i === 2 ? neon(PINK, 2.5) : cubeMat);
  mesh.position.set(x, y + s / 2, z);
  scene.add(mesh);
  return { mesh, baseY: mesh.position.y, phase: i * 1.7 };
});

// --- Neon-Stäbe weit hinten: perfekte Bokeh-Lichter für den DOF ---
for (let i = 0; i < 9; i++) {
  const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 3.2, 4, 12), neon(i % 2 ? CYAN : PINK, 5));
  bar.position.set(-9 + i * 2.25, 1.8, -11 - (i % 3) * 1.5);
  scene.add(bar);
}

// --- Spiegelnder dunkler Boden ---
// reflector() rendert die Szene gespiegelt in eine eigene Textur und gibt sie
// als Node zurück – den mischen wir einfach ins Boden-Material.
const reflection = reflector({ resolutionScale: 0.5 });
reflection.target.rotateX(-Math.PI / 2);
scene.add(reflection.target);

// Basic statt Standard: ein Standard-Material würde bei flachem Blick die
// Umgebung (Fresnel) spiegeln und hellgrau werden – wir wollen nur die Spiegelung.
const floorMat = new THREE.MeshBasicNodeMaterial();
// Spiegelung zum Rand hin ausblenden, damit der Boden nicht „endet“
const floorFade = smoothstep(0.32, 0.06, distance(uv(), vec2(0.5)));
floorMat.colorNode = vec3(0.012, 0.012, 0.016).add(reflection.rgb.mul(floorFade).mul(0.42));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// --- Licht: Key, Rim (von hinten) und farbiges Akzentlicht ---
scene.add(new THREE.HemisphereLight(0x8890a0, 0x050505, 0.25));

const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(-4, 6, 5);
scene.add(key);

// Rim-Light: kommt von hinten und zeichnet helle Kanten um die Silhouetten
const rim = new THREE.DirectionalLight(0x9fdcff, 4);
rim.position.set(2, 4, -7);
scene.add(rim);

const accent = new THREE.PointLight(PINK, 40, 14, 1.6);
scene.add(accent);

const focusPoint = new THREE.Vector3();

function animateScene(t) {
  knot.rotation.x = t * 0.21;
  knot.rotation.y = t * 0.33;
  knot.position.y = 1.5 + Math.sin(t * 0.8) * 0.12;

  ring.rotation.z = t * 0.1;

  for (const o of orbiters) {
    const a = o.phase + t * o.speed;
    o.mesh.position.set(Math.cos(a) * o.orbit, o.height + Math.sin(t * 1.3 + o.phase) * 0.2, Math.sin(a) * o.orbit);
  }

  for (const c of cubes) {
    c.mesh.rotation.x = t * 0.3 + c.phase;
    c.mesh.rotation.y = t * 0.2 + c.phase;
    c.mesh.position.y = c.baseY + Math.sin(t * 0.9 + c.phase) * 0.08;
  }

  accent.position.set(Math.cos(t * 0.4) * 3.5, 2.2, Math.sin(t * 0.4) * 3.5);
}

// ============================================================
// 3 · REGLER-SYSTEM – uniform() + Zielwert = weiche Übergänge
// ============================================================
// Jeder Effekt-Parameter ist ein uniform(): ein Wert, der im Shader steckt,
// aber von JavaScript jederzeit geändert werden kann – ohne neu zu kompilieren.
//
// GUI und Presets setzen nur den ZIELWERT. Der Loop lässt den Uniform-Wert
// jeden Frame ein Stück hinterhergleiten. So wird jeder Preset-Wechsel
// automatisch ein weicher Übergang.
//
// Zusätzlich hat jeder Effekt einen „mix“-Uniform (0 = aus, 1 = voll).
// Ist ein Effekt aus UND ausgeblendet, fliegt er ganz aus dem Graphen
// (siehe Abschnitt 5) – dann kostet er auch keine Leistung mehr.

const params = {};
const effects = {};

function param(key, value, min, max, step, label) {
  const isColor = value instanceof THREE.Color;
  const node = uniform(isColor ? value.clone() : value);
  params[key] = { node, target: isColor ? value.clone() : value, initial: isColor ? value.clone() : value, isColor, min, max, step, label };
  return node;
}

function effect(key, label, keys) {
  effects[key] = { key, label, keys, on: false, inGraph: false, mix: uniform(0) };
  return effects[key].mix;
}

const uResolution = uniform(new THREE.Vector2(1, 1)); // Pixel des Canvas
const uAspect = uniform(1); // Breite / Höhe
const uNear = uniform(camera.near);
const uFar = uniform(camera.far);
const uFocus = uniform(9); // Abstand Kamera → Knoten, jeden Frame neu
const uSplitOn = uniform(0);
const uSplit = uniform(0.5);

// ============================================================
// 4 · EFFEKTE – je ein Abschnitt, je ein Node
// ============================================================

// ------------------------------------------------------------
// scenePass – die Szene als Node
// ------------------------------------------------------------
// pass() rendert scene + camera in Render-Targets. Mit setMRT() (Multiple
// Render Targets) schreibt derselbe Durchgang mehrere Texturen gleichzeitig:
// - "output": die normale Farbe (HDR, linear, noch ohne Tone Mapping)
// - "normal": die Oberflächen-Normale im Kamera-Raum, als Farbe kodiert
// Die Tiefe (depth) gibt es immer gratis dazu.
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));

const sceneColor = scenePass.getTextureNode("output");
const normalTex = scenePass.getTextureNode("normal");
const depthTex = scenePass.getTextureNode("depth");
// viewZ = Abstand zur Kamera in Welt-Einheiten (negativ, Kamera schaut nach -Z)
const sceneViewZ = scenePass.getViewZNode();

// ------------------------------------------------------------
// 4.1 · Outline (Comic) – eigene Fn() über Depth + Normalen
// ------------------------------------------------------------
// Für jeden Pixel schauen wir auf die 4 Nachbarn:
// - Springt die Tiefe stark → Silhouette (Objekt vor Hintergrund)
// - Knickt die Normale stark → Innenkante (z. B. Würfelkante)
// Beides zusammen ergibt die Tusche-Linie.
const mOutline = effect("outline", "Outline", ["outlineWidth", "outlineDepth", "outlineNormal", "outlineInk"]);
const uOutlineWidth = param("outlineWidth", 1.6, 0.5, 4, 0.1, "Linienbreite (px)");
const uOutlineDepth = param("outlineDepth", 0.06, 0.005, 0.3, 0.005, "Tiefen-Schwelle");
const uOutlineNormal = param("outlineNormal", 0.35, 0.05, 1, 0.01, "Normalen-Schwelle");
const uOutlineInk = param("outlineInk", new THREE.Color(0x050505), 0, 0, 0, "Tusche");

const outlineFx = Fn(([color]) => {
  const px = vec2(uOutlineWidth).div(uResolution); // eine „Linienbreite“ in UV
  const base = uv();

  // Tiefe an einer Stelle als echte Entfernung (nicht 0..1-Depth-Buffer)
  const viewZAt = (offset) => perspectiveDepthToViewZ(depthTex.sample(base.add(offset)).x, uNear, uFar);
  // Normalen kamen als Farbe (0..1) rein → zurück in Richtung (-1..1)
  const normalAt = (offset) => unpackRGBToNormal(normalTex.sample(base.add(offset)).rgb);

  const z0 = viewZAt(vec2(0));
  const n0 = normalAt(vec2(0));
  const offsets = [vec2(px.x, 0), vec2(px.x.negate(), 0), vec2(0, px.y), vec2(0, px.y.negate())];

  let depthDiff = float(0);
  let normalDiff = float(0);
  for (const o of offsets) {
    // relativ zur Entfernung, sonst wären ferne Objekte voller Linien
    depthDiff = depthDiff.add(abs(viewZAt(o).sub(z0)).div(abs(z0)));
    normalDiff = normalDiff.add(float(1).sub(dot(n0, normalAt(o))));
  }

  const edge = max(
    smoothstep(uOutlineDepth, uOutlineDepth.mul(2), depthDiff),
    smoothstep(uOutlineNormal, uOutlineNormal.mul(2), normalDiff),
  );

  return vec4(mix(color.rgb, uOutlineInk, edge.mul(mOutline)), color.a);
});

// ------------------------------------------------------------
// 4.2 · Depth of Field – fertig in den Addons: dof()
// ------------------------------------------------------------
// dof() braucht die Farbe UND die viewZ-Tiefe. focusDistance = wo es scharf
// ist (setzen wir jeden Frame auf den Knoten), focalLength = wie schnell es
// davor/dahinter unscharf wird, bokehScale = Größe der Unschärfe-Scheibchen.
const mDof = effect("dof", "Depth of Field", ["dofFocalLength", "dofBokeh"]);
const uDofFocalLength = param("dofFocalLength", 3.5, 0.5, 12, 0.1, "Schärfebereich");
const uDofBokeh = param("dofBokeh", 5, 0, 12, 0.1, "Bokeh-Größe");

// ------------------------------------------------------------
// 4.3 · Bloom – fertig: bloom()
// ------------------------------------------------------------
// bloom() filtert alles über threshold heraus, verwischt es mehrstufig und
// gibt NUR den Schein zurück – den addieren wir auf die Farbe.
const mBloom = effect("bloom", "Bloom", ["bloomStrength", "bloomRadius", "bloomThreshold"]);
const uBloomStrength = param("bloomStrength", 0.3, 0, 3, 0.01, "Stärke");
const uBloomRadius = param("bloomRadius", 0.35, 0, 1, 0.01, "Radius");
const uBloomThreshold = param("bloomThreshold", 0.9, 0, 3, 0.01, "Schwelle");

// ------------------------------------------------------------
// 4.4 · Chromatische Aberration – fertig: chromaticAberration()
// ------------------------------------------------------------
// Skaliert R nach außen und B nach innen – je weiter vom Zentrum, desto mehr.
const mCa = effect("ca", "Chrom. Aberration", ["caStrength"]);
const uCaStrength = param("caStrength", 0.8, 0, 3, 0.01, "Versatz");

// ------------------------------------------------------------
// 4.5 · Color Grading – eigene Fn()
// ------------------------------------------------------------
// Läuft NACH dem Tone Mapping, also auf Werten 0..1 wie in Photoshop/Resolve.
// - Temperatur: Rot rauf/Blau runter (warm) oder umgekehrt (kalt)
// - Lift/Gamma/Gain: Schatten / Mitten / Lichter getrennt einfärben
// - Kontrast um Mittelgrau, Sättigung über die Helligkeit (luminance)
const mGrade = effect("grade", "Color Grading", ["gradeTemp", "gradeContrast", "gradeSat", "gradeLift", "gradeGamma", "gradeGain"]);
const uGradeTemp = param("gradeTemp", 0, -1, 1, 0.01, "Temperatur");
const uGradeContrast = param("gradeContrast", 1, 0.5, 1.8, 0.01, "Kontrast");
const uGradeSat = param("gradeSat", 1, 0, 2, 0.01, "Sättigung");
const uGradeLift = param("gradeLift", new THREE.Color(0, 0, 0), 0, 0, 0, "Lift (Schatten)");
const uGradeGamma = param("gradeGamma", 1, 0.5, 2, 0.01, "Gamma (Mitten)");
const uGradeGain = param("gradeGain", new THREE.Color(1, 1, 1), 0, 0, 0, "Gain (Lichter)");

const gradeFx = Fn(([color]) => {
  let c = color.rgb;
  c = c.mul(vec3(uGradeTemp.mul(0.12).add(1), 1, uGradeTemp.mul(-0.12).add(1)));
  // Lift hebt nur die Schatten (wirkt dort, wo c klein ist), Gain skaliert die Lichter
  c = c.mul(uGradeGain).add(uGradeLift.mul(c.oneMinus()));
  c = pow(max(c, 0), vec3(1).div(uGradeGamma));
  c = c.sub(0.5).mul(uGradeContrast).add(0.5);
  c = mix(vec3(luminance(c)), c, uGradeSat);
  return vec4(mix(color.rgb, clamp(c, 0, 1), mGrade), color.a);
});

// ------------------------------------------------------------
// 4.6 · Posterize (Comic) – fertig in three/tsl: posterize()
// ------------------------------------------------------------
// Rundet jeden Kanal auf wenige Stufen → flache Farbflächen wie im Druck.
const mPoster = effect("posterize", "Posterize", ["posterSteps"]);
const uPosterSteps = param("posterSteps", 4, 2, 12, 1, "Stufen");

const posterFx = Fn(([color]) => {
  const flat = posterize(color.rgb.add(float(0.5).div(uPosterSteps)), uPosterSteps); // + halbe Stufe = runden statt abschneiden
  return vec4(mix(color.rgb, clamp(flat, 0, 1), mPoster), color.a);
});

// ------------------------------------------------------------
// 4.7 · Pixelation + Dithering (Retro) – eigene Fn()
// ------------------------------------------------------------
// Pixelation: alle Pixel einer Zelle lesen dieselbe Stelle der Textur.
// Dithering: statt hart auf wenige Farbstufen zu runden, verschieben wir die
// Rundungsgrenze pro Pixel nach einem Bayer-Muster – die Stufen werden zu
// feinen Punktrastern wie bei alten Konsolen.
const mPixel = effect("pixel", "Pixel + Dither", ["pixelSize", "pixelLevels", "pixelDither"]);
const uPixelSize = param("pixelSize", 6, 1, 24, 1, "Pixelgröße");
const uPixelLevels = param("pixelLevels", 5, 2, 16, 1, "Farbstufen");
const uPixelDither = param("pixelDither", 1, 0, 1, 0.01, "Dither");

// Bayer-Matrix ohne Tabelle: 2×2 per Formel, 4×4 aus zwei 2×2 zusammengesetzt
const bayer2 = (a) => {
  const f = floor(a);
  return fract(dot(f, vec2(0.5, f.y.mul(0.75))));
};
const bayer4 = (a) => bayer2(a.mul(0.5)).mul(0.25).add(bayer2(a));

const pixelFx = Fn(([tex]) => {
  // beim Einblenden wächst die Zelle von 1 Pixel auf die Zielgröße
  const cell = mix(1, uPixelSize, mPixel);
  const cellCoord = floor(uv().mul(uResolution).div(cell));
  const cellUV = cellCoord.add(0.5).mul(cell).div(uResolution);
  const c = tex.sample(cellUV).rgb;

  const levels = uPixelLevels.sub(1);
  const threshold = bayer4(cellCoord).sub(0.5).mul(uPixelDither);
  const q = floor(c.mul(levels).add(threshold).add(0.5)).div(levels);
  return vec4(mix(c, clamp(q, 0, 1), mPixel), 1);
});

// ------------------------------------------------------------
// 4.8 · VHS – Wackeln + Scanlines – eigene Fn() + scanlines() aus den Addons
// ------------------------------------------------------------
// - Zeilen-Zittern: jede Bildzeile bekommt pro Frame einen zufälligen Versatz
// - Tracking-Band: ein heller, verzogener Streifen läuft langsam durchs Bild
// - Bildwackeln: das ganze Bild hüpft minimal auf und ab
// - Farbsaum: R und B werden seitlich verschoben gelesen
const mVhs = effect("vhs", "VHS", ["vhsWobble", "vhsScan", "vhsLines", "vhsBleed"]);
const uVhsWobble = param("vhsWobble", 0.006, 0, 0.03, 0.0005, "Wackeln");
const uVhsScan = param("vhsScan", 0.35, 0, 1, 0.01, "Scanlines");
const uVhsLines = param("vhsLines", 420, 100, 900, 1, "Zeilen");
const uVhsBleed = param("vhsBleed", 0.003, 0, 0.012, 0.0001, "Farbsaum");

const vhsFx = Fn(([tex]) => {
  const amount = mVhs;
  const y = uv().y.add(sin(time.mul(7.3)).mul(0.0015).mul(amount)); // Bildwackeln
  const line = floor(y.mul(uVhsLines));
  const frame = floor(time.mul(24)); // Zittern im Film-Takt, nicht pro Bildschirm-Frame
  const jitter = hash(line.add(frame.mul(977))).sub(0.5).mul(uVhsWobble).mul(0.3);
  const wave = sin(y.mul(9).add(time.mul(1.7))).mul(uVhsWobble).mul(0.4);
  const band = smoothstep(0.05, 0, abs(y.sub(fract(time.mul(0.11)))));
  const shift = jitter.add(wave).add(band.mul(uVhsWobble).mul(2.5)).mul(amount);

  const st = vec2(uv().x.add(shift), y);
  const bleed = vec2(uVhsBleed.mul(amount), 0);
  let c = vec3(tex.sample(st.add(bleed)).r, tex.sample(st).g, tex.sample(st.sub(bleed)).b);
  c = scanlines(c, uVhsScan.mul(amount), uVhsLines, float(0.04), uv());
  c = c.add(band.mul(0.07).mul(amount)); // das Band ist etwas heller
  return vec4(c, 1);
});

// ------------------------------------------------------------
// 4.9 · Film Grain – eigene Fn() mit time
// ------------------------------------------------------------
// rand() liefert pro Pixel eine Zufallszahl. Weil time mit in die Koordinate
// fließt, ist das Rauschen jeden Frame anders – es „lebt“.
// (In den Addons gibt es auch film(), hier selbst gebaut zum Verstehen.)
const mGrain = effect("grain", "Film Grain", ["grainAmount"]);
const uGrainAmount = param("grainAmount", 0.08, 0, 0.35, 0.005, "Körnung");

const grainFx = Fn(([color]) => {
  const pixel = floor(uv().mul(uResolution));
  const noise = rand(pixel.add(fract(time.mul(0.7)).mul(1000))).sub(0.5);
  // Grain sieht man in den Mitten am stärksten, in Tiefschwarz kaum
  const l = luminance(color.rgb);
  const weight = float(1).sub(abs(l.mul(2).sub(1))).mul(0.7).add(0.3);
  return vec4(color.rgb.add(noise.mul(uGrainAmount).mul(weight).mul(mGrain)), color.a);
});

// ------------------------------------------------------------
// 4.10 · Vignette – fertig: vignette() aus den Addons
// ------------------------------------------------------------
const mVignette = effect("vignette", "Vignette", ["vignetteAmount", "vignetteSoft"]);
const uVignetteAmount = param("vignetteAmount", 0.5, 0, 1, 0.01, "Stärke");
const uVignetteSoft = param("vignetteSoft", 0.6, 0.05, 1, 0.01, "Weichheit");

const vignetteFx = Fn(([color]) => vec4(vignette(color.rgb, uVignetteAmount.mul(mVignette), uVignetteSoft, uv()), color.a));

// ------------------------------------------------------------
// 4.11 · Letterbox 2.39:1 – eigene Fn()
// ------------------------------------------------------------
// Wie hoch müssen die Balken sein, damit das sichtbare Bild 2.39:1 ist?
// Bildhöhe soll Breite/2.39 sein → pro Balken (1 − Seitenverhältnis/2.39) / 2.
const mLetterbox = effect("letterbox", "Letterbox", ["letterboxRatio"]);
const uLetterboxRatio = param("letterboxRatio", 2.39, 1.5, 3, 0.01, "Seitenverhältnis");

const letterboxFx = Fn(([color]) => {
  const bar = max(float(1).sub(uAspect.div(uLetterboxRatio)).mul(0.5), 0).mul(mLetterbox);
  const inBar = step(uv().y, bar).add(step(float(1).sub(bar), uv().y)).min(1);
  return vec4(mix(color.rgb, vec3(0), inBar), color.a);
});

// ------------------------------------------------------------
// Split-Vergleich (Taste V) – links ohne, rechts mit
// ------------------------------------------------------------
const splitFx = Fn(([clean, graded]) => {
  const right = mix(float(1), step(uSplit, uv().x), uSplitOn);
  const c = mix(clean.rgb, graded.rgb, right);
  const lineWidth = float(1.5).div(uResolution.x);
  const onLine = smoothstep(lineWidth, 0, abs(uv().x.sub(uSplit))).mul(uSplitOn);
  return vec4(mix(c, vec3(1), onLine), 1);
});

// ============================================================
// 5 · DIE KETTE – scenePass → Effekt → Effekt → … → Output
// ============================================================
// RenderPipeline (früher „PostProcessing“) ist das ganze Gerüst: Es rendert
// die Szene und zeigt am Ende das, was in outputNode steht.
//
// outputColorTransform = false: Tone Mapping + sRGB machen wir selbst an
// einer bewusst gewählten Stelle (renderOutput). Davor ist alles HDR
// (Bloom & DOF brauchen echte Helligkeit), danach 0..1 (Grading, Grain …).
//
// Effekte, die Nachbarpixel lesen, brauchen eine Textur als Eingang.
// convertToTexture() rendert dafür den bisherigen Teil der Kette in eine
// Zwischentextur (RTT = render to texture). Alles andere landet im selben Shader.

const renderPipeline = new THREE.RenderPipeline(renderer);
renderPipeline.outputColorTransform = false;

let graphNodes = []; // alles mit eigenen Render-Targets → beim Umbau aufräumen

function keep(node) {
  graphNodes.push(node);
  return node;
}

function asTexture(node) {
  return node.isTextureNode ? node : keep(convertToTexture(node));
}

function buildChain() {
  const old = graphNodes;
  graphNodes = [];
  const use = (key) => effects[key].inGraph;
  let color = sceneColor;

  // --- HDR: lineares Licht, Werte über 1 möglich ---
  if (use("outline")) color = outlineFx(color);
  if (use("dof")) color = keep(dof(asTexture(color), sceneViewZ, uFocus, uDofFocalLength, uDofBokeh.mul(mDof)));
  if (use("bloom")) color = color.add(keep(bloom(color, uBloomStrength.mul(mBloom), uBloomRadius, uBloomThreshold)));
  if (use("ca")) color = chromaticAberration(asTexture(color), uCaStrength.mul(mCa), vec2(0.5), float(1.1));

  // --- Tone Mapping (ACES) + sRGB: ab hier Bildschirmfarben 0..1 ---
  color = renderOutput(color);

  // --- LDR: Look & Textur ---
  if (use("grade")) color = gradeFx(color);
  if (use("posterize")) color = posterFx(color);
  if (use("pixel")) color = pixelFx(asTexture(color));
  if (use("vhs")) color = vhsFx(asTexture(color));
  if (use("grain")) color = grainFx(color);
  if (use("vignette")) color = vignetteFx(color);
  if (use("letterbox")) color = letterboxFx(color);

  // effects ist in Ketten-Reihenfolge angelegt → passt auch für die Anzeige
  // Linke Seite im Vergleich: dieselbe Szene, nur Tone Mapping
  renderPipeline.outputNode = splitFx(renderOutput(sceneColor), color);
  renderPipeline.needsUpdate = true;

  for (const node of old) node.dispose();
}

// ============================================================
// 6 · PRESETS – Tasten 1–5
// ============================================================
// Ein Preset ist nur eine Liste aktiver Effekte + Zielwerte. Alles, was nicht
// drinsteht, gleitet auf den Grundwert zurück.

const presets = [
  {
    name: "Clean",
    effects: ["bloom"],
    values: { bloomStrength: 0.25, bloomThreshold: 0.95, bloomRadius: 0.3 },
  },
  {
    name: "Cinematic",
    effects: ["dof", "bloom", "grade", "grain", "vignette", "letterbox"],
    values: {
      bloomStrength: 0.45,
      bloomThreshold: 0.8,
      dofFocalLength: 3,
      dofBokeh: 6,
      gradeTemp: 0.55,
      gradeContrast: 1.12,
      gradeSat: 0.88,
      gradeLift: new THREE.Color(0.0, 0.025, 0.035), // Teal in den Schatten …
      gradeGain: new THREE.Color(1, 0.94, 0.84), // … warmes Orange in den Lichtern
      grainAmount: 0.09,
      vignetteAmount: 0.6,
    },
  },
  {
    name: "Neon / Cyberpunk",
    effects: ["bloom", "ca", "grade", "vignette"],
    values: {
      bloomStrength: 0.8,
      bloomRadius: 0.55,
      bloomThreshold: 1.0,
      caStrength: 0.9,
      gradeTemp: -0.6,
      gradeContrast: 1.18,
      gradeSat: 1.35,
      gradeLift: new THREE.Color(0.05, 0.0, 0.07), // Magenta-Schatten
      gradeGain: new THREE.Color(0.82, 0.96, 1), // Cyan-Lichter
      gradeGamma: 0.92,
      vignetteAmount: 0.45,
    },
  },
  {
    name: "Retro VHS",
    effects: ["vhs", "ca", "bloom", "grade", "grain", "vignette"],
    values: {
      vhsWobble: 0.004,
      vhsScan: 0.4,
      vhsLines: 420,
      vhsBleed: 0.004,
      caStrength: 0.7,
      bloomStrength: 0.4,
      bloomRadius: 0.7,
      bloomThreshold: 0.9,
      gradeTemp: 0.2,
      gradeContrast: 0.82,
      gradeSat: 0.55,
      gradeLift: new THREE.Color(0.07, 0.06, 0.08), // verwaschenes Schwarz
      gradeGamma: 1.12,
      grainAmount: 0.14,
      vignetteAmount: 0.55,
    },
  },
  {
    name: "Comic",
    effects: ["outline", "grade", "posterize"],
    values: {
      outlineWidth: 1.8,
      outlineInk: new THREE.Color(1, 0.95, 0.85), // helle Tusche: die Szene ist fast schwarz
      gradeContrast: 1.15,
      gradeSat: 1.45,
      gradeGamma: 1.15,
      gradeLift: new THREE.Color(0.03, 0.03, 0.03),
      posterSteps: 4,
    },
  },
];

const usedByPresets = new Set(presets.flatMap((p) => p.effects));
let currentPreset = 0;

function applyPreset(index) {
  currentPreset = index;
  view.preset = index;
  const preset = presets[index];
  for (const e of Object.values(effects)) e.on = preset.effects.includes(e.key);
  for (const [key, p] of Object.entries(params)) {
    const value = preset.values[key] ?? p.initial;
    if (p.isColor) p.target.copy(value);
    else p.target = value;
  }
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  document.querySelector("#preset-name").textContent = `${index + 1} · ${preset.name}`;
}

// Untertitel: die sichtbare Kette. Im Graphen können mehr Effekte stecken
// (beim Ausblenden oder im Autoplay vorgeladen) – die zeigen wir nicht.
const chainEl = document.querySelector("#chain");
function updateChainCaption() {
  // effects ist in Ketten-Reihenfolge angelegt → passt auch für die Anzeige
  const active = Object.values(effects).filter((e) => e.on).map((e) => e.label);
  const text = ["scenePass", ...active, "Output"].join(" → ");
  if (chainEl.textContent !== text) chainEl.textContent = text;
}

// ============================================================
// 7 · GUI – lil-gui + stats.js
// ============================================================

const gui = new GUI({ title: "TSL Post-Processing" });

const view = { preset: 0, autoRotate: true, compare: () => toggleSplit(), autoplay: () => toggleAutoplay() };
gui
  .add(view, "preset", Object.fromEntries(presets.map((p, i) => [`${i + 1} · ${p.name}`, i])))
  .name("Preset")
  .onChange((i) => {
    stopAutoplay();
    applyPreset(i);
  });
gui.add(view, "autoRotate").name("Kamera dreht").onChange((v) => (controls.autoRotate = v));
gui.add(view, "compare").name("Vergleich (V)");
gui.add(view, "autoplay").name("Autoplay (P)");

// Ein Ordner pro Effekt, in Ketten-Reihenfolge. „an“ blendet weich ein/aus,
// die Regler setzen Zielwerte (der Uniform gleitet hinterher).
for (const e of Object.values(effects)) {
  const folder = gui.addFolder(e.label).close();
  folder.add(e, "on").name("an");
  for (const key of e.keys) {
    const p = params[key];
    if (p.isColor) folder.addColor(p, "target").name(p.label);
    else folder.add(p, "target", p.min, p.max, p.step).name(p.label);
  }
}

// stats.js: FPS. Effekt an/aus schalten und zusehen, was er kostet.
const stats = new Stats();
stats.dom.id = "stats";
document.body.appendChild(stats.dom);

// ============================================================
// 8 · STEUERUNG – Formate, Vergleich, Autoplay, Tasten
// ============================================================

const badge = document.querySelector("#badge");
let badgeTimer;
function showBadge(text) {
  badge.textContent = text;
  badge.classList.add("show");
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => badge.classList.remove("show"), 1400);
}

// --- Canvas-Formate (Taste F) ---
const formats = [
  { name: "Vollbild", width: null, height: null },
  { name: "1:1 · 1080×1080", width: 1080, height: 1080 },
  { name: "16:9 · 1920×1080", width: 1920, height: 1080 },
];
let formatIndex = 0;

const caption = document.querySelector("#caption");
const splitUI = document.querySelector("#split-ui");

function resize() {
  const f = formats[formatIndex];

  if (!f.width) {
    // Höchstens 1,5: jeder Effekt rechnet pro Pixel, Retina (2) wäre fast doppelt so teuer
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight); // setzt auch die CSS-Größe
    camera.aspect = window.innerWidth / window.innerHeight;
  } else {
    // Feste Auflösung rendern (Pixel exakt fürs Format) …
    renderer.setPixelRatio(1);
    renderer.setSize(f.width, f.height, false);
    // … und nur per CSS ins Fenster einpassen
    const scale = Math.min(window.innerWidth / f.width, window.innerHeight / f.height, 1);
    canvas.style.width = `${f.width * scale}px`;
    canvas.style.height = `${f.height * scale}px`;
    camera.aspect = f.width / f.height;
  }
  camera.updateProjectionMatrix();

  renderer.getDrawingBufferSize(uResolution.value);
  uAspect.value = camera.aspect;

  // Untertitel + Split-Beschriftung sitzen im Canvas, damit sie mit ins Video kommen
  const rect = canvas.getBoundingClientRect();
  caption.style.left = `${rect.left + 22}px`;
  caption.style.bottom = `${window.innerHeight - rect.bottom + 22}px`;
  Object.assign(splitUI.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
}

window.addEventListener("resize", resize);
resize();

// --- Split-Vergleich (Taste V), Trennlinie mit der Maus ziehen ---
let splitDragging = false;

function toggleSplit() {
  uSplitOn.value = uSplitOn.value ? 0 : 1;
  splitUI.hidden = !uSplitOn.value;
  showBadge(uSplitOn.value ? "Vergleich: Linie ziehen" : "Vergleich aus");
}

function splitFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1);
}

function nearSplitLine(event) {
  const rect = canvas.getBoundingClientRect();
  return uSplitOn.value && Math.abs(event.clientX - (rect.left + uSplit.value * rect.width)) < 24;
}

// capture: true → wir sind vor OrbitControls dran und können es stoppen
canvas.addEventListener(
  "pointerdown",
  (event) => {
    if (!nearSplitLine(event)) return;
    splitDragging = true;
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
    event.stopImmediatePropagation();
  },
  { capture: true },
);
canvas.addEventListener("pointermove", (event) => {
  if (splitDragging) {
    uSplit.value = splitFromEvent(event);
    splitUI.style.setProperty("--split", `${uSplit.value * 100}%`);
  }
  canvas.style.cursor = splitDragging || nearSplitLine(event) ? "ew-resize" : "";
});
canvas.addEventListener("pointerup", () => {
  splitDragging = false;
  controls.enabled = true;
});

// --- Autoplay (Taste P): alle 5 Presets nacheinander, dann zurück zu 1 ---
const autoplay = { active: false, step: 0, clock: 0 };
const AUTOPLAY_HOLD = 2.2; // Sekunden pro Preset (inkl. Übergang)

function toggleAutoplay() {
  if (autoplay.active) return stopAutoplay();
  // Alle Effekte der Presets kommen sofort in den Graphen. So wird nur EINMAL
  // kompiliert – vor dem ersten Übergang statt mitten im Clip.
  Object.assign(autoplay, { active: true, step: 0, clock: -0.6 });
  applyPreset(0);
  showBadge("Autoplay");
}

function stopAutoplay() {
  autoplay.active = false;
}

function updateAutoplay(delta) {
  if (!autoplay.active) return;
  autoplay.clock += delta;
  if (autoplay.clock < AUTOPLAY_HOLD) return;
  autoplay.clock = 0;
  autoplay.step++;
  if (autoplay.step > presets.length) return stopAutoplay(); // 1 → 5 → zurück zu 1, fertig
  applyPreset(autoplay.step % presets.length);
}

// --- Screenshot (Taste S) ---
let screenshotRequested = false;

function saveScreenshot() {
  canvas.toBlob((blob) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `tsl-post-${presets[currentPreset].name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, "image/png");
  showBadge("PNG gespeichert");
}

// --- Tasten ---
window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const k = event.key.toLowerCase();

  if (k >= "1" && k <= "5") {
    stopAutoplay();
    applyPreset(Number(k) - 1);
  }
  if (k === "p") toggleAutoplay();
  if (k === "v") toggleSplit();
  if (k === "h") document.body.classList.toggle("clean");
  if (k === "c") document.body.classList.toggle("no-caption");

  if (k === "f") {
    formatIndex = (formatIndex + 1) % formats.length;
    resize();
    showBadge(formats[formatIndex].name);
  }

  // Nicht sofort speichern: der Canvas ist zwischen zwei Frames leer.
  // Wir merken uns den Wunsch und lesen direkt nach dem nächsten Render.
  if (k === "s") screenshotRequested = true;
});

// ============================================================
// 9 · ANIMATION-LOOP
// ============================================================

// Effekte ein-/ausblenden, Parameter hinterhergleiten lassen und den Graphen
// nur dann neu bauen, wenn sich die Menge der beteiligten Effekte ändert.
function updateEffects(delta) {
  const ease = 1 - Math.exp(-delta * 4);
  let changed = false;

  for (const e of Object.values(effects)) {
    const target = e.on ? 1 : 0;
    e.mix.value += (target - e.mix.value) * ease;
    if (Math.abs(target - e.mix.value) < 0.002) e.mix.value = target;

    const needed = e.on || e.mix.value > 0 || (autoplay.active && usedByPresets.has(e.key));
    if (needed !== e.inGraph) {
      e.inGraph = needed;
      changed = true;
    }
  }

  for (const p of Object.values(params)) {
    if (p.isColor) p.node.value.lerp(p.target, ease);
    else p.node.value += (p.target - p.node.value) * ease;
  }

  if (changed) buildChain();
  updateChainCaption();
}

applyPreset(0);
// Startwerte sofort setzen statt vom Grundwert hinzugleiten
for (const e of Object.values(effects)) e.mix.value = e.on ? 1 : 0;
updateEffects(1);

const timer = new THREE.Timer();

renderer.setAnimationLoop((timestamp) => {
  stats.begin();

  timer.update(timestamp);
  // Nach einem Tab-Wechsel nicht mit riesigem Zeitschritt weiterspringen
  const delta = Math.min(timer.getDelta(), 1 / 20);
  const t = timer.getElapsed();

  animateScene(t);
  controls.update(delta);
  updateAutoplay(delta);
  updateEffects(delta);

  // DOF-Fokus = Abstand zum Knoten entlang der Blickrichtung
  camera.updateMatrixWorld();
  knot.getWorldPosition(focusPoint).applyMatrix4(camera.matrixWorldInverse);
  uFocus.value = -focusPoint.z;

  renderPipeline.render();

  if (screenshotRequested) {
    screenshotRequested = false;
    saveScreenshot();
  }

  stats.end();
});
