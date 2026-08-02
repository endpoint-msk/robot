// Навигационная оболочка: рендерит верхний экран стека с анимацией входа, держит
// портал-цель для нижней панели, busy-оверлей и хост модалок.

import { useEffect, useLayoutEffect, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { BarContext } from './barContext'
import { ModalHost } from './modals'
import { useStore, type ScreenName } from './store'
import { tg } from './telegram'
import { AnimContext } from './components/Screen'
import { Overview } from './screens/Overview'
import { Day } from './screens/Day'
import { Invite } from './screens/Invite'
import { Archive } from './screens/Archive'
import { ArchiveWeek } from './screens/ArchiveWeek'
import { GuestVisits } from './screens/GuestVisits'
import { Settings } from './screens/Settings'
import { DuesScreen } from './screens/Dues'
import { DuesPerson } from './screens/DuesPerson'
import { DuesHistory } from './screens/DuesHistory'
import { DuesSettings } from './screens/DuesSettings'
import { MyVisits } from './screens/MyVisits'
import { Peek } from './screens/Peek'
import { PeekDay } from './screens/PeekDay'
import { Visit } from './screens/Visit'
import { GuestNote } from './screens/GuestNote'
import { NewRequest } from './screens/NewRequest'
import { Rules } from './screens/Rules'
import { EditRequest } from './screens/EditRequest'
import { Event } from './screens/Event'
import { Route } from './screens/Route'
import { Dev } from './screens/Dev'
import { DevEdit } from './screens/DevEdit'
import { Announce } from './screens/Announce'

const SCREENS: Record<ScreenName, ComponentType> = {
  overview: Overview,
  day: Day,
  invite: Invite,
  archive: Archive,
  archiveWeek: ArchiveWeek,
  guestVisits: GuestVisits,
  settings: Settings,
  dues: DuesScreen,
  duesPerson: DuesPerson,
  duesHistory: DuesHistory,
  duesSettings: DuesSettings,
  myVisits: MyVisits,
  peek: Peek,
  peekDay: PeekDay,
  visit: Visit,
  guestNote: GuestNote,
  rules: Rules,
  newRequest: NewRequest,
  editRequest: EditRequest,
  event: Event,
  route: Route,
  dev: Dev,
  devEdit: DevEdit,
  announce: Announce,
}

function BusyOverlay() {
  return createPortal(
    <div id="busy-overlay">
      <div className="spinner" />
    </div>,
    document.body,
  )
}

export function App() {
  const { stack, navId, anim } = useStore()
  const [barNode, setBarNode] = useState<HTMLDivElement | null>(null)

  // Скролл в начало — только на навигации (смена navId), не при обновлении данных.
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [navId])

  // Системная кнопка «назад» видна, когда есть куда возвращаться.
  useEffect(() => {
    if (!tg) return
    try {
      if (stack.length > 1) tg.BackButton.show()
      else tg.BackButton.hide()
    } catch {
      /* старый клиент без BackButton */
    }
  }, [stack.length])

  const top = stack[stack.length - 1]!
  const ScreenComp = SCREENS[top.name]

  return (
    <BarContext.Provider value={barNode}>
      <AnimContext.Provider value={anim}>
        <ScreenComp key={navId} />
      </AnimContext.Provider>
      <div className="bar-portal" ref={setBarNode} />
      <BusyOverlay />
      <ModalHost />
    </BarContext.Provider>
  )
}
