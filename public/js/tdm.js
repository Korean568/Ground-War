// ===== 팀 데스매치 / 언덕 위의 왕 =====
// 직접 전투(3인칭 슈팅), 사령관 없음, 점수가 높은 팀 승리, 최소 50명(봇 포함)
const TDM = {
  TEAM_SIZE: 25,
  TIME: 240,
  SCORE_LIMIT: 80,
  RESPAWN: 4,
  PROTECT: 2,
  HP: 100,
  SPEED: 6.2,
  HILL: { x: 0, z: 0, r: 9, h: 0.35, cap: 5, bonus: 10 },
  WPN: ['rifle', 'smg', 'shotgun', 'sniper', 'lmg', 'rpg'],
  WEAPONS: {
    rifle:   { name: '돌격소총',  icon: '🔫', dmg: 24, rate: 0.13, range: 60,  spread: 0.025, mag: 30, reload: 2.0, auto: true,  speed: 1.0,  cls: 'mid',   fx: 'infantry', desc: '만능 자동소총' },
    smg:     { name: '기관단총',  icon: '💨', dmg: 16, rate: 0.075, range: 32, spread: 0.05, mag: 35, reload: 1.6, auto: true,  speed: 1.15, cls: 'close', fx: 'infantry', desc: '빠른 연사, 근접전' },
    shotgun: { name: '산탄총',    icon: '💥', dmg: 13, rate: 0.85, range: 18,  spread: 0.11, mag: 6,  reload: 2.4, pellets: 8, speed: 1.05, cls: 'close', fx: 'infantry', desc: '근거리 일격' },
    sniper:  { name: '저격소총',  icon: '🎯', dmg: 90, rate: 1.3,  range: 130, spread: 0.002, mag: 5, reload: 2.8, zoom: 3.2, speed: 0.9, cls: 'long', fx: 'sniper', head: 2.5, desc: '헤드샷 즉사, 원거리' },
    lmg:     { name: '경기관총',  icon: '🔥', dmg: 19, rate: 0.095, range: 65, spread: 0.04, mag: 80, reload: 4.2, auto: true,  speed: 0.85, cls: 'mid',   fx: 'apc', desc: '대용량 탄창, 제압' },
    rpg:     { name: '로켓발사기', icon: '🚀', dmg: 120, rate: 1.4, range: 85, spread: 0.01, mag: 1, reload: 2.8, splash: 5.5, speed: 0.9, cls: 'long', fx: 'tank', desc: '범위 폭발' },
  },
  // 엄폐물 [x, z, 폭, 깊이, 높이]  (z 대칭으로 복제됨)
  MAP_HALF: [
    [-18, 26, 10, 1, 3], [18, 26, 10, 1, 3], [0, 46, 14, 1, 3],
    [-8, 36, 2.6, 2.6, 1.7], [8, 36, 2.6, 2.6, 1.7], [-28, 13, 2.6, 2.6, 1.7], [28, 13, 2.6, 2.6, 1.7],
    [-25, 56, 3, 3, 1.7], [25, 56, 3, 3, 1.7], [-10, 63, 2.6, 2.6, 1.7], [10, 63, 2.6, 2.6, 1.7],
    [-13, 74, 5, 1, 1.0], [13, 74, 5, 1, 1.0], [0, 70, 5, 1, 1.0],
    [-6, 12, 5, 1, 1.0], [6, 12, 5, 1, 1.0], [-14, 6, 1, 5, 1.6], [14, 6, 1, 5, 1.6],
  ],
  MAP_MID: [[-30, 0, 7, 9, 4], [30, 0, 7, 9, 4]],
};
TDM.BOXES = (() => {
  const out = [];
  const add = (x, z, w, d, h) => out.push({ x, z, w, d, h, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
  for (const b of TDM.MAP_HALF) { add(b[0], b[1], b[2], b[3], b[4]); add(b[0], -b[1], b[2], b[3], b[4]); }
  for (const b of TDM.MAP_MID) add(b[0], b[1], b[2], b[3], b[4]);
  return out;
})();
const BOT_NAMES = ['독수리', '번개', '호랑이', '늑대', '매', '곰', '여우', '표범', '상어', '코브라', '바람', '천둥', '유령', '불꽃', '강철', '그림자', '사자', '황소', '전갈', '돌풍', '레이븐', '팔콘', '바이퍼', '카이저', '블레이드',
  '해일', '폭풍', '용', '들소', '재규어', '맹금', '화산', '빙하', '철벽', '탱고', '알파', '브라보', '델타', '에코', '폭스', '고스트', '스톰', '타이탄', '퓨마', '하운드', '불사조', '검독수리', '흑표', '백곰', '은빛여우'];
const botName = id => 'AI ' + BOT_NAMES[(id - 1) % BOT_NAMES.length];

// ---------- 공용 물리 ----------
const TdmPhys = {
  collide(p, r = 0.5) {
    for (const b of TDM.BOXES) {
      const cx = Math.max(b.x0, Math.min(b.x1, p.x)), cz = Math.max(b.z0, Math.min(b.z1, p.z));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
        else { // 박스 내부: 가장 가까운 면으로
          const opts = [[b.x0 - r - p.x, 0], [b.x1 + r - p.x, 0], [0, b.z0 - r - p.z], [0, b.z1 + r - p.z]];
          opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
          p.x += opts[0][0]; p.z += opts[0][1];
        }
      }
    }
    p.x = Math.max(-34, Math.min(34, p.x));
    p.z = Math.max(-97, Math.min(97, p.z));
  },
  // 레이 vs 박스 → 거리 (없으면 Infinity)
  rayBoxes(o, d, maxT) {
    let best = maxT;
    for (const b of TDM.BOXES) {
      let t0 = 0, t1 = best;
      const ax = [[o.x, d.x, b.x0, b.x1], [o.y, d.y, 0, b.h], [o.z, d.z, b.z0, b.z1]];
      let ok = true;
      for (const [oo, dd, lo, hi] of ax) {
        if (Math.abs(dd) < 1e-8) { if (oo < lo || oo > hi) { ok = false; break; } continue; }
        let ta = (lo - oo) / dd, tb = (hi - oo) / dd;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 < best) best = t0;
    }
    return best;
  },
  raySphere(o, d, cx, cy, cz, r) {
    const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
    const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r;
    const h = b * b - c;
    if (h < 0) return Infinity;
    const t = -b - Math.sqrt(h);
    return t >= 0 ? t : Infinity;
  },
  dir(yaw, pitch) { const cp = Math.cos(pitch); return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: Math.cos(yaw) * cp }; },
  onHill(x, z) { return Math.hypot(x - TDM.HILL.x, z - TDM.HILL.z) < TDM.HILL.r; },
};

