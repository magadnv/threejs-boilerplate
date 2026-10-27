// ============================================================
// 16 · GPU-Schwarm – 1 Million Partikel, komplett per TSL Compute
// ============================================================
// Die ganze Physik läuft auf der Grafikkarte. JavaScript schiebt pro Frame
// nur ein paar Zahlen (Mausposition, Zeit, Regler) als Uniforms rüber und
// sagt „rechne!“. Die CPU fasst keinen einzigen Partikel an.
//
// Warum GPU? Eine CPU hat ~8–12 Kerne, eine GPU tausende kleine Rechenwerke.
// Jeder Partikel ist unabhängig von den anderen – perfekt, um alle
// gleichzeitig zu rechnen. Außerdem liegen die Daten schon da, wo gezeichnet
// wird: kein Hin- und Herkopieren zwischen Arbeitsspeicher und GPU.

import * as THREE from "three/webgpu";
import {
  Fn,
  instancedArray,
  instanceIndex,
  uniform,
  hash,
  vec3,
  float,
  sin,
  cos,
  acos,
  pow,
  mix,
  smoothstep,
  uv,
  mx_noise_vec3,
  pass,
  PI2,
} from "three/tsl";
// bloom() liegt nicht direkt in three/tsl, sondern bei den Addons
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import GUI from "lil-gui";
import Stats from "stats.js";

// ============================================================
// 1 · SETUP – WebGPU prüfen, Renderer, Szene, Kamera
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
// Compute läuft dann über Transform Feedback, deutlich langsamer.
const renderer = new THREE.WebGPURenderer({
  canvas,
  antialias: false, // bei 1 Mio. Punkten bringt MSAA nichts, kostet nur
  forceWebGL: !(await detectWebGPU()),
});
renderer.toneMapping = THREE.ACESFilmicToneMapping;
await renderer.init(); // erst danach ist klar, welches Backend läuft

const isWebGPU = renderer.backend.isWebGPUBackend === true;

if (!isWebGPU) {
  const notice = document.querySelector("#notice");
  notice.textContent =
    "Kein WebGPU – läuft über WebGL2 mit 100.000 statt 1 Mio. Partikeln. Am besten in Chrome, Edge oder Safari 26 öffnen.";
  notice.hidden = false;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 7);

// ============================================================
// 2 · PARAMETER – Uniforms
// ============================================================
// uniform() ist ein Wert, der im Shader steht, aber von JS aus jederzeit
// geändert werden kann (uFoo.value = 3). Der Shader wird dafür NICHT neu
// gebaut – nur die Zahl im GPU-Speicher wird ersetzt. Ideal für lil-gui.

// Speicher für das Maximum anlegen, die aktive Anzahl ist frei wählbar
const MAX_COUNT = isWebGPU ? 2_000_000 : 200_000;
const countOptions = isWebGPU
  ? { "250.000": 250_000, "500.000": 500_000, "1 Mio.": 1_000_000, "2 Mio.": 2_000_000 }
  : { "25.000": 25_000, "50.000": 50_000, "100.000": 100_000, "200.000": 200_000 };

const settings = { count: isWebGPU ? 1_000_000 : 100_000 };

const uTarget = uniform(new THREE.Vector3()); // Maus (oder Autopilot) in 3D
const uDelta = uniform(0); // Sekunden seit dem letzten Frame
const uTime = uniform(0);
const uPulse = uniform(0); // 1 direkt nach dem Klick, klingt schnell auf 0 ab

const uAttraction = uniform(2.2);
const uNoiseStrength = uniform(2.8);
const uNoiseFrequency = uniform(0.8);
const uDamping = uniform(0.965); // Anteil der Geschwindigkeit, der pro Frame bleibt
const uPulseStrength = uniform(14);
const uSpawnRadius = uniform(2.6);

const uSize = uniform(0.008);
const uBrightness = uniform(0.16);
const uSpeedRange = uniform(2.4); // ab dieser Geschwindigkeit ist ein Partikel „heiß“
const uColorSlow = uniform(new THREE.Color("#1636ff"));
const uColorFast = uniform(new THREE.Color("#ffb070"));
const uBloomStrength = uniform(0.6);

// ============================================================
// 3 · SIMULATION – Speicher auf der GPU
// ============================================================
// instancedArray(anzahl, typ) legt einen Storage-Buffer direkt im
// Grafikspeicher an: ein riesiges Array mit einem vec3 pro Partikel.
// Compute-Shader dürfen ihn lesen UND schreiben, der Vertex-Shader liest ihn
// später fürs Zeichnen. Die Daten verlassen die GPU nie.

