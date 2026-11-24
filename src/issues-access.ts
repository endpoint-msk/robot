import type { TelegramClient } from '@mtcute/node'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'

export const knownIssuesUser = (storage: Storage, channelId: number, userId: number): boolean => {
    const state = storage.get()
    return Boolean(state.residentOnboarding[userId] || state.issuesChannelAccess[`${channelId}#${userId}`])
}

export const rememberIssuesUser = async (storage: Storage, channelId: number, userId: number): Promise<void> => {
    const key = `${channelId}#${userId}`
    if (!storage.get().issuesChannelAccess[key]) {
        await storage.update((s) => { s.issuesChannelAccess[key] = true })
    }
}

const pending = new Map<string, Promise<boolean>>()

// A membership update can arrive while the hourly reconciliation is changing the same user's rights.
const changeMember = (channelId: number, userId: number, change: () => Promise<boolean>): Promise<boolean> => {
    const key = `${channelId}#${userId}`
    const previous = pending.get(key) ?? Promise.resolve()
    const next = previous.then(change, change).finally(() => {
        if (pending.get(key) === next) pending.delete(key)
    })
    pending.set(key, next)
    return next
}

export const grantIssuesPosting = (
    client: TelegramClient, residents: ResidentDirectory, channelId: number, userId: number,
): Promise<boolean> => changeMember(channelId, userId, async () => {
    if (!(await residents.confirmResidency(userId))) return false
    // Telegram's editAdminRights has no membership precondition.
    const member = await client.getChatMember({ chatId: channelId, userId })
    if (member?.status !== 'member' || member.user.isBot) return false
    await client.editAdminRights({ chatId: channelId, userId, rights: { postMessages: true } })
    return true
})

export const removeFormerIssuesMember = (
    client: TelegramClient,
    residents: ResidentDirectory,
    channelId: number,
    userId: number,
): Promise<boolean> => changeMember(channelId, userId, async () => {
    if (await residents.confirmResidency(userId)) return false
    const member = await client.getChatMember({ chatId: channelId, userId })
    if (!member?.isMember || member.status === 'banned') return false
    if (member.status === 'creator') throw new Error('Владелец канала «ищью» должен сначала передать канал другому участнику.')
    if (member.status === 'admin') {
        if (member.raw._ !== 'channelParticipantAdmin' || !member.raw.canEdit) {
            throw new Error('Бот не может снять права этого администратора в канале «ищью». Их должен снять владелец канала.')
        }
        await client.editAdminRights({ chatId: channelId, userId, rights: {} })
    }
    // kickChatMember uses a permanent ban followed by unban. A timed ban also expires if the bot stops.
    await client.banChatMember({ chatId: channelId, participantId: userId, untilDate: Date.now() + 2 * 60_000 })
    return true
})
