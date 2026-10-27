// ============================================================
// CONTROLS – Maus-Wirbel und Tasten
// ============================================================

import * as THREE from "three/webgpu";

// ------------------------------------------------------------
// Maus → Punkt im Raum
// ------------------------------------------------------------
// Die Maus ist 2D, das Feld 3D. Wir schießen einen Strahl von der Kamera
// durch den Mauspunkt und schneiden ihn mit einer Ebene durch die Mitte,
// die zur Kamera schaut. Dort sitzt das Zentrum des Wirbels.
export function createPointer(canvas, camera, flow) {
  const u = flow.uniforms;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  const last = new THREE.Vector3();
  let inside = false;
  let moved = false;

  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    inside = moved = true;
  });
  canvas.addEventListener("pointerleave", () => (inside = false));

  return function update(delta) {
    camera.getWorldDirection(u.viewDir.value);

    if (!inside) {
      // Weit weg parken: exp(−d²) ist dort praktisch 0
      u.mouse.value.set(999, 999, 999);
      u.mouseVelocity.value.set(0, 0, 0);
      return;
    }

    if (moved) {
      plane.setFromNormalAndCoplanarPoint(u.viewDir.value, new THREE.Vector3());
      raycaster.setFromCamera(ndc, camera);
      raycaster.ray.intersectPlane(plane, hit);
      moved = false;
    }

    // Mausgeschwindigkeit: die Partikel werden ein Stück mitgezogen
    u.mouseVelocity.value.subVectors(hit, last).divideScalar(Math.max(delta, 1e-3)).clampLength(0, 12);
    last.copy(hit);
    u.mouse.value.lerp(hit, 1 - Math.exp(-delta * 20));
  };
}

// ------------------------------------------------------------
// Tasten
// ------------------------------------------------------------
// H Panel · S Screenshot · R Reset · C Palette · B Nacht/Papier · F Format · A Autopilot
export function bindKeys(actions) {
  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    const action = actions[e.key.toLowerCase()];
    if (action) {
      e.preventDefault();
      action();
    }
  });
}
