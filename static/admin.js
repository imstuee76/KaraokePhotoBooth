const el = (id) => document.getElementById(id);

let active = null;

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function setMsg(t, bad = false) {
  const m = el("msg");
  m.textContent = t;
  m.style.color = bad ? "#ffb3b3" : "rgba(245,242,234,.85)";
}

async function api(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

async function sync() {
  const r = await fetch("/api/session/active", { cache: "no-store" });
  if (!r.ok) return;
  const p = await r.json();
  active = p.active ? p : null;
  if (!active) {
    el("status").textContent = "No active session";
    el("code").textContent = "";
    el("timer").textContent = "";
    return;
  }
  el("status").textContent = "Session active";
  el("code").textContent = "Code: " + active.code;
}

async function start() {
  setMsg("Starting session...");
  try {
    await api("/api/session/start", {});
    await sync();
    setMsg("Session started.");
  } catch (e) {
    setMsg(e.message, true);
  }
}

async function stop() {
  setMsg("Stopping session...");
  try {
    await api("/api/session/stop-active", {});
    await sync();
    setMsg("Session stopped.");
  } catch (e) {
    setMsg(e.message, true);
  }
}

function tick() {
  if (active && active.ends_at) {
    const left = (Date.parse(active.ends_at) - Date.now()) / 1000;
    el("timer").textContent = "Left: " + fmt(left);
  }
  requestAnimationFrame(tick);
}

el("startBtn").addEventListener("click", start);
el("stopBtn").addEventListener("click", stop);
sync();
setInterval(sync, 3000);
tick();

