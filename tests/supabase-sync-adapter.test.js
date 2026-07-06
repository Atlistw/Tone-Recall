const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PHOTO_BUCKET,
  createSupabaseSyncAdapter,
  localToneToToneRow,
  toneRowToRemoteTone,
  undoRowToSnapshot,
  undoSnapshotToRow
} = require("../src/supabase-sync-adapter");

const NOW = "2026-07-06T12:00:00.000Z";
const USER_ID = "00000000-0000-4000-8000-000000000001";

class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.operation = "select";
    this.filters = [];
    this.orders = [];
    this.columns = null;
    this.payload = null;
    this.options = null;
    this.singleResult = false;
  }

  select(columns) {
    this.operation = this.operation === "select" ? "select" : this.operation;
    this.columns = columns;
    return this;
  }

  upsert(payload, options) {
    this.operation = "upsert";
    this.payload = payload;
    this.options = options || {};
    return this;
  }

  update(payload) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column, value) {
    this.filters.push({ column, value });
    return this;
  }

  order(column, options) {
    this.orders.push({ column, options });
    return this;
  }

  single() {
    this.singleResult = true;
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve(this.client.execute(this)).then(resolve, reject);
  }
}

class FakeSupabaseClient {
  constructor(resolvers = {}) {
    this.resolvers = resolvers;
    this.queries = [];
    this.storageOperations = [];
    this.storage = {
      from: (bucket) => ({
        upload: (path, body, options) => {
          this.storageOperations.push({ bucket, operation: "upload", path, body, options });
          const resolver = this.resolvers.storageUpload || this.resolvers.storage || this.resolvers.defaultStorage;
          return Promise.resolve(resolver
            ? resolver({ bucket, path, body, options })
            : { data: { path }, error: null });
        },
        download: (path) => {
          this.storageOperations.push({ bucket, operation: "download", path });
          const resolver = this.resolvers.storageDownload || this.resolvers.storage || this.resolvers.defaultStorage;
          return Promise.resolve(resolver
            ? resolver({ bucket, path })
            : { data: new Blob(["PHOTO"], { type: "image/jpeg" }), error: null });
        }
      })
    };
  }

  from(table) {
    return new FakeQuery(this, table);
  }

  execute(query) {
    this.queries.push({
      table: query.table,
      operation: query.operation,
      filters: query.filters,
      orders: query.orders,
      columns: query.columns,
      payload: query.payload,
      options: query.options,
      singleResult: query.singleResult
    });

    const resolver = this.resolvers[query.operation] || this.resolvers[query.table] || this.resolvers.default;
    if (resolver) {
      return resolver(query);
    }
    return { data: query.singleResult ? query.payload : [], error: null };
  }
}

function tone(overrides = {}) {
  return {
    id: "tone-1",
    title: "Edge of breakup",
    description: "Bridge pickup",
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-06T10:00:00.000Z",
    ...overrides
  };
}

function row(overrides = {}) {
  return {
    id: "tone-1",
    user_id: USER_ID,
    data: tone(),
    created_at: "2026-07-01T08:00:00.000Z",
    updated_at: "2026-07-06T10:00:00.000Z",
    deleted_at: null,
    cloud_revision: 3,
    last_synced_at: NOW,
    ...overrides
  };
}

test("localToneToToneRow maps local tone to public.tones row", () => {
  const mapped = localToneToToneRow(tone({ cloudRevision: 7 }), USER_ID, { now: NOW });

  assert.equal(mapped.id, "tone-1");
  assert.equal(mapped.user_id, USER_ID);
  assert.equal(mapped.created_at, "2026-07-01T08:00:00.000Z");
  assert.equal(mapped.updated_at, "2026-07-06T10:00:00.000Z");
  assert.equal(mapped.deleted_at, null);
  assert.equal(mapped.cloud_revision, 7);
  assert.equal(mapped.last_synced_at, NOW);
  assert.equal(mapped.data.id, "tone-1");
  assert.equal(mapped.data.updatedAt, "2026-07-06T10:00:00.000Z");
});

