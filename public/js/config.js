// ===== 국가 전쟁: 게임 설정 =====
// 언어: 한국어 브라우저 → 한국어, 그 외 → 영어
const LANG = (navigator.language || 'en').toLowerCase().startsWith('ko') ? 'ko' : 'en';
function tr(ko, en) { return LANG === 'ko' ? ko : en; }
// cat: inf(보병류) / armor(기갑) / air(공중)
const UNIT_TYPES = {
  infantry:  { name: tr('보병', 'Infantry'),     icon: '🪖', cost: 0,    hp: 50,  speed: 5.0, range: 22, dmg: 7,  rate: 1.0,  cat: 'inf',   hitAir: true,  radius: 0.8, height: 1.4, key: '1', desc: tr('기본 병사 (무료, 쿨타임)', 'Basic soldier (free, cooldown)') },
  medic:     { name: tr('의무병', 'Medic'),   icon: '⛑️', cost: 10,  hp: 150, speed: 5.0, range: 16, dmg: 4,  rate: 1.2,  cat: 'inf',   hitAir: true,  radius: 0.8, height: 1.4, key: '2', heal: 7, healRange: 11, desc: tr('주변 아군 치료', 'Heals nearby allies') },
  tank:      { name: tr('탱크병', 'Tank'),   icon: '🛡️', cost: 50,  hp: 100, speed: 3.6, range: 28, dmg: 26, rate: 2.4,  cat: 'armor', hitAir: false, radius: 2.2, height: 1.4, key: '3', splash: 4, desc: tr('범위 포격 (공중 공격 불가)', 'Splash damage (no anti-air)') },
  heli:      { name: tr('헬기병', 'Heli'),   icon: '🚁', cost: 100,  hp: 250, speed: 8.0, range: 26, dmg: 11, rate: 0.5,  cat: 'air',   hitAir: true,  radius: 2.6, height: 0.6, key: '4', fly: 10, desc: tr('빠른 공중 유닛, 기갑에 강함', 'Fast air unit, strong vs armor') },
  apc:       { name: tr('장갑차병', 'APC'), icon: '🚙', cost: 500, hp: 300, speed: 5.5, range: 24, dmg: 6,  rate: 0.22, cat: 'armor', hitAir: true,  radius: 2.3, height: 1.9, key: '5', desc: tr('튼튼함, 대공 기관총', 'Tough, anti-air machine gun') },
  sniper:    { name: tr('저격수', 'Sniper'),   icon: '🎯', cost: 1000, hp: 50,  speed: 4.0, range: 65, dmg: 95, rate: 3.2,  cat: 'inf',   hitAir: true,  radius: 0.8, height: 1.4, key: '6', desc: tr('초장거리 일격필살', 'Extreme range, one-shot kills') },
  commander: { name: tr('사령관', 'Commander'),   icon: '⭐', cost: 0,    hp: 100, speed: 4.5, range: 22, dmg: 12, rate: 1.1,  cat: 'inf',   hitAir: true,  radius: 0.9, height: 1.6, desc: tr('죽으면 패배!', 'If it dies, you lose!') },
  // 엘리트 유닛
  marine:    { name: tr('전설의 K-해병대원', 'Legendary K-Marine'), short: tr('K-해병', 'K-Marine'), icon: '🎖️', cost: 5000, hp: 450, speed: 6.0, range: 32, dmg: 24, rate: 0.35, cat: 'inf', hitAir: true, radius: 0.9, height: 1.5, key: '7', regen: 4, desc: tr('누구도 막을 수 없는 전설의 해병. 빠른 연사, 체력 자동 회복', 'An unstoppable legend. Rapid fire, regenerates HP') },
  sf:        { name: tr('특전사가 된 전설의 K-해병대원', 'Legendary K-Marine turned Special Forces'), short: tr('특전사', 'Spec Ops'), icon: '🦅', cost: 10000, hp: 800, speed: 7.0, range: 42, dmg: 42, rate: 0.3, cat: 'inf', hitAir: true, radius: 0.95, height: 1.55, key: '8', regen: 8, splash: 3, desc: tr('전설이 특전사가 되었다. 장거리 정밀 사격 + 수류탄, 빠른 회복', 'The legend joined Special Forces. Long-range precision fire + grenades, fast regen') },
};
const BUY_ORDER = ['infantry', 'medic', 'tank', 'heli', 'apc', 'sniper', 'marine', 'sf'];
const TYPE_LIST = ['infantry', 'medic', 'tank', 'heli', 'apc', 'sniper', 'commander', 'marine', 'sf'];

// 공격자 유형 → 대상 분류별 피해 배율 (상성)
const DMG_MUL = {
  infantry:  { inf: 1.0, armor: 0.4, air: 0.6 },
  marine:    { inf: 1.4, armor: 1.0, air: 1.0 },
  sf:        { inf: 1.5, armor: 1.3, air: 1.2 },
  medic:     { inf: 1.0, armor: 0.3, air: 0.5 },
  tank:      { inf: 1.2, armor: 1.6, air: 0 },
  heli:      { inf: 1.1, armor: 1.6, air: 0.8 },
  apc:       { inf: 1.3, armor: 0.8, air: 2.0 },
  sniper:    { inf: 1.5, armor: 0.6, air: 0.9 },
  commander: { inf: 1.0, armor: 0.5, air: 0.6 },
};

const GAME = {
  BASE_Z: 85,          // 기지 위치 (진영 0: +85, 진영 1: -85)
  MAP_W: 70,           // 전장 폭
  KILL_REWARD: 50,     // 처치 보상
  WIN_REWARD: 10000,   // 승리 보상
  BASE_INCOME: 5,      // 기본 초당 수입
  FACTORY_INCOME: 5,   // 공장 1개당 초당 수입
  FACTORY_MAX: 8,
  INF_COOLDOWN: 3,     // 무료 보병 쿨타임
  UNIT_CAP: 50,
  START_WALLET: 1000,
  HERO_BONUS: 1.25,    // 플레이어가 직접 조종하는 유닛 피해 보너스
};
function factoryCost(n) { return 200 + 200 * n; }

// 영구 업그레이드 (타이쿤 상점)
const UPGRADES = {
  eco:   { name: tr('경제 개발', 'Economy'), icon: '💰', desc: tr('기본 수입 +20%', 'Base income +20%'), max: 5 },
  armor: { name: tr('장갑 강화', 'Armor'), icon: '🧱', desc: tr('모든 유닛 체력 +10%', 'All units HP +10%'), max: 5 },
  fire:  { name: tr('화력 강화', 'Firepower'), icon: '🔥', desc: tr('모든 유닛 공격력 +10%', 'All units damage +10%'), max: 5 },
};
function upgradeCost(lvl) { return 2000 * (lvl + 1); }

const SIDE_COLORS = [0x2f6fdc, 0xd8352f];
const SIDE_CSS = ['#3b82f6', '#ef4444'];
