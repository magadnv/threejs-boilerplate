// ============================================================
// 15 · TSL Atem – eine glühende Kugel, komplett in TSL
// ============================================================
// TSL (Three Shading Language) = Shader als JavaScript-Bausteine („Nodes“).
// Jede Funktion wie mix(), sin(), mx_noise_float() baut keinen Wert,
// sondern einen Knoten im Shader-Graphen. Three.js übersetzt diesen Graphen
// selbst in WGSL (WebGPU) oder GLSL (WebGL2-Fallback).

import * as THREE from "three/webgpu";
import {
  uniform,
  positionLocal,
  normalLocal,
  normalView,
  positionViewDirection,
  mx_noise_float,
  vec3,
  float,
  mix,
  smoothstep,
  sin,
  varying,
  Fn,
  select,
  cross,
  distance,
  transformNormalToView,
  pass,
} from "three/tsl";
// bloom() liegt nicht in three/tsl, sondern bei den Addons
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

// ============================================================
// 1 · Renderer, Szene, Kamera
// ============================================================

const canvas = document.querySelector("#scene");

// WebGPURenderer nimmt WebGPU, wenn der Browser es kann, sonst WebGL2
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 6);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 3.5;
controls.maxDistance = 12;

// Wenig Licht, viel Kontrast: ein Hauptlicht schräg oben, ein kühles Kantenlicht
scene.add(new THREE.AmbientLight(0xffffff, 0.08));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x8899ff, 1.2);
rim.position.set(-5, -2, -4);
scene.add(rim);

// ============================================================
// 2 · Uniforms – Werte, die wir aus JS live ändern
// ============================================================
// uniform() erzeugt einen Node, dessen .value wir jederzeit setzen können,
// ohne dass der Shader neu gebaut wird. Genau das braucht das GUI.

const params = {
  noiseStrength: uniform(0.28),
  noiseFrequency: uniform(1.35),
  speed: uniform(0.35),
  colorA: uniform(new THREE.Color("#14020a")), // Täler: fast schwarzes Rot
  colorB: uniform(new THREE.Color("#cf1830")), // Wölbungen: madebymaga-Rot
  fresnelStrength: uniform(1.3),
  bloomStrength: uniform(0.4),
  // Extras
  bumpLight: uniform(1), // 0 = glatte Kugel-Normalen, 1 = Licht folgt jeder Beule
  heartbeat: uniform(0), // 0 = ruhiges Atmen, 1 = Herzschlag
  magnetStrength: uniform(0.3), // wie weit die Maus die Haut herauszieht
  magnetRadius: uniform(0.7), // wie groß die Beule unter der Maus ist
};

// Eigene Zeit statt des fertigen `time`-Nodes:
// time.mul(speed) würde beim Verschieben des Reglers springen
// (100 s × 0.35 → 100 s × 0.5 = großer Sprung). Wir zählen deshalb in JS
// selbst hoch: phase += delta × speed – so bleibt die Bewegung weich.
const phase = uniform(0);

// Maus auf der Kugel: Richtung vom Mittelpunkt zum Treffpunkt
// und wie stark der Magnet gerade an ist (0 … 1, weich ein- und ausgeblendet)
const mouseDir = uniform(new THREE.Vector3(0, 0, 1));
const mouseActive = uniform(0);

// ============================================================
// 3 · Rhythmus – Atem oder Herzschlag
// ============================================================

// Atem: ein langsames sin über die Zeit, die ganze Kugel schwillt sanft
const breath = sin(phase.mul(1.6)).mul(0.04);

// Herzschlag: sin().max(0) schneidet die negative Hälfte ab,
// pow(14) macht aus dem runden Buckel einen kurzen, harten Schlag.
// Zwei Schläge kurz hintereinander = „ba-bumm“.
const beatWave = (x) => sin(x).max(0).pow(14);
const beatX = phase.mul(18); // bei Geschwindigkeit 0.35 ≈ 60 Schläge pro Minute
const beat = beatWave(beatX).add(beatWave(beatX.sub(0.9)).mul(0.6));

// mix() blendet per Regler zwischen beiden Rhythmen
const rhythm = mix(breath, beat.mul(0.1), params.heartbeat);

// ============================================================
// 4 · Vertex-Displacement – die Kugel atmet
// ============================================================
// Fn() baut eine wiederverwendbare Shader-Funktion. Wir brauchen die
// Verschiebung gleich dreimal (Punkt + zwei Nachbarn für die Normalen),
// deshalb steckt sie in einer Funktion statt in einer festen Kette.
// Auf einer Kugel mit Radius 1 ist die Normale gleich der Position,
// deshalb reicht als Eingang die Richtung `dir`.

