const DB_NAME = "tone-recall-capture";
const STORE = "tones";
const SUPABASE_CDN_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

const state = {
  tones: [],
  activeId: null,
  activePedalId: null,
  activePhotoId: null,
  audioStream: null,
  audioContext: null,
  audioProcessor: null,
  audioSource: null,
  audioChunks: [],
  audioLength: 0,
  audioSampleRate: 44100,
  audioPeak: 0,
  isRecording: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  panning: false,
  panStartX: 0,
  panStartY: 0,
  supabaseClient: null,
  authSession: null,
  authConfigured: false,
  authLoading: false,
  syncLoading: false
};

const els = {
  libraryView: document.getElementById("libraryView"),
  detailView: document.getElementById("detailView"),
  toneGrid: document.getElementById("toneGrid"),
  libraryCount: document.getElementById("libraryCount"),
  searchInput: document.getElementById("searchInput"),
  authPanel: document.getElementById("authPanel"),
  authSignedOut: document.getElementById("authSignedOut"),
  authSignedIn: document.getElementById("authSignedIn"),
  authEmailInput: document.getElementById("authEmailInput"),
  authSendButton: document.getElementById("authSendButton"),
  authSyncButton: document.getElementById("authSyncButton"),
  authLogoutButton: document.getElementById("authLogoutButton"),
  authStatus: document.getElementById("authStatus"),
  authUserEmail: document.getElementById("authUserEmail"),
  matchedTags: document.getElementById("matchedTags"),
  saveToneButton: document.getElementById("saveToneButton"),
  exportButton: document.getElementById("exportButton"),
  importInput: document.getElementById("importInput"),
  backButton: document.getElementById("backButton"),
  doneButton: document.getElementById("doneButton"),
  photoInput: document.getElementById("photoInput"),
  pastePhotoButton: document.getElementById("pastePhotoButton"),
  removePhotoButton: document.getElementById("removePhotoButton"),
  tonePhoto: document.getElementById("tonePhoto"),
  photoFrame: document.getElementById("photoFrame"),
  photoStrip: document.getElementById("photoStrip"),
  photoEmpty: document.getElementById("photoEmpty"),
  zoomOutButton: document.getElementById("zoomOutButton"),
  zoomResetButton: document.getElementById("zoomResetButton"),
  zoomInButton: document.getElementById("zoomInButton"),
  titleInput: document.getElementById("titleInput"),
  descriptionInput: document.getElementById("descriptionInput"),
  detailTags: document.getElementById("detailTags"),
  recordButton: document.getElementById("recordButton"),
  audioInput: document.getElementById("audioInput"),
  audioStatus: document.getElementById("audioStatus"),
  audioPlayer: document.getElementById("audioPlayer"),
  downloadAudioLink: document.getElementById("downloadAudioLink"),
  deleteAudioButton: document.getElementById("deleteAudioButton"),
  deleteToneButton: document.getElementById("deleteToneButton"),
  pedalInput: document.getElementById("pedalInput"),
  addPedalButton: document.getElementById("addPedalButton"),
  pedalList: document.getElementById("pedalList"),
  pedalEditor: document.getElementById("pedalEditor"),
  selectedPedalName: document.getElementById("selectedPedalName"),
  addKnobButton: document.getElementById("addKnobButton"),
  knobList: document.getElementById("knobList")
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(tone) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(tone);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function dbAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function newTone() {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    title: "",
    description: "",
    photo: "",
    audio: null,
    audioType: "",
    audioSize: 0,
    audioPeak: 0,
    pedals: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function activeTone() {
  return state.tones.find((tone) => tone.id === state.activeId);
}

function activePedal() {
  const tone = activeTone();
  return tone?.pedals?.find((pedal) => pedal.id === state.activePedalId);
}

function activePhoto() {
  const tone = activeTone();
  if (!tone) return null;
  normalizeTone(tone);
  return tone.photos.find((photo) => photo.id === state.activePhotoId) || tone.photos[0] || null;
}

function makePhoto(data = "", name = "Photo") {
  return {
    id: crypto.randomUUID(),
    name,
    data
  };
}

function makePedal(name = "") {
  return {
    id: crypto.randomUUID(),
    name: name || "New pedal",
    knobs: []
  };
}

function makeKnob(index) {
  return {
    id: crypto.randomUUID(),
    name: `Knob ${index}`,
    value: ""
  };
}

function normalizeTone(tone) {
  if (!tone || typeof tone !== "object") return tone;
  const existingPhotos = Array.isArray(tone.photos) ? tone.photos : [];
  tone.photos = existingPhotos
    .map((photo, index) => {
      if (typeof photo === "string") return makePhoto(photo, `Photo ${index + 1}`);
      return {
        id: photo.id || crypto.randomUUID(),
        name: photo.name || `Photo ${index + 1}`,
        data: photo.data || photo.src || ""
      };
    })
    .filter((photo) => photo.data);
  if (!tone.photos.length && typeof tone.photo === "string" && tone.photo) {
    tone.photos.push(makePhoto(tone.photo, "Photo 1"));
  }
  tone.photo = tone.photos[0]?.data || "";

  tone.pedals = (tone.pedals || []).map((pedal) => {
    if (typeof pedal === "string") return makePedal(pedal);
    return {
      id: pedal.id || crypto.randomUUID(),
      name: pedal.name || "New pedal",
      knobs: (pedal.knobs || []).map((knob, index) => ({
        id: knob.id || crypto.randomUUID(),
        name: knob.name || `Knob ${index + 1}`,
        value: knob.value || ""
      }))
    };
  });
  return tone;
}

function tagsFor(text) {
  const matches = String(text || "").match(/#[a-z0-9][a-z0-9_-]*/gi) || [];
  return [...new Set(matches.map((tag) => tag.toLowerCase()))];
}

function searchableText(tone) {
  return [tone.title, tone.description, tagsFor(tone.description).join(" ")].join(" ").toLowerCase();
}

function visibleTones() {
  return state.tones.filter((tone) => !tone.deletedAt && !tone.deleted_at);
}

function filteredTones() {
  const term = els.searchInput.value.trim().toLowerCase();
  const tones = visibleTones();
  if (!term) return tones;
  return tones.filter((tone) => searchableText(tone).includes(term));
}

function supabaseConfig() {
  const config = window.TONE_RECALL_SUPABASE_CONFIG || {};
  return {
    url: String(config.url || "").trim(),
    anonKey: String(config.anonKey || "").trim(),
    redirectTo: String(config.redirectTo || "").trim()
  };
}

function hasSupabaseConfig(config) {
  return Boolean(config.url && config.anonKey && !config.url.includes("YOUR_") && !config.anonKey.includes("YOUR_"));
}

function authRedirectUrl(config) {
  if (config.redirectTo) return config.redirectTo;
  if (location.protocol === "file:") return "";
  return `${location.origin}${location.pathname}`;
}

function loadSupabaseScript() {
  if (window.supabase?.createClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-tone-recall-supabase="true"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = SUPABASE_CDN_URL;
    script.async = true;
    script.dataset.toneRecallSupabase = "true";
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

function renderAuthShell(message = "") {
  if (!els.authPanel) return;
  const email = state.authSession?.user?.email || "";
  els.authSignedOut.classList.toggle("hidden", Boolean(email));
  els.authSignedIn.classList.toggle("hidden", !email);
  els.authUserEmail.textContent = email;
  els.authEmailInput.disabled = state.authLoading || !state.authConfigured;
  els.authSendButton.disabled = state.authLoading || state.syncLoading || !state.authConfigured;
  els.authSyncButton.disabled = state.authLoading || state.syncLoading || !email || !state.authConfigured;
  els.authLogoutButton.disabled = state.authLoading || state.syncLoading;

  if (message) {
    els.authStatus.textContent = message;
  } else if (!state.authConfigured) {
    els.authStatus.textContent = "Supabase is not configured. Local library remains available.";
  } else if (email) {
    els.authStatus.textContent = "Signed in. Use Sync now to sync tone metadata.";
  } else {
    els.authStatus.textContent = "Enter an invited email to receive a sign-in link.";
  }
}

async function initSupabaseAuth() {
  const config = supabaseConfig();
  state.authConfigured = hasSupabaseConfig(config);
  renderAuthShell();
  if (!state.authConfigured) return;

  try {
    await loadSupabaseScript();
    state.supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce"
      }
    });
    const { data, error } = await state.supabaseClient.auth.getSession();
    if (error) throw error;
    state.authSession = data.session;
    state.supabaseClient.auth.onAuthStateChange((_event, session) => {
      state.authSession = session;
      state.syncLoading = false;
      renderAuthShell();
    });
    renderAuthShell();
  } catch (error) {
    state.authConfigured = false;
    renderAuthShell("Supabase auth could not start. Local library remains available.");
  }
}

async function sendMagicLink() {
  const config = supabaseConfig();
  const email = els.authEmailInput.value.trim();
  if (!state.supabaseClient || !email) return;
  const emailRedirectTo = authRedirectUrl(config);
  if (!emailRedirectTo) {
    renderAuthShell("Serve the app over localhost or HTTPS before sending a sign-in link.");
    return;
  }

  state.authLoading = true;
  renderAuthShell("Sending sign-in link...");
  const { error } = await state.supabaseClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
      shouldCreateUser: false
    }
  });
  state.authLoading = false;

  if (error) {
    renderAuthShell(error.message || "Could not send sign-in link.");
    return;
  }
  renderAuthShell("Sign-in link sent. Check that invited email inbox.");
}

