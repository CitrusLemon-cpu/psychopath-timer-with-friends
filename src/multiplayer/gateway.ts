import type { Room, TimerControlPolicy, TimerType, UserProfile } from '../types'

export interface AuthUser {
  id: string
  email: string | null
  isAnonymous: boolean
}

export interface AuthSnapshot {
  user: AuthUser | null
}

export interface CountdownInput {
  roomId: string
  name: string
  scope: TimerType
  durationSeconds: number
  color: string
  controlPolicy: TimerControlPolicy
  participantIds: string[]
  scheduledFor: string | null
  startImmediately: boolean
}

export type JoinResult = { status: 'joined'; roomId: string } | { status: 'pending' }
export type RoomRefreshKind = 'membership' | 'timer' | 'message' | 'activity' | 'presence'

export interface RoomSubscription {
  unsubscribe: () => Promise<void>
}

export interface MultiplayerGateway {
  getAuth(): Promise<AuthSnapshot>
  onAuthChange(callback: (snapshot: AuthSnapshot) => void): () => void
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<{ confirmationRequired: boolean }>
  signInAsGuest(displayName: string): Promise<void>
  signOut(): Promise<void>
  getProfile(userId: string): Promise<UserProfile>
  updateProfile(userId: string, handle: string, displayName: string): Promise<UserProfile>
  loadRooms(userId: string): Promise<Room[]>
  loadRoom(roomId: string, userId: string, onlineUserIds?: Set<string>): Promise<{ room: Room; serverNow: number }>
  createRoom(name: string): Promise<{ roomId: string; inviteCode: string }>
  joinRoom(code: string, nickname?: string): Promise<JoinResult>
  createCountdown(input: CountdownInput): Promise<void>
  controlCountdown(countdownId: string, action: 'start' | 'pause' | 'complete' | 'cancel' | 'reset'): Promise<void>
  finalizeElapsedCountdowns(roomId: string): Promise<number>
  sendMessage(roomId: string, content: string): Promise<void>
  subscribeToRoom(roomId: string, user: AuthUser, onChange: (kind: RoomRefreshKind, onlineUserIds?: Set<string>) => void): Promise<RoomSubscription>
}

export function generatedCrewmateName() {
  const adjectives = ['Brave', 'Calm', 'Cosmic', 'Swift', 'Steady', 'Bright']
  const roles = ['Navigator', 'Engineer', 'Pilot', 'Scout', 'Operator', 'Specialist']
  const bytes = crypto.getRandomValues(new Uint8Array(3))
  return `${adjectives[bytes[0] % adjectives.length]} ${roles[bytes[1] % roles.length]} ${String(bytes[2]).padStart(3, '0')}`
}

export function readableError(error: unknown) {
  if (!(error instanceof Error)) return 'The operation could not be completed.'
  if (/duplicate key|profiles_handle_unique/i.test(error.message)) return 'That handle is already in use.'
  if (/invalid login credentials/i.test(error.message)) return 'Email or password is incorrect.'
  if (/email not confirmed/i.test(error.message)) return 'Confirm your email before signing in.'
  if (/invite is invalid/i.test(error.message)) return 'That room code is invalid, expired, or fully used.'
  if (/already a room member/i.test(error.message)) return 'You already belong to that room.'
  return error.message.replace(/^.*?error:\s*/i, '')
}
