import * as THREE from "three";

// Feiner Staub, der beim festen Griff aus dem Stoff steigt und im Streiflicht glitzert.
export class Dust {
  constructor(max = 700) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);   // verbleibend
    this.span = new Float32Array(max).fill(1);
    const seed = new Float32Array(max);
    for (let i = 0; i < max; i++) seed[i] = Math.random();

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixel: { value: 1 },
        uLightDir: { value: new THREE.Vector3(0, -1, 0) },
      },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSeed;
        uniform float uTime, uPixel;
        uniform vec3 uLightDir;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Glitzern: Partikel drehen sich und blitzen kurz im Licht auf
          float tw = pow(0.5 + 0.5 * sin(uTime * (3.0 + aSeed * 9.0) + aSeed * 40.0), 10.0);
          vA = aAlpha * (0.18 + 1.6 * tw);
          gl_PointSize = (0.9 + aSeed * 1.8 + tw * 1.4) * uPixel * (30.0 / -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - smoothstep(0.1, 0.5, length(c));
          gl_FragColor = vec4(vec3(1.0, 0.96, 0.88) * vA * d * 2.2, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }

  emit(origin, normal, count, force = 1) {
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const r = Math.random() * 1.6;
      const a = Math.random() * Math.PI * 2;
      this.pos[i * 3] = origin.x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = origin.y + Math.sin(a) * r * 0.6;
      this.pos[i * 3 + 2] = origin.z + (Math.random() - 0.3) * 0.8;
      const up = 0.6 + Math.random() * 1.6 * force;
      this.vel[i * 3] = (Math.random() - 0.5) * 1.4 * force + normal.x * up;
      this.vel[i * 3 + 1] = 0.9 + Math.random() * 1.2 * force + normal.y * up;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8 + normal.z * up;
      this.span[i] = this.life[i] = 2.2 + Math.random() * 3.5;
    }
  }

  update(dt, time) {
    this.material.uniforms.uTime.value = time;
    const alpha = this.geometry.attributes.aAlpha.array;
    const drag = Math.exp(-dt * 1.4);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = i * 3;
      // Thermik: leichtes Steigen und Wirbeln
      this.vel[t] = this.vel[t] * drag + Math.sin(time * 0.9 + i) * 0.25 * dt;
      this.vel[t + 1] = this.vel[t + 1] * drag + 0.35 * dt;
      this.vel[t + 2] = this.vel[t + 2] * drag + Math.cos(time * 0.7 + i * 1.3) * 0.2 * dt;
      this.pos[t] += this.vel[t] * dt;
      this.pos[t + 1] += this.vel[t + 1] * dt;
      this.pos[t + 2] += this.vel[t + 2] * dt;
      const k = this.life[i] / this.span[i];
      alpha[i] = Math.max(0, Math.min(1, (1 - k) * 8) * Math.min(1, k * 2.5)) * 0.85;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
