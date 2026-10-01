import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { syncClient } from '@/shared/sync/client'
import { accountEmail, accountSchema, type Account } from '../../../shared/account-rules'

interface AuthStore {
  session: Session | null
  account: Account | null
  initialized: boolean
  error: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthStore>(() => ({
  session: null,
  account: null,
  initialized: false,
  error: null,
  login: async (username, password) => {
    if (!syncClient) throw new Error('请先配置 Supabase')
    const { data, error } = await syncClient.auth.signInWithPassword({
      email: accountEmail(username),
      password,
    })
    if (error) throw new Error('用户名或密码不正确，或登录请求过于频繁')
    if (!data.session) throw new Error('登录失败，请重试')
    await verifySession(data.session, ++generation)
    if (!useAuthStore.getState().account)
      throw new Error(useAuthStore.getState().error || '登录失败')
  },
  logout: async () => {
    if (!syncClient) return
    const { error } = await syncClient.auth.signOut({ scope: 'local' })
    if (error) throw error
    ++generation
    useAuthStore.setState({ session: null, account: null, initialized: true, error: null })
  },
}))

let generation = 0
async function verifySession(session: Session | null, request: number) {
  if (!syncClient) return
  if (!session) {
    if (request === generation)
      useAuthStore.setState({ session: null, account: null, initialized: true })
    return
  }
  try {
    const { data, error } = await syncClient
      .rpc('current_account')
      .setHeader('Authorization', `Bearer ${session.access_token}`)
    if (request !== generation) return
    if (error) throw new Error('无法验证账号，请检查网络或数据库配置后重试')
    const result = accountSchema.safeParse(data?.[0])
    if (!result.success || !result.data.enabled || result.data.id !== session.user.id) {
      useAuthStore.setState({
        session: null,
        account: null,
        initialized: true,
        error: '账号已停用或会话已失效，请重新登录或联系管理员',
      })
      return
    }
    useAuthStore.setState({ session, account: result.data, initialized: true, error: null })
  } catch (error) {
    if (request !== generation) return
    useAuthStore.setState({
      initialized: true,
      error: error instanceof Error ? error.message : '账号验证失败',
    })
  }
}

export function startAuth(): () => void {
  const client = syncClient
  if (!client) {
    useAuthStore.setState({ initialized: true, error: '请配置 Supabase 并创建管理员账号' })
    return () => {}
  }
  let stopped = false
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((_event, session) => {
    const request = ++generation
    if (session?.user.id !== useAuthStore.getState().session?.user.id) {
      useAuthStore.setState({ session: null, account: null })
    }
    setTimeout(() => {
      if (!stopped) void verifySession(session, request)
    }, 0)
  })
  const refresh = () => {
    void client.auth.getSession().then(({ data, error }) => {
      if (!stopped && !error) void verifySession(data.session, ++generation)
    })
  }
  window.addEventListener('focus', refresh)
  window.addEventListener('online', refresh)
  const interval = setInterval(refresh, 30_000)
  return () => {
    stopped = true
    ++generation
    subscription.unsubscribe()
    clearInterval(interval)
    window.removeEventListener('focus', refresh)
    window.removeEventListener('online', refresh)
  }
}
