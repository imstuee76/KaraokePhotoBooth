let state = {
  phase: "idle", // idle | session | ended
  active: false,
  code: null,
  qrUrl: null,
  expiresAt: null,
  sessionEndsAt: 0,
  timers: { sessionDuration: 180, preDelay: 3, clipDuration: 10 },
  recording: false,
  cfg: null,
  stream: null,
  recorder: null,
  chunks: [],
  overlayImg: null,
  drawReq: 0,
};

const el = (id) => document.getElementById(id);

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function setStatus(s) {
  el("status").textContent = s;
}

function setIdle(on) {
  el("idle").style.display = on ? "grid" : "none";
}

function setSessionUI(on, keepQr = false) {
  el("startBtn").style.display = on ? "none" : "";
  el("recordBtn").style.display = on ? "" : "none";
  el("stopBtn").style.display = on ? "" : "none";
  el("codePill").textContent = (state.code && (on || keepQr)) ? "Session: " + state.code : "";
  el("qrBox").classList.toggle("on", on || keepQr);
}

async function apiJson(path, bodyObj) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj || {}),
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

async function getConfig() {
  const r = await fetch("/api/config");
  if (!r.ok) throw new Error("config load failed");
  return r.json();
}

async function loadVersionTag() {
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    if (!r.ok) return;
    const v = await r.json();
    el("versionTag").textContent = `v${v.version} / ${v.commit}`;
  } catch {}
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

async function ensureMedia() {
  if (state.stream) return;

  state.cfg = await getConfig();

  const constraints = {
    video: {
      width: { ideal: state.cfg.width || 1920 },
      height: { ideal: state.cfg.height || 1080 },
      frameRate: { ideal: state.cfg.fps || 30 },
    },
    audio: {
      channelCount: state.cfg.audio_channels || 2,
      sampleRate: state.cfg.audio_samplerate || 48000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };

  // First request permission (labels may be empty until granted).
  state.stream = await navigator.mediaDevices.getUserMedia(constraints);

  // If the user provided preferred device labels, try to re-open using exact deviceId matches.
  const wantCam = (state.cfg.preferred_video_device_label || "").trim().toLowerCase();
  const wantMic = (state.cfg.preferred_audio_device_label || "").trim().toLowerCase();
  if ((wantCam || wantMic) && navigator.mediaDevices.enumerateDevices) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cam = wantCam ? devices.find(d => d.kind === "videoinput" && (d.label || "").toLowerCase().includes(wantCam)) : null;
    const mic = wantMic ? devices.find(d => d.kind === "audioinput" && (d.label || "").toLowerCase().includes(wantMic)) : null;
    if (cam || mic) {
      // Stop previous stream and reopen with targeted devices.
      for (const t of state.stream.getTracks()) t.stop();
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: cam ? { deviceId: { exact: cam.deviceId }, width: constraints.video.width, height: constraints.video.height, frameRate: constraints.video.frameRate } : constraints.video,
        audio: mic ? { deviceId: { exact: mic.deviceId }, ...constraints.audio } : constraints.audio,
      });
    }
  }

  const v = el("cam");
  v.srcObject = state.stream;
  await v.play();

  await loadOverlay();
  startDrawLoop();
}

async function loadOverlay() {
  state.overlayImg = null;
  if (!state.cfg) return;
  if (!state.cfg.overlay_enabled || !state.cfg.overlay_filename) return;
  const img = new Image();
  img.src = "/overlays/" + encodeURIComponent(state.cfg.overlay_filename) + "?t=" + Date.now();
  await new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("overlay load failed"));
  });
  state.overlayImg = img;
}

function startDrawLoop() {
  cancelAnimationFrame(state.drawReq);
  const canvas = el("stage");
  const ctx = canvas.getContext("2d");
  const v = el("cam");
  const cfg = state.cfg || {};

  canvas.width = cfg.width || 1280;
  canvas.height = cfg.height || 720;

  const crop = (cfg.crop || {});
  const brightness = Number(cfg.brightness || 0);
  const contrast = Number(cfg.contrast || 1);
  const saturation = Number(cfg.saturation || 1);

  function loop() {
    if (v.readyState >= 2) {
      const vw = v.videoWidth || canvas.width;
      const vh = v.videoHeight || canvas.height;

      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (crop.enabled && crop.w > 0 && crop.h > 0) {
        sx = Math.max(0, crop.x|0);
        sy = Math.max(0, crop.y|0);
        sw = Math.max(1, crop.w|0);
        sh = Math.max(1, crop.h|0);
      }
      // Keep source rect within bounds.
      if (sx + sw > vw) sw = Math.max(1, vw - sx);
      if (sy + sh > vh) sh = Math.max(1, vh - sy);

      const b = Math.max(0, 1 + brightness); // brightness -1..1 -> factor
      ctx.filter = `brightness(${b}) contrast(${contrast}) saturate(${saturation})`;
      ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      ctx.filter = "none";

      if (state.overlayImg) {
        ctx.drawImage(state.overlayImg, 0, 0, canvas.width, canvas.height);
      }
    }
    state.drawReq = requestAnimationFrame(loop);
  }
  loop();
}

