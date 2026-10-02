import { describe, expect, it } from 'vitest'
import { acknowledge, mergeRemote, recordKey, type LocalRecord } from './records'

const record = (overrides: Partial<LocalRecord> = {}): LocalRecord => ({
  kind: 'favorite',
  item_key: 'movie-1',
  value: { title: 'Movie' },
  modified_at: 100,
  mutation_id: 'a',
  deleted: false,
  pending: true,
  ...overrides,
})

describe('cloud sync conflict resolution', () => {
  it('accepts server-fenced playback progress after a stale upload even if the old clock is ahead', () => {
    const local = record({
      kind: 'history',
      modified_at: 99999,
      pending: false,
      value: { playbackLeaseId: 'old' },
    })
    const remote = record({
      kind: 'history',
      modified_at: 100,
      value: { playbackLeaseId: 'new', playbackPosition: 42 },
    })
    expect(mergeRemote({ [recordKey(local)]: local }, [remote])[recordKey(local)].value).toEqual(
      remote.value,
    )
    expect(
      mergeRemote({ [recordKey(local)]: { ...local, pending: true } }, [remote])[recordKey(local)]
        .pending,
    ).toBe(true)
  })
  it('keeps offline edits when an older remote snapshot arrives', () => {
    const local = record({ modified_at: 200 })
    const key = recordKey(local)
    expect(mergeRemote({ [key]: local }, [record()])[key]).toEqual(local)
  })
  it('propagates deletion without resurrecting it from an old device', () => {
    const local = record()
    const key = recordKey(local)
    const deleted = record({ deleted: true, value: null, modified_at: 200 })
    const result = mergeRemote({ [key]: local }, [deleted])
    expect(result[key].deleted).toBe(true)
    expect(mergeRemote(result, [local])[key].deleted).toBe(true)
  })
  it('does not acknowledge edits made while an upload is in flight', () => {
    const sent = record()
    const edited = record({ mutation_id: 'b', modified_at: 101 })
    const key = recordKey(sent)
    expect(acknowledge({ [key]: edited }, [sent])[key].pending).toBe(true)
    expect(acknowledge({ [key]: sent }, [sent])[key].pending).toBe(false)
  })
  it('merges unrelated records and deterministically breaks timestamp ties', () => {
    const a = record()
    const b = record({ mutation_id: 'b' })
    const other = record({ item_key: 'movie-2' })
    const result = mergeRemote({ [recordKey(a)]: a }, [b, other])
    expect(Object.keys(result)).toHaveLength(2)
    expect(result[recordKey(a)].mutation_id).toBe('b')
  })
  it('prefers existing cloud data over first-login guest imports, even at revision zero', () => {
    const guest = record({ modified_at: 0, mutation_id: '' })
    const cloud = record({ modified_at: 0, mutation_id: '', deleted: true, value: null })
    expect(mergeRemote({ [recordKey(guest)]: guest }, [cloud])[recordKey(guest)].deleted).toBe(true)
  })
})