// ---------- 학습: 플레이어 패턴 ----------
const TdmLearn = {
  empty() { return { matches: 0, wpn: {}, lane: [0, 0, 0], hill: 0, hillN: 0, dist: 0, distN: 0 }; },
  personal() { if (!Profile.data.learnTdm) Profile.data.learnTdm = this.empty(); return Profile.data.learnTdm; },
  // presence 로 공유하는 짧은 요약
  summary(L) {
    L = L || this.personal();
    const tot = Object.values(L.wpn).reduce((a, b) => a + b, 0) || 1;
    const lt = L.lane.reduce((a, b) => a + b, 0) || 1;
    return { m: L.matches, w: TDM.WPN.map(k => Math.round((L.wpn[k] || 0) / tot * 100)), l: L.lane.map(v => Math.round(v / lt * 100)), h: L.hillN ? Math.round(L.hill / L.hillN * 100) : 0, d: L.distN ? Math.round(L.dist / L.distN) : 35 };
  },
  // 여러 사람의 요약을 합쳐 봇이 쓰는 모델
  model(sums) {
    const m = { n: 0, w: TDM.WPN.map(() => 0), l: [0, 0, 0], h: 0, d: 0 };
    let wsum = 0;
    for (const s of sums) {
      if (!s || !Array.isArray(s.w) || !s.m || !s.w.some(v => v > 0)) continue;
      const k = Math.min(1, (s.m || 1) / 5) + 0.2;
      s.w.forEach((v, i) => { m.w[i] += (Number(v) || 0) * k; });
      (s.l || []).forEach((v, i) => { if (i < 3) m.l[i] += (Number(v) || 0) * k; });
      m.h += (Number(s.h) || 0) * k; m.d += (Number(s.d) || 35) * k; wsum += k; m.n += s.m || 1;
    }
    if (!wsum) return null;
    const wt = m.w.reduce((a, b) => a + b, 0) || 1, lt = m.l.reduce((a, b) => a + b, 0) || 1;
    m.w = m.w.map(v => v / wt); m.l = m.l.map(v => v / lt); m.h /= wsum * 100; m.d /= wsum;
    const cls = { close: 0, mid: 0, long: 0 };
    TDM.WPN.forEach((k, i) => { cls[TDM.WEAPONS[k].cls] += m.w[i]; });
    m.cls = cls;
    m.fav = TDM.WPN[m.w.indexOf(Math.max(...m.w))];
    return m;
  },
  // 모델을 보고 봇 무기 비율 결정 (상성 대응)
  botWeights(model, diff) {
    const base = { rifle: 3, smg: 1.5, shotgun: 1, sniper: 1, lmg: 1.5, rpg: 0.7 };
    if (!model || diff <= 0) return base;
    const k = Math.min(1.5, 0.4 + diff * 0.12);
    const c = model.cls;
    base.smg += c.long * 4 * k; base.shotgun += c.long * 2.5 * k;          // 저격 많으면 근접 돌격
    base.rifle += c.close * 3 * k; base.lmg += c.close * 3 * k; base.sniper += c.close * 1.5 * k; // 근접이면 거리 유지
    base.sniper += c.mid * 1.5 * k; base.rpg += c.mid * 1 * k;
    base.rpg += model.h * 3 * k;                                           // 거점 집착이면 로켓
    return base;
  },
  analysisText(model, diff) {
    if (!model) return ['학습 데이터 부족: 경기 중 실시간으로 패턴을 분석합니다.'];
    const W = TDM.WEAPONS, out = [];
    out.push(`플레이어들이 가장 많이 쓰는 무기: ${W[model.fav].icon} ${W[model.fav].name} (${Math.round(Math.max(...model.w) * 100)}%)`);
    const c = model.cls;
    if (c.long > 0.35) out.push('원거리 선호 → AI는 기관단총·산탄총으로 측면 돌파');
    else if (c.close > 0.4) out.push('근접전 선호 → AI는 소총·경기관총으로 거리 유지');
    else out.push('중거리 선호 → AI는 저격·로켓으로 견제');
    const lane = ['왼쪽', '중앙', '오른쪽'][model.l.indexOf(Math.max(...model.l))];
    out.push(`자주 다니는 길: ${lane} → AI가 그 길을 집중 방어`);
    if (model.h > 0.3) out.push('거점 점령을 좋아함 → 로켓 부대 배치');
    out.push(`분석한 경기 수 ${model.n} · AI 난이도 ${diff}`);
    return out;
  },
};

