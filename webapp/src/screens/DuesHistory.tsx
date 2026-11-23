// История взносов: собираемость за всё время, периоды и выгрузка таблицы.
// Тап по периоду открывает список того месяца тем же экраном, что и текущий.

import { tr } from '../i18n'
import { Fragment, type ReactNode } from 'react'
import { api } from '../api'
import { duesWord, periodsWord } from '../dates'
import { money, nb } from '../format'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { useRemote } from '../remote'
import { push, setBusy } from '../store'
import { haptic } from '../telegram'
import { ApiError, type DuesHistory as DuesHistoryData } from '../types'
import { BackRow, BottomBar, EmptyState, ErrorState, Footnote, Header, SectionTitle, Sep } from '../components/common'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkBlock, SkRows } from '../components/skeleton'

/** Каркас истории: собираемость крупной цифрой и полосой, дальше периоды списком. */
function HistorySkeleton() {
  return (
    <div aria-busy="true" aria-label={tr('Загружаем историю взносов', 'Loading dues history')}>
      <div className="card dues-summary">
        <div className="dues-figure">
          <SkBlock w={68} h={32} />
          <SkBlock w={112} h={15} />
        </div>
        <SkBlock h={8} style={{ display: 'block', marginTop: 14 }} />
        <SkBlock w="72%" h={14} style={{ display: 'block', marginTop: 11 }} />
      </div>
      <SectionTitle>{tr('Периоды', 'Periods')}</SectionTitle>
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
      haptic.notify('success')
      showAlert(tr('Отправил таблицу в личку от бота.', 'The bot sent the spreadsheet to your private chat.'))
    } catch (err) {
      showAlert((err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  // Шапка на месте во всех состояниях, подменяется только тело: каркас гаснет поверх
  // проявляющейся истории, а не исчезает в том же кадре.
  const frame = (subtitle: ReactNode, body: ReactNode, hasBottomBar = false) => (
    <Screen hasBottomBar={hasBottomBar}>
      <BackRow label={tr('Взносы', 'Dues')} />
      <Header title={tr('История', 'History')} subtitle={subtitle} />
      <Swap loading={loading && !data} skeleton={pending ? <HistorySkeleton /> : null}>
        {body}
      </Swap>
    </Screen>
  )

  // Подпись считается по периодам, поэтому на время загрузки под ней полоса, а не текст.
  if (loading && !data) return frame(<SkBlock w={196} h={14} />, null)
  // Упавший запрос — не «сборов ещё не было»: пустая история это утверждение о спейсе.
  if (error) return frame(undefined, <ErrorState onRetry={reload} />)
  if (!data || data.periods.length === 0) {
    return frame(
      undefined,
      <div className="card">
        <EmptyState title={tr('Сборов ещё не было', 'No dues periods yet')} text={tr('Первый период откроется в день сбора.', 'The first period opens on the collection day.')} />
      </div>,
    )
  }

  const closed = data.periods.reduce((sum, p) => sum + (p.total - p.paid), 0)
  return frame(
    tr(`${periodsWord(data.periods.length)} · собрано ${money(data.collected, data.currency)}`, `${periodsWord(data.periods.length)} · ${money(data.collected, data.currency)} collected`),
    <>
      <div className="card dues-summary">
        <div className="dues-figure">
          <span className="df-main">{`${data.rate}%`}</span>
          <span className="df-of">{tr('собираемость', 'collection rate')}</span>
        </div>
        <div className="dues-bar">
          <i style={{ width: `${data.rate}%` }} />
        </div>
        <div className="dues-note">
          {closed > 0
            ? nb(tr(`За всё время не внесено ${duesWord(closed)} на ${money(data.expected - data.collected, data.currency)}`, `${duesWord(closed)} outstanding, totaling ${money(data.expected - data.collected, data.currency)}`))
            : tr('Все взносы за всё время закрыты', 'All dues payments are up to date')}
        </div>
      </div>

      <SectionTitle>{tr('Периоды', 'Periods')}</SectionTitle>
      <div className="card">
        {data.periods.map((p, i) => {
          const pct = p.total > 0 ? Math.round((p.paid / p.total) * 100) : 0
          return (
            <Fragment key={p.periodKey}>
              {i > 0 ? <Sep inset="text" /> : null}
              <button type="button" className="row tappable" onClick={() => push('dues', { periodKey: p.periodKey })}>
                <span className="row-label">
                  {p.label}
                  <span className="row-sublabel">{nb((i === 0 ? tr('текущий · ', 'current · ') : '') + tr(`${p.paid} из ${p.total}`, `${p.paid} of ${p.total}`))}</span>
                </span>
                <div className="row-right">
                  <div className="period-bar">
                    {/* Недобор красит только закрытые периоды: в текущем сбор ещё идёт,
                        и оранжевый там означал бы «тревога» на ровном месте. */}
                    <i className={i > 0 && pct < 100 ? 'low' : undefined} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="dues-amount period-sum">{money(p.collected, data.currency)}</span>
                  {icons.chevron()}
                </div>
              </button>
            </Fragment>
          )
        })}
      </div>

      <Footnote>{tr('В таблице строка на человека, столбец на месяц, суммы и итоги. Файл придёт в личку от бота.', 'The spreadsheet has one row per person and one column per month, with amounts and totals. The bot will send the file in a private message.')}</Footnote>
      {/* Панель уезжает порталом наружу экрана — слой подмены её не задевает. */}
      <BottomBar>
        <button className="primary-btn" onClick={() => void exportCsv()}>
          {icons.doc(18, '#fff')}
          {tr('Выгрузить таблицу', 'Export spreadsheet')}
        </button>
      </BottomBar>
    </>,
    true,
  )
}
