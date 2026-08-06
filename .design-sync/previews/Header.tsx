import { Header } from 'endpoint-robot-webapp'

export const Title = () => <Header title="Ближайшая неделя" />

export const WithSubtitle = () => (
  <Header title="Мои визиты" subtitle="Заявка живёт, пока её кто-то не захостит" />
)

export const WithChip = () => (
  <Header
    title="День"
    subtitle="Среда, 5 августа"
    chip={<div className="dev-chips"><div className="dev-chip">Как гость</div></div>}
  />
)
