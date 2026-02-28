let state = {
  active: false,
  code: null,
  sessionEndsAt: 0,
  preDelay: 3,
  clipDuration: 10,
  recording: false,
  cfg: null,
  live: { active: false, values: {}, overlays: [] },
  stream: null,
  recorder: null,
  chunks: [],
  overlayImg: null,
  drawReq: 0,
  drag: { on: false, ox: 0, oy: 0, startX: 0, startY: 0 },
};

const el = (id) => document.getElementById(id);

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
function setStatus(s) { el("status").textContent = s; }
function setIdle(on) { el("idle").style.display = on ? "grid" : "none"; }
function setSessionUI(on) {
  el("recordBtn").style.display = on ? "" : "none";
  el("codePill").textContent = on && state.code ? "Session: " + state.code : "";
  el("qrBox").classList.toggle("on", on);
}

function applyThemeFromCfg() {
  const c = effectiveCfg();
  const theme = (c.theme_name || "neon_party");
  document.body.setAttribute("data-theme", theme);
}

async function apiJson(path, bodyObj) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyObj || {}) });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

async function getJson(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

function effectiveCfg() {
  const c = JSON.parse(JSON.stringify(state.cfg || {}));
  if (state.live.active && state.live.values) {
    Object.assign(c, state.live.values);
    if (state.live.values.crop) c.crop = { ...(c.crop || {}), ...state.live.values.crop };
  }
  return c;
}

async function loadVersionTag() {
  try {
    const v = await getJson("/api/version");
    el("versionTag").textContent = `v${v.version} / ${v.commit}`;
  } catch {}
}

function pickMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const c of candidates) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  return "";
}

async function ensureMedia() {
  if (state.stream) return;
  state.cfg = await getJson("/api/config");
  applyThemeFromCfg();
  const cfg = effectiveCfg();
  state.stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: cfg.width || 1920 }, height: { ideal: cfg.height || 1080 }, frameRate: { ideal: cfg.fps || 30 } },
    audio: { channelCount: cfg.audio_channels || 2, sampleRate: cfg.audio_samplerate || 48000, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const v = el("cam");
  v.srcObject = state.stream;
  await v.play();
  await loadOverlay();
  startDrawLoop();
}

async function loadOverlay() {
  state.overlayImg = null;
  const cfg = effectiveCfg();
  if (!cfg.overlay_enabled || !cfg.overlay_filename) return;
  const img = new Image();
  img.src = "/overlays/" + encodeURIComponent(cfg.overlay_filename) + "?t=" + Date.now();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  state.overlayImg = img;
}

function overlayRect(cfg, cw, ch) {
  const scale = Number(cfg.overlay_scale || 1);
  const ow = cw * scale;
  const oh = ch * scale;
  const ox = Number(cfg.overlay_x || 0) * cw;
  const oy = Number(cfg.overlay_y || 0) * ch;
  return { x: ox, y: oy, w: ow, h: oh };
}

function startDrawLoop() {
  cancelAnimationFrame(state.drawReq);
  const canvas = el("stage");
  const ctx = canvas.getContext("2d");
  const v = el("cam");
  function loop() {
    const cfg = effectiveCfg();
    canvas.width = cfg.width || 1280;
    canvas.height = cfg.height || 720;
    if (v.readyState >= 2) {
      const vw = v.videoWidth || canvas.width;
      const vh = v.videoHeight || canvas.height;
      const crop = cfg.crop || {};
      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (crop.enabled && crop.w > 0 && crop.h > 0) {
        sx = Math.max(0, crop.x | 0); sy = Math.max(0, crop.y | 0);
        sw = Math.max(1, crop.w | 0); sh = Math.max(1, crop.h | 0);
      }
      if (sx + sw > vw) sw = Math.max(1, vw - sx);
      if (sy + sh > vh) sh = Math.max(1, vh - sy);
      const b = Math.max(0, 1 + Number(cfg.brightness || 0));
      ctx.filter = `brightness(${b}) contrast(${Number(cfg.contrast || 1)}) saturate(${Number(cfg.saturation || 1)})`;
      ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      ctx.filter = "none";
      if (state.overlayImg) {
        const r = overlayRect(cfg, canvas.width, canvas.height);
        ctx.drawImage(state.overlayImg, r.x, r.y, r.w, r.h);
      }
    }
    state.drawReq = requestAnimationFrame(loop);
  }
  loop();
}

function showCountdown(n) { el("countdown").classList.add("on"); el("countNum").textContent = String(n); }
function hideCountdown() { el("countdown").classList.remove("on"); }
async function countdown(seconds) {
  for (let i = seconds; i > 0; i--) { showCountdown(i); await new Promise((r) => setTimeout(r, 1000)); }
  hideCountdown();
}

async function uploadBlob(blob, filename) {
  const fd = new FormData();
  fd.append("file", blob, filename);
  const r = await fetch(`/api/session/${encodeURIComponent(state.code)}/upload`, { method: "POST", body: fd });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

async function recordClip() {
  if (!state.active || !state.code || state.recording) return;
  state.recording = true;
  state.chunks = [];
  try {
    await ensureMedia();
    setStatus("Get ready...");
    await countdown(state.preDelay);
    const cfg = effectiveCfg();
    const canvas = el("stage");
    const stream = canvas.captureStream(cfg.fps || 30);
    for (const t of state.stream.getAudioTracks()) stream.addTrack(t);
    const rec = new MediaRecorder(stream, pickMimeType() ? { mimeType: pickMimeType() } : undefined);
    state.recorder = rec;
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) state.chunks.push(ev.data); };
    const stopped = new Promise((res) => (rec.onstop = () => res()));
    setStatus("Recording...");
    rec.start(250);
    await new Promise((r) => setTimeout(r, state.clipDuration * 1000));
    rec.stop();
    await stopped;
    await uploadBlob(new Blob(state.chunks, { type: rec.mimeType || "video/webm" }), "clip.webm");
    setStatus("Saved");
  } catch (e) {
    setStatus("Error: " + e.message);
  } finally {
    state.recording = false;
    state.recorder = null;
    state.chunks = [];
  }
}

