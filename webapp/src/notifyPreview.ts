// Превью уведомлений: какие баннеры придут в личку при текущих настройках. Общее у
// шага «Что присылать» в знакомстве и у карточки уведомлений в настройках.

import { tr } from './i18n'
import { addDays, fmtShortDate, weekdayIdx } from './dates'
import type { Banner } from './components/OnboardingScenes'
import { nb } from './format'
import type { NotifyPrefs, Settings } from './types'

export type NotifyChoice = 'today' | 'all' | 'off'
export const choiceOf = (p: NotifyPrefs): NotifyChoice => (p.enabled ? p.mode : 'off')
export const CHOICE_LABEL: Record<NotifyChoice, string> = {
  get today() { return tr('Только сегодня', 'Today only') },
  get all() { return tr('Любой день', 'Any day') },
  get off() { return tr('Выкл', 'Off') },
}

/** Тело запроса notify / notify.events для выбора в меню. Выключение сохраняет режим. */
export const prefsFor = (choice: NotifyChoice, cur: NotifyPrefs): NotifyPrefs =>
  choice === 'off' ? { enabled: false, mode: cur.mode } : { enabled: true, mode: choice }

/** Ближайшая суббота от сегодняшнего дня (сегодня, если суббота). */
export const nextSaturday = (today: string): string => addDays(today, (5 - weekdayIdx(today) + 7) % 7)

export const DEMO_EVENT = {
  get title() { return tr('Грокаем алгоритмы', 'Grokking algorithms') },
  get desc() { return tr('Собираемся дружной компанией и решаем задачи тысячелетия', "Let's get together and solve the millennium problems") },
  time: '16:00',
}

/** Баннеры о заявке и ивенте: текст как у настоящих сообщений бота, выключенный поток погашен. */
export const notifyBanners = (s: Pick<Settings, 'notify' | 'eventNotify'>, todayKey: string): Banner[] => [
  {
    key: 'req',
    time: tr('сейчас', 'now'),
    text:
      s.notify.mode === 'today'
        ? tr(`🚪 Новая заявка на визит: ${fmtShortDate(todayKey)} к 18:30 (сегодня). Гость: Оля.`, `🚪 New visit request: ${fmtShortDate(todayKey)} at 18:30 (today). Guest: Olya.`)
        : tr(`🚪 Новая заявка на визит: ${fmtShortDate(addDays(todayKey, 2))} к 14:00. Гость: Дима.`, `🚪 New visit request: ${fmtShortDate(addDays(todayKey, 2))} at 14:00. Guest: Dima.`),
    off: !s.notify.enabled,
  },
  {
    key: 'ev',
    time: nb(tr('1 ч назад', '1 h ago')),
    text:
      s.eventNotify.mode === 'today'
        ? tr('📅 Новый ивент: Кино в спейсе. Сегодня к 20:00.', '📅 New event: Movie night at the space. Today at 20:00.')
        : tr(`📅 Новый ивент: ${DEMO_EVENT.title}. ${fmtShortDate(nextSaturday(todayKey))} к ${DEMO_EVENT.time}.`, `📅 New event: ${DEMO_EVENT.title}. ${fmtShortDate(nextSaturday(todayKey))} at ${DEMO_EVENT.time}.`),
    off: !s.eventNotify.enabled,
  },
]