// Magnet: 1 direkt unter der Maus, weich abfallend bis 0 am Radius-Rand.
// distance() misst den Abstand zweier Punkte auf der Kugel.
const magnetAt = Fn(([dir]) => {
  const d = distance(dir, mouseDir);
  return float(1).sub(smoothstep(0, params.magnetRadius, d)).mul(mouseActive);
});

const displace = Fn(([dir]) => {
  // a) Wo fragen wir das Rauschen ab? Die Richtung, skaliert mit der
  //    Frequenz (größer = kleinere Beulen), plus ein Versatz, der mit der
  //    Zeit wandert → das Muster fließt.
  const p = dir.mul(params.noiseFrequency).add(vec3(phase.mul(0.6), phase, phase.mul(-0.4)));

  // b) mx_noise_float = Perlin-Rauschen aus MaterialX, Werte ca. −1 … +1.
  //    Zwei Lagen: eine große, langsame Welle + eine feine, schwächere.
  //    Das macht die Bewegung organisch statt gleichförmig.
  const noiseLarge = mx_noise_float(p);
  const noiseFine = mx_noise_float(p.mul(2.3).add(7.1)).mul(0.35);

  // c) Summe = wie weit sich dieser Punkt nach außen (+) oder innen (−)
  //    schiebt: Rauschen + Rhythmus + Beule unter der Maus
  return noiseLarge
    .add(noiseFine)
    .mul(params.noiseStrength)
    .add(rhythm)
    .add(magnetAt(dir).mul(params.magnetStrength));
});

const displacement = displace(normalLocal);

// d) Neue Position = alte Position + Normale × Verschiebung.
//    Die Normale zeigt auf einer Kugel immer nach außen.
const displacedPosition = positionLocal.add(normalLocal.mul(displacement));

// e) varying() reicht Werte vom Vertex- an den Fragment-Shader weiter.
//    So wird das Rauschen nur pro Ecke berechnet, nicht pro Pixel noch einmal.
const vDisplacement = varying(displacement, "vDisplacement");
const vMagnet = varying(magnetAt(normalLocal), "vMagnet");

// ============================================================
// 5 · Normalen neu berechnen – Licht fängt jede Beule
// ============================================================
// positionNode verschiebt nur die Punkte. Die Normalen zeigen danach noch
// wie bei einer glatten Kugel, deshalb sieht das Licht die Beulen nicht.
// Lösung (Finite Differences): Wir verschieben zwei Nachbarpunkte ein
// winziges Stück daneben genauso und spannen aus den beiden Kanten mit
// cross() eine neue Fläche auf. Ihre Senkrechte ist die neue Normale.

const bumpedNormal = Fn(() => {
  const n = normalLocal;

  // Zwei Richtungen, die auf der Kugel entlang laufen (Tangente t, Bitangente b).
  // cross(a, b) liefert einen Vektor, der senkrecht auf beiden steht.
  // Am Pol wäre (0,1,0) parallel zur Normalen → dort mit (1,0,0) helfen.
  const helper = select(n.y.abs().greaterThan(0.99), vec3(1, 0, 0), vec3(0, 1, 0));
  const t = cross(n, helper).normalize();
  const b = cross(n, t).normalize();

  // Zwei Nachbar-Richtungen, ein kleines Stück daneben
  const eps = 0.01;
  const nT = n.add(t.mul(eps)).normalize();
  const nB = n.add(b.mul(eps)).normalize();

  // Alle drei Punkte verschieben: Richtung × (Radius 1 + Verschiebung)
  const p0 = n.mul(displace(n).add(1));
  const pT = nT.mul(displace(nT).add(1));
  const pB = nB.mul(displace(nB).add(1));

  // Kanten zu den Nachbarn → cross → neue Normale (zeigt nach außen)
  return cross(pT.sub(p0), pB.sub(p0)).normalize();
})();

// Regler „Licht-Beulen“ blendet zwischen glatter und neuer Normale.
// transformNormalToView bringt sie in den Kamera-Raum, den das Material erwartet.
const finalNormal = mix(normalLocal, bumpedNormal, params.bumpLight).normalize();
const vNormal = varying(transformNormalToView(finalNormal), "vBumpNormal");

// ============================================================
// 6 · Farbe – Täler dunkel, Wölbungen hell
// ============================================================

// smoothstep macht aus der Verschiebung (ca. −0.3 … +0.3) einen weichen
// Wert 0 … 1. mix() blendet damit zwischen Farbe A und B.
const heat = smoothstep(-0.12, 0.3, vDisplacement);
const surfaceColor = mix(params.colorA, params.colorB, heat);

