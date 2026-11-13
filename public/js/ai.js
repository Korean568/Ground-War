// ===== 학습형 AI =====
// - 경기 중: 상대가 현재 보유한 병력 구성을 관찰해 상성으로 대응
// - 경기 전: 플레이어(개인) + 전체 플레이어들의 과거 전략 데이터를 학습해 미리 대비
// - 난이도(0~10): 수입, 화력, 판단 속도, 학습 활용도가 올라감
function aiSideParams(diff) {
  if (diff <= 0) return { money: 0, mulIncome: 0.25, mulDmg: 0.4 }; // 튜토리얼
  return { money: diff * 180, mulIncome: 0.3 + diff * 0.09, mulDmg: 0.5 + diff * 0.055 };
}

class AIController {
  constructor(sim, side, diff, model) {
    this.sim = sim; this.side = side; this.diff = diff;
    this.model = model || buildStrategyModel(null, null);
    this.timer = 1.5;
    this.saving = null;
    this.mode = 'defend';
    this.plan = this.makePlan();
  }

  // 경기 시작 전 학습 데이터로 세운 전략 (화면에 표시됨)
  makePlan() {
    const m = this.model, d = this.diff;
    const learnW = d <= 0 ? 0 : Math.min(0.85, 0.15 + d * 0.07) * m.confidence;
    const plan = { learnW, notes: [], counter: null, earlyDefense: false, factories: 0 };
    if (d <= 0) { plan.notes.push('튜토리얼 AI: 소극적으로 보병만 사용합니다.'); return plan; }
    // 선호 병과 → 대응 유닛
    const p = m.pref;
    if (m.confidence > 0.05) {
      const top = p.air >= p.armor && p.air >= p.inf ? 'air' : (p.armor >= p.inf ? 'armor' : 'inf');
      plan.counter = { air: 'apc', armor: 'heli', inf: 'tank' }[top];
      const catName = { air: '공중', armor: '기갑', inf: '보병' }[top];
      plan.notes.push(`상대는 ${catName} 병과를 선호 (${Math.round(p[top] * 100)}%) → ${UNIT_TYPES[plan.counter].name} 위주로 대응`);
      if (m.favorite) plan.notes.push(`가장 자주 쓰는 유닛: ${UNIT_TYPES[m.favorite].name}`);
      if (m.rushRate > 0.4) { plan.earlyDefense = true; plan.notes.push(`초반 러시 성향 (평균 ${Math.round(m.firstAttack)}초에 공격) → 초반 수비 강화`); }
      else plan.notes.push(`평균 ${Math.round(m.firstAttack)}초에 첫 공격 → 그 전에 경제 확장`);
      if (m.possessRate > 0.5) plan.notes.push('직접 참전을 즐겨함 → 사령관 호위 강화');
    } else {
      plan.notes.push('학습 데이터 부족: 경기 중 실시간으로 패턴을 분석합니다.');
    }
    plan.factories = Math.min(GAME.FACTORY_MAX, Math.round(1 + d * 0.5 + (plan.earlyDefense ? -1 : 0.5)));
    plan.notes.push(`학습 활용도 ${Math.round(learnW * 100)}% · 난이도 ${d}`);
    return plan;
  }

  update(dt) {
    if (this.sim.over) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.diff <= 0 ? 5 : Math.max(0.7, 3.4 - this.diff * 0.27);
    this.think();
  }

  strength(side) {
    let s = 0;
    for (const u of this.sim.units) {
      if (!u.alive || u.side !== side || u.type === 'commander') continue;
      const T = UNIT_TYPES[u.type];
      s += Math.sqrt(u.hp * (T.dmg / T.rate) * 3);
    }
    return s;
  }

  think() {
    const sim = this.sim, me = this.side, foe = 1 - me, S = sim.sides[me], d = this.diff;
    const buy = t => sim.command(me, { c: 'buy', t }) === 'ok';

    // --- 튜토리얼(쉬움) AI ---
    // 튜토리얼 AI: 보병 소수만, 절대 먼저 공격하지 않음
    if (d <= 0) {
      if (sim.armyCount(me) < 6 && Math.random() < 0.4) buy('infantry');
      sim.command(me, { c: 'stance', v: 'defend' });
      return;
    }

    // 무료 보병
    if (S.infCd <= 0 && Math.random() < 0.3 + d * 0.06) buy('infantry');

    // 관찰: 상대 병력 구성 (분류별 체력 비중)
    const obs = { inf: 0, armor: 0, air: 0 };
    let total = 0;
    for (const u of sim.units) {
      if (!u.alive || u.side !== foe || u.type === 'commander') continue;
      const w = u.maxHp;
      obs[UNIT_TYPES[u.type].cat] += w; total += w;
    }
    const lw = this.plan.learnW;
    const pred = {};
    for (const c of ['inf', 'armor', 'air']) {
      const o = total > 0 ? obs[c] / total : 0.34;
      pred[c] = o * (1 - lw * 0.6) + this.model.pref[c] * lw * 0.6;
    }

    // 경제(타이쿤): 공장 건설
    const earlyThreat = this.plan.earlyDefense && sim.t < this.model.firstAttack + 25;
    const wantFac = earlyThreat ? Math.min(1, this.plan.factories) : this.plan.factories;
    if (S.factories < wantFac && S.money > factoryCost(S.factories) + (earlyThreat ? 300 : 80)) {
      sim.command(me, { c: 'factory' });
    }

    // 유닛 선택: 상성 점수 × 가치
    const scores = {};
    for (const t of BUY_ORDER) {
      if (t === 'infantry') continue;
      const mul = DMG_MUL[t];
      let sc = pred.inf * mul.inf + pred.armor * mul.armor + pred.air * mul.air;
      if (t === 'medic') sc = 0.55 + (sim.armyCount(me) > 6 ? 0.3 : 0);
      if (t === this.plan.counter) sc *= 1 + lw;
      sc *= 1 + Math.log10(UNIT_TYPES[t].cost + 10) * 0.12;
      scores[t] = sc * (0.85 + Math.random() * 0.3);
    }
    const ranked = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
    const best = ranked[0];
    const reserve = earlyThreat ? 0 : 50;
    if (UNIT_TYPES[best].cost <= S.money - reserve) {
      buy(best); this.saving = null;
    } else if (d >= 4 && UNIT_TYPES[best].cost <= S.money + sim.income(me) * 25) {
      this.saving = best; // 돈을 모아서 최적 유닛 구매
    } else {
      for (const t of ranked) if (UNIT_TYPES[t].cost <= S.money - reserve && Math.random() < 0.7) { buy(t); break; }
    }

    // 공세/수비 판단
    const mine = this.strength(me), theirs = this.strength(foe);
    const myCmd = sim.commander(me);
    let threatened = false;
    if (myCmd) for (const u of sim.units) if (u.alive && u.side === foe && Math.hypot(u.x - myCmd.x, u.z - myCmd.z) < 35) threatened = true;
    const aggr = 2.1 - d * 0.1; // 낮은 난이도는 압도적으로 강할 때만 공격
    const minArmy = Math.max(4, 10 - d);
    const grace = Math.max(0, 75 - d * 7); // 초반 준비 시간 (난이도 낮을수록 김)
    if (threatened && mine < theirs * 1.2) this.mode = 'defend';
    else if (sim.t > grace && mine > theirs * aggr + 20 && sim.armyCount(me) >= minArmy) this.mode = 'attack';
    else if (mine < theirs * 0.75) this.mode = 'defend';
    if (earlyThreat && mine < theirs * 2 + 40) this.mode = 'defend';
    sim.command(me, { c: 'stance', v: this.mode });
  }
}
