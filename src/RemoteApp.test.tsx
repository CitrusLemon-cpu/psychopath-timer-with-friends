import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { AuthSnapshot, MultiplayerGateway, RoomRefreshKind } from './multiplayer/gateway'
import type { Room, UserProfile } from './types'

const user = { id: 'user-1', email: 'owner@example.test', isAnonymous: false }
const profile: UserProfile = { id: user.id, handle: 'ripley', displayName: 'Ellen Ripley', identityKind: 'permanent' }
const room: Room = {
  id: 'room-1', code: 'CREWCODE1', inviteCode: 'CREWCODE1', name: 'USCSS NOSTROMO', deck: '1/10 CREW · INVITE ONLY', lastVisitedAt: Date.now(), role: 'owner', canCreateSharedTimers: true,
  crew: [{ id: user.id, name: 'Ellen Ripley', handle: 'ripley', role: 'OWNER', online: true, initials: 'ER' }],
  timers: [{ id: 'timer-1', name: 'AIRLOCK CYCLE', startAt: Date.now() - 1_000, endAt: Date.now() + 60_000, color: '#54d6d2', type: 'shared', assigneeIds: [user.id], pausedAt: null, createdBy: user.id, durationSeconds: 60, controlPolicy: 'all_assigned', databaseState: 'running', canControl: true, canEdit: true }],
  activity: [], chat: [],
}

function gateway(overrides: Partial<MultiplayerGateway> = {}) {
  const base: MultiplayerGateway = {
    getAuth: vi.fn(async (): Promise<AuthSnapshot> => ({ user })),
    onAuthChange: vi.fn(() => () => undefined),
    signIn: vi.fn(async () => undefined),
    signUp: vi.fn(async () => ({ confirmationRequired: false })),
    signInAsGuest: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    getProfile: vi.fn(async () => profile),
    updateProfile: vi.fn(async (_id, handle, displayName) => ({ ...profile, handle, displayName })),
    loadRooms: vi.fn(async () => [room]),
    loadRoom: vi.fn(async () => ({ room, serverNow: Date.now() })),
    createRoom: vi.fn(async () => ({ roomId: room.id, inviteCode: room.code })),
    joinRoom: vi.fn(async () => ({ status: 'joined' as const, roomId: room.id })),
    createCountdown: vi.fn(async () => undefined),
    updateCountdown: vi.fn(async () => undefined),
    controlCountdown: vi.fn(async () => undefined),
    finalizeElapsedCountdowns: vi.fn(async () => 0),
    sendMessage: vi.fn(async () => undefined),
    subscribeToRoom: vi.fn(async () => ({ unsubscribe: async () => undefined })),
  }
  return Object.assign(base, overrides)
}

beforeEach(() => localStorage.clear())

