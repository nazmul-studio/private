// Append-only access log. entry.ts calls this from OUTSIDE the main Worker, so src/index.ts is not touched.
// IP, network location and User-Agent come from the server (trustworthy). Device model and GPS come from the browser
// (client-reported: a determined attacker can fake them, the IP cannot be faked this way).
type Json = Record<string, any>;
type Env = { DB: D1Database };
type Sev = "info" | "warn" | "alert";

const str = (v: unknown, n: number) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, n));
const nf = (v: unknown) => { const x = Number(v); return v !== undefined && v !== null && v !== "" && Number.isFinite(x) ? x : null; }; // Cloudflare sends latitude/longitude as strings
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

export function readClient(h: Headers): Json | null { // header X-Client-Info = encodeURIComponent(JSON), written by login.js
  try {
    const raw = h.get("x-client-info");
    if (!raw || raw.length > 4000) return null;
    const o = JSON.parse(decodeURIComponent(raw));
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch { return null; }
}

export function deviceLabel(ua: string, c: Json | null): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  let dev = str(c?.model, 60) ?? "", os = "", m: RegExpExecArray | null;
  if ((m = /Android ([\d.]+)/.exec(ua))) { os = "Android " + (str(c?.pv, 20) || m[1]); if (!dev) { const d = /Android [\d.]+; ([^;)]+?)(?: Build|[;)])/.exec(ua); if (d && d[1].trim() !== "K") dev = d[1].trim(); } } // Chrome hides the model in the UA string; the client hint fills it in
  else if (/iPhone|iPad|iPod/.test(ua)) { dev ||= /(iPhone|iPad|iPod)/.exec(ua)![1]; const v = /OS ([\d_]+)/.exec(ua); os = "iOS" + (v ? " " + v[1].replace(/_/g, ".") : ""); } // Apple never exposes the exact model
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";
  const parts = [dev, os, browser].filter(Boolean);
  return parts.length ? parts.join(" · ") : str(c?.platform, 30) || "Unknown device";
}

// Which requests are worth a record. Returns [event, severity] or null.
export function classify(m: string, p: string, s: number, code: string): [string, Sev] | null {
  const ok = s >= 200 && s < 300, post = m === "POST";
  if (post && p === "/api/auth/email/verify") return ok ? ["login_ok", "info"] : s === 423 ? ["lockdown_blocked", "alert"] : s === 429 ? ["rate_limited", "warn"] : code === "expired" ? ["login_code_expired", "warn"] : ["login_code_failed", "alert"];
  if (post && p === "/api/auth/login") return ok ? ["password_ok", "info"] : s === 423 ? ["lockdown_blocked", "alert"] : s === 429 ? ["rate_limited", "warn"] : code === "bot_check" ? ["bot_check_failed", "warn"] : code === "passkey_required" ? ["passkey_missing", "warn"] : s === 401 ? ["login_failed", "alert"] : ["login_error", "warn"];
  if (post && p === "/api/auth/passkey/verify") return ok ? ["passkey_ok", "info"] : s === 423 ? ["lockdown_blocked", "alert"] : s === 429 ? ["rate_limited", "warn"] : ["passkey_failed", "alert"];
  if (post && p.startsWith("/api/recovery/")) return ok ? [p.endsWith("/start") ? "recovery_requested" : p.endsWith("/activate") ? "recovery_completed" : "recovery_verified", "alert"] : s === 429 ? ["rate_limited", "warn"] : code === "bot_check" ? ["bot_check_failed", "warn"] : ["recovery_failed", "alert"];
  if (post && p === "/api/auth/setup") return s === 403 ? ["setup_token_failed", "alert"] : null;
  if (post && p === "/api/admin/reset-lockdown") return s === 403 ? ["admin_token_failed", "alert"] : null;
  if (s === 403) return [code === "bad_origin" ? "bad_origin" : code === "bad_csrf" ? "bad_csrf" : "forbidden", "alert"];
  if (s === 429) return ["rate_limited", "warn"];
  if (s === 401 && p !== "/api/auth/me") return ["unauthorized_api_call", "warn"];
  return null;
}

// These are always recorded (the app's own rate limits already cap them). Noisy ones are recorded at most once a minute per IP.
const ALWAYS = new Set(["login_ok", "password_ok", "passkey_ok", "login_failed", "login_code_failed", "passkey_failed", "recovery_requested", "recovery_verified", "recovery_completed", "recovery_failed", "setup_token_failed", "admin_token_failed"]);

export async function record(env: Env, req: Request, ev: [string, Sev], status: number, path: string): Promise<void> {
  const cf = ((req as unknown as { cf?: Json }).cf ?? {}) as Json, ip = str(req.headers.get("CF-Connecting-IP"), 64), now = Date.now();
  if (!ALWAYS.has(ev[0]) && (await env.DB.prepare("SELECT 1 x FROM access_logs WHERE ip IS ? AND event=? AND at>? LIMIT 1").bind(ip, ev[0], now - 60e3).first())) return;
  const ua = (req.headers.get("User-Agent") ?? "").slice(0, 400), c = readClient(req.headers), g = (c?.geo ?? {}) as Json, gs = str(g.s, 12), granted = gs === "granted";
  const { geo: _geo, ...rest } = c ?? {}, cj = c ? JSON.stringify(rest) : null;
  await env.DB.prepare(`INSERT INTO access_logs(at,event,severity,ip,country,region,city,postal,lat,lon,tz,asn,org,colo,ua,device,client,geo_status,gps_lat,gps_lon,gps_acc,method,path,status) VALUES(${Array(24).fill("?").join(",")})`)
    .bind(now, ev[0], ev[1], ip, str(cf.country, 8), str(cf.region, 80), str(cf.city, 80), str(cf.postalCode, 16), nf(cf.latitude), nf(cf.longitude), str(cf.timezone, 60), nf(cf.asn), str(cf.asOrganization, 120), str(cf.colo, 8), ua, deviceLabel(ua, c), cj && cj.length <= 1500 ? cj : null, gs ?? "none", granted ? num(g.lat, -90, 90) : null, granted ? num(g.lon, -180, 180) : null, granted ? num(g.acc, 0, 1e7) : null, req.method, path, status).run();
}

export async function list(env: Env, limit: number, offset: number): Promise<unknown[]> {
  return (await env.DB.prepare("SELECT id,at,event,severity,ip,country,region,city,lat,lon,tz,asn,org,device,client,geo_status,gps_lat,gps_lon,gps_acc FROM access_logs ORDER BY at DESC, id DESC LIMIT ? OFFSET ?").bind(limit, offset).all()).results;
}
