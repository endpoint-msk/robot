// Строка дня в обзоре недели (резидент) и в неделе архива, сегодняшний день карточкой.

import { useEffect, useState } from 'react'
import { fmtDayMonth, peopleWord, requestsWord, weekdayIdx, WEEKDAYS_FULL, WEEKDAYS_SHORT } from '../dates'
import { nb } from '../format'
import { icons } from '../icons'
import { E, ownTapRecent, reducedMotion } from '../motion'
import { useStore } from '../store'
import { sec } from '../theme'
import type { Attendee, DayAgenda, DayLock, HostingRequest, SpaceEvent } from '../types'
import { Collapse } from './Collapse'
import { Flip, XText } from './Flip'
import { AvatarStack, userLabel } from './people'

/** Самое долгое проявление ожившей строки: лицо, 0,12 + 0,34 с (app.css, .day-in). */
const GROW_MS = 500

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
  /** Повестка дня. В архиве её нет, как и замков. */
  agenda?: DayAgenda | null
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
  // Повестка встаёт на место метки ивента, когда ивента нет. Кроме закрытого дня, где
  // больше ничего нет: единственная строка там за причиной закрытия. Слова «закрыт»
  // в строке нет, и без неё штриховку не прочесть.
  const agendaText = !event && day.agenda && (people || !lock) ? day.agenda.text : null
  // «Пусто» — только про внешний вид строки. Открываться она должна всё равно: экран дня
  // это единственное место, где резидент отмечается «я приду», и в тихий день (заявок нет,
  // никто ещё не отметился) без этого туда было не попасть — то есть первым отметиться
  // было нельзя в принципе. Ивент и повестка - такая же активность дня, как заявка: иначе
  // день сереет, а сам повод прийти виден только на экране дня.
  const empty = !people && !event && !agendaText
  const cls =
    'row' +
    (tappable ? ' tappable' : '') +
    (isToday ? ' today' : '') +
    (empty ? ' day-empty' : '') +
    (lock ? ' day-locked' : '') +
    // Две строки внутри — своя вертикальная подложка (та же, что в «Активности»).
    ((event || agendaText) && people ? ' day-stack' : '')

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

  // Пустой день ожил своим действием (в том числе доигранным на «назад», App.tsx): «Пока
  // никого» тает, люди и подпись проявляются на его месте. Остальные смены строки ведут
  // сами лица (AvatarStack), подписи и метки. Чужая смена встаёт сразу.
  const [turn, setTurn] = useState({ empty, own: false, grow: false })
  if (turn.empty !== empty) {
    const own = ownTapRecent() && !reducedMotion()
    setTurn({ empty, own, grow: own && !empty })
  }
  // Проявление держится, пока не встанет последнее (лицо, 0,46 с): раньше снятый класс
  // оборвал бы его, а оставленный проиграл бы заново лицо, вставшее потом чужой сменой.
  useEffect(() => {
    if (!turn.grow) return
    const timer = window.setTimeout(() => setTurn((s) => ({ ...s, grow: false })), GROW_MS)
    return () => window.clearTimeout(timer)
  }, [turn.grow])

  const dayCol = (
    <div className="day-col">
      <div className="dow">
        <span>{WEEKDAYS_SHORT[weekdayIdx(day.dateKey)]}</span>
        {needsAction ? <i className="day-dot" aria-hidden="true" /> : null}
      </div>
      <div className="date">
        <span>{isToday ? 'Сегодня' : fmtDayMonth(day.dateKey)}</span>
      </div>
    </div>
  )

  // Кнопкой строка становится только когда по ней есть куда перейти: <button> без
  // обработчика всё равно ловил бы фокус и объявлялся как действие.
  const Tag = tappable ? 'button' : 'div'

  return (
    // title — единственный след закрытия для тех, кому штриховка ни о чём не говорит
    // (скринридер, наведение мышью): текстовой метки в строке нет намеренно.
    <Tag
      className={cls + (turn.own ? ' day-fresh' : '')}
      title={lock ? 'Закрыт для заявок' : needsAction ? 'Есть заявка без хоста' : undefined}
      {...(tappable ? { type: 'button' as const, onClick: onOpen } : {})}
    >
      {dayCol}
      {empty ? (
        // «Пока никого» в закрытом дне — неправда: никого и не будет.
        <span className={'day-none' + (turn.own ? ' day-none-in' : '')}>{lock ? lock.reason || 'Закрыт для гостей' : 'Пока никого'}</span>
      ) : (
        // Ивент и люди — двумя строками, как в «Активности» у гостя: в одну строку
        // метка и список не влезают. По одному времени не понять, ради чего открывать день.
        <div className={'day-main' + (turn.grow ? ' day-in' : '')}>
          {turn.grow ? (
            <span className="day-none day-ghost" aria-hidden="true">
              Пока никого
            </span>
          ) : null}
          <Collapse open={Boolean(event)} ms={320} ease={E.crisp}>
            {event ? (
              <div className="ev-day-label">
                {icons.calendar(13, '#bf5af2')}
                <span>{event.title}</span>
                <span className="ev-day-time">{`· ${event.time}`}</span>
              </div>
            ) : null}
          </Collapse>
          <Collapse open={!event && Boolean(agendaText)} ms={320} ease={E.crisp}>
            {!event && agendaText ? (
              <div className="agenda-day-label">
                {icons.agenda(13, sec(0.45))}
                <span>{agendaText}</span>
              </div>
            ) : null}
          </Collapse>
          <Collapse open={people} ms={320} ease={E.crisp}>
            <div className="day-people">
              {faces.length > 0 ? <AvatarStack users={faces} /> : null}
              <span className="day-count">
                <XText text={label} />
              </span>
              {day.approved > 0 || alwaysApproved ? (
                <div className="approved-count">
                  {icons.check(14, '#34c759')}
                  <Flip value={day.approved} />
                </div>
              ) : null}
            </div>
          </Collapse>
        </div>
      )}
      {tappable ? <div className="row-right">{icons.chevron(isToday ? sec(0.4) : undefined)}</div> : null}
    </Tag>
  )
}

