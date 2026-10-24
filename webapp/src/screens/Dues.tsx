// Взносы за период: свой взнос сверху, дальше состав тремя секциями. Экран один и
// тот же для текущего сбора (данные из bootstrap) и для прошлого, открытого из
// истории (грузится ручкой dues.period) — форма ответа у них общая.

import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { action, api } from '../api'
import { fmtIsoDay, monthsWord } from '../dates'
import { money } from '../format'
import { icons } from '../icons'
import { markOwnTap, ownTapRecent } from '../motion'
import { showAlert } from '../modals'
import { useRemote } from '../remote'
import { push, useParams, useStore } from '../store'
import { haptic } from '../telegram'
import type { DuesRow, DuesSnapshot, DuesStatus } from '../types'
import { BackRow, EmptyState, ErrorState, Header, SectionTitle, Sep } from '../components/common'
import { Collapse } from '../components/Collapse'
import { useCopyFeedback } from '../components/CopyFeedback'
import { Flip } from '../components/Flip'
import { Avatar, userLabel } from '../components/people'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
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

/** Смена отметки девом: экран держит строку на месте и сам ведёт её в новую секцию. */
type Mark = (row: DuesRow, to: DuesStatus) => void

/**
 * Состав в порядке разделов на экране: по нему листаются карточки людей. Запоминается в
 * момент открытия карточки, поэтому сверка, переставляющая строки, его не тасует.
 */
export type DuesRef = { userId: number; name: string; username: string | null }
const DuesOrderContext = createContext<DuesRef[]>([])

function DuesPersonRow({ row, snap, mark, meId, flash = false }: { row: DuesRow; snap: DuesSnapshot; mark: Mark; meId: number; flash?: boolean }) {
  const order = useContext(DuesOrderContext)
  const open = (): void => push('duesPerson', { userId: row.userId, people: order })
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
    <button
      type="button"
      className={'row' + (flash || (row.userId === meId && row.status === 'claimed' && ownTapRecent()) ? ' row-flash' : '')}
      onClick={open}
    >
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

  const actions: SwipeAction[] = [
    { key: 'rate', label: 'Ставка', icon: icons.tag(19, '#fff'), tone: 'neutral', onSelect: open },
    row.status === 'paid'
      ? { key: 'undo', label: 'Снять отметку', icon: icons.undo(19, '#fff'), tone: 'red', onSelect: () => mark(row, 'none') }
      : { key: 'ok', label: 'Отметить взнос', icon: icons.check(18, '#fff', 2), onSelect: () => mark(row, 'paid') },
  ]
  return <SwipeRow actions={actions}>{body}</SwipeRow>
}

/** Ответ dev на чужую заявку. Инлайн, не за свайпом: это решение по чужому действию. */
function Verdict({ row, mark, done }: { row: DuesRow; mark: Mark; done: boolean }) {
  if (done) {
    return (
      <div className="dues-verdict done">
        {icons.check(13, 'var(--green)', 2.4)}
        Подтверждено
      </div>
    )
  }
  return (
    <div className="dues-verdict">
      <button className="small-btn green" onClick={() => mark(row, 'paid')}>
        Подтвердить
      </button>
      <button className="small-btn gray" onClick={() => mark(row, 'none')}>
        Отклонить
      </button>
    </div>
  )
}

/** Строка, которую дев только что отметил: где стояла, где стоит сейчас и как выглядит. */
type Hold = { row: DuesRow; from: DuesStatus; to: DuesStatus; index: number; phase: 'stand' | 'leave' }
type Item = { row: DuesRow; leaving: boolean; entering: boolean; held: boolean }

/**
 * Секция состава. Строка, ушедшая после своего тапа, сворачивается на прежнем месте,
 * пришедшая вырастает с подсветкой. Секция, у которой ушла последняя строка, сворачивается
 * вместе с заголовком.
 */
