import { useState } from 'react'
import { api } from '../api'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { resetRoot, setBusy, setData, useStore } from '../store'
import { botCanWrite, haptic, requestWriteAccess } from '../telegram'
import type { Bootstrap, ReminderChoice } from '../types'
import { BackRow, BottomBar, Header, SectionTitle, Sep } from '../components/common'
import {
  AnonRow,
  DayChips,
  DayChipsLegend,
  firstOpenDay,
  isPastForToday,
  PurposeInput,
  RemindCard,
  reminderFor,
  useDayTime,
} from '../components/forms'
import { Screen } from '../components/Screen'
import { TimeField } from '../components/TimeField'

export function NewRequest() {
  const { data } = useStore()
  const days = data!.days
  // Закрытый день в чипах не выбрать — предвыбранным он оставил бы форму в состоянии,
  // из которого заявку не отправить.
  const { day, time, min, selectDay, onTimeChange } = useDayTime(firstOpenDay(days), null)
  const locked = days.find((d) => d.dateKey === day)?.lock ?? null
  const [purpose, setPurpose] = useState('')
  const [anon, setAnon] = useState(false)
  // Напоминание предлагается включённым: выключенное по умолчанию им бы почти никто
  // не воспользовался, а именно оно и уменьшает «забыл про заявку».
  const [remind, setRemind] = useState<ReminderChoice | null>('h2')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (): Promise<void> => {
    if (locked) {
      showAlert('В этот день спейс закрыт для гостей — выберите другой.')
      return
    }
    if (!time) {
      showAlert('Укажите время прихода.')
      return
    }
    if (isPastForToday(day, time)) {
      showAlert('Это время уже прошло — выберите время позже текущего.')
      return
    }
    setSubmitting(true)
    setBusy(true)
    try {
      // Если гость открыл миниапп из чата без /start, бот не сможет прислать ему ответ
      // резидента в личку — до создания заявки просим доступ нативной плашкой Telegram.
      if (!botCanWrite()) await requestWriteAccess()
      setData(await api<Bootstrap>('create', { dateKey: day, time, purpose, anon, remind: reminderFor(day, time, remind) }))
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
      <DayChipsLegend days={days} />
      <SectionTitle>Детали</SectionTitle>
      <div className="card">
        <div className="row" style={{ padding: '6px 14px' }}>
          <span style={{ fontSize: 16 }}>Приду к</span>
          <TimeField value={time} min={min} onChange={onTimeChange} />
        </div>
        <Sep left={14} />
        <div className="kv-block">
          <PurposeInput value={purpose} onChange={setPurpose} />
        </div>
      </div>
      <div style={{ height: 8 }} />
      <RemindCard dateKey={day} time={time} choice={remind} onChange={setRemind} />
      <div style={{ height: 8 }} />
      <AnonRow anon={anon} onChange={setAnon} />
      {/* Про кнопку «Я на месте» говорим заранее: в момент, когда гость стоит у двери,
          читать инструкции поздно, а сама кнопка появится только в день визита. */}
      <div className="hint-card">
        <div className="hint-icon">{icons.pin(17, '#34c759')}</div>
        <div className="hint-text">
          Когда доберётесь до спейса, откройте свой визит и нажмите «Я на месте» - резиденты
          поймут, что нужно открыть.
        </div>
      </div>
      <BottomBar>
        <button className="primary-btn" disabled={submitting} onClick={submit}>
          Отправить заявку
        </button>
        <div className="bar-hint">Ваша заявка будет отправлена резидентам</div>
      </BottomBar>
    </Screen>
  )
}