const positions = instancedArray(MAX_COUNT, "vec3");
const velocities = instancedArray(MAX_COUNT, "vec3");

// ============================================================
// 4 · SIMULATION – Init-Compute: einmal verteilen
// ============================================================
// Fn(() => { … }) schreibt eine Shader-Funktion in JavaScript. Der Code
// darin rechnet NICHT sofort – jedes .mul(), .add(), sin() baut einen Knoten
// in einem Graphen. Three.js übersetzt den Graphen in WGSL (WebGPU-Shader).
//
// .compute(n) macht daraus einen Compute-Shader, der n-mal parallel läuft.
// instanceIndex ist die Nummer des aktuellen Durchlaufs: 0, 1, 2 … n-1.
// Jeder Durchlauf kümmert sich also um genau einen Partikel.

const initSwarm = Fn(() => {
  const i = instanceIndex;

  // hash() = Pseudo-Zufall auf der GPU: gleicher Eingang → gleiche Zahl (0…1).
  // Verschiedene Offsets liefern drei unabhängige Zufallswerte pro Partikel.
  const u = hash(i);
  const v = hash(i.add(7919));
  const w = hash(i.add(104729));

  // Gleichmäßig in einer Kugel: Winkel zufällig, Radius mit Kubikwurzel,
  // sonst würden sich die Punkte in der Mitte ballen
  const theta = u.mul(PI2);
  const phi = acos(v.mul(2).sub(1));
  const radius = pow(w, 1 / 3).mul(uSpawnRadius);
  const p = vec3(sin(phi).mul(cos(theta)), cos(phi), sin(phi).mul(sin(theta))).mul(radius);

  positions.element(i).assign(p);
  // Kleiner Wirbel um die Y-Achse als Startschwung
  velocities.element(i).assign(vec3(p.z.negate(), 0, p.x).mul(0.4));
})().compute(MAX_COUNT);

// ============================================================
// 5 · SIMULATION – Curl-Noise
// ============================================================
// Normales Noise würde Partikel an manchen Stellen zusammenschieben (Klumpen).
// Curl-Noise ist die „Wirbelstärke“ eines Noise-Feldes: es fließt nur im
// Kreis, nie hinein oder hinaus – wie Rauch oder Wasser. Wir messen die
// Steigung des Feldes per Finite Differences (je ein Schritt vor und zurück
// pro Achse) und kreuzen sie zu einem Wirbel.
// Fn(([p]) => …) ist eine Shader-Funktion mit Parameter, wiederverwendbar.

const curlNoise = Fn(([p]) => {
  const e = float(0.1);
  const dx = vec3(e, 0, 0);
  const dy = vec3(0, e, 0);
  const dz = vec3(0, 0, e);

  const x0 = mx_noise_vec3(p.sub(dx));
  const x1 = mx_noise_vec3(p.add(dx));
  const y0 = mx_noise_vec3(p.sub(dy));
  const y1 = mx_noise_vec3(p.add(dy));
  const z0 = mx_noise_vec3(p.sub(dz));
  const z1 = mx_noise_vec3(p.add(dz));

  const cx = y1.z.sub(y0.z).sub(z1.y.sub(z0.y));
  const cy = z1.x.sub(z0.x).sub(x1.z.sub(x0.z));
  const cz = x1.y.sub(x0.y).sub(y1.x.sub(y0.x));

  return vec3(cx, cy, cz).div(e.mul(2));
});

// ============================================================
// 6 · SIMULATION – Update-Compute: jeden Frame
// ============================================================
// Pro Partikel: Kräfte addieren → Geschwindigkeit ändern → bremsen → bewegen.
// Klassische Euler-Integration, nur eben 1 Mio. Mal gleichzeitig.

const updateSwarm = Fn(() => {
  const position = positions.element(instanceIndex);
  const velocity = velocities.element(instanceIndex);

  // .toVar() kopiert in eine lokale Shader-Variable – wir rechnen damit
  // und schreiben am Ende einmal zurück in den Buffer
  const pos = position.toVar();
  const vel = velocity.toVar();

  const toTarget = uTarget.sub(pos).toVar();
  const dist = toTarget.length().max(0.0001).toVar();
  const dir = toTarget.div(dist).toVar();

  // a) Anziehung: wächst mit dem Abstand, aber gedeckelt –
  //    weit entfernte Partikel rasen nicht, nahe werden nicht eingesaugt
  const force = dir.mul(uAttraction).mul(dist.min(2.5)).toVar();

  // b) Curl-Noise: das Feld wandert langsam nach oben, damit es „atmet“
  const noisePos = pos.mul(uNoiseFrequency).add(vec3(0, uTime.mul(0.15), 0));
  force.addAssign(curlNoise(noisePos).mul(uNoiseStrength));

  // c) Klick: Stoß weg vom Ziel, nah dran viel stärker als weit weg
  force.subAssign(dir.mul(uPulse.mul(uPulseStrength)).div(dist.mul(dist).add(0.15)));

  // Kraft → Geschwindigkeit → Reibung → Position
  vel.addAssign(force.mul(uDelta));
  // Dämpfung bezogen auf 60 fps, damit es bei 120 Hz genauso aussieht
  vel.mulAssign(pow(uDamping, uDelta.mul(60)));
  pos.addAssign(vel.mul(uDelta));

  position.assign(pos);
  velocity.assign(vel);
})().compute(MAX_COUNT);

