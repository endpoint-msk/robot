import { rememberTelegramLanguage, tr, userLocale, withLocale } from './i18n.js'
import { BotKeyboard, html, type TelegramClient } from '@mtcute/node'
import { filters, PropagationAction, type Dispatcher } from '@mtcute/dispatcher'
import { issuesDescription, issuesInviteButton, issuesInviteTerms, type CreateIssuesInvite } from './issues.js'
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

const pendingWelcomes = new Set<number>()

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

const welcomeMessage = (webappUrl: string | null, issuesUrl: string | null | undefined) => {
    const paragraphs = [tr('<b>Ты теперь резидент Endpoint.</b>', "<b>You're now an Endpoint resident.</b>")]
    const rows = []
    if (webappUrl) {
        paragraphs.push(tr('Резиденты открывают спейс, встречают гостей и заводят ивенты. В миниаппе покажу, как это устроено, и настроим авто-отметку по телефону. Пара минут.', "Residents open the space, host guests, and organize events. The mini app shows you how it works and helps you set up automatic check-in from your phone. It takes a couple of minutes."))
        rows.push([BotKeyboard.webView(tr('Открыть знакомство', 'Start the walkthrough'), `${webappUrl}?onboarding=1`)])
    }
    if (issuesUrl !== undefined) {
        const terms = issuesUrl ? issuesInviteTerms() : tr('Сейчас не удалось создать ссылку.', 'The invite link is unavailable right now.')
        const nextInvite = webappUrl
            ? tr('Новую ссылку можно получить в настройках миниаппа.', 'You can get a fresh link in the Mini App settings.')
            : tr('За новой ссылкой напиши /issues.', 'Send /issues for a fresh link.')
        paragraphs.push(`${issuesDescription()} ${terms} ${nextInvite}`)
        if (issuesUrl) rows.push([issuesInviteButton(issuesUrl)])
    }
    return { text: html(paragraphs.join('<br><br>')), replyMarkup: rows.length ? BotKeyboard.inline(rows) : undefined }
}

const sendInvite = async (
    client: TelegramClient,
    storage: Storage,
    userId: number,
    webappUrl: string | null,
    createIssuesInvite: CreateIssuesInvite | null,
): Promise<void> => {
    const rec = onboardingOf(storage, userId)
    if (passed(rec) || rec?.invitedAt || pendingWelcomes.has(userId)) return
    pendingWelcomes.add(userId)
    try {
        let invite: string | null | undefined
        if (createIssuesInvite) {
            try {
                invite = await createIssuesInvite(userId)
                if (invite === null) return
            } catch (err) {
                console.error('[onboarding] не удалось создать приглашение в канал ищью:', err)
                invite = null
            }
        }
        const { text, replyMarkup } = withLocale(userLocale(storage, userId), () => welcomeMessage(webappUrl, invite))
        try {
            await client.sendText(userId, text, { replyMarkup })
        } catch {
            return
        }
        await storage.update((s) => {
            const key = String(userId)
            s.residentOnboarding[key] = { ...(s.residentOnboarding[key] ?? emptyRecord()), invitedAt: new Date().toISOString() }
        })
    } finally {
        pendingWelcomes.delete(userId)
    }
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
    createIssuesInvite: CreateIssuesInvite | null = null,
): Promise<void> => {
    if (webappUrl === null && createIssuesInvite === null) return
    if (storage.get().onboardingSince === '' && !(createIssuesInvite && onboardingOf(storage, userId)?.joinedAt)) return
    await sendInvite(client, storage, userId, webappUrl, createIssuesInvite)
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
        webappUrl: string | null
        createIssuesInvite: CreateIssuesInvite | null
    },
): void => {
    const { client, storage, residents, residentsChatId, webappUrl, createIssuesInvite } = deps
    if (residentsChatId === null || (!webappUrl && !createIssuesInvite)) return

    dp.onChatMemberUpdate(filters.chatMember(['joined', 'added']), async (upd) => {
        if (upd.chat.id !== residentsChatId) return PropagationAction.Continue
        const user = upd.user
        if (user.isBot) return
        rememberTelegramLanguage(storage, user.id, user.language)
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
        if (!createIssuesInvite && storage.get().onboardingSince === '') return
        if (createIssuesInvite && !(await residents.isResident(user.id))) return
        await sendInvite(client, storage, user.id, webappUrl, createIssuesInvite)
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
