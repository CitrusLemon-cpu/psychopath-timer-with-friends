import type { AppState } from './types'

const now = Date.now()

export const demoState: AppState = {
  currentUserId: 'crew-ripley',
  activeRoomId: null,
  rooms: [
    {
      id: 'room-nostromo',
      code: 'N7X-426',
      name: 'USCSS NOSTROMO',
      deck: 'DECK 04 / NIGHT SHIFT',
      lastVisitedAt: now,
      crew: [
        { id: 'crew-ripley', name: 'Ellen Ripley', role: 'WARRANT OFFICER', online: true, initials: 'ER' },
        { id: 'crew-parker', name: 'Dennis Parker', role: 'CHIEF ENGINEER', online: true, initials: 'DP' },
        { id: 'crew-lambert', name: 'Joan Lambert', role: 'NAVIGATOR', online: true, initials: 'JL' },
        { id: 'crew-dallas', name: 'Arthur Dallas', role: 'CAPTAIN', online: false, initials: 'AD' },
        { id: 'crew-kane', name: 'Thomas Kane', role: 'EXECUTIVE OFFICER', online: false, initials: 'TK' },
      ],
      timers: [
        { id: 'timer-shift', name: 'SURVIVE THE SHIFT', startAt: now - 28 * 60_000, endAt: now + 92 * 60_000, color: '#54d6d2', type: 'shared', assigneeIds: ['crew-ripley', 'crew-parker', 'crew-lambert'], pausedAt: null, createdBy: 'crew-ripley' },
        { id: 'timer-coolant', name: 'COOLANT CYCLE', startAt: now + 22 * 60_000, endAt: now + 82 * 60_000, color: '#a78bfa', type: 'shared', assigneeIds: ['crew-parker'], pausedAt: null, createdBy: 'crew-parker' },
        { id: 'timer-report', name: 'MISSION REPORT', startAt: now - 10 * 60_000, endAt: now + 35 * 60_000, color: '#f0c86b', type: 'personal', assigneeIds: ['crew-ripley'], pausedAt: now - 3 * 60_000, createdBy: 'crew-ripley' },
      ],
      activity: [],
      chat: [
        { id: 'msg-1', senderId: 'crew-parker', text: 'Coolant cycle is queued. Systems nominal.', sentAt: now - 12 * 60_000 },
        { id: 'msg-2', senderId: 'crew-ripley', text: 'Copy. Keep the channel open.', sentAt: now - 9 * 60_000 },
      ],
    },
    {
      id: 'room-sulaco',
      code: 'LV4-269',
      name: 'USS SULACO',
      deck: 'FLIGHT OPERATIONS',
      lastVisitedAt: now - 86_400_000,
      crew: [
        { id: 'crew-ripley', name: 'Ellen Ripley', role: 'ADVISOR', online: true, initials: 'ER' },
        { id: 'crew-hicks', name: 'Dwayne Hicks', role: 'CORPORAL', online: false, initials: 'DH' },
      ],
      timers: [],
      activity: [],
      chat: [],
    },
  ],
}
