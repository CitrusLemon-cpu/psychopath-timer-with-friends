import type { Room } from './types'

export const guestPersonalRoomStorageKey = 'psychopath-timer-guest-personal-room-v1'

export function personalRoomName(displayName: string | null | undefined, handle?: string) {
  const identity = displayName?.trim() || (handle ? `@${handle}` : 'User')
  return `${identity}${identity.toLowerCase().endsWith('s') ? '’' : '’s'} Room`
}

export function createBrowserPersonalRoom(userId: string, displayName?: string | null, handle?: string, stored?: Partial<Room>): Room {
  const name = displayName?.trim() || (handle ? `@${handle}` : 'Temporary Crewmate')
  return {
    ...stored,
    id: 'browser-personal-room',
    code: 'PERSONAL',
    name: personalRoomName(displayName, handle),
    deck: 'PRIVATE · SAVED IN THIS BROWSER',
    lastVisitedAt: stored?.lastVisitedAt ?? Date.now(),
    timers: (stored?.timers ?? []).map((timer) => ({ ...timer, type: 'personal', assigneeIds: [userId], createdBy: userId, canControl: true, canEdit: true })),
    activity: stored?.activity ?? [],
    chat: (stored?.chat ?? []).map((entry) => ({ ...entry, senderId: userId })),
    crew: [{ id: userId, name, handle, role: 'OWNER', online: true, initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() }],
    role: 'owner',
    canCreateSharedTimers: false,
    isPersonal: true,
    browserLocal: true,
  }
}

export function loadGuestPersonalRoom(userId: string, displayName?: string | null, handle?: string) {
  try {
    const saved = localStorage.getItem(guestPersonalRoomStorageKey)
    return createBrowserPersonalRoom(userId, displayName, handle, saved ? JSON.parse(saved) as Partial<Room> : undefined)
  } catch {
    return createBrowserPersonalRoom(userId, displayName, handle)
  }
}

export function saveGuestPersonalRoom(room: Room) {
  localStorage.setItem(guestPersonalRoomStorageKey, JSON.stringify(room))
}
