# Supabase Setup

This repo does not contain Supabase secrets. The browser app can use the public Supabase URL and anon/publishable key; security comes from Auth, RLS, and Storage policies, not from hiding the anon key. Never put the service-role key in frontend code.

## Run the Schema

1. Open the Supabase project dashboard.
2. Go to **SQL Editor**.
3. Paste the full contents of [supabase/schema.sql](../supabase/schema.sql).
4. Run it once.

The SQL is intended to be idempotent for the foundation objects. It creates or updates:

- `public.tones`
- `public.tone_undo_snapshots`
- RLS policies for both app tables
- private Storage buckets `tone-photos` and `tone-audio`
- Storage policies for authenticated users under their own user-id folder prefix

Expected Storage object paths:

- `tone-photos/{user_id}/{tone_id}/{photo_id}.jpg`
- `tone-audio/{user_id}/{tone_id}/audio.wav`

If the bucket creation section fails in SQL Editor because Storage bucket management is unavailable in that project context, create the buckets manually:

1. Go to **Storage**.
2. Create bucket `tone-photos`.
3. Keep it private.
4. Set an MVP file-size limit around 10 MB.
5. Allow image types: `image/jpeg`, `image/png`, `image/webp`.
6. Create bucket `tone-audio`.
7. Keep it private.
8. Set an MVP file-size limit around 50 MB.
9. Allow audio types: `audio/wav`, `audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/ogg`, `audio/webm`.
10. Rerun the `storage.objects` policy statements from `schema.sql` if needed.

## Frontend Config

The auth shell reads [src/supabase-config.js](../src/supabase-config.js). [src/supabase-config.example.js](../src/supabase-config.example.js) is the template, and the active config currently contains empty placeholders:

```js
window.TONE_RECALL_SUPABASE_CONFIG = {
  url: "",
  anonKey: "",
  redirectTo: ""
};
```

Fill in the project URL and anon/publishable key from **Project Settings -> API** when you are ready to test auth. The anon/publishable key is okay in browser code. Never paste a service-role key into this file.

Leave `redirectTo` blank to use the current page URL, or set it explicitly to the GitHub Pages URL.

## Auth Settings

Go to **Authentication -> URL Configuration**.

Use the current GitHub Pages URL as the production URL:

- Site URL: `https://atlistw.github.io/Tone-Recall/`
- Redirect URLs:
  - `https://atlistw.github.io/Tone-Recall/`
  - `http://localhost:8000/`
  - `http://127.0.0.1:8000/`

Adjust local ports later if the dev server uses a different port.

## Invite-Only MVP

For now, users should be invited or created manually in Supabase:

1. Go to **Authentication -> Users**.
2. Add or invite the user email manually.
3. The current app auth shell sends magic links with `shouldCreateUser: false`.

That keeps random visitors from creating accounts through the public app.

The default Supabase email sender is fine for the MVP. Custom SMTP and a custom auth email domain can wait until the app needs production polish.

## Verify Database Objects

In SQL Editor, these checks should return rows:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('tones', 'tone_undo_snapshots')
order by table_name;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('tones', 'tone_undo_snapshots');

select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('tones', 'tone_undo_snapshots')
order by tablename, policyname;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('tone-photos', 'tone-audio')
order by id;

select policyname, cmd
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'tone_media_%'
order by policyname;
```

## Verify RLS Behavior

After the schema is installed and auth is configured, verify from the browser with the anon/publishable key:

- signed-out users cannot read or write tones
- signed-in users can only read their own `user_id`
- writes fail if `user_id` does not match `auth.uid()`
- Storage uploads fail outside `{user_id}/...`

Do not use the service-role key for browser verification because it bypasses RLS.

## Current Non-Goals

The app has an auth shell and a pure sync-core test layer, but it still does not perform real Supabase tone sync. Do not expect tones, photos, audio, JSON imports, or deletes to upload/download until the next sync implementation pass.
