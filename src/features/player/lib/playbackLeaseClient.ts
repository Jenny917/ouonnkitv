import { syncClient } from '@/shared/sync/client'
import { useAuthStore } from '@/shared/store/authStore'
import { playbackReplySchema, type LeaseRequest } from './playbackLease'

export function playbackLeaseClient(mediaKey: string, title: string) {
  const player = crypto.randomUUID()
  const owner = useAuthStore.getState().account?.id
  const platform = navigator.platform || '未知设备'
  const browser = navigator.userAgent.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/)?.[1] || '浏览器'
  return async (input: LeaseRequest) => {
    const state = useAuthStore.getState()
    if (!syncClient || !owner || state.account?.id !== owner || !state.session)
      throw new Error('请重新登录')
    const { data, error } = await syncClient
      .rpc('playback_lease', {
        p_operation: input.operation,
        p_lease: input.lease,
        p_takeover: input.takeover,
        p_position: input.position,
        p_duration: input.duration,
        p_player: player,
        p_device_label: `${browser} · ${platform}`,
        p_media_key: mediaKey,
        p_title: title,
      })
      .setHeader('Authorization', `Bearer ${state.session.access_token}`)
      .abortSignal(AbortSignal.timeout(8000))
    if (error) throw error
    return playbackReplySchema.parse(data)
  }
}
