const TONE_COLUMNS = "id,user_id,data,created_at,updated_at,deleted_at,cloud_revision,last_synced_at";
const UNDO_COLUMNS = "tone_id,user_id,previous_data,previous_updated_at,captured_at,reason";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isoNow(now = new Date()) {
  if (typeof now === "string") return now;
  if (now instanceof Date) return now.toISOString();
  return new Date(now).toISOString();
}

function requireObject(value, label) {
  if (!value || typeof value !== "object") {
    throw new TypeError(label + " must be an object.");
  }
}

function requireUserId(userId) {
  if (!userId) throw new Error("userId is required.");
}

function requireToneId(toneId) {
  if (!toneId) throw new Error("toneId is required.");
}

function createdAtForTone(tone, updatedAt) {
  return tone.createdAt || tone.created_at || updatedAt || isoNow();
}

function updatedAtForTone(tone) {
  return tone.updatedAt || tone.updated_at || tone.createdAt || tone.created_at || isoNow();
}

function deletedAtForTone(tone) {
  return tone.deletedAt || tone.deleted_at || null;
}

function cloudRevisionForTone(tone) {
  return tone.cloudRevision ?? tone.cloud_revision ?? 1;
}

function metadataToneDocument(tone) {
  const document = clone(tone || {});
  delete document.photo;
  delete document.audio;

  if (Array.isArray(document.photos)) {
    document.photos = document.photos.map((photo, index) => ({
      id: photo?.id || `photo-${index + 1}`,
      name: photo?.name || `Photo ${index + 1}`
    }));
  }

  return document;
}

function localToneToToneRow(tone, userId, options = {}) {
  requireObject(tone, "Tone");
  if (!tone.id) throw new Error("Tone is missing id.");
  requireUserId(userId);

  const updatedAt = updatedAtForTone(tone);
  const deletedAt = deletedAtForTone(tone);
  const data = metadataToneDocument(tone);
  data.id = tone.id;
  data.updatedAt = data.updatedAt || updatedAt;
  delete data.updated_at;
  delete data.deleted_at;
  if (deletedAt) {
    data.deletedAt = deletedAt;
  } else {
    delete data.deletedAt;
  }

  return {
    id: tone.id,
    user_id: userId,
    data,
    created_at: createdAtForTone(tone, updatedAt),
    updated_at: updatedAt,
    deleted_at: deletedAt,
    cloud_revision: cloudRevisionForTone(tone),
    last_synced_at: isoNow(options.now)
  };
}

function toneRowToRemoteTone(row) {
  requireObject(row, "Tone row");
  if (!row.id) throw new Error("Tone row is missing id.");

  const data = row.data && typeof row.data === "object" ? clone(row.data) : {};
  data.id = data.id || row.id;
  data.updatedAt = data.updatedAt || data.updated_at || row.updated_at || row.updatedAt || row.created_at || row.createdAt;
  delete data.updated_at;

  const deletedAt = data.deletedAt || data.deleted_at || row.deleted_at || row.deletedAt || null;
  delete data.deleted_at;
  if (deletedAt) {
    data.deletedAt = deletedAt;
  } else {
    delete data.deletedAt;
  }

  return {
    id: row.id,
    user_id: row.user_id || row.userId || null,
    data,
    created_at: row.created_at || row.createdAt || null,
    updated_at: data.updatedAt,
    deleted_at: deletedAt,
    cloud_revision: row.cloud_revision ?? row.cloudRevision ?? null,
    last_synced_at: row.last_synced_at || row.lastSyncedAt || null
  };
}

function undoSnapshotToRow(snapshot, userId, options = {}) {
  requireObject(snapshot, "Undo snapshot");
  const toneId = snapshot.toneId || snapshot.tone_id;
  requireToneId(toneId);
  requireUserId(userId);

  return {
    tone_id: toneId,
    user_id: userId,
    previous_data: clone(snapshot.previousData || snapshot.previous_data || {}),
    previous_updated_at: snapshot.previousUpdatedAt || snapshot.previous_updated_at,
    captured_at: snapshot.capturedAt || snapshot.captured_at || isoNow(options.now),
    reason: snapshot.reason || "sync-overwrite"
  };
}

function undoRowToSnapshot(row) {
  requireObject(row, "Undo snapshot row");
  return {
    toneId: row.tone_id || row.toneId,
    userId: row.user_id || row.userId || null,
    previousData: clone(row.previous_data || row.previousData || {}),
    previousUpdatedAt: row.previous_updated_at || row.previousUpdatedAt,
    capturedAt: row.captured_at || row.capturedAt,
    reason: row.reason
  };
}

async function expectSupabaseResult(query) {
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data;
}

function createSupabaseSyncAdapter(client, options = {}) {
  requireObject(client, "Supabase client");
  requireUserId(options.userId);

  const userId = options.userId;
  const now = options.now;

  return {
    async listRemoteTones() {
      const data = await expectSupabaseResult(
        client
          .from("tones")
          .select(TONE_COLUMNS)
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
      );
      return (data || []).map(toneRowToRemoteTone);
    },

    async upsertTone(tone) {
      const row = localToneToToneRow(tone, userId, { now });
      const data = await expectSupabaseResult(
        client
          .from("tones")
          .upsert(row, { onConflict: "id" })
          .select(TONE_COLUMNS)
          .single()
      );
      return toneRowToRemoteTone(data);
    },

    async softDeleteTone(toneId, deletedAt = isoNow(now)) {
      requireToneId(toneId);
      const data = await expectSupabaseResult(
        client
          .from("tones")
          .update({
            deleted_at: deletedAt,
            updated_at: deletedAt,
            last_synced_at: isoNow(now)
          })
          .eq("id", toneId)
          .eq("user_id", userId)
          .select(TONE_COLUMNS)
          .single()
      );
      return toneRowToRemoteTone(data);
    },

    async purgeTone(toneId) {
      requireToneId(toneId);
      await expectSupabaseResult(
        client
          .from("tones")
          .delete()
          .eq("id", toneId)
          .eq("user_id", userId)
      );
      return { toneId };
    },

    async listUndoSnapshots() {
      const data = await expectSupabaseResult(
        client
          .from("tone_undo_snapshots")
          .select(UNDO_COLUMNS)
          .eq("user_id", userId)
          .order("captured_at", { ascending: false })
      );
      return (data || []).map(undoRowToSnapshot);
    },

    async upsertUndoSnapshot(snapshot) {
      const row = undoSnapshotToRow(snapshot, userId, { now });
      const data = await expectSupabaseResult(
        client
          .from("tone_undo_snapshots")
          .upsert(row, { onConflict: "user_id,tone_id" })
          .select(UNDO_COLUMNS)
          .single()
      );
      return undoRowToSnapshot(data);
    },

    async deleteUndoSnapshot(toneId) {
      requireToneId(toneId);
      await expectSupabaseResult(
        client
          .from("tone_undo_snapshots")
          .delete()
          .eq("user_id", userId)
          .eq("tone_id", toneId)
      );
      return { toneId };
    }
  };
}

module.exports = {
  TONE_COLUMNS,
  UNDO_COLUMNS,
  createSupabaseSyncAdapter,
  localToneToToneRow,
  toneRowToRemoteTone,
  undoRowToSnapshot,
  undoSnapshotToRow
};
