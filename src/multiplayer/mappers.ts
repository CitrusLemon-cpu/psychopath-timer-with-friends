import type { ActivityRow, CountdownRow, MembershipRow, MessageRow, ParticipantRow, ProfileRow, RoomRow } from '../supabase/database.types'
import type { ActivityItem, ChatMessage, CrewMember, MissionTimer, Room, UserProfile } from '../types'

export function mapProfile(row: ProfileRow): UserProfile {
  return { id: row.id, handle: row.handle, displayName: row.display_name, identityKind: row.identity_kind }
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function personalRoomName(profile?: ProfileRow) {
  const identity = profile?.display_name || `@${profile?.handle ?? 'user'}`
  return `${identity}${identity.toLowerCase().endsWith('s') ? '’' : '’s'} Room`
}

export function mapRoomData(input: {
  room: RoomRow
  membership: MembershipRow
  memberships: MembershipRow[]
  profiles: ProfileRow[]
  countdowns: CountdownRow[]
  participants: ParticipantRow[]
  messages: MessageRow[]
  activity: ActivityRow[]
  currentUserId: string
  inviteCode?: string
  onlineUserIds?: Set<string>
}): Room {
  const profiles = new Map(input.profiles.map((profile) => [profile.id, profile]))
  const visibleMemberships = input.memberships.filter((membership) => {
    const profile = profiles.get(membership.user_id)
    return profile?.identity_kind !== 'anonymous'
      || membership.user_id === input.currentUserId
      || input.onlineUserIds === undefined
      || input.onlineUserIds.has(membership.user_id)
  })
  const crew: CrewMember[] = visibleMemberships.map((membership) => {
    const profile = profiles.get(membership.user_id)
    const name = membership.room_nickname || profile?.display_name || (profile?.identity_kind === 'anonymous' ? 'Temporary Crewmate' : `@${profile?.handle ?? 'crew'}`)
    return {
      id: membership.user_id,
      name,
      handle: profile?.handle,
      role: membership.role.replace('_', ' ').toUpperCase(),
      online: input.onlineUserIds?.has(membership.user_id) ?? membership.user_id === input.currentUserId,
      initials: initials(name),
    }
  })
  const participantMap = new Map<string, string[]>()
  input.participants.forEach((participant) => participantMap.set(participant.countdown_id, [...(participantMap.get(participant.countdown_id) ?? []), participant.user_id]))
  const timers: MissionTimer[] = input.countdowns.filter((row) => row.state !== 'cancelled').map((row) => {
    const scheduledAt = row.scheduled_start_at ? Date.parse(row.scheduled_start_at) : null
    const startedAt = row.started_at ? Date.parse(row.started_at) : null
    const endsAt = row.ends_at ? Date.parse(row.ends_at) : null
    const pausedRemaining = (row.paused_remaining_seconds ?? row.duration_seconds) * 1000
    const updatedAt = Date.parse(row.updated_at)
    const referenceEnd = row.state === 'completed' ? updatedAt : endsAt ?? updatedAt + pausedRemaining
    const referenceStart = scheduledAt ?? startedAt ?? referenceEnd - row.duration_seconds * 1000
    const assigned = row.scope === 'personal' ? [row.owner_user_id!].filter(Boolean) : participantMap.get(row.id) ?? []
    const canControl = row.scope === 'personal'
      ? row.owner_user_id === input.currentUserId
      : row.creator_id === input.currentUserId
        || (row.control_policy === 'all_assigned' && assigned.includes(input.currentUserId))
        || (input.room.moderators_can_control_timers && ['owner', 'moderator'].includes(input.membership.role))
    const canEdit = row.creator_id === input.currentUserId || (row.scope === 'shared' && assigned.includes(input.currentUserId))
    return {
      id: row.id,
      name: row.name,
      startAt: referenceStart,
      endAt: referenceEnd,
      color: row.color,
      type: row.scope,
      assigneeIds: assigned,
      pausedAt: row.state === 'paused' ? Date.parse(row.updated_at) : null,
      createdBy: row.creator_id,
      durationSeconds: row.duration_seconds,
      fixedEnd: row.fixed_end,
      controlPolicy: row.control_policy,
      databaseState: row.state,
      canControl,
      canEdit,
    }
  })
  const timerMap = new Map(timers.map((timer) => [timer.id, timer]))
  const activity: ActivityItem[] = input.activity.map((row) => ({
    id: String(row.id),
    label: row.event_type.replaceAll('_', ' ').toUpperCase(),
    detail: row.subject_type ? row.subject_type.toUpperCase() : 'ROOM EVENT',
    occurredAt: Date.parse(row.created_at),
    timer: row.subject_id ? timerMap.get(row.subject_id) : undefined,
  }))
  const chat: ChatMessage[] = input.messages.filter((row) => row.deleted_at === null && row.content).map((row) => ({ id: row.id, senderId: row.author_id ?? '', text: row.content!, sentAt: Date.parse(row.created_at) }))
  return {
    id: input.room.id,
    code: input.inviteCode ?? 'PRIVATE',
    inviteCode: input.inviteCode,
    name: input.room.is_personal ? personalRoomName(profiles.get(input.room.owner_id)) : input.room.name,
    deck: input.room.is_personal ? 'PRIVATE PERSONAL WORKSPACE' : `${input.memberships.length}/${input.room.capacity} CREW · ${input.room.admission_policy.replace('_', ' ').toUpperCase()}`,
    crew,
    timers,
    activity,
    chat,
    lastVisitedAt: Date.parse(input.membership.updated_at),
    role: input.membership.role,
    canCreateSharedTimers: !input.room.is_personal && profiles.get(input.currentUserId)?.identity_kind === 'permanent',
    isPersonal: input.room.is_personal,
  }
}
