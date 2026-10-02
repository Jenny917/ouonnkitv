import { z } from 'zod'

export const playbackReplySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('held'),
    lease_id: z.string().uuid(),
    ttl_ms: z.number().positive(),
    resume_position: z.number().nonnegative().nullable().optional(),
  }),
  z.object({
    status: z.literal('busy'),
    lease_id: z.string().uuid(),
    device_label: z.string(),
    title: z.string(),
  }),
  z.object({ status: z.literal('lost') }),
  z.object({ status: z.literal('released') }),
])
export type PlaybackReply = z.infer<typeof playbackReplySchema>
export type PlaybackConflict = Extract<PlaybackReply, { status: 'busy' }>
export type LeaseRequest = {
  operation: 'acquire' | 'renew' | 'release'
  lease?: string
  takeover?: string
  position: number
  duration: number
}

/** One instance per mounted player, so two tabs also compete for the account lease. */
export function createPlaybackLease(options: {
  request: (input: LeaseRequest) => Promise<PlaybackReply>
  progress: () => { position: number; duration: number }
  isPlaying: () => boolean
  pause: () => void
  acquired: (resumePosition?: number | null) => void
  conflict: (value: PlaybackConflict | null) => void
  notice: (message: string) => void
  now?: () => number
}) {
  const now = options.now ?? Date.now
  let lease: string | null = null
  let deadline = 0
  let pending = false
  let disposed = false
  let revision = 0
  const lose = (message: string) => {
    lease = null
    deadline = 0
    options.pause()
    options.notice(message)
  }
  const currentLease = () => {
    if (disposed || !lease) return null
    if (now() >= deadline) {
      lose('无法确认播放权限，已暂停。请联网后点击播放重试。')
      return null
    }
    return lease
  }
  async function acquire(takeover?: string) {
    if (disposed) return
    options.pause()
    if (pending) return
    pending = true
    const run = ++revision
    const started = now()
    options.conflict(null)
    options.notice('正在确认播放设备…')
    try {
      const reply = await options.request({ operation: 'acquire', takeover, ...options.progress() })
      if (disposed || run !== revision) {
        if (reply.status === 'held')
          void options
            .request({ operation: 'release', lease: reply.lease_id, ...options.progress() })
            .catch(() => {})
        return
      }
      if (reply.status === 'busy') {
        lease = null
        options.notice('另一台设备正在播放。你可以选择接管，或留在此页面。')
        options.conflict(reply)
      } else if (reply.status === 'held') {
        lease = reply.lease_id
        // Budget from request start: slow responses must not extend the server's expiry.
        deadline = started + Math.min(reply.ttl_ms - 5000, 25000)
        if (currentLease()) {
          options.notice('')
          options.acquired(reply.resume_position)
        }
      } else lose('播放权限已变化，请重新点击播放。')
    } catch {
      if (!disposed && run === revision)
        lose('无法确认播放权限，请检查网络后重试；若持续失败请联系管理员。')
    } finally {
      pending = false
    }
  }
  async function renew(checkpoint = false) {
    const active = currentLease()
    if (!active || pending || (!checkpoint && !options.isPlaying())) return
    pending = true
    const run = revision
    const started = now()
    try {
      const reply = await options.request({
        operation: 'renew',
        lease: active,
        ...options.progress(),
      })
      if (disposed || run !== revision || lease !== active) return
      if (reply.status !== 'held' || reply.lease_id !== active) {
        lose('播放已切换到另一台设备。点击播放可重新申请接管。')
      } else {
        deadline = started + Math.min(reply.ttl_ms - 5000, 25000)
        currentLease()
      }
    } catch {
      // A short network interruption is allowed only within the last confirmed lease.
      if (!disposed) currentLease()
    } finally {
      pending = false
    }
  }
  return {
    acquire,
    renew,
    currentLease,
    dispose() {
      const active = lease
      disposed = true
      revision++
      lease = null
      if (active)
        void options
          .request({ operation: 'release', lease: active, ...options.progress() })
          .catch(() => {})
    },
  }
}
