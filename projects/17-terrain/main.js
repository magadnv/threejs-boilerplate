// ============================================================
// 17 · Terrain – endlose Landschaft, komplett prozedural in TSL
// ============================================================
// Kein Heightmap-Bild, kein 3D-Modell: Berge, Täler und Wasser entstehen
// allein aus Noise, jedes Frame neu auf der Grafikkarte berechnet.
// Das Mesh ist eine flache, unbewegte Platte. Nur die Zahlen, mit denen der
// Shader das Noise abfragt, ändern sich – und das sieht aus wie Fliegen.

import * as THREE from "three/webgpu";
import {
  Fn,
  Loop,
  uniform,
  varying,
  float,
  int,
  vec2,
  vec3,
  color,
  sin,
  cos,
  exp,
  mix,
  smoothstep,
  reflect,
  positionLocal,
  positionWorld,
  positionWorldDirection,
  cameraPosition,
  transformNormalToView,
  mx_noise_float,
  mx_cell_noise_float,
  fog,
  pass,
} from "three/tsl";
// bloom() liegt nicht direkt in three/tsl, sondern bei den Addons
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
// ACES Filmic: helle Stellen (Sonne, Glanz) laufen weich aus statt hart weiß
renderer.toneMapping = THREE.ACESFilmicToneMapping;
await renderer.init(); // erst danach ist klar, welches Backend läuft

if (!renderer.backend.isWebGPUBackend) {
  const notice = document.querySelector("#notice");
  notice.textContent = "Kein WebGPU – läuft über WebGL2. Am besten in Chrome, Edge oder Safari 26 öffnen.";
  notice.hidden = false;
}

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);

// ============================================================
// 2 · PARAMETER – Uniforms
// ============================================================
// uniform() ist ein Wert, der im Shader steht, aber von JS aus jederzeit
// geändert werden kann (uFoo.value = 3). Der Shader wird dafür NICHT neu
// gebaut – nur die Zahl im GPU-Speicher wird ersetzt. Ideal für lil-gui.

// Terrain-Form
const uOctaves = uniform(7); // wie viele Noise-Schichten übereinander
const uFrequency = uniform(0.012); // wie groß die Berge sind (klein = breit)
const uHeight = uniform(26); // Berghöhe in Welt-Einheiten
const uLacunarity = uniform(2.05); // Frequenz-Faktor pro Oktave
const uGain = uniform(0.48); // Höhen-Faktor pro Oktave
const uRidged = uniform(1); // 0 = weiches fbm, 1 = scharfe Grate (weich überblendet)
const uValleyFloor = uniform(0.22); // wie stark das Flugtal abgesenkt wird
const uSeed = uniform(new THREE.Vector2(37.2, 91.7)); // Startpunkt im Noise = „welche Welt“

// Endlos-Flug
const uOffset = uniform(new THREE.Vector2()); // wie weit wir schon geflogen sind
const uHeading = uniform(0); // Flugrichtung in Radiant
const uTime = uniform(0);

// Wasser & Farben
const uWaterLevel = uniform(1.4);
const uSnowLine = uniform(15);

// Atmosphäre – werden beim Wechsel der Lichtstimmung weich überblendet
const uZenith = uniform(new THREE.Color());
const uHorizon = uniform(new THREE.Color());
const uSunColor = uniform(new THREE.Color());
const uSunDir = uniform(new THREE.Vector3(0, 1, 0));
const uSunGlow = uniform(1);
const uStars = uniform(0);
const uWaterDeep = uniform(new THREE.Color());
const uFogDensity = uniform(0.0075);
const uBloomStrength = uniform(0.35);

// Terrain-Gitter: halbe Kantenlänge und Segmente pro Seite
const TERRAIN_RADIUS = 180;
const TERRAIN_SEGMENTS = 512;

// ============================================================
// 3 · TERRAIN – fbm: Fractal Brownian Motion
// ============================================================
// Ein einzelnes Noise ist eine sanfte Hügelwelle – langweilig.
// fbm legt mehrere Noise-Schichten („Oktaven“) übereinander:
//   Oktave 1: große Berge      (Frequenz × 1,   Höhe × 1)
//   Oktave 2: Hügel darauf     (Frequenz × 2,   Höhe × 0,5)
//   Oktave 3: Felsbuckel       (Frequenz × 4,   Höhe × 0,25) …
// Lacunarity = wie viel feiner jede Schicht wird, Gain = wie viel flacher.
// So entsteht das typische „Selbstähnliche“ echter Gebirge: aus der Ferne
// sieht ein Grat aus wie ein Berg, aus der Nähe wie ein Stein.
//
// Ridged Noise: Noise schwankt um 0. 1 − |noise| macht aus jedem
// Nulldurchgang eine scharfe Spitze → Grate statt runder Kuppen. Jede Oktave
// wird zusätzlich mit der vorigen gewichtet: Details sitzen dann vor allem
// auf den Graten, die Täler bleiben ruhig.

