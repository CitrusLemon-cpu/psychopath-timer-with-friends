import { describe, expect, it } from 'vitest'
import { formatDuration, getTimerMetrics, getTimerStatus, toggleTimer } from './timer'
import type { MissionTimer } from './types'

const timer: MissionTimer = {
  id: 'timer-1',
  name: 'Test mission',
  startAt: 1_000,
  endAt: 11_000,
  color: '#54d6d2',
  type: 'shared',
  assigneeIds: ['crew-1'],
  pausedAt: null,
  createdBy: 'crew-1',
}

describe('timer math', () => {
  it('tracks standby, running, and complete states at their boundaries', () => {
    expect(getTimerStatus(timer, 999)).toBe('standby')
    expect(getTimerStatus(timer, 1_000)).toBe('running')
    expect(getTimerStatus(timer, 10_999)).toBe('running')
    expect(getTimerStatus(timer, 11_000)).toBe('complete')
  })

  it('calculates progress and remaining time', () => {
    expect(getTimerMetrics(timer, 6_000)).toEqual({ status: 'running', remainingMs: 5_000, progress: 50 })
    expect(getTimerMetrics(timer, 0)).toEqual({ status: 'standby', remainingMs: 1_000, progress: 0 })
  })

  it('freezes while paused and shifts both boundaries when resumed', () => {
    const paused = toggleTimer(timer, 5_000)
    expect(getTimerMetrics(paused, 9_000)).toEqual({ status: 'paused', remainingMs: 6_000, progress: 40 })
    const resumed = toggleTimer(paused, 9_000)
    expect(resumed).toMatchObject({ startAt: 5_000, endAt: 15_000, pausedAt: null })
    expect(getTimerMetrics(resumed, 9_000).remainingMs).toBe(6_000)
  })

  it('does not pause fixed-end timers', () => {
    const fixed = { ...timer, fixedEnd: true }
    expect(toggleTimer(fixed, 5_000)).toEqual(fixed)
  })

  it('formats long and negative durations safely', () => {
    expect(formatDuration(3_661_000)).toBe('01:01:01')
    expect(formatDuration(-1)).toBe('00:00:00')
  })
})
