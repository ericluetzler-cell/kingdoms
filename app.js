/* Kingdoms – Oberfläche, Menüs, Tutorial und Online-Räume.
   Online: Der Browser des Gastgebers verwaltet das Spiel (inkl. KI), Gäste verbinden sich per WebRTC (PeerJS). */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const LEVELS = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };
  const BOT_NAMES = ['Graf Bruno', 'Lady Mira', 'König Otto', 'Baronin Ilse', 'Ritter Kunz', 'Herzogin Wanda', 'Fürst Egon', 'Gräfin Liv'];
  const ID_PREFIX = 'kingdoms-game-';
  const BLDG_ORDER = ['lumber', 'farm', 'mine', 'library', 'market', 'temple', 'caravan', 'tower', 'barracks', 'fort'];
  const newSeed = () => (Math.random() * 2 ** 32) >>> 0;
  const APP_VERSION = '16';
  // nur zum Testen: mit ?debug in der Adresse ist der Spielzustand in der Konsole erreichbar
  const DEBUG = new URLSearchParams(location.search).has('debug');

  const S = {
    role: null,            // 'local' | 'host' | 'guest'
    me: 0, state: null, geo: null, lobby: [], code: '',
    settings: { map: 'continent', size: 'medium', seed: newSeed(), mode: 'classic', world: null },
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
  const coin = n => `<span class="amt"><i class="coin"></i>${n}</span>`;
  const scroll = n => `<span class="amt"><i class="scroll">📜</i>${n}</span>`;

  if (DEBUG) window.__kingdoms = { S, render: () => render() };

  function show(id) { document.querySelectorAll('.screen').forEach(e => { e.hidden = e.id !== id; }); const m = document.querySelector('#menuSound'); if (m) m.hidden = id === 'game'; }

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
    return { name, type: 'ai', level, color: K.COLORS.find(c => !usedC.has(c)) };
  }

  // ---------- Titelbildschirm ----------

  $('#name').value = store.get('kingdoms-name') || '';
  $('#name').addEventListener('change', () => store.set('kingdoms-name', myName()));

  // ---------- Profil: eigenes Bild und Lieblingsfarbe ----------

  const PROFILE = { color: K.COLORS.includes(store.get('kingdoms-color')) ? store.get('kingdoms-color') : K.COLORS[0], avatar: store.get('kingdoms-avatar') || null };
  const me0 = () => ({ name: myName(), type: 'human', cid: 'host', color: PROFILE.color, avatar: PROFILE.avatar });
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
    const url = await MapView.toURL(MapView.terrain(w.geo, 1.6));
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
    else menuPanel(go);
  });

  // ---------- Eigene Welten (Weltenschmiede) ----------

  const worldsStore = {
    list() { try { return JSON.parse(store.get('kingdoms-worlds') || '[]'); } catch { return []; } },
    save(list) { store.set('kingdoms-worlds', JSON.stringify(list)); },
  };
  const worldCustom = w => ({
    land: w.land, provSize: w.provSize, forest: w.forest, mountain: w.mountain, desert: w.desert, rivers: w.rivers, peaks: w.peaks, fixedSize: true,
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
    if (S.peer) { try { S.peer.destroy(); } catch { /* egal */ } }
    Object.assign(S, { role: null, me: 0, state: null, geo: null, lobby: [], code: '', peer: null, conns: new Map(), conn: null,
      avatars: null, sel: -1, selPref: null, target: -1, mode: 'recruit', unit: 'w', bldg: 'lumber', amount: 1, turnKey: '',
      seenBattle: 0, seenMarch: 0, chat: [], tut: null, mapKey: '', nationKey: '', overShown: false, pick: null, plan: null, selDivs: null, split: null });
    $('#planner').hidden = true;
    $('#coach').hidden = true;
    $('#research').hidden = true;
    $('#side').classList.remove('open');
    document.title = 'Kingdoms';
  }

  function toMenu() { resetSession(); show('menu'); menuPanel('main'); }

  // ---------- Weltenschmiede: eigene Welten gestalten ----------

  const forge = (() => {
    const DEF = () => ({
      id: 'w' + Date.now().toString(36), name: 'Meine Welt', type: 'continent', size: 'medium', seed: newSeed(),
      land: 0.55, provSize: 17, forest: 0.34, mountain: 0.14, desert: 0.14, rivers: 6, peaks: true, monsters: 0.11,
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
      ['trolls', '👹', 'Trollhöhle'], ['dragon', '🐉', 'Drachenhort'], ['hut', '🛖', 'Dorf'], ['erase', '🧽', 'Entfernen'],
    ];
    const TOOL_HELP = {
      rename: 'Tippe auf eine Provinz, um sie umzubenennen.',
      start: 'Tippe auf Provinzen, um Startstädte festzulegen (höchstens 6). Dort beginnen die Reiche – benenne sie gleich mit ✏️.',
      wolves: 'Tippe auf eine Provinz, um ein Wolfsrudel zu setzen (leicht, kleiner Schatz).',
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
      const icon = { plain: '🌾', forest: '🌲', mountain: '⛰️', desert: '🏜️' };
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
        const nTerr = { plain: 0, forest: 0, mountain: 0, desert: 0 };
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
        <span class="grow">${esc(p.name)} ${p.cid === 'host' ? '<span class="tag">👑 Gastgeber</span>' : ''}
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

  function openHostPeer() {
    S.code = newCode();
    renderLobby();
    const peer = new Peer(ID_PREFIX + S.code);
    S.peer = peer;
    peer.on('open', () => renderLobby());
    peer.on('error', err => {
      if (err.type === 'unavailable-id') { peer.destroy(); openHostPeer(); return; }
      toast('Verbindungsfehler: ' + err.type);
    });
    peer.on('connection', conn => {
      conn.on('data', d => onHostData(conn, d));
      conn.on('close', () => onGuestLeft(conn));
    });
  }

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
      if (S.state) return conn.send({ t: 'err', msg: 'Das Spiel läuft bereits.', fatal: true });
      if (d.v !== APP_VERSION) return conn.send({ t: 'err', msg: 'Ihr habt verschiedene Versionen von Kingdoms. Bitte beide die Seite neu laden (Strg+F5 bzw. am Handy neu öffnen).', fatal: true });
      if (S.lobby.length >= 6) return conn.send({ t: 'err', msg: 'Der Raum ist voll.', fatal: true });
      S.conns.set(conn.peer, conn);
      const usedC = S.lobby.map(x => x.color);
      const color = K.COLORS.includes(d.color) && !usedC.includes(d.color) ? d.color : K.COLORS.find(c => !usedC.includes(c));
      S.lobby.push({ name: String(d.name || 'Gast').slice(0, 16), type: 'human', cid: conn.peer, color, avatar: safeAvatar(d.avatar) });
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

  // Gastgeber wirft jemanden raus: in der Lobby verschwindet er, im Spiel übernimmt die KI sein Reich
  function kickPlayer(cid) {
    const c = S.conns.get(cid);
    if (c && c.open) c.send({ t: 'err', msg: 'Du wurdest vom Gastgeber aus dem Raum entfernt.', fatal: true });
    setTimeout(() => { try { if (c) c.close(); } catch { /* egal */ } }, 1500);
    S.conns.delete(cid);
    if (S.state) {
      const p = S.state.players.findIndex(x => x.cid === cid);
      if (p >= 0) {
        Object.assign(S.state.players[p], { type: 'ai', level: 'medium', cid: null });
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
    S.conns.delete(conn.peer);
    if (S.state) {
      const p = S.state.players.findIndex(x => x.cid === conn.peer);
      if (p >= 0 && S.state.players[p].type === 'human') {
        Object.assign(S.state.players[p], { type: 'ai', level: 'medium', cid: null });
        S.state.log.push({ m: '📡 {0} hat das Spiel verlassen – die KI übernimmt.', ps: [p] });
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
    toast('Verbinde…');
    peer.on('open', () => {
      const conn = peer.connect(ID_PREFIX + code, { reliable: true });
      S.conn = conn;
      conn.on('open', () => conn.send({ t: 'join', name: myName(), v: APP_VERSION, color: PROFILE.color, avatar: PROFILE.avatar }));
      conn.on('data', onGuestData);
      conn.on('close', () => { if (S.role === 'guest' && conn === S.conn) { toast('Verbindung zum Gastgeber verloren.'); toMenu(); } });
    });
    peer.on('error', err => {
      toast(err.type === 'peer-unavailable' ? 'Raum nicht gefunden.' : 'Verbindungsfehler: ' + err.type);
      if (err.type === 'peer-unavailable') toMenu();
    });
  }

  function onGuestData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'lobby') {
      S.lobby = d.lobby; S.code = d.code; S.settings = d.settings || S.settings; S.state = null;
      $('#overlay').hidden = true; renderLobby();
    } else if (d.t === 'geo') S.geo = d.geo;
    else if (d.t === 'state') {
      if (!S.geo) return;
      const first = !S.state;
      S.state = { ...d.state, geo: S.geo };
      S.me = S.state.players.findIndex(p => p.cid === S.peer.id);
      if (first) { show('game'); S.avatars = S.lobby.map(p => p.avatar || null); }
      render();
    } else if (d.t === 'chat') { S.chat.push(d.msg); renderChat(); }
    else if (d.t === 'err') {
      if (d.fatal) { S.role = null; toMenu(); notice(d.msg); } else toast(d.msg);
    }
  }

  // ---------- Spielablauf (Gastgeber / lokal) ----------

  function startGame(extra = {}) {
    if (S.settings.world) {
      const n = previewWorld(S.settings, S.lobby.length).cells.length;
      if (n < S.lobby.length * 2) { toast(`Die Welt „${S.settings.world.name}“ hat nur ${n} Provinzen – zu wenig für ${S.lobby.length} Herrscher.`); return; }
    }
    S.state = K.createGame(S.lobby, { ...gameOpts(S.settings), ...extra });
    S.avatars = S.lobby.map(p => p.avatar || null);
    S.me = 0;
    Object.assign(S, { sel: -1, selDivs: null, split: null, plan: null, seenBattle: 0, seenMarch: 0, turnKey: '', nationKey: '' });
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

  function afterChange() {
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
  const attackable = i => S.sel >= 0 && i >= 0 && S.state.cells[S.sel].n.includes(i) && hostileTo(i);
  // ausgewählte Divisionen der gewählten Provinz
  const selDivObjs = () => (S.sel >= 0 && S.selDivs ? S.state.cells[S.sel].divs.filter(v => S.selDivs.includes(v.id)) : []);
  const selUnits = () => K.divUnits(selDivObjs());
  const pickTotal = () => K.total(selUnits());
  const marchable = () => (pickTotal() ? K.moveTargets(S.state, S.sel, selUnits()) : []);
  const readyDivs = c => c.divs.filter(v => !v.done);
  const strongest = u => [...K.TYPES].reverse().find(t => u[t] > 0) || 'w';
  const svgEl = () => $('#map');
  const SND = { recruit: 'recruit', build: 'build', research: 'research', demolish: null, end: 'click', propose: 'click', accept: 'click', break: 'lose', split: 'select', merge: 'select' };

  let view = { x: 0, y: 0, w: 100, h: 100 };
  function applyView() { svgEl().setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`); }
  function fitView() {
    if (!S.state) return;
    const geo = S.state.geo, r = $('#mapwrap').getBoundingClientRect();
    if (!r.width) return;
    const top = r.width < 860 ? 110 : 64, bottom = ($('#actionbar').offsetHeight || 110) + 20;
    const right = r.width < 860 ? 0 : ($('#side').offsetWidth || 0) + 24;
    const availH = Math.max(120, r.height - top - bottom), availW = Math.max(200, r.width - right);
    let scale = Math.min(availW / geo.W, availH / geo.H) * 0.97;
    let cx = geo.W / 2, cy = geo.H / 2;
    // Hochformat (Handy): nicht die winzige Gesamtkarte zeigen, sondern auf die eigene Hauptstadt zoomen
    const cap = S.state.cells.find(c => c.capital && c.owner === S.me);
    if (r.width < 600 && cap) { scale = Math.min(availH / geo.H, availW / (geo.W * 0.5)); cx = cap.lx; cy = cap.ly; }
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
    requestAnimationFrame(() => fitView());
    const url = await MapView.toURL(MapView.terrain(geo, Math.min(3, 2400 / geo.W)));
    if (S.mapKey === key) img.setAttribute('href', url);
  }

  // Ziehen (Karte verschieben oder Divisions-Marker ziehen), Mausrad, zwei Finger
  (() => {
    const wrap = $('#mapwrap'), pts = new Map();
    let start = null, dragged = false, pinch = null, unitDrag = null;
    const provAt = (x, y) => { const el = document.elementFromPoint(x, y); const g = el && el.closest && el.closest('.prov'); return g ? +g.dataset.i : -1; };
    wrap.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!S.state || S.sel < 0) return;
      const i = provAt(e.clientX, e.clientY);
      if (i >= 0 && i !== S.sel) onCell(i, true);
    });
    wrap.addEventListener('pointerdown', e => {
      if (e.button === 2) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      wrap.setPointerCapture(e.pointerId);
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
      if (g && S.state && !pts.size) showInfo(+g.dataset.i);
    });
    wrap.addEventListener('mouseleave', () => { $('#info').hidden = true; });
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
    const turnKey = st.round + '-' + st.turn;
    if (turnKey !== S.turnKey) {
      S.turnKey = turnKey;
      if (myTurn()) {
        Object.assign(S, { mode: st.players[S.me].gold >= 2 ? 'recruit' : 'army', sel: -1, selDivs: null, split: null });
        if (!(S.tut && st.round === 1)) { splash(`Dein Zug<small>Runde ${st.round}</small>`); Sound.play('turn'); }
      }
    }
    // ankommende Truppen erst nach ihrem Lauf über die Karte zeigen
    if (st.march && st.march.id !== S.seenMarch) S.arrive = { i: st.march.to, t0: performance.now(), ms: 1050 };
    if (st.battle && st.battle.id !== S.seenBattle && st.battle.won) S.arrive = { i: st.battle.to, t0: performance.now(), ms: 700 };
    fixSelection();
    renderProvinces();
    renderNations();
    renderLabels();
    renderUnits();
    renderHud();
    renderBar();
    document.documentElement.style.setProperty('--dock-h', ($('#actionbar').offsetHeight || 0) + 'px');
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
    const m = st.march && st.march.id !== S.seenMarch ? st.march : null;
    if (m) { S.seenMarch = m.id; playMarch(m); }
    tutEvent({ kind: 'render' });
  }

  function splash(html) {
    const s = $('#turnSplash');
    s.innerHTML = `<div>${html}</div>`;
    s.hidden = false;
    clearTimeout(S.splashTimer);
    S.splashTimer = setTimeout(() => { s.hidden = true; }, 1700);
  }

  function deselect() { S.sel = -1; S.selDivs = null; S.split = null; S.shootFrom = -1; $('#info').hidden = true; }

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
      else if (selN.includes(i) && attackable(i)) cls.push('atk');
      else if (marchT.includes(i)) cls.push('mov');
      if (mt && S.mode === 'recruit') cls.push(c.owner === S.me && K.canRecruit(c) ? 'can' : 'dim');
      if (mt && S.mode === 'build') cls.push((S.bldg === 'demolish' ? c.owner === S.me && c.building && !c.throne : K.canBuild(st, S.me, i, S.bldg)) ? 'can' : 'dim');
      if (S.shootFrom >= 0) { if (i === S.shootFrom) cls.push('sel'); else cls.push(shootT.includes(i) ? 'shoot' : 'dim'); }
      if (i === hint) cls.push('hint');
      if (c.throne) cls.push('throne');
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

  // Gebäude stehen sichtbar in der Provinz; neu gebaute erscheinen mit einer kleinen Bau-Animation
  const BLDG_SPOT = [-27, 4];
  function renderLabels() {
    const st = S.state, C = st.cells;
    S.seenBldg = S.seenBldg || {};
    let html = '';
    C.forEach((c, i) => {
      const { lx: x, ly: y } = c;
      const col = c.owner >= 0 ? st.players[c.owner].color : '#cfc6b2';
      html += `<text class="pname${c.sz === 'S' ? ' small' : ''}" x="${x}" y="${y - 15}">${esc(c.name)}</text>`;
      if (c.throne) html += `<g class="throne-mark"><use href="#crown" x="${x - 10}" y="${y - 60}" width="20" height="13"/><text class="throne-txt" x="${x}" y="${y - 63}">THRON</text></g>`;
      if (K.isCity(c)) {
        html += `<use href="#castle" x="${x - 12}" y="${y - 41}" width="24" height="20" style="color:${col}" filter="url(#f-soft)"/>`;
        if (c.capital) html += `<use href="#crown" x="${x - 5}" y="${y - 48}" width="10" height="6.5"/>`;
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
        else if (c.building === 'lumber') art = `<path class="stump" d="M${bx + 7} ${by + 6} h3 v2 h-3 z M${bx - 10} ${by + 7} h3 v2 h-3 z"/>`;
        html += `<g class="bldg${fresh ? ' fresh' : ''}" style="transform-origin:${bx}px ${by + 8}px">${art}
          <use href="#b-${c.building}" x="${bx - 9}" y="${by - 9}" width="18" height="18" filter="url(#f-soft)"/></g>`;
      }
      if (c.hut) html += `<use href="#hut" x="${x + BLDG_SPOT[0] - 7}" y="${y + BLDG_SPOT[1] - 7}" width="14" height="14" filter="url(#f-soft)"/>`;
    });
    $('#labels').innerHTML = html;
  }

  // Divisionen wie bei Hearts of Iron: eine Figur je Division (stärkste Einheit) auf einem Sockel mit der Stärke
  const FIG_W = { w: 12, a: 12, p: 12, l: 12, k: 17, c: 17, h: 17, t: 19, wo: 17, tr: 14, dr: 24 };
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
        html += `<g class="ctr${spent ? ' spent' : ''}${picked ? ' picked' : ''}${mine && !spent ? ' ready' : ''}${arr ? ' arriving' : ''}" data-i="${i}" data-d="${v.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"${arr ? ` style="animation-delay:${arr.ms - (performance.now() - arr.t0)}ms"` : ''}>
          <title>${esc(v.name)}: ${K.TYPES.filter(x2 => v.u[x2]).map(x2 => `${v.u[x2]} ${K.UNITS[x2].plural}`).join(', ')}</title>
          <rect class="hit" x="-2" y="-3" width="${W + 4}" height="28" rx="3"/>
          ${picked ? `<ellipse class="sel-glow" cx="${W / 2}" cy="15.5" rx="${W / 2 + 2}" ry="4"/>` : ''}
          <use class="fig" href="#fig-${t}" x="${(W - fw) / 2}" y="-1" width="${fw}" height="17" style="color:${col}"/>
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
    fx.querySelectorAll('animateMotion').forEach(a => { try { a.beginElement(); } catch { /* egal */ } });
    clearTimeout(S.fxTimer);
    S.fxTimer = setTimeout(() => { fx.innerHTML = ''; }, ms);
  }

  // eine kleine Figur läuft den Pfad entlang (wippt beim Gehen)
  const token = (d, col, fig, dur) => {
    const fw = FIG_W[fig] || 12;
    return `<g><g class="walker"><use href="#fig-${fig}" x="${-fw / 2 - 1}" y="-19" width="${fw + 2}" height="20" style="color:${col}"/></g>
      <animateMotion dur="${dur}s" begin="indefinite" fill="freeze" path="${d}" calcMode="spline" keyTimes="0;1" keySplines=".45 0 .55 1"/></g>`;
  };

  // Pfeilhagel: viele kleine Pfeile fliegen in hohem Bogen auf das Ziel
  function playVolley(v) {
    const C = S.state.cells, f = C[v.from], t = C[v.to];
    let html = '';
    for (let k = 0; k < Math.min(12, 3 + v.n * 2); k++) {
      const ox = (Math.sin(k * 2.1) * 8).toFixed(1), oy = (Math.cos(k * 1.7) * 6).toFixed(1);
      const x1 = f.lx + +ox, y1 = f.ly + +oy, x2 = t.lx + (Math.cos(k * 2.6) * 10), y2 = t.ly + (Math.sin(k * 1.9) * 8);
      const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - Math.hypot(x2 - x1, y2 - y1) * 0.45;
      const d = `M${x1} ${y1} Q${mx} ${my} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      html += `<g><path d="M-4 0 L3 0" stroke="#3b2a1a" stroke-width="1"/><path d="M3 -1.4 L5.5 0 L3 1.4 Z" fill="#d6dbe0"/>
        <animateMotion dur="0.7s" begin="indefinite" fill="freeze" path="${d}" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".3 0 .7 1"/></g>`;
    }
    html += `<text class="fx-dmg" x="${t.lx}" y="${t.ly - 30}">${v.killed ? '−' + v.killed : 'daneben'}</text>`;
    startFx(html, 2000);
    Sound.play('volley');
  }

  function playMarch(m) {
    const C = S.state.cells, col = S.state.players[C[m.to].owner].color;
    const d = curve(C[m.from], C[m.to]);
    startFx(`<path class="fx-arrow march" d="${d}" stroke="#4ade80"/>${token(d, col, m.fig || 'w', 1.1)}`, 2000);
    Sound.play('march');
  }

  function playBattle(b) {
    const st = S.state, C = st.cells;
    const to = C[b.to], froms = b.froms || [b.from];
    const attacker = b.won ? to.owner : C[b.from].owner;
    const col = st.players[attacker] ? st.players[attacker].color : '#fff';
    const x2 = to.lx, y2 = to.ly;
    const dust = Array.from({ length: 12 }, (_, k) => {
      const a = k / 12 * Math.PI * 2, r = 14 + (k % 3) * 6;
      return `<circle class="fx-dust" cx="${x2}" cy="${y2}" r="${1.6 + (k % 2)}" style="--tx:${(Math.cos(a) * r).toFixed(1)}px;--ty:${(Math.sin(a) * r).toFixed(1)}px"/>`;
    }).join('');
    let html = froms.map(f => { const d = curve(C[f], to); return `<path class="fx-arrow" d="${d}" stroke="${col}"/>${token(d, col, b.fig || 'w', 0.65)}`; }).join('') +
      `<circle class="fx-ring" cx="${x2}" cy="${y2}" r="16"/><circle class="fx-ring r2" cx="${x2}" cy="${y2}" r="24"/>${dust}`;
    if (b.won) {
      const ol = MapView.outlines(st.geo), f0 = C[b.from];
      html = `<clipPath id="fxclip"><path d="${ol.prov[b.to]}"/></clipPath>
        <g clip-path="url(#fxclip)"><circle class="fx-flood" cx="${(f0.lx + x2) / 2}" cy="${(f0.ly + y2) / 2}" r="${st.geo.s * 12}" fill="${col}"/></g>` + html +
        `<g class="fx-flagwrap" transform="translate(${x2 + 8} ${y2 - 6})"><g class="fx-flag">
          <line x1="0" y1="0" x2="0" y2="-24" stroke="#3b2a1a" stroke-width="1.6"/><circle cx="0" cy="-24.5" r="1.5" fill="#f5c542"/>
          <path class="fx-cloth" d="M0.8 -23 Q8 -25 15 -21 Q9 -18 0.8 -15 Z" fill="${col}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/></g></g>
        <text class="fx-text win" x="${x2}" y="${y2 + 30}">Erobert!</text>`;
    } else {
      html += `<g class="fx-shield"><use href="#crest" x="${x2 - 9}" y="${y2 - 34}" width="18" height="20"/></g>
        <text class="fx-text lose" x="${x2}" y="${y2 + 30}">Abgewehrt!</text>`;
    }
    if (b.aL) html += `<text class="fx-dmg" x="${C[b.from].lx}" y="${C[b.from].ly - 24}">−${b.aL}</text>`;
    if (b.dL) html += `<text class="fx-dmg" x="${x2}" y="${y2 - 38}">−${b.dL}</text>`;
    startFx(html, 3200);
    const svg = svgEl();
    svg.classList.remove('shake'); void svg.getBoundingClientRect(); svg.classList.add('shake');
    setTimeout(() => Sound.play('battle'), 450);
    const meInvolved = attacker === S.me || b.prev === S.me;
    setTimeout(() => Sound.play(b.won === (attacker === S.me) || !meInvolved && b.won ? 'win' : 'lose'), 1100);

    const ban = $('#banner');
    ban.innerHTML = `${pName(attacker)} ${b.won ? 'erobert' : 'scheitert an'} <b>${esc(to.name)}</b> (${Math.round(b.p * 100)} %${froms.length > 1 ? ` · aus ${froms.length} Provinzen` : ''})` +
      ` <span class="loss">Verluste −${b.aL} / −${b.dL}${b.reward ? ' ·' + esc(b.reward) : ''}</span>`;
    ban.hidden = false;
    ban.classList.toggle('good', b.won);
    clearTimeout(S.banTimer);
    S.banTimer = setTimeout(() => { ban.hidden = true; }, 2800);
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
    const chips = [T.name, `${K.PSIZE[c.sz].name}e Provinz`, c.river ? '🏞️ Fluss' : '', kind, `🛡️ ×${K.defMult(c, false).toFixed(2).replace(/\.?0+$/, '')}`]
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
    box.innerHTML = `<div class="ihead"><b>${esc(c.name)}</b><span>${c.owner >= 0 ? pName(c.owner) : '<span class="tag">Neutral</span>'}</span></div>
      <div class="chips">${chips}</div>
      <div class="tag">Ertrag pro Runde: ${coin('+' + y.gold)}${y.sci ? ' ' + scroll('+' + y.sci) : ''}${c.owner < 0 ? ' (nach Eroberung)' : ''}</div>
      ${c.hut ? '<div class="tag">Erobern bringt Gold oder Wissen</div>' : ''}
      ${L ? `<div class="treasure">💰 Schatz: +${L.gold} Gold, +${L.sci} Wissen – besiege die Monster!</div>` : ''}
      ${c.owner >= 0 ? `<div class="tag">Truppen ${K.total(c.u)} / ${K.capOf(c)} (Platz in der Provinz)</div>` : ''}
      ${divs}${extra}`;
    box.hidden = false;
  }

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
        <span title="Deine Provinzen">🏳️ ${s.cells}</span><span class="sep"></span>
        <span title="Deine Truppen (Unterhalt ${s.upkeep} Gold pro Runde)">⚔️ ${s.troops}</span>`;
    }
    const canRes = pl && Object.keys(K.TECHS).some(t => K.canResearch(st, S.me, t) && pl.sci >= K.TECHS[t].cost);
    $('#btnResearch').classList.toggle('ready', !!(canRes && myTurn()));
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
          <span class="aname">${esc(v.name)}<small>${v.done ? 'hat sich bewegt' : `bereit · ${mp + 0 * roads} Bew.`}</small></span>
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

  function renderBar() {
    const st = S.state, bar = $('#actionbar');
    if (!myTurn()) {
      const dead = st.players[S.me] && !st.players[S.me].alive;
      bar.innerHTML = `<div class="wait">${dead ? '💀 Dein Reich ist gefallen – du kannst weiter zuschauen.' : st.over ? 'Das Spiel ist vorbei.' : `⏳ ${pName(st.turn)} ist am Zug…`}</div>`;
      return;
    }
    const pl = st.players[S.me], gold = pl.gold;
    const tabs = `<div class="tabs">
        <button data-mode="recruit" class="${S.mode === 'recruit' ? 'on' : ''}" title="Taste 1">🛡️ Ausbilden</button>
        <button data-mode="build" class="${S.mode === 'build' ? 'on' : ''}" title="Taste 2">🔨 Bauen</button>
        <button data-mode="army" class="${S.mode === 'army' ? 'on' : ''}" title="Taste 3">⚔️ Armeen</button>
      </div>`;
    let status = '', right = '', shop = '';
    if (S.mode === 'recruit') {
      const btn = t => {
        const u = K.UNITS[t], locked = !K.unitUnlocked(st, S.me, t);
        return `<button class="card-btn ${S.unit === t ? 'on' : ''} ${locked ? 'locked' : ''}" data-unit="${t}" ${locked || gold < u.cost ? 'disabled' : ''}
            title="${u.name}: Angriff ${u.atk}, Verteidigung ${u.def}, Bewegung ${u.mp}${u.note ? ' – ' + u.note : ''}">
          <svg class="ico"><use href="#u-${t}"/></svg>
          <span><b>${u.name}</b><small>${locked ? '🔒 ' + K.TECHS[u.tech].name : `A${u.atk} · V${u.def} · Bew. ${u.mp}`}</small></span><em>${u.cost}<i class="coin"></i></em></button>`;
      };
      status = `Tippe auf deine Hauptstadt 👑${K.hasTech(st, S.me, 'masonry') ? ', eine Festung' : ''}${K.hasTech(st, S.me, 'drill') ? ' oder eine Kaserne' : ''} – neue Truppen bilden eine eigene Division`;
      right = `<div class="amount"><button data-amt="1" class="${S.amount === 1 ? 'on' : ''}">×1</button><button data-amt="5" class="${S.amount === 5 ? 'on' : ''}">×5</button></div>`;
      shop = `<div class="shop">${K.TYPES.filter(t => !K.UNITS[t].monster).map(btn).join('')}</div>`;
    } else if (S.mode === 'build') {
      const btn = b => {
        const B = K.BUILDINGS[b], locked = B.tech && !K.hasTech(st, S.me, B.tech);
        return `<button class="card-btn ${S.bldg === b ? 'on' : ''} ${locked ? 'locked' : ''}" data-bldg="${b}" ${locked || gold < B.cost ? 'disabled' : ''}
            title="${B.name}: ${B.desc}. Auf: ${B.on.map(t => K.TERRAIN[t].name).join(', ')}">
          <svg class="ico"><use href="${b === 'fort' ? '#castle' : '#b-' + b}" style="color:${pl.color}"/></svg>
          <span><b>${B.name}</b><small>${locked ? '🔒 ' + K.TECHS[B.tech].name : B.desc}</small></span><em>${B.cost}<i class="coin"></i></em></button>`;
      };
      const canDemo = K.hasTech(st, S.me, 'demolition');
      const demo = `<button class="card-btn ${S.bldg === 'demolish' ? 'on' : ''} ${canDemo ? '' : 'locked'}" data-bldg="demolish" ${canDemo ? '' : 'disabled'}
          title="Gebäude abreißen – die Hälfte der Kosten gibt es zurück"><span class="demo-ico">🔨</span>
          <span><b>Abreißen</b><small>${canDemo ? '50 % zurück' : '🔒 Abrissarbeiten'}</small></span></button>`;
      if (S.bldg === 'demolish') status = 'Abreißen: tippe auf ein eigenes Gebäude – die Hälfte der Kosten gibt es zurück';
      else {
        const B = K.BUILDINGS[S.bldg];
        status = `${B.name}: tippe auf eine eigene Provinz (${B.on.length === 4 ? 'beliebiges Gelände' : B.on.map(t => K.TERRAIN[t].name).join(', ')})`;
      }
      shop = `<div class="shop">${BLDG_ORDER.map(btn).join('')}${demo}</div>`;
    } else {
      status = S.sel >= 0 ? '<span class="lg mov"></span>marschieren · <span class="lg atk"></span>angreifen – Ziel antippen, Figur hinziehen oder Rechtsklick'
        : 'Tippe eine Figur (Division) oder eine Provinz an – oder ziehe eine Figur direkt auf ein Ziel';
      if (S.sel >= 0) shop = armyPanel();
    }
    bar.innerHTML = `${tabs}<span class="status">${status}</span>
      <div class="right">${right}<button id="bEnd" class="endturn ${S.mode === 'army' ? 'primary' : ''}" title="Leertaste">Zug beenden ➜</button></div>${shop}`;
  }

  $('#actionbar').onclick = e => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset, st = S.state;
    if (d.mode) { S.mode = d.mode; deselect(); Sound.play('click'); tutEvent({ kind: 'mode' }); render(); }
    else if (d.unit) { S.unit = d.unit; Sound.play('click'); renderBar(); }
    else if (d.bldg) { S.bldg = d.bldg; Sound.play('click'); renderBar(); renderProvinces(); }
    else if (d.amt) { S.amount = +d.amt; renderBar(); }
    else if (d.dv) { selectDiv(S.sel, +d.dv, true); }
    else if (d.shoot !== undefined) { S.shootFrom = S.sel; Sound.play('select'); toast('Wähle ein Ziel für den Fernschuss (gelb markiert).'); render(); }
    else if (d.dall !== undefined) { S.selDivs = readyDivs(st.cells[S.sel]).map(v => v.id); Sound.play('click'); render(); }
    else if (d.dmerge !== undefined) { act({ type: 'merge', cell: S.sel, divs: [...S.selDivs] }); }
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
  };

  async function endTurn() {
    if (!myTurn()) return;
    const st = S.state;
    // Hinweis, wenn noch viel ungenutzt ist (nicht im Tutorial)
    const idle = st.cells.reduce((s, c) => s + (c.owner === S.me ? K.total(K.avail(c)) : 0), 0);
    if (!S.tut && idle >= 6 && st.players[S.me].gold >= 2) {
      if (!await ask(`Du hast noch ${idle} bereite Truppen und ${st.players[S.me].gold} Gold. Zug trotzdem beenden?`, 'Zug beenden')) return;
    }
    deselect();
    act({ type: 'end' });
  }

  const canHover = window.matchMedia('(hover: hover)').matches;

  function onCell(i, dropped) {
    const st = S.state;
    if (!canHover || !myTurn()) showInfo(i);
    if (!myTurn()) return;
    const c = st.cells[i], gold = st.players[S.me].gold;
    if (S.mode === 'recruit' && !dropped) {
      if (c.owner !== S.me || !K.canRecruit(c)) return toast('Einheiten bildest du in deiner Hauptstadt 👑, in Festungen oder Kasernen aus.');
      const cost = K.UNITS[S.unit].cost;
      const n = Math.min(S.amount, Math.floor(gold / cost));
      if (n < 1) return toast(`Zu wenig Gold – ein ${K.UNITS[S.unit].name} kostet ${cost}.`);
      return act({ type: 'recruit', cell: i, units: { [S.unit]: n } });
    }
    if (S.mode === 'build' && !dropped) {
      if (S.bldg !== 'demolish') return act({ type: 'build', cell: i, b: S.bldg });
      if (c.owner !== S.me || !c.building) return toast('Tippe auf eines deiner Gebäude.');
      const B = K.BUILDINGS[c.building];
      ask(`${B.name} in ${esc(c.name)} abreißen? Du bekommst ${Math.floor(B.cost / 2)} Gold zurück.`, '🔨 Abreißen').then(ok => { if (ok) act({ type: 'demolish', cell: i }); });
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
        if (K.allied(st, S.me, c.owner)) return toast('Ihr seid verbündet – brich zuerst das Bündnis.');
        if (truceProtected(i)) return toast(`Friedenszeit: Spieler können erst ab Runde ${st.truce + 1} angegriffen werden.`);
      }
      if (c.owner === S.me && dropped) return toast(`Zu weit – diese Truppen schaffen ${K.mpOf(st, S.me, selUnits())} Provinz(en) pro Zug.`);
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
    const srcs = C[target].n.filter(j => C[j].owner === S.me && readyDivs(C[j]).length);
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
      return `<div class="psrc"><div class="ahead"><b>Aus ${esc(c.name)}</b>
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

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea') || $('#game').hidden || !S.state) return;
    const k = e.key;
    if (k === 'Escape') {
      if (!$('#planner').hidden) $('#planner').hidden = true;
      else if (!$('#research').hidden) $('#research').hidden = true;
      else if (!$('#help').hidden) $('#help').hidden = true;
      else { deselect(); render(); }
    } else if (k === 'Enter' && !$('#planner').hidden) launchAttack();
    else if (k === ' ' && $('#planner').hidden && $('#confirm').hidden) { e.preventDefault(); endTurn(); }
    else if (['1', '2', '3'].includes(k) && myTurn()) { S.mode = ['recruit', 'build', 'army'][+k - 1]; deselect(); tutEvent({ kind: 'mode' }); render(); }
    else if (k === 'r' || k === 'R') $('#btnResearch').click();
    else if (k === 'h' || k === 'H') openHelp();
    else if (k === 'f' || k === 'F') fitView();
  });

  // ---------- Ton ----------

  function renderSoundButtons() {
    for (const id of ['btnMusic', 'mMusic']) $('#' + id).classList.toggle('off', !Sound.music);
    for (const id of ['btnSfx', 'mSfx']) $('#' + id).classList.toggle('off', !Sound.sfx);
    $('#btnSfx').textContent = Sound.sfx ? '🔊' : '🔈';
    $('#mSfx').textContent = (Sound.sfx ? '🔊' : '🔈') + ' Effekte';
  }
  for (const id of ['btnMusic', 'mMusic']) $('#' + id).onclick = () => { Sound.toggleMusic(); renderSoundButtons(); };
  for (const id of ['btnSfx', 'mSfx']) $('#' + id).onclick = () => { Sound.toggleSfx(); renderSoundButtons(); Sound.play('click'); };
  renderSoundButtons();

  function renderPlayers() {
    const st = S.state;
    const pending = (a, b) => st.proposals.some(x => x.from === a && x.to === b);
    $('#players').innerHTML = st.players.map((p, i) => {
      const s = K.stats(st, i);
      let btn = '';
      if (i !== S.me && p.alive && st.players[S.me] && st.players[S.me].alive && !st.over && !S.tut) {
        if (K.allied(st, S.me, i)) btn = `<button data-break="${i}" title="Bündnis brechen">🗡️ Brechen</button>`;
        else if (pending(S.me, i)) btn = '<span class="tag">angefragt…</span>';
        else if (!pending(i, S.me)) btn = `<button data-ally="${i}" title="Bündnis anbieten">🤝 Bündnis</button>`;
      }
      if (S.role === 'host' && p.type === 'human' && p.cid && p.cid !== 'host') btn += `<button data-kick="${esc(p.cid)}" class="kick" title="Aus dem Spiel werfen (KI übernimmt)">👢</button>`;
      const ally = i !== S.me && K.allied(st, S.me, i) ? ' 🤝' : '';
      return `<li class="${i === st.turn && !st.over ? 'cur' : ''} ${p.alive ? '' : 'dead'}" style="--pc:${p.color}">
        ${avatarHTML(S.avatars && S.avatars[i], p.name, p.color, 'sm')}
        <span class="nm">${esc(p.name)}${i === S.me ? ' (Du)' : ''}${ally}</span>
        ${btn}
        <span class="st">${st.mode === 'throne' ? `<b class="crowns">👑 ${st.crowns[i]}/${st.crownGoal}</b> · ` : ''}${p.type === 'ai' ? `🤖 ${LEVELS[p.level]} · ` : ''}🏳️ ${s.cells} · ⚔️ ${s.troops} · 🔬 ${s.techs} · ${K.score(st, i)} Punkte</span>
      </li>`;
    }).join('');

    const incoming = st.over ? [] : st.proposals.filter(x => x.to === S.me);
    $('#proposals').innerHTML = incoming.map(x => `
      <div class="proposal">📜 ${pName(x.from)} bietet dir ein Bündnis an.
        <div class="row"><button data-acc="${x.from}" class="primary">Annehmen</button><button data-dec="${x.from}">Ablehnen</button></div>
      </div>`).join('');
  }

  $('#side').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.kick) { const p = S.state.players.find(x => x.cid === d.kick); if (p && await ask(`${esc(p.name)} aus dem Spiel werfen? Die KI übernimmt das Reich.`, '👢 Kicken')) kickPlayer(d.kick); return; }
    if (d.ally) act({ type: 'propose', target: +d.ally });
    else if (d.break && await ask('Bündnis wirklich brechen? Alle sehen deinen Verrat!', '🗡️ Brechen')) act({ type: 'break', target: +d.break });
    else if (d.acc) act({ type: 'accept', from: +d.acc });
    else if (d.dec) act({ type: 'decline', from: +d.dec });
    else if (d.e) sendChat(d.e);
  });
  $('#btnSide').onclick = () => $('#side').classList.toggle('open');

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
      <p class="tag">Wissen kommt aus deiner Hauptstadt, von Holzfällern und Bibliotheken. Jede Technologie schaltet etwas Neues frei.${myTurn() ? '' : ' Forschen kannst du nur in deinem Zug.'}</p>
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
      return `<tr><td><svg class="ico"><use href="#u-${t}"/></svg> ${u.name}</td><td>${u.cost}</td><td>${u.atk}</td><td>${u.def}</td><td>${u.mp}</td>
        <td>${u.tech ? K.TECHS[u.tech].name : '–'}${u.note ? `<br><small>${u.note}</small>` : ''}</td></tr>`;
    }).join('');
    const bldgs = BLDG_ORDER.map(b => {
      const B = K.BUILDINGS[b];
      return `<tr><td><svg class="ico"><use href="${b === 'fort' ? '#castle' : '#b-' + b}" style="color:#e8b64c"/></svg> ${B.name}</td><td>${B.cost}</td>
        <td>${B.desc}</td><td>${B.on.length === 4 ? 'überall' : B.on.map(t => K.TERRAIN[t].name).join(', ')}</td><td>${B.tech ? K.TECHS[B.tech].name : '–'}</td></tr>`;
    }).join('');
    const terr = Object.values(K.TERRAIN).map(T =>
      `<tr><td>${T.name}</td><td>${T.gold}</td><td>${T.def ? '+' + Math.round(T.def * 100) + ' %' : '–'}</td></tr>`).join('');
    const sizes = Object.values(K.PSIZE).map(P =>
      `<tr><td>${P.name}</td><td>+${P.gold}</td><td>${P.def ? '+' + Math.round(P.def * 100) + ' %' : '–'}</td></tr>`).join('');
    $('#help').innerHTML = `<div class="modal wide help">
      <div class="mhead"><h2>📖 Spielanleitung</h2><button data-close class="ghost" title="Schließen (Esc)">✕</button></div>
      <h3>Ziel</h3>
      <p>Vernichte alle Gegner. Nach 40 Runden gewinnt, wer die meisten Punkte hat (3 pro Provinz, 2 pro Technologie, 1 pro Gebäude).</p>
      <h3>Dein Zug</h3>
      <ol>
        <li><b>🔬 Forschen</b> – mit Wissen neue Einheiten, Gebäude und Boni freischalten.</li>
        <li><b>🔨 Bauen</b> – Gebäude in eigenen Provinzen bringen jede Runde mehr Gold oder Wissen.</li>
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
      <h3>Unterhalt</h3>
      <p>Armeen kosten Sold: je 4 Einheiten 1 Gold pro Runde. Oben bei deinem Gold siehst du dein Einkommen nach Abzug des Unterhalts.</p>
      <h3>Karte</h3>
      <p>Ziehen verschiebt die Karte, Mausrad oder zwei Finger zoomen. Dicke farbige Linien sind <b>Reichsgrenzen</b>, gestrichelte Linien über das Meer sind <b>Seewege</b>.</p>
      <h3>Provinzgröße</h3>
      <p>Große Provinzen sind schwerer zu erobern, bringen aber mehr Gold. Provinzen an Flüssen bringen +1 Gold.</p>
      <div class="tscroll"><table class="unit-table"><thead><tr><th>Größe</th><th>Gold</th><th>Verteidigung</th></tr></thead><tbody>${sizes}</tbody></table></div>
      <h3>Einheiten</h3>
      <div class="tscroll"><table class="unit-table"><thead><tr><th>Einheit</th><th>Gold</th><th>Angriff</th><th>Verteid.</th><th>Bewegung</th><th>Benötigt</th></tr></thead><tbody>${units}</tbody></table></div>
      <h3>Gebäude</h3>
      <div class="tscroll"><table class="unit-table"><thead><tr><th>Gebäude</th><th>Gold</th><th>Wirkung</th><th>Gelände</th><th>Benötigt</th></tr></thead><tbody>${bldgs}</tbody></table></div>
      <h3>Gelände</h3>
      <div class="tscroll"><table class="unit-table"><thead><tr><th>Gelände</th><th>Gold</th><th>Verteidigung</th></tr></thead><tbody>${terr}</tbody></table></div>
      <p>Die Hauptstadt bringt zusätzlich +3 Gold und +2 Wissen und verteidigt +50 %. 🛖 Dörfer geben beim Erobern Gold oder Wissen.</p>
      <h3>Tastenkürzel</h3>
      <p><b>Leertaste</b> Zug beenden · <b>1 / 2 / 3</b> Ausbilden / Bauen / Armeen · <b>R</b> Forschung · <b>H</b> Hilfe · <b>F</b> ganze Karte · <b>Esc</b> abbrechen · <b>Enter</b> Angriff bestätigen</p>
      <h3>Schwierigkeit</h3>
      <p>Die KI „Schwer“ greift aus mehreren Provinzen gleichzeitig an und bekommt wie in Civilization +20 % Gold und Wissen.</p>
      <h3>Fernschuss und Abriss</h3>
      <p><b>🏹 Langbogenschützen</b> können einmal pro Zug und Provinz auf Feinde schießen, die bis zu 2 Provinzen entfernt stehen – auch wenn sie sich schon bewegt haben.
        Jeder Schütze trifft mit etwa 55 % (Gelände, Größe und Festungen schützen). Pfeile treffen nur leichte Einheiten mit Verteidigung bis 3 – Trolle und Drachen sind zu zäh.<br>
        Mit der Forschung <b>🔨 Abrissarbeiten</b> kannst du unter „Bauen“ eigene Gebäude abreißen und bekommst die Hälfte der Kosten zurück.</p>
      <h3>Truppenlimit</h3>
      <p>In jede Provinz passen nur begrenzt viele Truppen: klein 8, mittel 10, groß 12 – Hauptstädte und Festungen +6. Das gilt beim Ausbilden, Marschieren und Angreifen.</p>
      <h3>Monster</h3>
      <p>${Object.values(K.LAIRS).map(L => `<b>${L.icon} ${L.name}</b>: Schatz +${L.gold} Gold, +${L.sci} Wissen`).join('<br>')}<br>
        Monster bleiben in ihrem Hort. Wer sie besiegt, bekommt den Schatz und die Provinz. Wölfe sind leicht, Trolle zäh (Verteidigung 5), Drachen sehr stark (Verteidigung 16).</p>
      <h3>Spielmodi</h3>
      <p><b>⚔️ Klassisch:</b> Vernichte alle Gegner – oder hab nach 40 Runden die meisten Punkte.<br>
        <b>👑 Thronkampf:</b> In der Mitte liegt die befestigte Thronstadt. Wer sie zu Beginn seines Zuges hält, bekommt eine Krone – 5 Kronen gewinnen.<br>
        <b>⚡ Blitzkrieg:</b> Doppeltes Einkommen, nur 20 Runden.</p>
      <h3>Weltenschmiede</h3>
      <p>Im Hauptmenü gestaltest du eigene Welten: Grundform, Größe, Landanteil, Provinzgröße, Wald, Gebirge, Wüste, Flüsse, Startgold, Rundenzahl und Friedenszeit.
        Tippe in der Vorschau auf eine Provinz, um sie umzubenennen. Gespeicherte Welten findest du bei „Welt“ im Einzelspieler und in deinem Online-Raum.</p>
      <h3>Online-Räume</h3>
      <p>Der Gastgeber wählt Welt und Modus, kann KI-Herrscher hinzufügen und Spieler mit <b>👢 Kicken</b> entfernen (sie können danach wieder beitreten) – in der Lobby und im laufenden Spiel (dann übernimmt die KI das Reich).</p>
      <h3>Bündnisse</h3>
      <p>Verbündete können sich nicht angreifen – bis einer das Bündnis bricht. Alle sehen den Verrat. 🗡️</p>
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
    { title: 'Gebäude bauen', text: 'Gebäude bringen mehr Ertrag. Wechsle zu <b>🔨 Bauen</b>, wähle den <b>Holzfäller</b> und tippe auf eine <b>eigene Waldprovinz</b> 🌲 (gelb markiert). Gehört dir noch kein Wald, erobere zuerst einen.',
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
    const won = st.winner === S.me;
    const canRestart = S.role !== 'guest';
    const ranking = st.players.map((p, i) => ({ i, s: K.score(st, i) })).sort((a, b) => b.s - a.s)
      .map(r => `<li>${pName(r.i)} <span class="tag">${r.s} Punkte</span></li>`).join('');
    setTimeout(() => {
      Sound.play(won ? 'victory' : 'defeat');
      o.innerHTML = `<div class="modal center victory">
        ${S.avatars && S.avatars[st.winner] ? avatarHTML(S.avatars[st.winner], st.players[st.winner].name, st.players[st.winner].color, 'win') : '<svg class="crest" style="width:64px;height:72px"><use href="#crest"/></svg>'}
        <h1>${won ? 'Sieg!' : 'Spielende'}</h1>
        <p>${pName(st.winner)} ${won ? '– du –' : ''} herrscht über das Land!</p>
        <ol class="ranking">${ranking}</ol>
        <div class="row">
          <button id="oMenu">Hauptmenü</button>
          ${canRestart ? '<button id="oAgain" class="primary">Nochmal spielen</button>' : '<span class="tag">Warte auf den Gastgeber…</span>'}
        </div></div>`;
      o.hidden = false;
      $('#oMenu').onclick = toMenu;
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
    else if (a === 'quit') { $('#gameMenu').hidden = true; if (await ask('Spiel verlassen und zum Hauptmenü?', 'Verlassen')) toMenu(); }
  });

  // ---------- Neue Version? ----------
  // version.json liegt neben der Seite; ändert sie sich nach einem Update, bekommt jeder Spieler einen Hinweis.
  async function checkVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.json()).v;
      if (v && v !== APP_VERSION && !S.updDismissed) $('#updateBar').hidden = false;
    } catch { /* offline – egal */ }
  }
  $('#btnReload').onclick = () => location.reload();
  $('#btnUpdLater').onclick = () => { S.updDismissed = true; $('#updateBar').hidden = true; };
  setInterval(checkVersion, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
  setTimeout(checkVersion, 4000);
})();
