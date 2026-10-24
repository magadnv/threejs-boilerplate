import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Nachtfahrt über den Ocean Drive. Die Welt fährt auf die Kamera zu und wird
// hinten wieder angehängt; gedrückt halten gibt Vollgas, wer lange draufbleibt,
// bekommt Fahndungssterne.

const canvas = document.querySelector("#scene");
const speedEl = document.querySelector("#speed");
const starsEl = document.querySelector(".wanted");
const stars = [...starsEl.children];

const COLORS = {
  skyTop: new THREE.Color("#140a33"),
  skyMid: new THREE.Color("#7a1f73"),
  horizon: new THREE.Color("#ff6a4d"),
  sunTop: new THREE.Color("#ffe48a"),
  sunBottom: new THREE.Color("#ff2d8c"),
  fog: new THREE.Color("#4a1752"),
  deep: new THREE.Color("#120a2e"),
  pink: new THREE.Color("#ff2d95"),
  cyan: new THREE.Color("#4fe8ff"),
  warm: new THREE.Color("#ffc36b"),
};
const FOG = { near: 30, far: 360 };
const SUN_POS = new THREE.Vector3(70, 62, -460);
const LANE = 1.7;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(COLORS.fog, FOG.near, FOG.far);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 1400);
camera.position.set(LANE, 1.35, 6);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const shared = {
  uTime: { value: 0 },
  uTravel: { value: 0 },
  uFog: { value: COLORS.fog },
  uFogNear: { value: FOG.near },
  uFogFar: { value: FOG.far },
};

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFog;
  uniform float uFogNear, uFogFar;
  vec3 applyFog(vec3 col, vec3 w, float amount) {
    float f = smoothstep(uFogNear, uFogFar, distance(w, cameraPosition));
    return mix(col, uFog, f * amount);
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const WORLD_VERT = /* glsl */ `
  varying vec3 vW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// ---------- Himmel ----------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1000, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: COLORS.skyTop },
      uMid: { value: COLORS.skyMid },
      uHorizon: { value: COLORS.horizon },
      uSunDir: { value: SUN_POS.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHorizon, uSunDir;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.12, h));
        col = mix(col, uTop, smoothstep(0.1, 0.45, h));
        // warmer Schein rund um die Sonne
        float sun = max(dot(vDir, uSunDir), 0.0);
        col += uHorizon * pow(sun, 30.0) * 0.35;
        // Sterne oben
        vec2 g = floor(vDir.xz / (vDir.y + 0.3) * 260.0);
        float s = step(0.997, hash(g)) * smoothstep(0.2, 0.5, h);
        col += s * 0.8;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
sky.renderOrder = -2;
scene.add(sky);

// ---------- Sonne mit Synthwave-Streifen ----------
const sun = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: shared.uTime,
      uTop: { value: COLORS.sunTop },
      uBottom: { value: COLORS.sunBottom },
    },
    vertexShader: WORLD_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTop, uBottom;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float d = length(p);
        float disc = smoothstep(0.25, 0.248, d);
        // Streifen wandern nach unten und werden zum Horizont hin breiter
        float y = vUv.y;
        float band = fract(y * 16.0 + uTime * 0.35);
        float gap = mix(0.0, 0.55, smoothstep(0.62, 0.25, y));
        disc *= step(gap, band);
        vec3 col = mix(uBottom, uTop, smoothstep(0.25, 0.75, y)) * 0.9;
        float halo = exp(-d * 8.0) * 0.6;
        gl_FragColor = vec4(col * disc + uBottom * halo, max(disc, halo));
      }
    `,
  })
);
sun.position.copy(SUN_POS);
sun.scale.setScalar(270);
sun.lookAt(0, SUN_POS.y, 0);
sun.renderOrder = -1;
scene.add(sun);

