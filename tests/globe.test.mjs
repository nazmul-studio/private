import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareWorld, countryAt } from "../public/assets/globe.js";

const world = prepareWorld(JSON.parse(fs.readFileSync(new URL("../public/assets/world.json", import.meta.url), "utf8")));
const at = (lat, lon) => { const k = countryAt(world, lon, lat); return k < 0 ? null : world.list[k].name; };

test("world outline data: about 180 countries, every ring has real coordinates", () => {
  assert.ok(world.list.length >= 170);
  for (const c of world.list) for (const rings of c.polys) for (const r of rings) {
    assert.ok(r.flat.length >= 6 && r.flat.length % 2 === 0, c.name);
    for (let i = 0; i < r.flat.length; i += 2) assert.ok(Math.abs(r.flat[i]) <= 180 && Math.abs(r.flat[i + 1]) <= 90, c.name);
  }
});

test("points on the Earth resolve to the right country", () => {
  assert.equal(at(23.81, 90.41), "Bangladesh");           // Dhaka
  assert.equal(at(35.68, 139.69), "Japan");               // Tokyo
  assert.equal(at(-33.87, 151.21), "Australia");          // Sydney
  assert.equal(at(-15.79, -47.88), "Brazil");             // Brasilia
  assert.equal(at(28.61, 77.21), "India");                // Delhi
  assert.equal(at(-82, 20), "Antarctica");
});

test("open ocean has no country", () => { assert.equal(at(0, -140), null); assert.equal(at(-40, -30), null); });

test("densified rings never leave long straight edges (so they bend like great circles on the globe)", () => {
  for (const c of world.list) for (const rings of c.polys) for (const r of rings) {
    const v = r.xyz, n = v.length / 3;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, d = v[3 * i] * v[3 * j] + v[3 * i + 1] * v[3 * j + 1] + v[3 * i + 2] * v[3 * j + 2]; assert.ok(Math.acos(Math.min(1, d)) < 0.07, c.name); } // < 4 degrees
  }
});
