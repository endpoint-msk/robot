import assert from 'node:assert/strict'
import test from 'node:test'
import { grantIssuesPosting } from '../src/issues-access.ts'

const channelId = -1000000000001
const userId = 42
const resident = { confirmResidency: async () => true }

test('grants only posting after fresh checks of residency and channel membership', async () => {
    const calls = []
    const residents = {
        confirmResidency: async (id) => {
            calls.push(['resident', id])
            return true
        },
    }
    const client = {
        getChatMember: async (params) => {
            calls.push(['member', params])
            return { status: 'member', user: { isBot: false } }
        },
        editAdminRights: async (params) => calls.push(['promote', params]),
    }
    assert.equal(await grantIssuesPosting(client, residents, channelId, userId), true)
    assert.deepEqual(calls, [
        ['resident', userId],
        ['member', { chatId: channelId, userId }],
        ['promote', { chatId: channelId, userId, rights: { postMessages: true } }],
    ])
})

test('preserves channel admins, restrictions and absent membership', async (t) => {
    const editAdminRights = t.mock.fn()
    const users = ['creator', 'admin', 'restricted', 'banned', 'left'].map(status => ({ status, user: { isBot: false } }))
    for (const member of [null, ...users, { status: 'member', user: { isBot: true } }]) {
        const client = { getChatMember: async () => member, editAdminRights }
        assert.equal(await grantIssuesPosting(client, resident, channelId, userId), false)
    }
    assert.equal(editAdminRights.mock.callCount(), 0)
})

test('refuses promotion after exit and propagates membership lookup errors', async (t) => {
    const editAdminRights = t.mock.fn()
    const unavailable = async () => { throw new Error('lookup unavailable') }
    const client = { getChatMember: t.mock.fn(unavailable), editAdminRights }
    assert.equal(await grantIssuesPosting(client, { confirmResidency: async () => false }, channelId, userId), false)
    await assert.rejects(grantIssuesPosting(client, { confirmResidency: unavailable }, channelId, userId), /lookup unavailable/)
    assert.equal(client.getChatMember.mock.callCount(), 0)
    await assert.rejects(grantIssuesPosting(client, resident, channelId, userId), /lookup unavailable/)
    assert.equal(editAdminRights.mock.callCount(), 0)
})
