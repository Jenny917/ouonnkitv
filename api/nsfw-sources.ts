import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { accountSchema } from '../shared/account-rules.js'

const sourceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  url: z.string().trim().min(1).max(4096),
  detailUrl: z.string().trim().min(1).max(4096).optional(),
  isEnabled: z.boolean().optional(),
  timeout: z.number().int().positive().max(120_000).optional(),
  retry: z.number().int().min(0).max(10).optional(),
})

function removeSurroundingQuotes(value: string) {
  const trimmed = value.trim()
  const first = trimmed.at(0)
  const last = trimmed.at(-1)
  return trimmed.length >= 2 && first === last && (first === "'" || first === '"')
    ? trimmed.slice(1, -1)
    : trimmed
}

async function loadSources() {
  let sourceText = process.env.NSFW_VIDEO_SOURCES?.trim() ?? ''
  if (!sourceText) return []
  let remoteUrl: URL | null = null
  try {
    remoteUrl = new URL(sourceText)
  } catch {
    // Inline JSON continues below.
  }
  if (remoteUrl) {
    const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) throw new Error(`Source request failed: ${response.status}`)
    sourceText = await response.text()
  }
  const parsed: unknown = JSON.parse(removeSurroundingQuotes(sourceText))
  const items = Array.isArray(parsed) ? parsed : [parsed]
  return items.flatMap((item, index) => {
    const source = sourceSchema.safeParse(item)
    return source.success ? [{ ...source.data, id: `nsfw_env_${index}` }] : []
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]
  if (!token) return res.status(401).json({ error: '请先登录' })
  const url = process.env.OKI_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.OKI_SUPABASE_ANON_KEY || process.env.OKI_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return res.status(503).json({ error: '账号服务尚未配置完成' })
  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await client.rpc('current_account')
    if (error) return res.status(401).json({ error: '登录已失效，请重新登录' })
    const account = accountSchema.safeParse(data?.[0])
    if (!account.success || !account.data.enabled) {
      return res.status(403).json({ error: '账号不可用' })
    }
    if (account.data.role !== 'admin' && !account.data.allow_nsfw) {
      return res.status(200).json({ sources: [] })
    }
    return res.status(200).json({ sources: await loadSources() })
  } catch {
    return res.status(500).json({ error: 'NSFW 视频源暂时不可用' })
  }
}
