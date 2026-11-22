// Pure helpers for search ranking, vectors and bulk-id handling (no Cloudflare APIs) so they can be unit-tested in Node.
// Minimum score for a result to be shown. Cosine similarity of the multilingual embedding model is roughly 0.5-0.8 for a
// good match and 0.1-0.3 for an unrelated one; raise this if unrelated photos show up, lower it if real matches are missing.
export const SEARCH_MIN = 0.35;
export const MAX_BULK = 40; // ids per bulk request (keeps every request well inside D1's per-request query limits)

// Words of a query (any script, Bangla combining marks and joiners included). Single characters are ignored.
export function searchTerms(q) {
  const out = [];
  for (const m of String(q).toLowerCase().matchAll(/[\p{L}\p{M}\p{N}‌‍]+/gu)) {
    if (m[0].length >= 2 && !out.includes(m[0])) out.push(m[0]);
    if (out.length === 8) break;
  }
  return out;
}
export const escapeLike = (s) => String(s).replace(/[\\%_]/g, "\\$&"); // for LIKE ? ESCAPE '\'

// 0 when no word matches; otherwise 0.3..1 by how many words were found (a filename hit counts a little more than a description hit).
export function keywordScore(terms, name, description) {
  if (!terms.length) return 0;
  const n = String(name ?? "").toLowerCase(), d = String(description ?? "").toLowerCase();
  let sum = 0;
  for (const t of terms) sum += n.includes(t) ? 1 : d.includes(t) ? 0.9 : 0;
  return sum === 0 ? 0 : 0.3 + 0.7 * (sum / terms.length);
}

// Vectors are stored as base64 of int8 values (about 1.4 KB for 1024 dimensions instead of 5.5 KB as float32).
// Cosine similarity does not depend on overall scale, so only the direction is kept.
export function unit(v) {
  let s = 0; for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return Float32Array.from(v, (x) => x / n);
}
export function packVec(v) {
  const u = unit(v); let max = 0;
  for (const x of u) max = Math.max(max, Math.abs(x));
  const k = max ? 127 / max : 1, bytes = new Uint8Array(u.length);
  for (let i = 0; i < u.length; i++) bytes[i] = Math.round(u[i] * k) & 0xff;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
// Cosine similarity between a unit-length query vector and a stored vector. 0 if the sizes differ (e.g. after a model change).
export function dotPacked(q, packed) {
  const bin = atob(packed);
  if (bin.length !== q.length) return 0;
  let dot = 0, nb = 0;
  for (let i = 0; i < q.length; i++) { let b = bin.charCodeAt(i); if (b > 127) b -= 256; dot += q[i] * b; nb += b * b; }
  return nb ? dot / Math.sqrt(nb) : 0;
}

// hits: Map id -> { sem, kw }. Best of the two scores, then the sum as a tie-break; weak results are dropped.
export function rank(hits, limit = 80) {
  const out = [];
  for (const [id, h] of hits) { const score = Math.max(h.sem, h.kw); if (score >= SEARCH_MIN) out.push({ id, score, tie: h.sem + h.kw }); }
  return out.sort((a, b) => b.score - a.score || b.tie - a.tie).slice(0, limit);
}

export const cleanIds = (v, max = MAX_BULK) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && /^[\w-]{1,64}$/.test(x)))].slice(0, max) : []);
