function remoteRowToTone(row) {
  if (!row || typeof row !== "object") {
    throw new TypeError("Remote row must be an object.");
  }

  const data = row.data && typeof row.data === "object" ? { ...row.data } : {};
  const id = row.id || data.id;
  const updatedAt = data.updatedAt || row.updated_at || row.updatedAt;
  const deletedAt = data.deletedAt || row.deleted_at || row.deletedAt || null;

  return {
    ...data,
    id,
    updatedAt,
    ...(deletedAt ? { deletedAt } : {}),
    cloudRevision: row.cloud_revision ?? row.cloudRevision ?? null
  };
}

function toneToRemoteUpsert(tone, userId) {
  if (!tone || typeof tone !== "object") {
    throw new TypeError("Tone must be an object.");
  }
  if (!tone.id) throw new Error("Tone is missing id.");
  if (!userId) throw new Error("userId is required.");

  return {
    id: tone.id,
    user_id: userId,
    data: { ...tone },
    created_at: tone.createdAt || tone.updatedAt,
    updated_at: tone.updatedAt,
    deleted_at: tone.deletedAt || null,
    last_synced_at: new Date().toISOString()
  };
}

module.exports = {
  remoteRowToTone,
  toneToRemoteUpsert
};
