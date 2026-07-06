# Tone Recall

Tone Recall is a local-first web app for saving guitar tones before they are forgotten. It works on mobile and desktop and can sync tone metadata, photos, and audio through Supabase for invited users.

## What It Saves

- Tone title and description
- Searchable tags in descriptions, such as `#crunchy`
- One or more tone photos
- Pedal names and knob values
- Optional voice memo or audio file

## Basic Use

1. Open the app.
2. Sign in with the invited email and password.
3. Press `New Tone Photo`.
4. Take, import, or paste one or more photos.
5. Add a title, description, tags, pedals, and knob values.
6. Optionally record or attach a voice memo.
7. Return to the library.

The library search matches titles, descriptions, and tags.

## Syncing Between Devices

Tone Recall syncs once when a signed-in user loads the library. It does not run continuous background sync yet, so use `Account -> Sync now` when you want to push or pull changes immediately.

Recommended flow:

1. Open the app and sign in. The library will try to sync once automatically.
2. After making changes on a device, open `Account`.
3. Press `Sync now`.
4. On the other device, open the app or press `Sync now` to pull the latest changes.

Sync currently handles:

- tone metadata
- descriptions and tags
- pedals and knob values
- soft deletes
- photos
- audio files and voice memos

Sync does not currently handle:

- automatic background sync
- multi-user shared tone libraries

## Conflict Resolution

If the same tone has conflicting same-time edits, the Account screen shows the conflict with two buttons:

- `Keep cloud`: use the cloud version on this device.
- `Keep this device`: upload this device's version to cloud.

Delete/edit conflicts are still paused for safety and should be resolved carefully in a later version.

## Clear Local Cache

`Account -> Clear local cache` clears only this device's local IndexedDB cache. It does not delete cloud data.

Use it when a device has stale local data:

1. Open `Account`.
2. Press `Clear local cache`.
3. Confirm the warning.
4. Press `Sync now` to download cloud tones again.

Do not use this for unsynced local work unless you are okay losing local-only tones, photos, or audio on that device.
