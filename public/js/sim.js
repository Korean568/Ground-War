// ===== 전투 시뮬레이션 (호스트/AI 대전에서 실행되는 권위 있는 게임 상태) =====
class Sim {
  // sides: [{ name, money, upg, mulDmg, mulIncome }, ...]
  constructor(sides) {
    this.t = 0;
    this.units = [];
    this.nextId = 1;
    this.events = [];
    this.over = false;
    this.winner = -1;
    this.sides = sides.map(s => ({
      name: s.name, money: s.money, upg: Object.assign({ eco: 0, armor: 0, fire: 0 }, s.upg || {}),
      mulDmg: s.mulDmg || 1, mulIncome: s.mulIncome || 1,
      factories: 0, infCd: 0, stance: 'defend', kills: 0, lost: 0, ctrlId: 0, input: null,
      stats: { buy: {}, factories: 0, firstAttack: -1, possess: 0 },
    }));
    for (let s = 0; s < 2; s++) this.spawn(s, 'commander');
  }

  baseZ(side) { return side === 0 ? GAME.BASE_Z : -GAME.BASE_Z; }
  fwd(side) { return side === 0 ? -1 : 1; }
  income(side) {
    const S = this.sides[side];
    return (GAME.BASE_INCOME * (1 + 0.2 * S.upg.eco) + S.factories * GAME.FACTORY_INCOME) * S.mulIncome;
  }
  armyCount(side) {
    let n = 0;
    for (const u of this.units) if (u.alive && u.side === side && u.type !== 'commander') n++;
    return n;
  }
  findUnit(id) { for (const u of this.units) if (u.id === id) return u; return null; }
  commander(side) { for (const u of this.units) if (u.alive && u.side === side && u.type === 'commander') return u; return null; }

  spawn(side, type) {
    const T = UNIT_TYPES[type];
    const S = this.sides[side];
    const bz = this.baseZ(side), f = this.fwd(side);
    const maxHp = T.hp * (1 + 0.1 * S.upg.armor);
    const u = {
      id: this.nextId++, type, side, alive: true, ctrl: false,
      x: (Math.random() - 0.5) * 24, y: T.fly || 0, z: bz + f * 6,
      yaw: side === 0 ? Math.PI : 0, hp: maxHp, maxHp, cd: Math.random(),
      laneX: (Math.random() - 0.5) * 50, healT: 0, fc: 0, tid: 0,
    };
    if (type === 'commander') { u.x = 0; u.z = bz - f * 3; u.laneX = 0; }
    this.units.push(u);
    this.events.push({ k: 'spawn', id: u.id, side, t: type });
    return u;
  }

  // 명령 처리. 성공 시 'ok', 실패 시 사유 반환
  command(side, c) {
    const S = this.sides[side];
    if (this.over) return 'over';
    switch (c.c) {
      case 'buy': {
        const T = UNIT_TYPES[c.t];
        if (!T || c.t === 'commander') return 'bad';
        if (this.armyCount(side) >= GAME.UNIT_CAP) return 'cap';
        if (c.t === 'infantry') {
          if (S.infCd > 0) return 'cooldown';
          S.infCd = GAME.INF_COOLDOWN;
        } else {
          if (S.money < T.cost) return 'money';
          S.money -= T.cost;
        }
        S.stats.buy[c.t] = (S.stats.buy[c.t] || 0) + 1;
        this.spawn(side, c.t);
        return 'ok';
      }
      case 'factory': {
        if (S.factories >= GAME.FACTORY_MAX) return 'max';
        const cost = factoryCost(S.factories);
        if (S.money < cost) return 'money';
        S.money -= cost; S.factories++; S.stats.factories++;
        this.events.push({ k: 'factory', side, n: S.factories });
        return 'ok';
      }
      case 'stance':
        S.stance = c.v === 'attack' ? 'attack' : 'defend';
        if (S.stance === 'attack' && S.stats.firstAttack < 0) S.stats.firstAttack = Math.round(this.t);
        return 'ok';
      case 'possess': {
        const u = this.findUnit(c.id);
        if (!u || !u.alive || u.side !== side) return 'bad';
        this.release(side);
        u.ctrl = true; S.ctrlId = u.id; S.input = null; S.stats.possess++;
        return 'ok';
      }
      case 'unpossess':
        this.release(side);
        return 'ok';
      case 'surrender': {
        const c = this.commander(side);
        this.over = true; this.winner = 1 - side;
        if (c) { c.alive = false; this.events.push({ k: 'die', id: c.id, t: 'commander', side, x: c.x, y: c.y, z: c.z, by: 'commander', ks: 1 - side }); this.logDeath(c, 'commander', 1 - side); }
        this.events.push({ k: 'over', w: 1 - side, surrender: side });
        return 'ok';
      }
      case 'input':
        S.input = c.i;
        return 'ok';
    }
    return 'bad';
  }
  release(side) {
    const S = this.sides[side];
    const u = this.findUnit(S.ctrlId);
    if (u) u.ctrl = false;
    S.ctrlId = 0; S.input = null;
  }

