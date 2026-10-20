// Превью уведомлений: какие баннеры придут в личку при текущих настройках. Общее у
// шага «Что присылать» в знакомстве и у карточки уведомлений в настройках.

import { addDays, fmtShortDate, weekdayIdx } from './dates'
import type { Banner } from './components/OnboardingScenes'
import type { NotifyPrefs, Settings } from './types'

export type NotifyChoice = 'today' | 'all' | 'off'
export const choiceOf = (p: NotifyPrefs): NotifyChoice => (p.enabled ? p.mode : 'off')
export const CHOICE_LABEL: Record<NotifyChoice, string> = { today: 'Только сегодня', all: 'Любой день', off: 'Выкл' }

/** Тело запроса notify / notify.events для выбора в меню. Выключение сохраняет режим. */
export const prefsFor = (choice: NotifyChoice, cur: NotifyPrefs): NotifyPrefs =>
  choice === 'off' ? { enabled: false, mode: cur.mode } : { enabled: true, mode: choice }

/** Ближайшая суббота от сегодняшнего дня (сегодня, если суббота). */
export const nextSaturday = (today: string): string => addDays(today, (5 - weekdayIdx(today) + 7) % 7)

export const DEMO_EVENT = { title: 'Грокаем алгоритмы', desc: 'Собираемся дружной компанией и решаем задачи тысячелетия', time: '16:00' }

/** Баннеры о заявке и ивенте: текст как у настоящих сообщений бота, выключенный поток погашен. */
export const notifyBanners = (s: Pick<Settings, 'notify' | 'eventNotify'>, todayKey: string): Banner[] => [
  {
    key: 'req',
    time: 'сейчас',
    text:
      s.notify.mode === 'today'
        ? `🚪 Новая заявка на визит: ${fmtShortDate(todayKey)} к 18:30 (сегодня). Гость: Оля.`
        : `🚪 Новая заявка на визит: ${fmtShortDate(addDays(todayKey, 2))} к 14:00. Гость: Дима.`,
    off: !s.notify.enabled,
  },
  {
    key: 'ev',
    time: '1 ч назад',
    text:
      s.eventNotify.mode === 'today'
        ? '📅 Новый ивент: Кино в спейсе. Сегодня к 20:00.'
        : `📅 Новый ивент: ${DEMO_EVENT.title}. ${fmtShortDate(nextSaturday(todayKey))} к ${DEMO_EVENT.time}.`,
    off: !s.eventNotify.enabled,
  },
]
