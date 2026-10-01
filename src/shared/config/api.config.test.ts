import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadVideoSources } from './api.config'

describe('loadVideoSources', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('解析完整配置中的视频源数组', async () => {
    const sources = await loadVideoSources([
      { name: '测试源', url: 'https://video.example.com/api', retry: 0 },
    ])

    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      id: 'env_source_0',
      name: '测试源',
      detailUrl: 'https://video.example.com/api',
      retry: 0,
    })
  })

  it('通过代理加载完整配置中的远程视频源', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ name: '远程源', url: 'https://remote.example/api' }]),
    })
    vi.stubGlobal('fetch', fetchMock)

    const sources = await loadVideoSources('https://example.com/sources.json')

    expect(fetchMock).toHaveBeenCalledWith(
      `/proxy?url=${encodeURIComponent('https://example.com/sources.json')}`,
    )
    expect(sources[0]).toMatchObject({ name: '远程源', url: 'https://remote.example/api' })
  })
})
