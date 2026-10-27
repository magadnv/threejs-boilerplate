// ============================================================
// <GlowObject /> – Kapitel 1: ein atmender, leuchtender Kern
// ============================================================
// TSL-Material als JSX: <meshStandardNodeMaterial positionNode={…} />
// Die Nodes (der Shader-Graph) werden EINMAL in useMemo gebaut.
// Pro Frame ändern sich nur die Zahlen in den uniforms.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls, folder } from 'leva'
import * as THREE from 'three/webgpu'
import {
  uniform,
  time,
  sin,
  vec3,
  float,
  dot,
  mix,
  normalLocal,
  normalView,
  positionLocal,
  positionViewDirection,
  mx_noise_float,
} from 'three/tsl'
import { reducedMotion } from '../three-setup'
import type { Story } from '../story'

export function GlowObject({ progress }: { progress: Story }) {
  const mesh = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)

  const { core, rim, glow, fresnel, displacement } = useControls({
    Glow: folder({
      core: '#3d5bff',
      rim: '#dce6ff',
      glow: { value: 1.4, min: 0, max: 6, step: 0.05 },
      fresnel: { value: 3.2, min: 0.5, max: 8, step: 0.1 },
      displacement: { value: 0.16, min: 0, max: 0.6, step: 0.01 },
    }),
  })

  // ----------------------------------------------------------
  // Wie lebt ein TSL-uniform in React?
  // uniform() erzeugt ein Objekt, dessen .value direkt in den GPU-Speicher
  // wandert. Es muss über alle Renders hinweg DASSELBE Objekt bleiben –
  // sonst müsste das Material neu kompiliert werden. Darum useMemo mit [].
  // Danach: .value in useFrame (pro Frame) oder in useEffect (bei Leva-
  // Änderungen) setzen. React rendert dafür nie neu.
  // ----------------------------------------------------------
  const u = useMemo(
    () => ({
      glow: uniform(1.4),
      fresnel: uniform(3.2),
      displacement: uniform(0.16),
      dissolve: uniform(0),
      motion: uniform(reducedMotion ? 0 : 1),
      core: uniform(new THREE.Color('#3d5bff')),
      rim: uniform(new THREE.Color('#dce6ff')),
    }),
    [],
  )

  // Leva → uniforms (nur wenn sich ein Regler bewegt, nicht pro Frame)
  useEffect(() => {
    u.glow.value = glow
    u.fresnel.value = fresnel
    u.displacement.value = displacement
    u.core.value.set(core)
    u.rim.value.set(rim)
  }, [u, glow, fresnel, displacement, core, rim])

  // Der Shader-Graph – reine Beschreibung, läuft komplett auf der GPU
  const nodes = useMemo(() => {
    const t = time.mul(u.motion)
    // Atmen: langsamer Sinus zwischen 0 und 1
    const breath = sin(t.mul(1.3)).mul(0.5).add(0.5)
    // Weiches 3D-Rauschen auf der Oberfläche, wandert langsam nach oben
    const n = mx_noise_float(normalLocal.mul(1.6).add(vec3(0, t.mul(0.3), 0)))
    // Beim Zerfall: feines, hartes Rauschen zieht Spitzen heraus
    const spikes = mx_noise_float(normalLocal.mul(7)).abs().mul(u.dissolve.mul(1.6))
    const disp = n.mul(u.displacement).mul(breath.mul(0.6).add(0.4)).add(spikes)

    // Fresnel: 0 in der Mitte, 1 am Rand → leuchtende Kante
    const facing = dot(normalView, positionViewDirection).abs()
    const fres = float(1).sub(facing).pow(u.fresnel)

    const emissive = mix(u.core.mul(0.04), u.rim, fres)
      .add(u.core.mul(n.max(0).pow(2).mul(0.9))) // feine helle „Adern“ aus dem Rauschen
      .mul(u.glow)
      .mul(breath.mul(0.3).add(0.85))
      .add(u.rim.mul(u.dissolve.mul(2))) // kurz vor dem Zerfall: aufglühen

    return {
      position: positionLocal.add(normalLocal.mul(disp)),
      color: vec3(0.02, 0.025, 0.04),
      emissive,
    }
  }, [u])

  useFrame((_, delta) => {
    const d = progress.dissolve
    u.dissolve.value = d
    if (!mesh.current || !light.current) return
    // Schrumpft weg, während die Splitter herausfliegen
    const s = Math.max(1 - d * d * 1.1, 0.0001)
    mesh.current.scale.setScalar(s)
    mesh.current.visible = s > 0.001
    mesh.current.rotation.y += delta * 0.12 * u.motion.value
    // Das Licht im Kern beleuchtet die Splitter, solange er da ist
    light.current.intensity = 7 * (1 - d)
  })

  return (
    <group>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[1.3, 40]} />
        <meshStandardNodeMaterial
          roughness={0.35}
          metalness={0.1}
          positionNode={nodes.position}
          colorNode={nodes.color}
          emissiveNode={nodes.emissive}
        />
      </mesh>
      <pointLight ref={light} color={rim} intensity={7} distance={0} decay={2} />
    </group>
  )
}
