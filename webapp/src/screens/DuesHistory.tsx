// История взносов: собираемость за всё время, периоды и выгрузка таблицы.
// Тап по периоду открывает список того месяца тем же экраном, что и текущий.

import { Fragment, useEffect, useState } from 'react'
import { api } from '../api'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { push, setBusy } from '../store'
import { haptic } from '../telegram'
import { ApiError, type DuesHistory as DuesHistoryData } from '../types'
import { BackRow, BottomBar, EmptyState, Footnote, Header, SectionTitle, Sep, SpinnerCenter } from '../components/common'
import { Screen } from '../components/Screen'
import { money } from './Dues'

export function DuesHistory() {
  const [data, setData] = useState<DuesHistoryData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const history = await api<DuesHistoryData>('dues.history')
        if (alive) setData(history)
      } catch {
        if (alive) setData(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const exportCsv = async () => {
    setBusy(true)
    try {
      await api('dues.export')
      haptic('success')
      showAlert('Отправил таблицу в личку от бота.')
    } catch (err) {
      showAlert((err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Screen>
        <BackRow label="Взносы" />
        <SpinnerCenter />
      </Screen>
    )
  }
  if (!data || data.periods.length === 0) {
    return (
      <Screen>
        <BackRow label="Взносы" />
        <Header title="История" />
        <div className="card">
          <EmptyState title="Сборов ещё не было" text="Первый период откроется в день сбора." />
        </div>
      </Screen>
    )
  }

  const closed = data.periods.reduce((sum, p) => sum + (p.total - p.paid), 0)
  return (
    <Screen hasBottomBar>
      <BackRow label="Взносы" />
      <Header
        title="История"
        subtitle={`${data.periods.length} ${data.periods.length === 1 ? 'период' : 'периодов'} · собрано ${money(data.collected, data.currency)}`}
      />

      <div className="card dues-summary">
        <div className="dues-figure">
          <span className="df-main">{`${data.rate}%`}</span>
          <span className="df-of">собираемость</span>
        </div>
        <div className="dues-bar">
          <i style={{ width: `${data.rate}%` }} />
        </div>
        <div className="dues-note">
          {closed > 0
            ? `За всё время не внесено ${closed} ${closed === 1 ? 'взнос' : 'взносов'} на ${money(data.expected - data.collected, data.currency)}`
            : 'Все взносы за всё время закрыты'}
        </div>
      </div>

      <SectionTitle>Периоды</SectionTitle>
      <div className="card">
        {data.periods.map((p, i) => {
          const pct = p.total > 0 ? Math.round((p.paid / p.total) * 100) : 0
          return (
            <Fragment key={p.periodKey}>
              {i > 0 ? <Sep left={14} /> : null}
              <div className="row tappable" onClick={() => push('dues', { periodKey: p.periodKey })}>
                <span className="row-label">
                  {p.label}
                  <span className="row-sublabel">{`${i === 0 ? 'текущий · ' : ''}${p.paid} из ${p.total}`}</span>
                </span>
                <div className="row-right">
                  <div className="period-bar">
                    <i className={pct < 100 ? 'low' : undefined} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="dues-amount">{money(p.collected, data.currency)}</span>
                  {icons.chevron()}
                </div>
              </div>
            </Fragment>
          )
        })}
      </div>

      <Footnote>В таблице строка на человека, столбец на месяц, суммы и итоги. Файл придёт в личку от бота.</Footnote>
      <BottomBar>
        <button className="primary-btn" onClick={() => void exportCsv()}>
          {icons.doc(18, '#fff')}
          Выгрузить таблицу
        </button>
      </BottomBar>
    </Screen>
  )
}
