// Pure security rules (no Cloudflare APIs) so they can be unit-tested in Node.
export const LOCK_MS = 12 * 3600e3, OTP_TTL = 10 * 60e3, REC_TTL = 30 * 60e3;
export const fresh = () => ({ fails: 0, lockedUntil: 0, lockdown: false, retryAt: 0 });
export const delayFor = (fails) => (fails < 2 ? 0 : Math.min(2 ** (fails - 2) * 1000, 30000)); // progressive: 1s, 2s, 4s ... 30s
export function apply(s, op, now) {
  if (op === "reset") return fresh();
  const n = { ...s };
  if (op === "fail") {
    n.fails++; n.retryAt = now + delayFor(n.fails);
    if (n.fails >= 10) n.lockdown = true; else if (n.fails === 5) n.lockedUntil = now + LOCK_MS; // 6-9 never extend the original deadline
  } else if (op === "ok" && !n.lockdown && now >= n.lockedUntil) { n.fails = 0; n.lockedUntil = 0; n.retryAt = 0; } // a correct factor never bypasses an active lock
  return n;
}
export const view = (s, now) => ({ ...s, locked: now < s.lockedUntil, wait: Math.max(0, s.retryAt - now) });
export function hit(w, now, limit, windowMs) { const t = (w || []).filter((x) => now - x < windowMs); if (t.length >= limit) return { ok: false, w: t }; t.push(now); return { ok: true, w: t }; }
export const challengeState = (c, now) => (!c ? "gone" : now > c.expires ? "expired" : c.attempts >= 5 ? "locked" : "valid");
export const tokenState = (t, now) => (!t ? "gone" : t.used ? "used" : now > t.expires ? "expired" : t.attempts >= 5 ? "locked" : "valid");
