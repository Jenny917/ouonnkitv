// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from '../api/nsfw-sources'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), profile: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))

const account = {
  id: '00000000-0000-4000-8000-000000000002',
  username: 'alice',
  role: 'user',
  enabled: true,
  allow_nsfw: false,
  created_at: '2026-10-02T00:00:00Z',
}

beforeEach(() => {
  vi.stubEnv('OKI_SUPABASE_URL', 'https://test.supabase.co')
  vi.stubEnv('OKI_SUPABASE_ANON_KEY', 'public-key')
  vi.stubEnv(
    'NSFW_VIDEO_SOURCES',
    JSON.stringify([
      { name: 'Restricted source', url: 'https://source.example/api', isEnabled: true },
      { name: '', url: 'invalid' },
    ]),
  )
  mocks.profile.mockReset().mockResolvedValue({ data: [account], error: null })
  mocks.createClient.mockReset().mockReturnValue({ rpc: mocks.profile })
})

async function request(authorization: string | null = 'Bearer token') {
  const req = {
    method: 'GET',
    headers: authorization ? { authorization } : {},
  } as unknown as VercelRequest
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() }
  res.status.mockReturnValue(res)
  await handler(req, res as unknown as VercelResponse)
  return res
}

describe('NSFW source API', () => {
  it('requires authentication', async () => {
    const res = await request(null)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('returns no restricted sources without account permission', async () => {
    const res = await request()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ sources: [] })
  })

  it('returns validated restricted sources to permitted users', async () => {
    mocks.profile.mockResolvedValueOnce({
      data: [{ ...account, allow_nsfw: true }],
      error: null,
    })
    const res = await request()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      sources: [
        {
          id: 'nsfw_env_0',
          name: 'Restricted source',
          url: 'https://source.example/api',
          isEnabled: true,
        },
      ],
    })
  })

  it('gives administrators access without a separate flag', async () => {
    mocks.profile.mockResolvedValueOnce({
      data: [{ ...account, role: 'admin' }],
      error: null,
    })
    const res = await request()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].sources).toHaveLength(1)
  })
})
