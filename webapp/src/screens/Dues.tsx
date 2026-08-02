// Взносы за период: свой взнос сверху, дальше состав тремя секциями. Экран один и
// тот же для текущего сбора (данные из bootstrap) и для прошлого, открытого из
// истории (грузится ручкой dues.period) — форма ответа у них общая.

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { action, api } from '../api'
import { fmtIsoDay } from '../dates'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { push, useParams, useStore } from '../store'
import { haptic } from '../telegram'
import type { DuesRow, DuesSnapshot } from '../types'
import { BackRow, EmptyState, Footnote, Header, SectionTitle, Sep, SpinnerCenter } from '../components/common'
import { Avatar, userLabel } from '../components/people'
import { Screen } from '../components/Screen'
import { SwipeRow, type SwipeAction } from '../components/SwipeRow'

/** `2222 ₽` с тонким пробелом в тысячах: в столбце сумм неразделённые тысячи не читаются. */
export const money = (n: number, currency: string): string =>
  `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${currency}`

/** «месяц» / «2 месяца»: подпись к просрочке. */
export const debtWord = (missed: number): string =>
  missed >= 2 ? `${missed} ${missed >= 5 ? 'месяцев' : 'месяца'}` : 'месяц'

export function DebtBadge({ missed }: { missed: number }) {
  if (missed <= 0) return null
  const crit = missed >= 2
  return (
    <span className={'debt-badge ' + (crit ? 'crit' : 'warn')}>
      {crit ? icons.stopSign(12, '#ff3b30') : icons.warnTriangle(12, '#ff9500')}
      {debtWord(missed)}
    </span>
  )
}

const RATE_LABEL: Record<string, string> = { student: 'СТУДЕНТ', custom: 'СВОЯ' }

function DuesPersonRow({ row, snap, onChanged }: { row: DuesRow; snap: DuesSnapshot; onChanged: () => void }) {
  const left =
    row.status === 'paid' ? (
      <div className="dues-mark ok">{icons.check(13, '#fff', 2.2)}</div>
    ) : row.status === 'claimed' ? (
      <div className="dues-mark wait">{icons.clock(12, '#ff9500')}</div>
    ) : (
      <Avatar user={row} className="req-avatar" />
    )

  const sub =
    row.status === 'paid' && row.at
      ? `${fmtIsoDay(row.at)}${row.by ? ` · подтвердил ${userLabel(row.by)}` : ''}`
      : row.status === 'claimed' && row.at
        ? `заявил ${fmtIsoDay(row.at)}`
        : row.missed >= 2
          ? 'Крайний срок неуплаты'
          : ''

  const body = (
    <div className="row" onClick={() => push('duesPerson', { userId: row.userId })}>
      {left}
      <div className="dues-main">
        <div className="dues-name-line">
          <span className="dues-name">{userLabel(row)}</span>
          <DebtBadge missed={row.missed} />
          {row.rate !== 'common' ? <span className="rate-chip">{RATE_LABEL[row.rate]}</span> : null}
        </div>
        {sub ? (
          <div className={'dues-sub-line' + (row.status === 'none' && row.missed >= 2 ? ' crit' : '')}>{sub}</div>
        ) : null}
      </div>
      <div className="row-right">
        <span className={'dues-amount' + (row.status === 'paid' ? ' paid' : '')}>{money(row.amount, snap.currency)}</span>
        {icons.chevron()}
      </div>
    </div>
  )

  if (!snap.canEdit) return body

  const run = async (method: string, params: Record<string, unknown>) => {
    const done = await action(method, { periodKey: snap.periodKey, ...params })
    if (done) {
      haptic('success')
      onChanged()
    }
  }
  const actions: SwipeAction[] = [
    { key: 'rate', label: 'Ставка', icon: icons.tag(19, '#fff'), tone: 'neutral', onSelect: () => push('duesPerson', { userId: row.userId }) },
    row.status === 'paid'
      ? { key: 'undo', label: 'Снять отметку', icon: icons.undo(19, '#fff'), tone: 'red', onSelect: () => run('dues.clear', { userId: row.userId }) }
      : { key: 'ok', label: 'Отметить взнос', icon: icons.check(18, '#fff', 2), onSelect: () => run('dues.confirm', { userId: row.userId }) },
  ]
  return <SwipeRow actions={actions}>{body}</SwipeRow>
}

