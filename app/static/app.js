/* =========================================================
   Shared helpers
   ========================================================= */

const TOKEN_KEY = "pt_token";

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function requireAuth() {
  if (!getToken()) { window.location.href = "/static/index.html"; }
}

function signOut() {
  clearToken();
  window.location.href = "/static/index.html";
}

function parseJwtPayload(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch { return {}; }
}

async function apiFetch(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { clearToken(); window.location.href = "/static/index.html"; return null; }
  return res;
}

async function apiUpload(formData) {
  const token = getToken();
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch("/transcribe", { method: "POST", headers, body: formData });
  if (res.status === 401) { clearToken(); window.location.href = "/static/index.html"; return null; }
  return res;
}

function fmtDuration(secs) {
  if (secs == null) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtTimestamp(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/* =========================================================
   Auth page  (index.html)
   ========================================================= */

if (document.getElementById("login-btn")) {
  // If already logged in, redirect
  if (getToken()) window.location.href = "/static/dashboard.html";

  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  // Login
  document.getElementById("login-btn").addEventListener("click", async () => {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const errEl = document.getElementById("login-error");
    errEl.classList.add("hidden");

    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.detail || "Login failed";
      errEl.classList.remove("hidden");
      return;
    }
    setToken(data.access_token);
    window.location.href = "/static/dashboard.html";
  });

  // Allow Enter key on login fields
  ["login-username", "login-password"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", e => {
      if (e.key === "Enter") document.getElementById("login-btn").click();
    });
  });

  // Register
  document.getElementById("register-btn").addEventListener("click", async () => {
    const username = document.getElementById("reg-username").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const msgEl = document.getElementById("register-msg");
    msgEl.className = "alert hidden";

    const res = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      msgEl.textContent = data.detail || "Registration failed";
      msgEl.className = "alert alert-error";
      return;
    }
    msgEl.textContent = "Account created! You can sign in now.";
    msgEl.className = "alert alert-success";
  });
}

/* =========================================================
   Dashboard page  (dashboard.html)
   ========================================================= */

