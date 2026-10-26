// Навигационная оболочка: рендерит верхний экран стека с анимацией входа, держит
// портал-цель для нижней панели, busy-оверлей и хост модалок.

import { useEffect, useLayoutEffect, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { BarContext } from './barContext'
import { ModalHost } from './modals'
import { EntryContext, UnderContext } from './screenContext'
import { useStore, useUnder, type NavEntry, type ScreenName, type UnderMode } from './store'
import { tg } from './telegram'
import { AnimContext } from './components/Screen'
import { UndoToast } from './components/UndoToast'
import { Overview } from './screens/Overview'
import { Day } from './screens/Day'
import { Invite } from './screens/Invite'
import { Archive } from './screens/Archive'
import { ArchiveWeek } from './screens/ArchiveWeek'
import { GuestVisits } from './screens/GuestVisits'
import { Visits } from './screens/Visits'
import { WalkIn } from './screens/WalkIn'
import { Settings } from './screens/Settings'
import { DuesScreen } from './screens/Dues'
import { DuesPerson } from './screens/DuesPerson'
import { DuesHistory } from './screens/DuesHistory'
import { DuesSettings } from './screens/DuesSettings'
import { Stats } from './screens/Stats'
import { StatsDay } from './screens/StatsDay'
import { StatsDays } from './screens/StatsDays'
import { StatsPerson } from './screens/StatsPerson'
import { MyVisits } from './screens/MyVisits'
import { Peek } from './screens/Peek'
import { PeekDay } from './screens/PeekDay'
import { Visit } from './screens/Visit'
import { GuestNote } from './screens/GuestNote'
import { NewRequest } from './screens/NewRequest'
import { EditRequest } from './screens/EditRequest'
import { Event } from './screens/Event'
import { EventApply } from './screens/EventApply'
import { EventApps } from './screens/EventApps'
import { Route } from './screens/Route'
import { Dev } from './screens/Dev'
import { DevEdit } from './screens/DevEdit'
import { Residents } from './screens/Residents'
import { ResidentProfile } from './screens/ResidentProfile'
import { Announce } from './screens/Announce'
import { Onboarding } from './screens/Onboarding'
import { Wrap } from './screens/Wrap'

const SCREENS: Record<ScreenName, ComponentType> = {
  overview: Overview,
  day: Day,
  invite: Invite,
  archive: Archive,
  archiveWeek: ArchiveWeek,
  guestVisits: GuestVisits,
  visits: Visits,
  walkIn: WalkIn,
  settings: Settings,
  dues: DuesScreen,
  duesPerson: DuesPerson,
  duesHistory: DuesHistory,
  duesSettings: DuesSettings,
  stats: Stats,
  statsDay: StatsDay,
  statsDays: StatsDays,
  statsPerson: StatsPerson,
  myVisits: MyVisits,
  peek: Peek,
  peekDay: PeekDay,
  visit: Visit,
  guestNote: GuestNote,
  newRequest: NewRequest,
  editRequest: EditRequest,
  event: Event,
  eventApply: EventApply,
  eventApps: EventApps,
  route: Route,
  dev: Dev,
  devEdit: DevEdit,
  residents: Residents,
  residentProfile: ResidentProfile,
  announce: Announce,
  onboarding: Onboarding,
  wrap: Wrap,
}

function BusyOverlay() {
  return createPortal(
    <div id="busy-overlay">
      <div className="spinner" />
    </div>,
    document.body,
  )
}

/**
 * Прежний экран под верхним на время жеста «вниз» или свайпа назад: картинка в той прокрутке,
 * в которой его оставили. Окно прокручивает верхний экран, поэтому нижний сдвинут сам и тапы не ловит.
 * Его нижняя панель тоже в картинке, под затемнением: появись она только после жеста,
 * в последнем кадре посадки она выскочила бы рывком.
 */
function UnderScreen({ entry, mode }: { entry: NavEntry; mode: UnderMode }) {
  const Comp = SCREENS[entry.name]
  const [bar, setBar] = useState<HTMLDivElement | null>(null)
  return (
    <div className={`screen-under ${mode}`} inert aria-hidden="true">
      <div className="screen-under-zoom">
        <div className="screen-under-in" style={{ transform: `translateY(${-(entry.scrollY ?? 0)}px)` }}>
          <BarContext.Provider value={bar}>
            <UnderContext.Provider value>
              <EntryContext.Provider value={entry.id}>
                <Comp />
              </EntryContext.Provider>
            </UnderContext.Provider>
          </BarContext.Provider>
        </div>
        <div ref={setBar} />
      </div>
      <div className="screen-under-dim" />
    </div>
  )
}

export function App() {
  const { stack, navId, anim } = useStore()
  const under = useUnder()
  const [barNode, setBarNode] = useState<HTMLDivElement | null>(null)

  // Прокрутка — только на навигации (смена navId), не при обновлении данных: вперёд экран
  // открывается сначала, «назад» возвращает его туда, где с него ушли. Именно layout-эффект:
  // переход из строки (hero.ts) снимает новый кадр сразу после отрисовки, и строка в нём
  // должна уже стоять на своём месте.
  useLayoutEffect(() => {
    window.scrollTo(0, stack[stack.length - 1]?.scrollY ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const below = under ? stack[stack.length - 2] : undefined
  const ScreenComp = SCREENS[top.name]

  return (
    <BarContext.Provider value={barNode}>
      {below && under ? <UnderScreen entry={below} mode={under} /> : null}
      <AnimContext.Provider value={anim}>
        <EntryContext.Provider value={top.id}>
          <ScreenComp key={navId} />
        </EntryContext.Provider>
      </AnimContext.Provider>
      <div className="bar-portal" ref={setBarNode} />
      <BusyOverlay />
      <ModalHost />
      <UndoToast />
    </BarContext.Provider>
  )
}
