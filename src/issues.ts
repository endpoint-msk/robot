import { filters, type Dispatcher } from '@mtcute/dispatcher'
import { BotKeyboard, type TelegramClient } from '@mtcute/node'
import { tr } from './i18n.js'
import type { ResidentDirectory } from './residents.js'

export type CreateIssuesInvite = (userId: number) => Promise<string | null>

const residentOnly = (): string =>
    tr('Канал «ищью» доступен резидентам спейса.', 'The Issues channel is for residents of the space.')

export const issuesDescription = (): string => tr(
    'В канале «ищью» резиденты обсуждают вопросы, предложения и задачи спейса. Опубликуй свой пост с одним вопросом и обсуди его в комментариях. Когда договоритесь, отредактируй свой пост и добавь решение.',
    'Residents use the Issues channel to discuss questions, proposals, and tasks for the space. Publish your own post about one topic and discuss it in the comments. Once you agree on an outcome, edit your post to record it.',
)

export const issuesInviteTerms = (): string => tr(
    'Ссылка действует час и рассчитана на одного участника.',
    'The link is valid for one hour and admits one person.',
)

export const issuesInviteButton = (link: string) =>
    BotKeyboard.url(tr('Вступить в канал «ищью»', 'Join the Issues channel'), link)

export const createIssuesInvite = async (client: TelegramClient, channelId: number): Promise<string> => {
    const invite = await client.createInviteLink(channelId, { usageLimit: 1, expires: Date.now() + 60 * 60_000 })
    return invite.link
}

export const sendIssuesInvite = async (client: TelegramClient, userId: number, createInvite: CreateIssuesInvite): Promise<void> => {
    let link: string | null
    try {
        link = await createInvite(userId)
    } catch (err) {
        console.error('[issues] не удалось создать приглашение:', err)
        await client.sendText(userId, tr('Не удалось создать ссылку. Попробуй /issues позже.', 'Could not create an invite link. Try /issues again later.'))
        return
    }
    if (link === null) {
        await client.sendText(userId, residentOnly())
        return
    }
    await client.sendText(userId, [issuesDescription(), issuesInviteTerms()].join('\n\n'), {
        replyMarkup: BotKeyboard.inline([[issuesInviteButton(link)]]),
    })
}

export const registerIssuesHandlers = (
    dp: Dispatcher,
    deps: { client: TelegramClient; residents: ResidentDirectory; createInvite: CreateIssuesInvite },
): void => {
    const { client, residents, createInvite } = deps
    dp.onNewMessage(filters.command('issues'), async (msg) => {
        if (msg.chat.type !== 'user' || msg.sender?.type !== 'user') return
        if (!(await residents.isResident(msg.sender.id))) {
            await msg.answerText(residentOnly())
            return
        }
        await sendIssuesInvite(client, msg.sender.id, createInvite)
    })
}
