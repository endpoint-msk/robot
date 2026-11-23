// Передача хостинга: резидент, взявшийся хостить визит, просит подхватить его другого
// резидента. Это предложение, а не назначение, — адресат отвечает сам, поэтому у него
// есть и кнопки в личке, и строка в миниаппе.
//
// Модель и мутации живут в hosting.ts рядом с переносом (offerTransfer/acceptTransfer/
// clearTransfer), здесь только личка: уведомления и обработка кнопок.

import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import type { CallbackQueryContext, Dispatcher } from '@mtcute/dispatcher'
import { PropagationAction } from '@mtcute/dispatcher'
import { audit, auditUser } from './audit.js'
import { requestTarget, webappAt } from './deeplink.js'
import { acceptTransfer, clearTransfer, displayName, formatDayKey, mentionLabel } from './hosting.js'
import { locale, tr, withUserLocale } from './i18n.js'
import type { Storage } from './storage.js'
import type { HostingRequest, HostingUser, HostTransfer } from './types.js'
import { own } from './types.js'

const CB_TAKE = 'hosttransfer:take:'
const CB_PASS = 'hosttransfer:pass:'

const slotOf = (request: HostingRequest): string => tr(`<b>${formatDayKey(request.dateKey)}</b> к ${request.time}`, `<b>${formatDayKey(request.dateKey)}</b> at ${request.time}`)

const whoOf = (u: HostingUser): string => (u.username ? `@${u.username}` : displayName(u.name))

/**
 * Строка журнала на ответ кнопкой из лички. Кнопки идут мимо диспетчера API, и без неё
 * в журнале оставалось бы только предложение передачи, а кто и когда визит взял, знал бы
 * один `approvedAt`. Текст и коды отказов те же, что у `transfer.accept`/`transfer.decline`
 * в webapp.ts, отказы пишем так же.
 */
const auditAnswer = (
    ctx: CallbackQueryContext,
    take: boolean,
    id: string,
    request: HostingRequest | undefined,
    transfer: HostTransfer | null,
    error?: string,
): void => {
    const what = request ? ` заявки ${whoOf(request.guest)} на ${request.dateKey} ${request.time}` : ` заявки ${id} на ?`
    const text = take
        ? `взял${what} на себя (${transfer ? `от ${whoOf(transfer.by)}, ` : ''}кнопка в личке)`
        : `отказался подхватить${what} (кнопка в личке)`
    audit({
        action: take ? 'transfer.accept' : 'transfer.decline',
        actor: auditUser(ctx.user),
        ok: !error,
        ...(error ? { error } : {}),
        text: error ? `${text} — отказ (${error})` : text,
        meta: { id },
    })
}

/** Кнопки под просьбой подхватить визит. Гасим их пустой разметкой, как только ответили. */
const offerKeyboard = (id: string, webappUrl: string) =>
    BotKeyboard.inline([
        [BotKeyboard.callback(tr('✅ Беру', "✅ I’ll host"), `${CB_TAKE}${id}`), BotKeyboard.callback(tr('Не смогу', "I can’t"), `${CB_PASS}${id}`)],
        ...(webappUrl ? [[BotKeyboard.webView(tr('Открыть хостинг', "Open visits"), webappAt(webappUrl, requestTarget(id)))]] : []),
    ])

/** Резиденту в личку: его просят взять чужой подтверждённый визит на себя. */
export const notifyTransferOffer = async (
    client: TelegramClient,
    storage: Storage,
    webappUrl: string,
    request: HostingRequest,
    transfer: HostTransfer,
): Promise<void> => withUserLocale(storage, transfer.to.userId, async () => {
    const from = await mentionLabel(client, transfer.by)
    const guest = await mentionLabel(client, request.guest)
    const text = tr(`🤝 ${from} просит подхватить визит ${guest} ${slotOf(request)}.`, `🤝 ${from} asks you to take over the visit for ${guest} on ${slotOf(request)}.`)
    try {
        await client.sendText(transfer.to.userId, html(text), {
            replyMarkup: offerKeyboard(request.id, webappUrl),
            disableWebPreview: true,
        })
    } catch {
        // резидент не открывал личку с ботом
    }
})

/** Прежнему хосту: визит подхватили, он больше не на нём. */
export const notifyTransferAccepted = async (
    client: TelegramClient,
    storage: Storage,
    request: HostingRequest,
    to: HostingUser,
    formerHostId: number,
): Promise<void> => withUserLocale(storage, formerHostId, async () => {
    const who = await mentionLabel(client, to)
    const guest = await mentionLabel(client, request.guest)
    const text = tr(`✅ ${who} берёт визит ${guest} ${slotOf(request)} на себя.`, `✅ ${who} took over the visit for ${guest} on ${slotOf(request)}.`)
    try {
        await client.sendText(formerHostId, html(text), { disableWebPreview: true })
    } catch {
        // личка закрыта — не критично
    }
})

/**
 * Снятое предложение передачи. Отказал адресат — пишем автору, отозвал автор — адресату:
 * действие одно, а получатель и формулировка разные.
 */
