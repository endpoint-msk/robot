import { Fragment, useEffect, useState } from 'react'
import { fmtRange, requestsWord } from '../dates'
import { money } from '../format'
import { icons } from '../icons'
import { push, useStore } from '../store'
import { DevChips, Header, Sep } from '../components/common'
import { DayRow } from '../components/DayRow'
import { LaterEvents } from '../components/EventRow'
import { MacSheet } from '../components/MacSheet'
import { Screen } from '../components/Screen'

/**
 * Плашка «взнос не отмечен»: висит, пока свой взнос не закрыт, дальше исчезает.
 * Нулевая ставка — освобождение: с человека взнос не спрашивают, и напоминать не о чем.
 */
function DuesBanner() {
  const { data } = useStore()
  const dues = data!.dues
  if (!dues || !dues.enabled || !dues.me.inRoster || dues.me.amount <= 0 || dues.me.status !== 'none') return null
  return (
    <button type="button" className="write-banner" onClick={() => push('dues')}>
      <div className="wb-icon">{icons.rub(17, '#fff')}</div>
      <div className="wb-text">
        <div className="wb-title">{`Взнос за ${dues.periodLabel.split(' ')[0]?.toLowerCase()}, ${money(dues.me.amount, dues.currency)}`}</div>
        <div className="wb-sub">Ещё не отмечен</div>
      </div>
      {icons.chevron()}
    </button>
  )
}

/** Сколько после вступления на главной висит плашка «Привяжите телефон». */
const PHONE_BANNER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Плашка для тех, кто пропустил привязку телефона в знакомстве: неделю после
 * вступления, пока телефон не привязан. Синяя, а не тёплая, как у взноса: это
 * приглашение, а не долг.
 */
function PhoneBanner() {
  const { data } = useStore()
  const [sheet, setSheet] = useState(false)
  const joinedAt = data!.onboarding?.joinedAt
  const bound = (data!.settings?.macs.length ?? 0) > 0
  const fresh = joinedAt ? Date.now() - Date.parse(joinedAt) < PHONE_BANNER_MS : false
  return (
    <>
      {fresh && !bound ? (
        <button type="button" className="write-banner invite" onClick={() => setSheet(true)}>
          <div className="wb-icon">{icons.wifi()}</div>
          <div className="wb-text">
            <div className="wb-title">Привяжите телефон</div>
            <div className="wb-sub">Бот сам отметит вас в спейсе</div>
          </div>
          {icons.chevron('var(--blue)')}
        </button>
      ) : null}
      {sheet ? <MacSheet onClose={() => setSheet(false)} /> : null}
    </>
  )
}

/** Сколько код домофона остаётся открытым: главную часто скриншотят в чаты. */
const DOOR_REVEAL_MS = 60_000

/** Код как на панели: буквы клавиш в рамке, цифры группами. */
function DoorCodeView({ code }: { code: string }) {
  const parts = code.match(/\d+|\D/g) ?? []
  return (
    <span className="door-code">
      {parts.map((p, i) => (/\d/.test(p) ? <span key={i}>{p}</span> : <span key={i} className="door-k">{p}</span>))}
    </span>
  )
}

/** Код домофона: скрыт, пока не попросили, и через минуту прячется сам. */
function DoorRow() {
  const { data } = useStore()
  const door = data!.door ?? null
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(false), DOOR_REVEAL_MS)
    return () => clearTimeout(timer)
  }, [shown])
  if (!door) return null
  return (
    <>
      <button
        type="button"
        className="row tappable"
        aria-label={shown ? `Код домофона ${door.code}` : 'Показать код домофона'}
        onClick={() => setShown(!shown)}
      >
        <div className="row-icon" style={{ background: 'var(--orange)' }}>
          {icons.door(18, '#fff')}
        </div>
        <span className="row-label">
          Домофон
          {door.note ? <span className="row-sublabel">{door.note}</span> : null}
        </span>
        <div className="row-right">{shown ? <DoorCodeView code={door.code} /> : <span className="door-show">Показать</span>}</div>
      </button>
      <Sep left={54} />
    </>
  )
}

/** Строка входа в раздел взносов со своим статусом справа. */
function DuesRow() {
  const { data } = useStore()
  const dues = data!.dues
  if (!dues) return null
  const status = !dues.enabled
    ? { text: 'Выключены', color: 'var(--text-3)' }
    : !dues.me.inRoster
      ? { text: '', color: 'var(--text-3)' }
      : dues.me.amount <= 0
        ? { text: 'Не требуется', color: 'var(--text-3)' }
        : dues.me.status === 'paid'
          ? { text: 'Внесён', color: 'var(--green)' }
          : dues.me.status === 'claimed'
            ? { text: 'Ждёт сверки', color: 'var(--text-2)' }
            : { text: 'Не внесён', color: 'var(--orange)' }
  return (
    <>
      <button type="button" className="row tappable" onClick={() => push('dues')}>
        <div className="row-icon" style={{ background: 'var(--green)' }}>
          {icons.rub(17, '#fff')}
        </div>
        <span className="row-label">Взносы</span>
        <div className="row-right">
          <span className="dues-amount" style={{ color: status.color }}>
            {status.text}
          </span>
          {icons.chevron()}
        </div>
      </button>
      <Sep left={54} />
    </>
  )
}

export function Overview() {
  const { data } = useStore()
  const days = data!.days
  const total = days.reduce((sum, d) => sum + d.total, 0)
  const first = days[0]!.dateKey
  const last = days[days.length - 1]!.dateKey

  return (
    <Screen>
      <Header title="Ближайшие дни" subtitle={`${fmtRange(first, last)} · ${requestsWord(total)}`} chip={<DevChips />} />
      <DuesBanner />
      <PhoneBanner />
      <div className="card">
        {days.map((day, i) => (
          <Fragment key={day.dateKey}>
            {i > 0 ? <Sep left={86} /> : null}
            <DayRow day={day} tappable onOpen={() => push('day', { dateKey: day.dateKey })} />
          </Fragment>
        ))}
      </div>
      <LaterEvents backLabel="Ближайшие дни" />
      <div style={{ height: 22 }} />
      <div className="card">
        <DoorRow />
        <button type="button" className="row tappable" onClick={() => push('archive')}>
          <div className="row-icon" style={{ background: 'var(--indigo)' }}>
            {icons.archiveBox()}
          </div>
          <span className="row-label">Архив</span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
        <Sep left={54} />
        <button type="button" className="row tappable" onClick={() => push('stats')}>
          <div className="row-icon" style={{ background: 'var(--blue)' }}>
            {icons.chart()}
          </div>
          <span className="row-label">Статистика</span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
        <Sep left={54} />
        <DuesRow />
        <button type="button" className="row tappable" onClick={() => push('settings')}>
          <div className="row-icon" style={{ background: 'var(--gray)' }}>
            {icons.gear()}
          </div>
          <span className="row-label">Настройки</span>
          <div className="row-right">{icons.chevron()}</div>
        </button>
      </div>
    </Screen>
  )
}