//
// Anti-Flackern (LOD): Das Gitter steht still, das Noise rutscht darunter
// durch. Ist eine Oktave feiner als der Abstand zweier Gitterpunkte, trifft
// jeder Punkt jedes Frame eine zufällig andere Stelle der Welle – die Grate
// zappeln (Aliasing). Darum bekommt fbm mit, wie viele Noise-Zellen auf
// einen Gitterabstand fallen. Ab ~¼ Zelle pro Punkt wird die Oktave weich
// auf ihren Mittelwert ausgeblendet. Nah an der Kamera (dichtes Gitter)
// bleiben alle Oktaven, in der Ferne nur die groben.

const fbm = Fn(([p, cellsPerVertex]) => {
  const q = p.toVar();
  const sum = float(0).toVar();
  const amp = float(0.5).toVar();
  const norm = float(0).toVar();
  const weight = float(1).toVar(); // nur für Ridged: Detail folgt den Graten
  const cells = cellsPerVertex.toVar(); // wächst pro Oktave mit der Frequenz

  // Loop mit Uniform als Ende: Oktaven lassen sich live ändern
  Loop({ start: int(0), end: int(uOctaves) }, () => {
    const n = mx_noise_float(q); // Perlin-Noise, ungefähr −1 … 1

    const smoothValue = n.mul(0.5).add(0.5);
    const ridge = float(1).sub(n.abs()).pow(2).toVar();
    const ridgedValue = ridge.mul(weight);
    weight.assign(ridge.mul(1.6).clamp(0, 1));

    // 1 = Gitter löst die Oktave auf, 0 = zu fein → Mittelwert statt Noise
    const resolvable = float(1).sub(smoothstep(0.15, 0.35, cells));
    const value = mix(smoothValue, ridgedValue, uRidged);
    const average = mix(float(0.5), float(0.3), uRidged);
    sum.addAssign(mix(average, value, resolvable).mul(amp));
    norm.addAssign(amp);

    // Nächste Oktave: feiner, flacher – und leicht gedreht (36,9°),
    // damit die Raster der Schichten nicht übereinander liegen
    q.assign(vec2(q.x.mul(0.8).sub(q.y.mul(0.6)), q.x.mul(0.6).add(q.y.mul(0.8))).mul(uLacunarity).add(vec2(13.7, 7.1)));
    amp.mulAssign(uGain);
    cells.mulAssign(uLacunarity);
  });

  return sum.div(norm); // grob 0 … 1, egal wie viele Oktaven
});

// ============================================================
// 4 · TERRAIN – der Endlos-Trick
// ============================================================
// Das Mesh steht still, die Kamera auch. Wir fragen das Noise aber nicht an
// der Mesh-Position ab, sondern an „Mesh-Position gedreht + Offset“.
// Wächst der Offset jedes Frame ein Stück in Flugrichtung, rutscht die ganze
// Landschaft auf uns zu – das Auge liest das als Vorwärtsflug.
// Drehen wir die Abfrage (uHeading), dreht sich die Welt um die Kamera –
// das ist eine Kurve. Die Welt ist dabei unendlich: Noise hat keinen Rand.

// Mesh-Koordinate (x, z) → Koordinate in der unendlichen Noise-Welt
const toWorld = Fn(([xz]) => {
  const c = cos(uHeading);
  const s = sin(uHeading);
  return vec2(xz.x.mul(c).sub(xz.y.mul(s)), xz.x.mul(s).add(xz.y.mul(c))).add(uOffset);
});

// Gitterabstand an der Stelle xz (siehe createGround: Punkte liegen nach
// außen immer lockerer). Ableitung der Verzerrung r = t^1.6 · R:
//   Abstand ≈ 1,6 · R / (Segmente/2) · (r/R)^0,375
const gridSpacing = Fn(([xz]) => {
  const r = xz.x.abs().max(xz.y.abs()); // die gröbere der beiden Achsen
  return r.div(TERRAIN_RADIUS).max(0.001).pow(0.375).mul((1.6 * TERRAIN_RADIUS) / (TERRAIN_SEGMENTS / 2));
});