export const notifyTransferCancelled = async (
    client: TelegramClient,
    storage: Storage,
    request: HostingRequest,
    transfer: HostTransfer,
    withdrawn: boolean,
): Promise<void> => withUserLocale(storage, (withdrawn ? transfer.to : transfer.by).userId, async () => {
    const guest = await mentionLabel(client, request.guest)
    const recipient = withdrawn ? transfer.to : transfer.by
    const actor = await mentionLabel(client, withdrawn ? transfer.by : transfer.to)
    const text = withdrawn
        ? tr(`${actor} отзывает просьбу подхватить визит ${guest} ${slotOf(request)}.`, `${actor} withdrew the request for you to host ${guest} on ${slotOf(request)}.`)
        : tr(`${actor} не сможет подхватить визит ${guest} ${slotOf(request)} — хостинг остаётся на вас.`, `${actor} can’t take over the visit for ${guest} on ${slotOf(request)}. You’re still the host.`)
    try {
        await client.sendText(recipient.userId, html(text), { disableWebPreview: true })
    } catch {
        // личка закрыта — не критично
    }
})

/** Гостю: его визит теперь хостит другой человек. Про саму передачу гостю знать незачем. */
export const notifyGuestHostChanged = async (
    client: TelegramClient,
    storage: Storage,
    webappUrl: string,
    request: HostingRequest,
): Promise<void> => withUserLocale(storage, request.guest.userId, async () => {
    const host = request.approvedBy
    if (!host) return
    const who = await mentionLabel(client, host)
    const text = tr(`Ваш визит ${slotOf(request)} теперь хостит ${who}.`, `${who} is now hosting your visit on ${slotOf(request)}.`)
    try {
        await client.sendText(request.guest.userId, html(text), {
            replyMarkup: webappUrl
                ? BotKeyboard.inline([[BotKeyboard.webView(tr('Мои визиты', "My visits"), webappAt(webappUrl, requestTarget(request.id)))]])
                : undefined,
            disableWebPreview: true,
        })
    } catch {
        // гость не открывал личку с ботом
    }
})

/**
 * Кнопки «Беру» / «Не смогу» из личной просьбы. Чужие callback'и пропускаем дальше
 * (см. инвариант про PropagationAction в CLAUDE.md).
 */
export const registerHostingTransferHandlers = (
    dp: Dispatcher,
    deps: { client: TelegramClient; storage: Storage; webappUrl: string },
): void => {
    const { client, storage, webappUrl } = deps

    dp.onCallbackQuery(async (ctx: CallbackQueryContext) => {
        const data = ctx.dataStr
        if (!data?.startsWith(CB_TAKE) && !data?.startsWith(CB_PASS)) return PropagationAction.Continue
        const take = data.startsWith(CB_TAKE)
        const id = data.slice((take ? CB_TAKE : CB_PASS).length)

        const request = own(storage.get().hostingRequests, id)
        const transfer = request?.transfer ?? null
        if (!request || !transfer) {
            auditAnswer(ctx, take, id, request, transfer, request ? 'no_transfer' : 'not_found')
            await ctx.answer({ text: tr('Эта просьба уже неактуальна.', "This request is no longer active."), alert: true })
            await ctx.editMessage({ replyMarkup: BotKeyboard.inline([]) }).catch(() => {})
            return
        }
        if (transfer.to.userId !== ctx.user.id) {
            auditAnswer(ctx, take, id, request, transfer, 'not_allowed')
            await ctx.answer({ text: tr('Эта просьба адресована другому резиденту.', "This request is for another resident."), alert: true })
            return
        }

        const user: HostingUser = {
            userId: ctx.user.id,
            username: ctx.user.username ?? null,
            name: displayName(ctx.user.displayName),
        }

        if (take) {
            const result = await acceptTransfer(storage, id, user)
            auditAnswer(ctx, true, id, request, transfer, result.ok ? undefined : result.error)
            if (!result.ok) {
                await ctx.answer({ text: tr('Эта просьба уже неактуальна.', "This request is no longer active."), alert: true })
                return
            }
            void notifyTransferAccepted(client, storage, result.request, user, result.from.userId)
                .catch((err) => console.error('[hosting] не удалось уведомить прежнего хоста о передаче:', err))
            void notifyGuestHostChanged(client, storage, webappUrl, result.request)
                .catch((err) => console.error('[hosting] не удалось уведомить гостя о смене хоста:', err))
            await ctx.editMessage({
                text: html((locale() === 'ru' ? `✅ Визит ${await mentionLabel(client, result.request.guest)} ${slotOf(result.request)} теперь на вас.` : `✅ You’re now hosting ${await mentionLabel(client, result.request.guest)} on ${slotOf(result.request)}.`)),
                replyMarkup: BotKeyboard.inline([]),
            }).catch((err) => console.warn('[hosting] не удалось переписать сообщение передачи:', err))
            await ctx.answer({ text: tr('Взяли', "You’re hosting") })
            return
        }

        const result = await clearTransfer(storage, id)
        auditAnswer(ctx, false, id, request, transfer, result.ok ? undefined : result.error)
        if (!result.ok) {
            await ctx.answer({ text: tr('Эта просьба уже неактуальна.', "This request is no longer active."), alert: true })
            return
        }
        void notifyTransferCancelled(client, storage, result.request, result.transfer, false)
            .catch((err) => console.error('[hosting] не удалось уведомить хоста об отказе:', err))
        await ctx.editMessage({
            text: html((locale() === 'ru' ? `Отказ отправлен: визит ${slotOf(result.request)} остаётся на ${await mentionLabel(client, result.transfer.by)}.` : `Request declined. ${await mentionLabel(client, result.transfer.by)} is still hosting the visit on ${slotOf(result.request)}.`)),
            replyMarkup: BotKeyboard.inline([]),
        }).catch((err) => console.warn('[hosting] не удалось переписать сообщение передачи:', err))
        await ctx.answer({ text: tr('Отказ отправлен', "Declined") })
    })
}
