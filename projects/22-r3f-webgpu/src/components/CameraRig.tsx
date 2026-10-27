// ============================================================
// <CameraRig /> – Kamera folgt dem Pfad, gedämpft, mit leichter Parallaxe
// ============================================================

import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { easing } from 'maath'
import * as THREE from 'three/webgpu'
import { CAMERA_PATH, ORIGIN, SEAL_LOOK } from '../path'
import { reducedMotion } from '../three-setup'
import type { Story } from '../story'

const BASE_FOV = 40

export function CameraRig({ progress }: { progress: Story }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)

  // Hochkant (Handy, Story-Format): Sichtfeld weiter, damit das Siegel passt
  useEffect(() => {
    const aspect = size.width / size.height
    const halfV = THREE.MathUtils.degToRad(BASE_FOV / 2)
    const fov = aspect < 1 ? 2 * Math.atan(Math.tan(halfV) / aspect) : 2 * halfV
    camera.fov = Math.min(THREE.MathUtils.radToDeg(fov), 72)
    camera.updateProjectionMatrix()
  }, [camera, size])

  // Hilfsvektoren einmal anlegen – nie im Frame-Loop neue Objekte erzeugen
  const v = useMemo(
    () => ({ pos: new THREE.Vector3(), ahead: new THREE.Vector3(), look: new THREE.Vector3(), lookNow: new THREE.Vector3() }),
    [],
  )

  useFrame((state, delta) => {
    const { travel, look, settle } = progress
    CAMERA_PATH.getPointAt(travel, v.pos)
    CAMERA_PATH.getPointAt(Math.min(travel + 0.08, 1), v.ahead)

    // Blick: erst aufs Objekt, dann voraus auf den Pfad, am Ende aufs Siegel
    v.look.lerpVectors(ORIGIN, v.ahead, look).lerp(SEAL_LOOK, settle)

    // Maus-Parallaxe: kleiner Versatz, gibt Tiefe (aus bei reduced motion)
    if (!reducedMotion) {
      v.pos.x += state.pointer.x * 0.35
      v.pos.y += state.pointer.y * 0.2
    }

    // Damping: die Kamera „holt“ ihr Ziel ein – weich, framerate-unabhängig
    easing.damp3(camera.position, v.pos, 0.3, delta)
    easing.damp3(v.lookNow, v.look, 0.25, delta)
    camera.lookAt(v.lookNow)
  })

  return null
}
