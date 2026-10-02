import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore'
import { useViewingHistoryStore } from '@/shared/store/viewingHistoryStore'
import { useSettingStore } from '@/shared/store/settingStore'
import { useAuthStore } from '@/shared/store/authStore'
import { syncClient } from './client'
import { applyJournal, seedJournal, snapshot, validPayload, type Snapshot } from './data'
import { acknowledge, mergeRemote, newer, recordSchema, type Journal } from './records'

export const useSyncStatus = create<{
  username: string | null
  status: string
  error: string | null
  lastSynced: number | null
}>(() => ({ username: null, status: '未登录', error: null, lastSynced: null }))

const prefix = 'ouonnki-cloud-v1:'
const ownerKey = `${prefix}owner`
const guestKey = `${prefix}guest`
let owner: string | null = null
let accessToken: string | null = null
let journal: Journal = {}
let previous: Snapshot = {}
let applying = false
let generation = 0
let busy = false
let timer: ReturnType<typeof setTimeout> | undefined

function report(error: unknown) {
  useSyncStatus.setState({
    status: '等待重试',
    error: error instanceof Error ? error.message : String(error),
  })
}

function readJournal(key: string): Journal {
  const text = localStorage.getItem(key)
  if (!text) return {}
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid local sync cache')
  const result: Journal = {}
  for (const [key, value] of Object.entries(parsed)) {
    const row = recordSchema.parse(value)
    if (!validPayload(row)) throw new Error('Invalid local sync record')
    result[key] = { ...row, pending: Boolean((value as { pending?: boolean }).pending) }
  }
  return result
}

function save() {
  if (!owner) return
  // Preserve edits made by another tab since our last storage event.
  const disk = readJournal(prefix + owner)
  for (const [key, row] of Object.entries(disk)) {
    const current = journal[key]
    if (
      row.kind === 'history' &&
      !row.pending &&
      current &&
      !current.pending &&
      current.value &&
      typeof current.value === 'object' &&
      'playbackLeaseId' in current.value
    )
      continue
    if (!journal[key] || newer(row, journal[key])) journal[key] = row
  }
  localStorage.setItem(prefix + owner, JSON.stringify(journal))
}

function apply() {
  applying = true
  try {
    applyJournal(journal)
    previous = snapshot()
  } finally {
    applying = false
  }
}

function capture() {
  if (!owner || applying) return
  try {
    const next = snapshot()
    let changed = false
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (JSON.stringify(previous[key]) === JSON.stringify(next[key])) continue
      const row = next[key] ?? previous[key]
      journal[key] = {
        ...row,
        value: next[key]?.value ?? null,
        deleted: !next[key],
        pending: true,
        modified_at: Math.max(Date.now(), (journal[key]?.modified_at ?? 0) + 1),
        mutation_id: crypto.randomUUID(),
      }
      changed = true
    }
    previous = next
    if (changed) {
      save()
      useSyncStatus.setState({ status: '有待同步的更改' })
      // Throttle, rather than debounce: continuous playback cannot postpone sync forever.
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined
          void syncNow()
        }, 10_000)
    }
  } catch (error) {
    report(error)
  }
}

export async function syncNow() {
  const client = syncClient
  if (!client || !owner || !accessToken || busy) return
  if (!navigator.onLine) {
    useSyncStatus.setState({ status: '离线 · 更改已保存在本机' })
    return
  }
  const run = generation
  const userId = owner
  const authorization = `Bearer ${accessToken}`
  busy = true
  useSyncStatus.setState({ status: '同步中…', error: null })
  try {
    const pending = Object.values(journal).filter(row => row.pending)
    for (let offset = 0; offset < pending.length; offset += 100) {
      const batch = pending.slice(offset, offset + 100)
      const { error } = await client
        .rpc('sync_user_records', {
          changes: batch.map(row => recordSchema.parse(row)),
        })
        .setHeader('Authorization', authorization)
      if (run !== generation) return
      if (error) throw new Error(error.message)
      journal = acknowledge(journal, batch)
      save()
    }
    // Paginate explicitly; Supabase normally limits a response to 1,000 rows.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client
        .from('user_sync_records')
        .select('*')
        .eq('user_id', userId)
        .order('kind')
        .order('item_key')
        .range(offset, offset + 499)
        .setHeader('Authorization', authorization)
      if (run !== generation) return
      if (error) throw new Error(error.message)
      const rows = (data ?? []).map(row => recordSchema.parse(row))
      const invalid = rows.find(row => !validPayload(row))
      if (invalid)
        throw new Error(`Cloud data is incompatible: ${invalid.kind}/${invalid.item_key}`)
      journal = mergeRemote(journal, rows)
      save()
      if (rows.length < 500) break
    }
    apply()
    useSyncStatus.setState({
      status: Object.values(journal).some(row => row.pending) ? '有待同步的更改' : '已同步',
      error: null,
      lastSynced: Date.now(),
    })
  } catch (error) {
    if (run === generation) report(error)
  } finally {
    if (run === generation) busy = false
  }
}

