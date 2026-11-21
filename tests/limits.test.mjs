import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, PART, categoryOfName, sizeMessage, planParts, cleanName } from "../public/assets/limits.js";
test("limits are exact", () => { assert.equal(LIMITS.image, 52428800); assert.equal(LIMITS.video, 367001600); assert.equal(LIMITS.file, 52428800); });
test("categories by extension", () => {
  for (const n of ["a.JPG", "b.png", "c.heic", "d.pdf"]) assert.equal(categoryOfName(n), "image");
  for (const n of ["a.mp4", "b.MOV"]) assert.equal(categoryOfName(n), "video");
  for (const n of ["a.zip", "b.DOCX", "c.txt", "d.json", "e.7z", "f.csv"]) assert.equal(categoryOfName(n), "file");
  for (const n of ["a.exe", "b.svg", "noext", "x.mp4.js", "p.html", "q.js", "r.php"]) assert.equal(categoryOfName(n), null);
});
test("error messages name the category limit", () => {
  assert.match(sizeMessage("a.jpg", 60e6, "image"), /Images can be up to 50 MB/);
  assert.match(sizeMessage("a.mp4", 400e6, "video"), /Videos can be up to 350 MB/);
});
test("part plan covers the file exactly and respects R2 part rules", () => {
  for (const size of [1, PART, PART + 1, LIMITS.video, LIMITS.video - 1]) {
    const p = planParts(size);
    assert.equal(p[0].start, 0); assert.equal(p.at(-1).end, size);
    p.forEach((x, i) => { if (i < p.length - 1) assert.equal(x.end - x.start, PART); if (i) assert.equal(x.start, p[i - 1].end); });
    assert.ok(p.length <= 10000);
  }
  assert.equal(planParts(LIMITS.video).length, 22);
});
import { validParts } from "../public/assets/limits.js";
test("resume keeps only fully uploaded parts of the planned size", () => {
  const size = PART * 2 + 5, plan = planParts(size);
  const listed = [{ n: 1, size: PART }, { n: 2, size: PART - 1 }, { n: 3, size: 5 }, { n: 9, size: PART }];
  assert.deepEqual(validParts(listed, size).map((p) => p.n), [1, 3]);
  assert.equal(plan.length, 3);
});
test("cleanName keeps Bangla and other letters, replaces unsafe characters, caps length", () => {
  assert.equal(cleanName("ছবি.jpg"), "ছবি.jpg");
  assert.equal(cleanName("ঢাকা ভ্রমণ 2026.mp4"), "ঢাকা ভ্রমণ 2026.mp4");
  assert.equal(cleanName("a/b\\c<d>.png"), "a_b_c_d_.png");
  assert.equal(cleanName("x".repeat(300)).length, 120);
});
import { sniffFile } from "../public/assets/limits.js";
const B = (...a) => Uint8Array.from(a), T8 = (t) => new TextEncoder().encode(t);
test("archives and documents must match their extension by content", () => {
  assert.ok(sniffFile("a.zip", B(0x50, 0x4b, 3, 4, 0))); assert.ok(sniffFile("a.docx", B(0x50, 0x4b, 3, 4)));
  assert.ok(!sniffFile("a.zip", T8("<html><script>alert(1)</script>"))); assert.ok(!sniffFile("a.docx", T8("hello")));
  assert.ok(sniffFile("a.rar", T8("Rar!\x1a\x07"))); assert.ok(sniffFile("a.7z", B(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c))); assert.ok(sniffFile("a.gz", B(0x1f, 0x8b, 8)));
  assert.ok(sniffFile("a.doc", B(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))); assert.ok(sniffFile("a.rtf", T8("{\\rtf1")));
  const tar = new Uint8Array(512); tar.set(T8("ustar"), 257); assert.ok(sniffFile("a.tar", tar)); assert.ok(!sniffFile("a.tar", new Uint8Array(512)));
});
test("text documents: no binary bytes; json must look like json", () => {
  assert.ok(sniffFile("a.txt", T8("hello বাংলা"))); assert.ok(!sniffFile("a.txt", B(104, 0, 105))); assert.ok(!sniffFile("a.csv", new Uint8Array(0)));
  assert.ok(sniffFile("a.json", T8('{"a":1}'))); assert.ok(!sniffFile("a.json", T8("not json")));
});
