import assert from 'node:assert/strict'
import test from 'node:test'
import { inviteOnStart, registerOnboardingHandlers } from '../src/onboarding.ts'

test('retries a resident’s undelivered welcome on /start with a fresh invite, once', async (t) => {
    const userId = 1
    const state = { residentOnboarding: {}, userLanguages: {}, onboardingSince: 'enabled' }
    const storage = { get: () => state, update: async mutate => mutate(state) }
    const residents = { invalidate() {}, isResident: async id => id === userId }
    const onChatMemberUpdate = t.mock.fn()
    let issued = 0
    const createIssuesInvite = t.mock.fn(async () => 'https://example.invalid/invite-' + ++issued)
    const sendText = t.mock.fn(async () => {})
    sendText.mock.mockImplementationOnce(async () => { throw new Error('private chat is closed') })
    const client = { sendText }
    const residentsChatId = -200
    registerOnboardingHandlers({ onChatMemberUpdate }, { client, storage, residents, residentsChatId, webappUrl: null, createIssuesInvite })
    const [, handleJoin] = onChatMemberUpdate.mock.calls[0].arguments
    const join = id => handleJoin({ chat: { id: residentsChatId }, user: { id, isBot: false } })

    await join(2)
    assert.equal(issued, 0)
    assert.equal(sendText.mock.callCount(), 0)
    await join(userId)
    assert.equal(state.residentOnboarding[userId].invitedAt, null)
    await inviteOnStart(client, storage, userId, null, createIssuesInvite)
    assert.ok(state.residentOnboarding[userId].invitedAt)
    await inviteOnStart(client, storage, userId, null, createIssuesInvite)

    assert.deepEqual(createIssuesInvite.mock.calls.map(call => call.arguments), [[userId], [userId]])
    assert.deepEqual(sendText.mock.calls.map(({ arguments: [id, , { replyMarkup }] }) =>
        [id, replyMarkup.buttons[0][0].url]), [[userId, 'https://example.invalid/invite-1'], [userId, 'https://example.invalid/invite-2']])
})
