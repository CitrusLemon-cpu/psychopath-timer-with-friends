import type { MissionTimer } from './types'

export type TimerStatus = 'standby' | 'running' | 'paused' | 'complete'
export const COMPLETION_GRACE_MS = 30_000

export function getTimerStatus(timer: MissionTimer, now: number): TimerStatus {
  if (timer.databaseState === 'completed' || timer.databaseState === 'cancelled') return 'complete'
  if (timer.databaseState === 'idle') return 'standby'
  if (timer.databaseState === 'paused') return 'paused'
  if (timer.databaseState === 'scheduled') {
    if (now >= timer.endAt) return 'complete'
    return now < timer.startAt ? 'standby' : 'running'
  }
  if (timer.pausedAt !== null) return 'paused'
  if (now < timer.startAt) return 'standby'
  if (now >= timer.endAt) return 'complete'
  return 'running'
}

export function getTimerMetrics(timer: MissionTimer, now: number) {
  const effectiveNow = timer.databaseState === 'idle' ? timer.startAt : timer.pausedAt ?? now
  const total = Math.max(1, timer.endAt - timer.startAt)
  const elapsed = Math.min(total, Math.max(0, effectiveNow - timer.startAt))
  const status = getTimerStatus(timer, now)
  const remainingMs = timer.databaseState === 'idle'
    ? (timer.durationSeconds ?? 0) * 1000
    : status === 'standby'
    ? timer.startAt - now
    : Math.max(0, timer.endAt - effectiveNow)

  return { status, remainingMs, progress: Math.round((elapsed / total) * 100) }
}

export function toggleTimer(timer: MissionTimer, now: number): MissionTimer {
  if (timer.pausedAt === null) return { ...timer, pausedAt: now }
  const pausedFor = now - timer.pausedAt
  return {
    ...timer,
    startAt: timer.startAt + pausedFor,
    endAt: timer.endAt + pausedFor,
    pausedAt: null,
  }
}

export function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}
