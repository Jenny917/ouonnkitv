import { z } from 'zod'
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore'
import type { FavoriteItem } from '@/features/favorites/types/favorites'
import { useViewingHistoryStore } from '@/shared/store/viewingHistoryStore'
import { useSettingStore } from '@/shared/store/settingStore'
import type { ViewingHistoryItem } from '@/shared/types'
import { getHistoryItemKey } from '@/shared/lib/viewingHistory'
import { recordKey, type Journal, type SyncRecord } from './records'

const favoriteBase = {
  id: z.string(),
  addedAt: z.number(),
  updatedAt: z.number(),
  watchStatus: z.enum(['not_watched', 'watching', 'completed']),
  tags: z.array(z.string()),
  notes: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
}
const favoriteSchema = z.discriminatedUnion('sourceType', [
  z.object({
    ...favoriteBase,
    sourceType: z.literal('tmdb'),
    media: z.object({
      id: z.number(),
      mediaType: z.enum(['movie', 'tv']),
      title: z.string(),
      originalTitle: z.string(),
      posterPath: z.string().nullable(),
      backdropPath: z.string().nullable(),
      releaseDate: z.string(),
      voteAverage: z.number(),
    }),
  }),
  z.object({
    ...favoriteBase,
    sourceType: z.literal('cms'),
    media: z.object({
      vodId: z.string(),
      vodName: z.string(),
      sourceCode: z.string(),
      sourceName: z.string(),
      vodPic: z.string().nullable().optional(),
      typeName: z.string().nullable().optional(),
      vodYear: z.string().nullable().optional(),
      vodArea: z.string().nullable().optional(),
    }),
  }),
])
const historySchema = z.object({
  recordType: z.enum(['cms', 'tmdb']),
  title: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  episodeIndex: z.coerce.number().int(),
  episodeName: z.string().nullable().optional(),
  sourceCode: z.string().nullable().optional(),
  sourceName: z.string().nullable().optional(),
  vodId: z.string().nullable().optional(),
  tmdbMediaType: z.enum(['movie', 'tv']).nullable().optional(),
  tmdbId: z.coerce.number().nullable().optional(),
  tmdbSeasonNumber: z.coerce.number().nullable().optional(),
  timestamp: z.coerce.number(),
  playbackPosition: z.coerce.number().nonnegative(),
  duration: z.coerce.number().nonnegative(),
})

// Whitelist preferences: credentials, proxy URLs and source configuration never enter sync.
const preferenceSchemas: Record<string, z.ZodType> = {
  'search.isSearchHistoryEnabled': z.boolean(),
  'search.isSearchHistoryVisible': z.boolean(),
  'search.maxSearchHistoryCount': z.number().int().min(5).max(100),
  'playback.isViewingHistoryEnabled': z.boolean(),
  'playback.isViewingHistoryVisible': z.boolean(),
  'playback.isAutoPlayEnabled': z.boolean(),
  'playback.defaultEpisodeOrder': z.enum(['asc', 'desc']),
  'playback.defaultVolume': z.number().min(0).max(1),
  'playback.playerThemeColor': z.string().max(100),
  'playback.maxViewingHistoryCount': z.number().int().min(10).max(500),
  'playback.tmdbMatchCacheTTLHours': z.number().min(1).max(168),
  'playback.isLoopEnabled': z.boolean(),
  'playback.isPipEnabled': z.boolean(),
  'playback.isAutoMiniEnabled': z.boolean(),
  'playback.isScreenshotEnabled': z.boolean(),
  'playback.isMobileGestureEnabled': z.boolean(),
  'playback.longPressPlaybackRate': z.number().min(1).max(5),
  'playback.isFullscreenProgressHidden': z.boolean(),
}

export type Snapshot = Record<string, Pick<SyncRecord, 'kind' | 'item_key' | 'value'>>

export function snapshot(): Snapshot {
  const result: Snapshot = {}
  const add = (kind: SyncRecord['kind'], item_key: string, value: unknown) => {
    result[recordKey({ kind, item_key })] = { kind, item_key, value }
  }
  useFavoritesStore.getState().favorites.forEach(item => add('favorite', item.id, item))
  useViewingHistoryStore
    .getState()
    .viewingHistory.forEach(item => add('history', getHistoryItemKey(item), item))
  const settings = useSettingStore.getState()
  for (const key of Object.keys(preferenceSchemas)) {
    const [group, field] = key.split('.')
    const values = settings[group as 'search' | 'playback'] as unknown as Record<string, unknown>
    add('preference', key, values[field])
  }
  return result
}