function DuesSection({
  title,
  items,
  snap,
  mark,
  meId,
  verdicts = false,
}: {
  title: string
  items: Item[]
  snap: DuesSnapshot
  mark: Mark
  meId: number
  verdicts?: boolean
}) {
  const live = items.filter((x) => !x.leaving).length
  return (
    <Collapse open={live > 0}>
      <SectionTitle>
        {`${title} · `}
        <Flip value={live} />
      </SectionTitle>
      <div className="card dues-list">
        {items.map((x, i) => (
          <Collapse key={x.row.userId} open={!x.leaving} appear={x.entering}>
            {i > 0 ? <Sep left={verdicts || x.row.status !== 'none' ? 46 : 64} /> : null}
            <DuesPersonRow row={x.row} snap={snap} mark={mark} meId={meId} flash={x.entering} />
            {verdicts && snap.canEdit ? <Verdict row={x.row} mark={mark} done={x.held} /> : null}
          </Collapse>
        ))}
      </div>
    </Collapse>
  )
}

/**
 * Свой взнос: одна карточка на все три состояния, как сцена взносов в знакомстве.
 * «Я внёс» переводит её в «Ждёт сверки» сразу, не дожидаясь ответа: запрос идёт без
 * оверлея, отказ возвращает карточку как было. Сверку делает dev, а резидент в этот
 * момент на экран не смотрит, поэтому «Внесён» встаёт без движения.
 */
