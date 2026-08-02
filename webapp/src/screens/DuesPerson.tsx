// Карточка резидента по взносам: просрочка, ставка и вся история по месяцам.
// Читают все резиденты, меняют ставку и закрывают месяцы только dev.

import { Fragment, useEffect, useState } from 'react'
import { action, api } from '../api'
import { fmtIsoDay } from '../dates'
import { icons } from '../icons'
import { numberPrompt } from '../modals'
import { useParams } from '../store'
import { haptic } from '../telegram'
import type { DuesPerson as DuesPersonData, DuesRateKind } from '../types'
import { BackRow, Footnote, Header, SectionTitle, Sep, SpinnerCenter } from '../components/common'
import { userLabel } from '../components/people'
import { Screen } from '../components/Screen'
import { debtWord, money } from './Dues'

const RATE_ROWS: { kind: DuesRateKind; label: string }[] = [
  { kind: 'common', label: 'Общая' },
  { kind: 'student', label: 'Студенческая' },
  { kind: 'custom', label: 'Своя' },
]

export function DuesPerson() {
  const { userId } = useParams()
  const [data, setData] = useState<DuesPersonData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const person = await api<DuesPersonData>('dues.person', { userId })
        if (alive) setData(person)
      } catch {
        if (alive) setData(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [userId, tick])

  if (loading) {
    return (
      <Screen>
        <BackRow label="Взносы" />
        <SpinnerCenter />
      </Screen>
    )
  }
  if (!data) {
    return (
      <Screen>
        <BackRow label="Взносы" />
        <Header title="Не нашёл" subtitle="Человека нет ни в одном периоде взносов." />
      </Screen>
    )
  }

  const reload = () => setTick((n) => n + 1)
  const current = data.months[0]

  const setRate = async (kind: DuesRateKind) => {
    if (kind === data.rate.kind && kind !== 'custom') return
    let amount: number | undefined
    if (kind === 'custom') {
      // null — отмена, и ставку не трогаем вовсе. Ноль это осмысленное значение
      // («не платит»), поэтому отличать его от отмены обязательно.
      const picked = await numberPrompt({
        text: 'Своя ставка',
        initial: data.rate.amount,
        hint: `Сумма по договорённости, в ${data.currency}. Ноль — освободить от взноса.`,
        confirmLabel: 'Поставить',
      })
      if (picked === null) return
      amount = picked
    }
    const done = await action('dues.rate', { userId: data.user.userId, kind, ...(amount === undefined ? {} : { amount }) })
    if (done) {
      haptic('success')
      reload()
    }
  }

  const toggleMonth = async (periodKey: string, paid: boolean) => {
    const done = await action(paid ? 'dues.clear' : 'dues.confirm', { periodKey, userId: data.user.userId })
    if (done) {
      haptic('success')
      reload()
    }
  }

  return (
    <Screen>
      <BackRow label="Взносы" />
      <Header title={data.user.name} subtitle={data.user.username ? `@${data.user.username}` : 'без ника'} />

      {data.missed > 0 && data.rate.amount > 0 ? (
        <div className="status-card" style={{ background: data.missed >= 2 ? 'rgba(255,59,48,0.1)' : 'rgba(255,149,0,0.1)' }}>
          <div className="status-card-head">
            <div className="status-card-icon" style={{ background: data.missed >= 2 ? 'var(--red)' : 'var(--orange)' }}>
              {data.missed >= 2 ? icons.stopSign(15, '#fff') : icons.warnTriangle(15, '#fff')}
            </div>
            <div className="status-card-title" style={{ color: data.missed >= 2 ? 'var(--red)' : 'var(--orange)' }}>
              {`${debtWord(data.missed)} без взноса`}
            </div>
          </div>
          <div className="status-card-note">
            {data.missed >= 2
              ? 'Два месяца это крайний срок неуплаты, дальше вопрос разбирается лично.'
              : 'Прошлый месяц так и не закрыт.'}
          </div>
        </div>
      ) : null}

      {current ? (
        <>
          <SectionTitle>{current.label}</SectionTitle>
          <div className="card">
            <div className="row kv-block">
              <span className="kv-key">Ставка</span>
              <span className="kv-val">{money(current.amount, data.currency)}</span>
            </div>
            <Sep left={14} />
            <div className="row kv-block">
              <span className="kv-key">Статус</span>
              <span
                className="kv-val"
                style={{ color: current.status === 'paid' ? 'var(--green)' : current.status === 'claimed' ? 'var(--text-2)' : 'var(--orange)' }}
              >
                {current.status === 'paid' ? 'Внесён' : current.status === 'claimed' ? 'Ждёт сверки' : 'Не внесён'}
              </span>
            </div>
            {data.debt > 0 ? (
              <>
                <Sep left={14} />
                <div className="row kv-block">
                  <span className="kv-key">Долг с учётом прошлых</span>
                  <span className="kv-val">{money(data.debt, data.currency)}</span>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {data.canEdit ? (
        <>
          <SectionTitle>Ставка</SectionTitle>
          <div className="card">
            {RATE_ROWS.map((r, i) => (
              <Fragment key={r.kind}>
                {i > 0 ? <Sep left={14} /> : null}
                <div className="row tappable" onClick={() => void setRate(r.kind)}>
                  <span className="row-label">
                    {r.label}
                    <span className="row-sublabel">
                      {r.kind === 'common'
                        ? `${money(data.amount, data.currency)}, как у всех`
                        : r.kind === 'student'
                          ? `${money(data.studentAmount, data.currency)}, следует за настройкой спейса`
                          : data.rate.kind === 'custom'
                            ? `${money(data.rate.amount, data.currency)} по договорённости`
                            : 'Сумма по договорённости'}
                    </span>
                  </span>
                  <div className="radio-check">{data.rate.kind === r.kind ? icons.check(16, '#007aff', 2.2) : null}</div>
                </div>
              </Fragment>
            ))}
          </div>
          <Footnote>«Своя» это фиксированное число: общая и студенческая ставки на неё больше не влияют.</Footnote>
        </>
      ) : null}

      <SectionTitle>История</SectionTitle>
      <div className="card">
        {data.months.map((m, i) => (
          <Fragment key={m.periodKey}>
            {i > 0 ? <Sep left={14} /> : null}
            <div
              className={'row' + (data.canEdit ? ' tappable' : '')}
              onClick={data.canEdit ? () => void toggleMonth(m.periodKey, m.status === 'paid') : undefined}
            >
              <span className="row-label">
                {m.label}
                {m.at ? (
                  <span className="row-sublabel">
                    {`${fmtIsoDay(m.at)}${m.by ? ` · подтвердил ${userLabel(m.by)}` : ''}`}
                  </span>
                ) : null}
              </span>
              <div className="row-right">
                {m.status === 'paid' ? (
                  <span className="dues-amount paid">{money(m.amount, data.currency)}</span>
                ) : m.status === 'claimed' ? (
                  <span className="dues-amount muted">ждёт сверки</span>
                ) : (
                  <span className="debt-badge warn">
                    {icons.warnTriangle(12, '#ff9500')}
                    не внесён
                  </span>
                )}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
      {data.canEdit ? <Footnote>Тап по месяцу закрывает его задним числом: деньги нередко доносят позже.</Footnote> : null}
    </Screen>
  )
}
