// Загрузка: тема, инициализация Telegram-клиента, слушатели темы, bootstrap.
// Соответствует boot() из старого миниаппа.

import { useCallback, useEffect, useState } from 'react'
import { api, bootstrapOnStart, loadOnboardingPeople } from './api'
import { App } from './App'
import { Swap } from './components/Swap'
import { BootSkeleton } from './components/skeleton'
import { launchTarget, targetEntries } from './deeplink'
import { icons } from './icons'
import { closeTopOverlay, hasOverlay } from './overlays'
import { bump, getState, openAt, openOnboardingRoot, pop, push, setData, setPerspective } from './store'
import { applyTheme, refreshAccent } from './theme'
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

/** Кнопка «Открыть знакомство» из лички ведёт сюда с ?onboarding=1 (см. src/onboarding.ts). */
const wantsOnboarding = (): boolean => {
  try {
    return new URLSearchParams(location.search).get('onboarding') === '1'
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
    // Пункт «Настройки» в меню «⋯» Telegram открывает наши настройки с любого экрана, без
    // возврата на главную. Открытые поверх листы и шторки сначала закрываются.
    const openSettings = (): void => {
      while (hasOverlay()) closeTopOverlay()
      const { stack } = getState()
      if (stack[stack.length - 1]?.name !== 'settings') push('settings')
    }
    try {
      if (tg.isVersionAtLeast?.('7.0') && tg.SettingsButton) {
        tg.SettingsButton.onClick(openSettings)
        tg.SettingsButton.show()
      }
    } catch {
      /* старый клиент */
    }
    // На десктопе тот же смысл несёт Escape, как в Telegram Desktop: до системной «Назад»
    // тянуться мышью. Из поля ввода первый Escape только выходит: черновик есть не у каждой
    // формы, и случайное нажатие посреди текста не должно уводить с экрана.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.repeat) return
      if (closeTopOverlay()) {
        e.preventDefault()
        return
      }
      const field = document.activeElement
      if (field instanceof HTMLElement && field.matches('input, textarea, select, [contenteditable]')) {
        field.blur()
        e.preventDefault()
        return
      }
      if (getState().stack.length > 1) {
        e.preventDefault()
        pop()
      }
    }
    window.addEventListener('keydown', onKey)

    // Тема клиента сменилась: при выборе «Системная» едем следом, а при своей теме
    // миниаппа перечитываем только акцент, он из темы Telegram всегда.
    const onSystemThemeChange = (): void => {
      if (getState().theme !== 'system') {
        refreshAccent()
        bump()
        return
      }
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
    const wantsIntro = wantsOnboarding()
    const target = launchTarget()
    let cancelled = false
    void (async () => {
      let data: Bootstrap
      try {
        data = attempt === 0 ? await bootstrapOnStart() : await api<Bootstrap>('bootstrap')
      } catch (e) {
        if (cancelled) return
        setErr((e as Error).message)
        setErrCode((e as ApiError).code)
        setPhase('error')
        return
      }
      if (cancelled) return
      setData(data)
      setPerspective(data.me.isResident ? 'resident' : 'guest')
      const place = target && !wantsIntro ? targetEntries(target, data, getState().perspective) : []
      // Кнопка «Создать ивент» из лички ведёт сюда с ?draft=1 — открываем редактор
      // с уже вставленным текстом поста. Проверяем и саму заготовку: её могли
      // отработать с другого устройства, и тогда открывать нечего.
      if (wantsDraft && data.me.isResident && data.eventDraft) {
        push('event', { fromDraft: true, backLabel: 'Обзор' })
      } else if (place.length > 0) {
        // Остальные кнопки бота ведут на своё место. Это ответ на тап, поэтому знакомство,
        // которое открылось бы само, ждёт следующего входа.
        openAt(place)
      } else if (data.me.isResident && (wantsIntro || data.onboarding?.show)) {
        // Знакомство открывается само один раз, пока его не прошли, и по кнопке из
        // лички. Люди для сот грузятся до показа: обложка без них пустая.
        const people = await loadOnboardingPeople()
        if (cancelled) return
        openOnboardingRoot(people)
      }
      setPhase('ready')
    })()

    return () => {
      cancelled = true
    }
  }, [attempt])

  // Экран ошибки на старте повторяет загрузку сам, как только вернулась сеть.
  useEffect(() => {
    if (phase !== 'error' || errCode !== 'network') return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [phase, errCode, retry])

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
