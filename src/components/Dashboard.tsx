import { useState, type FormEvent } from 'react'
import type { Room } from '../types'
import { getTimerStatus } from '../timer'
import { Modal } from './Modal'

interface DashboardProps {
  rooms: Room[]
  now: number
  onOpenRoom: (id: string) => void
  onCreateRoom: (name: string) => void | Promise<void>
  onJoinRoom: (code: string) => boolean | { status: 'joined' | 'pending' } | Promise<boolean | { status: 'joined' | 'pending' }>
  displayName?: string
  isGuest?: boolean
  isRemote?: boolean
  loadError?: string
}

export function Dashboard({ rooms, now, onOpenRoom, onCreateRoom, onJoinRoom, displayName = 'Ripley', isGuest = false, isRemote = false, loadError }: DashboardProps) {
  const [modal, setModal] = useState<'create' | 'join' | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!value.trim()) return
    setBusy(true)
    setError('')
    try {
      if (modal === 'create') await onCreateRoom(value.trim())
      if (modal === 'join') {
        const result = await onJoinRoom(value.trim().toUpperCase())
        if (!result) throw new Error('Room code not found on this device.')
        if (typeof result === 'object' && result.status === 'pending') setNotice('Join request transmitted. A room owner must approve it before the room appears.')
      }
      setModal(null)
      setValue('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The operation could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  function openModal(next: 'create' | 'join') {
    setValue('')
    setError('')
    setNotice('')
    setModal(next)
  }

  const orderedRooms = [...rooms].sort((left, right) => Number(Boolean(right.isPersonal)) - Number(Boolean(left.isPersonal)))

  return (
    <main className="dashboard">
      <section className="dashboard-hero">
        <p className="eyebrow">// PERSONAL COMMAND TERMINAL</p>
        <h1>WELCOME BACK, <em>{displayName.toUpperCase()}</em></h1>
        <p>Your missions are waiting. Select a room or establish a new link.</p>
        <div className="dashboard-actions">{!isGuest && <button className="primary" onClick={() => openModal('create')}>+ CREATE ROOM</button>}<button className="secondary" onClick={() => openModal('join')}>JOIN WITH CODE</button></div>
        {isGuest && <p className="access-note">GUEST SESSION · JOIN ROOMS AND CREATE PERSONAL TIMERS</p>}
        {notice && <p className="success-note" role="status">{notice}</p>}
        {loadError && <p className="form-error" role="alert">{loadError}</p>}
      </section>
      <section className="saved-rooms">
        <div className="section-heading"><div><p className="eyebrow">// SAVED FREQUENCIES</p><h2>YOUR ROOMS</h2></div><span className="count-label">{String(rooms.length).padStart(2, '0')} RECORDS</span></div>
        <div className="room-grid">
          {orderedRooms.map((room) => {
            const active = room.timers.filter((timer) => ['running', 'paused'].includes(getTimerStatus(timer, now))).length
            const online = room.crew.filter((member) => member.online).length
            return (
              <button className="room-card panel" key={room.id} onClick={() => onOpenRoom(room.id)}>
                <div className="room-card-top"><span className="room-glyph">{room.isPersonal ? '◎' : '✦'}</span><span className="room-code">{room.isPersonal ? 'PERSONAL' : room.code}</span></div>
                <h3>{room.name}</h3><p>{room.deck}</p>
                <div className="room-stats"><span><strong>{String(active).padStart(2, '0')}</strong> ACTIVE TIMERS</span><span><strong>{String(room.isPersonal ? room.chat.length : online).padStart(2, '0')}</strong> {room.isPersonal ? 'LOG ENTRIES' : 'CREW ONLINE'}</span></div>
                <div className="room-enter">{room.isPersonal ? 'OPEN PERSONAL ROOM' : 'ENTER CONTROL ROOM'} <span>→</span></div>
              </button>
            )
          })}
          {!isGuest && <button className="new-room-card" onClick={() => openModal('create')}><span>+</span><strong>ESTABLISH NEW ROOM</strong><small>{isRemote ? 'CREATE A PRIVATE CREW LINK' : 'CREATE A LOCAL FREQUENCY'}</small></button>}
        </div>
      </section>
      {modal && <Modal eyebrow={modal === 'create' ? '// ESTABLISH FREQUENCY' : '// LOCATE FREQUENCY'} title={modal === 'create' ? 'CREATE ROOM' : 'JOIN ROOM'} onClose={() => setModal(null)}><form className="simple-form" onSubmit={submit}><label>{modal === 'create' ? 'ROOM NAME' : 'ROOM CODE'}<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={modal === 'create' ? 'e.g. USCSS Nostromo' : 'e.g. N7X426'} maxLength={modal === 'create' ? 36 : 12} /></label>{error && <p className="form-error" role="alert">{error}</p>}<p className="modal-note">{isRemote ? (modal === 'create' ? 'A single multi-use crew code will be generated. Share it only with people you want aboard.' : 'The code will join immediately or submit an approval request according to the room policy.') : (modal === 'create' ? 'This room and its crew data will exist on this device only.' : 'Demo mode can only join rooms already saved on this device.')}</p><div className="dialog-actions"><button type="button" className="secondary" onClick={() => setModal(null)}>CANCEL</button><button className="primary" disabled={busy}>{busy ? 'TRANSMITTING…' : modal === 'create' ? 'CREATE ROOM' : 'JOIN ROOM'} →</button></div></form></Modal>}
    </main>
  )
}
