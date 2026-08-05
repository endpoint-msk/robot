import { BackRow, Header } from 'endpoint-robot-webapp'

/** Возврат на предыдущий экран: шеврон + имя того экрана, куда вернёмся. */
export const Default = () => <BackRow label="Неделя" />

/** Над заголовком — так он и стоит на каждом вложенном экране. */
export const AboveHeader = () => (
  <>
    <BackRow label="Мои визиты" />
    <Header title="Визит" subtitle="Пятница, 7 августа · к 17:00" />
  </>
)
