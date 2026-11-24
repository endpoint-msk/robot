import type { ChatMember, TelegramClient } from '@mtcute/node'
import { audit, auditUser } from './audit.js'
import { startHeartbeatInterval } from './health.js'
import { grantIssuesPosting, knownIssuesUser, rememberIssuesUser, removeFormerIssuesMember } from './issues-access.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'

export const reconcileIssuesChannel = async (
    client: TelegramClient, residents: ResidentDirectory, storage: Storage, channelId: number,
): Promise<void> => {
    const roster = await residents.list()
    if (!roster.complete) {
        console.warn('[issues] состав резидентов прочитан не целиком, сверка отложена')
        return
    }
    const residentIds = new Set(roster.users.map((user) => user.userId))
    const members: ChatMember[] = []
    // Removing members while paging shifts Telegram's offsets and can skip the next participant.
    for await (const member of client.iterChatMembers(channelId)) {
        if (member.isMember && !member.user.isBot) members.push(member)
    }
    for (const member of members) {
        const userId = member.user.id
        try {
            if (residentIds.has(userId)) {
                await rememberIssuesUser(storage, channelId, userId)
                if (member.status === 'member' && await grantIssuesPosting(client, residents, channelId, userId)) {
                    audit({ action: 'issues.grant', actor: auditUser(member.user), text: 'получил право публиковать в канале «ищью»' })
                }
            } else if (knownIssuesUser(storage, channelId, userId) && await removeFormerIssuesMember(client, residents, channelId, userId)) {
                audit({ action: 'issues.remove', actor: auditUser(member.user), text: 'исключён из канала «ищью» после потери резидентства' })
            }
        } catch (err) {
            console.error(`[issues] не удалось сверить права участника ${userId}:`, err)
        }
    }
}

export const startIssuesReconciler = (
    client: TelegramClient, residents: ResidentDirectory, storage: Storage, channelId: number,
): { stop: () => void } => {
    let running = false
    const sync = async () => {
        if (running) return
        running = true
        try {
            await reconcileIssuesChannel(client, residents, storage, channelId)
        } finally {
            running = false
        }
    }
    void sync().catch((err) => console.error('[issues] не удалось сверить состав при запуске:', err))
    return startHeartbeatInterval('issues', 60 * 60_000, sync, '[issues]')
}
