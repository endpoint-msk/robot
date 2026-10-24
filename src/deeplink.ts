// Адрес места в миниаппе для кнопок бота. В личке web_app-кнопка открывает миниапп ровно
// по своему URL, и адрес едет в query `to`; в группах web_app-кнопки запрещены, и ссылка
// t.me несёт тот же адрес в `startapp`. Разбирает его webapp/src/deeplink.ts.
//
// Адрес только выбирает экран: права проверяет сервер на каждом запросе, как всегда.
// Сообщение с кнопкой живёт в истории вечно, поэтому протухший адрес (заявку отменили,
// день прошёл, ивент удалили) миниапп молча меняет на ближайшее живое место.
//
// Символы только те, что Telegram пропускает в `startapp`: латиница, цифры, `_` и `-`.
// Id заявок и ивентов это UUID, ключ дня YYYY-MM-DD, оба в набор укладываются.

/** Экран дня у резидента. */
export const dayTarget = (dateKey: string): string => `day-${dateKey}`

/** Заявка: резидент попадает в её день, и строка вспыхивает, гость в свой визит. */
export const requestTarget = (id: string): string => `req-${id}`

/** Форма заявки на день (без дня на первый открытый). Резидент попадает в сам день. */
export const newRequestTarget = (dateKey?: string): string => (dateKey ? `new-${dateKey}` : 'new')

export const eventTarget = (id: string): string => `event-${id}`

/** Заявки по форме у рецензента ивента. */
export const eventAppsTarget = (id: string): string => `apps-${id}`

export const DUES_TARGET = 'dues'

/** URL web_app-кнопки в личке. */
export const webappAt = (webappUrl: string, target: string): string => `${webappUrl}?to=${target}`

/** Ссылка для группы: `botLink` вида https://t.me/<бот>, открывается его Main Mini App. */
export const startappAt = (botLink: string, target: string): string => `${botLink}?startapp=${target}`
