import assert from 'node:assert/strict'
import test from 'node:test'
import { createIssuesInvite, registerIssuesHandlers } from '../src/issues.ts'

test('creates a fresh one-person channel invite valid for one hour', async (t) => {
    const now = Date.UTC(2026, 0, 1)
    t.mock.method(Date, 'now', () => now)
    const createInviteLink = t.mock.fn(async () => ({ link: 'https://example.invalid/invitation' }))
    assert.equal(await createIssuesInvite({ createInviteLink }, -1000000000001), 'https://example.invalid/invitation')
    assert.deepEqual(createInviteLink.mock.calls[0].arguments, [-1000000000001, { usageLimit: 1, expires: now + 3_600_000 }])
})

test('/issues only sends fresh links to residents in private chats', async (t) => {
    const onNewMessage = t.mock.fn()
    const sendText = t.mock.fn()
    const answerText = t.mock.fn()
    const isResident = t.mock.fn(async (id) => id === 1)
    let issued = 0
    const createInvite = t.mock.fn(async () => 'https://example.invalid/invite-' + ++issued)
    registerIssuesHandlers({ onNewMessage }, { client: { sendText }, residents: { isResident }, createInvite })
    const [, handle] = onNewMessage.mock.calls[0].arguments
    const request = (type, userId) => handle({ chat: { type }, sender: { type: 'user', id: userId }, answerText })

    await request('supergroup', 1)
    assert.equal(isResident.mock.callCount(), 0)
    assert.equal(answerText.mock.callCount(), 0)
    await request('user', 2)
    assert.equal(answerText.mock.callCount(), 1)
    assert.equal(issued, 0)
    assert.equal(sendText.mock.callCount(), 0)

    await request('user', 1)
    await request('user', 1)
    assert.deepEqual(createInvite.mock.calls.map(call => call.arguments), [[1], [1]])
    const deliveries = sendText.mock.calls.map(({ arguments: [userId, , options] }) =>
        [userId, options.replyMarkup.buttons[0][0].url])
    assert.deepEqual(deliveries, [[1, 'https://example.invalid/invite-1'], [1, 'https://example.invalid/invite-2']])
})
