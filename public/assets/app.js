import { LIMITS, categoryOfName, sizeMessage, planParts, cleanName } from "/assets/limits.js";
const $ = (i) => document.getElementById(i);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (b) => { if (!b) return "0 B"; const k = 1024, u = ["B", "KB", "MB", "GB", "TB"], i = Math.min(4, Math.floor(Math.log(b) / Math.log(k))); return (b / Math.pow(k, i)).toFixed(1) + " " + u[i]; };
const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : Math.floor(s / 86400) + " d ago"; };
const TITLES = { all: "ALL MEDIA ARCHIVE", photos: "PHOTOS ONLY", videos: "VIDEOS ONLY", favorites: "FAVORITES", trash: "TRASH" };
const KIND = { files: "all", all: "all", photos: "image", videos: "video", favorites: "favorites", trash: "trash" };
const ACTIVE = ["bg-blue-600/15", "text-cyan-300", "border", "border-cyan-500/30", "shadow-[0_0_15px_rgba(6,182,212,0.15)]"];
const IC = (p, c = "w-4 h-4") => `<svg class="${c}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${p}"/></svg>`;
const P = { dl: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4", trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16", star: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z", add: "M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z", file: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", restore: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15", minus: "M20 12H4", plus: "M12 4v16m8-8H4" };

let me = null, st = { total: 0, photos: 0, videos: 0, docs: 0, favs: 0, trash: 0 };
let tab = "overview", sub = "", search = "", fileFilter = "all", dense = true;
let items = [], lbList = [], lbIdx = 0, ctx = "", pickMid = "", pending = [], resumeT = null, cur = null, busy = false, toastT = 0;

const api = async (path, o = {}) => { const r = await fetch(path, { ...o, headers: { ...(o.headers || {}), "X-CSRF": me ? me.csrf : "" } }); if (r.status === 401 || r.status === 423) { location.href = "/"; throw new Error("auth"); } if (r.status === 503) { render(); throw new Error("auth"); } return r; };
const J = { "Content-Type": "application/json" }, send = (u, m, b) => api(u, { method: m, headers: J, body: b ? JSON.stringify(b) : undefined });
const jpost = async (path, body) => { const r = await api(path, { method: "POST", headers: J, body: JSON.stringify(body || {}) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || "Upload failed."); return d; };
const toast = (m, ms = 4500) => { const t = $("toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), ms); };
const loadList = async (kind) => { let out = []; for (let off = 0, i = 0; i < 25; i++, off += 200) { const r = await (await api(`/api/media?kind=${kind}&offset=${off}`)).json(); out = out.concat(r); if (r.length < 200) break; } return out; };
const typeOf = (f) => { const e = (f.name.split(".").pop() || "").toLowerCase(); return f.mime === "application/pdf" || e === "pdf" ? "pdf" : ["zip", "rar", "7z", "tar", "gz", "bz2"].includes(e) ? "archive" : ["doc", "docx", "txt", "rtf", "odt", "xlsx", "xls", "csv", "json", "md"].includes(e) ? "document" : f.mime.startsWith("image/") ? "image" : f.mime.startsWith("video/") ? "video" : "other"; };
const extOf = (f) => (f.name.split(".").pop() || "bin").toLowerCase();

/* ---------- sidebar ---------- */
const toggleSidebar = (open) => { const sb = $("sidebar"), bd = $("drawer-backdrop"); sb.classList.toggle("-translate-x-full", !open); bd.classList.toggle("hidden", !open); };

/* ---------- badges / storage ---------- */
const setBadges = () => {
  const set = (i, v) => { const e = $(i); if (e) e.textContent = v; };
  set("badge-files", st.total); set("badge-all", st.photos + st.videos); set("badge-photos", st.photos); set("badge-videos", st.videos); set("badge-favs", st.favs); set("badge-trash", st.trash);
};

/* ---------- overview ---------- */
const ring = (id, pct, len) => { const e = $(id); if (e) e.setAttribute("stroke-dashoffset", (len * (1 - Math.min(100, Math.max(0, pct)) / 100)).toFixed(2)); };
const proj = (lat, lon) => [((lon + 180) / 360) * 1000, 300 - 3.4 * lat]; // fitted to the stylised map in the card
async function pingMs() { const t = performance.now(); await fetch("/api/security/state", { cache: "no-store" }); return Math.round(performance.now() - t); }
async function renderOverview() {
  const [ov, ping, sec] = await Promise.all([api("/api/overview").then((r) => r.json()), pingMs().catch(() => 0), fetch("/api/security/state").then((r) => r.json()).catch(() => ({ state: "open" }))]);
  st = { ...st, ...ov.stats }; setBadges();
  const pct = Math.min(100, (ov.used / ov.cap) * 100);
  $("storage-percent-label").innerHTML = `${pct.toFixed(1)}<span class="text-xs text-cyan-400">%</span>`;
  ring("storage-ring-circle", pct, 301.59);
  $("storage-used-label").textContent = fmt(ov.used); $("storage-free-label").textContent = fmt(Math.max(0, ov.cap - ov.used));
  $("storage-used-bar").style.width = pct + "%";
  $("gauge-photos-count").textContent = ov.stats.photos; $("gauge-videos-count").textContent = ov.stats.videos; $("gauge-files-count").textContent = ov.stats.docs;
  const g = [[`${ov.dbMs}ms`, (ov.dbMs / 200) * 100, "D1 query"], [ov.sessions.length, (ov.sessions.length / 10) * 100, "Signed in"], [`${ping}ms`, (ping / 500) * 100, "Round trip"], [ov.failed, (ov.failed / 10) * 100, "Failed sign-ins"]];
  g.forEach(([v, p, s], i) => { $(`gauge-${i + 1}-val`).textContent = v; ring(`gauge-${i + 1}-ring`, p, 113.1); $(`gauge-${i + 1}-sub`).textContent = s; });
  const state = sec.state === "lockdown" ? "LOCKDOWN" : "OPEN";
  $("state-label").textContent = state; $("status-chip").textContent = state === "OPEN" ? "READY" : state;
  // 24-hour traffic
  const byHour = new Map(ov.traffic.map((r) => [r.hour, r])), hrs = Array.from({ length: 24 }, (_, i) => ov.hour - 23 + i), reqs = hrs.map((h) => (byHour.get(h) || {}).req || 0), max = Math.max(1, ...reqs);
  const lab = (h) => new Date(h * 3600e3).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }).replace(/:\d\d$/, ":00");
  $("traffic-bars").innerHTML = hrs.map((h, i) => `<div class="flex-1 ${reqs[i] ? "bg-cyan-500/60" : "bg-slate-800/40"} hover:bg-cyan-500 rounded-t h-1 transition-all duration-200" title="${lab(h)}: ${reqs[i]} requests"></div>`).join("");
  [...$("traffic-bars").children].forEach((e, i) => { e.style.height = Math.max(4, Math.round((reqs[i] / max) * 100)) + "%"; });
  [0, 6, 12, 18].forEach((i, k) => { $(`tl-${k}`).textContent = lab(hrs[i]); });
  const totReq = reqs.reduce((a, b) => a + b, 0), totBytes = ov.traffic.reduce((a, r) => a + r.bytes, 0);
  $("traffic-chip").textContent = `${totReq} REQ`; $("map-requests").textContent = totReq; $("map-bandwidth").textContent = fmt(totBytes); $("map-visitors").textContent = ov.signins;
  // sessions + map
  const ss = ov.sessions, geo = ss.filter((s) => s.lat !== null && s.lon !== null);
  $("sessions-chip").textContent = `${ss.length} ACTIVE`; $("map-sessions-chip").textContent = `${ss.length} SESSIONS`;
  $("sessions-empty").classList.toggle("hidden", ss.length > 0);
  $("sessions-list").innerHTML = ss.map((s) => `<div class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#040817] border border-blue-950/70"><div class="min-w-0"><div class="text-[11px] font-mono text-slate-200 truncate">${esc([s.city, s.country].filter(Boolean).join(", ") || "Unknown location")}</div><div class="text-[9px] font-mono text-slate-400">Active ${ago(s.last_seen)} · since ${new Date(s.created_at).toLocaleString()}</div></div>${s.cur ? '<span class="text-[9px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/50">THIS DEVICE</span>' : `<button data-sdel="${s.id}" class="text-[10px] font-mono px-2 py-1 rounded-lg text-rose-300 bg-rose-950/40 border border-rose-900/50 hover:bg-rose-900/60">Sign out</button>`}</div>`).join("");
  $("map-pins").innerHTML = geo.map((s) => { const [x, y] = proj(s.lat, s.lon); return `<g class="map-pin"><circle class="radar-pulse-ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="none" stroke="#22d3ee" stroke-width="1.5"/><circle class="pin-core" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#38bdf8"/><title>${esc([s.city, s.country].filter(Boolean).join(", "))}</title></g>`; }).join("");
  $("map-idle").classList.toggle("hidden", geo.length > 0);
  $("map-idle-title").textContent = ss.length ? "NO LOCATION DATA" : "NO ACTIVE SESSIONS";
  $("map-idle-sub").textContent = ss.length ? `${ss.length} active ${ss.length === 1 ? "session" : "sessions"} · location unavailable` : "No active connections";
  const pend = await (await api("/api/media/video/pending")).json().catch(() => []);
  $("resume-slot").innerHTML = pend.map((u) => `<div class="glass-card rounded-2xl p-4 border border-amber-500/30 flex items-center justify-between gap-3"><div class="min-w-0"><div class="text-xs font-bold font-mono tracking-wider text-amber-300 uppercase">Unfinished upload</div><div class="text-[11px] font-mono text-slate-400 truncate">${esc(u.name)} · ${fmt(u.size)} — pick the same file to continue</div></div><div class="flex gap-2 shrink-0"><button data-resume="${u.id}" data-name="${esc(u.name)}" data-size="${u.size}" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-black bg-cyan-400 hover:bg-cyan-300 font-mono">Resume</button><button data-discard="${u.id}" class="px-3 py-1.5 rounded-lg text-xs font-mono text-slate-400 hover:text-white bg-slate-900/60 border border-blue-950">Discard</button></div></div>`).join("");
}

/* ---------- files list ---------- */
const FILE_STYLE = { pdf: ["bg-rose-950/80 text-rose-300 border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.2)]", "text-rose-400"], archive: ["bg-amber-950/80 text-amber-300 border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.2)]", "text-amber-400"], document: ["bg-blue-950/80 text-blue-300 border-blue-500/40", "text-blue-400"], image: ["bg-cyan-950/80 text-cyan-300 border-cyan-500/40", "text-cyan-400"], video: ["bg-purple-950/80 text-purple-300 border-purple-500/40", "text-purple-400"], other: ["bg-slate-800 text-slate-300 border-slate-700", "text-slate-300"] };
const visible = (list) => list.filter((f) => !search || f.name.toLowerCase().includes(search.toLowerCase()));
function setFileFilter(f) {
  fileFilter = f;
  document.querySelectorAll("[data-ff]").forEach((b) => { b.className = "file-filter-btn px-3 py-1.5 rounded-lg bg-[#040816] text-slate-400 hover:text-white border border-blue-950 transition-all"; });
  const a = $("ff-" + f); if (a) a.className = "file-filter-btn px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 transition-all font-semibold";
  drawFiles();
}
function drawFiles() {
  const list = visible(items).filter((f) => { const t = typeOf(f); return fileFilter === "all" || (fileFilter === "media" ? t === "image" || t === "video" : t === fileFilter); });
  $("files-total-badge").textContent = list.length; $("files-empty-state").classList.toggle("hidden", list.length > 0);
  $("files-list-container").innerHTML = list.map((f) => { const t = typeOf(f), [bc, ic] = FILE_STYLE[t];
    return `<div class="glass-card rounded-xl p-3 sm:p-3.5 flex items-center justify-between gap-3 hover:border-amber-400/40 transition-all group"><div class="flex items-center gap-3 min-w-0"><div class="w-10 h-10 rounded-xl ${bc} border flex items-center justify-center shrink-0">${IC(P.file, "w-4 h-4 " + ic)}</div><div class="min-w-0"><div class="flex items-center gap-2"><a href="/api/media/${f.id}" target="_blank" rel="noopener" class="text-xs font-semibold text-white truncate group-hover:text-amber-300 transition-colors font-mono">${esc(f.name)}</a><span class="text-[8px] font-mono px-1.5 py-0.5 rounded uppercase ${bc} font-bold">${esc(extOf(f))}</span></div><div class="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-slate-400"><span class="text-slate-300">${fmt(f.size)}</span><span>·</span><span>${new Date(f.created_at).toLocaleDateString()}</span><span>·</span><span class="text-emerald-400 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> AES-256</span></div></div></div><div class="flex items-center gap-1.5 shrink-0">${rowBtns(f)}</div></div>`; }).join("");
}
const BTN = "p-1.5 rounded-lg bg-blue-950/60 hover:bg-blue-900 border border-blue-900/60 text-slate-300 hover:text-white transition-all cursor-pointer";
const rowBtns = (f) => ctx === "trash" ? `<button data-restore="${f.id}" title="Restore" class="${BTN}">${IC(P.restore, "w-3.5 h-3.5")}</button><button data-del="${f.id}" data-perm="1" title="Delete forever" class="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 text-rose-400 hover:text-rose-200 transition-all cursor-pointer">${IC(P.trash, "w-3.5 h-3.5")}</button>` :
  `<button data-fav="${f.id}" data-on="${f.favorite ? 1 : 0}" title="Favorite" class="${f.favorite ? BTN.replace("text-slate-300", "text-amber-400") : BTN}">${IC(P.star, "w-3.5 h-3.5")}</button><button data-add="${f.id}" title="Add to…" class="${BTN}">${IC(P.add, "w-3.5 h-3.5")}</button><a href="/api/media/${f.id}?download=1" title="Download" class="${BTN}">${IC(P.dl, "w-3.5 h-3.5")}</a><button data-del="${f.id}" title="Move to Trash" class="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 text-rose-400 hover:text-rose-200 transition-all cursor-pointer">${IC(P.trash, "w-3.5 h-3.5")}</button>`;

/* ---------- media grid ---------- */
function setGridSize(size) {
  dense = size === "dense"; const g = $("media-grid");
  g.className = dense ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2" : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3";
  $("btn-dense").className = dense ? "px-2 py-1 rounded bg-blue-600/80 text-white" : "px-2 py-1 rounded text-slate-400 hover:text-white";
  $("btn-normal").className = dense ? "px-2 py-1 rounded text-slate-400 hover:text-white" : "px-2 py-1 rounded bg-blue-600/80 text-white";
}
function drawGrid() {
  const list = visible(items); lbList = list.filter((f) => /^(image|video)\//.test(f.mime));
  $("media-count-badge").textContent = `${list.length} FILES`; $("empty-state").classList.toggle("hidden", list.length > 0);
  $("empty-state-title").textContent = tab === "photos" ? "NO PHOTOS" : tab === "videos" ? "NO VIDEOS" : tab === "favorites" ? "NO FAVORITES" : tab === "trash" ? "TRASH IS EMPTY" : sub ? "EMPTY" : "NO MEDIA";
  $("media-grid").innerHTML = list.map((f) => {
    const vid = f.mime.startsWith("video/"), img = f.mime.startsWith("image/") && f.mime !== "image/heic", u = "/api/media/" + f.id;
    const face = f.has_thumb ? `<img src="${u}?thumb=1" alt="${esc(f.name)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">` : img ? `<img src="${u}" alt="${esc(f.name)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">` : `<div class="w-full h-full flex items-center justify-center text-[10px] font-mono font-bold text-cyan-400 uppercase">${esc(extOf(f))}</div>`;
    return `<div data-open="${f.id}" class="group relative aspect-square bg-[#030612] rounded-lg overflow-hidden border border-blue-950/80 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all duration-150 cursor-pointer">${face}<div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>${vid ? '<div class="absolute bottom-1 right-1 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm border border-blue-500/30 text-[9px] font-mono text-cyan-300"><svg class="w-2.5 h-2.5 fill-current text-cyan-400" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>' : ""}${f.favorite ? '<div class="absolute top-1 right-1 p-1 rounded bg-black/60 text-amber-400"><svg class="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></div>' : ""}<div class="absolute bottom-1 left-1 max-w-[80%] truncate text-[9px] font-mono text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">${esc(f.name)}</div></div>`;
  }).join("");
}

/* ---------- lightbox ---------- */
function showLb() {
  const f = lbList[lbIdx]; if (!f) return closeLb();
  const vid = f.mime.startsWith("video/"), u = "/api/media/" + f.id, tr = ctx === "trash", col = ctx.startsWith("col:");
  $("lb-title").textContent = f.name; $("lb-meta").textContent = `${fmt(f.size)} · ${new Date(f.created_at).toLocaleDateString()}`;
  $("lb-index-counter").textContent = `${lbIdx + 1} / ${lbList.length}`; $("lb-type-badge").textContent = vid ? "VIDEO" : "PHOTO";
  $("lb-media-container").innerHTML = vid ? `<video src="${u}" controls autoplay playsinline class="max-w-full max-h-[75vh] rounded-lg"></video>` : f.mime === "image/heic" ? `<div class="text-xs font-mono text-slate-400 text-center p-8">HEIC preview isn't supported by browsers.<br>Use download to open it.</div>` : `<img src="${u}" alt="${esc(f.name)}" class="max-w-full max-h-[75vh] object-contain rounded-lg">`;
  $("lb-fav-btn").classList.toggle("hidden", tr); $("lb-fav-btn").classList.toggle("text-amber-400", !!f.favorite); $("lb-fav-btn").classList.toggle("text-slate-400", !f.favorite);
  $("lb-download-btn").href = u + "?download=1"; $("lb-add-btn").classList.toggle("hidden", tr); $("lb-rm-btn").classList.toggle("hidden", !col);
  $("lb-restore-btn").classList.toggle("hidden", !tr); $("lb-del-btn").classList.remove("hidden"); $("lb-del-btn").title = tr ? "Delete forever" : "Move to Trash";
}
const closeLb = () => { $("lightbox").classList.add("hidden"); $("lb-media-container").innerHTML = ""; };
const openLb = (id) => { const i = lbList.findIndex((f) => f.id === id); if (i < 0) return window.open("/api/media/" + id, "_blank", "noopener"); lbIdx = i; showLb(); $("lightbox").classList.remove("hidden"); };
const stepLb = (d) => { if (!lbList.length) return; lbIdx = (lbIdx + d + lbList.length) % lbList.length; showLb(); };

/* ---------- extra pages ---------- */
const HDR = (t, right = "") => `<div class="flex items-center justify-between border-b border-blue-950/70 pb-3"><h2 class="text-sm font-bold font-mono tracking-wider text-white uppercase">${t}</h2>${right}</div>`;
const GBTN = "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-black bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-400 hover:from-cyan-300 hover:to-blue-300 shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all cursor-pointer";
const SBTN = "px-3 py-1.5 rounded-lg text-xs font-mono text-slate-300 hover:text-white bg-slate-900/60 border border-blue-950 hover:border-cyan-500/40 transition-all";
const DBTN = "px-3 py-1.5 rounded-lg text-xs font-mono text-rose-300 bg-rose-950/40 border border-rose-900/50 hover:bg-rose-900/60 transition-all";
const CARD = "glass-card rounded-2xl p-5 border border-blue-950/80 space-y-3";
const FIELD = (id, label, type = "password", ac = "off") => `<div class="space-y-1.5"><label for="${id}" class="text-[10px] font-mono uppercase tracking-wider text-slate-400">${label}</label><input id="${id}" type="${type}" autocomplete="${ac}" class="w-full bg-[#040816] text-xs text-slate-200 px-3 py-2 rounded-lg border border-blue-950 focus:outline-none focus:border-cyan-400 font-mono"></div>`;
const EMPTY = (t, d) => `<div class="py-12 text-center rounded-2xl border border-dashed border-blue-950 bg-blue-950/10 space-y-1"><div class="text-xs font-mono font-semibold text-slate-300 uppercase">${t}</div><div class="text-[10px] font-mono text-slate-400">${d}</div></div>`;
async function renderPage() {
  const v = $("view-page");
  if (tab === "albums" || tab === "folders") {
    const kind = tab === "albums" ? "album" : "folder", cl = await (await api("/api/collections?kind=" + kind)).json(), Name = kind[0].toUpperCase() + kind.slice(1);
    v.innerHTML = HDR(tab.toUpperCase(), `<button data-new="${kind}" class="${GBTN}">${IC(P.plus, "w-3.5 h-3.5 text-black")}<span>New ${kind}</span></button>`) + (cl.length ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">${cl.map((c) => `<div class="glass-card rounded-xl p-4 space-y-3"><div><a href="#${tab}/${c.id}" class="text-xs font-semibold text-white hover:text-cyan-300 font-mono">${esc(c.name)}</a><div class="text-[10px] font-mono text-slate-400">${c.n} files</div></div><div class="flex gap-2"><button data-ren="${c.id}" class="${SBTN}">Rename</button><button data-cdel="${c.id}" class="${DBTN}">Delete</button></div></div>`).join("")}</div>` : EMPTY("No " + Name.toLowerCase() + "s yet", `Create one to organize your files.`));
  } else if (tab === "sessions") {
    const l = await (await api("/api/sessions")).json();
    v.innerHTML = HDR("ACTIVE SESSIONS", `<button data-revo="1" class="${SBTN}">Sign out all other sessions</button>`) + `<div class="space-y-2">${l.map((x) => `<div class="glass-card rounded-xl p-3.5 flex items-center justify-between gap-3"><div class="min-w-0"><div class="text-xs font-mono text-white truncate">${esc([x.city, x.country].filter(Boolean).join(", ") || "Unknown location")}</div><div class="text-[10px] font-mono text-slate-400">Signed in ${new Date(x.created_at).toLocaleString()} · last active ${new Date(x.last_seen).toLocaleString()}</div></div>${x.cur ? '<span class="text-[9px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/50">THIS DEVICE</span>' : `<button data-sdel="${x.id}" class="${DBTN}">Sign out</button>`}</div>`).join("")}</div>`;
  } else if (tab === "history") {
    const l = await (await api("/api/security/log")).json();
    v.innerHTML = HDR("LOGIN HISTORY") + (l.length ? `<div class="space-y-2">${l.map((e) => `<div class="glass-card rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-[11px] font-mono"><span class="text-slate-200">${esc(e.event.replace(/_/g, " "))}</span><span class="text-slate-400">${new Date(e.at).toLocaleString()}</span></div>`).join("")}</div>` : EMPTY("No activity yet", "Sign-ins and lock events appear here."));
  } else if (tab === "settings") {
    const l = await (await api("/api/passkeys")).json();
    v.innerHTML = HDR("SETTINGS") + `<div class="${CARD}"><h3 class="text-xs font-bold font-mono tracking-wider text-white uppercase">Passkeys</h3>${l.length ? `<div class="space-y-2">${l.map((k) => `<div class="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[#040817] border border-blue-950/70 text-[11px] font-mono text-slate-200"><span>${esc(k.name)}</span><button data-pkdel="${k.id}" class="${DBTN}">Remove</button></div>`).join("")}</div>` : `<p class="text-[11px] font-mono text-slate-400">No passkeys yet. Once you add one, sign-in requires it.</p>`}${FIELD("pks", "Secret code (needed to add or remove a passkey)")}<button data-pkadd="1" class="${GBTN}">Add a passkey</button></div>
    <div class="${CARD}"><h3 class="text-xs font-bold font-mono tracking-wider text-white uppercase">Login email</h3>${FIELD("le", "New login email", "email", "email")}${FIELD("ls", "Secret code")}<button data-lemail="1" class="${SBTN}">Change login email</button></div>
    <div class="${CARD}"><h3 class="text-xs font-bold font-mono tracking-wider text-white uppercase">Limits</h3><div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">${[["IMAGES / PDF", fmt(me.maxImage)], ["FILES", fmt(me.maxFile)], ["VIDEOS", fmt(me.maxVideo)], ["TOTAL", fmt(me.cap)]].map(([a, b]) => `<div class="p-2.5 rounded-xl bg-[#040817] border border-blue-950/70"><span class="text-[9px] font-mono text-slate-400 block">${a}</span><span class="text-xs font-mono font-bold text-cyan-300">${b}</span></div>`).join("")}</div><p class="text-[10px] font-mono text-slate-400">These are set in the project files.</p></div>`;
  }
}

/* ---------- maintenance hold (5+ failed sign-ins): the library is unreachable and a 12 h countdown shows ---------- */
let maintT = 0;
function showMaint(until) {
  $("maint").classList.remove("hidden"); $("maint-at").textContent = new Date(until).toLocaleString();
  const tick = () => { const ms = until - Date.now(); if (ms <= 0) { clearInterval(maintT); $("maint-clock").textContent = "00:00:00"; setTimeout(render, 5000); return; } const sec = Math.floor(ms / 1000); $("maint-clock").textContent = [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, "0")).join(":"); };
  clearInterval(maintT); tick(); maintT = setInterval(tick, 1000);
}
/* ---------- router ---------- */
async function render() {
  const h = location.hash.slice(1).split("/"); tab = h[0] || "overview"; sub = h[1] || "";
  if (!$("nav-" + tab)) tab = "overview";
  me = await (await fetch("/api/auth/me")).json().catch(() => null); if (!me || !me.csrf) { location.href = "/"; return; }
  if (me.held) { showMaint(me.holdUntil); return; }
  clearInterval(maintT); $("maint").classList.add("hidden");
  document.querySelectorAll(".nav-btn").forEach((b) => { b.classList.remove(...ACTIVE); b.classList.add("text-slate-400"); });
  const ab = $("nav-" + tab); ab.classList.add(...ACTIVE); ab.classList.remove("text-slate-400");
  document.title = (tab[0].toUpperCase() + tab.slice(1)) + " | private";
  for (const v of ["overview", "files", "media", "page"]) $("view-" + v).classList.add("hidden");
  ctx = ""; $("media-back").classList.add("hidden");
  toggleSidebar(false);
  if (tab === "overview") { $("view-overview").classList.remove("hidden"); $("resume-slot").innerHTML = ""; await renderOverview(); }
  else {
    st = { ...st, ...(await (await api("/api/stats")).json().catch(() => ({}))) }; setBadges();
    if (tab === "files") { $("view-files").classList.remove("hidden"); items = await loadList("all"); setFileFilter(fileFilter); }
    else if (KIND[tab]) { ctx = tab === "trash" ? "trash" : ""; $("view-media").classList.remove("hidden"); $("media-view-title").textContent = TITLES[tab]; items = await loadList(KIND[tab]); setGridSize(dense ? "dense" : "normal"); drawGrid(); }
    else if ((tab === "albums" || tab === "folders") && sub) {
      ctx = "col:" + sub; $("view-media").classList.remove("hidden"); $("media-back").href = "#" + tab; $("media-back").classList.remove("hidden");
      const [cl, it] = await Promise.all([api("/api/collections?kind=" + (tab === "albums" ? "album" : "folder")).then((r) => r.json()), api(`/api/collections/${sub}/media`).then((r) => r.json())]);
      const c = cl.find((x) => x.id === sub); $("media-view-title").textContent = c ? c.name.toUpperCase() : tab.toUpperCase(); items = it; setGridSize(dense ? "dense" : "normal"); drawGrid();
    } else { $("view-page").classList.remove("hidden"); await renderPage(); }
  }
}
const refresh = () => render();

/* ---------- uploads ---------- */
const bar = (name, l, t) => { $("upload-progress-container").classList.remove("hidden"); $("uploading-file-name").textContent = name; const p = Math.round((l / t) * 100); $("upload-percent").textContent = p + "%"; $("upload-bar").style.width = p + "%"; };
const xhrPut = (method, url, body, headers, onp) => new Promise((ok, no) => { const x = new XMLHttpRequest(); if (cur) cur.xhrs.add(x); x.open(method, url); for (const k in headers) x.setRequestHeader(k, headers[k]); x.upload.onprogress = (e) => onp(e.loaded); x.onload = () => ok(x); x.onerror = () => no(new Error("Network error. Check your connection.")); x.onabort = () => no(new Error("Upload cancelled.")); x.send(body); });
async function thumb(id, f) {
  try {
    let src, w, h, url = null;
    if (f.type.startsWith("video/")) { url = URL.createObjectURL(f); src = document.createElement("video"); src.muted = true; src.preload = "auto"; src.src = url; await new Promise((ok, no) => { src.onloadeddata = ok; src.onerror = no; }); src.currentTime = Math.min(1, (src.duration || 2) / 2); await new Promise((ok) => { src.onseeked = ok; }); w = src.videoWidth; h = src.videoHeight; }
    else if (f.type.startsWith("image/") && f.type !== "image/heic") { src = await createImageBitmap(f); w = src.width; h = src.height; } else return;
    const sc = Math.min(1, 400 / Math.max(w, h)), c = document.createElement("canvas"); c.width = Math.round(w * sc); c.height = Math.round(h * sc); c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    if (url) URL.revokeObjectURL(url);
    const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8)); if (b) await api(`/api/media/${id}/thumb`, { method: "POST", body: b });
  } catch {}
}
const upImage = async (f) => { cur = { xhrs: new Set() }; try { const x = await xhrPut("POST", "/api/media/upload", f, { "X-CSRF": me.csrf, "X-Filename": encodeURIComponent(f.name) }, (l) => bar(f.name, l, f.size)); if (x.status !== 201) throw new Error(f.name + ": " + (JSON.parse(x.responseText || "{}").message || "Upload failed.")); await thumb(JSON.parse(x.responseText).id, f); } finally { cur = null; } };
const upVideo = async (f, resume) => {
  const id = resume ? resume.id : (await jpost("/api/media/video/init", { name: f.name, size: f.size })).id;
  const have = resume ? (await jpost(`/api/media/video/${id}/parts`)).parts : [];
  cur = { xhrs: new Set(), cancelled: false }; const parts = []; let done = 0;
  try {
    for (const pt of planParts(f.size)) {
      const got = have.find((x) => x.n === pt.n); if (got) { done += pt.end - pt.start; parts.push({ n: pt.n, etag: got.etag }); continue; }
      let etag = null;
      for (let a = 1; a <= 3 && !etag; a++) {
        if (cur.cancelled) throw new Error("Upload cancelled.");
        const { url } = await jpost(`/api/media/video/${id}/part`, { n: pt.n });
        try { const x = await xhrPut("PUT", url, f.slice(pt.start, pt.end), {}, (l) => bar(f.name, done + l, f.size)); etag = x.status === 200 ? x.getResponseHeader("ETag") : null; if (!etag) throw new Error("The upload was blocked. Check the R2 CORS settings."); } catch (e) { if (a === 3 || cur.cancelled) throw e; }
      }
      done += pt.end - pt.start; parts.push({ n: pt.n, etag });
    }
    $("uploading-file-name").textContent = "Finishing " + f.name + "…"; const fin = await jpost(`/api/media/video/${id}/complete`, { parts }); await thumb(fin.id, f);
  } catch (e) { if (cur && cur.cancelled) await api(`/api/media/video/${id}/abort`, { method: "POST" }).catch(() => {}); throw e; } finally { cur = null; }
};
const checkFile = (f) => {
  const c = categoryOfName(f.name);
  if (!c) return `${f.name}: this file type isn't allowed. Use photos (JPG, PNG, GIF, WEBP, HEIC), PDF, MP4/MOV video, ZIP/RAR/7Z/TAR/GZ/BZ2 archives, or DOC, DOCX, TXT, RTF, ODT, XLSX, XLS, CSV, JSON, MD documents.`;
  if (!f.size) return `${f.name}: the file is empty.`;
  if (f.size > LIMITS[c]) return sizeMessage(f.name, f.size, c);
  if (f.type && (c === "video") !== f.type.startsWith("video/")) return `${f.name}: the file's contents don't match its extension.`;
  if (me.used + f.size > me.cap) return `${f.name}: not enough storage left under your limit.`;
  return "";
};
const openUp = () => $("upload-modal").classList.remove("hidden");
function closeUp() { if (cur) { cur.cancelled = true; cur.xhrs.forEach((x) => x.abort()); } $("upload-modal").classList.add("hidden"); $("upload-progress-container").classList.add("hidden"); $("upload-bar").style.width = "0%"; pending = []; }
async function runUploads(files) {
  if (busy || !files.length) return; busy = true; openUp(); let ok = 0; const errs = [];
  for (const f of files) {
    const bad = checkFile(f); if (bad) { errs.push(bad); continue; }
    try { await (categoryOfName(f.name) === "video" ? upVideo : upImage)(f); me.used += f.size; ok++; } catch (m) { errs.push((m && m.message) || String(m)); if (m && m.message === "Upload cancelled.") break; }
  }
  busy = false; closeUp(); toast(errs.length ? errs[errs.length - 1] : `Uploaded ${ok} ${ok === 1 ? "file" : "files"}`, errs.length ? 8000 : 4000); refresh();
}

/* ---------- actions ---------- */
async function addPasskey() { try { const sec = $("pks").value; if (!sec) return toast("Enter your secret code first."); if (!window.PublicKeyCredential || !PublicKeyCredential.parseCreationOptionsFromJSON) return toast("This browser doesn't support passkeys."); const ro = await send("/api/passkey/register/options", "POST", { secret: sec }); if (!ro.ok) return toast(((await ro.json().catch(() => ({}))).message) || "Couldn't start passkey setup."); const o = await ro.json(), c = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(o) }), r = await send("/api/passkey/register/verify", "POST", c.toJSON()); if (!r.ok) toast((await r.json()).message); } catch { toast("Passkey setup was cancelled or failed."); } refresh(); }
async function pickCollection(mid) {
  const all = [...(await (await api("/api/collections?kind=album")).json()).map((c) => ["album", c]), ...(await (await api("/api/collections?kind=folder")).json()).map((c) => ["folder", c])];
  if (!all.length) return toast("Create an album or folder first.");
  $("pick-select").innerHTML = all.map(([k, c]) => `<option value="${c.id}">${esc(c.name)} (${k})</option>`).join(""); pickMid = mid; $("pick-modal").classList.remove("hidden");
}
const cur2 = () => lbList[lbIdx];
const ACT = {
  toggleCurrentFavorite: async () => { const f = cur2(); if (!f) return; await send("/api/media/" + f.id, "PATCH", { favorite: !f.favorite }); f.favorite = f.favorite ? 0 : 1; showLb(); },
  closeLightbox: closeLb, prevMedia: () => stepLb(-1), nextMedia: () => stepLb(1),
  closeUploadModal: closeUp,
  startUpload: () => { if (pending.length) { const p = pending; pending = []; runUploads(p); } else $("modalFileInput").click(); },
  lbAdd: () => { const f = cur2(); if (f) pickCollection(f.id); },
  lbRemove: async () => { const f = cur2(); if (f && confirm("Remove this file from the collection? The file is kept.")) { await send(`/api/collections/${ctx.slice(4)}/items/${f.id}`, "DELETE"); closeLb(); refresh(); } },
  lbRestore: async () => { const f = cur2(); if (f) { await send("/api/media/" + f.id, "PATCH", { restore: true }); closeLb(); refresh(); } },
  lbDelete: async () => { const f = cur2(); if (!f) return; const perm = ctx === "trash"; if (confirm(perm ? "Delete this file forever?" : "Move this file to Trash?")) { await send("/api/media/" + f.id + (perm ? "?permanent=1" : ""), "DELETE"); closeLb(); refresh(); } },
  closePick: () => $("pick-modal").classList.add("hidden"),
  confirmPick: async () => { $("pick-modal").classList.add("hidden"); await send(`/api/collections/${$("pick-select").value}/items`, "POST", { media_id: pickMid }); toast("Added."); refresh(); },
};
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-tab],[data-ff],[data-grid],[data-pick],[data-act],[data-open],[data-fav],[data-del],[data-restore],[data-add],[data-new],[data-ren],[data-cdel],[data-sdel],[data-revo],[data-resume],[data-discard],[data-pkdel],[data-pkadd],[data-lemail],#btn-upload,#menu-btn,#drawer-backdrop,#btn-signout,#btn-start-upload"); if (!t) return;
  const d = t.dataset;
  try {
    if (d.tab) { location.hash = d.tab === "overview" ? "" : d.tab; if (!location.hash && tab === "overview") refresh(); return; }
    if (d.ff) return setFileFilter(d.ff);
    if (d.grid) return setGridSize(d.grid);
    if (d.pick) return $("vaultFileInput").click();
    if (d.act) return ACT[d.act] && ACT[d.act]();
    if (d.open) return openLb(d.open);
    if (t.id === "btn-upload") return openUp();
    if (t.id === "menu-btn") return toggleSidebar(true);
    if (t.id === "drawer-backdrop") return toggleSidebar(false);
    if (t.id === "btn-signout") { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.href = "/"; return; }
    if (d.fav) await send("/api/media/" + d.fav, "PATCH", { favorite: d.on !== "1" });
    else if (d.del) { if (!confirm(d.perm ? "Delete this file forever?" : "Move this file to Trash?")) return; await send("/api/media/" + d.del + (d.perm ? "?permanent=1" : ""), "DELETE"); }
    else if (d.restore) await send("/api/media/" + d.restore, "PATCH", { restore: true });
    else if (d.add) return pickCollection(d.add);
    else if (d.new) { const name = prompt("Name"); if (name) await send("/api/collections", "POST", { kind: d.new, name }); }
    else if (d.ren) { const name = prompt("New name"); if (name) await send("/api/collections/" + d.ren, "PATCH", { name }); }
    else if (d.cdel) { if (confirm("Delete this collection? Your files are kept.")) await send("/api/collections/" + d.cdel, "DELETE"); }
    else if (d.sdel) await send("/api/sessions/" + d.sdel, "DELETE");
    else if (d.revo) await send("/api/sessions/revoke-others", "POST");
    else if (d.resume) { resumeT = { id: d.resume, name: d.name, size: Number(d.size) }; return $("rfile").click(); }
    else if (d.discard) await send(`/api/media/video/${d.discard}/abort`, "POST");
    else if (d.pkadd) return addPasskey();
    else if (d.pkdel) { const sec = $("pks").value; if (!sec) return toast("Enter your secret code first."); if (!confirm("Remove this passkey?")) return; const r = await send("/api/passkeys/" + d.pkdel, "DELETE", { secret: sec }); if (!r.ok) toast(((await r.json().catch(() => ({}))).message) || "Couldn't remove it."); }
    else if (d.lemail) { const r = await send("/api/settings/login-email", "POST", { email: $("le").value.trim(), secret: $("ls").value }), j = await r.json().catch(() => ({})); toast(r.ok ? "Login email changed." : j.message || "Couldn't change it."); }
    else return;
    refresh();
  } catch (err) { if (!err || err.message !== "auth") toast((err && err.message) || "Something went wrong."); }
});
$("searchInput").addEventListener("input", () => { search = $("searchInput").value.trim(); if (tab === "files") drawFiles(); else if (!$("view-media").classList.contains("hidden")) drawGrid(); });
$("modalFileInput").addEventListener("change", (e) => { pending = [...e.target.files]; e.target.value = ""; if (pending.length) { $("upload-progress-container").classList.remove("hidden"); $("uploading-file-name").textContent = pending.length === 1 ? pending[0].name : `${pending.length} files selected`; $("upload-percent").textContent = "0%"; $("upload-bar").style.width = "0%"; } });
$("vaultFileInput").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; runUploads(f); });
const dz = $("files-drop-area");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("border-amber-400/70"); });
dz.addEventListener("dragleave", () => dz.classList.remove("border-amber-400/70"));
dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("border-amber-400/70"); runUploads([...e.dataTransfer.files]); });
$("rfile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f || !resumeT) return;
  if (f.size !== resumeT.size || cleanName(f.name) !== resumeT.name) return toast(`Pick the same file: ${resumeT.name} (${fmt(resumeT.size)}).`);
  openUp(); try { await upVideo(f, resumeT); toast("Uploaded " + f.name); } catch (m) { toast((m && m.message) || String(m)); } finally { closeUp(); resumeT = null; }
  refresh();
});
document.addEventListener("keydown", (e) => { if ($("lightbox").classList.contains("hidden")) return; if (e.key === "Escape") closeLb(); else if (e.key === "ArrowRight") stepLb(1); else if (e.key === "ArrowLeft") stepLb(-1); });
$("maint-out").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.href = "/"; });
$("year").textContent = new Date().getFullYear();
addEventListener("hashchange", render);
setInterval(() => { if (tab === "overview" && !document.hidden && !busy) renderOverview().catch(() => {}); }, 30000);
render();
