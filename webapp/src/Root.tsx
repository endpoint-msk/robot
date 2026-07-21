// Загрузка: тема, инициализация Telegram-клиента, слушатели темы, bootstrap.
// Соответствует boot() из старого миниаппа.

import { useEffect, useState } from 'react'
import { api } from './api'
import { App } from './App'
import { bump, getState, pop, setData, setPerspective } from './store'
import { applyTheme } from './theme'
import { tg } from './telegram'
import type { Bootstrap } from './types'

const NoTg = () => (
  <div className="center-screen">
    <div style={{ fontSize: 40 }}>🚪</div>
    <div>Откройте миниапп из Telegram — через кнопку меню в чате с ботом.</div>
  </div>
)

const CenterSpinner = () => (
  <div className="center-screen">
    <div className="spinner" />
  </div>
)

const BootError = ({ message }: { message: string }) => (
  <div className="center-screen">
    <div style={{ fontSize: 40 }}>😿</div>
    <div>{'Не получилось загрузиться: ' + message}</div>
  </div>
)

type Phase = 'notg' | 'loading' | 'ready' | 'error'

export function Root() {
  const [phase, setPhase] = useState<Phase>(tg && tg.initData ? 'loading' : 'notg')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!tg || !tg.initData) return

    try {
      tg.ready()
    } catch {
      /* noop */
    }
    try {
      tg.expand()
    } catch {
      /* noop */
    }
    try {
      tg.disableVerticalSwipes?.()
    } catch {
      /* старый клиент */
    }
    try {
      tg.BackButton.onClick(pop)
    } catch {
      /* старый клиент */
    }

    // Тема клиента сменилась — при выборе «Системная» едем следом.
    const onSystemThemeChange = (): void => {
      if (getState().theme !== 'system') return
      applyTheme('system')
      bump()
    }
    try {
      tg.onEvent('themeChanged', onSystemThemeChange)
    } catch {
      /* старый клиент */
    }
    let mq: MediaQueryList | null = null
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', onSystemThemeChange)
    } catch {
      /* старый браузер */
    }

    let cancelled = false
    api<Bootstrap>('bootstrap')
      .then((data) => {
        if (cancelled) return
        setData(data)
        setPerspective(data.me.isResident ? 'resident' : 'guest')
        setPhase('ready')
      })
      .catch((e) => {
        if (!cancelled) {
          setErr((e as Error).message)
          setPhase('error')
        }
      })

    return () => {
      cancelled = true
      try {
        mq?.removeEventListener('change', onSystemThemeChange)
      } catch {
        /* noop */
      }
    }
  }, [])

  if (phase === 'notg') return <NoTg />
  if (phase === 'error') return <BootError message={err} />
  if (phase === 'loading') return <CenterSpinner />
  return <App />
}
