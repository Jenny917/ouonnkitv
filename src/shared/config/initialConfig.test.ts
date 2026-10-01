import { describe, expect, it, vi } from 'vitest'
import { parseInitialConfig } from './initialConfig'

describe('parseInitialConfig', () => {
  it('解析应用导出的完整配置字段', () => {
    const config = parseInitialConfig(
      `'${JSON.stringify({
        settings: { system: { tmdbApiToken: 'token-from-config' } },
        videoSources: 'https://example.com/sources.json',
        subscriptions: [{ id: 'subscription-1', url: 'https://example.com/feed.json' }],
        adFilteringEnabled: false,
      })}'`,
    )

    expect(config?.settings?.system?.tmdbApiToken).toBe('token-from-config')
    expect(config?.videoSources).toBe('https://example.com/sources.json')
    expect(config?.subscriptions).toHaveLength(1)
    expect(config?.adFilteringEnabled).toBe(false)
  })

  it('拒绝非对象根节点', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(parseInitialConfig('[]')).toBeNull()
  })
})