// Die aktive Anzahl lässt sich ohne Neubau ändern: count steuert, wie viele
// Threads starten (der Rest des Buffers bleibt einfach liegen)
function setCount(count) {
  initSwarm.count = count;
  updateSwarm.count = count;
  particles.count = count;
  renderer.compute(initSwarm);
}

// ============================================================
// 7 · RENDERING – weiche, leuchtende Punkte
// ============================================================
// Ein einziges Sprite, aber mit .count = 1 Mio. Instanzen: die GPU zeichnet
// es 1 Mio. Mal. .toAttribute() liest den Storage-Buffer als
// Instanz-Attribut, d. h. Instanz Nr. 5 bekommt Position Nr. 5.

const material = new THREE.SpriteNodeMaterial({
  transparent: true,
  depthWrite: false, // Partikel verdecken sich nicht gegenseitig …
  blending: THREE.AdditiveBlending, // … sondern addieren ihr Licht
});

material.positionNode = positions.toAttribute();
material.scaleNode = uSize;

// Farbe nach Tempo: ruhig = dunkles Blau, schnell = helles Warm
const speed = velocities.toAttribute().length();
const heat = smoothstep(0, uSpeedRange, speed);
material.colorNode = mix(uColorSlow, uColorFast, heat)
  .mul(mix(float(0.3), float(1.8), heat))
  .mul(uBrightness);

// Runder, weicher Punkt: Abstand zur Sprite-Mitte → Transparenz
const fromCenter = uv().sub(0.5).length();
material.opacityNode = smoothstep(0, 0.5, fromCenter).oneMinus().pow(2);

const particles = new THREE.Sprite(material);
particles.count = settings.count;
particles.frustumCulled = false; // die Bounding-Box kennt die GPU-Positionen nicht
scene.add(particles);

setCount(settings.count);

// ============================================================
// 8 · RENDERING – Post-Processing mit Bloom
// ============================================================
// RenderPipeline ist der neue Name von PostProcessing (seit r183).
// pass() rendert die Szene in eine Textur, bloom() legt einen Leuchtschleier
// über alles, was hell genug ist – auch das ist ein Node-Graph.

const renderPipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode("output");
const bloomPass = bloom(sceneColor, uBloomStrength, 0.5, 0.35);
renderPipeline.outputNode = sceneColor.add(bloomPass);

// ============================================================
// 9 · RENDERING – Canvas-Formate (Taste F)
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
// 10 · GUI – lil-gui + stats.js
// ============================================================

const gui = new GUI({ title: "GPU-Schwarm" });

const sim = gui.addFolder("Schwarm");
sim
  .add(settings, "count", countOptions)
  .name("Partikel")
  .onChange((count) => {
    setCount(count);
    showBadge(`${count.toLocaleString("de-DE")} Partikel`);
  });
sim.add(uAttraction, "value", 0, 8, 0.01).name("Anziehung");
sim.add(uNoiseStrength, "value", 0, 6, 0.01).name("Noise-Stärke");
sim.add(uNoiseFrequency, "value", 0.05, 2.5, 0.01).name("Noise-Frequenz");
sim.add(uDamping, "value", 0.85, 0.995, 0.001).name("Dämpfung");
sim.add(uPulseStrength, "value", 0, 40, 0.1).name("Klick-Impuls");

const look = gui.addFolder("Look");
look.add(uSize, "value", 0.002, 0.06, 0.001).name("Partikelgröße");
look.add(uBrightness, "value", 0.05, 2, 0.01).name("Helligkeit");
look.addColor(uColorSlow, "value").name("Farbe langsam");
look.addColor(uColorFast, "value").name("Farbe schnell");
look.add(uSpeedRange, "value", 0.3, 8, 0.01).name("Tempo für „heiß“");
look.add(uBloomStrength, "value", 0, 2, 0.01).name("Bloom-Stärke");

