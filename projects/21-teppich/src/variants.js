// ============================================================
// VARIANTS – drei Formen, gleiche Technik (Taste M)
// ============================================================
// Jede Variante liefert drei Dinge:
// 1. geometry()  – EINE Geometrie, die alle Instanzen teilen
// 2. place()     – die feste Startlage einer Instanz (läuft einmal beim Aufbau)
// 3. shape(ctx)  – TSL: wie Wellen, Maus und Klicks die Instanz verformen
//
// ctx enthält fertige Nodes aus instance-field.js:
//   u        alle Uniforms
//   grid     vec2  Rasterposition (x/z)
//   seed     float Zufall 0…1, pro Instanz fest
//   wave     float Wellenwert ca. -1…1 (waves.js)
//   mouse    float Maus-Einfluss 0…1
//   shock    float Höhe der Schockwellen hier
//   shockPush vec2 Richtung weg vom Klick
//   energy   float 0 = flach & still, 1 = volle Bewegung (aus „progress“)
//
// positionLocal ist hier schon die Vertex-Position NACH der Instanz-Matrix,
// also bereits an ihrem Platz im Raster. positionGeometry ist die rohe
// Position in der Geometrie (z. B. 0 = Halm-Wurzel, 1 = Halm-Spitze).

import * as THREE from "three/webgpu";
import {
  vec2,
  vec3,
  float,
  sin,
  cos,
  mix,
  step,
  length,
  normalize,
  positionLocal,
  positionGeometry,
} from "three/tsl";

const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Hilfswert: Welle von -1…1 auf 0…1
const to01 = (wave) => wave.mul(0.5).add(0.5).clamp(0, 1);

