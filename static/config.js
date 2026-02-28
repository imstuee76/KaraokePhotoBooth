const el = (id) => document.getElementById(id);
let liveMode = false;

function msg(t, bad = false) {
  const m = el("msg");
  m.textContent = t;
  m.style.color = bad ? "#ffb3b3" : "rgba(245,242,234,.85)";
}

function getVal(id) {
  const e = el(id);
  if (!e) return null;
  if (e.type === "number") return Number(e.value);
  return e.value;
}

function payloadFromForm() {
  return {
    base_qr_url: getVal("base_qr_url"),
    session_ttl_hours: getVal("session_ttl_hours"),
    session_duration_seconds: getVal("session_duration_seconds"),
    pre_clip_delay_seconds: getVal("pre_clip_delay_seconds"),
    clip_duration_seconds: getVal("clip_duration_seconds"),
    idle_text: getVal("idle_text"),
    show_main_session_controls: getVal("show_main_session_controls") === "true",
    theme_name: getVal("theme_name"),
    idle_background_filename: getVal("idle_background_filename"),

    preferred_video_device_label: getVal("preferred_video_device_label"),
    preferred_audio_device_label: getVal("preferred_audio_device_label"),

    width: getVal("width"),
    height: getVal("height"),
    fps: getVal("fps"),
    h264_crf: getVal("h264_crf"),
    h264_preset: getVal("h264_preset"),

    audio_codec: getVal("audio_codec"),
    audio_bitrate_k: getVal("audio_bitrate_k"),
    audio_samplerate: getVal("audio_samplerate"),
    audio_channels: Number(getVal("audio_channels")),

    brightness: Number(getVal("brightness")),
    contrast: Number(getVal("contrast")),
    saturation: Number(getVal("saturation")),

    overlay_enabled: getVal("overlay_enabled") === "true",
    overlay_filename: getVal("overlay_filename"),

    crop: {
      enabled: getVal("crop_enabled") === "true",
      x: getVal("crop_x"),
      y: getVal("crop_y"),
      w: getVal("crop_w"),
      h: getVal("crop_h"),
    },
  };
}

async function save() {
  msg("Saving...");
  const payload = payloadFromForm();
  const r = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    let d = "save failed";
    try { d = (await r.json()).detail || d; } catch {}
    msg(d, true);
    return;
  }
  // Read-back check for persistence.
  try {
    const check = await fetch("/api/config", { cache: "no-store" }).then((x) => x.json());
    if ((check.theme_name || "") === (payload.theme_name || "")) {
      msg("Saved to disk.");
    } else {
      msg("Saved, but read-back mismatch.", true);
    }
  } catch {
    msg("Saved.");
  }
}

async function liveStart() {
  const r = await fetch("/api/live-tune/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) { msg("Live mode start failed", true); return; }
  liveMode = true;
  await livePush();
  msg("Live mode started. Go to booth screen and adjust visually.");
}

async function liveStop() {
  await fetch("/api/live-tune/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  liveMode = false;
  msg("Live mode stopped.");
}

async function liveSave() {
  const r = await fetch("/api/live-tune/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) { msg("Live save failed", true); return; }
  liveMode = false;
  msg("Live values saved to config.");
}

async function livePush() {
  if (!liveMode) return;
  await fetch("/api/live-tune/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payloadFromForm()),
  });
}

async function uploadOverlay() {
  const f = el("overlay_upload").files[0];
  if (!f) return;
  msg("Uploading overlay...");
  const fd = new FormData();
  fd.append("file", f);
  const r = await fetch("/api/overlay/upload", { method: "POST", body: fd });
  if (!r.ok) {
    msg("Upload failed", true);
    return;
  }
  const data = await r.json();
  const sel = el("overlay_filename");
  // rebuild options
  const cur = data.filename;
  sel.innerHTML = '<option value="">(none)</option>' + data.overlays.map(o => {
    const s = o === cur ? " selected" : "";
    return `<option value="${o}"${s}>${o}</option>`;
  }).join("");
  rebuildFramePicker(data.overlays, cur);
  msg("Overlay uploaded.");
}

async function uploadBackground() {
  const f = el("bg_upload").files[0];
  if (!f) return;
  msg("Uploading background...");
  const fd = new FormData();
  fd.append("file", f);
  const r = await fetch("/api/background/upload", { method: "POST", body: fd });
  if (!r.ok) {
    msg("Background upload failed", true);
    return;
  }
  const data = await r.json();
  const sel = el("idle_background_filename");
  const cur = data.filename;
  sel.innerHTML = '<option value="">(none - black)</option>' + data.backgrounds.map(b => {
    const s = b === cur ? " selected" : "";
    return `<option value="${b}"${s}>${b}</option>`;
  }).join("");
  msg("Background uploaded.");
}

function applyPreset() {
  const idx = el("preset").value;
  if (idx === "") return;
  const p = window.__PRESETS__[Number(idx)];
  if (!p) return;
  el("width").value = p.width;
  el("height").value = p.height;
  el("fps").value = p.fps;
  el("h264_crf").value = p.crf;
  el("h264_preset").value = p.preset;
  el("audio_bitrate_k").value = p.audio_bitrate_k;
  msg("Preset applied (not saved yet).");
}

function rebuildFramePicker(frames, selected) {
  const box = el("framePicker");
  if (!box) return;
  const noneOn = selected ? "" : " on";
  box.innerHTML = `<button type="button" class="frame-card${noneOn}" data-frame=""><div class="frame-none">No frame</div></button>` +
    frames.map((o) => {
      const on = o === selected ? " on" : "";
      return `<button type="button" class="frame-card${on}" data-frame="${o}">
        <img src="/overlays/${encodeURIComponent(o)}?t=${Date.now()}" alt="${o}" />
        <span>${o}</span>
      </button>`;
    }).join("");
  bindFramePicker();
}

function bindFramePicker() {
  const box = el("framePicker");
  if (!box) return;
  box.querySelectorAll(".frame-card").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.getAttribute("data-frame") || "";
      el("overlay_filename").value = name;
      el("overlay_enabled").value = name ? "true" : "false";
      box.querySelectorAll(".frame-card").forEach((x) => x.classList.remove("on"));
      btn.classList.add("on");
      await livePush();
      msg(name ? `Frame selected: ${name}` : "Frame cleared");
    });
  });
}

el("saveBtn").addEventListener("click", save);
el("liveStartBtn").addEventListener("click", liveStart);
el("liveStopBtn").addEventListener("click", liveStop);
el("liveSaveBtn").addEventListener("click", liveSave);
el("overlay_upload").addEventListener("change", uploadOverlay);
el("bg_upload").addEventListener("change", uploadBackground);
el("preset").addEventListener("change", applyPreset);
[
  "width","height","fps","h264_crf","h264_preset","audio_codec","audio_bitrate_k","audio_samplerate","audio_channels",
  "brightness","contrast","saturation","overlay_enabled","overlay_filename","crop_enabled","crop_x","crop_y","crop_w","crop_h","theme_name"
].forEach((id) => {
  const n = el(id);
  if (!n) return;
  n.addEventListener("input", livePush);
  n.addEventListener("change", livePush);
});
bindFramePicker();
msg("");

// Simple camera preview (client-side) so we don't lock the device with server-side ffmpeg.
(async () => {
  try {
    const v = document.getElementById("cfgCam");
    if (!v || !navigator.mediaDevices) return;
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    v.srcObject = s;
    await v.play();
  } catch (e) {
    msg("Camera preview unavailable: " + e.message, true);
  }
})();
