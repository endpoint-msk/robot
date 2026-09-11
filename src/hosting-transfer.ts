// Передача хостинга: резидент, взявшийся хостить визит, просит подхватить его другого
// резидента. Это предложение, а не назначение, — адресат отвечает сам, поэтому у него
// есть и кнопки в личке, и строка в миниаппе.
//
// Модель и мутации живут в hosting.ts рядом с переносом (offerTransfer/acceptTransfer/
// clearTransfer), здесь только личка: уведомления и обработка кнопок.

import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import type { CallbackQueryContext, Dispatcher } from '@mtcute/dispatcher'
import { PropagationAction } from '@mtcute/dispatcher'
import { acceptTransfer, clearTransfer, displayName, formatDayKey, mentionLabel } from './hosting.js'
import type { Storage } from './storage.js'
import type { HostingRequest, HostingUser, HostTransfer } from './types.js'

const CB_TAKE = 'hosttransfer:take:'
const CB_PASS = 'hosttransfer:pass:'

const slotOf = (request: HostingRequest): string => `<b>${formatDayKey(request.dateKey)}</b> к ${request.time}`

/** Кнопки под просьбой подхватить визит. Гасим их пустой разметкой, как только ответили. */
const offerKeyboard = (id: string, webappUrl: string) =>
    BotKeyboard.inline([
        [BotKeyboard.callback('✅ Беру', `${CB_TAKE}${id}`), BotKeyboard.callback('Не смогу', `${CB_PASS}${id}`)],
        ...(webappUrl ? [[BotKeyboard.webView('Открыть хостинг', webappUrl)]] : []),
    ])

/** Резиденту в личку: его просят взять чужой подтверждённый визит на себя. */
export const notifyTransferOffer = async (
    client: TelegramClient,
    webappUrl: string,
    request: HostingRequest,
    transfer: HostTransfer,
): Promise<void> => {
    const from = await mentionLabel(client, transfer.by)
    const guest = await mentionLabel(client, request.guest)
    const text = `🤝 ${from} просит подхватить визит ${guest} ${slotOf(request)}.`
    try {
        await client.sendText(transfer.to.userId, html(text), {
            replyMarkup: offerKeyboard(request.id, webappUrl),
            disableWebPreview: true,
        })
    } catch {
        // резидент не открывал личку с ботом
    }
}

/** Прежнему хосту: визит подхватили, он больше не на нём. */
export const notifyTransferAccepted = async (
    client: TelegramClient,
    request: HostingRequest,
    to: HostingUser,
    formerHostId: number,
): Promise<void> => {
    const who = await mentionLabel(client, to)
    const guest = await mentionLabel(client, request.guest)
    const text = `✅ ${who} берёт визит ${guest} ${slotOf(request)} на себя.`
    try {
        await client.sendText(formerHostId, html(text), { disableWebPreview: true })
    } catch {
        // личка закрыта — не критично
    }
}

/**
 * Снятое предложение передачи. Отказал адресат — пишем автору, отозвал автор — адресату:
 * действие одно, а получатель и формулировка разные.
 */
export const notifyTransferCancelled = async (
    client: TelegramClient,
    request: HostingRequest,
    transfer: HostTransfer,
    withdrawn: boolean,
): Promise<void> => {
    const guest = await mentionLabel(client, request.guest)
    const recipient = withdrawn ? transfer.to : transfer.by
    const actor = await mentionLabel(client, withdrawn ? transfer.by : transfer.to)
    const text = withdrawn
        ? `${actor} отзывает просьбу подхватить визит ${guest} ${slotOf(request)}.`
        : `${actor} не сможет подхватить визит ${guest} ${slotOf(request)} — хостинг остаётся на вас.`
    try {
        await client.sendText(recipient.userId, html(text), { disableWebPreview: true })
    } catch {
        // личка закрыта — не критично
    }
}

/** Гостю: его визит теперь хостит другой человек. Про саму передачу гостю знать незачем. */
export const notifyGuestHostChanged = async (
    client: TelegramClient,
    webappUrl: string,
    request: HostingRequest,
): Promise<void> => {
    const host = request.approvedBy
    if (!host) return
    const who = await mentionLabel(client, host)
    const text = `Ваш визит ${slotOf(request)} теперь хостит ${who}.`
    try {
        await client.sendText(request.guest.userId, html(text), {
            replyMarkup: webappUrl ? BotKeyboard.inline([[BotKeyboard.webView('Мои визиты', webappUrl)]]) : undefined,
            disableWebPreview: true,
        })
    } catch {
        // гость не открывал личку с ботом
    }
}

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

        const request = storage.get().hostingRequests[id]
        const transfer = request?.transfer ?? null
        if (!request || !transfer) {
            await ctx.answer({ text: 'Эта просьба уже неактуальна.', alert: true })
            await ctx.editMessage({ replyMarkup: BotKeyboard.inline([]) }).catch(() => {})
            return
        }
        if (transfer.to.userId !== ctx.user.id) {
            await ctx.answer({ text: 'Эта просьба адресована другому резиденту.', alert: true })
            return
        }

        const user: HostingUser = {
            userId: ctx.user.id,
            username: ctx.user.username ?? null,
            name: displayName(ctx.user.displayName),
        }

        if (take) {
            const result = await acceptTransfer(storage, id, user)
            if (!result.ok) {
                await ctx.answer({ text: 'Эта просьба уже неактуальна.', alert: true })
                return
            }
            void notifyTransferAccepted(client, result.request, user, result.from.userId)
                .catch((err) => console.error('[hosting] не удалось уведомить прежнего хоста о передаче:', err))
            void notifyGuestHostChanged(client, webappUrl, result.request)
                .catch((err) => console.error('[hosting] не удалось уведомить гостя о смене хоста:', err))
            await ctx.editMessage({
                text: html(`✅ Визит ${await mentionLabel(client, result.request.guest)} ${slotOf(result.request)} теперь на вас.`),
                replyMarkup: BotKeyboard.inline([]),
            }).catch((err) => console.warn('[hosting] не удалось переписать сообщение передачи:', err))
            await ctx.answer({ text: 'Взяли' })
            return
        }

        const result = await clearTransfer(storage, id)
        if (!result.ok) {
            await ctx.answer({ text: 'Эта просьба уже неактуальна.', alert: true })
            return
        }
        void notifyTransferCancelled(client, result.request, result.transfer, false)
            .catch((err) => console.error('[hosting] не удалось уведомить хоста об отказе:', err))
        await ctx.editMessage({
            text: html(`Отказ отправлен: визит ${slotOf(result.request)} остаётся на ${await mentionLabel(client, result.transfer.by)}.`),
            replyMarkup: BotKeyboard.inline([]),
        }).catch((err) => console.warn('[hosting] не удалось переписать сообщение передачи:', err))
        await ctx.answer({ text: 'Отказ отправлен' })
    })
}
