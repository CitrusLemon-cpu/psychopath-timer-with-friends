import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthView } from './components/AuthView'
import { Dashboard } from './components/Dashboard'
import { ProfileSetup } from './components/ProfileSetup'
import { RoomView } from './components/RoomView'
import { readableError, type AuthUser, type MultiplayerGateway, type RoomSubscription } from './multiplayer/gateway'
import type { ChatMessage, Room, UserProfile } from './types'

interface RemoteAppProps { gateway: MultiplayerGateway }
const initialRemoteNow = Date.now()

function profileComplete(profile: UserProfile) {
  return profile.identityKind === 'anonymous' || (!/^user_[0-9a-f]{19}$/.test(profile.handle) && Boolean(profile.displayName?.trim()))
}

export default function RemoteApp({ gateway }: RemoteAppProps) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [activeRoom, setActiveRoom] = useState<Room | null>(null)
  const [now, setNow] = useState(initialRemoteNow)
  const [clockOffset, setClockOffset] = useState(0)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'degraded'>('connecting')
  const [error, setError] = useState('')
  const [editingProfile, setEditingProfile] = useState(false)
  const onlineUsers = useRef<Set<string> | undefined>(undefined)
  const subscription = useRef<RoomSubscription | null>(null)
  const authIdentity = useRef<string | null>(null)
  const activeRoomId = activeRoom?.id

  const clearUserState = useCallback(() => {
    setProfile(null)
    setRooms([])
    setActiveRoom(null)
    setError('')
    setEditingProfile(false)
    onlineUsers.current = undefined
    const current = subscription.current
    subscription.current = null
    if (current) void current.unsubscribe()
  }, [])

  const loadDashboard = useCallback(async (currentUser: AuthUser) => {
    setRooms(await gateway.loadRooms(currentUser.id))
  }, [gateway])

  const refreshRoom = useCallback(async (roomId: string, currentUser: AuthUser, presence?: Set<string>) => {
    if (presence) onlineUsers.current = presence
    const loaded = await gateway.loadRoom(roomId, currentUser.id, onlineUsers.current)
    setClockOffset(loaded.serverNow - Date.now())
    setActiveRoom((current) => current?.id === roomId ? loaded.room : current)
    setRooms((current) => current.map((room) => room.id === roomId ? loaded.room : room))
  }, [gateway])

  useEffect(() => {
    let active = true
    function acceptAuth(nextUser: AuthUser | null) {
      if (!active) return
      const nextIdentity = nextUser?.id ?? null
      if (authIdentity.current !== nextIdentity) {
        authIdentity.current = nextIdentity
        clearUserState()
      }
      setUser(nextUser)
      setConnection('live')
    }
    gateway.getAuth().then((snapshot) => acceptAuth(snapshot.user)).catch((caught) => { if (active) { clearUserState(); authIdentity.current = null; setError(readableError(caught)); setConnection('degraded'); setUser(null) } })
    const unsubscribe = gateway.onAuthChange((snapshot) => acceptAuth(snapshot.user))
    return () => { active = false; unsubscribe() }
  }, [clearUserState, gateway])

  useEffect(() => {
    if (!user) {
      return
    }
    let active = true
    async function load() {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const [nextProfile, nextRooms] = await Promise.all([gateway.getProfile(user!.id), gateway.loadRooms(user!.id)])
          if (active) { setProfile(nextProfile); setRooms(nextRooms); setConnection('live') }
          return
        } catch (caught) {
          if (!/JWT issued at future/i.test(readableError(caught)) || attempt === 2) throw caught
          await new Promise((resolve) => window.setTimeout(resolve, 1_000))
        }
      }
    }
    load().catch((caught) => { if (active) { setError(readableError(caught)); setConnection('degraded') } })
    return () => { active = false }
  }, [gateway, user])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now() + clockOffset), 1_000)
    return () => window.clearInterval(interval)
  }, [clockOffset])

  useEffect(() => {
    if (!activeRoomId || !user) return
    let disposed = false
    gateway.subscribeToRoom(activeRoomId, user, (_kind, presence) => {
      if (disposed) return
      refreshRoom(activeRoomId, user, presence).catch((caught) => { setError(readableError(caught)); setConnection('degraded') })
    }).then((next) => {
      if (disposed) next.unsubscribe()
      else { subscription.current = next; setConnection('live') }
    }).catch((caught) => { if (!disposed) { setError(readableError(caught)); setConnection('degraded') } })
    return () => {
      disposed = true
      const current = subscription.current
      subscription.current = null
      if (current) void current.unsubscribe()
      onlineUsers.current = undefined
    }
  }, [activeRoomId, gateway, refreshRoom, user])

  useEffect(() => {
    if (!activeRoom || !user) return
    const ends = activeRoom.timers
      .filter((timer) => timer.databaseState === 'running' || timer.databaseState === 'scheduled')
      .map((timer) => timer.endAt)
    if (!ends.length) return
    const delay = Math.max(0, Math.min(...ends) - (Date.now() + clockOffset)) + 250
    const timeout = window.setTimeout(() => {
      gateway.finalizeElapsedCountdowns(activeRoom.id)
        .then(() => refreshRoom(activeRoom.id, user))
        .catch((caught) => setError(readableError(caught)))
    }, Math.min(delay, 2_147_483_647))
    return () => window.clearTimeout(timeout)
  }, [activeRoom, clockOffset, gateway, refreshRoom, user])

  async function perform(action: () => Promise<void>, refresh = true) {
    setError('')
    try {
      await action()
      if (refresh && activeRoom && user) await refreshRoom(activeRoom.id, user)
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  async function signOut() {
    clearUserState()
    authIdentity.current = null
    setUser(null)
    try {
      await gateway.signOut()
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  if (user === undefined) return <div className="loading-screen"><span className="signal"><i /> RESTORING SECURE SESSION</span></div>
  if (!user) return <div className="shell"><RemoteHeader now={now} connection={connection} /><AuthView gateway={gateway} /><RemoteFooter connection={connection} /></div>
  if (!profile) return <div className="loading-screen"><span className="signal"><i /> LOADING CREW PROFILE</span>{error && <p className="form-error">{error}</p>}</div>
  if (!profileComplete(profile)) return <div className="shell"><RemoteHeader now={now} connection={connection} onSignOut={() => void signOut()} /><ProfileSetup gateway={gateway} profile={profile} onSaved={setProfile} /><RemoteFooter connection={connection} /></div>
  if (editingProfile && profile.identityKind === 'permanent') return <div className="shell"><RemoteHeader now={now} connection={connection} onHome={() => setEditingProfile(false)} onSignOut={() => void signOut()} /><ProfileSetup gateway={gateway} profile={profile} onCancel={() => setEditingProfile(false)} onSaved={(next) => { setProfile(next); setEditingProfile(false) }} /><RemoteFooter connection={connection} /></div>

  const displayName = profile.displayName || 'Temporary Crewmate'
  return <div className="shell"><RemoteHeader now={now} connection={connection} onHome={() => setActiveRoom(null)} onEditProfile={profile.identityKind === 'permanent' ? () => setEditingProfile(true) : undefined} onSignOut={() => void signOut()} />{activeRoom ? <RoomView room={activeRoom} currentUserId={user.id} now={now} isRemote connectionLabel={connection === 'live' ? 'LIVE PRIVATE LINK' : 'RECONNECTING'} actionError={error} onBack={() => { setActiveRoom(null); void loadDashboard(user) }} onSaveTimer={(timer) => void perform(async () => {
    const scheduled = timer.startAt > now + 2_000
    const input = { roomId: activeRoom.id, name: timer.name, scope: timer.type, durationSeconds: timer.durationSeconds ?? Math.ceil((timer.endAt - timer.startAt) / 1000), fixedEnd: timer.fixedEnd ?? false, color: timer.color, controlPolicy: timer.controlPolicy ?? 'creator_only', participantIds: timer.type === 'shared' ? timer.assigneeIds : [], scheduledFor: scheduled ? new Date(timer.startAt).toISOString() : null, startImmediately: !scheduled }
    if (activeRoom.timers.some((item) => item.id === timer.id)) await gateway.updateCountdown(timer.id, input)
    else await gateway.createCountdown(input)
  })} onToggleTimer={(id) => void perform(() => {
    const timer = activeRoom.timers.find((item) => item.id === id)
    if (timer?.fixedEnd && timer.databaseState === 'running') return Promise.resolve()
    const action = timer?.databaseState === 'running' || (timer?.databaseState === 'scheduled' && now >= timer.startAt) ? 'pause' : 'start'
    return gateway.controlCountdown(id, action)
  })} onDeleteTimer={(id) => void perform(() => gateway.controlCountdown(id, 'cancel'))} onRunAgain={(id) => void perform(async () => {
    const timer = activeRoom.activity.find((item) => item.id === id)?.timer
    if (!timer) return
    await gateway.createCountdown({ roomId: activeRoom.id, name: timer.name, scope: timer.type, durationSeconds: timer.durationSeconds!, fixedEnd: false, color: timer.color, controlPolicy: timer.controlPolicy ?? 'creator_only', participantIds: timer.assigneeIds, scheduledFor: null, startImmediately: true })
  })} onSendMessage={(message: ChatMessage) => void perform(() => gateway.sendMessage(activeRoom.id, message.text))} /> : <Dashboard rooms={rooms} now={now} displayName={displayName} isGuest={user.isAnonymous} isRemote onOpenRoom={(id) => {
    const room = rooms.find((item) => item.id === id)
    if (room) setActiveRoom(room)
  }} onCreateRoom={async (name) => {
    setConnection('connecting')
    const created = await gateway.createRoom(name)
    await loadDashboard(user)
    const loaded = await gateway.loadRoom(created.roomId, user.id)
    setClockOffset(loaded.serverNow - Date.now())
    setActiveRoom({ ...loaded.room, inviteCode: created.inviteCode, code: created.inviteCode })
  }} onJoinRoom={async (code) => {
    setConnection('connecting')
    const result = await gateway.joinRoom(code, user.isAnonymous ? displayName : undefined)
    if (result.status === 'joined') {
      await loadDashboard(user)
      const loaded = await gateway.loadRoom(result.roomId, user.id)
      setClockOffset(loaded.serverNow - Date.now())
      setActiveRoom(loaded.room)
    }
    return result
  }} /> }<RemoteFooter connection={connection} /></div>
}

function RemoteHeader({ now, connection, onHome, onEditProfile, onSignOut }: { now: number; connection: 'connecting' | 'live' | 'degraded'; onHome?: () => void; onEditProfile?: () => void; onSignOut?: () => void }) {
  return <header className="topbar"><button className="brand" onClick={onHome}><span className="brand-mark">✦</span><span><strong>PSYCHOPATH TIMER</strong><small>SHIPBOARD OPERATIONS CONSOLE</small></span></button><div className="top-meta"><span className={`signal connection-${connection}`}><i /> {connection === 'live' ? 'SUPABASE CONNECTED' : connection === 'degraded' ? 'LINK DEGRADED' : 'CONNECTING'}</span>{onEditProfile && <button className="text-button" onClick={onEditProfile}>PROFILE</button>}{onSignOut && <button className="text-button" onClick={onSignOut}>SIGN OUT</button>}<span>{new Date(now).toLocaleTimeString([], { hour12: false })}</span></div></header>
}

function RemoteFooter({ connection }: { connection: 'connecting' | 'live' | 'degraded' }) {
  return <footer><span>SYS.STATUS: {connection === 'live' ? 'CONNECTED' : connection.toUpperCase()}</span><span>PRIVATE MULTIPLAYER · RLS PROTECTED</span><span>v0.2.0</span></footer>
}
