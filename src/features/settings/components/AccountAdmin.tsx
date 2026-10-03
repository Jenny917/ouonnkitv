import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { History, Search, Users } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Checkbox } from '@/shared/components/ui/checkbox'
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
  set_nsfw: '更改 NSFW 权限',
  reset_password: '重置密码',
  force_logout: '强制退出',
  delete: '删除账号',
}

export default function AccountAdmin() {
  const [params, setParams] = useSearchParams()
  const id = params.get('id') || ''
  const auditView = !id && params.get('view') === 'audit'
  const pageValue = Number(params.get('page') || 1)
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1
  const offset = (page - 1) * 20
  const term = params.get('search') || ''
  const enabled = params.get('enabled') || ''
  const nsfw = params.get('nsfw') || ''
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const { current: generation } = useRef({ value: 0 })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [search, setSearch] = useState(term)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [allowNsfw, setAllowNsfw] = useState(false)
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
  const load = useCallback(async () => {
    const current = ++generation.value
    setLoading(true)
    setLoadError('')
    const query = new URLSearchParams({ offset: String(offset) })
    if (id) query.set('id', id)
    else if (auditView) query.set('view', 'audit')
    else {
      if (term) query.set('search', term)
      if (enabled) query.set('enabled', enabled)
      if (nsfw) query.set('nsfw', nsfw)
    }
    try {
      const result = await requestAccounts(undefined, `?${query}`)
      if (current !== generation.value) return
      if (offset > 0 && offset >= result.total) {
        setParams(
          previous => {
            const next = new URLSearchParams(previous)
            next.set('page', String(Math.max(1, Math.ceil(result.total / 20))))
            return next
          },
          { replace: true },
        )
        return
      }
      setTotal(result.total)
      if (id) setAccounts([accountSchema.parse(result.account)])
      else if (auditView) setAudit(auditEntrySchema.array().parse(result.audit))
      else setAccounts(accountSchema.array().parse(result.accounts))
    } catch (error) {
      if (current === generation.value)
        setLoadError(error instanceof Error ? error.message : '加载失败')
    } finally {
      if (current === generation.value) setLoading(false)
    }
  }, [offset, id, auditView, term, enabled, nsfw, setParams, generation])
  useEffect(() => {
    setAccounts([])
    setAudit([])
    setMessage('')
    setResetId(null)
    setConfirm(null)
    void load()
    return () => {
      generation.value++
    }
  }, [load, generation])
  useEffect(() => {
    setSearch(term)
  }, [term])
  function navigate(changes: Record<string, string>) {
    const next = new URLSearchParams(params)
    next.delete('page')
    Object.entries(changes).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    )
    setParams(next)
  }
  function returnToList() {
    navigate({ id: '', view: '', page: params.get('listPage') || '1', listPage: '' })
  }
  async function run(body: unknown, success: string) {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await requestAccounts(body)
      setPassword('')
      setAllowNsfw(false)
      setResetPassword('')
      setResetId(null)
      setConfirm(null)
      if ((body as { action: string }).action === 'delete') returnToList()
      else await load()
      setMessage(success)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsSection
      title={id ? '账号详情' : auditView ? '管理员操作记录' : '用户管理'}
      icon={<Users className="size-4" />}
      tone="violet"
      description="创建用户、查看近期设备、结束会话，并记录管理员操作。"
    >
      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={returnToList}>
          账号列表
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => navigate({ id: '', view: 'audit' })}
        >
          操作记录
        </Button>
      </div>
      {!id && !auditView && (
        <div className="mb-5 space-y-5">
          <details>
            <summary className="cursor-pointer text-sm font-medium">创建用户</summary>
            <form
              className="mt-3 flex flex-wrap gap-3 sm:items-end"
              onSubmit={event => {
                event.preventDefault()
                void run(
                  { action: 'create', username, password, allow_nsfw: allowNsfw },
                  '账号已创建。',
                )
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
              <label className="flex h-9 items-center gap-2 text-sm">
                <Checkbox
                  checked={allowNsfw}
                  onCheckedChange={checked => setAllowNsfw(checked === true)}
                />
                允许 NSFW
              </label>
              <Button type="submit" disabled={busy}>
                创建用户
              </Button>
            </form>
          </details>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={event => {
              event.preventDefault()
              navigate({ search: search.trim() })
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
                  maxLength={32}
                />
              </div>
            </label>
            <Button type="submit" variant="outline" disabled={busy}>
              搜索
            </Button>
            <label className="space-y-1 text-sm">
              <span className="block">账号状态</span>
              <select
                className="bg-background h-9 rounded-md border px-2"
                value={enabled}
                disabled={busy}
                onChange={event => navigate({ enabled: event.target.value })}
              >
                <option value="">全部状态</option>
                <option value="true">已启用</option>
                <option value="false">已停用</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block">NSFW 权限</span>
              <select
                className="bg-background h-9 rounded-md border px-2"
                value={nsfw}
                disabled={busy}
                onChange={event => navigate({ nsfw: event.target.value })}
              >
                <option value="">全部权限</option>
                <option value="true">允许</option>
                <option value="false">不允许</option>
              </select>
            </label>
          </form>
        </div>
      )}
      {loading && (
        <p role="status" className="py-6 text-center text-sm">
          正在加载…
        </p>
      )}
      {loadError && (
        <p role="alert" className="text-destructive py-4 text-sm">
          {loadError}
        </p>
      )}
      {!loading && !loadError && !auditView && (
        <div className="divide-border divide-y">
          {accounts.map(account => (
            <div key={account.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium break-all">
                    {account.username}{' '}
                    <span className="text-muted-foreground text-xs">
                      ·{' '}
                      {account.role === 'admin' ? '管理员' : account.enabled ? '已启用' : '已停用'}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    创建：{formatTime(account.created_at)}
                    {id && <> · 最近登录：{formatTime(account.last_sign_in_at)}</>}
                  </p>
                  {id && <p className="text-muted-foreground text-xs">近期设备记录：{total}</p>}
                  <p className="text-muted-foreground text-xs">
                    NSFW：{account.role === 'admin' || account.allow_nsfw ? '允许' : '不允许'}
                  </p>
                </div>
                {!id && (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      to={`?${new URLSearchParams({ ...Object.fromEntries(params), id: account.id, listPage: String(page), page: '1' })}`}
                    >
                      查看详情
                    </Link>
                  </Button>
                )}
                {id && account.role === 'user' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          {
                            action: 'set-nsfw',
                            id: account.id,
                            allow_nsfw: !account.allow_nsfw,
                          },
                          account.allow_nsfw
                            ? 'NSFW 权限已关闭，现有会话已退出。'
                            : 'NSFW 权限已开放，需要重新登录。',
                        )
                      }
                    >
                      {account.allow_nsfw ? '关闭 NSFW' : '开放 NSFW'}
                    </Button>
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
                  {account.devices.map((device, index) => (
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
      )}
      {!loading && !loadError && auditView && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center gap-2">
            <History className="size-4" />
            <h3 className="font-medium">最近管理员操作</h3>
          </div>
          <div className="divide-border divide-y rounded-lg border px-3">
            {audit.map(entry => (
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
      )}
      {!loading && !loadError && (
        <nav
          aria-label={id ? '设备分页' : auditView ? '操作记录分页' : '账号分页'}
          className="mt-5 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-muted-foreground text-sm">
            {total === 0 ? '0' : `${offset + 1}–${Math.min(offset + 20, total)}`} / {total}{' '}
            {id ? '条设备记录' : auditView ? '条记录' : '个账号'}
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={busy || page <= 1}
              onClick={() => navigate({ page: String(page - 1) })}
            >
              上一页
            </Button>
            <span className="text-sm">
              {page} / {Math.max(1, Math.ceil(total / 20))}
            </span>
            <Button
              variant="outline"
              disabled={busy || offset + 20 >= total}
              onClick={() => navigate({ page: String(page + 1) })}
            >
              下一页
            </Button>
          </div>
        </nav>
      )}
      <div className="mt-3">
        <Button variant="outline" disabled={busy || loading} onClick={() => void load()}>
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
