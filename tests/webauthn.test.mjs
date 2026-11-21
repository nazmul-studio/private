// Software-authenticator test: proves @simplewebauthn/server (as pinned in package.json) accepts a valid
// registration + sign-in with the exact options used in src/index.ts, and rejects a wrong origin / reused counter.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, createSign, randomBytes } from "node:crypto";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

const RP = "vault.example.test", ORIGIN = "https://" + RP;
const b64 = (b) => Buffer.from(b).toString("base64url");
const sha = (b) => createHash("sha256").update(b).digest();
const hdr = (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
const bytes = (b) => Buffer.concat([hdr(2, b.length), b]);
const text = (s) => Buffer.concat([hdr(3, s.length), Buffer.from(s)]);
const counter = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" }), credId = randomBytes(16);
const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]), bytes(Buffer.from(jwk.x, "base64url")), Buffer.from([0x22]), bytes(Buffer.from(jwk.y, "base64url"))]);

async function register(origin = ORIGIN) {
  const o = await generateRegistrationOptions({ rpName: "private vault", rpID: RP, userName: "owner", attestationType: "none", excludeCredentials: [], authenticatorSelection: { residentKey: "preferred", userVerification: "required" } });
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: o.challenge, origin }));
  const authData = Buffer.concat([sha(RP), Buffer.from([0x45]), counter(0), Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose]);
  const att = Buffer.concat([Buffer.from([0xa3]), text("fmt"), text("none"), text("attStmt"), Buffer.from([0xa0]), text("authData"), bytes(authData)]);
  const response = { id: b64(credId), rawId: b64(credId), type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(clientData), attestationObject: b64(att), transports: ["internal"] } };
  return verifyRegistrationResponse({ response, expectedChallenge: o.challenge, expectedOrigin: ORIGIN, expectedRPID: RP, requireUserVerification: true });
}

async function signIn(stored, n, origin = ORIGIN) {
  const o = await generateAuthenticationOptions({ rpID: RP, userVerification: "required", allowCredentials: [{ id: stored.id, transports: ["internal"] }] });
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: o.challenge, origin }));
  const authData = Buffer.concat([sha(RP), Buffer.from([0x05]), counter(n)]);
  const sig = createSign("sha256").update(Buffer.concat([authData, sha(clientData)])).sign(privateKey);
  const response = { id: stored.id, rawId: stored.id, type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(sig) } };
  return verifyAuthenticationResponse({ response, expectedChallenge: o.challenge, expectedOrigin: ORIGIN, expectedRPID: RP, credential: { id: stored.id, publicKey: isoBase64URL.toBuffer(stored.publicKey), counter: stored.counter, transports: ["internal"] }, requireUserVerification: true });
}

test("registration verifies and the public key survives the base64url storage round trip", async () => {
  const v = await register();
  assert.equal(v.verified, true);
  const c = v.registrationInfo.credential;
  assert.equal(c.id, b64(credId));
  const stored = isoBase64URL.fromBuffer(c.publicKey);
  assert.deepEqual(Buffer.from(isoBase64URL.toBuffer(stored)), Buffer.from(c.publicKey));
});
test("registration with a wrong origin is rejected", async () => { await assert.rejects(register("https://evil.example.test")); });
test("sign-in verifies, returns the new counter, and a wrong origin is rejected", async () => {
  const stored = { id: b64(credId), publicKey: isoBase64URL.fromBuffer(new Uint8Array(cose)), counter: 0 };
  const v = await signIn(stored, 1);
  assert.equal(v.verified, true); assert.equal(v.authenticationInfo.newCounter, 1);
  await assert.rejects(signIn(stored, 2, "https://evil.example.test"));
});
test("a replayed (non-increasing) counter is rejected", async () => {
  const stored = { id: b64(credId), publicKey: isoBase64URL.fromBuffer(new Uint8Array(cose)), counter: 5 };
  await assert.rejects(signIn(stored, 5));
});