export const VARIANTS = {
  // --------------------------------------------------------
  // Pixel-Stadt: Säulen, deren Höhe die Welle ist
  // --------------------------------------------------------
  stadt: {
    label: "Pixel-Stadt",
    jitter: 0,
    side: THREE.FrontSide,

    geometry() {
      // Würfel mit Boden bei y = 0 → Skalieren in Y wächst nur nach oben
      return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    },

    place(matrix, x, z, seed, cell) {
      position.set(x, 0, z);
      quaternion.identity();
      scale.set(cell * 0.82, 1, cell * 0.82); // kleine Fuge zwischen den Säulen
      return matrix.compose(position, quaternion, scale);
    },

    shape({ u, seed, wave, mouse, shock, energy }) {
      const amp = u.waveHeight;

      // Grundhöhe + Welle; pow(1.6) macht Täler breit und Spitzen schmal,
      // der Seed variiert jede Säule → wirkt wie eine Skyline statt einer Fläche
      const base = float(0.3).add(amp.mul(to01(wave).pow(1.6)).mul(mix(0.8, 1.2, seed)));
      // ~0,4 % Hochhäuser, die mit der Welle aus dem Teppich wachsen
      const towers = step(0.996, seed).mul(amp).mul(0.7).mul(to01(wave));
      const h = base.add(towers);

      // Maus: drücken (Delle) oder heben (Hügel), weich gemischt
      const pressed = h.mul(mix(float(1), float(0.06), mouse));
      const raised = h.add(mouse.mul(amp).mul(1.6));
      const withMouse = mix(pressed, raised, u.mouseRaise).add(shock.mul(amp).mul(1.2));

      // progress: 0 = flache Kacheln, 1 = volle Höhe
      const height = mix(float(0.05), withMouse, energy).max(0.05);

      return {
        position: positionLocal.mul(vec3(1, height, 1)),
        height01: height.div(amp.mul(1.1).add(0.3)).clamp(0, 1),
      };
    },
  },

  // --------------------------------------------------------
  // Wiese: Grashalme biegen sich im Wind, zur Spitze hin stärker
  // --------------------------------------------------------
  wiese: {
    label: "Wiese",
    jitter: 1, // Halme nicht im starren Raster, sonst sieht man Reihen
    side: THREE.DoubleSide,

    geometry() {
      // Ein Halm: schmaler werdender Streifen aus 5 Segmenten, Spitze = Punkt.
      // Die Segmente braucht es, damit sich der Halm biegen kann.
      const segments = 5;
      const vertices = [];
      const indices = [];
      for (let i = 0; i <= segments; i++) {
        const y = i / segments;
        const halfWidth = 0.5 * (1 - y) ** 0.9;
        const curl = y * y * 0.15; // leichte Wölbung, damit Licht darauf spielt
        vertices.push(-halfWidth, y, curl, halfWidth, y, curl);
      }
      for (let i = 0; i < segments; i++) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return geometry;
    },

    place(matrix, x, z, seed, cell) {
      position.set(x, 0, z);
      quaternion.setFromAxisAngle(UP, Math.random() * Math.PI * 2); // jede Richtung
      scale.set(cell * 0.9, 1, cell * 0.9);
      return matrix.compose(position, quaternion, scale);
    },

    shape({ u, grid, seed, wave, mouse, shockPush, shock, energy }) {
      const amp = u.waveHeight;
      const tip = positionGeometry.y; // 0 an der Wurzel, 1 an der Spitze

      // Halmlänge: Seed + Wellenhöhe; im Heben-Modus wachsen Halme unter der Maus
      const length0 = mix(0.6, 1.35, seed).mul(amp.mul(0.3).add(0.6));
      const halm = length0.mul(mouse.mul(u.mouseRaise).mul(1.3).add(1));

      // Wind: Welle = Böe, dazu ein schnelles Flattern pro Halm
      const windDir = vec2(0.94, 0.34);
      const gust = float(0.15).add(to01(wave).mul(amp).mul(0.16));
      const flutter = sin(u.time.mul(5).add(seed.mul(40))).mul(0.06);
      let bend = windDir.mul(gust.add(flutter)).mul(mouse.mul(u.mouseRaise).mul(-0.8).add(1));

      // Maus drückt die Halme weg (Drücken-Modus), Schockwelle schiebt nach außen
      const away = normalize(grid.sub(u.mouse).add(vec2(0.0001, 0)));
      bend = bend.add(away.mul(mouse).mul(u.mouseRaise.oneMinus()).mul(1.6));
      bend = bend.add(shockPush.mul(1.4));

      // Biegung begrenzen, sonst klappen Halme durch den Boden
      const bendLength = length(bend).min(1.4);
      bend = normalize(bend.add(vec2(0.0001, 0))).mul(bendLength).mul(energy);

      // Biegung wächst quadratisch zur Spitze: Wurzel bleibt stehen
      const offset = bend.mul(halm).mul(tip.mul(tip));
      const height = mix(float(0.12), halm, energy);
      // Gebogene Halme werden niedriger, damit sie nicht „länger“ wirken
      const y = tip.mul(height).mul(bendLength.mul(bendLength).mul(energy).mul(-0.3).add(1));

      return {
        position: vec3(positionLocal.x.add(offset.x), y, positionLocal.z.add(offset.y)),
        height01: tip.mul(to01(wave).mul(0.5).add(0.6)).add(shock.mul(0.3)).clamp(0, 1),
      };
    },
  },

  // --------------------------------------------------------
  // Kugeln: schweben und tanzen wie ein Fischschwarm
  // --------------------------------------------------------
  kugeln: {
    label: "Kugeln",
    jitter: 0.3,
    side: THREE.FrontSide,

    geometry() {
      return new THREE.SphereGeometry(0.5, 12, 8);
    },

    place(matrix, x, z, seed, cell) {
      position.set(x, 0, z);
      quaternion.identity();
      scale.setScalar(cell * 0.8);
      return matrix.compose(position, quaternion, scale);
    },

    shape({ u, grid, seed, wave, mouse, shock, energy }) {
      const amp = u.waveHeight;
      const w01 = to01(wave);

      // Mittelpunkt der Instanz und Vertex relativ dazu → um die Mitte skalieren
      const center = vec3(grid.x, 0, grid.y);
      const local = positionLocal.sub(center);

      // Schweben: Welle + eigener Takt pro Kugel (Phase aus dem Seed)
      const bob = sin(u.time.mul(1.7).add(seed.mul(6.283)).add(grid.x.mul(0.12))).mul(amp.mul(0.08));
      const lift = float(1).add(w01.mul(amp).mul(0.85)).add(bob).add(shock.mul(amp).mul(0.9));
      const withMouse = mix(lift.sub(mouse.mul(amp).mul(0.9)), lift.add(mouse.mul(amp).mul(1.2)), u.mouseRaise);
      const y = mix(u.cell.mul(0.35), withMouse, energy).max(u.cell.mul(0.3));

      // Schwarm: kleine Kreisbahnen, jede Kugel mit eigenem Tempo
      const swirl = vec2(sin(u.time.mul(0.8).add(seed.mul(12))), cos(u.time.mul(0.7).add(seed.mul(9))))
        .mul(u.cell.mul(0.5))
        .mul(energy);
      const size = mix(0.55, 1.2, seed).mul(w01.mul(0.4).add(0.75));

      return {
        position: center.add(local.mul(size)).add(vec3(swirl.x, y, swirl.y)),
        height01: y.sub(0.4).div(amp.mul(1.9)).clamp(0, 1),
      };
    },
  },
};

export const VARIANT_KEYS = Object.keys(VARIANTS);
