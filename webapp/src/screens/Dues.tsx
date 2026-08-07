// Взносы за период: свой взнос сверху, дальше состав тремя секциями. Экран один и
// тот же для текущего сбора (данные из bootstrap) и для прошлого, открытого из
// истории (грузится ручкой dues.period) — форма ответа у них общая.

import { Fragment, useState, type ReactNode } from 'react'
import { action, api } from '../api'
import { fmtIsoDay, monthsWord } from '../dates'
import { money } from '../format'
import { icons } from '../icons'
import { showAlert } from '../modals'
import { useRemote } from '../remote'
import { push, useParams, useStore } from '../store'
import { haptic } from '../telegram'
import type { DuesRow, DuesSnapshot } from '../types'
import { BackRow, EmptyState, ErrorState, Footnote, Header, SectionTitle, Sep } from '../components/common'
import { Avatar, userLabel } from '../components/people'
import { Screen } from '../components/Screen'
import { SkBlock, SkRows } from '../components/skeleton'
import { SwipeRow, type SwipeAction } from '../components/SwipeRow'

/** «месяц» / «2 месяца»: подпись к просрочке. */
export const debtWord = (missed: number): string => (missed >= 2 ? monthsWord(missed) : 'месяц')

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

/** Ставка 0 — человек освобождён от взноса: ни суммы, ни просрочки, ни строки в счётчике. */
const isExempt = (row: DuesRow): boolean => row.amount <= 0

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
        : isExempt(row)
          ? ''
          : row.missed >= 2
            ? 'Крайний срок неуплаты'
            : ''

  const body = (
    <button type="button" className="row" onClick={() => push('duesPerson', { userId: row.userId })}>
      {left}
      <div className="dues-main">
        <div className="dues-name-line">
          <span className="dues-name">{userLabel(row)}</span>
          {isExempt(row) ? null : <DebtBadge missed={row.missed} />}
          {isExempt(row) ? (
            <span className="rate-chip">НЕ ПЛАТИТ</span>
          ) : row.rate !== 'common' ? (
            <span className="rate-chip">{RATE_LABEL[row.rate]}</span>
          ) : null}
        </div>
        {sub ? (
          <div className={'dues-sub-line' + (row.status === 'none' && row.missed >= 2 ? ' crit' : '')}>{sub}</div>
        ) : null}
      </div>
      <div className="row-right">
        <span className={'dues-amount' + (row.status === 'paid' ? ' paid' : isExempt(row) ? ' muted' : '')}>
          {isExempt(row) ? 'освобождён' : money(row.amount, snap.currency)}
        </span>
        {icons.chevron()}
      </div>
    </button>
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
      showAlert('Не получилось скопировать. Выделите текст вручную.')
    }
  }

  // Ставка 0 — человек освобождён: плашка остаётся, но без реквизитов и кнопки.
  if (snap.me.amount <= 0) {
    return (
      <div className="my-dues">
        <div className="my-dues-kicker">Мой взнос</div>
        <div className="my-dues-sum">Не требуется</div>
        <div className="my-dues-sub">Ставка обнулена, взнос с вас не спрашивают.</div>
      </div>
    )
  }

  // Взнос подтверждён — плашки нет вовсе. Она существует ради действия («Я внёс»)
  // и реквизитов; закрытый взнос действия не требует, а «внесён» и так написано
  // в строке «Взносы» на главной и в составе периода.
  if (snap.me.status === 'paid') return null

  const cls = snap.me.status === 'claimed' ? 'claimed' : 'unpaid'
  return (
    <div className={'my-dues ' + cls}>
      <div className="my-dues-kicker">Мой взнос</div>
      <div className="my-dues-sum">{money(snap.me.amount, snap.currency)}</div>
      {snap.me.status === 'claimed' ? (
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
          <div className="my-dues-sub">Отметьте, когда переведёте: перевод будет рассмотрен.</div>
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
      {/* Подписи сегментов, а не только их цвет: зелёный и оранжевый под протанопией
          почти совпадают, и полоса без них читается одним куском. */}
      {claimed > 0 ? (
        <div className="dues-split">
          <span>
            <i style={{ background: 'var(--green)' }} />
            {`подтверждено ${paid}`}
          </span>
          <span>
            <i style={{ background: 'var(--orange)' }} />
            {`ждут сверки ${claimed}`}
          </span>
        </div>
      ) : null}
      <div className="dues-note">
        {left > 0 ? `Осталось собрать ${money(left, snap.currency)}` : 'Собрано полностью'}
      </div>
    </div>
  )
}

/**
 * Каркас прошлого периода: своя плашка, сводка, состав людьми с суммой справа.
 * Заголовки секций идут полосой, а не текстом: какие из них будут и с какими
 * счётчиками, известно только из ответа.
 */
function DuesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загружаем период взносов">
      <div className="my-dues">
        <SkBlock w={74} h={11} />
        <SkBlock w={148} h={30} style={{ display: 'block', marginTop: 6 }} />
        <SkBlock w="62%" h={14} style={{ display: 'block', marginTop: 6 }} />
      </div>
      <div className="card dues-summary">
        <div className="dues-figure">
          <SkBlock w={42} h={32} />
          <SkBlock w={136} h={15} />
          <SkBlock w={76} h={17} style={{ marginLeft: 'auto' }} />
        </div>
        <SkBlock h={8} style={{ display: 'block', marginTop: 14 }} />
        <SkBlock w="58%" h={14} style={{ display: 'block', marginTop: 11 }} />
      </div>
      <SectionTitle>
        <SkBlock w={124} h={11} />
      </SectionTitle>
      <SkRows count={3} avatar tail />
      <SectionTitle>
        <SkBlock w={92} h={11} />
      </SectionTitle>
      <SkRows count={6} avatar tail />
    </div>
  )
}

