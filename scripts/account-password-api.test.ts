// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from '../api/account-password'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  profile: vi.fn(),
  active: vi.fn(),
  login: vi.fn(),
  update: vi.fn(),
  logout: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
const id = '00000000-0000-4000-8000-000000000001'
const profile = { id, username: 'alice', role: 'user', enabled: true, created_at: '2026-10-01' }
const body = { currentPassword: 'current-password', newPassword: 'new-password-123' }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('OKI_SUPABASE_URL', 'https://test.supabase.co')
  vi.stubEnv('OKI_SUPABASE_ANON_KEY', 'public-key')
  mocks.profile.mockResolvedValue({ data: [profile], error: null })
  mocks.active.mockResolvedValue({ data: [profile], error: null })
  mocks.login.mockResolvedValue({ data: { session: {}, user: { id } }, error: null })
  mocks.update.mockResolvedValue({ error: null })
  mocks.logout.mockResolvedValue({ error: null })
  mocks.createClient.mockReturnValueOnce({ rpc: mocks.profile }).mockReturnValue({
    rpc: mocks.active,
    auth: { signInWithPassword: mocks.login, updateUser: mocks.update, signOut: mocks.logout },
  })
})
async function request(input: unknown = body, token: string | null = 'Bearer token') {
  const req = {
    method: 'POST',
    headers: { authorization: token, 'content-type': 'application/json' },
    body: input,
  }
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() }
  res.status.mockReturnValue(res)
  await handler(req as unknown as VercelRequest, res as unknown as VercelResponse)
  return res
}
describe('self-service password changes', () => {
  it('requires authentication before doing any work', async () => {
    expect((await request(body, null)).status).toHaveBeenCalledWith(401)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
  it('rejects stale or disabled accounts', async () => {
    mocks.profile.mockResolvedValueOnce({ data: [], error: null })
    expect((await request()).status).toHaveBeenCalledWith(401)
    expect(mocks.login).not.toHaveBeenCalled()
  })
  it('requires a correct current password', async () => {
    mocks.login.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'wrong password' },
    })
    expect((await request()).status).toHaveBeenCalledWith(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('changes only the authenticated account even when a target ID is supplied', async () => {
    const res = await request({ ...body, id: 'another-user', role: 'admin' })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.login).toHaveBeenCalledWith({
      email: 'alice@users.ouonnki.invalid',
      password: body.currentPassword,
    })
    expect(mocks.update).toHaveBeenCalledWith({
      password: body.newPassword,
      current_password: body.currentPassword,
    })
    expect(mocks.logout).toHaveBeenCalledWith({ scope: 'local' })
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    expect(mocks.createClient.mock.calls.every(call => call[1] === 'public-key')).toBe(true)
  })
  it('rejects an identity mismatch and disposes the temporary session', async () => {
    mocks.login.mockResolvedValueOnce({
      data: { session: {}, user: { id: 'wrong-id' } },
      error: null,
    })
    expect((await request()).status).toHaveBeenCalledWith(400)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.logout).toHaveBeenCalled()
  })
  it('rejects a user disabled during verification', async () => {
    mocks.active.mockResolvedValueOnce({ data: [], error: null })
    expect((await request()).status).toHaveBeenCalledWith(403)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.logout).toHaveBeenCalled()
  })
  it('validates password length and prevents reusing the current password', async () => {
    expect((await request({ ...body, newPassword: 'short' })).status).toHaveBeenCalledWith(400)
    expect(
      (await request({ ...body, newPassword: body.currentPassword })).status,
    ).toHaveBeenCalledWith(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('reports password policy failures without leaking credentials and cleans up', async () => {
    mocks.update.mockResolvedValueOnce({ error: { message: body.newPassword } })
    const res = await request()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(body.newPassword)
    expect(mocks.logout).toHaveBeenCalled()
  })
})
