import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type Dispatcher } from '@mtcute/dispatcher'
import type { ResidentDirectory } from './residents.js'
import type { Storage } from './storage.js'
import type { ResidentOnboarding } from './types.js'

/**
 * Версия знакомства. Поднять, когда в нём появился шаг, который должны увидеть и
 * те, кто его уже прошёл: у них знакомство откроется снова, целиком.
 */
export const ONBOARDING_VERSION = 1

/** Как часто пробуем включить знакомство, если на старте состав резидентов не прочитался. */
const SEED_RETRY_MS = 10 * 60_000

const INVITE_TEXT = [
    '<b>Ты теперь резидент Endpoint.</b>',
    '',
    'Резиденты открывают спейс, встречают гостей и заводят ивенты. В миниаппе покажу, как это устроено, и настроим авто-отметку по телефону. Пара минут.',
].join('<br>')

const emptyRecord = (): ResidentOnboarding => ({ joinedAt: null, invitedAt: null, version: 0, doneAt: null })

export const onboardingOf = (storage: Storage, userId: number): ResidentOnboarding | null =>
    storage.get().residentOnboarding[String(userId)] ?? null

const passed = (rec: ResidentOnboarding | null): boolean =>
    rec !== null && rec.doneAt !== null && rec.version >= ONBOARDING_VERSION

/**
 * Открыть ли знакомство само, на входе в миниапп. Пока его не включили (см.
 * `startOnboardingSeeder`), не открываем никому: не отличить, кто новенький, а кто
 * был резидентом задолго до знакомства.
 */
export const shouldShowOnboarding = (storage: Storage, userId: number): boolean =>
    storage.get().onboardingSince !== '' && !passed(onboardingOf(storage, userId))

export const markOnboardingDone = async (storage: Storage, userId: number): Promise<void> => {
    await storage.update((s) => {
        const key = String(userId)
        const rec = s.residentOnboarding[key] ?? emptyRecord()
        s.residentOnboarding[key] = { ...rec, version: ONBOARDING_VERSION, doneAt: new Date().toISOString() }
    })
}

/**
 * Приглашение в личку с кнопкой в миниапп. false - не доставлено: бот не может
 * начать переписку, пока человек сам не открыл личку. Тогда то же сообщение уйдёт
 * на его первый /start (`inviteOnStart`).
 */
const sendInvite = async (client: TelegramClient, storage: Storage, userId: number, webappUrl: string): Promise<boolean> => {
    try {
        await client.sendText(userId, html(INVITE_TEXT), {
            replyMarkup: BotKeyboard.inline([[BotKeyboard.webView('Открыть знакомство', `${webappUrl}?onboarding=1`)]]),
        })
    } catch {
        return false
    }
    await storage.update((s) => {
        const key = String(userId)
        s.residentOnboarding[key] = { ...(s.residentOnboarding[key] ?? emptyRecord()), invitedAt: new Date().toISOString() }
    })
    return true
}

/**
 * Приглашение на /start для тех, до кого оно не дошло на вступлении: личка была
 * закрыта или бот вступление проспал. Уходит один раз - дальше знакомство открывается
 * из настроек миниаппа.
 */
export const inviteOnStart = async (
    client: TelegramClient,
    storage: Storage,
    userId: number,
    webappUrl: string | null,
): Promise<void> => {
    if (webappUrl === null || storage.get().onboardingSince === '') return
    const rec = onboardingOf(storage, userId)
    if (passed(rec) || rec?.invitedAt) return
    await sendInvite(client, storage, userId, webappUrl)
}

/**
 * Вступление в чат резидентов - момент, когда человек становится резидентом, и бот
 * пишет ему сам. Апдейт участника приходит боту, только если он админ чата, а без
 * админки не работает и остальное (`ResidentDirectory.list`), так что отдельного
 * требования это не добавляет.
 */
export const registerOnboardingHandlers = (
    dp: Dispatcher,
    deps: {
        client: TelegramClient
        storage: Storage
        residents: ResidentDirectory
        residentsChatId: number | null
        webappUrl: string
    },
): void => {
    const { client, storage, residents, residentsChatId, webappUrl } = deps
    if (residentsChatId === null) return

    dp.onChatMemberUpdate(filters.chatMember(['joined', 'added']), async (upd) => {
        if (upd.chat.id !== residentsChatId) return PropagationAction.Continue
        const user = upd.user
        if (user.isBot) return
        // До вступления человек мог открыть миниапп гостем, и «не резидент» лежит в
        // кэше директории ещё минуту - а приглашение ведёт именно туда.
        residents.invalidate(user.id)
        const key = String(user.id)
        const rec = storage.get().residentOnboarding[key]
        // Вернулся после выхода и знакомство уже проходил - звать снова незачем.
        if (passed(rec ?? null)) return
        await storage.update((s) => {
            s.residentOnboarding[key] = { ...(s.residentOnboarding[key] ?? emptyRecord()), joinedAt: new Date().toISOString() }
        })
        if (storage.get().onboardingSince === '') return
        await sendInvite(client, storage, user.id, webappUrl)
    })
}

/**
 * Включение знакомства: всех, кто уже резидент, записываем прошедшими, и только после
 * этого оно начинает открываться само. Один раз за жизнь стейта - дальше новичков
 * отличает отсутствие записи.
 *
 * Нужен полный состав: по оборванному списку часть старых резидентов осталась бы без
 * записи и увидела бы знакомство. Не прочитался - пробуем снова, пока не выйдет.
 */
export const startOnboardingSeeder = (storage: Storage, residents: ResidentDirectory): { stop: () => void } => {
    let running = false
    let warned = false
    let timer: ReturnType<typeof setInterval> | null = null
    const stop = (): void => {
        if (timer !== null) clearInterval(timer)
        timer = null
    }
    const tick = async (): Promise<void> => {
        if (running) return
        if (storage.get().onboardingSince !== '') {
            stop()
            return
        }
        running = true
        try {
            const roster = await residents.list()
            if (!roster.complete || roster.users.length === 0) {
                if (!warned) console.warn('[onboarding] состав резидентов не прочитался, знакомство пока не включено')
                warned = true
                return
            }
            const now = new Date().toISOString()
            await storage.update((s) => {
                if (s.onboardingSince !== '') return
                for (const u of roster.users) {
                    const key = String(u.userId)
                    if (s.residentOnboarding[key]) continue
                    s.residentOnboarding[key] = { joinedAt: null, invitedAt: null, version: ONBOARDING_VERSION, doneAt: now }
                }
                s.onboardingSince = now
            })
            console.log(`[onboarding] знакомство включено, прошедшими записаны ${roster.users.length} резидентов`)
            stop()
        } catch (err) {
            console.error('[onboarding] не удалось включить знакомство:', err)
        } finally {
            running = false
        }
    }
    if (storage.get().onboardingSince === '') {
        timer = setInterval(() => void tick(), SEED_RETRY_MS)
        void tick()
    }
    return { stop }
}