async function logoutSupabase() {
  if (!state.supabaseClient) return;
  state.authLoading = true;
  renderAuthShell("Signing out...");
  const { error } = await state.supabaseClient.auth.signOut();
  state.authLoading = false;
  if (error) {
    renderAuthShell(error.message || "Could not sign out.");
    return;
  }
  state.authSession = null;
  state.syncLoading = false;
  renderAuthShell("Signed out. Local library remains on this device.");
}

function canRunManualMetadataSync() {
  return Boolean(
    state.supabaseClient &&
    state.authSession?.user?.id &&
    window.ToneRecallSyncCore?.planToneSync &&
    window.ToneRecallSupabaseSyncAdapter?.createSupabaseSyncAdapter &&
    window.ToneRecallManualSync?.runManualMetadataSync
  );
}

function syncSummaryMessage(summary) {
  if (summary.conflicts.length) {
    return `Sync paused for ${summary.conflicts.length} delete/edit ${summary.conflicts.length === 1 ? "conflict" : "conflicts"}. No conflicting tone was changed.`;
  }

  const parts = [];
  if (summary.uploaded) parts.push(`${summary.uploaded} uploaded`);
  if (summary.applied) parts.push(`${summary.applied} downloaded`);
  if (summary.deleted) parts.push(`${summary.deleted} deleted`);
  if (summary.purged) parts.push(`${summary.purged} purged`);
  if (summary.undoSnapshots) parts.push(`${summary.undoSnapshots} undo ${summary.undoSnapshots === 1 ? "snapshot" : "snapshots"}`);
  return parts.length ? `Sync complete: ${parts.join(", ")}.` : "Sync complete. No metadata changes.";
}

