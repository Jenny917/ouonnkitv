import { afterEach, describe, expect, it } from 'vitest'
import { getInitialContentConfigId, getPublicEnv, type RuntimeConfig } from './runtimeEnv'

type RuntimeConfigGlobal = typeof globalThis & {
  __OKI_RUNTIME_CONFIG__?: RuntimeConfig
}

const runtimeGlobal = globalThis as RuntimeConfigGlobal
const originalRuntimeConfig = runtimeGlobal.__OKI_RUNTIME_CONFIG__
const originalBuildTimePassword = import.meta.env.OKI_ACCESS_PASSWORD

describe('getPublicEnv', () => {
  afterEach(() => {
    runtimeGlobal.__OKI_RUNTIME_CONFIG__ = originalRuntimeConfig
    import.meta.env.OKI_ACCESS_PASSWORD = originalBuildTimePassword
  })

  it('Docker 运行时配置优先于构建时配置', () => {
    runtimeGlobal.__OKI_RUNTIME_CONFIG__ = {
      OKI_ACCESS_PASSWORD: 'runtime-password',
    }

    expect(getPublicEnv('OKI_ACCESS_PASSWORD')).toBe('runtime-password')
  })

  it('显式空值可以清除构建时配置', () => {
    runtimeGlobal.__OKI_RUNTIME_CONFIG__ = {
      OKI_TMDB_API_TOKEN: '',
    }

    expect(getPublicEnv('OKI_TMDB_API_TOKEN')).toBe('')
  })

  it('没有 Docker 运行时值时回退到 Vite 构建时配置', () => {
    runtimeGlobal.__OKI_RUNTIME_CONFIG__ = {}
    import.meta.env.OKI_ACCESS_PASSWORD = 'build-time-password'

    expect(getPublicEnv('OKI_ACCESS_PASSWORD')).toBe('build-time-password')
  })

  it('初始内容环境变量变化时生成不同配置标识', () => {
    runtimeGlobal.__OKI_RUNTIME_CONFIG__ = {
      OKI_INITIAL_VIDEO_SOURCES: '[{"name":"源一"}]',
    }
    const firstId = getInitialContentConfigId()

    runtimeGlobal.__OKI_RUNTIME_CONFIG__ = {
      OKI_INITIAL_VIDEO_SOURCES: '[{"name":"源二"}]',
    }

    expect(getInitialContentConfigId()).not.toBe(firstId)
  })
})
