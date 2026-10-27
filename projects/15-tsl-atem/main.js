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
};

// Eigene Zeit statt des fertigen `time`-Nodes:
// time.mul(speed) würde beim Verschieben des Reglers springen
// (100 s × 0.35 → 100 s × 0.5 = großer Sprung). Wir zählen deshalb in JS
// selbst hoch: phase += delta × speed – so bleibt die Bewegung weich.
const phase = uniform(0);

// ============================================================
// 3 · Vertex-Displacement – die Kugel atmet
// ============================================================

// a) Wo fragen wir das Rauschen ab? Die Position auf der Kugel,
//    skaliert mit der Frequenz (größer = kleinere, unruhigere Beulen),
//    plus ein Versatz, der mit der Zeit wandert → das Muster fließt.
const p = positionLocal
  .mul(params.noiseFrequency)
  .add(vec3(phase.mul(0.6), phase, phase.mul(-0.4)));

// b) mx_noise_float = Perlin-Rauschen aus MaterialX, Werte ca. −1 … +1.
//    Zwei Lagen: eine große, langsame Welle + eine feine, halb so starke.
//    Das macht die Bewegung organisch statt gleichförmig.
const noiseLarge = mx_noise_float(p);
const noiseFine = mx_noise_float(p.mul(2.3).add(7.1)).mul(0.35);

// c) Ein ganz langsames Ein- und Ausatmen der ganzen Kugel (sin über die Zeit)
const breath = sin(phase.mul(1.6)).mul(0.04);

// d) Summe = wie weit sich dieser Punkt nach außen (+) oder innen (−) schiebt
const displacement = noiseLarge.add(noiseFine).mul(params.noiseStrength).add(breath);

// e) Neue Position = alte Position + Normale × Verschiebung.
//    Die Normale zeigt auf einer Kugel immer nach außen.
const displacedPosition = positionLocal.add(normalLocal.mul(displacement));

// f) varying() reicht den Wert vom Vertex- an den Fragment-Shader weiter.
//    So wird das Rauschen nur pro Ecke berechnet, nicht pro Pixel noch einmal.
const vDisplacement = varying(displacement, "vDisplacement");

// ============================================================
// 4 · Farbe – Täler dunkel, Wölbungen hell
// ============================================================

// smoothstep macht aus der Verschiebung (ca. −0.3 … +0.3) einen weichen
// Wert 0 … 1. mix() blendet damit zwischen Farbe A und B.
const heat = smoothstep(-0.12, 0.3, vDisplacement);
const surfaceColor = mix(params.colorA, params.colorB, heat);

// ============================================================
// 5 · Fresnel-Glow am Rand
// ============================================================

// normalView = wohin die Oberfläche aus Sicht der Kamera zeigt
// positionViewDirection = Richtung vom Punkt zur Kamera
// dot() ist 1, wenn die Fläche uns direkt anschaut (Mitte),
// und 0, wenn sie seitlich wegkippt (Rand). 1 − dot → Rand hell.
const facing = normalView.dot(positionViewDirection).clamp(0, 1);
const fresnel = float(1).sub(facing).pow(3.5); // pow schärft den Rand

// Glühfarbe: Farbe B Richtung Weiß aufgehellt, damit der Rand „brennt“
const glowColor = mix(params.colorB, vec3(1, 0.85, 0.85), 0.25);

// Rand-Glow + ein Hauch Eigenleuchten auf den höchsten Wölbungen
const emissive = glowColor
  .mul(fresnel)
  .mul(params.fresnelStrength)
  .add(params.colorB.mul(heat.pow(4)).mul(0.6));

// ============================================================
// 6 · Material und Kugel
// ============================================================

const material = new THREE.MeshStandardNodeMaterial({
  roughness: 0.32,
  metalness: 0.15,
});
material.positionNode = displacedPosition; // Vertex-Shader: neue Form
material.colorNode = surfaceColor; // Fragment-Shader: Grundfarbe
material.emissiveNode = emissive; // Fragment-Shader: Eigenleuchten

// Viele Segmente, damit das Displacement weich aussieht
const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 256), material);
scene.add(sphere);

// ============================================================
// 7 · Post-Processing – dezenter Bloom
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
// 8 · Canvas-Formate (Taste F)
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
// 9 · GUI
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

// ============================================================
// 10 · Tasten: H (Panel), F (Format), S (Screenshot)
// ============================================================

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
// 11 · Animation-Loop
// ============================================================

const timer = new THREE.Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  phase.value += timer.getDelta() * params.speed.value;

  controls.update();
  renderPipeline.render();

  if (screenshotRequested) {
    screenshotRequested = false;
    saveScreenshot();
  }
});
