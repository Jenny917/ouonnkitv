// API 配置
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

export const API_CONFIG = {
  search: {
    path: '/api.php/provide/vod/?ac=videolist&wd=',
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    },
  },
  detail: {
    path: '/api.php/provide/vod/?ac=videolist&ids=',
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    },
  },
}

// 代理地址前缀（可在设置页被覆盖）
export const DEFAULT_PROXY_URL = '/proxy?url='
export const PROXY_URL = DEFAULT_PROXY_URL
export const M3U8_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g

export const normalizeProxyPrefix = (proxyUrl?: string | null): string => {
  const value = typeof proxyUrl === 'string' ? proxyUrl.trim() : ''
  const base = value || DEFAULT_PROXY_URL

  if (base.includes('{url}')) return base
  if (/[?&]url=$/i.test(base)) return base
  if (/[?&]url=[^&]*$/i.test(base)) {
    return base.replace(/([?&]url=)[^&]*$/i, '$1')
  }
  return base.includes('?') ? `${base}&url=` : `${base}?url=`
}

export const buildProxyRequestUrl = (targetUrl: string, proxyUrl?: string | null): string => {
  const normalized = normalizeProxyPrefix(proxyUrl)
  if (normalized.includes('{url}')) {
    return normalized.split('{url}').join(encodeURIComponent(targetUrl))
  }
  return normalized + encodeURIComponent(targetUrl)
}

import type { VideoApi } from '@/shared/types/video'
import { INITIAL_CONFIG, type VideoSourceConfig } from './initialConfig'
import { DEFAULT_SETTINGS } from './settings.config'
import { getPublicEnv } from './runtimeEnv'

type VideoSourceInput = VideoSourceConfig[] | string | undefined

export const parseVideoSources = (sources: VideoSourceConfig[]): VideoApi[] => {
  return sources
    .map((source, index) => {
      if (!source || typeof source !== 'object' || !source.name || !source.url) {
        console.warn(`跳过无效的视频源配置: ${JSON.stringify(source)}`)
        return null
      }

      return {
        id: source.id || `env_source_${index}`,
        name: source.name,
        url: source.url,
        detailUrl: source.detailUrl || source.url,
        isEnabled: source.isEnabled ?? true,
        updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date(),
        timeout: source.timeout ?? DEFAULT_SETTINGS.network.defaultTimeout,
        retry: source.retry ?? DEFAULT_SETTINGS.network.defaultRetry,
      } as VideoApi
    })
    .filter((source): source is VideoApi => source !== null)
}

export const loadVideoSources = async (input: VideoSourceInput): Promise<VideoApi[]> => {
  if (Array.isArray(input)) return parseVideoSources(input)
  if (!input || typeof input !== 'string') return []

  let sourceText = input.trim()
  if (!sourceText) return []

  let remoteUrl: URL | null = null
  try {
    remoteUrl = new URL(sourceText)
  } catch {
    // 不是 URL，按内联 JSON 继续处理
  }

  if (remoteUrl) {
    try {
      const response = await fetch(buildProxyRequestUrl(remoteUrl.toString()))
      if (!response.ok) {
        console.error(`无法获取视频源，HTTP状态: ${response.status}`)
        return []
      }
      sourceText = await response.text()
    } catch (error) {
      console.error('获取远程视频源失败:', error)
      return []
    }
  }

  try {
    const cleanedSources = sourceText
      .replace(/^\s*['"`]/, '') // 移除开头的引号
      .replace(/['"`]\s*$/, '') // 移除结尾的引号
      .trim()

    const jsonSources: unknown = JSON.parse(cleanedSources)
    const sources = Array.isArray(jsonSources) ? jsonSources : [jsonSources]

    return parseVideoSources(sources as VideoSourceConfig[])
  } catch (error) {
    console.error('解析环境变量中的视频源失败:', error)
    return []
  }
}

// 从环境变量获取初始视频源。完整配置优先于独立视频源变量。
export const getInitialVideoSources = async (): Promise<VideoApi[]> => {
  if (INITIAL_CONFIG && INITIAL_CONFIG.videoSources !== undefined) {
    return loadVideoSources(INITIAL_CONFIG.videoSources)
  }
  return loadVideoSources(getPublicEnv('OKI_INITIAL_VIDEO_SOURCES'))
}
