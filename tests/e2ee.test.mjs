import test from "node:test"; import assert from "node:assert/strict";
import { CH, encSize, deriveKey, randomB64, encryptBlob, decryptBuffer, encryptText, decryptText, makeVerifier, checkVerifier } from "../public/assets/e2ee.js";
const key = await deriveKey("correct horse", randomB64(16), 1000), other = await deriveKey("wrong", randomB64(16), 1000);
const bytes = (n) => { const u = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u.subarray(i, Math.min(n, i + 65536))); return u; };
for (const n of [0, 1, CH - 1, CH, CH + 5, 3 * CH + 17]) test(`round trip ${n} bytes, size matches encSize`, async () => {
  const plain = bytes(n), enc = await encryptBlob(key, new Blob([plain]));
  assert.equal(enc.size, encSize(n));
  const out = new Uint8Array(await (await decryptBuffer(key, await enc.arrayBuffer())).arrayBuffer());
  assert.deepEqual(out, plain);
});
test("ciphertext does not contain the plaintext", async () => { const plain = new TextEncoder().encode("SECRET-PHOTO-BYTES".repeat(50)), enc = new Uint8Array(await (await encryptBlob(key, new Blob([plain]))).arrayBuffer()); assert.ok(!Buffer.from(enc).includes("SECRET-PHOTO")); });
test("wrong key fails", async () => { const enc = await (await encryptBlob(key, new Blob([bytes(100)]))).arrayBuffer(); await assert.rejects(decryptBuffer(other, enc)); });
test("flipped byte is detected", async () => { const u = new Uint8Array(await (await encryptBlob(key, new Blob([bytes(5000)]))).arrayBuffer()); u[40] ^= 1; await assert.rejects(decryptBuffer(key, u.buffer)); });
test("cutting off the last chunk is detected", async () => { const u = new Uint8Array(await (await encryptBlob(key, new Blob([bytes(2 * CH + 10)]))).arrayBuffer()); await assert.rejects(decryptBuffer(key, u.slice(0, u.length - (10 + 16)).buffer)); });
test("swapping chunks is detected", async () => { const u = new Uint8Array(await (await encryptBlob(key, new Blob([bytes(3 * CH)]))).arrayBuffer()), s = CH + 16, a = u.slice(16, 16 + s), b = u.slice(16 + s, 16 + 2 * s); u.set(b, 16); u.set(a, 16 + s); await assert.rejects(decryptBuffer(key, u.buffer)); });
test("two encryptions of the same file differ", async () => { const p = new Blob([bytes(64)]), a = new Uint8Array(await (await encryptBlob(key, p)).arrayBuffer()), b = new Uint8Array(await (await encryptBlob(key, p)).arrayBuffer()); assert.notDeepEqual(a, b); });
test("text and verifier", async () => { assert.equal(await decryptText(key, await encryptText(key, "ছবি ১.jpg")), "ছবি ১.jpg"); const v = await makeVerifier(key); assert.ok(await checkVerifier(key, v)); assert.ok(!(await checkVerifier(other, v))); });