async function syncNow() {
  if (!state.authConfigured || !state.authSession) {
    renderAuthShell("Sign in before syncing. Local library remains available.");
    return;
  }
  if (!canRunManualMetadataSync()) {
    renderAuthShell("Sync tools are not ready. Local library remains available.");
    return;
  }

  state.syncLoading = true;
  renderAuthShell("Syncing tone metadata...");

  try {
    await syncFromForm();
    const userId = state.authSession.user.id;
    const now = new Date().toISOString();
    const adapter = window.ToneRecallSupabaseSyncAdapter.createSupabaseSyncAdapter(state.supabaseClient, { userId, now });
    const summary = await window.ToneRecallManualSync.runManualMetadataSync({
      localTones: await dbAll(),
      adapter,
      syncCore: window.ToneRecallSyncCore,
      now,
      applyLocalTone: async (tone) => {
        normalizeTone(tone);
        await dbPut(tone);
      },
      deleteLocalTone: dbDelete
    });

    state.tones = await dbAll();
    if (state.activeId && !visibleTones().some((tone) => tone.id === state.activeId)) {
      state.activeId = null;
      state.activePedalId = null;
      state.activePhotoId = null;
      showLibrary();
    } else if (!els.detailView.classList.contains("hidden")) {
      renderDetail();
    } else {
      renderLibrary();
    }

    state.syncLoading = false;
    renderAuthShell(syncSummaryMessage(summary));
  } catch (error) {
    state.syncLoading = false;
    renderAuthShell(error?.message || "Sync failed. Local library remains available.");
  }
}

