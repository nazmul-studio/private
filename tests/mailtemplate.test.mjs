import test from "node:test"; import assert from "node:assert/strict";
import { renderMail, esc } from "../src/mailtemplate.js";
test("escapes html in subject and body", () => { const h = renderMail("<b>x</b>", "a <script>alert(1)</script> & b"); assert.ok(!h.includes("<script>") && !h.includes("<b>x</b>")); assert.ok(h.includes("&lt;script&gt;")); });
test("sign-in code gets its own chip", () => { const h = renderMail("Code", "Your sign-in code is 123456. It expires in 10 minutes."); assert.ok(h.includes(">123456<")); });
test("link becomes a button and is escaped", () => { const h = renderMail("Recovery", "Recovery was requested.\nhttps://x.dev/r.html#t=a\"b\nIgnore if not you."); assert.ok(h.includes('href="https://x.dev/r.html#t=a&quot;b"')); assert.ok(h.includes("Open secure link") && !h.includes(">https")); });
test("esc handles quotes", () => assert.equal(esc(`"'<`), "&quot;&#39;&lt;"));
