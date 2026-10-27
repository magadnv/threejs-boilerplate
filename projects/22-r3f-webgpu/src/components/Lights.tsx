// ============================================================
// <Lights /> – kühles Führungslicht, das im Outro warm wird
// ============================================================

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { easing } from 'maath'
import * as THREE from 'three/webgpu'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Story } from '../story'

const COOL = { key: new THREE.Color('#9cc0ff'), hemi: new THREE.Color('#8fa3d6') }
const WARM = { key: new THREE.Color('#ffb27a'), hemi: new THREE.Color('#ffd6bd') }

export function Lights({ progress }: { progress: Story }) {
  const key = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const target = useMemo(() => new THREE.Color(), [])
  const gl = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer
  const scene = useThree((s) => s.scene)

  // Weiche Umgebungsreflexion, damit die metallischen Splitter funkeln.
  // Imperativer three.js-Code ist in R3F völlig okay – in einem useEffect
  // mit Aufräumen, damit Hot Reload keine Texturen liegen lässt.
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.35
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  useFrame((_, delta) => {
    if (!key.current || !hemi.current) return
    const w = progress.warm
    easing.dampC(key.current.color, target.lerpColors(COOL.key, WARM.key, w), 0.25, delta)
    easing.dampC(hemi.current.color, target.lerpColors(COOL.hemi, WARM.hemi, w), 0.25, delta)
    key.current.intensity = 2.2 + w * 0.8
  })

  return (
    <>
      <hemisphereLight ref={hemi} args={['#8fa3d6', '#050508', 0.4]} />
      <directionalLight ref={key} position={[4, 6, 8]} intensity={2.2} />
      {/* Rotes Gegenlicht von hinten – die Marke ist von Anfang an da */}
      <directionalLight position={[-5, -2, -10]} color="#ff3355" intensity={0.9} />
    </>
  )
}
