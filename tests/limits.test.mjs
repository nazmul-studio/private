import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, PART, categoryOfName, sizeMessage, planParts, cleanName } from "../public/assets/limits.js";
test("limits are exact", () => { assert.equal(LIMITS.image, 52428800); assert.equal(LIMITS.video, 367001600); });
test("categories by extension", () => {
  for (const n of ["a.JPG", "b.png", "c.heic", "d.pdf"]) assert.equal(categoryOfName(n), "image");
  for (const n of ["a.mp4", "b.MOV"]) assert.equal(categoryOfName(n), "video");
  for (const n of ["a.exe", "b.svg", "noext", "x.mp4.js"]) assert.equal(categoryOfName(n), null);
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
