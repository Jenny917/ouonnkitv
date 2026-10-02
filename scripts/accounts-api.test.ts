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
  deleteUser: vi.fn(),
  listUsers: vi.fn(),
  invalidate: vi.fn(),
  target: vi.fn(),
  list: vi.fn(),
  devices: vi.fn(),
  insertProfile: vi.fn(),
  insertAudit: vi.fn(),
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
  mocks.createUser.mockReset().mockResolvedValue({ data: { user: { id: userId } }, error: null })
  mocks.updateUser.mockReset().mockResolvedValue({ error: null })
  mocks.deleteUser.mockReset().mockResolvedValue({ error: null })
  mocks.listUsers.mockReset().mockResolvedValue({
    data: { users: [{ id: adminId, last_sign_in_at: '2026-10-02T01:00:00Z' }] },
    error: null,
  })
  mocks.invalidate.mockReset().mockResolvedValue({ error: null })
  mocks.target
    .mockReset()
    .mockResolvedValue({ data: { id: userId, role: 'user', username: 'alice' }, error: null })
  mocks.list.mockReset().mockResolvedValue({ data: [profile], error: null })
  mocks.devices.mockReset().mockResolvedValue({
    data: [
      {
        user_id: adminId,
        label: 'Chrome · Windows',
        first_seen_at: '2026-10-02T00:00:00Z',
        last_seen_at: '2026-10-02T01:00:00Z',
      },
    ],
    error: null,
  })
  mocks.insertProfile.mockReset().mockResolvedValue({ error: null })
  mocks.insertAudit.mockReset().mockResolvedValue({ error: null })
  mocks.createClient.mockReset().mockImplementation((_url, key) =>
    key === 'public-key'
      ? { rpc: mocks.profile }
      : {
          auth: {
            admin: {
              createUser: mocks.createUser,
              updateUserById: mocks.updateUser,
              deleteUser: mocks.deleteUser,
              listUsers: mocks.listUsers,
            },
          },
          rpc: mocks.invalidate,
          from: (table: string) =>
            table === 'admin_audit_log'
              ? { insert: mocks.insertAudit }
              : table === 'account_devices'
                ? {
                    select: () => ({
                      in: () => ({ order: mocks.devices }),
                    }),
                  }
                : {
                    insert: mocks.insertProfile,
                    select: () => ({
                      eq: () => ({ maybeSingle: mocks.target }),
                      order: () => ({ order: () => ({ range: mocks.list }) }),
                    }),
                  },
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
  it('lists last login and recent device activity for the dashboard', async () => {
    const res = await request()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      accounts: [
        expect.objectContaining({
          id: adminId,
          last_sign_in_at: '2026-10-02T01:00:00Z',
          devices: [
            expect.objectContaining({
              label: 'Chrome · Windows',
              last_seen_at: '2026-10-02T01:00:00Z',
            }),
          ],
        }),
      ],
      nextOffset: null,
    })
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
    expect(mocks.insertProfile).toHaveBeenCalledWith({
      id: userId,
      username: 'alice',
      role: 'user',
      enabled: true,
    })
    expect(mocks.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', target_username: 'alice' }),
    )
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
  it('forces logout for every device and records who performed it', async () => {
    const res = await request({ action: 'force-logout', id: userId })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.invalidate).toHaveBeenCalledWith('invalidate_account_sessions', {
      target_id: userId,
      new_enabled: null,
    })
    expect(mocks.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_username: 'admin',
        target_username: 'alice',
        action: 'force_logout',
      }),
    )
  })
  it('invalidates sessions before permanently deleting a user and records the deletion', async () => {
    const res = await request({ action: 'delete', id: userId })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteUser.mock.invocationCallOrder[0],
    )
    expect(mocks.deleteUser).toHaveBeenCalledWith(userId)
    expect(mocks.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', target_username: 'alice' }),
    )
  })
  it('rejects weak passwords and invalid usernames', async () => {
    const res = await request({ action: 'create', username: 'a@b', password: 'short' })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(usernameSchema.safeParse('a@b').success).toBe(false)
    expect(accountEmail(' A ')).toBe('a@users.ouonnki.invalid')
  })
})
