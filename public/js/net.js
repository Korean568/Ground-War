// ===== 네트워크 =====
// 두 가지 방식을 같은 인터페이스(Net.send / Net.on)로 제공
//  - ws  : server.js(WebSocket) 로 실행할 때
//  - room: Claude 아티팩트의 실시간 room 기능 (presence 로 상태 동기화)
const Net = {
  ws: null,
  mode: null,          // 'ws' | 'room' | null
  connected: false,
  handlers: {},
  globalLearn: null,
  online: 0,

  connect() {
    if (this.connected) return Promise.resolve(true);
    if (window.NW_OFFLINE || /[?&]mockroom/.test(location.search)) return RoomNet.connect('claude');
    // 깃허브 페이지 / 파일로 열었을 때: P2P(WebRTC) 로비
    if (location.protocol === 'file:' || /github\.io$/.test(location.hostname) || window.NW_P2P || /[?&]p2p/.test(location.search)) return RoomNet.connect('p2p');
    return new Promise(resolve => {
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        if (ok) resolve(true);
        else RoomNet.connect('p2p').then(resolve); // 서버가 없으면 P2P 로
      };
      try {
        const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onopen = () => { if (done) { ws.close(); return; } this.connected = true; this.mode = 'ws'; finish(true); };
        ws.onclose = () => { const was = this.mode === 'ws'; if (was) { this.connected = false; this.ws = null; } finish(false); if (was) this.emit('disconnected', {}); };
        ws.onerror = () => finish(false);
        ws.onmessage = ev => {
          let m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.type === 'hello' || m.type === 'learnData') { this.globalLearn = m.learn; this.globalLearnTdm = m.learnTdm || null; }
          if (m.type === 'online') this.online = m.n;
          this.emit(m.type, m);
        };
        setTimeout(() => finish(false), 2500);
      } catch (e) { finish(false); }
    });
  },
  send(obj) {
    if (this.mode === 'room') { RoomNet.send(obj); return; }
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  },
  on(type, fn) { this.handlers[type] = fn; },
  off(type) { delete this.handlers[type]; },
  emit(type, m) { const h = this.handlers[type]; if (h) h(m); },
};