// ============================================================
// 7 · Fresnel-Glow am Rand
// ============================================================

// normalView = wohin die Oberfläche aus Sicht der Kamera zeigt
// (seit wir material.normalNode setzen, ist das unsere neue Normale)
// positionViewDirection = Richtung vom Punkt zur Kamera
// dot() ist 1, wenn die Fläche uns direkt anschaut (Mitte),
// und 0, wenn sie seitlich wegkippt (Rand). 1 − dot → Rand hell.
const facing = normalView.dot(positionViewDirection).clamp(0, 1);
const fresnel = float(1).sub(facing).pow(3.5); // pow schärft den Rand

// Glühfarbe: Farbe B Richtung Weiß aufgehellt, damit der Rand „brennt“
const glowColor = mix(params.colorB, vec3(1, 0.85, 0.85), 0.25);

// Beim Herzschlag blitzt der Rand mit jedem Schlag auf
const pulseGlow = float(1).add(beat.mul(params.heartbeat).mul(1.5));

// Rand-Glow + Eigenleuchten auf den höchsten Wölbungen + Glut unter der Maus
const emissive = glowColor
  .mul(fresnel)
  .mul(params.fresnelStrength)
  .mul(pulseGlow)
  .add(params.colorB.mul(heat.pow(4)).mul(0.6))
  .add(glowColor.mul(vMagnet.pow(2)).mul(params.magnetStrength).mul(2));

// ============================================================
// 8 · Material und Kugel
// ============================================================

const material = new THREE.MeshStandardNodeMaterial({
  roughness: 0.32,
  metalness: 0.15,
});
material.positionNode = displacedPosition; // Vertex-Shader: neue Form
material.colorNode = surfaceColor; // Fragment-Shader: Grundfarbe
material.emissiveNode = emissive; // Fragment-Shader: Eigenleuchten
material.normalNode = vNormal.normalize(); // Fragment-Shader: neue Normale fürs Licht

// Viele Segmente, damit das Displacement weich aussieht
const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 256), material);
scene.add(sphere);

// ============================================================
// 9 · Post-Processing – dezenter Bloom
// ============================================================
// RenderPipeline ist der neue Name von PostProcessing (seit r183).

const renderPipeline = new THREE.RenderPipeline(renderer);

// pass() rendert die Szene in eine Textur; daraus holen wir die Farbe
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode("output");

// bloom(Eingang, Stärke, Radius, Schwelle) – die Stärke ist unser Uniform,
// die Schwelle sorgt dafür, dass nur helle Stellen (Rand, Wölbungen) leuchten
const bloomPass = bloom(sceneColor, params.bloomStrength, 0.4, 0.2);

// Endbild = Szene + Leuchtschleier
renderPipeline.outputNode = sceneColor.add(bloomPass);

// ============================================================
// 10 · Canvas-Formate (Taste F)
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
// 11 · GUI
// ============================================================

const gui = new GUI({ title: "TSL Atem" });

const shape = gui.addFolder("Form");
shape.add(params.noiseStrength, "value", 0, 0.8, 0.01).name("Noise-Stärke");
shape.add(params.noiseFrequency, "value", 0.2, 4, 0.01).name("Noise-Frequenz");
shape.add(params.speed, "value", 0, 2, 0.01).name("Geschwindigkeit");

const look = gui.addFolder("Farbe & Glow");
look.addColor(params.colorA, "value").name("Farbe A (Tal)");
look.addColor(params.colorB, "value").name("Farbe B (Wölbung)");
look.add(params.fresnelStrength, "value", 0, 6, 0.01).name("Fresnel-Stärke");
look.add(params.bloomStrength, "value", 0, 2, 0.01).name("Bloom-Stärke");

const extras = gui.addFolder("Extras");
extras.add(params.bumpLight, "value", 0, 1, 0.01).name("Licht-Beulen");
extras.add(params.heartbeat, "value", 0, 1, 0.01).name("Atem ↔ Herzschlag");
extras.add(params.magnetStrength, "value", 0, 0.8, 0.01).name("Magnet-Stärke");
extras.add(params.magnetRadius, "value", 0.1, 1.5, 0.01).name("Magnet-Radius");

// ============================================================
// 11b · Zufalls-Farben (Taste R, zurück mit Z)
// ============================================================
// Nicht völlig wild würfeln, sondern nach Farbharmonie: Farbe A ist immer
// ein sehr dunkler Ton (Täler), Farbe B ein satter, heller (Wölbungen).
// Der Farbton von B hängt über eine Regel am Farbton von A.

