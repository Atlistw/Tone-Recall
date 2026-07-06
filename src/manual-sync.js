function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

function mergePhotos(remotePhotos, existingPhotos) {
  const existingById = new Map((existingPhotos || []).map((photo) => [photo.id, photo]));
  if (!Array.isArray(remotePhotos) || !remotePhotos.length) {
    return clone(existingPhotos || []);
  }

  return remotePhotos.map((remotePhoto, index) => {
    const id = remotePhoto?.id || `photo-${index + 1}`;
    const existingPhoto = existingById.get(id) || {};
    const merged = {
      ...remotePhoto,
      id,
      name: remotePhoto?.name || existingPhoto.name || `Photo ${index + 1}`
    };

    if (existingPhoto.data && !remotePhoto?.data) {
      merged.data = existingPhoto.data;
    }
    if (existingPhoto.storagePath && !merged.storagePath) {
      merged.storagePath = existingPhoto.storagePath;
    }
    if (existingPhoto.mimeType && !merged.mimeType) {
      merged.mimeType = existingPhoto.mimeType;
    }

    return merged;
  });
}

function mergeRemoteMetadataWithLocalMedia(remoteMetadata, existingLocal) {
  const existing = clone(existingLocal || {});
  const remote = clone(remoteMetadata || {});
  const merged = {
    ...existing,
    ...remote
  };

  if (Object.prototype.hasOwnProperty.call(existing, "photo")) {
    merged.photo = existing.photo;
  } else {
    delete merged.photo;
  }

  merged.photos = mergePhotos(remote.photos, existing.photos);

  if (remote.audio) {
    merged.audio = remote.audio;
  } else if (Object.prototype.hasOwnProperty.call(existing, "audio")) {
    merged.audio = existing.audio;
  } else {
    delete merged.audio;
  }

  for (const key of ["audioType", "audioSize", "audioPeak"]) {
    if (remote.audio && Object.prototype.hasOwnProperty.call(remote, key)) {
      merged[key] = remote[key];
    } else if (Object.prototype.hasOwnProperty.call(existing, key)) {
      merged[key] = existing[key];
    }
  }

  return merged;
}

function toneSummary(tone, fallbackId = "") {
  const id = tone?.id || fallbackId || "";
  const title = String(tone?.title || "").trim();
  return {
    id,
    title,
    label: title || id || "Untitled tone"
  };
}

function photoStoragePathCount(tone) {
  return (tone?.photos || []).filter((photo) => photo?.storagePath).length;
}

function photoDataCount(tone) {
  return (tone?.photos || []).filter((photo) => photo?.data).length;
}

function audioStoragePathCount(tone) {
  return tone?.audioStoragePath ? 1 : 0;
}

function audioDataCount(tone) {
  return tone?.audio ? 1 : 0;
}

function hasPhotoDataMissingStorage(tone) {
  return (tone?.photos || []).some((photo) => photo?.data && !photo?.storagePath);
}

function hasAudioDataMissingStorage(tone) {
  return Boolean(tone?.audio && !tone?.audioStoragePath);
}

function hasMediaDataMissingStorage(tone) {
  return hasPhotoDataMissingStorage(tone) || hasAudioDataMissingStorage(tone);
}