const terrainHeight = Fn(([xz]) => {
  const cellsPerVertex = gridSpacing(xz).mul(uFrequency);
  const e = fbm(toWorld(xz).mul(uFrequency).add(uSeed), cellsPerVertex);

  // Formen: unten abschneiden (flache Talböden, dort steht später Wasser),
  // dann mit pow() die Gipfel spitzer und die Hänge steiler machen
  const shaped = e.sub(0.3).div(0.55).clamp(0.0001, 1).pow(1.6);

  // Flugtal: entlang der Kamera-Achse (x ≈ 0) wird alles abgesenkt.
  // Die Kamera kann so nie in einen Berg fliegen – und es wirkt wie ein
  // Canyon, durch den man gleitet. Die Kurven macht das Tal automatisch mit.
  const valley = mix(uValleyFloor, float(1), smoothstep(4, 40, xz.x.abs()));

  return shaped.mul(uHeight).mul(valley);
});

// ============================================================
// 5 · TERRAIN – Geometrie
// ============================================================
// Eine flache Platte in der XZ-Ebene, 512 × 512 Segmente = 263.000 Punkte.
// Trick: Die Punkte liegen nicht gleichmäßig. Nah an der Kamera (Mitte)
// dicht, zum Rand hin immer weiter auseinander. Vorne sieht man jedes
// Detail, hinten verschluckt der Nebel ohnehin alles.

function createGround(segments) {
  const geometry = new THREE.PlaneGeometry(2, 2, segments, segments);
  const pos = geometry.attributes.position;
  const warp = (t) => Math.sign(t) * Math.pow(Math.abs(t), 1.6) * TERRAIN_RADIUS;

  for (let i = 0; i < pos.count; i++) {
    // Plane liegt in XY → wir legen sie flach: y wird zu −z
    pos.setXYZ(i, warp(pos.getX(i)), 0, -warp(pos.getY(i)));
  }

  geometry.deleteAttribute("normal"); // Normalen rechnet gleich der Shader
  return geometry;
}

// ============================================================
// 6 · TERRAIN – Displacement + neue Normalen (Vertex-Shader)
// ============================================================
// positionNode ersetzt die Position jedes Punktes: x und z bleiben, y wird
// die Höhe aus dem Noise. Das ist Displacement.
//
// Warum Normalen neu berechnen? Die Platte war flach, ihre Normalen zeigen
// alle stur nach oben. Das Licht wüsste nichts von den Bergen – alles wäre
// gleich hell. Also fragen wir die Höhe auch kurz links/rechts und
// vorne/hinten ab (Finite Differences). Der Höhenunterschied ist die
// Steigung, und aus der Steigung ergibt sich die Normale:
//   n = normalize(hLinks − hRechts, 2·e, hHinten − hVorne)
// Weil die Höhe jedes Frame weiterwandert, muss das im Shader passieren.

const terrainMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });

const flat = positionLocal.xz;
const height = terrainHeight(flat);

// Messabstand = Gitterabstand: nah fein, fern grob. So sieht die Normale
// genau die Form, die das Gitter auch zeigt – kein Flimmern im Licht.
const e = gridSpacing(flat).max(0.15);
const hL = terrainHeight(flat.sub(vec2(e, 0)));
const hR = terrainHeight(flat.add(vec2(e, 0)));
const hB = terrainHeight(flat.sub(vec2(0, e)));
const hF = terrainHeight(flat.add(vec2(0, e)));
const terrainNormal = vec3(hL.sub(hR), e.mul(2), hB.sub(hF)).normalize();

terrainMaterial.positionNode = vec3(positionLocal.x, height, positionLocal.z);
// varying() rechnet im Vertex-Shader und reicht das Ergebnis an die Pixel
const vNormalWorld = varying(terrainNormal, "vNormalWorld");
const vNoisePos = varying(toWorld(flat), "vNoisePos"); // für Detail-Noise in den Farben
terrainMaterial.normalNode = transformNormalToView(vNormalWorld);

// ============================================================
// 7 · TERRAIN – Farbe nach Höhe und Steilheit (Fragment-Shader)
// ============================================================
// Zwei Fragen pro Pixel:
//   Wie hoch?  → positionWorld.y
//   Wie steil? → normal.y (1 = flach, 0 = senkrechte Wand)
// smoothstep(a, b, x) gibt 0 unter a, 1 über b und weich dazwischen.
// mix(A, B, t) blendet damit von Farbe A nach B. Ein kleines Detail-Noise
// verwackelt die Grenzen, sonst sähe man schnurgerade Höhenlinien.

const sand = color("#c9b48c");
const grassDark = color("#2c4220");
const grassLight = color("#5c7a35");
const rock = color("#5e554e");
const rockDark = color("#3a3532");
const snow = color("#f2f5fa");

