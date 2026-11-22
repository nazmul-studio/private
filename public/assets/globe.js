// A colourful 3D globe of the real Earth, drawn on a plain <canvas> (no libraries, so it works with the site's strict CSP).
// Country outlines come from /assets/world.json; pins are real session locations. Drag to rotate; it turns slowly on its own.
const D2R = Math.PI / 180, TAU = Math.PI * 2, STEP = 3.5 * D2R; // edges longer than 3.5 degrees are split so they bend like real great circles
const clampLat = (v) => Math.max(-85, Math.min(85, v));
let worldP = null;
const loadWorld = () => (worldP ||= fetch("/assets/world.json").then((r) => { if (!r.ok) throw new Error("world.json " + r.status); return r.json(); }).then(prepare));

function ring(flat) {
  const n = flat.length / 2, vec = (i) => { const lo = flat[2 * i] * D2R, la = flat[2 * i + 1] * D2R, c = Math.cos(la); return [c * Math.sin(lo), Math.sin(la), c * Math.cos(lo)]; }, pts = [];
  for (let i = 0; i < n; i++) {
    const a = vec(i), b = vec((i + 1) % n); pts.push(a);
    const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    if (ang > STEP && ang < Math.PI - 1e-3) for (let m = Math.ceil(ang / STEP), s = Math.sin(ang), j = 1; j < m; j++) { const t = j / m, w1 = Math.sin((1 - t) * ang) / s, w2 = Math.sin(t * ang) / s; pts.push([w1 * a[0] + w2 * b[0], w1 * a[1] + w2 * b[1], w1 * a[2] + w2 * b[2]]); }
  }
  const xyz = new Float32Array(pts.length * 3); pts.forEach((p, i) => { xyz[3 * i] = p[0]; xyz[3 * i + 1] = p[1]; xyz[3 * i + 2] = p[2]; });
  return { xyz, flat };
}
function prepare(j) {
  let maxN = 0;
  const list = j.c.map((c, k) => {
    let w = 180, e = -180, s = 90, nn = -90;
    const polys = c.p.map((rings) => rings.map((flat) => { for (let i = 0; i < flat.length; i += 2) { w = Math.min(w, flat[i]); e = Math.max(e, flat[i]); s = Math.min(s, flat[i + 1]); nn = Math.max(nn, flat[i + 1]); } const r = ring(flat); maxN = Math.max(maxN, r.xyz.length / 3); return r; }));
    const h = (k * 137.508) % 360, sat = 58 + ((k * 7) % 14), lig = 46 + ((k * 5) % 9); // golden-angle hues: neighbouring countries get clearly different colours
    return { name: c.n, polys, box: [w, s, e, nn], base: `hsl(${h.toFixed(0)} ${sat}% ${lig}%)`, hi: `hsl(${h.toFixed(0)} 85% ${lig + 14}%)`, side: `hsl(${h.toFixed(0)} ${sat}% ${Math.max(14, lig - 24)}%)` };
  });
  return { list, vx: new Float32Array(maxN), vy: new Float32Array(maxN), vz: new Float32Array(maxN) };
}
function inRing(flat, lon, lat) { let r = false; for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) { const xi = flat[i], yi = flat[i + 1], xj = flat[j], yj = flat[j + 1]; if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) r = !r; } return r; }
function countryAt(W, lon, lat) {
  for (let k = 0; k < W.list.length; k++) {
    const c = W.list[k], b = c.box; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    for (const rings of c.polys) if (inRing(rings[0].flat, lon, lat) && !rings.slice(1).some((h) => inRing(h.flat, lon, lat))) return k;
  }
  return -1;
}

export { prepare as prepareWorld, countryAt }; // exported so the outline data and the country lookup can be tested in Node

