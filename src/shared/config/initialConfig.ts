import { getPublicEnv } from './runtimeEnv'

export interface SettingsConfig {
  network?: {
    defaultTimeout?: number
    defaultRetry?: number
    concurrencyLimit?: number
    isProxyEnabled?: boolean
    proxyUrl?: string
  }
  search?: {
    isSearchHistoryEnabled?: boolean
    isSearchHistoryVisible?: boolean
    maxSearchHistoryCount?: number
  }
  playback?: {
    isViewingHistoryEnabled?: boolean
    isViewingHistoryVisible?: boolean
    isAutoPlayEnabled?: boolean
    defaultEpisodeOrder?: 'asc' | 'desc'
    defaultVolume?: number
    playerThemeColor?: string
    maxViewingHistoryCount?: number
    tmdbMatchCacheTTLHours?: number
    isLoopEnabled?: boolean
    isPipEnabled?: boolean
    isAutoMiniEnabled?: boolean
    isScreenshotEnabled?: boolean
    isMobileGestureEnabled?: boolean
    longPressPlaybackRate?: number
    isFullscreenProgressHidden?: boolean
  }
  system?: {
    tmdbEnabled?: boolean
    tmdbApiToken?: string
    tmdbApiBaseUrl?: string
    tmdbImageBaseUrl?: string
    isUpdateLogEnabled?: boolean
    isScrollChromeAnimationEnabled?: boolean
    tmdbLanguage?: string
    tmdbImageQuality?: 'low' | 'medium' | 'high'
  }
}

export interface VideoSourceConfig {
  id?: string
  name: string
  url: string
  detailUrl?: string
  isEnabled?: boolean
  updatedAt?: string | Date
  timeout?: number
  retry?: number
}

export interface SubscriptionConfig {
  id?: string
  name?: string
  url: string
  sourceCount?: number
  lastRefreshedAt?: string | Date | null
  lastRefreshSuccess?: boolean
  lastRefreshError?: string | null
  refreshInterval?: number
  createdAt?: string | Date
}

interface MetaConfig {
  version: string
  exportDate: string
}

export interface ExportedConfig {
  settings?: SettingsConfig
  videoSources?: VideoSourceConfig[] | string
  subscriptions?: SubscriptionConfig[]
  adFilteringEnabled?: boolean
  meta?: MetaConfig
}

function removeSurroundingQuotes(value: string): string {
  const trimmed = value.trim()
  const first = trimmed.at(0)
  const last = trimmed.at(-1)
  if (trimmed.length >= 2 && first === last && (first === "'" || first === '"')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export const parseInitialConfig = (rawConfig: unknown): ExportedConfig | null => {
  if (!rawConfig || typeof rawConfig !== 'string') return null

  try {
    const parsed: unknown = JSON.parse(removeSurroundingQuotes(rawConfig))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('配置根节点必须是对象')
    }
    return parsed as ExportedConfig
  } catch (error) {
    console.error('Failed to parse OKI_INITIAL_CONFIG:', error)
    return null
  }
}

export const getInitialConfig = (): ExportedConfig | null => {
  return parseInitialConfig(getPublicEnv('OKI_INITIAL_CONFIG'))
}

export const INITIAL_CONFIG = getInitialConfig()
