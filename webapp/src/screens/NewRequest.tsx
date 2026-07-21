import { useState } from 'react'
import { api } from '../api'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { resetRoot, setBusy, setData, useStore } from '../store'
import { botCanWrite, haptic, requestWriteAccess } from '../telegram'
import type { Bootstrap } from '../types'
import { BackRow, BottomBar, Header, SectionTitle, Sep } from '../components/common'
import { AnonRow, DayChips, isPastForToday, PurposeInput, useDayTime } from '../components/forms'
import { Screen } from '../components/Screen'

export function NewRequest() {
  const { data } = useStore()
  const days = data!.days
  const { day, time, min, selectDay, onTimeChange } = useDayTime(days[0]!.dateKey, null)
  const [purpose, setPurpose] = useState('')
  const [anon, setAnon] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (): Promise<void> => {
    if (!time) {
      showAlert('Укажи время прихода.')
      return
    }
    if (isPastForToday(day, time)) {
      showAlert('Это время уже прошло — выбери время позже текущего.')
      return
    }
    setSubmitting(true)
    setBusy(true)
    try {
      // Если гость открыл миниапп из чата без /start, бот не сможет прислать ему ответ
      // резидента в личку — до создания заявки просим доступ нативной плашкой Telegram.
      if (!botCanWrite()) await requestWriteAccess()
      setData(await api<Bootstrap>('create', { dateKey: day, time, purpose, anon }))
      haptic('success')
      resetRoot()
    } catch (err) {
      showAlert((err as Error).message)
      setSubmitting(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen hasBottomBar>
      <BackRow label="Назад" />
      <Header title="Хочу прийти" />
      <SectionTitle>День</SectionTitle>
      <DayChips days={days} selected={day} onSelect={selectDay} />
      <div className="chips-legend">
        {icons.check(12, '#34c759', 2.2)}
        число заявок и уже одобренных в этот день
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
      <AnonRow anon={anon} onChange={setAnon} />
      <BottomBar>
        <button className="primary-btn" disabled={submitting} onClick={submit}>
          Отправить заявку
        </button>
        <div className="bar-hint">Ваша заявка будет отправлена резидентам</div>
      </BottomBar>
    </Screen>
  )
}
