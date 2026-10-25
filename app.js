/* Kingdoms – Oberfläche, Menüs, Tutorial und Online-Räume.
   Online: Der Browser des Gastgebers verwaltet das Spiel (inkl. KI), Gäste verbinden sich per WebRTC (PeerJS). */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const LEVELS = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };
  const BOT_NAMES = ['Graf Bruno', 'Lady Mira', 'König Otto', 'Baronin Ilse', 'Ritter Kunz', 'Herzogin Wanda', 'Fürst Egon', 'Gräfin Liv'];
  const ID_PREFIX = 'kingdoms-game-';
  const BOT_REALMS = ['Eisenkrone', 'Sonnenthal', 'Rabenfels', 'Goldküste', 'Sturmwacht', 'Wolfsland', 'Silberau', 'Nebelmark'];
  const BLDG_ORDER = ['farm', 'lumber', 'quarry', 'granary', 'mine', 'harbor', 'library', 'market', 'temple', 'caravan', 'tower', 'barracks', 'fort'];
  const BUILD_CATS = { eco: ['farm', 'lumber', 'quarry', 'granary', 'mine', 'harbor', 'library', 'market', 'temple', 'caravan'], mil: ['tower', 'barracks', 'fort', 'walls'], tools: ['demolish'] };
  function bInfo(b) {
    if (b === 'walls') return { name: 'Stadtmauern', cost: K.WALLS_COST, need: K.WALLS_NEED, tech: 'fortification', desc: '+50 % Verteidigung', icon: '#walls', where: 'Hauptstadt oder Festung' };
    if (b === 'demolish') return { name: 'Abreißen', cost: 0, need: {}, tech: 'demolition', desc: '50 % der Kosten zurück', emoji: '🔨', where: 'eigene Gebäude und Mauern' };
    const B = K.BUILDINGS[b];
    return { ...B, icon: b === 'fort' ? '#castle' : '#b-' + b, where: B.coast ? 'an der Küste' : B.on.length >= 5 ? 'überall' : B.on.map(t => K.TERRAIN[t].name).join(', ') };
  }
  const newSeed = () => (Math.random() * 2 ** 32) >>> 0;
  const APP_VERSION = '33';
  const NET_V = 3;
  // nur zum Testen: mit ?debug in der Adresse ist der Spielzustand in der Konsole erreichbar
  const DEBUG = new URLSearchParams(location.search).has('debug');

  const S = {
    role: null,            // 'local' | 'host' | 'guest'
    me: 0, state: null, geo: null, lobby: [], code: '',
    settings: { map: 'continent', size: 'medium', seed: newSeed(), mode: 'classic', world: null }, bcat: 'eco', showLocked: false,
    solo: { bots: 2, level: 'medium' },
    peer: null, conns: new Map(), conn: null,
    sel: -1, selPref: null, target: -1, mode: 'recruit', unit: 'w', bldg: 'lumber', amount: 1, turnKey: '',
    aiTimer: null, seenBattle: 0, seenMarch: 0, lastAiBattle: 0, chat: [], tut: null, mapKey: '',
  };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
  };
  const newTok = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  const PID = store.get('kingdoms-pid') || (() => { const v = Math.random().toString(36).slice(2, 12); store.set('kingdoms-pid', v); return v; })();
  const RICO = k => `<svg class="ri" aria-hidden="true"><use href="#res-${k}"/></svg>`;
  const COIN = '<svg class="coin" aria-hidden="true"><use href="#res-gold"/></svg>';
  const coin = n => `<span class="amt">${COIN}${n}</span>`;
  const scroll = n => `<span class="amt"><svg class="scroll" aria-hidden="true"><use href="#res-sci"/></svg>${n}</span>`;
  const resAmt = (k, n) => `<span class="amt" title="${K.RES[k].name}">${RICO(k)}${n}</span>`;
  // Preis für Karten: Gold und Rohstoffe, fehlende rot
  const price = (gold, need, pl) => `<em class="price">${gold ? `<span class="${pl && pl.gold < gold ? 'miss' : ''}">${gold}${COIN}</span>` : ''}${K.RKEYS.filter(k => need && need[k])
    .map(k => `<span class="${pl && (pl[k] || 0) < need[k] ? 'miss' : ''}">${need[k]}${RICO(k)}</span>`).join('')}</em>`;
  const priceText = (gold, need) => [gold ? gold + ' Gold' : '', ...K.RKEYS.filter(k => need && need[k]).map(k => `${need[k]} ${K.RES[k].name}`)].filter(Boolean).join(', ');

  if (DEBUG) window.__kingdoms = { S, render: () => render(), mini: () => Mini };

  function show(id) { document.querySelectorAll('.screen').forEach(e => { e.hidden = e.id !== id; }); const m = document.querySelector('#menuSound'); if (m) m.hidden = id === 'game'; }
  // Handy: die Ton-Knöpfe im Menü weichen beim Scrollen, damit sie keine Eingabefelder verdecken
  document.querySelectorAll('.title-screen').forEach(s => s.addEventListener('scroll', () => $('#menuSound').classList.toggle('away', s.scrollTop > 40), { passive: true }));

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  // eigene Bestätigung (funktioniert überall, auch wo confirm() blockiert ist)
  function ask(text, okLabel = 'Ja') {
    return new Promise(res => {
      const o = $('#confirm');
      o.innerHTML = `<div class="modal center"><p>${text}</p><div class="row">
        <button data-a="0">Abbrechen</button><button data-a="1" class="primary">${okLabel}</button></div></div>`;
      o.hidden = false;
      o.onclick = e => {
        const b = e.target.closest('[data-a]');
        if (!b && e.target !== o) return;
        o.hidden = true;
        res(!!b && b.dataset.a === '1');
      };
    });
  }

  function notice(text) {
    const o = $('#confirm');
    o.innerHTML = `<div class="modal center"><p>${esc(text)}</p><div class="row"><button data-a="1" class="primary">OK</button></div></div>`;
    o.hidden = false;
    o.onclick = e => { if (e.target === o || e.target.closest('[data-a]')) o.hidden = true; };
  }

  const myName = () => ($('#name').value.trim() || 'Spieler').slice(0, 16);

  function botEntry(level, list = S.lobby) {
    const used = new Set(list.map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot ' + (list.length + 1);
    const usedC = new Set(list.map(p => p.color));
    const usedR = new Set(list.map(p => p.realm));
    const realm = BOT_REALMS.find(r => !usedR.has(r)) || '';
    return { name, realm, type: 'ai', level, color: K.COLORS.find(c => !usedC.has(c)) };
  }

  // ---------- Titelbildschirm ----------

  $('#name').value = store.get('kingdoms-name') || '';
  $('#name').addEventListener('change', () => store.set('kingdoms-name', myName()));

  // ---------- Profil: eigenes Bild und Lieblingsfarbe ----------

  const PROFILE = { color: K.COLORS.includes(store.get('kingdoms-color')) ? store.get('kingdoms-color') : K.COLORS[0], avatar: store.get('kingdoms-avatar') || null };
  const myRealm = () => ($('#realm').value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  $('#realm').value = store.get('kingdoms-realm') || '';
  $('#realm').addEventListener('change', () => store.set('kingdoms-realm', myRealm()));
  const me0 = () => ({ name: myName(), realm: myRealm(), type: 'human', cid: 'host', pid: PID, color: PROFILE.color, avatar: PROFILE.avatar });
  // Profilbild oder – ohne Bild – der Anfangsbuchstabe in der Reichsfarbe
  const avatarHTML = (avatar, name, color, cls = '') => (avatar
    ? `<img class="ava ${cls}" src="${avatar}" alt="">`
    : `<span class="ava ${cls}" style="background:${color}">${esc((name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`);
  const safeAvatar = a => (typeof a === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a) && a.length < 80000 ? a : null);
  function swatches(el, current, taken, onPick) {
    el.innerHTML = K.COLORS.map(c => `<button class="sw ${c === current ? 'on' : ''}" data-c="${c}" style="--sw:${c}"
      ${taken.includes(c) && c !== current ? 'disabled title="Diese Farbe hat schon jemand"' : `title="${c}"`}></button>`).join('');
    el.onclick = e => { const b = e.target.closest('[data-c]'); if (b && !b.disabled) onPick(b.dataset.c); };
  }
  function renderProfile() {
    $('#avatarBtn').innerHTML = avatarHTML(PROFILE.avatar, myName(), PROFILE.color, 'big') + '<span class="ava-edit">📷</span>';
    $('#avatarRemove').hidden = !PROFILE.avatar;
    swatches($('#myColors'), PROFILE.color, [], c => { PROFILE.color = c; store.set('kingdoms-color', c); Sound.play('click'); renderProfile(); });
  }
  // Bild quadratisch zuschneiden und auf 128×128 verkleinern – klein genug fürs Online-Spiel, bleibt nur in diesem Browser
  function loadAvatar(file) {
    if (!file || !file.type.startsWith('image/')) return toast('Bitte ein Bild auswählen.');
    if (file.size > 25e6) return toast('Das Bild ist zu groß (höchstens 25 MB).');
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const sz = Math.min(img.width, img.height), cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      cv.getContext('2d').drawImage(img, (img.width - sz) / 2, (img.height - sz) / 2, sz, sz, 0, 0, 128, 128);
      URL.revokeObjectURL(url);
      PROFILE.avatar = cv.toDataURL('image/jpeg', 0.82);
      store.set('kingdoms-avatar', PROFILE.avatar);
      renderProfile();
      toast('Profilbild gespeichert.');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Das Bild konnte nicht gelesen werden.'); };
    img.src = url;
  }
  $('#avatarBtn').onclick = $('#avatarUpload').onclick = () => $('#avatarFile').click();
  $('#avatarFile').onchange = e => { loadAvatar(e.target.files[0]); e.target.value = ''; };
  $('#avatarRemove').onclick = () => { PROFILE.avatar = null; try { localStorage.removeItem('kingdoms-avatar'); } catch { /* egal */ } renderProfile(); };
  $('#name').addEventListener('input', () => renderProfile());
  renderProfile();

  setTimeout(async () => {
    const w = K.generateWorld(4, ['continent', 'twin', 'inland', 'islands'][newSeed() % 4], 'large', newSeed());
    const url = await MapView.toURL(MapView.terrain(w.geo, 1.6, true));
    document.querySelectorAll('.title-bg').forEach(e => { e.style.backgroundImage = `url(${url})`; });
  }, 50);

  function menuPanel(name) {
    $('#menuMain').hidden = name !== 'main';
    $('#panelSolo').hidden = name !== 'solo';
    $('#panelMulti').hidden = name !== 'multi';
    $('#panelForge').hidden = name !== 'forge';
    if (name === 'solo') soloSetup.refresh();
    if (name === 'forge') forge.open();
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const go = b.dataset.go;
    if (go === 'tutorial') startTutorial();
    else if (go === 'help') openHelp();
    else if (go === 'news') showNews(true);
    else menuPanel(go);
  });

  // ---------- Eigene Welten (Weltenschmiede) ----------

  const worldsStore = {
    list() { try { return JSON.parse(store.get('kingdoms-worlds') || '[]'); } catch { return []; } },
    save(list) { store.set('kingdoms-worlds', JSON.stringify(list)); },
  };
  const worldCustom = w => ({
    land: w.land, provSize: w.provSize, forest: w.forest, mountain: w.mountain, desert: w.desert, snow: w.snow != null ? w.snow : 0, rivers: w.rivers, peaks: w.peaks, fixedSize: true,
    monsters: w.monsters != null ? w.monsters : 0.11, starts: w.starts || [],
    lairs: w.lairsManual ? w.lairs || {} : undefined, huts: w.hutsManual ? w.huts || [] : undefined,
  });
  // Einstellungen (Karte oder eigene Welt + Modus) in Optionen für K.createGame übersetzen
  function gameOpts(set) {
    const mode = set.mode || 'classic', w = set.world;
    if (!w) return { map: set.map, size: set.size, seed: set.seed, mode };
    return { map: w.type, size: w.size, seed: w.seed, mode, custom: worldCustom(w), names: w.names, rounds: w.rounds, gold: w.gold, truce: w.truce, worldName: w.name };
  }
  function previewWorld(set, n) {
    const o = gameOpts(set);
    const r = K.generateWorld(n, o.map, o.size, o.seed, o.custom);
    if (o.names) for (const [k, v] of Object.entries(o.names)) if (r.cells[+k] && v) r.cells[+k].name = v;
    return r;
  }

  // ---------- Spiel einrichten: Weltwahl mit Vorschau ----------

  function seg(el, options, value, onPick, enabled = true) {
    el.innerHTML = options.map(([v, label]) => `<button data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}" ${enabled ? '' : 'disabled'}>${label}</button>`).join('');
    el.onclick = e => { const b = e.target.closest('[data-v]'); if (b && enabled) onPick(b.dataset.v); };
  }

  function makeSetup(p, getPlayers, editable) {
    let pvTimer;
    const ui = {
      refresh() {
        const st = S.settings;
        const can = editable();
        const saved = worldsStore.list();
        if (st.world && !saved.some(w => w.id === st.world.id)) saved.push(st.world);
        const maps = [...Object.entries(K.MAPS).map(([k, m]) => [k, `<span>${m.icon}</span>${m.name}`]), ['random', '<span>🎲</span>Zufall'],
          ...saved.map(w => ['w:' + w.id, `<span>🛠️</span>${esc(w.name)}`])];
        seg($(`#${p}Maps`), maps, st.world ? 'w:' + st.world.id : st.map, v => {
          if (v.startsWith('w:')) S.settings = { ...st, world: saved.find(w => 'w:' + w.id === v) || null };
          else S.settings = { ...st, map: v, world: null, seed: newSeed() };
          changed();
        }, can);
        seg($(`#${p}Mode`), Object.entries(K.MODES).map(([k, m]) => [k, `${m.icon} ${m.name}`]), st.mode || 'classic', v => { S.settings = { ...st, mode: v }; changed(); }, can);
        seg($(`#${p}Size`), Object.entries(K.SIZES).map(([k, s]) => [k, s.name]), st.world ? '' : st.size, v => { S.settings = { ...st, size: v }; changed(); }, can && !st.world);
        $(`#${p}Reroll`).hidden = !can || !!st.world;
        $(`#${p}Reroll`).onclick = () => { S.settings = { ...S.settings, seed: newSeed() }; changed(); };
        clearTimeout(pvTimer);
        $(`#${p}PvLoad`).hidden = false;
        pvTimer = setTimeout(() => {
          const w = previewWorld(st, Math.max(2, getPlayers()));
          const src = MapView.preview(w.geo, 760), cv = $(`#${p}Preview`);
          cv.width = src.width; cv.height = src.height;
          cv.getContext('2d').drawImage(src, 0, 0);
          $(`#${p}PvLoad`).hidden = true;
          const m = K.MAPS[w.geo.type];
          const md = K.MODES[st.mode || 'classic'];
          $(`#${p}PvName`).textContent = st.world ? `🛠️ ${st.world.name}` : `${m.icon} ${m.name}${st.map === 'random' ? ' (Zufall)' : ''}`;
          $(`#${p}PvStats`).textContent = `${w.cells.length} Provinzen · ${getPlayers()} Herrscher · ${md.icon} ${md.name}`;
          $(`#${p}PvDesc`).textContent = `${st.world ? `Eigene Welt (${m.name}, ${K.SIZES[st.world.size].name}).` : m.desc} – ${md.desc}`;
        }, 30);
      },
    };
    const changed = () => { ui.refresh(); if (S.role === 'host') lobbyChanged(); };
    return ui;
  }

  const soloSetup = makeSetup('solo', () => S.solo.bots + 1, () => true);
  function renderSoloOpts() {
    seg($('#soloBots'), [1, 2, 3, 4, 5].map(n => [n, n]), S.solo.bots, v => { S.solo.bots = +v; renderSoloOpts(); soloSetup.refresh(); });
    seg($('#soloLevel'), [['easy', 'Leicht'], ['medium', 'Mittel'], ['hard', 'Schwer'], ['mixed', 'Gemischt']], S.solo.level, v => { S.solo.level = v; renderSoloOpts(); });
  }
  renderSoloOpts();

  $('#btnLocal').onclick = () => {
    const settings = { ...S.settings };
    resetSession();
    S.role = 'local';
    S.settings = settings;
    S.lobby = [me0()];
    const mix = ['easy', 'medium', 'hard'];
    for (let i = 0; i < S.solo.bots; i++) S.lobby.push(botEntry(S.solo.level === 'mixed' ? mix[i % 3] : S.solo.level));
    startGame();
    S.settings = { ...settings, seed: newSeed() };
  };

  function startTutorial() {
    resetSession();
    S.role = 'local';
    S.settings = { map: 'continent', size: 'small', seed: newSeed(), mode: 'classic', world: null };
    S.lobby = [me0()];
    S.lobby.push(botEntry('easy'));
    startGame({ truce: 6 });
    S.tut = { step: 0, recruited: 0 };
    renderCoach();
  }

  $('#btnHost').onclick = () => {
    if (!window.Peer) return toast('Online-Modul konnte nicht geladen werden – Internetverbindung prüfen.');
    resetSession();
    S.role = 'host';
    S.lobby = [me0()];
    openHostPeer();
  };

  $('#btnJoin').onclick = () => {
    const code = $('#joinCode').value.trim().toUpperCase();
    if (code.length < 4) return toast('Bitte den Raum-Code eingeben.');
    if (!window.Peer) return toast('Online-Modul konnte nicht geladen werden – Internetverbindung prüfen.');
    resetSession();
    S.role = 'guest';
    joinRoom(code);
  };
  $('#joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });

  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) { $('#joinCode').value = urlRoom.toUpperCase(); menuPanel('multi'); }

  function resetSession() {
    clearTimeout(S.aiTimer);
    if (S.reconn) clearTimeout(S.reconn.timer);
    S.reconn = null;
    { const nb = $('#netBar'); if (nb) nb.hidden = true; }
    { const mo = $('#mini'); if (mo) { mo.hidden = true; mo.innerHTML = ''; } }
    if (S.peer) { try { S.peer.destroy(); } catch { /* egal */ } }
    Object.assign(S, { role: null, me: 0, state: null, geo: null, lobby: [], code: '', peer: null, conns: new Map(), conn: null, seats: null, joinReqs: [], reqSeq: 0, seatTok: null, pin: -1, infoCell: -1,
      avatars: null, sel: -1, selPref: null, target: -1, mode: 'recruit', unit: 'w', bldg: 'lumber', amount: 1, turnKey: '',
      seenBattle: 0, seenMarch: 0, chat: [], tut: null, lastLogN: null, mapKey: '', nationKey: '', labelKey: '', overShown: false, pick: null, plan: null, selDivs: null, split: null });
    $('#planner').hidden = true;
    $('#coach').hidden = true;
    $('#research').hidden = true;
    $('#side').classList.remove('open');
    document.title = 'Kingdoms';
    keepAwake(false);
  }

  function toMenu() { resetSession(); show('menu'); menuPanel('main'); renderResume(); setTimeout(() => checkVersion(), 500); }

  // Online-Spiel auf dem Handy: der Bildschirm bleibt an, damit die Verbindung beim Warten nicht abreißt
  let wakeLock = null, wakeWanted = false;
  function keepAwake(on) {
    wakeWanted = on;
    if (!navigator.wakeLock) return;
    if (on && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = navigator.wakeLock.request('screen').then(l => {
        if (!wakeWanted) { l.release(); wakeLock = null; return null; }
        l.addEventListener('release', () => { wakeLock = null; });
        return l;
      }).catch(() => { wakeLock = null; return null; });
    } else if (!on && wakeLock) { const p = wakeLock; wakeLock = null; p.then(l => l && l.release()).catch(() => {}); }
  }
  document.addEventListener('visibilitychange', () => { if (wakeWanted) keepAwake(true); });

  // ---------- Weltenschmiede: eigene Welten gestalten ----------

  const forge = (() => {
    const DEF = () => ({
      id: 'w' + Date.now().toString(36), name: 'Meine Welt', type: 'continent', size: 'medium', seed: newSeed(),
      land: 0.55, provSize: 17, forest: 0.34, mountain: 0.14, desert: 0.14, snow: 0.15, rivers: 6, peaks: true, monsters: 0.11,
      names: {}, starts: [], lairs: {}, huts: [], lairsManual: false, hutsManual: false, rounds: 40, gold: 4, truce: 0,
    });
    let F = DEF(), world = null, pvTimer, renaming = -1, tool = 'rename';
    // Regler: [Schlüssel, Beschriftung, min, max, Schritt, Anzeige, verändert die Provinzaufteilung?]
    const SLIDERS = [
      ['land', 'Landanteil', 0.25, 0.75, 0.01, v => Math.round(v * 100) + ' %', true],
      ['provSize', 'Provinzgröße', 9, 32, 1, v => (v < 14 ? 'viele kleine' : v > 23 ? 'wenige große' : 'mittel') + ` (${v})`, true],
      ['forest', 'Wald', 0, 0.7, 0.01, v => Math.round(v * 100) + ' %', false],
      ['mountain', 'Gebirge', 0, 0.5, 0.01, v => Math.round(v * 100) + ' %', true],
      ['desert', 'Wüste', 0, 0.7, 0.01, v => Math.round(v * 100) + ' %', false],
      ['snow', 'Schnee (im Norden)', 0, 0.8, 0.01, v => (v ? Math.round(v * 100) + ' % der Karte' : 'kein Schnee'), false],
      ['rivers', 'Flüsse', 0, 20, 1, v => v, false],
      ['monsters', 'Monsterhorte (zufällig)', 0, 0.3, 0.01, v => (v ? Math.round(v * 100) + ' % der Provinzen' : 'keine'), false],
    ];
    const RULES = [
      ['gold', 'Startgold', 0, 30, 1, v => v],
      ['rounds', 'Rundenzahl', 15, 80, 5, v => v],
      ['truce', 'Friedenszeit (Runden)', 0, 10, 1, v => v || 'keine'],
    ];
    const TOOLS = [
      ['rename', '✏️', 'Umbenennen'], ['start', '🏰', 'Startstadt'], ['wolves', '🐺', 'Wolfsrudel'],
      ['trolls', '👹', 'Trollhöhle'], ['dragon', '🐉', 'Drachenhort'], ['worms', '🪱', 'Sandwürmer'], ['hut', '🛖', 'Dorf'], ['erase', '🧽', 'Entfernen'],
    ];
    const TOOL_HELP = {
      rename: 'Tippe auf eine Provinz, um sie umzubenennen.',
      start: 'Tippe auf Provinzen, um Startstädte festzulegen (höchstens 6). Dort beginnen die Reiche – benenne sie gleich mit ✏️.',
      wolves: 'Tippe auf eine Provinz, um ein Wolfsrudel zu setzen (leicht, kleiner Schatz).',
      worms: 'Tippe auf eine Provinz, um ein Sandwurmnest zu setzen (stark – und gefährlich für Wüstenprovinzen daneben).',
      trolls: 'Tippe auf eine Provinz, um eine Trollhöhle zu setzen (zäh, mittlerer Schatz).',
      dragon: 'Tippe auf eine Provinz, um einen Drachenhort zu setzen (sehr stark, großer Schatz).',
      hut: 'Tippe auf Provinzen, um Dörfer zu setzen oder zu entfernen (Belohnung beim Erobern).',
      erase: 'Tippe auf eine Provinz, um Startstadt, Monster und Dorf dort zu entfernen.',
    };

    function slider([k, label, min, max, step, fmt]) {
      return `<label class="slider"><span>${label}<b id="fv-${k}">${fmt(F[k])}</b></span>
        <input type="range" id="fs-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${F[k]}"></label>`;
    }

    function renderOpts() {
      const maps = Object.entries(K.MAPS).map(([k, m]) => `<button data-ft="${k}" class="${F.type === k ? 'on' : ''}"><span>${m.icon}</span>${m.name}</button>`).join('');
      const sizes = Object.entries(K.SIZES).map(([k, z]) => `<button data-fz="${k}" class="${F.size === k ? 'on' : ''}">${z.name}</button>`).join('');
      $('#forgeOpts').innerHTML = `
        <label class="field">Name der Welt <input id="forgeName" maxlength="28" value="${esc(F.name)}"></label>
        <div class="opt"><span class="olabel">Grundform</span><div class="maps">${maps}</div></div>
        <div class="opt"><span class="olabel">Größe</span><div class="seg">${sizes}</div></div>
        <div class="opt"><span class="olabel">Landschaft</span>${SLIDERS.map(slider).join('')}
          <label class="check"><input type="checkbox" id="forgePeaks" ${F.peaks ? 'checked' : ''}> Unpassierbare Gipfel</label>
          <label class="check"><input type="checkbox" id="forgeLairsManual" ${F.lairsManual ? 'checked' : ''}> Monster nur selbst platzieren</label>
          <label class="check"><input type="checkbox" id="forgeHutsManual" ${F.hutsManual ? 'checked' : ''}> Dörfer nur selbst platzieren</label></div>
        <div class="opt"><span class="olabel">Spielregeln</span>${RULES.map(slider).join('')}</div>`;
    }

    function renderTools() {
      $('#forgeTools').innerHTML = TOOLS.map(([k, ic, label]) => `<button data-tool="${k}" class="${tool === k ? 'on' : ''}" title="${label}"><span>${ic}</span>${label}</button>`).join('');
      $('#forgeToolHelp').textContent = TOOL_HELP[tool];
    }

    function renderSaved() {
      const list = worldsStore.list();
      $('#forgeSaved').innerHTML = list.length ? `<span class="olabel">Gespeicherte Welten</span>` + list.map(w => `
        <div class="srow ${w.id === F.id ? 'on' : ''}"><span>🛠️ <b>${esc(w.name)}</b> <small class="tag">${K.MAPS[w.type].name} · ${K.SIZES[w.size].name}</small></span>
          <button data-wl="${w.id}">Laden</button><button data-wd="${w.id}" title="Löschen">🗑️</button></div>`).join('') : '';
    }

    // Namensliste aller Provinzen zum schnellen Umbenennen
    function renderNames() {
      if (!world) return;
      const box = $('#forgeNames');
      const open = box.open;
      const icon = { plain: '🌾', forest: '🌲', mountain: '⛰️', desert: '🏜️', snow: '❄️' };
      box.innerHTML = `<summary>📜 Alle Provinznamen (${world.cells.length})</summary><div class="namelist">` +
        world.cells.map((c, i) => `<label class="nrow ${F.starts.includes(i) ? 'start' : ''}"><span>${F.starts.includes(i) ? '🏰' : icon[c.terrain]}</span>
          <input data-ni="${i}" maxlength="24" value="${esc(c.name)}" class="${F.names[i] !== undefined ? 'custom' : ''}"></label>`).join('') + '</div>';
      box.open = open;
    }

    function drawPreview() {
      clearTimeout(pvTimer);
      $('#forgePvLoad').hidden = false;
      pvTimer = setTimeout(() => {
        world = K.generateWorld(2, F.type, F.size, F.seed, worldCustom(F));
        for (const [k, v] of Object.entries(F.names)) if (world.cells[+k]) world.cells[+k].name = v;
        const width = 1200, src = MapView.preview(world.geo, width), cv = $('#forgePreview');
        cv.width = src.width; cv.height = src.height;
        const g = cv.getContext('2d');
        g.drawImage(src, 0, 0);
        // Provinznamen und Markierungen (Startstädte, Monster, Dörfer) auf die Vorschau zeichnen
        const sc = width / world.geo.W;
        g.textAlign = 'center'; g.lineJoin = 'round';
        world.cells.forEach((c, i) => {
          const x = c.lx * sc, y = c.ly * sc;
          const marks = [];
          const si = F.starts.indexOf(i);
          if (si >= 0) marks.push('🏰');
          if (F.lairsManual && F.lairs[i]) marks.push(K.LAIRS[F.lairs[i]].icon);
          if (F.hutsManual && F.huts.includes(i)) marks.push('🛖');
          if (marks.length) {
            g.font = `${Math.max(14, 11 * sc)}px sans-serif`;
            g.fillText(marks.join(''), x, y - Math.max(10, 8 * sc));
          }
          const custom = F.names[i] !== undefined;
          g.font = `700 ${Math.max(10, 7.2 * sc)}px Cinzel, Georgia, serif`;
          g.strokeStyle = 'rgba(20,14,6,.85)'; g.lineWidth = 3;
          g.fillStyle = i === renaming ? '#ffe2a0' : si >= 0 ? '#ffd27a' : custom ? '#ffe9b8' : '#fff8e6';
          g.strokeText(c.name, x, y + 4);
          g.fillText(c.name, x, y + 4);
        });
        $('#forgePvLoad').hidden = true;
        const nTerr = { plain: 0, forest: 0, mountain: 0, desert: 0, snow: 0 };
        world.cells.forEach(c => nTerr[c.terrain]++);
        const nLairs = F.lairsManual ? Object.keys(F.lairs).length : Math.round(world.cells.length * F.monsters);
        $('#forgePvName').textContent = `🛠️ ${F.name || 'Ohne Namen'}`;
        $('#forgePvStats').textContent = `${world.cells.length} Provinzen · ${F.starts.length} Startstädte · ${nLairs} Monsterhorte${F.lairsManual ? '' : ' (zufällig)'} · bis zu ${Math.min(6, Math.floor(world.cells.length / 4))} Herrscher`;
        renderNames();
      }, 120);
    }

    // Klick in die Vorschau → Provinz finden → Werkzeug anwenden
    $('#forgePreview').addEventListener('click', e => {
      if (!world) return;
      const r = e.target.getBoundingClientRect();
      const wx = (e.clientX - r.left) / r.width * world.geo.W, wy = (e.clientY - r.top) / r.height * world.geo.H;
      let best = -1, bd = Infinity;
      for (let i = 0; i < world.geo.prov.length; i++) {
        if (world.geo.prov[i] < 0) continue;
        const [x, y] = K.hexXY(world.geo, i), d = (x - wx) ** 2 + (y - wy) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0 || bd > (world.geo.s * 1.5) ** 2) return;
      const pi = world.geo.prov[best], c = world.cells[pi];
      if (tool === 'rename') {
        renaming = pi;
        $('#forgeRename').innerHTML = `<span class="olabel">Provinz umbenennen</span><div class="row">
          <input id="renameIn" maxlength="24" value="${esc(c.name)}"><button id="renameOk" class="primary">OK</button>
          ${F.names[pi] !== undefined ? '<button id="renameReset" title="Ursprünglichen Namen verwenden">↺</button>' : ''}</div>`;
        $('#forgeRename').hidden = false;
        $('#renameIn').focus(); $('#renameIn').select();
      } else if (tool === 'start') {
        if (F.starts.includes(pi)) F.starts = F.starts.filter(x => x !== pi);
        else if (F.starts.length >= 6) return toast('Höchstens 6 Startstädte.');
        else { F.starts.push(pi); delete F.lairs[pi]; F.huts = F.huts.filter(x => x !== pi); }
      } else if (K.LAIRS[tool]) {
        if (F.starts.includes(pi)) return toast('Auf einer Startstadt kann kein Monsterhort sein.');
        if (F.lairs[pi] === tool) delete F.lairs[pi]; else F.lairs[pi] = tool;
        if (!F.lairsManual) { F.lairsManual = true; renderOpts(); toast('Monster werden jetzt nur dort gesetzt, wo du sie platzierst.'); }
      } else if (tool === 'hut') {
        if (F.huts.includes(pi)) F.huts = F.huts.filter(x => x !== pi); else F.huts.push(pi);
        if (!F.hutsManual) { F.hutsManual = true; renderOpts(); toast('Dörfer werden jetzt nur dort gesetzt, wo du sie platzierst.'); }
      } else if (tool === 'erase') {
        F.starts = F.starts.filter(x => x !== pi); delete F.lairs[pi]; F.huts = F.huts.filter(x => x !== pi);
      }
      Sound.play('click');
      drawPreview();
    });
    $('#forgeRename').addEventListener('click', e => {
      if (e.target.id === 'renameOk') {
        const v = $('#renameIn').value.trim();
        if (v) F.names[renaming] = v.slice(0, 24);
        renaming = -1; $('#forgeRename').hidden = true; drawPreview();
      } else if (e.target.id === 'renameReset') { delete F.names[renaming]; renaming = -1; $('#forgeRename').hidden = true; drawPreview(); }
    });
    $('#forgeRename').addEventListener('keydown', e => { if (e.key === 'Enter') $('#renameOk').click(); });
    $('#forgeNames').addEventListener('change', e => {
      const i = e.target.dataset.ni;
      if (i === undefined) return;
      const v = e.target.value.trim();
      if (v) F.names[i] = v.slice(0, 24); else delete F.names[i];
      drawPreview();
    });
    $('#forgeTools').addEventListener('click', e => {
      const b = e.target.closest('[data-tool]');
      if (!b) return;
      tool = b.dataset.tool; renaming = -1; $('#forgeRename').hidden = true;
      renderTools();
    });

    // Ändert sich die Provinzaufteilung, passen Namen und Markierungen nicht mehr – dann zurücksetzen
    function structural() {
      const had = Object.keys(F.names).length + F.starts.length + Object.keys(F.lairs).length + F.huts.length;
      if (had) toast('Eigene Namen, Startstädte, Monster und Dörfer wurden zurückgesetzt, weil sich die Provinzen geändert haben.');
      F.names = {}; F.starts = []; F.lairs = {}; F.huts = [];
      renaming = -1; $('#forgeRename').hidden = true;
    }

    $('#forgeOpts').addEventListener('input', e => {
      const t = e.target;
      if (t.id === 'forgeName') { F.name = t.value.trim().slice(0, 28) || 'Meine Welt'; $('#forgePvName').textContent = `🛠️ ${F.name}`; return; }
      if (!t.dataset.k) return;
      const k = t.dataset.k, def = [...SLIDERS, ...RULES].find(x => x[0] === k);
      F[k] = +t.value;
      $(`#fv-${k}`).textContent = def[5](F[k]);
      if (def[6]) structural();
      if (SLIDERS.some(x => x[0] === k)) drawPreview();
    });
    $('#forgeOpts').addEventListener('change', e => {
      if (e.target.id === 'forgePeaks') { F.peaks = e.target.checked; structural(); drawPreview(); }
      if (e.target.id === 'forgeLairsManual') { F.lairsManual = e.target.checked; drawPreview(); }
      if (e.target.id === 'forgeHutsManual') { F.hutsManual = e.target.checked; drawPreview(); }
    });
    $('#forgeOpts').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.ft) { F.type = b.dataset.ft; structural(); }
      else if (b.dataset.fz) { F.size = b.dataset.fz; structural(); }
      else return;
      renderOpts(); drawPreview();
    });
    $('#forgeReroll').onclick = () => { F.seed = newSeed(); structural(); drawPreview(); };
    $('#forgeNew').onclick = () => { F = DEF(); renderOpts(); renderSaved(); drawPreview(); };
    $('#forgeSaved').addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      const list = worldsStore.list();
      if (b.dataset.wl) { F = { ...DEF(), ...list.find(w => w.id === b.dataset.wl) }; renderOpts(); renderSaved(); drawPreview(); }
      else if (b.dataset.wd) {
        const w = list.find(x => x.id === b.dataset.wd);
        if (w && await ask(`Welt „${esc(w.name)}“ löschen?`, '🗑️ Löschen')) { worldsStore.save(list.filter(x => x.id !== w.id)); if (F.id === w.id) F = DEF(); renderOpts(); renderSaved(); drawPreview(); }
      }
    });
    function save() {
      const list = worldsStore.list().filter(w => w.id !== F.id);
      list.unshift(JSON.parse(JSON.stringify(F)));
      worldsStore.save(list.slice(0, 20));
      renderSaved();
      toast(`Welt „${F.name}“ gespeichert.`);
      Sound.play('build');
    }
    $('#forgeSave').onclick = save;
    $('#forgePlay').onclick = () => {
      save();
      S.settings = { ...S.settings, world: JSON.parse(JSON.stringify(F)) };
      if (F.starts.length) S.solo.bots = Math.max(1, Math.min(5, F.starts.length - 1));
      renderSoloOpts();
      menuPanel('solo');
    };

    return { open() { renderOpts(); renderTools(); renderSaved(); drawPreview(); } };
  })();

  // ---------- Lobby ----------

  const lobbySetup = makeSetup('lobby', () => S.lobby.length, () => S.role === 'host');

  function renderLobby() {
    show('lobby');
    const host = S.role === 'host';
    $('#roomCode').textContent = S.code || '…';
    $('#shareLink').value = location.origin + location.pathname + '?room=' + S.code;
    $('#shareRow').hidden = !S.code;
    $('#botRow').hidden = !host;
    $('#btnStart').hidden = !host;
    $('#btnStart').disabled = S.lobby.length < 2;
    $('#lobbyHint').textContent = host ? 'Schicke Freunden den Code oder Link. Du kannst auch KI-Herrscher hinzufügen.' : 'Warte, bis der Gastgeber das Spiel startet…';
    seg($('#lobbyBotLevel'), [['easy', 'Leicht'], ['medium', 'Mittel'], ['hard', 'Schwer']], S.botLevel || 'medium', v => { S.botLevel = v; renderLobby(); });
    $('#lobbyList').innerHTML = S.lobby.map((p, i) => `
      <li>${avatarHTML(p.avatar, p.name, p.color || K.COLORS[i], 'sm')}<span class="dot" style="background:${p.color || K.COLORS[i]}"></span>
        <span class="grow">${esc(p.name)}${p.realm ? ` <span class="tag">🏰 ${esc(p.realm)}</span>` : ''} ${p.cid === 'host' ? '<span class="tag">👑 Gastgeber</span>' : ''}
          ${p.type === 'ai' ? `<span class="tag">🤖 KI ${LEVELS[p.level]}</span>` : ''}</span>
        ${host && p.type === 'ai' ? `<button data-rm="${i}" title="Entfernen">✕</button>` : ''}
        ${host && p.type === 'human' && p.cid !== 'host' ? `<button data-kick="${esc(p.cid)}" class="kick" title="Aus dem Raum werfen">👢 Kicken</button>` : ''}
      </li>`).join('');
    const mine = S.lobby.find(x => x.cid === (host ? 'host' : S.peer && S.peer.id));
    if (mine) swatches($('#lobbyColors'), mine.color, S.lobby.filter(x => x !== mine).map(x => x.color), c => {
      PROFILE.color = c; store.set('kingdoms-color', c);
      if (host) { mine.color = c; lobbyChanged(); } else if (S.conn && S.conn.open) S.conn.send({ t: 'color', color: c });
      Sound.play('click');
    });
    lobbySetup.refresh();
  }

  $('#lobbyList').onclick = async e => {
    const k = e.target.closest('[data-kick]');
    if (k) { const p = S.lobby.find(x => x.cid === k.dataset.kick); if (p && await ask(`${esc(p.name)} aus dem Raum werfen?`, '👢 Kicken')) kickPlayer(p.cid); return; }
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    S.lobby.splice(+b.dataset.rm, 1);
    lobbyChanged();
  };
  $('#btnAddBot').onclick = () => {
    if (S.lobby.length >= 6) return toast('Maximal 6 Spieler.');
    S.lobby.push(botEntry(S.botLevel || 'medium'));
    lobbyChanged();
  };
  $('#btnCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#shareLink').value); toast('Link kopiert!'); }
    catch { $('#shareLink').select(); toast('Bitte manuell kopieren.'); }
  };
  $('#btnLeave').onclick = toMenu;
  $('#btnStart').onclick = () => startGame();

  function lobbyChanged() {
    broadcast({ t: 'lobby', lobby: S.lobby, code: S.code, settings: S.settings });
    renderLobby();
  }

  // ---------- Netzwerk: Gastgeber ----------

  function newCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 5; i++) c += abc[Math.floor(Math.random() * abc.length)];
    return c;
  }

  function openHostPeer(keep, tries = 0) {
    S.code = keep || newCode();
    if (!keep) renderLobby();
    const peer = new Peer(ID_PREFIX + S.code);
    S.peer = peer;
    peer.on('open', () => {
      if (keep) { if (tries) toast(`✅ Raum ${S.code} ist wieder offen – deine Freunde können zurückkommen.`); }
      else renderLobby();
    });
    // Handy im Ruhemodus o. Ä.: Verbindung zum Vermittlungs-Server neu aufbauen, sonst findet niemand den Raum
    peer.on('disconnected', () => {
      setTimeout(() => { try { if (S.peer === peer && !peer.destroyed && peer.disconnected) peer.reconnect(); } catch { /* nächster Versuch */ } }, 1500);
    });
    peer.on('error', err => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        // Der alte Raum-Code ist nach dem Neuladen noch eine Weile belegt – geduldig weiter versuchen, niemals einen neuen Code nehmen
        if (keep) {
          if (tries % 5 === 0) toast(`⏳ Raum ${keep} wird wieder geöffnet… (das kann bis zu einer Minute dauern)`);
          setTimeout(() => { if (S.role === 'host' && S.code === keep) openHostPeer(keep, tries + 1); }, 3000);
          return;
        }
        openHostPeer(); return;
      }
      if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
        setTimeout(() => { try { if (S.peer === peer && !peer.destroyed && peer.disconnected) peer.reconnect(); } catch { /* egal */ } }, 3000);
        return;
      }
      if (err.type !== 'peer-unavailable') toast('Verbindungsfehler: ' + err.type);
    });
    peer.on('connection', conn => {
      conn.on('data', d => onHostData(conn, d));
      conn.on('close', () => onGuestLeft(conn));
    });
  }

  const deadConn = c => {
    const pc = c.peerConnection, cs = pc && (pc.connectionState || pc.iceConnectionState);
    if (!c.open || cs === 'failed' || cs === 'closed') return true;
    if (cs === 'disconnected') { c._lost = c._lost || Date.now(); return Date.now() - c._lost > 12000; }
    c._lost = 0;
    return false;
  };
  setInterval(() => {
    if (S.role === 'host') {
      for (const c of [...S.conns.values()]) if (deadConn(c)) { try { c.close(); } catch { /* egal */ } onGuestLeft(c); }
    } else if (S.role === 'guest' && S.conn && S.conn._ok && deadConn(S.conn)) {
      const c = S.conn;
      try { c.close(); } catch { /* egal */ }
      guestLost(c);
    }
  }, 4000);
  // zurück in der App (Handy entsperrt): Verbindungen sofort prüfen
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    try { if (S.peer && !S.peer.destroyed && S.peer.disconnected) S.peer.reconnect(); } catch { /* egal */ }
    if (S.role === 'guest' && S.conn && S.conn._ok && deadConn(S.conn)) { const c = S.conn; try { c.close(); } catch { /* egal */ } guestLost(c); }
    if (S.role === 'guest' && S.reconn) tryReconnect(true);
  });

  function broadcast(msg) {
    if (S.role !== 'host') return;
    for (const c of S.conns.values()) if (c.open) c.send(msg);
  }
  // Die Geländedaten sind groß und ändern sich nicht – sie gehen nur einmal pro Spiel raus
  function broadcastState(full) {
    if (S.role !== 'host' || !S.state) return;
    if (full) broadcast({ t: 'geo', geo: S.state.geo });
    const { geo, ...rest } = S.state;
    broadcast({ t: 'state', state: rest });
  }

  function sendTo(p, msg) {
    const cid = S.state && S.state.players[p] && S.state.players[p].cid;
    const c = cid && S.conns.get(cid);
    if (c && c.open) c.send(msg);
  }

  function onHostData(conn, d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'join') {
      if (S.state) return rejoin(conn, d);
      if ((d.net || 0) !== NET_V) return conn.send({ t: 'err', msg: 'Ihr habt verschiedene Versionen von Kingdoms. Bitte beide die Seite neu laden (Strg+F5 bzw. am Handy neu öffnen).', fatal: true });
      if (S.lobby.length >= 6) return conn.send({ t: 'err', msg: 'Der Raum ist voll.', fatal: true });
      S.conns.set(conn.peer, conn);
      const usedC = S.lobby.map(x => x.color);
      const color = K.COLORS.includes(d.color) && !usedC.includes(d.color) ? d.color : K.COLORS.find(c => !usedC.includes(c));
      const base = String(d.name || 'Gast').trim().slice(0, 16) || 'Gast';
      let nm = base, k = 2;
      while (S.lobby.some(x => x.name.toLowerCase() === nm.toLowerCase())) nm = `${base.slice(0, 13)} ${k++}`;
      S.lobby.push({ name: nm, realm: String(d.realm || '').replace(/\s+/g, ' ').trim().slice(0, 24), type: 'human', cid: conn.peer, pid: String(d.pid || '').slice(0, 20) || null, color, avatar: safeAvatar(d.avatar) });
      return lobbyChanged();
    }
    if (d.t === 'action' && S.state) {
      const p = S.state.players.findIndex(x => x.cid === conn.peer);
      return hostApply(p, d.a);
    }
    if (d.t === 'color' && !S.state) {
      const e = S.lobby.find(x => x.cid === conn.peer);
      if (!e || !K.COLORS.includes(d.color)) return;
      if (S.lobby.some(x => x !== e && x.color === d.color)) return conn.send({ t: 'err', msg: 'Diese Farbe hat schon jemand.' });
      e.color = d.color;
      return lobbyChanged();
    }
    if (d.t === 'chat') {
      const p = S.state ? S.state.players.find(x => x.cid === conn.peer) : null;
      const l = S.lobby.findIndex(x => x.cid === conn.peer);
      const name = p ? p.name : (S.lobby[l] || {}).name || 'Gast';
      const color = p ? p.color : (S.lobby[l] || {}).color || K.COLORS[0];
      addChat({ name, color, text: String(d.text || '').slice(0, 200) });
    }
  }

  // Wer die Verbindung verloren hat, kann zurück in sein Reich – erkannt NUR am geheimen Platz-Schlüssel oder an der
  // Geräte-ID. Unbekannte (oder ein neues Gerät) darf nur der Gastgeber in ein verwaistes Reich lassen.
  function rejoin(conn, d) {
    const st = S.state, seats = S.seats || [];
    if ((d.net || 0) !== NET_V) return conn.send({ t: 'err', msg: 'Der Gastgeber hat eine ältere Version von Kingdoms. Er muss die Seite einmal neu laden (dann „▶️ Spiel fortsetzen“) – danach kannst du zurück.', fatal: true });
    let p = d.tok ? seats.findIndex((x, i) => i > 0 && x && x.tok === d.tok) : -1;
    if (p < 0 && d.pid) p = seats.findIndex((x, i) => i > 0 && x && x.pid && x.pid === d.pid);
    if (p >= 0) {
      if (!st.players[p].alive) return conn.send({ t: 'err', msg: 'Dein Reich wurde inzwischen vernichtet.', fatal: true });
      return seatGuest(conn, p);
    }
    const away = st.players.map((x, i) => i).filter(i => i > 0 && st.players[i].away && st.players[i].alive);
    if (!away.length) return conn.send({ t: 'err', msg: 'Das Spiel läuft bereits.', fatal: true });
    S.joinReqs = (S.joinReqs || []).filter(r => r.conn.open && r.conn.peer !== conn.peer);
    S.joinReqs.push({ id: ++S.reqSeq, conn, name: String(d.name || 'Gast').slice(0, 16), pid: String(d.pid || '').slice(0, 20) || null });
    conn.send({ t: 'wait' });
    toast(`🔌 ${String(d.name || 'Gast').slice(0, 16)} möchte ins Spiel – siehe 👑 Reiche.`);
    renderPlayers();
  }

  // Gastgeber lässt jemanden in ein verwaistes Reich
  function approveJoin(id, p) {
    const r = (S.joinReqs || []).find(x => x.id === id), st = S.state;
    S.joinReqs = (S.joinReqs || []).filter(x => x.id !== id);
    if (!r || !st || !st.players[p] || !st.players[p].away) return renderPlayers();
    if (!r.conn.open) { toast('Der Spieler ist nicht mehr verbunden.'); return renderPlayers(); }
    S.seats[p] = { pid: r.pid, tok: newTok() };
    seatGuest(r.conn, p);
  }
  function denyJoin(id) {
    const r = (S.joinReqs || []).find(x => x.id === id);
    S.joinReqs = (S.joinReqs || []).filter(x => x.id !== id);
    if (r && r.conn.open) r.conn.send({ t: 'err', msg: 'Der Gastgeber hat dich nicht ins laufende Spiel gelassen.', fatal: true });
    renderPlayers();
  }

  function seatGuest(conn, p) {
    const st = S.state, pl = st.players[p];
    const old = pl.cid && pl.cid !== conn.peer && S.conns.get(pl.cid);
    if (old) { S.conns.delete(pl.cid); try { old.close(); } catch { /* egal */ } }
    S.seats[p] = S.seats[p] || { pid: null, tok: newTok() };
    S.conns.set(conn.peer, conn);
    Object.assign(pl, { type: 'human', level: null, cid: conn.peer, away: false });
    if (S.lobby[p]) Object.assign(S.lobby[p], { cid: conn.peer, type: 'human' });
    st.logN = (st.logN || 0) + 1;
    st.log.push({ m: '🔌 {0} ist zurück und übernimmt wieder das eigene Reich.', ps: [p], n: st.logN });
    conn.send({ t: 'lobby', lobby: S.lobby, code: S.code, settings: S.settings });
    conn.send({ t: 'seat', tok: S.seats[p].tok });
    conn.send({ t: 'geo', geo: st.geo });
    toast(`${pl.name} ist zurück!`);
    afterChange();
  }

  // Gastgeber wirft jemanden raus: in der Lobby verschwindet er, im Spiel übernimmt die KI sein Reich
  function kickPlayer(cid) {
    const c = S.conns.get(cid);
    if (c && c.open) c.send({ t: 'err', msg: 'Du wurdest vom Gastgeber aus dem Raum entfernt.', fatal: true });
    setTimeout(() => { try { if (c) c.close(); } catch { /* egal */ } }, 1500);
    S.conns.delete(cid);
    if (S.state) {
      const p = S.state.players.findIndex(x => x.cid === cid);
      if (p >= 0) {
        Object.assign(S.state.players[p], { type: 'ai', level: 'medium', cid: null, away: false });
        if (S.seats) S.seats[p] = null;
        S.state.log.push({ m: '👢 {0} wurde vom Gastgeber entfernt – die KI übernimmt.', ps: [p] });
      }
      afterChange();
    } else {
      S.lobby = S.lobby.filter(x => x.cid !== cid);
      lobbyChanged();
    }
    toast('Spieler entfernt.');
  }

  function onGuestLeft(conn) {
    if (S.joinReqs && S.joinReqs.some(r => r.conn === conn)) { S.joinReqs = S.joinReqs.filter(r => r.conn !== conn); renderPlayers(); }
    if (S.conns.get(conn.peer) !== conn) return;
    S.conns.delete(conn.peer);
    if (S.state) {
      const p = S.state.players.findIndex(x => x.cid === conn.peer);
      if (p >= 0 && S.state.players[p].type === 'human') {
        Object.assign(S.state.players[p], { type: 'ai', level: 'medium', cid: null, away: true });
        S.state.log.push({ m: '📡 {0} hat die Verbindung verloren – die KI übernimmt, bis {0} wieder beitritt.', ps: [p] });
        afterChange();
      }
    } else {
      S.lobby = S.lobby.filter(x => x.cid !== conn.peer);
      if (S.role === 'host') lobbyChanged();
    }
  }

  // ---------- Netzwerk: Gast ----------

  function joinRoom(code) {
    S.code = code;
    const peer = new Peer();
    S.peer = peer;
    if (!S.reconn) toast('Verbinde…');
    peer.on('open', () => {
      if (S.peer !== peer) return;
      const conn = peer.connect(ID_PREFIX + code, { reliable: true });
      S.conn = conn;
      conn.on('open', () => {
        conn._ok = true;
        const lr = lastRoom();
        conn.send({ t: 'join', name: myName(), realm: myRealm(), v: APP_VERSION, net: NET_V, pid: PID,
          tok: S.seatTok || (lr && lr.code === code ? lr.tok : null), color: PROFILE.color, avatar: PROFILE.avatar });
        // Verbindung steht – dem Gastgeber Zeit geben, uns wieder einzusetzen
        if (S.reconn) { clearTimeout(S.reconn.timer); S.reconn.timer = setTimeout(() => tryReconnect(), 9000); }
      });
      conn.on('data', onGuestData);
      conn.on('close', () => guestLost(conn));
    });
    peer.on('error', err => {
      if (S.peer !== peer) return;
      if (S.reconn) return; // beim Wiederverbinden einfach weiter versuchen
      toast(err.type === 'peer-unavailable' ? 'Raum nicht gefunden – vielleicht ist das Spiel schon vorbei oder der Gastgeber gerade weg.' : 'Verbindungsfehler: ' + err.type);
      if (err.type === 'peer-unavailable') toMenu();
    });
  }

  // Verbindung zum Gastgeber weg: im Spiel bleiben und automatisch neu verbinden
  function guestLost(conn) {
    if (S.role !== 'guest' || conn !== S.conn) return;
    S.conn = null;
    if (!S.state || S.state.over) { toMenu(); toast('Verbindung zum Gastgeber verloren.'); return; }
    if (!S.reconn) { S.reconn = { n: 0, timer: 0 }; tryReconnect(); }
  }
  function tryReconnect(now) {
    if (S.role !== 'guest' || !S.reconn) return;
    clearTimeout(S.reconn.timer);
    if (now && S.reconn.n && Date.now() - (S.reconn.at || 0) < 2500) { S.reconn.timer = setTimeout(() => tryReconnect(), 2500); return; }
    S.reconn.n++; S.reconn.at = Date.now();
    if (S.reconn.n > 120) { stopReconnect(); toMenu(); notice('Der Gastgeber ist nicht mehr erreichbar. Über „🔌 Zurück in Raum“ im Hauptmenü kannst du es später noch einmal versuchen.'); return; }
    netBanner(`📡 Verbindung weg – verbinde neu… <small>(Versuch ${S.reconn.n})</small>`);
    try { if (S.peer) S.peer.destroy(); } catch { /* egal */ }
    S.peer = null;
    joinRoom(S.code);
    S.reconn.timer = setTimeout(() => tryReconnect(), Math.min(7000, 3000 + S.reconn.n * 300));
  }
  function stopReconnect() {
    if (S.reconn) clearTimeout(S.reconn.timer);
    S.reconn = null;
    netBanner('');
  }
  function netBanner(html) {
    let b = $('#netBar');
    if (!b) { b = document.createElement('div'); b.id = 'netBar'; b.className = 'netbar'; document.body.appendChild(b); }
    b.innerHTML = html ? `<span>${html}</span><button id="netMenu" class="ghost-btn">Zum Menü</button>` : '';
    b.hidden = !html;
    const m = $('#netMenu');
    if (m) m.onclick = () => { stopReconnect(); toMenu(); };
  }

  function rememberRoom() {
    const lr = lastRoom();
    const tok = S.seatTok || (lr && lr.code === S.code ? lr.tok : null);
    store.set('kingdoms-lastroom', JSON.stringify({ code: S.code, tok, t: Date.now() }));
    renderResume();
  }

  function rejoinRoom(code) {
    if (!window.Peer) return toast('Online-Modul konnte nicht geladen werden – Internetverbindung prüfen.');
    resetSession();
    S.role = 'guest';
    joinRoom(code);
  }

  function onGuestData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'lobby') {
      S.lobby = d.lobby; S.code = d.code; S.settings = d.settings || S.settings;
      if (S.reconn && S.state) return; // beim Wiederverbinden nicht in die Lobby springen
      S.state = null;
      $('#overlay').hidden = true; renderLobby();
    } else if (d.t === 'geo') S.geo = d.geo;
    else if (d.t === 'state') {
      if (!S.geo) return;
      const first = !S.state;
      S.state = { ...d.state, geo: S.geo };
      S.me = S.state.players.findIndex(p => p.cid === S.peer.id);
      if (first) { show('game'); S.avatars = S.lobby.map(p => p.avatar || null); rememberRoom(); }
      if (S.reconn) { stopReconnect(); toast('✅ Wieder verbunden – du spielst wieder selbst!'); rememberRoom(); }
      render();
    } else if (d.t === 'chat') { S.chat.push(d.msg); renderChat(); }
    else if (d.t === 'seat') { S.seatTok = String(d.tok || ''); if (S.state) rememberRoom(); }
    else if (d.t === 'wait') {
      if (S.reconn) { clearTimeout(S.reconn.timer); netBanner('⏳ Der Gastgeber muss dich erst wieder hineinlassen…'); }
      else toast('⏳ Das Spiel läuft schon – der Gastgeber muss dich erst hineinlassen…');
    }
    else if (d.t === 'err') {
      if (d.fatal) { stopReconnect(); S.role = null; toMenu(); notice(d.msg); } else toast(d.msg);
    }
  }

  // ---------- Spielablauf (Gastgeber / lokal) ----------

  function startGame(extra = {}) {
    if (S.settings.world) {
      const n = previewWorld(S.settings, S.lobby.length).cells.length;
      if (n < S.lobby.length * 2) { toast(`Die Welt „${S.settings.world.name}“ hat nur ${n} Provinzen – zu wenig für ${S.lobby.length} Herrscher.`); return; }
    }
    S.state = K.createGame(S.lobby, { ...gameOpts(S.settings), ...extra });
    S.seats = S.lobby.map((p, i) => (p.type === 'human' ? { pid: p.pid || null, tok: i === 0 ? null : newTok() } : null));
    S.joinReqs = [];
    S.lobby.forEach((p, i) => { const c = p.cid && S.conns.get(p.cid); if (c && c.open && S.seats[i]) c.send({ t: 'seat', tok: S.seats[i].tok }); });
    setTimeout(saveGame, 0);
    S.avatars = S.lobby.map(p => p.avatar || null);
    S.me = 0;
    Object.assign(S, { sel: -1, selDivs: null, split: null, plan: null, seenBattle: 0, seenMarch: 0, turnKey: '', nationKey: '', labelKey: '' });
    $('#overlay').hidden = true;
    show('game');
    broadcastState(true);
    render();
    scheduleAI();
  }

  function hostApply(p, a) {
    const st = S.state;
    if (!st || p < 0) return;
    const r = K.applyAction(st, p, a);
    if (!r.ok) { if (p === S.me) { toast(r.err); Sound.play('error'); } else sendTo(p, { t: 'err', msg: r.err }); return; }
    if (p === S.me) { if (SND[a.type]) Sound.play(SND[a.type]); tutEvent({ kind: 'action', a }); }
    afterChange();
  }

  function saveGame() {
    if (!S.state || S.tut || (S.role !== 'local' && S.role !== 'host')) return;
    try {
      localStorage.setItem('kingdoms-save', JSON.stringify({ v: APP_VERSION, role: S.role, code: S.code, state: S.state, lobby: S.lobby, seats: S.seats || null, settings: S.settings, t: Date.now() }));
    } catch { /* Speicher voll – dann eben nicht */ }
  }
  function loadSave() {
    try { const d = JSON.parse(localStorage.getItem('kingdoms-save') || 'null'); return d && d.state && !d.state.over ? d : null; } catch { return null; }
  }
  function lastRoom() {
    try { const d = JSON.parse(store.get('kingdoms-lastroom') || 'null'); return d && Date.now() - d.t < 12 * 3600e3 ? d : null; } catch { return null; }
  }
  // Knöpfe „Spiel fortsetzen“ und „Zurück in Raum …“ im Hauptmenü
  function renderResume() {
    const sv = loadSave(), lr = lastRoom(), box = $('#resumeBox');
    if (!box) return;
    const when = t => new Date(t).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    box.innerHTML = (sv ? `<button class="menu-btn featured" id="btnResume"><span class="mb-ico">▶️</span><span><b>Spiel fortsetzen</b>
        <small>${sv.role === 'host' ? `Online-Raum ${esc(sv.code)}` : 'Einzelspieler'} · Runde ${sv.state.round} · ${when(sv.t)}</small></span></button>` : '') +
      (lr ? `<button class="menu-btn" id="btnRejoin"><span class="mb-ico">🔌</span><span><b>Zurück in Raum ${esc(lr.code)}</b>
        <small>Wieder in dein Online-Spiel einsteigen</small></span></button>` : '');
    box.hidden = !sv && !lr;
  }
  document.addEventListener('click', e => {
    if (e.target.closest('#btnRejoin')) { const lr = lastRoom(); if (lr) rejoinRoom(lr.code); }
    if (e.target.closest('#btnResume')) resumeGame();
  });
  function resumeGame() {
    const sv = loadSave();
    if (!sv) { renderResume(); return toast('Kein gespeichertes Spiel gefunden.'); }
    if (sv.role === 'host' && !window.Peer) return toast('Online-Modul konnte nicht geladen werden – Internetverbindung prüfen.');
    resetSession();
    S.role = sv.role; S.state = sv.state; S.lobby = sv.lobby; S.settings = sv.settings; S.me = 0;
    S.avatars = S.lobby.map(p => p.avatar || null);
    const st = S.state;
    for (const p of st.players) for (const k of K.RKEYS) if (p[k] == null) p[k] = 4;
    if (!st.pacts) { st.pacts = {}; for (const k of st.alliances || []) st.pacts[k] = { kind: 'alliance', since: 1, ends: null }; }
    S.seats = sv.seats || st.players.map((p, i) => (p.pid ? { pid: p.pid, tok: null } : null));
    for (const p of st.players) delete p.pid;
    S.joinReqs = [];
    Object.assign(S, { seenBattle: st.battle ? st.battle.id : 0, seenMarch: st.march ? st.march.id : 0, seenVolley: st.volley ? st.volley.id : 0,
      seenCrown: st.crownEvent ? st.crownEvent.id : 0, seenDemo: st.demolish ? st.demolish.id : 0, seenWorm: st.worm ? st.worm.id : 0, lastLogN: st.logN || 0 });
    if (sv.role === 'host') {
      // Gäste sind beim Neuladen rausgeflogen – die KI spielt für sie, bis sie wieder beitreten
      st.players.forEach((p, i) => { if (i !== 0 && p.type === 'human') Object.assign(p, { type: 'ai', level: 'medium', cid: null, away: true }); });
      openHostPeer(sv.code);
    }
    show('game');
    render();
    scheduleAI();
  }

  function afterChange() {
    saveGame();
    broadcastState(false);
    render();
    scheduleAI();
  }

  function scheduleAI() {
    clearTimeout(S.aiTimer);
    const st = S.state;
    if (!st || st.over) return;
    let changed = false;
    for (const pr of st.proposals.slice()) {
      if (st.players[pr.to].type === 'ai') {
        K.applyAction(st, pr.to, { type: K.aiRespond(st, pr.to, pr.from), from: pr.from });
        changed = true;
      }
    }
    if (changed) return afterChange();
    if (st.players[st.turn].type !== 'ai') return;
    const watching = st.players.some(p => p.type === 'human' && p.alive);
    // nach einem Kampf etwas warten, damit man die Animation sieht
    let delay = watching ? 420 : 60;
    if (watching && st.battle && st.battle.id !== S.lastAiBattle) { S.lastAiBattle = st.battle.id; delay = 1500; }
    else if (watching && st.march && st.march.id !== S.lastAiMarch) { S.lastAiMarch = st.march.id; delay = 1150; }
    S.aiTimer = setTimeout(() => {
      const p = st.turn;
      const r = K.applyAction(st, p, K.aiAction(st, p));
      if (!r.ok) K.applyAction(st, p, { type: 'end' });
      afterChange();
    }, delay);
  }

  function act(a) {
    if (S.role === 'guest') { if (S.conn && S.conn.open) S.conn.send({ t: 'action', a }); if (SND[a.type]) Sound.play(SND[a.type]); }
    else hostApply(S.me, a);
  }

  // ---------- Karte: Gelände, Provinzen, Zoom ----------

  const myTurn = () => S.state && !S.state.over && S.state.turn === S.me && S.state.players[S.me] && S.state.players[S.me].alive;
  const pName = i => {
    const p = S.state.players[i];
    return p ? `<span class="pn" style="color:${p.color}">${esc(p.name)}</span>` : '?';
  };
  const truceProtected = i => S.state.cells[i].owner >= 0 && S.state.round <= S.state.truce;
  const hostileTo = i => {
    const st = S.state, c = st.cells[i];
    return c.owner !== S.me && !K.allied(st, S.me, c.owner) && !truceProtected(i);
  };
  const attackable = i => S.sel >= 0 && i >= 0 && i !== S.sel && K.canStrike(S.state, S.sel, i) && hostileTo(i);
  // ausgewählte Divisionen der gewählten Provinz
  const selDivObjs = () => (S.sel >= 0 && S.selDivs ? S.state.cells[S.sel].divs.filter(v => S.selDivs.includes(v.id)) : []);
  const selUnits = () => K.divUnits(selDivObjs());
  const pickTotal = () => K.total(selUnits());
  const marchable = () => (pickTotal() ? K.moveTargets(S.state, S.sel, selUnits()) : []);
  const readyDivs = c => c.divs.filter(v => !v.done);
  const strongest = u => [...K.TYPES].reverse().find(t => u[t] > 0) || 'w';
  const svgEl = () => $('#map');
  const SND = { recruit: 'recruit', build: 'build', research: 'research', demolish: null, end: 'click', propose: 'click', accept: 'click', order: 'select', break: 'lose', betray: 'lose', cancel: 'click', gift: 'recruit', decline: 'click', split: 'select', merge: 'select' };

  let view = { x: 0, y: 0, w: 100, h: 100 };
  const dockSide = () => { const d = $('#actionbar').getBoundingClientRect(); return d.width && d.width < window.innerWidth * 0.6 && d.top < window.innerHeight / 3; };
  // Bildschirmränder, die von Kopfzeile, Leiste, Seitenleiste oder (auf Wunsch) vom Infofeld verdeckt sind
  function viewInsets(r, withInfo) {
    const side = dockSide(), hud = $('.hud-top').getBoundingClientRect(), dock = $('#actionbar').getBoundingClientRect();
    const ins = { top: Math.max(0, hud.bottom - r.top), bottom: 0, left: 0, right: 0 };
    if (side) ins.right = dock.width;
    else if (dock.height) ins.bottom = Math.max(0, r.bottom - dock.top);
    const sp = $('#side');
    if (r.width >= 860 && sp.offsetWidth) ins.right = Math.max(ins.right, r.right - sp.getBoundingClientRect().left);
    if (withInfo && r.width < 860 && !side && !$('#info').hidden) { const ib = $('#info').getBoundingClientRect(); if (ib.height) ins.bottom = Math.max(ins.bottom, r.bottom - ib.top); }
    ins.top = Math.min(ins.top, r.height * 0.4); ins.bottom = Math.min(ins.bottom, r.height * 0.5);
    return ins;
  }
  // die Karte nicht beliebig weit über ihren Rand hinaus schieben – sonst sieht man auf dem Handy vor allem leeres Meer
  function clampView() {
    const geo = S.state && S.state.geo, r = $('#mapwrap').getBoundingClientRect();
    if (!geo || !r.width) return;
    const ins = viewInsets(r), k = r.width / view.w, pad = geo.s * 2.5;
    // größere Karte: nicht über den Rand hinaus; kleinere Karte: bleibt ganz im Bild
    const fit = (pos, a, b, full, len) => {
      const lo = -pad - a / k, hi = len + pad - (full - b) / k;
      return Math.min(Math.max(pos, Math.min(lo, hi)), Math.max(lo, hi));
    };
    view.x = fit(view.x, ins.left, ins.right, r.width, geo.W);
    view.y = fit(view.y, ins.top, ins.bottom, r.height, geo.H);
  }
  function applyView() {
    clampView();
    svgEl().setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    if (S.state) svgEl().classList.toggle('zoomin', view.w < S.state.geo.W * 0.32);
  }
  function fitView() {
    if (!S.state) return;
    const geo = S.state.geo, r = $('#mapwrap').getBoundingClientRect();
    if (!r.width) return;
    const side = dockSide();
    const top = side ? 56 : r.width < 860 ? 110 : 64, bottom = side ? 10 : ($('#actionbar').offsetHeight || 110) + 20;
    const right = side ? ($('#actionbar').offsetWidth || 0) + 8 : r.width < 860 ? 0 : ($('#side').offsetWidth || 0) + 24;
    const availH = Math.max(120, r.height - top - bottom), availW = Math.max(200, r.width - right);
    let scale = Math.min(availW / geo.W, availH / geo.H) * 0.97;
    let cx = geo.W / 2, cy = geo.H / 2;
    // Hochformat (Handy): nicht die winzige Gesamtkarte zeigen, sondern auf die eigene Hauptstadt zoomen
    const cap = S.state.cells.find(c => c.capital && c.owner === S.me);
    if ((r.width < 600 || side) && cap) { scale = Math.min(availH / geo.H, availW / (geo.W * 0.5)); cx = cap.lx; cy = cap.ly; }
    view.w = r.width / scale; view.h = r.height / scale;
    view.x = cx - (availW / 2) / scale;
    view.y = cy - (top + availH / 2) / scale;
    applyView();
  }
  function zoomAt(f, sx, sy) {
    const geo = S.state.geo, r = $('#mapwrap').getBoundingClientRect();
    const fx = (sx - r.left) / r.width, fy = (sy - r.top) / r.height;
    const wx = view.x + fx * view.w, wy = view.y + fy * view.h;
    const w = Math.max(geo.W / 6, Math.min(geo.W * 1.8, view.w * f));
    view.h = view.h * (w / view.w); view.w = w;
    view.x = wx - fx * view.w; view.y = wy - fy * view.h;
    applyView();
  }
  // ausgewählte oder umkämpfte Provinz nicht unter Kopfzeile, Leiste oder Infofeld verstecken
  function keepVisible(i) {
    const r = $('#mapwrap').getBoundingClientRect(), c = S.state.cells[i];
    if (!r.width || !c) return;
    const ins = viewInsets(r, true), top = ins.top, bottom = r.height - ins.bottom, left = ins.left, right = r.width - ins.right;
    const sy = (c.ly - view.y) / view.h * r.height, sx = (c.lx - view.x) / view.w * r.width;
    let dy = 0, dx = 0;
    if (sy < top + 30 || sy > bottom - 30) dy = sy - (top + bottom) / 2;
    if (sx < left + 30 || sx > right - 30) dx = sx - (left + right) / 2;
    if (!dx && !dy) return;
    const fromX = view.x, fromY = view.y, toX = view.x + dx / r.width * view.w, toY = view.y + dy / r.height * view.h, t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 280), e = 1 - Math.pow(1 - k, 3);
      view.x = fromX + (toX - fromX) * e; view.y = fromY + (toY - fromY) * e; applyView();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function toWorld(sx, sy) {
    const r = $('#mapwrap').getBoundingClientRect();
    return [view.x + (sx - r.left) / r.width * view.w, view.y + (sy - r.top) / r.height * view.h];
  }

  async function setupMap() {
    const st = S.state, geo = st.geo;
    const key = geo.seed + geo.type + geo.cols + geo.terr.length;
    if (S.mapKey === key) return;
    S.mapKey = key;
    const ol = MapView.outlines(geo);
    $('#provs').innerHTML = st.cells.map((c, i) => `<g class="prov" data-i="${i}"><path class="pf" d="${ol.prov[i]}"/><path class="pr" d="${ol.prov[i]}"/></g>`).join('');
    $('#routes').innerHTML = (geo.routes || []).map(r => {
      const mx = (r.x1 + r.x2) / 2, my = (r.y1 + r.y2) / 2 - Math.hypot(r.x2 - r.x1, r.y2 - r.y1) * 0.15;
      return `<path d="M${r.x1} ${r.y1} Q${mx} ${my} ${r.x2} ${r.y2}"/><circle cx="${r.x1}" cy="${r.y1}" r="1.8"/><circle cx="${r.x2}" cy="${r.y2}" r="1.8"/>`;
    }).join('');
    const img = $('#terrainImg');
    img.setAttribute('width', geo.W); img.setAttribute('height', geo.H);
    img.removeAttribute('href');
    $('#ambient').innerHTML = MapView.ambient(geo);
    requestAnimationFrame(() => fitView());
    const url = await MapView.toURL(MapView.terrain(geo, Math.min(3, 2400 / geo.W)));
    if (S.mapKey === key) img.setAttribute('href', url);
  }

  // Ziehen (Karte verschieben oder Divisions-Marker ziehen), Mausrad, zwei Finger
  (() => {
    const wrap = $('#mapwrap'), pts = new Map();
    let start = null, dragged = false, pinch = null, unitDrag = null;
    // auch ein Tipp auf die Figuren einer Provinz zählt als Tipp auf die Provinz
    const provAt = (x, y) => { const el = document.elementFromPoint(x, y); const g = el && el.closest && el.closest('.prov, .ctr'); return g ? +g.dataset.i : -1; };
    wrap.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!S.state || S.sel < 0) return;
      const i = provAt(e.clientX, e.clientY);
      if (i >= 0 && i !== S.sel) onCell(i, true);
    });
    wrap.addEventListener('pointerdown', e => {
      if (e.button === 2) return;
      if (innerWidth <= 860 && $('#side').classList.contains('open')) { $('#side').classList.remove('open'); return; }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
      const ctr = e.target.closest && e.target.closest('.ctr');
      if (pts.size === 1 && ctr && ctr.dataset.d && myTurn() && S.state.cells[+ctr.dataset.i].owner === S.me) {
        unitDrag = { from: +ctr.dataset.i, div: +ctr.dataset.d, sx: e.clientX, sy: e.clientY, moved: false, add: e.ctrlKey || e.shiftKey || e.metaKey };
        return;
      }
      if (pts.size === 1) { start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; dragged = false; }
      if (pts.size === 2) { unitDrag = null; const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); dragged = true; }
    });
    wrap.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !S.state) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (unitDrag) {
        if (!unitDrag.moved && Math.hypot(e.clientX - unitDrag.sx, e.clientY - unitDrag.sy) > 6) {
          unitDrag.moved = true;
          // zieht man eine bereits ausgewählte Division, gehen alle ausgewählten mit
          const keep = S.sel === unitDrag.from && S.selDivs && S.selDivs.includes(unitDrag.div);
          if (!keep) selectDiv(unitDrag.from, unitDrag.div, false);
        }
        if (unitDrag.moved) {
          const c = S.state.cells[unitDrag.from], [wx, wy] = toWorld(e.clientX, e.clientY), over = provAt(e.clientX, e.clientY);
          const ok = over >= 0 && (marchable().includes(over) || attackable(over));
          $('#drag').innerHTML = `<line x1="${c.lx}" y1="${c.ly}" x2="${wx}" y2="${wy}" class="dragline ${ok ? (attackable(over) ? 'atk' : 'mov') : ''}"/>
            <circle cx="${wx}" cy="${wy}" r="5" class="dragdot"/>`;
        }
        return;
      }
      const r = wrap.getBoundingClientRect();
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt(pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch = d;
        return;
      }
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) > 6) { dragged = true; wrap.classList.add('dragging'); }
      if (dragged) { view.x = start.vx - dx * view.w / r.width; view.y = start.vy - dy * view.h / r.height; applyView(); }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (unitDrag) {
        const d = unitDrag; unitDrag = null;
        $('#drag').innerHTML = '';
        if (!d.moved) { selectDiv(d.from, d.div, d.add); return; }
        const over = provAt(e.clientX, e.clientY);
        if (over >= 0 && over !== d.from) onCell(over, true);
        return;
      }
      if (pts.size === 0) {
        wrap.classList.remove('dragging');
        if (!dragged && S.state) {
          const i = provAt(e.clientX, e.clientY);
          if (i >= 0) onCell(i); else { deselect(); render(); }
        }
        start = null; pinch = null;
      } else if (pts.size === 1) { const [p] = [...pts.values()]; start = { x: p.x, y: p.y, vx: view.x, vy: view.y }; }
    };
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', e => { pts.delete(e.pointerId); start = null; pinch = null; unitDrag = null; $('#drag').innerHTML = ''; wrap.classList.remove('dragging'); });
    wrap.addEventListener('wheel', e => { if (!S.state) return; e.preventDefault(); zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
    wrap.addEventListener('mouseover', e => {
      const g = e.target.closest && e.target.closest('.prov, .ctr');
      if (g && S.state && !pts.size && S.pin < 0) showInfo(+g.dataset.i);
    });
    wrap.addEventListener('mouseleave', () => { if (S.pin < 0) $('#info').hidden = true; });
    window.addEventListener('resize', () => { if (S.state && !$('#game').hidden) fitView(); });
    document.querySelector('.zoom').addEventListener('click', e => {
      const b = e.target.closest('[data-zoom]');
      if (!b || !S.state) return;
      const r = wrap.getBoundingClientRect();
      if (b.dataset.zoom === 'fit') fitView();
      else zoomAt(b.dataset.zoom === 'in' ? 0.75 : 1.33, r.left + r.width / 2, r.top + r.height / 2);
    });
  })();

  // ---------- Darstellung ----------

  function render() {
    if (!S.state) return;
    const st = S.state;
    setupMap();
    keepAwake((S.role === 'host' || S.role === 'guest') && !st.over);
    if (!$('#info').hidden && S.infoCell >= 0 && (S.pin >= 0 || !canHover) && st.cells[S.infoCell]) showInfo(S.infoCell);
    const turnKey = st.round + '-' + st.turn;
    if (turnKey !== S.turnKey) {
      S.turnKey = turnKey;
      if (myTurn()) {
        Object.assign(S, { mode: st.players[S.me].gold >= 2 ? 'recruit' : 'army', sel: -1, selDivs: null, split: null });
        if (!(S.tut && st.round === 1)) {
          splash(`Dein Zug<small>Runde ${st.round}</small>`); Sound.play('turn');
          if (S.role !== 'local' && Sound.sfx && navigator.vibrate) navigator.vibrate(70);
        }
        if (Mini.isOpen()) { Mini.close(); toast('⚔️ Du bist dran! Das Minispiel wartet auf dich.'); }
        // Rundenbericht: was seit deinem letzten Zug passiert ist (Angriffe auf dich, Bündnisse, Vernichtungen)
        if (S.lastLogN != null) {
          const fresh = st.log.filter(l => l.n > S.lastLogN && (l.ps.includes(S.me) || /💀|🏆|👑/.test(l.m)));
          if (fresh.length) showReport(fresh);
        }
        S.lastLogN = st.logN || 0;
      }
    }
    // ankommende Truppen erst nach ihrem Lauf über die Karte zeigen
    if (st.march && st.march.id !== S.seenMarch) S.arrive = { i: st.march.to, t0: performance.now(), ms: 1050 };
    if (st.battle && st.battle.id !== S.seenBattle) S.arrive = { i: st.battle.to, t0: performance.now(), ms: 2300 };
    fixSelection();
    renderProvinces();
    renderNations();
    renderRealms();
    renderLabels();
    renderOrders();
    renderUnits();
    renderHud();
    renderBar();
    document.documentElement.style.setProperty('--dock-h', ($('#actionbar').offsetHeight || 0) + 'px');
    document.body.classList.toggle('armysel', S.mode === 'army' && S.sel >= 0);
    if (S.sel >= 0 && S.sel !== S.focused) { S.focused = S.sel; keepVisible(S.sel); }
    if (S.sel < 0) S.focused = -1;
    renderPlayers();
    renderLog();
    renderChat();
    renderOverlay();
    if (!$('#research').hidden) renderResearch();
    if (!$('#planner').hidden) renderPlanner();
    const b = st.battle && st.battle.id !== S.seenBattle ? st.battle : null;
    if (b) { S.seenBattle = b.id; playBattle(b); }
    const ce = st.crownEvent && st.crownEvent.id !== S.seenCrown ? st.crownEvent : null;
    if (ce) { S.seenCrown = ce.id; splash(`👑 ${esc(st.players[ce.p].name)}<small>Krone ${ce.n} von ${st.crownGoal}</small>`); Sound.play(ce.p === S.me ? 'win' : 'research'); }
    const vo = st.volley && st.volley.id !== S.seenVolley ? st.volley : null;
    if (vo) { S.seenVolley = vo.id; playVolley(vo); }
    const dm = st.demolish && st.demolish.id !== S.seenDemo ? st.demolish : null;
    if (dm) { S.seenDemo = dm.id; const c = st.cells[dm.cell]; startFx(Array.from({ length: 10 }, (_, k) => `<circle class="fx-dust" cx="${c.lx - 27}" cy="${c.ly + 4}" r="${2 + (k % 3)}" style="--tx:${(Math.cos(k) * 16).toFixed(1)}px;--ty:${(Math.sin(k) * 12 - 6).toFixed(1)}px"/>`).join(''), 1200); Sound.play('build'); }
    const wm = st.worm && st.worm.id !== S.seenWorm ? st.worm : null;
    if (wm) {
      S.seenWorm = wm.id;
      const c = st.cells[wm.cell];
      startFx(Array.from({ length: 14 }, (_, k) => `<circle class="fx-dust sand" cx="${c.lx}" cy="${c.ly + 4}" r="${2 + (k % 4)}" style="--tx:${(Math.cos(k * 0.9) * 22).toFixed(1)}px;--ty:${(Math.sin(k * 0.9) * 14 - 8).toFixed(1)}px"/>`).join(''), 1400);
      if (wm.p === S.me) { toast(`🪱 Ein Sandwurm hat Truppen in ${c.name} verschlungen!`); Sound.play('lose'); }
    }
    const m = st.march && st.march.id !== S.seenMarch ? st.march : null;
    if (m) { S.seenMarch = m.id; playMarch(m); }
    tutEvent({ kind: 'render' });
  }

  function showReport(entries) {
    const box = $('#report');
    box.innerHTML = `<div class="rhead"><b>📜 Seit deinem letzten Zug</b><button class="ghost" data-rclose title="Schließen">✕</button></div>
      <ul>${entries.slice(-8).map(l => `<li>${esc(l.m).replace(/\{(\d)\}/g, (_, k) => pName(l.ps[k]))}</li>`).join('')}</ul>`;
    box.hidden = false;
    clearTimeout(S.reportTimer);
    S.reportTimer = setTimeout(() => { box.hidden = true; }, 14000);
  }

  function splash(html) {
    const s = $('#turnSplash');
    s.innerHTML = `<div>${html}</div>`;
    s.hidden = false;
    clearTimeout(S.splashTimer);
    S.splashTimer = setTimeout(() => { s.hidden = true; }, 1700);
  }

  function deselect() { S.sel = -1; S.selDivs = null; S.split = null; S.shootFrom = -1; S.pin = -1; $('#info').hidden = true; }

  // Provinz wählen: alle bereiten Divisionen sind ausgewählt
  function selectArmy(i) {
    const st = S.state, c = st.cells[i];
    if (!myTurn() || c.owner !== S.me) return;
    const ready = readyDivs(c);
    if (!ready.length) { toast('Diese Truppen haben sich in diesem Zug schon bewegt.'); return; }
    S.mode = 'army'; S.sel = i; S.selDivs = ready.map(v => v.id); S.split = null;
    Sound.play('select');
    tutEvent({ kind: 'mode' });
    render();
  }

  // eine Division wählen; mit Strg/Umschalt (oder in der Leiste) mehrere
  function selectDiv(i, id, add) {
    const st = S.state, c = st.cells[i], v = c.divs.find(d => d.id === id);
    if (!myTurn() || c.owner !== S.me || !v) return;
    if (v.done) { toast(`${v.name} hat sich in diesem Zug schon bewegt.`); return; }
    if (add && S.sel === i && S.selDivs) {
      S.selDivs = S.selDivs.includes(id) ? S.selDivs.filter(x => x !== id) : [...S.selDivs, id];
    } else { S.sel = i; S.selDivs = [id]; }
    S.mode = 'army'; S.split = null;
    Sound.play('select');
    tutEvent({ kind: 'mode' });
    render();
  }

  function fixSelection() {
    const st = S.state, C = st.cells;
    const ok = i => i >= 0 && C[i] && C[i].owner === S.me && readyDivs(C[i]).length > 0;
    const cands = S.selPref || [S.sel];
    S.selPref = null;
    const prev = S.sel;
    S.sel = myTurn() && S.mode === 'army' ? (cands.find(ok) ?? -1) : -1;
    if (S.sel < 0) { S.selDivs = null; S.split = null; return; }
    const ready = readyDivs(C[S.sel]).map(v => v.id);
    if (S.sel !== prev || !S.selDivs) S.selDivs = ready;
    S.selDivs = S.selDivs.filter(id => ready.includes(id));
    if (!S.selDivs.length) S.selDivs = ready;
    if (S.split && !C[S.sel].divs.some(v => v.id === S.split.div)) S.split = null;
  }

  function renderProvinces() {
    const st = S.state, C = st.cells, mt = myTurn();
    const selN = S.sel >= 0 ? C[S.sel].n : [];
    const marchT = marchable();
    const hint = S.tut ? tutCell() : -1;
    const shootT = S.shootFrom >= 0 ? K.shootTargets(st, S.shootFrom) : [];
    document.querySelectorAll('#provs .prov').forEach(g => {
      const i = +g.dataset.i, c = C[i];
      if (!c) return;
      const cls = ['prov'];
      if (c.owner < 0) cls.push('neutral');
      if (i === S.sel) cls.push('sel');
      else if (attackable(i)) cls.push('atk');
      else if (marchT.includes(i)) cls.push('mov');
      if (mt && S.mode === 'recruit') cls.push(c.owner === S.me && K.canRecruit(c) ? 'can' : 'dim');
      if (mt && S.mode === 'build') cls.push((S.bldg === 'demolish' ? c.owner === S.me && ((c.building && !c.throne) || c.walls)
        : S.bldg === 'walls' ? c.owner === S.me && K.isCity(c) && !c.walls : K.canBuild(st, S.me, i, S.bldg)) ? 'can' : 'dim');
      if (S.shootFrom >= 0) { if (i === S.shootFrom) cls.push('sel'); else cls.push(shootT.includes(i) ? 'shoot' : 'dim'); }
      if (i === hint) cls.push('hint');
      if (c.throne) cls.push('throne');
      if (c.capital) cls.push('capital');
      g.setAttribute('class', cls.join(' '));
      g.style.setProperty('--c', c.owner >= 0 ? st.players[c.owner].color : 'transparent');
    });
  }

  // dicke Reichsgrenzen um alle Provinzen eines Herrschers
  function renderNations() {
    const st = S.state, owners = st.cells.map(c => c.owner);
    const key = owners.join(',');
    if (S.nationKey === key) return;
    S.nationKey = key;
    const n = MapView.nations(st.geo, owners);
    $('#nations').innerHTML = Object.entries(n).map(([o, d]) =>
      `<path class="nb-out" d="${d}"/><path class="nb" d="${d}" stroke="${st.players[o].color}"/>`).join('');
  }

  // Reichsnamen quer über das Gebiet (wie in Strategiespielen von Paradox)
  S.realms = store.get('kingdoms-realms') !== '0';
  function renderRealms() {
    const st = S.state, C = st.cells;
    const key = S.realms + '|' + C.map(c => c.owner).join(',') + '|' + st.players.map(p => p.realm || p.name).join(',');
    if (S.realmKey === key) return;
    S.realmKey = key;
    if (!S.realms) { $('#realms').innerHTML = ''; return; }
    let html = '';
    st.players.forEach((pl, p) => {
      if (!pl.alive) return;
      const seen = new Set(), comps = [];
      C.forEach((c, i) => {
        if (c.owner !== p || seen.has(i)) return;
        const q = [i]; seen.add(i);
        for (let h = 0; h < q.length; h++) for (const j of C[q[h]].n) if (!seen.has(j) && C[j].owner === p) { seen.add(j); q.push(j); }
        comps.push(q);
      });
      comps.sort((a, b) => b.length - a.length);
      comps.filter((q, k) => q.length >= 3 || (k === 0 && q.length >= 2)).forEach(q => {
        const P = q.map(i => [C[i].lx, C[i].ly]);
        const mx = P.reduce((s, v) => s + v[0], 0) / P.length, my = P.reduce((s, v) => s + v[1], 0) / P.length;
        let sxx = 0, syy = 0, sxy = 0;
        for (const [x, y] of P) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
        let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        ang = Math.max(-0.6, Math.min(0.6, ang));
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const proj = P.map(([x, y]) => (x - mx) * ux + (y - my) * uy);
        const len = Math.max(70, Math.max(...proj) - Math.min(...proj) + 30);
        const name = pl.realm || pl.name;
        // kleiner, edler Schriftzug, der sich sanft entlang des Gebiets biegt
        const fs = Math.max(6, Math.min(15, len / (name.length * 1.35)));
        const half = Math.min(len, name.length * fs * 1.15) / 2 + 10, bend = half * 0.14;
        const x1 = mx - ux * half, y1 = my - uy * half, x2 = mx + ux * half, y2 = my + uy * half;
        const cx = mx + uy * bend * 2, cy = my - ux * bend * 2;
        const id = `rp-${p}-${html.length}`;
        html += `<path id="${id}" d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none"/>
          <text class="realm" font-size="${fs.toFixed(1)}" fill="${pl.color}" dy="${(fs * 0.35).toFixed(1)}"><textPath href="#${id}" startOffset="50%">${esc(name)}</textPath></text>`;
      });
    });
    $('#realms').innerHTML = html;
  }

  // ---------- Provinz-Schmuck: Gebäude und Hauptstadt prägen die ganze Provinz ----------
  const vh = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  // Feldmittelpunkte je Provinz (einmal pro Karte berechnet), dazu: liegt das Feld am Wasser?
  function provHexes(geo) {
    if (S.hexCache && S.hexCache.geo === geo) return S.hexCache.list;
    const list = [];
    geo.prov.forEach((p, i) => {
      if (p < 0) return;
      const [x, y] = K.hexXY(geo, i);
      let wet = false;
      for (let d = 0; d < 6; d++) { const j = K.hexNeighbor(geo, i, d); if (j >= 0 && geo.terr[j] === '.') wet = true; }
      (list[p] = list[p] || []).push({ i, x, y, wet });
    });
    S.hexCache = { geo, list };
    return list;
  }
  // n Plätze in der Provinz, die nicht auf Namen, Truppen oder Gebäude-Symbol liegen
  function spots(st, ci, n, salt, wetOnly) {
    const c = st.cells[ci], hs = (provHexes(st.geo)[ci] || []).filter(h => (!wetOnly || h.wet)
      && Math.hypot(h.x - c.lx, h.y - c.ly) > 17 && Math.hypot(h.x - (c.lx + BLDG_SPOT[0]), h.y - (c.ly + BLDG_SPOT[1])) > 13);
    return hs.map(h => ({ ...h, r: vh(h.i, salt) })).sort((a, b) => a.r - b.r).slice(0, n)
      .map(h => ({ x: h.x + (vh(h.i, salt + 1) - 0.5) * 6, y: h.y + (vh(h.i, salt + 2) - 0.5) * 6, r: h.r }));
  }
  const DECO = {
    farm: (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${(r - 0.5) * 40})"><rect class="field" x="-6" y="-3.5" width="12" height="7" rx=".8"/><path class="furrow" d="M-6 -1.6 H6 M-6 .2 H6 M-6 2 H6"/></g>`,
    granary: (x, y) => `<g transform="translate(${x} ${y})"><path class="hay" d="M-4 2 Q-4 -4 0 -5 Q4 -4 4 2 Z"/><path class="hay" d="M1 3 Q1 -1 4 -2 Q7 -1 7 3 Z"/></g>`,
    lumber: (x, y) => `<g transform="translate(${x} ${y})"><rect class="log" x="-5" y="-1" width="9" height="2.4" rx="1.2"/><rect class="log" x="-4" y="1.6" width="9" height="2.4" rx="1.2"/><circle class="logend" cx="4" cy=".2" r="1.2"/><circle class="logend" cx="5" cy="2.8" r="1.2"/><rect class="stumpd" x="-8" y="2" width="2.4" height="2"/></g>`,
    quarry: (x, y) => `<g transform="translate(${x} ${y})"><rect class="stone" x="-5" y="-1" width="5" height="3.6" rx=".5"/><rect class="stone" x="0.5" y="0" width="4.4" height="3" rx=".5"/><rect class="stone" x="-2.5" y="-4" width="4.4" height="3" rx=".5"/></g>`,
    mine: (x, y) => `<g transform="translate(${x} ${y})"><path class="spoild" d="M-6 3 q4 -6 8 0 z"/><path class="tunnel" d="M1 3 V0 a2.6 2.6 0 0 1 5.2 0 V3 Z"/><path class="rail" d="M-7 4 H8"/></g>`,
    harbor: (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${(r - 0.5) * 30})"><path class="hull" d="M-5 1 H5 L3.6 3 H-3.6 Z"/><path class="mast" d="M0 1 V-6"/><path class="sail" d="M.3 -5.6 L4 0 H.3 Z"/></g>`,
    library: (x, y) => `<g transform="translate(${x} ${y})"><rect class="wall" x="-3" y="-2" width="6" height="5"/><path class="roofb" d="M-4 -2 L0 -5.5 L4 -2 Z"/></g>`,
    market: (x, y, r) => `<g transform="translate(${x} ${y})"><rect class="stall" x="-3.5" y="-.5" width="7" height="3"/><path class="awning${r > 0.5 ? ' b' : ''}" d="M-4.5 -.5 L-3.5 -3 H3.5 L4.5 -.5 Z"/></g>`,
    temple: (x, y) => `<g transform="translate(${x} ${y})"><path class="wall" d="M-4 3 V-1 H4 V3 Z"/><path class="roofb" d="M-5 -1 L0 -4 L5 -1 Z"/><path class="col" d="M-2.5 -1 V3 M0 -1 V3 M2.5 -1 V3"/></g>`,
    caravan: (x, y, r, col) => `<g transform="translate(${x} ${y})"><path class="tent" d="M-5 3 L-2 -3 L1 3 Z"/><path class="tent" style="fill:${col}" d="M0 3 L3 -2 L6 3 Z"/></g>`,
    tower: (x, y, r, col) => `<g transform="translate(${x} ${y})"><rect class="wall" x="-1.6" y="-5" width="3.2" height="8"/><path d="M-2.4 -5 L0 -8 L2.4 -5 Z" style="fill:${col}"/></g>`,
    barracks: (x, y, r, col) => `<g transform="translate(${x} ${y})"><path class="tent" style="fill:${col}" d="M-4 3 L0 -3 L4 3 Z"/><path d="M0 -3 V-6" class="mast"/><path d="M.2 -6 L3 -5 L.2 -4 Z" style="fill:${col}"/></g>`,
    fort: (x, y) => `<g transform="translate(${x} ${y})"><path class="palisade" d="M-5 3 V-2 l1 -1 l1 1 V3 M-2 3 V-2 l1 -1 l1 1 V3 M1 3 V-2 l1 -1 l1 1 V3 M4 3 V-2 l1 -1 l1 1 V3"/></g>`,
  };
  const DECO_N = { farm: 6, granary: 4, lumber: 5, quarry: 5, mine: 3, harbor: 3, library: 3, market: 3, temple: 2, caravan: 4, tower: 2, barracks: 4, fort: 4 };
  function provDecor(st, ci, col) {
    const c = st.cells[ci];
    let h = '';
    if (c.building && DECO[c.building]) {
      const n = DECO_N[c.building] || 3;
      let ps = spots(st, ci, n, 7 + c.building.length, c.building === 'harbor');
      if (!ps.length && c.building === 'harbor') ps = spots(st, ci, 2, 9);
      h += `<g class="deco d-${c.building}">${ps.map(p => DECO[c.building](p.x.toFixed(1), p.y.toFixed(1), p.r, col)).join('')}</g>`;
    }
    if (c.capital) {
      // Stadt rund um die Burg: Häuser, Wege, Gärten
      // Häuser dicht um die Burg: Felder der Provinz nahe der Burg, aber nicht auf Burg, Namen oder Truppen
      const hs = (provHexes(st.geo)[ci] || []).filter(q => { const dc = Math.hypot(q.x - c.lx, q.y - (c.ly - 34)), dl = Math.hypot(q.x - c.lx, q.y - c.ly); return dc > 15 && dl > 11 && dc < 60; })
        .flatMap(q => [0, 1].map(k => ({ x: q.x + (vh(q.i, 20 + k) - 0.5) * 9, y: q.y + (vh(q.i, 30 + k) - 0.5) * 8, r: vh(q.i, 40 + k), d: Math.hypot(q.x - c.lx, q.y - c.ly) })))
        .sort((a, b) => a.d - b.d).slice(0, 16);
      const roads = hs.slice(0, 4).map(p => `<path class="road" d="M${c.lx} ${c.ly - 18} Q${((c.lx + p.x) / 2 + (p.r - 0.5) * 10).toFixed(1)} ${((c.ly - 18 + p.y) / 2).toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}"/>`).join('');
      const houses = hs.map((p, k) => {
        const roof = k % 3 === 0 ? col : ['#a34a30', '#7a5a40', '#8b3a2a'][k % 3];
        return k % 4 === 3 ? `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><circle class="garden" r="3.2"/><circle class="garden2" cx="1.4" cy="-1" r="1.6"/></g>`
          : `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><rect class="hwall" x="-3" y="-1.5" width="6" height="4.5"/><rect class="hshade" x="0.6" y="-1.3" width="2.2" height="4.1"/><path class="hroof" d="M-3.8 -1.4 L0 -4.6 L3.8 -1.4 Z" style="fill:${roof}"/><rect class="win" x="-1.5" y="0" width="1.2" height="1.4"/><rect class="win" x=".6" y="0" width="1.2" height="1.4"/>${k % 5 === 1 ? `<g class="a-smoke" transform="translate(1.8 -4.4) scale(.55)"><circle r="1.2"/><circle r="1.2" style="animation-delay:-1s"/><circle r="1.2" style="animation-delay:-2s"/></g>` : ''}</g>`;
      }).join('');
      h += `<g class="deco town">${roads}${houses}</g>`;
    }
    return h;
  }

  // Gebäude stehen sichtbar in der Provinz; neu gebaute erscheinen mit einer kleinen Bau-Animation
  const BLDG_SPOT = [-27, 4];
  function renderLabels() {
    const st = S.state, C = st.cells;
    // nur neu zeichnen, wenn sich etwas Sichtbares geändert hat (sonst springen die kleinen Animationen bei jedem Klick zurück)
    const key = st.players.map(p => p.color).join() + '|' + C.map(c => [c.owner, c.building, c.hut ? 1 : 0, c.walls ? 1 : 0, c.capital ? 1 : 0, c.throne ? 1 : 0, c.name].join(':')).join('|');
    if (S.labelKey === key && $('#labels').firstChild) return;
    S.labelKey = key;
    S.seenBldg = S.seenBldg || {};
    let html = '';
    C.forEach((c, i) => {
      const { lx: x, ly: y } = c;
      const col = c.owner >= 0 ? st.players[c.owner].color : '#cfc6b2';
      html += provDecor(st, i, col);
      html += `<text class="pname${c.sz === 'S' ? ' small' : ''}" x="${x}" y="${y - 15}">${esc(c.name)}</text>`;
      if (c.throne) html += `<g class="throne-mark"><use href="#crown" x="${x - 10}" y="${y - 60}" width="20" height="13"/><text class="throne-txt" x="${x}" y="${y - 63}">THRON</text></g>`;
      if (K.isCity(c)) {
        if (c.capital) {
          html += `<ellipse class="cap-glow" cx="${x}" cy="${y - 22}" rx="22" ry="9" fill="${col}"/>`;
          html += `<use href="#capital" x="${x - 19}" y="${y - 52}" width="38" height="32" style="color:${col}"/>`;
          html += `<use class="cap-crown" href="#crown" x="${x - 6}" y="${y - 63}" width="12" height="7.5"/>`;
        } else html += `<use href="#castle" x="${x - 12}" y="${y - 41}" width="24" height="20" style="color:${col}"/>`;
        if (c.walls) html += `<use href="#walls" x="${x - 20}" y="${y - 33.5}" width="40" height="13"/>`;
      }
      const key = c.building ? i + ':' + c.building : '';
      const fresh = key && S.seenBldg[i] !== undefined && S.seenBldg[i] !== key;
      S.seenBldg[i] = key;
      if (c.building && c.building !== 'fort') {
        const bx = x + BLDG_SPOT[0], by = y + BLDG_SPOT[1];
        let art = '';
        if (c.building === 'farm') {
          // Felder rund um den Hof
          art = [[-9, 6, -12], [5, 9, 8], [-3, -7, 4]].map(([dx, dy, rot]) =>
            `<g transform="translate(${bx + dx} ${by + dy}) rotate(${rot})"><rect class="field" x="-6" y="-3.5" width="12" height="7" rx=".8"/>
              <path class="furrow" d="M-6 -1.6 H6 M-6 .2 H6 M-6 2 H6"/></g>`).join('');
        } else if (c.building === 'mine') art = `<path class="spoil" d="M${bx - 9} ${by + 8} q5 -6 10 0 z"/>`;
        else if (c.building === 'quarry') art = `<path class="spoil" d="M${bx + 5} ${by + 9} l3 -4 l3 4 z M${bx - 11} ${by + 8} l2.5 -3.5 l2.5 3.5 z"/>`;
        else if (c.building === 'lumber') art = `<path class="stump" d="M${bx + 7} ${by + 6} h3 v2 h-3 z M${bx - 10} ${by + 7} h3 v2 h-3 z"/>`;
        if (fresh) html += puffs(bx, by + 8, 8, 0.45, 14);
        html += `<g class="bldg${fresh ? ' fresh' : ''}" style="transform-origin:${bx}px ${by + 8}px">${art}
          <ellipse class="bplate" cx="${bx}" cy="${by + 9}" rx="11" ry="3.4"/>
          <use href="#b-${c.building}" x="${bx - 12}" y="${by - 13}" width="24" height="24" style="color:${col}"/></g>`;
      }
      if (c.hut) html += `<use href="#hut" x="${x + BLDG_SPOT[0] - 7}" y="${y + BLDG_SPOT[1] - 7}" width="14" height="14"/>`;
    });
    $('#labels').innerHTML = html;
  }

  // Divisionen wie bei Hearts of Iron: eine Figur je Division (stärkste Einheit) auf einem Sockel mit der Stärke
  const FIG_W = { w: 12, a: 12, p: 12, l: 12, k: 17, c: 17, h: 17, t: 19, wo: 20, tr: 17, dr: 24, sw: 17 };
  // geplante Märsche: gestrichelter Weg mit Fähnchen am Ziel (nur die eigenen)
  function renderOrders() {
    const st = S.state, C = st.cells;
    let html = '';
    C.forEach((c, i) => {
      if (c.owner !== S.me) return;
      const goals = [...new Set(c.divs.filter(v => v.goal != null).map(v => v.goal))];
      for (const g of goals) {
        const path = K.routeTo(st, S.me, i, g);
        if (!path) continue;
        const pts = [[c.lx, c.ly], ...path.map(j => [C[j].lx, C[j].ly])].map(([x, y]) => `${x},${y}`).join(' ');
        html += `<polyline class="order-line" points="${pts}"/>
          <g class="order-flag" transform="translate(${C[g].lx} ${C[g].ly - 6})"><path d="M0 0 V-14" stroke="#3a2a1a" stroke-width="1.2"/><path d="M0.5 -14 L9 -11 L0.5 -8 Z" fill="${st.players[S.me].color}" stroke="#1d150c" stroke-width=".6"/></g>`;
      }
    });
    $('#orders').innerHTML = html;
  }

  function renderUnits() {
    const st = S.state, C = st.cells;
    let html = '';
    C.forEach((c, i) => {
      if (!c.divs || !c.divs.length) return;
      const col = c.owner >= 0 ? st.players[c.owner].color : '#8a7f69';
      const mine = c.owner === S.me && st.turn === S.me;
      const show = c.divs.slice(0, 4), more = c.divs.length - show.length;
      const items = show.map(v => ({ v })).concat(more ? [{ more }] : []);
      const W = 17, gap = 2, perRow = 3;
      const arr = S.arrive && S.arrive.i === i && performance.now() - S.arrive.t0 < S.arrive.ms ? S.arrive : null;
      items.forEach((it, k) => {
        const row = Math.floor(k / perRow), inRow = Math.min(perRow, items.length - row * perRow);
        const x = c.lx - (inRow * W + (inRow - 1) * gap) / 2 + (k % perRow) * (W + gap);
        const y = c.ly - 8 + row * 24;
        if (it.more) {
          html += `<g class="ctr more" data-i="${i}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
            <rect class="plate" x="0" y="15" width="${W}" height="8" rx="2" fill="${col}"/><text class="cnum" x="${W / 2}" y="21.2">+${it.more}</text></g>`;
          return;
        }
        const v = it.v, t = K.strongestType(v.u), n = K.total(v.u), fw = FIG_W[t];
        const spent = mine && v.done, picked = i === S.sel && S.selDivs && S.selDivs.includes(v.id);
        html += `<g class="ctr${K.UNITS[t].monster ? ' monster m-' + t : ''}${spent ? ' spent' : ''}${picked ? ' picked' : ''}${mine && !spent ? ' ready' : ''}${arr ? ' arriving' : ''}" data-i="${i}" data-d="${v.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"${arr ? ` style="animation-delay:${arr.ms - (performance.now() - arr.t0)}ms"` : ''}>
          <title>${esc(v.name)}: ${K.TYPES.filter(x2 => v.u[x2]).map(x2 => `${v.u[x2]} ${K.UNITS[x2].plural}`).join(', ')}</title>
          <rect class="hit" x="-2" y="-3" width="${W + 4}" height="28" rx="3"/>
          ${picked ? `<ellipse class="sel-glow" cx="${W / 2}" cy="15.5" rx="${W / 2 + 2}" ry="4"/>` : ''}
          <use class="fig" href="#fig-${t}" x="${(W - fw) / 2}" y="-1" width="${fw}" height="17" style="color:${col};animation-delay:-${((i * 7 + k * 3) % 13) / 5}s"/>
          <rect class="plate" x="0" y="15" width="${W}" height="8" rx="2" fill="${col}"/>
          <text class="cnum" x="${W / 2}" y="21.2">${n}</text></g>`;
      });
    });
    $('#units').innerHTML = html;
  }

  // ---------- Animationen ----------

  function curve(c1, c2) {
    const x1 = c1.lx, y1 = c1.ly, x2 = c2.lx, y2 = c2.ly;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const mx = (x1 + x2) / 2 - (y2 - y1) / len * len * 0.18, my = (y1 + y2) / 2 + (x2 - x1) / len * len * 0.18;
    // Pfeil endet kurz vor dem Ziel
    const ex = x2 - (x2 - mx) / Math.hypot(x2 - mx, y2 - my) * 9, ey = y2 - (y2 - my) / Math.hypot(x2 - mx, y2 - my) * 9;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }

  function startFx(html, ms) {
    const fx = $('#fx');
    fx.innerHTML = html;
    fx.querySelectorAll('.fx-arrow').forEach(p => {
      const L = p.getTotalLength();
      p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
    });
    fx.querySelectorAll('animateMotion, set').forEach(a => { try { a.beginElementAt(+(a.dataset.delay || 0)); } catch { /* egal */ } });
    clearTimeout(S.fxTimer);
    S.fxTimer = setTimeout(() => { fx.innerHTML = ''; }, ms);
  }

  // eine kleine Figur läuft den Pfad entlang (wippt beim Gehen, Beine und Räder bewegen sich)
  const token = (d, col, fig, dur, delay = 0, ox = 0, oy = 0, bob = 0.22) => {
    const fw = FIG_W[fig] || 12;
    return `<g visibility="hidden"><g transform="translate(${ox} ${oy})"><g class="walker" style="animation-duration:${bob}s"><use href="#fig-${fig}" x="${-fw / 2 - 1}" y="-19" width="${fw + 2}" height="20" style="color:${col}"/></g></g>
      <set attributeName="visibility" to="visible" begin="indefinite" data-delay="${delay}"/>
      <animateMotion dur="${dur}s" begin="indefinite" fill="freeze" path="${d}" calcMode="spline" keyTimes="0;1" keySplines=".45 0 .55 1" data-delay="${delay}"/></g>`;
  };

  const ARROW = `<path d="M-4.6 0 H3.4" stroke="#2b1d12" stroke-width="1.5"/><path d="M-4.6 0 H3.4" stroke="#c08a50" stroke-width=".7"/><path d="M-4.6 0 l-1.2 -1.2 M-4.6 0 l-1.2 1.2" stroke="#f1e7cf" stroke-width=".7"/><path d="M3 -1.5 L5.8 0 L3 1.5 Z" fill="#d4dbe1" stroke="#2b1d12" stroke-width=".4"/>`;
  // Staubwolke: n Bällchen fliegen auseinander
  const puffs = (x, y, n, delay, r = 10) => Array.from({ length: n }, (_, k) => {
    const a = k / n * Math.PI * 2 + 0.4;
    return `<circle class="fx-puff" cx="${x}" cy="${y}" r="${2 + (k % 2)}" style="--tx:${(Math.cos(a) * r).toFixed(1)}px;--ty:${(Math.sin(a) * r * 0.5 - 2).toFixed(1)}px;animation-delay:${(delay + (k % 3) * 0.05).toFixed(2)}s"/>`;
  }).join('');
  // Geschosse (Steine oder Pfeile) fliegen im Bogen von a nach b
  function shots(kind, x1, y1, x2, y2, n, delay) {
    let h = '';
    for (let k = 0; k < n; k++) {
      const ox = Math.sin(k * 2.1) * 5, oy = Math.cos(k * 1.7) * 4, tx = x2 + Math.cos(k * 2.6) * 6, ty = y2 + Math.sin(k * 1.9) * 4;
      const mx = (x1 + ox + tx) / 2, my = Math.min(y1, ty) - Math.hypot(tx - x1, ty - y1) * (kind === 'stone' ? 0.55 : 0.4);
      const d = `M${(x1 + ox).toFixed(1)} ${(y1 + oy).toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`;
      const art = kind === 'stone' ? '<circle r="2" fill="#a99f89" stroke="#2b1d12" stroke-width=".6"/><circle cx="-.6" cy="-.6" r=".6" fill="#e9e2cf"/>' : ARROW;
      h += `<g visibility="hidden">${art}<set attributeName="visibility" to="visible" begin="indefinite" data-delay="${(delay + k * 0.12).toFixed(2)}"/>
        <animateMotion dur="${kind === 'stone' ? 0.65 : 0.5}s" begin="indefinite" fill="freeze" path="${d}" rotate="auto" calcMode="spline" keyTimes="0;1" keySplines=".3 0 .7 1" data-delay="${(delay + k * 0.12).toFixed(2)}"/>
        <set attributeName="visibility" to="hidden" begin="indefinite" data-delay="${(delay + k * 0.12 + (kind === 'stone' ? 0.65 : 0.5)).toFixed(2)}"/></g>`;
    }
    return h;
  }

  // Pfeilhagel: viele kleine Pfeile fliegen in hohem Bogen auf das Ziel
  function playVolley(v) {
    const C = S.state.cells, f = C[v.from], t = C[v.to];
    let html = '';
    for (let k = 0; k < Math.min(12, 3 + v.n * 2); k++) {
      const ox = (Math.sin(k * 2.1) * 8).toFixed(1), oy = (Math.cos(k * 1.7) * 6).toFixed(1);
      const x1 = f.lx + +ox, y1 = f.ly + +oy, x2 = t.lx + (Math.cos(k * 2.6) * 10), y2 = t.ly + (Math.sin(k * 1.9) * 8);
      const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - Math.hypot(x2 - x1, y2 - y1) * 0.45;
      const d = `M${x1} ${y1} Q${mx} ${my} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      html += `<g>${ARROW}
        <animateMotion dur="0.7s" begin="indefinite" fill="freeze" path="${d}" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".3 0 .7 1"/></g>`;
    }
    html += puffs(t.lx, t.ly + 2, 7, 0.72, 12);
    html += `<text class="fx-dmg" x="${t.lx}" y="${t.ly - 30}">${v.killed ? '−' + v.killed : 'daneben'}</text>`;
    startFx(html, 2000);
    Sound.play('volley');
  }

  function playMarch(m) {
    const C = S.state.cells, col = S.state.players[C[m.to].owner].color;
    const d = curve(C[m.from], C[m.to]);
    // kleine Kolonne: bis zu drei Figuren hintereinander, mit Staub an den Füßen
    const n = Math.min(3, Math.max(1, Math.ceil((m.n || 1) / 3)));
    let html = `<path class="fx-arrow march" d="${d}" stroke="#4ade80"/>`;
    const OFF = [[0, 0], [-2.6, 1.8], [2.4, -1.4]];
    for (let k = n - 1; k >= 0; k--) html += token(d, col, m.fig || 'w', 1.15 + k * 0.05, k * 0.16, OFF[k][0], OFF[k][1], 0.21 + k * 0.03);
    const t = C[m.to];
    html += Array.from({ length: 6 }, (_, k) => `<circle class="fx-puff" cx="${t.lx}" cy="${t.ly + 2}" r="${2 + (k % 2)}" style="--tx:${(Math.cos(k * 1.05) * 10).toFixed(1)}px;--ty:${(Math.sin(k * 1.05) * 4 - 2).toFixed(1)}px;animation-delay:${(1.1 + n * 0.16).toFixed(2)}s"/>`).join('');
    startFx(html, 2300);
    Sound.play('march');
  }

  // Einmarsch mit Gefecht: Angreifer laufen hinein, Verteidiger stellen sich, kurzer Kampf, dann fällt der Verlierer
  function playBattle(b) {
    const st = S.state, C = st.cells;
    const to = C[b.to], froms = b.froms || [b.from];
    const attacker = b.won ? to.owner : C[b.from].owner;
    const acol = st.players[attacker] ? st.players[attacker].color : '#fff';
    const dcol = b.prev >= 0 && st.players[b.prev] ? st.players[b.prev].color : '#8a7f69';
    const x2 = to.lx, y2 = to.ly, f0 = C[b.from];
    // Blickrichtung: vom Hauptangreifer zur Provinz
    let dx = x2 - f0.lx, dy = y2 - f0.ly; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const flipA = dx < 0 ? -1 : 1, px = -dy, py = dx;
    const nA = Math.min(3, Math.max(1, Math.ceil((b.an || 3) / 3))), nD = b.dfig ? Math.min(3, Math.max(1, Math.ceil((b.dn || 1) / 3))) : 0;
    const fig = (t, col, x, y, cls, flip, vars) => {
      const fw = FIG_W[t] || 12, h = t === 'dr' ? 22 : 18;
      return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><g class="bt ${cls}" style="${vars}"><g transform="scale(${flip} 1)"><g class="hurt">
        <use href="#fig-${t}" x="${(-fw * h / 17 / 2).toFixed(1)}" y="${-h}" width="${(fw * h / 17).toFixed(1)}" height="${h}" style="color:${col}"/></g></g></g></g>`;
    };
    let html = '';
    // eroberte Provinz färbt sich am Ende
    if (b.won) {
      const ol = MapView.outlines(st.geo);
      html += `<clipPath id="fxclip"><path d="${ol.prov[b.to]}"/></clipPath>
        <g clip-path="url(#fxclip)"><circle class="fx-flood late" cx="${x2}" cy="${y2}" r="${st.geo.s * 12}" fill="${acol}"/></g>`;
    }
    froms.forEach(f => { html += `<path class="fx-arrow" d="${curve(C[f], to)}" stroke="${acol}"/>`; });
    // Verteidiger stehen in der Provinz und schauen den Angreifern entgegen
    for (let k = 0; k < nD; k++) {
      const off = (k - (nD - 1) / 2) * 8;
      const x = x2 + dx * 6 + px * off, y = y2 + dy * 6 + py * off + 4;
      html += fig(b.dfig, dcol, x, y, `def ${b.won ? 'lose' : 'win'}`, -flipA, `--lx:${(dx * 3).toFixed(1)}px;--ly:${(dy * 3).toFixed(1)}px;--swing-delay:${0.75 + k * 0.07}s;--hit-delay:${0.86 + k * 0.07}s;animation-delay:0s,${0.75 + k * 0.07}s,1.95s`);
    }
    // Angreifer marschieren aus ihren Provinzen herein
    for (let k = 0; k < nA; k++) {
      const src = C[froms[k % froms.length]], off = (k - (nA - 1) / 2) * 8;
      const x = x2 - dx * (nD ? 8 : 0) + px * off, y = y2 - dy * (nD ? 8 : 0) + py * off + 4;
      html += fig(b.fig || 'w', acol, x, y, `att ${b.won ? 'win' : 'lose'}${nD ? '' : ' free'}`, flipA,
        `--sx:${(src.lx - x).toFixed(1)}px;--sy:${(src.ly - y).toFixed(1)}px;--lx:${(-dx * 3).toFixed(1)}px;--ly:${(-dy * 3).toFixed(1)}px;--ax:${(dx * 9).toFixed(1)}px;--ay:${(dy * 9).toFixed(1)}px;--swing-delay:${0.75 + k * 0.07}s;--hit-delay:${0.86 + k * 0.07}s;animation-delay:${k * 0.08}s,${0.75 + k * 0.07}s,1.95s`);
    }
    // Belagerung und Fernkampf: Steine der Katapulte bzw. Pfeile der Bogenschützen fliegen voraus
    const src0 = C[froms[0]], aim = K.isCity(to) ? [x2, y2 - 24] : [x2 + dx * 4, y2 - 6];
    if (b.fig === 'c' || b.fig === 't') html += shots('stone', src0.lx, src0.ly - 10, aim[0], aim[1], 3, 0.05) + puffs(aim[0], aim[1] + 4, 8, 0.7, 12);
    else if (b.fig === 'a' || b.fig === 'l') html += shots('arrow', src0.lx, src0.ly - 8, x2 + dx * 5, y2 - 4, 5, 0.1);
    // Funken und Staub, wo sich die Reihen treffen
    if (nD) {
      const mx = x2 - dx * 1, my = y2 - dy * 1 - 6;
      for (let k = 0; k < 5; k++) {
        const sx = mx + Math.sin(k * 2.3) * 7, sy = my + Math.cos(k * 1.7) * 5;
        html += `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})"><path class="bt-spark" style="animation-delay:${(0.8 + k * 0.24).toFixed(2)}s" d="M0 -5 L1.2 -1.2 L5 0 L1.2 1.2 L0 5 L-1.2 1.2 L-5 0 L-1.2 -1.2 Z"/></g>`;
      }
      html += Array.from({ length: 10 }, (_, k) => {
        const a = k / 10 * Math.PI * 2, r = 12 + (k % 3) * 5;
        return `<circle class="fx-puff" cx="${mx}" cy="${my + 8}" r="${2 + (k % 2)}" style="--tx:${(Math.cos(a) * r).toFixed(1)}px;--ty:${(Math.sin(a) * r * 0.5).toFixed(1)}px;animation-delay:${(0.75 + (k % 4) * 0.25).toFixed(2)}s"/>`;
      }).join('');
      html += `<g transform="translate(${mx.toFixed(1)} ${(my + 2).toFixed(1)})"><path class="bt-spark bt-burst" d="M0 -9 L2.2 -2.6 L9 -3.4 L3.4 1 L6.6 7.4 L0 3.8 L-6.6 7.4 L-3.4 1 L-9 -3.4 L-2.2 -2.6 Z"/></g>
        <g transform="translate(${mx.toFixed(1)} ${(my - 14).toFixed(1)})"><g class="bt-clash"><use href="#fx-swords" x="-7" y="-7" width="14" height="14"/></g></g>`;
    }
    if (b.won) {
      html += `<circle class="fx-ring late" cx="${x2 + 8}" cy="${y2 - 6}" r="10"/><circle class="fx-ring r2 late" cx="${x2 + 8}" cy="${y2 - 6}" r="16"/>
        <g class="fx-flagwrap late" transform="translate(${x2 + 8} ${y2 - 6})"><g class="fx-flag">
          <line x1="0" y1="0" x2="0" y2="-24" stroke="#2b1d12" stroke-width="2.4" stroke-linecap="round"/><line x1="0" y1="0" x2="0" y2="-24" stroke="#8f5a30" stroke-width="1.2"/>
          <circle cx="0" cy="-24.6" r="1.6" fill="#f2c53d" stroke="#2b1d12" stroke-width=".5"/>
          <path class="fx-cloth" d="M0.8 -23 Q8 -25 15 -21 Q9 -18 0.8 -15 Z" fill="${acol}" stroke="#2b1d12" stroke-width=".7" stroke-linejoin="round"/></g></g>
        <text class="fx-text win late" x="${x2}" y="${y2 + 30}">Erobert!</text>`;
    } else {
      html += `<g class="fx-shield late"><use href="#crest" x="${x2 - 9}" y="${y2 - 40}" width="18" height="20"/></g>
        <text class="fx-text lose late" x="${x2}" y="${y2 + 30}">Abgewehrt!</text>`;
    }
    if (b.aL) html += `<text class="fx-dmg late" x="${x2 - dx * 14}" y="${y2 - dy * 14 - 22}">−${b.aL}</text>`;
    if (b.dL) html += `<text class="fx-dmg late" x="${x2 + dx * 10}" y="${y2 + dy * 10 - 26}">−${b.dL}</text>`;
    startFx(html, 3600);
    // Klirren während des Gefechts, Wackeln beim Aufprall
    if (nD) { [0.8, 1.15, 1.5].forEach((t, k) => setTimeout(() => Sound.play(k === 1 ? 'battle' : 'volley'), t * 1000)); }
    else setTimeout(() => Sound.play('march'), 100);
    setTimeout(() => { const svg = svgEl(); svg.classList.remove('shake'); void svg.getBoundingClientRect(); svg.classList.add('shake'); }, 800);
    const meInvolved = attacker === S.me || b.prev === S.me;
    if (meInvolved) keepVisible(b.to);
    setTimeout(() => Sound.play(b.won === (attacker === S.me) || !meInvolved && b.won ? 'win' : 'lose'), 2000);

    setTimeout(() => {
      const ban = $('#banner');
      ban.innerHTML = `${pName(attacker)} ${b.won ? 'erobert' : 'scheitert an'} <b>${esc(to.name)}</b> (${Math.round(b.p * 100)} %${froms.length > 1 ? ` · aus ${froms.length} Provinzen` : ''})` +
        ` <span class="loss">Verluste −${b.aL} / −${b.dL}${b.reward ? ' ·' + esc(b.reward) : ''}</span>`;
      ban.hidden = false;
      ban.classList.toggle('good', b.won);
      clearTimeout(S.banTimer);
      S.banTimer = setTimeout(() => { ban.hidden = true; }, 2800);
    }, 1900);
  }

  // ---------- Info, HUD, Leiste ----------

  const unitChips = u => K.TYPES.filter(t => u[t] > 0).map(t => `<span class="chip"><svg class="ico"><use href="#u-${t}"/></svg>${u[t]}</span>`).join('');

  function showInfo(i) {
    const st = S.state, c = st.cells[i], box = $('#info');
    if (!c) { box.hidden = true; return; }
    const T = K.TERRAIN[c.terrain];
    const y = K.provinceYield(st, c);
    const L = c.lair && K.LAIRS[c.lair];
    const kind = L ? `${L.icon} ${L.name}` : c.capital ? '👑 Hauptstadt' : c.throne ? '👑 Thronstadt' : c.building ? K.BUILDINGS[c.building].name : c.hut ? '🛖 Dorf' : '';
    const px = c.owner >= 0 && c.owner !== S.me ? K.pactOf(st, S.me, c.owner) : null;
    const chips = [px ? `${K.PACTS[px.kind].icon} ${K.PACTS[px.kind].name}` : '', T.name, `${K.PSIZE[c.sz].name}e Provinz`, c.river ? '🏞️ Fluss' : '', c.coast ? '⚓ Küste' : '', kind, c.walls ? '🧱 Stadtmauern' : '', `🛡️ ×${K.defMult(c, false).toFixed(2).replace(/\.?0+$/, '')}`]
      .filter(Boolean).map(t => `<span class="chip">${t}</span>`).join('');
    const mine = c.owner === S.me && st.turn === S.me;
    const divs = c.divs.map(v => `<div class="urow"><b class="dname">${esc(v.name)}</b><span class="chips">${unitChips(v.u)}</span>
        ${mine ? `<span class="tag">${v.done ? 'bewegt' : 'bereit'}</span>` : ''}</div>`).join('') ||
      (c.owner >= 0 ? '<div class="tag">⚠️ Keine Truppen – ungeschützt!</div>' : '');
    let extra = '';
    if (attackable(i) && pickTotal()) {
      const o = K.odds(st, S.me, selUnits(), c);
      const p = Math.round(o.p * 100), cls = p >= 70 ? 'hi' : p >= 45 ? 'mid' : 'lo';
      extra = `<div class="chance ${cls}"><div>Angriff <b>${o.A.toFixed(1)}</b> gegen Verteidigung <b>${o.D.toFixed(1)}</b></div>
        <div class="bar"><i style="width:${p}%"></i></div><div>Siegchance <span class="pct">${p} %</span> <span class="tag">mit deiner Auswahl</span></div></div>`;
    } else if (truceProtected(i) && c.owner !== S.me) extra = `<div class="tag">🕊️ Friedenszeit bis Runde ${st.truce}</div>`;
    box.innerHTML = `<div class="ihead"><b>${esc(c.name)}</b><span>${c.owner >= 0 ? pName(c.owner) : '<span class="tag">Neutral</span>'}${canHover ? '' : '<button class="ghost iclose" data-unpin title="Schließen">✕</button>'}</span></div>
      <div class="chips">${chips}</div>
      <div class="tag">Ertrag pro Runde: ${coin('+' + y.gold)}${y.sci ? ' ' + scroll('+' + y.sci) : ''}${K.RKEYS.filter(k => y[k]).map(k => ' ' + resAmt(k, '+' + y[k])).join('')}${c.owner < 0 ? ' (nach Eroberung)' : ''}</div>
      ${c.hut ? '<div class="tag">Erobern bringt Gold, Wissen oder Rohstoffe</div>' : ''}
      ${myTurn() && S.mode === 'build' && c.owner === S.me ? `<div class="buildable">🔨 Hier baubar: ${[...BLDG_ORDER.filter(b => K.canBuild(st, S.me, i, b)).map(b => K.BUILDINGS[b].name), ...(K.isCity(c) && !c.walls && K.hasTech(st, S.me, 'fortification') ? ['Stadtmauern'] : [])].join(', ') || (c.building ? `nichts – hier steht schon ${K.BUILDINGS[c.building].name}` : 'nichts (Forschung oder Gelände fehlt)')}</div>` : ''}
      ${L ? `<div class="treasure">💰 Schatz: +${L.gold} Gold, +${L.sci} Wissen – besiege die Monster!</div>` : ''}
      ${c.owner >= 0 ? `<div class="tag">Truppen ${K.total(c.u)} / ${K.capOf(c)} (Platz in der Provinz)</div>` : ''}
      ${quickBuild(i)}
      ${divs}${extra}`;
    box.hidden = false;
    box.classList.toggle('pinned', S.pin === i);
    S.infoCell = i;
  }

  // Bauen direkt aus dem Infofeld: alle Gebäude, die hier gerade gehen
  function quickBuild(i) {
    const st = S.state, c = st.cells[i];
    if (!myTurn() || c.owner !== S.me || (canHover && S.pin !== i)) return '';
    const pl = st.players[S.me];
    const list = [...BLDG_ORDER.filter(b => K.canBuild(st, S.me, i, b)), ...(K.isCity(c) && !c.walls && K.hasTech(st, S.me, 'fortification') ? ['walls'] : [])];
    const head = canHover ? `<div class="qhead"><b>🔨 Hier bauen</b><button data-unpin class="ghost" title="Schließen (Esc)">✕</button></div>` : '<div class="qhead"><b>🔨 Hier bauen</b></div>';
    if (!list.length) return `<div class="qbuild">${head}<span class="tag">${c.capital ? 'In der Hauptstadt ist kein Platz für Gebäude.' : c.building ? `Hier steht schon: ${K.BUILDINGS[c.building].name}.` : 'Nichts möglich – Forschung oder passendes Gelände fehlt.'}</span></div>`;
    return `<div class="qbuild">${head}<div class="qlist">${list.map(b => {
      const I = bInfo(b), miss = K.lack(pl, I.cost, I.need || {});
      return `<button data-qb="${b}" data-qc="${i}" ${miss ? 'disabled' : ''} title="${I.name}: ${I.desc}${miss ? ' – ' + miss : ''}">
        <svg class="ico"><use href="${I.icon}" style="color:${pl.color}"/></svg><span>${I.name}<small>${I.desc}</small></span>${price(I.cost, I.need, pl)}</button>`;
    }).join('')}</div></div>`;
  }
  $('#info').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.unpin !== undefined) { S.pin = -1; $('#info').hidden = true; return; }
    if (b.dataset.qb) {
      const i = +b.dataset.qc;
      act(b.dataset.qb === 'walls' ? { type: 'walls', cell: i } : { type: 'build', cell: i, b: b.dataset.qb });
    }
  });

  function renderHud() {
    const st = S.state, pl = st.players[S.me], cur = st.players[st.turn];
    const curAva = S.avatars && S.avatars[st.turn];
    $('#turnPlate').innerHTML = `${curAva ? `<img class="ava tp" src="${curAva}" alt="" style="border-color:${cur.color}">` : `<svg class="shield" viewBox="-11 -12 22 26"><path d="M-9 -10h18v7.5c0 7.5 -4.95 11 -9 13c-4.05 -2 -9 -5.5 -9 -13z" fill="${cur.color}" stroke="#e8b64c" stroke-width="1.4"/></svg>`}
      <div><div class="tp-round">Runde ${Math.min(st.round, st.maxRounds)} / ${st.maxRounds}</div>
      <div class="tp-who">${st.over ? 'Spiel beendet' : myTurn() ? 'Du bist am Zug' : esc(cur.name) + ' ist am Zug…'}</div></div>`;
    if (pl) {
      const s = K.stats(st, S.me);
      $('#res').innerHTML = `<span title="Gold: Einnahmen ${s.gross} − Unterhalt ${s.upkeep} = ${s.income} pro Runde">${coin(pl.gold)}<small>${s.income >= 0 ? '+' : ''}${s.income}</small></span><span class="sep"></span>
        <span title="Wissen: für Forschung">${scroll(pl.sci)}<small>+${s.sciIncome}</small></span><span class="sep"></span>
        ${K.RKEYS.map(k => `<span class="rs" title="${K.RES[k].name}: ${s[k + 'Income'] >= 0 ? '+' : ''}${s[k + 'Income']} pro Runde${k === 'food' ? ` (Armeen essen ${s.feed})` : ''}">${resAmt(k, s[k])}<small class="${s[k + 'Income'] < 0 ? 'neg' : ''}">${s[k + 'Income'] >= 0 ? '+' : ''}${s[k + 'Income']}</small></span>`).join('')}<span class="sep"></span>
        <span class="cells" title="Deine Provinzen">🏳️ ${s.cells}</span><span class="sep cells"></span>
        <span title="Deine Truppen (Unterhalt ${s.upkeep} Gold pro Runde)">⚔️ ${s.troops}</span>`;
    }
    const nRes = researchable();
    $('#btnResearch').classList.toggle('ready', !!(nRes && myTurn()));
    $('#btnResearch').innerHTML = `🔬 <span>Forschung</span>${nRes ? `<i class="badge">${nRes}</i>` : ''}`;
    document.title = myTurn() ? '⚔️ Dein Zug! – Kingdoms' : 'Kingdoms';
  }

  // Divisions-Leiste: auswählen, teilen, zusammenlegen
  function armyPanel() {
    const st = S.state, c = st.cells[S.sel];
    const roads = K.hasTech(st, S.me, 'roads') ? 1 : 0;
    const rows = c.divs.map(v => {
      const on = S.selDivs.includes(v.id);
      const mp = K.mpOf(st, S.me, v.u);
      const splitting = S.split && S.split.div === v.id;
      let splitUi = '';
      if (splitting) {
        splitUi = `<div class="splitbox"><span class="tag">Neue Division bekommt:</span>
          ${K.TYPES.filter(t => v.u[t] > 0).map(t => `<div class="stepper small"><svg class="ico"><use href="#u-${t}"/></svg>
            <button data-sp="${t}" data-d="-1" ${S.split.u[t] ? '' : 'disabled'}>−</button><b>${S.split.u[t]}</b>
            <button data-sp="${t}" data-d="1" ${S.split.u[t] < v.u[t] ? '' : 'disabled'}>+</button></div>`).join('')}
          <button data-spgo class="primary" ${K.total(S.split.u) && K.total(S.split.u) < K.total(v.u) ? '' : 'disabled'}>✂️ Teilen</button>
          <button data-spno>Abbrechen</button></div>`;
      }
      return `<div class="drow ${on ? 'on' : ''} ${v.done ? 'spent' : ''}">
          <button class="dpick" data-dv="${v.id}" ${v.done ? 'disabled' : ''} title="${on ? 'Abwählen' : 'Auswählen'}">${on ? '☑' : '☐'}</button>
          <span class="aname">${esc(v.name)}<small>${v.done ? 'hat sich bewegt' : `bereit · ${mp + 0 * roads} Bew.`}${v.goal != null ? ` · 🚩 nach ${esc(st.cells[v.goal].name)}` : ''}</small></span>
          ${v.goal != null ? `<button class="dsplit" data-dgo="${v.id}" title="Marschbefehl aufheben">🚩✕</button>` : ''}
          <span class="chips">${unitChips(v.u)}</span>
          <button class="dsplit" data-dsplit="${v.id}" ${K.total(v.u) > 1 ? '' : 'disabled'} title="Division teilen">✂️</button>
        </div>${splitUi}`;
    }).join('');
    const nSel = S.selDivs.length, mp = K.mpOf(st, S.me, selUnits());
    return `<div class="army"><div class="ahead"><b>${esc(c.name)}</b>
        <span class="tag">${nSel} Division${nSel === 1 ? '' : 'en'} · ${pickTotal()} Einheiten · Reichweite ${mp}</span>
        <button data-dall>Alle</button>
        ${c.u.l && !c.shot ? `<button data-shoot class="shootbtn" title="Langbogenschützen schießen bis 2 Provinzen weit">🏹 Fernschuss (${c.u.l})</button>` : ''}
        <button data-dmerge ${nSel >= 2 ? '' : 'disabled'} title="Ausgewählte Divisionen zu einer verbinden">🔗 Zusammenlegen</button></div>${rows}</div>`;
  }

  // Forschungen, die man sich gerade leisten kann
  const researchable = () => { const st = S.state, pl = st && st.players[S.me]; return pl ? Object.keys(K.TECHS).filter(t => K.canResearch(st, S.me, t) && pl.sci >= K.TECHS[t].cost).length : 0; };

  function renderBar() {
    const st = S.state, bar = $('#actionbar'), mt = myTurn();
    const dead = st.players[S.me] && !st.players[S.me].alive;
    if (!mt && (dead || st.over || !st.players[S.me])) {
      bar.innerHTML = `<div class="wait">${dead ? '💀 Dein Reich ist gefallen – du kannst weiter zuschauen.' : st.over ? 'Das Spiel ist vorbei.' : `⏳ ${pName(st.turn)} ist am Zug…`}</div>`;
      return;
    }
    const pl = st.players[S.me], gold = pl.gold, nRes = researchable();
    const tabs = `<div class="tabs">
        <button data-mode="recruit" class="${S.mode === 'recruit' ? 'on' : ''}" title="Taste 1">🛡️ Ausbilden</button>
        <button data-mode="build" class="${S.mode === 'build' ? 'on' : ''}" title="Taste 2">🔨 Bauen</button>
        <button data-mode="army" class="${S.mode === 'army' ? 'on' : ''}" title="Taste 3">⚔️ Armeen</button>
        <button data-research class="restab ${nRes && mt ? 'ready' : ''}" title="Forschung (Taste 4 oder R)">🔬 Forschung${nRes ? `<i class="badge">${nRes}</i>` : ''}</button>
      </div>`;
    let status = '', right = '', shop = '';
    if (S.mode === 'recruit') {
      const btn = t => {
        const u = K.UNITS[t], locked = !K.unitUnlocked(st, S.me, t);
        return `<button class="card-btn ${S.unit === t ? 'on' : ''} ${locked ? 'locked' : ''}" data-unit="${t}" ${locked || !mt || K.lack(pl, u.cost, u.need) ? 'disabled' : ''}
            title="${u.name}: Angriff ${u.atk}, Verteidigung ${u.def}, Bewegung ${u.mp}${u.note ? ' – ' + u.note : ''}">
          <svg class="ico"><use href="#u-${t}"/></svg>
          <span><b>${u.name}</b><small>${locked ? '🔒 ' + K.TECHS[u.tech].name : `A${u.atk} · V${u.def} · Bew. ${u.mp}`}</small></span>${price(u.cost, u.need, pl)}</button>`;
      };
      status = `Tippe auf deine Hauptstadt 👑${K.hasTech(st, S.me, 'masonry') ? ', eine Festung' : ''}${K.hasTech(st, S.me, 'drill') ? ' oder eine Kaserne' : ''} – neue Truppen bilden eine eigene Division`;
      right = `<div class="amount"><button data-amt="1" class="${S.amount === 1 ? 'on' : ''}">×1</button><button data-amt="5" class="${S.amount === 5 ? 'on' : ''}">×5</button></div>`;
      const own = K.TYPES.filter(t => !K.UNITS[t].monster);
      const openU = own.filter(t => K.unitUnlocked(st, S.me, t)), closedU = own.filter(t => !openU.includes(t));
      const moreU = closedU.length ? (S.showLocked ? closedU.map(btn).join('')
        : `<button class="card-btn more-locked" data-showlocked><span class="demo-ico">🔒</span><span><b>${closedU.length} weitere</b><small>Forschung nötig</small></span></button>`) : '';
      shop = `<div class="shop">${openU.map(btn).join('')}${moreU}</div>`;
    } else if (S.mode === 'build') {
      const list = BUILD_CATS[S.bcat];
      const open = list.filter(b => { const I = bInfo(b); return !I.tech || K.hasTech(st, S.me, I.tech); });
      const closed = list.filter(b => !open.includes(b));
      // wo kann man das gerade bauen?
      const spots = b => st.cells.filter((c, i) => (b === 'walls' ? c.owner === S.me && K.isCity(c) && !c.walls
        : b === 'demolish' ? c.owner === S.me && ((c.building && !c.throne) || c.walls) : K.canBuild(st, S.me, i, b))).length;
      const card = b => {
        const I = bInfo(b), locked = I.tech && !K.hasTech(st, S.me, I.tech), n = locked ? 0 : spots(b);
        return `<button class="card-btn ${S.bldg === b ? 'on' : ''} ${locked ? 'locked' : ''} ${!locked && !n ? 'nospot' : ''}" data-bldg="${b}" ${locked || !mt || K.lack(pl, I.cost, I.need || {}) ? 'disabled' : ''}
            title="${I.name}: ${I.desc}. Kosten: ${priceText(I.cost, I.need) || 'nichts'}. Wo: ${I.where}${locked ? '' : ` – gerade an ${n} Ort${n === 1 ? '' : 'en'} möglich`}">
          ${locked ? '' : `<i class="badge spot" title="mögliche Orte">${n}</i>`}
          ${I.emoji ? `<span class="demo-ico">${I.emoji}</span>` : `<svg class="ico"><use href="${I.icon}" style="color:${pl.color}"/></svg>`}
          <span><b>${I.name}</b><small>${locked ? '🔒 ' + K.TECHS[I.tech].name : I.desc}</small></span>${I.cost ? price(I.cost, I.need, pl) : ''}</button>`;
      };
      const cats = `<div class="cats">${[['eco', '🌾 Wirtschaft'], ['mil', '🛡️ Militär'], ['tools', '🔨 Werkzeuge']]
        .map(([k, l]) => `<button data-bcat="${k}" class="${S.bcat === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      const I = bInfo(S.bldg);
      status = S.bldg === 'demolish' ? 'Abreißen: tippe auf ein eigenes Gebäude oder eine Stadtmauer – die Hälfte der Kosten gibt es zurück'
        : S.bldg === 'walls' ? 'Stadtmauern: tippe auf deine Hauptstadt oder eine Festung' : `${I.name}: tippe auf eine leuchtende Provinz (${I.where}) – oder tippe eine eigene Provinz an und baue dort direkt`;
      shop = `<div class="shop-wrap">${cats}<div class="shop">${open.map(card).join('')}${closed.map(card).join('')}</div></div>`;
    } else {
      status = S.sel >= 0 ? '<span class="lg mov"></span>marschieren · <span class="lg atk"></span>angreifen – Ziel antippen, Figur hinziehen oder Rechtsklick'
        : 'Tippe eine Figur (Division) oder eine Provinz an – oder ziehe eine Figur direkt auf ein Ziel';
      if (S.sel >= 0 && mt) shop = armyPanel();
    }
    if (!mt) { status = `⏳ ${pName(st.turn)} ist am Zug – schau dich schon um und plane deinen nächsten Zug.`; right = ''; }
    bar.innerHTML = `${tabs}<span class="status">${status}</span>
      <div class="right">${right}${mt && S.mode === 'army' ? (() => { const n = st.cells.filter(c => c.owner === S.me && readyDivs(c).length).length; return n ? `<button id="bNext" title="Nächste bereite Armee (Taste N)">⏭ ${n}</button>` : ''; })() : ''}${mt ? `<button id="bEnd" class="endturn ${S.mode === 'army' ? 'primary' : ''}" title="Leertaste">Zug beenden ➜</button>` : '<button id="bMini" title="Ritterlauf spielen, bis du dran bist">🏃 Ritterlauf</button>'}</div>${shop}`;
  }

  $('#actionbar').onclick = e => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset, st = S.state;
    if (d.mode) { S.mode = d.mode; deselect(); Sound.play('click'); tutEvent({ kind: 'mode' }); render(); }
    else if (d.research !== undefined) $('#btnResearch').click();
    else if (d.unit) { S.unit = d.unit; Sound.play('click'); renderBar(); }
    else if (d.bldg) { S.bldg = d.bldg; Sound.play('click'); renderBar(); renderProvinces(); }
    else if (d.bcat) {
      S.bcat = d.bcat; S.showLocked = false;
      const first = BUILD_CATS[S.bcat].find(b => { const I = bInfo(b); return !I.tech || K.hasTech(st, S.me, I.tech); });
      S.bldg = first || BUILD_CATS[S.bcat][0];
      Sound.play('click'); renderBar(); renderProvinces();
    }
    else if (d.showlocked !== undefined) { S.showLocked = !S.showLocked; renderBar(); }
    else if (t.id === 'bNext') nextArmy();
    else if (d.amt) { S.amount = +d.amt; renderBar(); }
    else if (d.dv) { selectDiv(S.sel, +d.dv, true); }
    else if (d.shoot !== undefined) { S.shootFrom = S.sel; Sound.play('select'); toast('Wähle ein Ziel für den Fernschuss (gelb markiert).'); render(); }
    else if (d.dall !== undefined) { S.selDivs = readyDivs(st.cells[S.sel]).map(v => v.id); Sound.play('click'); render(); }
    else if (d.dmerge !== undefined) { act({ type: 'merge', cell: S.sel, divs: [...S.selDivs] }); }
    else if (d.dgo) { act({ type: 'order', cell: S.sel, divs: [+d.dgo], to: null }); toast('Marschbefehl aufgehoben.'); }
    else if (d.dsplit) {
      const v = st.cells[S.sel].divs.find(x => x.id === +d.dsplit);
      const half = K.emptyU();
      for (const tt of K.TYPES) half[tt] = Math.floor(v.u[tt] / 2);
      if (!K.total(half)) { const tt = K.TYPES.find(x => v.u[x] > 0); half[tt] = 1; }
      S.split = { div: v.id, u: half };
      Sound.play('click'); renderBar();
    } else if (d.sp) { S.split.u[d.sp] = Math.max(0, S.split.u[d.sp] + +d.d); renderBar(); }
    else if (d.spno !== undefined) { S.split = null; renderBar(); }
    else if (d.spgo !== undefined) { const sp = S.split; S.split = null; act({ type: 'split', cell: S.sel, div: sp.div, units: sp.u }); }
    else if (t.id === 'bEnd') endTurn();
    else if (t.id === 'bMini') Mini.open();
  };

  // springt zur nächsten Provinz mit bereiten Truppen, damit keine Armee vergessen wird
  function nextArmy() {
    const st = S.state;
    const ready = st.cells.map((c, i) => i).filter(i => st.cells[i].owner === S.me && readyDivs(st.cells[i]).length);
    if (!ready.length) return toast('Alle Armeen haben sich in diesem Zug schon bewegt.');
    const i = ready.find(j => j > S.sel) ?? ready[0];
    S.mode = 'army';
    selectArmy(i);
    const c = st.cells[i];
    view.x = c.lx - view.w * 0.42; view.y = c.ly - view.h * 0.42;
    applyView();
  }

  async function endTurn() {
    if (!myTurn()) return;
    const st = S.state;
    // Hinweis, wenn noch viel ungenutzt ist (nicht im Tutorial)
    const idle = st.cells.reduce((s, c) => s + (c.owner === S.me ? K.total(K.avail(c)) : 0), 0);
    if (!S.tut && idle >= 6 && st.players[S.me].gold >= 2) {
      if (!await ask(`Du hast noch ${idle} bereite Truppen und ${st.players[S.me].gold} Gold. Zug trotzdem beenden?`, 'Zug beenden')) return;
    }
    deselect();
    S.lastLogN = S.state.logN || 0;
    act({ type: 'end' });
  }

  const canHover = window.matchMedia('(hover: hover)').matches;

  function onCell(i, dropped) {
    const st = S.state;
    if (!canHover || !myTurn()) showInfo(i);
    if (!canHover && S.mode !== 'army') keepVisible(i);
    if (!myTurn()) return;
    const c = st.cells[i], gold = st.players[S.me].gold;
    // am PC: Klick auf eine eigene Provinz heftet das Infofeld an – dort kann man direkt bauen
    if (canHover && !dropped && S.mode !== 'army') {
      if (c.owner === S.me) { S.pin = i; showInfo(i); } else if (S.pin >= 0) { S.pin = -1; showInfo(i); }
    }
    if (S.mode === 'recruit' && !dropped) {
      if (c.owner !== S.me || !K.canRecruit(c)) return toast('Einheiten bildest du in deiner Hauptstadt 👑, in Festungen oder Kasernen aus.');
      const U = K.UNITS[S.unit];
      const n = Math.min(S.amount, K.maxAfford(st.players[S.me], S.unit));
      if (n < 1) return toast(`Zu wenig – ein ${U.name} kostet ${priceText(U.cost, U.need)}.`);
      return act({ type: 'recruit', cell: i, units: { [S.unit]: n } });
    }
    if (S.mode === 'build' && !dropped) {
      if (S.bldg === 'walls') return act({ type: 'walls', cell: i });
      if (S.bldg !== 'demolish') return act({ type: 'build', cell: i, b: S.bldg });
      if (c.owner !== S.me || (!c.building && !c.walls)) return toast('Tippe auf eines deiner Gebäude oder eine Stadtmauer.');
      const what = c.building ? K.BUILDINGS[c.building].name : 'Stadtmauern', B = c.building ? K.BUILDINGS[c.building] : { cost: K.WALLS_COST, need: K.WALLS_NEED };
      const half = {}; for (const k of K.RKEYS) half[k] = Math.floor(((B.need || {})[k] || 0) / 2);
      ask(`${what} in ${esc(c.name)} abreißen? Du bekommst ${priceText(Math.floor(B.cost / 2), half) || 'nichts'} zurück.`, '🔨 Abreißen').then(ok => { if (ok) act({ type: 'demolish', cell: i }); });
      return;
    }
    if (S.shootFrom >= 0) {
      const from = S.shootFrom;
      S.shootFrom = -1;
      if (K.shootTargets(st, from).includes(i)) return act({ type: 'shoot', from, to: i });
      toast('Fernschuss abgebrochen.'); render(); return;
    }
    if (S.sel >= 0 && i !== S.sel && pickTotal()) {
      const from = S.sel;
      if (marchable().includes(i)) { const divs = [...S.selDivs]; S.selPref = [from]; S.selDivs = null; return act({ type: 'move', from, to: i, divs }); }
      if (attackable(i)) { openPlanner(i); return; }
      if (st.cells[from].n.includes(i)) {
        if (K.allied(st, S.me, c.owner)) { const x = K.pactOf(st, S.me, c.owner); return toast(`${K.PACTS[x.kind].icon} Ihr habt ${x.kind === 'peace' ? 'Frieden' : 'ein Bündnis'} – kündige zuerst den Vertrag (👑 Reiche).`); }
        if (truceProtected(i)) return toast(`Friedenszeit: Spieler können erst ab Runde ${st.truce + 1} angegriffen werden.`);
      }
      if (c.owner === S.me && (dropped || !readyDivs(c).length)) {
        const route = K.routeTo(st, S.me, from, i);
        if (!route) return toast('Dorthin gibt es keinen Landweg durch eigenes oder verbündetes Gebiet.');
        const mp = Math.max(1, K.mpOf(st, S.me, selUnits())), divs = [...S.selDivs];
        S.selPref = [from]; S.selDivs = null;
        toast(`🚩 Marschbefehl: Die Truppen ziehen jetzt jede Runde automatisch weiter nach ${c.name} (etwa ${Math.ceil(route.length / mp)} Runden).`);
        return act({ type: 'order', cell: from, divs, to: i });
      }
      if (dropped) return toast('Dorthin kommen diese Truppen nicht.');
    }
    if (c.owner === S.me && readyDivs(c).length) { if (i === S.sel) { deselect(); render(); } else selectArmy(i); return; }
    if (c.owner === S.me && c.u.l && !c.shot && S.mode === 'army') { S.shootFrom = i; toast('Die Truppen haben sich bewegt – aber die Langbogenschützen können noch schießen. Wähle ein Ziel.'); render(); return; }
    if (c.owner === S.me && K.total(c.u)) toast('Diese Truppen haben sich in diesem Zug schon bewegt.');
    deselect(); render();
  }

  // ---------- Angriffsplan: Divisionen aus allen Nachbarprovinzen zusammenziehen ----------

  function openPlanner(target) {
    const st = S.state, C = st.cells;
    const srcs = C.map((c, j) => j).filter(j => C[j].owner === S.me && readyDivs(C[j]).length && K.canStrike(st, j, target));
    S.plan = { target, picks: {} };
    for (const j of srcs) S.plan.picks[j] = j === S.sel ? [...S.selDivs] : [];
    $('#planner').hidden = false;
    renderPlanner();
    Sound.play('select');
    tutEvent({ kind: 'planner' });
  }

  function planForce() {
    const C = S.state.cells, pl = S.plan;
    return Object.entries(pl.picks).reduce((u, [j, ids]) => K.addU(u, K.divUnits(C[j].divs.filter(v => ids.includes(v.id)))), K.emptyU());
  }

  function renderPlanner() {
    const st = S.state, C = st.cells, pl = S.plan;
    if (!pl || !myTurn() || !hostileTo(pl.target)) { $('#planner').hidden = true; return; }
    const t = C[pl.target];
    const force = planForce();
    const o = K.odds(st, S.me, force, t);
    const p = Math.round(o.p * 100), cls = p >= 70 ? 'hi' : p >= 45 ? 'mid' : 'lo';
    const defU = unitChips(t.u) || '<span class="tag">keine Verteidiger</span>';
    const srcHtml = Object.keys(pl.picks).map(Number).map(j => {
      const c = C[j], ids = pl.picks[j];
      const rows = readyDivs(c).map(v => `<button class="drow pick ${ids.includes(v.id) ? 'on' : ''}" data-pj="${j}" data-pv="${v.id}">
          <span class="dpick">${ids.includes(v.id) ? '☑' : '☐'}</span><span class="aname">${esc(v.name)}</span><span class="chips">${unitChips(v.u)}</span></button>`).join('');
      const left = c.divs.filter(v => !ids.includes(v.id)).reduce((s, v) => s + K.total(v.u), 0);
      return `<div class="psrc"><div class="ahead"><b>${c.n.includes(pl.target) ? '' : '⛵ '}Aus ${esc(c.name)}</b>
          <span class="tag">${left ? `${left} Einheiten bleiben zurück` : '⚠️ Provinz bleibt leer'}</span>
          <button data-pall="${j}">Alle</button><button data-pnone="${j}">Keine</button></div>${rows}</div>`;
    }).join('');
    $('#planner').innerHTML = `<div class="modal planner">
      <div class="mhead"><h2>⚔️ Angriff auf ${esc(t.name)}</h2><button data-pclose class="ghost" title="Abbrechen (Esc)">✕</button></div>
      <div class="ptarget"><span>${t.owner >= 0 ? pName(t.owner) : '<span class="tag">Neutrale Provinz</span>'} · ${K.TERRAIN[t.terrain].name} · ${K.PSIZE[t.sz].name}${K.isCity(t) ? ' · Festung' : ''}</span>
        <span class="chips">${defU}</span></div>
      <h3>Angreifende Divisionen</h3>${srcHtml}
      <div class="chance ${cls}"><div>Angriff <b>${o.A.toFixed(1)}</b> gegen Verteidigung <b>${o.D.toFixed(1)}</b>
        <span class="tag">(Verteidigung ×${o.mult.toFixed(2).replace(/\.?0+$/, '')}${o.siege ? ', Katapulte ignorieren Festungen' : ''})</span></div>
        <div class="bar"><i style="width:${p}%"></i></div><div>Siegchance <span class="pct">${p} %</span></div></div>
      <p class="tag ${K.total(force) > K.capOf(t) ? 'warn' : ''}">Höchstens <b>${K.capOf(t)}</b> Truppen passen nach ${esc(t.name)} (gewählt: ${K.total(force)}). Gewinnst du, ziehen die Divisionen ein. Verlierst du, sind alle angreifenden Divisionen verloren.</p>
      <div class="row end"><button data-pclose>Abbrechen</button><button data-pgo class="danger" ${K.total(force) && K.total(force) <= K.capOf(t) ? '' : 'disabled'}>⚔️ Angreifen · ${p} %</button></div>
    </div>`;
  }

  $('#planner').addEventListener('click', e => {
    const pl = S.plan;
    if (e.target.id === 'planner' || e.target.closest('[data-pclose]')) { $('#planner').hidden = true; return; }
    const b = e.target.closest('button');
    if (!b || b.disabled || !pl) return;
    const d = b.dataset, C = S.state.cells;
    if (d.pv !== undefined) {
      const ids = pl.picks[d.pj], id = +d.pv;
      pl.picks[d.pj] = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
      Sound.play('click');
    } else if (d.pall !== undefined) pl.picks[d.pall] = readyDivs(C[+d.pall]).map(v => v.id);
    else if (d.pnone !== undefined) pl.picks[d.pnone] = [];
    else if (d.pgo !== undefined) { launchAttack(); return; }
    renderPlanner();
  });

  function launchAttack() {
    const pl = S.plan;
    if (!pl || !K.total(planForce())) return;
    const sources = Object.entries(pl.picks).filter(([, ids]) => ids.length).map(([j, ids]) => ({ cell: +j, divs: [...ids] }));
    $('#planner').hidden = true;
    S.selPref = [pl.target, S.sel];
    S.selDivs = null;
    S.plan = null;
    act({ type: 'attack', to: pl.target, sources });
  }

  // ---------- Tastenkürzel ----------

  const KEYS = [['Leertaste', 'Zug beenden'], ['1 / 2 / 3', 'Ausbilden / Bauen / Armeen'], ['4 oder R', 'Forschung'], ['N', 'nächste bereite Armee'],
    ['A', 'alle Divisionen der Provinz wählen'], ['S', 'gewählte Division teilen (halbe-halbe)'], ['M', 'gewählte Divisionen zusammenlegen'],
    ['T', 'Statistik'], ['D', 'Reiche und Diplomatie'], ['F', 'ganze Karte'], ['H', 'Spielanleitung'], ['Esc', 'abbrechen / schließen'], ['Enter', 'Angriff bestätigen'],
    ['Rechtsklick / Figur ziehen', 'marschieren oder angreifen – weit weg: Marschbefehl über mehrere Runden']];
  function showKeys() {
    const o = $('#confirm');
    o.innerHTML = `<div class="modal center keys"><h2>⌨️ Tastenkürzel</h2><table class="keytable">${KEYS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>
      <div class="row"><button data-a="1" class="primary">OK</button></div></div>`;
    o.hidden = false;
    o.onclick = e => { if (e.target === o || e.target.closest('[data-a]')) o.hidden = true; };
  }
  // Division halbieren (Taste S)
  function splitHalf() {
    const st = S.state, c = S.sel >= 0 && st.cells[S.sel];
    const v = c && S.selDivs && c.divs.find(x => x.id === S.selDivs[0]);
    if (!v) return toast('Wähle zuerst eine Division (Armeen).');
    const tot = K.total(v.u);
    if (tot < 2) return toast('Eine einzelne Einheit kann man nicht teilen.');
    const half = K.emptyU();
    for (const t of K.TYPES) half[t] = Math.floor(v.u[t] / 2);
    let need = Math.floor(tot / 2) - K.total(half);
    for (const t of K.TYPES) if (need > 0 && v.u[t] - half[t] * 2 > 0) { half[t]++; need--; }
    act({ type: 'split', cell: S.sel, div: v.id, units: half });
  }

  document.addEventListener('keydown', e => {
    if ((e.target.matches && e.target.matches('input, textarea')) || $('#game').hidden || !S.state || !$('#mini').hidden) return;
    const k = e.key;
    if (k === 'Escape') {
      if (!$('#stats').hidden) $('#stats').hidden = true;
      else if (!$('#planner').hidden) $('#planner').hidden = true;
      else if (!$('#research').hidden) $('#research').hidden = true;
      else if (!$('#help').hidden) $('#help').hidden = true;
      else { deselect(); render(); }
    } else if (k === 'Enter' && !$('#planner').hidden) launchAttack();
    else if (k === ' ' && $('#planner').hidden && $('#confirm').hidden) { e.preventDefault(); endTurn(); }
    else if (['1', '2', '3'].includes(k)) { S.mode = ['recruit', 'build', 'army'][+k - 1]; deselect(); tutEvent({ kind: 'mode' }); render(); }
    else if (k === '4') $('#btnResearch').click();
    else if ((k === 's' || k === 'S') && myTurn()) splitHalf();
    else if ((k === 'm' || k === 'M') && myTurn() && S.sel >= 0 && S.selDivs && S.selDivs.length >= 2) act({ type: 'merge', cell: S.sel, divs: [...S.selDivs] });
    else if ((k === 'a' || k === 'A') && myTurn() && S.sel >= 0) { S.selDivs = readyDivs(S.state.cells[S.sel]).map(v => v.id); render(); }
    else if (k === 't' || k === 'T') { if ($('#stats').hidden) openStats(); else $('#stats').hidden = true; }
    else if (k === 'd' || k === 'D') $('#side').classList.toggle('open');
    else if ((k === 'n' || k === 'N') && myTurn()) nextArmy();
    else if (k === 'r' || k === 'R') $('#btnResearch').click();
    else if (k === 'h' || k === 'H') openHelp();
    else if (k === 'f' || k === 'F') fitView();
  });

  // ---------- Ton ----------

  function renderSoundButtons() {
    for (const id of ['btnMusic', 'mMusic']) $('#' + id).classList.toggle('off', !Sound.music);
    for (const id of ['btnSfx', 'mSfx']) $('#' + id).classList.toggle('off', !Sound.sfx);
    $('#btnSfx').textContent = Sound.sfx ? '🔊' : '🔈';
    $('#mSfx').innerHTML = (Sound.sfx ? '🔊' : '🔈') + ' <span>Effekte</span>';
  }
  for (const id of ['btnMusic', 'mMusic']) $('#' + id).onclick = () => { Sound.toggleMusic(); renderSoundButtons(); };
  for (const id of ['btnSfx', 'mSfx']) $('#' + id).onclick = () => { Sound.toggleSfx(); renderSoundButtons(); Sound.play('click'); };
  renderSoundButtons();

  // ---------- Diplomatie ----------

  function renderPlayers() {
    const st = S.state, me = st.players[S.me];
    const pending = (a, b) => st.proposals.find(x => x.from === a && x.to === b);
    const canDip = me && me.alive && !st.over && !S.tut;
    $('#players').innerHTML = st.players.map((p, i) => {
      const s = K.stats(st, i), x = K.pactOf(st, S.me, i);
      let dip = '';
      if (i !== S.me && p.alive && canDip) {
        const out = pending(S.me, i), inc = pending(i, S.me);
        const rel = x ? `<span class="rel ${x.kind}">${K.PACTS[x.kind].icon} ${K.PACTS[x.kind].name}${x.ends != null ? ` <small>bis Ende R. ${x.ends}</small>` : ''}</span>`
          : '<span class="rel none">⚔️ kein Vertrag</span>';
        const btns = [];
        if (out) btns.push(`<span class="tag">${out.kind === 'peace' ? 'Frieden' : 'Bündnis'} angefragt…</span>`);
        else if (inc) btns.push('<span class="tag">📜 Angebot oben</span>');
        else {
          if (!x || x.ends != null) btns.push(`<button data-offer="peace" data-to="${i}" title="Nichtangriffspakt: ihr könnt euch nicht angreifen">🕊️ Frieden</button>`);
          if (!x || x.kind !== 'alliance' || x.ends != null) btns.push(`<button data-offer="alliance" data-to="${i}" title="Bündnis: kein Angriff, +1 Gold und +1 Wissen pro Runde für beide, gemeinsamer Sieg">🤝 Bündnis</button>`);
        }
        if (x && x.ends == null) btns.push(`<button data-cancel="${i}" title="Vertrag kündigen – gilt noch bis Ende der nächsten Runde">📜 Kündigen</button>`,
          `<button data-betray="${i}" class="kick" title="Vertrag sofort brechen – Verrat!">🗡️</button>`);
        btns.push(`<button data-gift="${i}" title="Gold oder Rohstoffe schenken">🎁</button>`);
        dip = `<div class="dip">${rel}${btns.join('')}</div>`;
      }
      const kick = S.role === 'host' && p.type === 'human' && p.cid && p.cid !== 'host' ? `<button data-kick="${esc(p.cid)}" class="kick" title="Aus dem Spiel werfen (KI übernimmt)">👢</button>` : '';
      const mark = i !== S.me && x ? ' ' + K.PACTS[x.kind].icon : '';
      const traitor = p.traitor > st.round ? ' <span class="tag warn" title="Hat kürzlich einen Vertrag gebrochen">🗡️ Verräter</span>' : '';
      const away = p.away ? ' <span class="tag" title="Verbindung verloren – die KI spielt, bis er zurückkommt">📡</span>' : '';
      return `<li class="${i === st.turn && !st.over ? 'cur' : ''} ${p.alive ? '' : 'dead'}" style="--pc:${p.color}">
        ${avatarHTML(S.avatars && S.avatars[i], p.name, p.color, 'sm')}
        <span class="nm">${esc(p.name)}${i === S.me ? ' (Du)' : ''}${mark}${traitor}${away}${p.realm ? `<small class="realmname">🏰 ${esc(p.realm)}</small>` : ''}</span>
        ${i === S.me && p.alive && !st.over ? '<button data-rename class="ghost" title="Reich umbenennen">✏️</button>' : ''}
        ${kick}
        <span class="st">${st.mode === 'throne' ? `<b class="crowns">👑 ${st.crowns[i]}/${st.crownGoal}</b> · ` : ''}${p.type === 'ai' ? `🤖 ${LEVELS[p.level] || ''} · ` : ''}🏳️ ${s.cells} · ⚔️ ${s.troops} · 🔬 ${s.techs} · ${K.score(st, i)} Punkte</span>
        ${dip}
      </li>`;
    }).join('');

    const incoming = st.over ? [] : st.proposals.filter(x => x.to === S.me);
    const reqs = S.role === 'host' && !st.over ? (S.joinReqs || []) : [];
    const awayIds = st.players.map((x, i) => i).filter(i => i > 0 && st.players[i].away && st.players[i].alive);
    $('#proposals').innerHTML = reqs.map(r => `
      <div class="proposal join"><div>🔌 <b>${esc(r.name)}</b> möchte ins laufende Spiel.
        <small class="tag">Nur wenn du sicher bist, wer das ist: Lass ihn ein Reich übernehmen, dessen Spieler die Verbindung verloren hat.</small></div>
        <div class="row">${awayIds.map(i => `<button data-jr="${r.id}" data-jp="${i}" class="primary">Als ${esc(st.players[i].name)}</button>`).join('')}<button data-jx="${r.id}">Ablehnen</button></div>
      </div>`).join('') + incoming.map(x => `
      <div class="proposal"><div>${x.kind === 'peace'
        ? `🕊️ ${pName(x.from)} bietet dir <b>Frieden</b> an.<small class="tag">Ihr könnt euch nicht mehr angreifen – bis einer kündigt.</small>`
        : `📜 ${pName(x.from)} bietet dir ein <b>Bündnis</b> an.<small class="tag">Kein Angriff, je +1 Gold und +1 Wissen pro Runde, und wenn nur noch Verbündete übrig sind, siegt ihr gemeinsam.</small>`}</div>
        <div class="row"><button data-acc="${x.from}" class="primary">Annehmen</button><button data-dec="${x.from}">Ablehnen</button></div>
      </div>`).join('');
    // neue Angebote fallen auch auf, wenn die Seitenleiste zu ist (Handy)
    $('#btnSide').classList.toggle('ready', incoming.length + reqs.length > 0);
    const key = incoming.map(x => x.from + ':' + x.kind + ':' + x.round).join(',');
    if (key && key !== S.propKey) {
      const x = incoming[incoming.length - 1];
      toast(`${x.kind === 'peace' ? '🕊️' : '📜'} ${st.players[x.from].name} bietet dir ${x.kind === 'peace' ? 'Frieden' : 'ein Bündnis'} an – siehe 👑 Reiche.`);
    }
    S.propKey = key;
  }

  // ---------- Minispiel für die Wartezeit: Ritterlauf (wie Subway Surfers) ----------
  // Drei Spuren, alles kommt auf dich zu. Wischen/Pfeiltasten: ← → Spur wechseln, ↑ springen, ↓ rutschen.
  const Mini = (() => {
    const o = $('#mini');
    const W = 400, H = 600, HOR = 190, ZN = 1.15, CAMH = 1.5, F = (H - HOR) * ZN / CAMH, PZ = 2.4, LANE = 1.15;
    let cv, g, raf = 0, G = null, dpr = 1, touch = null;
    const best = () => +(store.get('kingdoms-run') || 0);
    const isOpen = () => !o.hidden;
    const rand = (a, b) => a + Math.random() * (b - a);
    const myColor = () => (S.state && S.state.players[S.me] ? S.state.players[S.me].color : PROFILE.color) || '#e5484d';
    // Perspektive: Welt (x quer, y hoch, z nach vorn) → Bildschirm
    const P = (x, y, z) => { const k = F / z; return [W / 2 + (x - G.camX) * k, HOR + (CAMH - y) * k, k]; };

    function open() {
      o.innerHTML = `<div class="modal minigame runner">
        <div class="mhead"><h2>🏃 Ritterlauf</h2><span class="tag" id="rnBest"></span><button data-mclose class="ghost" title="Schließen">✕</button></div>
        <div class="rnwrap"><canvas></canvas></div>
        <div class="minibar"><span class="tag">Wischen oder Pfeiltasten: ← → Spur · ↑ springen · ↓ rutschen</span>
          <span><button id="rnBrag" hidden>📣 Im Chat prahlen</button></span></div></div>`;
      o.hidden = false;
      cv = o.querySelector('canvas'); g = cv.getContext('2d');
      fit();
      cv.addEventListener('pointerdown', e => { e.preventDefault(); touch = { x: e.clientX, y: e.clientY, done: false }; });
      cv.addEventListener('pointermove', e => { if (touch && !touch.done) swipe(e, false); });
      cv.addEventListener('pointerup', e => { if (touch && !touch.done) swipe(e, true); touch = null; });
      cv.addEventListener('pointercancel', () => { touch = null; });
      G = fresh('intro'); prefill();
      $('#rnBest').textContent = `🏆 Rekord ${best()}`;
      cancelAnimationFrame(raf);
      let last = performance.now();
      const loop = now => {
        if (o.hidden || !G) return;
        const dt = Math.min(0.033, (now - last) / 1000);
        last = now;
        step(dt); draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    function fit() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const maxH = Math.min(window.innerHeight * 0.68, 640), w = Math.min(cv.parentElement.clientWidth, maxH * W / H);
      cv.style.width = w + 'px'; cv.style.height = (w * H / W) + 'px';
      cv.width = Math.round(w * dpr); cv.height = Math.round(w * H / W * dpr);
    }
    window.addEventListener('resize', () => { if (isOpen() && cv) fit(); });
    function close() { o.hidden = true; cancelAnimationFrame(raf); o.innerHTML = ''; G = null; }

    function fresh(state) {
      return { state, t: 0, dist: 0, speed: 9, score: 0, coins: 0, mult: 1, camX: 0,
        pl: { lane: 0, x: 0, y: 0, vy: 0, slide: 0, run: 0 }, objs: [], side: [], parts: [], texts: [],
        nextRow: 18, nextSide: 0, power: { magnet: 0, boots: 0, shield: 0, double: 0 }, flash: 0, shake: 0 };
    }
    function start() { G = fresh('play'); prefill(); $('#rnBrag').hidden = true; Sound.play('select'); }
    function prefill() { for (let z = 3; z < 42; z += rand(2.2, 3.6)) spawnSide(z); }
    const canRestart = () => G.state !== 'over' || G.t - G.overAt > 0.8;

    // ---------- Steuerung ----------
    function act(dir) {
      if (!G) return;
      if (G.state !== 'play') { if (canRestart()) start(); return; }
      const p = G.pl;
      if (dir === 'L' && p.lane > -1) { p.lane--; Sound.play('click'); }
      else if (dir === 'R' && p.lane < 1) { p.lane++; Sound.play('click'); }
      else if (dir === 'U' && p.y <= 0.001) { p.vy = G.power.boots > 0 ? 11.5 : 8.2; p.slide = 0; }
      else if (dir === 'D') { p.slide = 0.65; if (p.y > 0) p.vy = -14; }
    }
    function swipe(e, end) {
      const dx = e.clientX - touch.x, dy = e.clientY - touch.y, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d < 26) { if (end && G.state !== 'play') act('U'); return; }
      touch.done = true;
      act(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'L' : 'R') : (dy < 0 ? 'U' : 'D'));
    }
    const KEYMAP = { ArrowLeft: 'L', a: 'L', A: 'L', ArrowRight: 'R', d: 'R', D: 'R', ArrowUp: 'U', w: 'U', W: 'U', ' ': 'U', ArrowDown: 'D', s: 'D', S: 'D' };
    document.addEventListener('keydown', e => {
      if (!isOpen() || !G) return;
      if (e.key === 'Escape') { close(); return; }
      const k = KEYMAP[e.key];
      if (!k) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) act(k);
    }, true);

    // ---------- Effekte ----------
    function burst(x, y, z, n, cols) {
      for (let k = 0; k < n; k++) G.parts.push({ x, y, z, vx: rand(-2, 2), vy: rand(1, 4), vz: rand(-1, 1), life: rand(0.4, 0.8), c: cols[k % cols.length] });
    }
    const say = (txt, c = '#ffe2a0') => G.texts.push({ txt, c, t: 0 });

    // ---------- Spielwelt ----------
    function spawnRow(z) {
      const lv = Math.min(1, G.dist / 2500);
      const kinds = [];
      for (let l = -1; l <= 1; l++) {
        const r = Math.random();
        kinds.push(r < 0.24 + lv * 0.12 ? 'cart' : r < 0.42 + lv * 0.1 ? 'fence' : r < 0.56 + lv * 0.08 ? 'beam' : 'free');
      }
      // mindestens eine Spur ohne Wagen
      if (kinds.every(k => k === 'cart')) kinds[Math.floor(Math.random() * 3)] = 'free';
      kinds.forEach((k, i) => {
        const lane = i - 1;
        if (k === 'cart') G.objs.push({ type: 'cart', lane, z, len: 2.6, moving: lv > 0.3 && Math.random() < 0.25 });
        else if (k === 'fence') G.objs.push({ type: 'fence', lane, z, len: 0.25 });
        else if (k === 'beam') G.objs.push({ type: 'beam', lane, z, len: 0.25 });
      });
      // Münzen: in einer freien Spur als Reihe, über einem Zaun im Bogen
      const free = kinds.map((k, i) => [k, i - 1]).filter(([k]) => k !== 'cart');
      const [fk, fl] = free[Math.floor(Math.random() * free.length)];
      for (let k = 0; k < 6; k++) {
        const zz = z - 3 + k * 1.1, arc = fk === 'fence' ? Math.max(0, 1.4 - Math.abs(zz - z) * 0.5) : 0;
        G.objs.push({ type: 'coin', lane: fl, z: zz, y: 0.45 + arc, len: 0.3 });
      }
      if (Math.random() < 0.12) G.objs.push({ type: 'power', lane: fl, z: z + 4, y: 0.6, len: 0.4, kind: ['magnet', 'boots', 'shield', 'double'][Math.floor(Math.random() * 4)] });
    }
    function spawnSide(z) {
      for (const sx of [-1, 1]) {
        const r = Math.random();
        G.side.push({ x: sx * rand(3.0, 4.6), z: z + rand(-1, 1), kind: r < 0.5 ? 'tree' : r < 0.82 ? 'house' : 'tower', s: rand(0.85, 1.25), hue: Math.floor(rand(0, 3)) });
      }
    }
    function hit(o2) {
      if (G.power.shield > 0) { G.power.shield = 0; o2.gone = true; G.flash = 0.3; say('🛡️ Schild hat dich gerettet!', '#8fd0ff'); Sound.play('battle'); return; }
      gameOver();
    }
    function gameOver() {
      G.state = 'over'; G.overAt = G.t; G.shake = 0.4;
      Sound.play('lose');
      const total = Math.floor(G.score);
      const rec = total > best();
      if (rec) store.set('kingdoms-run', String(total));
      G.rec = rec; G.final = total;
      $('#rnBest').textContent = `🏆 Rekord ${best()}`;
      const brag = $('#rnBrag');
      if (brag && (S.role === 'guest' || S.role === 'host')) {
        brag.hidden = false;
        brag.onclick = () => { sendChat(`🏃 ${total} Punkte im Ritterlauf${rec ? ' – neuer Rekord!' : '!'}`); brag.hidden = true; toast('Angeber! 😎'); };
      }
      setTimeout(() => Sound.play(rec ? 'victory' : 'defeat'), 400);
    }
    function step(dt) {
      G.t += dt;
      G.flash = Math.max(0, G.flash - dt); G.shake = Math.max(0, G.shake - dt);
      for (const pt of G.parts) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt; pt.vy -= 9 * dt; pt.life -= dt; }
      G.parts = G.parts.filter(pt => pt.life > 0);
      for (const t of G.texts) t.t += dt;
      G.texts = G.texts.filter(t => t.t < 1.4);
      const p = G.pl;
      const v = G.state === 'play' ? G.speed : 3;
      // Landschaft läuft immer (auch im Startbild)
      G.nextSide -= v * dt;
      if (G.nextSide <= 0) { spawnSide(42); G.nextSide = rand(2.2, 3.6); }
      for (const sd of G.side) sd.z -= v * dt;
      G.side = G.side.filter(sd => sd.z > 0.8);
      p.run += dt * (G.state === 'play' ? G.speed * 1.1 : 4);
      if (G.state !== 'play') return;

      G.dist += v * dt;
      G.speed = Math.min(24, 9 + G.dist / 140);
      G.mult = G.power.double > 0 ? 2 : 1;
      G.score += v * dt * 0.5 * G.mult;
      for (const k in G.power) G.power[k] = Math.max(0, G.power[k] - dt);
      // Spieler
      p.x += (p.lane * LANE - p.x) * Math.min(1, dt * 14);
      G.camX += (p.x * 0.55 - G.camX) * Math.min(1, dt * 6);
      p.vy -= 26 * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) p.vy = Math.max(0, p.vy);
      p.slide = Math.max(0, p.slide - dt);
      // neue Hindernisse
      G.nextRow -= v * dt;
      if (G.nextRow <= 0) { spawnRow(46); G.nextRow = rand(7, 11) - Math.min(3, G.dist / 1500); }
      for (const ob of G.objs) { ob.z -= v * dt * (ob.moving ? 1.55 : 1); }
      // Zusammenstöße
      const pl = Math.round(p.x / LANE);
      for (const ob of G.objs) {
        if (ob.gone) continue;
        const near = Math.abs(ob.z - PZ) < ob.len / 2 + 0.35, sameLane = Math.abs(ob.lane * LANE - p.x) < 0.6;
        if (ob.type === 'coin' || ob.type === 'power') {
          const mag = G.power.magnet > 0 && ob.type === 'coin' && Math.abs(ob.z - PZ) < 4;
          if (mag) { ob.lane += (p.x / LANE - ob.lane) * Math.min(1, dt * 8); ob.y += (p.y + 0.5 - ob.y) * Math.min(1, dt * 8); }
          if ((near && sameLane && Math.abs((ob.y || 0) - (p.y + 0.5)) < 0.9) || (mag && Math.abs(ob.z - PZ) < 0.5)) {
            ob.gone = true;
            if (ob.type === 'coin') { G.coins++; G.score += 10 * G.mult; if (G.coins % 5 === 0) Sound.play('click'); burst(ob.lane * LANE, ob.y, ob.z, 4, ['#ffd34d', '#fff']); }
            else { G.power[ob.kind] = ob.kind === 'shield' ? 99 : 10; say({ magnet: '🧲 Magnet!', boots: '👢 Sprungstiefel!', shield: '🛡️ Schild!', double: '✖️2 Doppelte Punkte!' }[ob.kind]); Sound.play('win'); }
          }
          continue;
        }
        if (!near || pl !== ob.lane || Math.abs(ob.lane * LANE - p.x) > 0.55) continue;
        if (ob.type === 'fence' && p.y > 0.55) continue;
        if (ob.type === 'beam' && p.slide > 0) continue;
        if (ob.type === 'cart' && p.y > 1.45) continue;
        hit(ob);
        if (G.state !== 'play') break;
      }
      G.objs = G.objs.filter(ob => !ob.gone && ob.z > 0.6);
    }

    // ---------- Zeichnen ----------
    function shade(hex, f) {
      const n = parseInt(String(hex).slice(1), 16), r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
      const m = c => Math.max(0, Math.min(255, Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f)));
      return `rgb(${m(r)},${m(gg)},${m(b)})`;
    }
    // Quader in Perspektive: Vorderseite, Oberseite, sichtbare Seite
    function box(x, z, w, h, len, front, top, sideC, y0 = 0) {
      const z2 = z + len;
      const [ax, ay, k] = P(x - w / 2, y0, z), [bx] = P(x + w / 2, y0, z), [, ty] = P(x, y0 + h, z);
      const [cx2, , k2] = P(x - w / 2, y0, z2), [dx2] = P(x + w / 2, y0, z2), [, ty2] = P(x, y0 + h, z2), [, by2] = P(x, y0, z2);
      // Seite (zur Mitte hin sichtbar)
      g.fillStyle = sideC;
      if (x - G.camX > 0.05) { g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax, ty); g.lineTo(cx2, ty2); g.lineTo(cx2, by2); g.fill(); }
      else if (x - G.camX < -0.05) { g.beginPath(); g.moveTo(bx, ay); g.lineTo(bx, ty); g.lineTo(dx2, ty2); g.lineTo(dx2, by2); g.fill(); }
      g.fillStyle = top; g.beginPath(); g.moveTo(ax, ty); g.lineTo(bx, ty); g.lineTo(dx2, ty2); g.lineTo(cx2, ty2); g.fill();
      g.fillStyle = front; g.fillRect(ax, ty, bx - ax, ay - ty);
      return { ax, bx, ay, ty, k };
    }
    function drawObj(ob) {
      const x = ob.lane * LANE;
      if (ob.type === 'cart') {
        const b = box(x, ob.z, 0.95, 1.25, ob.len, '#8b5a2b', '#e2c25a', '#6e4422', 0.15);
        g.strokeStyle = '#4a2e14'; g.lineWidth = Math.max(1, b.k * 0.03);
        for (let k = 1; k < 4; k++) { const yy = b.ty + (b.ay - b.ty) * k / 4; g.beginPath(); g.moveTo(b.ax, yy); g.lineTo(b.bx, yy); g.stroke(); }
        // Räder
        const [wx1, wy] = P(x - 0.42, 0.12, ob.z), [wx2] = P(x + 0.42, 0.12, ob.z), rr = 0.17 * b.k;
        g.fillStyle = '#3a2a1a'; g.beginPath(); g.arc(wx1, wy, rr, 0, 7); g.arc(wx2, wy, rr, 0, 7); g.fill();
        if (ob.moving) { g.fillStyle = '#ff5a5f'; g.font = `900 ${Math.max(8, b.k * 0.35)}px sans-serif`; g.textAlign = 'center'; g.fillText('!', (b.ax + b.bx) / 2, b.ty - b.k * 0.15); }
      } else if (ob.type === 'fence') {
        const b = box(x, ob.z, 1.0, 0.5, ob.len, '#a0703c', '#c08850', '#7a5030');
        g.fillStyle = '#e5484d'; g.fillRect(b.ax, b.ty + (b.ay - b.ty) * 0.35, b.bx - b.ax, (b.ay - b.ty) * 0.22);
        g.fillStyle = '#f3ead2'; for (let k = 0; k < 4; k++) g.fillRect(b.ax + (b.bx - b.ax) * (k * 0.25 + 0.06), b.ty + (b.ay - b.ty) * 0.35, (b.bx - b.ax) * 0.1, (b.ay - b.ty) * 0.22);
      } else if (ob.type === 'beam') {
        // Pfosten und ein Banner auf Kopfhöhe – drunter durchrutschen
        const [lx, ly, k] = P(x - 0.5, 0, ob.z), [rx] = P(x + 0.5, 0, ob.z), [, ty] = P(x, 1.7, ob.z), [, by] = P(x, 0.95, ob.z);
        g.fillStyle = '#5a3d22'; g.fillRect(lx - k * 0.05, ty, k * 0.1, ly - ty); g.fillRect(rx - k * 0.05, ty, k * 0.1, ly - ty);
        g.fillStyle = myColor(); g.fillRect(lx, ty, rx - lx, by - ty);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(lx, by - (by - ty) * 0.2, rx - lx, (by - ty) * 0.2);
        g.fillStyle = '#ffe2a0'; g.font = `900 ${Math.max(7, k * 0.32)}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('↓', (lx + rx) / 2, (ty + by) / 2);
      } else if (ob.type === 'coin') {
        const [sx, sy, k] = P(x, ob.y, ob.z), r = 0.16 * k, wob = Math.abs(Math.sin(G.t * 6 + ob.z));
        g.fillStyle = '#ffd34d'; g.beginPath(); g.ellipse(sx, sy, r * (0.35 + wob * 0.65), r, 0, 0, 7); g.fill();
        g.strokeStyle = '#a07812'; g.lineWidth = Math.max(0.8, k * 0.02); g.stroke();
      } else if (ob.type === 'power') {
        const [sx, sy, k] = P(x, ob.y + Math.sin(G.t * 4) * 0.08, ob.z);
        g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.arc(sx, sy, 0.3 * k, 0, 7); g.fill();
        g.font = `${Math.max(8, 0.38 * k)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText({ magnet: '🧲', boots: '👢', shield: '🛡️', double: '✖️' }[ob.kind], sx, sy);
      }
    }
    function drawSide(sd) {
      const [sx, sy, k] = P(sd.x, 0, sd.z);
      if (sd.kind === 'tree') {
        g.fillStyle = '#5a3d22'; g.fillRect(sx - k * 0.08, sy - k * 0.7, k * 0.16, k * 0.7);
        g.fillStyle = ['#2d5b28', '#36692e', '#3f7434'][sd.hue]; g.beginPath(); g.arc(sx, sy - k * 1.1 * sd.s, k * 0.55 * sd.s, 0, 7); g.fill();
        g.fillStyle = 'rgba(140,190,90,.35)'; g.beginPath(); g.arc(sx - k * 0.15, sy - k * 1.25 * sd.s, k * 0.25 * sd.s, 0, 7); g.fill();
      } else if (sd.kind === 'house') {
        const w = k * 1.2 * sd.s, h = k * 0.9 * sd.s;
        g.fillStyle = '#e4d6b8'; g.fillRect(sx - w / 2, sy - h, w, h);
        g.fillStyle = ['#a34a30', '#7a5a40', myColor()][sd.hue]; g.beginPath(); g.moveTo(sx - w * 0.62, sy - h); g.lineTo(sx, sy - h * 1.8); g.lineTo(sx + w * 0.62, sy - h); g.fill();
        g.fillStyle = '#ffd77a'; g.fillRect(sx - w * 0.3, sy - h * 0.65, w * 0.16, h * 0.22); g.fillRect(sx + w * 0.14, sy - h * 0.65, w * 0.16, h * 0.22);
        g.fillStyle = '#5a3d22'; g.fillRect(sx - w * 0.08, sy - h * 0.4, w * 0.16, h * 0.4);
      } else {
        const w = k * 0.8 * sd.s, h = k * 2.4 * sd.s;
        g.fillStyle = '#b4ac9b'; g.fillRect(sx - w / 2, sy - h, w, h);
        g.fillStyle = myColor(); g.beginPath(); g.moveTo(sx - w * 0.65, sy - h); g.lineTo(sx, sy - h - w * 1.1); g.lineTo(sx + w * 0.65, sy - h); g.fill();
        g.fillStyle = '#3b2f22'; g.fillRect(sx - w * 0.12, sy - h * 0.7, w * 0.24, h * 0.12);
      }
    }
    function drawKnight() {
      const p = G.pl, [sx, sy, k] = P(p.x, p.y, PZ), col = myColor();
      const sl = p.slide > 0, air = p.y > 0.02, step = Math.sin(p.run * 2.2);
      const s = k * 0.95;
      g.save(); g.translate(sx, sy);
      // Schatten am Boden
      const [, gy] = P(p.x, 0, PZ);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(0, gy - sy, s * 0.32, s * 0.08, 0, 0, 7); g.fill();
      if (G.power.shield > 0) { g.strokeStyle = `rgba(143,208,255,${0.55 + Math.sin(G.t * 8) * 0.2})`; g.lineWidth = 3; g.beginPath(); g.ellipse(0, -s * 0.45, s * 0.48, s * 0.62, 0, 0, 7); g.stroke(); }
      if (sl) {
        // rutschend: flach nach hinten gelehnt
        g.fillStyle = '#3a2a1a'; g.fillRect(-s * 0.32, -s * 0.12, s * 0.5, s * 0.1);
        g.fillStyle = col; g.beginPath(); g.ellipse(0, -s * 0.2, s * 0.26, s * 0.14, -0.2, 0, 7); g.fill();
        g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(s * 0.18, -s * 0.32, s * 0.12, 0, 7); g.fill();
      } else {
        const lg = air ? 0.12 : step * 0.16;
        g.strokeStyle = '#3a2a1a'; g.lineWidth = s * 0.09; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-s * 0.08, -s * 0.35); g.lineTo(-s * 0.1 - lg * s, air ? -s * 0.12 : 0); g.moveTo(s * 0.08, -s * 0.35); g.lineTo(s * 0.1 + lg * s, air ? -s * 0.15 : 0); g.stroke();
        // Waffenrock in Reichsfarbe
        g.fillStyle = col; g.beginPath(); g.moveTo(-s * 0.2, -s * 0.78); g.lineTo(s * 0.2, -s * 0.78); g.lineTo(s * 0.24, -s * 0.32); g.lineTo(-s * 0.24, -s * 0.32); g.fill();
        g.fillStyle = shade(col, -0.35); g.fillRect(-s * 0.22, -s * 0.5, s * 0.44, s * 0.06);
        // Arme
        g.strokeStyle = '#c9ced6'; g.lineWidth = s * 0.08;
        g.beginPath(); g.moveTo(-s * 0.2, -s * 0.72); g.lineTo(-s * 0.32, -s * 0.5 + step * s * 0.08); g.moveTo(s * 0.2, -s * 0.72); g.lineTo(s * 0.32, -s * 0.5 - step * s * 0.08); g.stroke();
        // Schild auf dem Rücken
        g.fillStyle = shade(col, 0.2); g.beginPath(); g.moveTo(-s * 0.13, -s * 0.74); g.lineTo(s * 0.13, -s * 0.74); g.lineTo(s * 0.13, -s * 0.52); g.lineTo(0, -s * 0.42); g.lineTo(-s * 0.13, -s * 0.52); g.fill();
        g.strokeStyle = '#e8b64c'; g.lineWidth = s * 0.025; g.stroke();
        // Helm mit Federbusch
        g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(0, -s * 0.9, s * 0.15, 0, 7); g.fill();
        g.fillStyle = '#8a8f98'; g.fillRect(-s * 0.15, -s * 0.92, s * 0.3, s * 0.035);
        g.fillStyle = col; g.beginPath(); g.ellipse(0, -s * 1.08, s * 0.05, s * 0.1, 0.3, 0, 7); g.fill();
      }
      g.restore();
    }
    function draw() {
      if (!g || !G) return;
      g.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
      if (G.shake > 0) g.translate(rand(-4, 4) * G.shake * 2, rand(-4, 4) * G.shake * 2);
      // Himmel und ferne Burg
      const sky = g.createLinearGradient(0, 0, 0, HOR);
      sky.addColorStop(0, '#3a6ea5'); sky.addColorStop(1, '#f6c88a');
      g.fillStyle = sky; g.fillRect(-10, -10, W + 20, HOR + 10);
      g.fillStyle = 'rgba(255,240,200,.9)'; g.beginPath(); g.arc(W * 0.78, HOR - 70, 22, 0, 7); g.fill();
      g.fillStyle = '#5a6a8a'; g.beginPath(); g.moveTo(0, HOR); for (let x = 0; x <= W; x += 40) g.lineTo(x, HOR - 18 - Math.sin(x * 0.03 + 1) * 14); g.lineTo(W, HOR); g.fill();
      const cx0 = W / 2 - G.camX * 6;
      g.fillStyle = '#4a4f6a'; g.fillRect(cx0 - 30, HOR - 46, 60, 46); g.fillRect(cx0 - 44, HOR - 64, 16, 64); g.fillRect(cx0 + 28, HOR - 64, 16, 64); g.fillRect(cx0 - 8, HOR - 78, 16, 78);
      g.fillStyle = myColor(); g.beginPath(); g.moveTo(cx0, HOR - 92); g.lineTo(cx0 + 12, HOR - 87); g.lineTo(cx0, HOR - 82); g.fill();
      // Wiese
      g.fillStyle = '#5d8a3a'; g.fillRect(-10, HOR, W + 20, H - HOR + 10);
      // Weg (drei Spuren) mit Pflastersteinen
      const roadL = -1.8, roadR = 1.8;
      const [nlx, nly] = P(roadL, 0, ZN), [nrx] = P(roadR, 0, ZN), [flx, fly] = P(roadL, 0, 60), [frx] = P(roadR, 0, 60);
      g.fillStyle = '#9a8a72'; g.beginPath(); g.moveTo(nlx, nly); g.lineTo(nrx, nly); g.lineTo(frx, fly); g.lineTo(flx, fly); g.fill();
      // Pflaster-Streifen, die vorbeiziehen
      for (let k = 0; k < 40; k++) {
        const z = 1.2 + k * 1.4 - ((G.dist) % 1.4);
        if (z < ZN) continue;
        const [ax, ay] = P(roadL, 0, z), [bx] = P(roadR, 0, z);
        g.strokeStyle = `rgba(70,55,40,${Math.min(0.35, 2 / z)})`; g.lineWidth = Math.max(0.5, F / z * 0.03);
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, ay); g.stroke();
      }
      // Spurlinien
      for (const lx of [-LANE / 2, LANE / 2]) {
        const [ax, ay] = P(lx, 0, ZN), [bx, by] = P(lx, 0, 60);
        g.strokeStyle = 'rgba(255,240,210,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      }
      // Ränder
      for (const ex of [roadL, roadR]) { const [ax, ay] = P(ex, 0, ZN), [bx, by] = P(ex, 0, 60); g.strokeStyle = '#5a4a3a'; g.lineWidth = 4; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); }
      // Landschaft und Hindernisse von hinten nach vorn
      const all = [...G.side.map(sd => ({ z: sd.z, f: () => drawSide(sd) })), ...G.objs.map(ob => ({ z: ob.z, f: () => drawObj(ob) })), { z: PZ - 0.01, f: drawKnight }];
      all.sort((a, b) => b.z - a.z);
      for (const it of all) if (it.z > ZN - 0.1) it.f();
      // Partikel
      for (const pt of G.parts) { const [sx, sy, k] = P(pt.x, pt.y, Math.max(0.8, pt.z)); g.globalAlpha = Math.max(0, pt.life * 1.5); g.fillStyle = pt.c; g.beginPath(); g.arc(sx, sy, Math.max(1, k * 0.04), 0, 7); g.fill(); }
      g.globalAlpha = 1;
      if (G.flash > 0) { g.fillStyle = `rgba(143,208,255,${G.flash})`; g.fillRect(0, 0, W, H); }
      // Anzeige
      g.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
      g.textBaseline = 'middle'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.55)';
      if (G.state === 'play' || G.state === 'over') {
        g.font = '900 26px Georgia, serif'; g.textAlign = 'right';
        g.strokeText(Math.floor(G.score), W - 14, 24); g.fillStyle = '#fff'; g.fillText(Math.floor(G.score), W - 14, 24);
        g.font = '800 16px sans-serif'; g.textAlign = 'left';
        g.strokeText(`🪙 ${G.coins}`, 12, 24); g.fillStyle = '#ffd34d'; g.fillText(`🪙 ${G.coins}`, 12, 24);
        if (G.mult > 1) { g.strokeText('×2', 12, 48); g.fillStyle = '#ff9a3c'; g.fillText('×2', 12, 48); }
        const pw = Object.entries(G.power).filter(([k, v]) => v > 0 && k !== 'double');
        pw.forEach(([k, v], i) => { g.font = '14px sans-serif'; g.fillStyle = '#fff'; g.fillText(`${{ magnet: '🧲', boots: '👢', shield: '🛡️' }[k]}${k === 'shield' ? '' : ' ' + Math.ceil(v) + 's'}`, 12 + i * 64, 72); });
      }
      for (const t of G.texts) {
        g.globalAlpha = Math.max(0, 1 - t.t / 1.4);
        g.font = '900 20px Georgia, serif'; g.textAlign = 'center';
        g.strokeText(t.txt, W / 2, HOR - 30 - t.t * 30); g.fillStyle = t.c; g.fillText(t.txt, W / 2, HOR - 30 - t.t * 30);
      }
      g.globalAlpha = 1;
      if (G.state !== 'play') {
        g.fillStyle = 'rgba(10,8,20,.55)'; g.fillRect(0, 0, W, H);
        g.textAlign = 'center';
        const big = (txt, y, size, col) => { g.font = `900 ${size}px Georgia, serif`; g.lineWidth = 5; g.strokeText(txt, W / 2, y); g.fillStyle = col; g.fillText(txt, W / 2, y); };
        if (G.state === 'intro') {
          big('🏃 RITTERLAUF', H / 2 - 90, 36, '#ffe2a0');
          big('← →  Spur wechseln', H / 2 - 30, 18, '#fff');
          big('↑  über Zäune springen', H / 2, 18, '#fff');
          big('↓  unter Bannern durchrutschen', H / 2 + 30, 18, '#fff');
          big('Weich den Heuwagen aus!', H / 2 + 62, 15, '#ddd');
          big(Math.floor(G.t * 2) % 2 ? 'Tippen oder Taste zum Start' : '', H / 2 + 110, 20, '#ff9a3c');
        } else {
          big(G.rec ? '🏆 NEUER REKORD!' : 'AUTSCH!', H / 2 - 60, 34, G.rec ? '#ffd34d' : '#ff8a8d');
          big(`${G.final} Punkte`, H / 2 - 12, 28, '#fff');
          big(`🪙 ${G.coins} Münzen · ${Math.floor(G.dist)} m`, H / 2 + 24, 16, '#ffe2a0');
          big(`Rekord: ${best()}`, H / 2 + 52, 15, '#ffe2a0');
          big(Math.floor(G.t * 2) % 2 ? 'Tippen für eine neue Runde' : '', H / 2 + 100, 18, '#ff9a3c');
        }
      }
    }

    o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-mclose]')) close(); });
    return { open, close, isOpen, act };
  })();

  // ---------- Statistik ----------

  const METRICS = [['Provinzen', 0], ['Truppen', 1], ['Punkte', 2], ['Gold pro Runde', 3], ['Wissen pro Runde', 4]];
  function openStats(tab) {
    S.statTab = tab || S.statTab || 'table';
    S.statMetric = S.statMetric || 0;
    renderStats();
    $('#stats').hidden = false;
  }
  function chartSVG(st, m) {
    const hist = st.hist || [];
    if (hist.length < 2) return '<p class="tag">Der Verlauf erscheint ab Runde 2.</p>';
    const W = 640, H = 260, L = 34, R = 10, T = 12, B = 26;
    const rounds = hist.map(h => h.r), r0 = rounds[0], r1 = rounds[rounds.length - 1];
    let max = 1, min = 0;
    for (const h of hist) for (const v of h.d) { max = Math.max(max, v[m]); min = Math.min(min, v[m]); }
    const X = r => L + (r - r0) / Math.max(1, r1 - r0) * (W - L - R), Y = v => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(min + (max - min) * f));
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    for (const t of [...new Set(ticks)]) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${L - 6}" y="${Y(t) + 4}" class="ax" text-anchor="end">${t}</text>`;
    const step = Math.max(1, Math.ceil((r1 - r0) / 8));
    for (let r = r0; r <= r1; r += step) svg += `<text x="${X(r)}" y="${H - 8}" class="ax" text-anchor="middle">${r}</text>`;
    st.players.forEach((pl, i) => {
      const pts = hist.filter(h => h.d[i]).map(h => `${X(h.r).toFixed(1)},${Y(h.d[i][m]).toFixed(1)}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${pl.color}" stroke-width="${i === S.me ? 3.2 : 2}" stroke-linejoin="round" ${pl.alive ? '' : 'stroke-dasharray="5 4" opacity=".6"'}/>`;
    });
    return svg + '</svg>';
  }
  function renderStats() {
    const st = S.state, o = $('#stats');
    if (!st) return;
    const rows = st.players.map((pl, i) => {
      const x = K.stats(st, i), r = pl.rec || {};
      return `<tr class="${pl.alive ? '' : 'dead'}" style="--pc:${pl.color}"><td class="who">${avatarHTML(S.avatars && S.avatars[i], pl.name, pl.color, 'xs')} ${esc(pl.name)}${i === S.me ? ' (Du)' : ''}</td>
        <td>${x.cells}</td><td>${x.troops}</td><td>${x.income >= 0 ? '+' : ''}${x.income}</td><td>+${x.sciIncome}</td><td>${x.techs}</td><td>${x.buildings}</td>
        <td>${r.won || 0} / ${r.lost || 0}</td><td>${r.defended || 0}</td><td>${r.conq || 0}</td><td>${r.killed || 0}</td><td>${r.casualties || 0}</td><td>${r.monsters || 0}</td><td><b>${K.score(st, i)}</b></td></tr>`;
    }).join('');
    const table = `<div class="tscroll"><table class="unit-table stat-table"><thead><tr><th>Herrscher</th><th>🏳️ Prov.</th><th>⚔️ Truppen</th><th>🪙 Gold/R</th><th>📜 Wissen/R</th>
      <th>🔬 Techs</th><th>🏠 Bauten</th><th>Angriffe ✓/✗</th><th>🛡️ abgewehrt</th><th>🚩 erobert</th><th>💀 besiegt</th><th>🩸 verloren</th><th>🐉 Monster</th><th>Punkte</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    const chart = `<div class="seg metrics">${METRICS.map(([l, k]) => `<button data-sm="${k}" class="${S.statMetric === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${chartSVG(st, S.statMetric)}
      <div class="legend">${st.players.map(pl => `<span><i style="background:${pl.color}"></i>${esc(pl.name)}</span>`).join('')}</div>`;
    o.innerHTML = `<div class="modal wide stats">
      <div class="mhead"><h2>📊 Statistik · Runde ${Math.min(st.round, st.maxRounds)}</h2><button data-sclose class="ghost" title="Schließen (Esc)">✕</button></div>
      <div class="seg"><button data-st="table" class="${S.statTab === 'table' ? 'on' : ''}">Übersicht</button><button data-st="chart" class="${S.statTab === 'chart' ? 'on' : ''}">Verlauf</button></div>
      ${S.statTab === 'table' ? table : chart}</div>`;
  }
  $('#stats').addEventListener('click', e => {
    if (e.target.id === 'stats' || e.target.closest('[data-sclose]')) { $('#stats').hidden = true; return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.st) { S.statTab = b.dataset.st; renderStats(); }
    else if (b.dataset.sm) { S.statMetric = +b.dataset.sm; renderStats(); }
    else if (b.dataset.accreset !== undefined) ask('Deine ganze Statistik löschen?', 'Löschen').then(ok => { if (ok) { store.set('kingdoms-acc', ''); openAccStats(); } });
  });

  // ---------- Kontostatistik (auf diesem Gerät) ----------
  const accLoad = () => { try { return JSON.parse(store.get('kingdoms-acc') || 'null') || {}; } catch { return {}; } };
  function recordGame(st) {
    if (S.tut || !st || !st.id || !st.players[S.me]) return;
    const a = accLoad();
    a.counted = a.counted || [];
    if (a.counted.includes(st.id)) return;
    a.counted = [...a.counted, st.id].slice(-30);
    const winners = st.winners && st.winners.length ? st.winners : [st.winner];
    const won = winners.includes(S.me), r = st.players[S.me].rec || {};
    const add = (k, v) => { a[k] = (a[k] || 0) + (v || 0); };
    add('games', 1); add(won ? 'wins' : 'losses', 1); if (won && winners.length > 1) add('shared', 1);
    for (const k of ['won', 'lost', 'defended', 'conq', 'killed', 'casualties', 'recruited', 'built', 'monsters']) add(k, r[k]);
    add('rounds', Math.min(st.round, st.maxRounds));
    a.best = Math.max(a.best || 0, K.score(st, S.me));
    a.online = (a.online || 0) + (S.role === 'local' ? 0 : 1);
    store.set('kingdoms-acc', JSON.stringify(a));
  }
  function openAccStats() {
    const a = accLoad(), o = $('#stats');
    const g = a.games || 0, pct = g ? Math.round((a.wins || 0) / g * 100) : 0;
    const tile = (ic, v, l) => `<div class="tile"><span>${ic}</span><b>${v}</b><small>${l}</small></div>`;
    o.innerHTML = `<div class="modal stats acc">
      <div class="mhead"><h2>📊 Meine Statistik</h2><button data-sclose class="ghost" title="Schließen">✕</button></div>
      <div class="accrow">${avatarHTML(PROFILE.avatar, myName(), PROFILE.color, 'big')}<div><b>${esc(myName())}</b><br><span class="tag">gespeichert auf diesem Gerät</span></div></div>
      ${g ? `<div class="tiles">
        ${tile('🎮', g, 'Spiele')}${tile('🏆', a.wins || 0, 'Siege')}${tile('📈', pct + ' %', 'Siegquote')}${tile('🤝', a.shared || 0, 'gemeinsame Siege')}
        ${tile('🌐', a.online || 0, 'Online-Spiele')}${tile('⭐', a.best || 0, 'beste Punktzahl')}${tile('🚩', a.conq || 0, 'Provinzen erobert')}${tile('⚔️', `${a.won || 0} / ${a.lost || 0}`, 'Angriffe gewonnen / verloren')}
        ${tile('🛡️', a.defended || 0, 'Angriffe abgewehrt')}${tile('💀', a.killed || 0, 'Feinde besiegt')}${tile('🛠️', a.recruited || 0, 'Truppen ausgebildet')}${tile('🏠', a.built || 0, 'Gebäude gebaut')}
        ${tile('🐉', a.monsters || 0, 'Monsterhorte erobert')}${tile('⏳', a.rounds || 0, 'Runden gespielt')}
      </div><div class="row end"><button data-accreset class="ghost-btn">Statistik zurücksetzen</button></div>`
        : '<p class="tag">Noch keine fertigen Spiele. Spiel eine Partie zu Ende – dann steht hier, wie gut du bist.</p>'}
    </div>`;
    o.hidden = false;
  }
  $('#btnMyStats').onclick = openAccStats;

  function renameRealm() {
    const st = S.state, me = st.players[S.me], o = $('#confirm');
    o.innerHTML = `<div class="modal center"><h2>🏰 Dein Reich</h2><p class="tag">Wie soll dein Reich heißen? Der Name steht groß auf der Karte.</p>
      <input id="realmIn" maxlength="24" value="${esc(me.realm || '')}" placeholder="z. B. Königreich Nordmark">
      <div class="row"><button data-a="0">Abbrechen</button><button data-a="1" class="primary">Speichern</button></div></div>`;
    o.hidden = false;
    const inp = $('#realmIn');
    inp.focus(); inp.select();
    const done = ok => {
      o.hidden = true;
      if (!ok) return;
      const nm = inp.value.replace(/\s+/g, ' ').trim().slice(0, 24);
      act({ type: 'realm', name: nm });
      $('#realm').value = nm; store.set('kingdoms-realm', nm);
    };
    inp.onkeydown = e => { if (e.key === 'Enter') done(true); };
    o.onclick = e => { const b = e.target.closest('[data-a]'); if (b) done(b.dataset.a === '1'); else if (e.target === o) done(false); };
  }

  function openGift(t) {
    const st = S.state, me = st.players[S.me], o = $('#confirm');
    const rows = [['gold', `${COIN} Gold`, me.gold], ...K.RKEYS.map(k => [k, `${RICO(k)} ${K.RES[k].name}`, me[k] || 0])];
    o.innerHTML = `<div class="modal center gift"><h2>🎁 Geschenk an ${pName(t)}</h2>
      <p class="tag">Hilf Verbündeten – oder kauf dir Frieden.</p>
      <div class="giftrows">${rows.map(([k, l, max]) => `<label class="grow-row"><span>${l}</span>
        <input type="number" min="0" max="${max}" value="0" data-g="${k}" inputmode="numeric"><small class="tag">von ${max}</small></label>`).join('')}</div>
      <div class="row"><button data-a="0">Abbrechen</button><button data-a="1" class="primary">🎁 Schenken</button></div></div>`;
    o.hidden = false;
    o.onclick = e => {
      const b = e.target.closest('[data-a]');
      if (!b && e.target !== o) return;
      if (b && b.dataset.a === '1') {
        const a = { type: 'gift', target: t };
        o.querySelectorAll('[data-g]').forEach(inp => { a[inp.dataset.g] = Math.max(0, Math.min(+inp.max, Math.floor(+inp.value || 0))); });
        act(a);
      }
      o.hidden = true;
    };
  }

  $('#side').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset, st = S.state;
    if (d.kick) { const p = st.players.find(x => x.cid === d.kick); if (p && await ask(`${esc(p.name)} aus dem Spiel werfen? Die KI übernimmt das Reich.`, '👢 Kicken')) kickPlayer(d.kick); return; }
    if (d.rename !== undefined) { renameRealm(); return; }
    if (d.offer) act({ type: 'propose', target: +d.to, kind: d.offer });
    else if (d.cancel && await ask(`Vertrag mit ${pName(+d.cancel)} kündigen? Er gilt noch bis zum Ende der nächsten Runde – danach dürft ihr euch angreifen.`, '📜 Kündigen')) act({ type: 'cancel', target: +d.cancel });
    else if (d.betray && await ask(`Vertrag mit ${pName(+d.betray)} <b>sofort</b> brechen? Das ist Verrat: Alle sehen es, und 8 Runden lang will niemand einen Vertrag mit dir.`, '🗡️ Verrat begehen')) act({ type: 'betray', target: +d.betray });
    else if (d.gift) openGift(+d.gift);
    else if (d.jr) approveJoin(+d.jr, +d.jp);
    else if (d.jx) denyJoin(+d.jx);
    else if (d.acc) act({ type: 'accept', from: +d.acc });
    else if (d.dec) act({ type: 'decline', from: +d.dec });
    else if (d.e) sendChat(d.e);
  });
  $('#btnSide').onclick = () => $('#side').classList.toggle('open');
  $('#sideClose').onclick = () => $('#side').classList.remove('open');
  $('#report').addEventListener('click', () => { $('#report').hidden = true; });

  function renderLog() {
    const st = S.state;
    $('#log').innerHTML = st.log.slice(-40).reverse().map(l =>
      `<li>${esc(l.m).replace(/\{(\d)\}/g, (_, k) => pName(l.ps[k]))}</li>`).join('');
  }

  // ---------- Forschung ----------

  $('#btnResearch').onclick = () => { $('#research').hidden = false; renderResearch(); Sound.play('click'); tutEvent({ kind: 'research-open' }); };
  $('#research').addEventListener('click', e => {
    if (e.target.id === 'research' || e.target.closest('[data-close]')) { $('#research').hidden = true; return; }
    const b = e.target.closest('[data-tech]');
    if (b && !b.disabled) act({ type: 'research', tech: b.dataset.tech });
  });

  function renderResearch() {
    const st = S.state, pl = st.players[S.me];
    if (!pl) return;
    const tiers = [1, 2, 3].map(tier => {
      const cards = Object.entries(K.TECHS).filter(([, T]) => T.tier === tier).map(([k, T]) => {
        const done = pl.techs.includes(k);
        const reqOk = !T.req || pl.techs.includes(T.req);
        const afford = pl.sci >= T.cost;
        const state = done ? 'done' : !reqOk ? 'locked' : afford ? 'ready' : 'poor';
        const label = done ? '✓ Erforscht' : !reqOk ? `🔒 Braucht ${K.TECHS[T.req].name}` : afford ? 'Erforschen' : `Noch ${T.cost - pl.sci} Wissen`;
        return `<button class="tech ${state}" data-tech="${k}" ${state !== 'ready' || !myTurn() ? 'disabled' : ''}>
          <span class="tname">${T.name}</span><span class="tdesc">${T.desc}</span>
          <span class="tfoot">${scroll(T.cost)}<span>${label}</span></span></button>`;
      }).join('');
      return `<div class="tier"><h3>Stufe ${tier}</h3>${cards}</div>`;
    }).join('');
    $('#research').innerHTML = `<div class="modal wide">
      <div class="mhead"><h2>🔬 Forschung</h2><span>${scroll(pl.sci)} Wissen <small class="tag">(+${K.stats(st, S.me).sciIncome} pro Runde)</small></span>
        <button data-close class="ghost" title="Schließen (Esc)">✕</button></div>
      <p class="tag">Wissen kommt aus deiner Hauptstadt, von Sägewerken und Bibliotheken. Jede Technologie schaltet etwas Neues frei.${myTurn() ? '' : ' Forschen kannst du nur in deinem Zug.'}</p>
      <div class="tiers">${tiers}</div></div>`;
  }

  // ---------- Hilfe ----------

  $('#btnHelp').onclick = () => openHelp();
  $('#help').addEventListener('click', e => {
    if (e.target.id === 'help' || e.target.closest('[data-close]')) $('#help').hidden = true;
  });

  function openHelp() {
    const units = K.TYPES.filter(t => !K.UNITS[t].monster).map(t => {
      const u = K.UNITS[t];
      return `<tr><td><svg class="ico"><use href="#u-${t}"/></svg> ${u.name}</td><td>${priceText(u.cost, u.need)}</td><td>${u.atk}</td><td>${u.def}</td><td>${u.mp}</td>
        <td>${u.tech ? K.TECHS[u.tech].name : '–'}${u.note ? `<br><small>${u.note}</small>` : ''}</td></tr>`;
    }).join('');
    const bldgs = BLDG_ORDER.map(b => {
      const B = K.BUILDINGS[b];
      return `<tr><td><svg class="ico"><use href="${b === 'fort' ? '#castle' : '#b-' + b}" style="color:#e8b64c"/></svg> ${B.name}</td><td>${priceText(B.cost, B.need)}</td>
        <td>${B.desc}</td><td>${B.on.length === 4 ? 'überall' : B.on.map(t => K.TERRAIN[t].name).join(', ')}</td><td>${B.tech ? K.TECHS[B.tech].name : '–'}</td></tr>`;
    }).join('');
    const terr = Object.values(K.TERRAIN).map(T =>
      `<tr><td>${T.name}</td><td>${T.gold}</td><td>${T.res ? '+1 ' + K.RES[T.res].icon + ' ' + K.RES[T.res].name : '–'}</td><td>${T.def ? '+' + Math.round(T.def * 100) + ' %' : '–'}</td></tr>`).join('');
    const sizes = Object.values(K.PSIZE).map(P =>
      `<tr><td>${P.name}</td><td>+${P.gold}</td><td>${P.def ? '+' + Math.round(P.def * 100) + ' %' : '–'}</td></tr>`).join('');
    $('#help').innerHTML = `<div class="modal wide help">
      <div class="mhead"><h2>📖 Spielanleitung</h2><button data-close class="ghost" title="Schließen (Esc)">✕</button></div>
      <h3>Ziel</h3>
      <p>Vernichte alle Gegner. Nach 40 Runden gewinnt, wer die meisten Punkte hat (3 pro Provinz, 2 pro Technologie, 1 pro Gebäude).</p>
      <h3>Dein Zug</h3>
      <ol>
        <li><b>🔬 Forschen</b> – mit Wissen neue Einheiten, Gebäude und Boni freischalten.</li>
        <li><b>🔨 Bauen</b> – Gebäude in eigenen Provinzen bringen jede Runde mehr Gold, Wissen oder Rohstoffe.</li>
        <li><b>🛡️ Ausbilden</b> – Einheiten entstehen in der Hauptstadt und in Festungen.</li>
        <li><b>⚔️ Armeen</b> – wie bei Hearts of Iron steuerst du deine Truppen einzeln (siehe unten).</li>
        <li><b>Zug beenden</b> – nicht ausgegebenes Gold und Wissen bleiben erhalten.</li>
      </ol>
      <h3>Divisionen</h3>
      <p>Deine Truppen sind wie bei Hearts of Iron in <b>Divisionen</b> gruppiert. Jede Division steht als eigene <b>Figur</b> auf der Karte (Krieger, Bogenschütze, Speerkämpfer, Ritter oder Katapult – je nach stärkster Einheit), darunter ihre Stärke.
        Tippe eine Figur an, um diese Division zu wählen (mit <b>Strg/Umschalt</b> mehrere), oder eine Provinz, um alle bereiten Divisionen zu wählen.
        Unten kannst du Divisionen mit ☑ an- und abwählen, mit <b>✂️ teilen</b> und mit <b>🔗 zusammenlegen</b>. Neu ausgebildete Truppen bilden eine eigene Division.
        Dann tippst du ein <b>grünes</b> Ziel (marschieren) oder ein <b>rotes</b> Ziel (angreifen) – oder ziehst die <b>Figur direkt auf eine Provinz</b>. Am PC geht auch <b>Rechtsklick</b> aufs Ziel, wie bei Hearts of Iron.</p>
      <p>Jede Einheit hat <b>Bewegungspunkte</b> (Ritter 2, alle anderen 1, „Straßen“ +1) – die langsamste Einheit bestimmt das Tempo der Division. Jede Division handelt einmal pro Zug. Marschieren geht nur durch eigenes Land.
        Provinzen dürfen leer bleiben – aber dann kann sie jeder einfach einnehmen.</p>
      <h3>Kampf</h3>
      <p>Im <b>Angriffsplan</b> wählst du Divisionen aus <b>allen angrenzenden Provinzen</b>, die gemeinsam angreifen. Die <b>Angriffskraft</b> wird mit der <b>Verteidigungskraft</b>
        (Verteidigungswerte × Gelände-, Größen- und Festungsbonus) verglichen. Daraus ergibt sich die <b>Siegchance</b>.
        Gewinnst du, ziehen die Überlebenden ein. Verlierst du, ist die Angriffsarmee verloren.</p>
      <h3>Rohstoffe</h3>
      <p>Neben <b>Gold</b> und <b>📜 Wissen</b> gibt es drei Rohstoffe: <b>🌾 Nahrung</b> (Ebenen, Flüsse, Bauernhöfe), <b>🪵 Holz</b> (Wälder, Sägewerke) und <b>🪨 Stein</b> (Gebirge, Steinbrüche).
        Jede Provinz liefert jede Runde ihren Rohstoff, große Provinzen etwas mehr; die Hauptstadt liefert von allem ein bisschen.
        Soldaten brauchen Nahrung, Bogen und Belagerungswaffen Holz, Festungen, Türme, Tempel und Mauern Stein. Oben siehst du deinen Vorrat und was pro Runde dazukommt.<br>Armeen essen: je 4 Einheiten 1 🌾 Nahrung pro Runde. Fehlt Nahrung, wird sie mit Gold zugekauft.</p>
      <h3>Unterhalt</h3>
      <p>Armeen kosten Sold: je 4 Einheiten 1 Gold pro Runde. Oben bei deinem Gold siehst du dein Einkommen nach Abzug des Unterhalts.</p>
      <h3>Karte</h3>
      <p>Ziehen verschiebt die Karte, Mausrad oder zwei Finger zoomen. Dicke farbige Linien sind <b>Reichsgrenzen</b>, gestrichelte Linien über das Meer sind <b>Seewege</b>.</p>
      <h3>Provinzgröße</h3>
      <p>Große Provinzen sind schwerer zu erobern, bringen aber mehr Gold. Provinzen an Flüssen bringen +1 Gold.</p>
      <div class="tscroll"><table class="unit-table"><thead><tr><th>Größe</th><th>Gold</th><th>Verteidigung</th></tr></thead><tbody>${sizes}</tbody></table></div>
      <h3>Einheiten</h3>
      <div class="tscroll"><table class="unit-table"><thead><tr><th>Einheit</th><th>Kosten</th><th>Angriff</th><th>Verteid.</th><th>Bewegung</th><th>Benötigt</th></tr></thead><tbody>${units}</tbody></table></div>
      <h3>Gebäude</h3>
      <div class="tscroll"><table class="unit-table"><thead><tr><th>Gebäude</th><th>Kosten</th><th>Wirkung</th><th>Gelände</th><th>Benötigt</th></tr></thead><tbody>${bldgs}</tbody></table></div>
      <h3>Gelände</h3>
      <div class="tscroll"><table class="unit-table"><thead><tr><th>Gelände</th><th>Gold</th><th>Rohstoff</th><th>Verteidigung</th></tr></thead><tbody>${terr}</tbody></table></div>
      <p>Die Hauptstadt bringt zusätzlich +3 Gold, +2 Wissen, +2 Nahrung, +1 Holz und +1 Stein und verteidigt +50 %. 🛖 Dörfer geben beim Erobern Gold, Wissen oder Rohstoffe.</p>
      <h3>Tastenkürzel</h3>
      <p>${KEYS.map(([k, v]) => `<b>${k}</b> ${v}`).join(' · ')}</p>
      <h3>Schwierigkeit</h3>
      <p>Die KI „Schwer“ greift aus mehreren Provinzen gleichzeitig an und bekommt wie in Civilization +20 % Gold und Wissen.</p>
      <h3>Fernschuss und Abriss</h3>
      <p><b>🏹 Langbogenschützen</b> können einmal pro Zug und Provinz auf Feinde schießen, die bis zu 2 Provinzen entfernt stehen – auch wenn sie sich schon bewegt haben.
        Jeder Schütze trifft mit etwa 55 % (Gelände, Größe und Festungen schützen). Pfeile treffen nur leichte Einheiten mit Verteidigung bis 3 – Trolle und Drachen sind zu zäh.<br>
        Mit der Forschung <b>🔨 Abrissarbeiten</b> kannst du unter „Bauen“ eigene Gebäude abreißen und bekommst die Hälfte der Kosten zurück.</p>
      <h3>Stadtmauern</h3>
      <p>Mit der Forschung <b>🧱 Befestigung</b> baust du unter „Bauen → Militär“ Stadtmauern um Hauptstadt und Festungen (${priceText(K.WALLS_COST, K.WALLS_NEED)}): +50 % Verteidigung.
        Katapulte und Triboke brechen Mauern nur zur Hälfte (+25 % bleiben). Eroberte Mauern gehören dem Eroberer.</p>
      <h3>Marschbefehle</h3>
      <p>Ziehst du eine Division auf eine <b>weit entfernte eigene Provinz</b> (oder klickst sie mit der rechten Maustaste an), bekommt sie einen <b>Marschbefehl 🚩</b>:
        Sie zieht dann jede Runde von selbst weiter, bis sie ankommt. Der Weg ist auf der Karte gestrichelt. Unter ⚔️ Armeen kannst du den Befehl mit 🚩✕ aufheben.</p>
      <h3>Seefahrt und Verbündete</h3>
      <p>Mit der Forschung <b>⛵ Seefahrt</b> baust du in Küstenprovinzen einen <b>Hafen</b>. Truppen in einem Hafen segeln zu jeder eigenen Küstenprovinz in Reichweite – oder greifen dort direkt eine fremde Küste an.<br>
        Durch das Land von <b>🤝 Verbündeten</b> darfst du hindurchmarschieren (stehen bleiben geht dort nicht).</p>
      <h3>Schnee und Sandwürmer</h3>
      <p>❄️ <b>Schnee</b> bedeckt den Norden: wenig Gold, etwas Stein – aber +35 % Verteidigung. 🪱 <b>Sandwürmer</b> hausen in der Wüste:
        Ihr Nest ist ein großer Schatz, doch Wüstenprovinzen daneben verlieren ab und zu Truppen an die Würmer.</p>
      <h3>Truppenlimit</h3>
      <p>In jede Provinz passen nur begrenzt viele Truppen: klein 18, mittel 20, groß 22 – Hauptstädte und Festungen +6. Das gilt beim Ausbilden, Marschieren und Angreifen.</p>
      <h3>Monster</h3>
      <p>${Object.values(K.LAIRS).map(L => `<b>${L.icon} ${L.name}</b>: Schatz +${L.gold} Gold, +${L.sci} Wissen${K.RKEYS.filter(k => L[k]).map(k => `, +${L[k]} ${K.RES[k].name}`).join('')}`).join('<br>')}<br>
        Monster bleiben in ihrem Hort. Wer sie besiegt, bekommt den Schatz und die Provinz. Wölfe sind leicht, Trolle zäh (Verteidigung 5), Sandwürmer stark (7/7), Drachen sehr stark (Verteidigung 16).</p>
      <h3>Spielmodi</h3>
      <p><b>⚔️ Klassisch:</b> Vernichte alle Gegner – oder hab nach 40 Runden die meisten Punkte.<br>
        <b>👑 Thronkampf:</b> In der Mitte liegt die befestigte Thronstadt. Wer sie zu Beginn seines Zuges hält, bekommt eine Krone – 5 Kronen gewinnen.<br>
        <b>⚡ Blitzkrieg:</b> Doppeltes Einkommen, nur 20 Runden.</p>
      <h3>Weltenschmiede</h3>
      <p>Im Hauptmenü gestaltest du eigene Welten: Grundform, Größe, Landanteil, Provinzgröße, Wald, Gebirge, Wüste, Flüsse, Startgold, Rundenzahl und Friedenszeit.
        Tippe in der Vorschau auf eine Provinz, um sie umzubenennen. Gespeicherte Welten findest du bei „Welt“ im Einzelspieler und in deinem Online-Raum.</p>
      <h3>Online-Räume</h3>
      <p>Der Gastgeber wählt Welt und Modus, kann KI-Herrscher hinzufügen und Spieler mit <b>👢 Kicken</b> entfernen (sie können danach wieder beitreten) – in der Lobby und im laufenden Spiel (dann übernimmt die KI das Reich).</p>
      <h3>Diplomatie</h3>
      <p>Unter <b>👑 Reiche</b> schließt du Verträge mit anderen Herrschern:</p>
      <ul>
        <li><b>🕊️ Frieden</b> – ein Nichtangriffspakt: Ihr könnt euch nicht angreifen.</li>
        <li><b>🤝 Bündnis</b> – kein Angriff, dazu Handel und Wissensaustausch: <b>+1 Gold und +1 Wissen pro Runde</b> für jeden Verbündeten.
          Sind nur noch Verbündete übrig, <b>siegt ihr gemeinsam</b>. Beim Rundenlimit siegen die Verbündeten des Punktbesten mit.</li>
        <li><b>📜 Kündigen</b> – der Vertrag gilt noch bis zum Ende der nächsten Runde. Fair und ohne Folgen.</li>
        <li><b>🗡️ Verrat</b> – der Vertrag endet sofort und du kannst angreifen. Aber alle sehen es: 8 Runden lang bist du <b>Verräter</b>, und die KI schließt keine Verträge mit dir.</li>
        <li><b>🎁 Schenken</b> – Gold oder Rohstoffe an ein anderes Reich schicken, zum Beispiel an einen bedrängten Verbündeten.</li>
      </ul>
      <p>Angebote verfallen nach einer Runde. Im Thronkampf gibt es keinen gemeinsamen Sieg – die Krone trägt nur einer.</p>
    </div>`;
    $('#help').hidden = false;
  }

  // ---------- Tutorial ----------

  const capOf = () => S.state.cells.findIndex(c => c.capital && c.owner === S.me);
  const TUT = [
    { title: 'Willkommen, Herrscher!', text: 'In <b>Kingdoms</b> baust du ein Reich auf: Du eroberst Provinzen, errichtest Gebäude, erforschst Technologien – und besiegst deine Gegner. Ich zeige dir in ein paar Schritten, wie alles funktioniert.', next: 'Los geht\'s' },
    { title: 'Deine Hauptstadt', text: 'Das ist deine <b>Hauptstadt</b> 👑 (gelb umrandet). Hier bildest du Einheiten aus. Die kleinen <b>Figuren</b> sind deine <b>Divisionen</b> – Truppenverbände, die zusammen marschieren und kämpfen. Die Zahl darunter ist ihre Stärke. <br><small>Tipp: Ziehen verschiebt die Karte, Mausrad oder zwei Finger zoomen.</small>', cell: capOf, next: 'Weiter' },
    { title: 'Gold und Wissen', text: 'Oben siehst du deine Rohstoffe: <b>Gold</b> für Einheiten und Gebäude, <b>📜 Wissen</b> für Forschung. Die kleine Zahl ist dein Einkommen pro Runde – nach Abzug des <b>Unterhalts</b> für deine Armee.', el: '#res', next: 'Weiter' },
    { title: 'Einheiten ausbilden', text: 'Unten ist <b>🛡️ Ausbilden</b> gewählt und der <b>Krieger</b> markiert. Tippe <b>zweimal auf deine Hauptstadt</b>, um 2 Krieger auszubilden. Neue Truppen bilden eine <b>eigene Division</b> – du siehst gleich eine zweite Figur.', cell: capOf,
      enter() { S.mode = 'recruit'; S.unit = 'w'; S.amount = 1; },
      on: ev => ev.kind === 'action' && ev.a.type === 'recruit' && (S.tut.recruited += K.total(ev.a.units)) >= 2 },
    { title: 'Zum Angriff!', text: 'Sehr gut! Wechsle jetzt unten zu <b>⚔️ Armeen</b>.', el: '[data-mode="army"]', on: () => S.mode === 'army' },
    { title: 'Divisionen auswählen', text: 'Tippe auf deine Hauptstadt. Unten siehst du deine <b>Divisionen</b>: Mit ☑ wählst du, welche losziehen – lass ruhig eine zum Schutz zurück. Mit ✂️ kannst du eine Division <b>teilen</b>, mit 🔗 mehrere <b>zusammenlegen</b>. Tippe dann auf den gelb markierten <b>Wald</b>.',
      cell: () => {
        if (S.sel < 0) return capOf();
        return S.state.cells[capOf()].n.find(j => S.state.cells[j].terrain === 'forest' && S.state.cells[j].owner !== S.me) ?? -1;
      },
      on: ev => ev.kind === 'planner' || S.tut.attacked },
    { title: 'Der Angriffsplan', text: 'Hier siehst du die <b>Siegchance</b>. Du kannst Divisionen an- und abwählen – auch aus anderen Provinzen, die an das Ziel grenzen. Drücke <b>⚔️ Angreifen</b>.',
      el: '[data-pgo]', on: () => S.tut.attacked },
    { title: '', text: () => (S.state.battle && S.state.battle.won
      ? '<b>Erobert!</b> Die Provinz gehört jetzt dir und bringt jede Runde Gold. Die Division hat sich für diesen Zug verausgabt (blasse Figur). Provinzen mit 🛖 Dorf geben beim Erobern eine Belohnung.'
      : '<b>Verloren</b> – das passiert! Je höher die Siegchance, desto sicherer. Greife am besten mit Übermacht an. <b>Große Provinzen</b> und Gebirge sind schwerer einzunehmen.'), next: 'Weiter' },
    { title: 'Gebäude bauen', text: 'Gebäude bringen mehr Ertrag. Wechsle zu <b>🔨 Bauen</b>, wähle das <b>Sägewerk</b> und tippe auf eine <b>eigene Waldprovinz</b> 🌲 (gelb markiert) – es liefert Holz 🪵. Gehört dir noch kein Wald, erobere zuerst einen.',
      cell: () => S.state.cells.findIndex((c, i) => K.canBuild(S.state, S.me, i, 'lumber')),
      on: ev => ev.kind === 'action' && ev.a.type === 'build', skip: true },
    { title: 'Zug beenden', text: 'Für diese Runde reicht es. Tippe auf <b>Zug beenden</b> (oder drücke die Leertaste). Danach ist dein Gegner dran.', el: '#bEnd', on: ev => ev.kind === 'action' && ev.a.type === 'end' },
    { title: 'Der Gegner ist dran…', text: 'Graf Bruno macht seinen Zug. Es herrscht noch <b>Friedenszeit</b> bis Runde 6 – solange kann dich niemand angreifen.', on: () => myTurn() },
    { title: 'Forschung', text: 'Mit Wissen erforschst du Technologien. Öffne oben die <b>🔬 Forschung</b>.', el: '#btnResearch', on: ev => ev.kind === 'research-open' },
    { title: 'Technologie wählen', text: 'Erforsche <b>Landwirtschaft</b> (4 Wissen). Damit kannst du Bauernhöfe bauen, und danach die <b>Reiterei</b>: Ritter sind stark und laufen 2 Provinzen weit.',
      el: '[data-tech="agri"]', on: ev => ev.kind === 'action' && ev.a.type === 'research', skip: true },
    { title: 'Marschieren', text: 'Zum Verschieben tippst du eine Figur an (mit Strg/Umschalt mehrere) und dann eine <b>grün</b> markierte eigene Provinz – am PC geht auch <b>Rechtsklick</b> aufs Ziel, oder du <b>ziehst die Figur</b> einfach dorthin. Jede Division bewegt sich einmal pro Zug.', next: 'Weiter',
      enter() { $('#research').hidden = true; } },
    { title: 'Festungen & Seewege', text: 'Mit <b>Mauerwerk</b> baust du <b>Festungen</b>: Sie verteidigen +50 % und sind weitere Orte zum Ausbilden. Nur <b>Katapulte</b> ignorieren sie. Gestrichelte Linien über das Meer sind <b>Seewege</b>.', next: 'Weiter' },
    { title: 'Bereit!', text: 'Das war\'s! <b>Ziel:</b> Vernichte alle Gegner – oder habe nach 40 Runden die meisten Punkte. Bei Fragen hilft dir oben <b>❓</b>. Viel Erfolg!', next: 'Spielen' },
  ];

  function tutStep() { return S.tut && TUT[S.tut.step]; }
  function tutCell() { const s = tutStep(); return s && s.cell ? s.cell() : -1; }

  function tutAdvance() {
    if (!S.tut) return;
    S.tut.step++;
    const s = tutStep();
    if (!s) { S.tut = null; $('#coach').hidden = true; clearHl(); render(); return; }
    if (s.enter) s.enter();
    render();
    renderCoach();
  }

  function tutEvent(ev) {
    if (S.tut && ev.kind === 'action' && ev.a.type === 'attack') S.tut.attacked = true;
    const s = tutStep();
    if (!s || S.tut.pending) return;
    if (!s.on) { if (ev.kind === 'render') renderCoachHl(); return; }
    if (s.on(ev)) {
      S.tut.pending = true;
      setTimeout(() => { if (S.tut) S.tut.pending = false; tutAdvance(); }, S.tut.attacked && S.tut.step === 6 ? 2200 : 300);
    } else if (ev.kind === 'render') renderCoachHl();
  }

  function clearHl() { document.querySelectorAll('.tut-hl').forEach(e => e.classList.remove('tut-hl')); }
  function renderCoachHl() {
    clearHl();
    const s = tutStep();
    if (s && s.el) { const e = $(s.el); if (e) e.classList.add('tut-hl'); }
  }

  function renderCoach() {
    const s = tutStep(), box = $('#coach');
    if (!s) { box.hidden = true; return; }
    const text = typeof s.text === 'function' ? s.text() : s.text;
    box.innerHTML = `<div class="cstep">Tutorial · Schritt ${S.tut.step + 1} von ${TUT.length}</div>
      <div class="cprog"><i style="width:${(S.tut.step + 1) / TUT.length * 100}%"></i></div>
      ${s.title ? `<h3>${s.title}</h3>` : ''}<p>${text}</p>
      <div class="row">
        <button data-tut="quit" class="ghost-btn">Beenden</button>
        ${s.next ? `<button data-tut="next" class="primary">${s.next}</button>` : s.skip ? '<button data-tut="next">Überspringen</button>' : ''}
      </div>`;
    box.hidden = false;
    renderCoachHl();
  }

  $('#coach').addEventListener('click', e => {
    const b = e.target.closest('[data-tut]');
    if (!b) return;
    if (b.dataset.tut === 'next') tutAdvance();
    else { S.tut = null; $('#coach').hidden = true; clearHl(); render(); }
  });

  // ---------- Chat ----------

  function renderChat() {
    $('#chatBox').hidden = S.role === 'local';
    const box = $('#chat');
    const avaOf = name => { const e = S.lobby.find(x => x.name === name); return e ? e.avatar : null; };
    box.innerHTML = S.chat.slice(-60).map(m => `<div class="cmsg">${avatarHTML(avaOf(m.name), m.name, m.color, 'xs')}<span><b style="color:${esc(m.color)}">${esc(m.name)}:</b> ${esc(m.text)}</span></div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  function addChat(msg) {
    S.chat.push(msg);
    broadcast({ t: 'chat', msg });
    renderChat();
  }

  function sendChat(text) {
    text = text.trim();
    if (!text) return;
    if (S.role === 'guest') { if (S.conn && S.conn.open) S.conn.send({ t: 'chat', text }); }
    else if (S.role === 'host') {
      const p = S.state ? S.state.players[S.me] : null;
      addChat({ name: myName(), color: p ? p.color : PROFILE.color, text: text.slice(0, 200) });
    }
  }

  $('#chatForm').onsubmit = e => {
    e.preventDefault();
    sendChat($('#chatIn').value);
    $('#chatIn').value = '';
  };

  // ---------- Spielende ----------

  function renderOverlay() {
    const st = S.state, o = $('#overlay');
    if (!st.over) { o.hidden = true; S.overShown = false; return; }
    if (S.overShown) return;
    S.overShown = true;
    const winners = st.winners && st.winners.length ? st.winners : [st.winner];
    const won = winners.includes(S.me), shared = winners.length > 1;
    recordGame(st);
    const canRestart = S.role !== 'guest';
    const ranking = st.players.map((p, i) => ({ i, s: K.score(st, i) })).sort((a, b) => b.s - a.s)
      .map(r => `<li>${pName(r.i)} <span class="tag">${r.s} Punkte</span></li>`).join('');
    setTimeout(() => {
      Sound.play(won ? 'victory' : 'defeat');
      o.innerHTML = `<div class="modal center victory">
        ${S.avatars && S.avatars[st.winner] ? avatarHTML(S.avatars[st.winner], st.players[st.winner].name, st.players[st.winner].color, 'win') : '<svg class="crest" style="width:64px;height:72px"><use href="#crest"/></svg>'}
        <h1>${won ? (shared ? 'Gemeinsamer Sieg!' : 'Sieg!') : 'Spielende'}</h1>
        <p>${shared ? `🤝 Das Bündnis aus ${winners.map(pName).join(' und ')} herrscht gemeinsam über das Land!` : `${pName(st.winner)} ${won ? '– du –' : ''} herrscht über das Land!`}</p>
        <ol class="ranking">${ranking}</ol>
        <div class="row">
          <button id="oMenu">Hauptmenü</button>
          <button id="oStats">📊 Statistik</button>
          ${canRestart ? '<button id="oAgain" class="primary">Nochmal spielen</button>' : '<span class="tag">Warte auf den Gastgeber…</span>'}
        </div></div>`;
      o.hidden = false;
      $('#oMenu').onclick = toMenu;
      $('#oStats').onclick = () => openStats('chart');
      if (canRestart) $('#oAgain').onclick = () => {
        if (S.role === 'host') {
          // zurück in die Lobby; abgesprungene Spieler fallen raus
          S.lobby = S.lobby.filter(p => p.type === 'ai' || p.cid === 'host' || S.conns.has(p.cid));
          S.state = null;
          S.settings = { ...S.settings, seed: newSeed() };
          o.hidden = true;
          lobbyChanged();
        } else { S.tut = null; $('#coach').hidden = true; S.settings = { ...S.settings, seed: newSeed() }; startGame(); }
      };
    }, 1800);
  }

  $('#btnMenu').onclick = () => { renderGameMenu(); $('#gameMenu').hidden = false; };
  function renderGameMenu() {
    $('#gmMusic').textContent = `Musik: ${Sound.music ? 'an' : 'aus'}`;
    $('#gmSfx').textContent = `Soundeffekte: ${Sound.sfx ? 'an' : 'aus'}`;
    $('#gmRealms').textContent = `Reichsnamen auf der Karte: ${S.realms ? 'an' : 'aus'}`;
  }
  $('#gameMenu').addEventListener('click', async e => {
    const b = e.target.closest('[data-gm]');
    if (e.target.id === 'gameMenu' || (b && b.dataset.gm === 'close')) { $('#gameMenu').hidden = true; return; }
    if (!b) return;
    const a = b.dataset.gm;
    if (a === 'help') { $('#gameMenu').hidden = true; openHelp(); }
    else if (a === 'music') { Sound.toggleMusic(); renderSoundButtons(); renderGameMenu(); }
    else if (a === 'sfx') { Sound.toggleSfx(); renderSoundButtons(); renderGameMenu(); }
    else if (a === 'fit') { $('#gameMenu').hidden = true; fitView(); }
    else if (a === 'stats') { $('#gameMenu').hidden = true; openStats(); }
    else if (a === 'keys') { $('#gameMenu').hidden = true; showKeys(); }
    else if (a === 'realms') { S.realms = !S.realms; store.set('kingdoms-realms', S.realms ? '1' : '0'); S.realmKey = ''; renderRealms(); renderGameMenu(); }
    else if (a === 'quit') {
      $('#gameMenu').hidden = true;
      const st = S.state, running = st && !st.over;
      const txt = !running ? 'Zum Hauptmenü?'
        : S.role === 'guest' ? 'Spiel wirklich verlassen? Bis du zurückkommst, spielt die KI für dich. Über „🔌 Zurück in Raum“ im Hauptmenü kannst du wieder einsteigen.'
          : S.role === 'host' ? '<b>Du bist Gastgeber:</b> Wenn du gehst, fliegen alle aus dem Spiel. Über „▶️ Spiel fortsetzen“ kannst du es später wieder öffnen.'
            : 'Spiel verlassen? Über „▶️ Spiel fortsetzen“ geht es später weiter.';
      if (await ask(txt, 'Verlassen')) toMenu();
    }
  });

  // ---------- Was ist neu? ----------
  // Nach jedem Update erscheint einmal ein Fenster mit den Neuigkeiten (neueste zuerst).
  const CHANGELOG = [
    { v: '33', title: 'Besser spielen auf dem Handy', items: [
      '🗺️ Die Karte bleibt im Bild: Sie lässt sich nicht mehr weit ins leere Meer schieben und startet so, dass möglichst viel Land zu sehen ist.',
      '👆 Ein Tipp auf die Figuren einer Provinz wählt jetzt die Provinz – vorher passierte bei fremden Figuren gar nichts. Auch Truppen auf eine gegnerische Figur ziehen klappt jetzt.',
      '📋 Die Infotafel hat ein ✕ zum Schließen, und die angetippte Provinz rutscht über die Tafel, statt darunter zu verschwinden. Hinweise erscheinen oben statt über der Tafel.',
      '⚔️ Greift dich jemand an einer Stelle an, die du gerade nicht siehst, schwenkt die Karte automatisch dorthin.',
      '📱 Die Leiste unten ist flacher, die Reiche-Liste schließt mit ✕ oder einem Tipp auf die Karte, im Querformat sind alle Rohstoffe zu sehen, „Spiel starten“ ist im Menü immer erreichbar und die Provinznamen sind etwas größer.',
      '🔔 Im Online-Spiel bleibt der Bildschirm an, damit die Verbindung nicht abreißt, und das Handy vibriert kurz, wenn du dran bist.',
      '🎨 Die gewählte Reichsfarbe ist im Menü wieder richtig zu sehen.',
    ] },
    { v: '32', title: 'Neue Grafik und lebendige Animationen', items: [
      '🎨 Alles im gleichen Stil neu gezeichnet: Gebäude, Burgen, Hauptstadt, Mauern, Dörfer und alle Einheiten haben jetzt einen warmen dunklen Umriss, Licht von links oben und klare Formen – auch klein gut zu erkennen. Fahnen an Gebäuden zeigen deine Reichsfarbe.',
      '🌳 Die Karte lebt: Bäume wiegen sich im Wind, auf dem Meer glitzern Wellen, aus Dörfern und der Hauptstadt steigt Rauch, die Säge im Sägewerk dreht sich, Fackeln flackern, das Boot im Hafen schaukelt und Märkte und Tempel glimmen.',
      '🚶 Einheiten bewegen sich richtig: Soldaten laufen mit den Beinen, Ritter galoppieren, die Räder der Katapulte drehen sich. Deine bereiten Truppen atmen leicht – so siehst du sofort, wer noch ziehen kann.',
      '⚔️ Kämpfe mit mehr Wucht: Sie schlagen zu, werden getroffen und fallen, die Sieger jubeln. Katapulte schleudern Steine, Bogenschützen schießen Pfeile voraus, beim Zusammenprall blitzen gekreuzte Schwerter auf und beim Erobern weht die neue Fahne mit einer Schockwelle.',
      '🐉 Jedes Monster bewegt sich anders: Der Drache schlägt mit den Flügeln und speit Feuer, der Wolf lauert und hechelt, der Troll verlagert schwer sein Gewicht und der Sandwurm taucht in den Sand ab und wieder auf.',
      '💰 Gold, Wissen, Nahrung, Holz und Stein haben eigene gezeichnete Symbole.',
      '✅ Nur die Grafik ist neu – Regeln, Spielstände und das Online-Spiel bleiben gleich. Wer am Gerät „Bewegung reduzieren“ eingestellt hat, bekommt eine ruhige Karte.',
    ] },
    { v: '31', title: 'Neue Monster-Grafiken', items: [
      '🐉 Wolf, Troll, Drache und Sandwurm sind jetzt richtig gemalte Bilder statt einfacher Zeichnungen – mit SpriteCook erstellt.',
      '🧌 Der Troll atmet auf der Karte und bewegt seine Keule. Die anderen Monster atmen und wippen weiter wie bisher.',
      '🔎 Auch die kleinen Monster-Symbole in den Listen zeigen die neuen Bilder.',
    ] },
    { v: '30', title: 'Monster und Kampf-Animationen', items: [
      '🐺 Neue Monster: ein zotteliger Wolf, ein Troll mit Keule, ein feuerspeiender roter Drache und ein Sandwurm mit Zahnkranz.',
      '⚔️ Einmarsch mit Gefecht: Deine Truppen marschieren in die Provinz, die Verteidiger stellen sich, es fliegen Funken – dann fallen die Verlierer und die Sieger hissen ihre Fahne.',
      '🚶 Märsche als kleine Kolonne mit Staubwolken. Monster auf der Karte bewegen sich und der Drache speit Feuer.',
    ] },
    { v: '29', title: 'Neue Grafiken', items: [
      '🎨 Alle Gebäude sind neu gezeichnet: Bauernhof mit Silo, Sägewerk mit Kreissäge, Mine mit Lore voller Gold, Markt mit Ständen, Tempel mit Säulen, Hafen mit Schiff und mehr.',
      '⚔️ Neue Figuren für alle Einheiten: Krieger mit Schild, Bogenschützen mit Köcher, Speerkämpfer, Ritter und Schwere Reiterei auf Pferden, Katapult und Tribok.',
    ] },
    { v: '28', title: 'Wiederbeitreten neu gebaut & Ritterlauf', items: [
      '🔌 Bricht die Verbindung ab (Handy gesperrt, WLAN weg), verbindet sich das Spiel jetzt automatisch neu – du bleibst im Spiel und musst nichts tun.',
      '📡 Der Raum des Gastgebers bleibt erreichbar, auch wenn sein Handy kurz schläft. Nach dem Neuladen behält er immer denselben Raum-Code.',
      '🆙 Updates sperren niemanden mehr aus: Gastgeber und Freunde können auch mit leicht verschiedenen Versionen zusammen spielen.',
      '🏃 Neues Minispiel „Ritterlauf“ statt Drachenflug: drei Spuren, springen, rutschen, Münzen sammeln – wie Subway Surfers, nur mit Rittern.',
    ] },
    { v: '27', title: 'Ruhigere Forschung', items: [
      '🔬 Der Forschungs-Knopf blinkt nicht mehr – er ist nur noch dezent golden umrandet, und die Zahl zeigt, was du dir leisten kannst.',
    ] },
    { v: '26', title: 'Lebendige Provinzen', items: [
      '🏘️ Um deine Hauptstadt wächst eine Stadt mit Häusern, Wegen und Gärten – und die Provinz bekommt einen goldenen Rand.',
      '🌾 Gebäude prägen jetzt die ganze Provinz: Felder beim Bauernhof, Holzstapel beim Sägewerk, Steinblöcke, Boote am Hafen, Marktstände, Zelte und mehr.',
      '🔨 Gebäude-Symbole sind größer und stehen auf einem kleinen Sockel.',
    ] },
    { v: '25', title: 'Schönere Hauptstädte', items: [
      '🏰 Hauptstädte sind jetzt prächtige Burgen mit Bergfried, Ecktürmen, Fahnen in deiner Reichsfarbe und erleuchteten Fenstern.',
      '🏷️ Reichsnamen auf der Karte sind kleiner und eleganter und schwingen sich sanft über das Gebiet.',
    ] },
    { v: '24', title: 'Neuigkeiten-Fenster', items: [
      '📰 Nach jedem Update siehst du hier, was neu ist – und im Hauptmenü unter „Neuigkeiten“ jederzeit wieder.',
    ] },
    { v: '23', title: 'Drachenflug', items: [
      '🐉 Neues Minispiel, wenn du nicht dran bist: Flieg einen Drachen in deiner Reichsfarbe, brenne Krähen, Türme, Ballons und feindliche Drachen nieder.',
      '🔥 Power-ups (Dreifach-Feuer, Schild, Magnet, Extraleben), Kombos bis ×5 und ein Rekord zum Prahlen im Chat.',
    ] },
    { v: '22', title: 'Reichsnamen', items: [
      '🏰 Gib deinem Reich einen eigenen Namen – im Hauptmenü oder im Spiel mit ✏️. Er steht groß auf der Karte.',
    ] },
    { v: '21', title: 'Großes Update', items: [
      '🔌 Wiederbeitreten ist jetzt sicher: Nur du kommst zurück in dein Reich, Fremde muss der Gastgeber hereinlassen.',
      '❄️ Schnee im Norden, die Karte „Nordland“ und 🪱 Sandwürmer in der Wüste.',
      '⛵ Seefahrt mit Häfen, Durchmarsch bei Verbündeten und 🚩 Marschbefehle über mehrere Runden.',
      '📊 Statistikfenster (Taste T), eigene Statistik im Menü, neue Tastenkürzel (S teilt Divisionen).',
      '🔨 Baumenü immer sichtbar – direkt im Infofeld einer Provinz bauen. 🔬 Forschung hat einen eigenen Reiter.',
    ] },
    { v: '20', title: 'Diplomatie', items: [
      '🕊️ Frieden und 🤝 Bündnisse (mit Handel), Kündigen, 🗡️ Verrat, 🎁 Geschenke – und ein gemeinsamer Sieg für Verbündete.',
    ] },
    { v: '19', title: 'Rohstoffe', items: [
      '🌾 Nahrung, 🪵 Holz und 🪨 Stein – für Einheiten und Gebäude. Truppenlimit rund 20 pro Provinz. ▶️ Spiele fortsetzen.',
    ] },
  ];
  function showNews(force) {
    const seen = store.get('kingdoms-seen');
    store.set('kingdoms-seen', APP_VERSION);
    if (!force && seen === APP_VERSION) return;
    if (!force && !$('#game').hidden) return;
    // Neulinge sehen nur das neueste Update, Rückkehrer alles, was sie verpasst haben (höchstens 4)
    const list = force ? CHANGELOG.slice(0, 6) : seen ? CHANGELOG.filter(c => +c.v > +seen).slice(0, 4) : CHANGELOG.slice(0, 1);
    if (!list.length) return;
    const o = $('#confirm');
    o.innerHTML = `<div class="modal news"><div class="mhead"><h2>📰 Was ist neu?</h2><button data-a="1" class="ghost" title="Schließen">✕</button></div>
      ${list.map((c, k) => `<section class="${k ? 'old' : ''}"><h3>${k ? '' : '<span class="newtag">NEU</span> '}Version ${c.v} · ${esc(c.title)}</h3>
        <ul>${c.items.map(t => `<li>${t}</li>`).join('')}</ul></section>`).join('')}
      <div class="row end"><button data-a="1" class="primary">Los geht's!</button></div></div>`;
    o.hidden = false;
    o.onclick = e => { if (e.target === o || e.target.closest('[data-a]')) o.hidden = true; };
  }

  // ---------- Neue Version? ----------
  // version.json liegt neben der Seite; ändert sie sich nach einem Update, bekommt jeder Spieler einen Hinweis.
  async function checkVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.json()).v;
      // mitten im Online-Spiel nicht zum Neuladen auffordern – sonst passen die Versionen nicht mehr zusammen
      const online = S.state && !S.state.over && (S.role === 'guest' || S.role === 'host');
      if (v && v !== APP_VERSION && !S.updDismissed && !online) $('#updateBar').hidden = false;
    } catch { /* offline – egal */ }
  }
  $('#btnReload').onclick = () => location.reload();
  window.addEventListener('beforeunload', e => {
    if (S.state && !S.state.over && (S.role === 'guest' || S.role === 'host')) { e.preventDefault(); e.returnValue = ''; }
  });
  $('#btnUpdLater').onclick = () => { S.updDismissed = true; $('#updateBar').hidden = true; };
  setInterval(checkVersion, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
  setTimeout(checkVersion, 4000);
  renderResume();
  setTimeout(() => showNews(false), 600);
})();
