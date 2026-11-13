// ===== 국가 전쟁: 게임 흐름 / 입력 / HUD =====
const AI_NATIONS = ['붉은 제국', '강철 연방', '북방 왕국', '사막 술탄국', '기계 공화국', '폭풍 군단', '얼음 왕조'];
const TUT_STEPS = [
  { text: '<b>국가 전쟁</b>에 오신 것을 환영합니다!<br>상대 <b>사령관 ⭐</b>을 처치하면 승리합니다.<br>내 사령관이 죽으면 패배!', next: true },
  { text: '하단의 <b>🪖 보병</b> 버튼(또는 <b>1</b>키)을 눌러 무료 보병을 생산하세요.', check: m => (m.myStats.buy.infantry || 0) >= 1 },
  { text: '돈으로 다른 병과를 살 수 있어요.<br><b>🛡️ 탱크병 ($100)</b>을 구입해보세요. (<b>3</b>키)', check: m => (m.myStats.buy.tank || 0) >= 1 },
  { text: '<b>타이쿤</b> 요소! <b>🏭 공장</b>을 건설하면 초당 수입이 늘어납니다. (<b>E</b>키)<br>왼쪽 위에서 돈과 수입을 확인하세요.', check: m => m.myStats.factories >= 1 },
  { text: '<b>⚔️ 공격</b> 버튼(<b>Z</b>키)으로 군대를 진격시키세요.<br><b>🛡️ 방어</b>(<b>X</b>키)는 기지 앞을 지킵니다.', check: m => App.sideInfo(m.mySide).stance === 'attack' },
  { text: '이제 <b>직접 참전</b>! 아군을 클릭하고 <b>F</b>키, 또는 <b>🎮 직접 참전</b> 버튼.<br>WASD 이동 · 마우스 조준 · 클릭 사격 · <b>Q</b> 복귀', check: m => m.possessId > 0 },
  { text: '훌륭해요! 적 1명 처치 시 <b>$50</b>, 승리 시 <b>$10,000</b>!<br>상성: 탱크→보병, 헬기→기갑, 장갑차→헬기<br>이제 <b>적 사령관을 처치</b>하세요!', next: true },
];

