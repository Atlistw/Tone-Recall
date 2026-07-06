function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

  if (Object.prototype.hasOwnProperty.call(existing, "photos")) {
    merged.photos = clone(existing.photos);
  }

  if (Object.prototype.hasOwnProperty.call(existing, "audio")) {
    merged.audio = existing.audio;
  } else {
    delete merged.audio;
  }

  for (const key of ["audioType", "audioSize", "audioPeak"]) {
    if (Object.prototype.hasOwnProperty.call(existing, key)) {
      merged[key] = existing[key];
    }
  }

  return merged;
}

function createSummary(plan, executed) {
  return {
    uploaded: executed.uploaded,
    applied: executed.applied,
    deleted: executed.deleted,
    purged: executed.purged,
    undoSnapshots: executed.undoSnapshots,
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

  const remoteTones = await adapter.listRemoteTones();
  const undoSnapshots = typeof adapter.listUndoSnapshots === "function"
    ? await adapter.listUndoSnapshots()
    : [];

  const localById = new Map(localTones.map((tone) => [tone.id, tone]));
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

  const executed = {
    uploaded: 0,
    applied: 0,
    deleted: 0,
    purged: 0,
    undoSnapshots: 0
  };

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
      await adapter.upsertTone(metadataToneDocument(localTone));
      executed.uploaded += 1;
      continue;
    }

    if (action.type === "apply_remote" || action.type === "apply_remote_delete") {
      const existing = localById.get(action.toneId);
      const merged = mergeRemoteMetadataWithLocalMedia(action.tone, existing);
      await applyLocalTone(merged);
      if (action.type === "apply_remote_delete") {
        executed.deleted += 1;
      } else {
        executed.applied += 1;
      }
      continue;
    }

    if (action.type === "purge_deleted") {
      if (action.source === "remote" && typeof adapter.purgeTone === "function") {
        await adapter.purgeTone(action.toneId);
        executed.purged += 1;
      } else if (action.source === "local" && typeof deleteLocalTone === "function") {
        await deleteLocalTone(action.toneId);
        executed.purged += 1;
      }
    }
  }

  return createSummary(plan, executed);
}

const api = {
  metadataToneDocument,
  mergeRemoteMetadataWithLocalMedia,
  runManualMetadataSync
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof globalThis !== "undefined") {
  globalThis.ToneRecallManualSync = api;
}
