// ============================================================
// SCENE – ein leuchtender Kern, Tausende Splitter, drei Lichter
// ============================================================
// Jeder Splitter kennt DREI Plätze, als Instanz-Attribute auf der GPU:
//   aSphere  – auf der Kugeloberfläche (Kapitel 1)
//   aScatter – verstreut entlang des Kamerapfads (Kapitel 2–3)
//   aSeal    – im madebymaga-Siegel, Ring + kursives m (Kapitel 4–5)
//
// Zwei TSL-uniforms entscheiden, wo er gerade ist:
//   scatter 0→1 : Kugel → Wolke     form 0→1 : Wolke → Siegel
// GSAP verändert nur diese zwei Zahlen. Die eigentliche Bewegung von
// Tausenden Teilen rechnet der Vertex-Shader – kein JS-Loop über Instanzen.

import * as THREE from "three/webgpu";
import {
  instancedBufferAttribute,
  positionLocal,
  uniform,
  mix,
  smoothstep,
  sin,
  cos,
  pow,
  float,
  vec3,
  time,
  rotate,
  fog,
  densityFogFactor,
  reference,
  color,
  distance,
  cameraPosition,
  PI,
  PI2,
} from "three/tsl";
import { SEAL_CENTER } from "./camera-path.js";

// Alle Werte, die die Kapitel animieren – an einem Ort
export const U = {
  scatter: uniform(0),
  form: uniform(0),
  spin: uniform(0), // Drehgeschwindigkeit – GSAP tweent sie, main.js summiert sie auf
  spinAngle: uniform(0), // aufsummierter Winkel (nicht time × spin, sonst ruckt es beim Tweenen)
  motion: uniform(1), // 0 bei prefers-reduced-motion: kein Atmen, kein Treiben
  glow: uniform(1.1),
  colorA: uniform(new THREE.Color("#e4ecff")),
  colorB: uniform(new THREE.Color("#5e7cff")),
  coreColor: uniform(new THREE.Color("#cfdcff")),
  coreGlow: uniform(3),
  // Siegel: Lichtschimmer + zwei versteckte Entdeckungen (Maus drückt, Klick stempelt)
  sweep: uniform(-6), // Position des Schimmers quer über das Siegel
  pointer: uniform(new THREE.Vector3(0, 0, -100)), // Maus auf der Siegel-Ebene
  pointerAmt: uniform(0),
  stamp: uniform(0),
  egg: uniform(0), // Easter Egg 1: 0 = Siegel, 1 = „hey.“
  charge: uniform(0), // Easter Egg 2: Kugel gedrückt halten → lädt auf 0..1
  burst: uniform(0), // … und explodiert, federt zurück
  gold: uniform(0), // Easter Egg 3: Gold-Edition
  tilt: uniform(new THREE.Vector2()), // Easter Egg 5: Kuzushi – Siegel kippt um die Mitte
  paper: uniform(0), // Easter Egg 6: Paper Edition – Tinte auf Papier statt Licht im Dunkeln
};

// Wie weit der Zeitversatz zwischen den Splittern reicht (0 = alle gleichzeitig)
const SPREAD = 0.7;

// Lokaler Fortschritt eines Splitters: startet je nach `delay` früher oder später
// und läuft weich an und aus. So zerfällt die Kugel nicht auf einen Schlag.
const ease = (p, delay) => smoothstep(0, 1, p.mul(1 + SPREAD).sub(delay.mul(SPREAD)));

// Eine Form abtasten: Canvas zeichnen, jedes deckende Pixel ist ein möglicher
// Platz für einen Splitter. `size` = Breite in Welt-Einheiten, Mitte = Siegel.
function sampleCanvas(canvas, count, size) {
  const { width: W, height: H } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, W, H).data;

  const pixels = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 140) pixels.push(x, y);
    }
  }

  const out = new Float32Array(count * 3);
  const n = pixels.length / 2;
  for (let i = 0; i < count; i++) {
    const j = Math.floor(Math.random() * n) * 2;
    out[i * 3 + 0] = SEAL_CENTER.x + (pixels[j] / W - 0.5) * size;
    out[i * 3 + 1] = SEAL_CENTER.y - ((pixels[j + 1] - H / 2) / W) * size;
    out[i * 3 + 2] = SEAL_CENTER.z + (Math.random() - 0.5) * 0.22;
  }
  return out;
}

