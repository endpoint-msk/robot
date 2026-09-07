// Заголовок экрана по записи стека. Нужен ровно одному потребителю — кнопке
// «назад»: она подписана именем экрана, на который возвращает, и раньше это имя
// задавалось строкой на месте вызова. Строки разъезжались с заголовками —
// «Визит» вместо «Пятница», «День» вместо дня недели, голое «Назад» там, где
// экран отлично называется, — и подпись переставала быть навигацией.

import { fmtRange, fmtWeekdayDate, WEEKDAYS_FULL, weekdayIdx } from './dates'
import { addDays } from './dates'
import type { NavEntry } from './store'
import type { Bootstrap } from './types'

const weekday = (dateKey: unknown): string | null =>
  typeof dateKey === 'string' && dateKey ? (WEEKDAYS_FULL[weekdayIdx(dateKey)] ?? null) : null

export function screenTitle(entry: NavEntry, data: Bootstrap | null): string {
  const p = entry.params
  switch (entry.name) {
    case 'overview':
      return 'Ближайшие дни'
    case 'myVisits':
      return 'Мои визиты'
    case 'rules':
      return 'Правила спейса'
    case 'route':
      return 'Как пройти'
    case 'peek':
      return 'Активность'
    case 'settings':
      return 'Настройки'
    case 'archive':
      return 'Архив'
    case 'stats':
      return 'Статистика'
    case 'statsDays':
      return 'История по дням'
    case 'dues':
      return 'Взносы'
    case 'duesHistory':
      return 'История'
    case 'duesSettings':
      return 'Настройки взносов'
    case 'invite':
      return 'Позвать в спейс'
    case 'newRequest':
      return 'Хочу прийти'
    case 'editRequest':
      return 'Изменить заявку'
    case 'guestNote':
      return 'Заметка'
    case 'eventApps':
      return 'Заявки на ивент'
    case 'announce':
      return 'Анонс'
    case 'dev':
      return 'Dev'
    case 'devEdit':
      return 'Правка заявки'

    // Дальше — экраны, у которых заголовок собирается из данных. Промах любого
    // поиска даёт разумный запасной вариант: подпись «назад» не то место, ради
    // которого стоит падать.
    case 'day':
    case 'peekDay':
      return weekday(p.dateKey) ?? 'День'
    case 'statsDay':
      return typeof p.dateKey === 'string' ? fmtWeekdayDate(p.dateKey) : 'День'
    case 'archiveWeek':
      return typeof p.weekStart === 'string' ? fmtRange(p.weekStart, addDays(p.weekStart, 6)) : 'Неделя'
    case 'visit': {
      const r =
        data?.myRequests.find((x) => x.id === p.id) ?? (data?.myPast ?? []).find((x) => x.id === p.id)
      return weekday(r?.dateKey) ?? 'Визит'
    }
    case 'guestVisits':
      return p.user?.name ?? 'Гость'
    // Имя человека в параметрах есть не всегда, а «Человек» в подписи «назад»
    // читается хуже, чем название раздела, откуда карточку открыли.
    case 'duesPerson':
      return p.name ?? 'Взносы'
    case 'statsPerson':
      return p.name ?? 'Статистика'
    case 'event':
      return p.event?.title ?? 'Ивент'
    case 'eventApply':
      return p.event?.title ?? 'Ивент'
    default:
      return 'Назад'
  }
}
