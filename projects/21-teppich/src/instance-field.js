// ============================================================
// INSTANCING-MODUL – createInstanceField(renderer, scene, options)
// ============================================================
// WAS IST EIN DRAW CALL?
// Ein Draw Call ist ein Auftrag der CPU an die GPU: „Zeichne diese Geometrie
// mit diesem Material.“ Jeder Auftrag kostet Verwaltung auf der CPU (Zustand
// prüfen, Buffer binden, Uniforms hochladen). 40.000 einzelne Meshes wären
// 40.000 Aufträge pro Frame – die CPU wird zum Flaschenhals, die GPU wartet.
//
// WARUM IST INSTANCING SO SCHNELL?
// InstancedMesh sagt der GPU EINMAL: „Zeichne diese Geometrie 40.000 Mal.“
// Geometrie und Material liegen nur einmal im Speicher, die Unterschiede
// stehen in kleinen Instanz-Attributen (Lage, Seed, Farbe). Ein Draw Call,
// egal ob 100 oder 100.000 Objekte.
//
// WAS IST instanceIndex?
// Die Nummer der Instanz, die der Shader gerade rechnet: 0, 1, 2 … 39.999.
// Instanz-Attribute werden automatisch über diese Nummer gelesen
// („Instanz 5 bekommt Eintrag 5“). Wir nutzen instanceIndex zusätzlich
// direkt, z. B. als Zufalls-Quelle für die Streuung bei progress = 0.
//
// WARUM ANIMATION IM SHADER STATT setMatrixAt PRO FRAME?
// setMatrixAt pro Frame hieße: JavaScript rechnet 40.000 Matrizen
// (16 Zahlen je Instanz = 640.000 Zahlen), dann wandern 2,5 MB pro Frame
// über den Bus zur GPU. Im Shader rechnet die GPU alle Instanzen
// gleichzeitig, aus Daten, die schon dort liegen. Pro Frame schickt JS nur
// ein paar Uniforms (Zeit, Maus, Klicks) – ein paar Dutzend Bytes.
// setMatrixAt benutzen wir genau EINMAL: beim Aufbau, für die Startlage.

import * as THREE from "three/webgpu";
import {
  uniform,
  attribute,
  varying,
  instanceIndex,
  hash,
  vec3,
  float,
  mix,
  sin,
  length,
  smoothstep,
  positionWorld,
} from "three/tsl";
import { waveField, mouseField, shockField } from "./waves.js";
import { VARIANTS } from "./variants.js";

const SHOCK_SLOTS = 6;