if (document.getElementById("drop-zone")) {
  requireAuth();

  // Username in navbar
  const payload = parseJwtPayload(getToken());
  document.getElementById("nav-username").textContent = payload.sub || "";
  document.getElementById("signout-btn").addEventListener("click", signOut);

  // File selection
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const transcribeBtn = document.getElementById("transcribe-btn");
  const fileNameEl = document.getElementById("selected-filename");
  let selectedFile = null;

  const dropZoneIcon = document.getElementById("drop-zone-icon");
  const dropZoneFilename = document.getElementById("drop-zone-filename");
  const dropZoneInfo = document.getElementById("drop-zone-info");

  function setFile(f) {
    selectedFile = f;
    transcribeBtn.disabled = !f;
    if (f) {
      dropZone.classList.add("has-file");
      dropZoneIcon.textContent = "✅";
      dropZoneFilename.textContent = f.name;
      const sizeStr = f.size < 1024 * 1024
        ? (f.size / 1024).toFixed(1) + " KB"
        : (f.size / (1024 * 1024)).toFixed(1) + " MB";
      dropZoneInfo.textContent = sizeStr;
      const tmpAudio = new Audio(URL.createObjectURL(f));
      tmpAudio.addEventListener("loadedmetadata", () => {
        dropZoneInfo.textContent = sizeStr + " · " + fmtDuration(tmpAudio.duration);
        URL.revokeObjectURL(tmpAudio.src);
      });
      tmpAudio.addEventListener("error", () => URL.revokeObjectURL(tmpAudio.src));
    } else {
      dropZone.classList.remove("has-file");
      dropZoneIcon.textContent = "📂";
      dropZoneFilename.textContent = "";
      dropZoneInfo.textContent = "";
    }
  }

  document.getElementById("browse-link").addEventListener("click", e => {
    e.stopPropagation();
    fileInput.click();
  });
  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => setFile(fileInput.files[0] || null));

  dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  });

  // Transcribe
  const cancelBtn = document.getElementById("cancel-btn");
  let activeAbortController = null;

  cancelBtn.addEventListener("click", () => {
    if (activeAbortController) activeAbortController.abort();
  });

  transcribeBtn.addEventListener("click", async () => {
    if (!selectedFile) return;

    const label = document.getElementById("transcribe-label");
    const spinner = document.getElementById("transcribe-spinner");
    const progressWrap = document.getElementById("upload-progress");

    activeAbortController = new AbortController();
    transcribeBtn.disabled = true;
    cancelBtn.classList.remove("hidden");
    label.textContent = "Transcribing…";
    spinner.classList.remove("hidden");
    progressWrap.classList.remove("hidden");

    const fd = new FormData();
    fd.append("file", selectedFile);
    fd.append("number_of_speakers", document.getElementById("speaker-count").value);

    let res;
    try {
      const token = getToken();
      const headers = token ? { "Authorization": "Bearer " + token } : {};
      res = await fetch("/transcribe", {
        method: "POST", headers, body: fd,
        signal: activeAbortController.signal,
      });
      if (res.status === 401) { clearToken(); window.location.href = "/static/index.html"; return; }
    } catch (err) {
      if (err.name === "AbortError") {
        showToast("Transcription cancelled.", "error");
      }
      res = null;
    } finally {
      activeAbortController = null;
      transcribeBtn.disabled = false;
      cancelBtn.classList.add("hidden");
      label.textContent = "Transcribe";
      spinner.classList.add("hidden");
      progressWrap.classList.add("hidden");
    }

    if (!res) return;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.detail || "Transcription failed", "error");
      return;
    }
    showToast("Transcription complete! Saved to your history.", "success");
    setFile(null);
    fileInput.value = "";
    loadTranscriptions();
  });

  // Transcriptions table
  const tbody = document.getElementById("transcriptions-body");

  async function loadTranscriptions() {
    tbody.innerHTML = [0, 1, 2].map(() => `
      <tr>
        <td><div class="skeleton" style="width:55%"></div></td>
        <td><div class="skeleton" style="width:24px"></div></td>
        <td><div class="skeleton" style="width:40px"></div></td>
        <td><div class="skeleton" style="width:80px"></div></td>
        <td><div class="skeleton" style="width:64px"></div></td>
      </tr>
    `).join("");

    const res = await apiFetch("/transcriptions");
    if (!res) return;
    const list = await res.json();
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No transcriptions yet. Upload an audio file above.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(r => `
      <tr id="row-${r.id}">
        <td>
          <a class="filename-link" href="/static/detail.html?id=${r.id}">${escHtml(r.filename.replace(/\.[^.]+$/, ""))}</a>
        </td>
        <td>${r.number_of_speakers}</td>
        <td>${fmtDuration(r.duration_seconds)}</td>
        <td>${fmtDate(r.created_at)}</td>
        <td class="actions" id="actions-${r.id}">
          <button class="btn btn-danger btn-sm" onclick="confirmDelete(${r.id})">Delete</button>
        </td>
      </tr>
    `).join("");
  }

  window.confirmDelete = function(id) {
    const cell = document.getElementById(`actions-${id}`);
    cell.innerHTML = `
      <span style="font-size:0.8rem;color:var(--text-muted);margin-right:6px">Sure?</span>
      <button class="btn btn-danger btn-sm" onclick="deleteTranscription(${id})">Yes, delete</button>
      <button class="btn btn-ghost btn-sm" onclick="cancelDelete(${id})">Cancel</button>
    `;
  };

  window.cancelDelete = function(id) {
    const cell = document.getElementById(`actions-${id}`);
    cell.innerHTML = `<button class="btn btn-danger btn-sm" onclick="confirmDelete(${id})">Delete</button>`;
  };

  window.deleteTranscription = async function(id) {
    await apiFetch(`/transcriptions/${id}`, { method: "DELETE" });
    loadTranscriptions();
  };

  loadTranscriptions();
}

/* =========================================================
   Detail page  (detail.html)
   ========================================================= */

