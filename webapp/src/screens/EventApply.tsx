// Гость подаёт (или правит) заявку на ивент по его форме. Одна заявка на ивент:
// если она уже есть — режим правки (пока на рассмотрении) либо чтение (если принята).

import { useContext, useEffect, useMemo, useState } from 'react'
import { action } from '../api'
import { weekdayIdx, WEEKDAYS_FULL } from '../dates'
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
    offerUndo(readOnly ? 'Участие отменено' : 'Заявка отменена', done.undo)
  }

  const title = app ? (readOnly ? 'Вы участвуете' : 'Ваша заявка') : 'Заявка на ивент'
  const when = `${WEEKDAYS_FULL[weekdayIdx(event.dateKey)]!.toLowerCase()}, в ${event.time}, ${untilWord(data!.todayKey, event.dateKey)}`

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
            ? 'Заявка принята — вы в списке участников. Можно отменить участие.'
            : 'Заявка на рассмотрении. Пока её не приняли, ответы можно менять.'}
        </Footnote>
      ) : (
        <Footnote>Заполните форму организатора — резиденты рассмотрят заявку и ответят в личке.</Footnote>
      )}

      <SectionTitle>Форма</SectionTitle>
      <div className="card">
        <FormFill fields={fields} value={answers} disabled={readOnly} onChange={setAnswers} />
      </div>

      {!readOnly ? (
        <button className="primary-btn" style={{ marginTop: 22 }} disabled={!complete} onClick={submit}>
          {app ? 'Сохранить' : 'Отправить заявку'}
        </button>
      ) : null}
      {app ? (
        <button className="destructive-btn" style={{ marginTop: 14 }} onClick={cancel}>
          {readOnly ? 'Отменить участие' : 'Отменить заявку'}
        </button>
      ) : null}
    </Screen>
  )
}
