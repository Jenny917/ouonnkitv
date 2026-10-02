import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoSource } from '@ouonnki/cms-core'

const mocks = vi.hoisted(() => ({
  publicSources: vi.fn(),
  restrictedSources: vi.fn(),
}))

vi.mock('@/shared/config/api.config', () => ({
  getInitialVideoSources: mocks.publicSources,
  getAuthorizedNsfwVideoSources: mocks.restrictedSources,
}))

import { useApiStore } from './apiStore'

const source = (id: string, name = id): VideoSource => ({
  id,
  name,
  url: `https://${id}.example/api`,
  isEnabled: true,
})

beforeEach(() => {
  localStorage.clear()
  mocks.publicSources.mockReset().mockResolvedValue([source('env_source_0', 'Public')])
  mocks.restrictedSources.mockReset().mockResolvedValue([])
  useApiStore.setState({
    videoAPIs: [source('manual_source', 'Manual'), source('nsfw_env_0', 'Old restricted')],
    adFilteringEnabled: true,
  })
})

describe('account source access', () => {
  it('removes previously issued NSFW sources when the account has no access', async () => {
    await useApiStore.getState().initializeEnvSources()
    expect(useApiStore.getState().videoAPIs.map(item => item.id)).toEqual([
      'manual_source',
      'env_source_0',
    ])
  })

  it('adds server-authorized NSFW sources alongside public sources', async () => {
    mocks.restrictedSources.mockResolvedValueOnce([source('nsfw_env_0', 'Restricted')])
    await useApiStore.getState().initializeEnvSources()
    expect(useApiStore.getState().videoAPIs.map(item => item.id)).toEqual([
      'manual_source',
      'env_source_0',
      'nsfw_env_0',
    ])
  })

  it('clears restricted sources as soon as the authenticated account is removed', () => {
    useApiStore.getState().clearRestrictedSources()
    expect(useApiStore.getState().videoAPIs.map(item => item.id)).toEqual(['manual_source'])
  })
})