// renderer gehört zur API, damit das Modul später z. B. Compute-Passes
// (renderer.compute) starten kann, ohne dass sich die Signatur ändert.
export function createInstanceField(renderer, scene, options = {}) {
  const opts = {
    side: 200, // 200 × 200 = 40.000 Instanzen
    extent: 40, // Kantenlänge des Rasters in Welteinheiten (bleibt gleich, Zellen werden kleiner)
    variant: "stadt",
    progressMode: "rise", // "rise": flach → Wellen · "assemble": verstreut → Raster → Wellen
    shadows: true,
    ...options,
  };

  // --------------------------------------------------------
  // Uniforms: die einzigen Werte, die pro Frame zur GPU gehen
  // --------------------------------------------------------
  // uniform(x) ist ein Shader-Wert, den JS jederzeit über .value ändert –
  // ohne den Shader neu zu bauen.
  const u = {
    time: uniform(0), // Wellen-Zeit (mal Geschwindigkeit)
    clock: uniform(0), // echte Sekunden, für die Schockwellen
    progress: uniform(1), // 0 … 1, für die Scroll-Story
    assemble: uniform(opts.progressMode === "assemble" ? 1 : 0),
    cell: uniform(opts.extent / opts.side),

    waveHeight: uniform(4),
    waveFrequency: uniform(0.35),

    mouse: uniform(new THREE.Vector2(999, 999)),
    mouseActive: uniform(0),
    mouseRadius: uniform(5),
    mouseStrength: uniform(1),
    mouseRaise: uniform(0), // 0 = Dellen drücken, 1 = anheben

    shockSpeed: uniform(14),
    shocks: Array.from({ length: SHOCK_SLOTS }, () => uniform(new THREE.Vector4(0, 0, -999, 0))),

    colorA: uniform(new THREE.Color("#1b1d26")),
    colorB: uniform(new THREE.Color("#cf1830")),
    colorTip: uniform(new THREE.Color("#ffd6cc")),
    shockColor: uniform(new THREE.Color("#cf1830")),
    glow: uniform(1.2),
    shockGlow: uniform(1.5),
    aoStrength: uniform(0.8),
  };

  // Werte, die nur JS braucht
  const state = {
    speed: 1,
    running: false,
    mouseTarget: new THREE.Vector2(999, 999),
    mouseWanted: 0,
    shockIndex: 0,
    drawCalls: 0,
  };

  let mesh = null;

  // --------------------------------------------------------
  // Material: der komplette Node-Graph
  // --------------------------------------------------------
  function createMaterial(variant) {
    // Instanz-Daten lesen. attribute() + InstancedBufferAttribute in der
    // Geometrie → die GPU schaltet pro Instanz (nicht pro Vertex) weiter.
    const instanceData = attribute("aInstance", "vec4"); // x, z, seed, –
    const tint = attribute("aTint", "vec3");
    const grid = instanceData.xy;
    const seed = instanceData.z;

    // progress → zwei Kurven:
    // landing: 0 = verstreut, 1 = im Raster (nur im assemble-Modus)
    // energy:  0 = still und flach, 1 = volle Wellen
    const p = u.progress;
    const stagger = seed.mul(0.45); // jede Instanz landet etwas später
    const landing = mix(float(1), smoothstep(stagger, stagger.add(0.5), p), u.assemble);
    const energy = mix(smoothstep(0, 1, p), smoothstep(0.55, 1, p), u.assemble);

    const wave = waveField(u, grid);
    const mouse = mouseField(u, grid);
    const { amount: shock, push: shockPush } = shockField(u, grid);

    const shape = variant.shape({ u, grid, seed, wave, mouse, shock, shockPush, energy });

    // Streuung für progress = 0: hash(instanceIndex) = fester Zufall pro Instanz
    const scatter = vec3(
      hash(instanceIndex).sub(0.5).mul(opts.extent * 1.6),
      hash(instanceIndex.add(1)).mul(opts.extent * 0.7).add(4),
      hash(instanceIndex.add(2)).sub(0.5).mul(opts.extent * 1.6),
    );
    const away = landing.oneMinus();
    const positionNode = shape.position.add(scatter.mul(away.mul(away)));

    // varying(): im Vertex-Shader gerechnet, an den Fragment-Shader gereicht.
    // So läuft die teure Wellen-Rechnung einmal pro Vertex, nicht pro Pixel.
    const height01 = varying(shape.height01);
    const shockV = varying(shock.mul(energy).clamp(0, 1.5));
    const flying = varying(away); // 1 = noch unterwegs (assemble-Modus)
    const pulse = varying(sin(u.time.mul(1.4).sub(length(grid).mul(0.22))).mul(0.08));

    // Farbe: A unten → B oben, ganz oben Richtung Spitzenfarbe
    const blend = smoothstep(0.15, 0.95, height01.add(pulse));
    const base = mix(u.colorA, u.colorB, blend).mul(tint);
    const color = mix(base, u.colorTip, smoothstep(0.82, 1, height01));

    // AO-Look: je tiefer im „Teppich“, desto dunkler. Echte Ambient Occlusion
    // wäre ein teurer Post-Effekt; die Höhe über dem Boden ist ein guter Ersatz.
    const ao = smoothstep(-0.2, 2.6, positionWorld.y).mul(0.75).add(0.25);

    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.55,
      metalness: 0.1,
      side: variant.side,
    });
    material.positionNode = positionNode;
    material.colorNode = color.mul(mix(float(1), ao, u.aoStrength));
    // Höchste Instanzen leuchten leicht, die Schockwelle blitzt in shockColor
    material.emissiveNode = color
      .mul(smoothstep(0.7, 1, height01))
      .mul(u.glow)
      .add(u.shockColor.mul(shockV.add(flying.mul(0.6))).mul(u.shockGlow));

    return material;
  }

  // --------------------------------------------------------
  // Aufbau: Raster, Instanz-Daten, InstancedMesh
  // --------------------------------------------------------
  function build() {
    const variant = VARIANTS[opts.variant];
    const side = opts.side;
    const count = side * side;
    const cell = opts.extent / side;
    u.cell.value = cell;

    const geometry = variant.geometry();
    const instanceData = new Float32Array(count * 4);
    const tintData = new Float32Array(count * 3);

    mesh = new THREE.InstancedMesh(geometry, createMaterial(variant), count);

    // Einmalig auf der CPU: Startlage + Zusatzdaten. Danach fasst JS keine
    // Instanz mehr an.
    const matrix = new THREE.Matrix4();
    const half = opts.extent / 2;
    let i = 0;
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++, i++) {
        const seed = Math.random();
        const x = -half + (col + 0.5) * cell + (Math.random() - 0.5) * cell * variant.jitter;
        const z = -half + (row + 0.5) * cell + (Math.random() - 0.5) * cell * variant.jitter;

        mesh.setMatrixAt(i, variant.place(matrix, x, z, seed, cell));

        instanceData.set([x, z, seed, 0], i * 4);
        // Basisfarbe pro Instanz: ±12 % Helligkeit, minimal warm/kalt
        const light = 0.88 + Math.random() * 0.24;
        const warm = (Math.random() - 0.5) * 0.06;
        tintData.set([light + warm, light, light - warm], i * 3);
      }
    }

    geometry.setAttribute("aInstance", new THREE.InstancedBufferAttribute(instanceData, 4));
    geometry.setAttribute("aTint", new THREE.InstancedBufferAttribute(tintData, 3));

    mesh.castShadow = opts.shadows;
    mesh.receiveShadow = true;
    // Die Bounding-Box kennt die Shader-Bewegung nicht → nie wegschneiden
    mesh.frustumCulled = false;
    // Zählt, wie oft das Feld pro Frame gezeichnet wird (Bild + Schatten)
    mesh.onBeforeRender = () => state.drawCalls++;

    scene.add(mesh);
  }

  function destroy() {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh.dispose();
    mesh = null;
  }

  function rebuild() {
    destroy();
    build();
  }

  build();

  // --------------------------------------------------------
  // Öffentliche API
  // --------------------------------------------------------
  return {
    uniforms: u,
    progress: u.progress, // gsap.to(field.progress, { value: 1 })
    get mesh() {
      return mesh;
    },
    get count() {
      return opts.side * opts.side;
    },
    get variant() {
      return opts.variant;
    },
    get speed() {
      return state.speed;
    },
    set speed(value) {
      state.speed = value;
    },

    start() {
      state.running = true;
    },
    stop() {
      state.running = false;
    },

    // Jeden Frame aufrufen. Läuft nur, solange start() aktiv ist.
    update(delta) {
      if (!state.running) return;
      u.time.value += delta * state.speed; // Zeit aufaddieren statt multiplizieren → kein Sprung beim Regeln
      u.clock.value += delta;

      // Weiches Nachziehen: Maus gleitet hinterher, Delle blendet sanft ein/aus.
      // 1 - exp(-dt·k) ist bildratenunabhängiges Lerp.
      u.mouse.value.lerp(state.mouseTarget, 1 - Math.exp(-delta * 10));
      u.mouseActive.value += (state.mouseWanted - u.mouseActive.value) * (1 - Math.exp(-delta * 3));
    },

    // Mausposition auf dem Boden (x/z) oder null, wenn die Maus weg ist
    setPointer(x, z) {
      if (x === null) {
        state.mouseWanted = 0;
        return;
      }
      // Beim Wiedereintritt nicht quer übers Feld gleiten, sondern dort starten
      if (u.mouseActive.value < 0.02) u.mouse.value.set(x, z);
      state.mouseTarget.set(x, z);
      state.mouseWanted = 1;
    },

    // Schockwelle: belegt reihum einen der 6 Slots
    shock(x, z, strength = 1) {
      u.shocks[state.shockIndex].value.set(x, z, u.clock.value, strength);
      state.shockIndex = (state.shockIndex + 1) % SHOCK_SLOTS;
    },

    setVariant(name) {
      if (!VARIANTS[name] || name === opts.variant) return;
      opts.variant = name;
      rebuild();
    },
    setSide(side) {
      if (side === opts.side) return;
      opts.side = side;
      rebuild();
    },
    setShadows(enabled) {
      opts.shadows = enabled;
      if (mesh) mesh.castShadow = enabled;
    },
    setProgressMode(mode) {
      u.assemble.value = mode === "assemble" ? 1 : 0;
    },

    // Draw Calls des Feldes seit dem letzten Aufruf (für die Anzeige)
    takeDrawCalls() {
      const calls = state.drawCalls;
      state.drawCalls = 0;
      return calls;
    },

    dispose() {
      state.running = false;
      destroy();
    },
  };
}
