import { Fragment } from 'react'
import { action } from '../api'
import { fmtDayMonth, requestsWord, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { icons } from '../icons'
import { confirmDialog, numberPrompt, textPrompt } from '../modals'
import { haptic } from '../telegram'
import { sec } from '../theme'
import { pop, push, useParams, useStore } from '../store'
import type { DayCapacity, DayLock, HostingRequest } from '../types'
import { BackRow, EmptyState, Footnote, Header, ReadonlyBadge, SectionTitle, Sep, Switch } from '../components/common'
import { AttendeesCard } from '../components/attendees'
import { EventRow } from '../components/EventRow'
import { RequestsCard } from '../components/RequestRow'
import { Screen } from '../components/Screen'

/** Причина закрытия: её вводят один раз при закрытии и правят строкой в карточке. */
const askReason = (initial: string): Promise<string | null> =>
  textPrompt({
    text: 'Почему спейс закрыт?',
    initial,
    placeholder: 'Например: уборка',
    hint: 'Причину увидят гости. Можно оставить пустой.',
    maxLength: 120,
    confirmLabel: 'Готово',
  })

/** Плашка «день закрыт» под шапкой — отдельно от переключателя внизу экрана. */
function LockBanner({ lock }: { lock: DayLock }) {
  const who = lock.by ? (lock.by.username ? '@' + lock.by.username : lock.by.name) : ''
  return (
    <div className="lock-banner">
      <div className="lb-icon">{icons.lockFilled()}</div>
      <div className="lb-text">
        <div className="lb-title">Спейс закрыт для гостей</div>
        <div className="lb-sub">
          {[lock.reason, who ? `закрыл ${who}` : ''].filter(Boolean).join(' · ') || 'Новые заявки не принимаются'}
        </div>
      </div>
    </div>
  )
}

/**
 * Переключатель «Закрыт для заявок». Уже поданные заявки закрытие не трогает: отменить
 * чужой согласованный визит одним тумблером нельзя, для этого есть «Закрыть заявку»
 * с уведомлением гостя — поэтому на непустом дне сначала спрашиваем подтверждение.
 * Открытие тоже подтверждается: день закрывает любой резидент, и снять чужой замок
 * промахом по тумблеру — значит впустить гостей в день, про который договорились иначе.
 */
function LockCard({ dateKey, lock, requests }: { dateKey: string; lock: DayLock | null; requests: number }) {
  const toggle = async (): Promise<void> => {
    if (lock) {
      const who = lock.by ? (lock.by.username ? '@' + lock.by.username : lock.by.name) : ''
      const ok = await confirmDialog(
        [
          who ? `День закрыл ${who}.` : 'День закрыт.',
          lock.reason ? `Причина: ${lock.reason}.` : '',
          'Откроем — гости снова смогут оставлять заявки, и день вернётся на доску.',
        ]
          .filter(Boolean)
          .join(' '),
        { confirmLabel: 'Открыть день' },
      )
      if (!ok) return
      const done = await action('day.lock', { dateKey, locked: false })
      if (done) haptic('success')
      return
    }
    if (requests > 0) {
      const ok = await confirmDialog(
        `На этот день уже есть ${requestsWord(requests)}. Закрытие их не отменяет — гости просто не смогут оставить новые.`,
        { confirmLabel: 'Всё равно закрыть' },
      )
      if (!ok) return
    }
    const reason = await askReason('')
    if (reason === null) return
    const done = await action('day.lock', { dateKey, locked: true, reason })
    if (done) haptic('warning')
  }

  const editReason = async (): Promise<void> => {
    const reason = await askReason(lock?.reason ?? '')
    if (reason === null) return
    await action('day.lock', { dateKey, locked: true, reason })
  }

  return (
    <div className="card">
      <div className="row">
        <span className="row-label">
          Закрыт для заявок
          <span className="row-sublabel">Гости не оставят заявку, резиденты отмечаются как обычно</span>
        </span>
        <Switch on={Boolean(lock)} onToggle={toggle} label="Закрыт для заявок" />
      </div>
      {lock ? (
        <>
          <Sep left={14} />
          <button type="button" className="row tappable" onClick={editReason}>
            <span className="row-label">Причина</span>
            <div className="row-right">
              <span className="lock-reason">{lock.reason || 'Добавить'}</span>
              {icons.chevron()}
            </div>
          </button>
        </>
      ) : null}
    </div>
  )
}

/**
 * Вместимость дня: мягкий лимит. Он ничего не запрещает — при «Захостить» сверх него
 * приходит предупреждение с числами, а решать резиденту, который видит день целиком.
 * Заявки без хоста в «занято» не входят: подтвердится из них не всё, и считать их
 * занятыми значит упираться в потолок раньше времени.
 */
function CapacityCard({ dateKey, capacity }: { dateKey: string; capacity: DayCapacity }) {
  const over = capacity.occupied > capacity.cap
  const full = !over && capacity.occupied >= capacity.cap
  const edit = async (): Promise<void> => {
    const value = await numberPrompt({
      text: 'Сколько человек помещается в этот день?',
      initial: capacity.cap,
      hint: `Рекомендуем ${capacity.defaultCap}: столько вмещает подвал. Лимит мягкий — захостить сверх него можно, бот только предупредит.`,
      min: 1,
      max: 200,
      confirmLabel: 'Сохранить',
    })
    if (value === null || value === capacity.cap) return
    const done = await action('day.cap', { dateKey, cap: value })
    if (done) haptic('success')
  }
  const reset = async (): Promise<void> => {
    const done = await action('day.cap', { dateKey, cap: null })
    if (done) haptic('success')
  }
  return (
    <div className="card">
      <button type="button" className="row tappable" onClick={edit}>
        <span className="row-label">
          Вместимость
          <span className="row-sublabel">
            {`Занято ${capacity.occupied}`}
            {capacity.pending > 0 ? `, ещё ${requestsWord(capacity.pending)} без хоста` : ''}
          </span>
        </span>
        <div className="row-right">
          <span className={'cap-value' + (over ? ' over' : full ? ' full' : '')}>
            {`${capacity.occupied} / ${capacity.cap}`}
          </span>
          {icons.chevron()}
        </div>
      </button>
      {capacity.custom ? (
        <>
          <Sep left={14} />
          <button type="button" className="row tappable" onClick={reset}>
            <span className="row-label">Вернуть общую</span>
            <div className="row-right">
              <span className="lock-reason">{String(capacity.defaultCap)}</span>
            </div>
          </button>
        </>
      ) : null}
    </div>
  )
}

export function Day() {
  const params = useParams()
  const { data } = useStore()
  const archive = Boolean(params.archive)

  // День мог выпасть из окна обзора, пока экран был открыт (прежде всего — при
  // переходе через полночь). Это не «заявок нет»: данных о дне у нас больше нет
  // вовсе, и утверждать за него что-либо экран не вправе.
  const liveDay = !archive ? data!.days.find((d) => d.dateKey === params.dateKey) : undefined
  const dropped = !archive && !liveDay

  let requests: HostingRequest[]
  if (archive) {
    requests = (params.requests as HostingRequest[]) || []
  } else {
    requests = (liveDay && liveDay.requests) || []
  }
  const approved = requests.filter((r) => r.status === 'approved')
  const pending = requests.filter((r) => r.status !== 'approved')
  const isToday = !archive && params.dateKey === data!.todayKey

  // Резиденты «я приду» + переключатель для себя (только в живом дне).
  const dayObj = liveDay
  const residentsComing = !archive ? ((dayObj && dayObj.attendees) || []).filter((a) => a.resident) : []
  const iAmComing = residentsComing.some((a) => a.userId === data!.me.id)
  const events = (dayObj && dayObj.events) || []
  const lock = (dayObj && dayObj.lock) || null
  // Вместимость приходит только резидентам (см. bootstrap) — у гостя её нет вовсе.
  const capacity = (dayObj && dayObj.capacity) || null

  if (dropped) {
    return (
      <Screen>
        <BackRow label="Ближайшие дни" />
        <Header title={WEEKDAYS_FULL[weekdayIdx(params.dateKey)]} subtitle={fmtDayMonth(params.dateKey)} />
        <div className="card">
          <EmptyState
            icon={icons.calendar(26, sec(0.3))}
            title="Этот день больше не в обзоре"
            text={`Обзор показывает ближайшие семь дней, и ${fmtDayMonth(params.dateKey)} из них вышло.`}
          />
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 20px 22px' }}>
            <button type="button" className="retry-btn" style={{ marginTop: 0 }} onClick={pop}>
              К ближайшим дням
            </button>
          </div>
        </div>
      </Screen>
    )
  }

  return (
    <Screen>
      <BackRow label={archive ? 'Неделя' : 'Ближайшие дни'} />
      <Header
        title={WEEKDAYS_FULL[weekdayIdx(params.dateKey)]}
        subtitle={`${isToday ? 'Сегодня, ' : ''}${fmtDayMonth(params.dateKey)} · ${requestsWord(requests.length)}`}
      />
      {archive ? <ReadonlyBadge /> : null}
      {lock ? <LockBanner lock={lock} /> : null}
      {!archive ? (
        <button
          className={'attend-btn' + (iAmComing ? ' on' : '')}
          onClick={async () => {
            const done = await action('attend', { dateKey: params.dateKey, coming: !iAmComing })
            if (done) haptic(iAmComing ? 'warning' : 'success')
          }}
        >
          {iAmComing ? icons.check(15, '#fff', 2.6) : null}
          {iAmComing ? 'Вы придёте в этот день' : 'Я приду'}
        </button>
      ) : null}
      {!archive ? (
        <button className="secondary-btn" style={{ marginTop: 10 }} onClick={() => push('invite', { dateKey: params.dateKey })}>
          {icons.personPlus()}
          Позвать в спейс
        </button>
      ) : null}
      {/* Ивенты дня: список с переходом в редактор + строка «ещё» в конце той же карточки.
          Ивентов на день может быть сколько угодно, поэтому вход в редактор нужен и тогда,
          когда список уже не пуст. */}
      {!archive && events.length > 0 ? (
        <div className="card" style={{ marginTop: 20 }}>
          {events.map((ev, i) => (
            <Fragment key={ev.id}>
              {i > 0 ? <Sep left={62} /> : null}
              <EventRow event={ev} />
            </Fragment>
          ))}
          <Sep left={62} />
          <button
            type="button"
            className="row tappable ev-add-row"
            onClick={() => push('event', { dateKey: params.dateKey })}
          >
            <div className="row-icon ev-row-icon">{icons.plusSmall()}</div>
            <span className="ev-add-label">Ещё ивент</span>
          </button>
        </div>
      ) : null}
      {!archive && events.length === 0 ? (
        <button
          className="secondary-btn event-btn"
          style={{ marginTop: 10 }}
          onClick={() => push('event', { dateKey: params.dateKey })}
        >
          {icons.calendar(16, '#bf5af2')}
          Создать ивент
        </button>
      ) : null}
      {!archive && residentsComing.length > 0 ? (
        <>
          <SectionTitle>{`Придут резиденты · ${residentsComing.length}`}</SectionTitle>
          <AttendeesCard list={residentsComing} />
        </>
      ) : null}
      {requests.length === 0 && (archive || (residentsComing.length === 0 && events.length === 0)) ? (
        <div className="card">
          <EmptyState
            title={archive ? 'Заявок не было' : 'Нет заявок гостей'}
            text={archive ? 'В этот день никто не собирался прийти.' : 'На этот день пока никто не оставил заявку.'}
          />
        </div>
      ) : null}
      {approved.length > 0 ? (
        <>
          <SectionTitle>{`Одобрены · ${approved.length}`}</SectionTitle>
          <RequestsCard list={approved} archive={archive} />
        </>
      ) : null}
      {pending.length > 0 ? (
        <>
          <SectionTitle>{`Ждут ответа · ${pending.length}`}</SectionTitle>
          <RequestsCard list={pending} archive={archive} />
        </>
      ) : null}
      {/* Четыре действия резидента живут только в свайпе, и на экране не было ни
          одного следа жеста: не зная про него, закрыть заявку или предложить
          перенос физически нечем. Тот же приём и тот же компонент уже стоят в
          «Взносах». */}
      {requests.length > 0 ? (
        <Footnote>
          {archive
            ? 'Свайп по строке влево — заметка о госте.'
            : 'Свайп по строке влево: заметка, перенос, закрыть заявку, блокировка. Тап по своему имени в «одобрил» — передать визит другому резиденту.'}
        </Footnote>
      ) : null}
      {!archive ? (
        <>
          <SectionTitle>День</SectionTitle>
          <LockCard dateKey={params.dateKey} lock={lock} requests={requests.length} />
          {capacity ? <CapacityCard dateKey={params.dateKey} capacity={capacity} /> : null}
        </>
      ) : null}
    </Screen>
  )
}
