import { useMemo, useState, type FormEvent } from 'react'
import type { ChatMessage, MissionTimer, Room, TimerFilter } from '../types'
import { COMPLETION_GRACE_MS, formatDuration, getTimerMetrics } from '../timer'
import { TimerModal } from './TimerModal'

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

interface RoomViewProps {
  room: Room
  currentUserId: string
  now: number
  onBack: () => void
  onSaveTimer: (timer: MissionTimer) => void
  onToggleTimer: (id: string) => void
  onDeleteTimer: (id: string) => void
  onRunAgain: (id: string) => void
  onSendMessage: (message: ChatMessage) => void
}

export function RoomView({ room, currentUserId, now, onBack, onSaveTimer, onToggleTimer, onDeleteTimer, onRunAgain, onSendMessage }: RoomViewProps) {
  const [filter, setFilter] = useState<TimerFilter>('all')
  const [editingTimer, setEditingTimer] = useState<MissionTimer | null | undefined>(undefined)
  const [message, setMessage] = useState('')
  const [mobileRail, setMobileRail] = useState<'crew' | 'chat' | null>(null)
  const [offlineOpen, setOfflineOpen] = useState(false)
  const onlineCrew = room.crew.filter((member) => member.online)
  const offlineCrew = room.crew.filter((member) => !member.online)
  const activeCount = room.timers.filter((timer) => ['running', 'paused'].includes(getTimerMetrics(timer, now).status)).length
  const filteredTimers = useMemo(() => room.timers.filter((timer) => {
    const status = getTimerMetrics(timer, now).status
    if (status === 'complete' && now - timer.endAt >= COMPLETION_GRACE_MS) return false
    if (filter === 'mine') return timer.assigneeIds.includes(currentUserId)
    if (filter === 'shared') return timer.type === 'shared'
    if (filter === 'standby') return status === 'standby'
    if (filter === 'paused') return status === 'paused'
    return true
  }), [room.timers, filter, currentUserId, now])

  function sendMessage(event: FormEvent) {
    event.preventDefault()
    if (!message.trim()) return
    onSendMessage({ id: crypto.randomUUID(), senderId: currentUserId, text: message.trim(), sentAt: now })
    setMessage('')
  }

  return (
    <main className="room-view">
      <section className="room-header panel">
        <button className="back-button" onClick={onBack}>← <span>ALL ROOMS</span></button>
        <div className="room-identity"><p className="eyebrow">// ACTIVE CONTROL ROOM</p><h1>{room.name}</h1><div><span className="signal"><i /> LOCAL LINK</span><span>ROOM {room.code}</span><span>{room.deck}</span></div></div>
        <div className="readout"><span>ACTIVE TIMERS</span><strong>{String(activeCount).padStart(2, '0')}</strong></div>
      </section>
      <div className="mobile-rail-controls"><button onClick={() => setMobileRail(mobileRail === 'crew' ? null : 'crew')} className={mobileRail === 'crew' ? 'selected' : ''}>CREW <span>{onlineCrew.length}</span></button><button onClick={() => setMobileRail(mobileRail === 'chat' ? null : 'chat')} className={mobileRail === 'chat' ? 'selected' : ''}>COMMS <span>{room.chat.length}</span></button></div>
      <div className="workspace">
        <section className="timers-column">
          <div className="section-heading mission-heading"><div><p className="eyebrow">// LIVE SYSTEMS</p><h2>MISSION TIMERS</h2></div><button className="primary" onClick={() => setEditingTimer(null)}>+ NEW COUNTDOWN</button></div>
          <div className="filters" aria-label="Timer filters">{(['all', 'mine', 'shared', 'standby', 'paused'] as TimerFilter[]).map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? 'selected' : ''}>{item.toUpperCase()}</button>)}</div>
          <div className="timer-list">
            {filteredTimers.map((timer) => <TimerCard key={timer.id} timer={timer} room={room} now={now} onToggle={() => onToggleTimer(timer.id)} onEdit={() => setEditingTimer(timer)} onDelete={() => onDeleteTimer(timer.id)} />)}
            {!filteredTimers.length && <div className="empty-state panel"><span className="empty-icon">◎</span><h3>NO MATCHING MISSIONS</h3><p>No countdowns are transmitting on this channel.</p><button className="text-button" onClick={() => setEditingTimer(null)}>+ DEPLOY COUNTDOWN</button></div>}
          </div>
          <section className="activity-section"><div className="section-heading"><div><p className="eyebrow">// MISSION LOG</p><h2>RECENT ACTIVITY</h2></div><span className="count-label">LAST {Math.min(room.activity.length, 5).toString().padStart(2, '0')}</span></div><div className="activity-list">{room.activity.slice(0, 5).map((item) => <div className="activity-item" key={item.id}><span className="activity-mark">✓</span><div><strong>{item.timer.name}</strong><span>COMPLETED {formatTimestamp(item.completedAt)} · {item.timer.type.toUpperCase()}</span></div><button onClick={() => onRunAgain(item.id)}>↻ RUN AGAIN</button></div>)}{!room.activity.length && <p className="aside-note">Completed countdowns will be recorded here.</p>}</div></section>
        </section>
        <aside className={`right-rail ${mobileRail ? 'mobile-open' : ''}`}>
          <section className={`rail-panel panel crew-panel ${mobileRail === 'chat' ? 'mobile-hidden' : ''}`}><div className="aside-heading"><div><p className="eyebrow">// PERSONNEL</p><h2>CREW MANIFEST</h2></div><span className="crew-count">{String(room.crew.length).padStart(2, '0')}</span></div><p className="rail-label"><span><i /> ONLINE</span>{onlineCrew.length}/{room.crew.length}</p><div className="people-list">{onlineCrew.map((member) => <div className="person" key={member.id}><span className="avatar">{member.initials}</span><div><strong>{member.name}{member.id === currentUserId && <em>YOU</em>}</strong><small>{member.role}</small></div><i className="online-dot" /></div>)}</div>{offlineCrew.length > 0 && <><button className="offline-toggle" onClick={() => setOfflineOpen((value) => !value)}>{offlineOpen ? '▾' : '▸'} OFFLINE CREW <span>{offlineCrew.length}</span></button>{offlineOpen && <div className="people-list offline">{offlineCrew.map((member) => <div className="person" key={member.id}><span className="avatar">{member.initials}</span><div><strong>{member.name}</strong><small>{member.role}</small></div></div>)}</div>}</>}</section>
          <section className={`rail-panel panel chat-panel ${mobileRail === 'crew' ? 'mobile-hidden' : ''}`}><div className="aside-heading"><div><p className="eyebrow">// LOCAL CHANNEL</p><h2>CREW COMMS</h2></div><span className="transmit">TX</span></div><div className="messages">{room.chat.slice(-8).map((item) => { const sender = room.crew.find((member) => member.id === item.senderId); return <div className={`message ${item.senderId === currentUserId ? 'mine' : ''}`} key={item.id}><div><strong>{sender?.name ?? 'Unknown'}</strong><span>{new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><p>{item.text}</p></div>})}</div><form className="chat-form" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={240} placeholder="Transmit message..." aria-label="Chat message" /><button aria-label="Send message">→</button></form><p className="local-note">LOCAL DEVICE CHANNEL · NOT REALTIME</p></section>
        </aside>
      </div>
      {editingTimer !== undefined && <TimerModal crew={room.crew} currentUserId={currentUserId} now={now} timer={editingTimer ?? undefined} onClose={() => setEditingTimer(undefined)} onSave={(timer) => { onSaveTimer(timer); setEditingTimer(undefined) }} />}
    </main>
  )
}