export function DuesScreen() {
  const { data } = useStore()
  const params = useParams()
  const periodKey: string | undefined = params.periodKey
  // Прошлый период приезжает отдельной ручкой: в bootstrap лежит только текущий.
  // Хук зовётся всегда (правило хуков), а без periodKey отдаёт null сразу — поэтому
  // его состояния снаружи смотрим только на экране прошлого периода.
  const remote = useRemote<DuesSnapshot | null>(
    async () => (periodKey ? await api<DuesSnapshot>('dues.period', { periodKey }) : null),
    [periodKey],
  )
  const back = periodKey ? 'История' : 'Ближайшие дни'

  const snap = periodKey ? remote.data : data!.dues ?? null
  // Мутация возвращает свежий bootstrap; для прошлого периода его мало — перезапрашиваем.
  const onChanged = () => {
    if (periodKey) remote.reload()
  }

  // Скелет только на первой загрузке: перезапрос после отметки должен обновлять
  // список на месте, а не подменять экран.
  if (periodKey && remote.loading && !remote.data) {
    return (
      <Screen>
        <BackRow label={back} />
        {/* Заголовок известен заранее, подпись с названием периода — нет. */}
        <Header title="Взносы" subtitle={<SkBlock w={168} h={14} />} />
        <DuesSkeleton />
      </Screen>
    )
  }
  // Упавший запрос — не «сбор выключен»: про настройки спейса экран в этот момент
  // ничего не знает.
  if (periodKey && remote.error) {
    return (
      <Screen>
        <BackRow label={back} />
        <Header title="Взносы" />
        <ErrorState onRetry={remote.reload} />
      </Screen>
    )
  }
  // Пустое состояние: сбор выключен либо ещё ни разу не открывался. Обычный резидент
  // сюда не попадает (у него в bootstrap просто нет раздела), поэтому ниже вход в
  // настройки — единственный способ включить сбор обратно.
  if (!snap || !snap.periodKey) {
    return (
      <Screen>
        <BackRow label={back} />
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
            <button type="button" className="row tappable" onClick={() => push('duesSettings')}>
              <div className="row-icon" style={{ background: 'var(--orange)' }}>
                {icons.gear()}
              </div>
              <span className="row-label">Настройки взносов</span>
              <div className="row-right">{icons.chevron()}</div>
            </button>
          </div>
        ) : null}
      </Screen>
    )
  }

  const unpaid = snap.rows.filter((r) => r.status === 'none' && !isExempt(r))
  const exempt = snap.rows.filter((r) => r.status === 'none' && isExempt(r))
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
  sections.push(listOf('Не платят', exempt))

  return (
    <Screen>
      <BackRow label={back} />
      <Header
        title="Взносы"
        subtitle={`${snap.periodLabel}${snap.isCurrent ? ` · сбор ${snap.day}-го числа` : ' · прошлый период'}`}
      />
      <MyDues snap={snap} onChanged={onChanged} />
      <Summary snap={snap} />
      {sections}
      {!periodKey ? (
        <div className="card" style={{ marginTop: 22 }}>
          <button type="button" className="row tappable" onClick={() => push('duesHistory')}>
            <div className="row-icon" style={{ background: 'var(--gray)' }}>
              {icons.archiveBox()}
            </div>
            <span className="row-label">История и статистика</span>
            <div className="row-right">{icons.chevron()}</div>
          </button>
          {snap.canEdit ? (
            <>
              <Sep left={54} />
              <button type="button" className="row tappable" onClick={() => push('duesSettings')}>
                <div className="row-icon" style={{ background: 'var(--orange)' }}>
                  {icons.gear()}
                </div>
                <span className="row-label">Настройки взносов</span>
                <div className="row-right">{icons.chevron()}</div>
              </button>
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
