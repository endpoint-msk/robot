import { MacSheet } from 'endpoint-robot-webapp'

// Шторка открывается порталом в body поверх всего экрана, отсюда single-карточка.
// Вкладка платформы берётся из клиента Telegram или userAgent, пропом не задаётся.

export const Open = () => <MacSheet onClose={() => {}} />
