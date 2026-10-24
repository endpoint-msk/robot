// Холст сцены знакомства для превью. Без движка сцена стоит в начальном кадре
// анимации, поэтому конечный кадр рисует тот же SCENES[name].render, что и экран
// знакомства. Подложка повторяет stageColor из screens/Onboarding.tsx: 12% тона
// шага поверх --bg, у «Бота» и «Готово» свои цвета (обои чата и карта).

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { SCENES, createHive, type SceneName } from 'endpoint-robot-webapp'
import type { HivePerson } from '../webapp/src/onboarding'

const TONE: Record<SceneName, string> = {
  cover: 'color-mix(in srgb, var(--bg) 88%, var(--blue))',
  presence: 'color-mix(in srgb, var(--bg) 88%, var(--green))',
  mac: 'color-mix(in srgb, var(--bg) 88%, var(--blue))',
  notify: 'color-mix(in srgb, var(--bg) 88%, #5856d6)',
  guests: 'color-mix(in srgb, var(--bg) 88%, var(--orange))',
  events: 'color-mix(in srgb, var(--bg) 88%, var(--purple))',
  dues: 'color-mix(in srgb, var(--bg) 88%, var(--green))',
  bot: '#a9cc9c',
  done: '#e9ecf8',
}

export function SceneStage({
  scene,
  people = [],
  height = 320,
  children,
}: {
  scene: SceneName
  people?: HivePerson[]
  height?: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current) SCENES[scene].render(ref.current, Infinity, createHive(people))
  })
  return (
    <div
      ref={ref}
      className={'ob-stage' + (scene === 'cover' ? ' cover' : '')}
      style={{ height, minHeight: height, background: TONE[scene], borderRadius: 22 }}
    >
      {children}
    </div>
  )
}
