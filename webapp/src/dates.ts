// Даты и текст. Ключ дня — 'YYYY-MM-DD' в поясе спейса, приходит с сервера.

export const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
export const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
/** Сокращения для календарной плитки недели в архиве (в UI идут в uppercase). */
export const MONTHS_ABBR = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
]
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const WEEKDAYS_FULL = [
  'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье',
]

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

export const fmtDayMonth = (k: string): string => `${dayNum(k)} ${MONTHS_GEN[monthIdx(k)]}`
export const fmtRange = (a: string, b: string): string =>
  monthIdx(a) === monthIdx(b) && yearOf(a) === yearOf(b)
    ? `${dayNum(a)}–${dayNum(b)} ${MONTHS_GEN[monthIdx(b)]}`
    : `${fmtDayMonth(a)} – ${fmtDayMonth(b)}`
export const fmtWeekdayDate = (k: string): string => `${WEEKDAYS_FULL[weekdayIdx(k)]}, ${fmtDayMonth(k)}`
export const fmtShortDate = (k: string): string => `${WEEKDAYS_SHORT[weekdayIdx(k)]}, ${fmtDayMonth(k)}`

/** ISO-метка времени (например, правка заметки) → «21 июля». */
export const fmtIsoDay = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`
}

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100
  const d = abs % 10
  if (abs > 10 && abs < 20) return many
  if (d === 1) return one
  if (d >= 2 && d <= 4) return few
  return many
}

export const requestsWord = (n: number): string => `${n} ${plural(n, 'заявка', 'заявки', 'заявок')}`
export const peopleWord = (n: number): string => `${n} ${plural(n, 'человек', 'человека', 'человек')}`
export const visitsWord = (n: number): string => `${n} ${plural(n, 'визит', 'визита', 'визитов')}`
export const monthsWord = (n: number): string => `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`
export const periodsWord = (n: number): string => `${n} ${plural(n, 'период', 'периода', 'периодов')}`
export const duesWord = (n: number): string => `${n} ${plural(n, 'взнос', 'взноса', 'взносов')}`
