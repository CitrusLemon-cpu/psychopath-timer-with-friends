import { useState, type FormEvent } from 'react'
import { generatedCrewmateName, readableError, type MultiplayerGateway } from '../multiplayer/gateway'

export function AuthView({ gateway }: { gateway: MultiplayerGateway }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'signin') await gateway.signIn(email.trim(), password)
      else {
        const result = await gateway.signUp(email.trim(), password)
        if (result.confirmationRequired) setNotice('Check your email to confirm the account, then sign in.')
      }
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  async function guest() {
    setBusy(true)
    setError('')
    try {
      await gateway.signInAsGuest(generatedCrewmateName())
    } catch (caught) {
      setError(readableError(caught))
      setBusy(false)
    }
  }

  return <main className="auth-view"><section className="auth-panel panel"><p className="eyebrow">// SECURE CREW ACCESS</p><h1>{mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}</h1><p>Connect to persistent private rooms, synchronized mission timers, and crew comms.</p><div className="segmented"><button type="button" className={mode === 'signin' ? 'selected' : ''} onClick={() => setMode('signin')}>SIGN IN</button><button type="button" className={mode === 'signup' ? 'selected' : ''} onClick={() => setMode('signup')}>SIGN UP</button></div><form className="simple-form" onSubmit={submit}><label>EMAIL<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>PASSWORD<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={6} required /></label>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="success-note" role="status">{notice}</p>}<button className="primary auth-submit" disabled={busy}>{busy ? 'CONNECTING…' : mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'} →</button></form><div className="auth-divider"><span>OR</span></div><button className="secondary guest-button" disabled={busy} onClick={guest}>CONTINUE AS TEMPORARY CREWMATE</button><p className="modal-note">Guest sessions can join guest-enabled rooms and create personal timers. They cannot create rooms or shared timers.</p></section></main>
}