// ---------- 시뮬레이션 (호스트에서만 실행) ----------
class TdmSim {
  // humans: [{peer, name, team}], teams: [countryIdx, countryIdx]
  constructor(opts) {
    this.mode = opts.mode; this.teams = opts.teams; this.diff = opts.diff;
    this.model = opts.model;
    this.t = 0; this.score = [0, 0]; this.over = false; this.winner = -1;
    this.events = []; this.kills = []; this.killSeq = 0; this.booms = []; this.boomSeq = 0;
    this.hill = { owner: -1, prog: [0, 0], contested: false };
    this.proj = [];
    this.soldiers = [];
    this.weights = TdmLearn.botWeights(this.model, this.diff);
    let id = 1;
    for (let team = 0; team < 2; team++) {
      const hs = opts.humans.filter(h => h.team === team);
      for (let i = 0; i < TDM.TEAM_SIZE; i++) {
        const h = hs[i];
        const sid = id++;
        const s = { id: sid, team, human: h ? h.peer : null, name: h ? h.name : botName(sid), kills: 0, deaths: 0, fc: 0, alive: false, respawnT: 0.1 + i * 0.05, hp: 0 };
        s.wpn = h ? (h.wpn || 'rifle') : this.pickWeapon();
        s.bot = h ? null : this.newBrain(s);
        this.soldiers.push(s);
      }
    }
    for (const h of opts.humans) if (h.team > 1) this.addHuman(h);
  }
  get byId() { if (!this._by) { this._by = new Map(); } return this._by; }
  find(id) { return this.soldiers.find(s => s.id === id); }
  findHuman(peer) { return this.soldiers.find(s => s.human === peer); }
  humanCount(team) { return this.soldiers.filter(s => s.team === team && s.human).length; }
  // 경기 중 합류: 사람이 적은 팀의 봇 자리를 차지
  addHuman(h) {
    const team = this.humanCount(0) <= this.humanCount(1) ? 0 : 1;
    const s = this.soldiers.find(x => x.team === team && !x.human) || this.soldiers.find(x => !x.human);
    if (!s) return null;
    s.human = h.peer; s.name = h.name; s.bot = null; s.wpn = h.wpn || 'rifle';
    return s;
  }
  removeHuman(peer) {
    const s = this.findHuman(peer);
    if (!s) return;
    s.human = null; s.name = botName(s.id); s.bot = this.newBrain(s);
  }
  pickWeapon() {
    const w = this.weights; let tot = 0;
    for (const k in w) tot += w[k];
    let r = Math.random() * tot;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return 'rifle';
  }
  newBrain(s) {
    const d = this.diff;
    // 사람들이 자주 다니는 길에 봇을 더 배치
    const L = this.model ? this.model.l : [1 / 3, 1 / 3, 1 / 3];
    const r = Math.random(); const lane = r < L[0] * 0.6 + 0.13 ? 0 : r < (L[0] + L[1]) * 0.6 + 0.27 ? 1 : 2;
    return {
      lane, laneX: [-20, 0, 20][lane] + (Math.random() - 0.5) * 8,
      react: Math.max(0.18, 0.75 - d * 0.055), err: Math.max(0.012, 0.075 - d * 0.0065),
      think: Math.random() * 0.3, target: 0, seenT: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 1,
      aimYaw: 0, aimPitch: 0, hillBot: Math.random() < 0.6, nade: Math.random() < 0.25 + d * 0.05,
    };
  }
  spawnPos(team) {
    const z = team === 0 ? 86 : -86;
    return { x: (Math.random() - 0.5) * 40, z: z + (Math.random() - 0.5) * 8 };
  }
  respawn(s) {
    const p = this.spawnPos(s.team);
    Object.assign(s, { x: p.x, z: p.z, y: 0, yaw: s.team === 0 ? Math.PI : 0, pitch: 0, hp: TDM.HP, alive: true, prot: TDM.PROTECT, cd: 0, gren: 2 });
    const W = TDM.WEAPONS[s.wpn];
    s.ammo = W.mag; s.reloadT = 0;
    if (!s.human) { s.wpn = this.pickWeapon(); s.ammo = TDM.WEAPONS[s.wpn].mag; s.bot = Object.assign(s.bot || this.newBrain(s), { target: 0, seenT: 0 }); }
    this.events.push({ k: 'spawn', id: s.id, side: s.team });
  }