function changeSession(session: Session | null) {
  // Pin each request to the identity that created its batch, even during account switches.
  accessToken = session?.access_token ?? null
  const nextOwner = session?.user.id ?? null
  if (nextOwner === owner) return
  generation++
  busy = false
  if (timer) clearTimeout(timer)
  timer = undefined
  try {
    const storedOwner = localStorage.getItem(ownerKey)
    // Restore the guest snapshot before changing identities, including after a reload.
    const previousOwner = owner ?? storedOwner
    if (previousOwner && previousOwner !== nextOwner) {
      applying = true
      try {
        applyJournal(readJournal(guestKey))
      } finally {
        applying = false
      }
    }
    if (nextOwner) {
      if (!storedOwner && !localStorage.getItem(guestKey))
        localStorage.setItem(guestKey, JSON.stringify(seedJournal(snapshot())))
      const cached = localStorage.getItem(prefix + nextOwner)
      // Never silently import one device's guest collection into a new account.
      journal = cached ? readJournal(prefix + nextOwner) : {}
      owner = nextOwner
      localStorage.setItem(ownerKey, owner)
      save()
      apply()
    } else {
      owner = null
      journal = {}
      localStorage.removeItem(ownerKey)
    }
    useSyncStatus.setState({
      username: useAuthStore.getState().account?.username ?? null,
      error: null,
      lastSynced: null,
      status: nextOwner ? '准备同步' : '未登录',
    })
    // Avoid awaiting Supabase calls from inside onAuthStateChange's auth lock.
    if (nextOwner)
      timer = setTimeout(() => {
        timer = undefined
        void syncNow()
      }, 0)
  } catch (error) {
    owner = null
    report(error)
  }
}

export function startSync(): () => void {
  if (!syncClient) return () => {}
  // A persisted owner may exist even if the saved session has expired.
  owner = null
  const updateSession = (session: Session | null) => {
    if (!session && localStorage.getItem(ownerKey) && !owner) owner = localStorage.getItem(ownerKey)
    changeSession(session)
  }
  updateSession(useAuthStore.getState().session)
  const unsubscribeAuth = useAuthStore.subscribe((state, previousState) => {
    if (state.session !== previousState.session) updateSession(state.session)
  })
  const unsubscribers = [
    useFavoritesStore.subscribe(capture),
    useViewingHistoryStore.subscribe(capture),
    useSettingStore.subscribe(capture),
  ]
  const flush = () => {
    void syncNow()
  }
  const visible = flush
  // Let the player's pause handler save its final position before uploading.
  const paused = () => {
    queueMicrotask(flush)
  }
  const storage = (event: StorageEvent) => {
    if (!owner || event.key !== prefix + owner) return
    try {
      const incoming = readJournal(prefix + owner)
      for (const [key, row] of Object.entries(incoming)) {
        if (
          !journal[key] ||
          newer(row, journal[key]) ||
          row.mutation_id === journal[key].mutation_id
        )
          journal[key] = row
      }
      apply()
    } catch (error) {
      report(error)
    }
  }
  window.addEventListener('online', flush)
  window.addEventListener('focus', flush)
  window.addEventListener('storage', storage)
  document.addEventListener('visibilitychange', visible)
  document.addEventListener('pause', paused, true)
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') flush()
  }, 30_000)
  return () => {
    generation++
    busy = false
    unsubscribeAuth()
    unsubscribers.forEach(unsubscribe => unsubscribe())
    clearInterval(interval)
    if (timer) clearTimeout(timer)
    timer = undefined
    window.removeEventListener('online', flush)
    window.removeEventListener('focus', flush)
    window.removeEventListener('storage', storage)
    document.removeEventListener('visibilitychange', visible)
    document.removeEventListener('pause', paused, true)
  }
}

export function importDeviceCollection() {
  if (!owner) return
  const guest = readJournal(guestKey)
  for (const [key, row] of Object.entries(guest)) {
    if (row.kind !== 'preference' && !journal[key]) journal[key] = { ...row, pending: true }
  }
  save()
  apply()
  void syncNow()
}
