import { Header } from 'endpoint-robot-webapp'

/** Крупный заголовок экрана — 34/800, как в нативных списках iOS. */
export const Title = () => <Header title="Ближайшая неделя" />

/** С подзаголовком: одна строка объяснения под заголовком. */
export const WithSubtitle = () => (
  <Header title="Мои визиты" subtitle="Заявка живёт, пока её кто-то не захостит" />
)

/** Со слотом справа сверху: туда уходят чипы (дев-панель, режим просмотра). */
export const WithChip = () => (
  <Header
    title="День"
    subtitle="Среда, 5 августа"
    chip={<div className="dev-chips"><div className="dev-chip">Как гость</div></div>}
  />
)
