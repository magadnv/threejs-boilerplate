import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Maße in Zentimetern: 1 Einheit = 1 cm. Ein verstärkter BJJ-Kragen ist ~4,6 cm
// breit und ~1,2 cm dick (mehrlagig, gesteppt).
export const HALF_W = 2.3;
export const HALF_H = 0.6;
const CORNER = 0.52;
const BULGE = 0.07; // Polster: Ober- und Unterseite sind leicht gewölbt

// Mittellinie: ein langes, leicht gebogenes Band, schräg durchs Bild.
// Die Enden liegen weit außerhalb des Makro-Ausschnitts.
const CURVE = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(-62, 25, -30),
    new THREE.Vector3(-34, 12.5, -9),
    new THREE.Vector3(-15, 5.2, -1.6),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(13, -4.6, -1.4),
    new THREE.Vector3(30, -12, -8),
    new THREE.Vector3(54, -24, -24),
  ],
  false,
  "centripetal"
);

// Grundausrichtung der Stoff-Oberseite: zur Kamera, leicht nach unten gekippt,
// damit das Streiflicht von unten über die Webstruktur läuft.
const FACING = new THREE.Vector3(0.08, -0.16, 1).normalize();

// Mittellinie mit Rahmen (T Längs, W Breite, N Dicke) nach Bogenlänge abtasten.
// s = 0 liegt am Kurvenpunkt (0,0,0), damit Griff und Uniforms in cm rechnen.
export function buildFrames(count) {
  const pts = CURVE.getSpacedPoints(count - 1);
  const total = CURVE.getLength();
  let zero = 0;
  let best = Infinity;
  pts.forEach((p, i) => {
    const d = p.lengthSq();
    if (d < best) { best = d; zero = i; }
  });

  const frames = [];
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    const s = (i - zero) * (total / (count - 1));
    const T = CURVE.getTangentAt(u).normalize();
    const N0 = FACING.clone().addScaledVector(T, -FACING.dot(T)).normalize();
    const W0 = new THREE.Vector3().crossVectors(N0, T).normalize();
    // Organisches Rollen entlang der Länge: der Kragen liegt nie ganz flach
    const roll = 0.22 * Math.sin(s * 0.085 + 0.6) + 0.08 * Math.sin(s * 0.21);
    const c = Math.cos(roll), sn = Math.sin(roll);
    const N = N0.clone().multiplyScalar(c).addScaledVector(W0, sn);
    const W = W0.clone().multiplyScalar(c).addScaledVector(N0, -sn);
    frames.push({ s, C: pts[i].clone(), T, W, N });
  }
  return frames;
}

// Querschnitt: gepolstertes, abgerundetes Rechteck, gleichmäßig nach Umfang abgetastet.
function buildProfile(count) {
  // Gegen den Uhrzeigersinn: rechte Kante, Ecke, Oberseite, Ecke, linke Kante …
  const dense = [];
  const r = CORNER, iw = HALF_W - r, ih = HALF_H - r;
  const line = (x0, y0, x1, y1, n, bulge) => {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const b = bulge ? Math.sign(y) * BULGE * Math.max(0, 1 - (x / iw) ** 2) : 0;
      dense.push(new THREE.Vector2(x, y + b));
    }
  };
  const arc = (cx, cy, a0, n) => {
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 0.5;
      dense.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  line(HALF_W, -ih, HALF_W, ih, 20, false);
  arc(iw, ih, 0, 120);
  line(iw, HALF_H, -iw, HALF_H, 600, true);
  arc(-iw, ih, Math.PI * 0.5, 120);
  line(-HALF_W, ih, -HALF_W, -ih, 20, false);
  arc(-iw, -ih, Math.PI, 120);
  line(-iw, -HALF_H, iw, -HALF_H, 600, true);
  arc(iw, -ih, Math.PI * 1.5, 120);
  const steps = dense.length;
  const lens = [0];
  for (let i = 1; i <= steps; i++) {
    lens.push(lens[i - 1] + dense[i % steps].distanceTo(dense[i - 1]));
  }
  const perimeter = lens[steps];
  const out = [];
  let k = 0;
  for (let j = 0; j <= count; j++) {
    const target = (j / count) * perimeter;
    while (k < steps - 1 && lens[k + 1] < target) k++;
    const t = (target - lens[k]) / Math.max(1e-6, lens[k + 1] - lens[k]);
    const a = dense[k], b = dense[(k + 1) % steps];
    const p = a.clone().lerp(b, t);
    const tan = b.clone().sub(a).normalize();
    // Umlaufrichtung gegen den Uhrzeigersinn → Außennormale = (tan.y, -tan.x)
    out.push({ w: p.x, n: p.y, nw: tan.y, nn: -tan.x, peri: target });
  }
  return out;
}