const y = positionWorld.y;
const slope = vNormalWorld.normalize().y;
const detail = mx_noise_float(vNoisePos.mul(0.25)); // −1 … 1, wandert mit der Welt
// Feines Noise (Wellenlänge < 1) ist in der Ferne kleiner als ein Pixel und
// würde flimmern – darum mit der Entfernung zur Kamera weich ausblenden
const camDistance = positionWorld.sub(cameraPosition).length();
const fine = mx_noise_float(vNoisePos.mul(1.7)).mul(float(1).sub(smoothstep(25, 90, camDistance)));

// Gras in zwei Tönen, fleckig
const grass = mix(grassDark, grassLight, detail.mul(0.5).add(0.5));
// Sand direkt am Wasser → Gras etwas höher
const lowland = mix(sand, grass, smoothstep(uWaterLevel.add(0.4), uWaterLevel.add(1.6), y.add(detail.mul(0.5))));
// Steile Hänge werden Fels – mit dunklen Streifen für Struktur
const rockColor = mix(rockDark, rock, fine.mul(0.5).add(0.5));
const steepness = float(1).sub(smoothstep(0.5, 0.72, slope.add(fine.mul(0.06))));
const withRock = mix(lowland, rockColor, steepness);
// Schnee über der Schneegrenze – aber nur, wo er liegen bleibt (nicht zu steil)
const snowAmount = smoothstep(uSnowLine.sub(1.5), uSnowLine.add(1.5), y.add(detail.mul(3)))
  .mul(smoothstep(0.42, 0.62, slope));
const terrainColor = mix(withRock, snow, snowAmount);
// Unter Wasser: nasser, dunkler Grund
const wet = smoothstep(uWaterLevel.sub(0.4), uWaterLevel.add(0.1), y);

terrainMaterial.colorNode = mix(terrainColor.mul(0.45), terrainColor, wet);
terrainMaterial.roughnessNode = mix(float(0.95), float(0.5), snowAmount);

const terrain = new THREE.Mesh(createGround(TERRAIN_SEGMENTS), terrainMaterial);
terrain.frustumCulled = false; // die echte Höhe kennt nur die GPU
scene.add(terrain);

// ============================================================
// 8 · ATMOSPHÄRE – Himmel als Farbverlauf
// ============================================================
// Eine Funktion für „welche Farbe hat der Himmel in Richtung dir?“.
// Wir brauchen sie dreimal: für den Hintergrund, für die Nebelfarbe und
// für die Spiegelung im Wasser. Weil alle dieselbe Funktion nutzen, passt
// alles automatisch zusammen – der Nebel verschmilzt nahtlos mit dem Horizont.

const skyColor = Fn(([dir]) => {
  const up = dir.y.max(0);
  // pow(< 1) macht das helle Horizontband breiter, oben wird es schnell dunkel
  const gradient = mix(uHorizon, uZenith, up.pow(0.45));

  // Leuchten um die Sonne: breiter Schein + enger, heller Kern
  const toSun = dir.dot(uSunDir).max(0);
  const glow = toSun.pow(6).mul(0.45).add(toSun.pow(48).mul(0.9)).mul(uSunGlow);

  return gradient.add(uSunColor.mul(glow));
});

// Hintergrund: Verlauf + Sonnen-/Mondscheibe + Sterne (nur nachts)
const skyDir = positionWorldDirection;
const sunDisc = smoothstep(0.9994, 0.9997, skyDir.dot(uSunDir)).mul(6);
const starCells = mx_cell_noise_float(skyDir.mul(320));
const stars = smoothstep(0.9965, 1, starCells).mul(smoothstep(0.02, 0.3, skyDir.y)).mul(uStars).mul(3);

scene.backgroundNode = skyColor(skyDir).add(uSunColor.mul(sunDisc)).add(stars);

// ============================================================
// 9 · ATMOSPHÄRE – Distanz- und Höhennebel
// ============================================================
// Echte Luft streut Licht: Je weiter weg, desto mehr nimmt ein Berg die
// Farbe des Himmels an. Das ist der stärkste Tiefen-Hinweis überhaupt.
//   Distanznebel: 1 − exp(−Abstand · Dichte)
//   Höhennebel:   in Tälern dichter, auf Gipfeln dünner (exp über der Höhe)
// Ganz außen geht der Nebel auf 100 %, so sieht man den Rand des Meshes nie.
// scene.fogNode gilt automatisch für alle Materialien der Szene.

const toFragment = positionWorld.sub(cameraPosition);
const fogDistance = toFragment.length();
const viewDir = toFragment.div(fogDistance);

const heightThin = exp(y.sub(uWaterLevel).max(0).mul(-0.12)); // 1 im Tal, → 0 oben
const fogAmount = float(1).sub(exp(fogDistance.mul(uFogDensity).mul(mix(0.35, 1.3, heightThin)).negate()));
const edgeFog = smoothstep(TERRAIN_RADIUS * 0.6, TERRAIN_RADIUS * 0.92, fogDistance);

