# Sync Plan

This note records the intended sync architecture. Full Supabase tone sync is not implemented yet.

## Current State

Tone Recall remains local-first. IndexedDB is still the source used by the current UI. Manual JSON export/import stays available.

The repo now has:

- a Supabase schema/setup foundation
- a minimal Supabase auth shell for invite-only email magic links
- a provider-agnostic sync core with mock tests

The app still does not upload or download tones, photos, audio, JSON imports, or deletes.

## Auth

- Email magic-link login.
- Invite-only MVP.
- Supabase users are created or invited manually.
- Magic-link login uses `shouldCreateUser: false`.
- Logging out does not clear IndexedDB by default.
- Add a separate explicit action later to clear local data.

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

The sync-core test layer can already classify this conflict, but no conflict UI exists yet.

## Media

Use Supabase Storage:

- `tone-photos`
- `tone-audio`

Path shape:

- `{user_id}/{tone_id}/{photo_id}.jpg`
- `{user_id}/{tone_id}/audio.wav`

Upload media automatically when online in a later pass. Download full media lazily when a tone is opened. The library view can use existing local cached media first, then add metadata or thumbnails later.

## JSON Import and Export

Manual JSON export/import remains supported.

When signed out:

- import affects local IndexedDB only

When signed in:

- importing JSON should ask before uploading imported tones to cloud
- user choices should include local-only import and upload/sync import

The sync core can classify imported local tones as upload candidates, but the UI confirmation is not wired yet.

## Suggested Implementation Passes

1. Add real Supabase adapter methods behind the existing provider-agnostic sync core.
2. Add a manually triggered sync button or developer-only sync command.
3. Add automatic metadata sync using newest whole tone wins.
4. Add media upload queue.
5. Add lazy media download on tone open.
6. Add recycle bin restore/purge behavior.
7. Add delete-conflict prompt.
8. Polish account/settings UI, including explicit local data clear.

## Non-Goals For The Current Backend Foundation

- no app UI changes
- no real Supabase tone upload/download
- no automatic sync
- no media upload/download
- no JSON import/export behavior changes
- no service-role keys
- no schema split into pedals/knobs tables
