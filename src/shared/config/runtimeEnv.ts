export const PUBLIC_ENV_KEYS = [
  'OKI_INITIAL_VIDEO_SOURCES',
  'OKI_TMDB_API_TOKEN',
  'OKI_TMDB_API_BASE_URL',
  'OKI_TMDB_IMAGE_BASE_URL',
  'OKI_ACCESS_PASSWORD',
  'OKI_DISABLE_ANALYTICS',
  'OKI_INITIAL_CONFIG',
] as const

export type PublicEnvKey = (typeof PUBLIC_ENV_KEYS)[number]
export type RuntimeConfig = Partial<Record<PublicEnvKey, string>>

type RuntimeConfigGlobal = typeof globalThis & {
  __OKI_RUNTIME_CONFIG__?: RuntimeConfig
}

function getBuildTimeEnv(key: PublicEnvKey): string | undefined {
  const buildTimeConfig: RuntimeConfig = {
    OKI_INITIAL_VIDEO_SOURCES: import.meta.env.OKI_INITIAL_VIDEO_SOURCES,
    OKI_TMDB_API_TOKEN: import.meta.env.OKI_TMDB_API_TOKEN,
    OKI_TMDB_API_BASE_URL: import.meta.env.OKI_TMDB_API_BASE_URL,
    OKI_TMDB_IMAGE_BASE_URL: import.meta.env.OKI_TMDB_IMAGE_BASE_URL,
    OKI_ACCESS_PASSWORD: import.meta.env.OKI_ACCESS_PASSWORD,
    OKI_DISABLE_ANALYTICS: import.meta.env.OKI_DISABLE_ANALYTICS,
    OKI_INITIAL_CONFIG: import.meta.env.OKI_INITIAL_CONFIG,
  }
  return buildTimeConfig[key]
}

export function getRuntimeConfig(): RuntimeConfig {
  return (globalThis as RuntimeConfigGlobal).__OKI_RUNTIME_CONFIG__ ?? {}
}

/** Docker 运行时配置优先，其他部署回退到 Vite 构建时环境变量。 */
export function getPublicEnv(key: PublicEnvKey): string | undefined {
  const runtimeConfig = getRuntimeConfig()
  if (Object.prototype.hasOwnProperty.call(runtimeConfig, key)) {
    const runtimeValue = runtimeConfig[key]
    return typeof runtimeValue === 'string' ? runtimeValue : undefined
  }
  return getBuildTimeEnv(key)
}

function hashConfigValue(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** 标识会初始化本地视频源和订阅的配置；环境变量变化后触发一次重新初始化。 */
export function getInitialContentConfigId(schemaVersion = '2'): string {
  const initialConfig = getPublicEnv('OKI_INITIAL_CONFIG')?.trim() ?? ''
  const initialSources = getPublicEnv('OKI_INITIAL_VIDEO_SOURCES')?.trim() ?? ''
  return `${schemaVersion}:${hashConfigValue(`${initialConfig}\u0000${initialSources}`)}`
}
