import * as THREE from "three";
import gsap from "gsap";

// Gedämpfte Feder: x'' = k (Ziel − x) − c x'
function springStep(s, target, k, zeta, dt) {
  const c = 2 * Math.sqrt(k) * zeta;
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
}

export const physics = {
  gripStiffness: 260,  // Zupacken: wie schnell der Stoff zur Hand gezogen wird
  gripDamping: 0.72,
  releaseStiffness: 70, // Loslassen: Rückfederung
  releaseDamping: 0.22, // < 1 = schwingt nach
  maxPull: 3.4,         // cm, weiche Grenze für den Zug
  memoryHold: 0.7,      // s, so lange bleiben die Falten voll stehen
  memoryDecay: 2.6,     // s, Zeitkonstante des Ausglättens
};

export class Interaction {
  constructor(ctx, { audio, onWord }) {
    this.ctx = ctx;
    this.u = ctx.uniforms;
    this.audio = audio;
    this.onWord = onWord;

    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2(2, 2);
    this.pointerDirty = false;
    this.hoverHit = null;
    this.pressed = false;
    this.ghost = false;
    this.hold = 0;
    this.grips = 0;
    this.lastInput = performance.now();
    this.memAge = 0;
    this.lastYank = -10;
    this.tension = 0;

    this.grip = { x: 0, v: 0 };
    this.twist = { x: 0, v: 0 };
    this.pull = [0, 1, 2].map(() => ({ x: 0, v: 0 }));
    this.hover = { x: 0, v: 0 };

    this.dragPlane = new THREE.Plane();
    this.dragStart = new THREE.Vector3();
    this.dragNow = new THREE.Vector3();
    this.prevDrag = new THREE.Vector3();
    this.dragVel = 0;
    this.focusPoint = new THREE.Vector3(0, 0, 0);
    this.focusDist = 30;
    this.shake = { x: 0, y: 0, r: 0 };

    const el = ctx.renderer.domElement;
    el.addEventListener("pointermove", (e) => this.onMove(e));
    el.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => this.onUp(e));
    el.addEventListener("pointerleave", () => { if (!this.pressed) this.ndc.set(2, 2); this.pointerDirty = true; });
  }

  setNdc(e) {
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointerDirty = true;
    this.lastInput = performance.now();
  }

  onMove(e) { this.setNdc(e); }

  raycast() {
    this.ray.setFromCamera(this.ndc, this.ctx.camera);
    const hit = this.ray.intersectObject(this.ctx.proxy, false)[0];
    return hit ? this.frameAt(hit.point) : null;
  }

  // Nächsten Rahmen der Mittellinie zum Trefferpunkt suchen
  frameAt(point) {
    let best = null, bd = Infinity;
    for (const f of this.ctx.frames) {
      const d = f.C.distanceToSquared(point);
      if (d < bd) { bd = d; best = f; }
    }
    return { point: point.clone(), ...best };
  }

  onDown(e) {
    this.audio.unlock();
    this.setNdc(e);
    e.target.setPointerCapture?.(e.pointerId);
    const hit = this.raycast();
    if (!hit) return;
    this.stopGhost();
    this.beginGrip(hit);
  }

  beginGrip(hit) {
    const u = this.u;
    this.pressed = true;
    this.hold = 0;
    this.grips++;
    this.gripHit = hit;
    u.uGripPos.value.copy(hit.point);
    u.uGripT.value.copy(hit.T);
    u.uGripW.value.copy(hit.W);
    u.uGripN.value.copy(hit.N);
    u.uGripS.value = hit.s;
    u.uGripSeed.value = Math.random();
    this.dragStart.copy(hit.point);
    this.dragNow.copy(hit.point);
    this.prevDrag.copy(hit.point);
    const camDir = new THREE.Vector3();
    this.ctx.camera.getWorldDirection(camDir);
    this.dragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point);
    this.focusPoint.copy(hit.point);

    // Abnutzung: jeder Griff hinterlässt Spuren
    u.uWear.value = Math.min(1, this.grips / 14);
    gsap.to(u.uFray, { value: 1 + u.uWear.value * 0.9, duration: 1.2, ease: "power2.out" });
    if (this.grips === 14) this.onWord("OSS", 3.2);

    this.audio.grip(1);
    this.ctx.dust.emit(hit.point, hit.N, 18, 0.6);
    this.kick(0.09);
  }

  onUp() {
    if (!this.pressed || this.ghost) return;
    this.release();
  }

  release() {
    const u = this.u;
    this.pressed = false;
    // Falten bleiben als Erinnerung stehen
    u.uMemory.value = Math.max(u.uMemory.value * 0.5, Math.min(1.4, this.grip.x + this.pullLen() * 0.15));
    u.uMemPos.value.copy(u.uGripPos.value).add(this.pullVec());
    u.uMemT.value.copy(u.uGripT.value);
    u.uMemW.value.copy(u.uGripW.value);
    u.uMemSeed.value = u.uGripSeed.value;
    this.memAge = 0;
  }

  pullVec() { return new THREE.Vector3(this.pull[0].x, this.pull[1].x, this.pull[2].x); }
  pullLen() { return this.pullVec().length(); }

  // Kamera-Shake beim Zupacken
  kick(amount) {
    const s = this.shake;
    gsap.killTweensOf(s);
    const tl = gsap.timeline();
    for (let i = 0; i < 6; i++) {
      const f = amount * (1 - i / 6);
      tl.to(s, { x: (Math.random() - 0.5) * f, y: (Math.random() - 0.5) * f, r: (Math.random() - 0.5) * f * 0.02, duration: 0.045, ease: "sine.inOut" });
    }
    tl.to(s, { x: 0, y: 0, r: 0, duration: 0.25, ease: "power2.out" });
  }

  // Unsichtbare Hand: zeigt den Griff ohne Maus (Einstieg und im Leerlauf)
  ghostGrip(delay = 0) {
    const f = this.frameAt(new THREE.Vector3(0.6, -0.1, 0.4));
    const point = f.C.clone().addScaledVector(f.W, 0.5).addScaledVector(f.N, 0.6);
    const hit = { ...f, point };
    const target = { t: 0 };
    const dir = new THREE.Vector3(1.6, -2.2, 1.2);
    this.ghostTl = gsap.timeline({ delay })
      .call(() => { this.ghost = true; this.beginGrip(hit); })
      .to(target, {
        t: 1, duration: 1.3, ease: "power2.inOut",
        onUpdate: () => this.dragNow.copy(point).addScaledVector(dir, target.t),
      })
      .to({}, { duration: 0.35 })
      .call(() => { this.ghost = false; this.release(); });
  }

  stopGhost() {
    if (this.ghostTl) this.ghostTl.kill();
    if (this.ghost) { this.ghost = false; this.release(); }
  }

  update(dt, time) {
    const u = this.u;
    const p = physics;

    // Raycast höchstens einmal pro Frame
    if (this.pointerDirty) {
      this.pointerDirty = false;
      if (this.pressed && !this.ghost) {
        this.ray.setFromCamera(this.ndc, this.ctx.camera);
        this.ray.ray.intersectPlane(this.dragPlane, this.dragNow);
      } else if (!this.pressed) {
        this.hoverHit = this.ndc.x > 1 ? null : this.raycast();
      }
    }

    // Ziele
    let gripTarget = 0, twistTarget = 0;
    const drag = this.dragNow.clone().sub(this.dragStart);
    if (this.pressed) {
      this.hold += dt;
      // Entdeckung: lange halten → der Griff zieht nach (Knöchel werden weiß)
      gripTarget = 1 + 0.45 * THREE.MathUtils.smoothstep(this.hold, 1.8, 3.6);
      const len = drag.length();
      if (len > 1e-4) drag.multiplyScalar((p.maxPull * Math.tanh(len / p.maxPull)) / len);
      twistTarget = THREE.MathUtils.clamp(drag.dot(this.gripHit.W) * 0.1 + 0.1 * Math.sign(drag.dot(this.gripHit.W) || 1), -0.55, 0.55);

      // Entdeckung: Ruck → Kuzushi
      const speed = this.dragNow.distanceTo(this.prevDrag) / Math.max(dt, 1e-3);
      this.dragVel = THREE.MathUtils.lerp(this.dragVel, speed, 0.5);
      if (!this.ghost && this.dragVel > 25 && time - this.lastYank > 1.4 && drag.length() > 1.2) {
        this.lastYank = time;
        this.onWord("KUZUSHI", 1.6);
        this.audio.yank();
        this.kick(0.35);
        this.ctx.dust.emit(u.uGripPos.value, this.gripHit.N, 90, 1.6);
        this.grip.v += 6;
      }
      this.prevDrag.copy(this.dragNow);
    } else {
      drag.set(0, 0, 0);
    }

    const k = this.pressed ? p.gripStiffness : p.releaseStiffness;
    const z = this.pressed ? p.gripDamping : p.releaseDamping;
    // Feste Teilschritte für stabile Federn
    const steps = Math.ceil(dt / (1 / 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      springStep(this.grip, gripTarget, k, z, h);
      springStep(this.twist, twistTarget, k * 0.6, z, h);
      springStep(this.pull[0], drag.x, k * 0.8, z, h);
      springStep(this.pull[1], drag.y, k * 0.8, z, h);
      springStep(this.pull[2], drag.z, k * 0.8, z, h);
    }
    u.uGrip.value = this.grip.x;
    u.uTwist.value = this.twist.x;
    u.uPull.value.set(this.pull[0].x, this.pull[1].x, this.pull[2].x);

    // Erinnerung glättet sich langsam
    this.memAge += dt;
    if (this.memAge > p.memoryHold) u.uMemory.value *= Math.exp(-dt / p.memoryDecay);

    // Hover-Atem
    const hovering = !this.pressed && this.hoverHit;
    springStep(this.hover, hovering ? 1 : 0, 30, 0.9, dt);
    u.uHover.value = Math.max(0, this.hover.x);
    if (this.hoverHit) u.uHoverPos.value.lerp(this.hoverHit.point, 1 - Math.exp(-dt * 12));

    // Staub bei festem Griff und Bewegung
    const tension = Math.max(0, this.grip.x) * (0.5 + this.pullLen() / p.maxPull);
    const rate = (tension - this.tension) / Math.max(dt, 1e-3);
    this.tension = tension;
    if (this.pressed && (tension > 1.05 || Math.abs(rate) > 1.2) && Math.random() < dt * 30 * tension) {
      this.ctx.dust.emit(u.uGripPos.value.clone().add(u.uPull.value), this.gripHit.N, 1, 0.5);
    }
    this.audio.update(dt, this.pressed ? tension : tension * 0.3, rate);

    // Fokus folgt dem Griffpunkt, sonst dem Cursor
    if (this.pressed) this.focusPoint.copy(u.uGripPos.value).add(u.uPull.value);
    else if (this.hoverHit) this.focusPoint.lerp(this.hoverHit.point, 1 - Math.exp(-dt * 4));

    // Leerlauf: nach einer Weile greift die unsichtbare Hand wieder zu
    if (!this.pressed && performance.now() - this.lastInput > 11000) {
      this.lastInput = performance.now();
      this.ghostGrip(0);
    }
  }
}