function timestampMs(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function canonicalToneWithoutPhotoTransport(tone) {
  const document = metadataToneDocument(tone);
  delete document.audioStoragePath;
  if (Array.isArray(document.photos)) {
    document.photos = document.photos.map((photo, index) => ({
      id: photo?.id || `photo-${index + 1}`,
      name: photo?.name || `Photo ${index + 1}`
    }));
  }
  return document;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return stableJson(left) === stableJson(right);
}

function hasRemotePhotoStorage(tone) {
  return (tone?.photos || []).some((photo) => photo?.storagePath);
}

function hasRemoteAudioStorage(tone) {
  return Boolean(tone?.audioStoragePath);
}

function isMediaTransportOnlyConflict(conflict) {
  if (conflict.type !== "same_timestamp_difference") return false;
  return sameJson(
    canonicalToneWithoutPhotoTransport(conflict.localTone),
    canonicalToneWithoutPhotoTransport(conflict.remoteTone)
  );
}

function resolveMediaTransportConflicts(plan) {
  const remainingConflicts = [];

  for (const conflict of plan.conflicts) {
    if (!isMediaTransportOnlyConflict(conflict)) {
      remainingConflicts.push(conflict);
      continue;
    }

    if (hasRemotePhotoStorage(conflict.remoteTone) || hasRemoteAudioStorage(conflict.remoteTone)) {
      plan.actions.push({
        type: "apply_remote",
        toneId: conflict.toneId,
        reason: "media-storage-path-remote",
        tone: clone(conflict.remoteTone),
        remote: clone(conflict.remoteTone)
      });
      continue;
    }

    if (hasMediaDataMissingStorage(conflict.localTone)) {
      plan.actions.push({
        type: "upload",
        toneId: conflict.toneId,
        reason: "media-storage-backfill",
        tone: clone(conflict.localTone),
        remote: clone(conflict.remoteTone)
      });
      continue;
    }

    remainingConflicts.push(conflict);
  }

  plan.conflicts = remainingConflicts;
}

function createSummary(plan, executed) {
  return {
    uploaded: executed.uploaded,
    applied: executed.applied,
    deleted: executed.deleted,
    purged: executed.purged,
    undoSnapshots: executed.undoSnapshots,
    uploadedTones: executed.uploadedTones,
    downloadedTones: executed.downloadedTones,
    deletedTones: executed.deletedTones,
    purgedToneIds: executed.purgedToneIds,
    mediaUploaded: executed.mediaUploaded,
    mediaDownloaded: executed.mediaDownloaded,
    photoUploaded: executed.photoUploaded,
    photoDownloaded: executed.photoDownloaded,
    audioUploaded: executed.audioUploaded,
    audioDownloaded: executed.audioDownloaded,
    conflicts: plan.conflicts,
    actions: plan.actions
  };
}

async function runManualMetadataSync(options = {}) {
  const adapter = options.adapter;
  const syncCore = options.syncCore;
  const localTones = options.localTones || [];
  const applyLocalTone = options.applyLocalTone;
  const deleteLocalTone = options.deleteLocalTone;
  const now = options.now || new Date().toISOString();

  if (!adapter) throw new Error("adapter is required.");
  if (!syncCore?.planToneSync) throw new Error("syncCore.planToneSync is required.");
  if (typeof applyLocalTone !== "function") throw new Error("applyLocalTone is required.");

  const executed = {
    uploaded: 0,
    applied: 0,
    deleted: 0,
    purged: 0,
    undoSnapshots: 0,
    uploadedTones: [],
    downloadedTones: [],
    deletedTones: [],
    purgedToneIds: [],
    mediaUploaded: 0,
    mediaDownloaded: 0,
    photoUploaded: 0,
    photoDownloaded: 0,
    audioUploaded: 0,
    audioDownloaded: 0
  };

  const remoteTones = await adapter.listRemoteTones();
  const undoSnapshots = typeof adapter.listUndoSnapshots === "function"
    ? await adapter.listUndoSnapshots()
    : [];

  const localById = new Map(localTones.map((tone) => [tone.id, tone]));
  const remoteById = new Map(remoteTones.map((tone) => [tone.id, tone]));
  const localMetadata = localTones.map(metadataToneDocument);
  const remoteMetadata = remoteTones.map((tone) => ({
    ...tone,
    data: metadataToneDocument(tone.data || {})
  }));

  const plan = syncCore.planToneSync({
    localTones: localMetadata,
    remoteTones: remoteMetadata,
    undoSnapshots,
    now
  });
  resolveMediaTransportConflicts(plan);

  const plannedToneIds = new Set(plan.actions.map((action) => action.toneId));
  const conflictedToneIds = new Set(plan.conflicts.map((conflict) => conflict.toneId));
  for (const tone of localTones) {
    if (!tone?.id || plannedToneIds.has(tone.id) || conflictedToneIds.has(tone.id)) continue;
    if (!hasMediaDataMissingStorage(tone)) continue;
    const remoteTone = remoteById.get(tone.id);
    if (!remoteTone || remoteTone.deleted_at || remoteTone.deletedAt) continue;
    if (timestampMs(tone.updatedAt || tone.updated_at) < timestampMs(remoteTone.updated_at || remoteTone.updatedAt)) continue;
    plan.actions.push({
      type: "upload",
      toneId: tone.id,
      reason: "media-storage-backfill",
      tone: metadataToneDocument(tone),
      remote: clone(remoteTone)
    });
    plannedToneIds.add(tone.id);
  }

  for (const snapshot of plan.newUndoSnapshots) {
    if (typeof adapter.upsertUndoSnapshot === "function") {
      await adapter.upsertUndoSnapshot({
        ...snapshot,
        previousData: metadataToneDocument(snapshot.previousData)
      });
      executed.undoSnapshots += 1;
    }
  }

  for (const action of plan.actions) {
    if (action.type === "upload") {
      const localTone = localById.get(action.toneId) || action.tone;
      let uploadTone = localTone;
      if (typeof adapter.uploadTonePhotos === "function") {
        const beforePaths = photoStoragePathCount(localTone);
        uploadTone = await adapter.uploadTonePhotos(localTone);
        const afterPaths = photoStoragePathCount(uploadTone);
        if (afterPaths > beforePaths) {
          const uploadedPhotos = afterPaths - beforePaths;
          executed.mediaUploaded += uploadedPhotos;
          executed.photoUploaded += uploadedPhotos;
          localById.set(action.toneId, uploadTone);
        }
      }
      if (typeof adapter.uploadToneAudio === "function") {
        const beforeAudioPaths = audioStoragePathCount(uploadTone);
        uploadTone = await adapter.uploadToneAudio(uploadTone);
        const afterAudioPaths = audioStoragePathCount(uploadTone);
        if (afterAudioPaths > beforeAudioPaths) {
          const uploadedAudio = afterAudioPaths - beforeAudioPaths;
          executed.mediaUploaded += uploadedAudio;
          executed.audioUploaded += uploadedAudio;
          localById.set(action.toneId, uploadTone);
        }
      }
      if (uploadTone !== localTone) {
        await applyLocalTone(uploadTone);
      }
      await adapter.upsertTone(metadataToneDocument(uploadTone));
      executed.uploaded += 1;
      executed.uploadedTones.push(toneSummary(uploadTone, action.toneId));
      continue;
    }

    if (action.type === "apply_remote" || action.type === "apply_remote_delete") {
      const existing = localById.get(action.toneId);
      let remoteTone = action.tone;
      if (typeof adapter.downloadTonePhotos === "function") {
        const beforePhotoData = photoDataCount(remoteTone);
        remoteTone = await adapter.downloadTonePhotos(remoteTone);
        const afterPhotoData = photoDataCount(remoteTone);
        if (afterPhotoData > beforePhotoData) {
          const downloadedPhotos = afterPhotoData - beforePhotoData;
          executed.mediaDownloaded += downloadedPhotos;
          executed.photoDownloaded += downloadedPhotos;
        }
      }
      if (typeof adapter.downloadToneAudio === "function") {
        const beforeAudioData = audioDataCount(remoteTone);
        remoteTone = await adapter.downloadToneAudio(remoteTone);
        const afterAudioData = audioDataCount(remoteTone);
        if (afterAudioData > beforeAudioData) {
          const downloadedAudio = afterAudioData - beforeAudioData;
          executed.mediaDownloaded += downloadedAudio;
          executed.audioDownloaded += downloadedAudio;
        }
      }
      const merged = mergeRemoteMetadataWithLocalMedia(remoteTone, existing);
      await applyLocalTone(merged);
      if (action.type === "apply_remote_delete") {
        executed.deleted += 1;
        executed.deletedTones.push(toneSummary(merged, action.toneId));
      } else {
        executed.applied += 1;
        executed.downloadedTones.push(toneSummary(merged, action.toneId));
      }
      continue;
    }

    if (action.type === "purge_deleted") {
      if (action.source === "remote" && typeof adapter.purgeTone === "function") {
        await adapter.purgeTone(action.toneId);
        executed.purged += 1;
        executed.purgedToneIds.push(action.toneId);
      } else if (action.source === "local" && typeof deleteLocalTone === "function") {
        await deleteLocalTone(action.toneId);
        executed.purged += 1;
        executed.purgedToneIds.push(action.toneId);
      }
    }
  }

  return createSummary(plan, executed);
}

async function keepCloudConflict(options = {}) {
  const adapter = options.adapter;
  const conflict = options.conflict;
  const existingLocal = options.existingLocal;
  const applyLocalTone = options.applyLocalTone;

  if (!adapter) throw new Error("adapter is required.");
  if (!conflict?.toneId || !conflict.remoteTone) throw new Error("same-time conflict is required.");
  if (typeof applyLocalTone !== "function") throw new Error("applyLocalTone is required.");

  let remoteTone = conflict.remoteTone;
  if (typeof adapter.downloadTonePhotos === "function") {
    remoteTone = await adapter.downloadTonePhotos(remoteTone);
  }
  if (typeof adapter.downloadToneAudio === "function") {
    remoteTone = await adapter.downloadToneAudio(remoteTone);
  }
  const merged = mergeRemoteMetadataWithLocalMedia(remoteTone, existingLocal);
  await applyLocalTone(merged);
  return {
    tone: merged,
    summary: toneSummary(merged, conflict.toneId)
  };
}

async function keepThisDeviceConflict(options = {}) {
  const adapter = options.adapter;
  const conflict = options.conflict;
  const localTone = options.localTone || conflict?.localTone;
  const applyLocalTone = options.applyLocalTone;

  if (!adapter) throw new Error("adapter is required.");
  if (!conflict?.toneId || !localTone) throw new Error("same-time conflict is required.");
  if (typeof applyLocalTone !== "function") throw new Error("applyLocalTone is required.");

  let uploadTone = localTone;
  if (typeof adapter.uploadTonePhotos === "function") {
    uploadTone = await adapter.uploadTonePhotos(localTone);
  }
  if (typeof adapter.uploadToneAudio === "function") {
    uploadTone = await adapter.uploadToneAudio(uploadTone);
  }
  await applyLocalTone(uploadTone);
  await adapter.upsertTone(metadataToneDocument(uploadTone));
  return {
    tone: uploadTone,
    summary: toneSummary(uploadTone, conflict.toneId)
  };
}

const api = {
  metadataToneDocument,
  mergeRemoteMetadataWithLocalMedia,
  keepCloudConflict,
  keepThisDeviceConflict,
  runManualMetadataSync
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof globalThis !== "undefined") {
  globalThis.ToneRecallManualSync = api;
}
