const el = (id) => document.getElementById(id);

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
  const r = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payloadFromForm()),
  });
  if (!r.ok) {
    let d = "save failed";
    try { d = (await r.json()).detail || d; } catch {}
    msg(d, true);
    return;
  }
  msg("Saved. Refresh preview if needed.");
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
  msg("Overlay uploaded.");
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

el("saveBtn").addEventListener("click", save);
el("overlay_upload").addEventListener("change", uploadOverlay);
el("preset").addEventListener("change", applyPreset);
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
