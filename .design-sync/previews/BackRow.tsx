import { BackRow, Header } from 'endpoint-robot-webapp'

export const Default = () => <BackRow label="Неделя" />

export const AboveHeader = () => (
  <>
    <BackRow label="Мои визиты" />
    <Header title="Визит" subtitle="Пятница, 7 августа · к 17:00" />
  </>
)
