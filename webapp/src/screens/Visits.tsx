// «Кто пришёл» за день: отметки по заявкам и гости без заявки. Открывается с экрана
// сегодняшнего дня и из архива недели. Править можно только сам день визита и ночь
// после него (сервер отдаёт `editable`), прошедший день дальше только читается.
//
// Пропуском считается только явная отметка «не пришёл». Подтверждённый визит, который
// никто не отметил, остаётся «без отметки», а не неявкой: забыл резидент, а не гость.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { action, api } from '../api'
import { fmtDayMonth, weekdayIdx, WEEKDAYS_FULL } from '../dates'
import { icons } from '../icons'
import { animate, E, markOwnTap, pr, pulse, reducedMotion } from '../motion'
import { useRemote } from '../remote'
import { push, useParams, useStore } from '../store'
import { haptic } from '../telegram'
import { sec } from '../theme'
import type { HostingRequest, User, VisitOutcome, VisitsDay, WalkIn } from '../types'
import { ActionButton, BackRow, EmptyState, ErrorState, Header, ReadonlyBadge, SectionTitle, Sep } from '../components/common'
import { Collapse } from '../components/Collapse'
import { Flip } from '../components/Flip'
import { Avatar, userLabel } from '../components/people'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkRows } from '../components/skeleton'
import { minuteOfDay, useNowMin } from './Visit'

const NO_OUTCOME: VisitOutcome = { status: null, source: null, by: null, at: null }

/**
 * Исход с учётом своего тапа, который сервер ещё не подтвердил. Снятая отметка до
 * ответа показывается приблизительно: «до отметок» знает только сервер, и через
 * мгновение его ответ встанет на место.
 */
function effective(r: HostingRequest, pending: Record<string, boolean | null>, me: User, todayKey: string): VisitOutcome {
  if (!(r.id in pending)) return r.visit ?? NO_OUTCOME
  const came = pending[r.id]
  if (came === true || came === false) return { status: came ? 'came' : 'missed', source: 'mark', by: me, at: null }
  if (r.arrivedAt) return { status: 'came', source: 'door', by: null, at: null }
  if (r.status === 'approved' && r.dateKey < todayKey) return { status: 'unknown', source: null, by: null, at: null }
  return NO_OUTCOME
}

/** Подпись исхода: существительными, а не «пришёл/пришла» - пол гостя мы не знаем. */
function outcomeLine(o: VisitOutcome): { text: string; tone: string } | null {
  if (o.status === 'came') {
    if (o.source === 'door') return { text: 'приход · по кнопке «Я на месте»', tone: 'came' }
    if (o.source === 'legacy') return { text: 'приход · визит до отметок', tone: 'came' }
    return { text: o.by ? `приход · отметка ${userLabel(o.by)}` : 'приход', tone: 'came' }
  }
  if (o.status === 'missed') return { text: o.by ? `неявка · отметка ${userLabel(o.by)}` : 'неявка', tone: 'missed' }
  if (o.status === 'unknown') return { text: 'без отметки', tone: 'muted' }
  return null
}

/** Профиль есть только у того, за кем есть аккаунт: у добавленных по имени (id 0) его нет. */
const openGuest = (u: User): void => {
  if (u.userId !== 0) push('guestVisits', { userId: u.userId, user: u })
}

/** «Все пришли» проходит по строкам сверху вниз с этим шагом: видно, кого отметила общая кнопка. */
const STAGGER_MS = 90

// Длины штрихов значков отметки, по ним штрих дорисовывается через stroke-dashoffset:
// галочка M2.5 7.5 l3 3 L11.5 4 и черта крестика 9√2.
const CHECK_LEN = 13.09
const CROSS_LEN = 12.73

type MarkKind = 'came' | 'missed'

const isMark = (s: VisitOutcome['status']): s is MarkKind => s === 'came' || s === 'missed'

/** Тон вспышки строки, тот же, что у круга отметки. */
const FLASH_RGB: Record<MarkKind, string> = { came: '52, 199, 89', missed: '255, 149, 0' }

