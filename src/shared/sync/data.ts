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
  notes: z.string().optional(),
  rating: z.number().optional(),
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
      vodPic: z.string().optional(),
      typeName: z.string().optional(),
      vodYear: z.string().optional(),
      vodArea: z.string().optional(),
    }),
  }),
])
const historySchema = z.object({
  recordType: z.enum(['cms', 'tmdb']),
  title: z.string(),
  imageUrl: z.string(),
  episodeIndex: z.number().int(),
  episodeName: z.string().optional(),
  sourceCode: z.string(),
  sourceName: z.string(),
  vodId: z.string(),
  tmdbMediaType: z.enum(['movie', 'tv']).optional(),
  tmdbId: z.number().optional(),
  tmdbSeasonNumber: z.number().nullable().optional(),
  timestamp: z.number(),
  playbackPosition: z.number().nonnegative(),
  duration: z.number().nonnegative(),
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
    const parsed = historySchema.safeParse(row.value)
    return parsed.success && getHistoryItemKey(parsed.data) === row.item_key
  }
  return preferenceSchemas[row.item_key]?.safeParse(row.value).success ?? false
}

export function applyJournal(journal: Journal) {
  const favorites: FavoriteItem[] = []
  const history: ViewingHistoryItem[] = []
  const search: Record<string, unknown> = {}
  const playback: Record<string, unknown> = {}
  for (const row of Object.values(journal)) {
    if (row.deleted || !validPayload(row)) continue
    if (row.kind === 'favorite') favorites.push(row.value as FavoriteItem)
    if (row.kind === 'history') history.push(row.value as ViewingHistoryItem)
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
  useFavoritesStore.setState(state => ({
    favorites,
    selectedIds: new Set([...state.selectedIds].filter(id => availableIds.has(id))),
  }))
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
