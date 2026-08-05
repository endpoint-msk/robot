// Библиотечный вход дизайн-системы миниаппа: из этих кусков собраны все экраны
// (src/screens/*). Приложение его не импортирует — он нужен внешним потребителям:
// сборке для claude.ai/design (см. .design-sync/) и любому, кто хочет собирать
// экраны миниаппа из тех же деталей, что и сам миниапп.
//
// Что сюда НЕ входит: экраны (они завязаны на стек навигации и API), сам стор,
// api.ts. Дизайн-система — это то, из чего экран складывается, а не сам экран.

export {
  Sep,
  SectionTitle,
  Header,
  BackRow,
  EmptyState,
  SpinnerCenter,
  Footnote,
  ReadonlyBadge,
  Switch,
  BottomBar,
  DevChips,
} from './components/common'

export { DayChips, PurposeInput, AnonRow, useDayTime, defaultTimeFor, isPastForToday } from './components/forms'
export { Avatar, AvatarStack, Profile, userLabel } from './components/people'
export { Screen, AnimContext } from './components/Screen'
export { SwipeRow } from './components/SwipeRow'
export type { SwipeAction } from './components/SwipeRow'
export { DayRow } from './components/DayRow'
export { RequestRow, RequestsCard } from './components/RequestRow'
export { AttendeeRow, AttendeesCard } from './components/attendees'
export { EventCard, EventPoster } from './screens/Event'

// Модалки — императивный API (Promise) + хост очереди в портал.
export { ModalHost, showAlert, showImage, confirmDialog, timePrompt, reschedulePrompt, numberPrompt } from './modals'

// Часть компонентов (RequestRow, DayRow, DevChips) читает снимок бэкенда прямо из
// стора, а не из пропсов — без него они падают. Наружу отдаём только запись снимка
// и чтение: навигация и загрузка данных остаются делом приложения.
export { setData, useStore, getState } from './store'

// Иконки, тема и текстовые хелперы: без них компоненты не собрать 1:1 с миниаппом.
export { icons } from './icons'
export { THEMES, applyTheme, resolveTheme, resolvedTheme, systemTheme, sec } from './theme'
export { linkedText } from './linkify'
export * from './dates'

export type * from './types'