test("localToneToToneRow preserves soft delete metadata", () => {
  const mapped = localToneToToneRow(tone({ deletedAt: "2026-07-06T11:00:00.000Z" }), USER_ID, { now: NOW });

  assert.equal(mapped.deleted_at, "2026-07-06T11:00:00.000Z");
  assert.equal(mapped.data.deletedAt, "2026-07-06T11:00:00.000Z");
});

test("toneRowToRemoteTone maps Supabase row into sync-core remote shape", () => {
  const remote = toneRowToRemoteTone(row());

  assert.equal(remote.id, "tone-1");
  assert.equal(remote.user_id, USER_ID);
  assert.equal(remote.updated_at, "2026-07-06T10:00:00.000Z");
  assert.equal(remote.deleted_at, null);
  assert.equal(remote.cloud_revision, 3);
  assert.equal(remote.data.title, "Edge of breakup");
});

test("undo snapshot mapping round trips schema field names", () => {
  const snapshot = {
    toneId: "tone-1",
    previousData: tone({ title: "Before remote overwrite" }),
    previousUpdatedAt: "2026-07-06T09:00:00.000Z",
    capturedAt: NOW,
    reason: "apply_remote"
  };

  const rowValue = undoSnapshotToRow(snapshot, USER_ID);
  assert.deepEqual(Object.keys(rowValue).sort(), [
    "captured_at",
    "previous_data",
    "previous_updated_at",
    "reason",
    "tone_id",
    "user_id"
  ]);

  const roundTrip = undoRowToSnapshot(rowValue);
  assert.equal(roundTrip.toneId, "tone-1");
  assert.equal(roundTrip.userId, USER_ID);
  assert.equal(roundTrip.previousData.title, "Before remote overwrite");
  assert.equal(roundTrip.previousUpdatedAt, "2026-07-06T09:00:00.000Z");
  assert.equal(roundTrip.reason, "apply_remote");
});

test("adapter lists remote tones with user filter and updated order", async () => {
  const client = new FakeSupabaseClient({
    select(query) {
      assert.equal(query.table, "tones");
      return { data: [row()], error: null };
    }
  });
  const adapter = createSupabaseSyncAdapter(client, { userId: USER_ID, now: NOW });

  const tones = await adapter.listRemoteTones();

  assert.equal(tones.length, 1);
  assert.equal(tones[0].id, "tone-1");
  assert.deepEqual(client.queries[0].filters, [{ column: "user_id", value: USER_ID }]);
  assert.deepEqual(client.queries[0].orders, [{ column: "updated_at", options: { ascending: false } }]);
});

test("adapter upserts tone metadata without media upload", async () => {
  const client = new FakeSupabaseClient({
    upsert(query) {
      assert.equal(query.table, "tones");
      assert.deepEqual(query.options, { onConflict: "id" });
      assert.equal(query.payload.user_id, USER_ID);
      assert.equal(query.payload.data.title, "Edge of breakup");
      return { data: { ...query.payload, cloud_revision: 5 }, error: null };
    }
  });
  const adapter = createSupabaseSyncAdapter(client, { userId: USER_ID, now: NOW });

  const remote = await adapter.upsertTone(tone());

  assert.equal(remote.id, "tone-1");
  assert.equal(remote.cloud_revision, 5);
  assert.equal(client.queries[0].singleResult, true);
});

test("adapter uploads local photo data to private storage", async () => {
  const client = new FakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client, { userId: USER_ID, now: NOW });

  const withPhoto = await adapter.uploadTonePhotos(tone({
    photos: [{
      id: "photo-1",
      name: "Board",
      data: "data:image/jpeg;base64,UEhPVE8="
    }]
  }));

  assert.equal(withPhoto.photos[0].storagePath, `${USER_ID}/tone-1/photo-1.jpg`);
  assert.equal(withPhoto.photos[0].mimeType, "image/jpeg");
  assert.equal(client.storageOperations[0].bucket, PHOTO_BUCKET);
  assert.equal(client.storageOperations[0].operation, "upload");
  assert.equal(client.storageOperations[0].path, `${USER_ID}/tone-1/photo-1.jpg`);
  assert.equal(client.storageOperations[0].options.contentType, "image/jpeg");
  assert.equal(client.storageOperations[0].options.upsert, true);
});