  step(dt) {
    if (this.over) return;
    this.t += dt;
    for (let s = 0; s < 2; s++) {
      const S = this.sides[s];
      S.money += this.income(s) * dt;
      if (S.infCd > 0) S.infCd = Math.max(0, S.infCd - dt);
    }
    const units = this.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.alive) this.updateUnit(u, dt);
      if (this.over) break;
    }
    for (let i = units.length - 1; i >= 0; i--) if (!units[i].alive) units.splice(i, 1);
  }

  updateUnit(u, dt) {
    const T = UNIT_TYPES[u.type];
    const S = this.sides[u.side];
    u.cd -= dt;

    // 의무병: 주변 아군 치료
    if (T.heal) {
      let best = null, br = 1;
      for (const a of this.units) {
        if (!a.alive || a.side !== u.side || a.hp >= a.maxHp) continue;
        const d = Math.hypot(a.x - u.x, a.z - u.z);
        if (d > T.healRange) continue;
        const r = a.hp / a.maxHp;
        if (r < br) { br = r; best = a; }
      }
      if (best) {
        best.hp = Math.min(best.maxHp, best.hp + T.heal * dt);
        u.healT -= dt;
        if (u.healT <= 0) { u.healT = 1; this.events.push({ k: 'heal', a: u.id, b: best.id }); }
      }
    }

    // 엘리트 유닛: 체력 자동 회복
    if (T.regen && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + T.regen * dt);

    if (u.ctrl) { this.updateControlled(u, T, S.input, dt); return; }

    // 가장 가까운 적 탐색 + 아군 밀어내기
    let tgt = null, bd = 1e9, px = 0, pz = 0;
    for (const e of this.units) {
      if (!e.alive || e === u) continue;
      const dx = e.x - u.x, dz = e.z - u.z;
      const d = Math.hypot(dx, dz);
      if (e.side === u.side) {
        const ET = UNIT_TYPES[e.type];
        if (!!ET.fly !== !!T.fly) continue;
        const rr = (T.radius + ET.radius) * 1.1;
        if (d < rr && d > 0.001) { const k = (rr - d) / rr; px -= dx / d * k; pz -= dz / d * k; }
        continue;
      }
      if (!T.hitAir && UNIT_TYPES[e.type].fly) continue;
      if (d < bd) { bd = d; tgt = e; }
    }

    const sight = Math.max(T.range + 12, 34);
    const bz = this.baseZ(u.side), f = this.fwd(u.side);
    let mx = null, mz = null, stopDist = 1.5;

    if (tgt && bd <= T.range) {
      u.yaw = Math.atan2(tgt.x - u.x, tgt.z - u.z);
      if (u.cd <= 0) this.fire(u, tgt, T, false);
    } else if (u.type === 'commander') {
      const hx = 0, hz = bz - f * 3;
      if (tgt && bd < sight && Math.hypot(tgt.x - hx, tgt.z - hz) < 28) { mx = tgt.x; mz = tgt.z; stopDist = T.range * 0.8; }
      else { mx = hx; mz = hz; }
    } else if (tgt && bd < sight && (S.stance === 'attack' || Math.abs(tgt.z - bz) < 65)) {
      mx = tgt.x; mz = tgt.z; stopDist = T.range * 0.85;
    } else if (S.stance === 'attack') {
      const ec = this.commander(1 - u.side);
      mx = ec ? ec.x + u.laneX * 0.3 : u.laneX; mz = ec ? ec.z : this.baseZ(1 - u.side);
      stopDist = T.range * 0.8;
    } else {
      mx = u.laneX * 0.8; mz = bz + f * (u.type === 'sniper' ? 12 : 25);
    }

    let vx = 0, vz = 0;
    if (mx !== null) {
      const dx = mx - u.x, dz = mz - u.z, d = Math.hypot(dx, dz);
      if (d > stopDist) {
        vx = dx / d; vz = dz / d;
        u.yaw = Math.atan2(vx, vz);
      }
    }
    vx += px * 1.5; vz += pz * 1.5;
    const sp = T.speed;
    u.x += vx * sp * dt; u.z += vz * sp * dt;
    this.clamp(u);
  }

  clamp(u) {
    const hw = GAME.MAP_W / 2, hz = GAME.BASE_Z + 14;
    u.x = Math.max(-hw, Math.min(hw, u.x));
    u.z = Math.max(-hz, Math.min(hz, u.z));
  }

  // 플레이어가 직접 조종하는 유닛
  updateControlled(u, T, inp, dt) {
    if (!inp) return;
    let mx = inp.mx || 0, mz = inp.mz || 0;
    const l = Math.hypot(mx, mz);
    if (l > 0.01) {
      mx /= l; mz /= l;
      u.x += mx * T.speed * 1.25 * dt; u.z += mz * T.speed * 1.25 * dt;
      this.clamp(u);
    }
    if (typeof inp.yaw === 'number') u.yaw = inp.yaw;
    if (inp.fire && u.cd <= 0) this.heroFire(u, T, inp);
  }

  heroFire(u, T, inp) {
    const o = { x: inp.ox, y: inp.oy, z: inp.oz };
    let d = { x: inp.dx, y: inp.dy, z: inp.dz };
    const dl = Math.hypot(d.x, d.y, d.z) || 1;
    d = { x: d.x / dl, y: d.y / dl, z: d.z / dl };
    let best = null, bp = 1e9;
    for (const e of this.units) {
      if (!e.alive || e.side === u.side) continue;
      const ET = UNIT_TYPES[e.type];
      if (!T.hitAir && ET.fly) continue;
      if (Math.hypot(e.x - u.x, e.z - u.z) > T.range * 1.3) continue;
      const vx = e.x - o.x, vy = e.y + ET.height * 0.6 - o.y, vz = e.z - o.z;
      const proj = vx * d.x + vy * d.y + vz * d.z;
      if (proj < 0) continue;
      const px = vx - d.x * proj, py = vy - d.y * proj, pz = vz - d.z * proj;
      const perp = Math.hypot(px, py, pz);
      if (perp > ET.radius * 1.3 + 0.6) continue;
      if (proj < bp) { bp = proj; best = e; }
    }
    if (best) { this.fire(u, best, T, true); return; }
    // 빗나감
    u.cd = T.rate * 0.8;
    u.fc = (u.fc + 1) & 255; u.tid = 0;
    const uy = u.y + T.height;
    let L = T.range + 8;
    if (d.y < -0.01) L = Math.min(L, -o.y / d.y);
    const end = { x: o.x + d.x * L, y: Math.max(0, o.y + d.y * L), z: o.z + d.z * L };
    this.events.push({ k: 'shot', t: u.type, a: [u.x, uy, u.z], b: [end.x, end.y, end.z] });
    if (T.splash && end.y < 0.5 && Math.hypot(end.x - u.x, end.z - u.z) < T.range * 1.4) {
      this.events.push({ k: 'boom', x: end.x, y: 0, z: end.z, s: 1 });
      this.splash(u, end.x, end.z, T, null, true);
    }
  }

  dmgFor(u, target, T, hero) {
    const S = this.sides[u.side];
    const mul = DMG_MUL[u.type][UNIT_TYPES[target.type].cat];
    return T.dmg * mul * (1 + 0.1 * S.upg.fire) * S.mulDmg * (hero ? GAME.HERO_BONUS : 1) * (0.85 + Math.random() * 0.3);
  }

  fire(u, tgt, T, hero) {
    u.cd = T.rate * (hero ? 0.8 : (0.9 + Math.random() * 0.2));
    u.fc = (u.fc + 1) & 255; u.tid = tgt.id;
    const TT = UNIT_TYPES[tgt.type];
    this.events.push({ k: 'shot', t: u.type, a: [u.x, u.y + T.height, u.z], b: [tgt.x, tgt.y + TT.height * 0.6, tgt.z] });
    if (T.splash) {
      this.events.push({ k: 'boom', x: tgt.x, y: tgt.y, z: tgt.z, s: 1 });
      this.damage(tgt, this.dmgFor(u, tgt, T, hero), u);
      this.splash(u, tgt.x, tgt.z, T, tgt, hero);
    } else {
      this.damage(tgt, this.dmgFor(u, tgt, T, hero), u);
    }
  }

  splash(u, x, z, T, except, hero) {
    for (const e of this.units) {
      if (!e.alive || e.side === u.side || e === except || UNIT_TYPES[e.type].fly) continue;
      if (Math.hypot(e.x - x, e.z - z) < T.splash) this.damage(e, this.dmgFor(u, e, T, hero) * 0.5, u);
    }
  }

  damage(e, dmg, src) {
    if (!e.alive || this.over) return;
    e.hp -= dmg;
    if (e.hp > 0) return;
    e.hp = 0; e.alive = false;
    const ks = src.side;
    this.sides[ks].money += GAME.KILL_REWARD;
    this.sides[ks].kills++;
    this.sides[e.side].lost++;
    if (e.ctrl) this.release(e.side);
    this.events.push({ k: 'die', id: e.id, t: e.type, side: e.side, x: e.x, y: e.y, z: e.z, by: src.type, ks });
    this.logDeath(e, src.type, ks);
    if (e.type === 'commander') {
      this.over = true;
      this.winner = ks;
      this.events.push({ k: 'over', w: ks });
    }
  }

  // 최근 사망 기록 (아티팩트 멀티플레이 동기화용)
  logDeath(e, byType, ks) {
    this.deathSeq = (this.deathSeq || 0) + 1;
    this.deathLog = this.deathLog || [];
    this.deathLog.push([this.deathSeq, e.id, TYPE_LIST.indexOf(e.type), e.side, Math.round(e.x * 10) / 10, Math.round(e.z * 10) / 10, Math.round(e.y), ks, TYPE_LIST.indexOf(byType)]);
    if (this.deathLog.length > 12) this.deathLog.shift();
  }

  // ----- 네트워크 동기화용 스냅샷 -----
  snapshot(events) {
    const r = v => Math.round(v * 10) / 10;
    return {
      t: r(this.t),
      u: this.units.filter(u => u.alive).map(u => [u.id, TYPE_LIST.indexOf(u.type), u.side, r(u.x), r(u.y), r(u.z), Math.ceil(u.hp), Math.round(u.maxHp), Math.round(u.yaw * 100) / 100, u.ctrl ? 1 : 0]),
      s: this.sides.map((S, i) => ({ m: Math.floor(S.money), i: Math.round(this.income(i) * 10) / 10, f: S.factories, c: Math.round(S.infCd * 10) / 10, st: S.stance, k: S.kills, l: S.lost, ctrl: S.ctrlId })),
      ev: events.map(e => {
        const o = Object.assign({}, e);
        if (o.a) o.a = o.a.map(r);
        if (o.b) o.b = o.b.map(r);
        if (o.x !== undefined) { o.x = r(o.x); o.y = r(o.y); o.z = r(o.z); }
        return o;
      }),
      over: this.over, w: this.winner,
    };
  }
}

// 스냅샷 → 렌더링용 상태 (게스트 측)
function decodeSnapshot(snap) {
  return {
    t: snap.t,
    units: snap.u.map(a => ({ id: a[0], type: TYPE_LIST[a[1]], side: a[2], x: a[3], y: a[4], z: a[5], hp: a[6], maxHp: a[7], yaw: a[8], ctrl: !!a[9], alive: true })),
    sides: snap.s.map(s => ({ money: s.m, inc: s.i, factories: s.f, infCd: s.c, stance: s.st, kills: s.k, lost: s.l, ctrlId: s.ctrl })),
    over: snap.over, winner: snap.w,
  };
}