// ---------- Ozean ----------
const ocean = new THREE.Mesh(
  new THREE.PlaneGeometry(700, 900),
  new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uDeep: { value: COLORS.deep },
      uHorizon: { value: COLORS.horizon },
      uSun: { value: COLORS.sunTop },
      uPink: { value: COLORS.pink },
      uSunPos: { value: SUN_POS },
    },
    vertexShader: WORLD_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime, uTravel;
      uniform vec3 uDeep, uHorizon, uSun, uPink, uSunPos;
      varying vec3 vW;
      ${FOG_GLSL}
      void main() {
        vec3 v = vW - cameraPosition;
        float dist = length(v.xz);
        float ang = atan(v.x, -v.z);
        float sunAng = atan(uSunPos.x - cameraPosition.x, -(uSunPos.z - cameraPosition.z));
        float z = vW.z - uTravel;
        float w1 = sin(z * 0.8 + sin(vW.x * 0.21) * 3.0 + uTime * 1.4) * 0.5 + 0.5;
        float w2 = sin(vW.x * 1.3 - z * 0.35 - uTime * 0.9) * 0.5 + 0.5;
        float wave = w1 * w2;
        float spread = 0.06 + 6.0 / (dist + 20.0);
        float streak = exp(-pow((ang - sunAng) / spread, 2.0));
        float glitter = smoothstep(0.55, 0.9, wave) * streak;
        float far = smoothstep(40.0, 420.0, dist);
        vec3 col = mix(uDeep, uHorizon * 0.55, far);
        col += uPink * streak * 0.25 + uSun * glitter * 2.4;
        col += uPink * wave * 0.04;
        gl_FragColor = vec4(applyFog(col, vW, 0.35), 1.0);
      }
    `,
  })
);
ocean.rotation.x = -Math.PI / 2;
ocean.position.set(357, -0.05, -420);
scene.add(ocean);

// ---------- Strand und Land ----------
const flat = (w, d, x, z, color) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, -0.02, z);
  scene.add(m);
};
flat(3.2, 900, 5.4, -420, "#3a1735"); // Sand
flat(500, 900, -254, -420, "#13071d"); // Land unter der Stadt

// ---------- Straße ----------
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(7.6, 900),
  new THREE.ShaderMaterial({
    uniforms: { ...shared, uPink: { value: COLORS.pink }, uWarm: { value: COLORS.warm } },
    vertexShader: WORLD_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime, uTravel;
      uniform vec3 uPink, uWarm;
      varying vec3 vW;
      ${FOG_GLSL}
      void main() {
        float x = vW.x;
        float z = vW.z - uTravel;
        vec3 col = vec3(0.035, 0.02, 0.05);
        col += hash(floor(vW.xz * 40.0)) * 0.015;
        // nasser Glanz Richtung Sonne
        float dist = distance(vW, cameraPosition);
        col += uPink * 0.05 * smoothstep(10.0, 200.0, dist);
        float dash = step(abs(x), 0.07) * step(fract(z / 5.0), 0.45);
        col += uWarm * dash * 1.4;
        float edge = smoothstep(0.08, 0.0, abs(abs(x) - 3.55));
        col += uPink * edge * 3.0;
        gl_FragColor = vec4(applyFog(col, vW, 0.5), 1.0);
      }
    `,
  })
);
road.rotation.x = -Math.PI / 2;
road.position.set(0, 0, -420);
scene.add(road);

// ---------- Hilfen fürs Endlos-Band ----------
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (z, span, front = 12) => ((((z - front) % span) + span) % span) - span + front;
const dummy = new THREE.Object3D();

