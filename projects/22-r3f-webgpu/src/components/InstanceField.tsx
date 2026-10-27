// ============================================================
// <InstanceField progress={story} /> – Kapitel 2 + 3: Tausende Splitter
// ============================================================
// Jeder Splitter kennt DREI Plätze, als Instanz-Attribute auf der GPU:
//   aSphere  – auf der Oberfläche des Glow-Objekts (Start)
//   aScatter – als Tunnel um den Kamerapfad      (Kapitel 2)
//   aSeal    – im madebymaga-Siegel              (Kapitel 3)
// Zwei uniforms (scatter, form) entscheiden, wo er gerade ist.
//
// Warum kein drei <Instances>? Dort ist jede Instanz ein eigenes
// Object3D, dessen Matrix die CPU jeden Frame neu schreibt – bei 4000+
// Splittern ist das der Flaschenhals. Hier rechnet der Vertex-Shader alles,
// die CPU setzt pro Frame nur zwei Zahlen.

import { useEffect, useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { useControls, folder } from 'leva'
import { easing } from 'maath'
import * as THREE from 'three/webgpu'
import {
  uniform,
  instancedBufferAttribute,
  positionLocal,
  mix,
  smoothstep,
  sin,
  cos,
  pow,
  float,
  vec3,
  time,
  rotate,
  distance,
  cameraPosition,
  PI,
  PI2,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import { CAMERA_PATH } from '../path'
import { sampleSeal } from '../seal'
import { isMobile, reducedMotion } from '../three-setup'
import type { Story } from '../story'

type Props = { progress: Story }

// Zeitversatz zwischen den Splittern (0 = alle gleichzeitig)
const SPREAD = 0.7

// Pro Instanz 16 Floats hintereinander: [sphere3 scatter3 seal3 rot3 rnd4]
// WebGPU erlaubt nur 8 Vertex-Buffer pro Draw → alles in EINEN Buffer
const STRIDE = 16

function buildBuffer(count: number, seal: Float32Array) {
  const packed = new Float32Array(count * STRIDE)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const v = new THREE.Vector3()
  const p = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const n1 = new THREE.Vector3()
  const n2 = new THREE.Vector3()

  for (let i = 0; i < count; i++) {
    const o = i * STRIDE

    // Kugel: Fibonacci-Verteilung → gleichmäßig dicht, keine Pole
    const y = 1 - (i / (count - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const a = golden * i
    v.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(1.32)
    v.toArray(packed, o)

    // Tunnel: 20 % bleiben als Halo am Start, der Rest umgibt den
    // Kamerapfad mit Abstand – damit die Kamera hindurchfliegen kann
    if (Math.random() < 0.2) {
      v.randomDirection().multiplyScalar(2 + Math.random() * 4)
    } else {
      const s = 0.12 + Math.random() * 0.88
      CAMERA_PATH.getPointAt(s, p)
      CAMERA_PATH.getTangentAt(s, tangent)
      n1.crossVectors(tangent, THREE.Object3D.DEFAULT_UP).normalize()
      n2.crossVectors(tangent, n1).normalize()
      const ang = Math.random() * Math.PI * 2
      const dist = 1.1 + Math.pow(Math.random(), 0.7) * 5.5
      v.copy(p)
        .addScaledVector(n1, Math.cos(ang) * dist)
        .addScaledVector(n2, Math.sin(ang) * dist)
        .addScaledVector(tangent, (Math.random() - 0.5) * 3)
    }
    v.toArray(packed, o + 3)

    packed[o + 6] = seal[i * 3]
    packed[o + 7] = seal[i * 3 + 1]
    packed[o + 8] = seal[i * 3 + 2]

    packed[o + 9] = Math.random() * 2 - 1 // Drehachse
    packed[o + 10] = Math.random() * 2 - 1
    packed[o + 11] = Math.random() * 2 - 1

    packed[o + 12] = Math.random() // Farbmischung A/B
    packed[o + 13] = Math.random() // Leuchtkraft (wenige funkeln stark)
    packed[o + 14] = Math.random() // Zeitversatz
    packed[o + 15] = Math.random() // Größe
  }
  return new THREE.InstancedInterleavedBuffer(packed, STRIDE)
}

export function InstanceField({ progress }: Props) {
  const { count, coolA, coolB, warmA, warmB, shardGlow } = useControls({
    Instanzen: folder({
      count: { value: isMobile ? 2000 : 4000, min: 500, max: 20000, step: 500 },
      shardGlow: { value: 0.8, min: 0, max: 4, step: 0.05, label: 'glow' },
    }),
    Farben: folder({
      coolA: { value: '#e4ecff', label: 'kühl A' },
      coolB: { value: '#5e7cff', label: 'kühl B' },
      warmA: { value: '#cf1830', label: 'warm A' },
      warmB: { value: '#f4ece6', label: 'warm B' },
    }),
  })

  // Siegel-Bild laden – useLoader hält die Komponente per Suspense an,
  // bis das Bild da ist, und cached es
  const img = useLoader(THREE.ImageLoader, `${import.meta.env.BASE_URL}siegel.svg`)

  // Uniforms: ein Objekt für die ganze Lebenszeit (siehe GlowObject)
  const u = useMemo(
    () => ({
      scatter: uniform(0),
      form: uniform(0),
      spin: uniform(0),
      glow: uniform(0.8),
      motion: uniform(reducedMotion ? 0 : 1),
      colorA: uniform(new THREE.Color('#e4ecff')),
      colorB: uniform(new THREE.Color('#5e7cff')),
    }),
    [],
  )
  useEffect(() => void (u.glow.value = shardGlow), [u, shardGlow])

  // Farben als THREE.Color vorhalten – maath.dampC blendet pro Frame dahin
  const palette = useMemo(
    () => ({
      coolA: new THREE.Color(coolA),
      coolB: new THREE.Color(coolB),
      warmA: new THREE.Color(warmA),
      warmB: new THREE.Color(warmB),
      a: new THREE.Color(),
      b: new THREE.Color(),
    }),
    [coolA, coolB, warmA, warmB],
  )

  // Geometrie + Material neu, sobald sich count ändert. Alles andere bleibt.
  const { geometry, material } = useMemo(() => {
    const buffer = buildBuffer(count, sampleSeal(img, count))
    // Jedes Attribut ist ein „Fenster“ in denselben Buffer: Typ + Offset
    // (Die three-Typen kennen hier den Rückgabetyp nicht genau → Cast)
    const vec3At = (offset: number) => instancedBufferAttribute(buffer, 'vec3', STRIDE, offset) as unknown as Node<'vec3'>
    const aSphere = vec3At(0)
    const aScatter = vec3At(3)
    const aSeal = vec3At(6)
    const aRot = vec3At(9)
    const aRnd = instancedBufferAttribute(buffer, 'vec4', STRIDE, 12) as unknown as Node<'vec4'>

    // Lokaler Fortschritt: startet je nach Zufallswert früher oder später
    const ease = (p: Node<'float'>, delay: Node<'float'>) =>
      smoothstep(0, 1, p.mul(1 + SPREAD).sub(delay.mul(SPREAD)))
    const e1 = ease(u.scatter, aRnd.z)
    const e2 = ease(u.form, aRnd.z.oneMinus())
    const free = e1.mul(e2.oneMinus())

    // In der Wolke treiben die Splitter langsam
    const t = time.mul(0.35)
    const drift = vec3(sin(t.add(aRnd.x.mul(40))), cos(t.mul(0.8).add(aRnd.y.mul(40))), sin(t.mul(0.7).add(aRnd.z.mul(40))))
      .mul(0.18)
      .mul(free)
      .mul(u.motion)

    // Seitlicher Schwung unterwegs, damit niemand auf der Geraden fliegt
    const arc = aRot.mul(1.4)
    const p1 = mix(aSphere, aScatter, e1).add(arc.mul(sin(e1.mul(PI))))
    const offset = mix(p1, aSeal, e2).add(arc.mul(sin(e2.mul(PI)).mul(0.6))).add(drift)

    // Im Siegel drehen sich alle auf dieselbe Ausrichtung → ruhige Fläche
    const rotation = aRot.mul(PI2).add(aRot.mul(u.spin)).mul(e2.oneMinus())
    // Unsichtbar auf der Kugel, wachsen beim Herausfliegen
    const appear = smoothstep(0, 0.12, e1)
    const scale = mix(aRnd.w.mul(0.7).add(0.65), float(0.8), e2).mul(appear)
    // Splitter direkt vor der Linse schrumpfen weg (sonst Riesen-Splitter im Bild)
    const nearFade = smoothstep(0.8, 3.2, distance(offset, cameraPosition))

    const m = new THREE.MeshStandardNodeMaterial({ metalness: 0.6, roughness: 0.26, flatShading: true })
    m.positionNode = rotate(positionLocal.mul(scale).mul(nearFade), rotation).add(offset)
    const base = mix(u.colorA, u.colorB, aRnd.x)
    m.colorNode = base
    m.emissiveNode = base.mul(u.glow).mul(pow(aRnd.y, 6).mul(3.2).add(0.06))

    const size = 0.075 * Math.sqrt(4000 / count)
    const g = new THREE.OctahedronGeometry(size, 0)
    g.scale(1, 1.6, 0.7) // länglich → Splitter statt Würfelchen
    g.deleteAttribute('uv') // spart einen Vertex-Buffer
    return { geometry: g, material: m }
  }, [count, img, u])

  // Aufräumen, wenn count wechselt oder die Komponente verschwindet
  useEffect(() => () => (geometry.dispose(), material.dispose()), [geometry, material])

  // ----------------------------------------------------------
  // Warum kein setState in useFrame?
  // useFrame läuft 60–120× pro Sekunde AUSSERHALB von React. Ein setState
  // dort würde jedes Mal einen React-Render samt Reconciliation auslösen –
  // teuer und unnötig. Stattdessen mutieren wir direkt: uniform.value,
  // mesh.position, color.lerp. Das ist der Kern von R3F-Performance.
  // ----------------------------------------------------------
  useFrame((_, delta) => {
    u.scatter.value = progress.scatter
    u.form.value = progress.form
    // Drehung: schneller in der Wolke, kommt im Siegel zur Ruhe
    u.spin.value += delta * 0.6 * progress.scatter * (1 - progress.form) * u.motion.value

    // Kühl → warm: Ziel mischen, dann gedämpft hinblenden
    palette.a.lerpColors(palette.coolA, palette.warmA, progress.warm)
    palette.b.lerpColors(palette.coolB, palette.warmB, progress.warm)
    easing.dampC(u.colorA.value, palette.a, 0.2, delta)
    easing.dampC(u.colorB.value, palette.b, 0.2, delta)
  })

  return (
    // Die Instanz-Matrizen bleiben Einheitsmatrizen – die echte Position kommt
    // aus dem Shader. Die Bounding-Sphere wüsste davon nichts → nicht cullen.
    <instancedMesh key={count} args={[geometry, material, count]} frustumCulled={false} />
  )
}
