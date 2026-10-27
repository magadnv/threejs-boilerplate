// ============================================================
// INTERACTION – Maus auf den Boden, Klick = Schockwelle, Autopilot
// ============================================================
// Raycast auf eine mathematische Ebene (y = 0), NICHT auf das InstancedMesh:
// - Die Säulen bewegen sich nur im Shader, die CPU kennt ihre Höhe gar nicht.
// - 40.000 Instanzen einzeln zu testen wäre teuer.
// Ein Strahl gegen eine Ebene ist eine einzige Rechnung.

import * as THREE from "three/webgpu";

export function createInteraction({ canvas, camera, field, extent }) {
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const down = { x: 0, y: 0 };

  // Bildschirm → Boden-Punkt (oder null, wenn der Strahl den Boden verfehlt)
  function pickFloor(event) {
    const rect = canvas.getBoundingClientRect(); // Canvas kann skaliert sein (Taste F)
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(floorPlane, hit);
  }

  canvas.addEventListener("pointermove", (event) => {
    if (autopilot.enabled) return;
    const point = pickFloor(event);
    if (point) field.setPointer(point.x, point.z);
    else field.setPointer(null);
  });

  canvas.addEventListener("pointerleave", () => {
    if (!autopilot.enabled) field.setPointer(null);
  });

  // Klick nur, wenn die Maus sich kaum bewegt hat – sonst war es Orbit-Ziehen
  canvas.addEventListener("pointerdown", (event) => {
    down.x = event.clientX;
    down.y = event.clientY;
  });
  canvas.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    const point = pickFloor(event);
    if (point) field.shock(point.x, point.z);
  });

  // --- Autopilot (Taste A): Aufnehmen ohne Maus ---
  // Eine „Geister-Maus“ wandert auf einer Lissajous-Bahn übers Feld,
  // Schockwellen kommen in zufälligen Abständen.
  const autopilot = {
    enabled: false,
    time: 0,
    nextShock: 0.6,

    update(delta) {
      if (!this.enabled) return;
      this.time += delta;

      const r = extent * 0.3;
      field.setPointer(Math.sin(this.time * 0.23) * r, Math.sin(this.time * 0.31 + 1) * r * 0.8);

      this.nextShock -= delta;
      if (this.nextShock <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * extent * 0.35;
        field.shock(Math.cos(angle) * dist, Math.sin(angle) * dist, 0.7 + Math.random() * 0.5);
        this.nextShock = 1.4 + Math.random() * 2.6;
      }
    },

    toggle() {
      this.enabled = !this.enabled;
      this.nextShock = 0.3;
      if (!this.enabled) field.setPointer(null);
      return this.enabled;
    },
  };

  return { autopilot };
}
