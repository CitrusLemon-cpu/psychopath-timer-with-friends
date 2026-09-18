import type { RealtimeChannel, SupabaseClient, User } from '@supabase/supabase-js'
import type { AuthSnapshot, AuthUser, CountdownInput, JoinResult, MultiplayerGateway, RoomRefreshKind, RoomSubscription } from '../multiplayer/gateway'
import { mapProfile, mapRoomData } from '../multiplayer/mappers'
import type { Room, UserProfile } from '../types'
import type { Database, InviteRow, MembershipRow } from './database.types'

function authUser(user: User | null): AuthUser | null {
  if (!user) return null
  return { id: user.id, email: user.email ?? null, isAnonymous: user.is_anonymous === true }
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export class SupabaseGateway implements MultiplayerGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getAuth(): Promise<AuthSnapshot> {
    const { data, error } = await this.client.auth.getSession()
    throwIfError(error)
    return { user: authUser(data.session?.user ?? null) }
  }

  onAuthChange(callback: (snapshot: AuthSnapshot) => void) {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => callback({ user: authUser(session?.user ?? null) }))
    return () => data.subscription.unsubscribe()
  }

  async signIn(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email, password })
    throwIfError(error)
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.client.auth.signUp({ email, password })
    throwIfError(error)
    return { confirmationRequired: !data.session }
  }

  async signInAsGuest(displayName: string) {
    const { error } = await this.client.auth.signInAnonymously({ options: { data: { display_name: displayName } } })
    throwIfError(error)
  }

  async signOut() {
    const { data, error: userError } = await this.client.auth.getUser()
    let cleanupError: Error | null = userError ? new Error(userError.message) : null
    if (!userError && data.user?.is_anonymous) {
      const memberships = await this.client.from('room_memberships').select('room_id').eq('user_id', data.user.id)
      if (memberships.error) cleanupError = new Error(memberships.error.message)
      else {
        for (const membership of memberships.data ?? []) {
          const result = await this.client.rpc('leave_room', { target_room_id: membership.room_id })
          if (result.error && !cleanupError) cleanupError = new Error(result.error.message)
        }
      }
    }
    const { error } = await this.client.auth.signOut()
    throwIfError(error)
    if (cleanupError) throw cleanupError
  }

  async getProfile(userId: string): Promise<UserProfile> {
    const { data, error } = await this.client.from('profiles').select('*').eq('id', userId).single()
    throwIfError(error)
    if (!data) throw new Error('Crew profile was not found.')
    return mapProfile(data)
  }

  async updateProfile(userId: string, handle: string, displayName: string): Promise<UserProfile> {
    const { data, error } = await this.client.from('profiles').update({ handle: handle.toLowerCase(), display_name: displayName }).eq('id', userId).select('*').single()
    throwIfError(error)
    if (!data) throw new Error('Crew profile could not be updated.')
    return mapProfile(data)
  }

  async loadRooms(userId: string): Promise<Room[]> {
    const { data, error } = await this.client.from('room_memberships').select('*').eq('user_id', userId).order('updated_at', { ascending: false })
    throwIfError(error)
    if (!data) return []
    return Promise.all(data.map(async (membership) => (await this.loadRoom(membership.room_id, userId)).room))
  }

  async loadRoom(roomId: string, userId: string, onlineUserIds?: Set<string>) {
    await this.finalizeElapsedCountdowns(roomId)
    const [roomResult, membershipResult, membershipsResult, countdownsResult, messagesResult, activityResult, timeResult] = await Promise.all([
      this.client.from('rooms').select('*').eq('id', roomId).single(),
      this.client.from('room_memberships').select('*').eq('room_id', roomId).eq('user_id', userId).single(),
      this.client.from('room_memberships').select('*').eq('room_id', roomId).order('joined_at'),
      this.client.from('countdowns').select('*').eq('room_id', roomId).order('updated_at', { ascending: false }),
      this.client.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true }).limit(100),
      this.client.from('activity_events').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(25),
      this.client.rpc('server_time'),
    ])
    ;[roomResult, membershipResult, membershipsResult, countdownsResult, messagesResult, activityResult, timeResult].forEach((result) => throwIfError(result.error))
    const memberships = membershipsResult.data!
    const userIds = memberships.map((membership) => membership.user_id)
    const countdownIds = countdownsResult.data!.map((countdown) => countdown.id)
    const participantsResult = countdownIds.length
      ? await this.client.from('countdown_participants').select('*').in('countdown_id', countdownIds)
      : { data: [], error: null }
    throwIfError(participantsResult.error)
    const { data: profiles, error: profilesError } = await this.client.from('profiles').select('*').in('id', userIds)
    throwIfError(profilesError)
    let invite: InviteRow | undefined
    if (['owner', 'moderator'].includes(membershipResult.data!.role)) {
      const { data, error } = await this.client.from('room_invites').select('*').eq('room_id', roomId).is('revoked_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
      throwIfError(error)
      invite = data ?? undefined
    }
    return {
      room: mapRoomData({
        room: roomResult.data!,
        membership: membershipResult.data!,
        memberships,
        profiles: profiles!,
        countdowns: countdownsResult.data!,
        participants: participantsResult.data!,
        messages: messagesResult.data!,
        activity: activityResult.data!,
        currentUserId: userId,
        inviteCode: invite?.code,
        onlineUserIds,
      }),
      serverNow: Date.parse(timeResult.data!),
    }
  }

  async createRoom(name: string) {
    const { data, error } = await this.client.rpc('create_room_with_invite', { room_name: name })
    throwIfError(error)
    const result = data as { room_id?: string; invite_code?: string } | null
    if (!result?.room_id || !result.invite_code) throw new Error('Room creation returned an invalid response.')
    return { roomId: result.room_id, inviteCode: result.invite_code }
  }

  async joinRoom(code: string, nickname?: string): Promise<JoinResult> {
    const normalized = code.replace(/[^A-Z0-9]/gi, '').toUpperCase()
    const redeemed = await this.client.rpc('redeem_room_invite', { invite_code: normalized, nickname: nickname || null })
    if (!redeemed.error) return { status: 'joined', roomId: (redeemed.data as MembershipRow).room_id }
    if (!/requires an approved join request/i.test(redeemed.error.message)) throw new Error(redeemed.error.message)
    const requested = await this.client.rpc('request_room_join_with_invite', { invite_code: normalized, nickname: nickname || null })
    throwIfError(requested.error)
    return { status: 'pending' }
  }

  async createCountdown(input: CountdownInput) {
    const parameters = {
      target_scope: input.scope,
      countdown_name: input.name,
      seconds: input.durationSeconds,
      countdown_color: input.color,
      target_room_id: input.roomId,
      policy: input.controlPolicy,
      participant_ids: input.scope === 'shared' ? input.participantIds : [],
    }
    const created = input.startImmediately
      ? await this.client.rpc('create_and_start_countdown', parameters)
      : await this.client.rpc('create_countdown', { ...parameters, scheduled_for: input.scheduledFor })
    throwIfError(created.error)
  }

  async controlCountdown(countdownId: string, action: 'start' | 'pause' | 'complete' | 'cancel' | 'reset') {
    const { error } = await this.client.rpc('control_countdown', { target_countdown_id: countdownId, action })
    throwIfError(error)
  }

  async finalizeElapsedCountdowns(roomId: string) {
    const { data, error } = await this.client.rpc('finalize_elapsed_countdowns', { target_room_id: roomId })
    throwIfError(error)
    return data ?? 0
  }

  async sendMessage(roomId: string, content: string) {
    const { error } = await this.client.rpc('send_room_message', { target_room_id: roomId, message_content: content, reply_to: null })
    throwIfError(error)
  }

  async subscribeToRoom(roomId: string, user: AuthUser, onChange: (kind: RoomRefreshKind, onlineUserIds?: Set<string>) => void): Promise<RoomSubscription> {
    await this.client.realtime.setAuth()
    const channel = this.client.channel(`room:${roomId}`, { config: { private: true, presence: { key: user.id } } })
    const notify = (kind: RoomRefreshKind) => () => onChange(kind)
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_memberships', filter: `room_id=eq.${roomId}` }, notify('membership'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'countdowns', filter: `room_id=eq.${roomId}` }, notify('timer'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, notify('message'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_events', filter: `room_id=eq.${roomId}` }, notify('activity'))
      .on('presence', { event: 'sync' }, () => onChange('presence', this.onlineUsers(channel)))
    await new Promise<void>((resolve, reject) => {
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: user.id, online_at: new Date().toISOString() })
          onChange('presence', this.onlineUsers(channel))
          resolve()
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('Realtime room link could not be established.'))
      })
    })
    return { unsubscribe: async () => { await this.client.removeChannel(channel) } }
  }

  private onlineUsers(channel: RealtimeChannel) {
    return new Set(Object.values(channel.presenceState()).flat().map((presence) => String((presence as unknown as { user_id?: string }).user_id ?? '')).filter(Boolean))
  }
}
