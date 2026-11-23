// End-to-end encryption. Runs in the browser (Web Crypto). The Worker only imports encSize() to check upload sizes;
// it never sees the passphrase, the key, file contents, thumbnails or file names.
// File format: "VEC1" | 8-byte random nonce prefix | uint32 chunk size | then each 1 MiB chunk as AES-256-GCM ciphertext (+16-byte tag).
// Chunk i uses nonce prefix||i and authenticates a "last chunk" flag, so reordering, cutting or extending a file is detected.
export const CH = 1048576, HEAD = 16, TAG = 16, ITER = 600000;
export const encSize = (n) => HEAD + n + TAG * Math.max(1, Math.ceil(n / CH));
const te = new TextEncoder(), td = new TextDecoder();
const b64e = (u) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const randomB64 = (n) => b64e(crypto.getRandomValues(new Uint8Array(n)));
export async function deriveKey(pass, saltB64, iter = ITER) { // passphrase -> non-extractable AES-256 key
  const base = await crypto.subtle.importKey("raw", te.encode(String(pass).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64d(saltB64), iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const nonce = (prefix, i) => { const n = new Uint8Array(12); n.set(prefix); new DataView(n.buffer).setUint32(8, i); return n; };
const aad = (last) => Uint8Array.of(last ? 1 : 0);
export async function encryptBlob(key, blob) {
  const prefix = crypto.getRandomValues(new Uint8Array(8)), head = new Uint8Array(HEAD);
  head.set(te.encode("VEC1")); head.set(prefix, 4); new DataView(head.buffer).setUint32(12, CH);
  const n = Math.max(1, Math.ceil(blob.size / CH)), parts = [head];
  for (let i = 0; i < n; i++) parts.push(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(prefix, i), additionalData: aad(i === n - 1) }, key, await blob.slice(i * CH, (i + 1) * CH).arrayBuffer()));
  return new Blob(parts, { type: "application/octet-stream" });
}
export async function decryptBuffer(key, buf, type = "application/octet-stream") {
  const u = new Uint8Array(buf);
  if (u.length < HEAD + TAG || td.decode(u.subarray(0, 4)) !== "VEC1" || new DataView(buf).getUint32(12) !== CH) throw new Error("not_encrypted");
  const prefix = u.slice(4, 12), step = CH + TAG, n = Math.max(1, Math.ceil((u.length - HEAD) / step)), parts = [];
  for (let i = 0; i < n; i++) parts.push(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce(prefix, i), additionalData: aad(i === n - 1) }, key, u.subarray(HEAD + i * step, Math.min(u.length, HEAD + (i + 1) * step))));
  return new Blob(parts, { type });
}
export async function encryptText(key, text) { const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(text))); const o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); return b64e(o); }
export async function decryptText(key, b64) { const u = b64d(b64); return td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12) }, key, u.subarray(12))); }
const CHECK = "vault-e2ee-v1";
export const makeVerifier = (key) => encryptText(key, CHECK); // stored on the server so a wrong passphrase is noticed, without revealing the key
export const checkVerifier = async (key, v) => { try { return (await decryptText(key, v)) === CHECK; } catch { return false; } };