// Nebelfarbe = Himmelsfarbe in Blickrichtung (unter dem Horizont: Horizontfarbe)
scene.fogNode = fog(skyColor(vec3(viewDir.x, viewDir.y.max(0), viewDir.z)), fogAmount.max(edgeFog));

// ============================================================
// 10 · WASSER – Wellen, Fresnel, Spiegelung
// ============================================================
// Eine zweite Platte auf fester Höhe. Wo das Terrain höher ist, verdeckt es
// das Wasser einfach (Tiefentest) – Seen und Flüsse entstehen von selbst.
//
// Wellen: Wir verschieben nicht die Geometrie, sondern nur die Normalen
// (gleiche Finite-Differences-Idee wie beim Terrain, nur mit kleinem,
// animiertem Noise). Das kostet fast nichts und glitzert trotzdem.
//
// Fresnel: Schaut man steil ins Wasser, sieht man hinein (dunkle Tiefe).
// Schaut man flach darüber, spiegelt es fast nur noch den Himmel.
// Schlick-Formel: f = 0,02 + 0,98 · (1 − cos θ)^5

const waterMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true });

const waterFlat = positionLocal.xz;
waterMaterial.positionNode = vec3(positionLocal.x, uWaterLevel, positionLocal.z);
// Wassertiefe pro Punkt: Wasserspiegel minus Terrainhöhe darunter
const vDepth = varying(uWaterLevel.sub(terrainHeight(waterFlat)), "vDepth");
const vWaterPos = varying(toWorld(waterFlat), "vWaterPos");

const waves = Fn(([p]) => {
  const t = uTime;
  // zwei Wellenlagen, die in verschiedene Richtungen ziehen
  const a = mx_noise_float(p.mul(1.3).add(vec2(t.mul(0.35), t.mul(0.2))));
  const b = mx_noise_float(p.mul(3.1).sub(vec2(t.mul(0.25), t.mul(-0.4)))).mul(0.5);
  return a.add(b);
});

const we = 0.08;
const w0 = waves(vWaterPos);
const waveX = waves(vWaterPos.add(vec2(we, 0))).sub(w0);
const waveZ = waves(vWaterPos.add(vec2(0, we))).sub(w0);
// In der Ferne werden die Wellen flacher: kleiner als ein Pixel würden sie nur flimmern
const waveStrength = float(-0.22 / we).mul(float(1).sub(smoothstep(30, 120, fogDistance).mul(0.85)));
const waterNormal = vec3(waveX.mul(waveStrength), 1, waveZ.mul(waveStrength)).normalize();

const reflected = reflect(viewDir, waterNormal);
const facingWater = viewDir.negate().dot(waterNormal).max(0);
const fresnel = float(1).sub(facingWater).pow(5).mul(0.98).add(0.02);

// Was das Wasser spiegelt: den Himmel (nach oben geklappt) + Glanzpunkt der Sonne
const skyReflection = skyColor(vec3(reflected.x, reflected.y.abs(), reflected.z));
const sunSparkle = reflected.dot(uSunDir).max(0).pow(600).mul(18);

// Eigenfarbe: flach = heller, tief = dunkel
const waterBody = mix(uWaterDeep.mul(1.8), uWaterDeep, smoothstep(0, 4, vDepth));
// Schaumsaum am Ufer, leicht ausgefranst
const foam = float(1).sub(smoothstep(0, 0.25, vDepth.add(w0.mul(0.08)))).mul(0.3);

waterMaterial.colorNode = mix(waterBody, skyReflection.mul(0.85), fresnel)
  .add(uSunColor.mul(sunSparkle))
  .add(foam);
waterMaterial.opacityNode = mix(float(0.55), float(0.95), smoothstep(0, 2.5, vDepth)).max(fresnel);

const water = new THREE.Mesh(createGround(256), waterMaterial);
water.frustumCulled = false;
scene.add(water);

// ============================================================
// 11 · ATMOSPHÄRE – Licht und zwei Stimmungen (Taste L)
// ============================================================
// Sonne = DirectionalLight (paralleles Licht wie von weit weg).
// HemisphereLight = Himmel von oben, Boden-Reflex von unten – füllt die
// Schattenseiten, damit sie nicht schwarz absaufen.

const sun = new THREE.DirectionalLight();
const hemi = new THREE.HemisphereLight();
scene.add(sun, hemi);

