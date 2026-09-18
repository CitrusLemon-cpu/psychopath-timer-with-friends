import { describe, expect, it } from 'vitest'
import type { CountdownRow, MembershipRow, ProfileRow, RoomRow } from '../supabase/database.types'
import { mapRoomData } from './mappers'

const room: RoomRow = { id: 'room-1', owner_id: 'owner-1', name: 'Room', admission_policy: 'invite_only', guest_policy: 'allow_guests', capacity: 10, moderators_can_control_timers: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
const memberships: MembershipRow[] = [
  { room_id: room.id, user_id: 'owner-1', role: 'owner', room_nickname: null, succession_rank: 1, joined_at: room.created_at, updated_at: room.updated_at },
  { room_id: room.id, user_id: 'member-1', role: 'member', room_nickname: null, succession_rank: 2, joined_at: room.created_at, updated_at: room.updated_at },
  { room_id: room.id, user_id: 'guest-1', role: 'guest', room_nickname: null, succession_rank: 3, joined_at: room.created_at, updated_at: room.updated_at },
]
const profiles: ProfileRow[] = [
  { id: 'owner-1', handle: 'owner', display_name: 'Owner', identity_kind: 'permanent', created_at: room.created_at, updated_at: room.updated_at },
  { id: 'member-1', handle: 'member', display_name: 'Member', identity_kind: 'permanent', created_at: room.created_at, updated_at: room.updated_at },
  { id: 'guest-1', handle: 'guest_temp', display_name: 'Guest', identity_kind: 'anonymous', created_at: room.created_at, updated_at: room.updated_at },
]

function mapped(currentUserId: string, onlineUserIds: Set<string>) {
  return mapRoomData({ room, membership: memberships.find((item) => item.user_id === currentUserId)!, memberships, profiles, countdowns: [], participants: [], messages: [], activity: [], currentUserId, onlineUserIds })
}

describe('room crew mapping', () => {
  it('keeps offline account members but removes offline anonymous guests', () => {
    const result = mapped('owner-1', new Set(['owner-1']))
    expect(result.crew.map((member) => member.id)).toEqual(['owner-1', 'member-1'])
    expect(result.crew.find((member) => member.id === 'member-1')?.online).toBe(false)
  })

  it('preserves the current guest and online guests during reconnects', () => {
    expect(mapped('guest-1', new Set()).crew.map((member) => member.id)).toContain('guest-1')
    expect(mapped('owner-1', new Set(['owner-1', 'guest-1'])).crew.map((member) => member.id)).toContain('guest-1')
  })

  it('lets creators and assigned crew edit shared timers', () => {
    const timer: CountdownRow = { id: 'timer-1', scope: 'shared', room_id: room.id, owner_user_id: null, creator_id: 'owner-1', name: 'Shared task', duration_seconds: 60, color: '#54d6d2', fixed_end: false, control_policy: 'creator_only', state: 'idle', scheduled_start_at: null, started_at: null, ends_at: null, paused_remaining_seconds: null, created_at: room.created_at, updated_at: room.updated_at }
    const input = { room, membership: memberships[1], memberships, profiles, countdowns: [timer], participants: [{ countdown_id: timer.id, user_id: 'member-1', assigned_by: 'owner-1', created_at: room.created_at }], messages: [], activity: [], currentUserId: 'member-1' }
    expect(mapRoomData(input).timers[0].canEdit).toBe(true)
    expect(mapRoomData({ ...input, membership: memberships[2], currentUserId: 'guest-1' }).timers[0].canEdit).toBe(false)
  })
})
