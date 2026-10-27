// ============================================================
// FLOWFIELD-MODUL – createFlowField(renderer, scene, options)
// ============================================================
// Alles, was der Effekt braucht, in einem Paket: GPU-Speicher, Compute-
// Shader, Sprite-Material. Das Modul weiß nichts von GUI, Tasten oder
// Spuren – deshalb lässt es sich 1:1 in eine Scroll-Story einbauen.
//
//   const flow = createFlowField(renderer, scene, { count: 300_000 });
//   flow.start();                      // Simulation läuft
//   flow.update(delta);                // jeden Frame aus deinem Loop
//   flow.uniforms.progress.value = 0.5 // 0 ruhig/geordnet … 1 wild/fließend
//   flow.stop(); flow.dispose();

import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  instancedArray,
  instanceIndex,
  uniform,
  hash,
  vec3,
  float,
  mix,
  smoothstep,
  exp,
  sin,
  cross,
  uv,
} from "three/tsl";
import { curlNoise } from "./curl-noise.js";
import { createSpawn, sampleText, EMITTERS, TEXT_POINTS } from "./emitters.js";
import { PALETTES } from "./palettes.js";

export { EMITTERS, PALETTES };

export function createFlowField(renderer, scene, options = {}) {
  const maxCount = options.maxCount ?? 1_000_000;

  // ----------------------------------------------------------
  // Uniforms – alles, was von außen live änderbar ist
  // ----------------------------------------------------------
  // uniform() ist eine Zahl im Shader, die JS jederzeit ersetzen kann,
  // ohne dass der Shader neu gebaut wird. GUI und GSAP schreiben nur hier rein.
  const palette = PALETTES[options.palette ?? 0].colors;
  const uniforms = {
    progress: uniform(options.progress ?? 0.85), // 0 ruhig/geordnet · 1 wild/fließend
    frequency: uniform(0.6), // wie groß die Wirbel sind (klein = große Wirbel)
    strength: uniform(0.5), // wie schnell das Feld schiebt
    fieldSpeed: uniform(0.12), // wie schnell sich das Feld selbst verändert
    inertia: uniform(0.45), // Sekunden, bis ein Partikel der Strömung folgt
    lifetime: uniform(4), // mittlere Lebensdauer in Sekunden
    hold: uniform(3), // Rückzug zur Form bei progress 0
    radius: uniform(2), // Größe der Emitter-Form
    emitter: uniform(options.emitter ?? EMITTERS.Kugel),
    bounds: uniform(9), // wer weiter weg ist, wird neu geboren

    mouse: uniform(new THREE.Vector3(999, 999, 999)),
    mouseVelocity: uniform(new THREE.Vector3()),
    mouseOn: uniform(1), // 0 = Maus stört nicht
    mouseStrength: uniform(4),
    mouseRadius: uniform(0.9),
    viewDir: uniform(new THREE.Vector3(0, 0, -1)), // Achse des Maus-Wirbels

    breath: uniform(0), // 0…1: Autopilot lässt das Feld „atmen“

    size: uniform(0.011),
    brightness: uniform(0.055),
    speedRange: uniform(1.2), // ab diesem Tempo ist ein Partikel am Ende des Verlaufs
    colorBy: uniform(0), // 0 = Farbe nach Tempo · 1 = nach Alter
    paper: uniform(0), // 0 leuchtend auf Schwarz · 1 Tinte auf Papier
    colorA: uniform(new THREE.Color(palette[0])),
    colorB: uniform(new THREE.Color(palette[1])),
    colorC: uniform(new THREE.Color(palette[2])),

    // werden vom Modul selbst geschrieben
    delta: uniform(0),
    time: uniform(0),
    fieldTime: uniform(0),
    seed: uniform(0),
  };
  const u = uniforms;

  // ----------------------------------------------------------
  // 1 · Speicher: ein Eintrag pro Partikel, direkt auf der GPU
  // ----------------------------------------------------------
  // instancedArray legt einen Storage-Buffer an, den Compute-Shader lesen
  // und schreiben und den der Vertex-Shader fürs Zeichnen liest.
  // Die Daten verlassen die Grafikkarte nie.
  const positions = instancedArray(maxCount, "vec3");
  const velocities = instancedArray(maxCount, "vec3");
  const homes = instancedArray(maxCount, "vec3"); // Geburtsort, für progress = 0
  const lives = instancedArray(maxCount, "float"); // 1 = frisch geboren … 0 = abgelaufen

  const textPoints = instancedArray(TEXT_POINTS, "vec4");
  setText(options.text ?? "flow");

  const spawn = createSpawn({ emitter: u.emitter, radius: u.radius, textPoints });

  // ----------------------------------------------------------
  // 2 · Init-Compute: alle Partikel auf die Form, Alter zufällig
  // ----------------------------------------------------------
  // Zufälliges Alter, damit nicht alle im selben Takt sterben (sonst „pumpt“ es)
  const initCompute = Fn(() => {
    const i = instanceIndex;
    const p = spawn(i.add(u.seed.toUint()));
    positions.element(i).assign(p);
    homes.element(i).assign(p);
    velocities.element(i).assign(vec3(0));
    lives.element(i).assign(hash(i.add(31337)));
  })().compute(maxCount);

  // ----------------------------------------------------------
  // 3 · Update-Compute: jeden Frame, für jeden Partikel parallel
  // ----------------------------------------------------------
  const updateCompute = Fn(() => {
    const i = instanceIndex;
    const pos = positions.element(i).toVar();
    const vel = velocities.element(i).toVar();
    const home = homes.element(i).toVar();
    const life = lives.element(i).toVar();
    const p = u.progress;

    // progress formt den Charakter: ruhig = schwache, große Wirbel;
    // wild = starke, feinere Wirbel. Autopilot lässt beides langsam atmen.
    const breathA = sin(u.time.mul(0.29)).mul(u.breath).mul(0.35).add(1);
    const breathB = sin(u.time.mul(0.17).add(1.3)).mul(u.breath).mul(0.18).add(1);
    const strength = u.strength.mul(mix(0.15, 1.2, p)).mul(breathA);
    const frequency = u.frequency.mul(mix(0.6, 1.25, p)).mul(breathB);

    // a) Wunsch-Geschwindigkeit aus dem Curl-Feld.
    //    fieldTime verschiebt die Abfrage durchs Noise → das Feld verändert sich langsam.
    const t = u.fieldTime;
    const samplePos = pos.mul(frequency).add(vec3(t.mul(0.6), t.mul(-0.35), t));
    const flow = curlNoise(samplePos).mul(strength).toVar();

    // b) Bei progress 0 zieht jeder Partikel zurück zu seinem Geburtsort →
    //    die Form bleibt lesbar und „flimmert“ nur. Quadratisch, damit sie
    //    schon bei progress 0.5 fast frei fließt.
    flow.addAssign(home.sub(pos).mul(u.hold.mul(p.oneMinus().pow(2))));

    // c) Maus-Wirbel: Drehung um die Blickachse, nur in der Nähe der Maus.
    //    Eine reine Drehung um eine Achse ist selbst divergenzfrei –
    //    der Wirbel passt sich also ins Feld ein, statt Partikel zu stauen.
    If(u.mouseOn.greaterThan(0.5), () => {
      const toP = pos.sub(u.mouse);
      const falloff = exp(toP.dot(toP).div(u.mouseRadius.mul(u.mouseRadius)).negate());
      const swirl = cross(u.viewDir, toP).mul(u.mouseStrength);
      flow.addAssign(swirl.add(u.mouseVelocity.mul(0.6)).mul(falloff));
    });

    // d) Trägheit: die Geschwindigkeit nähert sich dem Feld an, statt
    //    hart gesetzt zu werden. Warum?
    //    – Hart gesetzt knickt jede Bahn sofort ab, wenn sich das Feld ändert:
    //      eckige Linien, alle Partikel kleben exakt auf denselben Stromlinien.
    //    – Mit Trägheit tragen Partikel ihren Schwung kurz weiter, schwingen
    //      über die Stromlinie hinaus und fächern sich auf → weiche Kurven,
    //      seidige Bündel statt Draht.
    //    1 − exp(−Δt/τ) macht das unabhängig von der Bildrate (60 oder 120 Hz).
    const follow = float(1).sub(exp(u.delta.div(u.inertia.max(0.01)).negate()));
    vel.addAssign(flow.sub(vel).mul(follow));
    pos.addAssign(vel.mul(u.delta));

    // e) Lebensdauer: jeder Partikel lebt etwas anders lang (60–140 %)
    const lifespan = u.lifetime.mul(hash(i.add(4711)).mul(0.8).add(0.6));
    life.subAssign(u.delta.div(lifespan));

    // f) Abgelaufen oder zu weit weg → neu geboren an der Emitter-Form.
    //    seed wechselt jeden Frame, damit der neue Ort jedes Mal ein anderer ist.
    If(life.lessThan(0).or(pos.length().greaterThan(u.bounds)), () => {
      const p0 = spawn(i.add(u.seed.toUint()));
      pos.assign(p0);
      home.assign(p0);
      vel.assign(vec3(0));
      life.assign(1);
    });

    positions.element(i).assign(pos);
    velocities.element(i).assign(vel);
    homes.element(i).assign(home);
    lives.element(i).assign(life);
  })().compute(maxCount);

  // ----------------------------------------------------------
  // 4 · Rendering: ein Sprite, hunderttausendfach instanziert
  // ----------------------------------------------------------
  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false, // Partikel verdecken sich nicht …
    blending: THREE.AdditiveBlending, // … sondern addieren ihr Licht
  });

  // .toAttribute(): Instanz Nr. 5 liest Eintrag Nr. 5 aus dem Storage-Buffer
  const lifeAttr = lives.toAttribute();
  material.positionNode = positions.toAttribute();

  // Sanftes Ein- und Ausblenden: die ersten 15 % und die letzten 20 % des Lebens
  const fadeIn = smoothstep(0.85, 1, lifeAttr).oneMinus();
  const fadeOut = smoothstep(0, 0.2, lifeAttr);
  const lifeAlpha = fadeIn.mul(fadeOut);

  material.scaleNode = u.size.mul(lifeAlpha.mul(0.5).add(0.5));

  // Verlauf über drei Farben – Position im Verlauf nach Tempo oder Alter
  const speed = velocities.toAttribute().length();
  const g = mix(smoothstep(0, u.speedRange, speed), lifeAttr.oneMinus(), u.colorBy);
  const gradient = mix(mix(u.colorA, u.colorB, smoothstep(0, 0.5, g)), u.colorC, smoothstep(0.5, 1, g));

  // Auf Papier: Tinte schluckt Licht. Wir schreiben „wie viel geschluckt wird“
  // (1 − Farbe) in den Puffer, die Komposition rechnet daraus Papier × e^(−Tinte).
  const ink = gradient.oneMinus().mul(0.9).add(0.1);
  material.colorNode = mix(gradient, ink.mul(1.6), u.paper).mul(u.brightness);

  // Runder, weicher Punkt: Abstand zur Sprite-Mitte → Transparenz
  const soft = smoothstep(0, 0.5, uv().sub(0.5).length()).oneMinus().pow(2);
  material.opacityNode = soft.mul(lifeAlpha);

  const sprite = new THREE.Sprite(material);
  sprite.frustumCulled = false; // die Bounding-Box kennt die GPU-Positionen nicht
  scene.add(sprite);

  // ----------------------------------------------------------
  // API
  // ----------------------------------------------------------
  let running = false;
  let fieldTime = 0;
  let time = 0;

  function setCount(count) {
    const n = Math.min(count, maxCount);
    updateCompute.count = n;
    sprite.count = n;
  }

  // Neuer Text = neue Punktwolke hochladen. Kein Shader-Neubau nötig.
  function setText(text) {
    textPoints.value.array.set(sampleText(text));
    textPoints.value.needsUpdate = true;
  }

  function reset() {
    u.seed.value = Math.floor(Math.random() * 1e6);
    renderer.compute(initCompute);
  }

  function step(delta) {
    if (!running) return;
    time += delta;
    // Feldzeit aufsummieren statt time × speed: so springt das Feld nicht,
    // wenn jemand am Geschwindigkeits-Regler dreht
    fieldTime += delta * u.fieldSpeed.value;

    u.delta.value = delta;
    u.time.value = time;
    u.fieldTime.value = fieldTime;
    u.seed.value = Math.floor(Math.random() * 1e6);
    renderer.compute(updateCompute);
  }

  setCount(options.count ?? 400_000);
  reset();

  return {
    object: sprite,
    uniforms,
    progress: uniforms.progress, // Kurzweg für GSAP: gsap.to(flow.progress, { value: 1 })
    maxCount,
    start() {
      running = true;
      sprite.visible = true;
    },
    stop() {
      running = false;
    },
    update: step,
    reset,
    setCount,
    setText,
    setPalette(colors) {
      uniforms.colorA.value.set(colors[0]);
      uniforms.colorB.value.set(colors[1]);
      uniforms.colorC.value.set(colors[2]);
    },
    dispose() {
      running = false;
      scene.remove(sprite);
      material.dispose();
      initCompute.dispose();
      updateCompute.dispose();
      // Die Storage-Buffer hängen an den Compute-Nodes und am Material –
      // mit deren dispose() gibt der Renderer auch den GPU-Speicher frei
    },
  };
}