if (document.getElementById("transcript")) {
  requireAuth();

  const payload = parseJwtPayload(getToken());
  document.getElementById("nav-username").textContent = payload.sub || "";
  document.getElementById("signout-btn").addEventListener("click", signOut);

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) { window.location.href = "/static/dashboard.html"; }

  apiFetch(`/transcriptions/${id}`).then(async res => {
    if (!res || !res.ok) { window.location.href = "/static/dashboard.html"; return; }
    const data = await res.json();

    const displayName = data.filename.replace(/\.[^.]+$/, "");
    document.title = `${displayName} — Podcast Transcriber`;
    document.getElementById("detail-filename").textContent = displayName;

    const audioLoad = document.getElementById("audio-load");
    const audioWrap = document.getElementById("audio-player-wrap");
    const audioPlayer = document.getElementById("audio-player");

    document.getElementById("audio-file-input").addEventListener("change", function () {
      const file = this.files[0];
      if (!file) return;
      if (audioPlayer.src) URL.revokeObjectURL(audioPlayer.src);
      audioPlayer.src = URL.createObjectURL(file);
      audioLoad.classList.add("hidden");
      audioWrap.classList.remove("hidden");
    });

    document.getElementById("audio-remove-btn").addEventListener("click", function () {
      audioPlayer.pause();
      URL.revokeObjectURL(audioPlayer.src);
      audioPlayer.src = "";
      document.getElementById("audio-file-input").value = "";
      audioWrap.classList.add("hidden");
      audioLoad.classList.remove("hidden");
    });

    document.getElementById("detail-meta").innerHTML = `
      <div class="meta-item"><div class="meta-label">Speakers</div><div class="meta-value">${data.number_of_speakers}</div></div>
      <div class="meta-item"><div class="meta-label">Duration</div><div class="meta-value">${fmtDuration(data.duration_seconds)}</div></div>
      <div class="meta-item"><div class="meta-label">Segments</div><div class="meta-value">${data.segments.length}</div></div>
      <div class="meta-item"><div class="meta-label">Date</div><div class="meta-value">${fmtDate(data.created_at)}</div></div>
    `;

    const transcriptEl = document.getElementById("transcript");
    if (data.segments.length === 0) {
      transcriptEl.innerHTML = '<p class="text-muted">No segments found.</p>';
      return;
    }

    const speakers = [...new Set(data.segments.map(s => s.speaker))].sort();
    const speakerColorIdx = {};
    speakers.forEach((sp, i) => { speakerColorIdx[sp] = i % 6; });

    transcriptEl.innerHTML = data.segments.map((s, i) => {
      const spIdx = speakerColorIdx[s.speaker] ?? 0;
      return `
        <div class="segment" data-sp="${spIdx}" data-start="${s.start}" data-end="${s.end}" style="animation-delay:${i * 0.04}s">
          <div class="segment-meta">
            <span class="segment-speaker" data-speaker="${escHtml(s.speaker)}">${escHtml(s.speaker)}</span>
            &nbsp;·&nbsp; <span class="segment-time">${fmtTimestamp(s.start)} – ${fmtTimestamp(s.end)}</span>
          </div>
          <div class="segment-text" contenteditable="true" spellcheck="false">${escHtml(s.text)}</div>
        </div>
      `;
    }).join("");

    // Click segment-meta → seek audio
    transcriptEl.addEventListener("click", e => {
      const meta = e.target.closest(".segment-meta");
      if (!meta) return;
      const seg = meta.closest(".segment");
      if (!seg || !audioPlayer.src) return;
      audioPlayer.currentTime = parseFloat(seg.dataset.start);
      audioPlayer.play();
    });

    // Auto-scroll toggle
    let autoScroll = false;
    let lastActiveSeg = null;
    const autoScrollBtn = document.getElementById("autoscroll-btn");
    autoScrollBtn.addEventListener("click", () => {
      autoScroll = !autoScroll;
      autoScrollBtn.textContent = `Auto-scroll: ${autoScroll ? "On" : "Off"}`;
      autoScrollBtn.style.color = autoScroll ? "var(--accent-light)" : "";
      autoScrollBtn.style.borderColor = autoScroll ? "var(--accent-light)" : "";
    });

    // Highlight active segment while audio plays
    audioPlayer.addEventListener("timeupdate", () => {
      const t = audioPlayer.currentTime;
      let active = null;
      transcriptEl.querySelectorAll(".segment").forEach(seg => {
        const start = parseFloat(seg.dataset.start);
        const end = parseFloat(seg.dataset.end);
        const isActive = t >= start && t < end;
        seg.classList.toggle("active", isActive);
        if (isActive) active = seg;
      });
      if (autoScroll && active && active !== lastActiveSeg) {
        lastActiveSeg = active;
        active.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    const panel = document.getElementById("speakers-panel");
    panel.innerHTML = `
      <div class="speakers-panel">
        <div class="speakers-panel-label">Rename speakers</div>
        <div class="speakers-panel-inputs">
          ${speakers.map(s => `
            <div class="speaker-chip" data-sp="${speakerColorIdx[s] ?? 0}">
              <div class="speaker-chip-tag">${escHtml(s)}</div>
              <input class="speaker-name-input" type="text" placeholder="Enter name…" data-speaker="${escHtml(s)}" />
            </div>
          `).join("")}
        </div>
      </div>
    `;
    panel.querySelectorAll(".speaker-name-input").forEach(input => {
      input.addEventListener("input", function () {
        const original = this.dataset.speaker;
        const name = this.value.trim() || original;
        document.querySelectorAll(`.segment-speaker[data-speaker="${original}"]`).forEach(el => {
          el.textContent = name;
        });
      });
    });

    // Collect current segment state from DOM
    function collectSegments() {
      return [...transcriptEl.querySelectorAll(".segment")].map(seg => ({
        speaker: seg.querySelector(".segment-speaker").textContent,
        start: parseFloat(seg.dataset.start),
        end: parseFloat(seg.dataset.end),
        text: seg.querySelector(".segment-text").textContent.trim(),
      }));
    }

    // Unsaved changes warning
    let hasUnsavedChanges = false;
    transcriptEl.addEventListener("input", () => { hasUnsavedChanges = true; });
    panel.addEventListener("input", () => { hasUnsavedChanges = true; });
    window.addEventListener("beforeunload", e => {
      if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ""; }
    });

    // Copy transcript to clipboard
    document.getElementById("copy-btn").addEventListener("click", async () => {
      const segs = collectSegments();
      const text = segs.map(s => `[${fmtTimestamp(s.start)}] ${s.speaker}: ${s.text}`).join("\n\n");
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById("copy-btn");
      btn.textContent = "Copied!";
      btn.style.color = "var(--success)";
      setTimeout(() => { btn.textContent = "Copy"; btn.style.color = ""; }, 2000);
    });

    // Save edits
    document.getElementById("save-btn").addEventListener("click", async () => {
      const saveBtn = document.getElementById("save-btn");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      const res = await apiFetch(`/transcriptions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ segments: collectSegments() }),
      });
      saveBtn.disabled = false;
      saveBtn.textContent = "Save edits";
      if (!res || !res.ok) {
        showToast("Failed to save edits.", "error");
      } else {
        hasUnsavedChanges = false;
        showToast("Transcript saved.", "success");
      }
    });

    // Export helpers
    function toSrtTime(secs) {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.round((secs % 1) * 1000);
      return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
    }

    function triggerDownload(content, filename, type) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([content], { type }));
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    const exportBtn = document.getElementById("export-btn");
    const exportMenu = document.getElementById("export-menu");

    exportBtn.addEventListener("click", e => {
      e.stopPropagation();
      exportMenu.classList.toggle("hidden");
    });
    document.addEventListener("click", () => exportMenu.classList.add("hidden"));

    document.getElementById("export-txt").addEventListener("click", () => {
      const segs = collectSegments();
      const lines = segs.map(s => `[${fmtTimestamp(s.start)}] ${s.speaker}: ${s.text}`);
      triggerDownload(lines.join("\n\n"), data.filename.replace(/\.[^.]+$/, "") + ".txt", "text/plain");
    });

    document.getElementById("export-srt").addEventListener("click", () => {
      const segs = collectSegments();
      const lines = segs.map((s, i) =>
        `${i + 1}\n${toSrtTime(s.start)} --> ${toSrtTime(s.end)}\n${s.speaker}: ${s.text}`
      );
      triggerDownload(lines.join("\n\n"), data.filename.replace(/\.[^.]+$/, "") + ".srt", "text/plain");
    });
  });
}

/* =========================================================
   Utility
   ========================================================= */

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg, type = "success") {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.animation = "toastIn 0.2s ease reverse both";
    el.addEventListener("animationend", () => el.remove());
  }, 3500);
}
