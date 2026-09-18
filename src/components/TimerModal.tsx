import { useState, type FormEvent } from 'react'
import type { CrewMember, MissionTimer, TimerType } from '../types'
import { Modal } from './Modal'

const colors = ['#54d6d2', '#ef4b4b', '#f0c86b', '#a78bfa', '#67e8a5']

function toLocalInput(timestamp: number) {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}

interface TimerModalProps {
  crew: CrewMember[]
  currentUserId: string
  now: number
  timer?: MissionTimer
  onClose: () => void
  onSave: (timer: MissionTimer) => void
  allowShared?: boolean
}

export function TimerModal({ crew, currentUserId, now, timer, onClose, onSave, allowShared = true }: TimerModalProps) {
  const initialStart = timer?.startAt ?? now
  const [name, setName] = useState(timer?.name ?? '')
  const [mode, setMode] = useState<'duration' | 'end'>('duration')
  const [startAt, setStartAt] = useState(toLocalInput(initialStart))
  const [endAt, setEndAt] = useState(toLocalInput(timer?.endAt ?? initialStart + 60 * 60_000))
  const [hours, setHours] = useState(timer ? Math.max(0, Math.floor((timer.endAt - timer.startAt) / 3_600_000)) : 1)
  const [minutes, setMinutes] = useState(timer ? Math.floor(((timer.endAt - timer.startAt) % 3_600_000) / 60_000) : 0)
  const [type, setType] = useState<TimerType>(timer?.type ?? (allowShared ? 'shared' : 'personal'))
  const [assignees, setAssignees] = useState(timer?.assigneeIds ?? [currentUserId])
  const [color, setColor] = useState(timer?.color ?? colors[0])
  const [error, setError] = useState('')
  const [controlPolicy, setControlPolicy] = useState(timer?.controlPolicy ?? 'creator_only')

  function submit(event: FormEvent) {
    event.preventDefault()
    const start = new Date(startAt).getTime()
    const end = mode === 'duration' ? start + (hours * 60 + minutes) * 60_000 : new Date(endAt).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setError('End time must be after the start time.')
      return
    }
    const selected = type === 'personal' ? [currentUserId] : assignees
    if (type === 'shared' && selected.length === 0) {
      setError('Assign at least one crew member to a shared timer.')
      return
    }
    onSave({
      id: timer?.id ?? crypto.randomUUID(),
      name: name.trim() || new Date(end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      startAt: start,
      endAt: end,
      color,
      type,
      assigneeIds: selected,
      pausedAt: timer?.pausedAt ?? null,
      createdBy: timer?.createdBy ?? currentUserId,
      durationSeconds: Math.ceil((end - start) / 1000),
      controlPolicy,
    })
  }

  function toggleAssignee(id: string) {
    setAssignees((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  return (
    <Modal eyebrow={timer ? '// MODIFY MISSION RECORD' : '// NEW MISSION RECORD'} title={timer ? 'EDIT COUNTDOWN' : 'DEPLOY COUNTDOWN'} onClose={onClose}>
      <form className="timer-form" onSubmit={submit}>
        <label>MISSION NAME <span>(OPTIONAL)</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={42} placeholder="e.g. Survive the shift" /></label>
        <div className="segmented" aria-label="Countdown method">
          <button type="button" className={mode === 'duration' ? 'selected' : ''} onClick={() => setMode('duration')}>DURATION</button>
          <button type="button" className={mode === 'end' ? 'selected' : ''} onClick={() => setMode('end')}>END TIME</button>
        </div>
        <label>START TIME <span>(FUTURE START OPTIONAL)</span><input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
        {mode === 'duration' ? (
          <div className="form-grid duration-grid">
            <label>HOURS<input type="number" min="0" max="999" value={hours} onChange={(event) => setHours(Number(event.target.value))} /></label>
            <label>MINUTES<input type="number" min="0" max="59" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
          </div>
        ) : <label>END TIME<input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} /></label>}
        <fieldset>
          <legend>TIMER TYPE</legend>
          <div className="type-options">
            <label className={type === 'personal' ? 'selected' : ''}><input type="radio" name="type" checked={type === 'personal'} onChange={() => setType('personal')} disabled={Boolean(timer)} />PERSONAL <span>VISIBLE TO CREW</span></label>
            {allowShared && <label className={type === 'shared' ? 'selected' : ''}><input type="radio" name="type" checked={type === 'shared'} onChange={() => setType('shared')} disabled={Boolean(timer)} />SHARED <span>ASSIGN MULTIPLE CREW</span></label>}
          </div>
        </fieldset>
        {type === 'shared' && <fieldset><legend>ASSIGN CREW</legend><div className="crew-picker">{crew.map((member) => <label key={member.id} className={assignees.includes(member.id) ? 'selected' : ''}><input type="checkbox" checked={assignees.includes(member.id)} onChange={() => toggleAssignee(member.id)} /><span>{member.initials}</span>{member.name}</label>)}</div><label className="policy-option"><input type="checkbox" checked={controlPolicy === 'all_assigned'} onChange={(event) => setControlPolicy(event.target.checked ? 'all_assigned' : 'creator_only')} /> ALLOW ASSIGNED CREW TO CONTROL THIS TIMER</label></fieldset>}
        {!allowShared && <p className="modal-note">GUEST ACCESS · PERSONAL TIMERS ONLY</p>}
        <fieldset className="color-field"><legend>PROGRESS COLOR <span>{color.toUpperCase()}</span></legend><div className="color-options">{colors.map((option) => <button key={option} type="button" className={`color-swatch ${color === option ? 'selected' : ''}`} style={{ '--swatch': option } as React.CSSProperties} onClick={() => setColor(option)} aria-label={`Use ${option}`} />)}<input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Custom progress color" /></div></fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button className="secondary" type="button" onClick={onClose}>ABORT</button><button className="primary" type="submit">{timer ? 'SAVE CHANGES' : 'DEPLOY TIMER'} →</button></div>
      </form>
    </Modal>
  )
}
