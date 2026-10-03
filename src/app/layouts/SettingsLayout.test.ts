import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsLayout from './SettingsLayout'

const auth = vi.hoisted(() => ({ account: { role: 'user' } }))
vi.mock('@/shared/store/authStore', () => ({
  useAuthStore: (select: (state: typeof auth) => unknown) => select(auth),
}))

let root: Root
let container: HTMLDivElement
function RetainedLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  // Model the parent animation retaining SettingsLayout after the URL changes.
  return createElement(
    Fragment,
    null,
    createElement('output', null, location.pathname),
    createElement('button', { onClick: () => navigate('/account') }, '我的账号'),
    createElement(SettingsLayout),
  )
}
beforeEach(() => {
  auth.account.role = 'user'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    },
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function mount(path: string) {
  await act(async () =>
    root.render(
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(RetainedLayout)),
    ),
  )
}
describe('settings navigation during exit animation', () => {
  it.each([
    ['返回', '/'],
    ['我的账号', '/account'],
  ])('allows %s to leave playback settings', async (label, destination) => {
    await mount('/settings/playback')
    const button = [...container.querySelectorAll('button')].find(
      node => node.textContent?.trim() === label,
    )!
    expect(button).toBeTruthy()
    await act(async () => button.click())
    expect(container.querySelector('output')?.textContent).toBe(destination)
  })
  it.each([
    '/settings',
    '/settings/source',
    '/settings/system',
    '/settings/profile',
    '/settings/about',
  ])('still blocks ordinary users from %s', async path => {
    await mount(path)
    expect(container.querySelector('output')?.textContent).toBe('/settings/playback')
  })
  it('preserves administrator access', async () => {
    auth.account.role = 'admin'
    await mount('/settings/source')
    expect(container.querySelector('output')?.textContent).toBe('/settings/source')
  })
})
