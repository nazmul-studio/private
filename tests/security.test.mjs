import test from "node:test";
import assert from "node:assert/strict";
import { apply, fresh, view, delayFor, hit, challengeState, tokenState, LOCK_MS } from "../src/policy.js";
const T = 1_000_000, fail = (s, n, t = T) => { for (let i = 0; i < n; i++) s = apply(s, "fail", t); return s; };
test("attempts 1-4 stay open, 5 locks for 12h", () => {
  assert.equal(view(fail(fresh(), 4), T).locked, false);
  const s = fail(fresh(), 5); assert.equal(view(s, T).locked, true); assert.equal(s.lockedUntil, T + LOCK_MS);
});
test("attempts 6-9 keep the original deadline; 10 is emergency lockdown", () => {
  let s = fail(fresh(), 5);
  for (let i = 6; i <= 9; i++) { s = apply(s, "fail", T + 1000 * i); assert.equal(s.lockedUntil, T + LOCK_MS); assert.equal(s.lockdown, false); }
  s = apply(s, "fail", T + 20000); assert.equal(s.lockdown, true);
});
test("a correct factor never bypasses lock or lockdown", () => {
  const locked = fail(fresh(), 5); assert.deepEqual(apply(locked, "ok", T + 1), locked);
  const down = fail(fresh(), 10); assert.equal(apply(down, "ok", T + LOCK_MS + 1).lockdown, true);
});
test("success after the lock ends resets the counter; reset clears lockdown", () => {
  assert.equal(apply(fail(fresh(), 5), "ok", T + LOCK_MS).fails, 0);
  assert.deepEqual(apply(fail(fresh(), 10), "reset", T), fresh());
});
test("state survives a restart or another device (plain JSON round trip)", () => {
  const s = JSON.parse(JSON.stringify(fail(fresh(), 5)));
  assert.equal(view(s, T + 1000).locked, true); assert.equal(view(s, T + LOCK_MS).locked, false);
});
test("progressive delay grows, is capped, and gates the next attempt", () => {
  assert.equal(delayFor(1), 0); assert.ok(delayFor(3) > delayFor(2)); assert.equal(delayFor(30), 30000);
  assert.ok(view(fail(fresh(), 3), T).wait > 0); assert.equal(view(fail(fresh(), 3), T + 60000).wait, 0);
});
test("per-IP rate limit blocks the 13th request and recovers after the window", () => {
  let w; for (let i = 0; i < 12; i++) { const r = hit(w, T + i, 12, 600000); assert.ok(r.ok); w = r.w; }
  assert.equal(hit(w, T + 100, 12, 600000).ok, false); assert.equal(hit(w, T + 700000, 12, 600000).ok, true);
});
test("email OTP: expiry and attempt cap", () => {
  assert.equal(challengeState(null, T), "gone"); assert.equal(challengeState({ expires: T + 1, attempts: 0 }, T), "valid");
  assert.equal(challengeState({ expires: T - 1, attempts: 0 }, T), "expired"); assert.equal(challengeState({ expires: T + 1, attempts: 5 }, T), "locked");
});
test("recovery token: valid, expired, single-use, attempt cap, gone", () => {
  assert.equal(tokenState({ expires: T + 1, attempts: 0, used: false }, T), "valid"); assert.equal(tokenState({ expires: T - 1, attempts: 0, used: false }, T), "expired");
  assert.equal(tokenState({ expires: T + 1, attempts: 0, used: true }, T), "used"); assert.equal(tokenState({ expires: T + 1, attempts: 5, used: false }, T), "locked");
  assert.equal(tokenState(null, T), "gone");
});
