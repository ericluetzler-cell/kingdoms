/* Kingdoms – Weltgenerator, Spielregeln und KI-Gegner.
   Der Spielzustand ist reines JSON, damit er übers Netzwerk geschickt werden kann. */
(function (global) {
  'use strict';

  // 12 Reichsfarben zur Auswahl (die ersten sechs sind die Standardfarben)
  const COLORS = ['#e5484d', '#3e8ef7', '#30a46c', '#f5a524', '#9b5de5', '#12a6b5', '#e93d82', '#8ac926', '#a0703c', '#3d4fb5', '#e8e2d0', '#3a3a3a'];
  const MAX_ROUNDS = 40;
  const ATTACK_LIMIT = { easy: 4, medium: 14, hard: 30 };
  const SQ3 = Math.sqrt(3);
  const HEX_S = 10;

  // Reihenfolge = wer bei Verlusten zuerst fällt (billigste zuerst)
  const TYPES = ['w', 'a', 'p', 'k', 'c'];
  const UNITS = {
    w: { name: 'Krieger', plural: 'Krieger', cost: 2, atk: 1, def: 1, mp: 1, tech: null },
    a: { name: 'Bogenschütze', plural: 'Bogenschützen', cost: 3, atk: 1, def: 3, mp: 1, tech: 'archery' },
    p: { name: 'Speerkämpfer', plural: 'Speerkämpfer', cost: 4, atk: 2, def: 2, mp: 1, tech: 'bronze', note: '+2 Verteidigung gegen Ritter' },
    k: { name: 'Ritter', plural: 'Ritter', cost: 5, atk: 4, def: 2, mp: 2, tech: 'riding', note: 'bewegt sich 2 Provinzen weit' },
    c: { name: 'Katapult', plural: 'Katapulte', cost: 6, atk: 6, def: 1, mp: 1, tech: 'math', note: 'ignoriert Festungen und Hauptstädte' },
  };
  const TERRAIN = {
    plain: { name: 'Ebene', def: 0, gold: 1 },
    forest: { name: 'Wald', def: 0.25, gold: 1 },
    mountain: { name: 'Gebirge', def: 0.5, gold: 1 },
    desert: { name: 'Wüste', def: 0, gold: 0 },
  };
  const PSIZE = {
    S: { name: 'Klein', def: 0, gold: 0 },
    M: { name: 'Mittel', def: 0.25, gold: 1 },
    L: { name: 'Groß', def: 0.5, gold: 2 },
  };
  const ANY = ['plain', 'forest', 'mountain', 'desert'];
  const BUILDINGS = {
    lumber: { name: 'Holzfäller', cost: 3, on: ['forest'], tech: null, gold: 1, sci: 1, desc: '+1 Gold, +1 Wissen' },
    farm: { name: 'Bauernhof', cost: 4, on: ['plain'], tech: 'agri', gold: 2, desc: '+2 Gold' },
    mine: { name: 'Mine', cost: 5, on: ['mountain'], tech: 'mining', gold: 3, desc: '+3 Gold' },
    library: { name: 'Bibliothek', cost: 5, on: ANY, tech: 'writing', sci: 2, desc: '+2 Wissen' },
    caravan: { name: 'Karawanserei', cost: 5, on: ['desert'], tech: 'trade', gold: 3, desc: '+3 Gold' },
    fort: { name: 'Festung', cost: 8, on: ANY, tech: 'masonry', desc: '+50 % Verteidigung, hier ausbilden' },
  };
  const TECHS = {
    agri: { name: 'Landwirtschaft', tier: 1, cost: 4, req: null, desc: 'Bauernhof bauen (+2 Gold auf Ebenen)' },
    mining: { name: 'Bergbau', tier: 1, cost: 4, req: null, desc: 'Mine bauen (+3 Gold im Gebirge)' },
    writing: { name: 'Schrift', tier: 1, cost: 4, req: null, desc: 'Bibliothek bauen (+2 Wissen)' },
    archery: { name: 'Bogenbau', tier: 1, cost: 4, req: null, desc: 'Bogenschützen ausbilden (Verteidigung 3)' },
    masonry: { name: 'Mauerwerk', tier: 1, cost: 5, req: null, desc: 'Festung bauen: +50 % Verteidigung, dort Einheiten ausbilden' },
    riding: { name: 'Reiterei', tier: 2, cost: 9, req: 'agri', desc: 'Ritter ausbilden (Angriff 4)' },
    bronze: { name: 'Bronzeguss', tier: 2, cost: 9, req: 'mining', desc: 'Speerkämpfer ausbilden (stark gegen Ritter)' },
    math: { name: 'Mathematik', tier: 2, cost: 9, req: 'writing', desc: 'Katapulte ausbilden (Angriff 6, knacken Festungen)' },
    trade: { name: 'Handel', tier: 2, cost: 9, req: 'agri', desc: 'Karawanserei in der Wüste (+3 Gold), Bauernhöfe +1 Gold' },
    roads: { name: 'Straßen', tier: 2, cost: 8, req: 'masonry', desc: 'Alle Truppen bewegen sich 1 Provinz weiter' },
    steel: { name: 'Stahl', tier: 3, cost: 15, req: 'bronze', desc: 'Alle Einheiten +1 Angriff' },
    tactics: { name: 'Taktik', tier: 3, cost: 15, req: 'archery', desc: 'Alle Einheiten +1 Verteidigung' },
    university: { name: 'Universität', tier: 3, cost: 14, req: 'math', desc: 'Bibliotheken +2 Wissen' },
    banking: { name: 'Bankwesen', tier: 3, cost: 14, req: 'trade', desc: 'Jedes Gebäude +1 Gold' },
  };
  const MAPS = {
    continent: { name: 'Kontinent', icon: '🌍', desc: 'Ein großer Kontinent mit Flüssen, Wäldern und Gebirgen.' },
    islands: { name: 'Inselreich', icon: '🏝️', desc: 'Viele Inseln, verbunden durch Seewege.' },
    twin: { name: 'Zwei Reiche', icon: '🌗', desc: 'Zwei Kontinente, getrennt durch eine Meerenge.' },
    inland: { name: 'Binnenmeer', icon: '🌊', desc: 'Ein Ring aus Ländern um ein großes Meer.' },
    highlands: { name: 'Hochland', icon: '⛰️', desc: 'Gewaltige Gebirge mit unpassierbaren Gipfeln und engen Pässen.' },
    desert: { name: 'Wüstenreich', icon: '🏜️', desc: 'Karge Wüste – fruchtbare Flusstäler sind heiß umkämpft.' },
  };
  const MAP_KEYS = Object.keys(MAPS);
  const SIZES = { small: { name: 'Klein', dim: [34, 24] }, medium: { name: 'Mittel', dim: [44, 30] }, large: { name: 'Groß', dim: [56, 38] }, huge: { name: 'Riesig', dim: [68, 46] } };
  const MODES = {
    classic: { name: 'Klassisch', icon: '⚔️', desc: 'Vernichte alle Gegner – oder hab nach 40 Runden die meisten Punkte.' },
    throne: { name: 'Thronkampf', icon: '👑', desc: 'Erobere die Thronstadt in der Mitte. Wer sie zu Beginn seines Zuges hält, bekommt eine Krone – 5 Kronen gewinnen.' },
    blitz: { name: 'Blitzkrieg', icon: '⚡', desc: 'Doppeltes Einkommen, nur 20 Runden – schnelle, wilde Partien.' },
  };

  const rnd = n => Math.floor(Math.random() * n);
  const pick = a => a[rnd(a.length)];
  const akey = (a, b) => Math.min(a, b) + '-' + Math.max(a, b);

  const emptyU = () => ({ w: 0, a: 0, p: 0, k: 0, c: 0 });
  const total = u => TYPES.reduce((s, t) => s + (u[t] || 0), 0);
  const addU = (a, b) => { const r = emptyU(); for (const t of TYPES) r[t] = (a[t] || 0) + (b[t] || 0); return r; };
  const costOf = u => TYPES.reduce((s, t) => s + (u[t] || 0) * UNITS[t].cost, 0);
  function removeCheapest(u) {
    for (const t of TYPES) if (u[t] > 0) { u[t]--; return t; }
    return null;
  }
  // Alle Einheiten bis auf die billigste ziehen los
  function army(u) { const a = { ...u }; removeCheapest(a); return a; }

  // ---------- Zufall und Rauschen (mit Seed, damit Vorschau = Spielkarte) ----------

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeNoise(rng) {
    const N = 256, vals = new Float32Array(N * N);
    for (let i = 0; i < vals.length; i++) vals[i] = rng();
    const lat = (x, y) => vals[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
    const sm = t => t * t * (3 - 2 * t);
    const n2 = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), u = sm(x - xi), v = sm(y - yi);
      const a = lat(xi, yi), b = lat(xi + 1, yi), c = lat(xi, yi + 1), d = lat(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    return (x, y, oct = 4) => {
      let s = 0, amp = 1, f = 1, norm = 0;
      for (let o = 0; o < oct; o++) { s += amp * n2(x * f + o * 17.3, y * f + o * 9.1); norm += amp; amp *= 0.5; f *= 2; }
      return s / norm;
    };
  }

  // ---------- Sechseck-Raster (fein, nur für Gelände und Grenzen) ----------

  // Nachbarn in Kantenreihenfolge O, SO, SW, W, NW, NO (versetzte Zeilen, „odd-r“)
  const NB_EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
  const NB_ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];
  function hexNeighbor(geo, i, k) {
    const c = i % geo.cols, r = (i - c) / geo.cols;
    const [dc, dr] = (r & 1 ? NB_ODD : NB_EVEN)[k];
    const nc = c + dc, nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= geo.cols || nr >= geo.rows) return -1;
    return nr * geo.cols + nc;
  }
  function hexXY(geo, i) {
    const c = i % geo.cols, r = (i - c) / geo.cols;
    return [geo.s * SQ3 * (c + 0.5 * (r & 1)) + geo.s * SQ3 / 2, geo.s * 1.5 * r + geo.s];
  }
  function hexDistIdx(geo, a, b) {
    const ax = a % geo.cols, ar = (a - ax) / geo.cols, bx = b % geo.cols, br = (b - bx) / geo.cols;
    const aq = ax - (ar - (ar & 1)) / 2, bq = bx - (br - (br & 1)) / 2;
    return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq + ar - bq - br)) / 2;
  }

  const NAME_A = ['Eichen', 'Raben', 'Wolfs', 'Nord', 'Süd', 'Ost', 'West', 'Gold', 'Silber', 'Stein', 'Eisen', 'Falken', 'Hirsch', 'Drachen',
    'Sturm', 'Nebel', 'Moos', 'Bären', 'Löwen', 'Adler', 'Schwarz', 'Weiß', 'Rot', 'Grün', 'Hohen', 'Tiefen', 'Kalt', 'Sonnen', 'Mond',
    'Stern', 'Kron', 'Greifen', 'Ulmen', 'Birken', 'Fuchs', 'Linden', 'Dorn', 'Rosen', 'Blau', 'Frost', 'Glut', 'Wind', 'Krähen', 'Elster'];
  const NAME_B = {
    plain: ['au', 'feld', 'heim', 'mark', 'furt', 'tal', 'wiesen', 'gau', 'dorf', 'land'],
    forest: ['wald', 'hain', 'grund', 'holz', 'forst', 'busch', 'moor'],
    mountain: ['berg', 'fels', 'stein', 'horn', 'wacht', 'kamm', 'klamm'],
    desert: ['sand', 'öde', 'dünen', 'steppe', 'glut', 'senke'],
  };

  function quantile(arr, q) {
    const s = Float32Array.from(arr).sort();
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
  }

  function generateWorld(nPlayers, typeIn, size, seed, cus = {}) {
    cus = cus || {};
    const rng = mulberry32(seed >>> 0);
    const noise = makeNoise(rng);
    const type = MAPS[typeIn] ? typeIn : MAP_KEYS[(seed >>> 0) % MAP_KEYS.length];
    const sz = cus.fixedSize ? size : nPlayers >= 5 && size === 'small' ? 'medium' : nPlayers >= 6 && size === 'medium' ? 'large' : size;
    const [cols, rows] = SIZES[sz].dim;
    const N = cols * rows;
    const geo = { seed, type, cols, rows, s: HEX_S, W: HEX_S * SQ3 * (cols + 1), H: HEX_S * (1.5 * (rows - 1) + 2) };

    // 1. Landform je nach Kartentyp
    const ell = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    const e = new Float32Array(N);
    const LAND = cus.land != null ? cus.land : { continent: 0.55, islands: 0.36, twin: 0.48, inland: 0.48, highlands: 0.6, desert: 0.58 }[type];
    for (let i = 0; i < N; i++) {
      const [x, y] = hexXY(geo, i);
      const nx = x / geo.W, ny = y / geo.H;
      const n = noise(nx * 3.2, ny * 3.2, 5) - 0.5;
      let v;
      if (type === 'islands') v = (noise(nx * 6.5, ny * 6.5, 4) - 0.5) * 1.8 - ell(nx, ny, 0.5, 0.5, 0.52, 0.5) * 0.45;
      else if (type === 'twin') v = n * 1.3 - Math.min(ell(nx, ny, 0.26, 0.5, 0.24, 0.42), ell(nx, ny, 0.74, 0.5, 0.24, 0.42)) * 0.85;
      else if (type === 'inland') { const d = Math.sqrt(ell(nx, ny, 0.5, 0.5, 0.47, 0.45)); v = n * 1.1 - Math.abs(d - 0.68) * 2.2 - Math.max(0, d - 1) * 3; }
      else v = n * 1.4 - ell(nx, ny, 0.5, 0.5, 0.47, 0.45) * 0.95;
      const edge = Math.min(x, geo.W - x, y, geo.H - y) / (HEX_S * 3);
      if (edge < 1) v -= (1 - edge) * 2;
      e[i] = v;
    }
    const sea = quantile(e, 1 - LAND);
    let emax = -Infinity;
    for (let i = 0; i < N; i++) if (e[i] > emax) emax = e[i];

    // 2. Höhe, Feuchtigkeit, Gelände
    const terr = new Array(N).fill('.');
    const elev = new Float32Array(N);
    const moist = new Float32Array(N);
    const landIdx = [];
    for (let i = 0; i < N; i++) {
      if (e[i] < sea) continue;
      const [x, y] = hexXY(geo, i);
      const nx = x / geo.W, ny = y / geo.H;
      let h = (e[i] - sea) / (emax - sea);
      const ridge = 1 - Math.abs(noise(nx * 5 + 3, ny * 5 + 7, 3) - 0.5) * 2;
      h = h * 0.65 + ridge * ridge * (type === 'highlands' ? 0.75 : 0.45);
      elev[i] = h;
      moist[i] = noise(nx * 3.6 + 40, ny * 3.6 + 40, 4);
      landIdx.push(i);
      terr[i] = 'p';
    }
    const hl = landIdx.map(i => elev[i]), ml = landIdx.map(i => moist[i]);
    const peakQ = cus.peaks === false ? 2 : cus.peaks === true ? Math.min(0.97, { highlands: 0.9 }[type] || 0.96) : { highlands: 0.9, continent: 0.975, twin: 0.975, desert: 0.98 }[type] || 2;
    const mtnQ = cus.mountain != null ? 1 - cus.mountain : type === 'highlands' ? 0.68 : 0.86;
    const hPeak = peakQ < 1 ? quantile(hl, peakQ) : Infinity, hMtn = quantile(hl, mtnQ);
    const dShare = cus.desert != null ? cus.desert : type === 'desert' ? 0.6 : 0.14;
    const fShare = cus.forest != null ? cus.forest : type === 'desert' ? 0.1 : 0.34;
    const mDry = quantile(ml, dShare), mWet = quantile(ml, Math.max(dShare, 1 - fShare));
    for (const i of landIdx) {
      terr[i] = elev[i] >= hPeak ? 'x' : elev[i] >= hMtn ? 'm' : moist[i] <= mDry ? 'd' : moist[i] >= mWet ? 'f' : 'p';
    }

    // 3. kleine Inselchen versenken
    const seen = new Uint8Array(N);
    for (const s0 of landIdx) {
      if (seen[s0] || terr[s0] === '.') continue;
      const comp = [s0]; seen[s0] = 1;
      for (let k = 0; k < comp.length; k++) for (let d = 0; d < 6; d++) {
        const j = hexNeighbor(geo, comp[k], d);
        if (j >= 0 && !seen[j] && terr[j] !== '.') { seen[j] = 1; comp.push(j); }
      }
      if (comp.filter(i => terr[i] !== 'x').length < 6) comp.forEach(i => { terr[i] = '.'; });
    }
    const passable = i => i >= 0 && terr[i] !== '.' && terr[i] !== 'x';
    let pass = [];
    for (let i = 0; i < N; i++) if (passable(i)) pass.push(i);

    // 4. Provinzen: gewichtete Keime wachsen um die Wette (Gebirge bremst → Grenzen folgen Kämmen)
    const P = cus.provSize ? Math.max(6, Math.min(90, Math.round(pass.length / cus.provSize))) : Math.max(nPlayers * 4, Math.min(90, Math.round(pass.length / 17)));
    const seeds = [];
    let minD = Math.sqrt(pass.length / P) * 1.05;
    for (let tries = 0; seeds.length < P && tries < 20000; tries++) {
      const c = pass[Math.floor(rng() * pass.length)];
      if (seeds.every(s => hexDistIdx(geo, s, c) >= minD)) seeds.push(c);
      if (tries % 2000 === 1999) minD *= 0.9;
    }
    // jede Landmasse braucht mindestens eine Provinz
    const compOf = new Int32Array(N).fill(-1);
    let nComp = 0;
    for (const s0 of pass) {
      if (compOf[s0] >= 0) continue;
      const comp = [s0]; compOf[s0] = nComp;
      for (let k = 0; k < comp.length; k++) for (let d = 0; d < 6; d++) {
        const j = hexNeighbor(geo, comp[k], d);
        if (passable(j) && compOf[j] < 0) { compOf[j] = nComp; comp.push(j); }
      }
      if (!seeds.some(s => compOf[s] === nComp)) seeds.push(comp[Math.floor(comp.length / 2)]);
      nComp++;
    }
    const weight = seeds.map(() => 0.55 + rng() * 1.1);
    const prov = new Int32Array(N).fill(-1);
    const best = new Float64Array(N).fill(Infinity);
    const heap = [];
    const push = (pr, i, s, g) => {
      heap.push([pr, i, s, g]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    seeds.forEach((s, k) => { best[s] = 0; push(0, s, k, 0); });
    const jitter = new Float32Array(N);
    for (let i = 0; i < N; i++) jitter[i] = 0.75 + rng() * 0.5;
    while (heap.length) {
      const [pr, i, s, g] = pop();
      if (prov[i] >= 0) continue;
      prov[i] = s;
      for (let d = 0; d < 6; d++) {
        const j = hexNeighbor(geo, i, d);
        if (!passable(j) || prov[j] >= 0) continue;
        const g2 = g + (terr[j] === 'm' ? 2.4 : 1) * jitter[j];
        const p2 = g2 / weight[s];
        if (p2 < best[j]) { best[j] = p2; push(p2, j, s, g2); }
      }
    }
    // winzige Provinzen dem Nachbarn zuschlagen
    for (let guard = 0; guard < 200; guard++) {
      const cnt = new Map();
      for (const i of pass) cnt.set(prov[i], (cnt.get(prov[i]) || 0) + 1);
      let small = -1;
      for (const [p, c] of cnt) if (p >= 0 && c < 7 && (small < 0 || c < cnt.get(small))) small = p;
      if (small < 0) break;
      const border = new Map();
      for (const i of pass) {
        if (prov[i] !== small) continue;
        for (let d = 0; d < 6; d++) {
          const j = hexNeighbor(geo, i, d);
          if (passable(j) && prov[j] !== small) border.set(prov[j], (border.get(prov[j]) || 0) + 1);
        }
      }
      if (!border.size) { cnt.delete(small); for (const i of pass) if (prov[i] === small) prov[i] = -2 - small; continue; }
      const into = [...border.entries()].sort((a, b) => b[1] - a[1])[0][0];
      for (const i of pass) if (prov[i] === small) prov[i] = into;
    }
    // abgeschlossene Mini-Täler (keine Nachbarn) werden zu Gebirge
    for (const i of pass) if (prov[i] <= -2) { prov[i] = -1; terr[i] = 'x'; }
    pass = pass.filter(i => prov[i] >= 0);
    const ids = [...new Set(pass.map(i => prov[i]))];
    const remap = new Map(ids.map((p, k) => [p, k]));
    for (let i = 0; i < N; i++) prov[i] = prov[i] >= 0 ? remap.get(prov[i]) : -1;

    // 5. Flüsse fließen bergab ins Meer
    const rivers = [];
    const isRiver = new Uint8Array(N);
    const nRiv = cus.rivers != null ? cus.rivers : { small: 4, medium: 6, large: 9, huge: 12 }[sz] + (type === 'desert' ? 3 : 0);
    const hSrc = quantile(hl, 0.7);
    const srcs = landIdx.filter(i => passable(i) && elev[i] >= hSrc && elev[i] < hPeak);
    for (let k = 0; k < nRiv * 6 && rivers.length < nRiv && srcs.length; k++) {
      const src = srcs[Math.floor(rng() * srcs.length)];
      if (isRiver[src] || rivers.some(r => hexDistIdx(geo, r[0], src) < 5)) continue;
      const path = [src], vis = new Set([src]);
      let cur = src, ok = false;
      for (let step = 0; step < 70; step++) {
        let next = -1, bestH = Infinity;
        for (let d = 0; d < 6; d++) {
          const j = hexNeighbor(geo, cur, d);
          if (j < 0 || vis.has(j)) continue;
          if (terr[j] === '.') { next = j; bestH = -1; break; }
          if (terr[j] === 'x') continue;
          const h = elev[j] + rng() * 0.03;
          if (h < bestH) { bestH = h; next = j; }
        }
        if (next < 0) break;
        path.push(next); vis.add(next);
        if (terr[next] === '.') { ok = true; break; }
        if (isRiver[next]) { ok = true; break; }
        cur = next;
      }
      if (ok && path.length >= 5) { rivers.push(path); path.forEach(i => { if (terr[i] !== '.') isRiver[i] = 1; }); }
    }

    // 6. Provinzdaten
    const PN = ids.length;
    const provinces = Array.from({ length: PN }, () => ({ hexes: [], tcount: { p: 0, f: 0, m: 0, d: 0 }, river: false, n: new Set() }));
    for (const i of pass) {
      const P0 = provinces[prov[i]];
      P0.hexes.push(i); P0.tcount[terr[i]]++;
      if (isRiver[i]) P0.river = true;
      for (let d = 0; d < 6; d++) {
        const j = hexNeighbor(geo, i, d);
        if (passable(j) && prov[j] !== prov[i]) P0.n.add(prov[j]);
      }
    }
    const sizes = provinces.map(p => p.hexes.length).sort((a, b) => a - b);
    const med = sizes[Math.floor(sizes.length / 2)];
    const usedNames = new Set();
    const cells = provinces.map((P0, k) => {
      const tc = P0.tcount;
      const terrain = { p: 'plain', f: 'forest', m: 'mountain', d: 'desert' }[['p', 'f', 'm', 'd'].reduce((a, b) => (tc[b] > tc[a] ? b : a))];
      // Beschriftungspunkt: das Feld, das am weitesten von der Provinzgrenze entfernt ist
      const inP = new Set(P0.hexes), dist = new Map(), q = [];
      for (const i of P0.hexes) {
        let edgeHex = false;
        for (let d = 0; d < 6; d++) { const j = hexNeighbor(geo, i, d); if (j < 0 || !inP.has(j)) edgeHex = true; }
        if (edgeHex) { dist.set(i, 0); q.push(i); }
      }
      for (let h = 0; h < q.length; h++) for (let d = 0; d < 6; d++) {
        const j = hexNeighbor(geo, q[h], d);
        if (inP.has(j) && !dist.has(j)) { dist.set(j, dist.get(q[h]) + 1); q.push(j); }
      }
      let cx = 0, cy = 0;
      for (const i of P0.hexes) { const [x, y] = hexXY(geo, i); cx += x; cy += y; }
      cx /= P0.hexes.length; cy /= P0.hexes.length;
      let lab = P0.hexes[0], lb = -Infinity;
      for (const i of P0.hexes) {
        const [x, y] = hexXY(geo, i);
        const sc = (dist.get(i) || 0) * 30 - Math.hypot(x - cx, y - cy);
        if (sc > lb) { lb = sc; lab = i; }
      }
      const [lx, ly] = hexXY(geo, lab);
      let name;
      for (let t = 0; t < 30; t++) {
        name = NAME_A[Math.floor(rng() * NAME_A.length)] + NAME_B[terrain][Math.floor(rng() * NAME_B[terrain].length)];
        if (!usedNames.has(name)) break;
      }
      usedNames.add(name);
      const size = P0.hexes.length;
      return {
        name, terrain, size, sz: size < med * 0.8 ? 'S' : size > med * 1.3 ? 'L' : 'M', river: P0.river,
        lx: Math.round(lx * 10) / 10, ly: Math.round(ly * 10) / 10, n: [...P0.n], label: lab,
        owner: -1, u: emptyU(), building: null, capital: false, hut: false,
      };
    });

    geo.adj = [];
    cells.forEach((c, a) => c.n.forEach(b => { if (a < b) geo.adj.push([a, b]); }));
    geo.labels = cells.map(c => [c.lx, c.ly]);

    // 7. Seewege verbinden getrennte Landmassen (und im Inselreich nahe Inseln)
    const coast = cells.map(() => []);
    for (const i of pass) {
      for (let d = 0; d < 6; d++) { const j = hexNeighbor(geo, i, d); if (j >= 0 && terr[j] === '.') { coast[prov[i]].push(i); break; } }
    }
    const routes = [];
    const addRoute = (a, b, ha, hb) => {
      if (cells[a].n.includes(b)) return;
      cells[a].n.push(b); cells[b].n.push(a);
      const [x1, y1] = hexXY(geo, ha), [x2, y2] = hexXY(geo, hb);
      routes.push({ a, b, x1, y1, x2, y2 });
    };
    // Provinzen ohne Küste (im Gebirge eingeschlossen) verbinden sich über einen Pass
    const edgeHexes = k => (coast[k].length ? coast[k] : provinces[k].hexes);
    const closest = (A, B) => {
      let bd = Infinity, res = null;
      for (const a of A) for (const ha of edgeHexes(a)) for (const b of B) for (const hb of edgeHexes(b)) {
        const d = hexDistIdx(geo, ha, hb);
        if (d < bd) { bd = d; res = [a, b, ha, hb, d]; }
      }
      return res;
    };
    for (let guard = 0; guard < 40; guard++) {
      const comp = new Int32Array(PN).fill(-1);
      let nc = 0;
      for (let s0 = 0; s0 < PN; s0++) {
        if (comp[s0] >= 0) continue;
        const q = [s0]; comp[s0] = nc;
        for (let h = 0; h < q.length; h++) for (const j of cells[q[h]].n) if (comp[j] < 0) { comp[j] = nc; q.push(j); }
        nc++;
      }
      if (nc <= 1) break;
      const groups = Array.from({ length: nc }, (_, g) => cells.map((_, k) => k).filter(k => comp[k] === g)).sort((a, b) => b.length - a.length);
      const r = closest(groups[0], groups.slice(1).flat());
      if (!r) break;
      addRoute(...r.slice(0, 4));
    }
    if (type === 'islands' || type === 'twin') {
      for (let a = 0; a < PN; a++) for (let b = a + 1; b < PN; b++) {
        if (cells[a].n.includes(b) || !coast[a].length || !coast[b].length) continue;
        const r = closest([a], [b]);
        if (r && r[4] <= 3 && rng() < 0.6) addRoute(...r.slice(0, 4));
      }
    }

    geo.terr = terr.join('');
    geo.prov = Array.from(prov);
    geo.elev = Array.from(elev, v => Math.max(0, Math.min(9, Math.round(v * 9)))).join('');
    geo.rivers = rivers;
    geo.routes = routes;
    return { geo, cells };
  }

  function placeCapitals(cells, n) {
    const bfsP = starts => {
      const d = new Array(cells.length).fill(Infinity), q = [...starts];
      starts.forEach(s => { d[s] = 0; });
      for (let h = 0; h < q.length; h++) for (const j of cells[q[h]].n) if (d[j] === Infinity) { d[j] = d[q[h]] + 1; q.push(j); }
      return d;
    };
    const good = cells.map((c, i) => i).filter(i => cells[i].n.length >= 3 && cells[i].sz !== 'L');
    const pool = good.length >= n ? good : cells.map((c, i) => i);
    const d0 = bfsP([pick(pool)]);
    const starts = [pool.reduce((a, b) => (d0[b] > d0[a] ? b : a))];
    while (starts.length < n) {
      const d = bfsP(starts);
      let bestI = -1, bestD = -1;
      for (const i of shuffleCopy(pool)) if (!starts.includes(i) && d[i] > bestD) { bestD = d[i]; bestI = i; }
      starts.push(bestI);
    }
    return starts;
  }

  function shuffleCopy(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  }

  // ---------- Divisionen ----------
  // Truppen einer Provinz sind in Divisionen gruppiert: { id, name, u: Einheiten, done: schon bewegt }.
  // c.u (Summe) und c.done (Summe der bewegten) werden daraus abgeleitet.

  function newDiv(st, owner, u, name) {
    let n = name;
    if (!n) {
      if (owner >= 0) { const pl = st.players[owner]; pl.divNo = (pl.divNo || 0) + 1; n = `${pl.divNo}. Division`; }
      else n = 'Miliz';
    }
    return { id: ++st.divSeq, name: n, u: { ...emptyU(), ...u }, done: false };
  }

  function sync(c) {
    c.divs = c.divs.filter(v => total(v.u) > 0);
    const u = emptyU(), d = emptyU();
    for (const v of c.divs) for (const t of TYPES) { u[t] += v.u[t]; if (v.done) d[t] += v.u[t]; }
    c.u = u; c.done = d;
  }

  function setUnits(st, c, u) { c.divs = [newDiv(st, c.owner, u)]; sync(c); }

  // Truppen aus einer Provinz herauslösen: ganze Divisionen (ids) oder eine Anzahl Einheiten (wird aus bereiten Divisionen genommen)
  function detach(st, c, spec) {
    if (spec.divs) {
      const ds = c.divs.filter(v => spec.divs.includes(v.id));
      c.divs = c.divs.filter(v => !spec.divs.includes(v.id));
      sync(c);
      return ds;
    }
    const want = cleanUnits(spec.units), out = emptyU(), used = [];
    for (const v of c.divs) {
      if (v.done) continue;
      let took = 0;
      for (const t of TYPES) { const k = Math.min(v.u[t], want[t] - out[t]); v.u[t] -= k; out[t] += k; took += k; }
      if (took && !total(v.u)) used.push(v);
    }
    sync(c);
    if (used.length) { used[0].u = out; return [used[0]]; }
    return [newDiv(st, c.owner, out)];
  }

  function arrive(c, divs) {
    for (const v of divs) { v.done = true; c.divs.push(v); }
    sync(c);
  }

  // Verluste über mehrere Divisionen verteilen: billigste Einheiten zuerst
  function lossesFrom(divs, dmg, valueOf) {
    let n = 0;
    const tot = () => divs.reduce((s, v) => s + total(v.u), 0);
    while (dmg > 0 && tot() > 1) {
      const t = TYPES.find(x => divs.some(v => v.u[x] > 0));
      const v = divs.filter(d => d.u[t] > 0).sort((a, b) => b.u[t] - a.u[t])[0];
      v.u[t]--; dmg -= valueOf(t); n++;
    }
    return n;
  }

  const divUnits = divs => divs.reduce((u, v) => addU(u, v.u), emptyU());
  // stärkste Einheit einer Gruppe – bestimmt die Figur auf der Karte
  const strongestType = u => [...TYPES].reverse().find(t => u[t] > 0) || 'w';

  // ---------- Spiel ----------

  function createGame(defs, opts = {}) {
    const seed = opts.seed != null ? opts.seed >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    const { geo, cells } = generateWorld(defs.length, opts.map || 'continent', SIZES[opts.size] ? opts.size : 'medium', seed, opts.custom);
    // eigene Provinznamen aus der Weltenschmiede
    if (opts.names) for (const [k, v] of Object.entries(opts.names)) if (cells[+k] && v) cells[+k].name = String(v).slice(0, 24);
    const mode = MODES[opts.mode] ? opts.mode : 'classic';
    const players = defs.map((p, i) => ({
      name: p.name, type: p.type, level: p.level || null, cid: p.cid || null,
      color: COLORS.includes(p.color) ? p.color : COLORS[i], alive: true, gold: opts.gold != null ? +opts.gold : 4, sci: 2, techs: [], lastAsk: -10, divNo: 0,
    }));
    const st = {
      cells, geo, players, turn: 0, round: 1, attacks: 0, divSeq: 0,
      alliances: [], proposals: [], log: [], over: false, winner: -1, battle: null, march: null, seq: 0,
      maxRounds: opts.rounds ? +opts.rounds : mode === 'blitz' ? 20 : MAX_ROUNDS, map: geo.type, truce: opts.truce || 0,
      mode, worldName: opts.worldName || '', throne: -1, crowns: players.map(() => 0), crownGoal: 5,
    };
    // neutrale Provinzen: je größer, desto mehr Verteidiger; manche mit Dorf (Belohnung beim Erobern)
    for (const c of cells) {
      const u = emptyU();
      u.w = { S: 1, M: 1 + rnd(2), L: 2 + rnd(2) }[c.sz];
      if ((c.terrain === 'forest' || c.terrain === 'mountain' || c.sz === 'L') && Math.random() < 0.4) u.a = 1;
      if (Math.random() < 0.12) { c.hut = true; u.w += 1; }
      setUnits(st, c, u);
    }
    const terr = geo.terr.split('');
    const setTerrain = (ci, t, code) => {
      cells[ci].terrain = t;
      geo.prov.forEach((p, i) => { if (p === ci && terr[i] !== 'x' && (terr[i] !== 'm' || t === 'mountain')) terr[i] = code; });
    };
    const order = shuffleCopy(players.map((_, i) => i));
    const caps = placeCapitals(cells, players.length);
    caps.forEach((ci, k) => {
      Object.assign(cells[ci], { owner: order[k], capital: true, hut: false });
      setUnits(st, cells[ci], { w: 3 });
      setTerrain(ci, 'plain', 'p');
      // faire Startumgebung: ein Wald und eine Ebene nebenan, leicht zu erobern
      const ns = shuffleCopy(cells[ci].n).filter(j => !caps.includes(j));
      ns.forEach((j, m) => {
        cells[j].hut = false;
        setUnits(st, cells[j], { w: 1 });
        if (m === 0) setTerrain(j, 'forest', 'f');
        if (m === 1 && cells[j].terrain === 'desert') setTerrain(j, 'plain', 'p');
      });
    });
    // Thronkampf: die Provinz, die von allen Hauptstädten am weitesten entfernt ist, wird zur befestigten Thronstadt
    if (mode === 'throne') {
      const d = bfs(cells, caps);
      let best = -1;
      cells.forEach((c, i) => { if (!caps.includes(i) && (best < 0 || d[i] > d[best] || (d[i] === d[best] && c.size > cells[best].size))) best = i; });
      st.throne = best;
      Object.assign(cells[best], { throne: true, hut: false, building: 'fort' });
      setUnits(st, cells[best], { w: 4, a: 2 });
    }
    geo.terr = terr.join('');
    log(st, `Das Spiel beginnt${st.worldName ? ` in der Welt „${st.worldName}“` : ` auf der Karte „${MAPS[geo.type].name}“`} – Modus: ${MODES[mode].name}!`);
    if (mode === 'throne') log(st, `👑 Erobere die Thronstadt ${cells[st.throne].name}! Wer sie zu Beginn seines Zuges hält, bekommt eine Krone – ${st.crownGoal} Kronen gewinnen.`);
    startTurn(st);
    return st;
  }

  function log(st, m, ...ps) {
    st.log.push({ m, ps });
    if (st.log.length > 80) st.log.shift();
  }

  const hasTech = (st, p, t) => p >= 0 && !!st.players[p] && st.players[p].techs.includes(t);

  function provinceYield(st, c) {
    const p = c.owner;
    let gold = TERRAIN[c.terrain].gold + PSIZE[c.sz].gold + (c.river ? 1 : 0), sci = 0;
    if (c.capital) { gold += 3; sci += 2; }
    const b = c.building && BUILDINGS[c.building];
    if (b) {
      gold += b.gold || 0; sci += b.sci || 0;
      if (c.building === 'farm' && hasTech(st, p, 'trade')) gold += 1;
      if (c.building === 'library' && hasTech(st, p, 'university')) sci += 2;
      if (hasTech(st, p, 'banking')) gold += 1;
    }
    return { gold, sci };
  }

  // Unterhalt: je 4 Einheiten 1 Gold pro Runde
  const upkeepFor = troops => Math.floor(troops / 4);

  function income(st, p) {
    let gold = 0, sci = 1, cells = 0, troops = 0;
    for (const c of st.cells) {
      if (c.owner !== p) continue;
      cells++; troops += total(c.u);
      const y = provinceYield(st, c);
      gold += y.gold; sci += y.sci;
    }
    return cells ? { gold, sci, upkeep: upkeepFor(troops) } : { gold: 0, sci: 0, upkeep: 0 };
  }

  function stats(st, p) {
    let cells = 0, troops = 0, buildings = 0;
    for (const c of st.cells) if (c.owner === p) { cells++; troops += total(c.u); if (c.building) buildings++; }
    const inc = income(st, p), pl = st.players[p];
    return { cells, troops, buildings, gold: pl.gold, sci: pl.sci, techs: pl.techs.length, income: inc.gold - inc.upkeep, gross: inc.gold, upkeep: inc.upkeep, sciIncome: inc.sci };
  }

  const score = (st, p) => { const s = stats(st, p); return s.cells * 3 + s.techs * 2 + s.buildings; };
  const allied = (st, a, b) => a >= 0 && b >= 0 && a !== b && st.alliances.includes(akey(a, b));
  const aliveCount = st => st.players.filter(p => p.alive).length;
  const isCity = c => c.capital || c.building === 'fort';
  // Einheiten, die in diesem Zug noch handeln können
  const avail = c => { const r = emptyU(); for (const t of TYPES) r[t] = Math.max(0, c.u[t] - (c.done ? c.done[t] : 0)); return r; };

  function startTurn(st) {
    const pl = st.players[st.turn], inc = income(st, st.turn);
    // wie bei Civilization: die schwere KI bekommt einen Ressourcenbonus
    const bonus = (pl.type === 'ai' && pl.level === 'hard' ? 1.2 : 1) * (st.mode === 'blitz' ? 2 : 1);
    pl.gold = Math.max(0, pl.gold + Math.round(inc.gold * bonus) - inc.upkeep);
    pl.sci += Math.round(inc.sci * bonus);
    for (const c of st.cells) { for (const v of c.divs) v.done = false; sync(c); }
    st.attacks = 0;
    if (st.mode === 'throne' && st.throne >= 0 && st.cells[st.throne].owner === st.turn && !st.over) {
      st.crowns[st.turn]++;
      log(st, `👑 {0} hält den Thron – Krone ${st.crowns[st.turn]} von ${st.crownGoal}!`, st.turn);
      st.crownEvent = { id: ++st.seq, p: st.turn, n: st.crowns[st.turn] };
      if (st.crowns[st.turn] >= st.crownGoal) {
        st.over = true; st.winner = st.turn;
        log(st, '🏆 {0} wird zum Herrscher über alle Reiche gekrönt!', st.turn);
      }
    }
  }

  function nextTurn(st) {
    const n = st.players.length;
    let t = st.turn;
    do {
      t = (t + 1) % n;
      if (t === 0) st.round++;
    } while (!st.players[t].alive);
    st.turn = t;
    if (st.round > st.maxRounds) {
      let best = -1, bestScore = -1;
      st.players.forEach((p, i) => {
        if (!p.alive) return;
        const s = score(st, i) + (st.mode === 'throne' ? st.crowns[i] * 1000 : 0);
        if (s > bestScore) { bestScore = s; best = i; }
      });
      st.over = true; st.winner = best;
      log(st, 'Rundenlimit erreicht – {0} hat die meisten Punkte (Provinzen, Forschung, Gebäude)!', best);
      return;
    }
    startTurn(st);
  }

  // ---------- Bewegung und Kampf ----------

  const atkOf = (st, p, t) => UNITS[t].atk + (hasTech(st, p, 'steel') ? 1 : 0);
  const defOf = (st, p, t, vsKnights) => UNITS[t].def + (hasTech(st, p, 'tactics') ? 1 : 0) + (t === 'p' && vsKnights ? 2 : 0);
  // Gelände, Provinzgröße und Festung machen die Verteidigung stärker
  function defMult(cell, siege) {
    let m = 1 + TERRAIN[cell.terrain].def + PSIZE[cell.sz].def;
    if (!siege && isCity(cell)) m += 0.5;
    return m;
  }

  // Bewegungspunkte einer Gruppe: die langsamste Einheit bestimmt das Tempo
  function mpOf(st, p, units) {
    let mp = Infinity;
    for (const t of TYPES) if (units[t] > 0) mp = Math.min(mp, UNITS[t].mp);
    return mp === Infinity ? 0 : mp + (hasTech(st, p, 'roads') ? 1 : 0);
  }

  // Eigene Provinzen, die eine Gruppe in diesem Zug erreichen kann (nur durch eigenes Gebiet)
  function moveTargets(st, from, units) {
    const C = st.cells, p = C[from].owner, range = mpOf(st, p, units);
    const d = new Map([[from, 0]]), queue = [from], out = [];
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h];
      if (d.get(i) >= range) continue;
      for (const j of C[i].n) {
        if (d.has(j) || C[j].owner !== p) continue;
        d.set(j, d.get(i) + 1); queue.push(j); out.push(j);
      }
    }
    return out;
  }

  // Angriffskraft (aus einer oder mehreren Provinzen) gegen Verteidigungskraft → Siegchance
  function odds(st, p, units, to) {
    const A = TYPES.reduce((s, t) => s + (units[t] || 0) * atkOf(st, p, t), 0);
    const vsK = units.k > 0, siege = units.c > 0;
    const mult = defMult(to, siege);
    const D = TYPES.reduce((s, t) => s + to.u[t] * defOf(st, to.owner, t, vsK), 0) * mult;
    const pr = D <= 0 ? (A > 0 ? 1 : 0) : A <= 0 ? 0 : A ** 2.5 / (A ** 2.5 + D ** 2.5);
    return { A, D, p: pr, mult, siege };
  }

  function checkEliminated(st, p) {
    if (p < 0 || !st.players[p].alive || stats(st, p).cells > 0) return;
    st.players[p].alive = false;
    st.alliances = st.alliances.filter(k => !k.split('-').map(Number).includes(p));
    st.proposals = st.proposals.filter(x => x.from !== p && x.to !== p);
    log(st, '💀 {0} wurde vernichtet!', p);
    if (aliveCount(st) === 1) {
      st.over = true;
      st.winner = st.players.findIndex(x => x.alive);
      log(st, '🏆 {0} herrscht über das ganze Land!', st.winner);
    }
  }

  function bfs(cells, starts, passable) {
    const d = new Array(cells.length).fill(Infinity);
    const queue = [];
    for (const s of starts) { d[s] = 0; queue.push(s); }
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h];
      for (const j of cells[i].n) {
        if (d[j] === Infinity && (!passable || passable(j))) { d[j] = d[i] + 1; queue.push(j); }
      }
    }
    return d;
  }

  const canResearch = (st, p, t) => {
    const T = TECHS[t], pl = st.players[p];
    return !!T && !pl.techs.includes(t) && (!T.req || pl.techs.includes(T.req));
  };
  const unitUnlocked = (st, p, t) => !UNITS[t].tech || hasTech(st, p, UNITS[t].tech);
  function canBuild(st, p, i, b) {
    const c = st.cells[i], B = BUILDINGS[b];
    if (!c || !B || c.owner !== p || c.building || c.capital) return false;
    return B.on.includes(c.terrain) && (!B.tech || hasTech(st, p, B.tech));
  }

  const cleanUnits = u => { const r = emptyU(); for (const t of TYPES) r[t] = Math.max(0, (u && u[t]) | 0); return r; };
  const fits = (u, a) => TYPES.every(t => u[t] <= a[t]);
  const fail = err => ({ ok: false, err });

  // prüft eine Truppenangabe ({divs} oder {units}) und liefert die Einheiten-Summe oder einen Fehlertext
  function specUnits(c, spec) {
    if (spec.divs) {
      if (!Array.isArray(spec.divs) || !spec.divs.length) return 'Keine Division ausgewählt.';
      const ds = spec.divs.map(id => c.divs.find(v => v.id === id));
      if (ds.some(v => !v)) return 'Diese Division gibt es hier nicht.';
      if (ds.some(v => v.done)) return 'Diese Division hat sich in diesem Zug schon bewegt.';
      return divUnits(ds);
    }
    const u = cleanUnits(spec.units);
    if (!fits(u, avail(c))) return 'Diese Truppen haben sich in diesem Zug schon bewegt.';
    return u;
  }

  function applyAction(st, p, a) {
    if (st.over) return fail('Das Spiel ist vorbei.');
    const me = st.players[p];
    if (!me || !me.alive || !a) return fail('Ungültig.');
    const C = st.cells;

    // Diplomatie geht jederzeit
    switch (a.type) {
      case 'propose': {
        const t = a.target, tp = st.players[t];
        if (!tp || !tp.alive || t === p) return fail('Ungültiges Ziel.');
        if (allied(st, p, t)) return fail('Ihr seid schon verbündet.');
        if (st.proposals.some(x => (x.from === p && x.to === t) || (x.from === t && x.to === p))) return fail('Es gibt schon ein offenes Angebot.');
        st.proposals.push({ from: p, to: t });
        log(st, '📜 {0} bietet {1} ein Bündnis an.', p, t);
        return { ok: true };
      }
      case 'accept':
      case 'decline': {
        const i = st.proposals.findIndex(x => x.from === a.from && x.to === p);
        if (i < 0) return fail('Kein Angebot vorhanden.');
        st.proposals.splice(i, 1);
        if (a.type === 'accept') {
          st.alliances.push(akey(p, a.from));
          log(st, '🤝 {0} und {1} sind jetzt verbündet.', p, a.from);
        } else log(st, '✋ {0} lehnt das Bündnis mit {1} ab.', p, a.from);
        return { ok: true };
      }
      case 'break': {
        if (!allied(st, p, a.target)) return fail('Ihr seid nicht verbündet.');
        st.alliances = st.alliances.filter(k => k !== akey(p, a.target));
        log(st, '🗡️ {0} bricht das Bündnis mit {1}!', p, a.target);
        return { ok: true };
      }
    }

    if (st.turn !== p) return fail('Du bist nicht am Zug.');

    switch (a.type) {
      case 'research': {
        const T = TECHS[a.tech];
        if (!T) return fail('Unbekannte Technologie.');
        if (me.techs.includes(a.tech)) return fail('Schon erforscht.');
        if (T.req && !me.techs.includes(T.req)) return fail(`Benötigt zuerst „${TECHS[T.req].name}“.`);
        if (me.sci < T.cost) return fail(`Zu wenig Wissen (${T.cost} nötig).`);
        me.sci -= T.cost; me.techs.push(a.tech);
        log(st, `🔬 {0} erforscht ${T.name}.`, p);
        return { ok: true };
      }
      case 'recruit': {
        const c = C[a.cell];
        if (!c || c.owner !== p) return fail('Nur in eigenen Provinzen.');
        if (!isCity(c)) return fail('Einheiten werden in deiner Hauptstadt oder in Festungen ausgebildet.');
        const units = cleanUnits(a.units);
        if (!total(units)) return fail('Keine Einheiten gewählt.');
        for (const t of TYPES) if (units[t] && !unitUnlocked(st, p, t)) return fail(`${UNITS[t].plural} brauchen „${TECHS[UNITS[t].tech].name}“.`);
        const cost = costOf(units);
        if (cost > me.gold) return fail(`Zu wenig Gold (${cost} nötig).`);
        // neue Rekruten sammeln sich in dieser Runde in einer eigenen Division
        let v = c.divs.find(d => d.rec === st.round && !d.done);
        if (!v) { v = newDiv(st, p, emptyU()); v.rec = st.round; c.divs.push(v); }
        v.u = addU(v.u, units);
        sync(c);
        me.gold -= cost;
        return { ok: true, div: v.id };
      }
      case 'build': {
        const B = BUILDINGS[a.b], c = C[a.cell];
        if (!B || !c) return fail('Ungültig.');
        if (c.owner !== p) return fail('Nur in eigenen Provinzen.');
        if (c.capital) return fail('In der Hauptstadt ist kein Platz mehr.');
        if (c.building) return fail(`Hier steht schon: ${BUILDINGS[c.building].name}.`);
        if (B.tech && !hasTech(st, p, B.tech)) return fail(`${B.name} braucht „${TECHS[B.tech].name}“.`);
        if (!B.on.includes(c.terrain)) return fail(`${B.name} geht nur auf: ${B.on.map(t => TERRAIN[t].name).join(', ')}.`);
        if (me.gold < B.cost) return fail(`Zu wenig Gold (${B.cost} nötig).`);
        me.gold -= B.cost; c.building = a.b;
        if (a.b === 'fort') log(st, `🏰 {0} baut eine Festung in ${c.name}.`, p);
        return { ok: true };
      }
      case 'split': {
        const c = C[a.cell];
        if (!c || c.owner !== p) return fail('Nur in eigenen Provinzen.');
        const v = c.divs.find(d => d.id === a.div);
        if (!v) return fail('Diese Division gibt es hier nicht.');
        const units = cleanUnits(a.units);
        if (!total(units)) return fail('Wähle Einheiten für die neue Division.');
        if (!fits(units, v.u) || total(units) >= total(v.u)) return fail('Die alte Division muss mindestens eine Einheit behalten.');
        for (const t of TYPES) v.u[t] -= units[t];
        const nv = newDiv(st, p, units);
        nv.done = v.done;
        c.divs.splice(c.divs.indexOf(v) + 1, 0, nv);
        sync(c);
        return { ok: true, div: nv.id };
      }
      case 'merge': {
        const c = C[a.cell];
        if (!c || c.owner !== p) return fail('Nur in eigenen Provinzen.');
        const ds = (a.divs || []).map(id => c.divs.find(v => v.id === id)).filter(Boolean);
        if (ds.length < 2) return fail('Wähle mindestens zwei Divisionen zum Zusammenlegen.');
        const base = ds[0];
        for (const v of ds.slice(1)) { base.u = addU(base.u, v.u); base.done = base.done || v.done; v.u = emptyU(); }
        sync(c);
        return { ok: true, div: base.id };
      }
      case 'move': {
        const f = C[a.from], t = C[a.to];
        if (!f || !t || f.owner !== p || t.owner !== p) return fail('Nur zwischen eigenen Provinzen.');
        const spec = a.divs ? { divs: a.divs } : { units: a.units || avail(f) };
        const units = specUnits(f, spec);
        if (typeof units === 'string') return fail(units);
        if (!total(units)) return fail('Keine Truppen ausgewählt.');
        if (!moveTargets(st, a.from, units).includes(a.to)) {
          const mp = mpOf(st, p, units);
          return fail(`Zu weit – diese Truppen schaffen ${mp} Provinz${mp === 1 ? '' : 'en'} pro Zug (nur durch eigenes Land).`);
        }
        arrive(t, detach(st, f, spec));
        st.march = { id: ++st.seq, from: a.from, to: a.to, n: total(units), fig: strongestType(units) };
        return { ok: true };
      }
      case 'attack': {
        const t = C[a.to];
        if (!t) return fail('Ungültiges Ziel.');
        // Quellen: [{cell, divs}] oder [{cell, units}]; ohne Angabe ziehen alle bereiten Truppen der Provinz los
        const srcs = (a.sources || [{ cell: a.from }]).map(s => ({
          cell: s.cell,
          spec: s.divs ? { divs: s.divs } : { units: s.units || (C[s.cell] ? avail(C[s.cell]) : emptyU()) },
        }));
        let force = emptyU();
        for (const s of srcs) {
          const f = C[s.cell];
          if (!f || f.owner !== p || !f.n.includes(a.to)) return fail('Angreifen geht nur aus eigenen Nachbarprovinzen.');
          const u = specUnits(f, s.spec);
          if (typeof u === 'string') return fail(u);
          force = addU(force, u);
        }
        if (!total(force)) return fail('Wähle Truppen für den Angriff aus.');
        if (t.owner === p) return fail('Das ist deine eigene Provinz.');
        if (allied(st, p, t.owner)) return fail('Du kannst keine Verbündeten angreifen.');
        if (t.owner >= 0 && st.round <= st.truce) return fail(`Friedenszeit: Spieler können erst ab Runde ${st.truce + 1} angegriffen werden.`);
        const prev = t.owner;
        const o = odds(st, p, force, t);
        const won = Math.random() < o.p;
        const spread = () => 0.6 + Math.random() * 0.8;
        const live = srcs.filter(s => total(specUnits(C[s.cell], s.spec)));
        const main = live.slice().sort((x, y) => total(specUnits(C[y.cell], y.spec)) - total(specUnits(C[x.cell], x.spec)))[0].cell;
        const froms = live.map(s => s.cell);
        const attDivs = live.flatMap(s => detach(st, C[s.cell], s.spec));
        st.attacks++;
        let aL, dL;
        if (won) {
          dL = total(t.u);
          aL = lossesFrom(attDivs, o.D * 0.5 * spread(), tt => atkOf(st, p, tt));
          t.owner = p; t.divs = [];
          arrive(t, attDivs);
          let reward = '';
          if (t.hut) {
            t.hut = false;
            if (Math.random() < 0.5) { me.gold += 6; reward = ' Im Dorf: +6 Gold!'; } else { me.sci += 4; reward = ' Im Dorf: +4 Wissen!'; }
          }
          if (t.capital) { t.capital = false; t.building = 'fort'; log(st, `👑 {0} erobert die Hauptstadt ${t.name} von {1}!`, p, prev); }
          else if (prev >= 0) log(st, `⚔️ {0} erobert ${t.name} von {1}.` + reward, p, prev);
          else log(st, `🚩 {0} erobert ${t.name}.` + reward, p);
          checkEliminated(st, prev);
          st.battle = { id: ++st.seq, from: main, froms, to: a.to, won, aL, dL, p: o.p, reward, prev, fig: strongestType(force) };
        } else {
          aL = total(force);
          dL = lossesFrom(t.divs, o.A * 0.5 * spread(), tt => defOf(st, prev, tt, false));
          sync(t);
          if (prev >= 0) log(st, `🛡️ {1} verteidigt ${t.name} gegen {0}.`, p, prev);
          st.battle = { id: ++st.seq, from: main, froms, to: a.to, won, aL, dL, p: o.p, prev, fig: strongestType(force) };
        }
        return { ok: true, won };
      }
      case 'end':
        nextTurn(st);
        return { ok: true };
    }
    return fail('Unbekannte Aktion.');
  }

  // ---------- KI ----------

  // Stellschrauben der KI (zum Abstimmen der Schwierigkeit)
  const AI_CFG = { hardEcoRounds: 10, hardEcoReserve: 10, hardNeed: 0.62, hardNeedHigh: 0.5, mediumNeed: 0.7, hardArmy: 0.7 };

  const AI_TECH = {
    medium: ['agri', 'archery', 'riding', 'mining', 'writing', 'masonry', 'bronze', 'trade', 'math', 'steel', 'tactics', 'roads', 'banking', 'university'],
    hard: ['agri', 'mining', 'riding', 'writing', 'masonry', 'math', 'bronze', 'steel', 'trade', 'roads', 'archery', 'tactics', 'banking', 'university'],
  };

  function aiAction(st, p) {
    const me = st.players[p], lvl = me.level || 'medium';
    const C = st.cells;
    const mine = [];
    C.forEach((c, i) => { if (c.owner === p) mine.push(i); });
    const truce = st.round <= st.truce;
    const hostile = i => C[i].owner !== p && !allied(st, p, C[i].owner) && !(truce && C[i].owner >= 0);
    const enemyNear = i => C[i].n.some(j => C[j].owner >= 0 && C[j].owner !== p && !allied(st, p, C[j].owner));
    const border = mine.filter(i => C[i].n.some(hostile));
    const counts = st.players.map((_, i) => stats(st, i).cells);
    let leader = -1;
    counts.forEach((n, i) => { if (i !== p && st.players[i].alive && (leader < 0 || n > counts[leader])) leader = i; });

    // Diplomatie
    if (lvl !== 'easy') {
      for (const k of st.alliances) {
        const [a, b] = k.split('-').map(Number);
        if (a !== p && b !== p) continue;
        const ally = a === p ? b : a;
        if (aliveCount(st) === 2) return { type: 'break', target: ally };
        if (lvl === 'hard' && counts[ally] > counts[p] * 1.6) return { type: 'break', target: ally };
      }
      if (aliveCount(st) >= 3 && st.round - me.lastAsk >= 4 && leader >= 0 && counts[leader] > counts[p] * 1.3) {
        const cands = st.players.map((_, i) => i).filter(i => i !== p && i !== leader && st.players[i].alive &&
          !allied(st, p, i) && !st.proposals.some(x => (x.from === p && x.to === i) || (x.from === i && x.to === p)));
        me.lastAsk = st.round;
        if (cands.length) return { type: 'propose', target: cands.reduce((a, b) => (counts[b] > counts[a] ? b : a)) };
      }
    }

    // 1. Forschung
    const avTech = Object.keys(TECHS).filter(t => canResearch(st, p, t));
    if (avTech.length) {
      const t = lvl === 'easy' ? avTech.sort((x, y) => TECHS[x].cost - TECHS[y].cost)[0] : AI_TECH[lvl].find(x => avTech.includes(x));
      if (t && me.sci >= TECHS[t].cost) return { type: 'research', tech: t };
    }

    // 2. Wirtschaft ausbauen
    const ecoOpts = [];
    for (const i of mine) for (const b of Object.keys(BUILDINGS)) {
      if (b === 'fort' || !canBuild(st, p, i, b)) continue;
      const B = BUILDINGS[b];
      ecoOpts.push({ i, b, cost: B.cost, s: ((B.gold || 0) + (B.sci || 0) * 1.3) / B.cost + (enemyNear(i) ? -0.3 : 0) });
    }
    ecoOpts.sort((x, y) => y.s - x.s);
    const eco = ecoOpts[0];
    if (eco && me.gold >= eco.cost) {
      const want = lvl === 'easy' ? rnd(4) === 0
        : lvl === 'medium' ? (st.round < 14 ? rnd(2) === 0 : rnd(5) === 0)
          : st.round < AI_CFG.hardEcoRounds || me.gold >= eco.cost + AI_CFG.hardEcoReserve;
      if (want) return { type: 'build', cell: eco.i, b: eco.b };
    }

    // 3. Einheiten in Städten ausbilden (Unterhalt im Blick behalten)
    const cities = mine.filter(i => isCity(C[i]));
    const s0 = stats(st, p);
    if (cities.length && me.gold >= 2 && (lvl === 'easy' || s0.income > 1 || me.gold >= 8)) {
      const dFront = bfs(C, border.length ? border : mine, j => C[j].owner === p);
      const city = cities.slice().sort((x, y) => dFront[x] - dFront[y])[0];
      const has = t => unitUnlocked(st, p, t);
      const u = emptyU();
      let g = me.gold;
      const buy = (t, n) => { n = Math.max(0, Math.min(n, Math.floor(g / UNITS[t].cost))); u[t] += n; g -= n * UNITS[t].cost; };
      const enemyPow = C[city].n.reduce((s, j) => s + (C[j].owner >= 0 && C[j].owner !== p && !allied(st, p, C[j].owner) ? total(C[j].u) : 0), 0);
      const threatened = enemyPow > total(C[city].u);
      if (lvl === 'easy') buy('w', 99);
      else if (threatened) {
        const enemyKnights = C[city].n.some(j => C[j].owner >= 0 && C[j].u.k > 0);
        if (enemyKnights && has('p')) buy('p', 99);
        if (has('a')) buy('a', 99);
        buy('w', 99);
      } else {
        const best = has('k') ? 'k' : has('p') ? 'p' : 'w';
        if (lvl === 'hard' && has('c') && C[city].u.c < 1) buy('c', 1);
        buy(best, Math.floor(g * (lvl === 'hard' ? AI_CFG.hardArmy : 0.5) / UNITS[best].cost));
        buy('w', 99);
      }
      if (total(u)) return { type: 'recruit', cell: city, units: u };
    }

    // 4. Angreifen – mittlere KI aus einer Provinz, schwere KI aus allen Nachbarprovinzen gleichzeitig
    if (st.attacks < ATTACK_LIMIT[lvl]) {
      const value = t => {
        const c = C[t];
        let v = c.owner < 0 ? 1 : 1.6;
        v += provinceYield(st, c).gold * 0.25;
        if (c.hut) v += 2;
        if (c.building) v += 1;
        if (c.capital) v += 3;
        if (c.throne) v += 8;
        if (c.owner >= 0 && counts[c.owner] === 1) v += 6;
        if (c.owner === leader) v += 0.5;
        v += 0.3 * c.n.filter(j => C[j].owner === p).length;
        return v;
      };
      // Grenzprovinzen zu anderen Spielern behalten eine Wache
      const sendable = (s, target) => {
        const u = avail(C[s]);
        const exposed = C[s].n.some(j => j !== target && C[j].owner >= 0 && C[j].owner !== p && !allied(st, p, C[j].owner));
        if (exposed || C[s].capital) { const keep = Math.max(1, Math.floor(total(C[s].u) * (C[s].capital ? 0.4 : 0.2))); for (let k = 0; k < keep && total(u); k++) removeCheapest(u); }
        return u;
      };
      let choice = null, bestS = 0;
      const targets = new Set();
      for (const b of border) for (const t of C[b].n) if (hostile(t)) targets.add(t);
      for (const t of targets) {
        const srcs = C[t].n.filter(s => C[s].owner === p).map(s => ({ cell: s, units: sendable(s, t) })).filter(s => total(s.units) > 0);
        if (!srcs.length) continue;
        let use;
        if (lvl === 'hard') use = srcs;
        else use = [srcs.sort((x, y) => odds(st, p, y.units, C[t]).p - odds(st, p, x.units, C[t]).p)[0]];
        const force = use.reduce((u, s) => addU(u, s.units), emptyU());
        const pr = odds(st, p, force, C[t]).p;
        if (lvl === 'easy') { if (pr > 0.35 && rnd(3) === 0) return { type: 'attack', to: t, sources: use }; continue; }
        const need = lvl === 'hard' ? (value(t) >= 5 ? AI_CFG.hardNeedHigh : AI_CFG.hardNeed) : AI_CFG.mediumNeed;
        if (pr < need) continue;
        const sc = pr * value(t);
        if (sc > bestS) { bestS = sc; choice = { type: 'attack', to: t, sources: use }; }
      }
      if (choice) return choice;
    }

    // 5. Bereite Truppen aus dem Hinterland an die Front
    if (lvl !== 'easy' && border.length) {
      const own = new Set(mine);
      const d = bfs(C, border, j => own.has(j));
      for (const i of mine.slice().sort((x, y) => total(C[y].u) - total(C[x].u))) {
        const u = avail(C[i]);
        if (d[i] === 0 || d[i] === Infinity || !total(u)) continue;
        if (C[i].capital) { const keep = 1; for (let k = 0; k < keep && total(u); k++) removeCheapest(u); if (!total(u)) continue; }
        const targets = moveTargets(st, i, u).filter(j => d[j] < d[i]).sort((x, y) => d[x] - d[y]);
        if (targets.length) return { type: 'move', from: i, to: targets[0], units: u };
      }
    }
    // 6. Zum Zugende kleine Divisionen zu einer Armee je Provinz zusammenlegen
    for (const i of mine) if (C[i].divs.length >= 3) return { type: 'merge', cell: i, divs: C[i].divs.map(v => v.id) };
    return { type: 'end' };
  }

  function aiRespond(st, p, from) {
    const lvl = st.players[p].level || 'medium';
    if (aliveCount(st) <= 2) return 'decline';
    if (lvl === 'easy') return Math.random() < 0.5 ? 'accept' : 'decline';
    const counts = st.players.map((_, i) => stats(st, i).cells);
    let leader = -1;
    counts.forEach((n, i) => { if (st.players[i].alive && (leader < 0 || n > counts[leader])) leader = i; });
    if (lvl === 'medium') return from === leader && counts[from] > counts[p] * 1.3 ? 'decline' : 'accept';
    return counts[from] <= counts[p] * 1.1 || (leader !== from && leader !== p) ? 'accept' : 'decline';
  }

  global.K = {
    AI_CFG, divUnits, strongestType, createGame, generateWorld, applyAction, aiAction, aiRespond, stats, income, provinceYield, score, allied, odds, total, avail,
    moveTargets, mpOf, canBuild, canResearch, unitUnlocked, hasTech, isCity, defMult, hexNeighbor, hexXY, emptyU, addU, upkeepFor,
    COLORS, UNITS, TYPES, TERRAIN, PSIZE, BUILDINGS, TECHS, MAPS, SIZES, MODES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
