-- Tone Recall Supabase backend foundation.
-- Run this in the Supabase Dashboard SQL Editor for the project.
-- This creates private per-user tone tables and private Storage policies.

begin;

create table if not exists public.tones (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null,
  deleted_at timestamptz null,
  cloud_revision bigint not null default 1,
  last_synced_at timestamptz null,

  constraint tones_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint tones_cloud_revision_at_least_one check (cloud_revision >= 1),
  constraint tones_user_id_id_unique unique (user_id, id)
);

comment on table public.tones is
  'Private per-user Tone Recall records. The data column stores the MVP tone document as JSONB.';
comment on column public.tones.data is
  'Whole tone document from the local IndexedDB model. Keep pedals, knobs, tags, and media references together for MVP sync.';
comment on column public.tones.updated_at is
  'App-level last edit timestamp used by the MVP newest-whole-tone-wins conflict rule.';
comment on column public.tones.deleted_at is
  'Soft-delete marker. The app keeps deleted tones restorable for 7 days before purge.';
comment on column public.tones.cloud_revision is
  'Cloud-side revision bookkeeping. The MVP conflict rule still uses updated_at.';
comment on column public.tones.last_synced_at is
  'Optional client-written marker for diagnostics; not an authorization boundary.';

create index if not exists tones_user_updated_idx
  on public.tones (user_id, updated_at desc);

create index if not exists tones_user_deleted_idx
  on public.tones (user_id, deleted_at)
  where deleted_at is not null;

create table if not exists public.tone_undo_snapshots (
  tone_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  previous_data jsonb not null,
  previous_updated_at timestamptz not null,
  captured_at timestamptz not null default now(),
  reason text not null,

  primary key (user_id, tone_id),
  constraint tone_undo_previous_data_is_object check (jsonb_typeof(previous_data) = 'object'),
  constraint tone_undo_reason_not_blank check (length(trim(reason)) > 0),
  constraint tone_undo_tone_fk
    foreign key (user_id, tone_id)
    references public.tones (user_id, id)
    on delete cascade
);

comment on table public.tone_undo_snapshots is
  'One undo snapshot per user tone. Replaced each time the app captures a new undo point.';
comment on column public.tone_undo_snapshots.previous_data is
  'Previous whole tone document used for single-step undo.';
comment on column public.tone_undo_snapshots.previous_updated_at is
  'Previous app-level update timestamp restored with the undo snapshot.';

create index if not exists tone_undo_user_captured_idx
  on public.tone_undo_snapshots (user_id, captured_at desc);

alter table public.tones enable row level security;
alter table public.tone_undo_snapshots enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.tones to authenticated;
grant select, insert, update, delete on public.tone_undo_snapshots to authenticated;

drop policy if exists "tones_select_own" on public.tones;
create policy "tones_select_own"
on public.tones
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tones_insert_own" on public.tones;
create policy "tones_insert_own"
on public.tones
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "tones_update_own" on public.tones;
create policy "tones_update_own"
on public.tones
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "tones_delete_own" on public.tones;
create policy "tones_delete_own"
on public.tones
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tone_undo_select_own" on public.tone_undo_snapshots;
create policy "tone_undo_select_own"
on public.tone_undo_snapshots
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tone_undo_insert_own" on public.tone_undo_snapshots;
create policy "tone_undo_insert_own"
on public.tone_undo_snapshots
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "tone_undo_update_own" on public.tone_undo_snapshots;
create policy "tone_undo_update_own"
on public.tone_undo_snapshots
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "tone_undo_delete_own" on public.tone_undo_snapshots;
create policy "tone_undo_delete_own"
on public.tone_undo_snapshots
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Private Storage buckets. Supabase projects expose Storage metadata in the
-- storage schema. If this bucket block fails in SQL Editor, create the buckets
-- manually with the exact dashboard steps in docs/supabase_setup.md, then rerun
-- the storage.objects policy statements below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('tone-photos', 'tone-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('tone-audio', 'tone-audio', false, 52428800, array['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tone_media_select_own_prefix" on storage.objects;
create policy "tone_media_select_own_prefix"
on storage.objects
for select
to authenticated
using (
  bucket_id in ('tone-photos', 'tone-audio')
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "tone_media_insert_own_prefix" on storage.objects;
create policy "tone_media_insert_own_prefix"
on storage.objects
for insert
to authenticated
with check (
  bucket_id in ('tone-photos', 'tone-audio')
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "tone_media_update_own_prefix" on storage.objects;
create policy "tone_media_update_own_prefix"
on storage.objects
for update
to authenticated
using (
  bucket_id in ('tone-photos', 'tone-audio')
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id in ('tone-photos', 'tone-audio')
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "tone_media_delete_own_prefix" on storage.objects;
create policy "tone_media_delete_own_prefix"
on storage.objects
for delete
to authenticated
using (
  bucket_id in ('tone-photos', 'tone-audio')
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

commit;
