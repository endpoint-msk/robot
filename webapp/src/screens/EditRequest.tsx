import { useEffect, useState } from 'react'
import { action } from '../api'
import { showAlert } from '../modals'
import { icons } from '../icons'
import { pop, useParams, useStore } from '../store'
import { haptic } from '../telegram'
import type { ReminderChoice } from '../types'
import { BackRow, BottomBar, Header, SectionTitle, Sep } from '../components/common'
import { AnonRow, DayChips, isPastForToday, PurposeInput, RemindCard, reminderFor, useDayTime } from '../components/forms'
import { Screen } from '../components/Screen'

export function EditRequest() {
  const params = useParams()
  const { data } = useStore()
  const days = data!.days
  const r = data!.myRequests.find((x) => x.id === params.id)

  // Хуки — безусловно; при отсутствии заявки инициализируем дефолтами и уходим назад.
  const { day, time, min, selectDay, onTimeChange } = useDayTime(r ? r.dateKey : days[0]!.dateKey, r ? r.time : null)
  const [purpose, setPurpose] = useState(r ? r.purpose : '')
  const [anon, setAnon] = useState(r ? r.anon : false)
  const [remind, setRemind] = useState<ReminderChoice | null>(r?.remind?.choice ?? null)

  useEffect(() => {
    if (!r) pop()
  }, [r])
  if (!r) return <Screen />

  const submit = async (): Promise<void> => {
    if (!time) {
      showAlert('Укажи время прихода.')
      return
    }
    if (isPastForToday(day, time)) {
      showAlert('Это время уже прошло — выбери время позже текущего.')
      return
    }
    const done = await action('edit', {
      id: r.id,
      dateKey: day,
      time,
      purpose,
      anon,
      remind: reminderFor(day, time, remind),
    })
    if (done) {
      haptic('success')
      pop()
    }
  }

  return (
    <Screen hasBottomBar>
      <BackRow label="Визит" />
      <Header title="Изменить заявку" />
      <SectionTitle>День</SectionTitle>
      <DayChips days={days} selected={day} onSelect={selectDay} />
      <div className="chips-legend">
        <span className="cl-row">
          {icons.check(12, '#34c759', 2.2)}
          число заявок и уже одобренных в этот день
        </span>
        {days.some((d) => d.events.length > 0) ? (
          <span className="cl-row">
            <i className="legend-dot" />в этот день ивент
          </span>
        ) : null}
      </div>
      <SectionTitle>Детали</SectionTitle>
      <div className="card">
        <div className="row" style={{ padding: '6px 14px' }}>
          <span style={{ fontSize: 16 }}>Приду к</span>
          <input className="time-input" type="time" value={time} min={min} onChange={(e) => onTimeChange(e.target.value)} />
        </div>
        <Sep left={14} />
        <div className="kv-block">
          <PurposeInput value={purpose} onChange={setPurpose} />
        </div>
      </div>
      <div style={{ height: 8 }} />
      <RemindCard dateKey={day} time={time} choice={remind} onChange={setRemind} sentAt={r.remind?.sentAt} />
      <div style={{ height: 8 }} />
      <AnonRow anon={anon} onChange={setAnon} />
      <BottomBar>
        <button className="primary-btn" onClick={submit}>
          Сохранить
        </button>
      </BottomBar>
    </Screen>
  )
}
