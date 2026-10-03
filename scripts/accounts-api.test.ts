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
  getUser: vi.fn(),
  range: vi.fn(),
  filter: vi.fn(),
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
  mocks.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { last_sign_in_at: '2026-10-02T01:00:00Z' } }, error: null })
  mocks.range.mockReset()
  mocks.filter.mockReset()
  mocks.invalidate.mockReset().mockResolvedValue({ error: null })
  mocks.target
    .mockReset()
    .mockResolvedValue({ data: { id: userId, role: 'user', username: 'alice' }, error: null })
  mocks.list.mockReset().mockResolvedValue({ data: [profile], count: 1, error: null })
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
  function query(table: string) {
    const chain = {
      select: () => chain,
      order: () => chain,
      eq: (...args: unknown[]) => {
        mocks.filter(...args)
        return chain
      },
      or: (...args: unknown[]) => {
        mocks.filter(...args)
        return chain
      },
      ilike: (...args: unknown[]) => {
        mocks.filter(...args)
        return chain
      },
      range: (...args: unknown[]) => {
        mocks.range(table, ...args)
        return chain
      },
      maybeSingle: mocks.target,
      insert: table === 'admin_audit_log' ? mocks.insertAudit : mocks.insertProfile,
      then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
        (table === 'account_devices' ? mocks.devices() : mocks.list()).then(resolve, reject),
    }
    return chain
  }
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
              getUserById: mocks.getUser,
            },
          },
          rpc: mocks.invalidate,
          from: query,
        },
  )
})

async function request(body?: unknown, authorization: string | null = 'Bearer token', query = {}) {
  const req = {
    method: body ? 'POST' : 'GET',
    query,
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
  it('paginates summaries without loading devices or the Auth directory', async () => {
    const res = await request()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ accounts: [profile], total: 1 })
    expect(mocks.range).toHaveBeenCalledWith('user_accounts', 0, 19)
    expect(mocks.devices).not.toHaveBeenCalled()
    expect(mocks.listUsers).not.toHaveBeenCalled()
    expect(mocks.getUser).not.toHaveBeenCalled()
  })
  it('applies search and permission filters to the requested database page', async () => {
    await request(undefined, 'Bearer token', {
      offset: '20',
      search: 'a_b',
      enabled: 'false',
      nsfw: 'false',
    })
    expect(mocks.range).toHaveBeenCalledWith('user_accounts', 20, 39)
    expect(mocks.filter).toHaveBeenCalledWith('username', '%a\\_b%')
    expect(mocks.filter).toHaveBeenCalledWith('enabled', false)
    expect(mocks.filter).toHaveBeenCalledWith('role', 'user')
    expect(mocks.filter).toHaveBeenCalledWith('allow_nsfw', false)
  })
  it('loads only the selected account and requested device page', async () => {
    const res = await request(undefined, 'Bearer token', { id: userId, offset: '20' })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.getUser).toHaveBeenCalledWith(userId)
    expect(mocks.filter).toHaveBeenCalledWith('user_id', userId)
    expect(mocks.range).toHaveBeenCalledWith('account_devices', 20, 39)
    expect(mocks.listUsers).not.toHaveBeenCalled()
  })
  it('rejects invalid offsets, filters and detail ids', async () => {
    for (const query of [
      { offset: '-1' },
      { offset: '1.5' },
      { enabled: 'yes' },
      { nsfw: 'all' },
      { id: 'bad' },
    ]) {
      expect((await request(undefined, 'Bearer token', query)).status).toHaveBeenCalledWith(400)
    }
    expect(mocks.devices).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('returns 404 for a deleted account without looking up its devices', async () => {
    mocks.target.mockResolvedValue({ data: null, error: null })
    expect((await request(undefined, 'Bearer token', { id: userId })).status).toHaveBeenCalledWith(
      404,
    )
    expect(mocks.devices).not.toHaveBeenCalled()
  })
  it('paginates audit independently from accounts', async () => {
    mocks.list.mockResolvedValue({ data: [], count: 20, error: null })
    const res = await request(undefined, 'Bearer token', { view: 'audit', offset: '20' })
    expect(res.json).toHaveBeenCalledWith({ audit: [], total: 20 })
    expect(mocks.range).toHaveBeenCalledWith('admin_audit_log', 20, 39)
    expect(mocks.getUser).not.toHaveBeenCalled()
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
      allow_nsfw: false,
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
  it('changes NSFW access and invalidates existing sessions', async () => {
    const res = await request({ action: 'set-nsfw', id: userId, allow_nsfw: true })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.invalidate).toHaveBeenCalledWith('set_account_nsfw', {
      target_id: userId,
      new_allow_nsfw: true,
    })
    expect(mocks.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'set_nsfw', details: { allow_nsfw: true } }),
    )
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
