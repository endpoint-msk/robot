import { BotKeyboard, html, type MessageForwardInfo, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type Dispatcher } from '@mtcute/dispatcher'
import {
    clearEventDraft,
    draftPhotoId,
    MAX_EVENT_PHOTO_BYTES,
    saveEventDraft,
    saveEventPhoto,
    splitPostText,
} from './events.js'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'

/**
 * Ссылка на исходный пост. У публичного канала это `t.me/<ник>/<id поста>`, у
 * закрытого — `t.me/c/<id канала>/<id поста>`: она откроется только у подписчиков,
 * но других ссылок у закрытого канала и нет.
 *
 * Id поста берём из `raw.channelPost`: `fromMessageId` в mtcute — это `savedFromMsgId`,
 * он заполняется только у пересылок в «Избранное».
 */
const postUrlFrom = (fwd: MessageForwardInfo, channelId: number): string | null => {
    const postId = fwd.raw.channelPost
    if (!postId) return null
    const sender = fwd.sender
    const username = 'username' in sender ? sender.username : null
    if (username) return `https://t.me/${username}/${postId}`
    // -100 — префикс каналов в chatId; в ссылке идёт внутренний id, без него.
    return `https://t.me/c/${String(Math.abs(channelId)).replace(/^100/, '')}/${postId}`
}

/**
 * Приём анонсов из канала: резидент пересылает боту в личку пост из
 * `ANNOUNCE_CHANNEL_ID`, бот вытаскивает текст и картинку и предлагает сделать из
 * этого ивент. Кнопка открывает миниапп с уже заполненным редактором.
 *
 * Смысл в том, что анонс уже написан в канале — перепечатывать его в форму никто не
 * станет, и ивент просто не заведут. Форматирование поста (жирный, курсив) при этом
 * теряется намеренно: редактор ивента в миниаппе — обычная textarea, сохранить
 * разметку в ней всё равно негде.
 */
export const registerEventIntake = (
    dp: Dispatcher,
    deps: {
        client: TelegramClient
        storage: Storage
        residents: ResidentDirectory
        /** Канал анонсов: пересылки только оттуда превращаются в заготовку. */
        channelId: number
        /** Публичный URL миниаппа: без него открывать нечего. */
        webappUrl: string
        /** Путь к файлу стейта — рядом с ним лежат афиши. */
        dataFile: string
    },
): void => {
    const { client, storage, residents, channelId, webappUrl, dataFile } = deps

    dp.onNewMessage(filters.chat('user'), async (msg) => {
        const fwd = msg.forward
        if (!fwd) return PropagationAction.Continue
        // Отправитель пересылки для постов канала — сам канал (Chat). У скрытых
        // пересылок это AnonymousSender без id — такие нам не подходят.
        const sender = fwd.sender
        if (!('id' in sender) || Number(sender.id) !== channelId) return PropagationAction.Continue
        if (!msg.sender || msg.sender.type !== 'user') return PropagationAction.Continue

        const userId = msg.sender.id
        if (!(await residents.isResident(userId))) {
            // Не резидент переслал пост канала — это не наш поток, но и молчать
            // в личке невежливо: пусть знает, что кнопка ему не светит.
            await msg.answerText('Ивенты заводят резиденты спейса.')
            return PropagationAction.Stop
        }

        const { title, description } = splitPostText(msg.text ?? '')
        if (!title) {
            await msg.answerText('В этом посте нет текста — из чего делать ивент, непонятно. Перешли пост с описанием.')
            return PropagationAction.Stop
        }

        // Картинку кладём рядом со стейтом под ключом заготовки: при создании ивента
        // она переедет на его id (adoptDraftPhoto), при следующей пересылке — перезапишется.
        let hasPhoto = false
        if (msg.media?.type === 'photo') {
            try {
                const bytes = await client.downloadAsBuffer(msg.media)
                if (bytes.length <= MAX_EVENT_PHOTO_BYTES) {
                    await saveEventPhoto(dataFile, draftPhotoId(userId), bytes)
                    hasPhoto = true
                }
            } catch (err) {
                console.warn('[events] не удалось скачать афишу из пересланного поста:', err)
            }
        }
        // Прошлая заготовка вместе с её картинкой больше не нужна: одна на человека.
        if (!hasPhoto) await clearEventDraft(storage, dataFile, userId)

        const postUrl = postUrlFrom(fwd, channelId)
        await saveEventDraft(storage, {
            userId,
            title,
            description,
            hasPhoto,
            ...(postUrl ? { postUrl } : {}),
            at: new Date().toISOString(),
        })

        const preview = title.length > 60 ? `${title.slice(0, 60)}…` : title
        await msg.answerText(
            html(`Сделать из этого поста ивент?<br><br><b>${html.escape(preview)}</b>${hasPhoto ? '<br>Афиша из поста тоже подтянется.' : ''}`),
            {
                replyMarkup: BotKeyboard.inline([
                    [BotKeyboard.webView('Создать ивент', `${webappUrl}?draft=1`)],
                ]),
                disableWebPreview: true,
            },
        )
        return PropagationAction.Stop
    })
}
