// ===== 국가 전쟁: 게임 설정 =====
// cat: inf(보병류) / armor(기갑) / air(공중)
const UNIT_TYPES = {
  infantry:  { name: '보병',     icon: '🪖', cost: 0,    hp: 50,  speed: 5.0, range: 22, dmg: 7,  rate: 1.0,  cat: 'inf',   hitAir: true,  radius: 0.8, height: 1.4, key: '1', desc: '기본 병사 (무료, 쿨타임)' },
  medic:     { name: '의무병',   icon: '⛑️', cost: 100,  hp: 150, speed: 5.0, range: 16, dmg: 4,  rate: 1.2,  cat: 'inf',   hitAir: true,  radius: 0.8, height: 1.4, key: '2', heal: 7, healRange: 11, desc: '주변 아군 치료' },
  tank:      { name: '탱크병',   icon: '🛡️', cost: 100,  hp: 100, speed: 3.6, range: 28, dmg: 26, rate: 2.4,  cat: 'armor', hitAir: false, radius: 2.2, height: 1.4, key: '3', splash: 4, desc: '범위 포격 (공중 공격 불가)' },
  heli:      { name: '헬기병',   icon: '🚁', cost: 500,  hp: 250, speed: 8.0, range: 26, dmg: 11, rate: 0.5,  cat: 'air',   hitAir: true,  radius: 2.6, height: 0.6, key: '4', fly: 10, desc: '빠른 공중 유닛, 기갑에 강함' },
  apc:       { name: '장갑차병', icon: '🚙', cost: 1000, hp: 500, speed: 5.5, range: 24, dmg: 6,  rate: 0.22, cat: 'armor', hitAir: true,  radius: 2.3, height: 1.9, key: '5', desc: '튼튼함, 대공 기관총' },
  sniper:    { name: '저격수',   icon: '🎯', cost: 5000, hp: 50,  speed: 4.0, range: 65, dmg: 95, rate: 3.2,  cat: 'inf',   hitAir: true,  radius: 0.8, height: 1.4, key: '6', desc: '초장거리 일격필살' },
  commander: { name: '사령관',   icon: '⭐', cost: 0,    hp: 100, speed: 4.5, range: 22, dmg: 12, rate: 1.1,  cat: 'inf',   hitAir: true,  radius: 0.9, height: 1.6, desc: '죽으면 패배!' },
};
const BUY_ORDER = ['infantry', 'medic', 'tank', 'heli', 'apc', 'sniper'];
const TYPE_LIST = ['infantry', 'medic', 'tank', 'heli', 'apc', 'sniper', 'commander'];

// 공격자 유형 → 대상 분류별 피해 배율 (상성)
const DMG_MUL = {
  infantry:  { inf: 1.0, armor: 0.4, air: 0.6 },
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
  eco:   { name: '경제 개발', icon: '💰', desc: '기본 수입 +20%', max: 5 },
  armor: { name: '장갑 강화', icon: '🧱', desc: '모든 유닛 체력 +10%', max: 5 },
  fire:  { name: '화력 강화', icon: '🔥', desc: '모든 유닛 공격력 +10%', max: 5 },
};
function upgradeCost(lvl) { return 2000 * (lvl + 1); }

const SIDE_COLORS = [0x2f6fdc, 0xd8352f];
const SIDE_CSS = ['#3b82f6', '#ef4444'];
