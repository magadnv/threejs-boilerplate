import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.querySelector("#scene");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161616);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(2.4, 1.6, 4);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.3, 1.3, 1.3),
  new THREE.MeshStandardMaterial({ color: 0xc7ff55, roughness: .4 })
);
box.position.x = -1.2;
scene.add(box);

const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(0.6, 0.2, 128, 32),
  new THREE.MeshStandardMaterial({ color: 0xaa8cff, roughness: .3 })
);
knot.position.x = 1.2;
scene.add(knot);

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(3, 4, 3);
scene.add(key);
const rim = new THREE.PointLight(0xff825c, 8, 15);
rim.position.set(-3, -1, -2);
scene.add(rim);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  box.rotation.x += 0.006;
  box.rotation.y += 0.009;
  knot.rotation.y -= 0.005;
  controls.update();
  renderer.render(scene, camera);
}
animate();
