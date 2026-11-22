// Builds public/assets/world.json (country outlines for the 3D globe on the Overview page).
// Usage: node tools/build-world.mjs path/to/countries.geo.json
// Source used: github.com/johan/world.geo.json (public domain, derived from Natural Earth). Coordinates are rounded to 0.1 degree.
import fs from "node:fs";
const src = process.argv[2];
if (!src) { console.error("usage: node tools/build-world.mjs countries.geo.json"); process.exit(1); }
const g = JSON.parse(fs.readFileSync(src, "utf8")), r1 = (v) => Math.round(v * 10) / 10;
const c = [];
for (const f of g.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
  const out = [];
  for (const rings of polys) {
    const rs = [];
    for (const ring of rings) {
      const flat = []; let lx = NaN, ly = NaN;
      for (const [x, y] of ring) { const a = r1(x), b = r1(y); if (a === lx && b === ly) continue; flat.push(a, b); lx = a; ly = b; } // drop repeated points
      if (flat.length >= 4 && flat[0] === flat[flat.length - 2] && flat[1] === flat[flat.length - 1]) flat.length -= 2; // the closing point repeats the first one
      if (flat.length >= 6) rs.push(flat);
    }
    if (rs.length) out.push(rs);
  }
  if (out.length) c.push({ n: String(f.properties?.name ?? f.id ?? ""), p: out });
}
const text = JSON.stringify({ c });
fs.writeFileSync(new URL("../public/assets/world.json", import.meta.url), text);
console.log("world.json:", c.length, "countries,", text.length, "bytes");
