/* Kingdoms – Kartenzeichner.
   Gelände wird einmal pro Karte auf ein Canvas gemalt (Meerestiefe, Küsten, Höhenschattierung, Flüsse, Wälder, Gebirge),
   Provinzgrenzen werden als weiche SVG-Pfade aus dem feinen Sechseckraster abgeleitet. */
(function (global) {
  'use strict';

  function vhash(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Ecke k eines Sechsecks (Spitze oben). Kante k verbindet Ecke k und k+1 und grenzt an Nachbar k (O, SO, SW, W, NW, NO).
  // Gemeinsame Ecken bekommen denselben Versatz → natürlich wirkende, aber lückenlose Grenzen.
  function corner(geo, x, y, k) {
    const a = Math.PI / 180 * (60 * k - 30);
    const cx = x + geo.s * Math.cos(a), cy = y + geo.s * Math.sin(a);
    const kx = Math.round(cx * 4), ky = Math.round(cy * 4);
    const j = geo.s * 0.45;
    return [cx + (vhash(kx, ky, geo.seed) - 0.5) * j, cy + (vhash(ky, kx, geo.seed + 7) - 0.5) * j, kx + ',' + ky];
  }

  function traceLoops(geo, hexes, inside) {
    const edges = new Map();
    for (const i of hexes) {
      const [x, y] = K.hexXY(geo, i);
      for (let k = 0; k < 6; k++) {
        const j = K.hexNeighbor(geo, i, k);
        if (j >= 0 && inside(j)) continue;
        const a = corner(geo, x, y, k), b = corner(geo, x, y, (k + 1) % 6);
        if (!edges.has(a[2])) edges.set(a[2], []);
        edges.get(a[2]).push({ a, b, used: false });
      }
    }
    const out = [];
    for (const list of edges.values()) for (const e of list) {
      if (e.used) continue;
      const loop = [];
      let cur = e;
      while (cur && !cur.used) {
        cur.used = true;
        loop.push([cur.a[0], cur.a[1]]);
        const nl = edges.get(cur.b[2]);
        cur = nl && nl.find(x => !x.used);
      }
      if (loop.length > 2) out.push(loop);
    }
    return out;
  }

  function chaikin(pts, iter, closed = true) {
    for (let it = 0; it < iter; it++) {
      const o = [], n = pts.length;
      if (!closed) o.push(pts[0]);
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        o.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
      }
      if (!closed) o.push(pts[n - 1]);
      pts = o;
    }
    return pts;
  }

  const pathD = loops => loops.map(l => 'M' + l.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z').join('');

  const cache = new Map();
  function outlines(geo) {
    const key = geo.seed + geo.type + geo.cols + geo.prov.length;
    if (cache.has(key)) return cache.get(key);
    const land = [], byProv = new Map();
    for (let i = 0; i < geo.terr.length; i++) {
      if (geo.terr[i] !== '.') land.push(i);
      const p = geo.prov[i];
      if (p >= 0) { if (!byProv.has(p)) byProv.set(p, []); byProv.get(p).push(i); }
    }
    const coastLoops = traceLoops(geo, land, j => geo.terr[j] !== '.').map(l => chaikin(l, 2));
    const prov = [];
    for (const [p, hexes] of byProv) prov[p] = pathD(traceLoops(geo, hexes, j => geo.prov[j] === p).map(l => chaikin(l, 2)));
    const res = { coast: pathD(coastLoops), prov };
    if (cache.size > 6) cache.clear();
    cache.set(key, res);
    return res;
  }

  // ---------- Gelände malen ----------

  const COL = { p: [140, 178, 88], f: [74, 120, 56], m: [148, 138, 118], d: [224, 197, 132], x: [118, 112, 102], s: [226, 233, 240] };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function hexPath(g, x, y, r) {
    g.moveTo(x + r * 0.866, y - r * 0.5);
    g.lineTo(x + r * 0.866, y + r * 0.5); g.lineTo(x, y + r);
    g.lineTo(x - r * 0.866, y + r * 0.5); g.lineTo(x - r * 0.866, y - r * 0.5); g.lineTo(x, y - r);
    g.closePath();
  }

  function terrain(geo, scale) {
    const W = Math.ceil(geo.W * scale), H = Math.ceil(geo.H * scale), s = geo.s;
    const N = geo.terr.length;
    const rng = mulberry32((geo.seed ^ 0x9e3779b9) >>> 0);
    const T = i => geo.terr[i], E = i => +geo.elev[i];
    const cv = mk(W, H), g = cv.getContext('2d');
    const layer = () => { const c = mk(W, H), x = c.getContext('2d'); x.setTransform(scale, 0, 0, scale, 0, 0); return [c, x]; };
    const blit = (c, blur, alpha = 1) => {
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      if (blur) g.filter = `blur(${blur * scale}px)`;
      g.globalAlpha = alpha;
      g.drawImage(c, 0, 0); g.restore();
    };
    g.setTransform(scale, 0, 0, scale, 0, 0);
    const coast = new Path2D(outlines(geo).coast);

    // Meer mit Tiefe: flach (türkis) an der Küste, tiefblau draußen
    const gr = g.createRadialGradient(geo.W / 2, geo.H / 2, geo.H * 0.1, geo.W / 2, geo.H / 2, geo.W * 0.75);
    gr.addColorStop(0, '#24688c'); gr.addColorStop(1, '#0f3049');
    g.fillStyle = gr; g.fillRect(0, 0, geo.W, geo.H);
    const dist = new Int16Array(N).fill(99), q = [];
    for (let i = 0; i < N; i++) if (T(i) !== '.') { dist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) for (let k = 0; k < 6; k++) {
      const j = K.hexNeighbor(geo, q[h], k);
      if (j >= 0 && dist[j] > dist[q[h]] + 1) { dist[j] = dist[q[h]] + 1; q.push(j); }
    }
    const [wc, wx] = layer();
    for (let i = 0; i < N; i++) {
      if (T(i) !== '.' || dist[i] > 5) continue;
      const [x, y] = K.hexXY(geo, i), a = [0, 0.75, 0.5, 0.3, 0.16, 0.07][dist[i]];
      wx.fillStyle = `rgba(86,176,190,${a})`;
      wx.beginPath(); hexPath(wx, x, y, s * 1.2); wx.fill();
    }
    blit(wc, s * 0.9);
    // Wellenkräusel
    g.save(); g.globalAlpha = 0.07; g.strokeStyle = '#fff'; g.lineWidth = 0.6;
    for (let k = 0; k < (geo.W * geo.H) / 260; k++) {
      const x = rng() * geo.W, y = rng() * geo.H, w = 3 + rng() * 5;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 1.2, x + w, y); g.stroke();
    }
    g.restore();

    // Land: Farbe je Gelände, Hangschattierung (Licht von Nordwesten), weich überblendet
    const [lc, lx] = layer();
    for (let i = 0; i < N; i++) {
      const t = T(i);
      if (t === '.') continue;
      const [x, y] = K.hexXY(geo, i);
      const nw = K.hexNeighbor(geo, i, 4), se = K.hexNeighbor(geo, i, 1);
      const eNW = nw >= 0 && T(nw) !== '.' ? E(nw) : E(i) - 1, eSE = se >= 0 && T(se) !== '.' ? E(se) : E(i) - 1;
      const shade = (eSE - eNW) * 0.045 + (vhash(i, 3, geo.seed) - 0.5) * 0.1 + (E(i) - 4) * 0.015;
      const c = COL[t].map(v => Math.max(0, Math.min(255, Math.round(v * (1 + shade)))));
      lx.fillStyle = `rgb(${c})`;
      lx.beginPath(); hexPath(lx, x, y, s * (dist[i] === 0 && hasWaterNb(geo, i) ? 1.7 : 1.2)); lx.fill();
    }
    g.save(); g.clip(coast); blit(lc, s * 0.32); g.restore();

    // Relief: Höhenkarte weich zeichnen und von Nordwesten beleuchten (Hangschattierung)
    {
      const hs = 0.5, RW = Math.ceil(W * hs), RH = Math.ceil(H * hs);
      const ec = mk(RW, RH), ex = ec.getContext('2d');
      ex.setTransform(scale * hs, 0, 0, scale * hs, 0, 0);
      ex.fillStyle = '#000'; ex.fillRect(0, 0, geo.W, geo.H);
      for (let i = 0; i < N; i++) {
        const t = T(i);
        if (t === '.') continue;
        const v = Math.min(255, Math.round((E(i) + (t === 'x' ? 4 : t === 'm' ? 1.5 : 0)) / 14 * 255) + 18);
        const [x, y] = K.hexXY(geo, i);
        ex.fillStyle = `rgb(${v},${v},${v})`;
        ex.beginPath(); hexPath(ex, x, y, s * 1.15); ex.fill();
      }
      const bc = mk(RW, RH), bx = bc.getContext('2d');
      bx.filter = `blur(${s * scale * hs * 0.8}px)`; bx.drawImage(ec, 0, 0); bx.filter = 'none';
      const src = bx.getImageData(0, 0, RW, RH).data, out = bx.createImageData(RW, RH), od = out.data;
      const k = 3.2 / (s * scale * hs);
      for (let yy = 1; yy < RH - 1; yy++) for (let xx = 1; xx < RW - 1; xx++) {
        const o = (yy * RW + xx) * 4;
        const dx = src[o + 4] - src[o - 4], dy = src[o + RW * 4] - src[o - RW * 4];
        const sh = Math.max(-1, Math.min(1, (dx + dy) * k * 0.1));
        if (sh > 0) { od[o] = od[o + 1] = od[o + 2] = 255; od[o + 3] = sh * 120; }
        else { od[o] = 30; od[o + 1] = 22; od[o + 2] = 10; od[o + 3] = -sh * 170; }
      }
      bx.putImageData(out, 0, 0);
      g.save(); g.clip(coast); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(bc, 0, 0, W, H); g.restore();
    }

    // Körnung für eine natürliche Oberfläche
    const nz = mk(128, 128), nx = nz.getContext('2d'), id = nx.createImageData(128, 128);
    for (let k = 0; k < id.data.length; k += 4) { const v = 100 + rng() * 60; id.data[k] = id.data[k + 1] = id.data[k + 2] = v; id.data[k + 3] = 255; }
    nx.putImageData(id, 0, 0);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.22;
    g.fillStyle = g.createPattern(nz, 'repeat'); g.fillRect(0, 0, W, H); g.restore();

    // Strand, Brandung, Küstenlinie
    g.save(); g.clip(coast); g.strokeStyle = 'rgba(236,220,160,.85)'; g.lineWidth = s * 0.45; g.stroke(coast); g.restore();
    g.save();
    const outside = new Path2D(); outside.rect(-10, -10, geo.W + 20, geo.H + 20); outside.addPath(coast);
    g.clip(outside, 'evenodd');
    g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = s * 0.9; g.stroke(coast);
    g.strokeStyle = 'rgba(255,255,255,.32)'; g.lineWidth = s * 0.25; g.stroke(coast);
    g.restore();
    g.strokeStyle = 'rgba(70,55,30,.55)'; g.lineWidth = s * 0.08; g.stroke(coast);

    // Flüsse: werden zur Mündung hin breiter
    for (const r of geo.rivers || []) {
      const pts = r.map(i => K.hexXY(geo, i));
      const last = pts.length - 1;
      pts[last] = [(pts[last][0] + pts[last - 1][0]) / 2, (pts[last][1] + pts[last - 1][1]) / 2];
      const sm = chaikin(pts, 3, false);
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const [col, extra] of [['rgba(40,90,120,.7)', s * 0.12], ['#62b2d8', 0]]) {
        g.strokeStyle = col;
        for (let k = 1; k < sm.length; k++) {
          g.lineWidth = s * (0.08 + 0.26 * k / sm.length) + extra;
          g.beginPath(); g.moveTo(sm[k - 1][0], sm[k - 1][1]); g.lineTo(sm[k][0], sm[k][1]); g.stroke();
        }
      }
    }

    // Straßen zwischen benachbarten Provinzen (Feldwege)
    if (geo.adj && geo.labels) {
      g.lineCap = 'round';
      // natürliches Wegenetz: kürzeste Verbindungen (Spannbaum) plus ein paar Querwege
      const L = ([a, b]) => Math.hypot(geo.labels[a][0] - geo.labels[b][0], geo.labels[a][1] - geo.labels[b][1]);
      const parent = geo.labels.map((_, i) => i);
      const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      const roads = [];
      for (const e of geo.adj.slice().sort((x, y) => L(x) - L(y))) {
        const ra = find(e[0]), rb = find(e[1]);
        if (ra !== rb) { parent[ra] = rb; roads.push(e); } else if (vhash(e[0], e[1], geo.seed + 3) < 0.18) roads.push(e);
      }
      for (const [a, b] of roads) {
        const [x1, y1] = geo.labels[a], [x2, y2] = geo.labels[b];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len > s * 14) continue;
        const bend = (vhash(a, b, geo.seed) - 0.5) * 0.35;
        const mx = (x1 + x2) / 2 - (y2 - y1) * bend, my = (y1 + y2) / 2 + (x2 - x1) * bend;
        for (const [col, w] of [['rgba(70,50,25,.28)', s * 0.18], ['rgba(190,160,105,.6)', s * 0.08]]) {
          g.strokeStyle = col; g.lineWidth = w;
          g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
        }
      }
    }

    // Dekoration: Bäume, Berge, Dünen, Gras, Siedlungen – von hinten nach vorne gezeichnet
    const deco = [];
    (geo.labels || []).forEach(([lx, ly], k) => {
      const n = 5 + Math.floor(vhash(k, 1, geo.seed) * 4);
      for (let h = 0; h < n; h++) {
        const ang = vhash(k, 10 + h, geo.seed) * Math.PI * 2, rad = s * (0.5 + vhash(k, 30 + h, geo.seed) * 1.1);
        deco.push({ t: 'house', x: lx + Math.cos(ang) * rad * 1.3, y: ly + Math.sin(ang) * rad, z: vhash(k, 50 + h, geo.seed) });
      }
    });
    for (let i = 0; i < N; i++) {
      const t = T(i);
      if (t === '.') continue;
      const [x, y] = K.hexXY(geo, i);
      const r = k => vhash(i, k, geo.seed);
      if (t === 'f') {
        const n = 4 + Math.floor(r(1) * 3);
        for (let k = 0; k < n; k++) deco.push({ t: 'tree', x: x + (r(10 + k) - 0.5) * s * 1.5, y: y + (r(20 + k) - 0.5) * s * 1.4, z: r(30 + k) });
      } else if (t === 'm') deco.push({ t: 'mtn', x: x + (r(1) - 0.5) * s * 0.5, y: y + (r(2) - 0.5) * s * 0.4, z: 0.85 + r(3) * 0.35, snow: E(i) >= 7 });
      else if (t === 'x') {
        deco.push({ t: 'mtn', x: x - s * 0.35, y: y + s * 0.1, z: 1.45, snow: true });
        deco.push({ t: 'mtn', x: x + s * 0.45, y: y + s * 0.35, z: 1.15, snow: true });
      } else if (t === 'd') {
        if (r(1) < 0.7) deco.push({ t: 'dune', x: x + (r(2) - 0.5) * s, y: y + (r(3) - 0.5) * s, z: r(4) });
        if (r(5) < 0.12) deco.push({ t: 'rock', x: x + (r(6) - 0.5) * s, y: y + (r(7) - 0.5) * s, z: r(8) });
      } else if (t === 's') {
        if (r(1) < 0.38) { const n = 1 + Math.floor(r(2) * 3); for (let k = 0; k < n; k++) deco.push({ t: 'pine', x: x + (r(10 + k) - 0.5) * s * 1.4, y: y + (r(20 + k) - 0.5) * s * 1.3, z: r(30 + k) }); }
        else if (r(3) < 0.45) deco.push({ t: 'drift', x: x + (r(4) - 0.5) * s, y: y + (r(5) - 0.5) * s, z: r(6) });
      } else if (t === 'p') {
        if (r(1) < 0.5) deco.push({ t: 'grass', x: x + (r(2) - 0.5) * s * 1.2, y: y + (r(3) - 0.5) * s * 1.2, z: r(4) });
        if (r(5) < 0.08) deco.push({ t: 'field', x: x + (r(6) - 0.5) * s * 0.6, y: y + (r(7) - 0.5) * s * 0.6, z: r(8) });
      }
    }
    deco.sort((a, b) => a.y - b.y);
    const TREE = ['#2d5b28', '#36692e', '#2a5124', '#3f7434'];
    for (const d of deco) {
      if (d.t === 'tree') {
        const rr = s * (0.2 + d.z * 0.1);
        g.fillStyle = 'rgba(20,30,10,.28)';
        g.beginPath(); g.ellipse(d.x + rr * 0.4, d.y + rr * 0.6, rr, rr * 0.6, 0, 0, 7); g.fill();
        g.fillStyle = TREE[Math.floor(d.z * 4)];
        g.beginPath(); g.arc(d.x, d.y, rr, 0, 7); g.fill();
        g.fillStyle = 'rgba(140,190,90,.35)';
        g.beginPath(); g.arc(d.x - rr * 0.3, d.y - rr * 0.35, rr * 0.5, 0, 7); g.fill();
      } else if (d.t === 'mtn') {
        const w = s * 0.95 * d.z, h = s * 0.85 * d.z, x = d.x, y = d.y + h * 0.4;
        g.fillStyle = 'rgba(30,25,15,.25)';
        g.beginPath(); g.moveTo(x - w * 0.1, y); g.lineTo(x + w * 1.1, y); g.lineTo(x + w * 0.35, y - h * 0.5); g.fill();
        g.fillStyle = '#a89d88';
        g.beginPath(); g.moveTo(x - w, y); g.lineTo(x, y - h); g.lineTo(x + w * 0.15, y); g.fill();
        g.fillStyle = '#76695a';
        g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + w, y); g.lineTo(x + w * 0.1, y); g.fill();
        if (d.snow) {
          g.fillStyle = '#f3f0e8';
          g.beginPath(); g.moveTo(x - w * 0.32, y - h * 0.68); g.lineTo(x, y - h); g.lineTo(x + w * 0.3, y - h * 0.7);
          g.lineTo(x + w * 0.1, y - h * 0.6); g.lineTo(x - w * 0.08, y - h * 0.72); g.fill();
        }
      } else if (d.t === 'house') {
        const w = s * (0.22 + d.z * 0.1), h = w * 0.75;
        g.fillStyle = 'rgba(20,15,5,.3)'; g.fillRect(d.x - w / 2 + w * 0.25, d.y - h / 2 + h * 0.35, w, h);
        g.fillStyle = d.z > 0.5 ? '#e4d6b8' : '#d2c19c'; g.fillRect(d.x - w / 2, d.y - h / 2, w, h);
        g.fillStyle = d.z > 0.7 ? '#7a5a40' : '#a34a30';
        g.beginPath(); g.moveTo(d.x - w * 0.62, d.y - h / 2 + 0.2); g.lineTo(d.x, d.y - h * 1.15); g.lineTo(d.x + w * 0.62, d.y - h / 2 + 0.2); g.fill();
      } else if (d.t === 'pine') {
        const w = s * (0.22 + d.z * 0.08), h = w * 2.2;
        g.fillStyle = 'rgba(40,60,80,.22)';
        g.beginPath(); g.ellipse(d.x + w * 0.4, d.y + w * 0.2, w * 0.9, w * 0.4, 0, 0, 7); g.fill();
        g.fillStyle = '#2f5a45';
        g.beginPath(); g.moveTo(d.x - w, d.y); g.lineTo(d.x, d.y - h); g.lineTo(d.x + w, d.y); g.fill();
        g.fillStyle = '#f4f7fb';
        g.beginPath(); g.moveTo(d.x - w * 0.45, d.y - h * 0.55); g.lineTo(d.x, d.y - h); g.lineTo(d.x + w * 0.45, d.y - h * 0.55);
        g.lineTo(d.x + w * 0.15, d.y - h * 0.62); g.lineTo(d.x - w * 0.2, d.y - h * 0.58); g.fill();
      } else if (d.t === 'drift') {
        g.fillStyle = 'rgba(150,175,200,.35)';
        g.beginPath(); g.ellipse(d.x + s * 0.05, d.y + s * 0.05, s * 0.32, s * 0.1, 0, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.beginPath(); g.ellipse(d.x, d.y, s * 0.3, s * 0.09, 0, 0, 7); g.fill();
      } else if (d.t === 'dune') {
        g.strokeStyle = 'rgba(170,130,60,.55)'; g.lineWidth = s * 0.07;
        g.beginPath(); g.moveTo(d.x - s * 0.4, d.y); g.quadraticCurveTo(d.x, d.y - s * 0.28, d.x + s * 0.4, d.y); g.stroke();
      } else if (d.t === 'rock') {
        g.fillStyle = '#9c8466'; g.beginPath(); g.ellipse(d.x, d.y, s * 0.14, s * 0.09, 0, 0, 7); g.fill();
      } else if (d.t === 'grass') {
        g.strokeStyle = 'rgba(80,120,45,.6)'; g.lineWidth = s * 0.05;
        g.beginPath();
        for (let k = -1; k <= 1; k++) { g.moveTo(d.x + k * s * 0.08, d.y); g.lineTo(d.x + k * s * 0.12, d.y - s * 0.18); }
        g.stroke();
      } else if (d.t === 'field') {
        g.save(); g.translate(d.x, d.y); g.rotate((d.z - 0.5) * 1.2);
        g.fillStyle = 'rgba(214,190,100,.75)'; g.fillRect(-s * 0.4, -s * 0.25, s * 0.8, s * 0.5);
        g.strokeStyle = 'rgba(150,120,50,.6)'; g.lineWidth = s * 0.04;
        for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(-s * 0.4, k * s * 0.1); g.lineTo(s * 0.4, k * s * 0.1); g.stroke(); }
        g.restore();
      }
    }

    // Vignette
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,10,20,.45)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H); g.restore();
    return cv;
  }

  function hasWaterNb(geo, i) {
    for (let k = 0; k < 6; k++) { const j = K.hexNeighbor(geo, i, k); if (j < 0 || geo.terr[j] === '.') return true; }
    return false;
  }

  // Kleine Vorschau für Menüs: Gelände + Provinzgrenzen
  function preview(geo, width) {
    const scale = width / geo.W;
    const cv = terrain(geo, scale), g = cv.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.strokeStyle = 'rgba(40,28,12,.55)'; g.lineWidth = 1.2 / scale; g.lineJoin = 'round';
    for (const d of outlines(geo).prov) if (d) g.stroke(new Path2D(d));
    return cv;
  }

  const toURL = cv => new Promise(res => cv.toBlob(b => res(URL.createObjectURL(b)), 'image/jpeg', 0.9));

  // Reichsgrenzen: Umriss aller Provinzen eines Herrschers (wie die dicken Landesgrenzen bei Hearts of Iron)
  const nationCache = new Map();
  function nations(geo, owners) {
    const key = geo.seed + ':' + owners.join(',');
    if (nationCache.has(key)) return nationCache.get(key);
    const by = new Map();
    for (let i = 0; i < geo.prov.length; i++) {
      const p = geo.prov[i];
      if (p < 0 || owners[p] < 0) continue;
      const o = owners[p];
      if (!by.has(o)) by.set(o, []);
      by.get(o).push(i);
    }
    const res = {};
    for (const [o, hexes] of by) res[o] = pathD(traceLoops(geo, hexes, j => geo.prov[j] >= 0 && owners[geo.prov[j]] === o).map(l => chaikin(l, 2)));
    if (nationCache.size > 20) nationCache.clear();
    nationCache.set(key, res);
    return res;
  }

  global.MapView = { outlines, terrain, preview, toURL, nations };
})(typeof window !== 'undefined' ? window : globalThis);
