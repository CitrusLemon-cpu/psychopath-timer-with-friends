import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthView } from './components/AuthView'
import { Dashboard } from './components/Dashboard'
import { ProfileSetup } from './components/ProfileSetup'
import { RoomView } from './components/RoomView'
import { readableError, type AuthUser, type MultiplayerGateway, type RoomSubscription } from './multiplayer/gateway'
import { createBrowserPersonalRoom, loadGuestPersonalRoom, saveGuestPersonalRoom, sweepCompletedTimers } from './personalRoom'
import { toggleTimer } from './timer'
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
  const browserRoom = useRef<Room | null>(null)
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

  const provisionPersonalRoom = useCallback(async (currentUser: AuthUser) => {
    if (currentUser.isAnonymous) return
    try {
      await gateway.ensurePersonalRoom()
    } catch (caught) {
      setError(readableError(caught))
      setConnection('degraded')
    }
  }, [gateway])

  const loadDashboard = useCallback(async (currentUser: AuthUser) => {
    await provisionPersonalRoom(currentUser)
    const loaded = await gateway.loadRooms(currentUser.id)
    setRooms((current) => currentUser.isAnonymous
      ? [current.find((room) => room.browserLocal) ?? createBrowserPersonalRoom(currentUser.id), ...loaded.filter((room) => !room.isPersonal)]
      : loaded)
  }, [gateway, provisionPersonalRoom])

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
          const nextProfile = await gateway.getProfile(user!.id)
          await provisionPersonalRoom(user!)
          const loadedRooms = await gateway.loadRooms(user!.id)
          const nextRooms = user!.isAnonymous ? [loadGuestPersonalRoom(user!.id, nextProfile.displayName, nextProfile.handle), ...loadedRooms.filter((room) => !room.isPersonal)] : loadedRooms
          if (active) { setProfile(nextProfile); setRooms(nextRooms); setConnection((current) => current === 'degraded' ? current : 'live') }
          return
        } catch (caught) {
          if (!/JWT issued at future/i.test(readableError(caught)) || attempt === 2) throw caught
          await new Promise((resolve) => window.setTimeout(resolve, 1_000))
        }
      }
    }
    load().catch((caught) => { if (active) { setError(readableError(caught)); setConnection('degraded') } })
    return () => { active = false }
  }, [gateway, provisionPersonalRoom, user])

  useEffect(() => {
    browserRoom.current = activeRoom?.browserLocal ? activeRoom : null
  }, [activeRoom])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const tick = Date.now() + clockOffset
      setNow(tick)
      const current = browserRoom.current
      if (!current) return
      const next = sweepCompletedTimers(current, tick)
      if (!next) return
      saveGuestPersonalRoom(next)
      setActiveRoom(next)
      setRooms((rooms) => rooms.map((room) => room.id === next.id ? next : room))
    }, 1_000)
    return () => window.clearInterval(interval)
  }, [clockOffset])

  useEffect(() => {
    if (!activeRoomId || !user || activeRoom?.browserLocal) return
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
  }, [activeRoom?.browserLocal, activeRoomId, gateway, refreshRoom, user])

  useEffect(() => {
    if (!activeRoom || !user || activeRoom.browserLocal) return
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

  function updateBrowserPersonalRoom(updater: (room: Room) => Room) {
    if (!activeRoom?.browserLocal) return
    const next = updater(activeRoom)
    saveGuestPersonalRoom(next)
    setActiveRoom(next)
    setRooms((current) => current.map((room) => room.id === next.id ? next : room))
  }

  function saveTimer(timer: Room['timers'][number]) {
    if (activeRoom?.browserLocal) {
      const browserTimer = { ...timer, type: 'personal' as const, assigneeIds: [user!.id], createdBy: user!.id, canControl: true, canEdit: true }
      updateBrowserPersonalRoom((room) => ({ ...room, timers: room.timers.some((item) => item.id === browserTimer.id) ? room.timers.map((item) => item.id === browserTimer.id ? browserTimer : item) : [browserTimer, ...room.timers] }))
      return
    }
    void perform(async () => {
      if (!activeRoom) return
      const scheduled = timer.startAt > now + 2_000
      const input = { roomId: activeRoom.id, name: timer.name, scope: timer.type, durationSeconds: timer.durationSeconds ?? Math.ceil((timer.endAt - timer.startAt) / 1000), fixedEnd: timer.fixedEnd ?? false, color: timer.color, controlPolicy: timer.controlPolicy ?? 'creator_only', participantIds: timer.type === 'shared' ? timer.assigneeIds : [], scheduledFor: scheduled ? new Date(timer.startAt).toISOString() : null, startImmediately: !scheduled }
      if (activeRoom.timers.some((item) => item.id === timer.id)) await gateway.updateCountdown(timer.id, input)
      else await gateway.createCountdown(input)
    })
  }

  function toggleActiveTimer(id: string) {
    const timer = activeRoom?.timers.find((item) => item.id === id)
    if (!timer || (timer.fixedEnd && (timer.databaseState === 'running' || timer.pausedAt === null && now >= timer.startAt))) return
    if (activeRoom?.browserLocal) {
      updateBrowserPersonalRoom((room) => ({ ...room, timers: room.timers.map((item) => item.id === id ? toggleTimer(item, now) : item) }))
      return
    }
    void perform(() => gateway.controlCountdown(id, timer.databaseState === 'running' || (timer.databaseState === 'scheduled' && now >= timer.startAt) ? 'pause' : 'start'))
  }

  function deleteTimer(id: string) {
    if (activeRoom?.browserLocal) {
      updateBrowserPersonalRoom((room) => ({ ...room, timers: room.timers.filter((timer) => timer.id !== id) }))
      return
    }
    void perform(() => gateway.controlCountdown(id, 'cancel'))
  }

  function runAgain(id: string) {
    const timer = activeRoom?.activity.find((item) => item.id === id)?.timer
    if (!timer || !activeRoom) return
    if (activeRoom.browserLocal) {
      const duration = timer.endAt - timer.startAt
      updateBrowserPersonalRoom((room) => ({ ...room, timers: [{ ...timer, id: crypto.randomUUID(), startAt: now, endAt: now + duration, pausedAt: null, fixedEnd: false }, ...room.timers] }))
      return
    }
    void perform(() => gateway.createCountdown({ roomId: activeRoom.id, name: timer.name, scope: timer.type, durationSeconds: timer.durationSeconds!, fixedEnd: false, color: timer.color, controlPolicy: timer.controlPolicy ?? 'creator_only', participantIds: timer.assigneeIds, scheduledFor: null, startImmediately: true }))
  }

  function sendMessage(message: ChatMessage) {
    if (activeRoom?.browserLocal) {
      updateBrowserPersonalRoom((room) => ({ ...room, chat: [...room.chat, message].slice(-50) }))
      return
    }
    if (activeRoom) void perform(() => gateway.sendMessage(activeRoom.id, message.text))
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
  if (editingProfile && profile.identityKind === 'permanent') return <div className="shell"><RemoteHeader now={now} connection={connection} onHome={() => setEditingProfile(false)} onSignOut={() => void signOut()} /><ProfileSetup gateway={gateway} profile={profile} onCancel={() => setEditingProfile(false)} onSaved={(next) => { setProfile(next); setEditingProfile(false); void loadDashboard(user) }} /><RemoteFooter connection={connection} /></div>

  const displayName = profile.displayName || 'Temporary Crewmate'
  return <div className="shell"><RemoteHeader now={now} connection={connection} onHome={() => setActiveRoom(null)} onEditProfile={profile.identityKind === 'permanent' ? () => setEditingProfile(true) : undefined} onSignOut={() => void signOut()} />{activeRoom ? <RoomView room={activeRoom} currentUserId={user.id} now={now} isRemote connectionLabel={activeRoom.browserLocal ? 'BROWSER ONLY' : connection === 'live' ? 'LIVE PRIVATE LINK' : 'RECONNECTING'} actionError={error} onBack={() => { setActiveRoom(null); void loadDashboard(user) }} onSaveTimer={saveTimer} onToggleTimer={toggleActiveTimer} onDeleteTimer={deleteTimer} onRunAgain={runAgain} onSendMessage={sendMessage} /> : <Dashboard rooms={rooms} now={now} displayName={displayName} isGuest={user.isAnonymous} isRemote loadError={error} onOpenRoom={(id) => {
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
