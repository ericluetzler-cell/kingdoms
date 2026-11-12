/* Kingdoms – Online-Speicher für Konten, Freunde, Chat und Einladungen.
   Treiber: Firebase (echte Konten, siehe firebase-config.js) oder – nur zum Testen mit ?mockcloud in der Adresse –
   ein nachgebauter Server im Browser (localStorage, mehrere Tabs = mehrere Spieler).
   Datenmodell (Firestore):
     users/{uid}                 Profil: name, nameLower, avatar, color, realm, cap, bots, eq, pass, acc
     presence/{uid}              { seen, st }  – klein gehalten, weil es sich oft ändert
     usernames/{name klein}      { uid, name } – damit jeder Spielername nur einmal vorkommt
     users/{uid}/requests/{von}  Freundschaftsanfragen
     users/{uid}/friends/{uid2}  Freunde (bei beiden eingetragen)
     users/{uid}/invites/{id}    Einladungen in einen Raum
     chats/{uidA_uidB}           members, last, r_<uid> (gelesen bis)
     chats/{..}/messages/{id}    { from, text, at } */
(() => {
  'use strict';
  const FB_V = '11.10.0';
  const MOCK = new URLSearchParams(location.search).has('mockcloud');
  const CFG = window.KINGDOMS_FIREBASE;
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });

  // ---------- Treiber: Firebase ----------
  async function firebaseDriver(cfg) {
    const base = `https://www.gstatic.com/firebasejs/${FB_V}/`;
    const [A, U, F] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
    const app = A.initializeApp(cfg);
    const auth = U.getAuth(app);
    try { auth.languageCode = 'de'; } catch { /* egal */ }
    const db = F.getFirestore(app);
    const ref = p => F.doc(db, p);
    const opt = m => (m ? { merge: true } : {});
    const data = s => (s.exists() ? s.data() : null);
    const user = u => (u ? { uid: u.uid, email: u.email || '', google: (u.providerData || []).some(p => p.providerId === 'google.com') } : null);
    try { await U.getRedirectResult(auth); } catch (e) { console.warn('Google-Anmeldung', e); }
    return {
      kind: 'firebase',
      auth: {
        onChange: cb => U.onAuthStateChanged(auth, u => cb(user(u))),
        signUp: (e, p) => U.createUserWithEmailAndPassword(auth, e, p),
        signIn: (e, p) => U.signInWithEmailAndPassword(auth, e, p),
        async google() {
          const prov = new U.GoogleAuthProvider();
          prov.setCustomParameters({ prompt: 'select_account' });
          try { await U.signInWithPopup(auth, prov); }
          catch (e) {
            if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) await U.signInWithRedirect(auth, prov);
            else throw e;
          }
        },
        reset: e => U.sendPasswordResetEmail(auth, e),
        signOut: () => U.signOut(auth),
      },
      get: async p => data(await F.getDoc(ref(p))),
      set: (p, d, m) => F.setDoc(ref(p), d, opt(m)),
      update: (p, d) => F.updateDoc(ref(p), d), // ersetzt die genannten Felder ganz (kein tiefes Zusammenführen)
      del: p => F.deleteDoc(ref(p)),
      batch(ops) {
        const b = F.writeBatch(db);
        for (const o of ops) { if (o.del) b.delete(ref(o.del)); else b.set(ref(o.set), o.data, opt(o.merge)); }
        return b.commit();
      },
      // „gibt es nicht“ nur glauben, wenn der Server es sagt – offline käme sonst ein leeres Profil an
      watch: (p, cb) => F.onSnapshot(ref(p), s => { if (!s.exists() && s.metadata.fromCache) return; cb(data(s)); }, e => console.warn('Kingdoms-Cloud', p, e)),
      watchCol(cp, q, cb) {
        const cons = [];
        if (q.contains) cons.push(F.where(q.contains[0], 'array-contains', q.contains[1]));
        if (q.order) cons.push(F.orderBy(q.order[0], q.order[1] || 'asc'));
        if (q.limit) cons.push(F.limit(q.limit));
        return F.onSnapshot(F.query(F.collection(db, cp), ...cons), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => { console.warn('Kingdoms-Cloud', cp, e); cb([]); });
      },
      txn: fn => F.runTransaction(db, t => fn({
        get: async p => data(await t.get(ref(p))),
        set: (p, d, m) => t.set(ref(p), d, opt(m)),
        del: p => t.delete(ref(p)),
      })),
      newId: () => F.doc(F.collection(db, 'x')).id,
    };
  }

  // ---------- Treiber: Test-Server im Browser (nur mit ?mockcloud) ----------
  function mockDriver() {
    const KEY = 'kmock-db', AKEY = 'kmock-auth', SKEY = 'kmock-session';
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
    const subs = new Set();
    const ping = () => setTimeout(() => subs.forEach(f => f()), 0);
    window.addEventListener('storage', e => { if (e.key === KEY) ping(); });
    const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
    const merge = (a, b) => { const o = { ...(isObj(a) ? a : {}) }; for (const k in b) o[k] = isObj(b[k]) && isObj(o[k]) ? merge(o[k], b[k]) : b[k]; return o; };
    const clone = x => (x == null ? null : JSON.parse(JSON.stringify(x)));
    function apply(ops) {
      const db = load();
      for (const o of ops) { if (o.del) delete db[o.del]; else db[o.set] = o.merge ? merge(db[o.set], clone(o.data)) : clone(o.data); }
      localStorage.setItem(KEY, JSON.stringify(db));
      ping();
    }
    function sub(read, cb) {
      let last;
      const run = () => { const v = JSON.stringify(read(load()) ?? null); if (v !== last) { last = v; cb(JSON.parse(v)); } };
      subs.add(run); setTimeout(run, 0);
      return () => subs.delete(run);
    }
    const users = () => { try { return JSON.parse(localStorage.getItem(AKEY) || '{}'); } catch { return {}; } };
    let user = null, authCb = null;
    try { user = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch { /* egal */ }
    const setUser = u => {
      user = u;
      try { if (u) sessionStorage.setItem(SKEY, JSON.stringify(u)); else sessionStorage.removeItem(SKEY); } catch { /* egal */ }
      if (authCb) setTimeout(() => authCb(u), 0);
    };
    const newUid = () => 'u' + Math.random().toString(36).slice(2, 12);
    const delay = v => new Promise(r => setTimeout(() => r(v), 60));
    return {
      kind: 'mock',
      auth: {
        onChange: cb => { authCb = cb; setTimeout(() => cb(user), 0); return () => { authCb = null; }; },
        async signUp(e, p) {
          e = String(e).trim().toLowerCase();
          const us = users();
          if (!/^\S+@\S+\.\S+$/.test(e)) throw err('auth/invalid-email');
          if (us[e]) throw err('auth/email-already-in-use');
          if (String(p).length < 6) throw err('auth/weak-password');
          us[e] = { pw: p, uid: newUid() };
          localStorage.setItem(AKEY, JSON.stringify(us));
          await delay(); setUser({ uid: us[e].uid, email: e });
        },
        async signIn(e, p) {
          e = String(e).trim().toLowerCase();
          const u = users()[e];
          if (!u || u.pw !== p) throw err('auth/invalid-credential');
          await delay(); setUser({ uid: u.uid, email: e });
        },
        async google(hint) {
          const e = (hint && /\S+@\S+/.test(hint) ? hint : 'google-test@example.com').trim().toLowerCase();
          const us = users();
          if (!us[e]) { us[e] = { pw: Math.random().toString(36), uid: newUid(), google: true }; localStorage.setItem(AKEY, JSON.stringify(us)); }
          await delay(); setUser({ uid: us[e].uid, email: e, google: true });
        },
        async reset(e) { if (!users()[String(e).trim().toLowerCase()]) throw err('auth/user-not-found'); },
        async signOut() { setUser(null); },
      },
      get: async p => delay(clone(load()[p] ?? null)),
      set: async (p, d, m) => apply([{ set: p, data: d, merge: m }]),
      async update(p, d) { const cur = load()[p]; if (!cur) throw err('not-found'); apply([{ set: p, data: { ...cur, ...clone(d) } }]); },
      del: async p => apply([{ del: p }]),
      batch: async ops => apply(ops),
      watch: (p, cb) => sub(db => db[p], cb),
      watchCol: (cp, q, cb) => sub(db => {
        const pre = cp + '/';
        let list = Object.keys(db).filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => ({ id: k.slice(pre.length), ...db[k] }));
        if (q.contains) list = list.filter(d => Array.isArray(d[q.contains[0]]) && d[q.contains[0]].includes(q.contains[1]));
        if (q.order) { const [f, dir] = q.order; list.sort((a, b) => ((a[f] > b[f]) - (a[f] < b[f])) * (dir === 'desc' ? -1 : 1)); }
        if (q.limit) list = list.slice(0, q.limit);
        return list;
      }, cb),
      async txn(fn) {
        const db = load(), ops = [];
        const r = await fn({ get: async p => clone(db[p] ?? null), set: (p, d, m) => ops.push({ set: p, data: d, merge: m }), del: p => ops.push({ del: p }) });
        apply(ops);
        return r;
      },
      newId: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    };
  }

  // ---------- Gemeinsame Logik ----------
  const ONLINE_MS = 5 * 60e3, BEAT_MS = 2 * 60e3, INVITE_MS = 30 * 60e3;
  const C = {
    enabled: !!(CFG || MOCK), mock: MOCK,
    ready: false, failed: '', user: null, profile: undefined,
    friends: new Map(),   // uid -> { uid, at, prof, pres }
    requests: [], invites: [], chats: new Map(),
  };
  let D = null, unsubs = [], friendSubs = new Map(), status = 'menu', beat = 0;
  const handlers = {};
  C.on = (ev, fn) => { (handlers[ev] = handlers[ev] || new Set()).add(fn); return () => handlers[ev].delete(fn); };
  const emit = (ev, x) => (handlers[ev] || []).forEach(fn => { try { fn(x); } catch (e) { console.error(e); } });
  const me = () => C.user && C.user.uid;
  const need = () => { if (!D || !me()) throw err('not-signed-in', 'Bitte zuerst anmelden.'); };
  const cid = other => [me(), other].sort().join('_');
  C.cleanName = n => String(n || '').replace(/[/\\.#$[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

  C.start = async () => {
    if (!C.enabled || D) return;
    try { D = MOCK ? mockDriver() : await firebaseDriver(CFG); }
    catch (e) { console.error(e); C.failed = 'Der Konto-Server ist gerade nicht erreichbar.'; emit('auth', null); return; }
    C.ready = true;
    D.auth.onChange(u => {
      stopAll();
      C.user = u; C.profile = u ? undefined : null;
      emit('auth', u);
      if (u) startAll();
    });
  };

  function stopAll() {
    unsubs.forEach(f => { try { f(); } catch { /* egal */ } });
    unsubs = [];
    friendSubs.forEach(s => s.forEach(f => f()));
    friendSubs = new Map();
    clearInterval(beat);
    C.friends = new Map(); C.requests = []; C.invites = []; C.chats = new Map();
  }

  function startAll() {
    const uid = me();
    unsubs.push(D.watch('users/' + uid, p => { C.profile = p; emit('profile', p); }));
    unsubs.push(D.watchCol(`users/${uid}/friends`, {}, list => { syncFriends(list); emit('friends'); }));
    unsubs.push(D.watchCol(`users/${uid}/requests`, {}, list => { C.requests = list.sort((a, b) => b.at - a.at); emit('requests'); }));
    unsubs.push(D.watchCol(`users/${uid}/invites`, {}, list => {
      const now = Date.now();
      for (const i of list) if (now - (i.at || 0) > INVITE_MS) D.del(`users/${uid}/invites/${i.id}`).catch(() => {});
      C.invites = list.filter(i => now - (i.at || 0) <= INVITE_MS).sort((a, b) => b.at - a.at);
      emit('invites');
    }));
    unsubs.push(D.watchCol('chats', { contains: ['members', uid] }, list => {
      C.chats = new Map(list.map(c => [c.members.find(m => m !== uid) || uid, c]));
      emit('chats');
    }));
    heartbeat();
    beat = setInterval(heartbeat, BEAT_MS);
  }

  function syncFriends(list) {
    const ids = new Set(list.map(f => f.id));
    for (const [uid, s] of friendSubs) if (!ids.has(uid)) { s.forEach(f => f()); friendSubs.delete(uid); C.friends.delete(uid); }
    for (const f of list) {
      const cur = C.friends.get(f.id) || { uid: f.id, prof: null, pres: null };
      cur.at = f.at;
      C.friends.set(f.id, cur);
      if (!friendSubs.has(f.id)) {
        friendSubs.set(f.id, [
          D.watch('users/' + f.id, p => { const x = C.friends.get(f.id); if (x) { x.prof = p; emit('friends'); } }),
          D.watch('presence/' + f.id, p => { const x = C.friends.get(f.id); if (x) { x.pres = p; emit('friends'); } }),
        ]);
      }
    }
  }

  // ---------- Anwesenheit ----------
  function heartbeat() {
    if (!D || !me() || document.hidden) return;
    D.set('presence/' + me(), { seen: Date.now(), st: status }).catch(() => {});
  }
  C.setStatus = st => { if (st === status) return; status = st; heartbeat(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) heartbeat(); });
  window.addEventListener('pagehide', () => { if (D && me()) D.set('presence/' + me(), { seen: Date.now(), st: 'off' }).catch(() => {}); });
  // 'menu' | 'lobby' | 'game' | 'off' (null = offline)
  C.presenceOf = f => {
    const p = f && f.pres;
    if (!p || p.st === 'off' || Date.now() - (p.seen || 0) > ONLINE_MS) return null;
    return p.st || 'menu';
  };

  // ---------- Anmeldung ----------
  C.signUp = (e, p) => D.auth.signUp(String(e).trim(), p);
  C.signIn = (e, p) => D.auth.signIn(String(e).trim(), p);
  C.google = hint => D.auth.google(hint);
  C.resetPassword = e => D.auth.reset(String(e).trim());
  C.signOut = async () => {
    if (D && me()) await D.set('presence/' + me(), { seen: Date.now(), st: 'off' }).catch(() => {});
    return D.auth.signOut();
  };

  // ---------- Profil ----------
  // Felder ganz ersetzen (so verschwinden auch abgelegte Belohnungen); gibt es das Profil noch nicht, wird es angelegt
  C.saveProfile = async patch => {
    need();
    try { await D.update('users/' + me(), patch); }
    catch (e) { if (e && e.code === 'not-found') return D.set('users/' + me(), patch, true); throw e; }
  };
  C.getUser = uid => D.get('users/' + uid);
  // Spielernamen gibt es nur einmal; der alte Name wird frei
  C.claimName = async name => {
    need();
    const nm = C.cleanName(name), low = nm.toLowerCase(), uid = me();
    if (nm.length < 2) throw err('name-short', 'Der Name braucht mindestens 2 Zeichen.');
    await D.txn(async t => {
      const cur = await t.get('usernames/' + low);
      const prof = await t.get('users/' + uid);
      const old = prof && prof.nameLower && prof.nameLower !== low ? prof.nameLower : null;
      const oldDoc = old ? await t.get('usernames/' + old) : null;
      if (cur && cur.uid !== uid) throw err('name-taken', `„${nm}“ ist schon vergeben – nimm einen anderen Namen.`);
      t.set('usernames/' + low, { uid, name: nm });
      if (oldDoc && oldDoc.uid === uid) t.del('usernames/' + old);
      t.set('users/' + uid, { name: nm, nameLower: low }, true);
    });
    return nm;
  };
  C.findUser = async name => {
    need();
    const u = await D.get('usernames/' + C.cleanName(name).toLowerCase());
    if (!u) return null;
    const p = await D.get('users/' + u.uid);
    return { uid: u.uid, ...(p || { name: u.name }) };
  };

  // ---------- Freunde ----------
  C.request = async uid => {
    need();
    if (uid === me()) throw err('self', 'Das bist du selbst. 🙂');
    if (C.friends.has(uid)) throw err('already', 'Ihr seid schon befreundet.');
    if (C.requests.some(r => r.id === uid)) return C.accept(uid); // hat mich schon angefragt → gleich annehmen
    await D.set(`users/${uid}/requests/${me()}`, { name: (C.profile && C.profile.name) || '', at: Date.now() });
    return 'sent';
  };
  C.accept = async from => {
    need();
    const at = Date.now();
    await D.batch([
      { set: `users/${me()}/friends/${from}`, data: { at } },
      { set: `users/${from}/friends/${me()}`, data: { at } },
      { del: `users/${me()}/requests/${from}` },
    ]);
    return 'friends';
  };
  C.decline = from => { need(); return D.del(`users/${me()}/requests/${from}`); };
  C.unfriend = uid => { need(); return D.batch([{ del: `users/${me()}/friends/${uid}` }, { del: `users/${uid}/friends/${me()}` }]); };

  // ---------- Einladungen ----------
  C.invite = (uid, code) => {
    need();
    return D.set(`users/${uid}/invites/${D.newId()}`, { from: me(), name: (C.profile && C.profile.name) || '', code: String(code), at: Date.now() });
  };
  C.dropInvite = id => { need(); return D.del(`users/${me()}/invites/${id}`); };

  // ---------- Chat ----------
  C.send = (uid, text) => {
    need();
    text = String(text || '').trim().slice(0, 500);
    if (!text) return Promise.resolve();
    const at = Date.now(), id = cid(uid), members = [me(), uid].sort();
    return D.batch([
      { set: 'chats/' + id, data: { members, last: { from: me(), text: text.slice(0, 80), at }, ['r_' + me()]: at }, merge: true },
      { set: `chats/${id}/messages/${D.newId()}`, data: { from: me(), text, at } },
    ]);
  };
  C.watchMessages = (uid, cb) => { need(); return D.watchCol(`chats/${cid(uid)}/messages`, { order: ['at', 'desc'], limit: 60 }, list => cb(list.reverse())); };
  C.markRead = uid => {
    if (!me()) return;
    const c = C.chats.get(uid);
    if (!c || !c.last || (c['r_' + me()] || 0) >= c.last.at) return;
    D.set('chats/' + cid(uid), { members: [me(), uid].sort(), ['r_' + me()]: Date.now() }, true).catch(() => {});
  };
  C.unread = uid => {
    const c = C.chats.get(uid);
    return !!(c && c.last && c.last.from !== me() && c.last.at > (c['r_' + me()] || 0));
  };

  // verständliche Fehlermeldungen
  C.why = e => {
    const code = (e && e.code) || '';
    const M = {
      'auth/email-already-in-use': 'Für diese E-Mail gibt es schon ein Konto – melde dich an.',
      'auth/invalid-email': 'Diese E-Mail-Adresse stimmt nicht.',
      'auth/missing-email': 'Bitte gib deine E-Mail-Adresse ein.',
      'auth/weak-password': 'Das Passwort braucht mindestens 6 Zeichen.',
      'auth/missing-password': 'Bitte gib ein Passwort ein.',
      'auth/invalid-credential': 'E-Mail oder Passwort stimmt nicht.',
      'auth/wrong-password': 'E-Mail oder Passwort stimmt nicht.',
      'auth/user-not-found': 'Zu dieser E-Mail gibt es kein Konto.',
      'auth/too-many-requests': 'Zu viele Versuche – warte einen Moment.',
      'auth/popup-closed-by-user': 'Anmeldung abgebrochen.',
      'auth/cancelled-popup-request': 'Anmeldung abgebrochen.',
      'auth/network-request-failed': 'Keine Verbindung zum Server – Internet prüfen.',
      'auth/unauthorized-domain': 'Diese Seite ist in Firebase noch nicht freigegeben (Authentication → Einstellungen → Autorisierte Domains).',
      'auth/operation-not-allowed': 'Diese Anmeldeart ist in Firebase noch nicht eingeschaltet.',
      'permission-denied': 'Keine Berechtigung – sind die Firestore-Regeln eingetragen?',
      unavailable: 'Der Server ist gerade nicht erreichbar.',
    };
    return M[code] || (e && e.message) || 'Das hat nicht geklappt.';
  };

  window.Cloud = C;
})();
