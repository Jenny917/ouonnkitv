import { useCallback, useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { syncClient } from '@/shared/sync/client'
import { SettingsSection } from './common'
import { accountSchema, type Account } from '../../../../shared/account-rules'

async function requestAccounts(body?: unknown, offset = 0) {
  const session = await syncClient!.auth.getSession()
  if (!session.data.session) throw new Error('请重新登录')
  const response = await fetch(`/api/accounts?offset=${offset}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${session.data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '账号操作失败')
  return data
}

export default function AccountAdmin() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const load = useCallback(async (offset = 0) => {
    const data = await requestAccounts(undefined, offset)
    const rows = accountSchema.array().parse(data.accounts)
    setAccounts(previous => (offset ? [...previous, ...rows] : rows))
    setNextOffset(typeof data.nextOffset === 'number' ? data.nextOffset : null)
  }, [])
  useEffect(() => {
    void load().catch(error => setMessage(error.message))
  }, [load])
  async function run(body: unknown, success: string) {
    setBusy(true)
    setMessage('')
    try {
      await requestAccounts(body)
      setPassword('')
      setResetPassword('')
      setResetId(null)
      await load()
      setMessage(success)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsSection
      title="用户管理"
      icon={<Users className="size-4" />}
      tone="violet"
      description="创建账号后，用户使用用户名和密码登录，无需邮箱或同步密钥。"
    >
      <form
        className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={event => {
          event.preventDefault()
          void run({ action: 'create', username, password }, '账号已创建，请将登录信息交给该用户。')
        }}
      >
        <label className="space-y-1 text-sm">
          <span>新用户名</span>
          <Input
            autoComplete="off"
            autoCapitalize="none"
            required
            pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}"
            maxLength={32}
            value={username}
            onChange={event => setUsername(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>初始密码（至少 10 位）</span>
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy}>
          创建用户
        </Button>
      </form>
      <div className="divide-border divide-y">
        {accounts.map(account => (
          <div key={account.id} className="space-y-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-sm break-all">
                {account.username} ·{' '}
                {account.role === 'admin' ? '管理员' : account.enabled ? '已启用' : '已停用'}
              </p>
              {account.role === 'user' && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setResetId(account.id)
                      setResetPassword('')
                    }}
                  >
                    重置密码
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        {
                          action: 'set-enabled',
                          id: account.id,
                          enabled: !account.enabled,
                        },
                        account.enabled
                          ? '账号已停用，现有会话无法继续访问云端数据。'
                          : '账号已启用，请用户重新登录。',
                      )
                    }
                  >
                    {account.enabled ? '停用' : '启用'}
                  </Button>
                </div>
              )}
            </div>
            {resetId === account.id && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={event => {
                  event.preventDefault()
                  void run(
                    { action: 'reset-password', id: account.id, password: resetPassword },
                    '密码已重置，用户需在所有设备重新登录。',
                  )
                }}
              >
                <label className="space-y-1 text-sm">
                  <span>{account.username} 的新密码</span>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    maxLength={128}
                    value={resetPassword}
                    onChange={event => setResetPassword(event.target.value)}
                  />
                </label>
                <Button type="submit" disabled={busy}>
                  保存新密码
                </Button>
                <Button type="button" variant="ghost" onClick={() => setResetId(null)}>
                  取消
                </Button>
              </form>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void load().catch(error => setMessage(error.message))}
        >
          刷新列表
        </Button>
        {nextOffset !== null && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void load(nextOffset).catch(error => setMessage(error.message))}
          >
            加载更多
          </Button>
        )}
      </div>
      {message && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}
    </SettingsSection>
  )
}