function TimerCard({ timer, room, now, onToggle, onEdit, onDelete }: { timer: MissionTimer; room: Room; now: number; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const metrics = getTimerMetrics(timer, now)
  const names = timer.assigneeIds.map((id) => room.crew.find((member) => member.id === id)?.name.split(' ')[0]).filter(Boolean).join(' · ') || 'UNASSIGNED CREW'
  const statusLabel = { running: 'IN PROGRESS', paused: 'PAUSED', standby: 'STANDBY', complete: 'COMPLETE' }[metrics.status]
  return <article className={`timer-card ${metrics.status}`} style={{ '--timer-color': timer.color } as React.CSSProperties}><div className="timer-top"><div><div className="timer-title-row"><span className="timer-kind">{timer.type === 'shared' ? '◉' : '◎'} {timer.type.toUpperCase()}</span><span className={`status ${metrics.status}`}><i />{statusLabel}</span></div><h3>{timer.name}</h3><div className="timer-crew">ASSIGNED: {names.toUpperCase()}</div></div><div className="time-display"><strong>{formatDuration(metrics.remainingMs)}</strong><span>{metrics.status === 'standby' ? 'UNTIL START' : 'REMAINING'}</span></div></div><div className="progress-row"><div className="progress-track"><div className="progress-fill" style={{ width: `${metrics.progress}%` }} /></div><span>{metrics.progress}%</span></div><div className="timer-bottom"><span>{formatTimestamp(timer.startAt)} → {formatTimestamp(timer.endAt)}</span><div className="timer-actions">{['running', 'paused'].includes(metrics.status) && <button onClick={onToggle}>{metrics.status === 'paused' ? '▶ RESUME' : 'Ⅱ PAUSE'}</button>}<button onClick={onEdit}>EDIT</button><button className="danger" onClick={onDelete}>DELETE</button></div></div></article>
}