// ---------- 스냅샷 압축 (presence 4KB 제한에 맞춤) ----------
const RoomCodec = {
  b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); },
  unb64(str) { const s = atob(str), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; },
  chunk(str, n = 900) { const out = []; for (let i = 0; i < str.length; i += n) out.push(str.slice(i, i + n)); return out; },

  // 호스트: sim → presence 용 작은 객체
  encode(sim) {
    const alive = sim.units.filter(u => u.alive);
    const buf = new Uint8Array(alive.length * 14), dv = new DataView(buf.buffer);
    alive.forEach((u, i) => {
      const o = i * 14;
      dv.setUint16(o, u.id & 0xffff);
      dv.setUint8(o + 2, (TYPE_LIST.indexOf(u.type) << 2) | (u.side << 1) | (u.ctrl ? 1 : 0));
      dv.setInt16(o + 3, Math.round(u.x * 100));
      dv.setInt16(o + 5, Math.round(u.z * 100));
      dv.setUint8(o + 7, Math.min(255, Math.round(u.y * 10)));
      dv.setUint16(o + 8, Math.min(65535, Math.ceil(u.hp)));
      let yw = u.yaw % (Math.PI * 2); if (yw < 0) yw += Math.PI * 2;
      dv.setUint8(o + 10, Math.round(yw / (Math.PI * 2) * 256) & 255);
      dv.setUint8(o + 11, u.fc & 255);
      dv.setUint16(o + 12, (u.tid || 0) & 0xffff);
    });
    return {
      t: Math.round(sim.t * 10),
      u: this.chunk(this.b64(buf)),
      s: sim.sides.map((S, i) => [Math.floor(S.money), Math.round(sim.income(i) * 10), S.factories, Math.round(S.infCd * 10), S.stance === 'attack' ? 1 : 0, S.kills, S.lost, S.ctrlId, S.upg.armor]),
      d: (sim.deathLog || []).slice(),
      o: sim.over ? 1 : 0, w: sim.winner,
    };
  },

  // 게스트: presence 객체 → sim.snapshot() 형식 + 이벤트 재구성
  newState() { return { fc: new Map(), lastDeath: 0, overSent: false, first: true }; },
  decode(p, st) {
    const bytes = this.unb64((p.u || []).join('')), dv = new DataView(bytes.buffer);
    const n = Math.floor(bytes.length / 14);
    const sides = (p.s || []).map(a => ({ m: a[0], i: a[1] / 10, f: a[2], c: a[3] / 10, st: a[4] ? 'attack' : 'defend', k: a[5], l: a[6], ctrl: a[7], armor: a[8] || 0 }));
    const units = [], byId = new Map();
    for (let i = 0; i < n; i++) {
      const o = i * 14, ts = dv.getUint8(o + 2);
      const type = TYPE_LIST[ts >> 2], side = (ts >> 1) & 1;
      const T = UNIT_TYPES[type];
      if (!T) continue;
      const armor = sides[side] ? sides[side].armor : 0;
      const u = {
        id: dv.getUint16(o), type, side, ctrl: ts & 1,
        x: dv.getInt16(o + 3) / 100, z: dv.getInt16(o + 5) / 100, y: dv.getUint8(o + 7) / 10,
        hp: dv.getUint16(o + 8), maxHp: Math.round(T.hp * (1 + 0.1 * armor)),
        yaw: dv.getUint8(o + 10) / 256 * Math.PI * 2, fc: dv.getUint8(o + 11), tid: dv.getUint16(o + 12),
      };
      units.push(u); byId.set(u.id, u);
    }
    const ev = [];
    const newFc = new Map();
    for (const u of units) {
      newFc.set(u.id, u.fc);
      const prev = st.fc.get(u.id);
      const T = UNIT_TYPES[u.type];
      if (prev === undefined) { if (!st.first) ev.push({ k: 'spawn', id: u.id, side: u.side, t: u.type }); continue; }
      if (prev === u.fc) continue;
      const a = [u.x, u.y + T.height, u.z];
      const tg = u.tid ? byId.get(u.tid) : null;
      let b;
      if (tg) b = [tg.x, tg.y + UNIT_TYPES[tg.type].height * 0.6, tg.z];
      else b = [u.x + Math.sin(u.yaw) * T.range, u.y + T.height * 0.5, u.z + Math.cos(u.yaw) * T.range];
      ev.push({ k: 'shot', t: u.type, a, b });
      if (T.splash && tg) ev.push({ k: 'boom', x: tg.x, y: tg.y, z: tg.z, s: 1 });
    }
    st.fc = newFc;
    for (const d of (p.d || [])) {
      if (d[0] <= st.lastDeath) continue;
      st.lastDeath = d[0];
      ev.push({ k: 'die', id: d[1], t: TYPE_LIST[d[2]], side: d[3], x: d[4], z: d[5], y: d[6], ks: d[7], by: TYPE_LIST[d[8]] || 'infantry' });
    }
    if (p.o && !st.overSent) { st.overSent = true; ev.push({ k: 'over', w: p.w }); }
    st.first = false;
    return {
      t: (p.t || 0) / 10,
      u: units.map(u => [u.id, TYPE_LIST.indexOf(u.type), u.side, u.x, u.y, u.z, u.hp, u.maxHp, u.yaw, u.ctrl]),
      s: sides.map(s => ({ m: s.m, i: s.i, f: s.f, c: s.c, st: s.st, k: s.k, l: s.l, ctrl: s.ctrl })),
      ev, over: !!p.o, w: p.w,
    };
  },

  // 국기를 작게 줄여서 presence 에 실을 수 있게
  shrinkFlag(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 84; c.height = 56;
        c.getContext('2d').drawImage(img, 0, 0, 84, 56);
        resolve(c.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  },
};

