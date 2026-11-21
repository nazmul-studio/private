// Builds public/assets/style.css: Tailwind utilities used by the pages + the vault theme's own CSS.
// Run after changing any class name in public/*.html or public/assets/*.js:  npm run build:css
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const twDir = path.dirname(require.resolve("tailwindcss/package.json")) + "/";
const { compile } = await import(path.join(twDir, "dist/lib.mjs"));
const pub = new URL("../public/", import.meta.url).pathname;
const files = [...fs.readdirSync(pub).filter((f) => f.endsWith(".html")).map((f) => pub + f), ...fs.readdirSync(pub + "assets").filter((f) => f.endsWith(".js")).map((f) => pub + "assets/" + f)];
const cands = new Set(); for (const f of files) for (const t of fs.readFileSync(f, "utf8").split(/[\s"'`<>{}]+/)) if (t) cands.add(t);
const c = await compile('@import "tailwindcss";', { base: twDir, loadStylesheet: async (id, base) => { const p = id === "tailwindcss" ? twDir + "index.css" : id.startsWith("tailwindcss/") ? twDir + id.slice(12) + ".css" : path.resolve(base, id); return { path: p, base: path.dirname(p), content: fs.readFileSync(p, "utf8") }; } });
const out = c.build([...cands]) + "\n" + fs.readFileSync(new URL("./vault.css", import.meta.url), "utf8");
fs.writeFileSync(pub + "assets/style.css", out); console.log("style.css", out.length, "bytes from", cands.size, "candidates");
