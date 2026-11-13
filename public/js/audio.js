// ===== 효과음: WebAudio 절차적 합성 (오디오 파일 없음) =====
// Sound.play(name, {x,y,z,vol,size}) — 위치를 주면 카메라(리스너) 기준 거리 감쇠 / 좌우 패닝
// Sound.toggle(), Sound.muted, Sound.setVolume(v), M 키로 음소거 토글
const Sound = (() => {
  const KEY = 'nationwar_muted';
  let ctx = null, master = null, bus = null, comp = null;
  let noiseBuf = null, brownBuf = null;
  let ambient = null, rotor = null;
  let active = 0;
  const lastAt = {};          // 이름별 최근 재생 시각 (스로틀)
  const winCount = {};        // 이름별 짧은 창(window) 내 재생 수
  let frameT = 0, frameN = 0; // 전체 프레임 예산
  const L = { x: 0, y: 0, z: 0, rx: 1, rz: 0, lift: 0 };

  const S = {
    muted: false,
    volume: 0.8,
    sceneLevel: 1,
  };
  try { S.muted = localStorage.getItem(KEY) === '1'; } catch (e) { /* 저장소 사용 불가 */ }

  // 이름별 설정: 최대 동시(창 0.06초당) 개수, 우선순위, 거리 기준(ref) / 감쇠
  const CFG = {
    rifle: { max: 3, pri: 1, ref: 10, roll: 1.2 },
    smg: { max: 2, pri: 1, ref: 9, roll: 1.2 },
    pistol: { max: 2, pri: 1, ref: 9, roll: 1.2 },
    sniper: { max: 2, pri: 3, ref: 25, roll: 0.7 },
    cannon: { max: 2, pri: 4, ref: 30, roll: 0.6 },
    mg: { max: 2, pri: 2, ref: 16, roll: 1.0 },
    heligun: { max: 2, pri: 2, ref: 18, roll: 0.9 },
    rocket: { max: 2, pri: 3, ref: 18, roll: 0.9 },
    explosion: { max: 3, pri: 5, ref: 35, roll: 0.5 },
    bigexplosion: { max: 2, pri: 6, ref: 45, roll: 0.45 },
    death: { max: 2, pri: 1, ref: 8, roll: 1.4 },
    impact: { max: 2, pri: 0, ref: 6, roll: 1.6 },
    coin: { max: 2, pri: 7, ui: true },
    build: { max: 1, pri: 6, ref: 40, roll: 0.5 },
    spawn: { max: 1, pri: 2, ui: true },
    click: { max: 1, pri: 2, ui: true },
    victory: { max: 1, pri: 9, ui: true },
    defeat: { max: 1, pri: 9, ui: true },
  };

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; return null; }
    master = ctx.createGain();
    master.gain.value = S.muted ? 0 : S.volume;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    bus = ctx.createGain();
    bus.gain.value = S.sceneLevel;
    bus.connect(comp); comp.connect(master); master.connect(ctx.destination);
    // 노이즈 버퍼 (화이트 / 브라운)
    const n = ctx.sampleRate * 4;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    brownBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const w = noiseBuf.getChannelData(0), b = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }
    return ctx;
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!ambient) startAmbient();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));

  function ready() { return ctx && ctx.state === 'running' && !S.muted; }

  // ---------- 리스너 ----------
  function setListener(x, y, z, rx, rz, lift) {
    L.x = x; L.y = y; L.z = z;
    const l = Math.hypot(rx, rz) || 1;
    L.rx = rx / l; L.rz = rz / l; L.lift = lift || 0;
  }

  // 위치 기반 출력 체인: gain → (거리 로우패스) → panner → bus
  function output(o, cfg, vol) {
    let g = vol, pan = 0, dist = 0;
    if (o && o.x !== undefined && !cfg.ui) {
      const dx = o.x - L.x, dy = (o.y || 0) - L.y, dz = o.z - L.z;
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz + L.lift * L.lift);
      const ref = cfg.ref || 10, roll = cfg.roll || 1;
      g *= dist <= ref ? 1 : ref / (ref + roll * (dist - ref));
      if (dist > 0.01) pan = Math.max(-1, Math.min(1, (dx * L.rx + dz * L.rz) / Math.max(dist, 8))) * 0.75;
    }
    if (g < 0.012) return null;
    const gn = ctx.createGain();
    gn.gain.value = g;
    let node = gn;
    if (dist > 35) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(700, 16000 / (1 + (dist - 35) / 18));
      node.connect(lp); node = lp;
    }
    if (ctx.createStereoPanner && pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p); node = p;
    }
    node.connect(bus);
    return gn;
  }

  // ---------- 합성 프리미티브 ----------
  function track(src, endT) {
    active++;
    src.onended = () => { active--; };
    src.stop(endT);
  }
  // 노이즈 버스트: 필터 + 지수 감쇠
  function noise(dst, t, o) {
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? brownBuf : noiseBuf;
    src.playbackRate.value = o.rate || 1;
    let node = src;
    if (o.type) {
      const f = ctx.createBiquadFilter();
      f.type = o.type; f.frequency.setValueAtTime(o.f, t);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.fdur || o.dur));
      f.Q.value = o.q || 0.7;
      node.connect(f); node = f;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + (o.att || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.att || 0.002) + o.dur);
    node.connect(g); g.connect(dst);
    src.start(t, Math.random() * Math.max(0, 3.8 - o.dur - (o.att || 0)));
    track(src, t + o.dur + 0.05);
  }
  // 톤: 주파수 스윕 + 감쇠
  function tone(dst, t, o) {
    const osc = ctx.createOscillator();
    osc.type = o.wave || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.fdur || o.dur));
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 0.7;
      node.connect(f); node = f;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + (o.att || 0.004));
    if (o.hold) g.gain.setValueAtTime(o.vol, t + (o.att || 0.004) + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.att || 0.004) + (o.hold || 0) + o.dur);
    node.connect(g); g.connect(dst);
    osc.start(t);
    track(osc, t + (o.att || 0.004) + (o.hold || 0) + o.dur + 0.05);
  }

  // ---------- 효과음 정의 ----------
  const r = (a, b) => a + Math.random() * (b - a);
  function gunshot(d, t, body, crackF, thumpF, tail, v = 1) {
    noise(d, t, { type: 'highpass', f: crackF, dur: 0.035, vol: 0.55 * v });
    noise(d, t, { type: 'bandpass', f: body * r(0.9, 1.1), q: 0.9, dur: 0.09, vol: 0.9 * v });
    tone(d, t, { f: thumpF, f2: thumpF * 0.4, dur: 0.09, vol: 0.55 * v });
    noise(d, t + 0.01, { type: 'lowpass', f: 1200, f2: 300, dur: tail, vol: 0.18 * v, att: 0.01 });
  }
  const SYN = {
    rifle(d, t) { gunshot(d, t, 1700, 3500, 170, 0.28, 0.75); },
    smg(d, t) { gunshot(d, t, 2100, 4000, 190, 0.18, 0.55); gunshot(d, t + 0.07, 2000, 4000, 190, 0.18, 0.45); },
    pistol(d, t) { gunshot(d, t, 2300, 4200, 210, 0.2, 0.6); },
    sniper(d, t) {
      noise(d, t, { type: 'highpass', f: 2500, dur: 0.05, vol: 1.0 });
      noise(d, t, { type: 'bandpass', f: 1100, q: 0.8, dur: 0.16, vol: 1.0 });
      tone(d, t, { f: 140, f2: 40, dur: 0.22, vol: 0.8 });
      noise(d, t + 0.03, { type: 'lowpass', f: 900, f2: 180, dur: 1.4, vol: 0.32, att: 0.02 });
    },
    cannon(d, t) {
      noise(d, t, { type: 'bandpass', f: 2200, q: 0.6, dur: 0.07, vol: 0.9 });
      tone(d, t, { f: 95, f2: 28, dur: 0.6, vol: 1.2 });
      noise(d, t, { type: 'lowpass', f: 900, f2: 120, dur: 1.3, vol: 1.0, att: 0.004 });
      noise(d, t + 0.02, { type: 'lowpass', f: 260, dur: 2.0, vol: 0.6, brown: true, att: 0.03 });
    },
    mg(d, t) { for (let i = 0; i < 3; i++) gunshot(d, t + i * 0.075, 1300, 3000, 140, 0.16, 0.6); },
    heligun(d, t) { for (let i = 0; i < 4; i++) gunshot(d, t + i * 0.06, 900, 2400, 110, 0.18, 0.62); },
    rocket(d, t) {
      noise(d, t, { type: 'bandpass', f: 1800, f2: 600, q: 1.2, dur: 0.5, vol: 0.5, att: 0.02 });
      noise(d, t, { type: 'lowpass', f: 500, dur: 0.6, vol: 0.4, brown: true });
    },
    explosion(d, t, o) {
      const s = Math.max(0.6, Math.min(2.5, (o && o.size) || 1));
      tone(d, t, { f: 80 / Math.sqrt(s), f2: 24, dur: 0.5 + 0.25 * s, vol: 1.1 });
      noise(d, t, { type: 'lowpass', f: 1600, f2: 160, dur: 0.9 + 0.5 * s, vol: 1.0, att: 0.003 });
      noise(d, t, { type: 'bandpass', f: 3000, q: 0.7, dur: 0.12, vol: 0.5 });
      noise(d, t + 0.05, { type: 'lowpass', f: 200, dur: 1.5 + s, vol: 0.7, brown: true, att: 0.06 });
      for (let i = 0; i < 4; i++) noise(d, t + 0.15 + Math.random() * 0.6, { type: 'bandpass', f: r(2500, 5000), q: 2, dur: 0.03, vol: 0.12 });
    },
    bigexplosion(d, t) {
      SYN.explosion(d, t, { size: 2.4 });
      tone(d, t + 0.02, { f: 55, f2: 20, dur: 1.4, vol: 0.9 });
      noise(d, t + 0.2, { type: 'lowpass', f: 400, f2: 120, dur: 2.5, vol: 0.5, brown: true, att: 0.2 });
    },
    death(d, t) {
      tone(d, t, { f: 120, f2: 55, dur: 0.16, vol: 0.5 });
      noise(d, t, { type: 'lowpass', f: 700, dur: 0.14, vol: 0.4 });
      noise(d, t + 0.05, { type: 'bandpass', f: 4200, q: 3, dur: 0.06, vol: 0.12 });
    },
    impact(d, t) { noise(d, t, { type: 'bandpass', f: r(1800, 3500), q: 1.5, dur: 0.05, vol: 0.25 }); },
    coin(d, t) {
      tone(d, t, { wave: 'triangle', f: 1318.5, dur: 0.18, vol: 0.32 });
      tone(d, t + 0.075, { wave: 'triangle', f: 1975.5, dur: 0.42, vol: 0.32 });
      tone(d, t + 0.075, { wave: 'sine', f: 3951, dur: 0.25, vol: 0.06 });
    },
    build(d, t) {
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.13;
        tone(d, tt, { wave: 'square', f: r(380, 520), dur: 0.08, vol: 0.12, lp: 2600 });
        noise(d, tt, { type: 'bandpass', f: r(2500, 3800), q: 6, dur: 0.12, vol: 0.35 });
      }
      tone(d, t + 0.45, { wave: 'triangle', f: 659.3, dur: 0.25, vol: 0.25 });
      tone(d, t + 0.58, { wave: 'triangle', f: 987.8, dur: 0.45, vol: 0.25 });
    },
    spawn(d, t) {
      noise(d, t, { type: 'bandpass', f: 2600, q: 2, dur: 0.04, vol: 0.18 });
      tone(d, t + 0.01, { wave: 'triangle', f: 520, f2: 780, dur: 0.08, vol: 0.08 });
    },
    click(d, t) { tone(d, t, { wave: 'triangle', f: 1400, f2: 900, dur: 0.04, vol: 0.12 }); },
    victory(d, t) {
      const brass = (f, tt, dur, v = 0.22) => {
        tone(d, tt, { wave: 'sawtooth', f, dur, vol: v, lp: 2400, att: 0.03, hold: dur * 0.4 });
        tone(d, tt, { wave: 'square', f: f * 1.003, dur, vol: v * 0.4, lp: 1800, att: 0.03, hold: dur * 0.4 });
      };
      const N = [523.25, 659.25, 783.99, 1046.5];
      N.forEach((f, i) => brass(f, t + i * 0.14, 0.18));
      [523.25, 659.25, 783.99, 1046.5].forEach(f => brass(f, t + 0.62, 1.2, 0.14));
      tone(d, t + 0.62, { f: 65.4, dur: 1.2, vol: 0.5 });
      noise(d, t + 0.62, { type: 'highpass', f: 6000, dur: 1.0, vol: 0.12, att: 0.01 });
    },
    defeat(d, t) {
      const horn = (f, tt, dur, v = 0.2) => tone(d, tt, { wave: 'sawtooth', f, dur, vol: v, lp: 1100, att: 0.06, hold: dur * 0.5 });
      horn(392, t, 0.45); horn(311.1, t + 0.42, 0.45); horn(261.6, t + 0.84, 1.4);
      horn(130.8, t + 0.84, 1.6, 0.22);
      tone(d, t + 0.84, { f: 60, f2: 35, dur: 1.4, vol: 0.6 });
    },
  };

  // ---------- 재생 ----------
  function play(name, o) {
    if (!ready()) return;
    const cfg = CFG[name];
    const fn = SYN[name];
    if (!cfg || !fn) return;
    const now = ctx.currentTime;
    // 프레임(약 1/30초) 전체 예산: 우선순위 낮은 소리부터 버림
    if (now - frameT > 0.033) { frameT = now; frameN = 0; }
    if (frameN >= 7 && cfg.pri < 4) return;
    if (active > 90 && cfg.pri < 5) return;
    // 이름별 창 스로틀
    if (now - (lastAt[name] || 0) > 0.06) { lastAt[name] = now; winCount[name] = 0; }
    if (winCount[name] >= cfg.max) return;
    const vol = (o && o.vol !== undefined ? o.vol : 1);
    const dst = output(o, cfg, vol);
    if (!dst) return;
    winCount[name]++;
    frameN++;
    fn(dst, now + 0.005 + Math.random() * 0.01, o);
  }

  // ---------- 환경음: 바람 + 헬기 로터 ----------
  function startAmbient() {
    if (!ctx || ambient) return;
    const src = ctx.createBufferSource();
    src.buffer = brownBuf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.45;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lg = ctx.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.05;
    const lg2 = ctx.createGain(); lg2.gain.value = 180;
    lfo2.connect(lg2); lg2.connect(bp.frequency);
    src.connect(bp); bp.connect(g); g.connect(bus);
    src.start(); lfo.start(); lfo2.start();
    ambient = { src, g };

    // 로터: 저역 노이즈를 ~11Hz로 진폭 변조
    const rs = ctx.createBufferSource();
    rs.buffer = noiseBuf; rs.loop = true;
    const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 320; rl.Q.value = 1.2;
    const am = ctx.createGain(); am.gain.value = 0.5;
    const ro = ctx.createOscillator(); ro.frequency.value = 11.5;
    const rog = ctx.createGain(); rog.gain.value = 0.5;
    ro.connect(rog); rog.connect(am.gain);
    const thump = ctx.createOscillator(); thump.type = 'sine'; thump.frequency.value = 46;
    const tg = ctx.createGain(); tg.gain.value = 0.25;
    thump.connect(tg); tg.connect(am);
    const level = ctx.createGain(); level.gain.value = 0;
    rs.connect(rl); rl.connect(am); am.connect(level); level.connect(bus);
    rs.start(); ro.start(); thump.start();
    rotor = { level };
  }
  function setRotor(v) {
    if (!rotor || !ctx) return;
    rotor.level.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.55, ctx.currentTime, 0.25);
  }
  function setScene(level) {
    if (S.sceneLevel === level) return;
    S.sceneLevel = level;
    if (bus) bus.gain.setTargetAtTime(level, ctx.currentTime, 0.4);
  }

  function applyVolume() {
    if (master) master.gain.setTargetAtTime(S.muted ? 0 : S.volume, ctx.currentTime, 0.05);
  }
  function setMuted(m) {
    S.muted = !!m;
    try { localStorage.setItem(KEY, S.muted ? '1' : '0'); } catch (e) { /* 무시 */ }
    applyVolume();
    return S.muted;
  }
  function toggle() { return setMuted(!S.muted); }
  function setVolume(v) { S.volume = Math.max(0, Math.min(1, v)); applyVolume(); }

  // M 키: 음소거 토글
  window.addEventListener('keydown', e => {
    if (e.code !== 'KeyM' || (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'))) return;
    const m = toggle();
    if (typeof UI !== 'undefined' && UI.toast) UI.toast(m ? '🔇 소리 꺼짐 (M)' : '🔊 소리 켜짐 (M)', 1200);
  });
  // UI 버튼 클릭음
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('button, label.btn');
    if (b) play('click');
  }, true);

  Object.assign(S, { play, toggle, setMuted, setVolume, setListener, setRotor, setScene, unlock });
  Object.defineProperty(S, 'ctx', { get: () => ctx });
  return S;
})();
