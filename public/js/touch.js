// ===== 모바일 모드: 터치 조작 =====
// - 지휘(국가 전쟁): 한 손가락 드래그 = 카메라 이동, 두 손가락 = 확대/축소, 탭 = 선택, 두 번 탭 = 직접 조종
// - 직접 전투(참전/팀 모드): 왼쪽 조이스틱 이동, 오른쪽 화면 드래그 시점, 버튼으로 사격·조준·재장전·수류탄
const Touch = {
  on: false,
  axis: { x: 0, y: 0 },
  pref() { try { return localStorage.getItem('nw_mobile') || 'auto'; } catch (e) { return 'auto'; } },
  detect() { return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; },

  init() {
    this.apply();
    this.buildUI();
    this.bindCanvas();
    const b = $('btn-mobile');
    if (b) b.onclick = () => {
      const order = { auto: 'on', on: 'off', off: 'auto' };
      const next = order[this.pref()];
      try { localStorage.setItem('nw_mobile', next); } catch (e) { /* 무시 */ }
      this.apply();
      UI.toast(`📱 모바일 모드: ${{ auto: '자동', on: '켜짐', off: '꺼짐' }[next]}`);
    };
  },
  apply() {
    const p = this.pref();
    this.on = p === 'on' || (p === 'auto' && this.detect());
    document.body.classList.toggle('mobile', this.on);
    if (this.on) App.noLock = true;
    const b = $('btn-mobile');
    if (b) b.textContent = `📱 모바일 모드: ${{ auto: '자동', on: '켜짐', off: '꺼짐' }[p]}${p === 'auto' ? (this.on ? ' (켜짐)' : ' (꺼짐)') : ''}`;
  },

  mode() {
    if (!this.on) return null;
    if (TdmGame.active) return 'tdm';
    if (App.match && App.match.possessId) return 'hero';
    if (App.match) return 'rts';
    return null;
  },

  buildUI() {
    const ui = document.createElement('div');
    ui.id = 'touch-ui';
    ui.innerHTML = `
      <div id="tc-stick-zone"><div id="tc-stick"><div id="tc-knob"></div></div></div>
      <button class="tc-btn" id="tc-fire">🔫</button>
      <button class="tc-btn sm" id="tc-aim">🎯</button>
      <button class="tc-btn sm" id="tc-reload">R</button>
      <button class="tc-btn sm" id="tc-gren">💣</button>
      <button class="tc-btn sm" id="tc-wpn">🔄</button>
      <button class="tc-btn xs" id="tc-board">📊</button>
      <button class="tc-btn xs" id="tc-menu">☰</button>
      <button class="tc-btn sm" id="tc-exit">↩️</button>
      <div id="tc-rotate">📱↻ 가로로 돌리면 더 잘 보여요</div>`;
    document.body.appendChild(ui);
    this.ui = ui;
    const hold = (id, down, up) => {
      const el = $(id);
      el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); down(); }, { passive: false });
      const end = e => { e.preventDefault(); el.classList.remove('down'); if (up) up(); };
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
    };
    hold('tc-fire', () => {
      if (TdmGame.active) { TdmGame.fireHeld = true; TdmGame.firePressed = true; }
      else if (App.match) App.match.fire = true;
    }, () => { TdmGame.fireHeld = false; if (App.match) App.match.fire = false; });
    hold('tc-aim', () => { TdmGame.aimHeld = !TdmGame.aimHeld; $('tc-aim').classList.toggle('on', TdmGame.aimHeld); });
    hold('tc-reload', () => TdmGame.reload());
    hold('tc-gren', () => TdmGame.grenade());
    hold('tc-wpn', () => { const i = TDM.WPN.indexOf(TdmGame.wpn); TdmGame.chooseWeapon(TDM.WPN[(i + 1) % TDM.WPN.length]); UI.toast(`${TDM.WEAPONS[TdmGame.wpn].icon} ${TDM.WEAPONS[TdmGame.wpn].name}`, 900); });
    hold('tc-board', () => { TdmGame.boardOn = !TdmGame.boardOn; });
    hold('tc-menu', () => {
      if (TdmGame.active) $('screen-pause').classList.toggle('hidden');
      else if (App.match) App.togglePause($('screen-pause').classList.contains('hidden'));
    });
    hold('tc-exit', () => App.exitPossess());

    // 조이스틱
    const zone = $('tc-stick-zone'), stick = $('tc-stick'), knob = $('tc-knob');
    let sid = null, cx = 0, cy = 0;
    const R = 55;
    zone.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      sid = t.identifier;
      const zr = zone.getBoundingClientRect();
      cx = t.clientX; cy = t.clientY;
      stick.style.left = (cx - zr.left) + 'px'; stick.style.top = (cy - zr.top) + 'px';
      stick.classList.add('active');
    }, { passive: false });
    zone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== sid) continue;
        let dx = t.clientX - cx, dy = t.clientY - cy;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx = dx / l * R; dy = dy / l * R; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.axis.x = dx / R; this.axis.y = -dy / R;
      }
    }, { passive: false });
    const endStick = e => {
      for (const t of e.changedTouches) if (t.identifier === sid) {
        sid = null; this.axis.x = 0; this.axis.y = 0;
        knob.style.transform = ''; stick.classList.remove('active');
      }
    };
    zone.addEventListener('touchend', endStick);
    zone.addEventListener('touchcancel', endStick);
  },

  // 캔버스 터치: 시점 회전(전투) / 카메라 이동·확대·선택(지휘)
  bindCanvas() {
    const cv = App.r.canvas;
    cv.style.touchAction = 'none';
    const pts = new Map();
    let pinch = 0, tapStart = null, lastTap = { t: 0, id: 0 };
    cv.addEventListener('touchstart', e => {
      if (!this.on) return;
      e.preventDefault();
      for (const t of e.changedTouches) pts.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now() });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); tapStart = null; }
      else if (pts.size === 1) { const p = [...pts.values()][0]; tapStart = { x: p.x, y: p.y, t: p.t }; }
    }, { passive: false });
    cv.addEventListener('touchmove', e => {
      if (!this.on) return;
      e.preventDefault();
      const mode = this.mode();
      if (mode === 'rts' && pts.size === 2) {
        for (const t of e.changedTouches) { const p = pts.get(t.identifier); if (p) { p.x = t.clientX; p.y = t.clientY; } }
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) App.r.zoom(pinch / d);
        pinch = d;
        return;
      }
      for (const t of e.changedTouches) {
        const p = pts.get(t.identifier);
        if (!p) continue;
        const dx = t.clientX - p.x, dy = t.clientY - p.y;
        p.x = t.clientX; p.y = t.clientY;
        if (mode === 'tdm') {
          const k = TdmGame.aimHeld ? 0.0028 : 0.0055;
          TdmGame.yaw -= dx * k;
          TdmGame.pitch = Math.max(-0.75, Math.min(0.6, TdmGame.pitch - dy * k));
        } else if (mode === 'hero') {
          const m = App.match;
          m.camYaw -= dx * 0.0055;
          m.camPitch = Math.max(-0.7, Math.min(0.45, m.camPitch - dy * 0.0055));
        } else if (mode === 'rts') {
          const k = App.r.cam.dist * 0.0028;
          App.r.panCamera(-dx * k, dy * k);
        }
      }
    }, { passive: false });
    const end = e => {
      if (!this.on) return;
      for (const t of e.changedTouches) {
        const p = pts.get(t.identifier);
        pts.delete(t.identifier);
        if (!p || this.mode() !== 'rts' || !tapStart) continue;
        const moved = Math.hypot(t.clientX - p.sx, t.clientY - p.sy);
        if (moved < 10 && performance.now() - p.t < 350) {
          const id = App.r.pick(t.clientX, t.clientY);
          const now = performance.now();
          const u = App.findUnit(id);
          if (id && id === lastTap.id && now - lastTap.t < 400 && u && u.side === App.match.mySide) { App.possess(id); lastTap = { t: 0, id: 0 }; }
          else { App.r.setSelection(id); App.updateSelInfo(); lastTap = { t: now, id }; }
        }
      }
      if (pts.size < 2) pinch = 0;
    };
    cv.addEventListener('touchend', end, { passive: false });
    cv.addEventListener('touchcancel', end, { passive: false });
  },

  // 매 프레임: 화면에 맞는 버튼만 보이기
  update() {
    const mode = this.mode();
    if (this.lastMode === mode) return;
    this.lastMode = mode;
    const show = (id, on) => $(id).classList.toggle('hidden', !on);
    const fight = mode === 'tdm' || mode === 'hero';
    this.ui.classList.toggle('hidden', !mode);
    document.body.classList.toggle('hero-on', mode === 'hero');
    show('tc-stick-zone', fight);
    show('tc-fire', fight);
    ['tc-aim', 'tc-reload', 'tc-gren', 'tc-wpn', 'tc-board'].forEach(id => show(id, mode === 'tdm'));
    show('tc-exit', mode === 'hero');
    show('tc-menu', !!mode);
    if (!fight) { this.axis.x = 0; this.axis.y = 0; }
  },
};