const harmonies = [
  { name: "Ton in Ton", offset: () => 0 },
  { name: "Nachbarn", offset: () => (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 25) },
  { name: "Gegenfarbe", offset: () => 180 + (Math.random() - 0.5) * 30 },
  { name: "Dreiklang", offset: () => (Math.random() < 0.5 ? 120 : 240) },
];

const colorHistory = [];
const fade = { from: [new THREE.Color(), new THREE.Color()], to: [new THREE.Color(), new THREE.Color()], t: 1 };

function fadeTo(a, b, label) {
  fade.from[0].copy(params.colorA.value);
  fade.from[1].copy(params.colorB.value);
  fade.to[0].copy(a);
  fade.to[1].copy(b);
  fade.t = 0;
  showBadge(`${label} · #${a.getHexString()} / #${b.getHexString()}`);
}

function randomColors() {
  colorHistory.push([params.colorA.value.clone(), params.colorB.value.clone()]);

  const harmony = harmonies[Math.floor(Math.random() * harmonies.length)];
  const hueA = Math.random() * 360;
  const hueB = (hueA + harmony.offset() + 360) % 360;

  // setHSL: Farbton 0…1, Sättigung 0…1, Helligkeit 0…1
  const a = new THREE.Color().setHSL(hueA / 360, 0.6 + Math.random() * 0.35, 0.03 + Math.random() * 0.05);
  const b = new THREE.Color().setHSL(hueB / 360, 0.75 + Math.random() * 0.25, 0.32 + Math.random() * 0.14);
  fadeTo(a, b, harmony.name);
}

function previousColors() {
  const last = colorHistory.pop();
  if (last) fadeTo(last[0], last[1], "Zurück");
}

// Weich überblenden statt springen – sieht auch im Clip gut aus
function updateFade(delta) {
  if (fade.t >= 1) return;
  fade.t = Math.min(1, fade.t + delta / 0.6);
  const k = fade.t * fade.t * (3 - 2 * fade.t); // smoothstep in JS
  params.colorA.value.lerpColors(fade.from[0], fade.to[0], k);
  params.colorB.value.lerpColors(fade.from[1], fade.to[1], k);
  look.controllers.forEach((c) => c.updateDisplay()); // GUI-Farbfelder mitziehen
}

look.add({ randomColors }, "randomColors").name("🎲 Zufall (R)");
look.add({ previousColors }, "previousColors").name("↩ Zurück (Z)");

// ============================================================
// 12 · Maus-Magnet
// ============================================================
// Die Kugel liegt im Ursprung und dreht sich nicht (nur die Kamera kreist),
// deshalb ist Welt- gleich Objekt-Raum. Statt gegen 130.000 Dreiecke zu
// raycasten, schneiden wir den Mausstrahl mit einer gedachten Kugel –
// mathematisch exakt und praktisch kostenlos.

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hitSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
const hitPoint = new THREE.Vector3();
let pointerOnCanvas = false;

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  pointerOnCanvas = true;
});
canvas.addEventListener("pointerleave", () => (pointerOnCanvas = false));

function updateMagnet(delta) {
  let target = 0;

  if (pointerOnCanvas) {
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectSphere(hitSphere, hitPoint)) {
      // Richtung weich nachziehen, damit die Beule der Maus „folgt“
      mouseDir.value.lerp(hitPoint.normalize(), 0.15).normalize();
      target = 1;
    }
  }

  // Ein- und Ausblenden über ~¼ Sekunde statt hart an/aus
  mouseActive.value += (target - mouseActive.value) * Math.min(1, delta * 4);
}

// ============================================================
// 13 · Tasten: H (Panel), F (Format), S (Screenshot)
// ============================================================

let screenshotRequested = false;

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const k = event.key.toLowerCase();

  if (k === "h") document.body.classList.toggle("clean");
  if (k === "r") randomColors();
  if (k === "z") previousColors();

  if (k === "f") {
    formatIndex = (formatIndex + 1) % formats.length;
    if (formatIndex === 0) canvas.style.width = canvas.style.height = "";
    resize();
    showBadge(formats[formatIndex].name);
  }

  // Nicht sofort speichern: der Canvas ist zwischen zwei Frames leer.
  // Wir merken uns den Wunsch und lesen direkt nach dem nächsten Render.
  if (k === "s") screenshotRequested = true;
});

function saveScreenshot() {
  canvas.toBlob((blob) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `tsl-atem-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, "image/png");
  showBadge("PNG gespeichert");
}

// ============================================================
// 14 · Animation-Loop
// ============================================================

const timer = new THREE.Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  phase.value += delta * params.speed.value;

  updateMagnet(delta);
  updateFade(delta);
  controls.update();
  renderPipeline.render();

  if (screenshotRequested) {
    screenshotRequested = false;
    saveScreenshot();
  }
});
