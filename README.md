# Ground Wars

3D multiplayer war tycoon game (browser, Three.js)

## ▶ Play now: https://korean568.github.io/Ground-War/

The game follows your browser language: Korean browsers get Korean, everything else gets English.

[한국어 설명은 아래에 있습니다.](#한국어)

- Works on PC and mobile (landscape recommended on mobile; switch Mobile Mode from the menu)
- Web multiplayer: players who open the same page connect peer-to-peer (WebRTC). Pick the same mode at the same time as your friend.
  (Some school or office networks block P2P. If so, run the server below.)

## How to run

1. Install [Node.js](https://nodejs.org)
2. Double-click `게임실행.bat` (or run `npm install` then `npm start` in a terminal)
3. Open `http://localhost:3000` in your browser
4. **Friends on the same Wi-Fi** can join at the `http://192.168.x.x:3000` address shown in the server window and get matched with you.

> Opening `public/index.html` directly lets you play against the AI, but multiplayer needs the server.

### Multiplayer in the artifact (claude.ai) version

1. Invite your friend from the artifact's **Share** menu. (People who open a public link can't connect live.)
2. Your friend opens the link while **signed in** to claude.ai.
3. Both of you press **"Find Match"** at the same time to connect. (No opponent within 30 seconds → you play the AI.)

Local test: start the server and open `http://localhost:3000/artifact.html?mockroom` in two tabs to match the same way.

## Rules

| Unit | Cost | HP | Notes |
|---|---|---|---|
| 🪖 Infantry | Free (3s cooldown) | 50 | Basic soldier |
| ⛑️ Medic | G$10 | 150 | Heals nearby allies |
| 🛡️ Tank | G$50 | 100 | Splash damage, can't hit air |
| 🚁 Heli | G$100 | 250 | Fast, strong vs armor |
| 🚙 APC | G$500 | 300 | Tough, anti-air |
| 🎯 Sniper | G$1000 | 50 | Extreme range, one-shot kills |
| 🎖️ Legendary K-Marine | G$5000 | 75 | Rapid fire, regenerates HP |
| 🦅 Legendary K-Marine turned Special Forces | G$10000 | 75 | Long-range fire + grenades, fast regen |
| ⭐ Commander | Starting unit | 100 | **If it dies, you lose** |

- Each kill: **G$50** / Win: **G$10,000** (G$ = Ground Dollars)
- Money keeps piling up in your wallet (tycoon). Build **factories** during a match to raise income, and buy permanent **Base Upgrades** from the menu.
- **Join the fight**: click an ally, press `F` → WASD move, mouse aim, click to fire, `Q` to return
- If no opponent is found within 15 seconds, you play the **learning AI**
  - The AI learns from your past matches and every player's matches on the server: favorite units, first-attack timing and economy, then counters them
  - AI level rises with your level and win streak (1–10)
- First-time players start with the **tutorial** (easy AI)

## Team modes (main menu)

- **🎯 Team Deathmatch**: fight in person, no commander. 25 vs 25 (empty slots are AI). 1 point per kill; the round ends when a team reaches 250 points (or after 10 minutes), and the higher score wins.
- **⛰️ King of the Hill**: same rules, plus **+10 points** for capturing the hill in the middle (retaking it gives another +10), and the team holding it earns **+1 point per second** (paused while contested).
- Teams are 2 random countries out of 38 (flags drawn automatically). The first player joins the first country drawn; later players alternate.
- 6 weapons: Assault Rifle · SMG · Shotgun · Sniper Rifle · LMG · Rocket Launcher + grenades (G)
- 2 special classes (HP 75): 🎖️ K-Marine (strong rifle, fast, regen) · 🦅 Spec Ops (precise suppressed rifle, 4 grenades)
- Maps (random each match): Plains · City Streets · Desert Ruins · Snowfield. The commander mode also gets a random battlefield look.
- The AI learns players' weapon picks, routes and hill tactics, then picks counter weapons and lanes.
- Controls: WASD, Shift sprint, click to fire, right-click aim, R reload, G grenade, 1–8 weapons, Tab scoreboard

## Controls

| Key | Action |
|---|---|
| 1–8 | Build units |
| E | Build factory |
| Z / X | Attack / Defend |
| F / Q | Join fight / Return |
| WASD, wheel, right-drag | Camera |
| ESC | Menu / Surrender |

---

## 한국어

3D 멀티플레이 전쟁 타이쿤 게임 (브라우저, Three.js)

게임 화면은 브라우저 언어를 따릅니다. 한국어 브라우저는 한국어, 그 외에는 영어로 표시됩니다.

- PC와 모바일 모두 지원 (모바일은 가로 화면 권장, 메뉴에서 모바일 모드 전환 가능)
- 웹 버전 멀티플레이: 같은 페이지를 연 사람끼리 P2P(WebRTC)로 연결됩니다. 친구와 동시에 같은 모드를 고르세요.
  (일부 학교/회사 네트워크는 P2P 연결을 막을 수 있어요. 그럴 땐 아래 서버 실행 방법을 쓰세요.)

### 실행 방법

1. [Node.js](https://nodejs.org) 설치
2. `게임실행.bat` 더블클릭 (또는 터미널에서 `npm install` 후 `npm start`)
3. 브라우저에서 `http://localhost:3000` 접속
4. **같은 와이파이의 친구**는 서버 창에 표시된 `http://192.168.x.x:3000` 주소로 접속하면 서로 매칭됩니다.

> `public/index.html`을 직접 열어도 AI 대전은 가능하지만, 멀티플레이는 서버가 필요합니다.

#### 아티팩트(claude.ai) 버전에서 친구와 멀티플레이

1. 아티팩트의 **공유(Share)** 메뉴에서 친구를 초대합니다. (공개 링크로 들어온 사람은 실시간 연결이 안 됩니다)
2. 친구는 claude.ai에 **로그인**한 상태로 링크를 엽니다.
3. 두 사람이 **동시에 "매칭 시작"**을 누르면 연결됩니다. (30초 안에 상대가 없으면 AI와 대전)

로컬 테스트: 서버 실행 후 `http://localhost:3000/artifact.html?mockroom` 을 탭 두 개로 열면 같은 방식으로 매칭됩니다.

### 게임 규칙

| 병과 | 가격 | HP | 특징 |
|---|---|---|---|
| 🪖 보병 | 무료 (3초 쿨타임) | 50 | 기본 병사 |
| ⛑️ 의무병 | G$10 | 150 | 주변 아군 치료 |
| 🛡️ 탱크병 | G$50 | 탱크 100 | 범위 포격, 공중 공격 불가 |
| 🚁 헬기병 | G$100 | 헬기 250 | 빠름, 기갑에 강함 |
| 🚙 장갑차병 | G$500 | 장갑차 300 | 튼튼함, 대공 |
| 🎯 저격수 | G$1000 | 50 | 초장거리 일격 |
| 🎖️ 전설의 K-해병대원 | G$5000 | 75 | 빠른 연사, 체력 자동 회복 |
| 🦅 특전사가 된 전설의 K-해병대원 | G$10000 | 75 | 장거리 정밀 사격 + 수류탄, 빠른 회복 |
| ⭐ 사령관 | 기본 | 100 | **죽으면 패배** |

- 적 1명 처치: **G$50** / 승리: **G$10,000** (G$ = 그라운드 달러)
- 돈은 지갑에 계속 쌓이며(타이쿤), 경기 중 **공장**을 지어 수입을 늘리고, 메뉴의 **기지 업그레이드**로 영구 강화
- **직접 참전**: 아군 클릭 후 `F` → WASD 이동, 마우스 조준, 클릭 사격, `Q` 복귀
- 매칭 15초 안에 상대가 없으면 **학습형 AI**와 대전
  - AI는 내 과거 경기 + 서버의 모든 플레이어 경기에서 선호 병과 / 첫 공격 타이밍 / 경제 운영을 학습해 대응
  - 레벨과 연승이 오를수록 AI 난이도 상승 (1~10)
- 처음 하는 사람은 자동으로 **튜토리얼**(쉬운 AI) 진행

### 팀 모드 (메인 메뉴)

- **🎯 팀 데스매치**: 사령관 없이 직접 전투. 25 vs 25 (빈 자리는 AI). 처치 1점, 한 팀이 250점을 내면 라운드 끝 (최대 10분), 점수 높은 팀 승리.
- **⛰️ 언덕 위의 왕**: 같은 규칙 + 가운데 거점을 점령하면 **+10점** (빼앗아도 다시 +10점), 거점을 차지한 팀은 **초당 +1점** (교전 중엔 멈춤).
- 팀은 세계 38개국 중 랜덤 2개국(국기 자동 생성). 첫 사람은 먼저 뽑힌 국가, 이후 사람은 번갈아 배정.
- 무기 6종: 돌격소총 · 기관단총 · 산탄총 · 저격소총 · 경기관총 · 로켓발사기 + 수류탄(G)
- 특수 병과 2종 (체력 75): 🎖️ K-해병대원 (강한 소총, 빠름, 체력 회복) · 🦅 특전사 (소음기 정밀 소총, 수류탄 4개)
- 맵 (경기마다 랜덤): 평원 전장 · 시가전 도시 · 사막 유적 · 설원 기지. 국가 전쟁 모드도 전장 모습이 랜덤으로 바뀜.
- AI는 플레이어들의 무기 선택·이동 경로·거점 공략 패턴을 학습해 상성 무기와 길목을 고릅니다.
- 조작: WASD, Shift 달리기, 클릭 사격, 우클릭 조준, R 재장전, G 수류탄, 1~8 무기, Tab 점수판

### 조작

| 키 | 기능 |
|---|---|
| 1~8 | 유닛 생산 |
| E | 공장 건설 |
| Z / X | 공격 / 방어 |
| F / Q | 직접 참전 / 복귀 |
| WASD, 휠, 우클릭 드래그 | 카메라 |
| ESC | 메뉴 / 항복 |
