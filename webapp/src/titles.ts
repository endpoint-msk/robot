// Заголовок экрана по записи стека. Нужен ровно одному потребителю — кнопке
// «назад»: она подписана именем экрана, на который возвращает, и раньше это имя
// задавалось строкой на месте вызова. Строки разъезжались с заголовками —
// «Визит» вместо «Пятница», «День» вместо дня недели, голое «Назад» там, где
// экран отлично называется, — и подпись переставала быть навигацией.

import { tr } from './i18n'
import { fmtRange, fmtWeekdayDate, weekdaysFull, weekdayIdx } from './dates'
import { addDays } from './dates'
import type { NavEntry } from './store'
import type { Bootstrap } from './types'

const weekday = (dateKey: unknown): string | null =>
  typeof dateKey === 'string' && dateKey ? (weekdaysFull()[weekdayIdx(dateKey)] ?? null) : null

export function screenTitle(entry: NavEntry, data: Bootstrap | null): string {
  const p = entry.params
  switch (entry.name) {
    case 'overview':
      return tr('Ближайшие дни', "Upcoming days")
    case 'myVisits':
      return tr('Мои визиты', "My visits")
    case 'route':
      return tr('Как пройти', "Directions")
    case 'peek':
      return tr('Активность', "Activity")
    case 'settings':
      return tr('Настройки', "Settings")
    case 'archive':
      return tr('Архив', "Archive")
    case 'stats':
      return tr('Статистика', "Stats")
    case 'statsDays':
      return tr('История по дням', "Daily history")
    case 'dues':
      return tr('Взносы', "Dues")
    case 'duesHistory':
      return tr('История', "History")
    case 'duesSettings':
      return tr('Настройки взносов', "Dues settings")
    case 'invite':
      return tr('Позвать в спейс', "Invite to the space")
    case 'newRequest':
      return tr('Хочу прийти', "Request a visit")
    case 'walkIn':
      return tr('Без заявки', "Walk-ins")
    case 'eventApps':
      return tr('Заявки на ивент', "Event applications")
    case 'announce':
      return tr('Анонс', "Announcement")
    case 'onboarding':
      return tr('Знакомство', "Bot tour")
    case 'wrap':
      return tr('Итоги месяца', "Monthly recap")
    case 'dev':
      return 'Dev'
    case 'devEdit':
      return tr('Правка заявки', "Edit request")
    case 'residents':
      return tr('Резиденты', "Residents")
    case 'residentProfile':
      return p.name ?? tr('Резидент', "Resident")

    // Дальше — экраны, у которых заголовок собирается из данных. Промах любого
    // поиска даёт разумный запасной вариант: подпись «назад» не то место, ради
    // которого стоит падать.
    case 'day':
    case 'peekDay':
      return weekday(p.dateKey) ?? tr('День', "Day")
    // Сегодняшний (и вчерашний ночью) день открывают с экрана дня, и там «Пятница» уже
    // занята им самим.
    case 'visits':
      return p.dateKey === data?.todayKey || p.dateKey === data?.visitGraceDay ? tr('Кто пришёл', "Attendance") : (weekday(p.dateKey) ?? tr('День', "Day"))
    case 'statsDay':
      return typeof p.dateKey === 'string' ? fmtWeekdayDate(p.dateKey) : tr('День', "Day")
    case 'archiveWeek':
      return typeof p.weekStart === 'string' ? fmtRange(p.weekStart, addDays(p.weekStart, 6)) : tr('Неделя', "Week")
    case 'visit': {
      const r =
        data?.myRequests.find((x) => x.id === p.id) ?? (data?.myPast ?? []).find((x) => x.id === p.id)
      return weekday(r?.dateKey) ?? tr('Визит', "Visit")
    }
    case 'guestVisits':
      return p.user?.name ?? tr('Гость', "Guest")
    // Имя человека в параметрах есть не всегда, а «Человек» в подписи «назад»
    // читается хуже, чем название раздела, откуда карточку открыли.
    case 'duesPerson':
      return p.name ?? tr('Взносы', "Dues")
    case 'statsPerson':
      return p.name ?? tr('Статистика', "Stats")
    case 'event':
      return p.event?.title ?? tr('Ивент', "Event")
    case 'eventApply':
      return p.event?.title ?? tr('Ивент', "Event")
    default:
      return tr('Назад', "Back")
  }
}
