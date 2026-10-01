import { useState } from 'react'
import { Cloud } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { syncClient } from '@/shared/sync/client'
import { syncNow, useSyncStatus } from '@/shared/sync/service'
import { SettingsSection } from './common'

export default function CloudSync() {
  const state = useSyncStatus()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsSection
      title="跨设备云同步"
      icon={<Cloud className="size-4" />}
      tone="sky"
      description="同步收藏、观看进度与播放/搜索偏好。本机优先，后台同步。"
    >
      {!syncClient ? (
        <p className="text-muted-foreground text-sm">
          尚未配置云同步。请在部署环境中设置 OKI_SUPABASE_URL 和 OKI_SUPABASE_ANON_KEY 后重新部署。
        </p>
      ) : state.email ? (
        <div className="space-y-3">
          <p className="text-sm">{state.email}</p>
          <p className="text-muted-foreground text-sm" role="status">
            {state.status}
            {state.lastSynced ? ` · ${new Date(state.lastSynced).toLocaleTimeString()}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || state.status === '同步中…'} onClick={() => void syncNow()}>
              立即同步
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await syncNow()
                  const { error } = await syncClient!.auth.signOut({ scope: 'local' })
                  if (error) throw error
                  setSentTo('')
                  setCode('')
                })
              }
            >
              退出云同步
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            退出后恢复访客数据；未上传的更改保留在此账号的本机缓存中。
          </p>
        </div>
      ) : (
        <form
          className="max-w-md space-y-3"
          onSubmit={event => {
            event.preventDefault()
            void run(async () => {
              if (sentTo) {
                const { error } = await syncClient!.auth.verifyOtp({
                  email: sentTo,
                  token: code.trim(),
                  type: 'email',
                })
                if (error) throw error
                setCode('')
              } else {
                const address = email.trim()
                const { error } = await syncClient!.auth.signInWithOtp({ email: address })
                if (error) throw error
                setSentTo(address)
                setMessage('验证码已发送，请查看邮箱。')
              }
            })
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>邮箱</span>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              disabled={busy || !!sentTo}
              onChange={event => setEmail(event.target.value)}
            />
          </label>
          {sentTo && (
            <label className="block space-y-1 text-sm">
              <span>邮箱验证码</span>
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                value={code}
                onChange={event => setCode(event.target.value)}
              />
            </label>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? '请稍候…' : sentTo ? '登录并同步' : '发送登录验证码'}
            </Button>
            {sentTo && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setSentTo('')
                  setCode('')
                  setMessage('')
                }}
              >
                重新发送 / 更换邮箱
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            首次登录会合并本机数据；已有云端记录优先。视频源仍使用配置导入/导出。
          </p>
        </form>
      )}
      {(message || state.error) && (
        <p className="mt-3 text-sm break-words" role="status">
          {message || state.error}
        </p>
      )}
    </SettingsSection>
  )
}