// ---------- 아티팩트 room 매칭/중계 ----------
const RoomNet = {
  room: null, tried: null, myPeer: null, pres: {}, partner: null,
  connect(kind) {
    if (!this.tried) {
      this.tried = (async () => {
        let room = null;
        if (/[?&]mockroom/.test(location.search)) room = MockRoom.create();
        else if (kind === 'p2p') room = await PeerRoom.create();
        else if (window.claude && window.claude.use) { try { room = await window.claude.use('room'); } catch (e) { room = null; } }
        if (!room) { setTimeout(() => { this.tried = null; }, 0); return false; }
        this.kind = kind;
        this.room = room;
        Net.mode = 'room';
        Net.connected = true;
        room.onPeers(ch => this.onPeers(ch.peers), () => { Net.connected = false; Net.emit('disconnected', {}); });
        this.setP({ v: 1, st: 'idle' });
        setInterval(() => this.onPeers(room.peers()), 1000);
        return true;
      })();
    }
    return this.tried;
  },

  setP(patch, retried) {
    Object.assign(this.pres, patch);
    for (const k in patch) if (patch[k] === null) delete this.pres[k];
    if (!this.room) return;
    this.room.presence(patch).catch(e => {
      // 4KB 초과 시 국기 데이터를 비우고 다시 시도
      if (!retried && e && e.code === 'invalid_argument' && this.pres.fl) { this.setP({ fl: null }); this.setP(patch, true); }
    });
  },

  reset() {
    this.partner = null; this.partnerPres = null;
    this.cmdSeq = 0; this.cq = []; this.lastCmd = 0; this.lastIn = null; this.lastSn = null;
    this.flagSeen = false; this.startSeen = false; this.codec = RoomCodec.newState();
  },

  async send(m) {
    switch (m.type) {
      case 'queue':
        this.reset();
        this.setP({ st: 'queue', name: m.name, lv: m.level, with: null, fl: null, ready: null, go: null, sn: null, in: null, cq: null, nat: null, qt: Date.now() });
        this.onPeers(this.room.peers());
        break;
      case 'cancel':
      case 'leave':
        this.reset();
        this.setP({ st: 'idle', with: null, fl: null, ready: null, go: null, sn: null, in: null, cq: null });
        break;
      case 'flag': {
        const small = await RoomCodec.shrinkFlag(m.flag);
        this.setP({ fl: small ? RoomCodec.chunk(small) : null, nat: String(m.nation).slice(0, 20), money: Math.floor(m.money), upg: m.upg, lv: m.level, ready: 1 });
        break;
      }
      case 'start':
        this.setP({ go: 1 + Math.max(0, RTS_THEMES.indexOf(m.theme)) });
        setTimeout(() => { if (this.pres.go) this.setP({ fl: null }); }, 3000);
        break;
      case 'cmd':
        if (m.c.c === 'input') this.setP({ in: m.c.i });
        else {
          this.cq.push({ n: ++this.cmdSeq, c: m.c });
          if (this.cq.length > 12) this.cq.shift();
          this.setP({ cq: this.cq.slice() });
        }
        break;
      case 'snapRoom':
        this.setP({ sn: m.r });
        break;
    }
  },

  onPeers(peers) {
    if (!peers) return;
    const me = peers.find(p => p.isMe && p.sameTab);
    if (me) this.myPeer = me.peer;
    if (Net.online !== peers.length) { Net.online = peers.length; Net.emit('online', {}); }
    const st = this.pres.st;
    if (st === 'queue' || st === 'offer') this.tryMatch(peers);
    if (this.partner) this.partnerUpdate(peers);
  },

  tryMatch(peers) {
    const my = this.myPeer;
    if (!my) return;
    const P = p => p.presence || {};
    // 누군가 나에게 매칭을 제안했으면 수락 (나는 진영 1)
    const offer = peers.find(p => !p.sameTab && P(p).st === 'offer' && P(p).with === my);
    if (offer && this.pres.st === 'queue') {
      this.partner = offer.peer;
      this.setP({ st: 'match', with: offer.peer });
      Net.emit('matched', { type: 'matched', side: 1, opponent: { name: String(P(offer).name || tr('상대', 'Opponent')), level: Number(P(offer).lv) || 1 } });
      return;
    }
    if (this.pres.st === 'queue') {
      const q = peers.filter(p => p.sameTab ? true : (P(p).st === 'queue' && Date.now() - p.updatedAt < 60000)).map(p => p.peer).sort();
      const i = q.indexOf(my);
      if (i >= 0 && i % 2 === 0 && i + 1 < q.length) {
        this.setP({ st: 'offer', with: q[i + 1] });
        this.offerT = Date.now();
      }
      return;
    }
    // 내가 제안한 상태: 상대가 수락했는지 확인 (나는 진영 0, 호스트)
    const t = peers.find(p => p.peer === this.pres.with);
    if (t && P(t).st === 'match' && P(t).with === my) {
      this.partner = t.peer;
      this.setP({ st: 'match' });
      Net.emit('matched', { type: 'matched', side: 0, opponent: { name: String(P(t).name || tr('상대', 'Opponent')), level: Number(P(t).lv) || 1 } });
    } else if (!t || (P(t).st !== 'queue' && P(t).st !== 'match') || Date.now() - this.offerT > 5000) {
      this.setP({ st: 'queue', with: null });
    }
  },

  partnerUpdate(peers) {
    const p = peers.find(x => x.peer === this.partner);
    const pp = p && p.presence;
    if (!p || !pp || pp.st === 'idle' || pp.st === 'queue' || (pp.with && pp.with !== this.myPeer)) {
      this.reset();
      this.setP({ st: 'idle', with: null });
      Net.emit('peerLeft', {});
      return;
    }
    if (pp === this.partnerPres) return;
    this.partnerPres = pp;
    if (pp.ready && pp.fl && !this.flagSeen) {
      this.flagSeen = true;
      Net.emit('flag', { flag: pp.fl.join(''), nation: String(pp.nat || tr('상대국', 'Enemy Nation')), money: Number(pp.money) || 0, upg: pp.upg || {}, level: Number(pp.lv) || 1 });
    }
    if (pp.go && !this.startSeen && this.flagSeen) {
      this.startSeen = true;
      Net.emit('start', { theme: RTS_THEMES[(Number(pp.go) || 1) - 1] });
      setTimeout(() => this.setP({ fl: null }), 3000);
    }
    if (pp.sn && pp.sn !== this.lastSn) {
      this.lastSn = pp.sn;
      try { Net.emit('snap', { s: RoomCodec.decode(pp.sn, this.codec) }); } catch (e) { /* 손상된 데이터 무시 */ }
    }
    if (Array.isArray(pp.cq)) for (const c of pp.cq) {
      if (c && c.n > this.lastCmd) { this.lastCmd = c.n; Net.emit('cmd', { c: c.c }); }
    }
    if (pp.in && pp.in !== this.lastIn) { this.lastIn = pp.in; Net.emit('cmd', { c: { c: 'input', i: pp.in } }); }
  },
};

