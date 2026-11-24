import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileIssuesChannel } from '../src/issues-sync.ts'
import { createTelegramResidentDirectory } from '../src/residents.ts'
import { emptyState } from '../src/types.ts'

const channelId = -1000000000001
const residentChatId = -1000000000002

const member = (id, status = 'member') => ({
    user: { id, type: 'user', isBot: false, displayName: String(id), username: null },
    status,
    isMember: true,
    raw: status === 'admin' ? { _: 'channelParticipantAdmin', canEdit: true } : { _: 'channelParticipant' },
})

const setup = (residentIds, subscribers) => {
    const roster = new Map(residentIds.map(id => [id, member(id)]))
    const channel = new Map(subscribers.map(person => [person.user.id, person]))
    const edits = []
    const removals = []
    const chat = (id) => {
        assert([residentChatId, channelId].includes(id))
        return id === residentChatId ? roster : channel
    }
    const client = {
        async *iterChatMembers(id) { yield* chat(id).values() },
        async getChatMember({ chatId, userId }) { return chat(chatId).get(userId) ?? null },
        async editAdminRights({ chatId, userId, rights }) {
            assert.equal(chatId, channelId)
            assert(channel.has(userId))
            edits.push([userId, rights])
            channel.set(userId, member(userId, Object.keys(rights).length ? 'admin' : 'member'))
        },
        async banChatMember({ chatId, participantId }) {
            assert.equal(chatId, channelId)
            assert.equal(channel.get(participantId)?.status, 'member')
            removals.push(participantId)
            channel.delete(participantId)
        },
    }
    const start = (state = emptyState()) => {
        const residents = createTelegramResidentDirectory(client, new Set(), residentChatId)
        const storage = { get: () => state, update: async (mutate) => mutate(state) }
        return { state, residents, reconcile: () => reconcileIssuesChannel(client, residents, storage, channelId) }
    }
    return { client, roster, channel, edits, removals, start }
}

test('repairs missed joins and departures after restart and preserves unrelated subscribers and existing roles', async () => {
    const { start, roster, channel, edits, removals } = setup([1, 2, 3, 4], [
        member(1), member(3, 'admin'), member(4, 'restricted'), member(5),
    ])
    const first = start()
    await first.reconcile()
    assert.deepEqual(edits, [[1, { postMessages: true }]])
    assert.deepEqual(removals, [])

    roster.delete(1)
    channel.set(2, member(2))
    const restarted = start(JSON.parse(JSON.stringify(first.state)))
    await restarted.reconcile()
    await restarted.reconcile()
    assert.deepEqual(edits, [[1, { postMessages: true }], [1, {}], [2, { postMessages: true }]])
    assert.deepEqual(removals, [1])
    assert.equal(channel.get(3).status, 'admin')
    assert.equal(channel.get(4).status, 'restricted')
    assert.equal(channel.get(5).status, 'member')
})

test('stale roster and cached positive and negative membership never authorize a grant or removal', async () => {
    const { start, roster, edits, removals } = setup([1], [member(1), member(2)])
    const { residents, state, reconcile } = start()
    state.issuesChannelAccess[channelId + '#2'] = true
    assert.deepEqual([...await residents.listIds()], [1])
    assert.equal(await residents.isResident(1), true)
    assert.equal(await residents.isResident(2), false)
    roster.delete(1)
    roster.set(2, member(2))

    await reconcile()
    assert.deepEqual(edits, [])
    assert.deepEqual(removals, [])
})

test('defers changes on incomplete roster or failed live lookup and recovers on the next pass', async (t) => {
    t.mock.method(console, 'warn', () => {})
    t.mock.method(console, 'error', () => {})
    const { client, start, edits, removals } = setup([1], [member(1), member(2)])
    const { state, reconcile } = start()
    state.issuesChannelAccess[channelId + '#2'] = true
    const iterate = client.iterChatMembers
    const brokenRoster = t.mock.method(client, 'iterChatMembers', async function* (chatId) {
        yield* iterate(chatId)
        if (chatId === residentChatId) throw new Error('roster interrupted')
    })
    await reconcile()
    assert.deepEqual(edits, [])
    assert.deepEqual(removals, [])
    brokenRoster.mock.restore()

    const getMember = client.getChatMember
    const unavailable = t.mock.method(client, 'getChatMember', async (params) => {
        if (params.chatId === residentChatId) throw new Error('lookup interrupted')
        return getMember(params)
    })
    await reconcile()
    assert.deepEqual(edits, [])
    assert.deepEqual(removals, [])
    unavailable.mock.restore()

    await reconcile()
    assert.deepEqual(edits, [[1, { postMessages: true }]])
    assert.deepEqual(removals, [2])
})
