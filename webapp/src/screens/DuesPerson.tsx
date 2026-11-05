// Карточка резидента по взносам: просрочка, ставка и вся история по месяцам.
// Читают все резиденты, меняют ставку и закрывают месяцы только dev.

import { Fragment, useState, type ReactNode } from 'react'
import { action, api } from '../api'
import { fmtIsoDay } from '../dates'
import { money } from '../format'
import { numberPrompt } from '../modals'
import { useRemote } from '../remote'
import { markOwnTap, mixc, palette } from '../motion'
import { setTopParams, useParams } from '../store'
import { haptic } from '../telegram'
import { ApiError, type DuesPerson as DuesPersonData, type DuesRateKind } from '../types'
import { ActionButton, BackRow, ErrorState, Footnote, Header, RadioCheck, SectionTitle, Sep } from '../components/common'
import { Collapse } from '../components/Collapse'
import { avatarTone, userLabel } from '../components/people'
import { Pager } from '../components/Pager'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SwipeRow, swipeIcons } from '../components/SwipeRow'
import { SkBlock, SkRows } from '../components/skeleton'
import { DebtBadge, type DuesRef } from './Dues'

const RATE_ROWS: { kind: DuesRateKind; label: string }[] = [
  { kind: 'common', label: 'Общая' },
  { kind: 'student', label: 'Студенческая' },
  { kind: 'custom', label: 'Своя' },
]

/**
 * Каркас карточки: имя человека, блок текущего месяца и история по месяцам.
 * Имя и название месяца — данные, поэтому под ними полосы; «История» подпись
 * постоянная и остаётся текстом. Ставку и просрочку скелет не рисует: первая
 * видна только dev, вторая — только у должника.
 */
function PersonSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загружаем карточку по взносам">
      <SectionTitle>
        <SkBlock w={104} h={11} />
      </SectionTitle>
      <div className="card">
        <div className="row kv-block">
          <SkBlock w={62} h={15} />
          <SkBlock w={86} h={15} style={{ marginLeft: 'auto' }} />
        </div>
        <Sep inset="text" />
        <div className="row kv-block">
          <SkBlock w={70} h={15} />
          <SkBlock w={74} h={15} style={{ marginLeft: 'auto' }} />
        </div>
      </div>
      <SectionTitle>История</SectionTitle>
      <SkRows count={6} tail />
    </div>
  )
}

/**
 * Карточки листаются в порядке разделов «Взносов» (`people` в параметрах): дев сверяет
 * выписку с людьми одного за другим, не возвращаясь в список.
 */
export function DuesPerson() {
  const params = useParams()
  const userId = params.userId as number
  const people = (params.people as DuesRef[] | undefined) ?? null
  const index = people ? people.findIndex((p) => p.userId === userId) : -1
  if (!people || index < 0 || people.length < 2) {
    return (
      <Screen>
        <BackRow label="Взносы" />
        <DuesPage userId={userId} known={people?.[index] ?? null} />
      </Screen>
    )
  }
  return (
    <Screen>
      <Pager
        items={people}
        index={index}
        keyOf={(p) => String(p.userId)}
        onCommit={(i) => setTopParams({ ...params, userId: people[i]!.userId })}
        tone={(p) => {
          const C = palette()
          return mixc(C.bg, avatarTone(p.userId), C.mixp)
        }}
        top={<BackRow label="Взносы" />}
        renderPage={(p) => <DuesPage userId={p.userId} known={p} />}
      />
    </Screen>
  )
}

