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

  function setFile(f) {
    selectedFile = f;
    fileNameEl.textContent = f ? "Selected: " + f.name : "";
    transcribeBtn.disabled = !f;
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
  transcribeBtn.addEventListener("click", async () => {
    if (!selectedFile) return;
    const errEl = document.getElementById("upload-error");
    const okEl = document.getElementById("upload-success");
    errEl.classList.add("hidden");
    okEl.classList.add("hidden");

    const label = document.getElementById("transcribe-label");
    const spinner = document.getElementById("transcribe-spinner");
    transcribeBtn.disabled = true;
    label.textContent = "Transcribing…";
    spinner.classList.remove("hidden");

    const fd = new FormData();
    fd.append("file", selectedFile);
    fd.append("number_of_speakers", document.getElementById("speaker-count").value);

    const res = await apiUpload(fd);
    transcribeBtn.disabled = false;
    label.textContent = "Transcribe";
    spinner.classList.add("hidden");

    if (!res) return;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      errEl.textContent = data.detail || "Transcription failed";
      errEl.classList.remove("hidden");
      return;
    }
    okEl.textContent = "Transcription complete! Saved to your history.";
    okEl.classList.remove("hidden");
    setFile(null);
    fileInput.value = "";
    loadTranscriptions();
  });

  // Transcriptions table
  const tbody = document.getElementById("transcriptions-body");

  async function loadTranscriptions() {
    const res = await apiFetch("/transcriptions");
    if (!res) return;
    const list = await res.json();
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No transcriptions yet. Upload an audio file above.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(r => `
      <tr>
        <td>${escHtml(r.filename)}</td>
        <td>${r.number_of_speakers}</td>
        <td>${fmtDuration(r.duration_seconds)}</td>
        <td>${fmtDate(r.created_at)}</td>
        <td class="actions">
          <button class="btn btn-ghost btn-sm" onclick="viewDetail(${r.id})">View</button>
          <button class="btn btn-danger" onclick="deleteTranscription(${r.id})">Delete</button>
        </td>
      </tr>
    `).join("");
  }

  window.viewDetail = function(id) {
    window.location.href = `/static/detail.html?id=${id}`;
  };

  window.deleteTranscription = async function(id) {
    if (!confirm("Delete this transcription?")) return;
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

    document.title = `${data.filename} — Podcast Transcriber`;
    document.getElementById("detail-filename").textContent = data.filename;

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
    transcriptEl.innerHTML = data.segments.map(s => `
      <div class="segment">
        <div class="segment-meta">${escHtml(s.speaker)} &nbsp;·&nbsp; [${fmtTimestamp(s.start)} – ${fmtTimestamp(s.end)}]</div>
        <div class="segment-text">${escHtml(s.text)}</div>
      </div>
    `).join("");
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