export function createGlobe(host, opt = {}) {
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d"), tip = document.createElement("div");
  canvas.className = "vx-gcanvas"; tip.className = "vx-gtip hidden"; host.prepend(canvas); host.append(tip);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = null, pins = [], hiSet = new Set(), lon0 = 80, lat0 = 18, vLon = 0, vLat = 0, drag = null, lastTouch = -1e9, w = 0, h = 0, R = 100, cx = 0, cy = 0, run = false, raf = 0, prev = 0, hover = null;
  loadWorld().then((x) => { W = x; markCountries(); }).catch(() => {});

  function markCountries() { hiSet = new Set(); if (W) for (const p of pins) { const k = countryAt(W, p.lon, p.lat); if (k >= 0) hiSet.add(k); } }
  function resize() { const r = host.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); w = Math.max(50, r.width); h = Math.max(50, r.height); canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); ctx.setTransform(d, 0, 0, d, 0, 0); R = Math.min(w, h) / 2 * 0.84; cx = w / 2; cy = h / 2; }
  const view = () => { const l = lon0 * D2R, p = lat0 * D2R; return { cl: Math.cos(l), sl: Math.sin(l), cp: Math.cos(p), sp: Math.sin(p) }; };
  const rot = (x, y, z, v) => { const z1 = z * v.cl + x * v.sl; return [x * v.cl - z * v.sl, y * v.cp - z1 * v.sp, y * v.sp + z1 * v.cp]; }; // [screen x, screen y (up), depth (toward the viewer)]
  const toVec = (lat, lon) => { const la = lat * D2R, lo = lon * D2R, c = Math.cos(la); return [c * Math.sin(lo), Math.sin(la), c * Math.cos(lo)]; };

  // Adds the visible part of one ring to a path: edges crossing the horizon are cut there, and the hidden stretch is replaced by an arc along the rim.
  function addRing(path, xyz, v) {
    const n = xyz.length / 3, X = W.vx, Y = W.vy, Z = W.vz; let s = -1;
    for (let i = 0; i < n; i++) { const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2], z1 = z * v.cl + x * v.sl; X[i] = x * v.cl - z * v.sl; Y[i] = y * v.cp - z1 * v.sp; Z[i] = y * v.sp + z1 * v.cp; if (s < 0 && Z[i] >= 0) s = i; }
    if (s < 0) return false;
    let first = true, ex = 0, ey = 0;
    const put = (x, y) => { const px = cx + R * x, py = cy - R * y; if (first) { path.moveTo(px, py); first = false; } else path.lineTo(px, py); };
    const cross = (i, j) => { const t = Z[i] / (Z[i] - Z[j]), x = X[i] + t * (X[j] - X[i]), y = Y[i] + t * (Y[j] - Y[i]), l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    for (let k = 0; k < n; k++) {
      const i = (s + k) % n, j = (i + 1) % n, vi = Z[i] >= 0, vj = Z[j] >= 0;
      if (vi) put(X[i], Y[i]);
      if (vi && !vj) { const c = cross(i, j); put(c[0], c[1]); ex = c[0]; ey = c[1]; }
      else if (!vi && vj) {
        const c = cross(i, j), a0 = Math.atan2(ey, ex); let d = Math.atan2(c[1], c[0]) - a0; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
        for (let m = 1, st = Math.max(1, Math.ceil(Math.abs(d) / (6 * D2R))); m < st; m++) put(Math.cos(a0 + (d * m) / st), Math.sin(a0 + (d * m) / st));
        put(c[0], c[1]);
      }
    }
    path.closePath(); return true;
  }

  function lines(v) { // faint latitude/longitude grid
    ctx.beginPath();
    const seg = (lat, lon) => { const p = toVec(lat, lon), r = rot(p[0], p[1], p[2], v); return r; };
    for (let lo = -180; lo < 180; lo += 30) { let pen = false; for (let la = -90; la <= 90; la += 4) { const r = seg(la, lo); if (r[2] >= 0) { const px = cx + R * r[0], py = cy - R * r[1]; pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py); pen = true; } else pen = false; } }
    for (let la = -60; la <= 60; la += 30) { let pen = false; for (let lo = -180; lo <= 180; lo += 4) { const r = seg(la, lo); if (r[2] >= 0) { const px = cx + R * r[0], py = cy - R * r[1]; pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py); pen = true; } else pen = false; } }
    ctx.strokeStyle = "rgba(186,230,253,0.10)"; ctx.lineWidth = 0.7; ctx.stroke();
  }

  function pinPos(p, v, k = 1) { const q = toVec(p.lat, p.lon), r = rot(q[0], q[1], q[2], v); return { x: cx + R * k * r[0], y: cy - R * k * r[1], z: r[2] }; }

  function draw(t) {
    const v = view(); ctx.clearRect(0, 0, w, h);
    // atmosphere glow
    let g = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.22); g.addColorStop(0, "rgba(56,189,248,0.38)"); g.addColorStop(0.5, "rgba(37,99,235,0.14)"); g.addColorStop(1, "rgba(37,99,235,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, TAU); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    // ocean
    g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05); g.addColorStop(0, "#2a78c4"); g.addColorStop(0.55, "#12427e"); g.addColorStop(1, "#061a3d");
    ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    lines(v);
    if (W) {
      const shown = [];
      for (let k = 0; k < W.list.length; k++) { const c = W.list[k], path = new Path2D(); let any = false; for (const rings of c.polys) for (const r of rings) if (addRing(path, r.xyz, v)) any = true; if (any) shown.push({ c, path, hi: hiSet.has(k) }); }
      for (const s of shown) { ctx.fillStyle = s.c.side; ctx.fill(s.path, "evenodd"); } // the dark layer is the country's side wall...
      const lift = 1.022; ctx.save(); ctx.translate(cx, cy); ctx.scale(lift, lift); ctx.translate(-cx, -cy); // ...and the top layer is lifted straight away from the centre, which gives the raised, 3D look
      for (const s of shown) { ctx.fillStyle = s.hi ? s.c.hi : s.c.base; ctx.fill(s.path, "evenodd"); ctx.strokeStyle = s.hi ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.32)"; ctx.lineWidth = s.hi ? 1.6 : 0.6; ctx.stroke(s.path); }
      if (hover && hover.k >= 0) { const c = W.list[hover.k], path = new Path2D(); for (const rings of c.polys) for (const r of rings) addRing(path, r.xyz, v); ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fill(path, "evenodd"); }
      ctx.restore();
    }
    // light and shade: bright upper-left, dark toward the far edge, plus a soft highlight
    g = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.05, cx - R * 0.1, cy - R * 0.1, R * 1.18); g.addColorStop(0, "rgba(255,255,255,0.20)"); g.addColorStop(0.35, "rgba(255,255,255,0)"); g.addColorStop(0.7, "rgba(2,8,28,0.28)"); g.addColorStop(1, "rgba(1,4,16,0.78)");
    ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.strokeStyle = "rgba(125,211,252,0.55)"; ctx.lineWidth = 1.2; ctx.stroke();
    // pins: a pole standing on the surface, a pulsing ring at its foot and a glowing head
    const phase = reduce ? 0.3 : (t % 2000) / 2000, vis = [];
    for (const p of pins) {
      const b = pinPos(p, v), up = pinPos(p, v, 1.13); if (b.z < 0.02) continue; vis.push({ p, b, up });
      const col = p.cur ? "#fbbf24" : "#22d3ee", ang = Math.atan2(b.y - cy, b.x - cx), rr = 5 + 13 * phase;
      ctx.beginPath(); ctx.ellipse(b.x, b.y, rr * Math.max(0.25, b.z), rr, ang, 0, TAU); ctx.strokeStyle = col; ctx.globalAlpha = 1 - phase; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      const lg = ctx.createLinearGradient(b.x, b.y, up.x, up.y); lg.addColorStop(0, col); lg.addColorStop(1, "rgba(255,255,255,0.9)"); ctx.strokeStyle = lg; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(up.x, up.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, 2.2, 0, TAU); ctx.fillStyle = col; ctx.fill();
      const hg = ctx.createRadialGradient(up.x, up.y, 0, up.x, up.y, 9); hg.addColorStop(0, "#fff"); hg.addColorStop(0.35, col); hg.addColorStop(1, "rgba(34,211,238,0)"); ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(up.x, up.y, 9, 0, TAU); ctx.fill();
    }
    ctx.font = "600 10px 'JetBrains Mono', monospace"; ctx.textBaseline = "middle";
    for (const { p, up } of vis) { if (!p.label) continue; const tw = ctx.measureText(p.label).width, left = up.x + 12 + tw + 10 > w, x0 = left ? up.x - 12 - tw - 10 : up.x + 12; ctx.fillStyle = "rgba(4,8,23,0.85)"; ctx.fillRect(x0, up.y - 9, tw + 10, 18); ctx.fillStyle = p.cur ? "#fcd34d" : "#a5f3fc"; ctx.fillText(p.label, x0 + 5, up.y); }
    canvas._vis = vis;
  }

  function frame(now) {
    raf = 0; if (!run) return;
    const dt = Math.min(0.05, (now - (prev || now)) / 1000); prev = now;
    if (!drag) {
      lon0 += vLon; lat0 = clampLat(lat0 + vLat); vLon *= 0.94; vLat *= 0.94;
      if (Math.abs(vLon) < 0.002) vLon = 0; if (Math.abs(vLat) < 0.002) vLat = 0;
      if (!reduce && !hover && now - lastTouch > 3500) lon0 += 7 * dt; // slow spin when nobody is touching it
    }
    lon0 = ((lon0 + 540) % 360) - 180; draw(now); raf = requestAnimationFrame(frame);
  }
  const start = () => { if (!run) { run = true; prev = 0; raf = requestAnimationFrame(frame); } };
  const stop = () => { run = false; if (raf) cancelAnimationFrame(raf); raf = 0; };

  // pointer: drag to rotate, hover for the country name or the session
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function pick(px, py) {
    const v = view(); for (const q of canvas._vis || []) if (Math.hypot(px - q.up.x, py - q.up.y) < 12 || Math.hypot(px - q.b.x, py - q.b.y) < 8) return { pin: q.p, x: q.up.x, y: q.up.y };
    const x = (px - cx) / R, y = (cy - py) / R, d = x * x + y * y; if (d > 1 || !W) return null;
    const z = Math.sqrt(1 - d), Y = y * v.cp + z * v.sp, z1 = -y * v.sp + z * v.cp, Xw = x * v.cl + z1 * v.sl, Zw = -x * v.sl + z1 * v.cl, lat = Math.asin(Math.max(-1, Math.min(1, Y))) / D2R, lon = Math.atan2(Xw, Zw) / D2R, k = countryAt(W, lon, lat);
    return k >= 0 ? { k, x: px, y: py, name: W.list[k].name } : null;
  }
  canvas.addEventListener("pointerdown", (e) => { const [x, y] = pos(e); drag = { x, y, moved: 0 }; lastTouch = performance.now(); vLon = vLat = 0; canvas.setPointerCapture(e.pointerId); canvas.classList.add("vx-grab"); tip.classList.add("hidden"); });
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = pos(e);
    if (drag) { const dx = x - drag.x, dy = y - drag.y; drag.x = x; drag.y = y; drag.moved += Math.abs(dx) + Math.abs(dy); const k = 90 / R; lon0 -= dx * k; lat0 = clampLat(lat0 + dy * k); vLon = -dx * k * 0.5; vLat = dy * k * 0.5; lastTouch = performance.now(); return; }
    const hit = pick(x, y); hover = hit && hit.k !== undefined ? hit : null;
    if (!hit) { tip.classList.add("hidden"); return; }
    tip.textContent = hit.pin ? hit.pin.title || hit.pin.label || "" : hit.name; tip.classList.remove("hidden"); tip.style.left = Math.min(w - 8, Math.max(8, hit.x)) + "px"; tip.style.top = Math.max(14, hit.y - 14) + "px";
  });
  const endDrag = () => { drag = null; lastTouch = performance.now(); canvas.classList.remove("vx-grab"); };
  canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => { hover = null; tip.classList.add("hidden"); });

  const ro = new ResizeObserver(() => { resize(); if (!run) draw(performance.now()); }); ro.observe(host); resize();
  const io = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting && !document.hidden ? start() : stop(); }); io.observe(host); // no drawing while the Overview page is not on screen
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else if (host.offsetParent) start(); });

  return {
    setPins(list) { pins = list.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)); markCountries(); const c = pins.find((p) => p.cur) || pins[0]; if (c && !opt.keepView && !this._centred) { lon0 = c.lon; lat0 = clampLat(c.lat * 0.8); lastTouch = performance.now(); this._centred = true; } },
    focus(lat, lon) { lon0 = lon; lat0 = clampLat(lat); vLon = vLat = 0; lastTouch = performance.now(); if (!run) draw(performance.now()); }, // turns the globe so this point faces the viewer
    destroy() { stop(); ro.disconnect(); io.disconnect(); canvas.remove(); tip.remove(); },
  };
}
