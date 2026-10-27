import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { buildCollarGeometry, buildThreadGeometry } from "./collar.js";
import { createGiMaterial, giUniforms } from "./gi-material.js";
import { Dust } from "./dust.js";
import { DofPass } from "./dof.js";

const BG = new THREE.Color("#050505");

// Film Grain + Vignette, nach dem Tone Mapping im sRGB-Raum
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },
    uVignette: { value: 1.0 },
    uBg: { value: new THREE.Vector3(BG.r, BG.g, BG.b) },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAspect;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
      float vig = smoothstep(1.05, 0.25, length(v) * (0.9 + 0.25 * uVignette));
      c *= mix(1.0, vig, uVignette);
      // Korn, in den Mitteltönen am stärksten
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      float n = h(gl_FragCoord.xy + fract(uTime * 7.31) * 913.0) - 0.5;
      c += n * uGrain * (0.35 + lum * (1.0 - lum) * 2.6);
      c = max(c, vec3(0.0196) * vig);   // nie ganz schwarz: #050505
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function createScene(canvas, { low }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setClearColor(BG, 1);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const maxDpr = low ? 1 : 1.5;
  let dpr = Math.min(window.devicePixelRatio, maxDpr);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  scene.background = BG;

  // 100-mm-Makro: enger Bildwinkel, nah dran
  const camera = new THREE.PerspectiveCamera(19, 1, 5, 200);
  const camBase = new THREE.Vector3(0.6, -1.2, 30);
  const camTarget = new THREE.Vector3(0.4, -0.2, 0);

  // --- Licht ---------------------------------------------------------------
  // Hartes Rim-Light schräg von unten/hinten: streift über die Webstruktur
  const rim = new THREE.DirectionalLight(0xfff1e2, 0);
  scene.add(rim, rim.target);
  // Sehr schwaches, kühles Fill von vorne oben
  const fill = new THREE.DirectionalLight(0xf2efe8, 0);
  fill.position.set(-0.3, 0.7, 1);
  scene.add(fill);

  const light = {
    azimuth: 72,       // Grad, um die Blickachse: 0 = von rechts, 90 = von unten
    elevation: -18,    // Grad: <0 = Licht kommt von hinter dem Kragen
    rimIntensity: 8,
    fillIntensity: 0.14,
  };
  const rimDir = new THREE.Vector3();
  function applyLight(scale = 1) {
    const az = THREE.MathUtils.degToRad(light.azimuth);
    const el = THREE.MathUtils.degToRad(light.elevation);
    // Ebene senkrecht zur Blickachse: x rechts, y oben; z zur Kamera
    rimDir.set(Math.cos(az) * Math.cos(el), -Math.sin(az) * Math.cos(el), Math.sin(el)).normalize();
    rim.position.copy(rimDir).multiplyScalar(40);
    rim.intensity = light.rimIntensity * scale;
    fill.intensity = light.fillIntensity * scale;
  }
  applyLight(0);

  // --- Kragen ----------------------------------------------------------------
  const { geometry, frames } = buildCollarGeometry(
    low ? { segments: 520, profile: 44 } : { segments: 1100, profile: 84 }
  );
  const collar = new THREE.Mesh(geometry, createGiMaterial());
  collar.frustumCulled = false;
  scene.add(collar);

  const threads = new THREE.Mesh(
    buildThreadGeometry(frames, { count: low ? 70 : 150 }),
    createGiMaterial({ thread: true })
  );
  threads.frustumCulled = false;
  scene.add(threads);

  // Unsichtbarer, grober Stellvertreter fürs Raycasting
  const proxy = new THREE.Mesh(
    buildCollarGeometry({ segments: 260, profile: 20 }).geometry,
    new THREE.MeshBasicMaterial()
  );
  proxy.visible = false; // Raycaster prüft Sichtbarkeit nicht
  scene.add(proxy);

  const dust = new Dust(low ? 300 : 700);
  scene.add(dust.points);

  // --- Postprocessing -------------------------------------------------------
  // Kein MSAA: es würde jeden Post-Pass vervielfachen. Die Pixelratio glättet.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new DofPass(scene, camera, { focus: 30, aperture: 0.0024, maxblur: 0.014 });
  bokeh.hide.push(dust.points);
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.82);
  // Dezenter Bloom braucht keine volle Auflösung: halbe Größe spart ~¾ der Kosten
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSetSize(Math.ceil(w / 2), Math.ceil(h / 2));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  const dof = { aperture: 0.0024, maxblur: 0.014 };

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    // Hochformat: weiter zurück, damit der Kragen breit genug bleibt
    const minWidth = 11;
    const needed = minWidth / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    camBase.z = THREE.MathUtils.clamp(needed, 30, 60);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    finish.uniforms.uAspect.value = camera.aspect;
    dust.material.uniforms.uPixel.value = dpr * Math.min(1.4, h / 800);
  }

  function setDpr(v) {
    dpr = v;
    renderer.setPixelRatio(dpr);
    resize();
  }

  return {
    renderer, scene, camera, camBase, camTarget, composer, collar, threads, proxy, frames,
    dust, bokeh, bloom, finish, light, applyLight, rimDir, dof, resize, setDpr,
    get dpr() { return dpr; }, maxDpr, uniforms: giUniforms,
  };
}
