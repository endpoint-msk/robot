// Настройки взносов: включение сбора, день, ставки, реквизиты. Только dev.
// В общий чат подсистема не пишет, поэтому настраивать тут нечего кроме денег и дня.

import { useState } from 'react'
import { action } from '../api'
import { icons } from '../icons'
import { numberPrompt } from '../modals'
import { useStore } from '../store'
import { haptic } from '../telegram'
import { BackRow, Footnote, Header, SectionTitle, Sep, Switch } from '../components/common'
import { Screen } from '../components/Screen'
import { money } from './Dues'

const MIN_DAY = 1
const MAX_DAY = 28

export function DuesSettings() {
  const { data } = useStore()
  const dues = data!.dues ?? null
  const [requisites, setRequisites] = useState(dues?.requisites ?? '')
  const [dirty, setDirty] = useState(false)

  if (!dues) {
    return (
      <Screen>
        <BackRow label="Взносы" />
        <Header title="Настройки взносов" subtitle="Сбор выключен." />
      </Screen>
    )
  }

  const save = async (patch: Record<string, unknown>) => {
    const done = await action('dues.settings', patch)
    if (done) haptic('success')
    return Boolean(done)
  }

  const askNumber = async (title: string, current: number, field: string) => {
    const picked = await numberPrompt({
      text: title,
      initial: current,
      hint: `Сумма в ${dues.currency}. Ноль освобождает от взноса.`,
    })
    if (picked === null) return
    await save({ [field]: picked })
  }

  const askDay = async () => {
    const picked = await numberPrompt({
      text: 'День сбора',
      initial: dues.day,
      min: MIN_DAY,
      max: MAX_DAY,
      hint: `Число от ${MIN_DAY} до ${MAX_DAY}: 29, 30 и 31 есть не в каждом месяце.`,
    })
    if (picked === null) return
    await save({ day: picked })
  }

  return (
    <Screen>
      <BackRow label="Взносы" />
      <Header title="Настройки взносов" />

      <div className="card">
        <div className="row">
          <div className="row-icon" style={{ background: '#30d158' }}>
            {icons.rub(17, '#fff')}
          </div>
          <span className="row-label">
            Сбор взносов
            <span className="row-sublabel">Периоды открываются сами</span>
          </span>
          <Switch on={dues.enabled} onToggle={() => void save({ enabled: !dues.enabled })} />
        </div>
        <Sep left={54} />
        <div className="row tappable" onClick={() => void askDay()}>
          <span className="row-label">День сбора</span>
          <div className="row-right">
            <span className="dues-amount">{`${dues.day}-го числа`}</span>
            {icons.chevron()}
          </div>
        </div>
      </div>

      <SectionTitle>Ставки</SectionTitle>
      <div className="card">
        <div className="row tappable" onClick={() => void askNumber('Ставка для всех', dues.amount, 'amount')}>
          <span className="row-label">Всем</span>
          <div className="row-right">
            <span className="dues-amount">{money(dues.amount, dues.currency)}</span>
            {icons.chevron()}
          </div>
        </div>
        <Sep left={14} />
        <div className="row tappable" onClick={() => void askNumber('Ставка для студентов', dues.studentAmount, 'studentAmount')}>
          <span className="row-label">Студентам</span>
          <div className="row-right">
            <span className="dues-amount">{money(dues.studentAmount, dues.currency)}</span>
            {icons.chevron()}
          </div>
        </div>
      </div>
      <Footnote>
        Новая ставка действует на текущий и будущие месяцы. Уже подтверждённые суммы не пересчитываются. Своя ставка по
        договорённости ставится на карточке человека.
      </Footnote>

      <SectionTitle>Реквизиты</SectionTitle>
      <div className="card">
        <div className="row">
          <textarea
            className="text-input"
            rows={3}
            placeholder="Куда переводить: банк, номер, получатель"
            value={requisites}
            onChange={(e) => {
              setRequisites(e.target.value)
              setDirty(true)
            }}
          />
        </div>
        {dirty ? (
          <div className="inline-form-actions">
            <button
              className="small-btn blue"
              onClick={async () => {
                if (await save({ requisites })) setDirty(false)
              }}
            >
              Сохранить
            </button>
            <button
              className="small-btn gray"
              onClick={() => {
                setRequisites(dues.requisites)
                setDirty(false)
              }}
            >
              Отмена
            </button>
          </div>
        ) : null}
      </div>
      <Footnote>
        Уходят в личку каждому вместе с суммой и стоят в плашке «Мой взнос». Пусто, значит строки про реквизиты нигде нет.
      </Footnote>

      <SectionTitle>Уведомления</SectionTitle>
      <div className="card">
        <div className="row">
          <div className="row-icon" style={{ background: '#007aff' }}>
            {icons.bell()}
          </div>
          <span className="row-label">
            Напоминать о сборе
            <span className="row-sublabel">В личку, с кнопкой «Я внёс»</span>
          </span>
          <Switch on={dues.notify} onToggle={() => void action('dues.notify', { enabled: !dues.notify })} />
        </div>
      </div>
      <Footnote>Тумблер личный: у каждого резидента свой, по умолчанию включён.</Footnote>
    </Screen>
  )
}
