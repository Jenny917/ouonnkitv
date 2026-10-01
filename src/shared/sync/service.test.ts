import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { useViewingHistoryStore } from '@/shared/store/viewingHistoryStore'
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore'
import { useAuthStore } from '@/shared/store/authStore'
import { useSettingStore } from '@/shared/store/settingStore'
import type { ViewingHistoryItem } from '@/shared/types'
import { recordKey, type SyncRecord } from './records'

const mocks = vi.hoisted(() => ({
  authCallback: null as null | ((event: string, session: Session | null) => void),
  rpc: vi.fn(),
  range: vi.fn(),
}))
vi.mock('./client', () => ({
  syncClient: {
    auth: {
      onAuthStateChange: (callback: typeof mocks.authCallback) => {
        mocks.authCallback = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
    rpc: (...args: unknown[]) => ({ setHeader: () => mocks.rpc(...args) }),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => ({
              range: (...args: unknown[]) => ({ setHeader: () => mocks.range(...args) }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { startSync, syncNow, useSyncStatus } from './service'

const item = (vodId: string): ViewingHistoryItem => ({
  recordType: 'cms',
  title: vodId,
  imageUrl: '',
  episodeIndex: 0,
  sourceCode: 'source',
  sourceName: 'Source',
  vodId,
  timestamp: 100,
  playbackPosition: 30,
  duration: 120,
})
const session = (id: string) =>
  ({ access_token: `token-${id}`, user: { id, email: `${id}@example.com` } }) as Session
let stop: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useFavoritesStore.setState({ favorites: [] })
  useViewingHistoryStore.setState({ viewingHistory: [item('guest')] })
  useSettingStore.getState().resetSettings()
  mocks.rpc.mockReset().mockResolvedValue({ error: null })
  mocks.range.mockReset().mockResolvedValue({ data: [], error: null })
  useAuthStore.setState({ session: null, account: null })
  mocks.authCallback = (_event, value) =>
    useAuthStore.setState({
      session: value,
      account: value
        ? {
            id: value.user.id,
            username: value.user.id,
            role: 'user',
            enabled: true,
            created_at: '2026-10-01',
          }
        : null,
    })
  stop = startSync()
})
afterEach(() => {
  stop?.()
  vi.useRealTimers()
})

describe('cloud sync lifecycle', () => {
  it('restores guest data on sign-out and isolates account caches', async () => {
    mocks.authCallback!('SIGNED_IN', session('alice'))
    useViewingHistoryStore.getState().addViewingHistory(item('alice-private'))
    await syncNow()
    mocks.authCallback!('SIGNED_OUT', null)
    expect(useViewingHistoryStore.getState().viewingHistory.map(row => row.vodId)).toEqual([
      'guest',
    ])
    mocks.authCallback!('SIGNED_IN', session('bob'))
    expect(useViewingHistoryStore.getState().viewingHistory).toEqual([])
    mocks.authCallback!('SIGNED_IN', session('alice'))
    expect(
      useViewingHistoryStore.getState().viewingHistory.some(row => row.vodId === 'alice-private'),
    ).toBe(true)
  })

  it('retains queued edits after network failure and reload', async () => {
    mocks.authCallback!('SIGNED_IN', session('alice'))
    mocks.rpc.mockResolvedValue({ error: { message: 'Network unavailable' } })
    useViewingHistoryStore.getState().addViewingHistory(item('offline'))
    await syncNow()
    expect(useSyncStatus.getState().error).toBe('Network unavailable')
    stop!()
    stop = startSync()
    mocks.authCallback!('INITIAL_SESSION', session('alice'))
    mocks.rpc.mockResolvedValue({ error: null })
    await syncNow()
    const sent = mocks.rpc.mock.calls[mocks.rpc.mock.calls.length - 1][1].changes as SyncRecord[]
    expect(sent.some(row => row.item_key.includes('offline'))).toBe(true)
  })

  it('ignores responses from an account that signed out during upload', async () => {
    mocks.authCallback!('SIGNED_IN', session('alice'))
    useViewingHistoryStore.getState().addViewingHistory(item('guest'))
    let resolve!: (value: { error: null }) => void
    mocks.rpc.mockReturnValueOnce(
      new Promise(result => {
        resolve = result
      }),
    )
    const syncing = syncNow()
    mocks.authCallback!('SIGNED_OUT', null)
    mocks.authCallback!('SIGNED_IN', session('bob'))
    resolve({ error: null })
    await syncing
    expect(useSyncStatus.getState().username).toBe('bob')
    expect(mocks.range).not.toHaveBeenCalled()
  })

  it('does not lose a progress update made while an upload is in flight', async () => {
    mocks.authCallback!('SIGNED_IN', session('alice'))
    useViewingHistoryStore.getState().addViewingHistory(item('guest'))
    let resolve!: (value: { error: null }) => void
    mocks.rpc.mockReturnValueOnce(
      new Promise(result => {
        resolve = result
      }),
    )
    const syncing = syncNow()
    useViewingHistoryStore.getState().addViewingHistory({ ...item('guest'), playbackPosition: 70 })
    resolve({ error: null })
    await syncing
    const cache = JSON.parse(localStorage.getItem('ouonnki-cloud-v1:alice')!)
    const key = recordKey({ kind: 'history', item_key: 'cms::source::guest::0' })
    expect(cache[key].pending).toBe(true)
    expect(cache[key].value.playbackPosition).toBe(70)
  })

  it('restores guest data when a saved session is missing on reload', () => {
    mocks.authCallback!('SIGNED_IN', session('alice'))
    useViewingHistoryStore.getState().addViewingHistory(item('alice-private'))
    stop!()
    stop = startSync()
    mocks.authCallback!('INITIAL_SESSION', null)
    expect(useViewingHistoryStore.getState().viewingHistory.map(row => row.vodId)).toEqual([
      'guest',
    ])
  })

  it('never uploads API credentials or proxy settings', async () => {
    useSettingStore.getState().setSystemSettings({ tmdbApiToken: 'private-token' })
    useSettingStore.getState().setNetworkSettings({ proxyUrl: 'https://private-proxy.example' })
    mocks.authCallback!('SIGNED_IN', session('alice'))
    useViewingHistoryStore.getState().addViewingHistory(item('check'))
    await syncNow()
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('private-token')
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('private-proxy')
  })
})