function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext("2d", { willReadFrequently: true })];
}

// Siegel aus dem echten SVG
async function sampleSeal(count, size) {
  const img = new Image();
  img.src = `${import.meta.env.BASE_URL}siegel.svg`;
  await img.decode();
  const [canvas, ctx] = makeCanvas(400, 400);
  ctx.drawImage(img, 0, 0, 400, 400);
  return sampleCanvas(canvas, count, size);
}

// Easter Egg: dieselben Splitter schreiben „hey.“ in der Titelschrift
async function sampleHey(count, size) {
  const font = 'italic 300px "Instrument Serif"';
  await document.fonts.load(font);
  const [canvas, ctx] = makeCanvas(800, 400);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText("hey.", 400, 190);
  return sampleCanvas(canvas, count, size);
}

export async function createWorld(scene, path, { count, reduced }) {
  const sphere = new Float32Array(count * 3);
  const scatter = new Float32Array(count * 3);
  const arc = new Float32Array(count * 3);
  const rot = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 4);
  const seal = await sampleSeal(count, 6.6);
  const hey = await sampleHey(count, 9);

  const RADIUS = 1.3;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const p = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  const n2 = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    // Kugel: Fibonacci-Verteilung = gleichmäßig dicht, keine Pole
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    tmp.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(RADIUS * (0.97 + Math.random() * 0.06));
    tmp.toArray(sphere, i * 3);

    // Wolke: 20 % bleiben als Halo um den Ursprung, der Rest verteilt sich
    // als „Tunnel“ um den Kamerapfad – mit Abstand, damit die Kamera hindurchfliegt
    if (Math.random() < 0.2) {
      tmp.randomDirection().multiplyScalar(2 + Math.random() * 4);
    } else {
      const s = 0.14 + Math.random() * 0.86; // bis ganz ans Ende, sonst wird es vor dem Siegel schwarz
      path.cam.getPoint(s, p);
      path.cam.getTangent(s, tangent);
      n1.crossVectors(tangent, THREE.Object3D.DEFAULT_UP).normalize();
      n2.crossVectors(tangent, n1).normalize();
      const ang = Math.random() * Math.PI * 2;
      const dist = 1.1 + Math.pow(Math.random(), 0.7) * 5.5;
      tmp.copy(p)
        .addScaledVector(n1, Math.cos(ang) * dist)
        .addScaledVector(n2, Math.sin(ang) * dist)
        .addScaledVector(tangent, (Math.random() - 0.5) * 3);
    }
    tmp.toArray(scatter, i * 3);

    // Bogen: seitlicher Schwung unterwegs, damit niemand auf der Geraden fliegt
    tmp.randomDirection().multiplyScalar(0.6 + Math.random() * 1.8);
    tmp.toArray(arc, i * 3);

    rot[i * 3 + 0] = Math.random() * 2 - 1;
    rot[i * 3 + 1] = Math.random() * 2 - 1;
    rot[i * 3 + 2] = Math.random() * 2 - 1;

    rnd[i * 4 + 0] = Math.random(); // Farbmischung A/B
    rnd[i * 4 + 1] = Math.random(); // Leuchtkraft (wenige funkeln stark)
    rnd[i * 4 + 2] = Math.random(); // Zeitversatz
    rnd[i * 4 + 3] = Math.random(); // Größe
  }

  // WebGPU erlaubt nur 8 Vertex-Buffer pro Draw. Sechs eigene Attribute + position,
  // normal, instanceMatrix wären zu viele → alles in EINEN verschachtelten Buffer:
  // pro Instanz 22 Floats hintereinander [sphere3 scatter3 seal3 arc3 rot3 rnd4 hey3]
  const STRIDE = 22;
  const packed = new Float32Array(count * STRIDE);
  const parts = [
    [sphere, 3],
    [scatter, 3],
    [seal, 3],
    [arc, 3],
    [rot, 3],
    [rnd, 4],
    [hey, 3],
  ];
  for (let i = 0; i < count; i++) {
    let o = i * STRIDE;
    for (const [arr, size] of parts) {
      for (let k = 0; k < size; k++) packed[o++] = arr[i * size + k];
    }
  }
  const buffer = new THREE.InstancedInterleavedBuffer(packed, STRIDE);
  const attr = (type, offset) => instancedBufferAttribute(buffer, type, STRIDE, offset);
  const aSphere = attr("vec3", 0);
  const aScatter = attr("vec3", 3);
  const aSeal = attr("vec3", 6);
  const aArc = attr("vec3", 9);
  const aRot = attr("vec3", 12);
  const aRnd = attr("vec4", 15);
  const aHey = attr("vec3", 19);

  // --- Splitter-Material: Position, Drehung, Farbe – alles TSL ---
  const material = new THREE.MeshStandardNodeMaterial({
    metalness: 0.6,
    roughness: 0.26,
    // Normalen aus den Bildschirm-Ableitungen: stimmen automatisch,
    // auch nachdem der Shader die Splitter gedreht hat → kristalline Facetten
    flatShading: true,
  });

  const e1 = ease(U.scatter, aRnd.z);
  const e2 = ease(U.form, aRnd.z.oneMinus());
  const free = e1.mul(e2.oneMinus()); // 1 = gerade frei schwebend

  // Kugel atmet leicht
  const breath = sin(time.mul(1.3).add(aRnd.x.mul(PI2))).mul(0.025).mul(U.motion).add(1);
  // In der Wolke treiben die Splitter langsam
  const t = time.mul(0.35);
  const drift = vec3(sin(t.add(aRnd.x.mul(40))), cos(t.mul(0.8).add(aRnd.y.mul(40))), sin(t.mul(0.7).add(aRnd.z.mul(40))))
    .mul(0.18)
    .mul(free)
    .mul(U.motion);

  // Die Kugel dreht sich langsam – auch ohne Scrollen lebt das erste Bild
  const spun = rotate(aSphere.mul(breath), vec3(0.18, time.mul(0.14).mul(U.motion), 0));

  // Maus auf dem Siegel: Splitter im Umkreis weichen zur Kamera hin aus
  const toPointer = aSeal.xy.sub(U.pointer.xy);
  const e3 = ease(U.egg, aRnd.x);
  const press = smoothstep(1.5, 0, toPointer.length()).mul(U.pointerAmt).mul(e2).mul(e3.oneMinus());
  const push = vec3(toPointer.normalize().mul(press.mul(0.35)), press.mul(0.9));

  // Aufladen: die Kugel zittert immer heftiger; Supernova: Stoß nach außen
  const charge2 = U.charge.mul(U.charge);
  const jitter = sin(time.mul(38).add(aRnd.y.mul(60))).mul(charge2).mul(0.07).add(1);
  const charged = spun.mul(jitter).add(aArc.mul(U.burst).mul(2.2));

  const p1 = mix(charged, aScatter, e1).add(aArc.mul(sin(e1.mul(PI))));
  // Easter Egg: aus dem Siegel wird „hey.“ – mit eigenem Bogen, Splitter für Splitter
  // Kuzushi: das Siegel als Ganzes um seine Mitte kippen
  const tilted = rotate(aSeal.sub(SEAL_CENTER), vec3(U.tilt.y, U.tilt.x, U.tilt.x.mul(0.3))).add(SEAL_CENTER);
  const sealOrHey = mix(tilted, aHey, e3).add(aArc.mul(sin(e3.mul(PI)).mul(0.8)));
  const offset = mix(p1, sealOrHey, e2)
    .add(aArc.mul(sin(e2.mul(PI)).mul(0.35))) // halber Bogen: ruhigeres Zusammensetzen
    .add(aArc.mul(U.stamp).mul(e2)) // Klick: Stoß nach außen, federt zurück
    .add(push)
    .add(drift);

  // Im Siegel drehen sich alle auf dieselbe Ausrichtung → ruhige, einheitliche Fläche
  const rotation = aRot.mul(PI2).add(aRot.mul(U.spinAngle)).mul(e2.oneMinus());
  const scale = mix(aRnd.w.mul(0.7).add(0.65), float(0.8), e2);

  // Splitter direkt vor der Linse schrumpfen weg – sonst schiebt sich ein
  // riesiger, überstrahlter Splitter ins Bild, wenn die Kamera durchfliegt
  const nearFade = smoothstep(0.4, 2.2, distance(offset, cameraPosition));

  material.positionNode = rotate(positionLocal.mul(scale).mul(nearFade), rotation).add(offset);

  const gold = mix(color(new THREE.Color("#9c6a1c")), color(new THREE.Color("#ffe2a0")), aRnd.x);
  const base = mix(mix(U.colorA, U.colorB, aRnd.x), gold, U.gold);
  // Paper Edition: unterwegs schwarze Tinte, als Siegel rot – rot auf weiß
  const inkBlack = mix(color(new THREE.Color("#111114")), color(new THREE.Color("#3a3a40")), aRnd.x);
  const inkRed = color(new THREE.Color("#cf1830"));
  const ink = mix(inkBlack, inkRed.mul(0.35), e2);
  material.colorNode = mix(base, ink, U.paper);
  // Tinte glänzt nicht wie Metall
  material.metalnessNode = mix(float(0.6), float(0.05), U.paper);
  material.roughnessNode = mix(float(0.26), float(0.85), U.paper);
  // Schimmer: ein schmales Lichtband wandert diagonal über das fertige Siegel
  const home = mix(aSeal, aHey, e3); // der Schimmer läuft auch über „hey.“
  const diag = home.x.sub(SEAL_CENTER.x).add(home.y.sub(SEAL_CENTER.y).mul(0.6));
  const band = smoothstep(0.7, 0, diag.sub(U.sweep).abs()).mul(e2);
  const sparkle = pow(aRnd.y, 6).mul(3.2).add(0.06);
  const glint = mix(vec3(1, 0.92, 0.86), vec3(1, 0.78, 0.4), U.gold);
  material.emissiveNode = base
    .mul(U.glow)
    .mul(sparkle.add(charge2.mul(2.5)))
    .add(glint.mul(band.mul(1.6).add(press.mul(1.2))))
    .mul(U.paper.oneMinus()) // Tinte leuchtet nicht …
    // … außer das Siegel: das Rot kommt als Eigenfarbe, damit Licht es nicht ins Rosa aufhellt
    .add(inkRed.mul(e2).mul(U.paper).mul(0.85));

  const shardSize = 0.075 * Math.sqrt(4000 / count);
  const geometry = new THREE.OctahedronGeometry(shardSize, 0);
  geometry.scale(1, 1.6, 0.7); // länglich → wirkt wie Splitter, nicht wie Würfelchen
  geometry.deleteAttribute("uv"); // brauchen wir nicht – spart einen Vertex-Buffer

  const shards = new THREE.InstancedMesh(geometry, material, count);
  // Die Instanz-Matrizen bleiben Einheitsmatrizen – die echte Position kommt aus
  // dem Shader. Der Bounding-Sphere wüsste davon nichts, also nicht cullen.
  shards.frustumCulled = false;
  scene.add(shards);

  // --- Der leuchtende Kern (Kapitel 1), scheint durch die Lücken der Splitter ---
  const coreMat = new THREE.MeshBasicNodeMaterial();
  // Beim Aufladen glüht der Kern auf, die Supernova blitzt hell
  const coreLit = U.coreColor.mul(U.coreGlow.add(U.charge.mul(5)).add(U.burst.mul(10)));
  // Auf Papier wird der leuchtende Kern zum Tintentropfen
  coreMat.colorNode = mix(coreLit, color(new THREE.Color("#121215")), U.paper);
  const core = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 0.9, 48, 24), coreMat);
  scene.add(core);

  // --- Licht: kühles Führungslicht → wird in Kapitel 4 warm ---
  const hemi = new THREE.HemisphereLight(0x8fa3d6, 0x050508, 0.35);
  const key = new THREE.DirectionalLight(0x9cc0ff, 2.2);
  key.position.set(4, 6, 8);
  const rim = new THREE.DirectionalLight(0xff3355, 0.9);
  rim.position.set(-5, -2, -10);
  const coreLight = new THREE.PointLight(0xcfdcff, 6, 0, 2);
  scene.add(hemi, key, rim, coreLight);

  // Eigener Nebel-Node: wie FogExp2 (GSAP tweent weiter scene.fog.density), aber
  // auf Papier fast ausgeschaltet – sonst legt sich ein weißer Schleier über die Tinte
  const fogDensity = reference("density", "float", scene.fog).mul(U.paper.mul(-0.9).add(1));
  scene.fogNode = fog(reference("color", "color", scene.fog), densityFogFactor(fogDensity));

  if (reduced) U.motion.value = 0;

  return { shards, core, lights: { hemi, key, rim, coreLight } };
}
