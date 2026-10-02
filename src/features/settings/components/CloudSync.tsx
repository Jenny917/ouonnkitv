import { useState } from 'react'
import { Cloud } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { importDeviceCollection, syncNow, useSyncStatus } from '@/shared/sync/service'
import { useAuthStore } from '@/shared/store/authStore'
import { SettingsSection } from './common'
import AccountAdmin from './AccountAdmin'

export default function CloudSync({ showAdmin = true }: { showAdmin?: boolean }) {
  const state = useSyncStatus()
  const { account, logout, error } = useAuthStore()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  return (
    <>
      <SettingsSection
        title="账号与云同步"
        icon={<Cloud className="size-4" />}
        tone="sky"
        description="登录后自动同步收藏、观看进度与播放/搜索偏好。各账号的数据相互独立。"
      >
        <div className="space-y-3">
          <p className="text-sm">
            {account?.username} · {account?.role === 'admin' ? '管理员' : '用户'}
          </p>
          <p className="text-muted-foreground text-sm" role="status">
            {state.status}
            {state.lastSynced ? ` · 最近同步：${new Date(state.lastSynced).toLocaleString()}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || state.status === '同步中…'} onClick={() => void syncNow()}>
              立即同步
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                try {
                  importDeviceCollection()
                  setMessage('已合并此设备登录前的收藏与历史；云端已有记录优先。')
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : '导入失败')
                }
              }}
            >
              导入此设备原有收藏与历史
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void syncNow()
                  .then(logout)
                  .catch(error => setMessage(error instanceof Error ? error.message : '退出失败'))
                  .finally(() => setBusy(false))
              }}
            >
              退出账号
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            本机更改立即保存，网络恢复后继续同步。退出仅影响当前设备。
          </p>
          {(message || state.error || error) && (
            <p className="text-sm break-words" role="status">
              {message || state.error || error}
            </p>
          )}
        </div>
      </SettingsSection>
      {showAdmin && account?.role === 'admin' && <AccountAdmin />}
    </>
  )
}
