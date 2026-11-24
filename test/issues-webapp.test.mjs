import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Storage } from '../src/storage.ts'
import { startWebappServer } from '../src/webapp.ts'

const token = 'test-bot-token'
const guest = 32
const devGuest = 33

function signedInitData(id, signingToken) {
    const authDate = String(Math.floor(Date.now() / 1000))
    const user = JSON.stringify({ id, first_name: 'Test' })
    const secret = createHmac('sha256', 'WebAppData').update(signingToken).digest()
    const hash = createHmac('sha256', secret).update(`auth_date=${authDate}\nuser=${user}`).digest('hex')
    return new URLSearchParams({ user, auth_date: authDate, hash }).toString()
}

async function startApi(t, resident, createIssuesInvite) {
    const dir = await mkdtemp(join(tmpdir(), 'robot-issues-test-'))
    const access = t.mock.fn(async id => ({ resident: id === resident, member: true, banned: false }))
    const { server, stop } = startWebappServer({
        client: {}, storage: new Storage(join(dir, 'state.json')),
        residents: { access, confirmResidency: async id => id === resident },
        botToken: token, devUserIds: new Set([devGuest]), allowedChats: new Set(),
        config: { publicUrl: 'https://example.invalid', port: 0, host: '127.0.0.1' },
        tzOffsetMinutes: 0, createIssuesInvite,
    })
    t.after(async () => {
        const closed = once(server, 'close')
        stop()
        await closed
        await rm(dir, { recursive: true, force: true })
    })
    await once(server, 'listening')
    const url = `http://127.0.0.1:${server.address().port}/api/issues.invite`
    const request = async (id, signingToken = token) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: signedInitData(id, signingToken) }),
        })
        return { status: response.status, headers: response.headers, body: await response.json() }
    }
    return { request, access }
}

test('issues API only creates invites for authenticated residents and rate-limits before issuance', async (t) => {
    const resident = 31
    const createInvite = t.mock.fn(async () => 'https://example.invalid/channel-invite')
    const { request, access } = await startApi(t, resident, createInvite)
    const invalid = await request(resident, 'different-test-token')
    assert.equal(invalid.status, 401)
    assert.equal(invalid.body.error, 'bad_init_data')
    assert.equal(access.mock.callCount(), 0)
    for (const userId of [guest, devGuest]) {
        const denied = await request(userId)
        assert.equal(denied.status, 403)
        assert.equal(denied.body.error, 'not_resident')
    }
    assert.equal(createInvite.mock.callCount(), 0)
    for (let i = 0; i < 10; i++) {
        const issued = await request(resident)
        assert.equal(issued.status, 200)
        assert.equal(issued.headers.get('cache-control'), 'no-store')
        assert.deepEqual(issued.body, { url: 'https://example.invalid/channel-invite' })
    }
    const checked = access.mock.callCount()
    const limited = await request(resident)
    assert.equal(limited.status, 429)
    assert.equal(limited.body.error, 'rate_limited')
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    assert.equal(access.mock.callCount(), checked)
    assert.deepEqual(createInvite.mock.calls.map(call => call.arguments), Array.from({ length: 10 }, () => [resident]))
})

test('issues API reports an unconfigured channel to a resident', async (t) => {
    const resident = 41
    const { request } = await startApi(t, resident, null)
    const disabled = await request(resident)
    assert.equal(disabled.status, 404)
    assert.equal(disabled.body.error, 'issues_disabled')
    assert.equal(disabled.body.url, undefined)
})

test('issues API reports invite creation failure without returning a link', async (t) => {
    const resident = 42
    t.mock.method(console, 'error', () => {})
    const { request } = await startApi(t, resident, async () => { throw new Error('test failure') })
    const unavailable = await request(resident)
    assert.equal(unavailable.status, 503)
    assert.equal(unavailable.body.error, 'issues_unavailable')
    assert.equal(unavailable.body.url, undefined)
})

test('issues API refuses a resident who left after the cached access check', async (t) => {
    const resident = 43
    const { request } = await startApi(t, resident, async () => null)
    const denied = await request(resident)
    assert.equal(denied.status, 403)
    assert.equal(denied.body.error, 'not_resident')
    assert.equal(denied.body.url, undefined)
})