// ---------- 서버(ws) 버전의 presence 방 (팀 모드용) ----------
const WsRoom = {
  list: [], me: null, ready: false,
  init() {
    if (this.ready) return;
    this.ready = true;
    Net.on('peers', m => {
      this.me = m.me;
      const now = Date.now();
      this.list = (m.peers || []).map(p => ({ peer: p.peer, presence: p.presence || {}, isMe: p.peer === m.me, sameTab: p.peer === m.me, updatedAt: now }));
    });
  },
  presence(patch) { Net.send({ type: 'pres', patch }); },
  peers() { return this.list; },
};

// ---------- P2P 로비 (깃허브 페이지용, PeerJS/WebRTC) ----------
// 먼저 들어온 사람이 고정 ID 의 "허브"가 되어 모두의 presence 를 중계.
// 허브가 나가면 남은 사람 중 하나가 허브를 이어받음.
const PeerRoom = {
  LOBBY: 'kukga-jeonjaeng-lobby-v1',
  create() {
    return new Promise(resolve => {
      if (!window.Peer) return resolve(null);
      const R = { me: null, mine: {}, list: [], listeners: [], conn: null, hub: null, hubConns: new Map(), hubPres: new Map(), dirty: false, objs: new Map(), changed: new Map() };
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      setTimeout(() => finish(null), 10000);
      const opts = { debug: 0 };
      let client;
      try { client = new Peer(opts); } catch (e) { return resolve(null); }
      client.on('open', id => { R.me = id; tryHub(); });
      client.on('error', e => {
        if (!R.me) { finish(null); return; }
        if (e && e.type === 'peer-unavailable') setTimeout(tryHub, 500 + Math.random() * 1500); // 허브가 없음 → 내가 허브 시도
      });
      client.on('disconnected', () => { try { client.reconnect(); } catch (e) { /* 무시 */ } });

      function tryHub() {
        if (R.hub && !R.hub.destroyed) { connectHub(); return; }
        let settled = false;
        let h;
        try { h = new Peer(PeerRoom.LOBBY, opts); } catch (e) { connectHub(); return; }
        h.on('open', () => { if (settled) return; settled = true; R.hub = h; setupHub(h); connectHub(); });
        h.on('error', e => {
          if (settled) return;
          settled = true;
          try { h.destroy(); } catch (_) { /* 무시 */ }
          connectHub(); // 이미 허브가 있음
        });
        setTimeout(() => { if (!settled) { settled = true; try { h.destroy(); } catch (_) { /* 무시 */ } connectHub(); } }, 5000);
      }
      function setupHub(h) {
        h.on('connection', c => {
          c.on('open', () => { R.hubConns.set(c.peer, c); });
          c.on('data', d => {
            if (!d || d.t !== 'p') return;
            const cur = d.full ? {} : Object.assign({}, R.hubPres.get(c.peer) || {});
            const patch = d.patch || {};
            for (const k in patch) { if (patch[k] === null) delete cur[k]; else cur[k] = patch[k]; }
            R.hubPres.set(c.peer, cur);
            R.dirty = true;
          });
          c.on('close', () => { R.hubPres.delete(c.peer); R.hubConns.delete(c.peer); R.dirty = true; });
        });
        setInterval(() => {
          if (!R.dirty) return;
          R.dirty = false;
          const peers = [...R.hubPres].map(([peer, presence]) => ({ peer, presence }));
          for (const c of R.hubConns.values()) if (c.open) { try { c.send({ t: 'peers', peers }); } catch (e) { /* 무시 */ } }
        }, 50);
      }
      function connectHub() {
        if (R.conn && R.conn.open) return;
        const c = client.connect(PeerRoom.LOBBY, { reliable: true });
        R.conn = c;
        const to = setTimeout(() => { if (!c.open) { try { c.close(); } catch (e) { /* 무시 */ } setTimeout(tryHub, Math.random() * 1500); } }, 6000);
        c.on('open', () => { clearTimeout(to); c.send({ t: 'p', patch: R.mine, full: true }); finish(api); });
        c.on('data', d => { if (d && d.t === 'peers') onList(d.peers || []); });
        c.on('close', () => { if (R.conn === c) { R.conn = null; setTimeout(tryHub, 300 + Math.random() * 1500); } });
      }
      function onList(peers) {
        const now = Date.now(), seen = new Set();
        R.list = peers.map(p => {
          seen.add(p.peer);
          const js = JSON.stringify(p.presence || {});
          let o = R.objs.get(p.peer);
          if (!o || o.js !== js) { o = { js, obj: Object.freeze(p.presence || {}) }; R.objs.set(p.peer, o); R.changed.set(p.peer, now); }
          const me = p.peer === R.me;
          return { peer: p.peer, by: null, isMe: me, sameTab: me, kind: 'viewer', guest: false, presence: o.obj, updatedAt: R.changed.get(p.peer) || now };
        });
        for (const k of [...R.objs.keys()]) if (!seen.has(k)) { R.objs.delete(k); R.changed.delete(k); }
        const ch = { peers: R.list, joined: [], left: [], updated: [] };
        R.listeners.forEach(f => { try { f(ch); } catch (e) { /* 무시 */ } });
      }
      const api = {
        presence(patch) {
          const n = Object.assign({}, R.mine, patch);
          for (const k in patch) if (patch[k] === null) delete n[k];
          if (JSON.stringify(n).length > 4096) return Promise.reject({ code: 'invalid_argument', message: 'over 4KiB' });
          R.mine = n;
          if (R.conn && R.conn.open) { try { R.conn.send({ t: 'p', patch }); } catch (e) { /* 무시 */ } }
          return Promise.resolve();
        },
        peers() { return R.list; },
        onPeers(fn) { R.listeners.push(fn); setTimeout(() => fn({ peers: R.list, joined: [], left: [], updated: [] }), 0); return () => {}; },
      };
      window.addEventListener('beforeunload', () => { try { client.destroy(); if (R.hub) R.hub.destroy(); } catch (e) { /* 무시 */ } });
    });
  },
};

