import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { accountEmail, accountSchema, passwordSchema } from '../shared/account-rules.js'

const inputSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]
  if (!token) return res.status(401).json({ error: '请重新登录' })
  if (!req.headers['content-type']?.startsWith('application/json'))
    return res.status(415).json({ error: 'Expected application/json' })
  const input = inputSchema.safeParse(req.body)
  if (!input.success)
    return res.status(400).json({ error: '请填写当前密码，新密码需为 10–128 个字符' })
  if (input.data.currentPassword === input.data.newPassword)
    return res.status(400).json({ error: '新密码不能与当前密码相同' })
  const url = process.env.OKI_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.OKI_SUPABASE_ANON_KEY || process.env.OKI_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return res.status(503).json({ error: '账号服务尚未配置完成' })
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }
  try {
    const caller = createClient(url, key, {
      ...options,
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await caller.rpc('current_account')
    const account = accountSchema.safeParse(data?.[0])
    if (error || !account.success || !account.data.enabled)
      return res.status(401).json({ error: '账号或会话已失效，请重新登录' })

    // Reauthenticate in an isolated, non-persistent client. Never accept a target user ID.
    const verifier = createClient(url, key, options)
    const verified = await verifier.auth.signInWithPassword({
      email: accountEmail(account.data.username),
      password: input.data.currentPassword,
    })
    try {
      if (verified.error || !verified.data.session || verified.data.user?.id !== account.data.id)
        return res.status(400).json({ error: '当前密码不正确，或请求过于频繁，请稍后重试' })
      const active = await verifier.rpc('current_account')
      if (active.error || active.data?.[0]?.id !== account.data.id || !active.data[0].enabled)
        return res.status(403).json({ error: '账号已不可用，请联系管理员' })
      const updated = await verifier.auth.updateUser({
        password: input.data.newPassword,
        current_password: input.data.currentPassword,
      })
      if (updated.error)
        return res.status(400).json({ error: '修改失败，请检查新密码是否符合密码要求后重试' })
      return res.status(200).json({ ok: true })
    } finally {
      // Dispose only the temporary verification session, preserving the browser session.
      if (verified.data.session) await verifier.auth.signOut({ scope: 'local' }).catch(() => {})
    }
  } catch {
    return res.status(500).json({ error: '账号服务暂时不可用，请稍后重试' })
  }
}
