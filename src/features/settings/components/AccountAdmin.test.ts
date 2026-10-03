import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountAdmin from './AccountAdmin'

vi.mock('@/shared/sync/client', () => ({
  syncClient: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) },
  },
}))

const account = {
  id: '00000000-0000-4000-8000-000000000002',
  username: 'alice',
  role: 'user',
  enabled: true,
  created_at: '2026-10-01',
}
let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>
const response = (data: unknown) => ({ ok: true, json: async () => data })
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  fetchMock = vi.fn(async (url: string) => {
    const query = new URL(url, 'https://test.invalid').searchParams
    if (query.has('id')) return response({ account: { ...account, devices: [] }, total: 0 })
    return response({ accounts: [account], total: 21 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function mount(path = '/admin') {
  await act(async () =>
    root.render(
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(AccountAdmin)),
    ),
  )
}
async function click(text: string) {
  const element = [...container.querySelectorAll('button,a')].find(
    node => node.textContent === text,
  )
  expect(element).toBeTruthy()
  await act(async () => (element as HTMLElement).click())
}
describe('admin account navigation', () => {
  it('loads only summaries, pages on the server and loads details on demand', async () => {
    await mount()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('重置密码')
    await click('下一页')
    expect(fetchMock.mock.lastCall?.[0]).toContain('offset=20')
    expect(container.textContent).toContain('21–21 / 21')
    const next = [...container.querySelectorAll('button')].find(
      node => node.textContent === '下一页',
    )
    expect(next?.disabled).toBe(true)
    await click('查看详情')
    expect(fetchMock.mock.lastCall?.[0]).toContain(`id=${account.id}`)
    expect(container.textContent).toContain('重置密码')
    await click('账号列表')
    expect(fetchMock.mock.lastCall?.[0]).toContain('offset=20')
  })
  it('resets pagination when filtering and preserves the search term', async () => {
    await mount('/admin?page=2&search=alice')
    await act(async () => {
      const select = container.querySelector('select')!
      select.value = 'false'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const query = new URL(fetchMock.mock.lastCall![0], 'https://test.invalid').searchParams
    expect(query.get('offset')).toBe('0')
    expect(query.get('search')).toBe('alice')
    expect(query.get('enabled')).toBe('false')
  })
  it('ignores a late response from a previous filter', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    await mount()
    await act(async () => {
      const select = container.querySelector('select')!
      select.value = 'false'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () =>
      finish(response({ accounts: [{ ...account, username: 'stale' }], total: 1 })),
    )
    expect(container.textContent).toContain('alice')
    expect(container.textContent).not.toContain('stale')
  })
})
