/* Kingdoms – Konto, Freunde, Chat, Einladungen und Battle Pass (Oberfläche).
   Braucht cloud.js (Online-Speicher); app.js meldet sich mit Social.init(Brücke) an. */
(() => {
  'use strict';
  const Cloud = window.Cloud;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let A = null; // Brücke zu app.js

  // ===================== Katalog: Saison, Belohnungen, Aufgaben =====================
  const SEASON = { id: 1, name: 'Zeit der Kronen', end: '2027-03-01T00:00:00' };
  const TIER_XP = 200, TIERS = 30, TASK_XP = 100;
  const TITLES = {
    knappe: 'der Knappe', bauer: 'Bauernfreund', burgherr: 'Burgherr', schild: 'Schildwall', belagerer: 'Belagerungsmeister',
    wunder: 'Wunderhüter', drache: 'Drachentöter', knoedel: 'Knödelkönig', unbesiegbar: 'der Unbesiegbare', welt: 'Weltenherrscher',
  };
  const FRAMES = { bronze: 'Bronze', silver: 'Silber', ivy: 'Efeu', frost: 'Frost', gold: 'Gold', flame: 'Flammen', royal: 'Königlich' };
  const CASTLES = { banner: 'Bannerburg', ice: 'Eisfestung', gold: 'Goldene Burg', dragon: 'Drachenhort' };
  const FX = { confetti: ['🎉', 'Konfetti-Sieg'], fireworks: ['🎆', 'Feuerwerk'], goldrain: ['🪙', 'Goldregen'] };
  const EMOTES = ['🍺', '🥨', '🐉', '👑', '🔥', '🏰'];
  const BASE_EMOTES = ['👍', '😂', '😡', '🤝', '⚔️', '😱'];
  // Stufe 1 … 30
  const TRACK = ['title:knappe', 'emote:🍺', 'frame:bronze', 'title:bauer', 'castle:banner', 'emote:🥨', 'fx:confetti', 'title:burgherr', 'frame:silver', 'castle:ice',
    'emote:🐉', 'title:schild', 'frame:ivy', 'title:belagerer', 'fx:fireworks', 'emote:👑', 'frame:frost', 'title:wunder', 'castle:gold', 'frame:gold',
    'emote:🔥', 'title:drache', 'fx:goldrain', 'frame:flame', 'title:knoedel', 'emote:🏰', 'title:unbesiegbar', 'castle:dragon', 'frame:royal', 'title:welt'];
  const KIND = { title: 'Titel', frame: 'Profilrahmen', castle: 'Burg-Stil', emote: 'Chat-Emote', fx: 'Siegeseffekt' };
  const SLOTS = ['title', 'frame', 'castle', 'fx'];
  const CAT = { title: TITLES, frame: FRAMES, castle: CASTLES, fx: FX };
  const split = id => { const i = id.indexOf(':'); return [id.slice(0, i), id.slice(i + 1)]; };
  const itemName = id => { const [k, v] = split(id); return k === 'emote' ? 'Emote ' + v : k === 'fx' ? FX[v][1] : CAT[k][v]; };
  const tierOf = id => TRACK.indexOf(id) + 1;
  // Wochenaufgaben: jede Woche 3 aus diesem Vorrat
  const TASKS = [
    { k: 'win2', t: 'Gewinne 2 Partien', n: 2, f: g => (g.won ? 1 : 0) },
    { k: 'play3', t: 'Spiele 3 Partien zu Ende', n: 3, f: () => 1 },
    { k: 'conq30', t: 'Erobere 30 Provinzen', n: 30, f: g => g.rec.conq || 0 },
    { k: 'kill150', t: 'Besiege 150 feindliche Einheiten', n: 150, f: g => g.rec.killed || 0 },
    { k: 'def6', t: 'Wehre 6 Angriffe ab', n: 6, f: g => g.rec.defended || 0 },
    { k: 'build20', t: 'Errichte 20 Gebäude', n: 20, f: g => g.rec.built || 0 },
    { k: 'rec60', t: 'Bilde 60 Truppen aus', n: 60, f: g => g.rec.recruited || 0 },
    { k: 'monst3', t: 'Erobere 3 Monsterhorte', n: 3, f: g => g.rec.monsters || 0 },
    { k: 'wonder', t: 'Halte am Ende einer Partie ein Weltwunder', n: 1, f: g => (g.wonders > 0 ? 1 : 0) },
    { k: 'online', t: 'Spiele eine Online-Partie mit Freunden', n: 1, f: g => (g.humans > 1 ? 1 : 0) },
    { k: 'hard', t: 'Gewinne gegen eine schwere KI', n: 1, f: g => (g.won && g.opp.some(o => o.level === 'hard') ? 1 : 0) },
    { k: 'big', t: 'Gewinne auf einer großen Welt', n: 1, f: g => (g.won && g.size === 'large' ? 1 : 0) },
  ];
  const WEEK0 = Date.UTC(2026, 0, 5); // ein Montag
  const weekNo = () => Math.floor((Date.now() - WEEK0) / 6048e5);
  const weekEnd = () => new Date(WEEK0 + (weekNo() + 1) * 6048e5);
  function rng(seed) {
    return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function weekTasks(w = weekNo()) {
    const r = rng(w * 7919 + SEASON.id * 31), pool = TASKS.slice(), out = [];
    while (out.length < 3) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  }
  const seasonOver = () => Date.now() >= Date.parse(SEASON.end);
  const levelOf = xp => Math.min(TIERS, Math.floor(xp / TIER_XP) + 1);
  const starsOf = xp => Math.max(0, Math.floor((xp - (TIERS - 1) * TIER_XP) / (TIER_XP * 2)));
  const today = () => new Date().toLocaleDateString('sv');
  const fmtDate = d => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });

  // ===================== Fortschritt (Gerät + Konto) =====================
  const PKEY = 'kingdoms-pass';
  const fresh = () => ({ s: SEASON.id, xp: 0, claimed: [], owned: [], eq: {}, wk: { w: weekNo(), p: {}, done: [] }, day: '', counted: [], owner: null });
  const arr = x => (Array.isArray(x) ? x : []);
  function norm(p) {
    const f = fresh();
    p = p && typeof p === 'object' ? p : {};
    const o = {
      s: +p.s || f.s, xp: Math.max(0, Math.floor(+p.xp || 0)),
      claimed: arr(p.claimed).filter(t => t >= 1 && t <= TIERS), owned: arr(p.owned).filter(id => TRACK.includes(id)),
      eq: {}, wk: p.wk && typeof p.wk === 'object' ? { w: +p.wk.w, p: { ...(p.wk.p || {}) }, done: arr(p.wk.done) } : f.wk,
      day: String(p.day || ''), counted: arr(p.counted).slice(-50), owner: p.owner || null,
    };
    for (const s of SLOTS) if (p.eq && p.eq[s] && o.owned.includes(s + ':' + p.eq[s])) o.eq[s] = p.eq[s];
    if (o.s !== SEASON.id) Object.assign(o, { s: SEASON.id, xp: 0, claimed: [] }); // neue Saison – Gesammeltes bleibt
    if (o.wk.w !== weekNo()) o.wk = { w: weekNo(), p: {}, done: [] };
    return o;
  }
  const union = (a, b) => [...new Set([...a, ...b])];
  // zwei Stände zusammenführen: 'add' = Gast-Fortschritt kommt zum Konto dazu, 'max' = derselbe Spieler auf zwei Geräten
  function combine(cloud, local, how) {
    const m = norm(cloud), l = norm(local);
    m.xp = how === 'add' ? m.xp + l.xp : Math.max(m.xp, l.xp);
    m.claimed = union(m.claimed, l.claimed); m.owned = union(m.owned, l.owned);
    m.counted = union(m.counted, l.counted).slice(-50);
    m.eq = { ...l.eq, ...m.eq };
    if (m.wk.w === l.wk.w) {
      for (const k in l.wk.p) m.wk.p[k] = how === 'add' ? (m.wk.p[k] || 0) + l.wk.p[k] : Math.max(m.wk.p[k] || 0, l.wk.p[k]);
      m.wk.done = union(m.wk.done, l.wk.done);
    }
    m.day = m.day > l.day ? m.day : l.day;
    return m;
  }
  let P = fresh();
  const loadPass = () => { try { return norm(JSON.parse(A.store.get(PKEY) || 'null')); } catch { return fresh(); } };
  const strip = p => { const { owner, ...rest } = p; return rest; };
  function savePass() {
    A.store.set(PKEY, JSON.stringify(P));
    if (Cloud.user && P.owner === Cloud.user.uid) Cloud.saveProfile({ pass: strip(P), eq: myCos() }).catch(e => console.warn(e));
    refresh();
  }
  const claimable = () => TRACK.map((id, i) => i + 1).filter(t => t <= levelOf(P.xp) && !P.claimed.includes(t));
  const myCos = () => { const c = {}; for (const s of SLOTS) if (P.eq[s]) c[s] = P.eq[s]; return c; };
  function cleanCos(c) {
    if (!c || typeof c !== 'object') return null;
    const o = {};
    for (const s of SLOTS) if (typeof c[s] === 'string' && CAT[s][c[s]] !== undefined) o[s] = c[s];
    return Object.keys(o).length ? o : null;
  }
  const titleHTML = c => (c && c.title && TITLES[c.title] ? `<small class="ptitle${c.title === 'welt' ? ' top' : ''}">${esc(TITLES[c.title])}</small>` : '');

  // ===================== XP am Spielende =====================
  function gameOver(g) {
    if (!g || !g.id || P.counted.includes(g.id)) return null;
    P.counted = [...P.counted, g.id].slice(-50);
    if (seasonOver()) { savePass(); return { xp: 0, html: '<div class="xpbox"><b>Die Saison ist vorbei</b><span class="tag">Die nächste Saison startet bald – deine Belohnungen behältst du.</span></div>' }; }
    const lines = [['🎮 Partie gespielt', 25], [`⏳ ${g.rounds} ${g.rounds === 1 ? 'Runde' : 'Runden'}`, 3 * Math.min(40, g.rounds)]];
    if (g.won) {
      lines.push([g.shared ? '🤝 Gemeinsamer Sieg' : '🏆 Sieg', g.shared ? 50 : 75]);
      const opp = g.opp.reduce((s, o) => s + (o.type === 'human' ? 15 : { easy: 3, medium: 8, hard: 12 }[o.level] || 5), 0);
      if (opp) lines.push(['⚔️ Stärke der Gegner', opp]);
    }
    const cq = Math.min(25, g.rec.conq || 0);
    if (cq) lines.push(['🚩 Eroberte Provinzen', cq]);
    if (g.humans > 1) lines.push(['👥 Online mit Freunden +20 %', Math.round(lines.reduce((s, l) => s + l[1], 0) * 0.2)]);
    if (g.won && P.day !== today()) { lines.push(['☀️ Erster Sieg des Tages', 50]); P.day = today(); }
    if (P.wk.w !== weekNo()) P.wk = { w: weekNo(), p: {}, done: [] };
    for (const t of weekTasks()) {
      if (P.wk.done.includes(t.k)) continue;
      P.wk.p[t.k] = Math.min(t.n, (P.wk.p[t.k] || 0) + t.f(g));
      if (P.wk.p[t.k] >= t.n) { P.wk.done.push(t.k); lines.push([`✅ Aufgabe: ${t.t}`, TASK_XP]); }
    }
    const gain = lines.reduce((s, l) => s + l[1], 0);
    const before = levelOf(P.xp);
    P.xp += gain;
    const after = levelOf(P.xp);
    savePass();
    uploadAcc();
    const pct = after >= TIERS ? 100 : Math.round((P.xp % TIER_XP) / TIER_XP * 100);
    const html = `<div class="xpbox">
      <div class="xphead"><b>+${gain} XP</b><span class="tag">🏆 Battle Pass · Stufe ${after}</span></div>
      <ul class="xplines">${lines.map(([t, v]) => `<li><span>${esc(t)}</span><b>+${v}</b></li>`).join('')}</ul>
      <div class="xpbar"><i style="width:${pct}%"></i></div>
      ${after > before ? `<p class="lvlup">⬆️ Stufe ${after} erreicht – ${after - before === 1 ? 'eine neue Belohnung wartet' : `${after - before} neue Belohnungen warten`}!</p>` : ''}
      <button class="ghost-btn" data-sopen="pass">🏆 Battle Pass öffnen</button></div>`;
    return { xp: gain, levelUp: after > before, html };
  }

  // Siegeseffekt aus dem Battle Pass
  function victoryFx(host) {
    const fx = P.eq.fx;
    if (!fx || !host || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = document.createElement('div');
    layer.className = 'vfx ' + fx;
    const R = (a, b) => a + Math.random() * (b - a);
    let h = '';
    if (fx === 'confetti') {
      const cols = ['#e8b64c', '#e5484d', '#3e8ef7', '#30a46c', '#9b5de5', '#fff'];
      for (let i = 0; i < 70; i++) h += `<i style="left:${R(0, 100)}%;background:${cols[i % cols.length]};animation-delay:${R(0, 1.6).toFixed(2)}s;--dx:${R(-60, 60).toFixed(0)}px;--rot:${R(200, 900).toFixed(0)}deg"></i>`;
    } else if (fx === 'fireworks') {
      const cols = ['#ffe2a0', '#ff7a7e', '#7fd0ff', '#b4f27a', '#e0a8ff'];
      for (let b = 0; b < 6; b++) {
        const x = R(15, 85), y = R(12, 50), c = cols[b % cols.length], d = (b * 0.45).toFixed(2);
        for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2, r = R(60, 110); h += `<i style="left:${x}%;top:${y}%;background:${c};animation-delay:${d}s;--tx:${(Math.cos(a) * r).toFixed(0)}px;--ty:${(Math.sin(a) * r).toFixed(0)}px"></i>`; }
      }
    } else if (fx === 'goldrain') {
      for (let i = 0; i < 40; i++) h += `<svg style="left:${R(0, 100)}%;animation-delay:${R(0, 2).toFixed(2)}s;--rot:${R(-300, 300).toFixed(0)}deg"><use href="#res-gold"/></svg>`;
    }
    layer.innerHTML = h;
    host.appendChild(layer);
    setTimeout(() => layer.remove(), 6500);
  }

  // ===================== Zusammenführen beim Anmelden =====================
  let initFor = null, pendingName = '', loginAction = false, nameErr = '';
  async function onLogin(p) {
    const u = Cloud.user, loc = A.getProfile();
    if (!p || !p.name) {
      // neues Konto: Spielernamen sichern, dann das Profil von diesem Gerät mitnehmen
      const want = pendingName || (loc.name !== 'Spieler' ? loc.name : '');
      pendingName = '';
      await Cloud.saveProfile({ avatar: loc.avatar || null, color: loc.color, realm: loc.realm || '', cap: loc.cap || '', bots: loc.bots || '', created: Date.now() }).catch(e => console.warn(e));
      if (!want) { nameErr = ''; open('name'); }
      else try { await Cloud.claimName(want); } catch (e) { nameErr = Cloud.why(e); open('name'); }
    } else {
      A.applyProfile(p);
    }
    // Battle Pass
    const local = loadPass(), cloud = p && p.pass ? p.pass : null;
    P = norm(!cloud ? local : local.owner === u.uid ? combine(cloud, local, 'max') : !local.owner ? combine(cloud, local, 'add') : cloud);
    P.owner = u.uid;
    savePass();
    // Statistik
    const la = A.accGet(), lo = A.store.get('kingdoms-acc-owner') || '';
    let acc = p && p.acc ? p.acc : null;
    if (!acc) acc = la;
    else if (!lo) acc = addAcc(acc, la);
    else if (lo === u.uid && (la.games || 0) > (acc.games || 0)) acc = la;
    A.accSet(acc || {});
    A.store.set('kingdoms-acc-owner', u.uid);
    uploadAcc();
    if (loginAction) { loginAction = false; A.toast(`☁️ Angemeldet${p && p.name ? ' als ' + p.name : ''} – dein Profil gilt jetzt überall.`); }
  }
  function addAcc(a, b) {
    const o = { ...a };
    for (const k in b) {
      if (k === 'counted') o.counted = union(arr(a.counted), arr(b.counted)).slice(-30);
      else if (k === 'best') o.best = Math.max(a.best || 0, b.best || 0);
      else if (typeof b[k] === 'number') o[k] = (a[k] || 0) + b[k];
    }
    return o;
  }
  function uploadAcc() { if (Cloud.user && initFor === Cloud.user.uid) Cloud.saveProfile({ acc: A.accGet() }).catch(e => console.warn(e)); }
  // Änderungen von einem anderen Gerät übernehmen
  function applyRemote(p) {
    if (!p) return;
    A.applyProfile(p);
    if (p.pass) {
      const m = norm(p.pass);
      m.xp = Math.max(m.xp, P.xp); m.claimed = union(m.claimed, P.claimed); m.owned = union(m.owned, P.owned); m.counted = union(m.counted, P.counted).slice(-50);
      m.owner = P.owner;
      P = m;
      A.store.set(PKEY, JSON.stringify(P));
    }
  }
  function onLogout() {
    P = fresh();
    A.store.set(PKEY, JSON.stringify(P));
    A.accSet({});
    A.store.set('kingdoms-acc-owner', '');
  }

  // ===================== Oberfläche =====================
  let view = null, chatWith = null, chatUnsub = null, passTab = 'track', authMode = 'login';
  const myName = () => (Cloud.profile && Cloud.profile.name) || A.getProfile().name;
  const fProf = f => (f && f.prof) || {};
  const fName = uid => { const f = Cloud.friends.get(uid); return (f && f.prof && f.prof.name) || 'Freund'; };
  const ago = t => {
    if (!t) return 'offline';
    const m = Math.round((Date.now() - t) / 60e3);
    return m < 60 ? `zuletzt vor ${Math.max(1, m)} Min.` : m < 1440 ? `zuletzt vor ${Math.round(m / 60)} Std.` : `zuletzt vor ${Math.round(m / 1440)} ${Math.round(m / 1440) === 1 ? 'Tag' : 'Tagen'}`;
  };
  const STATUS = { menu: '🟢 online', lobby: '🟢 in einem Raum', game: '🎮 spielt gerade' };
  const socialCount = () => Cloud.requests.length + Cloud.invites.length + [...Cloud.friends.keys()].filter(uid => Cloud.unread(uid)).length;
  const onlineFriends = () => [...Cloud.friends.values()].filter(f => Cloud.presenceOf(f)).length;

  function renderBar() {
    const el = $('#socialBar');
    if (!el || !A) return;
    const u = Cloud.user, lp = A.getProfile();
    let acct;
    if (!Cloud.enabled) acct = '<div class="acct-txt"><b>🔐 Konto</b><span class="tag">Konten sind noch nicht eingerichtet – dein Battle Pass zählt solange auf diesem Gerät.</span></div>';
    else if (Cloud.failed) acct = `<div class="acct-txt"><b>🔐 Konto</b><span class="tag">${esc(Cloud.failed)}</span></div>`;
    else if (!Cloud.ready) acct = '<div class="acct-txt"><span class="tag">☁️ Verbinde mit dem Konto-Server…</span></div>';
    else if (!u) acct = '<div class="acct-txt"><b>🔐 Konto</b><span class="tag">Melde dich an – dann hast du auf jedem Gerät dasselbe Profil, deine Freunde und deinen Battle Pass.</span></div><button class="primary" data-sopen="login">Anmelden</button>';
    else {
      const noName = Cloud.profile !== undefined && !(Cloud.profile && Cloud.profile.name);
      acct = `${A.avatarHTML(lp.avatar, myName(), lp.color, 'sm', myCos())}<div class="acct-txt"><b>${esc(myName())}</b>${titleHTML(myCos())}
        <span class="tag">☁️ angemeldet${u.email ? ' · ' + esc(u.email) : ''}</span></div>
        ${noName ? '<button class="primary" data-sopen="name">Namen wählen</button>' : '<button class="ghost-btn" data-sopen="account">Konto</button>'}`;
    }
    const n = u ? socialCount() : 0, on = u ? onlineFriends() : 0, cl = claimable().length;
    el.innerHTML = `<div class="acct">${acct}</div>
      <div class="sbtns">
        <button class="sbtn" data-sopen="friends"><span class="si">👥</span><span><b>Freunde</b><small>${u ? (on ? `${on} online` : `${Cloud.friends.size} ${Cloud.friends.size === 1 ? 'Freund' : 'Freunde'}`) : 'Chat & Einladungen'}</small></span>${n ? `<i class="sbadge">${n > 9 ? '9+' : n}</i>` : ''}</button>
        <button class="sbtn" data-sopen="pass"><span class="si">🏆</span><span><b>Battle Pass</b><small>Stufe ${levelOf(P.xp)} von ${TIERS}</small></span>${cl ? `<i class="sbadge gold" title="Belohnungen abholen">${cl}</i>` : ''}</button>
      </div>`;
    const inv = $('#btnInviteFriends');
    if (inv) inv.hidden = !Cloud.enabled;
    const gmf = $('#gmFriends');
    if (gmf) gmf.textContent = n ? `Freunde (${n} neu)` : 'Freunde';
  }

  function open(v) {
    if (v === 'friends' && !Cloud.user) v = Cloud.enabled ? 'login' : 'nocloud';
    if (chatUnsub && !String(v).startsWith('chat:')) { chatUnsub(); chatUnsub = null; chatWith = null; }
    view = v;
    $('#social').hidden = false;
    renderView(true);
  }
  function close() {
    $('#social').hidden = true;
    if (chatUnsub) { chatUnsub(); chatUnsub = null; }
    chatWith = null; view = null;
  }

  function renderView(full) {
    if (!view || $('#social').hidden) return;
    const o = $('#social');
    if (view === 'friends') {
      if (full || !$('#sfList')) o.innerHTML = friendsShell();
      $('#sfList').innerHTML = friendsList();
    } else if (view.startsWith('chat:')) {
      const uid = view.slice(5);
      if (full || !$('#fchat')) { o.innerHTML = chatShell(uid); startChat(uid); $('#fchatIn').focus(); }
      else $('#fchatHead').innerHTML = chatHead(uid);
    } else if (view === 'pass') {
      if (full || !$('#ptab')) o.innerHTML = passShell();
      else $('#ptop').innerHTML = passTop();
      $('#ptab').innerHTML = passTab === 'tasks' ? passTasks() : passTab === 'coll' ? passColl() : passTrack();
      if (passTab === 'track' && full) { const cur = $(`.ptier[data-tier="${Math.min(TIERS, levelOf(P.xp) + 1)}"]`); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    } else if (!full) return;
    else if (view === 'login') o.innerHTML = loginView();
    else if (view === 'name') o.innerHTML = nameView();
    else if (view === 'account') o.innerHTML = accountView();
    else if (view === 'nocloud') o.innerHTML = `<div class="modal center"><h2>👥 Freunde</h2><p>Für Freunde, Chat und Einladungen braucht Kingdoms Konten – die sind noch nicht eingerichtet.</p><div class="row"><button data-sclose class="primary">OK</button></div></div>`;
  }

  // ---------- Anmelden ----------
  function loginView() {
    const reg = authMode === 'register';
    return `<div class="modal social-m">
      <div class="mhead"><h2>🔐 ${reg ? 'Konto erstellen' : 'Anmelden'}</h2><button data-sclose class="ghost" title="Schließen">✕</button></div>
      <div class="seg"><button data-amode="login" class="${reg ? '' : 'on'}">Anmelden</button><button data-amode="register" class="${reg ? 'on' : ''}">Neues Konto</button></div>
      <form id="sAuth" class="sform" novalidate>
        ${reg ? `<label class="field">Spielername <small class="tag">einmalig – so finden dich deine Freunde</small><input id="saName" maxlength="16" value="${esc(A.getProfile().name === 'Spieler' ? '' : A.getProfile().name)}" autocomplete="nickname"></label>` : ''}
        <label class="field">E-Mail<input id="saMail" type="email" autocomplete="email" inputmode="email"></label>
        <label class="field">Passwort${reg ? ' <small class="tag">mindestens 6 Zeichen</small>' : ''}<input id="saPw" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
        <p class="serr" id="saErr" hidden></p>
        <button class="primary big">${reg ? 'Konto erstellen' : 'Anmelden'}</button>
      </form>
      <div class="or"><span>oder</span></div>
      <button class="gbtn" data-sgoogle><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg> Mit Google anmelden</button>
      ${reg ? '' : '<button class="ghost-btn" data-sreset>Passwort vergessen?</button>'}
      ${Cloud.mock ? '<p class="tag">🧪 Test-Modus: Konten liegen nur in diesem Browser.</p>' : ''}
    </div>`;
  }
  const showErr = (id, msg) => { const e = $(id); if (e) { e.textContent = msg; e.hidden = !msg; } };
  async function submitAuth() {
    const reg = authMode === 'register', mail = $('#saMail').value.trim(), pw = $('#saPw').value;
    const btn = $('#sAuth button.primary');
    showErr('#saErr', '');
    if (reg) {
      const nm = Cloud.cleanName($('#saName').value);
      if (nm.length < 2) return showErr('#saErr', 'Wähle einen Spielernamen (mindestens 2 Zeichen).');
      pendingName = nm;
    }
    btn.disabled = true;
    loginAction = true;
    try { await (reg ? Cloud.signUp(mail, pw) : Cloud.signIn(mail, pw)); close(); }
    catch (e) { loginAction = false; showErr('#saErr', Cloud.why(e)); }
    finally { if (btn.isConnected) btn.disabled = false; }
  }

  function nameView() {
    return `<div class="modal social-m">
      <div class="mhead"><h2>✍️ Dein Spielername</h2><button data-sclose class="ghost" title="Später">✕</button></div>
      <p class="tag">Jeder Name kommt nur einmal vor – damit finden dich deine Freunde.</p>
      <form id="sName" class="sform"><input id="snIn" maxlength="16" value="${esc(A.getProfile().name === 'Spieler' ? '' : A.getProfile().name)}" autocomplete="nickname">
        <p class="serr" id="snErr" ${nameErr ? '' : 'hidden'}>${esc(nameErr)}</p><button class="primary">Speichern</button></form></div>`;
  }
  async function submitName() {
    const nm = $('#snIn').value;
    try { const n = await Cloud.claimName(nm); nameErr = ''; A.applyProfile({ name: n }); close(); A.toast(`✅ Du heißt jetzt ${n}.`); }
    catch (e) { nameErr = Cloud.why(e); showErr('#snErr', nameErr); }
  }

  function accountView() {
    const lp = A.getProfile(), u = Cloud.user;
    return `<div class="modal social-m center">
      <div class="mhead"><h2>☁️ Dein Konto</h2><button data-sclose class="ghost" title="Schließen">✕</button></div>
      ${A.avatarHTML(lp.avatar, myName(), lp.color, 'big', myCos())}
      <div><b class="bigname">${esc(myName())}</b>${titleHTML(myCos())}</div>
      <span class="tag">${u && u.email ? esc(u.email) : ''}${u && u.google ? ' · Google' : ''}</span>
      <p class="tag">Name, Bild, Farbe und Reich änderst du wie immer im Hauptmenü – alles wird mit deinem Konto gespeichert, genau wie Statistik und Battle Pass.</p>
      <div class="row"><button data-sopen="pass">🏆 Battle Pass</button><button data-sopen="friends">👥 Freunde</button></div>
      <button class="danger" data-slogout>Abmelden</button>
    </div>`;
  }

  // ---------- Freunde ----------
  function friendsShell() {
    return `<div class="modal social-m">
      <div class="mhead"><h2>👥 Freunde</h2><button data-sclose class="ghost" title="Schließen">✕</button></div>
      <form id="sfAdd" class="row"><input id="sfName" maxlength="16" placeholder="Spielername eines Freundes" autocomplete="off"><button class="primary">Hinzufügen</button></form>
      <p class="tag">Dein Spielername ist <b>${esc(myName())}</b> – den brauchen deine Freunde, um dich zu finden.</p>
      <div id="sfList"></div></div>`;
  }
  function friendsList() {
    const room = A.room(), canInvite = room && !room.inGame;
    const reqs = Cloud.requests.map(r => `<li class="freq"><span>👋 <b>${esc(r.name || '?')}</b> möchte dein Freund sein</span>
      <button class="primary" data-facc="${esc(r.id)}">Annehmen</button><button data-fdec="${esc(r.id)}" title="Ablehnen">✕</button></li>`).join('');
    const list = [...Cloud.friends.values()].sort((a, b) => (!!Cloud.presenceOf(b) - !!Cloud.presenceOf(a)) || String(fProf(a).name).localeCompare(String(fProf(b).name)));
    const rows = list.map(f => {
      const p = fProf(f), st = Cloud.presenceOf(f), un = Cloud.unread(f.uid);
      return `<li class="fr ${st ? 'on' : ''}">
        <button class="fr-main" data-fchat="${esc(f.uid)}" title="Nachricht schreiben">${A.avatarHTML(p.avatar, p.name || '?', p.color || '#888', 'sm', cleanCos(p.eq))}
          <span class="fr-n"><b>${esc(p.name || '…')}</b>${titleHTML(cleanCos(p.eq))}<small class="fst">${st ? STATUS[st] : esc(ago(f.pres && f.pres.seen))}</small></span>
          ${un ? '<i class="sbadge">💬</i>' : ''}</button>
        ${canInvite ? `<button data-finv="${esc(f.uid)}" class="primary" title="In deinen Raum ${esc(room.code)} einladen">🎮 Einladen</button>` : ''}
        <button data-fchat="${esc(f.uid)}" title="Nachricht schreiben">💬</button>
        <button data-frm="${esc(f.uid)}" class="ghost" title="Freund entfernen">✕</button></li>`;
    }).join('');
    const hint = room && !room.inGame ? `<p class="hint">🎮 Du bist in Raum <b class="code">${esc(room.code)}</b> – lade Freunde direkt ein.</p>`
      : '<p class="tag">💡 Erstelle unter „Mit Freunden“ einen Raum – dann kannst du Freunde hier mit einem Klick einladen.</p>';
    return `${reqs ? `<h3>Anfragen</h3><ul class="flist">${reqs}</ul>` : ''}
      <h3>Deine Freunde${list.length ? ` (${list.length})` : ''}</h3>
      ${rows ? `<ul class="flist">${rows}</ul>` : '<p class="tag">Noch keine Freunde. Gib oben den Spielernamen eines Freundes ein. Sobald er annimmt, seht ihr euch hier, könnt euch schreiben und in Räume einladen.</p>'}
      ${hint}`;
  }
  async function addFriend() {
    const inp = $('#sfName'), nm = inp.value.trim();
    if (nm.length < 2) return A.toast('Gib den Spielernamen deines Freundes ein.');
    try {
      const u = await Cloud.findUser(nm);
      if (!u) return A.toast(`Niemand heißt „${nm}“. Genau so geschrieben?`);
      const r = await Cloud.request(u.uid);
      inp.value = '';
      A.toast(r === 'friends' ? `🤝 Du und ${u.name} seid jetzt Freunde!` : `📨 Anfrage an ${u.name} geschickt.`);
    } catch (e) { A.toast(Cloud.why(e)); }
  }

  // ---------- Chat ----------
  const chatHead = uid => {
    const f = Cloud.friends.get(uid), p = fProf(f), st = Cloud.presenceOf(f);
    return `${A.avatarHTML(p.avatar, p.name || '?', p.color || '#888', 'sm', cleanCos(p.eq))}<span class="fr-n"><b>${esc(p.name || 'Freund')}</b><small class="fst">${st ? STATUS[st] : esc(ago(f && f.pres && f.pres.seen))}</small></span>`;
  };
  function chatShell(uid) {
    const room = A.room();
    return `<div class="modal social-m chat-m">
      <div class="mhead"><button data-sopen="friends" class="ghost" title="Zurück">←</button><div class="chat-who" id="fchatHead">${chatHead(uid)}</div>
        ${room && !room.inGame ? `<button data-finv="${esc(uid)}" class="primary" title="In Raum ${esc(room.code)} einladen">🎮</button>` : ''}<button data-sclose class="ghost" title="Schließen">✕</button></div>
      <div class="fchat" id="fchat"><p class="tag">Lade Nachrichten…</p></div>
      <form id="fchatForm" class="row"><input id="fchatIn" maxlength="500" placeholder="Nachricht an ${esc(fName(uid))}…" autocomplete="off"><button class="primary" title="Senden">➤</button></form></div>`;
  }
  function startChat(uid) {
    if (chatUnsub) chatUnsub();
    chatWith = uid;
    chatUnsub = Cloud.watchMessages(uid, msgs => {
      const box = $('#fchat');
      if (!box || chatWith !== uid) return;
      const me = Cloud.user && Cloud.user.uid;
      let lastDay = '';
      box.innerHTML = msgs.length ? msgs.map(m => {
        const d = new Date(m.at), day = d.toLocaleDateString('de-DE');
        const sep = day !== lastDay ? `<div class="cday">${day === new Date().toLocaleDateString('de-DE') ? 'Heute' : esc(day)}</div>` : '';
        lastDay = day;
        return `${sep}<div class="bub ${m.from === me ? 'mine' : ''}"><span>${esc(m.text)}</span><small>${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</small></div>`;
      }).join('') : `<p class="tag">Noch keine Nachrichten. Sag hallo! 👋</p>`;
      box.scrollTop = box.scrollHeight;
      Cloud.markRead(uid);
    });
  }

  // ---------- Battle Pass ----------
  function preview(id) {
    const [k, v] = split(id), lp = A.getProfile();
    if (k === 'title') return `<span class="pv-title">${esc(TITLES[v])}</span>`;
    if (k === 'frame') return A.avatarHTML(lp.avatar, myName(), lp.color, 'tp', { frame: v });
    if (k === 'castle') return `<svg class="pv-castle" viewBox="0 -4 64 58"><use href="#capital-${v}" width="64" height="54" style="color:${esc(lp.color)}"/></svg>`;
    if (k === 'fx') return `<span class="pv-emo">${FX[v][0]}</span>`;
    return `<span class="pv-emo">${v}</span>`;
  }
  function passTop() {
    const lvl = levelOf(P.xp), max = lvl >= TIERS, inLvl = P.xp - (lvl - 1) * TIER_XP, cl = claimable().length;
    const end = new Date(SEASON.end), days = Math.max(0, Math.ceil((end - Date.now()) / 864e5)), st = starsOf(P.xp);
    return `<div class="lvl"><small>Stufe</small><b>${lvl}</b></div>
      <div class="pass-info"><b>Saison ${SEASON.id}: ${esc(SEASON.name)}</b>
        <span class="tag">${seasonOver() ? 'Die Saison ist vorbei – die nächste startet bald.' : `endet am ${fmtDate(new Date(end - 1))} · noch ${days} ${days === 1 ? 'Tag' : 'Tage'}`}</span>
        <div class="xpbar"><i style="width:${max ? 100 : Math.round(inLvl / TIER_XP * 100)}%"></i></div>
        <span class="tag">${max ? `Alle Stufen geschafft! ${st ? `⭐ ×${st} Bonus-Sterne` : 'Weitere XP bringen Bonus-Sterne.'}` : `${inLvl} / ${TIER_XP} XP bis Stufe ${lvl + 1}`} · insgesamt ${P.xp} XP</span></div>
      ${cl ? `<button class="primary" data-pclaimall>🎁 ${cl === 1 ? 'Belohnung' : cl + ' Belohnungen'} abholen</button>` : ''}`;
  }
  function passShell() {
    const tab = (k, l) => `<button data-ptab="${k}" class="${passTab === k ? 'on' : ''}">${l}</button>`;
    return `<div class="modal wide pass-m">
      <div class="mhead"><h2>🏆 Battle Pass</h2><button data-sclose class="ghost" title="Schließen">✕</button></div>
      <div class="pass-top" id="ptop">${passTop()}</div>
      <div class="seg ptabs">${tab('track', '🎁 Belohnungen')}${tab('tasks', '📜 Aufgaben')}${tab('coll', '🎒 Sammlung')}</div>
      <div id="ptab"></div>
      ${Cloud.enabled && !Cloud.user ? '<p class="tag">💡 <button class="linkbtn" data-sopen="login">Melde dich an</button>, dann zählt dein Fortschritt auf allen Geräten.</p>' : ''}
    </div>`;
  }
  function passTrack() {
    const lvl = levelOf(P.xp);
    return `<div class="ptrack">${TRACK.map((id, i) => {
      const t = i + 1, [k] = split(id), done = P.claimed.includes(t), can = !done && t <= lvl;
      return `<div class="ptier ${done ? 'done' : can ? 'claim' : 'lock'} ${t % 5 === 0 ? 'major' : ''}" data-tier="${t}">
        <span class="pt-n">${t}</span><div class="pt-prev">${preview(id)}</div>
        <b>${esc(itemName(id))}</b><small>${KIND[k]}</small>
        ${done ? '<span class="pt-ok">✓ abgeholt</span>' : can ? `<button class="primary" data-pclaim="${t}">Abholen</button>` : `<span class="pt-lock">🔒 ${(t - 1) * TIER_XP} XP</span>`}
      </div>`;
    }).join('')}</div><p class="tag">XP gibt es für jede Partie: fürs Spielen, für jede Runde, für Siege und Eroberungen – und für die Aufgaben der Woche.</p>`;
  }
  function passTasks() {
    const tasks = weekTasks(), dn = P.day === today();
    return `<div class="ptasks"><h3>Aufgaben dieser Woche</h3><span class="tag">Neue Aufgaben am ${esc(weekEnd().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
      ${tasks.map(t => { const p = Math.min(t.n, P.wk.p[t.k] || 0), d = P.wk.done.includes(t.k); return `<div class="task ${d ? 'done' : ''}"><div class="grow"><b>${d ? '✅ ' : ''}${esc(t.t)}</b>
        <div class="xpbar"><i style="width:${Math.round(p / t.n * 100)}%"></i></div><small class="tag">${p} / ${t.n}</small></div><b class="tx">+${TASK_XP} XP</b></div>`; }).join('')}
      <div class="task ${dn ? 'done' : ''}"><div class="grow"><b>${dn ? '✅ ' : ''}☀️ Erster Sieg des Tages</b><small class="tag">${dn ? 'Heute geschafft – morgen wieder!' : 'Gewinne heute eine Partie.'}</small></div><b class="tx">+50 XP</b></div>
      <h3>So bekommst du XP</h3>
      <ul class="xprules"><li>🎮 jede Partie: <b>25 XP</b> + <b>3 XP</b> pro Runde</li><li>🏆 Sieg: <b>75 XP</b> + Bonus je nach Gegnern (Freunde und schwere KI zählen mehr)</li>
        <li>🚩 je eroberte Provinz: <b>1 XP</b> (bis 25)</li><li>👥 Online mit Freunden: <b>+20 %</b></li><li>Alle ${TIER_XP} XP steigst du eine Stufe auf.</li></ul></div>`;
  }
  function passColl() {
    const groups = SLOTS.concat('emote').map(k => {
      const items = TRACK.filter(id => split(id)[0] === k);
      const none = k !== 'emote' ? `<button class="citem ${!P.eq[k] ? 'on' : ''}" data-peq="${k}:"><span class="pv-emo">∅</span><small>ohne</small></button>` : '';
      return `<h3>${KIND[k]}${k === 'emote' ? ' <small class="tag">– freigeschaltete Emotes erscheinen im Spiel-Chat</small>' : ''}</h3><div class="coll">${none}${items.map(id => {
        const own = P.owned.includes(id), on = k !== 'emote' && P.eq[k] === split(id)[1];
        return `<button class="citem ${on ? 'on' : ''} ${own ? '' : 'locked'}" ${k !== 'emote' ? `data-peq="${esc(id)}"` : ''} ${own ? '' : 'disabled'} title="${esc(itemName(id))}">
          ${preview(id)}<small>${own ? (on ? '✓ ' : '') + esc(itemName(id)) : `🔒 Stufe ${tierOf(id)}`}</small></button>`;
      }).join('')}</div>`;
    }).join('');
    return `<div class="pcoll"><p class="tag">Was du freigeschaltet hast, sehen alle im Spiel: Titel und Rahmen in der Lobby und bei den Reichen, den Burg-Stil auf deiner Hauptstadt, den Siegeseffekt am Ende.</p>${groups}</div>`;
  }
  function claim(ts) {
    const got = [];
    for (const t of ts) {
      if (P.claimed.includes(t) || t > levelOf(P.xp)) continue;
      P.claimed.push(t);
      const id = TRACK[t - 1];
      if (!P.owned.includes(id)) P.owned.push(id);
      const [k, v] = split(id);
      if (SLOTS.includes(k) && !P.eq[k]) P.eq[k] = v;
      got.push(id);
    }
    if (!got.length) return;
    savePass();
    A.Sound.play('victory');
    A.toast(got.length === 1 ? `🎁 ${itemName(got[0])} freigeschaltet!` : `🎁 ${got.length} Belohnungen freigeschaltet!`);
    A.profileChanged();
  }

  // ---------- Einladungen ----------
  const dismissed = new Set();
  function renderInvite() {
    const el = $('#invitePop');
    if (!el) return;
    const room = A.room();
    for (const i of Cloud.invites) if (room && room.code === i.code && !dismissed.has(i.id)) { dismissed.add(i.id); Cloud.dropInvite(i.id).catch(() => {}); }
    const inv = Cloud.user ? Cloud.invites.find(i => !dismissed.has(i.id)) : null;
    if (!inv) { el.hidden = true; return; }
    el.innerHTML = `<span class="ip-ico">🎮</span><div><b>${esc(inv.name || 'Ein Freund')}</b> lädt dich zum Spielen ein!<small class="tag">Raum ${esc(inv.code)}</small></div>
      <div class="row"><button class="primary" data-ijoin="${esc(inv.id)}">Beitreten</button><button data-ino="${esc(inv.id)}">Später</button></div>`;
    if (el.hidden) { el.hidden = false; A.Sound.play('turn'); }
  }

  // ---------- Ereignisse vom Server ----------
  let seenReq = null, seenChat = null;
  function refresh() { if (!A) return; renderBar(); renderView(false); renderInvite(); }
  Cloud.on('auth', u => {
    if (!u) { if (initFor || P.owner) { onLogout(); if (initFor) A.toast('Abgemeldet.'); } initFor = null; seenReq = null; seenChat = null; if (view && view !== 'login' && view !== 'pass') close(); }
    refresh();
  });
  Cloud.on('profile', async p => {
    const u = Cloud.user;
    if (!u) return;
    if (initFor !== u.uid) { initFor = u.uid; await onLogin(p); }
    else applyRemote(p);
    refresh();
  });
  Cloud.on('friends', refresh);
  Cloud.on('requests', () => {
    if (seenReq) for (const r of Cloud.requests) if (!seenReq.has(r.id)) { A.toast(`👋 ${r.name || 'Jemand'} möchte dein Freund sein – siehe 👥 Freunde.`); A.Sound.play('click'); }
    seenReq = new Set(Cloud.requests.map(r => r.id));
    refresh();
  });
  Cloud.on('invites', refresh);
  Cloud.on('chats', () => {
    const me = Cloud.user && Cloud.user.uid;
    if (seenChat) {
      for (const [uid, c] of Cloud.chats) {
        if (!c.last || c.last.from === me || c.last.at <= (seenChat.get(uid) || 0)) continue;
        if (chatWith === uid && !$('#social').hidden) continue;
        A.toast(`💬 ${fName(uid)}: ${c.last.text}`);
        A.Sound.play('click');
      }
    }
    seenChat = new Map([...Cloud.chats].map(([uid, c]) => [uid, c.last ? c.last.at : 0]));
    refresh();
  });

  // ---------- Klicks und Formulare ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-sopen]');
    if (b) { e.preventDefault(); A.closeOverlays && A.closeOverlays(b); open(b.dataset.sopen); }
  });
  function wire() {
    const o = $('#social');
    o.addEventListener('click', async e => {
      if (e.target === o || e.target.closest('[data-sclose]')) return close();
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.amode) { authMode = d.amode; renderView(true); }
      else if (d.sgoogle !== undefined) {
        loginAction = true;
        try { await Cloud.google($('#saMail') && $('#saMail').value); close(); } catch (er) { loginAction = false; showErr('#saErr', Cloud.why(er)); }
      } else if (d.sreset !== undefined) {
        const m = $('#saMail').value.trim();
        if (!m) return showErr('#saErr', 'Gib oben deine E-Mail ein – dann schicken wir dir einen Link zum Zurücksetzen.');
        try { await Cloud.resetPassword(m); showErr('#saErr', ''); A.toast('📧 Wir haben dir eine E-Mail zum Zurücksetzen geschickt.'); } catch (er) { showErr('#saErr', Cloud.why(er)); }
      } else if (d.slogout !== undefined) { if (await A.ask('Abmelden? Dein Fortschritt bleibt im Konto gespeichert.', 'Abmelden')) { close(); await Cloud.signOut(); } }
      else if (d.facc) { try { await Cloud.accept(d.facc); A.toast('🤝 Ihr seid jetzt Freunde!'); } catch (er) { A.toast(Cloud.why(er)); } }
      else if (d.fdec) Cloud.decline(d.fdec).catch(er => A.toast(Cloud.why(er)));
      else if (d.frm) { if (await A.ask(`${esc(fName(d.frm))} als Freund entfernen?`, 'Entfernen')) Cloud.unfriend(d.frm).catch(er => A.toast(Cloud.why(er))); }
      else if (d.fchat) { view = 'chat:' + d.fchat; renderView(true); }
      else if (d.finv) {
        const room = A.room();
        if (!room || room.inGame) return A.toast('Erstelle zuerst einen Raum – dann kannst du einladen.');
        try { await Cloud.invite(d.finv, room.code); A.toast(`📨 Einladung an ${fName(d.finv)} geschickt.`); b.disabled = true; } catch (er) { A.toast(Cloud.why(er)); }
      } else if (d.ptab) { passTab = d.ptab; renderView(true); }
      else if (d.pclaim) claim([+d.pclaim]);
      else if (d.pclaimall !== undefined) claim(claimable());
      else if (d.peq !== undefined) {
        const [k, v] = split(d.peq);
        if (v && !P.owned.includes(d.peq)) return;
        if (v) P.eq[k] = v; else delete P.eq[k];
        savePass(); A.Sound.play('click'); A.profileChanged();
      }
    });
    o.addEventListener('submit', e => {
      e.preventDefault();
      if (e.target.id === 'sAuth') submitAuth();
      else if (e.target.id === 'sName') submitName();
      else if (e.target.id === 'sfAdd') addFriend();
      else if (e.target.id === 'fchatForm') {
        const inp = $('#fchatIn'), t = inp.value.trim();
        if (!t || !chatWith) return;
        inp.value = '';
        Cloud.send(chatWith, t).catch(er => { A.toast(Cloud.why(er)); inp.value = t; });
      }
    });
    $('#invitePop').addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      const inv = Cloud.invites.find(i => i.id === (b.dataset.ijoin || b.dataset.ino));
      if (!inv) return;
      dismissed.add(inv.id);
      $('#invitePop').hidden = true;
      Cloud.dropInvite(inv.id).catch(() => {});
      if (b.dataset.ijoin) { close(); A.joinRoom(inv.code); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#social').hidden) close(); });
  }

  // ===================== Anbindung an app.js =====================
  window.Social = {
    cleanCos, titleHTML,
    frameOf: c => (c && c.frame && FRAMES[c.frame] ? c.frame : ''),
    castleOf: c => (c && c.castle && CASTLES[c.castle] ? c.castle : ''),
    cos: () => cleanCos(myCos()),
    emotes: () => BASE_EMOTES.concat(EMOTES.filter(e => P.owned.includes('emote:' + e))),
    gameOver, victoryFx, open,
    signedIn: () => !!Cloud.user,
    onScreen(id) { Cloud.setStatus(id === 'game' ? 'game' : id === 'lobby' ? 'lobby' : 'menu'); refresh(); },
    // Profilfelder im Hauptmenü geändert
    profileEdited(field) {
      if (!Cloud.user || initFor !== Cloud.user.uid) return;
      const lp = A.getProfile();
      if (field === 'name') {
        Cloud.claimName(lp.name).then(n => { if (n !== lp.name) A.applyProfile({ name: n }); refresh(); })
          .catch(e => { A.toast(Cloud.why(e)); if (Cloud.profile && Cloud.profile.name) A.applyProfile({ name: Cloud.profile.name }); });
      } else {
        const map = { avatar: 'avatar', color: 'color', realm: 'realm', cap: 'cap', bots: 'bots' };
        if (map[field]) Cloud.saveProfile({ [map[field]]: field === 'avatar' ? lp.avatar || null : lp[field] || '' }).catch(e => console.warn(e));
      }
      refresh();
    },
    statsSaved: uploadAcc,
    init(bridge) {
      A = bridge;
      P = loadPass();
      wire();
      refresh();
      Cloud.start().then(refresh);
    },
  };
})();
