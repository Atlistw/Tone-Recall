const DB_NAME = "tone-recall-capture";
const STORE = "tones";

const state = {
  tones: [],
  activeId: null,
  activePedalId: null,
  mediaRecorder: null,
  audioChunks: [],
  zoom: 1,
  panX: 0,
  panY: 0,
  panning: false,
  panStartX: 0,
  panStartY: 0
};

const els = {
  libraryView: document.getElementById("libraryView"),
  detailView: document.getElementById("detailView"),
  toneGrid: document.getElementById("toneGrid"),
  libraryCount: document.getElementById("libraryCount"),
  searchInput: document.getElementById("searchInput"),
  matchedTags: document.getElementById("matchedTags"),
  saveToneButton: document.getElementById("saveToneButton"),
  exportButton: document.getElementById("exportButton"),
  importInput: document.getElementById("importInput"),
  backButton: document.getElementById("backButton"),
  doneButton: document.getElementById("doneButton"),
  photoInput: document.getElementById("photoInput"),
  pastePhotoButton: document.getElementById("pastePhotoButton"),
  tonePhoto: document.getElementById("tonePhoto"),
  photoFrame: document.getElementById("photoFrame"),
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

function filteredTones() {
  const term = els.searchInput.value.trim().toLowerCase();
  if (!term) return state.tones;
  return state.tones.filter((tone) => searchableText(tone).includes(term));
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
    audio: typeof item.audio === "string" ? item.audio : null,
    audioType: typeof item.audioType === "string" ? item.audioType : "",
    audioSize: Number.isFinite(item.audioSize) ? item.audioSize : 0,
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
  els.titleInput.value = tone.title || "";
  els.descriptionInput.value = tone.description || "";
  els.tonePhoto.src = tone.photo || "";
  els.tonePhoto.classList.toggle("hidden", !tone.photo);
  els.photoEmpty.classList.toggle("hidden", Boolean(tone.photo));
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
  renderPedals();
  applyZoom();
}

function renderAudioCapability() {
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
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
  tone.photo = await blobToDataUrl(file);
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
  const tone = activeTone();
  if (!tone) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    renderAudioCapability();
    return;
  }

  if (state.mediaRecorder?.state === "recording") {
    state.mediaRecorder.stop();
    els.recordButton.textContent = "Record";
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    els.audioStatus.textContent = "Microphone access was blocked. Attach an audio file instead.";
    return;
  }
  state.audioChunks = [];
  const mimeType = preferredAudioMimeType();
  state.mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  state.mediaRecorder.ondataavailable = (event) => state.audioChunks.push(event.data);
  state.mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType || "audio/webm" });
    if (!blob.size) {
      els.audioStatus.textContent = "Recording stopped, but no audio data was captured. Try Add Audio File or test from localhost/HTTPS.";
      renderDetail();
      return;
    }
    tone.audio = await blobToDataUrl(blob);
    tone.audioType = blob.type;
    tone.audioSize = blob.size;
    tone.updatedAt = new Date().toISOString();
    await dbPut(tone);
    renderDetail();
  };
  state.mediaRecorder.start(500);
  els.recordButton.textContent = "Stop";
  els.audioStatus.textContent = `Recording with ${state.mediaRecorder.mimeType || "browser default audio format"}...`;
}

function preferredAudioMimeType() {
  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac"
  ];
  return options.find((type) => MediaRecorder.isTypeSupported?.(type) && audioCanPlay(type)) || "";
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

els.saveToneButton.addEventListener("click", startTone);
els.exportButton.addEventListener("click", exportLibrary);
els.importInput.addEventListener("change", () => {
  importLibrary(els.importInput.files?.[0]);
  els.importInput.value = "";
});
els.backButton.addEventListener("click", showLibrary);
els.doneButton.addEventListener("click", showLibrary);
els.photoInput.addEventListener("change", () => savePhotoFile(els.photoInput.files?.[0]));
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
  await dbDelete(tone.id);
  state.tones = state.tones.filter((item) => item.id !== tone.id);
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
  if (!activeTone()?.photo) return;
  event.preventDefault();
  const rect = els.photoFrame.getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width / 2;
  const y = event.clientY - rect.top - rect.height / 2;
  setZoom(state.zoom + (event.deltaY < 0 ? 0.25 : -0.25), x, y);
});
els.photoFrame.addEventListener("pointerdown", (event) => {
  if (!activeTone()?.photo) return;
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
  if (activeTone()?.photo) event.preventDefault();
});

window.addEventListener("beforeunload", syncFromForm);

(async function init() {
  state.tones = await dbAll();
  renderLibrary();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
