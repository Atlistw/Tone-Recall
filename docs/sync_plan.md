# Sync Plan

This note records the current sync architecture and remaining follow-up work.

## Current State

Tone Recall remains local-first. IndexedDB is still the source used by the UI, and manual JSON export/import stays available.

The repo now has:

- a Supabase schema/setup foundation
- a minimal Supabase auth/account shell for invited users
- a provider-agnostic sync core with mock tests
- a real Supabase metadata/media adapter with fake-client tests
- a manual `Sync now` path
- a conservative one-shot sync when a signed-in user loads the library

The app can upload/download tone metadata, soft deletes, photos, and audio. It does not run continuous background sync or upload imported JSON automatically without the normal sync path.

## Auth

- Email/password login is the primary flow.
- Magic-link sign-in remains available as a fallback.
- Invite-only MVP.
- Supabase users are created or invited manually.
- Magic-link login uses `shouldCreateUser: false`.
- Logging out does not clear IndexedDB by default.
- The Account screen has an explicit local cache clear action.

## Cloud Data Model

Use `public.tones` as the MVP sync table.

- One row per tone.
- `data jsonb` stores the whole tone document.
- Pedals, knobs, tags, and media references stay inside the JSON document for now.
- `updated_at` remains the app-level conflict timestamp.
- `cloud_revision` is cloud-side sync bookkeeping.
- `deleted_at` marks soft deletes for a 7-day recycle bin.

Use `public.tone_undo_snapshots` for one undo point per tone.

- Replaced when a new undo point is captured.
- Stores previous whole `data`.
- Stores previous `updated_at`.
- Intended for single-step restore, not full history.

## Conflict Rules

Default conflict rule:

- newest `updatedAt` wins for the whole tone document

Delete conflict:

- if remote has `deleted_at`
- and the local tone has a newer edit than the delete
- the app should not silently choose
- ask whether to restore the edited version or keep the delete

Same-time edit conflicts can be resolved from the Account screen with `Keep cloud` or `Keep this device`. Delete/edit conflicts are still paused for safety and need a dedicated restore/delete choice.

## Media

Use Supabase Storage:

- `tone-photos`
- `tone-audio`

Path shape:

- `{user_id}/{tone_id}/{photo_id}.jpg`
- `{user_id}/{tone_id}/audio.wav`

Manual sync uploads local photo/audio payloads to Storage when needed, stores only Storage paths in cloud tone metadata, and downloads missing media payloads to the local IndexedDB cache. Continuous background media sync is not implemented.

## JSON Import and Export

Manual JSON export/import remains supported.

When signed out:

- import affects local IndexedDB only

When signed in, imported JSON remains local until the user syncs. The sync core classifies imported local tones as upload candidates, but there is not yet a dedicated import confirmation flow.

## Remaining Follow-Up Work

1. Add a dedicated delete/edit conflict prompt.
2. Add a recycle bin view for restore/purge behavior.
3. Add JSON import confirmation while signed in.
4. Consider continuous background sync or a safer periodic sync if the product needs it.
5. Add more user-facing sync progress for large photo/audio transfers.

## Current Non-Goals

- no continuous background sync loop
- no multi-user shared tone libraries
- no automatic cloud upload immediately after JSON import without user sync
- no service-role keys
- no schema split into pedals/knobs tables
