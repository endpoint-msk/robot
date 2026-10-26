// Место из кнопки бота. Web_app-кнопка лички несёт его в query `to`, ссылка t.me из группы
// в `startapp` (доходит как start_param). Адреса строит src/deeplink.ts.
//
// Адрес только выбирает экран, данные и права приходят с сервера, как всегда. Сообщение с
// кнопкой живёт вечно, поэтому протухший адрес (заявку отменили, день прошёл, ивент
// удалили) не ругается: миниапп остаётся на ближайшем живом месте, в дне или на главной.
// Сюда же попадает старое `startapp=hosting` со старых досок.

import type { NavParams, ScreenName } from './store'
import { tg } from './telegram'
import type { Bootstrap, Perspective, SpaceEvent } from './types'

export const launchTarget = (): string | null => {
  try {
    const to = new URLSearchParams(location.search).get('to')
    if (to) return to
  } catch {
    /* noop */
  }
  return tg?.initDataUnsafe?.start_param || null
}

export type TargetEntry = { name: ScreenName; params?: NavParams }

const findEvent = (data: Bootstrap, id: string): SpaceEvent | null =>
  data.days.flatMap((d) => d.events).find((e) => e.id === id) ?? data.laterEvents.find((e) => e.id === id) ?? null

/** Экраны над корнем стека для адреса. Пусто: остаёмся на главной. */
export function targetEntries(raw: string, data: Bootstrap, perspective: Perspective): TargetEntry[] {
  const m = /^([a-z]+)(?:-([A-Za-z0-9_-]+))?$/.exec(raw)
  if (!m) return []
  const kind = m[1]
  const arg = m[2] ?? ''
  const resident = perspective === 'resident'
  const hasDay = (key: string): boolean => data.days.some((d) => d.dateKey === key)

  switch (kind) {
    case 'day':
      if (!hasDay(arg)) return []
      return resident ? [{ name: 'day', params: { dateKey: arg } }] : [{ name: 'peek' }, { name: 'peekDay', params: { dateKey: arg } }]
    case 'new': {
      // Резиденту заявка не нужна: «Хочу прийти» для него это день, где «Я приду».
      if (resident) {
        const key = arg || data.todayKey
        return hasDay(key) ? [{ name: 'day', params: { dateKey: key } }] : []
      }
      // Правила до первой заявки форма поднимает над собой сама. Прошедший или закрытый
      // день она меняет на первый открытый.
      return [{ name: 'newRequest', params: arg ? { dateKey: arg } : {} }]
    }
    case 'req': {
      if (resident) {
        const day = data.days.find((d) => (d.requests ?? []).some((r) => r.id === arg))
        return day ? [{ name: 'day', params: { dateKey: day.dateKey, flash: arg } }] : []
      }
      const mine = data.myRequests.some((r) => r.id === arg) || data.myPast.some((r) => r.id === arg)
      return mine ? [{ name: 'visit', params: { id: arg } }] : []
    }
    case 'event': {
      const event = findEvent(data, arg)
      return event ? [{ name: 'event', params: { event } }] : []
    }
    case 'apps': {
      const event = findEvent(data, arg)
      if (!event) return []
      const view: TargetEntry = { name: 'event', params: { event } }
      return resident && event.canReview && event.form ? [view, { name: 'eventApps', params: { event, backLabel: 'Ивент' } }] : [view]
    }
    case 'dues':
      return resident && data.dues ? [{ name: 'dues' }] : []
  }
  return []
}