// stats.js misst die Frame-Zeit: 60 (oder 120) fps = die GPU schafft es locker
const stats = new Stats();
stats.dom.id = "stats";
document.body.appendChild(stats.dom);

// ============================================================
// 11 · CONTROLS – Maus, Autopilot, Klick
// ============================================================
// Die Maus ist 2D, der Schwarm 3D. Wir schießen einen Strahl von der Kamera
// durch den Mauspunkt und schneiden ihn mit einer unsichtbaren Ebene durch
// den Ursprung, die zur Kamera schaut. Der Schnittpunkt ist das Ziel.

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const plane = new THREE.Plane();
const planeNormal = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();

let autopilot = true; // ohne Maus sofort Bewegung
let autopilotPinned = false; // per A eingeschaltet → Maus schaltet ihn nicht ab
let pointerOnCanvas = false;

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  pointerOnCanvas = true;
  if (autopilot && !autopilotPinned) autopilot = false;
});
canvas.addEventListener("pointerleave", () => (pointerOnCanvas = false));
canvas.addEventListener("pointerdown", () => (uPulse.value = 1));

function updateTarget(time, delta) {
  if (autopilot) {
    // Lissajous-Kurve: drei Sinus mit „krummen“ Frequenzen –
    // die Bahn wiederholt sich kaum und wirkt trotzdem ruhig
    desiredTarget.set(
      2.4 * Math.sin(time * 0.53),
      1.4 * Math.sin(time * 0.79 + 0.6),
      1.0 * Math.sin(time * 0.31)
    );
  } else if (pointerOnCanvas) {
    planeNormal.copy(camera.position).normalize();
    plane.setFromNormalAndCoplanarPoint(planeNormal, scene.position);
    raycaster.setFromCamera(pointer, camera);
    raycaster.ray.intersectPlane(plane, desiredTarget);
  }

  // Weich nachziehen statt springen, unabhängig von der Bildrate
  uTarget.value.lerp(desiredTarget, 1 - Math.exp(-delta * 8));
}

// ============================================================
// 12 · CONTROLS – Tasten
// ============================================================
// H Panel · F Format · S Screenshot · R Reset · A Autopilot · Leertaste Impuls

let screenshotRequested = false;

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const k = event.key.toLowerCase();

  if (k === "h") document.body.classList.toggle("clean");

  if (k === "f") {
    formatIndex = (formatIndex + 1) % formats.length;
    if (formatIndex === 0) canvas.style.width = canvas.style.height = "";
    resize();
    showBadge(formats[formatIndex].name);
  }

  if (k === "r") {
    renderer.compute(initSwarm);
    showBadge("Reset");
  }

  if (k === "a") {
    autopilot = !autopilot;
    autopilotPinned = autopilot;
    showBadge(autopilot ? "Autopilot an" : "Autopilot aus");
  }

  if (k === " ") {
    event.preventDefault();
    uPulse.value = 1;
  }

  // Nicht sofort speichern: der Canvas ist zwischen zwei Frames leer.
  // Wir merken uns den Wunsch und lesen direkt nach dem nächsten Render.
  if (k === "s") screenshotRequested = true;
});

function saveScreenshot() {
  canvas.toBlob((blob) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `gpu-schwarm-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, "image/png");
  showBadge("PNG gespeichert");
}

// ============================================================
// 13 · Animation-Loop
// ============================================================
// setAnimationLoop statt requestAnimationFrame: der Renderer stimmt den
// Takt selbst ab (auch für WebXR) und wartet, bis WebGPU bereit ist.

const timer = new THREE.Timer();

renderer.setAnimationLoop((timestamp) => {
  stats.begin();

  timer.update(timestamp);
  // Nach einem Tab-Wechsel nicht mit riesigem Zeitschritt weiterrechnen
  const delta = Math.min(timer.getDelta(), 1 / 30);
  const time = timer.getElapsed();

  // Kamera pendelt sanft, damit man die Tiefe des Schwarms sieht
  camera.position.x = Math.sin(time * 0.11) * 1.6;
  camera.position.y = Math.sin(time * 0.07) * 0.6;
  camera.lookAt(scene.position);

  updateTarget(time, delta);

  uDelta.value = delta;
  uTime.value = time;
  uPulse.value *= Math.exp(-delta * 10); // Impuls klingt in ~0,3 s ab

  // 1) Physik auf der GPU, 2) Bild rendern – beides ohne CPU-Partikelarbeit
  renderer.compute(updateSwarm);
  renderPipeline.render();

  if (screenshotRequested) {
    screenshotRequested = false;
    saveScreenshot();
  }

  stats.end();
});
