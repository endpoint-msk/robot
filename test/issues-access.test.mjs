import assert from 'node:assert/strict'
import test from 'node:test'
import { grantIssuesPosting, removeFormerIssuesMember } from '../src/issues-access.ts'
import { registerResidentAccessHandlers } from '../src/resident-access.ts'

test('demotes a former resident before issuing a server-expiring ban', async (t) => {
    const now = Date.UTC(2026, 0, 1)
    t.mock.method(Date, 'now', () => now)
    const calls = []
    const client = {
        getChatMember: async () => ({ status: 'admin', isMember: true, raw: { _: 'channelParticipantAdmin', canEdit: true } }),
        editAdminRights: async (options) => calls.push(['demote', options]),
        banChatMember: async (options) => calls.push(['remove', options]),
    }
    assert.equal(await removeFormerIssuesMember(client, { confirmResidency: async () => false }, -42, 7), true)
    assert.deepEqual(calls, [
        ['demote', { chatId: -42, userId: 7, rights: {} }],
        ['remove', { chatId: -42, participantId: 7, untilDate: now + 120_000 }],
    ])
})

test('protects current residents, unknown status, existing bans, and other administrators', async (t) => {
    const client = { getChatMember: t.mock.fn(), editAdminRights: t.mock.fn(), banChatMember: t.mock.fn() }
    const remove = (confirmResidency) => removeFormerIssuesMember(client, { confirmResidency }, -42, 7)
    assert.equal(await remove(async () => true), false)
    await assert.rejects(remove(async () => { throw new Error('residency unavailable') }), /residency unavailable/)
    assert.equal(client.getChatMember.mock.callCount(), 0)
    for (const member of [null, { status: 'banned', isMember: true }, { status: 'restricted', isMember: false }]) {
        client.getChatMember.mock.mockImplementation(async () => member)
        assert.equal(await remove(async () => false), false)
    }
    for (const status of ['admin', 'creator']) {
        client.getChatMember.mock.mockImplementation(async () => ({ status, isMember: true, raw: { _: 'channelParticipantAdmin' } }))
        await assert.rejects(remove(async () => false), /владелец/i)
    }
    assert.equal(client.editAdminRights.mock.callCount(), 0)
    assert.equal(client.banChatMember.mock.callCount(), 0)
})

test('checks resident departures and channel joins without removing unrelated members', async (t) => {
    const channel = -42
    const residentChat = -43
    const onChatMemberUpdate = t.mock.fn()
    const client = {
        getChatMember: async () => ({ status: 'member', isMember: true, user: { isBot: false } }),
        editAdminRights: t.mock.fn(),
        banChatMember: t.mock.fn(),
    }
    const state = { residentOnboarding: { 2: {} }, issuesChannelAccess: {} }
    const storage = { get: () => state, update: async (fn) => fn(state) }
    registerResidentAccessHandlers({ onChatMemberUpdate }, {
        client, residentsChatId: residentChat, issuesChannelId: channel, storage, adminTargets: [], authentik: null,
        residents: { invalidate() {}, confirmResidency: async (id) => id === 1 },
    })
    const [, receive] = onChatMemberUpdate.mock.calls[0].arguments
    const update = (chat, id, type, extra = {}) => receive({ chat: { id: chat }, user: { id }, type, ...extra })
    await update(channel, 1, 'joined')
    await update(channel, 2, 'joined')
    await update(channel, 3, 'joined', { inviteLink: { isMyLink: true } })
    await update(channel, 4, 'added')
    await update(residentChat, 5, 'left', { oldMember: { status: 'member', isMember: true } })
    await update(residentChat, 6, 'kicked', { oldMember: null })
    await update(residentChat, 7, 'kicked', { oldMember: { status: 'restricted', isMember: false } })
    assert.deepEqual(client.editAdminRights.mock.calls.map(({ arguments: args }) => args[0].userId), [1])
    assert.deepEqual(client.banChatMember.mock.calls.map(({ arguments: args }) => args[0].participantId), [2, 3, 5])
    assert.deepEqual(state.issuesChannelAccess, { '-42#1': true, '-42#3': true, '-42#5': true })
})

test('a departure during promotion finishes with the member removed', async () => {
    const started = Promise.withResolvers()
    const resume = Promise.withResolvers()
    const changes = []
    let isResident = true
    let status = 'member'
    const residents = { confirmResidency: async () => isResident }
    const client = {
        getChatMember: async () => ({ status, isMember: true, user: { isBot: false }, raw: { _: 'channelParticipantAdmin', canEdit: true } }),
        async editAdminRights({ rights }) {
            if (rights.postMessages) {
                started.resolve()
                await resume.promise
                status = 'admin'
            } else {
                status = 'member'
            }
            changes.push(status)
        },
        banChatMember: async () => changes.push('removed'),
    }
    const grant = grantIssuesPosting(client, residents, -42, 7)
    await started.promise
    isResident = false
    const remove = removeFormerIssuesMember(client, residents, -42, 7)
    resume.resolve()
    await Promise.all([grant, remove])
    assert.deepEqual(changes, ['admin', 'member', 'removed'])
})