test("adapter downloads remote photo data from private storage", async () => {
  const client = new FakeSupabaseClient({
    storageDownload({ path }) {
      assert.equal(path, `${USER_ID}/tone-1/photo-1.jpg`);
      return { data: new Blob(["PHOTO"], { type: "image/jpeg" }), error: null };
    }
  });
  const adapter = createSupabaseSyncAdapter(client, { userId: USER_ID, now: NOW });

  const withPhoto = await adapter.downloadTonePhotos(tone({
    photos: [{
      id: "photo-1",
      name: "Board",
      storagePath: `${USER_ID}/tone-1/photo-1.jpg`,
      mimeType: "image/jpeg"
    }]
  }));

  assert.match(withPhoto.photos[0].data, /^data:image\/jpeg;base64,/);
  assert.equal(client.storageOperations[0].bucket, PHOTO_BUCKET);
  assert.equal(client.storageOperations[0].operation, "download");
});

test("adapter writes soft delete as metadata update", async () => {
  const deletedAt = "2026-07-06T11:30:00.000Z";
  const client = new FakeSupabaseClient({
    update(query) {
      assert.equal(query.table, "tones");
      assert.deepEqual(query.payload, {
        deleted_at: deletedAt,
        updated_at: deletedAt,
        last_synced_at: NOW
      });
      return { data: row({ deleted_at: deletedAt, updated_at: deletedAt, data: tone({ deletedAt }) }), error: null };
    }
  });
  const adapter = createSupabaseSyncAdapter(client, { userId: USER_ID, now: NOW });

  const remote = await adapter.softDeleteTone("tone-1", deletedAt);

  assert.equal(remote.deleted_at, deletedAt);
  assert.deepEqual(client.queries[0].filters, [
    { column: "id", value: "tone-1" },
    { column: "user_id", value: USER_ID }
  ]);
});

test("adapter can purge old deleted tone metadata", async () => {
  const client = new FakeSupabaseClient({
    delete(query) {
      assert.equal(query.table, "tones");
      return { data: null, error: null };
    }
  });
  const adapter = createSupabaseSyncAdapter(client, { userId: USER_ID, now: NOW });

  const result = await adapter.purgeTone("tone-1");

  assert.deepEqual(result, { toneId: "tone-1" });
  assert.deepEqual(client.queries[0].filters, [
    { column: "id", value: "tone-1" },
    { column: "user_id", value: USER_ID }
  ]);
});

test("adapter lists and upserts undo snapshots", async () => {
  const snapshotRow = undoSnapshotToRow({
    toneId: "tone-1",
    previousData: tone({ title: "Previous" }),
    previousUpdatedAt: "2026-07-06T09:00:00.000Z",
    capturedAt: NOW,
    reason: "apply_remote"
  }, USER_ID);

  const client = new FakeSupabaseClient({
    select(query) {
      assert.equal(query.table, "tone_undo_snapshots");
      return { data: [snapshotRow], error: null };
    },
    upsert(query) {
      assert.equal(query.table, "tone_undo_snapshots");
      assert.deepEqual(query.options, { onConflict: "user_id,tone_id" });
      return { data: query.payload, error: null };
    }
  });
  const adapter = createSupabaseSyncAdapter(client, { userId: USER_ID, now: NOW });

  const snapshots = await adapter.listUndoSnapshots();
  const saved = await adapter.upsertUndoSnapshot(snapshots[0]);

  assert.equal(snapshots[0].toneId, "tone-1");
  assert.equal(saved.previousData.title, "Previous");
  assert.deepEqual(client.queries[0].filters, [{ column: "user_id", value: USER_ID }]);
});

test("adapter surfaces Supabase errors", async () => {
  const supabaseError = new Error("RLS rejected write");
  const client = new FakeSupabaseClient({
    upsert() {
      return { data: null, error: supabaseError };
    }
  });
  const adapter = createSupabaseSyncAdapter(client, { userId: USER_ID, now: NOW });

  await assert.rejects(() => adapter.upsertTone(tone()), /RLS rejected write/);
});
