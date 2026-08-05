import { DevChips, Header } from 'endpoint-robot-webapp'

/** Дев-панель в шапке: переключатель перспективы и вход в дев-меню.
    Видна только аккаунтам из DEV_USER_IDS — у остальных компонент отдаёт null. */
export const InHeader = () => (
  <Header title="Ближайшая неделя" subtitle="Резидентский обзор" chip={<DevChips />} />
)
