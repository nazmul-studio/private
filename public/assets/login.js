const $ = (id) => document.getElementById(id), err = $("err");
const show = (m) => { err.textContent = m; err.hidden = false; };
let tok = "", chal = "", wid, proof = "", needPk = false;
window.tsReady = async () => { const k = (await (await fetch("/api/security/config")).json()).turnstileSiteKey; wid = turnstile.render("#ts", { sitekey: k, callback: (t) => { tok = t; }, "expired-callback": () => { tok = ""; } }); };
$("tg").addEventListener("click", (e) => { const pw = $("pw"), on = pw.type === "password"; pw.type = on ? "text" : "password"; e.target.textContent = on ? "Hide" : "Show"; e.target.setAttribute("aria-pressed", String(on)); });
fetch("/api/security/state").then((r) => r.json()).then((s) => { if (s.state === "lockdown") show("Emergency lockdown is active. Use recovery to reopen the vault."); else if (s.state === "locked") show("The vault is locked until " + new Date(s.lockedUntil).toLocaleString() + "."); }).catch(() => {});
const post = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return [r, await r.json().catch(() => ({}))]; };
$("f").addEventListener("submit", async (e) => {
  e.preventDefault(); err.hidden = true;
  if (!$("pw").value || !$("sc").value) return show("Enter both your password and your secret code.");
  if (!tok) return show("Complete the bot check first.");
  if (needPk && !proof) return show("Verify your passkey first.");
  try {
    const [r, d] = await post("/api/auth/login", { password: $("pw").value, secret: $("sc").value, turnstile: tok, proof });
    if (r.ok && d.challenge) { chal = d.challenge; $("f").hidden = true; $("o").hidden = false; $("code").focus(); } else { proof = ""; $("pk").textContent = "Verify passkey"; show(d.message || "Sign-in failed. Try again."); if (window.turnstile) turnstile.reset(wid); tok = ""; }
  } catch { show("Can't reach the server. Check your connection and try again."); }
});
$("o").addEventListener("submit", async (e) => {
  e.preventDefault(); err.hidden = true;
  try {
    const [r, d] = await post("/api/auth/email/verify", { challenge: chal, code: $("code").value.trim() });
    if (r.ok) location.href = "/app.html"; else { show(d.message || "That code didn't work."); if (d.error === "expired") { $("o").hidden = true; $("f").hidden = false; if (window.turnstile) turnstile.reset(wid); tok = ""; } }
  } catch { show("Can't reach the server. Check your connection and try again."); }
});
$("pk").addEventListener("click", async () => {
  err.hidden = true;
  try {
    const [, d] = await post("/api/auth/passkey/options", {});
    if (!d.required) return show(d.message || "No passkey is set up.");
    const cred = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(d.options) });
    const [r, v] = await post("/api/auth/passkey/verify", { cid: d.cid, response: cred.toJSON() });
    if (r.ok) { proof = v.proof; $("pk").textContent = "Passkey verified"; } else show(v.message || "Passkey verification failed.");
  } catch { show("Passkey verification was cancelled or isn't supported in this browser."); }
});
fetch("/api/security/config").then((r) => r.json()).then((c) => { if (c.passkeys) { needPk = true; $("pk").hidden = false; } }).catch(() => {});
