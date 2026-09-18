import { useEffect, useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { RoomView } from './components/RoomView'
import { demoState } from './demo'
import { COMPLETION_GRACE_MS, getTimerStatus, toggleTimer } from './timer'
import type { AppState, ChatMessage, MissionTimer, Room } from './types'

const storageKey = 'psychopath-timer-react-state-v1'
const legacyStorageKey = 'psychopath-timer-state'
const initialNow = Date.now()

function loadState(): AppState {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) return JSON.parse(saved) as AppState
    const legacy = localStorage.getItem(legacyStorageKey)
    if (!legacy) return demoState
    const parsed = JSON.parse(legacy) as { people?: { id: string; name: string }[]; timers?: { id: string; name: string; start: string; end: string; color?: string; people?: string[]; pausedAt?: number }[] }
    const room = demoState.rooms[0]
    return {
      ...demoState,
      rooms: [{
        ...room,
        crew: (parsed.people ?? []).map((person, index) => ({ id: person.id, name: person.name, role: 'CREW MEMBER', online: index < 3, initials: person.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() })),
        timers: (parsed.timers ?? []).map((timer) => ({ id: timer.id, name: timer.name, startAt: new Date(timer.start).getTime(), endAt: new Date(timer.end).getTime(), color: timer.color ?? '#54d6d2', type: 'shared', assigneeIds: timer.people ?? [], pausedAt: timer.pausedAt ?? null, createdBy: demoState.currentUserId })),
        activity: [],
        chat: [],
      }],
    }
  } catch {
    return demoState
  }
}

function createCode() {
  return `${Math.random().toString(36).slice(2, 5)}-${Math.floor(100 + Math.random() * 900)}`.toUpperCase()
}

export default function LocalApp() {
  const [state, setState] = useState(loadState)
  const [now, setNow] = useState(initialNow)

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const tick = Date.now()
      setNow(tick)
      setState((current) => {
        let changed = false
        const rooms = current.rooms.map((room) => {
          const completed = room.timers.filter((timer) => getTimerStatus(timer, tick) === 'complete' && !room.activity.some((item) => item.timer?.id === timer.id))
          const expired = room.timers.filter((timer) => getTimerStatus(timer, tick) === 'complete' && tick - timer.endAt >= COMPLETION_GRACE_MS)
          if (!completed.length && !expired.length) return room
          changed = true
          return {
            ...room,
            timers: room.timers.filter((timer) => !expired.some((item) => item.id === timer.id)),
            activity: [...completed.map((timer) => ({ id: crypto.randomUUID(), timer, label: 'TIMER COMPLETED', detail: timer.type.toUpperCase(), occurredAt: timer.endAt })), ...room.activity].slice(0, 25),
          }
        })
        return changed ? { ...current, rooms } : current
      })
    }, 1_000)
    return () => window.clearInterval(interval)
  }, [])

  function updateActiveRoom(updater: (room: Room) => Room) {
    setState((current) => ({ ...current, rooms: current.rooms.map((room) => room.id === current.activeRoomId ? updater(room) : room) }))
  }

  function saveTimer(timer: MissionTimer) {
    updateActiveRoom((room) => ({ ...room, timers: room.timers.some((item) => item.id === timer.id) ? room.timers.map((item) => item.id === timer.id ? timer : item) : [timer, ...room.timers] }))
  }

  function createRoom(name: string) {
    const id = crypto.randomUUID()
    const room: Room = {
      id,
      code: createCode(),
      name: name.toUpperCase(),
      deck: 'LOCAL OPERATIONS',
      lastVisitedAt: Date.now(),
      timers: [],
      activity: [],
      chat: [],
      crew: [{ id: state.currentUserId, name: 'Ellen Ripley', role: 'ROOM COMMANDER', online: true, initials: 'ER' }],
    }
    setState((current) => ({ ...current, rooms: [room, ...current.rooms], activeRoomId: id }))
  }

  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId)

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => setState((current) => ({ ...current, activeRoomId: null }))}><span className="brand-mark">✦</span><span><strong>PSYCHOPATH TIMER</strong><small>SHIPBOARD OPERATIONS CONSOLE</small></span></button>
        <div className="top-meta"><span className="demo-badge">DEMO / LOCAL</span><span className="signal desktop-signal"><i /> DEVICE LINK</span><span>{new Date(now).toLocaleTimeString([], { hour12: false })}</span></div>
      </header>
      {activeRoom ? <RoomView room={activeRoom} currentUserId={state.currentUserId} now={now} onBack={() => setState((current) => ({ ...current, activeRoomId: null }))} onSaveTimer={saveTimer} onToggleTimer={(id) => updateActiveRoom((room) => ({ ...room, timers: room.timers.map((timer) => timer.id === id ? toggleTimer(timer, now) : timer) }))} onDeleteTimer={(id) => updateActiveRoom((room) => ({ ...room, timers: room.timers.filter((timer) => timer.id !== id) }))} onRunAgain={(id) => updateActiveRoom((room) => { const source = room.activity.find((item) => item.id === id)?.timer; if (!source) return room; const duration = source.endAt - source.startAt; return { ...room, timers: [{ ...source, id: crypto.randomUUID(), startAt: now, endAt: now + duration, pausedAt: null, fixedEnd: false }, ...room.timers] } })} onSendMessage={(message: ChatMessage) => updateActiveRoom((room) => ({ ...room, chat: [...room.chat, message].slice(-50) }))} /> : <Dashboard rooms={state.rooms} now={now} onOpenRoom={(id) => setState((current) => ({ ...current, activeRoomId: id, rooms: current.rooms.map((room) => room.id === id ? { ...room, lastVisitedAt: now } : room) }))} onCreateRoom={createRoom} onJoinRoom={(code) => { const room = state.rooms.find((item) => item.code === code); if (!room) return false; setState((current) => ({ ...current, activeRoomId: room.id })); return true }} />}
      <footer><span>SYS.STATUS: NOMINAL</span><span>DEMO MODE // DATA STORED ON THIS DEVICE</span><span>v0.1.0</span></footer>
    </div>
  )
}
