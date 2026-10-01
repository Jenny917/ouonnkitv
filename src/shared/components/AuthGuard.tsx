import { useEffect, useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { Input } from '@/shared/components/ui/input'
import { Button } from '@/shared/components/ui/button'
import { OkiLogo } from '@/shared/components/icons'
import { startAuth, useAuthStore } from '@/shared/store/authStore'
import { startSync } from '@/shared/sync/service'
import { syncClient } from '@/shared/sync/client'

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { account, initialized, error, login } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const stopSync = startSync()
    const stopAuth = startAuth()
    return () => {
      stopAuth()
      stopSync()
    }
  }, [])
  if (account) return <>{children}</>
  return (
    <div className="bg-background flex min-h-dvh flex-col md:flex-row">
      <div className="bg-muted/40 flex flex-col items-center justify-center gap-4 px-8 py-12 md:w-1/2">
        <OkiLogo size={80} />
        <div className="text-xl font-bold tracking-widest">xkaTV</div>
        <p className="text-muted-foreground text-sm">你的私人流媒体影院</p>
      </div>
      <div className="flex flex-1 items-center justify-center px-8 py-12">
        <form
          className="w-full max-w-sm space-y-5"
          onSubmit={event => {
            event.preventDefault()
            if (busy) return
            setBusy(true)
            setMessage('')
            void login(username, password)
              .then(() => setPassword(''))
              .catch(error => {
                setMessage(error instanceof Error ? error.message : '登录失败')
              })
              .finally(() => setBusy(false))
          }}
        >
          <Lock className="text-muted-foreground size-6" />
          <div>
            <h1 className="text-2xl font-semibold">登录账号</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              使用管理员分配的账号登录，自动同步你的收藏与观看进度。
            </p>
          </div>
          <label className="block space-y-2 text-sm">
            <span>用户名</span>
            <Input
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={32}
              value={username}
              onChange={event => setUsername(event.target.value)}
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span>密码</span>
            <Input
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </label>
          <Button className="w-full" type="submit" disabled={busy || !initialized || !syncClient}>
            {busy || !initialized ? '正在验证…' : '登录'}
          </Button>
          {(message || error) && (
            <p role="alert" className="text-destructive text-sm">
              {message || error}
            </p>
          )}
          <p className="text-muted-foreground text-xs">没有账号或忘记密码？请联系管理员。</p>
        </form>
      </div>
    </div>
  )
}
