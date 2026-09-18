import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { Database, MembershipRow, RoomRow } from './database.types'
import { SupabaseGateway } from './gateway'

const createdRoom: RoomRow = { id: 'room-1', owner_id: 'user-1', name: 'Test Room', admission_policy: 'invite_only', guest_policy: 'allow_guests', capacity: 10, moderators_can_control_timers: false, is_personal: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
const membership: MembershipRow = { room_id: createdRoom.id, user_id: 'user-2', role: 'member', room_nickname: null, succession_rank: 2, joined_at: new Date().toISOString(), updated_at: new Date().toISOString() }

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>
}

describe('SupabaseGateway RPC boundary', () => {
  it('idempotently provisions the account personal room', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: createdRoom, error: null })
    await new SupabaseGateway(clientWithRpc(rpc)).ensurePersonalRoom()
    expect(rpc).toHaveBeenCalledWith('ensure_personal_room')
  })

  it('creates a room and exactly one identity-neutral multi-use invite', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { room_id: createdRoom.id, invite_code: 'CREWCODE1' }, error: null })
    const result = await new SupabaseGateway(clientWithRpc(rpc)).createRoom('Test Room')
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('create_room_with_invite', { room_name: 'Test Room' })
    expect(result).toEqual({ roomId: createdRoom.id, inviteCode: 'CREWCODE1' })
  })

  it('falls back to an approval request only for the policy-specific redeem response', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'this room requires an approved join request' } }).mockResolvedValueOnce({ data: { id: 'request-1', status: 'pending' }, error: null })
    await expect(new SupabaseGateway(clientWithRpc(rpc)).joinRoom('crew-code')).resolves.toEqual({ status: 'pending' })
    expect(rpc).toHaveBeenNthCalledWith(1, 'redeem_room_invite', { invite_code: 'CREWCODE', nickname: null })
    expect(rpc).toHaveBeenNthCalledWith(2, 'request_room_join_with_invite', { invite_code: 'CREWCODE', nickname: null })
  })

  it('returns the joined room without querying private room data by code', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: membership, error: null })
    await expect(new SupabaseGateway(clientWithRpc(rpc)).joinRoom('CREWCODE')).resolves.toEqual({ status: 'joined', roomId: createdRoom.id })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('maps countdown creation and immediate control to the authoritative RPCs', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { id: 'timer-1', state: 'running' }, error: null })
    await new SupabaseGateway(clientWithRpc(rpc)).createCountdown({ roomId: createdRoom.id, name: 'Shared check', scope: 'shared', durationSeconds: 600, fixedEnd: false, color: '#a78bfa', controlPolicy: 'all_assigned', participantIds: ['user-1', 'user-2'], scheduledFor: null, startImmediately: true })
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('create_and_start_countdown_v2', { target_scope: 'shared', countdown_name: 'Shared check', seconds: 600, countdown_color: '#a78bfa', target_room_id: createdRoom.id, policy: 'all_assigned', participant_ids: ['user-1', 'user-2'], fixed_end: false })
  })

  it('updates countdowns through the authorized RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'timer-1' }, error: null })
    await new SupabaseGateway(clientWithRpc(rpc)).updateCountdown('timer-1', { roomId: createdRoom.id, name: 'Updated check', scope: 'shared', durationSeconds: 90, fixedEnd: true, color: '#54d6d2', controlPolicy: 'all_assigned', participantIds: ['user-2'], scheduledFor: null, startImmediately: true })
    expect(rpc).toHaveBeenCalledWith('update_countdown_v2', {
      target_countdown_id: 'timer-1', target_scope: 'shared', countdown_name: 'Updated check', seconds: 90, countdown_color: '#54d6d2', policy: 'all_assigned', participant_ids: ['user-2'], scheduled_for: null, start_immediately: true, fixed_end: true,
    })
  })

  it('leaves every guest membership before signing out', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const query = { select: vi.fn(), eq: vi.fn(), then: (resolve: (value: unknown) => void) => resolve({ data: [{ room_id: 'room-1' }, { room_id: 'room-2' }], error: null }) }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'guest-1', is_anonymous: true } }, error: null }), signOut }, from: vi.fn().mockReturnValue(query), rpc } as unknown as SupabaseClient<Database>
    await new SupabaseGateway(client).signOut()
    expect(rpc.mock.calls).toEqual([
      ['leave_room', { target_room_id: 'room-1' }],
      ['leave_room', { target_room_id: 'room-2' }],
    ])
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('scopes participant reads to countdowns loaded for the room', async () => {
    const timer = { id: 'timer-1', scope: 'shared', room_id: createdRoom.id, owner_user_id: null, creator_id: 'user-1', name: 'Scoped timer', duration_seconds: 60, color: '#a78bfa', fixed_end: false, control_policy: 'creator_only', state: 'running', scheduled_start_at: null, started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 60_000).toISOString(), paused_remaining_seconds: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    const profileRow = { id: 'user-2', handle: 'member', display_name: 'Member', identity_kind: 'permanent', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    const responses: Record<string, unknown[]> = {
      rooms: [{ data: createdRoom, error: null }],
      room_memberships: [{ data: membership, error: null }, { data: [membership], error: null }],
      countdowns: [{ data: [timer], error: null }],
      messages: [{ data: [], error: null }],
      activity_events: [{ data: [], error: null }],
      profiles: [{ data: [profileRow], error: null }],
      countdown_participants: [{ data: [{ countdown_id: timer.id, user_id: 'user-2', assigned_by: 'user-1', created_at: new Date().toISOString() }], error: null }],
    }
    const participantIn = vi.fn()
    const from = vi.fn((table: string) => {
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query, is: () => query,
        single: () => query, maybeSingle: () => query,
        in: (column: string, values: string[]) => { if (table === 'countdown_participants') participantIn(column, values); return query },
        then: (resolve: (value: unknown) => void) => resolve(responses[table].shift()),
      }
      return query
    })
    const rpc = vi.fn((name: string) => Promise.resolve(name === 'server_time' ? { data: new Date().toISOString(), error: null } : { data: 0, error: null }))
    const client = { from, rpc } as unknown as SupabaseClient<Database>
    const loaded = await new SupabaseGateway(client).loadRoom(createdRoom.id, 'user-2')
    expect(participantIn).toHaveBeenCalledOnce()
    expect(participantIn).toHaveBeenCalledWith('countdown_id', ['timer-1'])
    expect(loaded.room.timers[0].color).toBe('#a78bfa')
  })
})
