// ===== 팀 모드 클라이언트: 로비, 조작, 네트워크, HUD =====
// 네트워크는 presence(상태 공유) 방식: 호스트는 'th', 참가자는 'tm' 필드를 씀
const TdmNetAdapter = {
  get() {
    if (Net.mode === 'room' && RoomNet.room) return {
      setP: p => RoomNet.setP(p), peers: () => RoomNet.room.peers(), me: () => RoomNet.myPeer,
    };
    if (Net.mode === 'ws') { WsRoom.init(); return { setP: p => WsRoom.presence(p), peers: () => WsRoom.peers(), me: () => WsRoom.me }; }
    return null;
  },
};

const TdmGame = {
  active: false, lobby: false,
  keys: {}, fireHeld: false, aimHeld: false, boardOn: false,

  init() {
    $('btn-tdm').onclick = () => this.open('tdm');
    $('btn-koth').onclick = () => this.open('koth');
    $('btn-tl-start').onclick = () => { this.startNow = true; };
    $('btn-tl-leave').onclick = () => this.leaveLobby();
    const pick = $('t-wpn-pick');
    TDM.WPN.forEach((k, i) => {
      const W = TDM.WEAPONS[k];
      const b = document.createElement('button');
      b.className = 'wpn-card'; b.id = 'wp-' + k;
      b.innerHTML = `<kbd>${i + 1}</kbd><span class="ic">${W.icon}</span><b>${W.name}</b><small>${W.desc}</small>`;
      b.onclick = () => this.chooseWeapon(k);
      pick.appendChild(b);
    });
    // 저격 조준경 화면
    const sc = document.createElement('div');
    sc.id = 't-scope'; sc.className = 'hidden';
    sc.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at center, transparent 0, transparent 31vmin, rgba(0,0,0,0.95) 31.5vmin);';
    sc.innerHTML = '<div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(0,0,0,0.85)"></div><div style="position:absolute;top:50%;left:0;right:0;height:1px;background:rgba(0,0,0,0.85)"></div><div style="position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#e33"></div>';
    $('tdm-hud').prepend(sc);
    this.scopeEl = sc;
    const cv = App.r.canvas;
    cv.addEventListener('mousedown', e => {
      if (!this.active || !this.alive()) return;
      if (!App.pointerLocked && !App.noLock) { App.lockPointer(); return; }
      if (e.button === 0) { this.fireHeld = true; this.firePressed = true; }
      if (e.button === 2) this.aimHeld = true;
    });
    window.addEventListener('mouseup', e => { if (e.button === 0) this.fireHeld = false; if (e.button === 2) this.aimHeld = false; });
    window.addEventListener('mousemove', e => {
      if (!this.active || !(App.pointerLocked || App.noLock)) return;
      const sens = this.aimHeld ? 0.0012 : 0.0025;
      this.yaw -= e.movementX * sens;
      this.pitch = Math.max(-0.75, Math.min(0.6, this.pitch - e.movementY * sens));
    });
    window.addEventListener('keydown', e => {
      if (!this.active || e.target.tagName === 'INPUT') return;
      this.keys[e.code] = true;
      if (e.code.startsWith('Digit')) { const k = TDM.WPN[parseInt(e.code.slice(5), 10) - 1]; if (k) this.chooseWeapon(k); }
      if (e.code === 'KeyR') this.reload();
      if (e.code === 'KeyG') this.grenade();
      if (e.code === 'Tab') { this.boardOn = true; e.preventDefault(); }
      if (e.code === 'Escape' && !App.pointerLocked) $('screen-pause').classList.toggle('hidden');
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; if (e.code === 'Tab') this.boardOn = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.fireHeld = false; this.aimHeld = false; });
  },

  // ================= 로비 =================
  async open(mode) {
    this.mode = mode; this.role = null; this.hostPeer = null; this.startNow = false; this.lobby = true;
    App.stopMatching && App.stopMatching(false);
    UI.show('screen-tdm-lobby');
    $('tl-title').textContent = mode === 'koth' ? tr('⛰️ 언덕 위의 왕', '⛰️ King of the Hill') : tr('🎯 팀 데스매치', '🎯 Team Deathmatch');
    $('tl-sub').textContent = tr('연결 중...', 'Connecting...');
    $('tl-players').innerHTML = ''; $('tl-count').textContent = ''; $('tl-analysis').innerHTML = '';
    $('btn-tl-start').classList.add('hidden');
    const ok = await Net.connect();
    if (!this.lobby) return;
    this.net = ok ? TdmNetAdapter.get() : null;
    if (!this.net) {
      $('tl-sub').textContent = tr('온라인 상대가 없어 패턴을 학습한 AI들과 싸웁니다', 'No players online. You will fight AI that learned player patterns');
      setTimeout(() => { if (this.lobby) this.hostStart([]); }, 1200);
      return;
    }
    this.net.setP({ tm: { mode, st: 'look', name: Profile.data.name, pat: TdmLearn.summary() } });
    clearInterval(this.lobbyTimer);
    this.lobbyTimer = setInterval(() => this.lobbyTick(), 200);
  },
  leaveLobby() {
    this.lobby = false;
    clearInterval(this.lobbyTimer);
    if (this.net) this.net.setP({ tm: null, th: null });
    App.showMenu();
  },
  lobbyTick() {
    if (!this.lobby) return;
    const peers = this.net.peers(), my = this.net.me();
    if (!my) {
      // 방 정보를 못 받으면 3초 후 혼자(AI와) 시작
      this.noPeerT = (this.noPeerT || 0) + 1;
      if (this.noPeerT > 15) { this.noPeerT = 0; this.net = null; $('tl-sub').textContent = tr('연결된 상대가 없어 AI들과 싸웁니다', 'Nobody connected. Fighting AI soldiers'); this.hostStart([]); }
      return;
    }
    this.noPeerT = 0;
    const P = p => p.presence || {};
    const hosts = peers.filter(p => !p.sameTab && P(p).th && P(p).th.mode === this.mode && P(p).th.ph !== 'end');
    if (!this.role) {
      const h = hosts.sort((a, b) => (a.peer < b.peer ? -1 : 1))[0];
      if (h) { this.role = 'guest'; this.hostPeer = h.peer; }
      else { this.role = 'host'; this.lobbyEnd = Date.now() + 20000; }
    }
    if (this.role === 'host') {
      // 동시에 방을 연 사람이 있으면 번호가 작은 쪽으로 합침
      const lower = hosts.find(h => P(h).th.ph === 'lobby' && h.peer < my);
      if (lower) { this.role = 'guest'; this.hostPeer = lower.peer; this.net.setP({ th: null }); return; }
      const joiners = peers.filter(p => !p.sameTab && P(p).tm && P(p).tm.g === my);
      const left = Math.max(0, Math.ceil((this.lobbyEnd - Date.now()) / 1000));
      this.net.setP({ th: { mode: this.mode, ph: 'lobby', left, pl: [String(Profile.data.name).slice(0, 14) + tr(' (방장)', ' (host)'), ...joiners.map(j => String(P(j).tm.name || '?').slice(0, 14))] } });
      $('tl-sub').textContent = tr('방장입니다. 다른 플레이어를 기다리는 중... (빈 자리는 학습형 AI가 채웁니다)', 'You are the host. Waiting for players... (AI fills empty slots)');
      $('tl-count').textContent = tr(`${left}초 후 시작`, `Starting in ${left}s`);
      this.renderLobbyPlayers([Profile.data.name + tr(' (나)', ' (you)'), ...joiners.map(j => P(j).tm.name)]);
      $('btn-tl-start').classList.remove('hidden');
      if (left <= 0 || this.startNow) this.hostStart(joiners);
    } else {
      const h = peers.find(p => p.peer === this.hostPeer);
      const th = h && P(h).th;
      if (!th || th.mode !== this.mode) { this.role = null; this.net.setP({ tm: { mode: this.mode, st: 'look', name: Profile.data.name, pat: TdmLearn.summary() } }); return; }
      this.net.setP({ tm: { mode: this.mode, st: 'join', g: this.hostPeer, name: Profile.data.name, wpn: this.wpn || 'rifle', pat: TdmLearn.summary() } });
      $('btn-tl-start').classList.add('hidden');
      if (th.ph === 'lobby') {
        $('tl-sub').textContent = tr('방에 참가했습니다. 방장이 곧 시작합니다', 'Joined the room. The host will start soon');
        $('tl-count').textContent = tr(`${th.left}초 후 시작`, `Starting in ${th.left}s`);
        this.renderLobbyPlayers([...(th.pl || [])]);
      } else if (th.ph === 'play') {
        $('tl-sub').textContent = tr('진행 중인 경기에 합류하는 중...', 'Joining the match in progress...');
        const mine = (th.hn || []).find(a => a[1] === my);
        if (mine) this.guestStart(th, mine[0]);
      }
    }
  },
  renderLobbyPlayers(names) {
    $('tl-players').innerHTML = names.map(n => `<div class="tl-p">👤 ${String(n).replace(/[<>&]/g, '')}</div>`).join('') +
      `<div class="tl-p ai">🤖 ${tr(`AI ${Math.max(0, TDM.TEAM_SIZE * 2 - names.length)}명이 빈 자리를 채움`, `${Math.max(0, TDM.TEAM_SIZE * 2 - names.length)} AI soldiers fill the empty slots`)}</div>`;
  },

  // 호스트: 국가 추첨, 팀 배정, 시뮬레이션 시작
  hostStart(joiners) {
    clearInterval(this.lobbyTimer);
    this.lobby = false;
    const my = this.net ? this.net.me() : 'me';
    this.myPeer = my;
    const teams = drawTwoCountries();
    // 먼저 뽑힌 국가부터: 사람들을 번갈아 배정 (혼자면 봇은 모두 상대편 국가 + 우리 편 지원)
    const humans = [{ peer: my, name: Profile.data.name, team: 0, wpn: this.wpn || 'rifle' }];
    joiners.forEach((j, i) => humans.push({ peer: j.peer, name: String((j.presence.tm || {}).name || tr('플레이어', 'Player')).slice(0, 14), team: (i + 1) % 2, wpn: (j.presence.tm || {}).wpn || 'rifle' }));
    const sums = [TdmLearn.summary()];
    if (this.net) for (const p of this.net.peers()) if (!p.sameTab && p.presence && p.presence.tm && p.presence.tm.pat) sums.push(p.presence.tm.pat);
    if (Net.globalLearnTdm) sums.push(...Net.globalLearnTdm);
    const model = TdmLearn.model(sums);
    const diff = Profile.aiDifficulty();
    const sim = new TdmSim({ mode: this.mode, teams, humans, diff, model });
    this.sim = sim; this.role = this.net ? 'host' : 'solo';
    this.analysis = TdmLearn.analysisText(model, diff);
    const me = sim.findHuman(my);
    this.begin(teams, me.id, me.team);
  },
  guestStart(th, myId) {
    clearInterval(this.lobbyTimer);
    this.lobby = false;
    this.role = 'guest'; this.sim = null; this.myPeer = this.net.me();
    this.codec = TdmCodec.newState();
    this.lastQ = -1;
    this.analysis = th.an || [];
    const v = TdmCodec.decode(th, this.codec);
    this.view = v;
    const me = v.soldiers.find(s => s.id === myId);
    this.begin(th.tm, myId, me ? me.team : 0);
  },

  async begin(teams, myId, myTeam) {
    this.teams = teams; this.myId = myId; this.myTeam = myTeam;
    this.names = teams.map(i => COUNTRIES[i].name);
    this.flags = teams.map(i => countryFlag(i));
    this.yaw = myTeam === 0 ? Math.PI : 0; this.pitch = 0;
    this.me = { x: 0, z: 0, alive: false };
    this.wpn = this.wpn || 'rifle';
    this.ammo = {}; TDM.WPN.forEach(k => { this.ammo[k] = TDM.WEAPONS[k].mag; });
    this.reloadT = 0; this.cd = 0; this.gren = 2; this.shotSeq = 0; this.shots = []; this.grens = [];
    this.lastShotN = {}; this.lastGrN = {}; this.lastStateQ = {};
    this.sendT = 0; this.acc = 0; this.hudT = 0; this.ended = false; this.wasAlive = false;
    this.feed = []; this.myKills = 0;
    App.demo = null;
    const imgs = await Promise.all(this.flags.map(f => Flags.load(f)));
    App.r.initMatch(myTeam, imgs, this.names);
    this.buildMap();
    this.active = true;
    UI.hideAll();
    $('hud').classList.add('hidden');
    $('tdm-hud').classList.remove('hidden');
    $('t-name-0').textContent = this.names[0]; $('t-name-1').textContent = this.names[1];
    $('t-flag-0').src = this.flags[0]; $('t-flag-1').src = this.flags[1];
    $('t-team-0').classList.toggle('mine', myTeam === 0); $('t-team-1').classList.toggle('mine', myTeam === 1);
    $('t-mode').textContent = this.mode === 'koth' ? tr('⛰️ 언덕 위의 왕', '⛰️ King of the Hill') : tr('🎯 팀 데스매치', '🎯 Team Deathmatch');
    $('t-hill').classList.toggle('hidden', this.mode !== 'koth');
    $('btn-surrender').textContent = tr('🚪 경기 나가기', '🚪 Leave match');
    App.r.camMode = 'fps'; App.r.followId = myId;
    App.r.camera.near = 0.05; App.r.camera.updateProjectionMatrix();
    UI.announce(tr(`${COUNTRIES[teams[myTeam]].name} 소속으로 참전!`, `Fighting for ${COUNTRIES[teams[myTeam]].name}!`), '#f6c343', 2500);
    if (this.analysis && this.analysis.length) UI.toast('🧠 ' + this.analysis.slice(0, 2).join(' · '), 5000);
    App.lockPointer();
  },

  // 엄폐물, 거점 3D 모델
  buildMap() {
    const r = App.r, g = new THREE.Group();
    const std = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0.05 }, o || {}));
    const mWall = std(0x9a9284), mCrate = std(0x8a6a3c), mSand = std(0xbfa977), mHouse = std(0xb9ad97), mRoof = std(0x6d4b3a);
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const b of TDM.BOXES) {
      const mat = b.h >= 3.5 ? mHouse : b.h >= 2.5 ? mWall : b.h >= 1.5 ? mCrate : mSand;
      const m = new THREE.Mesh(box, mat);
      m.scale.set(b.w, b.h, b.d); m.position.set(b.x, b.h / 2, b.z);
      m.castShadow = true; m.receiveShadow = true; g.add(m);
      if (b.h >= 3.5) { const roof = new THREE.Mesh(box, mRoof); roof.scale.set(b.w + 0.6, 0.4, b.d + 0.6); roof.position.set(b.x, b.h + 0.2, b.z); roof.castShadow = true; g.add(roof); }
      if (b.h >= 1.5 && b.h < 2.5) { // 상자 테두리
        const edge = new THREE.Mesh(box, std(0x5a4424)); edge.scale.set(b.w + 0.05, 0.15, b.d + 0.05); edge.position.set(b.x, b.h - 0.07, b.z); g.add(edge);
      }
    }
    if (this.mode === 'koth') {
      const H = TDM.HILL;
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(H.r, H.r + 0.6, H.h, 40), std(0x8c8c88));
      plat.position.set(H.x, H.h / 2, H.z); plat.receiveShadow = true; g.add(plat);
      this.hillRing = new THREE.Mesh(new THREE.RingGeometry(H.r - 0.5, H.r, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      this.hillRing.rotation.x = -Math.PI / 2; this.hillRing.position.set(H.x, H.h + 0.03, H.z); g.add(this.hillRing);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 8), std(0xcccccc, { metalness: 0.6 }));
      pole.position.set(H.x, 4.5 + H.h, H.z); g.add(pole);
      this.hillFlag = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      this.hillFlag.position.set(H.x + 1.8, 7.6 + H.h, H.z); g.add(this.hillFlag);
      this.hillFlagTex = this.flags.map(f => { const t = new THREE.TextureLoader().load(f); t.encoding = THREE.sRGBEncoding; return t; });
      this.hillOwnerShown = -2;
    }
    // 수류탄 표시용
    this.nadeMeshes = [];
    const ng = new THREE.SphereGeometry(0.18, 8, 6), nm = std(0x2d3a22);
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(ng, nm); m.visible = false; g.add(m); this.nadeMeshes.push(m); }
    r.scene.add(g);
    this.mapGroup = g;
  },

  // ================= 조작 =================
  alive() {
    const s = this.mySoldier();
    return !!(s && s.alive);
  },
  mySoldier() {
    if (this.sim) return this.sim.find(this.myId);
    return this.view ? this.view.soldiers.find(s => s.id === this.myId) : null;
  },
  chooseWeapon(k) {
    if (!TDM.WEAPONS[k]) return;
    if (this.wpn === k) return;
    this.wpn = k; this.cd = 0.5; this.reloadT = 0;
    this.renderWpnPick();
  },
  reload() {
    const W = TDM.WEAPONS[this.wpn];
    if (this.reloadT > 0 || this.ammo[this.wpn] >= W.mag) return;
    this.reloadT = W.reload;
  },
  grenade() {
    if (!this.alive() || this.gren <= 0) return;
    this.gren--;
    const g = { n: ++this.shotSeq, yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3) };
    if (this.sim) this.sim.humanGrenade(this.myPeer, g);
    else { this.grens.push(g); if (this.grens.length > 4) this.grens.shift(); }
  },
  tryFire(aim) {
    const W = TDM.WEAPONS[this.wpn];
    if (!aim || this.cd > 0 || this.reloadT > 0) return;
    if (!(W.auto ? this.fireHeld : this.firePressed)) return;
    this.firePressed = false;
    if (this.ammo[this.wpn] <= 0) { this.reload(); return; }
    this.ammo[this.wpn]--;
    this.cd = W.rate;
    if (this.ammo[this.wpn] <= 0) this.reloadT = W.reload;
    const r2 = v => Math.round(v * 1000) / 1000;
    const sh = { n: ++this.shotSeq, w: this.wpn, ox: r2(aim.o.x), oy: r2(aim.o.y), oz: r2(aim.o.z), dx: r2(aim.d.x), dy: r2(aim.d.y), dz: r2(aim.d.z) };
    // 내 총알은 바로 그리기 (총구에서 시작)
    const L = Math.min(TdmPhys.rayBoxes(aim.o, aim.d, W.range), W.range);
    App.r.viewKick(this.wpn);
    const tip = App.r.viewmodelTip() || [aim.o.x, aim.o.y - 0.1, aim.o.z];
    App.r.handleEvent({ k: 'shot', t: W.fx, a: tip, b: [aim.o.x + aim.d.x * L, aim.o.y + aim.d.y * L, aim.o.z + aim.d.z * L] });
    this.recoil = (this.recoil || 0) + (W.pellets ? 0.05 : W.zoom ? 0.04 : 0.012);
    if (this.sim) this.sim.humanShot(this.myPeer, sh);
    else { this.shots.push(sh); if (this.shots.length > 10) this.shots.shift(); }
  },

  // ================= 매 프레임 =================
  tick(dt) {
    if (!this.active) return;
    const fdt = Math.min(0.05, dt);
    const s = this.mySoldier();
    const alive = !!(s && s.alive);
    // 부활 직후: 서버가 정한 위치로
    if (alive && !this.wasAlive) {
      this.me.x = s.x; this.me.z = s.z; this.yaw = this.myTeam === 0 ? Math.PI : 0; this.pitch = 0;
      TDM.WPN.forEach(k => { this.ammo[k] = TDM.WEAPONS[k].mag; });
      this.gren = 2; this.reloadT = 0;
      $('t-dead').classList.add('hidden');
    }
    if (!alive && this.wasAlive) this.onMyDeath();
    this.wasAlive = alive;
    this.cd = Math.max(0, this.cd - dt);
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.ammo[this.wpn] = TDM.WEAPONS[this.wpn].mag; }
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 0.6);

    if (alive) {
      const k = this.keys, W = TDM.WEAPONS[this.wpn];
      let fw = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), st = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
      let analog = 1, touchSprint = false;
      if (Touch.axis.x || Touch.axis.y) { // 모바일 조이스틱 (끝까지 밀면 달리기)
        fw = Touch.axis.y; st = Touch.axis.x;
        analog = Math.min(1, Math.hypot(fw, st));
        touchSprint = analog > 0.95 && fw > 0.7;
      }
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      let mx = sy * fw - cy * st, mz = cy * fw + sy * st;
      const l = Math.hypot(mx, mz);
      if (l > 0) {
        const sprint = (k.ShiftLeft || touchSprint) && fw > 0 && !this.aimHeld ? 1.45 : 1;
        const sp = TDM.SPEED * W.speed * sprint * analog * (this.aimHeld ? 0.6 : 1) * fdt / l;
        this.me.x += mx * sp; this.me.z += mz * sp;
        TdmPhys.collide(this.me);
      }
    }
    const meY = this.mode === 'koth' && TdmPhys.onHill(this.me.x, this.me.z) ? TDM.HILL.h : 0;

    // 시뮬레이션 / 네트워크
    if (this.sim) {
      if (alive) this.sim.humanState(this.myPeer, { x: this.me.x, z: this.me.z, yaw: this.yaw, pitch: this.pitch, wpn: this.wpn });
      else { const ms = this.sim.findHuman(this.myPeer); if (ms) ms.wpn = this.wpn; }
      if (this.role === 'host') this.readGuests();
      this.acc += dt;
      while (this.acc >= 1 / 30) { this.sim.step(1 / 30); this.acc -= 1 / 30; }
      this.relearnT = (this.relearnT || 0) + dt;
      if (this.relearnT > 20) { this.relearnT = 0; this.sim.relearn([TdmLearn.summary()]); }
      const evs = this.sim.events; this.sim.events = [];
      for (const e of evs) this.handleEvent(e);
      if (this.role === 'host') {
        this.sendT -= dt;
        if (this.sendT <= 0) {
          this.sendT = 0.1;
          const th = Object.assign({ mode: this.mode, ph: this.sim.over ? 'end' : 'play', tm: this.teams, an: this.analysis.slice(0, 3) }, this.sim.encode());
          this.net.setP({ th });
        }
      }
    } else {
      this.readHost();
      this.sendT -= dt;
      if (this.sendT <= 0 && this.net) {
        this.sendT = 0.05;
        const r2 = v => Math.round(v * 100) / 100;
        this.stateQ = (this.stateQ || 0) + 1;
        this.net.setP({ tm: { mode: this.mode, st: 'play', g: this.hostPeer, name: Profile.data.name, wpn: this.wpn, pat: TdmLearn.summary(),
          me: { q: this.stateQ, x: r2(this.me.x), z: r2(this.me.z), yaw: r2(this.yaw), pitch: r2(this.pitch), wpn: this.wpn, alive: alive ? 1 : 0 },
          sh: this.shots.slice(), gr: this.grens.slice() } });
      }
    }

    // 렌더
    const list = [];
    const sols = this.sim ? this.sim.soldiers : (this.view ? this.view.soldiers : []);
    for (const x of sols) {
      if (!x.alive) continue;
      const mine = x.id === this.myId;
      list.push({ id: x.id, type: (mine ? this.wpn : x.wpn) === 'sniper' ? 'sniper' : 'infantry', side: x.team, alive: true,
        x: mine ? this.me.x : x.x, y: mine ? meY : (x.y || 0), z: mine ? this.me.z : x.z, yaw: mine ? this.yaw : x.yaw,
        hp: x.hp, maxHp: TDM.HP, ctrl: !!x.human });
    }
    App.r.sync(list, [{ factories: 0 }, { factories: 0 }], fdt);
    const mm = App.r.meshes.get(this.myId);
    if (mm && alive) mm.root.position.set(this.me.x, meY, this.me.z);
    // 카메라
    const W = TDM.WEAPONS[this.wpn];
    const zoom = this.aimHeld && alive ? (W.zoom || 1.5) : 1;
    const fov = 72 / zoom;
    if (Math.abs(App.r.camera.fov - fov) > 0.1) { App.r.camera.fov += (fov - App.r.camera.fov) * Math.min(1, dt * 14); App.r.camera.updateProjectionMatrix(); }
    if (alive) {
      // 1인칭: 눈높이 카메라, 내 몸은 숨기고 총만 보이기
      App.r.camMode = 'fps'; App.r.followId = this.myId;
      if (mm) mm.root.visible = false;
      const scoped = this.aimHeld && this.wpn === 'sniper';
      App.r.setViewmodel(!scoped, this.wpn);
      this.scopeEl.classList.toggle('hidden', !scoped);
      const k = this.keys;
      const moving = !!(Touch.axis.x || Touch.axis.y || k.KeyW || k.KeyA || k.KeyS || k.KeyD);
      const aim = App.r.updateFirstPerson(this.me.x, meY + 1.62, this.me.z, this.yaw, this.pitch + this.recoil, this.wpn, moving, fdt);
      if (aim && (App.pointerLocked || App.noLock)) this.tryFire(aim);
    } else {
      App.r.setViewmodel(false);
      this.scopeEl.classList.add('hidden');
      App.r.camMode = 'rts';
      Object.assign(App.r.cam, { x: this.me.x * 0.5, z: this.myTeam === 0 ? 40 : -40, dist: 70, yaw: this.myTeam === 0 ? 0 : Math.PI, pitch: 0.9 });
    }
    this.updateNades();
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }
  },

  // 호스트: 참가자들의 presence 읽기
  readGuests() {
    if (!this.net) return;
    const my = this.net.me();
    const peers = this.net.peers();
    const present = new Set();
    for (const p of peers) {
      const tm = p.presence && p.presence.tm;
      if (p.sameTab || !tm || tm.g !== my || tm.mode !== this.mode) continue;
      present.add(p.peer);
      let s = this.sim.findHuman(p.peer);
      if (!s) { s = this.sim.addHuman({ peer: p.peer, name: String(tm.name || tr('플레이어', 'Player')).slice(0, 14), wpn: tm.wpn }); if (s) UI.toast(tr(`👤 ${s.name} 님이 ${COUNTRIES[this.teams[s.team]].name} 팀으로 합류!`, `👤 ${s.name} joined ${COUNTRIES[this.teams[s.team]].name}!`)); continue; }
      if (tm.wpn && TDM.WEAPONS[tm.wpn]) s.wpn = tm.wpn;
      if (tm.me && tm.me.q !== this.lastStateQ[p.peer]) { this.lastStateQ[p.peer] = tm.me.q; this.sim.humanState(p.peer, tm.me); }
      for (const sh of (tm.sh || [])) if (sh && sh.n > (this.lastShotN[p.peer] || 0)) { this.lastShotN[p.peer] = sh.n; this.sim.humanShot(p.peer, sh); }
      for (const g of (tm.gr || [])) if (g && g.n > (this.lastGrN[p.peer] || 0)) { this.lastGrN[p.peer] = g.n; this.sim.humanGrenade(p.peer, g); }
    }
    for (const s of this.sim.soldiers) if (s.human && s.human !== my && !present.has(s.human)) {
      UI.toast(tr(`👤 ${s.name} 님이 나갔습니다 (AI가 대신함)`, `👤 ${s.name} left (AI took over)`));
      this.sim.removeHuman(s.human);
    }
  },
  // 게스트: 호스트 스냅샷 읽기
  readHost() {
    const h = this.net.peers().find(p => p.peer === this.hostPeer);
    const th = h && h.presence && h.presence.th;
    if (!th) {
      this.lostT = (this.lostT || 0) + 1;
      if (this.lostT > 300 && !this.ended) { this.ended = true; UI.announce(tr('방장이 나갔습니다', 'The host left'), '#f87171', 2500); setTimeout(() => this.finish(null), 2500); }
      return;
    }
    this.lostT = 0;
    if (th.q === this.lastQ) return;
    this.lastQ = th.q;
    try { this.view = TdmCodec.decode(th, this.codec); } catch (e) { return; }
    for (const e of this.view.ev) this.handleEvent(e);
    if (this.view.over && !this.ended) this.handleEvent({ k: 'over', w: this.view.winner });
  },

  handleEvent(e) {
    if (e.k === 'shot' && e.by === this.myId) return; // 내 총알은 이미 그림
    if (e.k === 'die') {
      const ev = Object.assign({}, e, { ks: e.killer === this.myId ? this.myTeam : -1 });
      App.r.handleEvent(ev);
      this.addFeed(e);
      if (e.killer === this.myId) { this.myKills++; this.hitmark(e.head); }
      if (e.id === this.myId) this.killedBy = e.killer;
      return;
    }
    if (e.k === 'cap') { const n = this.names[e.team]; UI.announce(tr(`⛰️ ${n} 거점 점령! +${TDM.HILL.bonus}점`, `⛰️ ${n} captured the hill! +${TDM.HILL.bonus}`), e.team === this.myTeam ? '#4ade80' : '#f87171', 2200); return; }
    if (e.k === 'over') { this.onOver(e.w); return; }
    if (e.k === 'spawn') return;
    App.r.handleEvent(e);
  },
  hitmark(head) {
    const h = $('t-hitmark');
    h.textContent = head ? tr('💀 헤드샷 +$', '💀 Headshot +$') + GAME.KILL_REWARD : tr('✖ 처치 +$', '✖ Kill +$') + GAME.KILL_REWARD;
    h.classList.remove('show'); void h.offsetWidth; h.classList.add('show');
  },
  addFeed(e) {
    const sols = this.sim ? this.sim.soldiers : this.view.soldiers;
    const k = sols.find(s => s.id === e.killer), v = sols.find(s => s.id === e.id);
    if (!k || !v) return;
    const W = TDM.WEAPONS[e.wpn] || TDM.WEAPONS.rifle;
    const nm = s => `<span style="color:${SIDE_CSS[s.team]}${s.id === this.myId ? ';font-weight:900;text-decoration:underline' : ''}">${String(s.name).replace(/[<>&]/g, '')}</span>`;
    const d = document.createElement('div');
    d.innerHTML = `${nm(k)} ${W.icon}${e.head ? '💀' : ''} ${nm(v)}`;
    const f = $('t-feed'); f.prepend(d);
    while (f.children.length > 6) f.lastChild.remove();
    setTimeout(() => d.remove(), 6000);
  },
  onMyDeath() {
    const sols = this.sim ? this.sim.soldiers : this.view.soldiers;
    const k = sols.find(s => s.id === this.killedBy);
    $('t-dead-msg').textContent = k ? tr(`💀 ${k.name}에게 당했습니다`, `💀 Killed by ${k.name}`) : tr('💀 사망', '💀 You died');
    $('t-dead').classList.remove('hidden');
    this.renderWpnPick();
    this.fireHeld = false;
  },
  renderWpnPick() { TDM.WPN.forEach(k => $('wp-' + k).classList.toggle('on', k === this.wpn)); },
  updateNades() {
    const list = this.sim ? this.sim.proj.map(p => [p.x, p.y, p.z]) : (this.view ? this.view.nades : []);
    this.nadeMeshes.forEach((m, i) => { const p = list[i]; m.visible = !!p; if (p) m.position.set(p[0], p[1], p[2]); });
  },

  updateHud() {
    const sc = this.sim ? this.sim.score : (this.view ? this.view.score : [0, 0]);
    const t = this.sim ? this.sim.t : (this.view ? this.view.t : 0);
    $('t-score-0').textContent = sc[0]; $('t-score-1').textContent = sc[1];
    $('t-time').textContent = UI.time(Math.max(0, TDM.TIME - t));
    const s = this.mySoldier();
    const hp = s ? s.hp : 0;
    $('t-hp').style.width = Math.round(hp / TDM.HP * 100) + '%';
    $('t-hp').style.background = hp < 35 ? '#ef4444' : '#4ade80';
    $('t-hp-num').textContent = Math.ceil(hp);
    const W = TDM.WEAPONS[this.wpn];
    $('t-wpn-name').textContent = `${W.icon} ${W.name}`;
    $('t-ammo').textContent = this.reloadT > 0 ? tr('재장전 중...', 'Reloading...') : `${this.ammo[this.wpn]} / ${W.mag}`;
    $('t-gren').textContent = `💣 x${this.gren}`;
    $('t-cross').classList.toggle('zoom', this.aimHeld);
    if (s && !s.alive) $('t-dead-timer').textContent = tr(`${Math.max(0, s.respawnT).toFixed(1)}초 후 부활`, `Respawn in ${Math.max(0, s.respawnT).toFixed(1)}s`);
    // 거점
    if (this.mode === 'koth') {
      const H = this.sim ? [this.sim.hill.owner, this.sim.hill.prog[0] * 10, this.sim.hill.prog[1] * 10, this.sim.hill.contested ? 1 : 0] : (this.view && this.view.hill) || [-1, 0, 0, 0];
      $('t-hill-0').style.width = Math.min(100, H[1] / (TDM.HILL.cap * 10) * 100) + '%';
      $('t-hill-1').style.width = Math.min(100, H[2] / (TDM.HILL.cap * 10) * 100) + '%';
      $('t-hill-text').textContent = H[3] ? tr('⚔️ 거점 교전 중!', '⚔️ Hill contested!') : H[0] >= 0 ? tr(`⛰️ 거점: ${this.names[H[0]]}`, `⛰️ Hill: ${this.names[H[0]]}`) : tr('⛰️ 거점: 중립', '⛰️ Hill: Neutral');
      if (this.hillOwnerShown !== H[0]) {
        this.hillOwnerShown = H[0];
        this.hillRing.material.color.set(H[0] >= 0 ? SIDE_COLORS[H[0]] : 0xffffff);
        if (H[0] >= 0) { this.hillFlag.material.map = this.hillFlagTex[H[0]]; this.hillFlag.material.color.set(0xffffff); }
        else { this.hillFlag.material.map = null; this.hillFlag.material.color.set(0xdddddd); }
        this.hillFlag.material.needsUpdate = true;
      }
    }
    // 점수판
    const b = $('t-board');
    b.classList.toggle('hidden', !this.boardOn);
    if (this.boardOn) {
      const sols = this.sim ? this.sim.soldiers : (this.view ? this.view.soldiers : []);
      b.innerHTML = [0, 1].map(team => {
        const rows = sols.filter(x => x.team === team).sort((a, c) => c.kills - a.kills || a.deaths - c.deaths).slice(0, 12);
        return `<div class="tb-col"><div class="tb-head" style="color:${SIDE_CSS[team]}"><img src="${this.flags[team]}"> ${this.names[team]} · ${sc[team]}${tr('점', ' pts')}</div>` +
          rows.map(x => `<div class="tb-row${x.id === this.myId ? ' me' : ''}${x.human ? ' human' : ''}"><span>${x.human ? '👤' : '🤖'} ${String(x.name).replace(/[<>&]/g, '')}</span><span>${x.kills} / ${x.deaths}</span></div>`).join('') + '</div>';
      }).join('');
    }
  },

  onOver(w) {
    if (this.ended) return;
    this.ended = true;
    const msg = w === this.myTeam ? tr('🏆 승리!', '🏆 Victory!') : w < 0 ? tr('무승부', 'Draw') : tr('패배...', 'Defeat...');
    UI.announce(msg, w === this.myTeam ? '#f6c343' : '#f87171', 3000);
    setTimeout(() => this.finish(w), 3200);
  },

  finish(w) {
    if (!this.active) return;
    const P = Profile.data;
    const s = this.mySoldier();
    const kills = s ? s.kills : this.myKills, deaths = s ? s.deaths : 0;
    const win = w === this.myTeam;
    const before = P.money, prevLevel = Profile.level();
    P.money += kills * GAME.KILL_REWARD + (win ? GAME.WIN_REWARD : 0);
    const xp = (win ? 120 : w === null ? 20 : 45) + kills * 3;
    P.xp += xp; P.kills += kills;
    if (w !== null && w >= 0) { if (win) { P.wins++; P.streak++; P.bestStreak = Math.max(P.bestStreak, P.streak); } else { P.losses++; P.streak = 0; } }
    // 내 패턴 기록 (AI 학습)
    const L = TdmLearn.personal(), ms = this.sim ? this.sim.findHuman(this.myPeer) : null;
    L.matches++;
    if (this.wpnTime) for (const k in this.wpnTime) L.wpn[k] = (L.wpn[k] || 0) + this.wpnTime[k];
    if (ms && ms.laneT) { ms.laneT.forEach((v, i) => { L.lane[i] += v; }); L.hill += ms.hillT || 0; L.hillN += this.sim.t; if (ms.distN) { L.dist += ms.dists; L.distN += ms.distN; } }
    else if (this.laneTime) { this.laneTime.forEach((v, i) => { L.lane[i] += v; }); L.hill += this.hillTime || 0; L.hillN += this.playTime || 0; }
    Profile.save();
    if (Net.mode === 'ws') Net.send({ type: 'learn', stats: { tdm: TdmLearn.summary() } });
    const sc = this.sim ? this.sim.score : (this.view ? this.view.score : [0, 0]);
    this.cleanup();
    $('result-title').textContent = win ? tr('🏆 승리!', '🏆 Victory!') : w === null ? tr('경기 종료', 'Match over') : w < 0 ? tr('무승부', 'Draw') : tr('패배...', 'Defeat...');
    $('result-title').className = 'result-title ' + (win ? 'win' : 'lose');
    $('result-sub').textContent = `${this.names[0]} ${sc[0]} : ${sc[1]} ${this.names[1]}  (${this.mode === 'koth' ? tr('언덕 위의 왕', 'King of the Hill') : tr('팀 데스매치', 'Team Deathmatch')})`;
    const rows = [
      [tr('소속 국가', 'Your country'), this.names[this.myTeam]],
      [tr('처치 / 사망', 'Kills / Deaths'), `${kills} / ${deaths}`],
      [tr('처치 보상', 'Kill reward'), UI.money(kills * GAME.KILL_REWARD)],
      [tr('승리 보상', 'Victory bonus'), win ? '+' + UI.money(GAME.WIN_REWARD) : '-'],
      [tr('지갑', 'Wallet'), `${UI.money(before)} → <b>${UI.money(P.money)}</b>`],
      [tr('경험치', 'XP'), `+${xp} XP` + (Profile.level() > prevLevel ? tr(` · <b>레벨 업! Lv.${Profile.level()}</b>`, ` · <b>Level up! Lv.${Profile.level()}</b>`) : '')],
    ];
    $('result-list').innerHTML = rows.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('') +
      '<p class="note">' + tr('🧠 AI가 이번 경기에서 당신의 무기 선택, 이동 경로, 거점 공략 패턴을 학습했습니다.', '🧠 The AI learned your weapon choices, routes and hill tactics from this match.') + '</p>';
    App.againMode = this.mode;
    UI.show('screen-result');
  },
  leave() {
    if (!this.active) return;
    $('screen-pause').classList.add('hidden');
    this.finish(null);
  },
  cleanup() {
    this.active = false;
    if (this.net) this.net.setP({ tm: null, th: null });
    if (this.mapGroup) App.r.scene.remove(this.mapGroup);
    App.r.clearMatch();
    App.r.setViewmodel(false);
    if (this.scopeEl) this.scopeEl.classList.add('hidden');
    App.r.camera.fov = 55; App.r.camera.near = 0.3; App.r.camera.updateProjectionMatrix();
    App.r.camMode = 'rts';
    $('tdm-hud').classList.add('hidden');
    $('screen-pause').classList.add('hidden');
    $('btn-surrender').textContent = tr('🏳️ 항복', '🏳️ Surrender');
    if (document.pointerLockElement) document.exitPointerLock();
    this.sim = null; this.view = null;
    App.startDemo();
  },
};
// 무기 사용 시간 기록 (게스트도 자신의 패턴 저장)
setInterval(() => {
  const g = TdmGame;
  if (!g.active || !g.alive()) return;
  g.wpnTime = g.wpnTime || {}; g.wpnTime[g.wpn] = (g.wpnTime[g.wpn] || 0) + 0.5;
  g.laneTime = g.laneTime || [0, 0, 0]; g.laneTime[g.me.x < -10 ? 0 : g.me.x > 10 ? 2 : 1] += 0.5;
  g.playTime = (g.playTime || 0) + 0.5;
  if (TdmPhys.onHill(g.me.x, g.me.z)) g.hillTime = (g.hillTime || 0) + 0.5;
}, 500);
