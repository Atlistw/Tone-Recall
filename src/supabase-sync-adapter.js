const TONE_COLUMNS = "id,user_id,data,created_at,updated_at,deleted_at,cloud_revision,last_synced_at";
const UNDO_COLUMNS = "tone_id,user_id,previous_data,previous_updated_at,captured_at,reason";
const PHOTO_BUCKET = "tone-photos";
const AUDIO_BUCKET = "tone-audio";

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
  if (!document.audioStoragePath) delete document.audioStoragePath;

  if (Array.isArray(document.photos)) {
    document.photos = document.photos.map((photo, index) => ({
      id: photo?.id || `photo-${index + 1}`,
      name: photo?.name || `Photo ${index + 1}`,
      ...(photo?.storagePath ? { storagePath: photo.storagePath } : {}),
      ...(photo?.mimeType ? { mimeType: photo.mimeType } : {})
    }));
  }

  return document;
}

function imageExtensionForMimeType(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "jpg";
}

function audioExtensionForMimeType(mimeType) {
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/mp4" || mimeType === "audio/aac") return "m4a";
  if (mimeType === "audio/ogg") return "ogg";
  if (mimeType === "audio/webm") return "webm";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return "wav";
  return "audio";
}

function dataUrlParts(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    isBase64: Boolean(match[2]),
    body: match[3] || ""
  };
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrlParts(dataUrl);
  if (!parts) throw new Error("Media data is not a data URL.");
  const binary = parts.isBase64
    ? (typeof atob !== "undefined" ? atob(parts.body) : Buffer.from(parts.body, "base64").toString("binary"))
    : decodeURIComponent(parts.body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: parts.mimeType });
}

async function blobToDataUrl(blob) {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  return `data:${blob.type || "application/octet-stream"};base64,${buffer.toString("base64")}`;
}

function photoStoragePath(userId, toneId, photo, index) {
  const photoId = photo?.id || `photo-${index + 1}`;
  const mimeType = photo?.mimeType || dataUrlParts(photo?.data)?.mimeType || "image/jpeg";
  return `${userId}/${toneId}/${photoId}.${imageExtensionForMimeType(mimeType)}`;
}

function audioStoragePath(userId, toneId, tone) {
  const mimeType = tone?.audioType || dataUrlParts(tone?.audio)?.mimeType || "audio/wav";
  return `${userId}/${toneId}/audio.${audioExtensionForMimeType(mimeType)}`;
}

async function expectStorageResult(result) {
  const { data, error } = await result;
  if (error) throw error;
  return data;
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

    async uploadTonePhotos(tone) {
      requireObject(tone, "Tone");
      if (!tone.id) throw new Error("Tone is missing id.");
      const nextTone = clone(tone);
      const photos = Array.isArray(nextTone.photos) ? nextTone.photos : [];
      nextTone.photos = [];

      for (const [index, photo] of photos.entries()) {
        const nextPhoto = { ...photo };
        if (nextPhoto.data && !nextPhoto.storagePath) {
          const blob = dataUrlToBlob(nextPhoto.data);
          const path = photoStoragePath(userId, nextTone.id, nextPhoto, index);
          await expectStorageResult(
            client
              .storage
              .from(PHOTO_BUCKET)
              .upload(path, blob, {
                contentType: blob.type || "image/jpeg",
                upsert: true
              })
          );
          nextPhoto.storagePath = path;
          nextPhoto.mimeType = blob.type || nextPhoto.mimeType || "image/jpeg";
        }
        nextTone.photos.push(nextPhoto);
      }

      return nextTone;
    },

    async downloadTonePhotos(tone) {
      requireObject(tone, "Tone");
      const nextTone = clone(tone);
      const photos = Array.isArray(nextTone.photos) ? nextTone.photos : [];
      nextTone.photos = [];

      for (const photo of photos) {
        const nextPhoto = { ...photo };
        if (!nextPhoto.data && nextPhoto.storagePath) {
          const blob = await expectStorageResult(
            client
              .storage
              .from(PHOTO_BUCKET)
              .download(nextPhoto.storagePath)
          );
          nextPhoto.data = await blobToDataUrl(blob);
          nextPhoto.mimeType = nextPhoto.mimeType || blob.type || "";
        }
        nextTone.photos.push(nextPhoto);
      }

      return nextTone;
    },

    async uploadToneAudio(tone) {
      requireObject(tone, "Tone");
      if (!tone.id) throw new Error("Tone is missing id.");
      const nextTone = clone(tone);
      if (nextTone.audio && !nextTone.audioStoragePath) {
        const blob = dataUrlToBlob(nextTone.audio);
        const path = audioStoragePath(userId, nextTone.id, nextTone);
        await expectStorageResult(
          client
            .storage
            .from(AUDIO_BUCKET)
            .upload(path, blob, {
              contentType: blob.type || nextTone.audioType || "audio/wav",
              upsert: true
            })
        );
        nextTone.audioStoragePath = path;
        nextTone.audioType = blob.type || nextTone.audioType || "audio/wav";
        nextTone.audioSize = nextTone.audioSize || blob.size || 0;
      }
      return nextTone;
    },

    async downloadToneAudio(tone) {
      requireObject(tone, "Tone");
      const nextTone = clone(tone);
      if (!nextTone.audio && nextTone.audioStoragePath) {
        const blob = await expectStorageResult(
          client
            .storage
            .from(AUDIO_BUCKET)
            .download(nextTone.audioStoragePath)
        );
        nextTone.audio = await blobToDataUrl(blob);
        nextTone.audioType = nextTone.audioType || blob.type || "";
        nextTone.audioSize = nextTone.audioSize || blob.size || 0;
      }
      return nextTone;
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

const supabaseSyncAdapterApi = {
  TONE_COLUMNS,
  UNDO_COLUMNS,
  PHOTO_BUCKET,
  AUDIO_BUCKET,
  createSupabaseSyncAdapter,
  localToneToToneRow,
  toneRowToRemoteTone,
  undoRowToSnapshot,
  undoSnapshotToRow
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = supabaseSyncAdapterApi;
}

if (typeof globalThis !== "undefined") {
  globalThis.ToneRecallSupabaseSyncAdapter = supabaseSyncAdapterApi;
}