async function exportLibrary() {
  syncFromForm();
  const tones = state.tones.map((tone) => normalizeTone({ ...tone }));
  const backup = {
    app: "Tone Recall",
    version: 1,
    exportedAt: new Date().toISOString(),
    tones
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tone-recall-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importLibrary(file) {
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    alert("Import failed. That file is not valid JSON.");
    return;
  }

  const incoming = Array.isArray(parsed) ? parsed : parsed.tones;
  if (!Array.isArray(incoming)) {
    alert("Import failed. This does not look like a Tone Recall backup.");
    return;
  }

  const existingIds = new Set(state.tones.map((tone) => tone.id));
  const imported = [];
  incoming.forEach((item) => {
    const tone = normalizeImportedTone(item);
    if (!tone || existingIds.has(tone.id)) return;
    existingIds.add(tone.id);
    imported.push(tone);
  });

  for (const tone of imported) {
    await dbPut(tone);
  }
  state.tones = [...imported, ...state.tones].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  renderLibrary();
  alert(`Imported ${imported.length} ${imported.length === 1 ? "tone" : "tones"}. Existing duplicates were skipped.`);
}

function normalizeImportedTone(item) {
  if (!item || typeof item !== "object") return null;
  const id = typeof item.id === "string" && item.id ? item.id : crypto.randomUUID();
  const now = new Date().toISOString();
  return normalizeTone({
    id,
    title: typeof item.title === "string" ? item.title : "",
    description: typeof item.description === "string" ? item.description : "",
    photo: typeof item.photo === "string" ? item.photo : "",
    photos: Array.isArray(item.photos) ? item.photos : [],
    audio: typeof item.audio === "string" ? item.audio : null,
    audioType: typeof item.audioType === "string" ? item.audioType : "",
    audioSize: Number.isFinite(item.audioSize) ? item.audioSize : 0,
    audioPeak: Number.isFinite(item.audioPeak) ? item.audioPeak : 0,
    pedals: Array.isArray(item.pedals) ? item.pedals : [],
    createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now
  });
}

function showLibrary() {
  syncFromForm();
  els.detailView.classList.add("hidden");
  els.libraryView.classList.remove("hidden");
  els.backButton.classList.add("hidden");
  renderLibrary();
}

function showDetail(id) {
  state.activeId = id;
  const tone = activeTone();
  if (!tone) return;
  normalizeTone(tone);
  state.activePedalId = tone.pedals[0]?.id || null;
  els.libraryView.classList.add("hidden");
  els.detailView.classList.remove("hidden");
  els.backButton.classList.remove("hidden");
  resetZoom();
  renderDetail();
}

function renderLibrary() {
  const tones = filteredTones().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  els.libraryCount.textContent = `${tones.length} ${tones.length === 1 ? "tone" : "tones"}`;
  renderTags(els.matchedTags, matchedSearchTags(tones));
  els.toneGrid.innerHTML = "";
  if (!tones.length) {
    const empty = document.createElement("div");
    empty.className = "cardEmpty";
    empty.textContent = "No matching tones";
    els.toneGrid.append(empty);
    return;
  }

  tones.forEach((tone) => {
    normalizeTone(tone);
    const hasAudio = Boolean(tone.audio);
    const photoCount = tone.photos?.length || 0;
    const knobsComplete = hasCompleteKnobs(tone);
    const card = document.createElement("article");
    card.className = "toneCard";
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="cardImage">
        ${tone.photo ? `<img src="${tone.photo}" alt="">` : `<div class="cardEmpty">No photo</div>`}
        <div class="cardStatus">
          <span class="statusPill ${hasAudio ? "good" : "bad"}">${hasAudio ? "Audio yes" : "Audio no"}</span>
          <span class="statusPill ${knobsComplete ? "good" : "bad"}">${knobsComplete ? "Knob details yes" : "Knob details no"}</span>
        </div>
        ${photoCount ? `<div class="photoCount">${photoCount} ${photoCount === 1 ? "image" : "images"}</div>` : ""}
      </div>
      <div class="cardBody">
        <h3>${escapeHtml(tone.title || "Untitled tone")}</h3>
        <p>${escapeHtml(summary(tone.description) || "No description")}</p>
        <div class="cardBadges">
          ${tone.photo ? `<span class="badge">Photo</span>` : ""}
          ${hasAudio ? `<span class="badge">Audio</span>` : ""}
          ${tone.pedals?.length ? `<span class="badge">${tone.pedals.length} pedals</span>` : ""}
          ${tone.description ? `<span class="badge">Description</span>` : ""}
          ${tagsFor(tone.description).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
        </div>
      </div>
    `;
    card.addEventListener("click", () => showDetail(tone.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") showDetail(tone.id);
    });
    els.toneGrid.append(card);
  });
}

function hasCompleteKnobs(tone) {
  const pedals = tone.pedals || [];
  if (!pedals.length) return false;
  return pedals.every((pedal) => {
    const knobs = pedal.knobs || [];
    return knobs.length > 0 && knobs.every((knob) => knob.name.trim() && knob.value.trim());
  });
}

function matchedSearchTags(tones) {
  const search = els.searchInput.value.trim().toLowerCase();
  const tags = tones.flatMap((tone) => tagsFor(tone.description));
  const unique = [...new Set(tags)];
  return search ? unique.filter((tag) => tag.includes(search) || search.includes(tag.slice(1))) : unique;
}

function renderDetail() {
  const tone = activeTone();
  if (!tone) return;
  normalizeTone(tone);
  if (!tone.photos.some((photo) => photo.id === state.activePhotoId)) {
    state.activePhotoId = tone.photos[0]?.id || null;
  }
  const selectedPhoto = activePhoto();
  els.titleInput.value = tone.title || "";
  els.descriptionInput.value = tone.description || "";
  els.tonePhoto.src = selectedPhoto?.data || "";
  els.tonePhoto.classList.toggle("hidden", !selectedPhoto);
  els.photoEmpty.classList.toggle("hidden", Boolean(selectedPhoto));
  if (els.audioPlayer.dataset.objectUrl) {
    URL.revokeObjectURL(els.audioPlayer.dataset.objectUrl);
    delete els.audioPlayer.dataset.objectUrl;
  }
  if (tone.audio instanceof Blob) {
    const url = URL.createObjectURL(tone.audio);
    els.audioPlayer.src = url;
    els.audioPlayer.dataset.objectUrl = url;
    els.downloadAudioLink.href = url;
  } else {
    els.audioPlayer.src = tone.audio || "";
    els.downloadAudioLink.href = tone.audio || "#";
  }
  els.audioPlayer.load();
  els.audioPlayer.classList.toggle("hidden", !tone.audio);
  els.downloadAudioLink.classList.toggle("hidden", !tone.audio);
  els.downloadAudioLink.download = audioDownloadName(tone);
  els.deleteAudioButton.classList.toggle("hidden", !tone.audio);
  renderAudioCapability();
  renderTags(els.detailTags, tagsFor(tone.description));
  renderPhotoStrip();
  renderPedals();
  applyZoom();
}

function renderAudioCapability() {
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  els.recordButton.disabled = !canRecord;
  const tone = activeTone();
  const currentAudio = tone?.audio
    ? `Saved audio: ${tone.audioType || "unknown format"}${tone.audioSize ? `, ${formatBytes(tone.audioSize)}` : ""}.`
    : "";
  if (canRecord) {
    const base = location.protocol === "file:"
      ? "Recording may be blocked from a local file. Add Audio File works anywhere."
      : "Record a short voice memo or attach an audio file.";
    els.audioStatus.textContent = [base, currentAudio].filter(Boolean).join(" ");
  } else {
    els.audioStatus.textContent = ["Recording is not available in this browser. Attach an audio file instead.", currentAudio].filter(Boolean).join(" ");
  }
}

function renderTags(container, tags) {
  container.innerHTML = tags.map((tag) => `<span class="tagPill">${escapeHtml(tag)}</span>`).join("");
}

function syncFromForm() {
  const tone = activeTone();
  if (!tone || els.detailView.classList.contains("hidden")) return;
  tone.title = els.titleInput.value.trim();
  tone.description = els.descriptionInput.value.trim();
  normalizeTone(tone);
  tone.updatedAt = new Date().toISOString();
  dbPut(tone);
}

function renderPedals() {
  const tone = activeTone();
  if (!tone) return;
  normalizeTone(tone);
  const pedals = tone.pedals;
  els.pedalList.innerHTML = "";
  if (!pedals.length) {
    const empty = document.createElement("p");
    empty.className = "helperText";
    empty.textContent = "No pedals added yet.";
    els.pedalList.append(empty);
    els.pedalEditor.classList.add("hidden");
    return;
  }

  if (!pedals.some((pedal) => pedal.id === state.activePedalId)) {
    state.activePedalId = pedals[0].id;
  }

  pedals.forEach((pedal, index) => {
    const row = document.createElement("div");
    row.className = `pedalRow ${pedal.id === state.activePedalId ? "selected" : ""}`;
    row.innerHTML = `
      <button class="pedalSelect" type="button">${escapeHtml(pedal.name)}</button>
      <button class="removePedal" type="button" aria-label="Remove ${escapeHtml(pedal.name)}">Remove</button>
    `;
    row.querySelector(".pedalSelect").addEventListener("click", () => {
      state.activePedalId = pedal.id;
      renderPedals();
    });
    row.querySelector(".removePedal").addEventListener("click", async () => {
      tone.pedals.splice(index, 1);
      if (state.activePedalId === pedal.id) state.activePedalId = tone.pedals[0]?.id || null;
      tone.updatedAt = new Date().toISOString();
      await dbPut(tone);
      renderPedals();
    });
    els.pedalList.append(row);
  });

  renderPedalEditor();
}

function addPedal() {
  const tone = activeTone();
  const value = els.pedalInput.value.trim();
  if (!tone || !value) return;
  normalizeTone(tone);
  const pedal = makePedal(value);
  tone.pedals.push(pedal);
  state.activePedalId = pedal.id;
  tone.updatedAt = new Date().toISOString();
  els.pedalInput.value = "";
  dbPut(tone);
  renderPedals();
}

function renderPedalEditor() {
  const pedal = activePedal();
  if (!pedal) {
    els.pedalEditor.classList.add("hidden");
    return;
  }

  els.pedalEditor.classList.remove("hidden");
  els.selectedPedalName.value = pedal.name;
  els.knobList.innerHTML = "";

  if (!pedal.knobs.length) {
    const empty = document.createElement("p");
    empty.className = "helperText";
    empty.textContent = "No knob values yet. Add one row per knob you want to remember.";
    els.knobList.append(empty);
    return;
  }

  pedal.knobs.forEach((knob, index) => {
    const row = document.createElement("div");
    row.className = "knobRow";
    row.innerHTML = `
      <input type="text" value="${escapeHtml(knob.name)}" aria-label="Knob name">
      <input type="text" value="${escapeHtml(knob.value)}" aria-label="Knob value" placeholder="9:30, 2.5, max">
      <button type="button" aria-label="Remove ${escapeHtml(knob.name)}">Remove</button>
    `;
    const [nameInput, valueInput] = row.querySelectorAll("input");
    nameInput.addEventListener("input", () => updateKnob(index, { name: nameInput.value }));
    valueInput.addEventListener("input", () => updateKnob(index, { value: valueInput.value }));
    row.querySelector("button").addEventListener("click", async () => {
      const current = activePedal();
      if (!current) return;
      current.knobs.splice(index, 1);
      await saveActiveTone();
      renderPedalEditor();
    });
    els.knobList.append(row);
  });
}

async function saveActiveTone() {
  const tone = activeTone();
  if (!tone) return;
  tone.updatedAt = new Date().toISOString();
  await dbPut(tone);
}

function updateKnob(index, changes) {
  const pedal = activePedal();
  if (!pedal?.knobs[index]) return;
  Object.assign(pedal.knobs[index], changes);
  saveActiveTone();
}

function addKnob() {
  const pedal = activePedal();
  if (!pedal) return;
  pedal.knobs.push(makeKnob(pedal.knobs.length + 1));
  saveActiveTone();
  renderPedalEditor();
}

async function startTone() {
  syncFromForm();
  const tone = newTone();
  state.tones.unshift(tone);
  state.activeId = tone.id;
  await dbPut(tone);
  showDetail(tone.id);
  els.photoInput.click();
}

async function savePhotoFile(file) {
  if (!file) return;
  const tone = activeTone();
  if (!tone) return;
  normalizeTone(tone);
  const data = await blobToDataUrl(file);
  const photo = makePhoto(data, `Photo ${tone.photos.length + 1}`);
  tone.photos.push(photo);
  tone.photo = tone.photos[0]?.data || "";
  state.activePhotoId = photo.id;
  tone.updatedAt = new Date().toISOString();
  await dbPut(tone);
  resetZoom();
  renderDetail();
}

function renderPhotoStrip() {
  const tone = activeTone();
  if (!tone) return;
  normalizeTone(tone);
  els.photoStrip.innerHTML = "";
  els.photoStrip.classList.toggle("hidden", tone.photos.length <= 1);
  tone.photos.forEach((photo, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `photoThumb ${photo.id === state.activePhotoId ? "selected" : ""}`;
    button.innerHTML = `<img src="${photo.data}" alt="${escapeHtml(photo.name)}"><span>${escapeHtml(photo.name || `Photo ${index + 1}`)}</span>`;
    button.addEventListener("click", () => {
      state.activePhotoId = photo.id;
      resetZoom();
      renderDetail();
    });
    els.photoStrip.append(button);
  });
  els.removePhotoButton.classList.toggle("hidden", !tone.photos.length);
}

async function removeSelectedPhoto() {
  const tone = activeTone();
  if (!tone) return;
  normalizeTone(tone);
  if (!state.activePhotoId) return;
  const index = tone.photos.findIndex((photo) => photo.id === state.activePhotoId);
  if (index < 0) return;
  tone.photos.splice(index, 1);
  state.activePhotoId = tone.photos[Math.max(0, index - 1)]?.id || tone.photos[0]?.id || null;
  tone.photo = tone.photos[0]?.data || "";
  tone.updatedAt = new Date().toISOString();
  await dbPut(tone);
  resetZoom();
  renderDetail();
}

async function pastePhoto() {
  const items = await navigator.clipboard?.read?.().catch(() => []);
  for (const item of items || []) {
    const type = item.types.find((candidate) => candidate.startsWith("image/"));
    if (!type) continue;
    const blob = await item.getType(type);
    await savePhotoFile(blob);
    return;
  }
}

async function toggleRecording() {
  if (state.isRecording) {
    await stopWavRecording();
    return;
  }
  await startWavRecording();
}

async function startWavRecording() {
  const tone = activeTone();
  if (!tone) return;
  if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
    renderAudioCapability();
    return;
  }

  try {
    state.audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
  } catch (error) {
    els.audioStatus.textContent = "Microphone access was blocked. Attach an audio file instead.";
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  state.audioContext = new AudioContextClass();
  await state.audioContext.resume();
  state.audioSampleRate = state.audioContext.sampleRate;
  state.audioChunks = [];
  state.audioLength = 0;
  state.audioPeak = 0;
  state.audioSource = state.audioContext.createMediaStreamSource(state.audioStream);
  state.audioProcessor = state.audioContext.createScriptProcessor(4096, 1, 1);

  state.audioProcessor.onaudioprocess = (event) => {
    if (!state.isRecording) return;
    const input = event.inputBuffer.getChannelData(0);
    event.outputBuffer.getChannelData(0).fill(0);
    const copy = new Float32Array(input.length);
    let peak = 0;
    for (let index = 0; index < input.length; index += 1) {
      const sample = input[index];
      copy[index] = sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    state.audioPeak = Math.max(state.audioPeak, peak);
    state.audioChunks.push(copy);
    state.audioLength += copy.length;
    els.audioStatus.textContent = `Recording WAV... input level ${Math.round(Math.min(1, peak) * 100)}%`;
  };

  state.audioSource.connect(state.audioProcessor);
  state.audioProcessor.connect(state.audioContext.destination);
  state.isRecording = true;
  els.recordButton.textContent = "Stop";
  els.audioStatus.textContent = "Recording WAV... play a chord or speak to test input level.";
}

async function stopWavRecording() {
  const tone = activeTone();
  state.isRecording = false;
  els.recordButton.textContent = "Record";
  cleanupRecorderGraph();
  if (!tone) return;

  if (!state.audioLength) {
    els.audioStatus.textContent = "Recording stopped, but no audio data was captured. Try Add Audio File or test on the hosted HTTPS page.";
    return;
  }

  const wavBlob = encodeWav(state.audioChunks, state.audioLength, state.audioSampleRate);
  tone.audio = await blobToDataUrl(wavBlob);
  tone.audioType = "audio/wav";
  tone.audioSize = wavBlob.size;
  tone.audioPeak = state.audioPeak;
  tone.updatedAt = new Date().toISOString();
  await dbPut(tone);
  renderDetail();
  if (state.audioPeak < 0.01) {
    els.audioStatus.textContent = `WAV saved (${formatBytes(wavBlob.size)}), but the input looked silent. Check the selected microphone/input device.`;
  } else {
    els.audioStatus.textContent = `WAV saved (${formatBytes(wavBlob.size)}). Input level looked good.`;
  }
}

function cleanupRecorderGraph() {
  state.audioProcessor?.disconnect();
  state.audioSource?.disconnect();
  state.audioStream?.getTracks().forEach((track) => track.stop());
  state.audioContext?.close?.();
  state.audioProcessor = null;
  state.audioSource = null;
  state.audioStream = null;
  state.audioContext = null;
}

function encodeWav(chunks, length, sampleRate) {
  const samples = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    samples.set(chunk, offset);
    offset += chunk.length;
  });

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let position = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(position, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    position += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

function writeString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function audioCanPlay(type) {
  if (!type) return true;
  return Boolean(els.audioPlayer.canPlayType(type));
}

function audioExtension(type = "") {
  const clean = type.toLowerCase();
  if (clean.includes("mpeg") || clean.includes("mp3")) return "mp3";
  if (clean.includes("mp4") || clean.includes("aac") || clean.includes("m4a")) return "m4a";
  if (clean.includes("wav")) return "wav";
  if (clean.includes("ogg")) return "ogg";
  if (clean.includes("webm")) return "webm";
  return "audio";
}

function audioDownloadName(tone) {
  const title = (tone?.title || "tone-audio").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${title || "tone-audio"}.${audioExtension(tone?.audioType)}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function summary(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > 110 ? `${value.slice(0, 107)}...` : value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setZoom(nextZoom, centerX = 0, centerY = 0) {
  const previous = state.zoom;
  state.zoom = Math.min(5, Math.max(1, nextZoom));
  if (state.zoom === 1) {
    state.panX = 0;
    state.panY = 0;
  } else if (previous !== state.zoom) {
    const ratio = state.zoom / previous;
    state.panX = centerX - (centerX - state.panX) * ratio;
    state.panY = centerY - (centerY - state.panY) * ratio;
  }
  applyZoom();
}

function applyZoom() {
  els.tonePhoto.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  els.tonePhoto.style.cursor = state.zoom > 1 ? "grab" : "zoom-in";
}

function resetZoom() {
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  applyZoom();
}

els.authSendButton.addEventListener("click", sendMagicLink);
els.authEmailInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendMagicLink();
});
els.authSyncButton.addEventListener("click", syncNow);
els.authLogoutButton.addEventListener("click", logoutSupabase);
els.saveToneButton.addEventListener("click", startTone);
els.exportButton.addEventListener("click", exportLibrary);
els.importInput.addEventListener("change", () => {
  importLibrary(els.importInput.files?.[0]);
  els.importInput.value = "";
});
els.backButton.addEventListener("click", showLibrary);
els.doneButton.addEventListener("click", showLibrary);
els.photoInput.addEventListener("change", () => {
  savePhotoFile(els.photoInput.files?.[0]);
  els.photoInput.value = "";
});
els.removePhotoButton.addEventListener("click", removeSelectedPhoto);
els.pastePhotoButton.addEventListener("click", pastePhoto);
els.searchInput.addEventListener("input", renderLibrary);
els.descriptionInput.addEventListener("input", () => {
  syncFromForm();
  renderTags(els.detailTags, tagsFor(els.descriptionInput.value));
});
els.titleInput.addEventListener("input", syncFromForm);
els.recordButton.addEventListener("click", toggleRecording);
els.audioInput.addEventListener("change", async () => {
  const file = els.audioInput.files?.[0];
  const tone = activeTone();
  if (!file || !tone) return;
  if (file.type && !audioCanPlay(file.type)) {
    els.audioStatus.textContent = "This browser may not play that audio format. Try an mp3, m4a, wav, or browser-recorded clip.";
  }
  tone.audio = await blobToDataUrl(file);
  tone.audioType = file.type;
  tone.audioSize = file.size;
  tone.updatedAt = new Date().toISOString();
  await dbPut(tone);
  renderDetail();
});
els.deleteAudioButton.addEventListener("click", async () => {
  const tone = activeTone();
  if (!tone) return;
  tone.audio = null;
  tone.audioType = "";
  tone.audioSize = 0;
  tone.audioPeak = 0;
  tone.updatedAt = new Date().toISOString();
  await dbPut(tone);
  renderDetail();
});
els.audioPlayer.addEventListener("error", () => {
  els.audioStatus.textContent = "Audio could not play in this browser. Try attaching an mp3, m4a, or wav file.";
});
els.audioPlayer.addEventListener("canplay", () => {
  const tone = activeTone();
  if (tone?.audio) {
    els.audioStatus.textContent = `Audio is ready to play: ${tone.audioType || "unknown format"}${tone.audioSize ? `, ${formatBytes(tone.audioSize)}` : ""}.`;
  }
});
els.deleteToneButton.addEventListener("click", async () => {
  const tone = activeTone();
  if (!tone) return;
  if (state.authConfigured && state.authSession?.user?.id) {
    const now = new Date().toISOString();
    tone.deletedAt = now;
    tone.updatedAt = now;
    await dbPut(tone);
  } else {
    await dbDelete(tone.id);
    state.tones = state.tones.filter((item) => item.id !== tone.id);
  }
  state.activeId = null;
  showLibrary();
});
els.addPedalButton.addEventListener("click", addPedal);
els.pedalInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addPedal();
});
els.selectedPedalName.addEventListener("input", async () => {
  const pedal = activePedal();
  if (!pedal) return;
  pedal.name = els.selectedPedalName.value.trim() || "New pedal";
  saveActiveTone();
});
els.selectedPedalName.addEventListener("change", renderPedals);
els.addKnobButton.addEventListener("click", addKnob);
els.zoomInButton.addEventListener("click", () => setZoom(state.zoom + 0.5));
els.zoomOutButton.addEventListener("click", () => setZoom(state.zoom - 0.5));
els.zoomResetButton.addEventListener("click", resetZoom);
els.photoFrame.addEventListener("wheel", (event) => {
  if (!activePhoto()) return;
  event.preventDefault();
  const rect = els.photoFrame.getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width / 2;
  const y = event.clientY - rect.top - rect.height / 2;
  setZoom(state.zoom + (event.deltaY < 0 ? 0.25 : -0.25), x, y);
});
els.photoFrame.addEventListener("pointerdown", (event) => {
  if (!activePhoto()) return;
  event.preventDefault();
  if (state.zoom === 1) {
    setZoom(2);
    return;
  }
  state.panning = true;
  state.panStartX = event.clientX - state.panX;
  state.panStartY = event.clientY - state.panY;
  els.photoFrame.setPointerCapture(event.pointerId);
  els.tonePhoto.style.cursor = "grabbing";
});
els.photoFrame.addEventListener("pointermove", (event) => {
  if (!state.panning) return;
  state.panX = event.clientX - state.panStartX;
  state.panY = event.clientY - state.panStartY;
  applyZoom();
});
els.photoFrame.addEventListener("pointerup", (event) => {
  state.panning = false;
  if (els.photoFrame.hasPointerCapture(event.pointerId)) {
    els.photoFrame.releasePointerCapture(event.pointerId);
  }
  applyZoom();
});
els.photoFrame.addEventListener("pointercancel", () => {
  state.panning = false;
  applyZoom();
});
els.photoFrame.addEventListener("contextmenu", (event) => {
  if (activePhoto()) event.preventDefault();
});

window.addEventListener("beforeunload", syncFromForm);

(async function init() {
  state.tones = await dbAll();
  renderLibrary();
  initSupabaseAuth();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