const moods = [
  {
    name: "Sonnenuntergang",
    zenith: "#1d2550",
    horizon: "#e8a07e",
    sunColor: "#ffa95e",
    sunDir: new THREE.Vector3(-0.62, 0.1, -1).normalize(),
    sunIntensity: 2.6,
    sunGlow: 1,
    hemiSky: "#8f8fbf",
    hemiGround: "#3a2418",
    hemiIntensity: 0.9,
    waterDeep: "#0b1e2b",
    stars: 0,
  },
  {
    name: "Mondnacht",
    zenith: "#01030b",
    horizon: "#1a2b47",
    sunColor: "#8fb0ff",
    sunDir: new THREE.Vector3(0.45, 0.32, -1).normalize(),
    sunIntensity: 0.9,
    sunGlow: 0.35,
    hemiSky: "#2c4370",
    hemiGround: "#05070d",
    hemiIntensity: 0.5,
    waterDeep: "#030812",
    stars: 1,
  },
];

// Farben einmal als THREE.Color vorbereiten, damit das Überblenden billig ist
for (const m of moods) {
  for (const key of ["zenith", "horizon", "sunColor", "hemiSky", "hemiGround", "waterDeep"]) {
    m[key] = new THREE.Color(m[key]);
  }
}

const moodState = { index: 0, blend: 0 }; // blend: 0 = Stimmung A, 1 = B

function applyMood(t) {
  const [a, b] = moods;
  const k = t * t * (3 - 2 * t); // smoothstep: sanft an- und auslaufen
  uZenith.value.lerpColors(a.zenith, b.zenith, k);
  uHorizon.value.lerpColors(a.horizon, b.horizon, k);
  uSunColor.value.lerpColors(a.sunColor, b.sunColor, k);
  uWaterDeep.value.lerpColors(a.waterDeep, b.waterDeep, k);
  uSunDir.value.lerpVectors(a.sunDir, b.sunDir, k).normalize();
  uSunGlow.value = THREE.MathUtils.lerp(a.sunGlow, b.sunGlow, k);
  uStars.value = THREE.MathUtils.lerp(a.stars, b.stars, k);

  sun.color.copy(uSunColor.value);
  sun.intensity = THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, k);
  sun.position.copy(uSunDir.value).multiplyScalar(100);
  hemi.color.lerpColors(a.hemiSky, b.hemiSky, k);
  hemi.groundColor.lerpColors(a.hemiGround, b.hemiGround, k);
  hemi.intensity = THREE.MathUtils.lerp(a.hemiIntensity, b.hemiIntensity, k);
}

applyMood(0);

function toggleMood() {
  moodState.index = 1 - moodState.index;
  showBadge(moods[moodState.index].name);
}

// ============================================================
// 12 · RENDERING – Bloom + Tone Mapping
// ============================================================
// RenderPipeline ist der neue Name von PostProcessing (seit r183).
// pass() rendert die Szene in eine Textur, bloom() legt einen Lichtschleier
// über alles, was heller als die Schwelle ist (Sonne, Glitzern).
// Das ACES-Tone-Mapping des Renderers hängt die Pipeline automatisch hinten an.

const renderPipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode("output");
const bloomPass = bloom(sceneColor, uBloomStrength, 0.6, 0.75);
renderPipeline.outputNode = sceneColor.add(bloomPass);

// ============================================================
// 13 · RENDERING – Canvas-Formate (Taste F)
// ============================================================

const formats = [
  { name: "Vollbild", width: null, height: null },
  { name: "1:1 · 1080×1080", width: 1080, height: 1080 },
  { name: "16:9 · 1920×1080", width: 1920, height: 1080 },
];
let formatIndex = 0;

function resize() {
  const f = formats[formatIndex];

  if (!f.width) {
    // Höchstens 1,25: Nebel, Himmel und Wasser rechnen pro Pixel – bei Retina (2)
    // wären das 2,5× so viele Pixel und die Bildrate fällt deutlich
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.setSize(window.innerWidth, window.innerHeight);
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
}

window.addEventListener("resize", resize);
resize();

const badge = document.querySelector("#badge");
let badgeTimer;
function showBadge(text) {
  badge.textContent = text;
  badge.classList.add("show");
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => badge.classList.remove("show"), 1400);
}

// ============================================================
// 14 · KAMERA – Flyover und OrbitControls (Taste C)
// ============================================================
// Flyover: Die Kamera bleibt im Ursprung. Bewegt wird nur die Welt
// (uOffset, uHeading – siehe Endlos-Trick). Die Kamera schwebt leicht auf
// und ab und legt sich in Kurven auf die Seite wie ein Flugzeug.
// Handflug: WASD/Pfeile lenken dieselben Werte (Drehung, Höhe), die sonst
// der Autopilot setzt. Nach ein paar Sekunden ohne Taste fliegt er wieder.