  // ---- 사람 입력 (로컬 호스트 또는 원격 게스트) ----
  humanState(peer, st) {
    const s = this.findHuman(peer);
    if (!s || !s.alive || !st) return;
    const nx = Number(st.x), nz = Number(st.z);
    if (isFinite(nx) && isFinite(nz) && Math.hypot(nx - s.x, nz - s.z) < 12) { s.x = nx; s.z = nz; TdmPhys.collide(s); }
    if (isFinite(st.yaw)) s.yaw = Number(st.yaw);
    if (isFinite(st.pitch)) s.pitch = Number(st.pitch);
    if (st.wpn && TDM.WEAPONS[st.wpn]) s.wpn = st.wpn;
    s.y = TdmPhys.onHill(s.x, s.z) && this.mode === 'koth' ? TDM.HILL.h : 0;
  }
  humanShot(peer, sh) {
    const s = this.findHuman(peer);
    if (!s || !s.alive || !sh) return;
    const now = this.t;
    const W = TDM.WEAPONS[sh.w] || TDM.WEAPONS[s.wpn];
    if (s.lastShot && now - s.lastShot < W.rate * 0.6) return;
    s.lastShot = now;
    const o = { x: Number(sh.ox), y: Number(sh.oy), z: Number(sh.oz) };
    if (![o.x, o.y, o.z].every(isFinite) || Math.hypot(o.x - s.x, o.z - s.z) > 9) return;
    this.fire(s, o, { x: Number(sh.dx), y: Number(sh.dy), z: Number(sh.dz) }, sh.w || s.wpn, 0);
  }
  humanGrenade(peer, g) {
    const s = this.findHuman(peer);
    if (!s || !s.alive) return;
    this.throwGrenade(s, Number(g.yaw) || s.yaw, Number(g.pitch) || 0);
  }