function DuesList({ rows, snap, onChanged }: { rows: DuesRow[]; snap: DuesSnapshot; onChanged: () => void }) {
  return (
    <div className="card">
      {rows.map((row, i) => (
        <Fragment key={row.userId}>
          {i > 0 ? <Sep left={row.status === 'none' ? 64 : 46} /> : null}
          <DuesPersonRow row={row} snap={snap} onChanged={onChanged} />
        </Fragment>
      ))}
    </div>
  )
}

/** Ответ dev на чужую заявку. Инлайн, не за свайпом: это решение по чужому действию. */
function Verdict({ row, snap, onChanged }: { row: DuesRow; snap: DuesSnapshot; onChanged: () => void }) {
  if (!snap.canEdit) return null
  const run = async (method: string) => {
    const done = await action(method, { periodKey: snap.periodKey, userId: row.userId })
    if (done) {
      haptic('success')
      onChanged()
    }
  }
  return (
    <div className="dues-verdict">
      <button className="small-btn" style={{ background: 'var(--green)', color: '#fff' }} onClick={() => void run('dues.confirm')}>
        Подтвердить
      </button>
      <button className="small-btn gray" onClick={() => void run('dues.clear')}>
        Отклонить
      </button>
    </div>
  )
}

function MyDues({ snap, onChanged }: { snap: DuesSnapshot; onChanged: () => void }) {
  const [copied, setCopied] = useState(false)
  if (!snap.me.inRoster) return null

  const claim = async () => {
    const done = await action('dues.claim')
    if (done) {
      haptic('success')
      onChanged()
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snap.requisites)
      setCopied(true)
      haptic('success')
      setTimeout(() => setCopied(false), 1600)
    } catch {
      showAlert('Не получилось скопировать. Выдели текст вручную.')
    }
  }

  const cls = snap.me.status === 'paid' ? 'paid' : snap.me.status === 'claimed' ? 'claimed' : 'unpaid'
  return (
    <div className={'my-dues ' + cls}>
      <div className="my-dues-kicker">Мой взнос</div>
      <div className="my-dues-sum">{money(snap.me.amount, snap.currency)}</div>
      {snap.me.status === 'paid' ? (
        <div className="my-dues-sub">Внесён{snap.me.at ? ` ${fmtIsoDay(snap.me.at)}` : ''}</div>
      ) : snap.me.status === 'claimed' ? (
        <div className="my-dues-sub">Отмечен{snap.me.at ? ` ${fmtIsoDay(snap.me.at)}` : ''}, ждёт сверки с выпиской</div>
      ) : (
        <>
          {snap.requisites ? (
            <div className="my-dues-req">
              <div className="mdr-text">{snap.requisites}</div>
              <button className="mdr-copy" aria-label="Скопировать реквизиты" onClick={() => void copy()}>
                {copied ? icons.check(17, '#34c759', 2.2) : icons.copy(17, '#007aff')}
              </button>
            </div>
          ) : null}
          <div className="my-dues-sub">Отметь, когда переведёшь: dev сверит с выпиской и подтвердит.</div>
          <button className="primary-btn" onClick={() => void claim()}>
            {icons.check(18, '#fff', 2)}
            Я внёс
          </button>
        </>
      )}
    </div>
  )
}

function Summary({ snap }: { snap: DuesSnapshot }) {
  const { total, paid, claimed, collected, expected } = snap.summary
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  const left = expected - collected
  return (
    <div className="card dues-summary">
      <div className="dues-figure">
        <span className="df-main">{paid}</span>
        <span className="df-of">{`из ${total} подтверждено`}</span>
        <span className="df-sum">{money(collected, snap.currency)}</span>
      </div>
      <div className="dues-bar">
        <i style={{ width: `${pct(paid)}%` }} />
        {claimed > 0 ? <i className="claimed" style={{ width: `${pct(claimed)}%` }} /> : null}
      </div>
      <div className="dues-note">
        {claimed > 0
          ? `Ещё ${claimed} ${claimed === 1 ? 'заявил' : 'заявили'} о переводе, ждут сверки`
          : left > 0
            ? `Осталось собрать ${money(left, snap.currency)}`
            : 'Собрано полностью'}
      </div>
    </div>
  )
}

