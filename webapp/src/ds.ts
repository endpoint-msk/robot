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

export { ModalHost, showAlert, showImage, confirmDialog, timePrompt, reschedulePrompt, numberPrompt } from './modals'

// RequestRow, DayRow и DevChips читают снимок бэкенда из стора, а не из пропсов:
// без посева они падают. Навигация и загрузка данных наружу не отдаются.
export { setData, useStore, getState } from './store'

export { icons } from './icons'
export { THEMES, applyTheme, resolveTheme, resolvedTheme, systemTheme, sec } from './theme'
export { linkedText } from './linkify'
export * from './dates'

export type * from './types'
