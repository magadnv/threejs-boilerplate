// ============================================================
// PATH – Kamerapfad und Siegel-Position (geteilt von Kamera + Splittern)
// ============================================================

import * as THREE from 'three/webgpu'

// Die Kamera startet vor dem Objekt, fliegt seitlich schwingend hindurch
// und kommt vor dem Siegel zur Ruhe
export const CAMERA_PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 0, 6.5),
    new THREE.Vector3(0.6, 0.25, 3.4),
    new THREE.Vector3(-0.9, 0.5, -2.5),
    new THREE.Vector3(1.1, -0.35, -9),
    new THREE.Vector3(0, 0.15, -17.5),
  ],
  false,
  'centripetal',
)

export const ORIGIN = new THREE.Vector3(0, 0, 0)
export const SEAL_CENTER = new THREE.Vector3(0, 0, -27)
export const SEAL_SIZE = 4.4
// Blickziel leicht unter dem Siegel → es sitzt im Bild höher, Platz für den CTA
export const SEAL_LOOK = SEAL_CENTER.clone().add(new THREE.Vector3(0, -1.5, 0))
