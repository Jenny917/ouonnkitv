import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ login: vi.fn(), rpc: vi.fn(), signOut: vi.fn() }))
vi.mock('@/shared/sync/client', () => ({
  syncClient: {
    auth: { signInWithPassword: mocks.login, signOut: mocks.signOut },
    rpc: () => ({ setHeader: mocks.rpc }),
  },
}))
import { useAuthStore } from './authStore'
const id = '00000000-0000-4000-8000-000000000001'
const account = { id, username: 'alice', role: 'user', enabled: true, created_at: '2026-10-01' }
beforeEach(() => {
  useAuthStore.setState({ session: null, account: null, initialized: false, error: null })
  mocks.login.mockResolvedValue({
    data: { session: { access_token: 'jwt', user: { id } } },
    error: null,
  })
  mocks.rpc.mockResolvedValue({ data: [account], error: null })
  mocks.signOut.mockResolvedValue({ error: null })
})
describe('account login', () => {
  it('uses a username and validates the live account before granting access', async () => {
    await useAuthStore.getState().login(' Alice ', 'password-123')
    expect(mocks.login).toHaveBeenCalledWith({
      email: 'alice@users.ouonnki.invalid',
      password: 'password-123',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('Authorization', 'Bearer jwt')
    expect(useAuthStore.getState().account?.username).toBe('alice')
  })
  it('does not authorize a disabled account or an old invalidated session', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(useAuthStore.getState().login('alice', 'password-123')).rejects.toThrow()
    expect(useAuthStore.getState().session).toBeNull()
  })
  it('fails closed when account verification is unavailable on a fresh login', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } })
    await expect(useAuthStore.getState().login('alice', 'password-123')).rejects.toThrow()
    expect(useAuthStore.getState().account).toBeNull()
  })
  it('signs out only this device and clears its active identity', async () => {
    await useAuthStore.getState().login('alice', 'password-123')
    await useAuthStore.getState().logout()
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(useAuthStore.getState().account).toBeNull()
  })
})
