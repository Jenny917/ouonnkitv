import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApiStore } from './apiStore'
import { useSubscriptionStore } from './subscriptionStore'

describe('subscriptionStore replaceSubscriptions', () => {
  afterEach(() => {
    useSubscriptionStore.getState().clearSubscriptions()
    useApiStore.setState({ videoAPIs: [] })
    vi.unstubAllGlobals()
  })

  it('恢复订阅并立即拉取对应视频源', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ name: '订阅源', url: 'https://video.example.com/api' }],
      }),
    )

    await useSubscriptionStore.getState().replaceSubscriptions([
      {
        id: 'subscription-1',
        name: '测试订阅',
        url: 'https://example.com/subscription.json',
        refreshInterval: 30,
      },
    ])

    expect(useSubscriptionStore.getState().subscriptions[0]).toMatchObject({
      id: 'subscription-1',
      name: '测试订阅',
      sourceCount: 1,
      lastRefreshSuccess: true,
      refreshInterval: 30,
    })
    expect(useApiStore.getState().videoAPIs[0]).toMatchObject({
      id: 'sub:subscription-1:0',
      name: '订阅源',
    })
  })
})
