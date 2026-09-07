// Строка дня в обзоре недели (резидент) и в неделе архива.

import { fmtDayMonth, peopleWord, requestsWord, weekdayIdx, WEEKDAYS_SHORT } from '../dates'
import { icons } from '../icons'
import { useStore } from '../store'
import { sec } from '../theme'
import type { Attendee, DayLock, HostingRequest, SpaceEvent } from '../types'
import { AvatarStack } from './people'

type DayRowData = {
  dateKey: string
  total: number
  approved: number
  requests?: HostingRequest[]
  /** Публичный «кто придёт»: в обзоре есть всегда, в архиве не приходит вовсе. */
  attendees?: Attendee[]
  /** Ивенты дня: в архиве их нет. */
  events?: SpaceEvent[]
  /** День закрыт для гостевых заявок. В архиве замков нет. */
  lock?: DayLock | null
}

export function DayRow({
  day,
  tappable = false,
  onOpen,
  alwaysApproved = false,
}: {
  day: DayRowData
  tappable?: boolean
  onOpen?: () => void
  alwaysApproved?: boolean
}) {
  const { data } = useStore()
  const isToday = day.dateKey === data!.todayKey
  const att = day.attendees ?? []
  const event = (day.events ?? [])[0]
  const lock = day.lock ?? null
  // Заявок нет, но кто-то придёт — показываем людей, а не «нет заявок»: иначе день
  // с одними отметками резидентов выглядит пустым.
  const people = day.total > 0 || att.length > 0
  // «Пусто» — только про внешний вид строки. Открываться она должна всё равно: экран дня
  // это единственное место, где резидент отмечается «я приду», и в тихий день (заявок нет,
  // никто ещё не отметился) без этого туда было не попасть — то есть первым отметиться
  // было нельзя в принципе. Ивент — такая же активность дня, как заявка: день с ивентом
  // не «пустой», иначе он сереет, а сам повод прийти виден только на экране дня.
  const empty = !people && !event
  const cls =
    'row' +
    (tappable ? ' tappable' : '') +
    (isToday ? ' today' : '') +
    (empty ? ' day-empty' : '') +
    (lock ? ' day-locked' : '') +
    // Две строки внутри — своя вертикальная подложка (та же, что в «Активности»).
    (event && people ? ' day-stack' : '')

  const dayCol = (
    <div className="day-col">
      <div className="dow">{WEEKDAYS_SHORT[weekdayIdx(day.dateKey)]}</div>
      <div className="date">{isToday ? 'Сегодня' : fmtDayMonth(day.dateKey)}</div>
    </div>
  )

  // Резиденты и гости в одном стеке, резиденты первыми (тот же порядок, что у
  // attendeesForDay). Раньше при непустом списке заявок отметившиеся резиденты
  // из строки пропадали целиком: день, на который собрались трое своих, выглядел
  // как день с одной гостевой заявкой.
  const guests = (day.requests || []).map((r) => r.guest)
  const seen = new Set<number>()
  const faces = [...att.filter((a) => a.resident), ...guests, ...att.filter((a) => !a.resident)].filter((u) => {
    if (seen.has(u.userId)) return false
    seen.add(u.userId)
    return true
  })
  const label = day.total > 0 ? requestsWord(day.total) : peopleWord(att.length)
  // Заявка есть, а хоста у неё нет — единственное место в неделе, где от резидента
  // что-то требуется. Точка, а не слово: строка и так плотная, а «ждут ответа»
  // читается как статус дня, хотя относится к части заявок.
  const needsAction = day.total > day.approved && !lock

  // Кнопкой строка становится только когда по ней есть куда перейти: <button> без
  // обработчика всё равно ловил бы фокус и объявлялся как действие.
  const Tag = tappable ? 'button' : 'div'

  return (
    // title — единственный след закрытия для тех, кому штриховка ни о чём не говорит
    // (скринридер, наведение мышью): текстовой метки в строке нет намеренно.
    <Tag className={cls} title={lock ? 'Закрыт для заявок' : needsAction ? 'Есть заявка без хоста' : undefined} {...(tappable ? { type: 'button' as const, onClick: onOpen } : {})}>
      {dayCol}
      {needsAction ? <i className="day-dot" aria-hidden="true" /> : null}
      {empty ? (
        // «Пока никого» в закрытом дне — неправда: никого и не будет.
        <span className="day-none">{lock ? lock.reason || 'Закрыт для гостей' : 'Пока никого'}</span>
      ) : (
        // Ивент и люди — двумя строками, как в «Активности» у гостя: в одну строку
        // метка и список не влезают. В метке только время — название видно внутри дня.
        <div className="day-main">
          {event ? (
            <div className="ev-day-label">
              {icons.calendar(13, '#bf5af2')}
              <span>{`в ${event.time}`}</span>
            </div>
          ) : null}
          {people ? (
            <div className="day-people">
              {faces.length > 0 ? <AvatarStack users={faces} /> : null}
              <span className="day-count">{label}</span>
            </div>
          ) : null}
        </div>
      )}
      <div className="row-right">
        {!empty && (day.approved > 0 || alwaysApproved) ? (
          <div className="approved-count">
            {icons.check(14, '#34c759')}
            {String(day.approved)}
          </div>
        ) : null}
        {tappable ? icons.chevron(isToday ? sec(0.4) : undefined) : null}
      </div>
    </Tag>
  )
}
