import { useState, type FormEvent } from 'react'
import { readableError, type MultiplayerGateway } from '../multiplayer/gateway'
import type { UserProfile } from '../types'

export function ProfileSetup({ gateway, profile, onSaved, onCancel }: { gateway: MultiplayerGateway; profile: UserProfile; onSaved: (profile: UserProfile) => void; onCancel?: () => void }) {
  const handleIsSet = !/^user_[0-9a-f]{19}$/.test(profile.handle)
  const generatedHandle = handleIsSet ? profile.handle : ''
  const [handle, setHandle] = useState(generatedHandle)
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!/^[a-z0-9_]{3,24}$/i.test(handle)) {
      setError('Handle must be 3–24 letters, numbers, or underscores.')
      return
    }
    if (!displayName.trim() || displayName.trim().length > 50) {
      setError('Display name must be 1–50 characters.')
      return
    }
    setBusy(true)
    setError('')
    try {
      onSaved(await gateway.updateProfile(profile.id, handle, displayName.trim()))
    } catch (caught) {
      setError(readableError(caught))
      setBusy(false)
    }
  }

  return <main className="auth-view"><section className="auth-panel panel"><p className="eyebrow">// {onCancel ? 'UPDATE CREW IDENTITY' : 'CREW IDENTITY REQUIRED'}</p><h1>{onCancel ? 'EDIT PROFILE' : 'CREATE PROFILE'}</h1><p>{handleIsSet ? 'Your handle is permanent. You can still update your display name.' : 'Choose the permanent identity your crewmates will see. Handles are unique and cannot be changed later.'}</p><form className="simple-form" onSubmit={submit}><label>HANDLE<div className="handle-input"><span>@</span><input aria-label="HANDLE" value={handle} onChange={(event) => setHandle(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} maxLength={24} required disabled={handleIsSet} /></div></label><label>DISPLAY NAME<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={50} required /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions">{onCancel && <button type="button" className="secondary" onClick={onCancel}>CANCEL</button>}<button className="primary" disabled={busy}>{busy ? 'SAVING…' : 'SAVE CREW IDENTITY'} →</button></div></form></section></main>
}