const flight = {
  speed: 9, // Grundtempo (GUI)
  heading: 0, // Flugrichtung in Radiant
  turnRate: 0, // aktuelle Drehung pro Sekunde (+ = rechts)
  altitude: 0, // zusätzliche Höhe über der Grundhöhe (Handflug)
  climbRate: 0, // aktuelles Steigen/Sinken pro Sekunde
  boost: 1, // Faktor fürs Tempo (Shift)
  lastInput: -Infinity, // Zeitpunkt der letzten Lenk-Eingabe
  manual: false,
};

// Handflug: Wie lange nach der letzten Taste der Autopilot wieder übernimmt
const AUTOPILOT_RETURN = 4;

const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495; // nicht unter den Boden schauen

let orbitMode = false;

function flightCameraHeight() {
  return uHeight.value * uValleyFloor.value + 4.5;
}

// Gedrückte Tasten merken. event.code statt event.key: „KeyW“ liegt immer
// an derselben Stelle, egal ob QWERTZ, QWERTY oder Feststelltaste
const pressed = new Set();
const isDown = (...codes) => codes.some((c) => pressed.has(c));

function updateFlight(time, delta) {
  // Eingabe: −1, 0 oder +1 pro Achse
  const steer = (isDown("KeyD", "ArrowRight") ? 1 : 0) - (isDown("KeyA", "ArrowLeft") ? 1 : 0);
  const climb = (isDown("KeyW", "ArrowUp") ? 1 : 0) - (isDown("KeyS", "ArrowDown") ? 1 : 0);
  if (steer !== 0 || climb !== 0) flight.lastInput = time;

  const manual = time - flight.lastInput < AUTOPILOT_RETURN;
  if (manual !== flight.manual) {
    flight.manual = manual;
    showBadge(manual ? "Handflug" : "Autopilot");
  }

  // Ziel-Werte: im Handflug aus den Tasten, sonst vom Autopilot.
  // Autopilot-Kurven aus zwei langsamen Sinus mit „krummen“ Frequenzen:
  // mal links, mal rechts, mal geradeaus – wiederholt sich kaum
  const autoTurn = 0.09 * Math.sin(time * 0.071) + 0.05 * Math.sin(time * 0.029 + 1.3);
  const targetTurn = manual ? steer * 0.7 : autoTurn;
  const targetClimb = climb * 9;
  const targetBoost = isDown("ShiftLeft", "ShiftRight") ? 2.5 : 1;

  // Nie springen, immer weich hinziehen (unabhängig von der Bildrate) –
  // so fühlt sich die Steuerung schwer an, wie ein Segelflieger
  const soft = (rate) => 1 - Math.exp(-delta * rate);
  flight.turnRate += (targetTurn - flight.turnRate) * soft(manual ? 3 : 1);
  flight.climbRate += (targetClimb - flight.climbRate) * soft(3);
  flight.boost += (targetBoost - flight.boost) * soft(2);

  // Höhe: nicht unter die Grundhöhe (dort schützt uns das Flugtal),
  // im Autopilot langsam zurück nach unten ins Tal
  flight.altitude = THREE.MathUtils.clamp(flight.altitude + flight.climbRate * delta, 0, 60);
  if (!manual) flight.altitude *= Math.exp(-delta * 0.25);

  // heading größer = Kurve nach rechts (die Welt dreht sich links herum)
  flight.heading += flight.turnRate * delta;

  // Vorwärts in Noise-Richtung = (0, −1) gedreht um heading
  const step = flight.speed * flight.boost * delta;
  uOffset.value.x += Math.sin(flight.heading) * step;
  uOffset.value.y -= Math.cos(flight.heading) * step;
  uHeading.value = flight.heading;

  if (orbitMode) {
    controls.update();
    return;
  }

  const camY = flightCameraHeight() + flight.altitude + Math.sin(time * 0.37) * 0.7;
  camera.position.set(0, camY, 0);
  camera.up.set(0, 1, 0);
  // Leicht nach unten geneigt; beim Steigen hebt sich die Nase, beim Sinken senkt sie sich
  camera.lookAt(0, camY - 4.5 + flight.climbRate * 0.4, -40);
  // In die Kurve legen: Rechtskurve → rechte Seite runter (negatives Rollen)
  camera.rotateZ(-flight.turnRate * 0.6);
}

function toggleCamera() {
  orbitMode = !orbitMode;
  controls.enabled = orbitMode;
  if (orbitMode) {
    camera.up.set(0, 1, 0);
    controls.target.set(0, flightCameraHeight() - 3, -25);
    controls.update();
  }
  canvas.style.cursor = orbitMode ? "grab" : "default";
  showBadge(orbitMode ? "Kamera frei (Orbit)" : "Flyover");
}

