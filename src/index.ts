import * as s3 from "./s3";
import { sendMail } from "./mail";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { OTP_TTL, REC_TTL, challengeState, tokenState } from "./policy.js";
import { LIMITS, PART, categoryOfName, sizeMessage, planParts, validParts, cleanName } from "../public/assets/limits.js";
import { rand, sha256, hmacHex, hashSecret, verifySecret, same } from "./crypto";
export { SecurityState } from "./security";

interface Env { ASSETS: Fetcher; MEDIA_BUCKET: R2Bucket; DB: D1Database; SECURITY: DurableObjectNamespace; SETUP_TOKEN?: string; AUDIT_SALT?: string; TOTAL_CAP_BYTES: string; R2_ACCOUNT_ID: string; R2_BUCKET: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string; BREVO_API_KEY: string; SENDER_EMAIL: string; SENDER_NAME: string; LOGIN_EMAIL?: string; SECURITY_EMAIL?: string; TURNSTILE_SECRET?: string; TURNSTILE_SITE_KEY: string }
type Up = { id: string; r2_key: string; upload_id: string; name: string; mime: string; size: number };
type Sec = { fails: number; wait: number; locked: boolean; lockedUntil: number; lockdown: boolean };
type Row = { id: string; r2_key: string; name: string; mime: string; size: number; created_at: number; deleted_at: number | null };
const IDLE = 2 * 3600e3, ABS = 7 * 86400e3, COOKIE = "__Host-sid";
const clean = (s: string) => cleanName(s);
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
const CSP = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const secure = (res: Response, env: Env) => { const r = new Response(res.body, res); r.headers.set("Content-Security-Policy", CSP.replace("connect-src 'self'", `connect-src 'self' https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)); r.headers.set("X-Content-Type-Options", "nosniff"); r.headers.set("Referrer-Policy", "no-referrer"); r.headers.set("X-Frame-Options", "DENY"); return r; };
const json = (d: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...h } });
const read = async (r: Request) => ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

function sniff(b: Uint8Array): string | null {
  const s = (a: number, n: number) => String.fromCharCode(...b.slice(a, a + n));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && s(1, 3) === "PNG") return "image/png";
  if (s(0, 4) === "GIF8") return "image/gif";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "image/webp";
  if (s(0, 4) === "%PDF") return "application/pdf";
  if (s(4, 4) === "ftyp") { const br = s(8, 4); return br === "qt  " ? "video/quicktime" : /^(heic|heix|mif1|heim)$/.test(br) ? "image/heic" : "video/mp4"; }
  return null;
}

async function purgeMedia(env: Env, r: Row) {
  await env.MEDIA_BUCKET.delete([r.r2_key, r.r2_key + ".thumb"]);
  await env.DB.batch([env.DB.prepare("DELETE FROM collection_items WHERE media_id=?").bind(r.id), env.DB.prepare("DELETE FROM media_metadata WHERE id=?").bind(r.id)]);
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url), p = url.pathname, m = req.method;
  if (!p.startsWith("/api/")) return env.ASSETS.fetch(req);
  if (m !== "GET" && req.headers.get("Origin") !== url.origin) return json({ error: "bad_origin" }, 403);
  const stub = env.SECURITY.get(env.SECURITY.idFromName("owner"));
  const st = async (op: string) => (await (await stub.fetch("https://do/" + op, { method: "POST" })).json()) as Sec;
  const hashIp = async (v: string) => (await hmacHex(env.AUDIT_SALT || env.SETUP_TOKEN || "private-vault", v)).slice(0, 16); // keyed: AUDIT_SALT, else SETUP_TOKEN
  const audit = async (event: string) => env.DB.prepare("INSERT INTO security_audit_logs(at,event,ip_hash) VALUES(?,?,?)").bind(Date.now(), event, await hashIp(req.headers.get("CF-Connecting-IP") ?? "")).run();
  const setupOk = async () => !!env.SETUP_TOKEN && same(await sha256(req.headers.get("x-setup-token") ?? ""), await sha256(env.SETUP_TOKEN));

  if (p === "/api/security/state") { const s = await st("state"); return json({ state: s.lockdown ? "lockdown" : s.locked ? "locked" : "open", lockedUntil: s.locked ? s.lockedUntil : null }); }

  if (p === "/api/auth/setup" && m === "POST") {
    if (!(await setupOk())) return json({ error: "forbidden", message: "Invalid setup token." }, 403);
    const b = await read(req), pw = String(b.password ?? ""), sc = String(b.secret ?? "");
    if (pw.length < 12 || sc.length < 8) return json({ error: "weak", message: "Use a password of 12+ characters and a secret code of 8+ characters." }, 400);
    const r = await env.DB.prepare("INSERT OR IGNORE INTO owner_config(id,password_hash,secret_hash,created_at) VALUES(1,?,?,?)").bind(await hashSecret(pw), await hashSecret(sc), Date.now()).run();
    return r.meta.changes ? json({ ok: true }, 201) : json({ error: "exists", message: "Owner is already set up." }, 409);
  }
  if (p === "/api/admin/reset-lockdown" && m === "POST") {
    if (!(await setupOk())) return json({ error: "forbidden" }, 403);
    await st("reset"); await audit("lockdown_reset_by_admin"); return json({ ok: true });
  }

  if (p === "/api/security/config") return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY, passkeys: (await env.DB.prepare("SELECT COUNT(*) n FROM auth_factors WHERE kind='passkey'").first<{ n: number }>())!.n > 0 });
  const tn = Date.now(), ip = req.headers.get("CF-Connecting-IP") ?? "", ipH = await hashIp(ip), rec = p.startsWith("/api/recovery/");
  const secEmail = env.SECURITY_EMAIL || env.LOGIN_EMAIL; // alerts and recovery links; either address can stand in for the other if only one is set
  const mail = (to: string | undefined, subj: string, text: string) => (to ? sendMail(env, to, subj, text).catch(() => {}) : Promise.resolve()); // alerts are best-effort
  const loginEmail = async () => (await env.DB.prepare("SELECT value v FROM system_settings WHERE key='login_email'").first<{ v: string }>())?.v || env.LOGIN_EMAIL || secEmail;
  const turnstile = async (tok: unknown) => {
    if (!env.TURNSTILE_SECRET) return false; // fail closed
    const f = new FormData(); f.set("secret", env.TURNSTILE_SECRET); f.set("response", String(tok ?? "")); f.set("remoteip", ip);
    return !!((await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f })).json().catch(() => ({}))) as { success?: boolean }).success;
  };
  if ((m === "POST" && (p.startsWith("/api/auth/") || p.startsWith("/api/settings/") || rec)) || (m !== "GET" && p.startsWith("/api/passkey"))) { // per-IP rate limit
    const rl = env.SECURITY.get(env.SECURITY.idFromName(`rl:${rec ? "rec" : "auth"}:${ipH}`));
    if (!((await (await rl.fetch(`https://do/hit?limit=${rec ? 6 : 12}&win=${rec ? 3600e3 : 600e3}`, { method: "POST" })).json()) as { ok: boolean }).ok) return json({ error: "rate_limited", message: "Too many requests. Wait a few minutes and try again." }, 429, { "Retry-After": "600" });
  }
  const bad = async () => { // one failed factor = one attempt
    const s = await st("fail");
    await audit(s.lockdown ? "emergency_lockdown" : s.locked && s.fails === 5 ? "lock_started" : "login_failed");
    if (s.lockdown) { await env.DB.prepare("DELETE FROM active_sessions").run(); await env.DB.prepare("DELETE FROM login_challenges").run(); await mail(secEmail, "Vault emergency lockdown", "10 failed sign-in attempts. All sessions were revoked. Use the recovery page to reopen the vault."); return json({ error: "lockdown", message: "Too many failed attempts. The vault is locked down." }, 423); }
    if (s.locked) { if (s.fails === 5) await mail(secEmail, "Vault locked for 12 hours", "5 failed sign-in attempts. Sign-in is locked for 12 hours."); return json({ error: "locked", lockedUntil: s.lockedUntil, message: "Too many failed attempts. Try again later." }, 423); }
    return json({ error: "invalid", message: "Incorrect credentials." }, 401);
  };
  const blocked = (s: Sec) => s.lockdown ? json({ error: "lockdown", message: "The vault is in emergency lockdown. Use recovery." }, 423) : s.wait > 0 ? json({ error: "slow_down", message: `Wait ${Math.ceil(s.wait / 1000)} seconds before trying again.` }, 429, { "Retry-After": String(Math.ceil(s.wait / 1000)) }) : null;

  // ---- passkey sign-in step (required first once any passkey is registered) ----
  if (p === "/api/auth/passkey/options" && m === "POST") {
    const s = await st("state"); const blk = blocked(s); if (blk) return blk;
    const cr = (await env.DB.prepare("SELECT cred_id, transports FROM auth_factors WHERE kind='passkey'").all<{ cred_id: string; transports: string }>()).results;
    if (!cr.length) return json({ required: false });
    const o = await generateAuthenticationOptions({ rpID: url.hostname, userVerification: "required", allowCredentials: cr.map((c) => ({ id: c.cred_id, transports: JSON.parse(c.transports) })) });
    const cid = rand(16);
    await env.DB.prepare("INSERT INTO webauthn_challenges(id,challenge,purpose,expires_at) VALUES(?,?,'auth',?)").bind(cid, o.challenge, tn + 300e3).run();
    return json({ required: true, options: o, cid });
  }
  if (p === "/api/auth/passkey/verify" && m === "POST") {
    const s = await st("state"); const blk = blocked(s); if (blk) return blk;
    const b = await read(req), resp = (b.response ?? {}) as { id?: string };
    const ch = await env.DB.prepare("DELETE FROM webauthn_challenges WHERE id=? AND purpose='auth' AND expires_at>? RETURNING challenge").bind(String(b.cid ?? ""), tn).first<{ challenge: string }>();
    const f = await env.DB.prepare("SELECT id, cred_id, public_key, counter, transports FROM auth_factors WHERE kind='passkey' AND cred_id=?").bind(String(resp.id ?? "")).first<{ id: string; cred_id: string; public_key: string; counter: number; transports: string }>();
    const v = ch && f ? await verifyAuthenticationResponse({ response: b.response as never, expectedChallenge: ch.challenge, expectedOrigin: url.origin, expectedRPID: url.hostname, credential: { id: f.cred_id, publicKey: isoBase64URL.toBuffer(f.public_key), counter: f.counter, transports: JSON.parse(f.transports) }, requireUserVerification: true }).catch(() => null) : null;
    if (!v?.verified) return bad();
    await env.DB.prepare("UPDATE auth_factors SET counter=? WHERE id=?").bind(v.authenticationInfo.newCounter, f!.id).run();
    const proof = rand(16); // single-use proof, consumed by the password step
    await env.DB.prepare("INSERT INTO webauthn_challenges(id,challenge,purpose,expires_at) VALUES(?,'','proof',?)").bind(proof, tn + 300e3).run();
    return json({ proof });
  }
  if (p === "/api/auth/login" && m === "POST") {
    let s = await st("state"); const blk = blocked(s); if (blk) return blk;
    const b = await read(req);
    if (!(await turnstile(b.turnstile))) return json({ error: "bot_check", message: "Bot check failed. Reload the page and try again." }, 400);
    if ((await env.DB.prepare("SELECT COUNT(*) n FROM auth_factors WHERE kind='passkey'").first<{ n: number }>())!.n > 0 && !(await env.DB.prepare("DELETE FROM webauthn_challenges WHERE id=? AND purpose='proof' AND expires_at>? RETURNING id").bind(String(b.proof ?? ""), tn).first())) return json({ error: "passkey_required", message: "Verify your passkey first." }, 401);
    const o = await env.DB.prepare("SELECT password_hash h1, secret_hash h2 FROM owner_config WHERE id=1").first<{ h1: string; h2: string }>();
    if (!o) return json({ error: "setup_required", message: "Owner setup is not complete. Open /setup.html." }, 409);
    const a = await verifySecret(String(b.password ?? ""), o.h1), c = await verifySecret(String(b.secret ?? ""), o.h2);
    if (!(a && c)) return bad();
    if (s.locked) { await audit("login_blocked_by_lock"); return json({ error: "locked", lockedUntil: s.lockedUntil, message: "The vault is locked. Try again after the lock ends." }, 423); }
    const to = await loginEmail(); if (!to || !env.SENDER_EMAIL || !env.BREVO_API_KEY) return json({ error: "mail_not_configured", message: "Email isn't set up yet. Add the email secrets in Cloudflare (see README)." }, 503);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"), cid = rand(16);
    await env.DB.prepare("DELETE FROM login_challenges").run(); // a new code invalidates the old one
    await env.DB.prepare("INSERT INTO login_challenges(id,code_hash,expires_at,attempts) VALUES(?,?,?,0)").bind(cid, await sha256(cid + code), tn + OTP_TTL).run();
    try { await sendMail(env, to, "Your vault sign-in code", `Your sign-in code is ${code}. It expires in 10 minutes. If this wasn't you, ignore this email.`); } catch { return json({ error: "mail_failed", message: "Couldn't send the sign-in code. Try again." }, 502); }
    return json({ challenge: cid });
  }
  if (p === "/api/auth/email/verify" && m === "POST") {
    const s = await st("state"); const blk = blocked(s); if (blk) return blk;
    const b = await read(req), cid = String(b.challenge ?? "");
    const c = await env.DB.prepare("SELECT code_hash, expires_at, attempts FROM login_challenges WHERE id=?").bind(cid).first<{ code_hash: string; expires_at: number; attempts: number }>();
    if (challengeState(c ? { expires: c.expires_at, attempts: c.attempts } : null, tn) !== "valid") { if (c) await env.DB.prepare("DELETE FROM login_challenges WHERE id=?").bind(cid).run(); return json({ error: "expired", message: "That code has expired. Sign in again." }, 401); }
    if (!same(await sha256(cid + String(b.code ?? "")), c!.code_hash)) { await env.DB.prepare("UPDATE login_challenges SET attempts=attempts+1 WHERE id=?").bind(cid).run(); return bad(); }
    await env.DB.prepare("DELETE FROM login_challenges WHERE id=?").bind(cid).run(); // single use
    if (s.locked) { await audit("login_blocked_by_lock"); return json({ error: "locked", lockedUntil: s.lockedUntil, message: "The vault is locked. Try again after the lock ends." }, 423); }
    await st("ok"); await audit("login_ok");
    const sid = rand(), now = Date.now();
    await env.DB.prepare("INSERT INTO active_sessions(id_hash,csrf,created_at,last_seen) VALUES(?,?,?,?)").bind(await sha256(sid), rand(16), now, now).run();
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=${sid}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${ABS / 1000}` });
  }

  // ---- recovery: reachable during lockdown; needs an emailed one-time link AND the secret code ----
  if (p === "/api/recovery/start" && m === "POST") {
    if (!(await turnstile((await read(req)).turnstile))) return json({ error: "bot_check", message: "Bot check failed. Reload the page and try again." }, 400);
    if (await env.DB.prepare("SELECT 1 x FROM owner_config WHERE id=1").first()) {
      const tok = rand(32);
      await env.DB.prepare("DELETE FROM recovery_tokens").run(); // invalidate older tokens
      await env.DB.prepare("INSERT INTO recovery_tokens(token_hash,expires_at,attempts,used) VALUES(?,?,0,0)").bind(await sha256(tok), tn + REC_TTL).run();
      await audit("recovery_started");
      await mail(secEmail, "Vault recovery link", `Recovery was requested. This link is valid for 30 minutes and you will also need your secret code:\n${url.origin}/recovery.html#t=${tok}\nIf this wasn't you, ignore this email.`);
    }
    return json({ ok: true, message: "If a vault exists, a recovery link was emailed to the security address." });
  }
  if ((p === "/api/recovery/verify" || p === "/api/recovery/activate") && m === "POST") {
    const b = await read(req), th = await sha256(String(b.token ?? ""));
    const t = await env.DB.prepare("SELECT expires_at, attempts, used FROM recovery_tokens WHERE token_hash=?").bind(th).first<{ expires_at: number; attempts: number; used: number }>();
    const o = await env.DB.prepare("SELECT secret_hash h FROM owner_config WHERE id=1").first<{ h: string }>();
    const okTok = tokenState(t ? { expires: t.expires_at, attempts: t.attempts, used: !!t.used } : null, tn) === "valid" && !!o;
    if (!okTok || !(await verifySecret(String(b.secret ?? ""), o!.h))) { if (okTok) await env.DB.prepare("UPDATE recovery_tokens SET attempts=attempts+1 WHERE token_hash=?").bind(th).run(); await audit("recovery_failed"); return json({ error: "invalid", message: "The link is invalid or expired, or the secret code is wrong." }, 401); }
    if (p === "/api/recovery/verify") return json({ ok: true });
    const np = String(b.new_password ?? ""), ns = String(b.new_secret ?? "");
    if (b.confirm !== true) return json({ error: "confirm", message: "Confirm that you want to reset your credentials." }, 400);
    if (np.length < 12 || ns.length < 8) return json({ error: "weak", message: "Use a password of 12+ characters and a secret code of 8+ characters." }, 400);
    const le = String(b.new_login_email ?? "").trim();
    if (le && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(le)) return json({ error: "invalid_email", message: "Enter a valid email address." }, 400);
    await env.DB.prepare("UPDATE owner_config SET password_hash=?, secret_hash=? WHERE id=1").bind(await hashSecret(np), await hashSecret(ns)).run();
    if (le) await env.DB.prepare("INSERT OR REPLACE INTO system_settings(key,value) VALUES('login_email',?)").bind(le).run();
    if (b.reset_passkeys === true) await env.DB.prepare("DELETE FROM auth_factors WHERE kind='passkey'").run();
    await env.DB.prepare("UPDATE recovery_tokens SET used=1 WHERE token_hash=?").bind(th).run();
    await env.DB.prepare("DELETE FROM active_sessions").run(); await env.DB.prepare("DELETE FROM login_challenges").run();
    await st("reset"); await audit("recovery_completed");
    await mail(secEmail, "Vault recovery completed", `Your password and secret code were reset${le ? ", the login email was changed" : ""}${b.reset_passkeys === true ? ", passkeys were removed" : ""} and all sessions were revoked. If this wasn't you, act immediately.`);
    return json({ ok: true });
  }

  // ---- everything below needs a valid session ----
  const sid = /(?:^|; )__Host-sid=([a-f0-9]+)/.exec(req.headers.get("Cookie") ?? "")?.[1];
  const sh = sid ? await sha256(sid) : "", now = Date.now();
  const ses = sid ? await env.DB.prepare("SELECT csrf, created_at, last_seen FROM active_sessions WHERE id_hash=?").bind(sh).first<{ csrf: string; created_at: number; last_seen: number }>() : null;
  if (!ses || now - ses.last_seen > IDLE || now - ses.created_at > ABS) { if (ses) await env.DB.prepare("DELETE FROM active_sessions WHERE id_hash=?").bind(sh).run(); return json({ error: "unauthorized" }, 401); }
  if ((await st("state")).lockdown) return json({ error: "lockdown" }, 423);
  if (m !== "GET" && !same(req.headers.get("X-CSRF") ?? "", ses.csrf)) return json({ error: "bad_csrf" }, 403);
  await env.DB.prepare("UPDATE active_sessions SET last_seen=? WHERE id_hash=?").bind(now, sh).run();
  const used = async () => (await env.DB.prepare("SELECT COALESCE(SUM(size),0) n FROM media_metadata").first<{ n: number }>())!.n;

  const reserved = async () => (await env.DB.prepare("SELECT COALESCE(SUM(size),0) n FROM upload_sessions WHERE status='open' AND expires_at>?").bind(now).first<{ n: number }>())!.n;
  if (p === "/api/auth/me") return json({ csrf: ses.csrf, used: await used(), cap: Number(env.TOTAL_CAP_BYTES), maxImage: LIMITS.image, maxVideo: LIMITS.video });
  if (p === "/api/auth/logout" && m === "POST") { await env.DB.prepare("DELETE FROM active_sessions WHERE id_hash=?").bind(sh).run(); return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0` }); }
  if (p === "/api/security/log") return json((await env.DB.prepare("SELECT at, event FROM security_audit_logs ORDER BY at DESC LIMIT 50").all()).results);

  const secretOk = async (v: unknown) => { // re-check the secret code for sensitive changes; failures are logged
    const o = await env.DB.prepare("SELECT secret_hash h FROM owner_config WHERE id=1").first<{ h: string }>();
    if (o && (await verifySecret(String(v ?? ""), o.h))) return true;
    await audit("settings_secret_failed"); return false;
  };
  const noSecret = () => json({ error: "forbidden", message: "The secret code is wrong." }, 403);
  if (p === "/api/settings/login-email" && m === "POST") { // needs the secret code again; the old and security addresses are told
    const b = await read(req), le = String(b.email ?? "").trim();
    const o = await env.DB.prepare("SELECT secret_hash h FROM owner_config WHERE id=1").first<{ h: string }>();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(le)) return json({ error: "invalid_email", message: "Enter a valid email address." }, 400);
    if (!o || !(await verifySecret(String(b.secret ?? ""), o.h))) { await audit("settings_secret_failed"); return json({ error: "forbidden", message: "The secret code is wrong." }, 403); }
    const old = await loginEmail();
    await env.DB.prepare("INSERT OR REPLACE INTO system_settings(key,value) VALUES('login_email',?)").bind(le).run();
    await audit("login_email_changed");
    await mail(secEmail, "Login email changed", `The sign-in email was changed from ${old} to ${le}.`);
    if (old !== secEmail) await mail(old, "Login email changed", "The sign-in email for your vault was changed. If this wasn't you, use recovery now.");
    return json({ ok: true });
  }
  if (p === "/api/media" && m === "GET") {
    const k = url.searchParams.get("kind") ?? "all", like = k === "image" ? "image/%" : k === "video" ? "video/%" : "%";
    const cond = k === "trash" ? "deleted_at IS NOT NULL" : "deleted_at IS NULL" + (k === "favorites" ? " AND favorite=1" : "");
    return json((await env.DB.prepare(`SELECT id,name,mime,size,created_at,favorite,has_thumb FROM media_metadata WHERE ${cond} AND mime LIKE ? ORDER BY created_at DESC LIMIT 200`).bind(like).all()).results);
  }
  const tm = /^\/api\/media\/([\w-]+)\/thumb$/.exec(p);
  if (tm && m === "POST") { // small JPEG made in the browser
    const len = Number(req.headers.get("content-length") ?? 0);
    if (!len || len > 300000) return json({ error: "too_large" }, 413);
    const row = await env.DB.prepare("SELECT r2_key FROM media_metadata WHERE id=?").bind(tm[1]).first<{ r2_key: string }>();
    const buf = await req.arrayBuffer(), hd = new Uint8Array(buf, 0, Math.min(3, buf.byteLength));
    if (!row || buf.byteLength !== len || !(hd[0] === 0xff && hd[1] === 0xd8 && hd[2] === 0xff)) return json({ error: "invalid" }, 400);
    await env.MEDIA_BUCKET.put(row.r2_key + ".thumb", buf, { httpMetadata: { contentType: "image/jpeg" } });
    await env.DB.prepare("UPDATE media_metadata SET has_thumb=1 WHERE id=?").bind(tm[1]).run();
    return json({ ok: true }, 201);
  }
  // albums (many-to-many) and folders (a file lives in at most one)
  if (p === "/api/collections" && m === "GET") { const k = url.searchParams.get("kind") === "folder" ? "folder" : "album"; return json((await env.DB.prepare("SELECT c.id, c.name, (SELECT COUNT(*) FROM collection_items i JOIN media_metadata mm ON mm.id=i.media_id WHERE i.collection_id=c.id AND mm.deleted_at IS NULL) n FROM collections c WHERE c.kind=? ORDER BY c.name").bind(k).all()).results); }
  if (p === "/api/collections" && m === "POST") {
    const b = await read(req), n = clean(String(b.name ?? "")).trim();
    if (!n || !["album", "folder"].includes(String(b.kind))) return json({ error: "invalid", message: "Enter a name." }, 400);
    const id = crypto.randomUUID(); await env.DB.prepare("INSERT INTO collections(id,kind,name,created_at) VALUES(?,?,?,?)").bind(id, b.kind, n, now).run(); return json({ id }, 201);
  }
  const cm = /^\/api\/collections\/([\w-]+)(?:\/(media|items)(?:\/([\w-]+))?)?$/.exec(p);
  if (cm) {
    const col = await env.DB.prepare("SELECT id, kind FROM collections WHERE id=?").bind(cm[1]).first<{ id: string; kind: string }>();
    if (!col) return json({ error: "not_found" }, 404);
    if (!cm[2] && m === "PATCH") { const n = clean(String((await read(req)).name ?? "")).trim(); if (!n) return json({ error: "invalid" }, 400); await env.DB.prepare("UPDATE collections SET name=? WHERE id=?").bind(n, col.id).run(); return json({ ok: true }); }
    if (!cm[2] && m === "DELETE") { await env.DB.batch([env.DB.prepare("DELETE FROM collection_items WHERE collection_id=?").bind(col.id), env.DB.prepare("DELETE FROM collections WHERE id=?").bind(col.id)]); return json({ ok: true }); }
    if (cm[2] === "media" && m === "GET") return json((await env.DB.prepare("SELECT mm.id,mm.name,mm.mime,mm.size,mm.created_at,mm.favorite,mm.has_thumb FROM collection_items i JOIN media_metadata mm ON mm.id=i.media_id WHERE i.collection_id=? AND mm.deleted_at IS NULL ORDER BY mm.created_at DESC").bind(col.id).all()).results);
    if (cm[2] === "items" && m === "POST") {
      const mid = String((await read(req)).media_id ?? "");
      if (!(await env.DB.prepare("SELECT 1 x FROM media_metadata WHERE id=?").bind(mid).first())) return json({ error: "not_found" }, 404);
      if (col.kind === "folder") await env.DB.prepare("DELETE FROM collection_items WHERE media_id=? AND collection_id IN (SELECT id FROM collections WHERE kind='folder')").bind(mid).run();
      await env.DB.prepare("INSERT OR IGNORE INTO collection_items(collection_id,media_id) VALUES(?,?)").bind(col.id, mid).run(); return json({ ok: true });
    }
    if (cm[2] === "items" && m === "DELETE" && cm[3]) { await env.DB.prepare("DELETE FROM collection_items WHERE collection_id=? AND media_id=?").bind(col.id, cm[3]).run(); return json({ ok: true }); }
  }
  // active sessions
  if (p === "/api/sessions" && m === "GET") return json((await env.DB.prepare("SELECT id_hash id, created_at, last_seen, id_hash=? cur FROM active_sessions ORDER BY last_seen DESC").bind(sh).all()).results);
  if (p === "/api/sessions/revoke-others" && m === "POST") { await env.DB.prepare("DELETE FROM active_sessions WHERE id_hash!=?").bind(sh).run(); await audit("sessions_revoked_others"); return json({ ok: true }); }
  const sm = /^\/api\/sessions\/([a-f0-9]{64})$/.exec(p);
  if (sm && m === "DELETE") { await env.DB.prepare("DELETE FROM active_sessions WHERE id_hash=?").bind(sm[1]).run(); await audit("session_revoked"); return json({ ok: true }); }
  // passkey management (signed in)
  if (p === "/api/passkeys" && m === "GET") return json((await env.DB.prepare("SELECT id, name, created_at FROM auth_factors WHERE kind='passkey' ORDER BY created_at").all()).results);
  if (p === "/api/passkey/register/options" && m === "POST") {
    if (!(await secretOk((await read(req)).secret))) return noSecret();
    const ex = (await env.DB.prepare("SELECT cred_id FROM auth_factors WHERE kind='passkey'").all<{ cred_id: string }>()).results;
    const o = await generateRegistrationOptions({ rpName: "private vault", rpID: url.hostname, userName: "owner", attestationType: "none", excludeCredentials: ex.map((e) => ({ id: e.cred_id })), authenticatorSelection: { residentKey: "preferred", userVerification: "required" } });
    await env.DB.prepare("INSERT OR REPLACE INTO webauthn_challenges(id,challenge,purpose,expires_at) VALUES(?,?,'reg',?)").bind("reg:" + sh, o.challenge, now + 300e3).run();
    return json(o);
  }
  if (p === "/api/passkey/register/verify" && m === "POST") {
    const ch = await env.DB.prepare("DELETE FROM webauthn_challenges WHERE id=? AND purpose='reg' AND expires_at>? RETURNING challenge").bind("reg:" + sh, now).first<{ challenge: string }>();
    if (!ch) return json({ error: "expired", message: "Passkey setup expired. Try again." }, 400);
    const v = await verifyRegistrationResponse({ response: (await read(req)) as never, expectedChallenge: ch.challenge, expectedOrigin: url.origin, expectedRPID: url.hostname, requireUserVerification: true }).catch(() => null);
    if (!v?.verified) return json({ error: "invalid", message: "That passkey couldn't be verified." }, 400);
    const c = v.registrationInfo!.credential;
    await env.DB.prepare("INSERT INTO auth_factors(id,kind,cred_id,public_key,counter,transports,name,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), "passkey", c.id, isoBase64URL.fromBuffer(c.publicKey), c.counter, JSON.stringify(c.transports ?? []), "Passkey " + new Date(now).toISOString().slice(0, 10), now).run();
    await audit("passkey_added"); await mail(secEmail, "Passkey added", "A passkey was added to your vault."); return json({ ok: true }, 201);
  }
  const pk = /^\/api\/passkeys\/([\w-]+)$/.exec(p);
  if (pk && m === "DELETE") { if (!(await secretOk((await read(req)).secret))) return noSecret(); await env.DB.prepare("DELETE FROM auth_factors WHERE id=?").bind(pk[1]).run(); await audit("passkey_removed"); await mail(secEmail, "Passkey removed", "A passkey was removed from your vault."); return json({ ok: true }); }
  if (p === "/api/media/upload" && m === "POST") { // images and PDFs only; videos use direct multipart below
    const len = Number(req.headers.get("content-length") ?? 0), name = clean(safeDecode(req.headers.get("x-filename") ?? "file")), cat = categoryOfName(name);
    if (!len) return json({ error: "empty", message: "The file is empty." }, 400);
    if (cat !== "image") return json({ error: "type", message: cat === "video" ? "Videos upload in parts. Use the Upload button." : "This file type isn't allowed." }, 415);
    if (len > LIMITS.image) return json({ error: "too_large", message: sizeMessage(name, len, "image") }, 413);
    if ((await used()) + (await reserved()) + len > Number(env.TOTAL_CAP_BYTES)) return json({ error: "storage_full", message: "Not enough storage left under your configured limit." }, 413);
    const buf = await req.arrayBuffer(), mime = sniff(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
    if (buf.byteLength !== len || !mime || mime.startsWith("video/")) return json({ error: "type", message: "This file isn't a valid image or PDF." }, 415);
    const id = crypto.randomUUID(), key = crypto.randomUUID();
    await env.MEDIA_BUCKET.put(key, buf, { httpMetadata: { contentType: mime } });
    await env.DB.prepare("INSERT INTO media_metadata(id,r2_key,name,mime,size,created_at) VALUES(?,?,?,?,?,?)").bind(id, key, name, mime, len, now).run();
    return json({ id }, 201);
  }
  if (p === "/api/media/video/pending" && m === "GET") return json((await env.DB.prepare("SELECT id,name,size FROM upload_sessions WHERE session_hash=? AND status='open' AND expires_at>? ORDER BY created_at DESC").bind(sh, now).all()).results);
  if (p === "/api/media/video/init" && m === "POST") {
    const b = await read(req), name = clean(String(b.name ?? "")), size = Number(b.size);
    if (categoryOfName(name) !== "video" || !Number.isInteger(size) || size <= 0) return json({ error: "type", message: "Only MP4 and MOV videos can be uploaded this way." }, 415);
    if (size > LIMITS.video) return json({ error: "too_large", message: sizeMessage(name, size, "video") }, 413);
    const open = (await env.DB.prepare("SELECT COUNT(*) n FROM upload_sessions WHERE status='open' AND expires_at>?").bind(now).first<{ n: number }>())!.n;
    if (open >= 3) return json({ error: "busy", message: "Too many uploads in progress. Finish or cancel one first." }, 429);
    if ((await used()) + (await reserved()) + size > Number(env.TOTAL_CAP_BYTES)) return json({ error: "storage_full", message: "Not enough storage left under your configured limit." }, 413);
    const mime = name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4", key = crypto.randomUUID(), id = crypto.randomUUID();
    const uploadId = await s3.create(env, key, mime);
    await env.DB.prepare("INSERT INTO upload_sessions(id,session_hash,r2_key,upload_id,name,mime,size,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,'open',?,?)").bind(id, sh, key, uploadId, name, mime, size, now, now + 6 * 3600e3).run();
    return json({ id, partSize: PART }, 201);
  }
  const vm = /^\/api\/media\/video\/([\w-]+)\/(part|parts|complete|abort)$/.exec(p);
  if (vm && m === "POST") { // only the session that created the upload may touch it
    const u = await env.DB.prepare("SELECT * FROM upload_sessions WHERE id=? AND session_hash=? AND status='open' AND expires_at>?").bind(vm[1], sh, now).first<Up>();
    if (!u) return json({ error: "not_found", message: "This upload is no longer active." }, 404);
    const plan = planParts(u.size);
    if (vm[2] === "parts") return json({ parts: validParts(await s3.listParts(env, u.r2_key, u.upload_id), u.size) }); // for resuming
    if (vm[2] === "abort") { await s3.abort(env, u.r2_key, u.upload_id).catch(() => {}); await env.DB.prepare("UPDATE upload_sessions SET status='aborted' WHERE id=?").bind(u.id).run(); return json({ ok: true }); }
    const b = await read(req);
    if (vm[2] === "part") { const pt = plan[Number(b.n) - 1]; return pt ? json({ url: await s3.presignPart(env, u.r2_key, u.upload_id, pt.n) }) : json({ error: "invalid" }, 400); }
    const parts = Array.isArray(b.parts) ? (b.parts as { n: number; etag: string }[]) : [];
    const fail = async (status: number, msg: string) => { await s3.abort(env, u.r2_key, u.upload_id).catch(() => {}); await env.MEDIA_BUCKET.delete(u.r2_key); await env.DB.prepare("UPDATE upload_sessions SET status='failed' WHERE id=?").bind(u.id).run(); return json({ error: "invalid_upload", message: msg }, status); };
    if (parts.length !== plan.length || !plan.every((pt, i) => parts[i]?.n === pt.n && /^"?[a-f0-9-]{8,64}"?$/.test(String(parts[i].etag)))) return fail(400, "The upload parts were incomplete. Try again.");
    await s3.complete(env, u.r2_key, u.upload_id, parts);
    const head = await env.MEDIA_BUCKET.head(u.r2_key);
    if (!head || head.size !== u.size) return fail(422, "The uploaded file didn't match its declared size. Try again.");
    const first = await env.MEDIA_BUCKET.get(u.r2_key, { range: { offset: 0, length: 16 } }), mime = first ? sniff(new Uint8Array(await first.arrayBuffer())) : null;
    if (!mime || !mime.startsWith("video/")) return fail(415, "That file isn't a valid MP4 or MOV video.");
    if ((await used()) + u.size > Number(env.TOTAL_CAP_BYTES)) return fail(413, "Not enough storage left under your configured limit.");
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO media_metadata(id,r2_key,name,mime,size,created_at) VALUES(?,?,?,?,?,?)").bind(id, u.r2_key, u.name, u.mime, u.size, now).run();
    await env.DB.prepare("UPDATE upload_sessions SET status='done' WHERE id=?").bind(u.id).run();
    return json({ id }, 201);
  }
  const mm = /^\/api\/media\/([\w-]+)$/.exec(p);
  if (mm) {
    const row = await env.DB.prepare("SELECT * FROM media_metadata WHERE id=?").bind(mm[1]).first<Row>();
    if (!row) return json({ error: "not_found" }, 404);
    if (m === "DELETE") { // first delete = Trash; deleting from Trash (or ?permanent) removes it for good
      if (!row.deleted_at && !url.searchParams.has("permanent")) { await env.DB.prepare("UPDATE media_metadata SET deleted_at=? WHERE id=?").bind(now, row.id).run(); return json({ ok: true, trashed: true }); }
      await purgeMedia(env, row); return json({ ok: true });
    }
    if (m === "PATCH") {
      const b = await read(req);
      if (b.restore === true) await env.DB.prepare("UPDATE media_metadata SET deleted_at=NULL WHERE id=?").bind(row.id).run();
      if (typeof b.favorite === "boolean") await env.DB.prepare("UPDATE media_metadata SET favorite=? WHERE id=?").bind(b.favorite ? 1 : 0, row.id).run();
      if (typeof b.name === "string") { const n = clean(b.name); if (!n) return json({ error: "invalid" }, 400); await env.DB.prepare("UPDATE media_metadata SET name=? WHERE id=?").bind(n, row.id).run(); }
      return json({ ok: true });
    }
    if (m === "GET") {
      if (url.searchParams.has("thumb")) { const t = await env.MEDIA_BUCKET.get(row.r2_key + ".thumb"); return t ? new Response(t.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } }) : json({ error: "not_found" }, 404); }
      const h: Record<string, string> = { "Content-Type": row.mime, "Cache-Control": "no-store", "Accept-Ranges": "bytes", "Content-Disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.name)}` };
      const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
      if (rg && (rg[1] || rg[2])) {
        const a = rg[1] === "" ? row.size - Number(rg[2]) : Number(rg[1]), b = rg[1] === "" || rg[2] === "" ? row.size - 1 : Math.min(Number(rg[2]), row.size - 1);
        if (a < 0 || a > b || a >= row.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${row.size}` } });
        const o = await env.MEDIA_BUCKET.get(row.r2_key, { range: { offset: a, length: b - a + 1 } });
        return o ? new Response(o.body, { status: 206, headers: { ...h, "Content-Range": `bytes ${a}-${b}/${row.size}`, "Content-Length": String(b - a + 1) } }) : json({ error: "not_found" }, 404);
      }
      const o = await env.MEDIA_BUCKET.get(row.r2_key);
      return o ? new Response(o.body, { headers: { ...h, "Content-Length": String(row.size) } }) : json({ error: "not_found" }, 404);
    }
  }
  return json({ error: "not_found" }, 404);
}

export default {
  async scheduled(_e: ScheduledController, env: Env): Promise<void> { // abandoned multipart uploads
    const { results } = await env.DB.prepare("SELECT id,r2_key,upload_id FROM upload_sessions WHERE status='open' AND expires_at<? LIMIT 50").bind(Date.now()).all<Up>();
    for (const u of results) { await s3.abort(env, u.r2_key, u.upload_id).catch(() => {}); await env.DB.prepare("UPDATE upload_sessions SET status='expired' WHERE id=?").bind(u.id).run(); }
    await env.DB.prepare("DELETE FROM upload_sessions WHERE status!='open' AND created_at<?").bind(Date.now() - 7 * 86400e3).run();
    for (const r of (await env.DB.prepare("SELECT * FROM media_metadata WHERE deleted_at IS NOT NULL AND deleted_at<? LIMIT 50").bind(Date.now() - 30 * 86400e3).all<Row>()).results) await purgeMedia(env, r); // Trash auto-empties after 30 days
    await env.DB.prepare("DELETE FROM webauthn_challenges WHERE expires_at<?").bind(Date.now()).run();
    await env.DB.prepare("DELETE FROM login_challenges WHERE expires_at<?").bind(Date.now()).run();
    await env.DB.prepare("DELETE FROM recovery_tokens WHERE expires_at<? OR used=1").bind(Date.now()).run();
    await env.DB.prepare("DELETE FROM active_sessions WHERE created_at<? OR last_seen<?").bind(Date.now() - ABS, Date.now() - IDLE).run();
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    try { return secure(await route(req, env), env); } catch (e) { console.error("route_error", (e as Error).message); return secure(json({ error: "server_error", message: "Something went wrong. Try again." }, 500), env); }
  },
};
