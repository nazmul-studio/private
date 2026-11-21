import { LIMITS, categoryOfName, sizeMessage, planParts, cleanName } from "/assets/limits.js";
const $ = (i) => document.getElementById(i);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.ceil(n / 1e3) + " KB");
const pages = [["overview", "Overview"], ["photos", "Photos", "image"], ["videos", "Videos", "video"], ["recent", "Recently added", "all"], ["favorites", "Favorites", "favorites"], ["albums", "Albums"], ["folders", "Folders"], ["trash", "Trash", "trash"], ["sessions", "Active sessions"], ["history", "Login history"], ["settings", "Settings"]];
let me = null, files = [];
const api = async (path, o = {}) => { const r = await fetch(path, { ...o, headers: { ...(o.headers || {}), "X-CSRF": me ? me.csrf : "" } }); if (r.status === 401 || r.status === 423) { location.href = "/"; throw new Error("auth"); } return r; };
$("nav").innerHTML = pages.map(([k, n]) => `<a href="#${k}">${n}</a>`).join("");
const empty = (t, d) => `<div class="empty"><strong>${t}</strong><span>${d}</span></div>`;
let ctx = "";
const card = (f) => {
  const u = "/api/media/" + f.id, img = f.mime.startsWith("image/") && f.mime !== "image/heic";
  const m = img ? `<img src="${u}${f.has_thumb ? "?thumb=1" : ""}" alt="${esc(f.name)}" loading="lazy">` : f.mime.startsWith("video/") ? `<video src="${u}" controls preload="metadata"${f.has_thumb ? ` poster="${u}?thumb=1"` : ""}></video>` : `<div class="ph file">${esc(f.mime.split("/")[1].toUpperCase())}</div>`;
  const acts = ctx === "trash" ? `<button class="btn" data-restore="${f.id}">Restore</button><button class="btn" data-del="${f.id}" data-perm="1">Delete forever</button>` : `<button class="btn" data-fav="${f.id}" data-on="${f.favorite ? 1 : 0}" aria-pressed="${!!f.favorite}">${f.favorite ? "★ Favorite" : "☆ Favorite"}</button><button class="btn" data-add="${f.id}">Add to…</button><a class="btn" href="${u}?download=1">Download</a><button class="btn" data-del="${f.id}">Trash</button>${ctx.startsWith("col:") ? `<button class="btn" data-rm="${f.id}">Remove</button>` : ""}`;
  return `<figure class="card media">${m}<figcaption><strong>${esc(f.name)}</strong><span class="muted">${fmt(f.size)} · ${new Date(f.created_at).toLocaleDateString()}</span><span class="row">${acts}</span></figcaption></figure>`;
};
let resumeT = null;
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
async function render() {
  const k = location.hash.slice(1).split("/")[0] || "overview", p = pages.find((x) => x[0] === k) || pages[0];
  document.querySelectorAll("#nav a").forEach((a) => (a.hash === "#" + p[0] ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  document.title = p[1] + " | private"; $("side").classList.remove("open"); $("menu").setAttribute("aria-expanded", "false");
  const v = $("view"); me = await (await fetch("/api/auth/me")).json().catch(() => null); if (!me || !me.csrf) { location.href = "/"; return; }
  ctx = ""; const sub = location.hash.split("/")[1];
  if (p[0] === "albums" || p[0] === "folders") {
    const kind = p[0] === "albums" ? "album" : "folder", cl = await (await api("/api/collections?kind=" + kind)).json();
    if (sub) { const items = await (await api(`/api/collections/${sub}/media`)).json(), c = cl.find((x) => x.id === sub); ctx = "col:" + sub; v.innerHTML = `<h1>${esc(c ? c.name : p[1])}</h1><p><a href="#${p[0]}">← Back to ${p[1].toLowerCase()}</a></p>` + (items.length ? `<div class="grid media-grid">${items.map(card).join("")}</div>` : empty("Empty", "Use “Add to…” on a file to put it here.")); return; }
    v.innerHTML = `<h1>${p[1]}</h1><p><button class="btn primary" data-new="${kind}">New ${kind}</button></p>` + (cl.length ? `<div class="grid">${cl.map((c) => `<section class="card"><h2><a href="#${p[0]}/${c.id}">${esc(c.name)}</a></h2><p class="muted">${c.n} files</p><span class="row"><button class="btn" data-ren="${c.id}">Rename</button><button class="btn" data-cdel="${c.id}">Delete</button></span></section>`).join("")}</div>` : empty("Nothing here yet", "Create one to organize your files.")); return;
  }
  if (p[0] === "sessions") { const l = await (await api("/api/sessions")).json(); v.innerHTML = `<h1>Active sessions</h1><p><button class="btn" id="revo">Sign out all other sessions</button></p><ul class="log">${l.map((x) => `<li>Signed in ${new Date(x.created_at).toLocaleString()} · last active ${new Date(x.last_seen).toLocaleString()} ${x.cur ? "<strong>(this device)</strong>" : `<button class="btn" data-sdel="${x.id}">Sign out</button>`}</li>`).join("")}</ul>`; return; }
  if (p[0] === "settings") { const l = await (await api("/api/passkeys")).json(); v.innerHTML = `<h1>Settings</h1><section class="card"><h2>Passkeys</h2>${l.length ? `<ul class="log">${l.map((k2) => `<li>${esc(k2.name)} <button class="btn" data-pkdel="${k2.id}">Remove</button></li>`).join("")}</ul>` : `<p class="muted">No passkeys yet. Once you add one, sign-in requires it.</p>`}<div class="field"><label for="pks">Secret code (needed to add or remove a passkey)</label><div class="input"><input id="pks" type="password" autocomplete="off"></div></div><button class="btn primary" id="pkadd">Add a passkey</button></section><section class="card mt"><h2>Login email</h2><div class="field"><label for="le">New login email</label><div class="input"><input id="le" type="email" autocomplete="email"></div></div><div class="field"><label for="ls">Secret code</label><div class="input"><input id="ls" type="password" autocomplete="off"></div></div><button class="btn" id="lemail">Change login email</button></section><section class="card mt"><h2>Limits</h2><p class="muted">Images ${fmt(me.maxImage)}, videos ${fmt(me.maxVideo)}, total storage ${fmt(me.cap)}. These are set in the project files.</p></section>`; return; }
  if (p[2] === "trash") ctx = "trash";
  if (p[0] === "history") { const l = await (await api("/api/security/log")).json(); v.innerHTML = `<h1>Login history</h1>` + (l.length ? `<ul class="log">${l.map((e) => `<li>${new Date(e.at).toLocaleString()} <span class="muted">${esc(e.event.replace(/_/g, " "))}</span></li>`).join("")}</ul>` : empty("No activity yet", "Sign-ins and lock events appear here.")); return; }
  if (p[0] === "overview" || p[2]) {
    files = await (await api("/api/media?kind=" + (p[2] || "all"))).json();
    const pend = p[0] === "overview" ? await (await api("/api/media/video/pending")).json() : [], q = $("q").value.toLowerCase(), list = files.filter((f) => f.name.toLowerCase().includes(q)), pct = Math.min(100, (me.used / me.cap) * 100);
    v.innerHTML = (p[0] === "overview" ? `<h1>Welcome back</h1><p class="live" id="clk">Live · vault secured</p>${pend.map((u) => `<section class="card resume"><strong>Unfinished upload</strong><p class="muted">${esc(u.name)} · ${fmt(u.size)}. Pick the same file to continue where it stopped.</p><span class="row"><button class="btn primary" data-resume="${u.id}" data-name="${esc(u.name)}" data-size="${u.size}">Resume</button><button class="btn" data-discard="${u.id}">Discard</button></span></section>`).join("")}<div class="grid"><section class="card"><h2>Storage</h2><progress value="${pct}" max="100" aria-label="Storage used"></progress><p class="muted">${fmt(me.used)} used of ${fmt(me.cap)}. Limits: images ${fmt(me.maxImage)}, videos ${fmt(me.maxVideo)}.</p></section></div><h2 class="mt">Recent files</h2>` : `<h1>${p[1]}</h1>`) + (list.length ? `<div class="grid media-grid">${list.slice(0, p[0] === "overview" ? 6 : 200).map(card).join("")}</div>` : empty("No files yet", "Select Upload to add photos, videos or PDFs."));
    return;
  }
  v.innerHTML = `<h1>${p[1]}</h1>` + empty(p[1] + " isn't available yet", "This part of the vault hasn't been built.");
}
let cur = null;
const progress = (name, l, t) => { $("prog").hidden = false; $("prog").value = (l / t) * 100; $("stat").textContent = `Uploading ${name}: ${Math.round((l / t) * 100)}% (${fmt(l)} of ${fmt(t)})`; };
const xhrPut = (method, url, body, headers, onp) => new Promise((ok, no) => { const x = new XMLHttpRequest(); if (cur) cur.xhrs.add(x); x.open(method, url); for (const k in headers) x.setRequestHeader(k, headers[k]); x.upload.onprogress = (e) => onp(e.loaded); x.onload = () => ok(x); x.onerror = () => no(new Error("Network error. Check your connection.")); x.onabort = () => no(new Error("Upload cancelled.")); x.send(body); });
const upImage = async (f) => { cur = { xhrs: new Set() }; try { const x = await xhrPut("POST", "/api/media/upload", f, { "X-CSRF": me.csrf, "X-Filename": encodeURIComponent(f.name) }, (l) => progress(f.name, l, f.size)); if (x.status !== 201) throw new Error(f.name + ": " + (JSON.parse(x.responseText || "{}").message || "Upload failed.")); await thumb(JSON.parse(x.responseText).id, f); } finally { cur = null; } };
const jpost = async (path, body) => { const r = await api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || "Upload failed."); return d; };
const upVideo = async (f, resume) => {
  const id = resume ? resume.id : (await jpost("/api/media/video/init", { name: f.name, size: f.size })).id;
  const have = resume ? (await jpost(`/api/media/video/${id}/parts`)).parts : [];
  cur = { xhrs: new Set(), cancelled: false }; const parts = []; let done = 0;
  try {
    for (const pt of planParts(f.size)) {
      const got = have.find((h) => h.n === pt.n); if (got) { done += pt.end - pt.start; parts.push({ n: pt.n, etag: got.etag }); continue; }
      let etag = null;
      for (let a = 1; a <= 3 && !etag; a++) {
        if (cur.cancelled) throw new Error("Upload cancelled.");
        const { url } = await jpost(`/api/media/video/${id}/part`, { n: pt.n }); // fresh short-lived URL per attempt
        try { const x = await xhrPut("PUT", url, f.slice(pt.start, pt.end), {}, (l) => progress(f.name, done + l, f.size)); etag = x.status === 200 ? x.getResponseHeader("ETag") : null; if (!etag) throw new Error("The upload was blocked. Check the R2 CORS settings."); } catch (e) { if (a === 3 || cur.cancelled) throw e; }
      }
      done += pt.end - pt.start; parts.push({ n: pt.n, etag });
    }
    $("stat").textContent = "Finishing " + f.name + "…"; const fin = await jpost(`/api/media/video/${id}/complete`, { parts }); await thumb(fin.id, f);
  } catch (e) { if (cur && cur.cancelled) await api(`/api/media/video/${id}/abort`, { method: "POST" }).catch(() => {}); throw e; } finally { cur = null; }
};
const checkFile = (f) => {
  const c = categoryOfName(f.name);
  if (!c) return `${f.name}: this file type isn't allowed. Use JPG, PNG, GIF, WEBP, HEIC, PDF, MP4 or MOV.`;
  if (!f.size) return `${f.name}: the file is empty.`;
  if (f.size > LIMITS[c]) return sizeMessage(f.name, f.size, c);
  if (f.type && (c === "video") !== f.type.startsWith("video/")) return `${f.name}: the file's contents don't match its extension.`;
  if (me.used + f.size > me.cap) return `${f.name}: not enough storage left under your limit.`;
  return "";
};
$("up").addEventListener("click", () => $("file").click());
$("cancel").addEventListener("click", () => { if (cur) { cur.cancelled = true; cur.xhrs.forEach((x) => x.abort()); } });
$("file").addEventListener("change", async (e) => {
  const fl = [...e.target.files]; e.target.value = "";
  for (const f of fl) {
    const bad = checkFile(f); if (bad) { $("stat").textContent = bad; continue; }
    $("cancel").hidden = false;
    try { await (categoryOfName(f.name) === "video" ? upVideo : upImage)(f); $("stat").textContent = "Uploaded " + f.name; me.used += f.size; } catch (m) { $("stat").textContent = (m && m.message) || String(m); } finally { $("cancel").hidden = true; $("prog").hidden = true; }
  }
  render();
});
const J = { "Content-Type": "application/json" }, send = (u, m, b) => api(u, { method: m, headers: J, body: b ? JSON.stringify(b) : undefined });
async function addPasskey() { try { const sec = $("pks").value; if (!sec) return alert("Enter your secret code first."); if (!window.PublicKeyCredential || !PublicKeyCredential.parseCreationOptionsFromJSON) return alert("This browser doesn't support passkeys."); const ro = await send("/api/passkey/register/options", "POST", { secret: sec }); if (!ro.ok) return alert(((await ro.json().catch(() => ({}))).message) || "Couldn't start passkey setup."); const o = await ro.json(), c = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(o) }), r = await send("/api/passkey/register/verify", "POST", c.toJSON()); if (!r.ok) alert((await r.json()).message); } catch { alert("Passkey setup was cancelled or failed."); } render(); }
$("view").addEventListener("click", async (e) => {
  const d = e.target.dataset || {};
  if (e.target.id === "lemail") { const r = await send("/api/settings/login-email", "POST", { email: $("le").value.trim(), secret: $("ls").value }), j = await r.json().catch(() => ({})); alert(r.ok ? "Login email changed." : j.message || "Couldn't change it."); return render(); }
  if (e.target.id === "pkadd") return addPasskey();
  if (e.target.id === "revo") await send("/api/sessions/revoke-others", "POST");
  else if (d.del) { if (confirm(d.perm ? "Delete this file forever?" : "Move this file to Trash?")) await send("/api/media/" + d.del + (d.perm ? "?permanent=1" : ""), "DELETE"); }
  else if (d.resume) { resumeT = { id: d.resume, name: d.name, size: Number(d.size) }; return $("rfile").click(); }
  else if (d.discard) await send(`/api/media/video/${d.discard}/abort`, "POST");
  else if (d.restore) await send("/api/media/" + d.restore, "PATCH", { restore: true });
  else if (d.fav) await send("/api/media/" + d.fav, "PATCH", { favorite: d.on !== "1" });
  else if (d.add) { const all = [...(await (await api("/api/collections?kind=album")).json()).map((c) => ["album", c]), ...(await (await api("/api/collections?kind=folder")).json()).map((c) => ["folder", c])]; if (!all.length) return alert("Create an album or folder first."); return pick(d.add, all); }
  else if (d.rm) await send(`/api/collections/${ctx.slice(4)}/items/${d.rm}`, "DELETE");
  else if (d.new) { const name = prompt("Name"); if (name) await send("/api/collections", "POST", { kind: d.new, name }); }
  else if (d.ren) { const name = prompt("New name"); if (name) await send("/api/collections/" + d.ren, "PATCH", { name }); }
  else if (d.cdel) { if (confirm("Delete this collection? Your files are kept.")) await send("/api/collections/" + d.cdel, "DELETE"); }
  else if (d.sdel) await send("/api/sessions/" + d.sdel, "DELETE");
  else if (d.pkdel) { const sec = $("pks").value; if (!sec) return alert("Enter your secret code first."); if (confirm("Remove this passkey?")) { const r = await send("/api/passkeys/" + d.pkdel, "DELETE", { secret: sec }); if (!r.ok) alert(((await r.json().catch(() => ({}))).message) || "Couldn't remove it."); } }
  else return;
  render();
});
$("q").addEventListener("input", render);
$("out").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.href = "/"; });
$("menu").addEventListener("click", () => $("menu").setAttribute("aria-expanded", String($("side").classList.toggle("open"))));
const pick = (mid, all) => { $("psel").innerHTML = all.map(([k, c]) => `<option value="${c.id}">${esc(c.name)} (${k})</option>`).join(""); $("pick").dataset.mid = mid; $("pick").showModal(); };
$("pform").addEventListener("submit", async (e) => { e.preventDefault(); const dlg = $("pick"); dlg.close(); await send(`/api/collections/${$("psel").value}/items`, "POST", { media_id: dlg.dataset.mid }); render(); });
$("pcancel").addEventListener("click", () => $("pick").close());
$("rfile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f || !resumeT) return;
  if (f.size !== resumeT.size || cleanName(f.name) !== resumeT.name) { $("stat").textContent = `Pick the same file: ${resumeT.name} (${fmt(resumeT.size)}).`; return; }
  $("cancel").hidden = false;
  try { await upVideo(f, resumeT); $("stat").textContent = "Uploaded " + f.name; } catch (m) { $("stat").textContent = (m && m.message) || String(m); } finally { $("cancel").hidden = true; $("prog").hidden = true; resumeT = null; }
  render();
});
setInterval(() => { const c = $("clk"); if (c) c.textContent = "Live · " + new Date().toLocaleTimeString() + " · vault secured"; }, 1000);
addEventListener("hashchange", render); render();
