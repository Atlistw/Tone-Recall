const test = require("node:test");
const assert = require("node:assert/strict");
const syncCore = require("../src/sync-core");
const {
  metadataToneDocument,
  mergeRemoteMetadataWithLocalMedia,
  runManualMetadataSync
} = require("../src/manual-sync");

const NOW = "2026-07-06T12:00:00.000Z";

function tone(id, updatedAt, extra = {}) {
  return {
    id,
    title: extra.title || `Tone ${id}`,
    description: extra.description || "",
    createdAt: extra.createdAt || "2026-07-01T00:00:00.000Z",
    updatedAt,
    photo: extra.photo || "data:image/jpeg;base64,LOCALPHOTO",
    photos: extra.photos || [{ id: "photo-1", name: "Board", data: "data:image/jpeg;base64,LOCALPHOTO" }],
    audio: extra.audio || "data:audio/wav;base64,LOCALAUDIO",
    audioType: "audio/wav",
    audioSize: 123,
    audioPeak: 0.5,
    pedals: extra.pedals || [],
    ...(extra.deletedAt ? { deletedAt: extra.deletedAt } : {})
  };
}

function remoteTone(id, updatedAt, extra = {}) {
  const data = metadataToneDocument(tone(id, updatedAt, extra));
  return {
    id,
    user_id: "user-1",
    data,
    created_at: data.createdAt,
    updated_at: updatedAt,
    deleted_at: extra.deletedAt || null,
    cloud_revision: extra.cloudRevision || 1,
    last_synced_at: NOW
  };
}

function fakeAdapter(remoteTones = []) {
  return {
    uploaded: [],
    undoSnapshots: [],
    purged: [],
    photoUploads: [],
    photoDownloads: [],
    async listRemoteTones() {
      return remoteTones;
    },
    async listUndoSnapshots() {
      return [];
    },
    async upsertTone(toneValue) {
      this.uploaded.push(toneValue);
      return remoteTone(toneValue.id, toneValue.updatedAt, toneValue);
    },
    async upsertUndoSnapshot(snapshot) {
      this.undoSnapshots.push(snapshot);
      return snapshot;
    },
    async purgeTone(toneId) {
      this.purged.push(toneId);
      return { toneId };
    },
    async uploadTonePhotos(toneValue) {
      const nextTone = JSON.parse(JSON.stringify(toneValue));
      nextTone.photos = (nextTone.photos || []).map((photo) => {
        if (!photo.data || photo.storagePath) return photo;
        const nextPhoto = {
          ...photo,
          storagePath: `user-1/${nextTone.id}/${photo.id}.jpg`,
          mimeType: "image/jpeg"
        };
        this.photoUploads.push(nextPhoto.storagePath);
        return nextPhoto;
      });
      return nextTone;
    },
    async downloadTonePhotos(toneValue) {
      const nextTone = JSON.parse(JSON.stringify(toneValue));
      nextTone.photos = (nextTone.photos || []).map((photo) => {
        if (photo.data || !photo.storagePath) return photo;
        this.photoDownloads.push(photo.storagePath);
        return {
          ...photo,
          data: "data:image/jpeg;base64,REMOTEPHOTO",
          mimeType: photo.mimeType || "image/jpeg"
        };
      });
      return nextTone;
    }
  };
}

test("metadataToneDocument strips local photo and audio payloads", () => {
  const metadata = metadataToneDocument(tone("a", "2026-07-06T10:00:00.000Z"));

  assert.equal(metadata.photo, undefined);
  assert.equal(metadata.audio, undefined);
  assert.deepEqual(metadata.photos, [{ id: "photo-1", name: "Board" }]);
  assert.equal(metadata.audioType, "audio/wav");
  assert.equal(metadata.title, "Tone a");
});

test("mergeRemoteMetadataWithLocalMedia applies remote fields but preserves local media", () => {
  const local = tone("a", "2026-07-06T09:00:00.000Z", { title: "Local title" });
  const remote = metadataToneDocument(tone("a", "2026-07-06T10:00:00.000Z", { title: "Remote title" }));

  const merged = mergeRemoteMetadataWithLocalMedia(remote, local);

  assert.equal(merged.title, "Remote title");
  assert.equal(merged.updatedAt, "2026-07-06T10:00:00.000Z");
  assert.equal(merged.photo, "data:image/jpeg;base64,LOCALPHOTO");
  assert.equal(merged.photos[0].data, "data:image/jpeg;base64,LOCALPHOTO");
  assert.equal(merged.audio, "data:audio/wav;base64,LOCALAUDIO");
});