describe('Supabase mode', () => {
  it('gates room access behind authentication and sends readable sign-in input', async () => {
    const remote = gateway({ getAuth: vi.fn(async () => ({ user: null })) })
    const actor = userEvent.setup()
    render(<App gateway={remote} />)
    await actor.type(await screen.findByLabelText('EMAIL'), 'crew@example.test')
    await actor.type(screen.getByLabelText('PASSWORD'), 'SeCrEt12')
    await actor.click(screen.getByRole('button', { name: /SIGN IN →/ }))
    expect(remote.signIn).toHaveBeenCalledWith('crew@example.test', 'SeCrEt12')
    expect(screen.getByLabelText('PASSWORD')).toHaveClass('password-input')
    expect(screen.queryByRole('button', { name: '+ CREATE ROOM' })).not.toBeInTheDocument()
  })

  it('requires a completed permanent profile and hides room creation from guests', async () => {
    const incomplete = gateway({ getProfile: vi.fn(async () => ({ ...profile, handle: 'user_0123456789abcdef012', displayName: null })) })
    const { unmount } = render(<App gateway={incomplete} />)
    expect(await screen.findByRole('heading', { name: 'CREATE PROFILE' })).toBeInTheDocument()
    unmount()
    const guestUser = { ...user, isAnonymous: true, email: null }
    const guest = gateway({ getAuth: vi.fn(async () => ({ user: guestUser })), getProfile: vi.fn(async (): Promise<UserProfile> => ({ ...profile, identityKind: 'anonymous', displayName: 'Calm Pilot 014' })) })
    render(<App gateway={guest} />)
    expect(await screen.findByText(/GUEST SESSION/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ CREATE ROOM' })).not.toBeInTheDocument()
  })

  it('creates rooms and safely surfaces approval-request joins', async () => {
    const remote = gateway({ joinRoom: vi.fn(async () => ({ status: 'pending' as const })) })
    const actor = userEvent.setup()
    render(<App gateway={remote} />)
    await actor.click(await screen.findByRole('button', { name: '+ CREATE ROOM' }))
    await actor.type(screen.getByLabelText('ROOM NAME'), 'Hadley Hope')
    await actor.click(screen.getByRole('button', { name: /CREATE ROOM →/ }))
    await waitFor(() => expect(remote.createRoom).toHaveBeenCalledWith('Hadley Hope'))
    await actor.click(screen.getByRole('button', { name: /ALL ROOMS/ }))
    await actor.click(await screen.findByRole('button', { name: 'JOIN WITH CODE' }))
    await actor.type(screen.getByLabelText('ROOM CODE'), 'crew-code-1')
    await actor.click(screen.getByRole('button', { name: /JOIN ROOM →/ }))
    expect(remote.joinRoom).toHaveBeenCalledWith('CREW-CODE-1', undefined)
    expect(await screen.findByRole('status')).toHaveTextContent(/join request transmitted/i)
  })

  it('maps timer creation and permission-aware controls to gateway operations', async () => {
    const remote = gateway()
    const actor = userEvent.setup()
    render(<App gateway={remote} />)
    await actor.click(await screen.findByRole('button', { name: /USCSS NOSTROMO/i }))
    await actor.click(screen.getByRole('button', { name: 'Ⅱ PAUSE' }))
    await waitFor(() => expect(remote.controlCountdown).toHaveBeenCalledWith('timer-1', 'pause'))
    await actor.click(screen.getByRole('button', { name: '+ NEW COUNTDOWN' }))
    await actor.type(screen.getByPlaceholderText('e.g. Survive the shift'), 'Reactor check')
    await actor.click(screen.getByRole('button', { name: /DEPLOY TIMER →/ }))
    await waitFor(() => expect(remote.createCountdown).toHaveBeenCalledWith(expect.objectContaining({ roomId: room.id, name: 'Reactor check', scope: 'shared', color: '#54d6d2', participantIds: [user.id], controlPolicy: 'creator_only', startImmediately: true })))
  })

  it('updates an editable remote timer instead of creating a duplicate', async () => {
    const remote = gateway()
    const actor = userEvent.setup()
    render(<App gateway={remote} />)
    await actor.click(await screen.findByRole('button', { name: /USCSS NOSTROMO/i }))
    await actor.click(screen.getByRole('button', { name: 'EDIT' }))
    const name = screen.getByPlaceholderText('e.g. Survive the shift')
    await actor.clear(name)
    await actor.type(name, 'Updated airlock')
    await actor.click(screen.getByRole('button', { name: /SAVE CHANGES →/ }))
    await waitFor(() => expect(remote.updateCountdown).toHaveBeenCalledWith('timer-1', expect.objectContaining({ name: 'Updated airlock', scope: 'shared' })))
    expect(remote.createCountdown).not.toHaveBeenCalled()
  })

  it('keeps an established handle disabled while editing a profile', async () => {
    const remote = gateway()
    const actor = userEvent.setup()
    render(<App gateway={remote} />)
    await actor.click(await screen.findByRole('button', { name: 'PROFILE' }))
    expect(screen.getByLabelText('HANDLE')).toBeDisabled()
    expect(screen.getByText(/handle is permanent/i)).toBeInTheDocument()
  })

  it('re-fetches authoritative room data after realtime changes', async () => {
    let notify: ((kind: RoomRefreshKind, users?: Set<string>) => void) | undefined
    const updated = { ...room, chat: [{ id: 'message-1', senderId: user.id, text: 'Systems synchronized.', sentAt: Date.now() }] }
    const remote = gateway({
      subscribeToRoom: vi.fn(async (_roomId, _user, callback) => { notify = callback; return { unsubscribe: async () => undefined } }),
      loadRoom: vi.fn().mockResolvedValue({ room: updated, serverNow: Date.now() }),
    })
    const actor = userEvent.setup()
    render(<App gateway={remote} />)
    await actor.click(await screen.findByRole('button', { name: /USCSS NOSTROMO/i }))
    await waitFor(() => expect(remote.subscribeToRoom).toHaveBeenCalled())
    notify?.('message')
    expect(await screen.findByText('Systems synchronized.')).toBeInTheDocument()
    expect(remote.loadRoom).toHaveBeenCalledTimes(1)
  })

  it('clears room, profile, presence subscription state before rendering a new identity', async () => {
    let authChange: ((snapshot: AuthSnapshot) => void) | undefined
    const unsubscribeRoom = vi.fn(async () => undefined)
    const nextProfile = new Promise<UserProfile>(() => undefined)
    const remote = gateway({
      onAuthChange: vi.fn((callback) => { authChange = callback; return () => undefined }),
      getProfile: vi.fn().mockResolvedValueOnce(profile).mockReturnValueOnce(nextProfile),
      subscribeToRoom: vi.fn(async () => ({ unsubscribe: unsubscribeRoom })),
    })
    const actor = userEvent.setup()
    render(<App gateway={remote} />)
    await actor.click(await screen.findByRole('button', { name: /USCSS NOSTROMO/i }))
    expect(await screen.findByRole('heading', { name: 'USCSS NOSTROMO' })).toBeInTheDocument()
    await waitFor(() => expect(remote.subscribeToRoom).toHaveBeenCalled())
    await act(async () => authChange?.({ user: { id: 'user-2', email: 'other@example.test', isAnonymous: false } }))
    expect(screen.queryByText('USCSS NOSTROMO')).not.toBeInTheDocument()
    expect(screen.getByText('LOADING CREW PROFILE')).toBeInTheDocument()
    expect(unsubscribeRoom).toHaveBeenCalled()
  })
})
