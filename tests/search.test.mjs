import test from "node:test";
import assert from "node:assert/strict";
import { SEARCH_MIN, MAX_BULK, searchTerms, escapeLike, keywordScore, unit, packVec, dotPacked, rank, cleanIds } from "../src/search.js";

const rnd = (n, seed) => { let s = seed; return Array.from({ length: n }, () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) - 0.5); };
const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return d / Math.sqrt(x * y); };

test("search terms: any script, Bangla marks kept, short and duplicate words dropped, capped at 8", () => {
  assert.deepEqual(searchTerms("Red  car, on the road!"), ["red", "car", "on", "the", "road"]);
  assert.deepEqual(searchTerms("লাল জামা পরা ছেলে"), ["লাল", "জামা", "পরা", "ছেলে"]);
  assert.deepEqual(searchTerms("a b cat cat"), ["cat"]);
  assert.equal(searchTerms("one two three four five six seven eight nine ten").length, 8);
  assert.deepEqual(searchTerms("  !!  "), []);
});

test("LIKE patterns are escaped", () => {
  assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
});

test("keyword score: 0 for no match, higher when more words match, filename counts a little more than description", () => {
  assert.equal(keywordScore(["beach"], "IMG_1.jpg", "a sunny day"), 0);
  assert.equal(keywordScore([], "x", "y"), 0);
  const all = keywordScore(["red", "car"], "x.jpg", "a red car on a road"), some = keywordScore(["red", "car"], "x.jpg", "a red bus");
  assert.ok(all > some && some > 0 && all <= 1);
  assert.ok(keywordScore(["beach"], "beach.jpg", null) > keywordScore(["beach"], "x.jpg", "a beach"));
  assert.ok(keywordScore(["beach"], "x.jpg", "a beach") >= SEARCH_MIN);
});

test("packed vectors keep the cosine similarity (int8 storage error stays small)", () => {
  const a = rnd(1024, 1), b = rnd(1024, 2), near = a.map((x, i) => x + 0.3 * b[i]);
  const q = unit(a);
  assert.ok(Math.abs(dotPacked(q, packVec(a)) - 1) < 0.01);
  for (const v of [b, near]) assert.ok(Math.abs(dotPacked(q, packVec(v)) - cosine(a, v)) < 0.02, "close to the float cosine");
  assert.ok(dotPacked(q, packVec(near)) > dotPacked(q, packVec(b)), "similar vector ranks above an unrelated one");
  assert.ok(dotPacked(q, packVec(a.map((x) => -x))) < -0.99);
  assert.ok(packVec(a).length < 1500, "about 1.4 KB per photo");
});

test("a stored vector of a different size never matches (model change)", () => {
  assert.equal(dotPacked(unit(rnd(512, 3)), packVec(rnd(1024, 3))), 0);
});

test("rank: best score first, weak results dropped, limit applied, ties broken by combined score", () => {
  const hits = new Map([["weak", { sem: 0.2, kw: 0 }], ["sem", { sem: 0.6, kw: 0 }], ["kw", { sem: 0, kw: 0.93 }], ["both", { sem: 0.6, kw: 0.3 }], ["edge", { sem: SEARCH_MIN, kw: 0 }]]);
  assert.deepEqual(rank(hits).map((r) => r.id), ["kw", "both", "sem", "edge"]);
  assert.equal(rank(hits, 2).length, 2);
});

test("bulk ids: only safe ids, no duplicates, capped", () => {
  assert.deepEqual(cleanIds(["a-1", "b_2", "a-1", "bad id", "x'; DROP", 5, null, ""]), ["a-1", "b_2"]);
  assert.deepEqual(cleanIds("nope"), []);
  assert.equal(cleanIds(Array.from({ length: 200 }, (_, i) => "id" + i)).length, MAX_BULK);
});
