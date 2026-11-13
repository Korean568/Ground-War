// ===== 플레이어 프로필 (레벨, 지갑, 연승, 학습 데이터) =====
const Profile = {
  data: null,
  KEY: 'nationwar_profile_v1',

  defaults() {
    return {
      name: '', nation: '', money: GAME.START_WALLET, xp: 0,
      wins: 0, losses: 0, streak: 0, bestStreak: 0, kills: 0,
      tutorialDone: false, flag: null,
      upg: { eco: 0, armor: 0, fire: 0 },
      learn: { matches: 0, buy: {}, factories: 0, firstAttackSum: 0, firstAttackN: 0, rushes: 0, possess: 0 },
    };
  },
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { d = null; }
    const def = this.defaults();
    this.data = Object.assign(def, d || {});
    this.data.upg = Object.assign(def.upg, (d && d.upg) || {});
    this.data.learn = Object.assign(this.defaults().learn, (d && d.learn) || {});
    return this.data;
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* 저장 불가 */ } },
  reset() { this.data = this.defaults(); this.save(); },

  isNewbie() { return !this.data.tutorialDone; },
  level() { return Math.floor((1 + Math.sqrt(1 + 0.08 * this.data.xp)) / 2); },
  xpForLevel(L) { return 50 * L * (L - 1); },
  levelProgress() {
    const L = this.level(), a = this.xpForLevel(L), b = this.xpForLevel(L + 1);
    return (this.data.xp - a) / (b - a);
  },
  // 레벨과 연승에 따라 AI 난이도 상승 (1~10)
  aiDifficulty() {
    return Math.max(1, Math.min(10, 1 + Math.floor((this.level() - 1) / 3) + Math.floor(this.data.streak / 2)));
  },

  // 경기에서 플레이어가 보여준 전략을 기록
  recordStrategy(stats) {
    const L = this.data.learn;
    L.matches++;
    for (const k in stats.buy) L.buy[k] = (L.buy[k] || 0) + stats.buy[k];
    L.factories += stats.factories;
    if (stats.firstAttack >= 0) {
      L.firstAttackSum += stats.firstAttack; L.firstAttackN++;
      if (stats.firstAttack < 45) L.rushes++;
    }
    L.possess += stats.possess;
  },
};

// 개인 + 전체 학습 데이터를 합쳐 AI가 쓰는 "전략 모델" 생성
function buildStrategyModel(personal, global) {
  const model = { confidence: 0, pref: { inf: 0.34, armor: 0.33, air: 0.33 }, typePref: {}, firstAttack: 90, rushRate: 0.2, factoryAvg: 1.5, possessRate: 0.3, favorite: null };
  const sources = [];
  if (personal && personal.matches > 0) sources.push([personal, 0.75]);
  if (global && global.matches > 0) sources.push([global, 0.25]);
  if (!sources.length) return model;
  const typeW = {};
  let fa = 0, faW = 0, rush = 0, rushW = 0, fac = 0, facW = 0, pos = 0, posW = 0, conf = 0;
  for (const [s, w] of sources) {
    let tot = 0;
    for (const k in s.buy) tot += s.buy[k];
    if (tot > 0) for (const k in s.buy) typeW[k] = (typeW[k] || 0) + w * s.buy[k] / tot;
    if (s.firstAttackN > 0) { fa += w * s.firstAttackSum / s.firstAttackN; faW += w; rush += w * s.rushes / s.firstAttackN; rushW += w; }
    fac += w * s.factories / s.matches; facW += w;
    pos += w * Math.min(1, s.possess / s.matches); posW += w;
    conf += w * Math.min(1, s.matches / 5);
  }
  model.confidence = conf;
  const cat = { inf: 0.01, armor: 0.01, air: 0.01 };
  let totT = 0;
  for (const k in typeW) totT += typeW[k];
  for (const k in typeW) {
    model.typePref[k] = typeW[k] / totT;
    if (UNIT_TYPES[k]) cat[UNIT_TYPES[k].cat] += typeW[k];
  }
  const ct = cat.inf + cat.armor + cat.air;
  model.pref = { inf: cat.inf / ct, armor: cat.armor / ct, air: cat.air / ct };
  let fav = null, fv = 0;
  for (const k in model.typePref) if (k !== 'infantry' && model.typePref[k] > fv) { fv = model.typePref[k]; fav = k; }
  model.favorite = fav;
  if (faW) { model.firstAttack = fa / faW; model.rushRate = rush / rushW; }
  if (facW) model.factoryAvg = fac / facW;
  if (posW) model.possessRate = pos / posW;
  return model;
}
