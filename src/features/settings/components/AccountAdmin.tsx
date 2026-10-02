import { useCallback, useEffect, useState } from 'react'
import { History, Search, Users } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { ConfirmModal } from '@/shared/components/common/ConfirmModal'
import { syncClient } from '@/shared/sync/client'
import { SettingsSection } from './common'
import {
  accountSchema,
  auditEntrySchema,
  type Account,
  type AuditEntry,
} from '../../../../shared/account-rules'

async function requestAccounts(body?: unknown, params = '') {
  const session = await syncClient!.auth.getSession()
  if (!session.data.session) throw new Error('请重新登录')
  const response = await fetch(`/api/accounts${params}`, {
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

const formatTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : '从未')
const actionLabels: Record<string, string> = {
  create: '创建账号',
  set_enabled: '更改状态',
  reset_password: '重置密码',
  force_logout: '强制退出',
  delete: '删除账号',
}

export default function AccountAdmin() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [search, setSearch] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    body: unknown
    success: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const load = useCallback(async (term = '') => {
    const query = new URLSearchParams({ offset: '0' })
    if (term.trim()) query.set('search', term.trim())
    const [users, events] = await Promise.all([
      requestAccounts(undefined, `?${query}`),
      requestAccounts(undefined, '?view=audit&offset=0'),
    ])
    setAccounts(accountSchema.array().parse(users.accounts))
    setAudit(auditEntrySchema.array().parse(events.audit))
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
      setConfirm(null)
      await load(search)
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
      description="创建用户、查看近期设备、结束会话，并记录管理员操作。"
    >
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={event => {
            event.preventDefault()
            void run({ action: 'create', username, password }, '账号已创建。')
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
        <form
          className="flex items-end gap-2"
          onSubmit={event => {
            event.preventDefault()
            void load(search).catch(error => setMessage(error.message))
          }}
        >
          <label className="space-y-1 text-sm">
            <span>搜索用户</span>
            <div className="relative">
              <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
              <Input
                className="pl-8"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="用户名"
              />
            </div>
          </label>
          <Button type="submit" variant="outline" disabled={busy}>
            搜索
          </Button>
        </form>
      </div>
      <div className="divide-border divide-y">
        {accounts.map(account => (
          <div key={account.id} className="space-y-3 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium break-all">
                  {account.username}{' '}
                  <span className="text-muted-foreground text-xs">
                    · {account.role === 'admin' ? '管理员' : account.enabled ? '已启用' : '已停用'}
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">
                  创建：{formatTime(account.created_at)} · 最近登录：
                  {formatTime(account.last_sign_in_at)}
                </p>
                <p className="text-muted-foreground text-xs">近期设备：{account.devices.length}</p>
              </div>
              {account.role === 'user' && (
                <div className="flex flex-wrap gap-2">
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
                      setConfirm({
                        title: '强制退出所有设备',
                        description: `${account.username} 需要在所有设备重新登录。`,
                        body: { action: 'force-logout', id: account.id },
                        success: '该用户的所有现有会话已失效。',
                      })
                    }
                  >
                    强制退出
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        { action: 'set-enabled', id: account.id, enabled: !account.enabled },
                        account.enabled ? '账号已停用。' : '账号已启用。',
                      )
                    }
                  >
                    {account.enabled ? '停用' : '启用'}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        title: '永久删除账号',
                        description: `将删除 ${account.username}、所有同步数据和会话。此操作无法恢复。`,
                        body: { action: 'delete', id: account.id },
                        success: '账号及其同步数据已删除。',
                      })
                    }
                  >
                    删除
                  </Button>
                </div>
              )}
            </div>
            {!!account.devices.length && (
              <div className="grid gap-2 sm:grid-cols-2">
                {account.devices.slice(0, 6).map((device, index) => (
                  <div
                    key={`${device.label}-${index}`}
                    className="bg-muted/40 rounded-md px-3 py-2 text-xs"
                  >
                    <p>{device.label}</p>
                    <p className="text-muted-foreground">
                      最近活动：{formatTime(device.last_seen_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {resetId === account.id && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={event => {
                  event.preventDefault()
                  void run(
                    { action: 'reset-password', id: account.id, password: resetPassword },
                    '密码已重置，现有会话已失效。',
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
                  保存
                </Button>
                <Button type="button" variant="ghost" onClick={() => setResetId(null)}>
                  取消
                </Button>
              </form>
            )}
          </div>
        ))}
        {!accounts.length && (
          <p className="text-muted-foreground py-6 text-center text-sm">没有匹配的账号</p>
        )}
      </div>
      <div className="mt-6 space-y-3">
        <div className="flex items-center gap-2">
          <History className="size-4" />
          <h3 className="font-medium">最近管理员操作</h3>
        </div>
        <div className="divide-border divide-y rounded-lg border px-3">
          {audit.slice(0, 20).map(entry => (
            <div key={entry.id} className="py-2 text-xs">
              <p>
                {entry.actor_username} · {actionLabels[entry.action] || entry.action} ·{' '}
                {entry.target_username || '未知用户'}
              </p>
              <p className="text-muted-foreground">{formatTime(entry.created_at)}</p>
            </div>
          ))}
          {!audit.length && (
            <p className="text-muted-foreground py-4 text-center text-xs">暂无记录</p>
          )}
        </div>
      </div>
      <div className="mt-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void load(search).catch(error => setMessage(error.message))}
        >
          刷新
        </Button>
      </div>
      {message && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}
      <ConfirmModal
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void run(confirm.body, confirm.success)
        }}
        title={confirm?.title || ''}
        description={confirm?.description || ''}
        confirmText="确认"
        isDestructive
      />
    </SettingsSection>
  )
}