// ---------- Skyline ----------
const BUILDINGS = 220;
const CITY_SPAN = 420;
const city = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uPink: { value: COLORS.pink },
      uCyan: { value: COLORS.cyan },
      uWarm: { value: COLORS.warm },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW, vLocal, vSeed, vNormal2;
      void main() {
        vec3 scale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vLocal = (position + vec3(0.0, 0.5, 0.0)) * scale;
        vSeed = instanceColor;
        vNormal2 = normal;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uPink, uCyan, uWarm;
      varying vec3 vW, vLocal, vSeed, vNormal2;
      ${FOG_GLSL}
      void main() {
        float height = vLocal.y;
        float top = vSeed.y;
        vec2 face = abs(vNormal2.z) > 0.5 ? vLocal.xy : vLocal.zy;
        vec2 cell = floor(face / vec2(0.9, 1.1));
        vec2 f = fract(face / vec2(0.9, 1.1));
        float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.75);
        float lit = step(0.68, hash(cell + vSeed.x * 91.0));
        vec3 winCol = mix(uWarm, uCyan, step(0.75, hash(cell * 1.7 + vSeed.z * 13.0)));
        vec3 col = mix(vec3(0.05, 0.02, 0.09), vec3(0.16, 0.05, 0.2), height / max(top, 1.0));
        if (vNormal2.y > 0.5) col = vec3(0.03, 0.01, 0.05);
        col += winCol * win * lit * 0.85;
        // Neon-Kante oben
        float crown = smoothstep(top - 0.5, top - 0.05, height) * step(vNormal2.y, 0.5);
        vec3 neon = vSeed.z > 0.5 ? uPink : uCyan;
        col += neon * crown * step(0.45, vSeed.x) * 3.5;
        gl_FragColor = vec4(applyFog(col, vW, 0.9), 1.0);
      }
    `,
  }),
  BUILDINGS
);
const cityData = [];
for (let i = 0; i < BUILDINGS; i++) {
  const row = Math.random();
  const x = -16 - row * row * 120;
  const tower = Math.random() < 0.18;
  const h = tower ? rand(30, 70) : rand(6, 26) * (1 + row);
  cityData.push({
    x,
    z: rand(0, -CITY_SPAN),
    w: rand(4, 9),
    d: rand(4, 9),
    h,
  });
  city.setColorAt(i, new THREE.Color(Math.random(), h, Math.random()));
}
city.frustumCulled = false;
scene.add(city);

// ---------- Palmen ----------
function palmGeometry() {
  const parts = [];
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.25, 2.5, 0),
    new THREE.Vector3(0.7, 5, 0),
    new THREE.Vector3(1.3, 7.2, 0),
  ]);
  parts.push(new THREE.TubeGeometry(curve, 16, 0.13, 5));
  const crown = curve.getPoint(1);
  const FRONDS = 9;
  for (let i = 0; i < FRONDS; i++) {
    const len = rand(2.4, 3.2);
    const g = new THREE.PlaneGeometry(len, 0.7, 12, 1);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const u = (pos.getX(v) + len / 2) / len;
      pos.setXYZ(
        v,
        u * len,
        -0.9 * u * u * len * 0.45,
        pos.getY(v) * Math.sin(Math.PI * Math.min(u * 1.3, 1)) * (1 - u * 0.4)
      );
    }
    g.rotateZ(rand(0.05, 0.45));
    g.rotateY((i / FRONDS) * Math.PI * 2 + rand(-0.2, 0.2));
    g.translate(crown.x, crown.y, crown.z);
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts);
}
const PALMS = 46;
const PALM_SPAN = 276;
const palms = new THREE.InstancedMesh(
  palmGeometry(),
  new THREE.MeshBasicMaterial({ color: "#0d0414", side: THREE.DoubleSide }),
  PALMS
);
const palmData = [];
for (let i = 0; i < PALMS; i++) {
  const right = i % 2 === 0;
  palmData.push({
    x: right ? rand(4.6, 6.4) : rand(-4.8, -6.5),
    z: -i * (PALM_SPAN / PALMS) + rand(-2, 2),
    s: rand(0.85, 1.3),
    ry: right ? rand(-0.6, 0.6) : Math.PI + rand(-0.6, 0.6),
  });
}
palms.frustumCulled = false;
scene.add(palms);

// ---------- Laternen ----------
const LAMPS = 12;
const LAMP_SPAN = 360;
const posts = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.12, 6, 0.12).translate(0, 3, 0),
  new THREE.MeshBasicMaterial({ color: "#0b0410" }),
  LAMPS
);
const bulbs = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.28, 12, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb070").multiplyScalar(4), toneMapped: false }),
  LAMPS
);
posts.frustumCulled = bulbs.frustumCulled = false;
scene.add(posts, bulbs);

// ---------- Verkehr ----------
const CARS = 26;
const CAR_SPAN = 420;
const lights = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.08, 10, 6).scale(1.6, 0.7, 1),
  new THREE.MeshBasicMaterial({ toneMapped: false }),
  CARS * 2
);
const head = new THREE.Color("#fff2dc").multiplyScalar(6);
const tail = new THREE.Color("#ff1840").multiplyScalar(2.5);
const cars = [];
for (let i = 0; i < CARS; i++) {
  const oncoming = i % 3 !== 0;
  cars.push({
    x: oncoming ? -LANE + rand(-0.3, 0.3) : LANE + 1.3,
    z: rand(-40, -CAR_SPAN),
    // vor uns: etwas schneller als Normaltempo, bei Vollgas überholen wir
    v: oncoming ? rand(25, 40) : -rand(28, 36),
    oncoming,
  });
  lights.setColorAt(i * 2, oncoming ? head : tail);
  lights.setColorAt(i * 2 + 1, oncoming ? head : tail);
}
lights.frustumCulled = false;
scene.add(lights);

// ---------- Post: Bloom, Farbsaum, Korn, Blaulicht ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.55, 0.62);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: shared.uTime,
    uBoost: { value: 0 },
    uSiren: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uBoost, uSiren;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec2 off = c * (0.004 + uBoost * 0.018) * r;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // Blaulicht an den Rändern, links rot, rechts blau im Wechsel
      float flip = step(0.5, fract(uTime * 2.4));
      vec3 siren = mix(vec3(1.0, 0.05, 0.15), vec3(0.1, 0.3, 1.0), flip == 1.0 ? smoothstep(0.3, 0.7, vUv.x) : smoothstep(0.7, 0.3, vUv.x));
      col += siren * uSiren * smoothstep(0.35, 0.75, r) * 0.9;
      col *= 1.0 - smoothstep(0.45, 0.85, r) * 0.55;
      col += (hash(vUv * 900.0 + fract(uTime)) - 0.5) * 0.045;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
composer.addPass(finish);

// ---------- Eingabe ----------
const pointer = { x: 0, y: 0 };
let holding = false;
addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = (e.clientY / innerHeight) * 2 - 1;
});
canvas.addEventListener("pointerdown", () => (holding = true));
addEventListener("pointerup", () => (holding = false));
addEventListener("pointercancel", () => (holding = false));
addEventListener("keydown", (e) => {
  if (e.code === "Space") { holding = true; e.preventDefault(); }
});
addEventListener("keyup", (e) => { if (e.code === "Space") holding = false; });

// ---------- Countdown ----------
const release = new Date(2026, 10, 19);
const days = Math.ceil((release - new Date()) / 86400000);
document.querySelector("#countdown").innerHTML =
  days > 0 ? `Noch <b>${days} Tage</b> · 19.11.2026` : `<b>Jetzt draußen</b> · 19.11.2026`;

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- Loop ----------
const clock = new THREE.Clock();
let speed = 0;
let boost = 0;
let heat = 0; // wächst bei Vollgas, daraus werden die Sterne
let travel = 0;
const look = new THREE.Vector3();
const lean = { x: 0, y: 0 };

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  boost += ((holding ? 1 : 0) - boost) * (holding ? 2.2 : 1.4) * dt;
  const target = 26 + boost * 64;
  speed += (target - speed) * Math.min(dt * 1.8, 1);
  travel += speed * dt;
  heat = THREE.MathUtils.clamp(heat + (holding ? dt * 0.55 : -dt * 0.35), 0, 5.4);
  const level = Math.floor(heat);

  shared.uTime.value = t;
  shared.uTravel.value = travel;

  // Kamera: leichtes Wiegen, Maus lenkt den Blick, Vollgas weitet das Bild
  lean.x += (pointer.x - lean.x) * dt * 2;
  lean.y += (pointer.y - lean.y) * dt * 2;
  camera.position.x = LANE + lean.x * 0.7 + Math.sin(t * 0.7) * 0.08;
  camera.position.y = 1.35 + Math.sin(t * 9) * 0.012 * (speed / 30) - lean.y * 0.25;
  camera.fov = 58 + boost * 22;
  camera.updateProjectionMatrix();
  look.set(LANE + 9 + lean.x * 14, 2.6 - lean.y * 3, -60);
  camera.lookAt(look);
  camera.rotateZ(-lean.x * 0.04 + Math.sin(t * 0.5) * 0.01);

  for (let i = 0; i < BUILDINGS; i++) {
    const b = cityData[i];
    dummy.position.set(b.x, b.h / 2, wrap(b.z + travel, CITY_SPAN, 20));
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    city.setMatrixAt(i, dummy.matrix);
  }
  city.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < PALMS; i++) {
    const p = palmData[i];
    dummy.position.set(p.x, 0, wrap(p.z + travel, PALM_SPAN));
    dummy.rotation.set(0, p.ry + Math.sin(t * 0.8 + i) * 0.03, Math.sin(t * 1.1 + i * 0.7) * 0.015);
    dummy.scale.setScalar(p.s);
    dummy.updateMatrix();
    palms.setMatrixAt(i, dummy.matrix);
  }
  palms.instanceMatrix.needsUpdate = true;

  dummy.rotation.set(0, 0, 0);
  for (let i = 0; i < LAMPS; i++) {
    const z = wrap(-i * (LAMP_SPAN / LAMPS) + travel, LAMP_SPAN);
    dummy.scale.setScalar(1);
    dummy.position.set(-4.2, 0, z);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
    dummy.position.set(-3.6, 6, z);
    dummy.updateMatrix();
    bulbs.setMatrixAt(i, dummy.matrix);
  }
  posts.instanceMatrix.needsUpdate = bulbs.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < CARS; i++) {
    const c = cars[i];
    c.z += c.v * dt;
    const z = wrap(c.z + travel, CAR_SPAN, 14);
    for (let k = 0; k < 2; k++) {
      dummy.position.set(c.x + (k ? 0.75 : -0.75), 0.65, z);
      dummy.scale.set(1, 1, c.oncoming ? 1 + speed * 0.04 : 1);
      dummy.updateMatrix();
      lights.setMatrixAt(i * 2 + k, dummy.matrix);
    }
  }
  lights.instanceMatrix.needsUpdate = true;

  bloom.strength = 0.85 + boost * 0.6;
  finish.uniforms.uBoost.value = boost;
  const siren = level >= 3 ? 1 : 0;
  finish.uniforms.uSiren.value += (siren - finish.uniforms.uSiren.value) * dt * 3;

  speedEl.textContent = Math.round(speed * 1.9);
  stars.forEach((s, i) => s.classList.toggle("on", i < level));
  starsEl.classList.toggle("blink", level >= 3);

  composer.render();
  requestAnimationFrame(tick);
}
tick();