export function DuesScreen() {
  const { data } = useStore()
  const params = useParams()
  const periodKey: string | undefined = params.periodKey
  // Прошлый период приезжает отдельной ручкой: в bootstrap лежит только текущий.
  const [past, setPast] = useState<DuesSnapshot | null>(null)
  const [loading, setLoading] = useState(Boolean(periodKey))
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!periodKey) return
    let alive = true
    void (async () => {
      try {
        const snap = await api<DuesSnapshot>('dues.period', { periodKey })
        if (alive) setPast(snap)
      } catch {
        if (alive) setPast(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [periodKey, tick])

  const snap = periodKey ? past : data!.dues ?? null
  // Мутация возвращает свежий bootstrap; для прошлого периода его мало — перезапрашиваем.
  const onChanged = () => {
    if (periodKey) setTick((n) => n + 1)
  }

  if (loading) {
    return (
      <Screen>
        <BackRow label="Назад" />
        <SpinnerCenter />
      </Screen>
    )
  }
  // Пустое состояние: сбор выключен либо ещё ни разу не открывался. Обычный резидент
  // сюда не попадает (у него в bootstrap просто нет раздела), поэтому ниже вход в
  // настройки — единственный способ включить сбор обратно.
  if (!snap || !snap.periodKey) {
    return (
      <Screen>
        <BackRow label="Обзор" />
        <Header title="Взносы" />
        <div className="card">
          <EmptyState
            title={snap?.enabled ? 'Сбор ещё не открывался' : 'Сбор выключен'}
            text={
              snap?.enabled
                ? `Первый период откроется ${snap.day}-го числа. До этого никто ничего не должен.`
                : 'Пока сбор выключен, периоды не открываются и никто ничего не должен.'
            }
          />
        </div>
        {snap?.canEdit ? (
          <div className="card" style={{ marginTop: 22 }}>
            <div className="row tappable" onClick={() => push('duesSettings')}>
              <div className="row-icon" style={{ background: '#ff9500' }}>
                {icons.gear()}
              </div>
              <span className="row-label">Настройки взносов</span>
              <div className="row-right">{icons.chevron()}</div>
            </div>
          </div>
        ) : null}
      </Screen>
    )
  }

  const unpaid = snap.rows.filter((r) => r.status === 'none')
  const claimed = snap.rows.filter((r) => r.status === 'claimed')
  const paid = snap.rows.filter((r) => r.status === 'paid')
  // У dev очередь на сверку идёт первой: это его список дел, а не справка.
  const sections: ReactNode[] = []
  const listOf = (title: string, rows: DuesRow[], verdicts = false) =>
    rows.length === 0 ? null : (
      <Fragment key={title}>
        <SectionTitle>{`${title} · ${rows.length}`}</SectionTitle>
        {verdicts && snap.canEdit ? (
          <div className="card">
            {rows.map((row, i) => (
              <Fragment key={row.userId}>
                {i > 0 ? <Sep left={46} /> : null}
                <DuesPersonRow row={row} snap={snap} onChanged={onChanged} />
                <Verdict row={row} snap={snap} onChanged={onChanged} />
              </Fragment>
            ))}
          </div>
        ) : (
          <DuesList rows={rows} snap={snap} onChanged={onChanged} />
        )}
      </Fragment>
    )
  if (snap.canEdit) {
    sections.push(listOf('Ждут подтверждения', claimed, true), listOf('Не внесли', unpaid), listOf('Внесли', paid))
  } else {
    sections.push(listOf('Не внесли', unpaid), listOf('Ждут подтверждения', claimed), listOf('Внесли', paid))
  }

  return (
    <Screen>
      <BackRow label={periodKey ? 'История' : 'Обзор'} />
      <Header
        title="Взносы"
        subtitle={`${snap.periodLabel}${snap.isCurrent ? ` · сбор ${snap.day}-го числа` : ' · прошлый период'}`}
      />
      <MyDues snap={snap} onChanged={onChanged} />
      <Summary snap={snap} />
      {sections}
      {!periodKey ? (
        <div className="card" style={{ marginTop: 22 }}>
          <div className="row tappable" onClick={() => push('duesHistory')}>
            <div className="row-icon" style={{ background: '#8e8e93' }}>
              {icons.archiveBox()}
            </div>
            <span className="row-label">История и статистика</span>
            <div className="row-right">{icons.chevron()}</div>
          </div>
          {snap.canEdit ? (
            <>
              <Sep left={54} />
              <div className="row tappable" onClick={() => push('duesSettings')}>
                <div className="row-icon" style={{ background: '#ff9500' }}>
                  {icons.gear()}
                </div>
                <span className="row-label">Настройки взносов</span>
                <div className="row-right">{icons.chevron()}</div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      <Footnote>
        {snap.canEdit
          ? 'Свайп по строке: ставка человека и отметка наличными. У подтверждённого — снять отметку.'
          : 'Чужие строки только на чтение: подтверждает dev. Свой взнос отмечается кнопкой выше.'}
      </Footnote>
    </Screen>
  )
}