/** Серый штрих и белый поверх него: белый дорисовывается, когда отметку ставят. */
function MarkGlyph({ kind }: { kind: MarkKind }) {
  if (kind === 'came') {
    const d = 'M2.5 7.5l3 3L11.5 4'
    return (
      <svg width="16" height="16" viewBox="0 0 14 14" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path className="vm-base" d={d} />
        <path className="vm-ink" d={d} strokeDasharray={`${CHECK_LEN} ${CHECK_LEN}`} />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" strokeWidth="1.9" strokeLinecap="round">
      <path className="vm-base" d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
      <path className="vm-ink" d="M5.5 5.5l9 9" strokeDasharray={`${CROSS_LEN} ${CROSS_LEN}`} />
      <path className="vm-ink" d="M14.5 5.5l-9 9" strokeDasharray={`${CROSS_LEN} ${CROSS_LEN}`} />
    </svg>
  )
}

function markParts(row: HTMLElement, kind: MarkKind) {
  const btn = row.querySelector<HTMLElement>(`.vm-btn.${kind}`)
  const fill = btn?.querySelector<HTMLElement>('.vm-fill')
  const base = btn?.querySelector<SVGElement>('.vm-base')
  if (!btn || !fill || !base) return null
  return { fill, base, inks: Array.from(btn.querySelectorAll<SVGElement>('.vm-ink')) }
}

/**
 * Своя отметка рисуется: круг заливается с перелётом, белый штрих дорисовывается
 * поверх серого, строка коротко вспыхивает тоном отметки. Снятая гаснет быстрее и без
 * вспышки. Отмена заодно снимает стили кадра: остаток прерванного движения иначе висел
 * бы поверх нового состояния.
 */
function playMark(row: HTMLElement, from: VisitOutcome['status'], to: VisitOutcome['status']): () => void {
  const on = isMark(to) ? markParts(row, to) : null
  const off = isMark(from) ? markParts(row, from) : null
  const len = to === 'missed' ? CROSS_LEN : CHECK_LEN
  const flash = isMark(to) ? FLASH_RGB[to] : null
  const clear = (): void => {
    row.style.backgroundColor = ''
    for (const p of [on, off]) {
      if (!p) continue
      p.fill.style.transform = ''
      p.base.style.opacity = ''
      for (const ink of p.inks) {
        ink.style.opacity = ''
        ink.style.strokeDashoffset = ''
      }
    }
  }
  const stop = animate(
    on ? 800 : 240,
    (t) => {
      if (on) {
        on.fill.style.transform = `scale(${pr(t, 0, 340, E.crisp).toFixed(3)})`
        on.base.style.opacity = String(1 - pr(t, 110, 260))
        on.inks.forEach((ink, i) => {
          // Черты крестика идут одна за другой, галочка одним движением.
          const k = on.inks.length > 1 ? pr(t, 110 + i * 100, 170, E.inOut) : pr(t, 110, 260, E.inOut)
          ink.style.opacity = k > 0 ? '1' : '0'
          ink.style.strokeDashoffset = (len * (1 - k)).toFixed(2)
        })
      }
      if (off) {
        off.fill.style.transform = `scale(${(1 - pr(t, 0, 220, E.inOut)).toFixed(3)})`
        off.base.style.opacity = String(pr(t, 60, 180))
        for (const ink of off.inks) {
          ink.style.opacity = String(1 - pr(t, 0, 140))
          ink.style.strokeDashoffset = '0'
        }
      }
      if (flash) row.style.backgroundColor = `rgba(${flash}, ${(0.16 * pulse(t, 40, 760)).toFixed(3)})`
    },
    clear,
  )
  return () => {
    stop()
    clear()
  }
}

function RequestVisitRow({
  r,
  outcome,
  own,
  editable,
  canMiss,
  onMark,
}: {
  r: HostingRequest
  outcome: VisitOutcome
  /** Строка ждёт ответа на свой тап: только такая смена отметки рисуется движением. */
  own: boolean
  editable: boolean
  /** «Не пришёл» доступен: визит подтверждён и его время уже наступило. */
  canMiss: boolean
  onMark: (r: HostingRequest, came: boolean | null) => void
}) {
  const line = outcomeLine(outcome)
  const came = outcome.status === 'came'
  const missed = outcome.status === 'missed'
  // Повторный тап по своей же отметке её снимает. «Приход» по кнопке гостя или до
  // отметок отметкой не является: тап по нему ставит её явно.
  const ownCame = came && outcome.source === 'mark'
  const rowRef = useRef<HTMLDivElement>(null)
  const was = useRef(outcome.status)
  // Отметка другого резидента и откат после отказа сервера встают без движения: у
  // строки в этот момент нет своего тапа в ожидании.
  useLayoutEffect(() => {
    const from = was.current
    was.current = outcome.status
    const row = rowRef.current
    if (from === outcome.status || !own || !row) return
    return playMark(row, from, outcome.status)
  }, [outcome.status])
  return (
    <div className="row visit-row" ref={rowRef}>
      <button type="button" className="visit-who" onClick={() => openGuest(r.guest)}>
        <Avatar user={r.guest} className="req-avatar" />
        <div className="req-main">
          <div className="req-name">{r.guest.name}</div>
          <div className="req-sub">
            {`к ${r.time} · ${r.approvedBy ? `хостит ${userLabel(r.approvedBy)}` : 'без хоста'}`}
            {r.anon ? ' · анонимно' : ''}
          </div>
          <Collapse open={line !== null}>
            {line ? <div className={'visit-status ' + line.tone}>{line.text}</div> : null}
          </Collapse>
        </div>
      </button>
      {editable ? (
        <div className="visit-mark">
          <button
            type="button"
            className={'vm-btn came' + (came ? ' on' : '')}
            aria-label={ownCame ? 'Снять отметку прихода' : 'Отметить приход'}
            aria-pressed={came}
            onClick={() => onMark(r, ownCame ? null : true)}
          >
            <i className="vm-fill" />
            <MarkGlyph kind="came" />
          </button>
          <button
            type="button"
            className={'vm-btn missed' + (missed ? ' on' : '')}
            aria-label={missed ? 'Снять отметку неявки' : 'Отметить неявку'}
            aria-pressed={missed}
            disabled={!canMiss && !missed}
            title={!canMiss && !missed ? (r.status === 'approved' ? 'Визит ещё не начался' : 'Заявку никто не брал') : undefined}
            onClick={() => onMark(r, missed ? null : false)}
          >
            <i className="vm-fill" />
            <MarkGlyph kind="missed" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function WalkInRow({ w, editable, onRemove }: { w: WalkIn; editable: boolean; onRemove: (w: WalkIn) => Promise<unknown> }) {
  const sub = w.guest.username ? '@' + w.guest.username : w.guest.userId === 0 ? 'без аккаунта' : ''
  return (
    <div className="row visit-row">
      <button type="button" className="visit-who" onClick={() => openGuest(w.guest)}>
        <Avatar user={w.guest} className="req-avatar" />
        <div className="req-main">
          <div className="req-name">{w.guest.name}</div>
          {sub ? <div className="req-sub">{sub}</div> : null}
          <div className="visit-status came">{`приход · отметка ${userLabel(w.by)}`}</div>
        </div>
      </button>
      {editable ? (
        <ActionButton className="vm-remove" label="Убрать из списка" onClick={() => onRemove(w)}>
          {icons.xmark(11, sec(0.5))}
        </ActionButton>
      ) : null}
    </div>
  )
}

export function Visits() {
  const params = useParams()
  const { data } = useStore()
  const dateKey = params.dateKey as string
  const todayKey = data!.todayKey
  const isToday = dateKey === todayKey
  // Вчерашний вечер, который ещё можно отметить: открыт из архива недели.
  const isGrace = dateKey === data!.visitGraceDay
  const me: User = { userId: data!.me.id, name: data!.me.name, username: data!.me.username }
  const nowMin = useNowMin()

  // Из архива недели день приезжает готовым: экран рисуется сразу, а свежая версия
  // догоняет. После своих отметок сервер отдаёт день целиком, и он заменяет оба.
  const preset = (params.preset as VisitsDay | undefined) ?? null
  const remote = useRemote(() => api<VisitsDay>('visits.day', { dateKey }), [dateKey])
  const [local, setLocal] = useState<VisitsDay | null>(null)
  const day = local ?? remote.data ?? preset
  const [pending, setPending] = useState<Record<string, boolean | null>>({})
  // Строки, по которым сейчас идёт «Все пришли». Для общей кнопки они уже отмечены:
  // иначе её счётчик убывал бы по одной строке и свернулась бы она с единицей.
  const [cascade, setCascade] = useState<string[]>([])
  // Свёрнутая кнопка ещё жива до конца свёртки и держит обработчик со старым состоянием,
  // поэтому повторный тап отсекается по ссылке, а не по cascade.
  const cascading = useRef(false)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), [])

  const mark = async (r: HostingRequest, came: boolean | null): Promise<void> => {
    haptic.impact(came === null ? 'soft' : 'light')
    markOwnTap()
    setPending((p) => ({ ...p, [r.id]: came }))
    const res = await action('visit.mark', { id: r.id, came }, { quiet: true })
    if (res?.visitsDay) setLocal(res.visitsDay)
    setPending((p) => {
      const { [r.id]: _done, ...rest } = p
      return rest
    })
  }

  // Отметки встают сразу на тап, по строке за шаг, а запрос идёт параллельно. Отказ
  // сервера снимает их обратно; при «уменьшении движения» строки отмечаются разом.
  const markAll = (ids: string[]): void => {
    if (ids.length === 0 || cascading.current) return
    cascading.current = true
    haptic.impact('medium')
    markOwnTap()
    setCascade(ids)
    const step = reducedMotion() ? 0 : STAGGER_MS
    const put = (id: string): void => setPending((p) => ({ ...p, [id]: true }))
    ids.forEach((id, i) => {
      if (i === 0 || step === 0) put(id)
      else timers.current.push(window.setTimeout(() => put(id), i * step))
    })
    const t0 = performance.now()
    void (async () => {
      const res = await action('visit.markAll', { dateKey }, { quiet: true })
      if (res) {
        // Ответ ложится после последней строки: пришедший раньше, он поставил бы её
        // отметку сам, и строка встала бы без движения.
        const wait = (ids.length - 1) * step + 50 - (performance.now() - t0)
        if (wait > 0) await new Promise((done) => window.setTimeout(done, wait))
        if (res.visitsDay) setLocal(res.visitsDay)
      }
      timers.current.forEach((id) => window.clearTimeout(id))
      timers.current = []
      setPending((p) => {
        const next = { ...p }
        for (const id of ids) if (next[id] === true) delete next[id]
        return next
      })
      setCascade([])
      cascading.current = false
    })()
  }

  const removeWalkIn = async (w: WalkIn): Promise<void> => {
    haptic.impact('soft')
    markOwnTap()
    const res = await action('walkin.remove', { id: w.id }, { quiet: true })
    if (res?.visitsDay) setLocal(res.visitsDay)
  }

  const title = isToday || isGrace ? 'Кто пришёл' : WEEKDAYS_FULL[weekdayIdx(dateKey)]
  const when = `${isToday ? 'Сегодня, ' : isGrace ? 'Вчера, ' : ''}${fmtDayMonth(dateKey)}`
  let subtitle: ReactNode = when
  let body = null

  if (!day && remote.error) {
    body = <ErrorState onRetry={remote.reload} />
  } else if (day) {
    const editable = day.editable
    const requests = [...day.requests].sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved'))
    const outcomes = new Map(requests.map((r) => [r.id, effective(r, pending, me, todayKey)]))
    const came = requests.filter((r) => outcomes.get(r.id)?.status === 'came').length + day.walkIns.length
    const unmarked = requests.filter((r) => outcomes.get(r.id)?.status === 'unknown').length
    subtitle = (
      <>
        {`${when} · пришли\u00a0`}
        <Flip value={came} />
        {unmarked > 0 ? ` · без отметки\u00a0${unmarked}` : ''}
      </>
    )
    // «Все пришли» трогает только тех, о ком ничего не известно: явную неявку и приход
    // по кнопке гостя общая кнопка не переписывает (то же правило на сервере). Порядок
    // тот же, что в списке: по нему кнопка и проходит строки.
    const rest = requests
      .filter((r) => {
        const o = outcomes.get(r.id)
        return r.status === 'approved' && !r.arrivedAt && o?.source !== 'mark' && o?.status !== 'came' && !cascade.includes(r.id)
      })
      .map((r) => r.id)
    const canMiss = (r: HostingRequest): boolean =>
      r.status === 'approved' && (r.dateKey < todayKey || nowMin >= minuteOfDay(r.time))

    body = (
      <>
        {!editable ? <ReadonlyBadge /> : null}
        {/* Кнопка сворачивается, когда по строкам пройдёт последняя отметка. Отступ до
            списка внутри сворачивающегося блока: снаружи он провисел бы до конца
            свёртки и пропал рывком. */}
        {editable ? (
          <div className="visits-all">
            <Collapse open={rest.length > 0} delay={cascade.length > 0 ? (cascade.length - 1) * STAGGER_MS + 320 : 0}>
              <div className="card">
                <ActionButton className="row tappable" onClick={() => markAll(rest)}>
                  <div className="row-icon" style={{ background: 'var(--green)' }}>
                    {icons.check(17, '#fff', 2.4)}
                  </div>
                  <span className="row-label">Все пришли</span>
                  <span className="row-right count-muted">{String(rest.length)}</span>
                </ActionButton>
              </div>
              <div className="visits-all-gap" />
            </Collapse>
          </div>
        ) : null}
        {requests.length > 0 ? (
          <>
            <SectionTitle>{`По заявкам · ${requests.length}`}</SectionTitle>
            <div className="card">
              {requests.map((r, i) => (
                <Fragment key={r.id}>
                  {i > 0 ? <Sep left={66} /> : null}
                  <RequestVisitRow
                    r={r}
                    outcome={outcomes.get(r.id) ?? NO_OUTCOME}
                    own={r.id in pending}
                    editable={editable}
                    canMiss={canMiss(r)}
                    onMark={(req, value) => void mark(req, value)}
                  />
                </Fragment>
              ))}
            </div>
          </>
        ) : null}
        {day.walkIns.length > 0 || editable ? (
          <>
            <SectionTitle>{day.walkIns.length > 0 ? `Без заявки · ${day.walkIns.length}` : 'Без заявки'}</SectionTitle>
            <div className="card">
              {day.walkIns.map((w, i) => (
                <Fragment key={w.id}>
                  {i > 0 ? <Sep left={66} /> : null}
                  <WalkInRow w={w} editable={editable} onRemove={removeWalkIn} />
                </Fragment>
              ))}
              {editable ? (
                <>
                  {day.walkIns.length > 0 ? <Sep left={54} /> : null}
                  <button type="button" className="row tappable" onClick={() => push('walkIn', { dateKey })}>
                    <div className="row-icon" style={{ background: 'var(--blue)' }}>
                      {icons.personPlus('#fff')}
                    </div>
                    <span className="row-label">Добавить гостя без заявки</span>
                    <div className="row-right">{icons.chevron()}</div>
                  </button>
                </>
              ) : null}
            </div>
          </>
        ) : null}
        {requests.length === 0 && day.walkIns.length === 0 && !editable ? (
          <div className="card">
            <EmptyState title="Никого не отметили" text="В этот день не было ни заявок, ни гостей без заявки." />
          </div>
        ) : null}
      </>
    )
  }

  return (
    <Screen>
      <BackRow />
      <Header title={title} subtitle={subtitle} />
      {/* Шапка известна заранее, подменяется только список. */}
      <Swap
        loading={!day && !remote.error}
        skeleton={
          remote.pending ? (
            <div aria-busy="true" aria-label="Загружаем, кто пришёл">
              <SectionTitle>По заявкам</SectionTitle>
              <SkRows count={3} avatar tail />
            </div>
          ) : null
        }
      >
        {body}
      </Swap>
    </Screen>
  )
}