function MyDues({ snap, onChanged }: { snap: DuesSnapshot; onChanged: () => void }) {
  const clip = useCopyFeedback(17)
  const [claiming, setClaiming] = useState(false)
  const [moving, setMoving] = useState(false)
  useEffect(() => setClaiming(false), [snap.me.status])
  useEffect(() => {
    if (!moving) return
    const timer = setTimeout(() => setMoving(false), 700)
    return () => clearTimeout(timer)
  }, [moving])
  if (!snap.me.inRoster) return null

  const claim = async () => {
    if (claiming) return
    haptic.impact('medium')
    markOwnTap()
    setMoving(true)
    setClaiming(true)
    const done = await action('dues.claim', undefined, { quiet: true })
    if (done) onChanged()
    else setClaiming(false)
  }
  const copy = async (e: MouseEvent) => {
    if (!(await clip.copy(snap.requisites, e))) showAlert('Не получилось скопировать. Выделите текст вручную.')
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

  // Подтверждённый взнос остаётся зелёной карточкой до конца периода: о сверке
  // резиденту ничего не приходит, и это единственное место, где он про неё узнаёт.
  const status = claiming && snap.me.status === 'none' ? 'claimed' : snap.me.status
  const paidOn = status === 'paid' && snap.me.at ? ` ${fmtIsoDay(snap.me.at)}` : ''
  return (
    <div className={`my-dues md-card md-${status}` + (moving ? ' md-moving' : '')}>
      <div className="md-tint" aria-hidden="true">
        <i className="md-s" data-s="none" />
        <i className="md-s" data-s="claimed" />
        <i className="md-s" data-s="paid" />
      </div>
      <div className="md-body">
        <div className="md-top">
          <div className="my-dues-kicker">Мой взнос</div>
          <span className="md-tags">
            <span className="ob-tag warn md-s" data-s="none">
              Не внесён
            </span>
            <span className="ob-tag gray md-s" data-s="claimed">
              Ждёт сверки
            </span>
            <span className="ob-tag green md-s" data-s="paid">
              Внесён
            </span>
          </span>
        </div>
        <div className="my-dues-sum">{money(snap.me.amount, snap.currency)}</div>
        {/* Реквизиты нужны только до перевода; после тапа они сворачиваются по
            высоте, а не пропадают одним кадром. */}
        {snap.requisites && (status === 'none' || moving) ? (
          <div className="md-req">
            <div className="md-req-in">
              <div className="my-dues-req">
                <div className="mdr-text">
                  {snap.requisites}
                </div>
                <button className="mdr-copy" aria-label="Скопировать реквизиты" onClick={(e) => void copy(e)}>
                  {clip.glyph}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <div className="md-act">
          <button
            className="primary-btn md-s"
            data-s="none"
            disabled={status !== 'none'}
            tabIndex={status === 'none' ? 0 : -1}
            onClick={() => void claim()}
          >
            {icons.check(18, '#fff', 2)}
            Я внёс
          </button>
          <div className="ob-pay-line md-s" data-s="claimed">
            {icons.clock(16, 'currentColor')}
            Отметка ушла на сверку
          </div>
          <div className="ob-pay-line ok md-s" data-s="paid">
            {icons.check(15, 'currentColor', 2.2)}
            {`Сверено с выпиской${paidOn}`}
          </div>
        </div>
      </div>
      {clip.toast}
    </div>
  )
}

function Summary({ snap }: { snap: DuesSnapshot }) {
  const { total, paid, claimed, collected, expected } = snap.summary
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  const left = expected - collected
  return (
    <div className={'card dues-summary' + (ownTapRecent() ? ' ds-moving' : '')}>
      <div className="dues-figure">
        <span className="df-main">
          <Flip value={paid} />
        </span>
        <span className="df-of">{`из ${total} подтверждено`}</span>
        <span className="df-sum">{money(collected, snap.currency)}</span>
      </div>
      <div className="dues-bar">
        {/* Пустой сегмент не рисуем: зазор между сегментами иначе отодвигал бы
            заявленные от начала полосы, пока не подтверждён ни один. */}
        {paid > 0 ? <i style={{ width: `${pct(paid)}%` }} /> : null}
        {claimed > 0 ? <i className="claimed" style={{ width: `${pct(claimed)}%` }} /> : null}
      </div>
      {/* Подписи сегментов, а не только их цвет: зелёный и оранжевый под протанопией
          почти совпадают, и полоса без них читается одним куском. */}
      {claimed > 0 ? (
        <div className="dues-split">
          <span>
            <i style={{ background: 'var(--green)' }} />
            {'подтверждено '}
            <Flip value={paid} />
          </span>
          <span>
            <i style={{ background: 'var(--orange)' }} />
            {'ждут сверки '}
            <Flip value={claimed} />
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

  const snap = periodKey ? remote.data : data!.dues ?? null
  // Мутация возвращает свежий bootstrap; для прошлого периода его мало — перезапрашиваем.
  const onChanged = () => {
    if (periodKey) remote.reload()
  }

  // Дев сверяет переводы подряд по выписке, поэтому под пальцем не должна оказываться
  // чужая строка. Подтверждённая полсекунды стоит на месте уже зелёной, потом
  // сворачивается и вырастает во «Внесли»; отказ и снятие уходят сразу. Строку держим,
  // пока сервер не ответил: свежий bootstrap переставил бы её в первом же кадре.
  const [holds, setHolds] = useState<Record<number, Hold>>({})
  const dropHold = (id: number): void =>
    setHolds((h) => {
      if (!h[id]) return h
      const next = { ...h }
      delete next[id]
      return next
    })
  const mark: Mark = (row, to) => {
    if (!snap || holds[row.userId]) return
    const confirm = to === 'paid'
    haptic.impact(confirm ? 'medium' : 'light')
    markOwnTap()
    const from = row.status
    const index = snap.rows.filter((r) => r.status === from).findIndex((r) => r.userId === row.userId)
    const me = data!.me
    const shown: DuesRow = confirm
      ? { ...row, status: 'paid', at: new Date().toISOString(), by: { username: me.username, name: me.name } }
      : { ...row, status: 'none', at: null, by: null }
    const stand = confirm && from !== 'paid'
    setHolds((h) => ({ ...h, [row.userId]: { row: shown, from, to, index, phase: stand ? 'stand' : 'leave' } }))
    if (stand) setTimeout(() => setHolds((h) => (h[row.userId] ? { ...h, [row.userId]: { ...h[row.userId]!, phase: 'leave' } } : h)), 500)
    const t0 = performance.now()
    void (async () => {
      const done = await action(confirm ? 'dues.confirm' : 'dues.clear', { periodKey: snap.periodKey, userId: row.userId }, { quiet: true })
      if (done) {
        onChanged()
        const wait = (stand ? 1000 : 520) - (performance.now() - t0)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      }
      dropHold(row.userId)
    })()
  }

  // Шапка одна на все состояния, меняется только тело — его и подменяет Swap: каркас
  // гаснет поверх проявившегося списка, а не пропадает в том же кадре.
  // Скелет только на первой загрузке: перезапрос после отметки должен обновлять
  // список на месте, а не подменять экран.
  const loading = !!periodKey && remote.loading && !remote.data
  const frame = (subtitle: ReactNode, body: ReactNode) => (
    <Screen>
      <BackRow />
      <Header title="Взносы" subtitle={subtitle} />
      <Swap loading={loading} skeleton={remote.pending ? <DuesSkeleton /> : null}>
        {body}
      </Swap>
    </Screen>
  )

  // Заголовок известен заранее, подпись с названием периода — нет.
  if (loading) return frame(<SkBlock w={168} h={14} />, null)
  // Упавший запрос — не «сбор выключен»: про настройки спейса экран в этот момент
  // ничего не знает.
  if (periodKey && remote.error) return frame(undefined, <ErrorState onRetry={remote.reload} />)
  // Пустое состояние: сбор выключен либо ещё ни разу не открывался. Обычный резидент
  // сюда не попадает (у него в bootstrap просто нет раздела), поэтому ниже вход в
  // настройки — единственный способ включить сбор обратно.
  if (!snap || !snap.periodKey) {
    return frame(
      undefined,
      <>
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
      </>,
    )
  }

  const meId = data!.me.id
  const statusOf = (r: DuesRow): DuesStatus => {
    const h = holds[r.userId]
    return h ? (h.phase === 'stand' ? h.from : h.to) : r.status
  }
  const itemsOf = (st: DuesStatus, keep: (r: DuesRow) => boolean = () => true): Item[] => {
    const items: Item[] = snap.rows
      .filter((r) => statusOf(r) === st && keep(r))
      .map((r) => {
        const h = holds[r.userId]
        return { row: h ? h.row : r, leaving: false, entering: Boolean(h && h.phase === 'leave'), held: Boolean(h) }
      })
    for (const h of Object.values(holds)) {
      if (h.phase === 'leave' && h.from === st && keep(h.row)) {
        items.splice(Math.min(h.index, items.length), 0, { row: h.row, leaving: true, entering: false, held: true })
      }
    }
    return items
  }
  const unpaid = itemsOf('none', (r) => !isExempt(r))
  const exempt = itemsOf('none', isExempt)
  const claimed = itemsOf('claimed')
  const paid = itemsOf('paid')
  // У dev очередь на сверку идёт первой: это его список дел, а не справка.
  const section = (title: string, items: Item[], verdicts = false) => (
    <DuesSection key={title} title={title} items={items} snap={snap} mark={mark} meId={meId} verdicts={verdicts} />
  )
  const sections: ReactNode[] = snap.canEdit
    ? [section('Ждут подтверждения', claimed, true), section('Не внесли', unpaid), section('Внесли', paid)]
    : [section('Не внесли', unpaid), section('Ждут подтверждения', claimed), section('Внесли', paid)]
  sections.push(section('Не платят', exempt))
  const order: DuesRef[] = [...(snap.canEdit ? [claimed, unpaid, paid] : [unpaid, claimed, paid]), exempt]
    .flat()
    .filter((it) => !it.leaving)
    .map((it) => ({ userId: it.row.userId, name: it.row.name, username: it.row.username }))

  return frame(
    `${snap.periodLabel}${snap.isCurrent ? ` · сбор ${snap.day}-го числа` : ' · прошлый период'}`,
    <>
      <MyDues snap={snap} onChanged={onChanged} />
      <Summary snap={snap} />
      <DuesOrderContext.Provider value={order}>{sections}</DuesOrderContext.Provider>
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
    </>,
  )
}
