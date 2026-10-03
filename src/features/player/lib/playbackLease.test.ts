import { describe, expect, it, vi } from 'vitest'
import { createPlaybackLease, type PlaybackReply } from './playbackLease'

const leaseId = '00000000-0000-4000-8000-000000000001'
const otherId = '00000000-0000-4000-8000-000000000002'
const held: PlaybackReply = { status: 'held', lease_id: leaseId, ttl_ms: 30000 }
const busy: PlaybackReply = {
  status: 'busy',
  lease_id: otherId,
  device_label: 'Phone',
  title: 'Movie',
}
function setup() {
  let time = 0
  const request = vi.fn().mockResolvedValue(held)
  const options = {
    request,
    progress: () => ({ position: 120, duration: 600 }),
    isPlaying: vi.fn().mockReturnValue(true),
    pause: vi.fn(),
    acquired: vi.fn(),
    conflict: vi.fn(),
    notice: vi.fn(),
    displaced: vi.fn(),
    now: () => time,
  }
  return {
    controller: createPlaybackLease(options),
    options,
    setTime: (value: number) => {
      time = value
    },
  }
}
describe('playback ownership', () => {
  it('pauses before claiming and permits progress only after server confirmation', async () => {
    const { controller, options } = setup()
    expect(controller.currentLease()).toBeNull()
    await controller.acquire()
    expect(options.pause.mock.invocationCallOrder[0]).toBeLessThan(
      options.request.mock.invocationCallOrder[0],
    )
    expect(controller.currentLease()).toBe(leaseId)
    expect(options.acquired).toHaveBeenCalledOnce()
  })
  it('does not automatically steal another device playback', async () => {
    const { controller, options } = setup()
    options.request.mockResolvedValue(busy)
    await controller.acquire()
    expect(options.conflict).toHaveBeenLastCalledWith(busy)
    expect(controller.currentLease()).toBeNull()
    expect(options.acquired).not.toHaveBeenCalled()
    expect(options.request).toHaveBeenCalledTimes(1)
  })
  it('takes over only the lease confirmed by the user and resumes the returned progress', async () => {
    const { controller, options } = setup()
    options.request.mockResolvedValue({ ...held, resume_position: 125 })
    await controller.acquire(otherId)
    expect(options.request).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'acquire', takeover: otherId }),
    )
    expect(options.acquired).toHaveBeenCalledWith(125)
  })
  it('asks again if another device took over while the dialog was open', async () => {
    const { controller, options } = setup()
    options.request.mockResolvedValue(busy)
    await controller.acquire(leaseId)
    expect(options.conflict).toHaveBeenLastCalledWith(busy)
    expect(options.acquired).not.toHaveBeenCalled()
  })
  it('pauses and blocks further progress writes after ownership is lost', async () => {
    const { controller, options } = setup()
    await controller.acquire()
    options.request.mockResolvedValue({ status: 'lost' })
    await controller.renew()
    expect(controller.currentLease()).toBeNull()
    expect(options.pause).toHaveBeenCalledTimes(2)
    expect(options.notice).toHaveBeenLastCalledWith(expect.stringContaining('另一台设备'))
    expect(options.displaced).toHaveBeenCalledOnce()
    expect(options.pause.mock.invocationCallOrder[1]).toBeLessThan(
      options.displaced.mock.invocationCallOrder[0],
    )
    await controller.renew()
    expect(options.displaced).toHaveBeenCalledOnce()
  })
  it('allows brief outages but pauses before the server lease expires', async () => {
    const { controller, options, setTime } = setup()
    await controller.acquire()
    options.request.mockRejectedValue(new Error('offline'))
    setTime(5000)
    await controller.renew()
    expect(controller.currentLease()).toBe(leaseId)
    setTime(25000)
    expect(controller.currentLease()).toBeNull()
    expect(options.pause).toHaveBeenCalledTimes(2)
    expect(options.displaced).not.toHaveBeenCalled()
  })
  it('does not grant playback after an excessively slow response', async () => {
    const { controller, options, setTime } = setup()
    options.request.mockImplementation(async () => {
      setTime(31000)
      return held
    })
    await controller.acquire()
    expect(options.acquired).not.toHaveBeenCalled()
    expect(controller.currentLease()).toBeNull()
  })
  it('releases a late claim when the player was closed during the request', async () => {
    const { controller, options } = setup()
    let resolve!: (reply: PlaybackReply) => void
    options.request.mockReturnValueOnce(
      new Promise<PlaybackReply>(done => {
        resolve = done
      }),
    )
    const pending = controller.acquire()
    controller.dispose()
    resolve(held)
    await pending
    expect(options.acquired).not.toHaveBeenCalled()
    expect(options.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: 'release', lease: leaseId }),
    )
  })
  it('releases only its own lease and ignores later renewal responses', async () => {
    const { controller, options } = setup()
    await controller.acquire()
    let resolve!: (reply: PlaybackReply) => void
    options.request.mockReturnValueOnce(
      new Promise<PlaybackReply>(done => {
        resolve = done
      }),
    )
    const pending = controller.renew()
    controller.dispose()
    resolve(held)
    await pending
    expect(controller.currentLease()).toBeNull()
    expect(options.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: 'release', lease: leaseId }),
    )
  })
  it('does not keep a paused player alive but can checkpoint its final position', async () => {
    const { controller, options } = setup()
    await controller.acquire()
    options.isPlaying.mockReturnValue(false)
    await controller.renew()
    expect(options.request).toHaveBeenCalledTimes(1)
    await controller.renew(true)
    expect(options.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: 'renew', position: 120 }),
    )
  })
  it('deduplicates repeated clicks while acquiring', async () => {
    const { controller, options } = setup()
    await Promise.all([controller.acquire(), controller.acquire()])
    expect(options.request).toHaveBeenCalledTimes(1)
    expect(options.pause).toHaveBeenCalledTimes(2)
  })
})
