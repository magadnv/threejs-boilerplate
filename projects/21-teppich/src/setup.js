// ============================================================
// SETUP – Renderer, Szene, Kamera, Licht, Boden, Bloom
// ============================================================

import * as THREE from "three/webgpu";
import { pass, uniform } from "three/tsl";
// bloom() liegt nicht direkt in three/tsl, sondern bei den Addons
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export async function createSetup(canvas) {
  // WebGPURenderer nimmt WebGPU, wenn der Browser es kann, sonst WebGL2.
  // init() wartet, bis das Grafik-Gerät bereit ist – erst danach rendern.
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07070a, 38, 95); // Rasterränder laufen weich aus

  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 300);
  camera.position.set(30, 24, 34);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47; // nicht unter den Boden
  controls.minDistance = 8;
  controls.maxDistance = 110;
  controls.autoRotateSpeed = 0.5;

  // --- Licht ---
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.4);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Schattenkamera muss das ganze Raster sehen (40 × 40 + Rand)
  const s = 26;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 90 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun);

  // --- Boden: fängt Schatten, verschwindet im Nebel ---
  const floorMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x0a0a0e, roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // --- Post-Processing ---
  // RenderPipeline (früher PostProcessing): pass() rendert die Szene in eine
  // Textur, bloom() legt einen Leuchtschleier über alles, was hell genug ist.
  const bloomStrength = uniform(0.8);
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  const bloomPass = bloom(sceneColor, bloomStrength, 0.4, 0.55);
  pipeline.outputNode = sceneColor.add(bloomPass);

  return { renderer, scene, camera, controls, hemi, sun, floor, pipeline, bloomStrength, bloomPass };
}