const App = {
  r: null, match: null, pre: null, demo: null,
  keys: {}, last: 0, hudT: 0, pointerLocked: false, rotating: false, lastMX: 0,

  init() {
    Profile.load();
    if (!Profile.data.flag) { Profile.data.flag = Flags.random(); Profile.save(); }
    this.r = new Renderer($('game-container'));
    this.bindUI();
    this.bindInput();
    this.bindNet();
    TdmGame.init();
    Touch.init();
    this.startDemo();
    if (Profile.data.name) this.showMenu(); else UI.show('screen-title');
    Net.connect().then(() => this.updateOnline());
    window.addEventListener('beforeunload', () => { if (Net.mode === 'room') Net.send({ type: 'leave' }); });
    this.last = performance.now();
    requestAnimationFrame(t => { this.last = t; this.loop(t); });
    // 탭이 가려져 애니메이션이 멈춰도 (특히 멀티플레이 호스트) 게임은 계속 진행
    setInterval(() => {
      const t = performance.now();
      if (t - this.last > 250 && (this.match || TdmGame.active)) this.step(t);
    }, 100);
  },

  // ---------- 메뉴 배경: AI vs AI 데모 전투 ----------
  async startDemo() {
    const flags = [Flags.random(), Flags.random()];
    const imgs = await Promise.all(flags.map(f => Flags.load(f)));
    if (this.match || TdmGame.active) return;
    const dn = [...AI_NATIONS].sort(() => Math.random() - 0.5);
    this.r.initMatch(0, imgs, [dn[0], dn[1]]);
    const p = aiSideParams(4);
    const sim = new Sim([0, 1].map(() => ({ name: 'demo', money: 1500, mulDmg: 1, mulIncome: p.mulIncome })));
    this.demo = { sim, ais: [new AIController(sim, 0, 4, null), new AIController(sim, 1, 5, null)], acc: 0, angle: 0, overT: 0 };
  },
  stepDemo(dt) {
    const d = this.demo;
    d.acc += dt;
    while (d.acc >= 1 / 30) {
      d.sim.step(1 / 30);
      d.ais.forEach(a => a.update(1 / 30));
      d.acc -= 1 / 30;
    }
    for (const e of d.sim.events) this.r.handleEvent(e);
    d.sim.events = [];
    this.r.sync(d.sim.units, d.sim.sides, dt);
    d.angle += dt * 0.06;
    Object.assign(this.r.cam, { x: Math.sin(d.angle) * 10, z: Math.cos(d.angle * 0.7) * 30, dist: 120, yaw: d.angle + 0.8, pitch: 0.55 });
    if (d.sim.over) { d.overT += dt; if (d.overT > 4) { this.demo = null; this.startDemo(); } }
  },

  // ---------- UI 바인딩 ----------
  bindUI() {
    $('btn-title-start').onclick = () => {
      const n = $('inp-name').value.trim() || '지휘관';
      Profile.data.name = n;
      if (!Profile.data.nation) Profile.data.nation = n + ' 공화국';
      Profile.save();
      this.showMenu();
    };
    $('inp-name').onkeydown = e => { if (e.key === 'Enter') $('btn-title-start').click(); };
    $('btn-match').onclick = () => {
      if (Profile.isNewbie()) { UI.toast('처음이시군요! 튜토리얼(쉬운 AI)부터 시작합니다', 2500); this.prepareAI(true); }
      else this.startMatching();
    };
    $('btn-tutorial').onclick = () => this.prepareAI(true);
    $('btn-shop').onclick = () => this.showShop();
    $('btn-units').onclick = () => this.showUnits();
    $('btn-reset').onclick = () => {
      const b = $('btn-reset');
      if (!b.dataset.armed) {
        b.dataset.armed = '1';
        b.textContent = '⚠️ 한 번 더 누르면 초기화';
        setTimeout(() => { delete b.dataset.armed; b.textContent = '🔄 프로필 초기화'; }, 3000);
        return;
      }
      delete b.dataset.armed; b.textContent = '🔄 프로필 초기화';
      Profile.reset(); Profile.data.flag = Flags.random(); Profile.save();
      $('inp-name').value = ''; UI.show('screen-title');
    };
    $('btn-shop-back').onclick = () => this.showMenu();
    $('btn-units-back').onclick = () => this.showMenu();
    $('btn-match-ai').onclick = () => { this.stopMatching(true); this.prepareAI(false); };
    $('btn-match-cancel').onclick = () => { this.stopMatching(true); this.showMenu(); };

    $('inp-flag').onchange = async e => {
      const f = e.target.files[0];
      if (!f || !this.pre) return;
      try {
        this.pre.myFlag = await Flags.fromFile(f);
        Flags.draw($('flag-preview'), this.pre.myFlag);
        UI.toast('국기가 업로드되었습니다!');
      } catch (err) { UI.toast('이미지를 불러올 수 없습니다'); }
      e.target.value = '';
    };
    $('btn-flag-random').onclick = () => {
      if (!this.pre) return;
      this.pre.myFlag = Flags.random();
      Flags.draw($('flag-preview'), this.pre.myFlag);
    };
    $('btn-ready').onclick = () => this.onReady();
    $('btn-flag-back').onclick = () => {
      if (this.pre && (this.pre.mode === 'host' || this.pre.mode === 'guest')) Net.send({ type: 'leave' });
      this.pre = null;
      this.showMenu();
    };

    $('btn-again').onclick = () => {
      if (this.againMode) { TdmGame.open(this.againMode); return; }
      if (Profile.isNewbie()) this.prepareAI(true); else this.startMatching();
    };
    $('btn-result-menu').onclick = () => this.showMenu();
    $('btn-resume').onclick = () => this.togglePause(false);
    $('btn-surrender').onclick = () => {
      if (TdmGame.active) { TdmGame.leave(); return; }
      if (!this.match) return;
      this.togglePause(false);
      this.cmd({ c: 'surrender' });
    };

    // HUD
    const bb = $('buy-buttons');
    BUY_ORDER.forEach((t, i) => {
      const T = UNIT_TYPES[t];
      const b = document.createElement('button');
      b.className = 'buy'; b.id = 'buy-' + t;
      b.title = T.desc;
      b.innerHTML = `<kbd>${i + 1}</kbd><span class="ic">${T.icon}</span><span class="nm">${T.name}</span><span class="cs">${T.cost ? UI.money(T.cost) : '무료'}</span><span class="hp">HP ${T.hp}</span><div class="cdmask"></div>`;
      b.onclick = () => this.cmd({ c: 'buy', t });
      bb.appendChild(b);
    });
    $('btn-factory').onclick = () => this.cmd({ c: 'factory' });
    $('btn-attack').onclick = () => this.cmd({ c: 'stance', v: 'attack' });
    $('btn-defend').onclick = () => this.cmd({ c: 'stance', v: 'defend' });
    $('btn-possess').onclick = () => this.togglePossess();
    $('tut-next').onclick = () => this.tutAdvance();
    $('tut-skip').onclick = () => { if (this.match) this.match.tut = null; $('tutorial').classList.add('hidden'); };
    $('minimap').onmousedown = e => {
      if (!this.match) return;
      const rc = e.target.getBoundingClientRect();
      let nx = (e.clientX - rc.left) / rc.width, nz = (e.clientY - rc.top) / rc.height;
      if (this.match.mySide === 1) { nx = 1 - nx; nz = 1 - nz; }
      if (this.match.possessId) this.exitPossess();
      this.r.cam.x = (nx - 0.5) * GAME.MAP_W;
      this.r.cam.z = nz * 200 - 100;
    };
  },

  bindNet() {
    Net.on('online', () => this.updateOnline());
    Net.on('hello', () => this.updateOnline());
    Net.on('flag', m => {
      if (!this.pre || this.pre.mode === 'ai' || this.pre.mode === 'tutorial') return;
      this.pre.peer = m;
      Flags.draw($('opp-flag'), m.flag);
      $('opp-name').textContent = `${m.nation} (Lv.${m.level})`;
      $('opp-status').textContent = '✅ 국기 업로드 완료 · 준비됨';
      this.tryStartMP();
    });
    Net.on('start', () => { if (this.pre && this.pre.mode === 'guest' && this.pre.ready) this.startMatch(); });
    Net.on('cmd', m => {
      const M = this.match;
      if (M && M.mode === 'host' && M.sim) M.sim.command(1 - M.mySide, m.c);
    });
    Net.on('snap', m => {
      const M = this.match;
      if (!M || M.mode !== 'guest') return;
      M.view = decodeSnapshot(m.s);
      for (const e of m.s.ev) this.handleEvent(e);
      if (M.view.over) this.onOver(M.view.winner);
    });
    Net.on('peerLeft', () => {
      const M = this.match;
      if (M && (M.mode === 'host' || M.mode === 'guest')) {
        if (!M.ended) {
          M.ended = true;
          this.exitPossess();
          UI.announce('상대가 도망쳤습니다! 승리!', '#f6c343', 2500);
          setTimeout(() => this.finishMatch(true, '상대가 게임을 떠났습니다'), 2500);
        }
      } else if (this.pre && (this.pre.mode === 'host' || this.pre.mode === 'guest')) {
        UI.toast('상대가 나갔습니다', 2500);
        this.pre = null;
        this.showMenu();
      }
    });
    Net.on('disconnected', () => {
      const M = this.match;
      this.updateOnline();
      if (M && !M.ended && (M.mode === 'host' || M.mode === 'guest')) {
        M.ended = true;
        UI.toast('서버 연결이 끊겼습니다', 3000);
        this.finishMatch(false, '서버 연결 끊김');
      }
    });
  },

  updateOnline() {
    $('menu-online').textContent = Net.connected
      ? (Net.mode === 'room'
        ? `🟢 실시간 연결됨 · 지금 이 게임을 연 사람 ${Net.online || 1}명 · 친구와 동시에 매칭을 누르세요`
        : `🟢 서버 연결됨 · 현재 접속자 ${Net.online || 1}명`)
      : window.NW_OFFLINE
        ? '⚪ 실시간 연결 대기 중 · 멀티플레이는 claude.ai에 로그인하고 이 게임에 초대받은 사람끼리 가능'
        : '⚪ 오프라인 모드 (학습형 AI 대전) · 멀티플레이는 server.js 실행 후 접속';
  },

  // ---------- 메뉴 화면들 ----------
  showMenu() {
    const P = Profile.data;
    $('menu-name').textContent = `${P.name} · ${P.nation || ''}`;
    $('menu-level').textContent = Profile.level();
    $('menu-xp').style.width = Math.round(Profile.levelProgress() * 100) + '%';
    $('menu-money').textContent = UI.money(P.money);
    $('menu-wins').textContent = P.wins;
    $('menu-losses').textContent = P.losses;
    $('menu-streak').textContent = P.streak;
    $('menu-ai').textContent = Profile.isNewbie() ? '튜토' : Profile.aiDifficulty();
    $('menu-flag').src = P.flag;
    $('btn-match').textContent = Profile.isNewbie() ? '⚔️ 매칭 시작 (튜토리얼)' : '⚔️ 매칭 시작';
    this.updateOnline();
    UI.show('screen-menu');
    if (!this.demo && !this.match) this.startDemo();
  },

  showShop() {
    const P = Profile.data;
    $('shop-money').textContent = UI.money(P.money);
    const grid = $('shop-grid');
    grid.innerHTML = '';
    for (const k in UPGRADES) {
      const U = UPGRADES[k], lv = P.upg[k], cost = upgradeCost(lv);
      const d = document.createElement('div');
      d.className = 'shop-item';
      d.innerHTML = `<div class="ic">${U.icon}</div><b>${U.name}</b><div class="lv">Lv.${lv} / ${U.max}</div><div class="note">${U.desc}</div>`;
      const b = document.createElement('button');
      b.textContent = lv >= U.max ? '최대 레벨' : `구매 ${UI.money(cost)}`;
      b.disabled = lv >= U.max || P.money < cost;
      b.onclick = () => {
        if (P.money < cost || lv >= U.max) return;
        P.money -= cost; P.upg[k]++; Profile.save();
        UI.toast(`${U.name} Lv.${P.upg[k]} 달성!`);
        this.showShop();
      };
      d.appendChild(b);
      grid.appendChild(d);
    }
    UI.show('screen-shop');
  },

  showUnits() {
    const tb = $('unit-table');
    tb.innerHTML = '';
    for (const t of TYPE_LIST) {
      const T = UNIT_TYPES[t];
      const d = document.createElement('div');
      d.className = 'unit-card';
      d.innerHTML = `<div class="ic">${T.icon}</div><b>${T.name}</b><div class="st">가격: ${t === 'commander' ? '기본 지급' : T.cost ? UI.money(T.cost) : '무료'}<br>체력: ${T.hp}<br>사거리: ${T.range} · 공격력: ${T.dmg}<br>${T.desc}</div>`;
      tb.appendChild(d);
    }
    UI.show('screen-units');
  },

  // ---------- 매칭 ----------
  async startMatching() {
    UI.show('screen-matching');
    $('match-status').textContent = '상대를 찾는 중...';
    $('match-sub').textContent = '서버에 연결하는 중...';
    this.stopMatching(false);
    const token = this.matchToken = {};
    const ok = await Net.connect();
    if (token !== this.matchToken) return;
    if (!ok) {
      $('match-status').textContent = '온라인 상대가 없습니다';
      $('match-sub').textContent = '패턴을 학습하는 AI와 대전합니다...';
      this.matchTimeout = setTimeout(() => this.prepareAI(false), 1500);
      return;
    }
    Net.on('matched', m => {
      if (token !== this.matchToken) return;
      this.stopMatching(false);
      this.matchToken = null;
      $('match-status').textContent = '매칭 성공!';
      this.prepareMP(m);
    });
    Net.send({ type: 'queue', name: Profile.data.name, level: Profile.level() });
    let left = Net.mode === 'room' ? 30 : 15;
    const upd = () => {
      $('match-sub').textContent = (Net.mode === 'room' ? `이 게임을 연 사람 ${Net.online}명 · 친구도 매칭 시작을 누르면 연결됩니다 · ` : `접속자 ${Net.online}명 · `) +
        `${left}초 안에 상대가 없으면 학습형 AI(난이도 ${Profile.aiDifficulty()})와 대전합니다`;
    };
    upd();
    if (!this.matchToken) return; // 이미 매칭됨
    this.matchInterval = setInterval(() => {
      left--; upd();
      if (left <= 0) {
        this.stopMatching(true);
        $('match-status').textContent = '상대가 없습니다!';
        $('match-sub').textContent = '학습형 AI와 매칭되었습니다';
        this.matchTimeout = setTimeout(() => this.prepareAI(false), 1000);
      }
    }, 1000);
  },
  stopMatching(cancelQueue) {
    clearInterval(this.matchInterval);
    clearTimeout(this.matchTimeout);
    Net.off('matched');
    if (cancelQueue) { Net.send({ type: 'cancel' }); this.matchToken = null; }
  },

  prepareAI(tutorial) {
    const diff = tutorial ? 0 : Profile.aiDifficulty();
    const model = buildStrategyModel(Profile.data.learn, Net.globalLearn);
    const plan = new AIController(null, 1, diff, model).plan;
    this.pre = {
      mode: tutorial ? 'tutorial' : 'ai', mySide: 0, diff, model, plan,
      oppNation: tutorial ? '훈련 교관단' : AI_NATIONS[Math.floor(Math.random() * AI_NATIONS.length)],
      oppFlag: Flags.random(), myFlag: Profile.data.flag, ready: false, peer: null,
    };
    this.showFlagScreen();
  },
  prepareMP(m) {
    this.pre = { mode: m.side === 0 ? 'host' : 'guest', mySide: m.side, opp: m.opponent, myFlag: Profile.data.flag, ready: false, peer: null };
    this.showFlagScreen();
  },

  showFlagScreen() {
    const p = this.pre, P = Profile.data;
    const isAI = p.mode === 'ai' || p.mode === 'tutorial';
    $('flag-title').textContent = p.mode === 'tutorial' ? '📘 튜토리얼 — 국기를 업로드하세요' : '매칭 완료! 국기를 업로드하세요';
    $('inp-nation').value = P.nation || (P.name + ' 공화국');
    $('flag-wallet').textContent = UI.money(P.money);
    Flags.draw($('flag-preview'), p.myFlag);
    $('btn-ready').disabled = false;
    $('btn-ready').textContent = '⚔️ 전투 준비 완료';
    if (isAI) {
      $('opp-label').textContent = p.mode === 'tutorial' ? '🤖 쉬운 AI' : `🤖 학습형 AI · 난이도 ${p.diff}`;
      $('opp-name').textContent = p.oppNation;
      $('opp-status').textContent = '준비 완료';
      Flags.draw($('opp-flag'), p.oppFlag);
      const a = $('ai-analysis');
      a.classList.remove('hidden');
      a.innerHTML = '<b>🧠 AI 전략 분석</b><br>' + p.plan.notes.map(n => '· ' + n).join('<br>');
    } else {
      $('opp-label').textContent = `👤 ${p.opp.name}`;
      $('opp-name').textContent = `Lv.${p.opp.level}`;
      $('opp-status').textContent = '⏳ 상대가 국기를 업로드하는 중...';
      Flags.draw($('opp-flag'), null);
      $('ai-analysis').classList.add('hidden');
    }
    UI.show('screen-flag');
  },

  onReady() {
    const p = this.pre;
    if (!p) return;
    p.myNation = $('inp-nation').value.trim() || (Profile.data.name + ' 공화국');
    Profile.data.flag = p.myFlag;
    Profile.data.nation = p.myNation;
    Profile.save();
    if (p.mode === 'ai' || p.mode === 'tutorial') { this.startMatch(); return; }
    p.ready = true;
    $('btn-ready').disabled = true;
    $('btn-ready').textContent = '⏳ 상대를 기다리는 중...';
    Net.send({ type: 'flag', flag: p.myFlag, nation: p.myNation, money: Profile.data.money, upg: Profile.data.upg, level: Profile.level() });
    this.tryStartMP();
  },
  tryStartMP() {
    const p = this.pre;
    if (p && p.mode === 'host' && p.ready && p.peer) {
      Net.send({ type: 'start' });
      this.startMatch();
    }
  },

  // ---------- 경기 시작 ----------
  async startMatch() {
    const p = this.pre;
    if (!p) return;
    this.pre = null;
    this.demo = null;
    const me = p.mySide, other = 1 - me;
    const names = [], flags = [];
    names[me] = p.myNation; flags[me] = p.myFlag;
    names[other] = p.peer ? p.peer.nation : p.oppNation;
    flags[other] = p.peer ? p.peer.flag : p.oppFlag;
    const imgs = await Promise.all(flags.map(f => Flags.load(f)));
    this.r.initMatch(me, imgs, names);

    const m = {
      mode: p.mode, mySide: me, names, flags, diff: p.diff || 0,
      sim: null, ai: null, view: null, startMoney: Profile.data.money,
      possessId: 0, camYaw: 0, camPitch: -0.1, lostT: 0, fire: false, inputT: 0, possessNext: false,
      acc: 0, snapT: 0, pending: [], ended: false, paused: false, deathPos: null,
      myStats: { buy: {}, factories: 0, firstAttack: -1, possess: 0 }, tut: null,
    };
    if (p.mode !== 'guest') {
      const sides = [];
      sides[me] = { name: names[me], money: Profile.data.money, upg: Profile.data.upg };
      if (p.mode === 'host') {
        sides[other] = { name: names[other], money: p.peer.money, upg: p.peer.upg };
      } else {
        const ap = aiSideParams(m.diff);
        const u = Math.floor(m.diff / 4);
        sides[other] = { name: names[other], money: ap.money, upg: { eco: 0, armor: u, fire: u }, mulDmg: ap.mulDmg, mulIncome: ap.mulIncome };
      }
      m.sim = new Sim(sides);
      if (p.mode === 'ai' || p.mode === 'tutorial') m.ai = new AIController(m.sim, other, m.diff, p.model);
    }
    this.match = m;

    // HUD 세팅 (왼쪽 = 나, 오른쪽 = 상대)
    $('hud-name-0').textContent = names[me];
    $('hud-name-1').textContent = names[other];
    $('hud-flag-0').src = flags[me];
    $('hud-flag-1').src = flags[other];
    $('team-0').style.borderLeftColor = SIDE_CSS[me];
    $('team-1').style.borderRightColor = SIDE_CSS[other];
    $('hud-ai').textContent = p.mode === 'ai' ? `🤖 학습형 AI Lv.${m.diff}` : p.mode === 'tutorial' ? '📘 튜토리얼' : '👥 멀티플레이';
    $('killfeed').innerHTML = '';
    $('selinfo').classList.add('hidden');
    UI.hideAll();
    $('hud').classList.remove('hidden');
    this.setPossessUI(false);
    if (p.mode === 'tutorial') { m.tut = { i: 0 }; this.renderTut(); $('tutorial').classList.remove('hidden'); }
    else $('tutorial').classList.add('hidden');
    UI.announce('전투 시작!', '#f6c343', 1800);
    UI.toast(`우리 편: ${me === 0 ? '파랑' : '빨강'} · 상대 사령관 ⭐을 처치하세요!`, 3000);
  },

  // ---------- 상태 조회 (호스트/AI: sim, 게스트: 스냅샷) ----------
  viewUnits() {
    const m = this.match;
    if (!m) return [];
    if (m.sim) return m.sim.units;
    return m.view ? m.view.units : [];
  },
  sideInfo(i) {
    const m = this.match;
    if (m && m.sim) {
      const S = m.sim.sides[i];
      return { money: S.money, inc: m.sim.income(i), factories: S.factories, infCd: S.infCd, stance: S.stance, kills: S.kills, lost: S.lost, ctrlId: S.ctrlId };
    }
    if (m && m.view) return m.view.sides[i];
    return { money: m && i === m.mySide ? Profile.data.money : 0, inc: 0, factories: 0, infCd: 0, stance: 'defend', kills: 0, lost: 0, ctrlId: 0 };
  },
  findUnit(id) { for (const u of this.viewUnits()) if (u.id === id && u.alive) return u; return null; },
  myArmy() { const s = this.match.mySide; let n = 0; for (const u of this.viewUnits()) if (u.alive && u.side === s && u.type !== 'commander') n++; return n; },

  // ---------- 명령 ----------
  cmd(c) {
    const m = this.match;
    if (!m || m.ended) return false;
    const S = this.sideInfo(m.mySide);
    if (c.c === 'buy') {
      const T = UNIT_TYPES[c.t];
      if (this.myArmy() >= GAME.UNIT_CAP) { UI.toast(`병력 한도(${GAME.UNIT_CAP}) 초과!`); return false; }
      if (c.t === 'infantry' && S.infCd > 0) { UI.toast(`보병 징집 대기 중 (${S.infCd.toFixed(1)}초)`); return false; }
      if (T.cost > S.money) { UI.toast(`돈이 부족합니다! (${UI.money(T.cost)} 필요)`); return false; }
    }
    if (c.c === 'factory') {
      if (S.factories >= GAME.FACTORY_MAX) { UI.toast('공장을 더 지을 수 없습니다'); return false; }
      if (factoryCost(S.factories) > S.money) { UI.toast(`돈이 부족합니다! (${UI.money(factoryCost(S.factories))} 필요)`); return false; }
    }
    if (m.sim) {
      if (m.sim.command(m.mySide, c) !== 'ok') return false;
    } else {
      Net.send({ type: 'cmd', c });
    }
    const st = m.myStats;
    if (c.c === 'buy') st.buy[c.t] = (st.buy[c.t] || 0) + 1;
    if (c.c === 'factory') { st.factories++; UI.toast('🏭 공장 건설! 수입 증가'); }
    if (c.c === 'stance') {
      if (c.v === 'attack' && st.firstAttack < 0) st.firstAttack = Math.round(m.sim ? m.sim.t : (m.view ? m.view.t : 0));
      if (m.view) m.view.sides[m.mySide].stance = c.v;
      UI.toast(c.v === 'attack' ? '⚔️ 전군 공격!' : '🛡️ 방어 태세');
    }
    if (c.c === 'possess') st.possess++;
    return true;
  },

  // ---------- 직접 참전 ----------
  togglePossess() {
    const m = this.match;
    if (!m || m.ended) return;
    if (m.possessId) { this.exitPossess(); return; }
    const me = m.mySide;
    let u = this.findUnit(this.r.selectedId);
    if (!u || u.side !== me) {
      u = null;
      const units = this.viewUnits();
      for (let i = units.length - 1; i >= 0; i--) {
        const x = units[i];
        if (x.alive && x.side === me && x.type !== 'commander') { u = x; break; }
      }
    }
    if (u) { this.possess(u.id); return; }
    if (this.cmd({ c: 'buy', t: 'infantry' })) { m.possessNext = true; UI.toast('보병을 징집해 직접 참전합니다!'); }
    else {
      const c = this.viewUnits().find(x => x.alive && x.side === me && x.type === 'commander');
      if (c) { this.possess(c.id); UI.toast('⭐ 사령관으로 직접 참전! 죽으면 패배이니 조심하세요'); }
    }
  },
  possess(id) {
    const m = this.match;
    const u = this.findUnit(id);
    if (!u || u.side !== m.mySide) return;
    if (!this.cmd({ c: 'possess', id })) return;
    m.possessId = id; m.lostT = 0;
    m.camYaw = u.yaw; m.camPitch = -0.12;
    this.r.camMode = 'fps'; this.r.followId = id;
    this.setPossessUI(true);
    this.lockPointer();
    UI.announce(`${UNIT_TYPES[u.type].icon} ${UNIT_TYPES[u.type].name}(으)로 참전!`, '#4ade80', 1500);
  },
  exitPossess(msg) {
    const m = this.match;
    if (!m || !m.possessId) return;
    const o = this.r.meshes.get(m.possessId);
    if (o) { this.r.cam.x = o.root.position.x; this.r.cam.z = o.root.position.z + (m.mySide === 0 ? 25 : -25); }
    if (!m.ended) this.cmd({ c: 'unpossess' });
    m.possessId = 0; m.fire = false;
    this.r.camMode = 'rts'; this.r.followId = 0;
    this.r.cam.yaw = m.mySide === 0 ? 0 : Math.PI;
    this.setPossessUI(false);
    if (document.pointerLockElement) document.exitPointerLock();
    if (msg) UI.toast(msg, 2200);
  },
  setPossessUI(on) {
    $('crosshair').classList.toggle('hidden', !on);
    $('hero-panel').classList.toggle('hidden', !on);
    $('rts-hint').classList.toggle('hidden', on);
    $('btn-possess').classList.toggle('on', on);
    $('btn-possess').querySelector('b').textContent = on ? '↩️ 지휘 모드' : '🎮 직접 참전';
    if (on) $('selinfo').classList.add('hidden');
  },
  lockPointer() {
    if (this.noLock) return;
    try { const p = this.r.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { this.noLock = true; }); } catch (e) { this.noLock = true; }
  },

  // ---------- 입력 ----------
  bindInput() {
    const cv = this.r.canvas;
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === cv; });
    // 포인터 잠금이 막힌 환경에서는 잠금 없이 마우스로 조준
    document.addEventListener('pointerlockerror', () => { this.noLock = true; });
    if (!cv.requestPointerLock) this.noLock = true;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      const m = this.match;
      if (!m) return;
      if (m.possessId) {
        if (!this.pointerLocked && !this.noLock) { this.lockPointer(); return; }
        if (e.button === 0) m.fire = true;
        return;
      }
      if (e.button === 2) { this.rotating = true; this.lastMX = e.clientX; return; }
      if (e.button === 0) {
        const id = this.r.pick(e.clientX, e.clientY);
        this.r.setSelection(id);
        this.updateSelInfo();
      }
    });
    cv.addEventListener('dblclick', e => {
      const m = this.match;
      if (!m || m.possessId) return;
      const u = this.findUnit(this.r.pick(e.clientX, e.clientY));
      if (u && u.side === m.mySide) this.possess(u.id);
    });
    window.addEventListener('mouseup', e => {
      if (this.match && e.button === 0) this.match.fire = false;
      if (e.button === 2) this.rotating = false;
    });
    window.addEventListener('mousemove', e => {
      const m = this.match;
      if (!m) return;
      if (m.possessId && (this.pointerLocked || this.noLock)) {
        m.camYaw -= e.movementX * 0.0025;
        m.camPitch = Math.max(-0.7, Math.min(0.45, m.camPitch - e.movementY * 0.0025));
      } else if (this.rotating) {
        this.r.cam.yaw -= (e.clientX - this.lastMX) * 0.006;
        this.lastMX = e.clientX;
      }
    });
    cv.addEventListener('wheel', e => {
      if (this.match && !this.match.possessId) this.r.zoom(e.deltaY > 0 ? 1.1 : 0.9);
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this.keys[e.code] = true;
      const m = this.match;
      if (!m || m.ended) return;
      if (e.code.startsWith('Digit')) {
        const i = parseInt(e.code.slice(5), 10) - 1;
        if (BUY_ORDER[i]) this.cmd({ c: 'buy', t: BUY_ORDER[i] });
      }
      if (e.code === 'KeyE') this.cmd({ c: 'factory' });
      if (e.code === 'KeyZ') this.cmd({ c: 'stance', v: 'attack' });
      if (e.code === 'KeyX') this.cmd({ c: 'stance', v: 'defend' });
      if (e.code === 'KeyF') this.togglePossess();
      if (e.code === 'KeyQ' && m.possessId) this.exitPossess();
      if (e.code === 'Escape' && !m.possessId) this.togglePause(!m.paused && $('screen-pause').classList.contains('hidden'));
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; if (this.match) this.match.fire = false; });
  },

  togglePause(on) {
    const m = this.match;
    if (!m) return;
    const mp = m.mode === 'host' || m.mode === 'guest';
    $('pause-title').textContent = mp ? '메뉴 (멀티플레이 중에는 멈추지 않습니다)' : '일시정지';
    $('screen-pause').classList.toggle('hidden', !on);
    m.paused = on && !mp;
  },

  updateSelInfo() {
    const m = this.match;
    const box = $('selinfo');
    const u = m && this.findUnit(this.r.selectedId);
    if (!u || m.possessId) { box.classList.add('hidden'); return; }
    const T = UNIT_TYPES[u.type];
    const mine = u.side === m.mySide;
    box.classList.remove('hidden');
    $('sel-text').innerHTML = `<b style="color:${SIDE_CSS[u.side]}">${T.icon} ${T.name}</b> ${mine ? '(아군)' : '(적군)'}<br>체력 ${Math.ceil(u.hp)} / ${Math.round(u.maxHp)}<br><span class="note">${T.desc}</span>`;
    const b = $('btn-sel-possess');
    b.classList.toggle('hidden', !mine);
    b.onclick = () => this.possess(u.id);
  },

  // ---------- 이벤트 ----------
  handleEvent(e) {
    const m = this.match;
    this.r.handleEvent(e);
    if (!m) return;
    if (e.k === 'die') {
      const A = UNIT_TYPES[e.by] || UNIT_TYPES.infantry, D = UNIT_TYPES[e.t];
      UI.killfeed(`<span style="color:${SIDE_CSS[e.ks]}">${m.names[e.ks]}</span> ${A.icon} ▶ <span style="color:${SIDE_CSS[e.side]}">${D.icon} ${D.name}</span>`);
      if (e.id === m.possessId) this.exitPossess('💀 전사했습니다! 지휘 모드로 복귀');
      if (e.t === 'commander') m.deathPos = { x: e.x, z: e.z };
    }
    if (e.k === 'spawn' && m.possessNext && e.side === m.mySide && e.t === 'infantry') {
      m.possessNext = false;
      setTimeout(() => this.possess(e.id), 50);
    }
    if (e.k === 'over') this.onOver(e.w);
  },

  onOver(w) {
    const m = this.match;
    if (!m || m.ended) return;
    m.ended = true;
    this.exitPossess();
    const win = w === m.mySide;
    UI.announce(win ? '🏆 적 사령관 처치! 승리!' : '💀 사령관 전사... 패배', win ? '#f6c343' : '#f87171', 3200);
    if (m.deathPos) Object.assign(this.r.cam, { x: m.deathPos.x, z: m.deathPos.z + (m.mySide === 0 ? 18 : -18), dist: 40 });
    setTimeout(() => this.finishMatch(win), 3200);
  },

  finishMatch(win, reason) {
    const m = this.match;
    if (!m || m.finished) return;
    m.finished = true;
    this.againMode = null;
    const P = Profile.data;
    const my = this.sideInfo(m.mySide);
    const prevLevel = Profile.level(), prevDiff = Profile.aiDifficulty();
    const mp = m.mode === 'host' || m.mode === 'guest';
    const kills = my.kills || 0;
    const battleMoney = Math.max(0, Math.floor(my.money));
    P.money = battleMoney + (win ? GAME.WIN_REWARD : 0);
    let xp = m.mode === 'tutorial' ? 150 : mp ? (win ? 160 : 45) : (win ? 100 + m.diff * 15 : 35);
    xp += kills * 2;
    P.xp += xp;
    P.kills += kills;
    if (m.mode === 'tutorial') P.tutorialDone = true;
    else if (win) { P.wins++; P.streak++; P.bestStreak = Math.max(P.bestStreak, P.streak); }
    else { P.losses++; P.streak = 0; }
    if (m.mode !== 'tutorial') {
      Profile.recordStrategy(m.myStats);
      Net.send({ type: 'learn', stats: m.myStats });
    }
    Profile.save();
    if (mp) Net.send({ type: 'leave' });

    const dur = m.sim ? m.sim.t : (m.view ? m.view.t : 0);
    const newLevel = Profile.level(), newDiff = Profile.aiDifficulty();
    $('result-title').textContent = win ? '🏆 승리!' : '패배...';
    $('result-title').className = 'result-title ' + (win ? 'win' : 'lose');
    $('result-sub').textContent = reason || (m.mode === 'tutorial' ? '튜토리얼 완료! 이제 실전 매칭이 가능합니다.' : win ? `${m.names[1 - m.mySide]}을(를) 정복했습니다!` : `${m.names[1 - m.mySide]}에게 패배했습니다.`);
    const rows = [
      ['전투 시간', UI.time(dur)],
      ['처치 / 손실', `${kills} / ${my.lost || 0}`],
      ['처치 보상', UI.money(kills * GAME.KILL_REWARD)],
      ['승리 보상', win ? '+' + UI.money(GAME.WIN_REWARD) : '-'],
      ['남은 전투 자금', UI.money(battleMoney)],
      ['지갑', `${UI.money(m.startMoney)} → <b>${UI.money(P.money)}</b>`],
      ['경험치', `+${xp} XP` + (newLevel > prevLevel ? ` · <b>레벨 업! Lv.${newLevel}</b>` : ` · Lv.${newLevel}`)],
      ['연승', `${P.streak}연승 (최고 ${P.bestStreak})`],
      ['다음 AI 난이도', `${newDiff}` + (newDiff > prevDiff ? ' <b>▲ 상승</b>' : newDiff < prevDiff ? ' ▼' : '')],
    ];
    $('result-list').innerHTML = rows.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('') +
      (m.mode !== 'tutorial' ? '<p class="note">🧠 AI가 이번 경기에서 당신의 전략(병과 선택, 공격 타이밍, 경제 운영)을 학습했습니다.</p>' : '');

    this.match = null;
    this.r.clearMatch();
    $('hud').classList.add('hidden');
    $('screen-pause').classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    UI.show('screen-result');
    this.startDemo();
  },

  // ---------- 튜토리얼 ----------
  renderTut() {
    const m = this.match;
    if (!m || !m.tut) return;
    const s = TUT_STEPS[m.tut.i];
    $('tut-step').textContent = `(${m.tut.i + 1}/${TUT_STEPS.length})`;
    $('tut-text').innerHTML = s.text;
    $('tut-text').classList.remove('done');
    $('tut-next').classList.toggle('hidden', !s.next);
    $('tut-next').textContent = m.tut.i === TUT_STEPS.length - 1 ? '확인 ✔' : '다음 ▶';
  },
  tutAdvance() {
    const m = this.match;
    if (!m || !m.tut) return;
    if (m.tut.i >= TUT_STEPS.length - 1) { m.tut = null; $('tutorial').classList.add('hidden'); return; }
    m.tut.i++;
    this.renderTut();
  },
  checkTut() {
    const m = this.match;
    if (!m || !m.tut || m.tut.wait) return;
    const s = TUT_STEPS[m.tut.i];
    if (s.check && s.check(m)) {
      m.tut.wait = true;
      $('tut-text').innerHTML = '✅ 완료!';
      $('tut-text').classList.add('done');
      setTimeout(() => { if (m.tut) { m.tut.wait = false; this.tutAdvance(); } }, 900);
    }
  },

  // ---------- HUD ----------
  updateHud() {
    const m = this.match;
    const me = m.mySide, other = 1 - me;
    const S = this.sideInfo(me), O = this.sideInfo(other);
    $('hud-money').textContent = UI.money(S.money);
    $('hud-income').textContent = `+$${(S.inc || 0).toFixed(1)}/초 · 공장 ${S.factories}/${GAME.FACTORY_MAX}`;
    const army = this.myArmy();
    $('hud-army').textContent = `병력 ${army} / ${GAME.UNIT_CAP}`;
    $('hud-time').textContent = UI.time(m.sim ? m.sim.t : (m.view ? m.view.t : 0));
    $('hud-score').textContent = `처치 ${S.kills} : ${O.kills}`;
    for (const t of BUY_ORDER) {
      const b = $('buy-' + t), T = UNIT_TYPES[t];
      b.classList.toggle('poor', T.cost > S.money || army >= GAME.UNIT_CAP);
      if (t === 'infantry') b.querySelector('.cdmask').style.height = Math.round((S.infCd / GAME.INF_COOLDOWN) * 100) + '%';
    }
    const fc = factoryCost(S.factories);
    $('factory-cost').textContent = S.factories >= GAME.FACTORY_MAX ? 'MAX' : UI.money(fc);
    $('btn-factory').classList.toggle('poor', fc > S.money);
    $('btn-attack').classList.toggle('on', S.stance === 'attack');
    $('btn-defend').classList.toggle('on', S.stance !== 'attack');
    // 사령관 체력
    const cmdHp = [0, 0];
    for (const u of this.viewUnits()) if (u.alive && u.type === 'commander') cmdHp[u.side] = u.hp / u.maxHp;
    $('hud-cmd-0').style.width = Math.round(cmdHp[me] * 100) + '%';
    $('hud-cmd-1').style.width = Math.round(cmdHp[other] * 100) + '%';
    $('hud-cmd-0').style.background = cmdHp[me] < 0.4 ? '#ef4444' : '#4ade80';
    $('hud-cmd-1').style.background = cmdHp[other] < 0.4 ? '#ef4444' : '#4ade80';
    // 직접 조종 패널
    if (m.possessId) {
      const u = this.findUnit(m.possessId);
      if (u) {
        const T = UNIT_TYPES[u.type];
        $('hero-name').textContent = `${T.icon} ${T.name} — 직접 조종 중 (피해 +${Math.round((GAME.HERO_BONUS - 1) * 100)}%)`;
        $('hero-hp').style.width = Math.round(u.hp / u.maxHp * 100) + '%';
        $('hero-reload').style.width = (u.cd !== undefined ? Math.round((1 - Math.max(0, u.cd) / (T.rate * 0.8)) * 100) : 100) + '%';
      }
    } else if (this.r.selectedId) this.updateSelInfo();
    this.drawMinimap();
    this.checkTut();
  },

  drawMinimap() {
    const m = this.match, c = $('minimap'), g = c.getContext('2d'), W = c.width, H = c.height;
    const flip = m.mySide === 1;
    const P = (x, z) => {
      let nx = x / GAME.MAP_W + 0.5, nz = (z + 100) / 200;
      if (flip) { nx = 1 - nx; nz = 1 - nz; }
      return [nx * W, nz * H];
    };
    g.fillStyle = '#2d4a24'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(140,120,80,0.35)'; g.fillRect(W * 0.05, 0, W * 0.9, H);
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.setLineDash([]);
    for (let s = 0; s < 2; s++) {
      const [x, y] = P(0, s === 0 ? GAME.BASE_Z + 10 : -GAME.BASE_Z - 10);
      g.fillStyle = SIDE_CSS[s]; g.globalAlpha = 0.5; g.fillRect(x - 25, y - 8, 50, 16); g.globalAlpha = 1;
    }
    for (const u of this.viewUnits()) {
      if (!u.alive) continue;
      const [x, y] = P(u.x, u.z);
      g.fillStyle = SIDE_CSS[u.side];
      if (u.type === 'commander') {
        g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
        g.strokeStyle = SIDE_CSS[u.side]; g.lineWidth = 2; g.stroke();
      } else {
        const r = UNIT_TYPES[u.type].cat === 'inf' ? 2 : 3;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      if (u.id === m.possessId) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x - 5, y - 5, 10, 10); }
    }
    if (!m.possessId) {
      const [x, y] = P(this.r.cam.x, this.r.cam.z);
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1;
      g.strokeRect(x - 20, y - 14, 40, 28);
    }
  },

  // ---------- 메인 루프 ----------
  loop(now) {
    this.step(now);
    requestAnimationFrame(t => this.loop(t));
  },
  step(now) {
    const raw = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    const dt = Math.min(0.05, raw);
    const m = this.match;
    Touch.update();
    if (TdmGame.active) TdmGame.tick(Math.min(0.5, raw));
    else if (m) this.tick(m, Math.min(0.5, raw));
    else if (this.demo) this.stepDemo(dt);
    this.r.frame(dt);
  },

  tick(m, dt) {
    // 직접 조종 입력
    let input = null;
    if (m.possessId) {
      const u = this.findUnit(m.possessId);
      if (!u) { m.lostT += dt; if (m.lostT > 1.2) this.exitPossess('💀 전사했습니다! 지휘 모드로 복귀'); }
      else m.lostT = 0;
      const k = this.keys;
      let fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      let str = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      if (Touch.axis.x || Touch.axis.y) { fwd = Touch.axis.y; str = Touch.axis.x; }
      const sy = Math.sin(m.camYaw), cy = Math.cos(m.camYaw);
      const mx = sy * fwd - cy * str, mz = cy * fwd + sy * str;
      const aim = this.r.updateFollowCamera(m.possessId, m.camYaw, m.camPitch);
      if (aim) {
        const r2 = v => Math.round(v * 100) / 100;
        input = { mx: r2(mx), mz: r2(mz), yaw: r2(m.camYaw), ox: r2(aim.o.x), oy: r2(aim.o.y), oz: r2(aim.o.z), dx: r2(aim.d.x), dy: r2(aim.d.y), dz: r2(aim.d.z), fire: m.fire && (this.pointerLocked || this.noLock) };
      }
    } else {
      // 지휘(RTS) 카메라 이동
      const k = this.keys, sp = this.r.cam.dist * 0.9 * dt;
      const fz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      const fx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      if (fx || fz) this.r.panCamera(fx * sp, fz * sp);
    }

    if (m.sim) {
      if (!m.paused) {
        if (input) m.sim.command(m.mySide, { c: 'input', i: input });
        m.acc += dt;
        while (m.acc >= 1 / 30) {
          m.sim.step(1 / 30);
          if (m.ai) m.ai.update(1 / 30);
          m.acc -= 1 / 30;
        }
      }
      const evs = m.sim.events;
      m.sim.events = [];
      for (const e of evs) this.handleEvent(e);
      if (m.mode === 'host') {
        m.snapT -= dt;
        if (Net.mode === 'room') {
          // 아티팩트: 압축 스냅샷을 presence 로 (이벤트는 게스트가 재구성)
          if (m.snapT <= 0) { m.snapT = 0.1; Net.send({ type: 'snapRoom', r: RoomCodec.encode(m.sim) }); }
        } else {
          m.pending.push(...evs);
          if (m.snapT <= 0) {
            m.snapT = 0.066;
            Net.send({ type: 'snap', s: m.sim.snapshot(m.pending) });
            m.pending = [];
          }
        }
      }
      this.r.sync(m.sim.units, m.sim.sides, dt);
    } else {
      if (input) {
        m.inputT -= dt;
        if (m.inputT <= 0) { m.inputT = 0.05; Net.send({ type: 'cmd', c: { c: 'input', i: input } }); }
      }
      if (m.view) this.r.sync(m.view.units, m.view.sides, dt);
    }
    if (!this.match) return;
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }
  },
};

window.addEventListener('load', () => App.init());