// ---------- 로컬 테스트용 가짜 room (?mockroom, 같은 브라우저 탭끼리) ----------
const MockRoom = {
  create() {
    const ch = new BroadcastChannel('nw-mockroom');
    const id = Math.random().toString(36).slice(2, 10);
    const peers = new Map();
    let mine = {};
    const listeners = [];
    const snapshot = () => {
      const now = Date.now();
      for (const [k, v] of peers) if (now - v.seen > 4000) peers.delete(k);
      const arr = [{ peer: id, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: mine, updatedAt: now }];
      for (const [k, v] of peers) arr.push({ peer: k, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: v.presence, updatedAt: v.changed });
      return arr;
    };
    const fire = () => { const p = snapshot(); listeners.forEach(f => f({ peers: p, joined: [], left: [], updated: [] })); };
    ch.onmessage = e => {
      const { from, presence } = e.data;
      const old = peers.get(from);
      const same = old && JSON.stringify(old.presence) === JSON.stringify(presence);
      peers.set(from, { presence: same ? old.presence : Object.freeze(presence), seen: Date.now(), changed: same ? old.changed : Date.now() });
      if (!same) fire();
    };
    setInterval(() => ch.postMessage({ from: id, presence: mine }), 1000);
    return {
      presence(patch) {
        const n = Object.assign({}, mine, patch);
        for (const k in patch) if (patch[k] === null) delete n[k];
        if (JSON.stringify(n).length > 4096) return Promise.reject({ code: 'invalid_argument', message: 'over 4KiB' });
        mine = Object.freeze(n);
        ch.postMessage({ from: id, presence: mine });
        return Promise.resolve();
      },
      peers: snapshot,
      onPeers(fn) { listeners.push(fn); setTimeout(fire, 0); return () => {}; },
    };
  },
};