  // ---- 전투 ----
  fire(s, o, d, wpn, extraErr) {
    const W = TDM.WEAPONS[wpn];
    s.fc = (s.fc + 1) & 255; s.lastWpn = wpn;
    const n = W.pellets || 1;
    let lastEnd = null;
    for (let p = 0; p < n; p++) {
      const sp = W.spread + extraErr;
      let dx = d.x + (Math.random() - 0.5) * sp * 2, dy = d.y + (Math.random() - 0.5) * sp * 2, dz = d.z + (Math.random() - 0.5) * sp * 2;
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      const dir = { x: dx, y: dy, z: dz };
      const maxT = W.range * 1.4;
      let best = TdmPhys.rayBoxes(o, dir, maxT), hit = null, head = false;
      if (dir.y < -1e-4) best = Math.min(best, -o.y / dir.y);
      for (const e of this.soldiers) {
        if (!e.alive || e === s || e.team === s.team) continue;
        if (Math.abs(e.x - o.x) > maxT || Math.abs(e.z - o.z) > maxT) continue;
        const tb = TdmPhys.raySphere(o, dir, e.x, e.y + 1.05, e.z, 0.55);
        const th = TdmPhys.raySphere(o, dir, e.x, e.y + 1.62, e.z, 0.27);
        const t = Math.min(tb, th);
        if (t < best) { best = t; hit = e; head = th <= tb; }
      }
      const end = { x: o.x + dir.x * best, y: o.y + dir.y * best, z: o.z + dir.z * best };
      lastEnd = end;
      if (W.splash) {
        this.boom(end.x, end.y, end.z, 1.2);
        for (const e of this.soldiers) {
          if (!e.alive || e.team === s.team) continue;
          const dd = Math.hypot(e.x - end.x, e.y + 1 - end.y, e.z - end.z);
          if (dd < W.splash) this.damage(e, W.dmg * (1 - dd / W.splash * 0.7), s, wpn, false);
        }
      } else if (hit) {
        const dist = Math.hypot(hit.x - s.x, hit.z - s.z);
        let dmg = W.dmg * (dist > W.range ? 0.55 : 1) * (head ? (W.head || 1.6) : 1);
        this.damage(hit, dmg, s, wpn, head);
        if (s.human) { s.hitT = this.t; s.hitHead = head; }
      }
    }
    const eye = { x: s.x, y: s.y + 1.5, z: s.z };
    this.events.push({ k: 'shot', t: W.fx, a: [eye.x, eye.y, eye.z], b: [lastEnd.x, lastEnd.y, lastEnd.z], by: s.id });
  }
  throwGrenade(s, yaw, pitch) {
    if (!(s.gren > 0)) return;
    s.gren--;
    const d = TdmPhys.dir(yaw, Math.min(0.9, pitch + 0.35));
    this.proj.push({ x: s.x, y: s.y + 1.6, z: s.z, vx: d.x * 17, vy: d.y * 17 + 2, vz: d.z * 17, fuse: 2.0, owner: s.id });
  }
  boom(x, y, z, s) {
    this.boomSeq++;
    this.booms.push([this.boomSeq, Math.round(x * 10) / 10, Math.round(Math.max(0, y) * 10) / 10, Math.round(z * 10) / 10, s]);
    if (this.booms.length > 6) this.booms.shift();
    this.events.push({ k: 'boom', x, y, z, s });
  }
  damage(e, dmg, src, wpn, head) {
    if (!e.alive || e.prot > 0 || this.over) return;
    e.hp -= dmg;
    e.lastHitBy = src.id; e.lastHitT = this.t;
    if (e.bot && !e.bot.target) { e.bot.target = src.id; e.bot.seenT = this.t; }
    if (e.hp > 0) return;
    e.hp = 0; e.alive = false; e.respawnT = TDM.RESPAWN; e.deaths++;
    src.kills++;
    this.score[src.team]++;
    this.killSeq++;
    this.kills.push([this.killSeq, src.id, e.id, TDM.WPN.indexOf(wpn), head ? 1 : 0]);
    if (this.kills.length > 8) this.kills.shift();
    if (src.human) { src.dists = (src.dists || 0) + Math.hypot(e.x - src.x, e.z - src.z); src.distN = (src.distN || 0) + 1; }
    this.events.push({ k: 'die', id: e.id, t: e.wpn === 'sniper' ? 'sniper' : 'infantry', side: e.team, x: e.x, y: e.y, z: e.z, by: 'infantry', ks: src.team, killer: src.id, wpn, head });
  }