function applyInactive() {
  state.active = false;
  state.code = null;
  state.sessionEndsAt = 0;
  setIdle(true);
  setSessionUI(false);
  setStatus("Locked - waiting for admin");
  el("subtitle").textContent = "Waiting for admin to unlock session.";
  el("sessionTimer").textContent = "00:00";
}

async function applyActive(payload) {
  const switched = state.code !== payload.code || !state.active;
  state.active = true;
  state.code = payload.code;
  state.preDelay = Number(payload.pre_clip_delay_seconds || 3);
  state.clipDuration = Number(payload.clip_duration_seconds || 10);
  state.sessionEndsAt = Date.parse(payload.ends_at || "") || 0;
  el("qrImg").src = `/api/session/${encodeURIComponent(state.code)}/qr.png`;
  setIdle(false);
  setSessionUI(true);
  el("subtitle").textContent = "Session unlocked. Tap record to capture a clip.";
  if (switched) { setStatus("Session active"); try { await ensureMedia(); } catch (e) { setStatus("Camera/mic error: " + e.message); } }
}

async function syncActive() {
  try {
    const payload = await getJson("/api/session/active");
    if (!payload.active) { if (state.active) applyInactive(); return; }
    await applyActive(payload);
  } catch {}
}

function renderOverlayChips() {
  const box = el("liveOverlays");
  if (!box) return;
  box.innerHTML = "";
  for (const name of state.live.overlays || []) {
    const b = document.createElement("button");
    b.className = "live-chip" + ((effectiveCfg().overlay_filename === name) ? " on" : "");
    b.textContent = name;
    b.onclick = async () => {
      await apiJson("/api/live-tune/update", { overlay_enabled: true, overlay_filename: name });
    };
    box.appendChild(b);
  }
}

async function syncLiveTune() {
  try {
    const live = await getJson("/api/live-tune");
    const was = state.live.active;
    state.live = live;
    el("livePanel").style.display = live.active ? "" : "none";
    if (live.active) {
      renderOverlayChips();
      await loadOverlay();
      applyThemeFromCfg();
      if (!was) setStatus("Live edit mode active");
    } else if (was) {
      await loadOverlay();
      applyThemeFromCfg();
      setStatus(state.active ? "Session active" : "Locked - waiting for admin");
    }
  } catch {}
}

function pointerToNorm(canvas, ev) {
  const r = canvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
}

function setupLiveDrag() {
  const c = el("stage");
  c.addEventListener("pointerdown", (ev) => {
    if (!state.live.active || !state.overlayImg) return;
    const cfg = effectiveCfg();
    const p = pointerToNorm(c, ev);
    const r = overlayRect(cfg, c.width, c.height);
    const px = p.x * c.width, py = p.y * c.height;
    if (px < r.x || py < r.y || px > r.x + r.w || py > r.y + r.h) return;
    state.drag.on = true;
    state.drag.ox = Number(cfg.overlay_x || 0);
    state.drag.oy = Number(cfg.overlay_y || 0);
    state.drag.startX = p.x;
    state.drag.startY = p.y;
    c.setPointerCapture(ev.pointerId);
  });
  c.addEventListener("pointermove", async (ev) => {
    if (!state.drag.on || !state.live.active) return;
    const p = pointerToNorm(c, ev);
    const nx = state.drag.ox + (p.x - state.drag.startX);
    const ny = state.drag.oy + (p.y - state.drag.startY);
    state.live.values.overlay_x = nx;
    state.live.values.overlay_y = ny;
  });
  c.addEventListener("pointerup", async () => {
    if (!state.drag.on) return;
    state.drag.on = false;
    await apiJson("/api/live-tune/update", {
      overlay_x: state.live.values.overlay_x || 0,
      overlay_y: state.live.values.overlay_y || 0,
    });
  });
}

function tick() {
  if (state.active && state.sessionEndsAt > 0) {
    const left = (state.sessionEndsAt - Date.now()) / 1000;
    el("sessionTimer").textContent = fmt(left);
  }
  requestAnimationFrame(tick);
}

function bind() {
  el("recordBtn").addEventListener("click", recordClip);
  const testStart = el("testStartBtn");
  const testStop = el("testStopBtn");
  if (testStart) testStart.addEventListener("click", async () => { try { await apiJson("/api/session/start", {}); await syncActive(); } catch (e) { setStatus("Error: " + e.message); } });
  if (testStop) testStop.addEventListener("click", async () => { try { await apiJson("/api/session/stop-active", {}); await syncActive(); } catch (e) { setStatus("Error: " + e.message); } });
  const dec = el("ovSmaller"), inc = el("ovBigger");
  if (dec) dec.onclick = async () => {
    const v = Math.max(0.1, Number((effectiveCfg().overlay_scale || 1)) - 0.05);
    await apiJson("/api/live-tune/update", { overlay_scale: v });
  };
  if (inc) inc.onclick = async () => {
    const v = Math.min(4, Number((effectiveCfg().overlay_scale || 1)) + 0.05);
    await apiJson("/api/live-tune/update", { overlay_scale: v });
  };
}

async function init() {
  bind();
  setupLiveDrag();
  applyInactive();
  loadVersionTag();
  await syncActive();
  await syncLiveTune();
  setInterval(syncActive, 3000);
  setInterval(syncLiveTune, 800);
  tick();
}

init();
