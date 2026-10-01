import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { accountEmail, accountSchema, adminActionSchema } from '../shared/account-rules.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]
  if (!token) return res.status(401).json({ error: '请先登录' })
  const url = process.env.OKI_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.OKI_SUPABASE_ANON_KEY || process.env.OKI_SUPABASE_PUBLISHABLE_KEY
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key || !secret) return res.status(503).json({ error: '账号管理尚未配置完成' })
  try {
    // Verify the caller through RLS and live session state before using the privileged client.
    const caller = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: profiles, error: profileError } = await caller.rpc('current_account')
    if (profileError) return res.status(401).json({ error: '登录已失效，请重新登录' })
    const profile = accountSchema.safeParse(profiles?.[0])
    if (!profile.success || !profile.data.enabled || profile.data.role !== 'admin') {
      return res.status(403).json({ error: '仅管理员可管理账号' })
    }
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    if (req.method === 'GET') {
      const offset = Number(req.query.offset ?? 0)
      if (!Number.isSafeInteger(offset) || offset < 0)
        return res.status(400).json({ error: 'Invalid offset' })
      const { data, error } = await admin
        .from('user_accounts')
        .select('id,username,role,enabled,created_at')
        .order('created_at')
        .order('id')
        .range(offset, offset + 49)
      if (error) throw error
      return res
        .status(200)
        .json({ accounts: data, nextOffset: data?.length === 50 ? offset + 50 : null })
    }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      return res.status(415).json({ error: 'Expected application/json' })
    }
    const parsed = adminActionSchema.safeParse(req.body)
    if (!parsed.success)
      return res.status(400).json({ error: '请检查用户名和密码（密码至少 10 个字符）' })
    const action = parsed.data
    if (action.action === 'create') {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: accountEmail(action.username),
        password: action.password,
        email_confirm: true,
        app_metadata: { managed_account: true, username: action.username, account_role: 'user' },
      })
      if (error)
        return res.status(400).json({ error: '创建失败，请检查用户名是否已存在及密码要求' })
      if (!created.user) return res.status(500).json({ error: '账号创建未返回用户' })
      const { error: profileError } = await admin.from('user_accounts').insert({
        id: created.user.id,
        username: action.username,
        role: 'user',
        enabled: true,
      })
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return res
          .status(400)
          .json({ error: '账号资料创建失败，请检查数据库迁移和用户名是否已存在' })
      }
    } else {
      const { data: target, error: targetError } = await admin
        .from('user_accounts')
        .select('id,role')
        .eq('id', action.id)
        .maybeSingle()
      if (targetError) throw targetError
      // Admin accounts are managed by the operator; prevent self-lockout and privilege changes.
      if (!target || target.role !== 'user' || action.id === profile.data.id) {
        return res.status(403).json({ error: '此操作仅适用于普通用户账号' })
      }
      const { error: revokeError } = await admin.rpc('invalidate_account_sessions', {
        target_id: action.id,
        new_enabled: action.action === 'set-enabled' ? action.enabled : null,
      })
      if (revokeError) throw revokeError
      if (action.action === 'reset-password') {
        const { error } = await admin.auth.admin.updateUserById(action.id, {
          password: action.password,
        })
        if (error) return res.status(400).json({ error: '密码修改失败；旧会话已失效，请重试' })
        const { error: finalRevokeError } = await admin.rpc('invalidate_account_sessions', {
          target_id: action.id,
        })
        if (finalRevokeError) throw finalRevokeError
      }
    }
    return res.status(200).json({ ok: true })
  } catch {
    return res.status(500).json({ error: '账号服务暂时不可用，请检查服务端配置和数据库迁移' })
  }
}
