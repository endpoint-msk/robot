export type Donation = {
    /** Telegram username (без @) или произвольная строка-ник, как ввёл админ. */
    nick: string
    /** Сумма в условных единицах (RUB по умолчанию). */
    amount: number
    /** Когда добавили (ISO). Чисто для истории. */
    addedAt: string
}

export type Fundraiser = {
    /** Машинный ключ периода: "2026-06". */
    periodKey: string
    /** Год периода. */
    year: number
    /** Месяц периода (1..12). */
    month: number
    /** Цель в условных единицах. 0 — цель не задана, прогрессбар выводится по сумме относительно неё, иначе показывается «без цели». */
    goal: number
    /** Валюта (для отображения). */
    currency: string
    /** Тема сбора, например «аренду». */
    title: string
    donations: Donation[]
}

/** Координаты последнего «живого» сообщения сбора в чате. */
export type LastFundraiserMessage = {
    chatId: number
    messageId: number
    /** Какой период отрисован в этом сообщении. Если изменился — авто-обновление перерисует под актуальный. */
    periodKey: string
}

export type State = {
    /** Все сборы, ключ — periodKey. */
    fundraisers: Record<string, Fundraiser>
    /** Последнее сообщение со сбором в каждом чате (ключ — chatId как строка). */
    lastMessages: Record<string, LastFundraiserMessage>
    /** Резиденты, отметившиеся в хакерспейсе. Ключ — userId. */
    presence: Record<string, ResidentPresence>
    /** Когда в чате последний раз было «обычное» сообщение (от пользователя, не от бота). Ключ — chatId. */
    chatLastActivity: Record<string, string>
    /** ID последнего сообщения со списком присутствующих в каждом чате (для редактирования вместо нового). */
    presenceListMessages: Record<string, number>
    /** Когда сообщение со списком было ОТПРАВЛЕНО (не отредактировано) в каждом чате (ISO). Используется, чтобы при checkin/checkout
     *  публиковать новое сообщение, если предыдущее «протухло» — иначе апдейт никто не увидит. */
    presenceListPostedAt: Record<string, string>
    /** userId, попросивших уведомить в личку по окончании текущей печати. Чистится после уведомления. */
    printerSubscribers: Record<string, true>
}

/** Отметка резидента, что он сейчас внутри хакерспейса. */
export type ResidentPresence = {
    userId: number
    /** Имя для отображения в списке: либо @username, либо «Без ника» (если пользователь так выбрал). */
    displayLabel: string
    /** Username, если есть и пользователь не выбрал «без ника». */
    username: string | null
    /** Когда отметился (ISO). */
    checkedInAt: string
    /** Когда последний раз подтвердил присутствие через ping (ISO). При первой отметке = checkedInAt. */
    lastConfirmedAt: string
    /** Когда был отправлен последний ping в личку, на который мы ждём ответ. null — нет открытого ping'а. */
    pendingPingAt: string | null
}

export const emptyState = (): State => ({
    fundraisers: {},
    lastMessages: {},
    presence: {},
    chatLastActivity: {},
    presenceListMessages: {},
    presenceListPostedAt: {},
    printerSubscribers: {},
})
