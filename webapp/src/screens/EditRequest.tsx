import { useEffect, useState } from 'react'
import { action } from '../api'
import { showAlert } from '../modals'
import { markOwnTap } from '../motion'
import { pop, useParams, useStore } from '../store'
import { haptic } from '../telegram'
import type { ReminderChoice } from '../types'
import { ActionButton, BackRow, BottomBar, Header, SectionTitle, Sep, SwitchRow } from '../components/common'
import { Crossfade } from '../components/Crossfade'
import {
  DayChips,
  SelectedDayInfo,
  firstOpenDay,
  isPastForToday,
  PurposeInput,
  reminderFor,
  useDayTime,
} from '../components/forms'
import { Screen } from '../components/Screen'
import { TimeRow } from '../components/TimeField'
import { useRemind } from './NewRequest'

export function EditRequest() {
  const params = useParams()
  const { data } = useStore()
  const days = data!.days
  const r = data!.myRequests.find((x) => x.id === params.id)

  // Хуки — безусловно; при отсутствии заявки инициализируем дефолтами и уходим назад.
  const { day, time, min, selectDay, onTimeChange } = useDayTime(r ? r.dateKey : firstOpenDay(days), r ? r.time : null)
  const [purpose, setPurpose] = useState(r ? r.purpose : '')
  const [anon, setAnon] = useState(r ? r.anon : false)
  const [remind, setRemind] = useState<ReminderChoice | null>(r?.remind?.choice ?? null)
  // Отправленное напоминание сервер снимает вместе со сменой слота, поэтому «уже
  // отправлено» держится, только пока день и время прежние.
  const sent = Boolean(r?.remind?.sentAt) && day === r?.dateKey && time === r?.time
  const remindUi = useRemind(day, time, remind, setRemind, sent)

  useEffect(() => {
    if (!r) pop()
  }, [r])
  if (!r) return <Screen />

  const submit = async (): Promise<void> => {
    if (!time) {
      showAlert('Укажите, к скольки придёте.')
      return
    }
    if (isPastForToday(day, time)) {
      showAlert('Это время уже прошло — выберите время позже текущего.')
      return
    }
    haptic.impact('medium')
    markOwnTap()
    const done = await action(
      'edit',
      {
        id: r.id,
        dateKey: day,
        time,
        purpose,
        anon,
        remind: reminderFor(day, time, remind),
      },
      { quiet: true },
    )
    if (done) {
      haptic.notify('success')
      pop()
    }
  }

  return (
    <Screen hasBottomBar>
      <BackRow />
      <Header title="Изменить заявку" />
      <SectionTitle>День</SectionTitle>
      <DayChips
        days={days}
        selected={day}
        onSelect={(k) => {
          if (k !== day) haptic.tick()
          markOwnTap()
          selectDay(k)
        }}
      />
      <Crossfade id={day}>
        <SelectedDayInfo days={days} selected={day} />
      </Crossfade>
      <SectionTitle>Детали</SectionTitle>
      <div className="nt-host" ref={remindUi.hostRef}>
        <div className="card">
          <TimeRow label="Приду к" value={time} min={min} onChange={onTimeChange} />
          <Sep inset="text" />
          {remindUi.row}
          <Sep inset="text" />
          <SwitchRow on={anon} onToggle={() => setAnon(!anon)} label="Не показывать другим гостям" />
          <Sep inset="text" />
          <div className="kv-block">
            <PurposeInput value={purpose} onChange={setPurpose} />
          </div>
        </div>
        {remindUi.items}
      </div>
      <BottomBar>
        <ActionButton className="primary-btn" onClick={submit} submit>
          Сохранить
        </ActionButton>
      </BottomBar>
    </Screen>
  )
}
