# Local Supabase backend

This directory contains the version-controlled MVP database foundation. Anonymous sign-in is enabled locally; anonymous users still connect with PostgreSQL's `authenticated` role, and authorization-sensitive functions additionally inspect the JWT `is_anonymous` claim.

## Run locally

Prerequisites are Docker and the Supabase CLI. The commands below use `npx`, so a global CLI installation is optional.

```sh
npx supabase start
npx supabase db reset
npx supabase test db
```

`db reset` recreates the local database and applies every file in `migrations/`. `test db` runs the pgTAP suite in `tests/database/`, including room isolation, anonymous-user restrictions, approval admission, role boundaries, capacity locking, ownership succession, and countdown scheduling/control. Stop the containers without deleting local database state with `npx supabase stop`; add `--no-backup` to discard that state.

The local API, Studio, database, and test-mail URLs are printed by `supabase start`. Local keys printed by the CLI are development credentials generated for the local stack; do not copy them into source control. Put any machine-specific variables in an ignored `.env.local` file.

## Link a future remote development project

Authenticate the CLI interactively or through an uncommitted environment variable, then link by the project's non-secret reference:

```sh
npx supabase login
npx supabase link --project-ref <development-project-ref>
npx supabase db push --dry-run
npx supabase db push
```

Run the dry run first and inspect the migration list. Linking metadata lives under the ignored `supabase/.temp/` directory. Never pass database passwords, access tokens, service-role keys, or generated JWT signing material in a committed command or file. Production should be a separate explicitly linked project and should only receive already-reviewed migrations.

## Security model and write boundary

- Every application table has RLS enabled. Room-scoped reads require membership; profiles are visible only to the current user or people sharing a room.
- Direct writes are intentionally narrow. Sensitive mutations—admission, capacity, ownership, moderation, countdown control, and message edits/deletions—go through atomic `security definer` functions with an empty `search_path`.
- Anonymous users may join guest-enabled rooms as guests but cannot create rooms or shared timers. They may create and control their own room-visible personal timers.
- Invite codes are revocable grants, not credentials. They are unique, bounded by use count, optionally user-bound, and may expire. Invite-only rooms redeem them atomically; approval-required rooms convert them into pending requests and consume a use only during locked approval.
- Room ownership succession is deterministic among permanent users: moderators, members, then registered guests, each ordered by immutable membership `succession_rank`. Anonymous guests are never promoted; a room with no eligible successor is deleted. Transfers are recorded in `room_ownership_history`.
- All countdowns belong to a room. Personal countdowns have one owner and no participants; shared countdowns require at least one room-member participant. Scheduled countdowns fix both `scheduled_start_at` and `ends_at`, so opening or pausing one late preserves the original timeline; running countdowns use `started_at` plus `ends_at`, while paused countdowns store only `paused_remaining_seconds`. Constraints prevent mixed timing representations.
- Message edits append the prior body to `message_revisions`. Deletion clears content but keeps the message row as a reply-safe tombstone.
- Realtime database changes are published for the collaborative tables. Private channel policies authorize topics shaped as `room:<room_uuid>` against current membership; banned users cannot publish broadcasts.

The functions in the migrations are the backend API contract for the first client. Add new direct table grants only when a concrete client operation cannot be expressed through that contract.
