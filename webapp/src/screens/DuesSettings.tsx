// Настройки взносов: включение сбора, день, ставки, реквизиты. Только dev.
// В общий чат подсистема не пишет, поэтому настраивать тут нечего кроме денег и дня.

import { tr } from '../i18n'
import { useState } from 'react'
import { action } from '../api'
import { money } from '../format'
import { icons } from '../icons'
import { numberPrompt } from '../modals'
import { useStore } from '../store'
import { BackRow, Footnote, Header, SectionTitle, Sep, SwitchRow } from '../components/common'
import { Screen } from '../components/Screen'

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
        <BackRow label={tr('Взносы', 'Dues')} />
        <Header title={tr('Настройки взносов', 'Dues settings')} subtitle={tr('Сбор выключен.', 'Dues collection is off.')} />
      </Screen>
    )
  }

  const save = async (patch: Record<string, unknown>) => {
    return Boolean(await action('dues.settings', patch))
  }

  const askNumber = async (title: string, current: number, field: string) => {
    const picked = await numberPrompt({
      text: title,
      initial: current,
      hint: tr(`Сумма в ${dues.currency}. Ноль освобождает от взноса.`, `Amount in ${dues.currency}. Enter zero to waive dues.`),
    })
    if (picked === null) return
    await save({ [field]: picked })
  }

  const askDay = async () => {
    const picked = await numberPrompt({
      text: tr('День сбора', 'Collection day'),
      initial: dues.day,
      min: MIN_DAY,
      max: MAX_DAY,
      hint: tr(`Число от ${MIN_DAY} до ${MAX_DAY}: 29, 30 и 31 есть не в каждом месяце.`, `Enter a number from ${MIN_DAY} to ${MAX_DAY}. Some months have fewer than 29 days.`),
    })
    if (picked === null) return
    await save({ day: picked })
  }

  return (
    <Screen>
      <BackRow label={tr('Взносы', 'Dues')} />
      <Header title={tr('Настройки взносов', 'Dues settings')} />

      <div className="card ctl-card">
        <SwitchRow
          icon={
            <div className="row-icon" style={{ background: 'var(--green)' }}>
              {icons.rub(17, '#fff')}
            </div>
          }
          label={tr('Сбор взносов', 'Dues collection')}
          sub={tr('Периоды открываются сами', 'Periods open automatically')}
          on={dues.enabled}
          onToggle={() => void save({ enabled: !dues.enabled })}
        />
        <Sep inset="icon" />
        <button type="button" className="row tappable" onClick={() => void askDay()}>
          <span className="row-label">{tr('День сбора', 'Collection day')}</span>
          <div className="row-right">
            <span className="dues-amount">{tr(`${dues.day}-го числа`, `Day ${dues.day} of the month`)}</span>
            {icons.chevron()}
          </div>
        </button>
      </div>

      <SectionTitle>{tr('Ставки', 'Rates')}</SectionTitle>
      <div className="card">
        <button type="button" className="row tappable" onClick={() => void askNumber(tr('Ставка для всех', 'Standard rate'), dues.amount, 'amount')}>
          <span className="row-label">{tr('Всем', 'Standard')}</span>
          <div className="row-right">
            <span className="dues-amount">{money(dues.amount, dues.currency)}</span>
            {icons.chevron()}
          </div>
        </button>
        <Sep inset="text" />
        <button
          type="button"
          className="row tappable"
          onClick={() => void askNumber(tr('Ставка для студентов', 'Student rate'), dues.studentAmount, 'studentAmount')}
        >
          <span className="row-label">{tr('Студентам', 'Student')}</span>
          <div className="row-right">
            <span className="dues-amount">{money(dues.studentAmount, dues.currency)}</span>
            {icons.chevron()}
          </div>
        </button>
      </div>
      <Footnote>
        {tr('Новая ставка действует на текущий и будущие месяцы. Уже подтверждённые суммы не пересчитываются. Своя ставка по договорённости ставится на карточке человека.', "New rates apply to the current month and future months. Confirmed payments keep their original amounts. Set custom rates in each resident's profile.")}
      </Footnote>

      <SectionTitle>{tr('Реквизиты', 'Payment details')}</SectionTitle>
      <div className="card">
        <div className="row">
          <textarea
            className="text-input"
            rows={3}
            placeholder={tr('Куда переводить: банк, номер, получатель', 'Payment details: bank, account number, and recipient')}
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
              {tr('Сохранить', 'Save')}
            </button>
            <button
              className="small-btn gray"
              onClick={() => {
                setRequisites(dues.requisites)
                setDirty(false)
              }}
            >
              {tr('Отмена', 'Cancel')}
            </button>
          </div>
        ) : null}
      </div>
      <Footnote>
        {tr('Уходят в личку каждому вместе с суммой и стоят в плашке «Мой взнос». Пусто, значит строки про реквизиты нигде нет.', "These details appear with the amount in each resident's private message and under “My dues”. Leave this blank to hide payment details.")}
      </Footnote>

      <SectionTitle>{tr('Уведомления', 'Notifications')}</SectionTitle>
      <div className="card">
        <SwitchRow
          icon={
            <div className="row-icon" style={{ background: 'var(--blue)' }}>
              {icons.bell()}
            </div>
          }
          label={tr('Напоминать о сборе', 'Remind me about dues')}
          sub={tr('В личку, с кнопкой «Я внёс»', "Private message with an “I've paid” button")}
          on={dues.notify}
          onToggle={() => action('dues.notify', { enabled: !dues.notify }, { quiet: true })}
        />
      </div>
      <Footnote>{tr('Тумблер личный: у каждого резидента свой, по умолчанию включён.', "Each resident can change this setting. It's on by default.")}</Footnote>
    </Screen>
  )
}
