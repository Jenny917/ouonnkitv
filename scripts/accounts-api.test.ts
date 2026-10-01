// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from '../api/accounts'
import { accountEmail, usernameSchema } from '../shared/account-rules'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  profile: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  invalidate: vi.fn(),
  target: vi.fn(),
  list: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
const adminId = '00000000-0000-4000-8000-000000000001'
const userId = '00000000-0000-4000-8000-000000000002'
const profile = {
  id: adminId,
  username: 'admin',
  role: 'admin',
  enabled: true,
  created_at: '2026-10-01',
}

beforeEach(() => {
  vi.stubEnv('OKI_SUPABASE_URL', 'https://test.supabase.co')
  vi.stubEnv('OKI_SUPABASE_ANON_KEY', 'public-key')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-secret')
  mocks.profile.mockReset().mockResolvedValue({ data: [profile], error: null })
  mocks.createUser.mockReset().mockResolvedValue({ error: null })
  mocks.updateUser.mockReset().mockResolvedValue({ error: null })
  mocks.invalidate.mockReset().mockResolvedValue({ error: null })
  mocks.target.mockReset().mockResolvedValue({ data: { id: userId, role: 'user' }, error: null })
  mocks.list.mockReset().mockResolvedValue({ data: [profile], error: null })
  mocks.createClient.mockReset().mockImplementation((_url, key) =>
    key === 'public-key'
      ? { rpc: mocks.profile }
      : {
          auth: { admin: { createUser: mocks.createUser, updateUserById: mocks.updateUser } },
          rpc: mocks.invalidate,
          from: () => ({
            select: () => ({
              eq: () => ({ maybeSingle: mocks.target }),
              order: () => ({ order: () => ({ range: mocks.list }) }),
            }),
          }),
        },
  )
})

async function request(body?: unknown, authorization: string | null = 'Bearer token') {
  const req = {
    method: body ? 'POST' : 'GET',
    query: {},
    body,
    headers: { ...(authorization ? { authorization } : {}), 'content-type': 'application/json' },
  } as unknown as VercelRequest
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() }
  res.status.mockReturnValue(res)
  await handler(req, res as unknown as VercelResponse)
  return res
}

describe('managed account API', () => {
  it('rejects unauthenticated callers before creating a privileged client', async () => {
    const res = await request(undefined, null)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
  it('rejects ordinary users and disabled/stale sessions', async () => {
    for (const rows of [[{ ...profile, role: 'user' }], [{ ...profile, enabled: false }], []]) {
      mocks.profile.mockResolvedValueOnce({ data: rows, error: null })
      const res = await request({ action: 'create', username: 'alice', password: 'long-password' })
      expect(res.status).toHaveBeenCalledWith(403)
    }
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(mocks.createClient.mock.calls.every(call => call[1] === 'public-key')).toBe(true)
  })
  it('creates normalized usernames with server-controlled role metadata', async () => {
    const res = await request({
      action: 'create',
      username: ' Alice ',
      password: 'long-password',
      role: 'admin',
    })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: 'alice@users.ouonnki.invalid',
      password: 'long-password',
      email_confirm: true,
      app_metadata: { managed_account: true, username: 'alice', account_role: 'user' },
    })
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('long-password')
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('server-secret')
  })
  it('prevents self-lockout and modifications of admin accounts', async () => {
    mocks.target.mockResolvedValue({ data: { id: adminId, role: 'admin' }, error: null })
    const res = await request({ action: 'set-enabled', id: adminId, enabled: false })
    expect(res.status).toHaveBeenCalledWith(403)
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })
  it('invalidates sessions both before and after changing a password', async () => {
    await request({ action: 'reset-password', id: userId, password: 'new-password-123' })
    expect(mocks.invalidate).toHaveBeenCalledTimes(2)
    expect(mocks.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateUser.mock.invocationCallOrder[0],
    )
    expect(mocks.invalidate.mock.invocationCallOrder[1]).toBeGreaterThan(
      mocks.updateUser.mock.invocationCallOrder[0],
    )
  })
  it('uses database session invalidation when disabling or re-enabling users', async () => {
    await request({ action: 'set-enabled', id: userId, enabled: false })
    expect(mocks.invalidate).toHaveBeenCalledWith('invalidate_account_sessions', {
      target_id: userId,
      new_enabled: false,
    })
  })
  it('rejects weak passwords and invalid usernames', async () => {
    const res = await request({ action: 'create', username: 'a@b', password: 'short' })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(usernameSchema.safeParse('a@b').success).toBe(false)
    expect(accountEmail(' A ')).toBe('a@users.ouonnki.invalid')
  })
})
