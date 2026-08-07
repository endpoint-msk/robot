// История взносов: собираемость за всё время, периоды и выгрузка таблицы.
// Тап по периоду открывает список того месяца тем же экраном, что и текущий.

import { Fragment } from 'react'
import { api } from '../api'
import { duesWord, periodsWord } from '../dates'
import { money } from '../format'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { useRemote } from '../remote'
import { push, setBusy } from '../store'
import { haptic } from '../telegram'
import { ApiError, type DuesHistory as DuesHistoryData } from '../types'
import { BackRow, BottomBar, EmptyState, ErrorState, Footnote, Header, SectionTitle, Sep } from '../components/common'
import { Screen } from '../components/Screen'
import { SkBlock, SkRows } from '../components/skeleton'

/** Каркас истории: собираемость крупной цифрой и полосой, дальше периоды списком. */
function HistorySkeleton() {
  return (
    <div aria-busy="true" aria-label="Загружаем историю взносов">
      <div className="card dues-summary">
        <div className="dues-figure">
          <SkBlock w={68} h={32} />
          <SkBlock w={112} h={15} />
        </div>
        <SkBlock h={8} style={{ display: 'block', marginTop: 14 }} />
        <SkBlock w="72%" h={14} style={{ display: 'block', marginTop: 11 }} />
      </div>
      <SectionTitle>Периоды</SectionTitle>
      <SkRows count={6} tail />
    </div>
  )
}

export function DuesHistory() {
  const { data, error, loading, pending, reload } = useRemote(() => api<DuesHistoryData>('dues.history'), [])

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

  if (loading && !data) {
    return (
      <Screen>
        <BackRow label="Взносы" />
        {/* Подпись считается по периодам, поэтому под ней полоса, а не текст. */}
        <Header title="История" subtitle={<SkBlock w={196} h={14} />} />
        {pending ? <HistorySkeleton /> : null}
      </Screen>
    )
  }
  // Упавший запрос — не «сборов ещё не было»: пустая история это утверждение о спейсе.
  if (error) {
    return (
      <Screen>
        <BackRow label="Взносы" />
        <Header title="История" />
        <ErrorState onRetry={reload} />
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
        subtitle={`${periodsWord(data.periods.length)} · собрано ${money(data.collected, data.currency)}`}
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
            ? `За всё время не внесено ${duesWord(closed)} на ${money(data.expected - data.collected, data.currency)}`
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
              <button type="button" className="row tappable" onClick={() => push('dues', { periodKey: p.periodKey })}>
                <span className="row-label">
                  {p.label}
                  <span className="row-sublabel">{`${i === 0 ? 'текущий · ' : ''}${p.paid} из ${p.total}`}</span>
                </span>
                <div className="row-right">
                  <div className="period-bar">
                    {/* Недобор красит только закрытые периоды: в текущем сбор ещё идёт,
                        и оранжевый там означал бы «тревога» на ровном месте. */}
                    <i className={i > 0 && pct < 100 ? 'low' : undefined} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="dues-amount">{money(p.collected, data.currency)}</span>
                  {icons.chevron()}
                </div>
              </button>
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