  // ---- 봇 ----
  visible(a, b) {
    const o = { x: a.x, y: a.y + 1.5, z: a.z };
    const tx = b.x - o.x, ty = b.y + 1.2 - o.y, tz = b.z - o.z, L = Math.hypot(tx, ty, tz);
    if (L < 0.01) return true;
    return TdmPhys.rayBoxes(o, { x: tx / L, y: ty / L, z: tz / L }, L) >= L - 0.3;
  }
  updateBot(s, dt) {
    const b = s.bot, W = TDM.WEAPONS[s.wpn];
    b.think -= dt;
    if (b.think <= 0) {
      b.think = 0.2 + Math.random() * 0.15;
      // 표적 찾기
      let best = null, bd = W.range * 1.35;
      const cur = b.target ? this.find(b.target) : null;
      for (const e of this.soldiers) {
        if (!e.alive || e.team === s.team) continue;
        const d = Math.hypot(e.x - s.x, e.z - s.z);
        if (d > bd) continue;
        // 시야각: 앞쪽 140도 (최근에 맞았으면 무시)
        const ang = Math.abs(((Math.atan2(e.x - s.x, e.z - s.z) - s.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        if (ang > 1.25 && !(cur === e) && this.t - (s.lastHitT || -9) > 2) continue;
        if (!this.visible(s, e)) continue;
        bd = d; best = e;
      }
      if (best) {
        if (b.target !== best.id) { b.target = best.id; b.reactLeft = b.react * (0.7 + Math.random() * 0.6); }
        b.seenT = this.t; b.vis = true;
      } else {
        b.vis = false;
        if (this.t - b.seenT > 3) b.target = 0;
      }
      // 수류탄: 보이지 않는 근처 적
      if (b.nade && s.gren > 0 && cur && !b.vis && Math.random() < 0.06) {
        const d = Math.hypot(cur.x - s.x, cur.z - s.z);
        if (d > 10 && d < 24) this.throwGrenade(s, Math.atan2(cur.x - s.x, cur.z - s.z), 0.1);
      }
      if (Math.random() < 0.2) b.strafe = -b.strafe;
    }
    const tgt = b.target ? this.find(b.target) : null;
    // 목적지
    const f = s.team === 0 ? -1 : 1;
    let gx = b.laneX, gz = -f * -95 * -1; // 적 기지 방향
    gz = s.team === 0 ? -80 : 80;
    if (this.mode === 'koth' && b.hillBot && (this.hill.owner !== s.team || this.hill.contested || Math.random() < 0.002)) { gx = TDM.HILL.x + (Math.random() - 0.5) * 2; gz = TDM.HILL.z; }
    if (s.hp < 35 && !tgt) { gz = s.team === 0 ? 70 : -70; }
    let mx = 0, mz = 0;
    if (tgt && tgt.alive) {
      const dx = tgt.x - s.x, dz = tgt.z - s.z, d = Math.hypot(dx, dz) || 1;
      const want = W.cls === 'close' ? 8 : W.cls === 'long' ? W.range * 0.6 : 22;
      const fwd = d > want + 4 ? 1 : d < want - 4 ? -0.6 : 0;
      mx = dx / d * fwd + (dz / d) * b.strafe * 0.8; mz = dz / d * fwd - (dx / d) * b.strafe * 0.8;
      if (b.vis) {
        // 조준 (오차 + 반응 시간)
        const tYaw = Math.atan2(dx, dz), tPitch = Math.atan2(tgt.y + 1.2 - (s.y + 1.5), d);
        let dy = tYaw - s.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        s.yaw += dy * Math.min(1, dt * 7);
        s.pitch = tPitch;
        b.reactLeft = (b.reactLeft || 0) - dt;
        if (b.reactLeft <= 0 && Math.abs(dy) < 0.25 && s.cd <= 0 && s.reloadT <= 0 && d < W.range * 1.3) {
          const o = { x: s.x, y: s.y + 1.5, z: s.z };
          this.fire(s, o, TdmPhys.dir(s.yaw, s.pitch), s.wpn, b.err * (1 + d / 60));
          s.cd = W.rate * (W.auto ? 1.15 : 1.4) + Math.random() * 0.05;
          s.ammo--;
          if (s.ammo <= 0) s.reloadT = W.reload;
        }
      }
    } else {
      const dx = gx - s.x, dz = gz - s.z, d = Math.hypot(dx, dz);
      if (d > 2) { mx = dx / d; mz = dz / d; s.yaw = Math.atan2(mx, mz); s.pitch = 0; }
      if (s.ammo < W.mag * 0.5 && s.reloadT <= 0) s.reloadT = W.reload;
    }
    const l = Math.hypot(mx, mz);
    if (l > 0.01) {
      const sp = TDM.SPEED * 0.85 * W.speed * dt / Math.max(1, l);
      const px = s.x, pz = s.z;
      s.x += mx * sp; s.z += mz * sp;
      TdmPhys.collide(s);
      // 막혔으면 옆으로 미끄러지기
      if (Math.hypot(s.x - px, s.z - pz) < sp * 0.3) { s.x += mz * sp * b.strafe; s.z -= mx * sp * b.strafe; TdmPhys.collide(s); }
    }
    s.y = this.mode === 'koth' && TdmPhys.onHill(s.x, s.z) ? TDM.HILL.h : 0;
  }

  step(dt) {
    if (this.over) return;
    this.t += dt;
    for (const s of this.soldiers) {
      if (!s.alive) { s.respawnT -= dt; if (s.respawnT <= 0) this.respawn(s); continue; }
      if (s.prot > 0) s.prot -= dt;
      if (s.cd > 0) s.cd -= dt;
      if (s.reloadT > 0) { s.reloadT -= dt; if (s.reloadT <= 0) s.ammo = TDM.WEAPONS[s.wpn].mag; }
      if (s.bot) this.updateBot(s, dt);
      else if (s.human) { // 사람 패턴 기록 (경기 중 학습)
        s.laneT = s.laneT || [0, 0, 0];
        s.laneT[s.x < -10 ? 0 : s.x > 10 ? 2 : 1] += dt;
        s.wpnT = s.wpnT || {}; s.wpnT[s.wpn] = (s.wpnT[s.wpn] || 0) + dt;
        if (TdmPhys.onHill(s.x, s.z)) s.hillT = (s.hillT || 0) + dt;
      }
    }
    // 수류탄
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i];
      p.vy -= 20 * dt;
      const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
      const t = { x: nx, z: nz }; TdmPhys.collide(t, 0.2);
      if (t.x !== nx) p.vx *= -0.4; if (t.z !== nz) p.vz *= -0.4;
      p.x = t.x; p.z = t.z; p.y += p.vy * dt;
      if (p.y < 0.15) { p.y = 0.15; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.fuse -= dt;
      if (p.fuse <= 0) {
        this.proj.splice(i, 1);
        this.boom(p.x, p.y, p.z, 1.6);
        const src = this.find(p.owner);
        if (src) for (const e of this.soldiers) {
          if (!e.alive || (e.team === src.team && e !== src)) continue;
          const d = Math.hypot(e.x - p.x, e.z - p.z);
          if (d < 7) this.damage(e, 110 * (1 - d / 7), src, 'rpg', false);
        }
      }
    }
    // 언덕 위의 왕: 거점
    if (this.mode === 'koth') {
      const n = [0, 0];
      for (const s of this.soldiers) if (s.alive && TdmPhys.onHill(s.x, s.z)) n[s.team]++;
      const H = this.hill;
      H.contested = n[0] > 0 && n[1] > 0;
      if (!H.contested) {
        const team = n[0] > 0 ? 0 : n[1] > 0 ? 1 : -1;
        if (team >= 0 && H.owner !== team) {
          H.prog[team] += dt * Math.min(3, 0.6 + n[team] * 0.4);
          H.prog[1 - team] = Math.max(0, H.prog[1 - team] - dt);
          if (H.prog[team] >= TDM.HILL.cap) {
            H.owner = team; H.prog = [0, 0];
            this.score[team] += TDM.HILL.bonus;
            this.events.push({ k: 'cap', team });
            this.capSeq = (this.capSeq || 0) + 1; this.lastCap = team;
          }
        } else if (team < 0) { H.prog[0] = Math.max(0, H.prog[0] - dt * 0.5); H.prog[1] = Math.max(0, H.prog[1] - dt * 0.5); }
      }
    }
    if (this.t >= TDM.TIME || this.score[0] >= TDM.SCORE_LIMIT || this.score[1] >= TDM.SCORE_LIMIT) {
      this.over = true;
      this.winner = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : -1;
      this.events.push({ k: 'over', w: this.winner });
    }
  }

  // 사람들의 경기 중 패턴을 모아 봇 무기 비율 갱신 (실시간 학습)
  relearn(extraSums) {
    const sums = [...(extraSums || [])];
    for (const s of this.soldiers) if (s.human && s.wpnT) {
      const tot = Object.values(s.wpnT).reduce((a, b) => a + b, 0) || 1;
      const lt = s.laneT.reduce((a, b) => a + b, 0) || 1;
      sums.push({ m: 3, w: TDM.WPN.map(k => Math.round((s.wpnT[k] || 0) / tot * 100)), l: s.laneT.map(v => Math.round(v / lt * 100)), h: Math.round((s.hillT || 0) / this.t * 100), d: s.distN ? s.dists / s.distN : 35 });
    }
    const m = TdmLearn.model(sums);
    if (m) { this.model = m; this.weights = TdmLearn.botWeights(m, this.diff); }
  }

  // ---- 네트워크 스냅샷 (presence 4KB 이하) ----
  encode() {
    const buf = new Uint8Array(this.soldiers.length * 15), dv = new DataView(buf.buffer);
    this.soldiers.forEach((s, i) => {
      const o = i * 15;
      dv.setUint8(o, s.id);
      dv.setUint8(o + 1, s.team | (s.alive ? 2 : 0) | (s.human ? 4 : 0) | (TDM.WPN.indexOf(s.wpn) << 3));
      dv.setInt16(o + 2, Math.round((s.x || 0) * 100));
      dv.setInt16(o + 4, Math.round((s.z || 0) * 100));
      let yw = (s.yaw || 0) % (Math.PI * 2); if (yw < 0) yw += Math.PI * 2;
      dv.setUint8(o + 6, Math.round(yw / (Math.PI * 2) * 256) & 255);
      dv.setInt8(o + 7, Math.max(-127, Math.min(127, Math.round((s.pitch || 0) * 100))));
      dv.setUint8(o + 8, Math.max(0, Math.ceil(s.hp || 0)));
      dv.setUint8(o + 9, s.fc & 255);
      dv.setUint8(o + 10, Math.min(255, s.kills));
      dv.setUint8(o + 11, Math.min(255, s.deaths));
      dv.setUint8(o + 12, Math.min(255, Math.ceil(Math.max(0, s.respawnT || 0) * 10)));
      dv.setUint8(o + 13, (s.prot > 0 ? 1 : 0) | ((s.gren || 0) << 1));
      dv.setUint8(o + 14, s.y > 0.1 ? 1 : 0);
    });
    return {
      q: Math.round(this.t * 10), u: RoomCodec.chunk(RoomCodec.b64(buf)), sc: this.score.slice(),
      k: this.kills.slice(), b: this.booms.slice(),
      h: this.mode === 'koth' ? [this.hill.owner, Math.round(this.hill.prog[0] * 10), Math.round(this.hill.prog[1] * 10), this.hill.contested ? 1 : 0] : null,
      g: this.proj.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10]),
      hn: this.soldiers.filter(s => s.human).map(s => [s.id, s.human, String(s.name).slice(0, 14)]),
      o: this.over ? 1 : 0, w: this.winner,
    };
  }
}

