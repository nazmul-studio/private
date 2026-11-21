import test from "node:test";
import assert from "node:assert/strict";
import { apply, fresh, view, delayFor, hit, challengeState, tokenState, HOLD_MS } from "../src/policy.js";
const T = 1_000_000, fail = (s, n, t = T) => { for (let i = 0; i < n; i++) s = apply(s, "fail", t); return s; };
test("attempts 1-4 stay open, 5 starts a 12h maintenance hold but never locks sign-in", () => {
  assert.equal(view(fail(fresh(), 4), T).held, false);
  const s = fail(fresh(), 5); assert.equal(view(s, T).held, true); assert.equal(s.holdUntil, T + HOLD_MS); assert.equal(s.lockdown, false);
  assert.equal(view(s, T + HOLD_MS).held, false);
});
test("attempts 6-9 keep the original hold deadline; 10 is emergency lockdown", () => {
  let s = fail(fresh(), 5);
  for (let i = 6; i <= 9; i++) { s = apply(s, "fail", T + 1000 * i); assert.equal(s.holdUntil, T + HOLD_MS); assert.equal(s.lockdown, false); }
  s = apply(s, "fail", T + 20000); assert.equal(s.lockdown, true);
});
test("a correct sign-in resets the counter but does not end the hold; lockdown is never bypassed", () => {
  const held = fail(fresh(), 5), ok = apply(held, "ok", T + 1);
  assert.equal(ok.fails, 0); assert.equal(view(ok, T + 1).held, true);
  assert.equal(apply(fail(fresh(), 10), "ok", T + HOLD_MS + 1).lockdown, true);
});
test("a new 5-failure streak after the hold ended starts a new hold; during a hold it does not restart", () => {
  let s = apply(fail(fresh(), 5), "ok", T + 1); s = fail(s, 5, T + 2000); assert.equal(s.holdUntil, T + HOLD_MS);
  s = apply(s, "ok", T + HOLD_MS + 5); s = fail(s, 5, T + HOLD_MS + 10); assert.equal(s.holdUntil, T + HOLD_MS + 10 + HOLD_MS);
});
test("reset (recovery/admin) clears hold and lockdown", () => {
  assert.deepEqual(apply(fail(fresh(), 10), "reset", T), fresh()); assert.deepEqual(apply(fail(fresh(), 5), "reset", T), fresh());
});
test("state survives a restart or another device (plain JSON round trip)", () => {
  const s = JSON.parse(JSON.stringify(fail(fresh(), 5)));
  assert.equal(view(s, T + 1000).held, true); assert.equal(view(s, T + HOLD_MS).held, false);
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
