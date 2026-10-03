import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import CloudSync from '@/features/settings/components/CloudSync'
import { SettingsPageShell, SettingsSection } from '@/features/settings/components/common'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { syncClient } from '@/shared/sync/client'
import { useAuthStore } from '@/shared/store/authStore'

export default function AccountView() {
  const username = useAuthStore(state => state.account?.username)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  async function changePassword() {
    if (busy) return
    setMessage('')
    setFailed(false)
    if (newPassword !== confirmation) {
      setFailed(true)
      setMessage('两次输入的新密码不一致')
      return
    }
    setBusy(true)
    try {
      const session = await syncClient?.auth.getSession()
      const token = session?.data.session?.access_token
      if (!token) throw new Error('请重新登录')
      const response = await fetch('/api/account-password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '修改密码失败')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      setMessage('密码已修改。下次登录请使用新密码。')
    } catch (error) {
      setFailed(true)
      setMessage(error instanceof Error ? error.message : '修改失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-2 py-4 md:px-4 md:py-6">
      <SettingsPageShell
        title="我的账号"
        description="管理你的密码，查看收藏与观看进度的同步状态。"
      >
        <CloudSync />
        <SettingsSection
          title="修改密码"
          icon={<KeyRound className="size-4" />}
          tone="violet"
          description="请输入当前密码验证身份。新密码至少 10 个字符。"
        >
          <form
            className="max-w-md space-y-4"
            onSubmit={event => {
              event.preventDefault()
              void changePassword()
            }}
          >
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username || ''}
              readOnly
              hidden
            />
            <fieldset disabled={busy} className="space-y-4">
              <label className="block space-y-2 text-sm">
                <span>当前密码</span>
                <Input
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={currentPassword}
                  onChange={event => setCurrentPassword(event.target.value)}
                />
              </label>
              <label className="block space-y-2 text-sm">
                <span>新密码</span>
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={128}
                  value={newPassword}
                  onChange={event => setNewPassword(event.target.value)}
                />
              </label>
              <label className="block space-y-2 text-sm">
                <span>确认新密码</span>
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={128}
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? '正在修改…' : '保存新密码'}
              </Button>
            </fieldset>
            {message && (
              <p
                className={failed ? 'text-destructive text-sm' : 'text-sm'}
                role={failed ? 'alert' : 'status'}
              >
                {message}
              </p>
            )}
          </form>
        </SettingsSection>
      </SettingsPageShell>
    </div>
  )
}
