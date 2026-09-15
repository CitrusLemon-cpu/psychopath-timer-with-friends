import { useState, type FormEvent } from 'react'
import type { Room } from '../types'
import { getTimerStatus } from '../timer'
import { Modal } from './Modal'

interface DashboardProps {
  rooms: Room[]
  now: number
  onOpenRoom: (id: string) => void
  onCreateRoom: (name: string) => void
  onJoinRoom: (code: string) => boolean
}

export function Dashboard({ rooms, now, onOpenRoom, onCreateRoom, onJoinRoom }: DashboardProps) {
  const [modal, setModal] = useState<'create' | 'join' | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!value.trim()) return
    if (modal === 'create') onCreateRoom(value.trim())
    if (modal === 'join' && !onJoinRoom(value.trim().toUpperCase())) {
      setError('Room code not found on this device.')
      return
    }
    setModal(null)
    setValue('')
  }

  function openModal(next: 'create' | 'join') {
    setValue('')
    setError('')
    setModal(next)
  }

  return (
    <main className="dashboard">
      <section className="dashboard-hero">
        <p className="eyebrow">// PERSONAL COMMAND TERMINAL</p>
        <h1>WELCOME BACK, <em>RIPLEY</em></h1>
        <p>Your missions are waiting. Select a room or establish a new link.</p>
        <div className="dashboard-actions"><button className="primary" onClick={() => openModal('create')}>+ CREATE ROOM</button><button className="secondary" onClick={() => openModal('join')}>JOIN WITH CODE</button></div>
      </section>
      <section className="saved-rooms">
        <div className="section-heading"><div><p className="eyebrow">// SAVED FREQUENCIES</p><h2>YOUR ROOMS</h2></div><span className="count-label">{String(rooms.length).padStart(2, '0')} RECORDS</span></div>
        <div className="room-grid">
          {rooms.map((room) => {
            const active = room.timers.filter((timer) => ['running', 'paused'].includes(getTimerStatus(timer, now))).length
            const online = room.crew.filter((member) => member.online).length
            return (
              <button className="room-card panel" key={room.id} onClick={() => onOpenRoom(room.id)}>
                <div className="room-card-top"><span className="room-glyph">✦</span><span className="room-code">{room.code}</span></div>
                <h3>{room.name}</h3><p>{room.deck}</p>
                <div className="room-stats"><span><strong>{String(active).padStart(2, '0')}</strong> ACTIVE TIMERS</span><span><strong>{String(online).padStart(2, '0')}</strong> CREW ONLINE</span></div>
                <div className="room-enter">ENTER CONTROL ROOM <span>→</span></div>
              </button>
            )
          })}
          <button className="new-room-card" onClick={() => openModal('create')}><span>+</span><strong>ESTABLISH NEW ROOM</strong><small>CREATE A LOCAL FREQUENCY</small></button>
        </div>
      </section>
      {modal && <Modal eyebrow={modal === 'create' ? '// ESTABLISH FREQUENCY' : '// LOCATE FREQUENCY'} title={modal === 'create' ? 'CREATE ROOM' : 'JOIN ROOM'} onClose={() => setModal(null)}><form className="simple-form" onSubmit={submit}><label>{modal === 'create' ? 'ROOM NAME' : 'ROOM CODE'}<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={modal === 'create' ? 'e.g. USCSS Nostromo' : 'e.g. N7X-426'} maxLength={modal === 'create' ? 36 : 10} /></label>{error && <p className="form-error" role="alert">{error}</p>}<p className="modal-note">{modal === 'create' ? 'This room and its crew data will exist on this device only.' : 'Demo mode can only join rooms already saved on this device.'}</p><div className="dialog-actions"><button type="button" className="secondary" onClick={() => setModal(null)}>CANCEL</button><button className="primary">{modal === 'create' ? 'CREATE ROOM' : 'JOIN ROOM'} →</button></div></form></Modal>}
    </main>
  )
}
