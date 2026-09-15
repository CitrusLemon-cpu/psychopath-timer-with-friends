export type TimerType = 'personal' | 'shared'
export type TimerFilter = 'all' | 'mine' | 'shared' | 'standby' | 'paused'

export interface CrewMember {
  id: string
  name: string
  role: string
  online: boolean
  initials: string
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
}

export interface ActivityItem {
  id: string
  timer: MissionTimer
  completedAt: number
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
}

export interface AppState {
  rooms: Room[]
  activeRoomId: string | null
  currentUserId: string
}
