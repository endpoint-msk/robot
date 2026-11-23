// Даты и текст. Ключ дня — 'YYYY-MM-DD' в поясе спейса, приходит с сервера.

import { locale, plural as localizedPlural, tr } from './i18n'

const RU_MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
const RU_MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
/** Сокращения для календарной плитки недели в архиве (в UI идут в uppercase). */
const RU_MONTHS_ABBR = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
]
const RU_WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const RU_WEEKDAYS_FULL = [
  'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье',
]

const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const EN_MONTHS_ABBR = EN_MONTHS.map((month) => month.slice(0, 3))
const EN_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const EN_WEEKDAYS_SHORT = EN_WEEKDAYS.map((day) => day.slice(0, 3))

export const monthsGen = (): readonly string[] => locale() === 'ru' ? RU_MONTHS_GEN : EN_MONTHS
export const monthsNom = (): readonly string[] => locale() === 'ru' ? RU_MONTHS_NOM : EN_MONTHS
export const monthsAbbr = (): readonly string[] => locale() === 'ru' ? RU_MONTHS_ABBR : EN_MONTHS_ABBR
export const weekdaysShort = (): readonly string[] => locale() === 'ru' ? RU_WEEKDAYS_SHORT : EN_WEEKDAYS_SHORT
export const weekdaysFull = (): readonly string[] => locale() === 'ru' ? RU_WEEKDAYS_FULL : EN_WEEKDAYS

export const keyToDate = (k: string): Date => new Date(k + 'T12:00:00Z')
export const weekdayIdx = (k: string): number => (keyToDate(k).getUTCDay() + 6) % 7
export const dayNum = (k: string): number => keyToDate(k).getUTCDate()
export const monthIdx = (k: string): number => keyToDate(k).getUTCMonth()
export const yearOf = (k: string): number => keyToDate(k).getUTCFullYear()

export const addDays = (k: string, n: number): string => {
  const d = keyToDate(k)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Между числом и его словом пробел неразрывный (\u00a0), и тире держится за первую
// дату: иначе заголовок недели в архиве переносил «октября» на новую строку без своей
// «4». Строки только для показа, на сервер уходят ключи дней.
export const fmtDayMonth = (k: string): string => `${dayNum(k)}\u00a0${monthsGen()[monthIdx(k)]}`
export const fmtRange = (a: string, b: string): string =>
  monthIdx(a) === monthIdx(b) && yearOf(a) === yearOf(b)
    ? `${dayNum(a)}–${dayNum(b)}\u00a0${monthsGen()[monthIdx(b)]}`
    : `${fmtDayMonth(a)}\u00a0– ${fmtDayMonth(b)}`
export const fmtWeekdayDate = (k: string): string => `${weekdaysFull()[weekdayIdx(k)]}, ${fmtDayMonth(k)}`
export const fmtShortDate = (k: string): string => `${weekdaysShort()[weekdayIdx(k)]},\u00a0${fmtDayMonth(k)}`
/** \u0414\u0435\u043d\u044c \u0441\u0432\u043e\u0435\u0433\u043e \u0432\u0438\u0437\u0438\u0442\u0430 \u0443 \u0433\u043e\u0441\u0442\u044f: \u00ab\u0421\u0435\u0433\u043e\u0434\u043d\u044f\u00bb \u0438 \u00ab\u0417\u0430\u0432\u0442\u0440\u0430\u00bb, \u043a\u0430\u043a \u0432 \u0448\u0430\u043f\u043a\u0435 \u0434\u043d\u044f, \u0434\u0430\u043b\u044c\u0448\u0435 \u0434\u0435\u043d\u044c \u043d\u0435\u0434\u0435\u043b\u0438. */
export const visitDayWord = (k: string, today: string): string =>
  k === today ? tr('Сегодня', 'Today') : k === addDays(today, 1) ? tr('Завтра', 'Tomorrow') : weekdaysFull()[weekdayIdx(k)]!

/** ISO-метка времени (например, правка заметки) → «21 июля». */
export const fmtIsoDay = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()}\u00a0${monthsGen()[d.getMonth()]}`
}

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100
  const d = abs % 10
  if (abs > 10 && abs < 20) return many
  if (d === 1) return one
  if (d >= 2 && d <= 4) return few
  return many
}

export const requestsWord = (n: number): string => `${n}\u00a0${localizedPlural(n, ['заявка', 'заявки', 'заявок'], ['request', 'requests'])}`
export const peopleWord = (n: number): string => `${n}\u00a0${localizedPlural(n, ['человек', 'человека', 'человек'], ['person', 'people'])}`
export const visitsWord = (n: number): string => `${n}\u00a0${localizedPlural(n, ['визит', 'визита', 'визитов'], ['visit', 'visits'])}`
export const monthsWord = (n: number): string => `${n}\u00a0${localizedPlural(n, ['месяц', 'месяца', 'месяцев'], ['month', 'months'])}`
export const periodsWord = (n: number): string => `${n}\u00a0${localizedPlural(n, ['период', 'периода', 'периодов'], ['period', 'periods'])}`
export const duesWord = (n: number): string => `${n}\u00a0${localizedPlural(n, ['взнос', 'взноса', 'взносов'], ['payment', 'payments'])}`
