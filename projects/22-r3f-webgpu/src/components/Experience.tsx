// ============================================================
// <Experience /> – der Szenengraph als Komponentenbaum
// ============================================================

import { useMemo, type RefObject } from 'react'
import { ScrollControls } from '@react-three/drei'
import { BG, reducedMotion } from '../three-setup'
import { createStory } from '../story'
import { Director } from './Director'
import { CameraRig } from './CameraRig'
import { Lights } from './Lights'
import { GlowObject } from './GlowObject'
import { InstanceField } from './InstanceField'
import { StoryText } from './StoryText'
import { Effects } from './Effects'
import { PerfHud } from './PerfHud'
import { AutoScroll, KeepScrollConnected, Screenshot, type Format } from './Recorder'

type Props = { format: Format; perfTarget: RefObject<HTMLDivElement | null> }

export function Experience({ format, perfTarget }: Props) {
  // EIN veränderliches Objekt für den ganzen Fortschritt. Es wird als Prop
  // durchgereicht, aber nie ersetzt – die Kinder lesen pro Frame frische Werte,
  // ohne dass React je neu rendert.
  const story = useMemo(createStory, [])

  return (
    <>
      <color attach="background" args={[BG]} />
      {/* Exponentieller Nebel gibt der Reise Tiefe */}
      <fogExp2 attach="fog" args={[BG, 0.035]} />

      {/* pages=3 → drei Bildschirmhöhen Scroll; damping = Trägheit des Offsets */}
      <ScrollControls pages={3} damping={reducedMotion ? 0.1 : 0.3}>
        <Director progress={story} />
        <CameraRig progress={story} />
        <Lights progress={story} />
        <GlowObject progress={story} />
        <InstanceField progress={story} />
        <StoryText />
        <AutoScroll />
        <KeepScrollConnected />
      </ScrollControls>

      <Effects />
      <Screenshot format={format} />
      <PerfHud target={perfTarget} />
    </>
  )
}
