// Pure security rules (no Cloudflare APIs) so they can be unit-tested in Node.
export const HOLD_MS = 12 * 3600e3, OTP_TTL = 10 * 60e3, REC_TTL = 30 * 60e3;
// 5 failed sign-ins: nobody is locked out, but the library is hidden (maintenance hold) for 12 h. 10 failed sign-ins: full lockdown.
export const fresh = () => ({ fails: 0, holdUntil: 0, lockdown: false, retryAt: 0 });
export const delayFor = (fails) => (fails < 2 ? 0 : Math.min(2 ** (fails - 2) * 1000, 30000)); // progressive: 1s, 2s, 4s ... 30s
export function apply(s, op, now) {
  if (op === "reset") return fresh();
  const n = { ...s };
  if (op === "fail") {
    n.fails++; n.retryAt = now + delayFor(n.fails);
    if (n.fails >= 10) n.lockdown = true; else if (n.fails === 5 && now >= n.holdUntil) n.holdUntil = now + HOLD_MS; // 6-9 never extend the original deadline
  } else if (op === "ok" && !n.lockdown) { n.fails = 0; n.retryAt = 0; } // a correct sign-in resets the counter but never ends a hold early; lockdown still needs recovery
  return n;
}
export const view = (s, now) => ({ ...s, held: now < s.holdUntil, wait: Math.max(0, s.retryAt - now) });
export function hit(w, now, limit, windowMs) { const t = (w || []).filter((x) => now - x < windowMs); if (t.length >= limit) return { ok: false, w: t }; t.push(now); return { ok: true, w: t }; }
export const challengeState = (c, now) => (!c ? "gone" : now > c.expires ? "expired" : c.attempts >= 5 ? "locked" : "valid");
export const tokenState = (t, now) => (!t ? "gone" : t.used ? "used" : now > t.expires ? "expired" : t.attempts >= 5 ? "locked" : "valid");
