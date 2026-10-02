import { z } from 'zod'

export const recordSchema = z.object({
  kind: z.enum(['favorite', 'history', 'preference']),
  item_key: z.string().min(1).max(2048),
  value: z.unknown(),
  modified_at: z.number().int().nonnegative(),
  mutation_id: z.string(),
  deleted: z.boolean(),
})
export type SyncRecord = z.infer<typeof recordSchema>
export type LocalRecord = SyncRecord & { pending: boolean }
export type Journal = Record<string, LocalRecord>

export const recordKey = (record: Pick<SyncRecord, 'kind' | 'item_key'>) =>
  JSON.stringify([record.kind, record.item_key])

export function newer(a: SyncRecord, b: SyncRecord): boolean {
  return (
    a.modified_at > b.modified_at ||
    (a.modified_at === b.modified_at && a.mutation_id > b.mutation_id)
  )
}

// Merge individual records, retaining tombstones and unsent offline changes.
export function mergeRemote(journal: Journal, rows: SyncRecord[]): Journal {
  const result = { ...journal }
  for (const row of rows) {
    const key = recordKey(row)
    const local = result[key]
    // After upload, the server is authoritative for fenced playback progress. A rejected
    // stale player's clock must not keep its local progress ahead of the new owner forever.
    const serverPlayback =
      row.kind === 'history' &&
      !row.deleted &&
      !local?.pending &&
      !!row.value &&
      typeof row.value === 'object' &&
      'playbackLeaseId' in row.value
    if (!local || local.modified_at === 0 || serverPlayback || newer(row, local)) {
      result[key] = { ...row, pending: false }
    }
  }
  return result
}

export function acknowledge(journal: Journal, sent: SyncRecord[]): Journal {
  const result = { ...journal }
  for (const row of sent) {
    const key = recordKey(row)
    // A local edit made during upload must remain pending.
    if (result[key]?.mutation_id === row.mutation_id) {
      result[key] = { ...result[key], pending: false }
    }
  }
  return result
}
