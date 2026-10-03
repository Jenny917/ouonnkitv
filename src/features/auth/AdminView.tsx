import AccountAdmin from '@/features/settings/components/AccountAdmin'
import { SettingsPageShell } from '@/features/settings/components/common'

export default function AdminView() {
  return (
    <div className="mx-auto max-w-5xl px-2 py-4 md:px-4 md:py-6">
      <SettingsPageShell title="管理员中心" description="管理账号权限、近期设备与管理员操作记录。">
        <AccountAdmin />
      </SettingsPageShell>
    </div>
  )
}
