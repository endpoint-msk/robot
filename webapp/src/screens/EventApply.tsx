// Гость подаёт (или правит) заявку на ивент по его форме. Одна заявка на ивент:
// если она уже есть — режим правки (пока на рассмотрении) либо чтение (если принята).

import { tr } from '../i18n'
import { useContext, useEffect, useMemo, useState } from 'react'
import { action } from '../api'
import { weekdayIdx, weekdaysFull } from '../dates'
import { afterHero } from '../hero'
import { markOwnTap, stageTint, toHex, toneColors } from '../motion'
import { UnderContext } from '../screenContext'
import { getState, pop, useParams, useStore } from '../store'
import { haptic, setHeaderColor } from '../telegram'
import { applyTheme } from '../theme'
import { offerUndo, type Undoable } from '../undo'
import type { SpaceEvent } from '../types'
import { BackRow, Footnote, Header, SectionTitle } from '../components/common'
import { eventTone, toneVars } from '../components/EventRow'
import { FormFill, isFormComplete, type AnswerMap } from '../components/FormFill'
import { Screen } from '../components/Screen'
import { DateTile, untilWord } from './Event'

export function EventApply() {
  const params = useParams()
  const { data } = useStore()
  const event = params.event as SpaceEvent
  const fields = event.form?.fields ?? []
  const app = event.myApplication ?? null
  const readOnly = app?.status === 'approved'

  // Прежние ответы: choice хранит подписи (снимок) — восстанавливаем id по совпадению подписи.
  const initial = useMemo<AnswerMap>(() => {
    const map: AnswerMap = {}
    for (const ans of app?.answers ?? []) {
      const field = fields.find((f) => f.id === ans.fieldId)
      if (!field) continue
      if (field.type === 'text') map[field.id] = { text: ans.text ?? '' }
      else {
        const labels = ans.choiceLabels ?? []
        const ids = (field.options ?? []).filter((o) => labels.includes(o.label)).map((o) => o.id)
        map[field.id] = { optionIds: ids, ...(ans.writeIn ? { writeIn: ans.writeIn } : {}) }
      }
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [answers, setAnswers] = useState<AnswerMap>(initial)
  const complete = isFormComplete(fields, answers)

  // Форма открывается шапкой ивента: полоса в тон афиши, как на экране ивента, и шапка
  // Telegram того же цвета. На выходе её возвращает тема, а ивент под формой красит заново.
  const tone = eventTone(event)
  const header = tone ? toneColors(tone).band : toHex(stageTint('purple'))
  const under = useContext(UnderContext)
  useEffect(() => {
    if (!under) afterHero(() => setHeaderColor(header))
  }, [header, under])
  useEffect(
    () => () => {
      if (!under) afterHero(() => applyTheme(getState().theme))
    },
    [under],
  )

  const submit = async (): Promise<void> => {
    if (!complete || readOnly) return
    const done = app
      ? await action('event.apply.edit', { id: app.id, answers })
      : await action('event.apply', { eventId: event.id, answers })
    if (done) {
      haptic.notify('success')
      pop()
    }
  }

  // Без вопроса: отмена обратима, внизу пять секунд висит «Вернуть».
  const cancel = async (): Promise<void> => {
    if (!app) return
    markOwnTap()
    haptic.impact('medium')
    const done = (await action('event.apply.cancel', { id: app.id }, { quiet: true })) as Undoable | null
    if (!done) return
    pop()
    offerUndo(readOnly ? tr('Участие отменено', 'Attendance canceled') : tr('Заявка отменена', 'Application withdrawn'), done.undo)
  }

  const title = app ? (readOnly ? tr('Вы участвуете', 'You’re attending') : tr('Ваша заявка', 'Your request')) : tr('Заявка на ивент', 'Event application')
  const weekday = weekdaysFull()[weekdayIdx(event.dateKey)]!
  const until = untilWord(data!.todayKey, event.dateKey)
  const when = tr(`${weekday.toLowerCase()}, в ${event.time}, ${until}`, `${weekday} at ${event.time} · ${until}`)

  return (
    <Screen>
      <div className="evv-top eva-top" style={toneVars(tone)}>
        <div className="evv-band" aria-hidden="true" />
        <BackRow />
        <Header title={title} />
        <div className="evv-when">
          <DateTile dateKey={event.dateKey} />
          <div className="evv-when-text">
            <div className="evv-wt">{event.title}</div>
            <div className="evv-ws">{when}</div>
          </div>
        </div>
      </div>

      {app ? (
        <Footnote>
          {readOnly
            ? tr('Заявка принята — вы в списке участников. Можно отменить участие.', 'Your application was accepted and you’re on the guest list. You can cancel your attendance.')
            : tr('Заявка на рассмотрении. Пока её не приняли, ответы можно менять.', 'Your application is pending. You can edit your answers until it’s accepted.')}
        </Footnote>
      ) : (
        <Footnote>{tr('Заполните форму организатора — резиденты рассмотрят заявку и ответят в личке.', 'Fill out the organizer’s form. Residents will review your application and reply in a private message.')}</Footnote>
      )}

      <SectionTitle>{tr('Форма', 'Application form')}</SectionTitle>
      <div className="card">
        <FormFill fields={fields} value={answers} disabled={readOnly} onChange={setAnswers} />
      </div>

      {!readOnly ? (
        <button className="primary-btn" style={{ marginTop: 22 }} disabled={!complete} onClick={submit}>
          {app ? tr('Сохранить', 'Save') : tr('Отправить заявку', 'Submit application')}
        </button>
      ) : null}
      {app ? (
        <button className="destructive-btn" style={{ marginTop: 14 }} onClick={cancel}>
          {readOnly ? tr('Отменить участие', 'Cancel attendance') : tr('Отменить заявку', 'Withdraw application')}
        </button>
      ) : null}
    </Screen>
  )
}
