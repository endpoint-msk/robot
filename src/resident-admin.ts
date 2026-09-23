import { tl, type ChatMember, type TelegramClient } from '@mtcute/node'

/**
 * Выдача резиденту прав в чатах спейса — руками dev'а, по умолчанию ничего.
 *
 * Три цели: «чат» (супергруппа, `MAIN_CHAT_ID`), канал анонсов (`ANNOUNCE_CHANNEL_ID`)
 * и лайв-канал (`LIVE_CHANNEL_ID`). Набор прав определяется **типом** цели, а не её
 * именем: группе идёт `GROUP_RIGHTS`, broadcast-каналу — `CHANNEL_RIGHTS`.
 *
 * Тег резидента (member tag «resident») — отдельная фича, а не «пустая админка с
 * титулом»: он ставится `messages.editChatParticipantRank` (mtcute — `editChatMemberRank`)
 * и не делает человека админом. Ставим его только в «чате».
 */

/** Тег, который показывается рядом с именем участника «чата». */
export const RESIDENT_TAG = 'resident'

export type AdminTargetKind = 'group' | 'channel'

/** Одна цель выдачи прав. `canTag` — можно ли ставить в ней member tag (только «чат»). */
export type AdminTarget = {
    /** Стабильный ключ для API/журнала: 'main' | 'announce' | 'live'. */
    key: string
    chatId: number
    kind: AdminTargetKind
    /** Человекочитаемое имя цели для миниаппа и журнала. */
    label: string
    canTag: boolean
}

type Rights = Omit<tl.RawChatAdminRights, '_'>

/** Права админа-резидента в супергруппе: чистка, бан, инвайты, пины. */
const GROUP_RIGHTS: Rights = {
    deleteMessages: true,
    banUsers: true,
    inviteUsers: true,
    pinMessages: true,
}

/**
 * Права админа-резидента в broadcast-канале. Бот сам должен иметь каждое из них, включая
 * `manageDirectMessages`: `channels.editAdmin` отклоняет весь вызов (`RIGHT_FORBIDDEN`),
 * если просить право, которого нет у бота.
 */
const CHANNEL_RIGHTS: Rights = {
    postMessages: true,
    inviteUsers: true,
    banUsers: true,
    manageDirectMessages: true,
}

const rightsFor = (kind: AdminTargetKind): Rights => (kind === 'group' ? GROUP_RIGHTS : CHANNEL_RIGHTS)

/** Собирает список целей из заданных env-переменных. Незаданная — просто не появляется. */
export const buildAdminTargets = (ids: {
    mainChatId: number | null
    announceChannelId: number | null
    liveChannelId: number | null
}): AdminTarget[] => {
    const targets: AdminTarget[] = []
    if (ids.mainChatId !== null) {
        targets.push({ key: 'main', chatId: ids.mainChatId, kind: 'group', label: 'Чат', canTag: true })
    }
    if (ids.announceChannelId !== null) {
        targets.push({ key: 'announce', chatId: ids.announceChannelId, kind: 'channel', label: 'Канал анонсов', canTag: false })
    }
    if (ids.liveChannelId !== null) {
        targets.push({ key: 'live', chatId: ids.liveChannelId, kind: 'channel', label: 'Лайв-канал', canTag: false })
    }
    return targets
}

/** Текущее положение человека в конкретном чате. */
export type MemberState = {
    /** Состоит в чате (участник/админ/владелец). false — левый/забанен/вовсе не участник. */
    present: boolean
    /** Владелец: его права меняет только Telegram, кнопки к нему не применяем. */
    creator: boolean
    /** Уже админ (не владелец). */
    admin: boolean
    /** Telegram даёт боту править только назначенных им самим админов. */
    canEdit: boolean
    /** Текущий тег (поле `rank`). null — тега нет. */
    tag: string | null
    /** Код ошибки Telegram, если статус прочитать не удалось. */
    error: string | null
}

const errorText = (err: unknown): string => {
    const text = (err as { text?: unknown } | null)?.text
    return typeof text === 'string' ? text : 'UNKNOWN'
}

const toState = (m: ChatMember): MemberState => {
    const status = m.status
    const raw = m.raw as { _: string; canEdit?: boolean }
    return {
        present: status === 'member' || status === 'restricted' || status === 'admin' || status === 'creator',
        creator: status === 'creator',
        admin: status === 'admin',
        canEdit: status !== 'admin' || raw._ !== 'channelParticipantAdmin' || raw.canEdit === true,
        tag: m.title,
        error: null,
    }
}

const ABSENT: MemberState = { present: false, creator: false, admin: false, canEdit: true, tag: null, error: null }

/**
 * Одиночный `getChatMember` страхуется списком админов: он идёт другим методом и видит
 * админов, назначенных не ботом. Ошибка обоих — не «его тут нет», а `error`, иначе
 * вызывающий попросил бы зайти человека, который уже в чате.
 */
export const readMemberState = async (
    client: TelegramClient,
    chatId: number,
    userId: number,
): Promise<MemberState> => {
    let single: MemberState | null = null
    let failure: unknown = null
    try {
        const m = await client.getChatMember({ chatId, userId })
        single = m ? toState(m) : ABSENT
        if (single.present) return single
    } catch (err) {
        failure = err
    }
    try {
        const admins = await client.getChatMembers(chatId, { type: 'admins' })
        const found = admins.find((m) => m.user.id === userId)
        if (found) return toState(found)
    } catch (err) {
        failure ??= err
    }
    if (single) return single
    console.error(`[admin] не удалось прочитать статус ${userId} в ${chatId}:`, failure)
    return { ...ABSENT, error: errorText(failure) }
}

/**
 * Выдать админку. `rank` сохраняем текущим тегом: `editAdminRights` всегда шлёт `rank`
 * (дефолт `''`), а в супергруппе тег и титул админа — одно поле, поэтому наивный промоут
 * затёр бы тег «resident». Тег остаётся источником правды для этой строки.
 */
export const grantAdmin = async (
    client: TelegramClient,
    target: AdminTarget,
    userId: number,
    preserveTag: string | null,
): Promise<void> => {
    await client.editAdminRights({
        chatId: target.chatId,
        userId,
        rights: rightsFor(target.kind),
        rank: preserveTag ?? '',
    })
}

/** Снять админку: пустые права = демоут до обычного участника. */
export const revokeAdmin = async (client: TelegramClient, target: AdminTarget, userId: number): Promise<void> => {
    await client.editAdminRights({ chatId: target.chatId, userId, rights: {} })
}

/** Поставить (`tag`) или снять (`null`) member tag участника. */
export const setMemberTag = async (
    client: TelegramClient,
    chatId: number,
    userId: number,
    tag: string | null,
): Promise<void> => {
    await client.editChatMemberRank({ chatId, participantId: userId, rank: tag })
}
