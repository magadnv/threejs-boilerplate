import * as THREE from "three";
// Weitere Module bei Bedarf importieren, z.B.:
// import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.querySelector("#scene");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161616);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 4);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 1.2, 1.2),
  new THREE.MeshStandardMaterial({ color: 0xc7ff55 })
);
scene.add(box);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const light = new THREE.DirectionalLight(0xffffff, 1.5);
light.position.set(3, 3, 3);
scene.add(light);

// const controls = new OrbitControls(camera, renderer.domElement);
// controls.enableDamping = true;

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  box.rotation.x += 0.006;
  box.rotation.y += 0.009;
  // controls.update();
  renderer.render(scene, camera);
}
animate();
