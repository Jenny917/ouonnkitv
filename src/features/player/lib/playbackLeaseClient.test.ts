import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { playbackLeaseClient } from './playbackLeaseClient'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  setHeader: vi.fn(),
  abortSignal: vi.fn(),
  state: { account: { id: 'account-a' }, session: { access_token: 'token-a' } },
}))

vi.mock('@/shared/sync/client', () => ({ syncClient: { rpc: mocks.rpc } }))
vi.mock('@/shared/store/authStore', () => ({
  useAuthStore: { getState: () => mocks.state },
}))

beforeEach(() => {
  mocks.state = { account: { id: 'account-a' }, session: { access_token: 'token-a' } }
  mocks.rpc.mockReturnValue({ setHeader: mocks.setHeader })
  mocks.setHeader.mockReturnValue({ abortSignal: mocks.abortSignal })
  mocks.abortSignal.mockResolvedValue({ data: { status: 'lost' }, error: null })
})

describe('playback lease RPC contract', () => {
  it('sends the exact parameter names declared by the SQL migration', async () => {
    const request = playbackLeaseClient('episode-1', 'Example')
    await request({ operation: 'renew', lease: 'lease-1', position: 42, duration: 120 })
    const [name, payload] = mocks.rpc.mock.calls[0]
    const sql = readFileSync('supabase/migrations/202610030001_playback_lease.sql', 'utf8')
    const signature = sql.match(/create function public\.playback_lease\(([\s\S]*?)\)/)?.[1]
    expect(signature).toBeDefined()
    const parameters = signature!.split(',').map(parameter => parameter.trim().split(/\s+/)[0])
    expect(Object.keys(payload).sort()).toEqual(parameters.sort())
    expect(name).toBe('playback_lease')
    expect(payload).toMatchObject({
      p_operation: 'renew',
      p_lease: 'lease-1',
      p_position: 42,
      p_duration: 120,
      p_media_key: 'episode-1',
      p_title: 'Example',
    })
    expect(mocks.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer token-a')
  })

  it('uses a refreshed token and keeps the same player when taking over', async () => {
    const request = playbackLeaseClient('episode-1', 'Example')
    await request({ operation: 'acquire', position: 0, duration: 120 })
    mocks.state.session.access_token = 'refreshed'
    await request({ operation: 'acquire', takeover: 'other-lease', position: 0, duration: 120 })
    expect(mocks.rpc.mock.calls[1][1].p_player).toBe(mocks.rpc.mock.calls[0][1].p_player)
    expect(mocks.rpc.mock.calls[1][1].p_takeover).toBe('other-lease')
    expect(mocks.setHeader).toHaveBeenLastCalledWith('Authorization', 'Bearer refreshed')
  })

  it('rejects requests after switching accounts', async () => {
    const request = playbackLeaseClient('episode-1', 'Example')
    mocks.state.account.id = 'account-b'
    await expect(request({ operation: 'renew', position: 1, duration: 120 })).rejects.toThrow()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
