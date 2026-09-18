export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type IdentityKind = 'anonymous' | 'permanent'
export type RoomRole = 'owner' | 'moderator' | 'member' | 'guest'
export type AdmissionPolicy = 'invite_only' | 'approval_required'
export type GuestPolicy = 'allow_guests' | 'accounts_only'
export type TimerScope = 'personal' | 'shared'
export type TimerControlPolicy = 'creator_only' | 'all_assigned'
export type TimerState = 'idle' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled'

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type ProfileRow = { id: string; handle: string; display_name: string | null; identity_kind: IdentityKind; created_at: string; updated_at: string }
export type RoomRow = { id: string; owner_id: string; name: string; admission_policy: AdmissionPolicy; guest_policy: GuestPolicy; capacity: number; moderators_can_control_timers: boolean; created_at: string; updated_at: string }
export type MembershipRow = { room_id: string; user_id: string; role: RoomRole; room_nickname: string | null; succession_rank: number; joined_at: string; updated_at: string }
export type InviteRow = { id: string; room_id: string; code: string; created_by: string; granted_to: string | null; max_uses: number; use_count: number; expires_at: string | null; revoked_at: string | null; created_at: string }
export type CountdownRow = { id: string; scope: TimerScope; room_id: string; owner_user_id: string | null; creator_id: string; name: string; duration_seconds: number; color: string; control_policy: TimerControlPolicy; state: TimerState; scheduled_start_at: string | null; started_at: string | null; ends_at: string | null; paused_remaining_seconds: number | null; created_at: string; updated_at: string }
export type ParticipantRow = { countdown_id: string; user_id: string; assigned_by: string; created_at: string }
export type ActivityRow = { id: number; room_id: string | null; actor_id: string | null; event_type: string; subject_type: string | null; subject_id: string | null; details: Json; created_at: string }
export type MessageRow = { id: string; room_id: string; author_id: string | null; reply_to_id: string | null; content: string | null; edited_at: string | null; deleted_at: string | null; deleted_by: string | null; created_at: string; updated_at: string }

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>
      rooms: Table<RoomRow>
      room_memberships: Table<MembershipRow>
      room_invites: Table<InviteRow>
      countdowns: Table<CountdownRow>
      countdown_participants: Table<ParticipantRow>
      activity_events: Table<ActivityRow>
      messages: Table<MessageRow>
    }
    Views: Record<string, never>
    Functions: {
      server_time: { Args: Record<string, never>; Returns: string }
      create_room: { Args: { room_name: string; room_admission_policy?: AdmissionPolicy; room_guest_policy?: GuestPolicy; room_capacity?: number; allow_moderator_timer_control?: boolean }; Returns: RoomRow }
      create_room_with_invite: { Args: { room_name: string; room_admission_policy?: AdmissionPolicy; room_guest_policy?: GuestPolicy; room_capacity?: number; allow_moderator_timer_control?: boolean }; Returns: Json }
      create_room_invite: { Args: { target_room_id: string; invite_code: string; invite_granted_to?: string | null; invite_max_uses?: number; invite_expires_at?: string | null }; Returns: InviteRow }
      redeem_room_invite: { Args: { invite_code: string; nickname?: string | null }; Returns: MembershipRow }
      request_room_join_with_invite: { Args: { invite_code: string; nickname?: string | null }; Returns: { id: string; status: string } }
      create_countdown: { Args: { target_scope: TimerScope; countdown_name: string; seconds: number; target_room_id: string; policy?: TimerControlPolicy; participant_ids?: string[]; scheduled_for?: string | null; countdown_color?: string }; Returns: CountdownRow }
      create_and_start_countdown: { Args: { target_scope: TimerScope; countdown_name: string; seconds: number; target_room_id: string; policy?: TimerControlPolicy; participant_ids?: string[]; countdown_color?: string }; Returns: CountdownRow }
      update_countdown: { Args: { target_countdown_id: string; target_scope: TimerScope; countdown_name: string; seconds: number; countdown_color: string; policy: TimerControlPolicy; participant_ids: string[]; scheduled_for: string | null; start_immediately: boolean }; Returns: CountdownRow }
      control_countdown: { Args: { target_countdown_id: string; action: string }; Returns: CountdownRow }
      finalize_elapsed_countdowns: { Args: { target_room_id: string }; Returns: number }
      leave_room: { Args: { target_room_id: string }; Returns: undefined }
      can_control_countdown: { Args: { target_countdown_id: string; target_user_id?: string }; Returns: boolean }
      can_edit_countdown: { Args: { target_countdown_id: string; target_user_id?: string }; Returns: boolean }
      send_room_message: { Args: { target_room_id: string; message_content: string; reply_to?: string | null }; Returns: MessageRow }
    }
    Enums: {
      identity_kind: IdentityKind
      room_role: RoomRole
      admission_policy: AdmissionPolicy
      guest_policy: GuestPolicy
      timer_scope: TimerScope
      timer_control_policy: TimerControlPolicy
      timer_state: TimerState
    }
    CompositeTypes: Record<string, never>
  }
}