// 스냅샷 해석 (게스트) → 렌더/HUD 용 상태 + 이벤트 재구성
const TdmCodec = {
  newState() { return { fc: new Map(), alive: new Map(), pos: new Map(), kill: 0, boom: 0, first: true }; },
  decode(p, st) {
    const bytes = RoomCodec.unb64((p.u || []).join('')), dv = new DataView(bytes.buffer);
    const n = Math.floor(bytes.length / 15), sol = [];
    const names = new Map((p.hn || []).map(a => [a[0], a]));
    for (let i = 0; i < n; i++) {
      const o = i * 15, f = dv.getUint8(o + 1), id = dv.getUint8(o);
      const hn = names.get(id);
      sol.push({
        id, team: f & 1, alive: !!(f & 2), human: hn ? hn[1] : null, wpn: TDM.WPN[f >> 3] || 'rifle',
        x: dv.getInt16(o + 2) / 100, z: dv.getInt16(o + 4) / 100, yaw: dv.getUint8(o + 6) / 256 * Math.PI * 2,
        pitch: dv.getInt8(o + 7) / 100, hp: dv.getUint8(o + 8), fc: dv.getUint8(o + 9), kills: dv.getUint8(o + 10),
        deaths: dv.getUint8(o + 11), respawnT: dv.getUint8(o + 12) / 10, prot: dv.getUint8(o + 13) & 1, gren: dv.getUint8(o + 13) >> 1,
        y: dv.getUint8(o + 14) ? TDM.HILL.h : 0, name: hn ? hn[2] : botName(id),
      });
    }
    const ev = [];
    for (const s of sol) {
      const pf = st.fc.get(s.id);
      if (pf !== undefined && pf !== s.fc && s.alive) {
        const W = TDM.WEAPONS[s.wpn], d = TdmPhys.dir(s.yaw, s.pitch);
        const a = [s.x, s.y + 1.5, s.z];
        let L = Math.min(W.range, 45);
        const bt = TdmPhys.rayBoxes({ x: a[0], y: a[1], z: a[2] }, d, L); L = Math.min(L, bt);
        ev.push({ k: 'shot', t: W.fx, a, b: [a[0] + d.x * L, a[1] + d.y * L, a[2] + d.z * L], by: s.id });
      }
      st.fc.set(s.id, s.fc);
      if (s.alive) st.pos.set(s.id, s);
    }
    for (const k of (p.k || [])) {
      if (k[0] <= st.kill) continue;
      st.kill = k[0];
      if (st.first) continue;
      const v = st.pos.get(k[2]) || { x: 0, y: 0, z: 0, team: 0, wpn: 'rifle' };
      const killer = sol.find(x => x.id === k[1]);
      ev.push({ k: 'die', id: k[2], t: v.wpn === 'sniper' ? 'sniper' : 'infantry', side: v.team, x: v.x, y: v.y, z: v.z, by: 'infantry', ks: killer ? killer.team : 0, killer: k[1], wpn: TDM.WPN[k[3]], head: !!k[4] });
    }
    for (const b of (p.b || [])) {
      if (b[0] <= st.boom) continue;
      st.boom = b[0];
      if (!st.first) ev.push({ k: 'boom', x: b[1], y: b[2], z: b[3], s: b[4] });
    }
    st.first = false;
    return { t: (p.q || 0) / 10, soldiers: sol, score: p.sc || [0, 0], hill: p.h, nades: p.g || [], over: !!p.o, winner: p.w, ev };
  },
};
