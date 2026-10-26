// Карточка резидента по взносам: просрочка, ставка и вся история по месяцам.
// Читают все резиденты, меняют ставку и закрывают месяцы только dev.

import { Fragment, type ReactNode } from 'react'
import { action, api } from '../api'
import { fmtIsoDay } from '../dates'
import { money } from '../format'
import { icons } from '../icons'
import { numberPrompt } from '../modals'
import { useRemote } from '../remote'
import { mixc, palette } from '../motion'
import { setTopParams, useParams } from '../store'
import { haptic } from '../telegram'
import { accent } from '../theme'
import { ApiError, type DuesPerson as DuesPersonData, type DuesRateKind } from '../types'
import { BackRow, ErrorState, Footnote, Header, SectionTitle, Sep } from '../components/common'
import { avatarTone, userLabel } from '../components/people'
import { Pager } from '../components/Pager'
import { Screen } from '../components/Screen'
import { Swap } from '../components/Swap'
import { SkBlock, SkRows } from '../components/skeleton'
import { debtWord, type DuesRef } from './Dues'

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
        <Sep left={14} />
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

  const toggleMonth = async (periodKey: string, paid: boolean) => {
    haptic.impact('light')
    const done = await action(paid ? 'dues.clear' : 'dues.confirm', { periodKey, userId: data.user.userId }, { quiet: true })
    if (done) reload()
  }

  return frame(
    data.user.name,
    data.user.username ? `@${data.user.username}` : 'без ника',
    <>
      {data.missed > 0 && data.rate.amount > 0 ? (
        <div className={'status-card debt-card ' + (data.missed >= 2 ? 'crit' : 'warn')}>
          <div className="status-card-head">
            <div className="status-card-icon">
              {data.missed >= 2 ? icons.stopSign(15, '#fff') : icons.warnTriangle(15, '#fff')}
            </div>
            <div className="status-card-title">{`${debtWord(data.missed)} без взноса`}</div>
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
          <div className="card dues-kv">
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
                  <div className="radio-check">{data.rate.kind === r.kind ? icons.check(16, accent(), 2.2) : null}</div>
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
          const inner = (
            <>
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
            </>
          )
          return (
            <Fragment key={m.periodKey}>
              {i > 0 ? <Sep left={14} /> : null}
              {/* Строка кликабельна только у dev — остальным это справка, и кнопка
                  обещала бы действие, которого нет. */}
              {data.canEdit ? (
                <button
                  type="button"
                  className="row tappable"
                  onClick={() => void toggleMonth(m.periodKey, m.status === 'paid')}
                >
                  {inner}
                </button>
              ) : (
                <div className="row">{inner}</div>
              )}
            </Fragment>
          )
        })}
      </div>
      {data.canEdit ? <Footnote>Тап по месяцу закрывает его задним числом: деньги нередко доносят позже.</Footnote> : null}
    </>,
  )
}