export function validPayload(row: SyncRecord): boolean {
  if (row.deleted) return true
  if (row.kind === 'favorite') {
    const parsed = favoriteSchema.safeParse(row.value)
    return parsed.success && parsed.data.id === row.item_key
  }
  if (row.kind === 'history') {
    const parsed = normalizedLegacyHistory(row.value, row.item_key)
    return parsed !== null && getHistoryItemKey(parsed) === row.item_key
  }
  return preferenceSchemas[row.item_key]?.safeParse(row.value).success ?? false
}

function normalizedHistory(value: unknown): ViewingHistoryItem | null {
  const parsed = historySchema.safeParse(value)
  if (!parsed.success) return null
  return {
    ...parsed.data,
    title: parsed.data.title ?? '',
    imageUrl: parsed.data.imageUrl ?? '',
    sourceCode: parsed.data.sourceCode ?? '',
    sourceName: parsed.data.sourceName ?? '',
    vodId: parsed.data.vodId ?? '',
    episodeName: parsed.data.episodeName ?? undefined,
    tmdbMediaType: parsed.data.tmdbMediaType ?? undefined,
    tmdbId: parsed.data.tmdbId ?? undefined,
    tmdbSeasonNumber: parsed.data.tmdbSeasonNumber ?? undefined,
  }
}

function normalizedLegacyHistory(value: unknown, itemKey: string): ViewingHistoryItem | null {
  const parsed = normalizedHistory(value)
  if (parsed && getHistoryItemKey(parsed) === itemKey) return parsed
  if (!value || typeof value !== 'object') return null
  const parts = itemKey.split('::')
  if (parts.length !== 5 || parts[0] !== 'tmdb') return null
  const raw = value as Record<string, unknown>
  const fallback = historySchema.safeParse({
    ...raw,
    recordType: 'tmdb',
    tmdbMediaType: parts[1],
    tmdbId: parts[2],
    tmdbSeasonNumber: parts[3] === 'none' ? null : parts[3],
    episodeIndex: parts[4],
    title: raw.title ?? '',
    imageUrl: raw.imageUrl ?? '',
    sourceCode: raw.sourceCode ?? '',
    sourceName: raw.sourceName ?? '',
    vodId: raw.vodId ?? '',
    timestamp: raw.timestamp ?? 0,
    playbackPosition: raw.playbackPosition ?? 0,
    duration: raw.duration ?? 0,
  })
  return fallback.success ? normalizedHistory(fallback.data) : null
}

export function applyJournal(journal: Journal) {
  const favorites: FavoriteItem[] = []
  const history: ViewingHistoryItem[] = []
  const search: Record<string, unknown> = {}
  const playback: Record<string, unknown> = {}
  for (const row of Object.values(journal)) {
    if (row.deleted || !validPayload(row)) continue
    if (row.kind === 'favorite') favorites.push(row.value as FavoriteItem)
    if (row.kind === 'history') {
      const item = normalizedLegacyHistory(row.value, row.item_key)
      if (item) history.push(item)
    }
    if (row.kind === 'preference') {
      const [group, field] = row.item_key.split('.')
      ;(group === 'search' ? search : playback)[field] = row.value
    }
  }
  useSettingStore.setState(state => ({
    search: { ...state.search, ...search },
    playback: { ...state.playback, ...playback },
  }))
  const availableIds = new Set(favorites.map(item => item.id))
  const selectedIds = useFavoritesStore.getState().selectedIds
  useFavoritesStore.setState({
    favorites,
    selectedIds: new Set([...selectedIds].filter(id => availableIds.has(id))),
  })
  useFavoritesStore.getState()._applyFilters()
  useViewingHistoryStore.setState({
    viewingHistory: history.sort((a, b) => b.timestamp - a.timestamp),
  })
}

export function seedJournal(data: Snapshot): Journal {
  return Object.fromEntries(
    Object.entries(data).map(([key, row]) => [
      key,
      {
        ...row,
        modified_at: 0,
        mutation_id: '',
        deleted: false,
        pending: true,
      },
    ]),
  )
}