function DuesPage({ userId, known }: { userId: number; known: DuesRef | null }) {
  // Месяц, отмеченный своим касанием: капсула «внесён» встаёт сразу и держится, пока
  // перечитанная карточка не скажет то же самое.
  const [marked, setMarked] = useState<string | null>(null)
  const { data, error, loading, pending, reload } = useRemote<DuesPersonData | null>(async () => {
    try {
      return await api<DuesPersonData>('dues.person', { userId })
    } catch (err) {
      // «Нет ни в одном периоде» — ответ по существу, а не сбой загрузки: показывать
      // на него «не удалось загрузить, повторить» значит звать чинить исправное.
      if ((err as ApiError).code === 'not_found') return null
      throw err
    }
  }, [userId])

  // Меняется и шапка (она целиком из ответа), и тело; подменяем через Swap только
  // тело — каркас гаснет поверх проявляющейся карточки, а не исчезает в том же кадре.
  // Скелет только на первой загрузке: перезапрос после смены ставки должен
  // обновлять карточку на месте, а не подменять экран.
  const frame = (title: ReactNode, subtitle: ReactNode, body: ReactNode) => (
    <>
      <div data-pager-head>
        <Header title={title} subtitle={subtitle} />
      </div>
      <Swap loading={loading && !data} skeleton={pending ? <PersonSkeleton /> : null}>
        {body}
      </Swap>
    </>
  )

  // Шапка из ответа, а пока его нет — из списка, откуда открыли, если он есть.
  if (loading && !data) {
    return known
      ? frame(known.name, known.username ? `@${known.username}` : 'без ника', null)
      : frame(<SkBlock w={186} h={30} />, <SkBlock w={108} h={14} />, null)
  }
  if (error) return frame('Взносы', undefined, <ErrorState onRetry={reload} />)
  if (!data) return frame('Не нашёл', 'Человека нет ни в одном периоде взносов.', null)

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
    haptic.impact('light')
    const done = await action('dues.rate', { userId: data.user.userId, kind, ...(amount === undefined ? {} : { amount }) }, { quiet: true })
    if (done) reload()
  }

  const confirm = async (periodKey: string) => {
    haptic.impact('light')
    markOwnTap()
    setMarked(periodKey)
    const done = await action('dues.confirm', { periodKey, userId: data.user.userId }, { quiet: true })
    if (!done) setMarked(null)
    else reload()
  }
  const clear = async (periodKey: string) => {
    haptic.impact('light')
    setMarked(null)
    const done = await action('dues.clear', { periodKey, userId: data.user.userId }, { quiet: true })
    if (done) reload()
  }
  const isPaid = (m: { periodKey: string; status: string }): boolean => m.status === 'paid' || marked === m.periodKey

  // Статус месяца: у дева неотмеченный месяц - кнопка, своё касание перетекает в «внесён».
  const status = (m: (typeof data.months)[number], cta: boolean) => {
    const paid = isPaid(m)
    const tag =
      m.status === 'claimed' && !paid ? (
        <span className="ob-tag gray">ждёт сверки</span>
      ) : (
        <span className="ob-tag warn">не внесён</span>
      )
    return (
      <span className={'dues-st' + (marked === m.periodKey ? ' own' : '')}>
        {data.canEdit && cta ? (
          <ActionButton className={'host-btn' + (paid ? ' gone' : '')} onClick={() => confirm(m.periodKey)}>
            {m.status === 'claimed' ? 'Подтвердить' : 'Отметить'}
          </ActionButton>
        ) : (
          <span className={paid ? 'gone' : undefined}>{tag}</span>
        )}
        <span className={'ob-tag green' + (paid ? '' : ' gone')}>внесён</span>
      </span>
    )
  }

  return frame(
    data.user.name,
    data.user.username ? `@${data.user.username}` : 'без ника',
    <>
      {current ? (
        <>
          <div className="section-title dues-sec">
            <span>{current.label}</span>
            {data.rate.amount > 0 ? <DebtBadge missed={data.missed} /> : null}
          </div>
          <div className="card dues-kv">
            <div className="row kv-block">
              <span className="kv-key">Ставка</span>
              <span className="kv-val">{money(current.amount, data.currency)}</span>
            </div>
            <Sep inset="text" />
            <div className="row kv-block">
              <span className="kv-key">
                Статус
                {current.status === 'paid' && current.at ? (
                  <span className="kv-sub">
                    {`${fmtIsoDay(current.at)}${current.by ? ` · подтвердил ${userLabel(current.by)}` : ''}`}
                  </span>
                ) : null}
              </span>
              {status(current, true)}
            </div>
            <Collapse open={data.debt > 0}>
              <Sep inset="text" />
              <div className="row kv-block">
                <span className="kv-key">Долг с учётом прошлых</span>
                <span className="kv-val">{money(data.debt, data.currency)}</span>
              </div>
            </Collapse>
          </div>
        </>
      ) : null}

      {data.canEdit ? (
        <>
          <SectionTitle>Ставка</SectionTitle>
          <div className="card">
            {RATE_ROWS.map((r, i) => (
              <Fragment key={r.kind}>
                {i > 0 ? <Sep inset="text" /> : null}
                <button type="button" className="row tappable" onClick={() => void setRate(r.kind)}>
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
                  <RadioCheck on={data.rate.kind === r.kind} />
                </button>
              </Fragment>
            ))}
          </div>
          <Footnote>«Своя» это фиксированное число: общая и студенческая ставки на неё больше не влияют.</Footnote>
        </>
      ) : null}

      <SectionTitle>История</SectionTitle>
      <div className="card">
        {data.months.map((m, i) => {
          const paid = isPaid(m)
          const row = (
            <div className="row">
              <span className="row-label">
                {m.label}
                {m.at ? (
                  <span className="row-sublabel">
                    {`${fmtIsoDay(m.at)}${m.by ? ` · подтвердил ${userLabel(m.by)}` : ''}`}
                  </span>
                ) : null}
              </span>
              <div className="row-right">
                {/* Отмеченный своим касанием остаётся капсулой, в которую перетёк; сумма у прежних. */}
                {paid && marked !== m.periodKey ? (
                  <span className="dues-amount paid">{money(m.amount, data.currency)}</span>
                ) : (
                  status(m, true)
                )}
              </div>
            </div>
          )
          return (
            <Fragment key={m.periodKey}>
              {i > 0 ? <Sep inset="text" /> : null}
              {/* Снять отметку можно только свайпом: случайный тап молча её снимал. */}
              {data.canEdit && m.status === 'paid' ? (
                <SwipeRow
                  actions={[{ key: 'undo', label: 'Снять отметку', icon: swipeIcons.undo(), tone: 'red', onSelect: () => void clear(m.periodKey) }]}
                >
                  {row}
                </SwipeRow>
              ) : (
                row
              )}
            </Fragment>
          )
        })}
      </div>
    </>,
  )
}
