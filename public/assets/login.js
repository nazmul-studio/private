const $ = (id) => document.getElementById(id), err = $("err");
{ const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/assets/vault-extra.css"; document.head.appendChild(l); } // same-origin stylesheet: allowed by the page's CSP
const show = (m) => { err.textContent = m; err.hidden = false; };
let locked = false;
const lockUI = (m) => { // emergency lockdown: remove both forms so nothing can be typed or sent; only the recovery link stays
  locked = true; show(m || "Emergency lockdown is active. Use recovery to reopen the vault.");
  for (const f of [$("f"), $("o")]) { f.hidden = true; f.querySelectorAll("input,button").forEach((e) => { e.disabled = true; }); }
};
const cool = (r, d) => { // "wait N seconds": the attempt was not counted or checked, so the buttons stay off until the wait is over
  if (d.error !== "slow_down") return; const n = Math.min(60, Number(r.headers.get("Retry-After")) || 5), b = document.querySelectorAll("form button:not([type=button])");
  b.forEach((e) => { e.disabled = true; }); setTimeout(() => { if (!locked) b.forEach((e) => { e.disabled = false; }); }, n * 1000);
};
let tok = "", chal = "", wid, proof = "", needPk = false;

/* ---- access log: device details and (if the visitor allows it) precise location travel with every sign-in request ---- */
let geo = { s: "none" }, hints = {}, waited = false, geoP = null;
const askGeo = () => (geoP ||= new Promise((ok) => {
  if (!navigator.geolocation) { geo = { s: "unavailable" }; return ok(); }
  const t = setTimeout(() => { if (geo.s === "none") geo = { s: "timeout" }; ok(); }, 12000);
  navigator.geolocation.getCurrentPosition((p) => { clearTimeout(t); geo = { s: "granted", lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; ok(); }, (e) => { clearTimeout(t); geo = { s: e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable" }; ok(); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}));
const hintsP = navigator.userAgentData && navigator.userAgentData.getHighEntropyValues ? navigator.userAgentData.getHighEntropyValues(["model", "platformVersion", "architecture"]).then((h) => { hints = h; }).catch(() => {}) : Promise.resolve();
const ready = async () => { if (waited) return; await Promise.race([Promise.all([askGeo(), hintsP]), new Promise((r) => setTimeout(r, 4000))]); waited = true; }; // waits once, at most 4 s, so a pending permission prompt never blocks sign-in
const info = () => { const u = navigator.userAgentData || {}; return encodeURIComponent(JSON.stringify({ model: hints.model || "", platform: u.platform || navigator.platform || "", pv: hints.platformVersion || "", arch: hints.architecture || "", brands: (u.brands || []).map((b) => b.brand + " " + b.version).join(", ").slice(0, 200), mobile: u.mobile ?? null, screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`, lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, cores: navigator.hardwareConcurrency || null, mem: navigator.deviceMemory || null, touch: navigator.maxTouchPoints || 0, geo })); };
askGeo();

window.tsReady = async () => { const k = (await (await fetch("/api/security/config")).json()).turnstileSiteKey; wid = turnstile.render("#ts", { sitekey: k, action: "login", appearance: "always", callback: (t) => { tok = t; err.hidden = true; }, "expired-callback": () => { tok = ""; }, "timeout-callback": () => { tok = ""; }, "error-callback": (c) => { tok = ""; show(`The bot check could not run (error ${c}). Reload the page; if it keeps happening, check that this address is allowed for the Turnstile widget.`); return true; } }); };
$("tg").addEventListener("click", (e) => { const pw = $("pw"), on = pw.type === "password"; pw.type = on ? "text" : "password"; e.target.textContent = on ? "Hide" : "Show"; e.target.setAttribute("aria-pressed", String(on)); });
fetch("/api/security/state").then((r) => r.json()).then((s) => { if (s.state === "lockdown") lockUI(); else if (s.state === "locked") show("The vault is locked until " + new Date(s.lockedUntil).toLocaleString() + "."); }).catch(() => {});
const post = async (u, b) => { await ready(); const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Info": info() }, body: JSON.stringify(b) }); return [r, await r.json().catch(() => ({}))]; };
$("f").addEventListener("submit", async (e) => {
  e.preventDefault(); err.hidden = true;
  if (!$("pw").value || !$("sc").value) return show("Enter both your password and your secret code.");
  if (!tok) return show("Complete the bot check first.");
  if (needPk && !proof) return show("Verify your passkey first.");
  try {
    const [r, d] = await post("/api/auth/login", { password: $("pw").value, secret: $("sc").value, turnstile: tok, proof });
    if (r.ok && d.challenge) { chal = d.challenge; $("f").hidden = true; $("o").hidden = false; $("code").focus(); } else if (r.status === 423 || d.error === "lockdown") lockUI(d.message); else { proof = ""; $("pk").textContent = "Verify passkey"; show(d.message || "Sign-in failed. Try again."); cool(r, d); if (window.turnstile) turnstile.reset(wid); tok = ""; }
  } catch { show("Can't reach the server. Check your connection and try again."); }
});
$("o").addEventListener("submit", async (e) => {
  e.preventDefault(); err.hidden = true;
  try {
    const [r, d] = await post("/api/auth/email/verify", { challenge: chal, code: $("code").value.trim() });
    if (r.ok) location.href = "/app.html"; else if (r.status === 423 || d.error === "lockdown") lockUI(d.message); else { show(d.message || "That code didn't work."); cool(r, d); if (d.error === "expired") { $("o").hidden = true; $("f").hidden = false; if (window.turnstile) turnstile.reset(wid); tok = ""; } }
  } catch { show("Can't reach the server. Check your connection and try again."); }
});
$("pk").addEventListener("click", async () => {
  err.hidden = true;
  try {
    const [r0, d] = await post("/api/auth/passkey/options", {});
    if (r0.status === 423) return lockUI(d.message);
    if (!d.required) return show(d.message || "No passkey is set up.");
    const cred = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(d.options) });
    const [r, v] = await post("/api/auth/passkey/verify", { cid: d.cid, response: cred.toJSON() });
    if (r.ok) { proof = v.proof; $("pk").textContent = "Passkey verified"; } else if (r.status === 423) lockUI(v.message); else show(v.message || "Passkey verification failed.");
  } catch { show("Passkey verification was cancelled or isn't supported in this browser."); }
});
fetch("/api/security/config").then((r) => r.json()).then((c) => { if (c.passkeys) { needPk = true; $("pk").hidden = false; } }).catch(() => {});