async function startSession() {
  setStatus("Starting...");
  await ensureMedia();
  const data = await apiJson("/api/session/start", {});
  state.phase = "session";
  state.active = true;
  state.code = data.code;
  state.qrUrl = data.qr_url;
  state.expiresAt = data.expires_at;
  state.timers.sessionDuration = data.session_duration_seconds;
  state.timers.preDelay = data.pre_clip_delay_seconds;
  state.timers.clipDuration = data.clip_duration_seconds;
  state.sessionEndsAt = Date.now() + state.timers.sessionDuration * 1000;

  el("qrImg").src = `/api/session/${encodeURIComponent(state.code)}/qr.png`;
  setIdle(false);
  setSessionUI(true);
  setStatus("Session ready");
}

async function endSession(showQr) {
  if (state.code) {
    try { await apiJson(`/api/session/${encodeURIComponent(state.code)}/stop`, {}); } catch {}
  }
  state.active = false;
  state.recording = false;
  state.phase = showQr ? "ended" : "idle";

  if (showQr) {
    setIdle(false);
    setSessionUI(false, true);
    setStatus("Session ended (scan QR)");
    el("subtitle").textContent = "Session ended. Scan the QR to download for 24 hours. Tap Start for a new session.";
  } else {
    state.code = null;
    state.qrUrl = null;
    state.expiresAt = null;
    setSessionUI(false);
    setIdle(true);
    setStatus("Idle");
    el("subtitle").textContent = "Tap start, record clips, scan the QR to download for 24 hours.";
    el("sessionTimer").textContent = "00:00";
  }
}

function showCountdown(n) {
  el("countdown").classList.add("on");
  el("countNum").textContent = String(n);
}
function hideCountdown() {
  el("countdown").classList.remove("on");
}

async function countdown(seconds) {
  for (let i = seconds; i > 0; i--) {
    showCountdown(i);
    await new Promise((r) => setTimeout(r, 1000));
  }
  hideCountdown();
}

async function uploadBlob(blob, filename) {
  const fd = new FormData();
  fd.append("file", blob, filename);
  const r = await fetch(`/api/session/${encodeURIComponent(state.code)}/upload`, {
    method: "POST",
    body: fd,
  });
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
    setStatus("Get ready...");
    await countdown(state.timers.preDelay);

    const canvas = el("stage");
    const stream = canvas.captureStream(state.cfg.fps || 30);
    for (const t of state.stream.getAudioTracks()) stream.addTrack(t);

    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.recorder = rec;

    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) state.chunks.push(ev.data);
    };

    const stopped = new Promise((res) => (rec.onstop = () => res()));

    setStatus("Recording...");
    rec.start(250);
    await new Promise((r) => setTimeout(r, state.timers.clipDuration * 1000));
    rec.stop();
    await stopped;

    const blob = new Blob(state.chunks, { type: rec.mimeType || "video/webm" });
    setStatus("Uploading...");
    await uploadBlob(blob, `clip.webm`);
    setStatus("Saved. Record another?");
  } catch (e) {
    setStatus("Error: " + e.message);
  } finally {
    state.recording = false;
    state.recorder = null;
    state.chunks = [];
  }
}

function tick() {
  if (state.active) {
    const left = (state.sessionEndsAt - Date.now()) / 1000;
    el("sessionTimer").textContent = fmt(left);
    if (left <= 0) {
      endSession(true);
    }
  }
  requestAnimationFrame(tick);
}

function bind() {
  el("startBtn").addEventListener("click", async () => {
    try {
      el("subtitle").textContent = "Tap start, record clips, scan the QR to download for 24 hours.";
      await startSession();
    } catch (e) {
      setStatus("Error: " + e.message);
    }
  });
  el("recordBtn").addEventListener("click", recordClip);
  el("stopBtn").addEventListener("click", () => endSession(true));
}

async function init() {
  bind();
  setIdle(true);
  setSessionUI(false);
  setStatus("Idle");
  el("sessionTimer").textContent = "00:00";
  loadVersionTag();
  tick();

  // Warm up permissions on first tap only; do nothing here to avoid auto prompts.
}

init();