/**
 * Сегодняшний день на «Ближайших днях» карточкой над неделей: экран открывают почти всегда
 * ради него. Данные те же, что у строки дня, карточка только даёт им место. День недели и
 * дата словами целиком: неделя под карточкой начинается с завтрашнего дня.
 *
 * `guest` - та же карточка в «Активности»: строки заявок нет, гостю их не показывают, и
 * стрелка встаёт к людям, а без людей к строке «Пока никого».
 */
export function TodayCard({ day, onOpen, guest = false }: { day: DayRowData; onOpen: () => void; guest?: boolean }) {
  const { data } = useStore()
  const me = data!.me.id
  const att = day.attendees ?? []
  const event = (day.events ?? [])[0]
  const lock = day.lock ?? null
  // Причина закрытия встаёт на место повестки, как в строке: слова «закрыт» нет нигде,
  // и без неё штриховку не прочесть. Повестка тогда строкой ниже, если она о другом.
  const headline = lock ? lock.reason || 'Закрыт для гостей' : (day.agenda?.text ?? null)
  const agendaLine = lock && day.agenda && day.agenda.text !== lock.reason ? day.agenda.text : null
  const pending = day.total - day.approved
  const needsAction = !guest && pending > 0 && !lock

  // «вы, @mika и ещё 1»: себя человек ищет в списке первым.
  const names = [...(att.some((a) => a.userId === me) ? ['вы'] : []), ...att.filter((a) => a.userId !== me).map(userLabel)]
  const rest = names.length - 2
  const who =
    rest > 0 ? nb(`${names.slice(0, 2).join(', ')} и ещё ${rest}`) : names.length === 2 ? `${names[0]} и ${names[1]}` : (names[0] ?? '')

  const foot =
    day.total > 0
      ? `${requestsWord(day.total)}${needsAction ? `, ${pending}\u00a0без хоста` : ''}`
      : lock
        ? 'Заявки закрыты'
        : att.length > 0
          ? 'Заявок нет'
          : 'Пока никого'

  return (
    <button
      type="button"
      className={'today-card' + (lock ? ' day-locked' : '') + (guest && att.length > 0 ? ' tc-nofoot' : '')}
      title={lock ? 'Закрыт для заявок' : needsAction ? 'Есть заявка без хоста' : undefined}
      onClick={onOpen}
    >
      <div className="tc-k">
        <span className="tc-today">Сегодня</span>
        {` · ${WEEKDAYS_FULL[weekdayIdx(day.dateKey)]!.toLowerCase()}, ${fmtDayMonth(day.dateKey)}`}
      </div>
      {/* Тема, ивент и люди вырастают, когда появились своим действием, а подписи
          перетекают: та же смена, что на экране дня, доигранная на «назад» (App.tsx). */}
      <Collapse open={Boolean(headline)} ms={320} ease={E.crisp}>
        {headline ? <div className={'tc-ag' + (lock ? ' reason' : '')}>{headline}</div> : null}
      </Collapse>
      {agendaLine ? (
        <div className="agenda-day-label tc-line">
          {icons.agenda(13, sec(0.45))}
          <span>{agendaLine}</span>
        </div>
      ) : null}
      <Collapse open={Boolean(event)} ms={320} ease={E.crisp}>
        {event ? (
          <div className="ev-day-label tc-line">
            {icons.calendar(13, '#bf5af2')}
            <span>{event.title}</span>
            <span className="ev-day-time">{`· ${event.time}`}</span>
          </div>
        ) : null}
      </Collapse>
      <Collapse open={att.length > 0} ms={320} ease={E.crisp}>
        <div className="tc-people">
          <AvatarStack users={att} />
          <span className="tc-who">
            <b>
              {'Придут '}
              <Flip value={att.length} delay={140} />
            </b>
            <span>
              <XText text={who} delay={80} />
            </span>
          </span>
          {guest ? icons.chevron(sec(0.4)) : null}
        </div>
      </Collapse>
      {guest ? (
        att.length > 0 ? null : (
          <div className="tc-foot muted">
            <span className="tc-req">{lock ? 'Заявки закрыты' : 'Пока никого'}</span>
            {icons.chevron(sec(0.4))}
          </div>
        )
      ) : (
        <div className={'tc-foot' + (day.total > 0 ? '' : ' muted')}>
          <span className="tc-req">
            {needsAction ? <i className="day-dot" aria-hidden="true" /> : null}
            <XText text={foot} />
          </span>
          {day.approved > 0 ? (
            <span className="approved-count">
              {icons.check(14, '#34c759')}
              <Flip value={day.approved} />
            </span>
          ) : null}
          {icons.chevron(sec(0.4))}
        </div>
      )}
    </button>
  )
}
