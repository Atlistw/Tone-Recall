const test = require("node:test");
const assert = require("node:assert/strict");
const { planToneSync } = require("../src/sync-core");

const NOW = "2026-07-06T12:00:00.000Z";

function localTone(id, updatedAt, extra = {}) {
  return {
    id,
    title: extra.title || "Tone " + id,
    description: extra.description || "",
    updatedAt,
    createdAt: extra.createdAt || "2026-07-01T00:00:00.000Z",
    ...(extra.deletedAt ? { deletedAt: extra.deletedAt } : {}),
    ...(extra.source ? { source: extra.source } : {})
  };
}

function remoteTone(id, updatedAt, extra = {}) {
  const data = {
    id,
    title: extra.title || "Tone " + id,
    description: extra.description || "",
    updatedAt,
    createdAt: extra.createdAt || "2026-07-01T00:00:00.000Z",
    ...(extra.deletedAt ? { deletedAt: extra.deletedAt } : {})
  };
  return {
    id,
    user_id: extra.userId || "user-1",
    data,
    updated_at: updatedAt,
    deleted_at: extra.deletedAt || null,
    cloud_revision: extra.cloudRevision || 1
  };
}

function actionTypes(result) {
  return result.actions.map((action) => action.type);
}

test("local-only tone should produce upload action", () => {
  const result = planToneSync({
    localTones: [localTone("a", "2026-07-06T10:00:00.000Z")],
    remoteTones: [],
    now: NOW
  });

  assert.deepEqual(actionTypes(result), ["upload"]);
  assert.equal(result.actions[0].reason, "local-only");
  assert.equal(result.actions[0].toneId, "a");
  assert.equal(result.conflicts.length, 0);
});

test("remote-only tone should produce download/apply action", () => {
  const result = planToneSync({
    localTones: [],
    remoteTones: [remoteTone("a", "2026-07-06T10:00:00.000Z")],
    now: NOW
  });

  assert.deepEqual(actionTypes(result), ["apply_remote"]);
  assert.equal(result.actions[0].reason, "remote-only");
  assert.equal(result.actions[0].tone.title, "Tone a");
});

test("same tone unchanged should produce no action", () => {
  const updatedAt = "2026-07-06T10:00:00.000Z";
  const result = planToneSync({
    localTones: [localTone("a", updatedAt)],
    remoteTones: [remoteTone("a", updatedAt)],
    now: NOW
  });

  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.newUndoSnapshots, []);
});

test("remote newer tone should apply remote and create undo snapshot", () => {
  const result = planToneSync({
    localTones: [localTone("a", "2026-07-06T09:00:00.000Z", { title: "Old local" })],
    remoteTones: [remoteTone("a", "2026-07-06T10:00:00.000Z", { title: "New remote" })],
    now: NOW
  });

  assert.deepEqual(actionTypes(result), ["apply_remote"]);
  assert.equal(result.actions[0].tone.title, "New remote");
  assert.equal(result.newUndoSnapshots.length, 1);
  assert.equal(result.newUndoSnapshots[0].toneId, "a");
  assert.equal(result.newUndoSnapshots[0].previousData.title, "Old local");
  assert.equal(result.undoSnapshots.length, 1);
});

test("local newer tone should produce upload action", () => {
  const result = planToneSync({
    localTones: [localTone("a", "2026-07-06T11:00:00.000Z", { title: "New local" })],
    remoteTones: [remoteTone("a", "2026-07-06T10:00:00.000Z", { title: "Old remote" })],
    now: NOW
  });

  assert.deepEqual(actionTypes(result), ["upload"]);
  assert.equal(result.actions[0].reason, "local-newer");
  assert.equal(result.actions[0].tone.title, "New local");
});

test("remote soft-deleted newer than local should apply delete and create undo snapshot", () => {
  const result = planToneSync({
    localTones: [localTone("a", "2026-07-06T09:00:00.000Z", { title: "Local before delete" })],
    remoteTones: [remoteTone("a", "2026-07-06T10:00:00.000Z", {
      title: "Deleted remote",
      deletedAt: "2026-07-06T10:00:00.000Z"
    })],
    now: NOW
  });

  assert.deepEqual(actionTypes(result), ["apply_remote_delete"]);
  assert.equal(result.actions[0].reason, "remote-delete-newer");
  assert.equal(result.newUndoSnapshots.length, 1);
  assert.equal(result.newUndoSnapshots[0].previousData.title, "Local before delete");
});

test("local edit newer than remote delete should produce delete/edit conflict", () => {
  const result = planToneSync({
    localTones: [localTone("a", "2026-07-06T11:00:00.000Z", { title: "Edited after delete" })],
    remoteTones: [remoteTone("a", "2026-07-06T10:00:00.000Z", {
      title: "Deleted remote",
      deletedAt: "2026-07-06T10:00:00.000Z"
    })],
    now: NOW
  });

  assert.deepEqual(result.actions, []);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, "delete_edit");
  assert.deepEqual(result.conflicts[0].choices, ["restore_local", "keep_remote_delete"]);
});

test("deleted tone older than 7 days should produce purge candidate and action", () => {
  const result = planToneSync({
    localTones: [],
    remoteTones: [remoteTone("a", "2026-06-20T10:00:00.000Z", {
      deletedAt: "2026-06-20T10:00:00.000Z"
    })],
    now: NOW
  });

  assert.equal(result.purgeCandidates.length, 1);
  assert.equal(result.purgeCandidates[0].toneId, "a");
  assert.ok(result.actions.some((action) => action.type === "purge_deleted" && action.toneId === "a"));
});

test("existing undo snapshot for same tone should be replaced, not duplicated", () => {
  const result = planToneSync({
    localTones: [localTone("a", "2026-07-06T09:00:00.000Z", { title: "Undo me" })],
    remoteTones: [remoteTone("a", "2026-07-06T10:00:00.000Z", { title: "Remote wins" })],
    undoSnapshots: [{
      toneId: "a",
      previousData: { id: "a", title: "Older undo" },
      previousUpdatedAt: "2026-07-05T00:00:00.000Z",
      capturedAt: "2026-07-05T01:00:00.000Z",
      reason: "previous"
    }],
    now: NOW
  });

  assert.equal(result.undoSnapshots.length, 1);
  assert.equal(result.undoSnapshots[0].toneId, "a");
  assert.equal(result.undoSnapshots[0].previousData.title, "Undo me");
});

test("JSON-imported local tone while signed in is classified as local-only upload candidate", () => {
  const imported = localTone("imported-a", "2026-07-06T10:00:00.000Z", {
    title: "Imported local tone",
    source: "json-import"
  });
  const result = planToneSync({
    localTones: [imported],
    remoteTones: [],
    now: NOW
  });

  assert.deepEqual(actionTypes(result), ["upload"]);
  assert.equal(result.actions[0].toneId, "imported-a");
  assert.equal(result.actions[0].reason, "local-only");
  assert.equal(result.actions[0].tone.title, "Imported local tone");
});
