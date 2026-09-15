export type TimerType = 'personal' | 'shared'
export type TimerFilter = 'all' | 'mine' | 'shared' | 'standby' | 'paused'
export type TimerControlPolicy = 'creator_only' | 'all_assigned'
export type TimerDatabaseState = 'idle' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled'

export interface CrewMember {
  id: string
  name: string
  role: string
  online: boolean
  initials: string
  handle?: string
}

export interface MissionTimer {
  id: string
  name: string
  startAt: number
  endAt: number
  color: string
  type: TimerType
  assigneeIds: string[]
  pausedAt: number | null
  createdBy: string
  durationSeconds?: number
  controlPolicy?: TimerControlPolicy
  databaseState?: TimerDatabaseState
  canControl?: boolean
}

export interface ActivityItem {
  id: string
  label: string
  detail: string
  occurredAt: number
  timer?: MissionTimer
}

export interface ChatMessage {
  id: string
  senderId: string
  text: string
  sentAt: number
}

export interface Room {
  id: string
  code: string
  name: string
  deck: string
  crew: CrewMember[]
  timers: MissionTimer[]
  activity: ActivityItem[]
  chat: ChatMessage[]
  lastVisitedAt: number
  role?: string
  canCreateSharedTimers?: boolean
  inviteCode?: string
}

export interface AppState {
  rooms: Room[]
  activeRoomId: string | null
  currentUserId: string
}

export interface UserProfile {
  id: string
  handle: string
  displayName: string | null
  identityKind: 'anonymous' | 'permanent'
}
