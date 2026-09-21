import { tl, type TelegramClient } from '@mtcute/node'

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

/** Права админа-резидента в супергруппе (скрин 1): чистка, бан, инвайты, пины. */
const GROUP_RIGHTS: Rights = {
    deleteMessages: true,
    banUsers: true,
    inviteUsers: true,
    pinMessages: true,
}

/**
 * Права админа-резидента в broadcast-канале (скрин 2): постинг, инвайты, трансляции, бан.
 *
 * «Доступ к сообщениям канала» со скрина намеренно не включён: это новое право на монофорум
 * личных сообщений канала (`manageDirectMessages`), которого у обычного канала и у самого бота
 * обычно нет, а `channels.editAdmin` отклоняет ВЕСЬ вызов, если просить право, которого нет у
 * бота (`RIGHT_FORBIDDEN`) — то есть один лишний флаг ронял бы всю выдачу админки.
 */
const CHANNEL_RIGHTS: Rights = {
    postMessages: true,
    inviteUsers: true,
    manageCall: true,
    banUsers: true,
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
    /** Текущий тег (поле `rank`). null — тега нет. */
    tag: string | null
}

/**
 * Читает статус человека в чате. Не участник (`USER_NOT_PARTICIPANT`) или нет доступа —
 * возвращаем `present: false`, а не бросаем: «его тут нет» это нормальный ответ, на
 * котором строится ветка «попроси зайти».
 */
export const readMemberState = async (
    client: TelegramClient,
    chatId: number,
    userId: number,
): Promise<MemberState> => {
    try {
        const m = await client.getChatMember({ chatId, userId })
        const status = m?.status ?? null
        const present = status === 'member' || status === 'restricted' || status === 'admin' || status === 'creator'
        return {
            present,
            creator: status === 'creator',
            admin: status === 'admin',
            tag: m?.title ?? null,
        }
    } catch {
        return { present: false, creator: false, admin: false, tag: null }
    }
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