test("manual metadata sync uploads local-only tone without media payloads", async () => {
  const adapter = fakeAdapter([]);
  const applied = [];

  const summary = await runManualMetadataSync({
    localTones: [tone("a", "2026-07-06T10:00:00.000Z")],
    adapter,
    syncCore,
    now: NOW,
    applyLocalTone: async (nextTone) => applied.push(nextTone)
  });

  assert.equal(summary.uploaded, 1);
  assert.equal(summary.applied, 0);
  assert.equal(summary.mediaUploaded, 1);
  assert.deepEqual(summary.uploadedTones, [{ id: "a", title: "Tone a", label: "Tone a" }]);
  assert.equal(adapter.uploaded[0].id, "a");
  assert.equal(adapter.uploaded[0].photo, undefined);
  assert.equal(adapter.uploaded[0].audio, undefined);
  assert.deepEqual(adapter.uploaded[0].photos, [{
    id: "photo-1",
    name: "Board",
    storagePath: "user-1/a/photo-1.jpg",
    mimeType: "image/jpeg"
  }]);
  assert.equal(applied[0].photos[0].storagePath, "user-1/a/photo-1.jpg");
});

test("manual metadata sync applies remote newer metadata and writes undo snapshot", async () => {
  const adapter = fakeAdapter([remoteTone("a", "2026-07-06T11:00:00.000Z", { title: "Remote newer" })]);
  const applied = [];

  const summary = await runManualMetadataSync({
    localTones: [tone("a", "2026-07-06T10:00:00.000Z", { title: "Local older" })],
    adapter,
    syncCore,
    now: NOW,
    applyLocalTone: async (nextTone) => applied.push(nextTone)
  });

  assert.equal(summary.applied, 1);
  assert.equal(summary.undoSnapshots, 1);
  assert.deepEqual(summary.downloadedTones, [{ id: "a", title: "Remote newer", label: "Remote newer" }]);
  assert.equal(adapter.undoSnapshots[0].toneId, "a");
  assert.equal(adapter.undoSnapshots[0].previousData.title, "Local older");
  assert.equal(adapter.undoSnapshots[0].previousData.photo, undefined);
  assert.equal(applied[0].title, "Remote newer");
  assert.equal(applied[0].photo, "data:image/jpeg;base64,LOCALPHOTO");
});

test("manual metadata sync downloads remote photo data from storage", async () => {
  const adapter = fakeAdapter([
    remoteTone("remote-photo", "2026-07-06T11:00:00.000Z", {
      title: "Remote photo",
      photos: [{
        id: "photo-remote",
        name: "Remote board",
        storagePath: "user-1/remote-photo/photo-remote.jpg",
        mimeType: "image/jpeg"
      }]
    })
  ]);
  const applied = [];

  const summary = await runManualMetadataSync({
    localTones: [],
    adapter,
    syncCore,
    now: NOW,
    applyLocalTone: async (nextTone) => applied.push(nextTone)
  });

  assert.equal(summary.applied, 1);
  assert.equal(summary.mediaDownloaded, 1);
  assert.equal(applied[0].photos[0].data, "data:image/jpeg;base64,REMOTEPHOTO");
  assert.deepEqual(adapter.photoDownloads, ["user-1/remote-photo/photo-remote.jpg"]);
});

test("manual metadata sync backfills photo storage for unchanged synced tone", async () => {
  const updatedAt = "2026-07-06T10:00:00.000Z";
  const adapter = fakeAdapter([remoteTone("a", updatedAt)]);
  const applied = [];

  const summary = await runManualMetadataSync({
    localTones: [tone("a", updatedAt)],
    adapter,
    syncCore,
    now: NOW,
    applyLocalTone: async (nextTone) => applied.push(nextTone)
  });

  assert.equal(summary.uploaded, 1);
  assert.equal(summary.mediaUploaded, 1);
  assert.equal(adapter.uploaded[0].photos[0].storagePath, "user-1/a/photo-1.jpg");
  assert.equal(applied[0].photos[0].storagePath, "user-1/a/photo-1.jpg");
});

test("manual metadata sync surfaces delete/edit conflicts without applying or uploading", async () => {
  const adapter = fakeAdapter([
    remoteTone("a", "2026-07-06T10:00:00.000Z", {
      title: "Remote deleted",
      deletedAt: "2026-07-06T10:00:00.000Z"
    })
  ]);
  const applied = [];

  const summary = await runManualMetadataSync({
    localTones: [tone("a", "2026-07-06T11:00:00.000Z", { title: "Edited after delete" })],
    adapter,
    syncCore,
    now: NOW,
    applyLocalTone: async (nextTone) => applied.push(nextTone)
  });

  assert.equal(summary.conflicts.length, 1);
  assert.equal(summary.conflicts[0].type, "delete_edit");
  assert.equal(summary.uploaded, 0);
  assert.equal(summary.applied, 0);
  assert.deepEqual(applied, []);
  assert.deepEqual(adapter.uploaded, []);
});
