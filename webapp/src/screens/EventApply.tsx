// Гость подаёт (или правит) заявку на ивент по его форме. Одна заявка на ивент:
// если она уже есть — режим правки (пока на рассмотрении) либо чтение (если принята).

import { useMemo, useState } from 'react'
import { action } from '../api'
import { fmtShortDate } from '../dates'
import { confirmDialog } from '../modals'
import { pop, useParams } from '../store'
import { haptic } from '../telegram'
import type { SpaceEvent } from '../types'
import { BackRow, Footnote, Header, SectionTitle } from '../components/common'
import { FormFill, isFormComplete, type AnswerMap } from '../components/FormFill'
import { Screen } from '../components/Screen'

export function EventApply() {
  const params = useParams()
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

  const submit = async (): Promise<void> => {
    if (!complete || readOnly) return
    const done = app
      ? await action('event.apply.edit', { id: app.id, answers })
      : await action('event.apply', { eventId: event.id, answers })
    if (done) {
      haptic('success')
      pop()
    }
  }

  const cancel = async (): Promise<void> => {
    if (!app) return
    const ok = await confirmDialog(readOnly ? 'Отменить участие в ивенте?' : 'Отменить заявку на ивент?', {
      confirmLabel: readOnly ? 'Отменить участие' : 'Отменить заявку',
      cancelLabel: 'Оставить',
      destructive: true,
    })
    if (!ok) return
    const done = await action('event.apply.cancel', { id: app.id })
    if (done) {
      haptic('warning')
      pop()
    }
  }

  const title = app ? (readOnly ? 'Вы участвуете' : 'Ваша заявка') : 'Заявка на ивент'

  return (
    <Screen>
      <BackRow label={params.backLabel || 'Ивент'} />
      <Header title={title} subtitle={`${event.title} · ${fmtShortDate(event.dateKey)} в ${event.time}`} />

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
