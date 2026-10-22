import * as THREE from "three/webgpu";

// Ein Wollknäuel aus roten Fäden. Jeder Faden ist ein Mensch auf der code.talks:
// ein leicht taumelnder Großkreis, aus seinem Wort berechnet. Spätere Fäden
// wickeln weiter außen, das Knäuel wächst also mit jedem Gespräch.

const PAPER = new THREE.Color("#ffffff");
const INK = new THREE.Color("#16130f");
const SIGNAL = new THREE.Color("#cf1830");
const TAU = Math.PI * 2;
const THICK = 0.0034;
const RADIAL = 4;
const SETTLE = 3.2; // Sekunden, bis ein neuer Faden von Schwarz zu Rot wird

function hashStr(s) {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const layerRadius = (i) => 0.62 + 0.38 * Math.cbrt(i / 80);
const ease = (t) => 1 - Math.pow(1 - t, 3);

function windingCurve(seed, radius) {
  const r = mulberry32(seed);
  const unit = () => {
    const z = r() * 2 - 1;
    const a = r() * TAU;
    const s = Math.sqrt(1 - z * z);
    return new THREE.Vector3(s * Math.cos(a), z, s * Math.sin(a));
  };

  const normal = unit();
  const helper = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(normal, helper).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);
  const drift = unit();
  const precess = (r() - 0.5) * 1.6;
  const turns = 0.9 + r() * 0.9;
  const start = r() * TAU;
  const wobbleF = 2 + Math.floor(r() * 4);
  const wobbleP = r() * TAU;

  const n = Math.ceil(turns * 48);
  const q = new THREE.Quaternion();
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const th = start + t * turns * TAU;
    const p = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th));
    p.applyQuaternion(q.setFromAxisAngle(drift, precess * t));
    p.multiplyScalar(radius * (1 + 0.035 * Math.sin(th * wobbleF + wobbleP)));
    pts.push(p);
  }
  return { curve: new THREE.CatmullRomCurve3(pts), turns };
}

export async function createKnaeuel(canvas) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = PAPER;
  scene.fog = new THREE.Fog(PAPER, 2, 6);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  const ball = new THREE.Group();
  scene.add(ball);

  const settled = new THREE.MeshBasicNodeMaterial({ color: SIGNAL });
  const threads = new Map(); // id → { mesh, born, delay, mine, full }
  let outer = layerRadius(0);
  let dist = 4;

  function build(f, index, { animate = false, delay = 0, mine = false, ink = animate } = {}) {
    const radius = layerRadius(index);
    const { curve, turns } = windingCurve(hashStr(`${f.id}|${f.wort}`), radius);
    const geo = new THREE.TubeGeometry(curve, Math.ceil(turns * 150), THICK * (0.85 + radius * 0.25), RADIAL, false);
    const fresh = ink || mine;
    const mat = fresh ? new THREE.MeshBasicNodeMaterial({ color: INK.clone() }) : settled;
    const mesh = new THREE.Mesh(geo, mat);
    ball.add(mesh);
    const full = geo.index.count;
    if (animate) geo.setDrawRange(0, 0);
    threads.set(f.id, { mesh, born: animate ? clock.getElapsed() + delay : -Infinity, mine, full });
    outer = Math.max(outer, radius * 1.04);
  }

  function clear() {
    for (const t of threads.values()) {
      ball.remove(t.mesh);
      t.mesh.geometry.dispose();
      if (t.mesh.material !== settled) t.mesh.material.dispose();
    }
    threads.clear();
    outer = layerRadius(0);
  }

  // --- Bewegung: Eigendrehung plus Ziehen mit Nachlauf ------------------------

  const spin = { yaw: 0, pitch: 0.25, vYaw: 0.14, vPitch: 0 };
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, t: performance.now() };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const now = performance.now();
    const dt = Math.max(16, now - drag.t) / 1000;
    const dx = (e.clientX - drag.x) / canvas.clientWidth;
    const dy = (e.clientY - drag.y) / canvas.clientHeight;
    spin.yaw += dx * 4;
    spin.pitch = THREE.MathUtils.clamp(spin.pitch + dy * 3, -1.2, 1.2);
    spin.vYaw = (dx * 4) / dt;
    spin.vPitch = (dy * 3) / dt;
    drag = { x: e.clientX, y: e.clientY, t: now };
  });
  const release = () => (drag = null);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  // --- Größe ------------------------------------------------------------------

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  function targetDist() {
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    const fit = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
    return (outer / Math.sin(fit)) * 1.12;
  }

  // --- Schleife ---------------------------------------------------------------

  const clock = new THREE.Timer();
  const tmp = new THREE.Color();
  dist = targetDist();

  renderer.setAnimationLoop((time) => {
    clock.update(time);
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = clock.getElapsed();

    if (!drag) {
      spin.vYaw += (0.14 - spin.vYaw) * Math.min(1, dt * 1.2);
      spin.vPitch *= Math.exp(-dt * 3);
      spin.yaw += spin.vYaw * dt;
      spin.pitch = THREE.MathUtils.clamp(spin.pitch + spin.vPitch * dt, -1.2, 1.2);
      spin.pitch += (0.25 - spin.pitch) * dt * 0.3;
    }
    ball.rotation.set(spin.pitch, spin.yaw, 0, "XYZ");

    for (const t of threads.values()) {
      if (t.born === -Infinity) continue;
      const age = now - t.born;
      if (age < 0) continue;
      const step = RADIAL * 6;
      const p = ease(Math.min(1, age / 2.4));
      t.mesh.geometry.setDrawRange(0, Math.floor((t.full / step) * p) * step);
      if (t.mine) continue;
      if (t.mesh.material === settled) {
        if (p >= 1) t.born = -Infinity;
        continue;
      }
      const k = THREE.MathUtils.smoothstep(age, 2.4, 2.4 + SETTLE);
      t.mesh.material.color.copy(tmp.lerpColors(INK, SIGNAL, k));
      if (k >= 1) {
        t.mesh.material.dispose();
        t.mesh.material = settled;
        t.born = -Infinity;
      }
    }

    dist += (targetDist() - dist) * Math.min(1, dt * 2);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    scene.fog.near = dist - outer * 0.4;
    scene.fog.far = dist + outer * 2.4;

    renderer.render(scene, camera);
  });

  return {
    // Alle Fäden neu aufbauen, mit kurzem Einspinnen zum Start.
    set(list, { mineId = null, intro = true } = {}) {
      clear();
      list.forEach((f, i) => build(f, i, {
        animate: intro,
        ink: false,
        delay: intro ? Math.min(i * 0.02, 1.6) : 0,
        mine: f.id === mineId,
      }));
    },
    add(f, opts = {}) {
      if (threads.has(f.id)) return;
      build(f, threads.size, { animate: true, ...opts });
    },
    remove(id) {
      const t = threads.get(id);
      if (!t) return;
      ball.remove(t.mesh);
      t.mesh.geometry.dispose();
      threads.delete(id);
    },
    markMine(id) {
      const t = threads.get(id);
      if (!t || t.mine) return;
      t.mine = true;
      if (t.mesh.material === settled) t.mesh.material = new THREE.MeshBasicNodeMaterial({ color: INK.clone() });
      else t.mesh.material.color.copy(INK);
    },
    has: (id) => threads.has(id),
    get count() {
      return threads.size;
    },
  };
}
