const DEFAULT_RECYCLE_BIN_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function timestampMs(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactToneDocument(data, id, updatedAt, deletedAt) {
  const document = clone(data || {});
  document.id = id || document.id;
  document.updatedAt = updatedAt || document.updatedAt || document.updated_at;
  delete document.updated_at;

  const effectiveDeletedAt = deletedAt || document.deletedAt || document.deleted_at || null;
  delete document.deleted_at;
  if (effectiveDeletedAt) {
    document.deletedAt = effectiveDeletedAt;
  } else {
    delete document.deletedAt;
  }

  return document;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function sameToneDocument(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function normalizeLocalTone(tone) {
  if (!tone || typeof tone !== "object") {
    throw new TypeError("Local tone must be an object.");
  }

  const id = tone.id;
  if (!id) throw new Error("Local tone is missing id.");

  const updatedAt = tone.updatedAt || tone.updated_at || tone.createdAt || tone.created_at;
  const deletedAt = tone.deletedAt || tone.deleted_at || null;
  return {
    id,
    source: "local",
    userId: tone.userId || tone.user_id || null,
    updatedAt,
    updatedMs: timestampMs(updatedAt),
    deletedAt,
    deletedMs: timestampMs(deletedAt),
    data: compactToneDocument(tone, id, updatedAt, deletedAt)
  };
}

function normalizeRemoteTone(row) {
  if (!row || typeof row !== "object") {
    throw new TypeError("Remote tone must be an object.");
  }

  const rawData = row.data && typeof row.data === "object" ? row.data : {};
  const id = row.id || rawData.id;
  if (!id) throw new Error("Remote tone is missing id.");

  const updatedAt = rawData.updatedAt || rawData.updated_at || row.updated_at || row.updatedAt || row.created_at || row.createdAt;
  const deletedAt = rawData.deletedAt || rawData.deleted_at || row.deleted_at || row.deletedAt || null;
  return {
    id,
    source: "remote",
    userId: row.user_id || row.userId || null,
    cloudRevision: row.cloud_revision ?? row.cloudRevision ?? null,
    updatedAt,
    updatedMs: timestampMs(updatedAt),
    deletedAt,
    deletedMs: timestampMs(deletedAt),
    data: compactToneDocument(rawData, id, updatedAt, deletedAt),
    row: clone(row)
  };
}

function deletedAgeMs(tone, now) {
  if (!tone.deletedMs) return 0;
  return timestampMs(now) - tone.deletedMs;
}

function isPurgeCandidate(tone, now, recycleBinDays) {
  return Boolean(tone.deletedAt && deletedAgeMs(tone, now) >= recycleBinDays * MS_PER_DAY);
}

function createUndoSnapshot(localTone, reason, capturedAt) {
  return {
    toneId: localTone.id,
    userId: localTone.userId,
    previousData: clone(localTone.data),
    previousUpdatedAt: localTone.updatedAt,
    capturedAt,
    reason
  };
}

function normalizeUndoSnapshots(snapshots) {
  const byToneId = new Map();
  for (const snapshot of snapshots || []) {
    if (!snapshot) continue;
    const toneId = snapshot.toneId || snapshot.tone_id;
    if (!toneId) continue;
    byToneId.set(toneId, { ...clone(snapshot), toneId });
  }
  return byToneId;
}

function mergeUndoSnapshot(snapshotMap, snapshot) {
  snapshotMap.set(snapshot.toneId, snapshot);
}

function byId(items, normalizer) {
  const map = new Map();
  for (const item of items || []) {
    const normalized = normalizer(item);
    map.set(normalized.id, normalized);
  }
  return map;
}

function addPurgeCandidate(tone, result) {
  if (result.purgeCandidates.some((candidate) => candidate.toneId === tone.id && candidate.source === tone.source)) {
    return;
  }

  const candidate = {
    toneId: tone.id,
    source: tone.source,
    deletedAt: tone.deletedAt
  };
  result.purgeCandidates.push(candidate);
  result.actions.push({
    type: "purge_deleted",
    toneId: tone.id,
    source: tone.source,
    deletedAt: tone.deletedAt
  });
}

function planToneSync(options = {}) {
  const now = options.now || new Date().toISOString();
  const recycleBinDays = options.recycleBinDays ?? DEFAULT_RECYCLE_BIN_DAYS;
  const localById = byId(options.localTones || [], normalizeLocalTone);
  const remoteById = byId(options.remoteTones || [], normalizeRemoteTone);
  const undoByToneId = normalizeUndoSnapshots(options.undoSnapshots || []);
  const result = {
    actions: [],
    conflicts: [],
    undoSnapshots: [],
    newUndoSnapshots: [],
    purgeCandidates: []
  };

  const toneIds = [...new Set([...localById.keys(), ...remoteById.keys()])].sort();

  for (const toneId of toneIds) {
    const localTone = localById.get(toneId);
    const remoteTone = remoteById.get(toneId);

    if (localTone && isPurgeCandidate(localTone, now, recycleBinDays)) {
      addPurgeCandidate(localTone, result);
    }
    if (remoteTone && isPurgeCandidate(remoteTone, now, recycleBinDays)) {
      addPurgeCandidate(remoteTone, result);
    }

    if (localTone && !remoteTone) {
      result.actions.push({
        type: "upload",
        toneId,
        reason: "local-only",
        tone: clone(localTone.data)
      });
      continue;
    }

    if (!localTone && remoteTone) {
      result.actions.push({
        type: remoteTone.deletedAt ? "apply_remote_delete" : "apply_remote",
        toneId,
        reason: "remote-only",
        tone: clone(remoteTone.data),
        remote: clone(remoteTone.row)
      });
      continue;
    }

    if (!localTone || !remoteTone) continue;

    if (sameToneDocument(localTone.data, remoteTone.data)) {
      continue;
    }

    if (remoteTone.deletedAt && localTone.updatedMs > remoteTone.deletedMs) {
      result.conflicts.push({
        type: "delete_edit",
        toneId,
        localTone: clone(localTone.data),
        remoteTone: clone(remoteTone.data),
        remoteDeletedAt: remoteTone.deletedAt,
        choices: ["restore_local", "keep_remote_delete"]
      });
      continue;
    }

    if (remoteTone.updatedMs > localTone.updatedMs || (remoteTone.deletedAt && remoteTone.deletedMs > localTone.updatedMs)) {
      const actionType = remoteTone.deletedAt ? "apply_remote_delete" : "apply_remote";
      result.actions.push({
        type: actionType,
        toneId,
        reason: remoteTone.deletedAt ? "remote-delete-newer" : "remote-newer",
        tone: clone(remoteTone.data),
        remote: clone(remoteTone.row)
      });
      const undo = createUndoSnapshot(localTone, actionType, now);
      mergeUndoSnapshot(undoByToneId, undo);
      result.newUndoSnapshots.push(undo);
      continue;
    }

    if (localTone.updatedMs > remoteTone.updatedMs) {
      result.actions.push({
        type: "upload",
        toneId,
        reason: "local-newer",
        tone: clone(localTone.data),
        remote: clone(remoteTone.row)
      });
      continue;
    }

    result.conflicts.push({
      type: "same_timestamp_difference",
      toneId,
      localTone: clone(localTone.data),
      remoteTone: clone(remoteTone.data),
      choices: ["upload_local", "apply_remote"]
    });
  }

  result.undoSnapshots = [...undoByToneId.values()].sort((left, right) => left.toneId.localeCompare(right.toneId));
  result.newUndoSnapshots.sort((left, right) => left.toneId.localeCompare(right.toneId));
  result.actions.sort((left, right) => (left.toneId || "").localeCompare(right.toneId || "") || left.type.localeCompare(right.type));
  result.conflicts.sort((left, right) => left.toneId.localeCompare(right.toneId));
  result.purgeCandidates.sort((left, right) => left.toneId.localeCompare(right.toneId) || left.source.localeCompare(right.source));
  return result;
}

const syncCoreApi = {
  DEFAULT_RECYCLE_BIN_DAYS,
  normalizeLocalTone,
  normalizeRemoteTone,
  planToneSync,
  sameToneDocument
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = syncCoreApi;
}

if (typeof globalThis !== "undefined") {
  globalThis.ToneRecallSyncCore = syncCoreApi;
}
