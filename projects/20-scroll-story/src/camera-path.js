// ============================================================
// CAMERA-PATH – zwei Kurven: wo die Kamera ist, wohin sie schaut
// ============================================================
// Position und Blickziel haben je eine eigene CatmullRomCurve3 mit GLEICH
// vielen Punkten. Punkt i der Kamera-Kurve gehört zu Punkt i der Blick-Kurve.
//
// getPointAt(u) läuft nach Bogenlänge: gleicher Scroll-Weg = gleiche Strecke,
// die Kamera wird also nicht in langen Kurvenstücken plötzlich schneller.
// Für den Blick nehmen wir dasselbe „t“ (getUtoTmapping) – so bleibt
// Punkt i immer bei Punkt i, egal wie unterschiedlich lang die Kurven sind.
//
// Warum Lerp/Damping? GSAP liefert pro Frame einen Zielwert (state.t). Würde
// die Kamera ihn direkt übernehmen, sähe man jedes Mausrad-Rasten und jeden
// Knick der Kurve. damp() holt jeden Frame einen festen Anteil des Abstands auf
// – unabhängig von der Bildrate. Das gibt der Kamera Masse: sie „schwebt nach“.

import * as THREE from "three/webgpu";

const v = (x, y, z) => new THREE.Vector3(x, y, z);

// Das Siegel steht am Ende der Reise hier:
export const SEAL_CENTER = v(0, 0, -46);

const CAM_POINTS = [
  v(0, 0.3, 9), //   0 · Intro: weit weg, das Objekt allein im Dunkeln
  v(0.9, 0.25, 4.2), // 1 · Annäherung: nah dran
  v(0.4, 0.1, 1.1), //  2 · Eintauchen in die Splitter
  v(-2.2, 1.1, -8), //  3 · Reise …
  v(2.2, -0.9, -18), // 4
  v(-1.4, 0.6, -28), // 5
  v(0, 0.1, -36), //    6 · Ankunft vor dem Siegel
];

const LOOK_POINTS = [
  v(0, 0, 0),
  v(0, 0, 0),
  v(0, 0, -5),
  v(0.5, 0, -17),
  v(-0.5, 0, -27),
  v(0, 0, -37),
  SEAL_CENTER.clone(),
];

export function createCameraPath() {
  const cam = new THREE.CatmullRomCurve3(CAM_POINTS, false, "centripetal");
  const look = new THREE.CatmullRomCurve3(LOOK_POINTS, false, "centripetal");

  // u (Bogenlänge 0..1) an Kontrollpunkt i – damit Kapitel exakt
  // „bis Punkt 5“ fahren können statt „bis ungefähr 0.73“
  const lengths = cam.getLengths(600);
  const uAt = (i) => lengths[Math.round((i / (CAM_POINTS.length - 1)) * 600)] / lengths[600];

  return {
    cam,
    look,
    // Schlüsselstellen auf dem Pfad, die die Kapitel ansteuern
    keys: {
      intro: uAt(1) * 0.22,
      close: uAt(1),
      journeyEnd: uAt(5),
      seal: 1,
    },
  };
}

// ------------------------------------------------------------
// Kamera-Rig: GSAP schreibt in `state`, update() führt die Kamera gedämpft nach
// ------------------------------------------------------------
export function createCameraRig(camera, path, { reduced, parallax }) {
  // Diese Werte animieren die Kapitel-Timelines
  const state = { t: 0, pull: 0, lift: 0, drop: 0 };
  // Die tatsächlich benutzten, gedämpften Werte
  const smooth = { t: 0, pull: 0, lift: 0, drop: 0, mx: 0, my: 0 };
  const mouse = { x: 0, y: 0 };

  // Höher = straffer. Bei reduced motion fast ohne Nachschwingen.
  const LAMBDA = reduced ? 14 : 4.5;

  if (parallax) {
    addEventListener("pointermove", (e) => {
      mouse.x = (e.clientX / innerWidth) * 2 - 1;
      mouse.y = (e.clientY / innerHeight) * 2 - 1;
    });
  }

  const pos = new THREE.Vector3();
  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const { damp, clamp } = THREE.MathUtils;

  function update(dt) {
    smooth.t = damp(smooth.t, state.t, LAMBDA, dt);
    smooth.pull = damp(smooth.pull, state.pull, LAMBDA * 0.6, dt);
    smooth.lift = damp(smooth.lift, state.lift, LAMBDA * 0.6, dt);
    smooth.drop = damp(smooth.drop, state.drop, LAMBDA * 0.6, dt);
    // Parallax langsamer als Scroll – fühlt sich an wie eine Handkamera
    smooth.mx = damp(smooth.mx, mouse.x, 2.2, dt);
    smooth.my = damp(smooth.my, mouse.y, 2.2, dt);

    const u = clamp(smooth.t, 0, 1);
    path.cam.getPointAt(u, pos);
    path.look.getPoint(path.cam.getUtoTmapping(u), target);
    // Blickziel senken = Motiv rutscht im Bild nach oben (Platz für die Outro-Headline)
    target.y -= smooth.drop;

    // Kamera-Basis aus der Blickrichtung
    dir.subVectors(target, pos).normalize();
    right.crossVectors(dir, WORLD_UP).normalize();
    up.crossVectors(right, dir);

    // Outro: entlang der Blickrichtung zurückziehen und leicht anheben
    pos.addScaledVector(dir, -smooth.pull).addScaledVector(up, smooth.lift);

    // Maus-Parallax: kleiner Versatz quer zur Blickrichtung, Ziel bleibt fix
    pos.addScaledVector(right, smooth.mx * 0.35).addScaledVector(up, -smooth.my * 0.22);

    camera.position.copy(pos);
    camera.lookAt(target);
  }

  return { state, smooth, update };
}

// Sichtbarer Pfad für den Debug-Modus
export function createPathHelper(path) {
  const group = new THREE.Group();
  const line = (curve, color) => {
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(400));
    const mat = new THREE.LineBasicNodeMaterial({ color, fog: false, transparent: true, opacity: 0.8 });
    return new THREE.Line(geo, mat);
  };
  group.add(line(path.cam, 0xcf1830), line(path.look, 0x6f7bff));

  // Punkte auf die Blick-Kurve – auf der Kamera-Kurve säße man in ihnen drin
  const dotGeo = new THREE.SphereGeometry(0.08, 12, 8);
  const dotMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, fog: false });
  for (const p of path.look.points) {
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(p);
    group.add(dot);
  }
  group.visible = false;
  return group;
}