// ============================================================
// 15 · GUI – lil-gui + stats.js
// ============================================================

const settings = { ridged: true };

const gui = new GUI({ title: "Terrain" });

const shape = gui.addFolder("Landschaft");
shape.add(uOctaves, "value", 1, 10, 1).name("Oktaven");
shape.add(uFrequency, "value", 0.003, 0.04, 0.0005).name("Frequenz");
shape.add(uHeight, "value", 2, 50, 0.1).name("Berghöhe");
shape.add(settings, "ridged").name("Ridged (Grate)");
shape.add(uWaterLevel, "value", -2, 10, 0.05).name("Wasserhöhe");
shape.add(uSnowLine, "value", 0, 45, 0.1).name("Schneegrenze");

const detailFolder = shape.addFolder("Noise fein").close();
detailFolder.add(uLacunarity, "value", 1.5, 3, 0.01).name("Lacunarity");
detailFolder.add(uGain, "value", 0.25, 0.7, 0.01).name("Gain");
detailFolder.add(uValleyFloor, "value", 0, 1, 0.01).name("Flugtal");

const air = gui.addFolder("Flug & Atmosphäre");
air.add(flight, "speed", 0, 40, 0.1).name("Fluggeschwindigkeit");
air.add(uFogDensity, "value", 0, 0.04, 0.0005).name("Nebeldichte");
air.add(uBloomStrength, "value", 0, 2, 0.01).name("Bloom-Stärke");

function newSeed() {
  uSeed.value.set(Math.random() * 500, Math.random() * 500);
  showBadge(`Seed ${uSeed.value.x.toFixed(0)} · ${uSeed.value.y.toFixed(0)}`);
}
gui.add({ newSeed }, "newSeed").name("Neuer Seed (N)");
gui.add({ toggleMood }, "toggleMood").name("Lichtstimmung (L)");
gui.add({ toggleCamera }, "toggleCamera").name("Kamera (C)");

// stats.js misst die Frame-Zeit
const stats = new Stats();
stats.dom.id = "stats";
document.body.appendChild(stats.dom);

// ============================================================
// 16 · TASTEN
// ============================================================
// WASD / Pfeile fliegen · Shift Boost
// H Panel · F Format · P Screenshot · L Licht · C Kamera · N Seed
// (Screenshot liegt auf P, weil S jetzt sinken heißt)

let screenshotRequested = false;

const FLIGHT_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"];

window.addEventListener("keyup", (event) => pressed.delete(event.code));
// Fenster verliert den Fokus → keyup kommt nie an, also alles loslassen
window.addEventListener("blur", () => pressed.clear());

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;

  if (FLIGHT_KEYS.includes(event.code)) {
    event.preventDefault(); // Pfeiltasten sollen nicht die Seite scrollen
    pressed.add(event.code);
    return;
  }

  const k = event.key.toLowerCase();

  if (k === "h") document.body.classList.toggle("clean");
  if (k === "l") toggleMood();
  if (k === "c") toggleCamera();
  if (k === "n") newSeed();

  if (k === "f") {
    formatIndex = (formatIndex + 1) % formats.length;
    if (formatIndex === 0) canvas.style.width = canvas.style.height = "";
    resize();
    showBadge(formats[formatIndex].name);
  }

  // Nicht sofort speichern: der Canvas ist zwischen zwei Frames leer.
  // Wir merken uns den Wunsch und lesen direkt nach dem nächsten Render.
  if (k === "p") screenshotRequested = true;
});

function saveScreenshot() {
  canvas.toBlob((blob) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `terrain-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, "image/png");
  showBadge("PNG gespeichert");
}

// ============================================================
// 17 · Animation-Loop
// ============================================================

const timer = new THREE.Timer();

renderer.setAnimationLoop((timestamp) => {
  stats.begin();

  timer.update(timestamp);
  // Nach einem Tab-Wechsel nicht mit riesigem Zeitschritt weiterfliegen
  const delta = Math.min(timer.getDelta(), 1 / 30);
  const time = timer.getElapsed();
  uTime.value = time;

  // Weiche Übergänge statt Sprünge: Ridged und Lichtstimmung gleiten hin
  const ease = 1 - Math.exp(-delta * 1.6);
  uRidged.value += ((settings.ridged ? 1 : 0) - uRidged.value) * ease;
  moodState.blend += (moodState.index - moodState.blend) * ease;
  applyMood(moodState.blend);

  updateFlight(time, delta);

  renderPipeline.render();

  if (screenshotRequested) {
    screenshotRequested = false;
    saveScreenshot();
  }

  stats.end();
});