export function buildCollarGeometry({ segments, profile }) {
  const frames = buildFrames(segments + 1);
  const prof = buildProfile(profile);
  const rows = frames.length, cols = prof.length;
  const count = rows * cols;

  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const aCenter = new Float32Array(count * 3);
  const aT = new Float32Array(count * 3);
  const aN = new Float32Array(count * 3);
  const aS = new Float32Array(count);
  const aProf = new Float32Array(count * 2);
  const aPeri = new Float32Array(count);

  const p = new THREE.Vector3(), nrm = new THREE.Vector3();
  let v = 0;
  for (const f of frames) {
    for (const q of prof) {
      p.copy(f.C).addScaledVector(f.W, q.w).addScaledVector(f.N, q.n);
      nrm.copy(f.W).multiplyScalar(q.nw).addScaledVector(f.N, q.nn).normalize();
      p.toArray(position, v * 3);
      nrm.toArray(normal, v * 3);
      f.C.toArray(aCenter, v * 3);
      f.T.toArray(aT, v * 3);
      f.N.toArray(aN, v * 3);
      aS[v] = f.s;
      aProf[v * 2] = q.w;
      aProf[v * 2 + 1] = q.n;
      aPeri[v] = q.peri;
      v++;
    }
  }

  const index = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setIndex(index);
  g.setAttribute("position", new THREE.BufferAttribute(position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  g.setAttribute("aCenter", new THREE.BufferAttribute(aCenter, 3));
  g.setAttribute("aT", new THREE.BufferAttribute(aT, 3));
  g.setAttribute("aN", new THREE.BufferAttribute(aN, 3));
  g.setAttribute("aS", new THREE.BufferAttribute(aS, 1));
  g.setAttribute("aProf", new THREE.BufferAttribute(aProf, 2));
  g.setAttribute("aPeri", new THREE.BufferAttribute(aPeri, 1));
  // Winding prüfen: Dreiecke sollen mit den Außennormalen übereinstimmen
  ensureOutwardWinding(g);
  return { geometry: g, frames };
}

function ensureOutwardWinding(g) {
  const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3();
  a.fromBufferAttribute(pos, idx[0]);
  b.fromBufferAttribute(pos, idx[1]);
  c.fromBufferAttribute(pos, idx[2]);
  const face = b.sub(a).cross(c.sub(a));
  n.fromBufferAttribute(nor, idx[0]);
  if (face.dot(n) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t;
    }
  }
}

// Ausgefranste Fäden: dünne Röhren, die an den Kanten herausstehen. Jede Röhre
// trägt die Rahmen-Attribute ihres Wurzelpunkts, damit sie der Verformung folgt.
export function buildThreadGeometry(frames, { count, seed = 7 }) {
  const rand = mulberry(seed);
  const parts = [];
  const midIndex = frames.findIndex((f) => f.s >= 0);
  const step = frames[1].s - frames[0].s;

  for (let t = 0; t < count; t++) {
    const s = (rand() * 2 - 1) * 22;
    const i = Math.min(frames.length - 1, Math.max(0, midIndex + Math.round(s / step)));
    const f = frames[i];
    const side = rand() < 0.5 ? -1 : 1;
    const nOff = (rand() * 2 - 1) * HALF_H * 0.55;
    const root = f.C.clone().addScaledVector(f.W, side * (HALF_W - 0.06)).addScaledVector(f.N, nOff);

    const len = 0.12 + Math.pow(rand(), 2.6) * 0.95;
    const dir = f.W.clone().multiplyScalar(side)
      .addScaledVector(f.N, (rand() - 0.35) * 0.9)
      .addScaledVector(f.T, (rand() - 0.5) * 1.2)
      .normalize();
    const curlAxis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const curl = (rand() - 0.5) * 1.8;
    const pts = [];
    const segs = 6;
    const d = dir.clone();
    const cur = root.clone().addScaledVector(dir, -0.08);
    for (let k = 0; k <= segs; k++) {
      pts.push(cur.clone());
      d.applyAxisAngle(curlAxis, curl / segs).addScaledVector(f.N, -0.05).normalize();
      cur.addScaledVector(d, len / segs);
    }
    const radius = 0.0045 + rand() * 0.004;
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, radius, 4, false);
    tube.deleteAttribute("uv");
    const n = tube.attributes.position.count;
    const fill = (arr, vec) => { for (let k = 0; k < n; k++) vec.toArray(arr, k * 3); return arr; };
    tube.setAttribute("aCenter", new THREE.BufferAttribute(fill(new Float32Array(n * 3), f.C), 3));
    tube.setAttribute("aT", new THREE.BufferAttribute(fill(new Float32Array(n * 3), f.T), 3));
    tube.setAttribute("aN", new THREE.BufferAttribute(fill(new Float32Array(n * 3), f.N), 3));
    tube.setAttribute("aRoot", new THREE.BufferAttribute(fill(new Float32Array(n * 3), root), 3));
    tube.setAttribute("aS", new THREE.BufferAttribute(new Float32Array(n).fill(f.s), 1));
    parts.push(tube);
  }
  return mergeGeometries(parts);
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
