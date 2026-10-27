// ============================================================
// <Director /> – liest den Scroll und schreibt das Drehbuch
// ============================================================
// Läuft mit Priorität -1, also VOR allen anderen useFrames. Wenn
// GlowObject, InstanceField & Co. lesen, ist story schon aktuell.

import { useFrame } from '@react-three/fiber'
import { useScroll } from '@react-three/drei'
import { updateStory, type Story } from '../story'

export function Director({ progress }: { progress: Story }) {
  // scroll.offset ist bereits gedämpft (ScrollControls damping)
  const scroll = useScroll()
  useFrame(() => updateStory(progress, scroll.offset), -1)
  return null
}
