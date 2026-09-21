// Загрузка: тема, инициализация Telegram-клиента, слушатели темы, bootstrap.
// Соответствует boot() из старого миниаппа.

import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { App } from './App'
import { Swap } from './components/Swap'
import { BootSkeleton } from './components/skeleton'
import { icons } from './icons'
import { closeTopOverlay } from './overlays'
import { bump, getState, pop, push, setData, setPerspective } from './store'
import { applyTheme } from './theme'
import { tg } from './telegram'
import { ApiError, type Bootstrap } from './types'

const NoTg = () => (
  <div className="center-screen">
    <div style={{ fontSize: 40 }}>🚪</div>
    <div>Откройте миниапп из Telegram — через кнопку меню в чате с ботом.</div>
  </div>
)

/**
 * Заголовок пишем по коду ответа, а техтекст оставляем второй строкой: «нет связи»
 * и «слишком часто» человек чинит по-разному, а без подробностей о причине нельзя
 * ни понять, ни переслать в поддержку.
 */
const errorTitle = (code?: string): string => {
  if (code === 'network') return 'Нет связи с сервером'
  if (code === 'rate_limited') return 'Слишком часто'
  return 'Не получилось загрузиться'
}

/**
 * Корневая ошибка — единственный экран, с которого нельзя уйти навигацией: стека
 * ещё нет, «назад» вести некуда. Поэтому кнопка обязательна, иначе повторить
 * попытку можно только закрыв и открыв миниапп. Автоповтора намеренно нет:
 * запрос дорогой (за bootstrap стоит обход всех allowlist-чатов), а отказ по
 * рейтлимиту он бы только продлевал.
 */
const BootError = ({ message, code, onRetry }: { message: string; code?: string; onRetry: () => void }) => (
  <div className="center-screen">
    <div className="boot-error">
      {icons.wifiOff()}
      <div className="be-title">{errorTitle(code)}</div>
      {/* У сетевого сбоя текст ответа начинается той же фразой, что и заголовок —
          второй строкой остаётся только то, что человек может сделать. */}
      <div className="be-text">{code === 'network' ? 'Проверьте интернет и попробуйте ещё раз.' : message}</div>
      <button type="button" className="retry-btn" onClick={onRetry}>
        Повторить
      </button>
    </div>
  </div>
)

type Phase = 'notg' | 'loading' | 'ready' | 'error'

/**
 * Бот открывает миниапп с `?draft=1`, когда резидент переслал пост из канала анонсов
 * и согласился сделать из него ивент. Читаем именно query, а не `start_param`: в личке
 * кнопка web_app ведёт прямо на URL, deep link с `startapp` там не нужен.
 */
const wantsEventDraft = (): boolean => {
  try {
    return new URLSearchParams(location.search).get('draft') === '1'
  } catch {
    return false
  }
}

export function Root() {
  const [phase, setPhase] = useState<Phase>(tg && tg.initData ? 'loading' : 'notg')
  const [err, setErr] = useState('')
  const [errCode, setErrCode] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setPhase('loading')
    setAttempt((n) => n + 1)
  }, [])

  // Клиент Telegram настраивается один раз за жизнь вебвью — повтор загрузки его не трогает.
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

    // Системная «Назад» сначала закрывает верхний оверлей (модалка, шторка пикера,
    // лайтбокс, открытая строка свайпа) и только на пустом реестре уводит с экрана.
    const goBack = (): void => {
      if (!closeTopOverlay()) pop()
    }
    try {
      tg.BackButton.onClick(goBack)
    } catch {
      /* старый клиент */
    }
    // На десктопе тот же смысл несёт Escape — своей кнопки «Назад» там нет.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (closeTopOverlay()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)

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

    return () => {
      window.removeEventListener('keydown', onKey)
      try {
        mq?.removeEventListener('change', onSystemThemeChange)
      } catch {
        /* noop */
      }
    }
  }, [])

  useEffect(() => {
    if (!tg || !tg.initData) return
    const wantsDraft = wantsEventDraft()
    let cancelled = false
    api<Bootstrap>('bootstrap')
      .then((data) => {
        if (cancelled) return
        setData(data)
        setPerspective(data.me.isResident ? 'resident' : 'guest')
        // Кнопка «Создать ивент» из лички ведёт сюда с ?draft=1 — открываем редактор
        // с уже вставленным текстом поста. Проверяем и саму заготовку: её могли
        // отработать с другого устройства, и тогда открывать нечего.
        if (wantsDraft && data.me.isResident && data.eventDraft) {
          push('event', { fromDraft: true, backLabel: 'Обзор' })
        }
        setPhase('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setErr((e as Error).message)
        setErrCode((e as ApiError).code)
        setPhase('error')
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  if (phase === 'notg') return <NoTg />
  if (phase === 'error') return <BootError message={err} code={errCode} onRetry={retry} />
  // Каркас, а не спиннер: у остальных экранов ожидание выглядит именно так, и
  // первый кадр не должен быть единственным исключением. Гаснет он не рывком —
  // Swap держит его поверх проявляющегося экрана.
  return (
    <Swap loading={phase === 'loading'} skeleton={<BootSkeleton />} fadeOnly>
      <App />
    </Swap>
  )
}
