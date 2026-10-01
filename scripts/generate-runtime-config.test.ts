import { describe, expect, it } from 'vitest'
import {
  collectRuntimeConfig,
  PUBLIC_ENV_KEYS,
  serializeRuntimeConfig,
} from './generate-runtime-config.mjs'

describe('generate runtime config', () => {
  it('只导出支持的公开环境变量，并保留显式空值', () => {
    const config = collectRuntimeConfig({
      OKI_ACCESS_PASSWORD: '',
      OKI_INITIAL_VIDEO_SOURCES: '[{"name":"测试源"}]',
      PRIVATE_SECRET: 'never-export',
    })

    expect(Object.keys(config).every(key => PUBLIC_ENV_KEYS.includes(key))).toBe(true)
    expect(config).toEqual({
      OKI_INITIAL_VIDEO_SOURCES: '[{"name":"测试源"}]',
      OKI_ACCESS_PASSWORD: '',
    })
  })

  it('序列化时转义 script 结束标签与行分隔符', () => {
    const script = serializeRuntimeConfig({
      OKI_INITIAL_CONFIG: '</script>\u2028next',
    })

    expect(script).not.toContain('</script>')
    expect(script).toContain('\\u003c/script>')
    expect(script).toContain('\\u2028')
  })
})
