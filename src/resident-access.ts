import type { TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type Dispatcher } from '@mtcute/dispatcher'
import { audit, auditUser } from './audit.js'
import { loginFor, type AuthentikClient, type AuthentikUser } from './authentik.js'
import { startHeartbeatInterval } from './health.js'
import { displayName } from './hosting.js'
import type { OutlineClient } from './outline.js'
import { RESIDENT_TAG, readMemberState, revokeAdmin, setMemberTag, type AdminTarget } from './resident-admin.js'
import type { ResidentDirectory } from './residents.js'

/**
 * Доступы резидента за пределами бота: аккаунт Authentik с группой, вики и права в чатах
 * спейса. Вступил в чат резидентов - аккаунт заводится или включается, вышел - доступ
 * снимается отовсюду, куда бот дотягивается.
 */

export type AccessDeps = {
    client: TelegramClient
    residents: ResidentDirectory
    adminTargets: AdminTarget[]
    authentik: AuthentikClient | null
    outline: OutlineClient | null
}

export type AccountStatus = {
    telegramId: number
    /** null - аккаунта нет. */
    username: string | null
    group: string
    exists: boolean
    active: boolean
    inGroup: boolean
    email: string | null
    error: string | null
}

const reason = (err: unknown): string => {
    const text = err instanceof Error ? err.message : String(err)
    return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

/** null - Authentik не подключён, показывать нечего. */
export const accountStatus = async (deps: AccessDeps, userId: number): Promise<AccountStatus | null> => {
    const { authentik } = deps
    if (!authentik) return null
    const status: AccountStatus = {
        telegramId: userId,
        username: null,
        group: authentik.groupName,
        exists: false,
        active: false,
        inGroup: false,
        email: null,
        error: null,
    }
    try {
        const user = await authentik.findByTelegramId(userId)
        if (!user) return status
        Object.assign(status, { username: user.username, exists: true, active: user.active, email: user.email || null })
        status.inGroup = await authentik.inGroup(user)
    } catch (err) {
        status.error = reason(err)
    }
    return status
}

/**
 * `taken` - логин из ника уже чей-то. Чаще всего это старый аккаунт того же человека,
 * заведённый Authentik при входе через Telegram: второй ему ни к чему, вход всё равно
 * приведёт в старый. Отдать старый боту - вписать ему атрибут `telegram_id`.
 */
export type GrantResult = { kind: 'ok' } | { kind: 'taken'; login: string } | { kind: 'error'; reason: string }

export const takenHint = (login: string, telegramId: number): string =>
    `Логин «${login}» в Authentik уже занят. Если это его старый аккаунт, впиши ему атрибут telegram_id: ${telegramId}.`

/** Завести аккаунт или включить существующий. */
export const grantAccess = async (
    deps: AccessDeps,
    person: { userId: number; name: string; username: string | null },
): Promise<GrantResult> => {
    const { authentik } = deps
    if (!authentik) return { kind: 'ok' }
    try {
        const found = await authentik.findByTelegramId(person.userId)
        if (found) {
            if (!found.active) await authentik.setActive(found.pk, true)
            if (!(await authentik.inGroup(found))) await authentik.addToGroup(found.pk)
            return await unsuspendWiki(deps, found)
        }
        const login = loginFor(person.userId, person.username)
        if (await authentik.loginTaken(login)) return { kind: 'taken', login }
        await authentik.createUser({
            username: login,
            name: person.name,
            email: authentik.emailFor(login),
            telegramId: person.userId,
        })
        return { kind: 'ok' }
    } catch (err) {
        return { kind: 'error', reason: `authentik: ${reason(err)}` }
    }
}

/** Вернулся - вики снова пускает. Новому аккаунту нечего: в вики его ещё нет. */
const unsuspendWiki = async (deps: AccessDeps, user: AuthentikUser): Promise<GrantResult> => {
    if (!deps.outline || !user.email) return { kind: 'ok' }
    try {
        const wiki = await deps.outline.findByEmail(user.email)
        if (wiki?.suspended) await deps.outline.activate(wiki.id)
        return { kind: 'ok' }
    } catch (err) {
        return { kind: 'error', reason: `вики: ${reason(err)}` }
    }
}

/**
 * Выключить аккаунт, отключить в вики и забрать группу. Группу снимаем последней и только
 * если остальное прошло: участник группы, которого нет в чате резидентов, - метка
 * «доступ снят не весь», по ней сверка повторит попытку.
 */
const revokeAccount = async (deps: AccessDeps, telegramId: number, known?: AuthentikUser): Promise<string | null> => {
    const { authentik, outline } = deps
    if (!authentik) return null
    let user: AuthentikUser | null
    try {
        user = known ?? (await authentik.findByTelegramId(telegramId))
        if (!user) return null
        if (user.active) await authentik.setActive(user.pk, false)
    } catch (err) {
        return `authentik: ${reason(err)}`
    }
    if (outline && user.email) {
        try {
            const wiki = await outline.findByEmail(user.email)
            if (wiki && !wiki.suspended) await outline.suspend(wiki.id)
        } catch (err) {
            return `вики: ${reason(err)}`
        }
    }
    try {
        if (await authentik.inGroup(user)) await authentik.removeFromGroup(user.pk)
        return null
    } catch (err) {
        return `authentik: ${reason(err)}`
    }
}

/** Админка и тег резидента. Снять бот может только то, что выдал сам: чужую админку Telegram ему не отдаст. */
const revokeChatRights = async (deps: AccessDeps, userId: number): Promise<string[]> => {
    const { client } = deps
    const failures: string[] = []
    for (const target of deps.adminTargets) {
        const state = await readMemberState(client, target.chatId, userId)
        if (state.error) {
            failures.push(`«${target.label}»: ${state.error}`)
            continue
        }
        if (!state.present) continue
        if (state.creator) {
            failures.push(`«${target.label}»: владелец, его права меняет только Telegram`)
            continue
        }
        let tag = state.tag
        if (state.admin) {
            if (!state.canEdit) {
                failures.push(`«${target.label}»: админку выдал не бот`)
                continue
            }
            try {
                await revokeAdmin(client, target, userId)
            } catch (err) {
                failures.push(`«${target.label}»: ${reason(err)}`)
                continue
            }
            // У админа тег и титул - одно поле, и снятие прав с пустым титулом могло унести его само.
            if (target.canTag && tag !== null) tag = (await readMemberState(client, target.chatId, userId)).tag
        }
        if (target.canTag && tag === RESIDENT_TAG) {
            try {
                await setMemberTag(client, target.chatId, userId, null)
            } catch (err) {
                failures.push(`тег в «${target.label}»: ${reason(err)}`)
            }
        }
    }
    return failures
}

/** Всё сразу, на выходе из чата резидентов. Пустой список - снято отовсюду. */
export const revokeAccess = async (deps: AccessDeps, userId: number): Promise<string[]> => {
    const [account, chats] = await Promise.all([revokeAccount(deps, userId), revokeChatRights(deps, userId)])
    return account === null ? chats : [account, ...chats]
}

/** false - удалять нечего. */
export const deleteAccount = async (deps: AccessDeps, userId: number): Promise<boolean> => {
    const { authentik } = deps
    if (!authentik) return false
    const user = await authentik.findByTelegramId(userId)
    if (!user) return false
    await authentik.deleteUser(user.pk)
    return true
}

const JOINED = ['joined', 'added'] as const
const LEFT = ['left', 'kicked', 'demoted_kicked'] as const

/**
 * Своя группа хендлеров: в одной группе апдейт достаётся первому подходящему, а
 * знакомство (onboarding.ts) вступление дальше не пропускает.
 */
const HANDLER_GROUP = 1

export const registerResidentAccessHandlers = (dp: Dispatcher, deps: AccessDeps & { residentsChatId: number }): void => {
    const { residents, residentsChatId } = deps
    const joined: readonly string[] = JOINED
    dp.onChatMemberUpdate(
        filters.chatMember([...JOINED, ...LEFT]),
        async (upd) => {
            if (upd.chat.id !== residentsChatId) return PropagationAction.Continue
            const user = upd.user
            if (user.isBot) return
            residents.invalidate(user.id)
            const who = user.username ? `@${user.username}` : `id ${user.id}`
            if (joined.includes(upd.type)) {
                if (!deps.authentik) return
                const result = await grantAccess(deps, {
                    userId: user.id,
                    name: displayName(user.displayName),
                    username: user.username,
                })
                const failure =
                    result.kind === 'ok' ? null : result.kind === 'taken' ? takenHint(result.login, user.id) : result.reason
                audit({
                    action: 'access.grant',
                    actor: auditUser(user),
                    text: 'вступил в чат резидентов: бот выдал аккаунт Authentik',
                    ok: failure === null,
                    ...(failure !== null ? { error: failure } : {}),
                    meta: { userId: user.id },
                })
                if (failure !== null) console.error(`[access] ${who} вступил в чат резидентов, но аккаунт не выдан: ${failure}`)
                return
            }
            const failures = await revokeAccess(deps, user.id)
            audit({
                action: 'access.revoke',
                actor: auditUser(user),
                text: 'вышел из чата резидентов: бот снял доступы',
                ok: failures.length === 0,
                ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
                meta: { userId: user.id },
            })
            if (failures.length > 0) {
                console.error(`[access] ${who} вышел из чата резидентов, но снято не всё: ${failures.join('; ')}`)
            } else {
                console.log(`[access] ${who} вышел из чата резидентов, доступы сняты`)
            }
        },
        HANDLER_GROUP,
    )
}

const TICK_INTERVAL_MS = 10 * 60_000
const SYNC_INTERVAL_MS = 60 * 60_000
/** Больше 200 участников Telegram боту за проход не отдаёт: такой состав мог оборваться молча. */
const ROSTER_LIMIT = 200

/**
 * Сверка с составом чата резидентов - на случай, когда бот проспал выход (лежал или
 * терял связь): иначе вышедший так и ходил бы в сервисы. Трогает только участников
 * группы с атрибутом `telegram_id`, права в чатах не сверяет: в Telegram выданное ботом
 * от выданного людьми не отличить.
 */
export const startAccessReconciler = (deps: AccessDeps): { stop: () => void } => {
    /** Ноль - первая сверка уходит на первом же тике: рестарт и есть повод свериться. */
    let lastSyncAt = 0
    let warned = false
    const tick = async (): Promise<void> => {
        const { authentik, residents } = deps
        if (!authentik) return
        const now = Date.now()
        if (now - lastSyncAt < SYNC_INTERVAL_MS) return
        lastSyncAt = now
        const roster = await residents.list()
        if (!roster.complete || roster.users.length === 0 || roster.users.length >= ROSTER_LIMIT) {
            if (!warned) console.warn('[access-sync] состав резидентов прочитан не целиком, сверка аккаунтов пропущена')
            warned = true
            return
        }
        warned = false
        const ids = new Set(roster.users.map((u) => u.userId))
        let members: AuthentikUser[]
        try {
            members = await authentik.groupMembers()
        } catch (err) {
            // Как с принтером: лежащий Authentik не делает бота больным, а пульс ушёл бы в
            // /healthz. Повтор на следующем тике, не через час.
            console.error('[access-sync] Authentik не ответил, сверка отложена:', err)
            lastSyncAt = 0
            return
        }
        for (const member of members) {
            const telegramId = member.telegramId
            if (telegramId === null || ids.has(telegramId)) continue
            // Состав кэшируется на пять минут, и вступивший только что в него ещё не попал.
            if (await residents.isResident(telegramId)) continue
            const failure = await revokeAccount(deps, telegramId, member)
            audit({
                action: 'access.sync',
                actor: { id: telegramId, username: null, name: member.name },
                text: `не в чате резидентов: сверка выключила аккаунт ${member.username}`,
                ok: failure === null,
                ...(failure !== null ? { error: failure } : {}),
                meta: { userId: telegramId },
            })
            if (failure !== null) {
                console.error(`[access-sync] ${member.username} не в чате резидентов, но аккаунт не выключен: ${failure}`)
            } else {
                console.log(`[access-sync] ${member.username} не в чате резидентов, аккаунт выключен`)
            }
        }
    }
    return startHeartbeatInterval('access', TICK_INTERVAL_MS, tick, '[access-sync]')
}
