import { tr } from '../i18n'
import { useEffect, useState } from 'react'
import { action } from '../api'
import { showAlert } from '../modals'
import { pop, useParams, useStore } from '../store'
import { haptic } from '../telegram'
import { BackRow, BottomBar, Header, SectionTitle, Sep } from '../components/common'
import { DayChips } from '../components/forms'
import { Screen } from '../components/Screen'
import { TimeField } from '../components/TimeField'

// Дев-правка чужой заявки: день/время/цель.
export function DevEdit() {
  const params = useParams()
  const { data } = useStore()
  const days = data!.days
  const r = days.flatMap((d) => d.requests || []).find((x) => x.id === params.id)

  const [selected, setSelected] = useState(r ? r.dateKey : days[0]!.dateKey)
  const [time, setTime] = useState(r ? r.time : '')
  const [purpose, setPurpose] = useState(r ? r.purpose || '' : '')

  useEffect(() => {
    if (!r) pop()
  }, [r])
  if (!r) return <Screen />

  const submit = async (): Promise<void> => {
    if (!time) {
      showAlert(tr('Укажите время.', 'Choose a time.'))
      return
    }
    const res = await action('dev.update', { id: r.id, dateKey: selected, time, purpose })
    if (res) {
      haptic.notify('success')
      pop()
    }
  }

  return (
    <Screen hasBottomBar>
      <BackRow label="Dev" />
      <Header title={r.guest.name} subtitle={tr('Правка заявки', 'Edit request')} />
      <SectionTitle>{tr('День', 'Day')}</SectionTitle>
      <DayChips days={days} selected={selected} onSelect={setSelected} showCounts={false} />
      <SectionTitle>{tr('Детали', 'Details')}</SectionTitle>
      <div className="card">
        <div className="row time-row">
          <span style={{ fontSize: 16 }}>{tr('Придёт к', 'Arrival time')}</span>
          <TimeField value={time} onChange={setTime} />
        </div>
        <Sep inset="text" />
        <div className="kv-block">
          <textarea
            className="purpose-input"
            rows={2}
            maxLength={300}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </div>
      </div>
      <BottomBar>
        <button className="primary-btn" onClick={submit}>
          {tr('Сохранить', 'Save')}
        </button>
      </BottomBar>
    </Screen>
  )
}
