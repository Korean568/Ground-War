// ===== 3D 렌더링 (Three.js r149) =====
// ACES 톤매핑 · 하늘 셰이더 + PMREM 환경광 · 절차적 텍스처 · 디테일 모델 · 파티클 이펙트 · 효과음 연동
if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;

const R3D = (() => {
  const TAU = Math.PI * 2, HP = Math.PI / 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  let seed = 917331;
  const srnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sr = (a, b) => a + srnd() * (b - a);
  const rnd = (a, b) => a + Math.random() * (b - a);
  function hash2(x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, o = 4) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < o; i++) { s += a * noise2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  // 지형 높이: 전장(|x|<44, |z|<124)은 완전 평지, 바깥은 언덕 → 먼 산맥
  function terrainH(x, z) {
    const dx = Math.max(0, Math.abs(x) - 44), dz = Math.max(0, Math.abs(z) - 124);
    const d = Math.hypot(dx, dz);
    if (d <= 0) return 0;
    const n = fbm(x * 0.02 + 11.3, z * 0.02 - 4.1, 4);
    let h = smooth(0, 45, d) * (1.2 + n * n * 22);
    const m = fbm(x * 0.006 - 2.7, z * 0.006 + 8.2, 5);
    h += smooth(110, 330, d) * (18 + m * m * 200);
    return h;
  }
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
  function tex(c, srgb = true, repeat = false) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }
  function blob(g, x, y, r, sx = 1.3) {
    g.beginPath();
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU, rr = r * (0.6 + Math.random() * 0.5);
      const px = x + Math.cos(a) * rr * sx, py = y + Math.sin(a) * rr;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath(); g.fill();
  }
  function grain(g, w, h, a, n) {
    for (let i = 0; i < n; i++) {
      const v = Math.random() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${v},${v},${v},${a * Math.random()})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  }

  // ---------- 지오메트리 빌더 (정점색 + 아틀라스 UV / 월드 UV 병합) ----------
  const PRIM = {};
  function prim(key) {
    if (PRIM[key]) return PRIM[key];
    const [k, a, b] = key.split(':');
    let g;
    if (k === 'box') g = new THREE.BoxGeometry(1, 1, 1);
    else if (k === 'cyl') g = new THREE.CylinderGeometry(b !== undefined ? +b : 1, 1, 1, +a || 12);
    else if (k === 'cone') g = new THREE.ConeGeometry(1, 1, +a || 8);
    else if (k === 'sph') g = new THREE.SphereGeometry(1, +a || 12, +b || 8);
    else if (k === 'hemi') g = new THREE.SphereGeometry(1, +a || 12, +b || 6, 0, TAU, 0, HP);
    else if (k === 'ico') g = new THREE.IcosahedronGeometry(1, +a || 0);
    g = g.index ? g.toNonIndexed() : g;
    PRIM[key] = g;
    return g;
  }
  const colorCache = new Map();
  function col(c) {
    if (c && c.isColor) return c;
    let r = colorCache.get(c);
    if (!r) { r = new THREE.Color(c); colorCache.set(c, r); }
    return r;
  }
  const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _n3 = new THREE.Matrix3();
  class Builder {
    constructor() { this.parts = []; }
    add(key, sx, sy, sz, x, y, z, rx, ry, rz, c, t, k) {
      _e.set(rx || 0, ry || 0, rz || 0, 'YXZ');
      _q.setFromEuler(_e);
      const m = new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
      this.parts.push({ g: typeof key === 'string' ? prim(key) : key, m, c: col(c === undefined ? 0xffffff : c), t: t || 0, k: k || 'u' });
      return this;
    }
    box(w, h, d, x, y, z, c, t, rx, ry, rz, k) { return this.add('box', w, h, d, x, y, z, rx, ry, rz, c, t, k); }
    cyl(r, h, x, y, z, c, t, rx, ry, rz, seg = 12, top = 1, k) { return this.add('cyl:' + seg + ':' + top, r, h, r, x, y, z, rx, ry, rz, c, t, k); }
    sph(a, b, d, x, y, z, c, t, k) { return this.add('sph:12:8', a, b, d, x, y, z, 0, 0, 0, c, t, k); }
    keys() { return [...new Set(this.parts.map(p => p.k))]; }
    geometry(k = 'u', world = false, uvScale = 1) {
      const parts = this.parts.filter(p => p.k === k);
      let n = 0;
      for (const p of parts) n += p.g.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), cl = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let o = 0;
      for (const p of parts) {
        const P = p.g.attributes.position, N = p.g.attributes.normal, U = p.g.attributes.uv;
        _n3.getNormalMatrix(p.m);
        const tx = p.t % 4, ty = (p.t / 4) | 0;
        for (let i = 0; i < P.count; i++, o++) {
          _v.fromBufferAttribute(P, i).applyMatrix4(p.m);
          _n.fromBufferAttribute(N, i).applyMatrix3(_n3).normalize();
          pos[o * 3] = _v.x; pos[o * 3 + 1] = _v.y; pos[o * 3 + 2] = _v.z;
          nor[o * 3] = _n.x; nor[o * 3 + 1] = _n.y; nor[o * 3 + 2] = _n.z;
          cl[o * 3] = p.c.r; cl[o * 3 + 1] = p.c.g; cl[o * 3 + 2] = p.c.b;
          if (!world) {
            uv[o * 2] = (tx + 0.06 + U.getX(i) * 0.88) / 4;
            uv[o * 2 + 1] = (3 - ty + 0.06 + U.getY(i) * 0.88) / 4;
          } else {
            const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
            let a, b;
            if (ay >= ax && ay >= az) { a = _v.x; b = _v.z; } else if (ax >= az) { a = _v.z; b = _v.y; } else { a = _v.x; b = _v.y; }
            uv[o * 2] = a / uvScale; uv[o * 2 + 1] = b / uvScale;
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.computeBoundingSphere();
      return g;
    }
  }

  // ---------- 절차적 텍스처 ----------
  // 유닛 아틀라스 (4x4 타일, 회색조 패턴 → 정점색으로 진영색 틴트)
  function unitAtlas() {
    const [c, g] = canvas(512, 512);
    const T = 128;
    const tile = (i, fn) => { const x = (i % 4) * T, y = ((i / 4) | 0) * T; g.save(); g.beginPath(); g.rect(x, y, T, T); g.clip(); g.translate(x, y); fn(); g.restore(); };
    tile(0, () => { g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, T, T); grain(g, T, T, 0.05, 600); });
    tile(1, () => { // 위장 무늬
      g.fillStyle = '#c4c4c4'; g.fillRect(0, 0, T, T);
      const cs = ['#e4e4e4', '#9a9a9a', '#767676', '#b6b6b6'];
      for (let i = 0; i < 52; i++) { g.fillStyle = cs[i % 4]; blob(g, Math.random() * T, Math.random() * T, 5 + Math.random() * 13); }
      grain(g, T, T, 0.08, 900);
    });
    tile(2, () => { // 금속 패널
      g.fillStyle = '#d4d4d4'; g.fillRect(0, 0, T, T);
      grain(g, T, T, 0.06, 900);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (const x of [40, 92]) g.fillRect(x, 0, 2, T);
      g.fillRect(0, 62, T, 2);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (const x of [42, 94]) g.fillRect(x, 0, 1, T);
      g.fillRect(0, 64, T, 1);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (let y = 6; y < T; y += 12) for (const x of [36, 47, 88, 99]) g.fillRect(x, y, 2, 2);
      const gr = g.createLinearGradient(0, 70, 0, T); gr.addColorStop(0, 'rgba(70,55,40,0)'); gr.addColorStop(1, 'rgba(70,55,40,0.3)');
      g.fillStyle = gr; g.fillRect(0, 0, T, T);
    });
    tile(3, () => { // 무한궤도
      g.fillStyle = '#3a3a37'; g.fillRect(0, 0, T, T);
      for (let y = 0; y < T; y += 16) for (let x = 0; x < T; x += 16) {
        g.fillStyle = '#6a6a64'; g.fillRect(x + 2, y + 2, 12, 11);
        g.fillStyle = '#88887f'; g.fillRect(x + 6, y + 5, 4, 5);
      }
      grain(g, T, T, 0.12, 500);
    });
    tile(4, () => { // 천
      g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, T, T);
      g.strokeStyle = 'rgba(0,0,0,0.06)';
      for (let i = -T; i < T * 2; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + T, T); g.stroke(); }
      grain(g, T, T, 0.08, 800);
    });
    tile(5, () => { // 길리슈트 (색 포함)
      g.fillStyle = '#56603a'; g.fillRect(0, 0, T, T);
      const cs = ['#46552a', '#707a45', '#80704a', '#3a4824', '#8d8f5c', '#5f6b36'];
      g.lineCap = 'round';
      for (let i = 0; i < 700; i++) {
        g.strokeStyle = cs[i % cs.length]; g.lineWidth = 1.5 + Math.random() * 2.5;
        const x = Math.random() * T, y = Math.random() * T, a = Math.random() * TAU, l = 4 + Math.random() * 10;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    });
    tile(6, () => { // 유리
      const gr = g.createLinearGradient(0, 0, 0, T); gr.addColorStop(0, '#40607e'); gr.addColorStop(1, '#0c141c');
      g.fillStyle = gr; g.fillRect(0, 0, T, T);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath(); g.moveTo(20, 0); g.lineTo(55, 0); g.lineTo(15, T); g.lineTo(-20, T); g.fill();
    });
    tile(7, () => { // 타이어
      g.fillStyle = '#262626'; g.fillRect(0, 0, T, T);
      g.fillStyle = '#151515';
      for (let x = 0; x < T; x += 8) g.fillRect(x, 0, 4, T);
      grain(g, T, T, 0.1, 300);
    });
    tile(8, () => { // 나무 판자
      g.fillStyle = '#8a6a44'; g.fillRect(0, 0, T, T);
      for (let y = 0; y < T; y += 21) { g.fillStyle = 'rgba(40,25,10,0.6)'; g.fillRect(0, y, T, 2); }
      g.strokeStyle = 'rgba(60,40,20,0.25)';
      for (let i = 0; i < 40; i++) { const y = Math.random() * T; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(40, y + 3, 80, y - 3, T, y + 1); g.stroke(); }
    });
    tile(9, () => { // 통풍구
      g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, T, T);
      g.fillStyle = '#222';
      for (let y = 8; y < T - 4; y += 12) g.fillRect(8, y, T - 16, 6);
    });
    tile(10, () => { // 국적 표식 (별)
      g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, T, T);
      g.strokeStyle = '#f4f4f4'; g.lineWidth = 9;
      g.beginPath(); g.arc(64, 64, 46, 0, TAU); g.stroke();
      g.fillStyle = '#f4f4f4'; g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 16 : 38, a = -HP + (i * Math.PI) / 5; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
      g.fill();
    });
    tile(11, () => { // 적십자
      g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, T, T);
      g.fillStyle = '#c81e1e'; g.fillRect(48, 22, 32, 84); g.fillRect(22, 48, 84, 32);
    });
    tile(12, () => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, T, T); });
    const t = tex(c);
    return t;
  }

  // 건물용 반복 텍스처
  function concreteTex() {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#b4b1a8'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 160; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(90,85,75,0.07)' : 'rgba(255,255,255,0.07)'; blob(g, Math.random() * 256, Math.random() * 256, 6 + Math.random() * 26); }
    grain(g, 256, 256, 0.1, 4000);
    g.fillStyle = 'rgba(60,58,52,0.45)'; g.fillRect(0, 127, 256, 2); g.fillRect(127, 0, 2, 256); g.fillRect(0, 0, 256, 1); g.fillRect(0, 0, 1, 256);
    for (let i = 0; i < 10; i++) { const x = Math.random() * 256; const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(70,60,50,0.12)'); gr.addColorStop(1, 'rgba(70,60,50,0)'); g.fillStyle = gr; g.fillRect(x, 0, 3 + Math.random() * 8, 256); }
    return tex(c, true, true);
  }
  function brickTex() {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#b3a892'; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 16; r++) for (let k = -1; k < 9; k++) {
      const x = k * 32 + (r % 2) * 16, y = r * 16;
      const v = Math.random();
      g.fillStyle = v < 0.3 ? '#8e4632' : v < 0.6 ? '#9d5239' : v < 0.85 ? '#7e3e2c' : '#a8624a';
      g.fillRect(x + 1, y + 1, 30, 14);
    }
    grain(g, 256, 256, 0.12, 3000);
    return tex(c, true, true);
  }
  function metalTex() { // 골함석
    const [c, g] = canvas(256, 256);
    for (let x = 0; x < 256; x++) { const v = 150 + Math.sin((x / 256) * TAU * 16) * 45; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, 256); }
    grain(g, 256, 256, 0.08, 2000);
    for (let i = 0; i < 14; i++) { const x = Math.random() * 256, gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(120,70,30,0.25)'); gr.addColorStop(1, 'rgba(120,70,30,0)'); g.fillStyle = gr; g.fillRect(x, Math.random() * 100, 2 + Math.random() * 5, 256); }
    return tex(c, true, true);
  }
  function sandbagTex() {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#6e5f42'; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 4; r++) for (let k = -1; k < 5; k++) {
      const x = k * 64 + (r % 2) * 32 + 32, y = r * 64 + 32;
      const gr = g.createRadialGradient(x - 8, y - 12, 4, x, y, 40);
      gr.addColorStop(0, '#d2c08e'); gr.addColorStop(0.7, '#a8946a'); gr.addColorStop(1, '#6a5a3c');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, 31, 29, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(60,45,25,0.4)'; g.beginPath(); g.moveTo(x - 20, y - 4); g.lineTo(x + 20, y - 2); g.stroke();
    }
    grain(g, 256, 256, 0.12, 3000);
    return tex(c, true, true);
  }
  function woodTex() {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#7a5a38'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) { g.fillStyle = 'rgba(35,22,10,0.55)'; g.fillRect(x, 0, 2, 256); }
    g.strokeStyle = 'rgba(50,32,15,0.3)';
    for (let i = 0; i < 60; i++) { const x = Math.random() * 256; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 4, 80, x - 4, 170, x + 2, 256); g.stroke(); }
    grain(g, 256, 256, 0.1, 2000);
    return tex(c, true, true);
  }
  function fenceTex() {
    const [c, g] = canvas(128, 128);
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = '#a7adb0'; g.lineWidth = 2.5;
    for (let i = -128; i < 256; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
      g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 128, 0); g.stroke();
    }
    return tex(c, true, true);
  }
  function helipadTex() {
    const [c, g] = canvas(512, 512);
    g.fillStyle = '#4d4f50'; g.beginPath(); g.arc(256, 256, 254, 0, TAU); g.fill();
    grain(g, 512, 512, 0.12, 6000);
    g.strokeStyle = '#e8c547'; g.lineWidth = 18; g.beginPath(); g.arc(256, 256, 220, 0, TAU); g.stroke();
    g.strokeStyle = '#eeeeee'; g.lineWidth = 6; g.setLineDash([22, 16]); g.beginPath(); g.arc(256, 256, 190, 0, TAU); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#f2f2f2'; g.fillRect(170, 140, 44, 232); g.fillRect(298, 140, 44, 232); g.fillRect(170, 234, 172, 44);
    return tex(c);
  }
  function detailTex() { // 지면 디테일 (선형, 평균 0.5)
    const [c, g] = canvas(256, 256);
    const id = g.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) { const v = 128 + (Math.random() - 0.5) * 60; id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    g.putImageData(id, 0, 0);
    g.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, l = 3 + Math.random() * 6, a = -HP + (Math.random() - 0.5) * 1.2;
      const v = Math.random() < 0.5 ? 70 : 200;
      g.strokeStyle = `rgba(${v},${v},${v},0.28)`; g.lineWidth = 1 + Math.random();
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
        if (x + ox < -12 || x + ox > 268 || y + oy < -12 || y + oy > 268) continue;
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
      }
    }
    return tex(c, false, true);
  }
  function tuftTex() {
    const [c, g] = canvas(128, 128);
    g.lineCap = 'round';
    for (let i = 0; i < 42; i++) {
      const x = 14 + Math.random() * 100, h = 50 + Math.random() * 72, bend = (Math.random() - 0.5) * 40;
      const gr = g.createLinearGradient(0, 128, 0, 128 - h);
      const v = Math.random();
      gr.addColorStop(0, '#2c4a1c'); gr.addColorStop(1, v < 0.3 ? '#a3a85a' : v < 0.7 ? '#6f9a3e' : '#5a8a34');
      g.strokeStyle = gr; g.lineWidth = 2 + Math.random() * 3;
      g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + bend * 0.3, 128 - h * 0.6, x + bend, 128 - h); g.stroke();
    }
    return tex(c);
  }
  // 파티클 아틀라스 2x2: 0 연기, 1 섬광(별), 2 글로우, 3 예광탄 스트릭
  function particleTex() {
    const [c, g] = canvas(256, 256);
    const F = f => [(f % 2) * 128, (1 - ((f / 2) | 0)) * 128];
    { // 0 연기 덩어리
      const [x0, y0] = F(0);
      g.save(); g.translate(x0, y0);
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * TAU, d = Math.random() * 26, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, r = 18 + Math.random() * 22;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        const v = 215 + Math.random() * 40;
        gr.addColorStop(0, `rgba(${v},${v},${v},0.5)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      }
      g.globalCompositeOperation = 'destination-in';
      const m = g.createRadialGradient(64, 64, 20, 64, 64, 62); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = m; g.fillRect(0, 0, 128, 128);
      g.restore();
    }
    { // 1 섬광
      const [x0, y0] = F(1);
      g.save(); g.translate(x0 + 64, y0 + 64);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        g.rotate(TAU / 7 + Math.random() * 0.3);
        const l = 38 + Math.random() * 22;
        const gr = g.createLinearGradient(0, 0, l, 0); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, -6); g.lineTo(l, 0); g.lineTo(0, 6); g.fill();
      }
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 40); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(-64, -64, 128, 128);
      g.restore();
    }
    { // 2 글로우
      const [x0, y0] = F(2);
      const gr = g.createRadialGradient(x0 + 64, y0 + 64, 0, x0 + 64, y0 + 64, 62);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.65)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x0, y0, 128, 128);
    }
    { // 3 스트릭 (위쪽이 머리)
      const [x0, y0] = F(3);
      for (let y = 2; y < 126; y++) {
        const k = 1 - (y - 2) / 124, a = Math.pow(k, 1.6);
        const gr = g.createLinearGradient(x0 + 4, 0, x0 + 124, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x0 + 4, y0 + y, 120, 1);
      }
    }
    return tex(c);
  }
  function scorchTex() {
    const [c, g] = canvas(256, 256);
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 120);
    gr.addColorStop(0, 'rgba(18,14,10,0.95)'); gr.addColorStop(0.45, 'rgba(28,22,15,0.75)'); gr.addColorStop(1, 'rgba(40,32,22,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU, l = 60 + Math.random() * 60;
      g.strokeStyle = 'rgba(20,15,10,0.35)'; g.lineWidth = 3 + Math.random() * 6;
      g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * l, 128 + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(15,12,8,0.3)'; blob(g, 128 + (Math.random() - 0.5) * 140, 128 + (Math.random() - 0.5) * 140, 4 + Math.random() * 10, 1); }
    return tex(c);
  }
  function rotorTex() {
    const [c, g] = canvas(256, 256);
    const gr = g.createRadialGradient(128, 128, 8, 128, 128, 127);
    gr.addColorStop(0, 'rgba(30,30,30,0)'); gr.addColorStop(0.1, 'rgba(30,30,30,0.35)'); gr.addColorStop(0.85, 'rgba(30,30,30,0.18)');
    gr.addColorStop(0.95, 'rgba(60,60,60,0.35)'); gr.addColorStop(1, 'rgba(30,30,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(20,20,20,0.1)';
    for (let r = 30; r < 120; r += 9) { g.lineWidth = 2 + Math.random() * 3; g.beginPath(); g.arc(128, 128, r, 0, TAU); g.stroke(); }
    return tex(c);
  }
  function ringTex() {
    const [c, g] = canvas(128, 128);
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 63);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return tex(c);
  }

  // 지면 텍스처: x∈[-80,80], z∈[-140,140] (6.4px/m)
  const GW = 1024, GH = 1792, GK = 6.4, GBASE = '#4b6e31';
  function groundCanvas() {
    const [c, g] = canvas(GW, GH);
    const PX = x => (x + 80) * GK, PZ = z => (z + 140) * GK;
    const soft = (x, y, r, hex, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(hex, a)); gr.addColorStop(1, rgba(hex, 0));
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    g.fillStyle = GBASE; g.fillRect(0, 0, GW, GH);
    const greens = ['#5b7d36', '#42652a', '#6d8540', '#3c5b27', '#7c8a46', '#557a33'];
    for (let i = 0; i < 900; i++) soft(Math.random() * GW, Math.random() * GH, 20 + Math.random() * 80, greens[i % greens.length], 0.12 + Math.random() * 0.18);
    // 전장: 닳은 풀 + 흙
    const dirts = ['#7d6a4a', '#6e5c3f', '#8a7652', '#5f5236', '#73654a'];
    for (let i = 0; i < 4200; i++) {
      const x = (srnd() + srnd() - 1) * 38, z = sr(-122, 122);
      const keep = 0.25 + 0.75 * (1 - Math.abs(x) / 38) * (Math.abs(z) < 75 ? 1 : 0.6);
      if (srnd() > keep) continue;
      soft(PX(x), PZ(z), sr(1.2, 5.5) * GK, dirts[i % dirts.length], sr(0.08, 0.24));
    }
    for (let i = 0; i < 900; i++) soft(PX(sr(-34, 34)), PZ(sr(-45, 45)), sr(1.5, 6) * GK, dirts[i % dirts.length], sr(0.1, 0.25));
    for (let i = 0; i < 70; i++) soft(PX(sr(-33, 33)), PZ(sr(-70, 70)), sr(2, 5) * GK, '#3e3424', sr(0.15, 0.3));
    // 탱크 궤도 자국
    g.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const x0 = sr(-30, 30), z0 = sr(-70, -20), x1 = x0 + sr(-14, 14), z1 = sr(20, 70);
      const cx = sr(-30, 30), cz = sr(-30, 30);
      for (const off of [-1.15, 1.15]) {
        g.strokeStyle = 'rgba(48,38,26,0.12)'; g.lineWidth = 0.55 * GK;
        g.beginPath(); g.moveTo(PX(x0 + off), PZ(z0)); g.quadraticCurveTo(PX(cx + off), PZ(cz), PX(x1 + off), PZ(z1)); g.stroke();
        g.strokeStyle = 'rgba(30,24,16,0.18)'; g.lineWidth = 0.4 * GK; g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(PX(x0 + off), PZ(z0)); g.quadraticCurveTo(PX(cx + off), PZ(cz), PX(x1 + off), PZ(z1)); g.stroke();
        g.setLineDash([]);
      }
    }
    // 중앙 흙길 (바퀴 자국 포함)
    const roadX = z => Math.sin(z * 0.045) * 1.8 * (1 - smooth(55, 78, Math.abs(z)));
    for (let z = -122; z <= 122; z += 0.6) {
      const x = roadX(z);
      soft(PX(x + sr(-0.8, 0.8)), PZ(z), (3.6 + sr(-0.5, 0.8)) * GK, '#8f7b58', 0.22);
      soft(PX(x + sr(-0.4, 0.4)), PZ(z), 2.6 * GK, '#9a865f', 0.18);
    }
    for (const off of [-1.3, 1.3]) {
      g.strokeStyle = 'rgba(66,54,36,0.5)'; g.lineWidth = 0.5 * GK;
      g.beginPath();
      for (let z = -122; z <= 122; z += 1) { const x = roadX(z) + off; if (z === -122) g.moveTo(PX(x), PZ(z)); else g.lineTo(PX(x), PZ(z)); }
      g.stroke();
    }
    for (let i = 0; i < 3000; i++) { const z = sr(-122, 122), x = roadX(z) + sr(-3, 3); g.fillStyle = srnd() < 0.5 ? 'rgba(170,150,115,0.5)' : 'rgba(70,58,40,0.4)'; g.fillRect(PX(x), PZ(z), 1.5, 1.5); }
    // 포탄 구덩이
    for (let i = 0; i < 38; i++) {
      const x = PX(sr(-32, 32)), z = PZ(sr(-62, 62)), r = sr(1.2, 3.4) * GK;
      const gr = g.createRadialGradient(x, z, 0, x, z, r * 1.6);
      gr.addColorStop(0, 'rgba(38,31,22,0.85)'); gr.addColorStop(0.5, 'rgba(58,48,34,0.7)'); gr.addColorStop(0.68, 'rgba(150,130,96,0.55)'); gr.addColorStop(1, 'rgba(120,100,70,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, z, r * 1.6, 0, TAU); g.fill();
    }
    // 기지 부지 (자갈 + 콘크리트 슬래브 + 공장 부지)
    for (let s = 0; s < 2; s++) {
      const W = (lx, lz) => [PX(s ? -lx : lx), PZ(s ? -GAME.BASE_Z - lz : GAME.BASE_Z + lz)];
      const rect = (x0, z0, x1, z1, fill) => { const [a, b] = W(x0, z0), [c2, d] = W(x1, z1); g.fillStyle = fill; g.fillRect(Math.min(a, c2), Math.min(b, d), Math.abs(c2 - a), Math.abs(d - b)); };
      const slab = (x0, z0, x1, z1, base) => {
        rect(x0, z0, x1, z1, base);
        g.fillStyle = 'rgba(55,52,46,0.35)';
        for (let x = x0; x <= x1; x += 3) { const [a, b] = W(x, z0), [, d] = W(x, z1); g.fillRect(a - 0.6, Math.min(b, d), 1.2, Math.abs(d - b)); }
        for (let z = z0; z <= z1; z += 3) { const [a, b] = W(x0, z), [c2] = W(x1, z); g.fillRect(Math.min(a, c2), b - 0.6, Math.abs(c2 - a), 1.2); }
      };
      rect(-41, -4, 41, 36, '#837d69');
      for (let i = 0; i < 500; i++) { const [x, z] = W(sr(-41, 41), sr(-4, 36)); soft(x, z, sr(4, 20), srnd() < 0.5 ? '#6d6754' : '#9a937c', 0.25); }
      for (let i = 0; i < 9000; i++) { const [x, z] = W(sr(-41, 41), sr(-4, 36)); g.fillStyle = srnd() < 0.5 ? 'rgba(60,55,45,0.5)' : 'rgba(190,182,160,0.5)'; g.fillRect(x, z, 1.5, 1.5); }
      for (let i = 0; i < 60; i++) { const [x, z] = W(sr(-42, 42), srnd() < 0.5 ? sr(-6, -2) : sr(34, 38)); soft(x, z, sr(8, 24), GBASE, 0.5); }
      slab(-11, 5, 11, 20, '#a19e95');
      slab(-3, -4, 3, 6, '#9c998f');
      slab(-14, 0, -8, 7, '#9a978d');
      const slots = [[-24, 10], [24, 10], [-30, 2], [30, 2], [-24, 20], [24, 20], [-30, 14], [30, 14]];
      for (const [x, z] of slots) {
        slab(x - 3.6, z - 3.1, x + 3.6, z + 3.1, '#9d9a90');
        g.fillStyle = '#d9b43a';
        for (const [cx, cz] of [[-3.4, -2.9], [3.4, -2.9], [-3.4, 2.9], [3.4, 2.9]]) { const [a, b] = W(x + cx, z + cz); g.fillRect(a - 4, b - 4, 8, 8); }
      }
      g.strokeStyle = 'rgba(230,200,70,0.8)'; g.lineWidth = 0.25 * GK;
      { const [a, b] = W(-38, -3.2), [c2] = W(38, -3.2); g.beginPath(); g.moveTo(a, b); g.lineTo(c2, b); g.stroke(); }
    }
    // 미세 풀 반점
    for (let i = 0; i < 60000; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? 'rgba(40,70,25,0.35)' : v < 0.85 ? 'rgba(120,150,70,0.3)' : 'rgba(150,140,90,0.3)';
      g.fillRect(Math.random() * GW, Math.random() * GH, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // 가장자리를 기본색으로 (텍스처 클램프 경계 이음매 제거)
    const edge = (x0, y0, x1, y1, w, h) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, GBASE); gr.addColorStop(1, rgba(GBASE, 0)); g.fillStyle = gr; return [w, h]; };
    edge(0, 0, 60, 0); g.fillRect(0, 0, 60, GH);
    edge(GW, 0, GW - 60, 0); g.fillRect(GW - 60, 0, 60, GH);
    edge(0, 0, 0, 60); g.fillRect(0, 0, GW, 60);
    edge(0, GH, 0, GH - 60); g.fillRect(0, GH - 60, GW, 60);
    return c;
  }

  // ---------- 하늘 셰이더 ----------
  const SKY_FRAG = `
    uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uTime; uniform float uClouds;
    varying vec3 vDir;
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * vn(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; } return v; }
    void main(){
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
      col = mix(col, uGround, smoothstep(0.0, -0.12, h));
      float sd = max(dot(d, uSunDir), 0.0);
      col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.5);
      col += uSunColor * smoothstep(0.9994, 0.9997, sd) * 18.0;
      if (h > 0.0 && uClouds > 0.5) {
        vec2 uv = d.xz / (h + 0.12) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
        float c = fbm(uv);
        float cov = smoothstep(0.48, 0.8, c) * smoothstep(0.0, 0.18, h);
        float shade = fbm(uv * 2.3 + 4.0);
        vec3 cc = mix(vec3(0.62, 0.66, 0.72), vec3(1.02, 1.0, 0.98), shade);
        cc += uSunColor * pow(sd, 5.0) * 0.6;
        col = mix(col, cc, cov * 0.88);
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }`;
  function skyMaterial(U) {
    return new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
  }

  // ---------- 파티클 시스템 (인스턴스 빌보드 1회 드로우) ----------
  const P_VERT = `
    attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iMisc; attribute vec3 iDir;
    uniform float uFogDensity;
    varying vec2 vUv; varying vec4 vCol; varying float vFog;
    void main(){
      vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
      vec2 c = position.xy;
      float size = iMisc.x;
      if (iMisc.w > 0.0) {
        vec4 mt = modelViewMatrix * vec4(iPos - iDir * iMisc.w, 1.0);
        vec2 ax = mv.xy - mt.xy;
        float l = length(ax);
        ax = l > 0.0001 ? ax / l : vec2(0.0, 1.0);
        vec2 pp = vec2(-ax.y, ax.x);
        mv = mix(mt, mv, c.y + 0.5);
        mv.xy += pp * c.x * size;
      } else {
        float s = sin(iMisc.y), co = cos(iMisc.y);
        mv.xy += vec2(c.x * co - c.y * s, c.x * s + c.y * co) * size;
      }
      gl_Position = projectionMatrix * mv;
      float f = iMisc.z;
      vUv = (position.xy + 0.5) * 0.5 + vec2(mod(f, 2.0), floor(f / 2.0)) * 0.5;
      vCol = iCol;
      float d = -mv.z;
      vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
    }`;
  const P_FRAG = `
    uniform sampler2D uMap; uniform vec3 uFogColor; uniform float uAdd;
    varying vec2 vUv; varying vec4 vCol; varying float vFog;
    void main(){
      vec4 t = texture2D(uMap, vUv);
      float a = t.a * vCol.a;
      if (uAdd > 0.5) {
        gl_FragColor = vec4(vCol.rgb * t.rgb * a * (1.0 - vFog), 1.0);
      } else {
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(vCol.rgb * t.rgb, uFogColor, vFog), a);
      }
      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }`;
  class Particles {
    constructor(cap, additive, map, fog) {
      this.cap = cap; this.n = 0;
      const F = n => new Float32Array(n);
      this.p = F(cap * 3); this.v = F(cap * 3); this.c = F(cap * 3);
      this.age = F(cap); this.life = F(cap); this.s0 = F(cap); this.s1 = F(cap); this.a = F(cap);
      this.rot = F(cap); this.rv = F(cap); this.grav = F(cap); this.drag = F(cap); this.fr = F(cap); this.st = F(cap); this.mode = F(cap);
      const geo = new THREE.InstancedBufferGeometry();
      const q = new THREE.PlaneGeometry(1, 1);
      geo.setIndex(q.index);
      geo.setAttribute('position', q.attributes.position);
      const ia = k => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
      this.aPos = ia(3); this.aCol = ia(4); this.aMisc = ia(4); this.aDir = ia(3);
      geo.setAttribute('iPos', this.aPos); geo.setAttribute('iCol', this.aCol); geo.setAttribute('iMisc', this.aMisc); geo.setAttribute('iDir', this.aDir);
      geo.instanceCount = 0;
      this.geo = geo;
      this.mat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: map }, uFogColor: { value: fog.color }, uFogDensity: { value: fog.density }, uAdd: { value: additive ? 1 : 0 } },
        vertexShader: P_VERT, fragmentShader: P_FRAG,
        transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.mesh = new THREE.Mesh(geo, this.mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = additive ? 7 : 6;
    }
    // mode: 0 연기(서서히 사라짐) 1 불꽃(빠르게 식음) 2 섬광/예광탄 3 고체 조각
    spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, fr, grav, drag, st, mode, delay) {
      let i = this.n;
      if (i >= this.cap) i = (Math.random() * this.cap) | 0; else this.n++;
      const i3 = i * 3;
      this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
      this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
      this.c[i3] = r; this.c[i3 + 1] = g; this.c[i3 + 2] = b;
      this.age[i] = -(delay || 0); this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a[i] = a;
      this.rot[i] = Math.random() * TAU; this.rv[i] = (Math.random() - 0.5) * (mode === 0 ? 0.8 : 3);
      this.grav[i] = grav || 0; this.drag[i] = drag || 0; this.fr[i] = fr; this.st[i] = st || 0; this.mode[i] = mode || 0;
    }
    kill(i) {
      const j = --this.n;
      if (i === j) return;
      const i3 = i * 3, j3 = j * 3;
      for (let k = 0; k < 3; k++) { this.p[i3 + k] = this.p[j3 + k]; this.v[i3 + k] = this.v[j3 + k]; this.c[i3 + k] = this.c[j3 + k]; }
      this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.a[i] = this.a[j];
      this.rot[i] = this.rot[j]; this.rv[i] = this.rv[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.fr[i] = this.fr[j]; this.st[i] = this.st[j]; this.mode[i] = this.mode[j];
    }
    clear() { this.n = 0; this.geo.instanceCount = 0; }
    update(dt) {
      const P = this.aPos.array, C = this.aCol.array, M = this.aMisc.array, D = this.aDir.array;
      const p = this.p, v = this.v;
      let i = 0;
      while (i < this.n) {
        const age = (this.age[i] += dt);
        if (age >= this.life[i]) { this.kill(i); continue; }
        const i3 = i * 3, i4 = i * 4;
        if (age < 0) { M[i4] = 0; M[i4 + 3] = 0; C[i4 + 3] = 0; P[i3] = p[i3]; P[i3 + 1] = p[i3 + 1]; P[i3 + 2] = p[i3 + 2]; i++; continue; }
        const t = age / this.life[i];
        const dr = Math.max(0, 1 - this.drag[i] * dt);
        const vx = v[i3] * dr, vy = v[i3 + 1] * dr - this.grav[i] * dt, vz = v[i3 + 2] * dr;
        v[i3] = vx; v[i3 + 1] = vy; v[i3 + 2] = vz;
        let px = p[i3] + vx * dt, py = p[i3 + 1] + vy * dt, pz = p[i3 + 2] + vz * dt;
        const mode = this.mode[i];
        if (mode === 3 && py < 0.05) { py = 0.05; v[i3] *= 0.5; v[i3 + 2] *= 0.5; v[i3 + 1] = Math.abs(vy) * 0.25; }
        p[i3] = px; p[i3 + 1] = py; p[i3 + 2] = pz;
        const e = 1 - (1 - t) * (1 - t);
        const size = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
        let al = this.a[i], r = this.c[i3], g = this.c[i3 + 1], b = this.c[i3 + 2];
        if (mode === 0) al *= Math.min(1, t * 7) * (1 - t);
        else if (mode === 1) { const k = 1 - t; al *= k * k; g *= 1 - t * 0.55; b *= 1 - t * 0.9; }
        else if (mode === 2) al *= 1 - t * t;
        else al *= t < 0.8 ? 1 : (1 - t) * 5;
        this.rot[i] += this.rv[i] * dt;
        P[i3] = px; P[i3 + 1] = py; P[i3 + 2] = pz;
        C[i4] = r; C[i4 + 1] = g; C[i4 + 2] = b; C[i4 + 3] = al;
        M[i4] = size; M[i4 + 1] = this.rot[i]; M[i4 + 2] = this.fr[i];
        const st = this.st[i];
        if (st > 0) {
          const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (sp > 0.001) { D[i3] = vx / sp; D[i3 + 1] = vy / sp; D[i3 + 2] = vz / sp; M[i4 + 3] = mode === 2 ? st : Math.min(st, sp * 0.06 + 0.05); } else M[i4 + 3] = 0;
        } else M[i4 + 3] = 0;
        i++;
      }
      const n = this.n;
      this.geo.instanceCount = n;
      for (const a of [this.aPos, this.aCol, this.aMisc, this.aDir]) { a.updateRange.offset = 0; a.updateRange.count = n * a.itemSize; a.needsUpdate = true; }
    }
  }

  // ---------- 진영 팔레트 ----------
  const TEAMS = [];
  function team(s) {
    if (TEAMS[s]) return TEAMS[s];
    const bright = new THREE.Color(SIDE_COLORS[s]);
    const main = bright.clone().lerp(new THREE.Color(0x58613f), 0.5);
    const t = {
      bright, main, dark: main.clone().multiplyScalar(0.6),
      uni: bright.clone().lerp(new THREE.Color(0x6e6c52), 0.6),
      helmet: bright.clone().lerp(new THREE.Color(0x4a4d3a), 0.62),
      coat: bright.clone().lerp(new THREE.Color(0x1d2026), 0.55),
    };
    t.uniLight = t.uni.clone().lerp(new THREE.Color(0xd8d8d0), 0.35);
    t.coatDark = t.coat.clone().multiplyScalar(0.55);
    return (TEAMS[s] = t);
  }
  const C = { skin: 0xd6a17a, boot: 0x2a2420, dark: 0x2c2d2a, vest: 0x6e6a4c, vest2: 0x5d5a40, olive: 0x5a5f3e, gun: 0x26272a, gun2: 0x3a3b36, rubber: 0x262626, gold: 0xd9a92b, met: 0x6a6c66 };

  // ---------- 유닛 모델 ----------
  function armsParts(A, type, uni, ut, tm) {
    if (type === 'commander') {
      A.box(0.11, 0.57, 0.11, 0.185, -0.05, 0.275, uni, ut, 1.746, -0.232, 0);
      A.box(0.125, 0.06, 0.125, 0.235, -0.0, 0.07, C.gold, 0, 1.746, -0.232, 0);
      A.sph(0.055, 0.06, 0.055, 0.12, -0.1, 0.56, 0xf2f2f2, 0);
      A.box(0.045, 0.085, 0.2, 0.12, -0.06, 0.64, 0x1c1c1c, 2);
      A.box(0.04, 0.11, 0.05, 0.12, -0.13, 0.58, 0x1c1c1c, 2, 0.25);
      A.box(0.12, 0.55, 0.12, -0.27, -0.27, 0.0, uni, ut, 0.05, 0, -0.08);
      A.sph(0.055, 0.06, 0.055, -0.29, -0.56, 0.02, 0xf2f2f2, 0);
      return [0.12, -0.06, 0.76];
    }
    const glove = type === 'sniper' ? 0x4a4a36 : 0x2e2e2c;
    A.box(0.115, 0.3, 0.12, 0.25, -0.135, 0.065, uni, ut, -0.45, 0, 0);
    A.box(0.125, 0.07, 0.13, 0.25, -0.07, 0.035, type === 'medic' ? 0xffffff : tm.bright, type === 'medic' ? 11 : 0, -0.45, 0, 0);
    A.box(0.1, 0.3, 0.1, 0.2, -0.235, 0.265, uni, ut, 1.33, -0.35, 0);
    A.sph(0.055, 0.06, 0.06, 0.15, -0.2, 0.4, glove, 0);
    A.box(0.115, 0.3, 0.12, -0.235, -0.12, 0.09, uni, ut, -0.64, 0, 0);
    A.box(0.1, 0.45, 0.1, -0.095, -0.2, 0.365, uni, ut, 1.39, 0.6, 0);
    A.sph(0.055, 0.06, 0.06, 0.03, -0.16, 0.56, glove, 0);
    if (type === 'sniper') {
      A.box(0.05, 0.12, 0.3, 0.09, -0.15, 0.02, 0x4f4a36, 2);
      A.box(0.06, 0.09, 0.42, 0.08, -0.12, 0.36, C.gun, 2);
      A.box(0.04, 0.1, 0.05, 0.08, -0.2, 0.36, C.gun, 2, 0.3);
      A.cyl(0.035, 0.34, 0.08, -0.03, 0.36, C.gun, 2, HP, 0, 0, 10);
      A.cyl(0.043, 0.05, 0.08, -0.03, 0.54, 0xffffff, 6, HP, 0, 0, 10);
      A.cyl(0.02, 0.8, 0.08, -0.11, 0.97, C.gun, 2, HP, 0, 0, 8);
      A.cyl(0.03, 0.12, 0.08, -0.11, 1.38, C.gun, 2, HP, 0, 0, 8);
      A.box(0.015, 0.3, 0.015, 0.05, -0.17, 0.72, C.gun, 2, 1.3, 0, 0.1);
      A.box(0.015, 0.3, 0.015, 0.11, -0.17, 0.72, C.gun, 2, 1.3, 0, -0.1);
      return [0.08, -0.11, 1.46];
    }
    if (type === 'medic') {
      A.box(0.045, 0.08, 0.2, 0.09, -0.15, 0.08, C.gun, 2);
      A.box(0.06, 0.1, 0.3, 0.08, -0.12, 0.33, C.gun, 2);
      A.box(0.04, 0.16, 0.05, 0.08, -0.23, 0.4, C.gun, 2, -0.15);
      A.cyl(0.025, 0.18, 0.08, -0.11, 0.56, C.gun, 2, HP, 0, 0, 8);
      return [0.08, -0.11, 0.66];
    }
    A.box(0.05, 0.11, 0.24, 0.09, -0.145, 0.05, C.gun, 2);
    A.box(0.06, 0.09, 0.36, 0.08, -0.12, 0.32, C.gun2, 2);
    A.box(0.04, 0.1, 0.05, 0.08, -0.19, 0.36, C.gun, 2, 0.3);
    A.box(0.045, 0.16, 0.07, 0.08, -0.22, 0.45, C.gun, 2, -0.25);
    A.box(0.065, 0.075, 0.24, 0.08, -0.115, 0.6, C.gun2, 2);
    A.box(0.03, 0.045, 0.1, 0.08, -0.055, 0.3, C.gun, 2);
    A.cyl(0.016, 0.22, 0.08, -0.11, 0.8, C.gun, 2, HP, 0, 0, 8);
    return [0.08, -0.11, 0.93];
  }
  function soldierParts(type, side) {
    const tm = team(side);
    const isS = type === 'sniper', isM = type === 'medic', isC = type === 'commander', isSF = type === 'sf';
    const uni = isS ? 0xffffff : isC ? tm.coat : isM ? tm.uniLight : isSF ? 0x24272b : tm.uni;
    const ut = isS ? 5 : isC ? 4 : isSF ? 4 : 1;
    const pants = isS ? 0xffffff : isC ? 0x25272c : isSF ? 0x24272b : tm.uni;
    const pt = isS ? 5 : isC ? 4 : 1;
    const L = new Builder();
    L.box(0.19, 0.46, 0.21, 0, -0.22, 0, pants, pt);
    L.box(0.17, 0.42, 0.19, 0, -0.63, 0, pants, pt);
    if (!isC) L.box(0.14, 0.1, 0.05, 0, -0.43, 0.105, C.dark, 4);
    if (isC) L.box(0.19, 0.36, 0.22, 0, -0.75, 0.01, 0x141418, 2);
    L.box(0.19, 0.13, 0.31, 0, -0.865, 0.045, isC ? 0x141418 : C.boot, 0);
    const b = new Builder();
    b.box(0.4, 0.18, 0.25, 0, 0.99, 0, pants, pt);
    b.box(0.42, 0.05, 0.27, 0, 1.07, 0, isC ? 0x3b2616 : C.dark, 0);
    b.box(0.44, 0.5, 0.25, 0, 1.33, 0, uni, ut);
    b.sph(0.12, 0.11, 0.12, 0.24, 1.51, 0, uni, ut);
    b.sph(0.12, 0.11, 0.12, -0.24, 1.51, 0, uni, ut);
    b.cyl(0.06, 0.12, 0, 1.6, 0, C.skin, 0, 0, 0, 0, 8);
    b.sph(0.115, 0.135, 0.125, 0, 1.72, 0.005, C.skin, 0);
    b.box(0.035, 0.05, 0.04, 0, 1.7, 0.125, C.skin, 0);
    if (type === 'infantry') {
      b.box(0.48, 0.36, 0.31, 0, 1.3, 0, C.vest, 4);
      for (const x of [-0.13, 0, 0.13]) b.box(0.1, 0.13, 0.06, x, 1.19, 0.17, C.vest2, 4);
      b.box(0.08, 0.1, 0.06, 0.17, 1.42, 0.17, C.dark, 4);
      b.box(0.34, 0.42, 0.18, 0, 1.34, -0.25, C.olive, 4);
      b.box(0.3, 0.12, 0.13, 0, 1.11, -0.24, 0x4b5034, 4);
      b.cyl(0.075, 0.38, 0, 1.6, -0.24, 0x4a4f36, 4, 0, 0, HP, 8);
      b.cyl(0.012, 0.5, 0.12, 1.78, -0.3, 0x222222, 0, -0.15, 0, 0, 4);
      b.add('hemi:12:6', 0.158, 0.15, 0.168, 0, 1.735, 0, 0, 0, 0, tm.helmet, 1);
      b.cyl(0.166, 0.03, 0, 1.735, 0, tm.helmet, 1, 0, 0, 0, 14);
      b.box(0.17, 0.05, 0.05, 0, 1.8, 0.135, 0x1e2226, 6, -0.3);
      b.box(0.06, 0.04, 0.02, 0, 1.79, -0.165, tm.bright, 0);
    } else if (isM) {
      b.box(0.47, 0.36, 0.3, 0, 1.3, 0, 0xd9d9d0, 4);
      b.box(0.18, 0.18, 0.02, 0, 1.36, 0.16, 0xffffff, 11);
      b.box(0.36, 0.42, 0.2, 0, 1.33, -0.25, 0xffffff, 11);
      b.add('hemi:12:6', 0.158, 0.15, 0.168, 0, 1.735, 0, 0, 0, 0, 0xe6e6e0, 0);
      b.cyl(0.166, 0.03, 0, 1.735, 0, 0xe6e6e0, 0, 0, 0, 0, 14);
      b.box(0.09, 0.09, 0.02, 0, 1.81, 0.15, 0xffffff, 11, -0.45);
      b.box(0.02, 0.09, 0.09, 0.158, 1.79, 0, 0xffffff, 11);
      b.box(0.02, 0.09, 0.09, -0.158, 1.79, 0, 0xffffff, 11);
      b.box(0.08, 0.14, 0.08, -0.22, 1.02, 0.08, 0xd9d9d0, 11);
    } else if (isS) {
      b.box(0.52, 0.42, 0.34, 0, 1.3, 0, 0xffffff, 5);
      b.add('hemi:10:5', 0.21, 0.2, 0.22, 0, 1.71, -0.01, 0, 0, 0, 0xffffff, 5);
      b.box(0.2, 0.04, 0.02, 0, 1.73, 0.125, 0x15181a, 6);
      seed = 4242;
      const cs = [0xffffff, 0xd8e0c0, 0xbfc79f, 0xe8e0c8];
      for (let i = 0; i < 26; i++) {
        const a = sr(-2.6, 2.6), y = sr(1.05, 1.85), r = y > 1.6 ? 0.2 : 0.27;
        b.add('cone:5', sr(0.05, 0.09), sr(0.2, 0.38), sr(0.05, 0.09), Math.sin(a) * r, y, -Math.abs(Math.cos(a)) * r * 0.9 - 0.02, Math.PI + sr(-0.5, 0.5), a, sr(-0.4, 0.4), cs[i % 4], 5);
      }
      b.box(0.16, 0.65, 0.12, 0.05, 1.3, -0.26, 0x6a6f4a, 4, 0, 0, 0.5);
    } else if (isC) {
      b.box(0.48, 0.62, 0.3, 0, 1.24, 0, tm.coat, 4);
      b.box(0.5, 0.44, 0.33, 0, 0.78, 0, tm.coat, 4);
      b.box(0.3, 0.09, 0.27, 0, 1.58, -0.01, tm.coat, 4);
      b.box(0.11, 0.26, 0.02, -0.07, 1.42, 0.155, tm.coatDark, 4, 0, 0, 0.25);
      b.box(0.11, 0.26, 0.02, 0.07, 1.42, 0.155, tm.coatDark, 4, 0, 0, -0.25);
      for (const y of [1.34, 1.22, 1.1, 0.95, 0.8]) for (const x of [-0.08, 0.08]) b.box(0.03, 0.03, 0.02, x, y, y > 1 ? 0.155 : 0.17, C.gold, 0);
      b.box(0.5, 0.06, 0.34, 0, 1.02, 0, 0x3b2616, 0);
      b.box(0.07, 0.06, 0.02, 0, 1.02, 0.175, C.gold, 0);
      b.box(0.16, 0.04, 0.15, 0.25, 1.6, 0, C.gold, 2);
      b.box(0.16, 0.04, 0.15, -0.25, 1.6, 0, C.gold, 2);
      [0xc81e1e, 0x1e5ec8, C.gold, 0x2a9d48].forEach((m, i) => b.box(0.04, 0.05, 0.02, -0.19 + i * 0.045, 1.44, 0.16, m, 0));
      b.cyl(0.152, 0.05, 0, 1.82, 0, 0x151515, 0, 0, 0, 0, 14);
      b.cyl(0.15, 0.1, 0, 1.885, 0, tm.coat, 4, 0, 0, 0, 14, 1.22);
      b.cyl(0.183, 0.02, 0, 1.94, 0, tm.coat, 4, 0, 0, 0, 14);
      b.box(0.22, 0.02, 0.11, 0, 1.805, 0.15, 0x111111, 0, 0.25);
      b.box(0.24, 0.015, 0.02, 0, 1.835, 0.155, C.gold, 0);
      b.box(0.07, 0.07, 0.02, 0, 1.89, 0.17, C.gold, 0, -0.2);
      b.box(0.18, 0.04, 0.03, 0, 1.735, 0.115, 0x0a0a0a, 6);
      b.cyl(0.018, 1.7, 0.16, 1.95, -0.2, 0x3a3a3a, 2, 0, 0, 0, 6);
      b.box(0.07, 0.14, 0.1, -0.26, 0.98, 0.04, 0x3b2616, 0);
    } else if (type === 'marine') {
      // 전설의 K-해병대원: 팔각모 + 빨간 명찰 + 전투 조끼
      b.box(0.48, 0.36, 0.31, 0, 1.3, 0, C.vest, 4);
      for (const x of [-0.13, 0, 0.13]) b.box(0.1, 0.13, 0.06, x, 1.19, 0.17, C.vest2, 4);
      b.box(0.15, 0.05, 0.02, 0.11, 1.43, 0.165, 0xc81e1e, 0);
      b.box(0.15, 0.012, 0.022, 0.11, 1.412, 0.166, 0xf2c230, 0);
      b.box(0.34, 0.42, 0.18, 0, 1.34, -0.25, C.olive, 4);
      b.cyl(0.152, 0.12, 0, 1.83, 0, tm.uni, 1, 0, 0, 0, 8);
      b.cyl(0.155, 0.015, 0, 1.895, 0, tm.uni, 1, 0, 0, 0, 8);
      b.box(0.22, 0.02, 0.11, 0, 1.775, 0.15, tm.uni, 1, 0.15);
      b.box(0.055, 0.055, 0.02, 0, 1.84, 0.152, C.gold, 0);
      b.box(0.18, 0.035, 0.03, 0, 1.735, 0.12, 0x0a0a0a, 6);
    } else if (isSF) {
      // 특전사가 된 전설의 K-해병대원: 검은 전투복, 복면, 검은 베레모, 야간투시경, 해병대원 명찰은 그대로
      b.box(0.5, 0.38, 0.32, 0, 1.3, 0, 0x16181a, 4);
      for (const x of [-0.14, -0.05, 0.05, 0.14]) b.box(0.08, 0.12, 0.06, x, 1.18, 0.17, 0x2b2e33, 4);
      b.box(0.15, 0.05, 0.02, 0.11, 1.43, 0.17, 0xc81e1e, 0);
      b.box(0.15, 0.012, 0.022, 0.11, 1.412, 0.171, 0xf2c230, 0);
      b.box(0.06, 0.06, 0.02, -0.12, 1.44, 0.17, C.gold, 0);
      b.box(0.36, 0.44, 0.2, 0, 1.34, -0.26, 0x1c1e21, 4);
      b.sph(0.124, 0.142, 0.132, 0, 1.72, 0.006, 0x121315, 0);
      b.box(0.17, 0.03, 0.02, 0, 1.74, 0.13, C.skin, 0);
      b.add('hemi:12:6', 0.165, 0.075, 0.175, -0.02, 1.805, 0, 0, 0, 0.22, 0x0b0b0d, 0);
      b.box(0.05, 0.05, 0.02, -0.08, 1.83, 0.14, C.gold, 0);
      for (const x of [-0.045, 0.045]) b.cyl(0.028, 0.09, x, 1.79, 0.16, 0x1e2a1e, 2, HP, 0, 0, 8);
      b.box(0.14, 0.04, 0.05, 0, 1.79, 0.11, 0x222222, 2);
    }
    const A = new Builder();
    const muzzle = armsParts(A, type, uni, ut, tm);
    return { body: b.geometry(), legs: L.geometry(), arms: A.geometry(), meta: { muzzle, h: 2.3 } };
  }
  function tankParts(side) {
    const tm = team(side), P = tm.main, Pd = tm.dark, TR = 0x3b3b37;
    const b = new Builder();
    for (const s of [-1, 1]) {
      const x = s * 1.12;
      b.box(0.6, 0.6, 4.3, x, 0.42, 0, TR, 3);
      b.cyl(0.3, 0.6, x, 0.42, 2.15, TR, 3, 0, 0, HP, 12);
      b.cyl(0.3, 0.6, x, 0.42, -2.15, TR, 3, 0, 0, HP, 12);
      for (let i = 0; i < 6; i++) b.cyl(0.27, 0.12, s * 1.43, 0.36, -1.75 + i * 0.7, 0x4a4c46, 2, 0, 0, HP, 12);
      b.cyl(0.32, 0.14, s * 1.43, 0.55, 2.2, 0x3f413c, 2, 0, 0, HP, 10);
      b.box(0.07, 0.42, 4.2, s * 1.49, 0.78, 0.05, P, 1);
      b.box(0.07, 0.06, 4.2, s * 1.49, 0.56, 0.05, Pd, 2);
      b.box(0.5, 0.3, 0.9, s * 1.2, 1.17, -0.9, Pd, 2);
      b.box(0.2, 0.1, 0.08, s * 1.2, 1.1, 2.33, 0xfff3d0, 12);
      b.box(0.5, 0.2, 0.1, s * 0.6, 0.95, -2.22, 0x2a2a2a, 9);
      b.cyl(0.21, 0.75, s * 0.42, 1.42, -2.3, 0x4d5a3a, 2, 0, 0, HP, 10);
    }
    b.box(2.95, 0.1, 4.6, 0, 1.0, 0.05, P, 2);
    b.box(1.66, 0.6, 4.4, 0, 0.66, 0, Pd, 1);
    b.box(2.2, 0.34, 3.3, 0, 1.2, -0.45, P, 1);
    b.box(2.2, 0.1, 1.4, 0, 1.06, 1.83, P, 1, 0.46);
    b.box(1.9, 0.48, 0.1, 0, 0.56, 2.33, Pd, 2, 0.55);
    b.box(1.5, 0.06, 0.32, 0, 1.22, 1.6, TR, 3, 0.46);
    b.box(1.8, 0.04, 1.3, 0, 1.385, -1.35, 0x9a9a9a, 9);
    b.box(2.2, 0.55, 0.1, 0, 1.1, -2.15, Pd, 2);
    const t = new Builder();
    t.box(1.9, 0.5, 2.0, 0, 0.25, -0.1, P, 1);
    for (const s of [-1, 1]) {
      t.box(0.85, 0.48, 1.05, s * 0.5, 0.24, 1.0, P, 1, 0, -s * 0.45, 0);
      t.box(0.02, 0.34, 0.34, s * 0.955, 0.27, -0.45, tm.bright, 10);
      for (let k = 0; k < 3; k++) t.cyl(0.055, 0.22, s * (0.78 + k * 0.08), 0.5, 0.45 - k * 0.1, 0x30302c, 2, -1.0, 0, 0, 8);
    }
    t.box(1.7, 0.04, 1.8, 0, 0.51, -0.2, Pd, 2);
    t.box(1.75, 0.42, 0.85, 0, 0.27, -1.45, P, 2);
    t.box(1.9, 0.06, 0.5, 0, 0.5, -1.95, 0x333333, 9);
    t.cyl(0.3, 0.22, -0.48, 0.6, -0.4, C.met, 2, 0, 0, 0, 12);
    t.box(0.52, 0.05, 0.52, -0.48, 0.92, -0.72, C.met, 2, 1.1);
    t.box(0.36, 0.32, 0.26, -0.48, 0.86, -0.4, tm.uni, 1);
    t.sph(0.115, 0.13, 0.12, -0.48, 1.12, -0.38, C.skin, 0);
    t.add('hemi:10:5', 0.15, 0.14, 0.16, -0.48, 1.14, -0.38, 0, 0, 0, 0x2f3328, 4);
    t.cyl(0.04, 0.3, 0.5, 0.65, -0.1, C.met, 2, 0, 0, 0, 8);
    t.box(0.08, 0.1, 0.42, 0.5, 0.83, 0.0, C.gun, 2);
    t.cyl(0.02, 0.6, 0.5, 0.84, 0.48, C.gun, 2, HP, 0, 0, 6);
    t.box(0.3, 0.24, 0.32, 0.55, 0.62, 0.55, C.met, 2);
    t.box(0.26, 0.16, 0.02, 0.55, 0.62, 0.72, 0xffffff, 6);
    t.cyl(0.015, 2.0, 0.7, 1.5, -1.5, 0x222222, 0, 0, 0, 0, 4);
    const g = new Builder();
    g.box(0.8, 0.42, 0.42, 0, 0, 0.1, P, 1);
    g.cyl(0.085, 3.0, 0, 0, 1.75, 0x5c5e58, 2, HP, 0, 0, 10);
    g.cyl(0.115, 1.0, 0, 0, 0.85, P, 2, HP, 0, 0, 10);
    g.cyl(0.135, 0.42, 0, 0, 1.9, P, 2, HP, 0, 0, 10);
    g.cyl(0.1, 0.14, 0, 0, 3.2, Pd, 2, HP, 0, 0, 10);
    return { body: b.geometry(), turret: t.geometry(), gun: g.geometry(), meta: { turret: [0, 1.38, -0.15], gun: [0, 0.28, 1.05], muzzle: [0, 0, 3.32], flag: [0.71, 2.2, -1.5], h: 2.9 } };
  }
  function apcParts(side) {
    const tm = team(side), P = tm.main, Pd = tm.dark;
    const b = new Builder();
    for (const s of [-1, 1]) {
      for (const z of [-1.9, -0.8, 0.8, 1.9]) {
        b.cyl(0.5, 0.38, s * 1.12, 0.5, z, C.rubber, 7, 0, 0, HP, 14);
        b.cyl(0.24, 0.4, s * 1.13, 0.5, z, 0x55583f, 2, 0, 0, HP, 8);
      }
      b.box(0.3, 0.06, 4.9, s * 1.2, 1.17, 0, Pd, 2);
      b.box(0.03, 0.55, 0.9, s * 1.285, 1.5, 0.3, Pd, 2);
      b.box(0.12, 0.4, 0.28, s * 1.33, 1.5, -1.6, 0x4d5a3a, 2);
      b.box(0.03, 0.42, 0.42, s * 1.29, 1.55, -0.9, tm.bright, 10);
      b.box(0.22, 0.12, 0.06, s * 0.95, 1.3, 2.86, 0xfff3d0, 12);
      b.box(0.12, 0.08, 0.04, s * 1.05, 1.75, -2.62, 0xcc2020, 12);
      b.box(0.08, 0.35, 4.5, s * 1.17, 1.98, -0.3, P, 1, 0, 0, -s * 0.6);
    }
    b.box(2.0, 0.6, 5.3, 0, 0.92, 0, Pd, 1);
    b.box(2.55, 0.72, 4.8, 0, 1.55, -0.2, P, 1);
    b.box(2.2, 0.25, 4.5, 0, 2.02, -0.3, P, 2);
    b.box(2.5, 0.1, 1.1, 0, 1.53, 2.6, P, 1, 0.76);
    b.box(2.0, 0.57, 0.1, 0, 0.93, 2.83, Pd, 2, 0.66);
    b.box(0.55, 0.06, 0.55, -0.6, 2.17, 1.55, Pd, 2);
    for (let k = -1; k <= 1; k++) b.box(0.1, 0.08, 0.06, -0.6 + k * 0.14, 2.2, 1.85, 0xffffff, 6);
    b.box(1.2, 0.95, 0.06, 0, 1.45, -2.63, Pd, 2);
    b.box(0.03, 0.3, 0.6, 1.285, 1.7, 1.2, 0x333333, 9);
    b.cyl(0.015, 1.8, -0.95, 3.0, -2.2, 0x222222, 0, 0, 0, 0, 4);
    const t = new Builder();
    t.cyl(0.62, 0.14, 0, 0.0, 0, Pd, 2, 0, 0, 0, 16);
    t.box(1.15, 0.48, 1.3, 0, 0.3, 0, P, 1);
    t.box(0.9, 0.36, 0.45, 0, 0.25, 0.82, Pd, 2);
    t.box(0.3, 0.26, 0.3, 0.45, 0.68, 0.2, C.met, 2);
    t.box(0.22, 0.14, 0.02, 0.45, 0.68, 0.36, 0xffffff, 6);
    t.cyl(0.25, 0.08, -0.3, 0.58, -0.25, Pd, 2, 0, 0, 0, 10);
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) t.cyl(0.05, 0.2, s * 0.62, 0.45, -0.25 + k * 0.13, 0x30302c, 2, -0.9, 0, s * 0.4, 8);
    const g = new Builder();
    g.box(0.22, 0.22, 0.35, 0, 0, 0, Pd, 2);
    g.cyl(0.05, 1.7, 0, 0, 0.95, C.gun, 2, HP, 0, 0, 8);
    g.cyl(0.075, 0.2, 0, 0, 1.85, C.gun, 2, HP, 0, 0, 8);
    g.cyl(0.025, 0.5, 0.2, -0.05, 0.4, C.gun, 2, HP, 0, 0, 6);
    return { body: b.geometry(), turret: t.geometry(), gun: g.geometry(), meta: { turret: [0, 2.1, -0.2], gun: [0, 0.32, 0.75], muzzle: [0, 0, 2.0], flag: [-0.94, 3.6, -2.2], h: 3.3 } };
  }
  function heliParts(side) {
    const tm = team(side), P = tm.main, Pd = tm.dark;
    const b = new Builder();
    b.add('sph:14:10', 0.48, 0.55, 0.95, 0, -0.05, 2.0, 0, 0, 0, P, 1);
    b.add('cyl:14:0.72', 0.62, 2.6, 0.78, 0, 0, 0.55, HP, 0, 0, P, 1);
    b.add('sph:14:10', 0.42, 0.42, 1.05, 0, 0.5, 1.3, -0.05, 0, 0, 0xffffff, 6);
    b.box(0.04, 0.05, 1.9, 0, 0.93, 1.25, 0x222222, 2);
    b.box(0.86, 0.04, 0.04, 0, 0.72, 1.3, 0x222222, 2);
    b.box(0.95, 0.5, 1.8, 0, 0.6, -0.2, P, 1);
    for (const s of [-1, 1]) {
      b.add('cyl:12:0.85', 0.3, 1.6, 0.3, s * 0.62, 0.62, -0.35, HP, 0, 0, P, 1);
      b.cyl(0.2, 0.35, s * 0.72, 0.68, -1.25, 0x2a2a2a, 9, HP - 0.2, s * 0.3, 0, 10);
      b.box(0.08, 0.22, 0.35, s * 0.95, -0.22, 0.35, Pd, 2);
      b.cyl(0.2, 1.05, s * 0.95, -0.45, 0.4, 0x4f5640, 2, HP, 0, 0, 12);
      b.cyl(0.17, 0.02, s * 0.95, -0.45, 0.93, 0x111111, 9, HP, 0, 0, 12);
      for (const dx of [-0.1, 0.1]) {
        b.cyl(0.065, 0.95, s * 1.38 + dx, -0.38, 0.35, 0xc8c8c0, 0, HP, 0, 0, 8);
        b.add('cone:8', 0.065, 0.14, 0.065, s * 1.38 + dx, -0.38, 0.89, HP, 0, 0, 0x666666, 0);
      }
      b.box(0.06, 0.5, 0.06, s * 0.6, -0.6, 1.0, 0x333333, 2, 0, 0, s * 0.25);
      b.cyl(0.17, 0.1, s * 0.7, -0.86, 1.0, C.rubber, 7, 0, 0, HP, 10);
      b.box(0.02, 0.35, 0.35, s * 0.345, 0.3, -2.2, tm.bright, 10);
    }
    b.box(0.45, 0.35, 0.7, 0, 1.0, 0.1, Pd, 2);
    b.cyl(0.1, 0.4, 0, 1.25, 0.1, 0x333333, 2, 0, 0, 0, 8);
    b.add('cyl:12:0.38', 0.42, 4.6, 0.42, 0, 0.3, -3.0, -HP, 0, 0, P, 1);
    b.box(0.1, 1.45, 0.75, 0, 1.0, -5.15, P, 1, -0.35);
    b.box(1.9, 0.07, 0.55, 0, 0.35, -4.7, P, 1);
    b.box(3.0, 0.09, 0.8, 0, -0.08, 0.35, P, 1);
    b.sph(0.2, 0.18, 0.2, 0, -0.55, 2.15, 0x333333, 2);
    b.cyl(0.03, 0.75, 0, -0.6, 2.6, 0x222222, 2, HP, 0, 0, 6);
    b.sph(0.2, 0.2, 0.2, 0, -0.25, 2.8, 0x2a2a2a, 2);
    b.box(0.18, 0.1, 0.02, 0, -0.25, 2.99, 0xffffff, 6);
    b.cyl(0.08, 0.06, 0, -0.1, -4.8, C.rubber, 7, 0, 0, HP, 8);
    const r = new Builder();
    r.cyl(0.22, 0.2, 0, 0, 0, 0x2a2a2a, 2, 0, 0, 0, 10);
    for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; r.box(0.3, 0.04, 4.5, Math.sin(a) * 2.35, 0, Math.cos(a) * 2.35, 0x262826, 2, 0.04, a, 0); }
    const tr = new Builder();
    tr.box(0.03, 1.3, 0.14, 0, 0, 0, 0x262826, 2);
    tr.box(0.03, 0.14, 1.3, 0, 0, 0, 0x262826, 2);
    tr.cyl(0.08, 0.08, 0, 0, 0, 0x333333, 2, 0, 0, HP, 8);
    return { body: b.geometry(), rotor: r.geometry(), tail: tr.geometry(), meta: { rotor: [0, 1.47, 0.1], tail: [0.12, 1.0, -5.25], muzzle: [0, -0.6, 3.0], h: 2.2 } };
  }

  return { TAU, HP, clamp, smooth, rnd, sr, srnd, setSeed: s => { seed = s; }, fbm, noise2, hash2, terrainH, canvas, tex, rgba, Builder, prim, col, team, C,
    unitAtlas, concreteTex, brickTex, metalTex, sandbagTex, woodTex, fenceTex, helipadTex, detailTex, tuftTex, particleTex, scorchTex, rotorTex, ringTex,
    groundCanvas, skyMaterial, Particles, soldierParts, tankParts, apcParts, heliParts };
})();

class Renderer {
  constructor(container) {
    this.container = container;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.maxPR = Math.min(window.devicePixelRatio || 1, 1.5);
    this.pr = this.maxPR;
    r.setPixelRatio(this.pr);
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.canvas = r.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.4, 1600);
    this.clock = 0;

    // 공용 벡터 (프레임당 할당 방지)
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._seen = new Set();
    this._aim = { o: new THREE.Vector3(), d: new THREE.Vector3() };
    this._camSave = new THREE.Vector3();

    this.textures = {};
    this.setupSkyAndLights();
    this.mats = this.makeMaterials();
    this.geo = this.makeGeometries();
    this.buildWorld();
    this.setupFx();

    this.meshes = new Map();   // 유닛 id → 렌더 객체
    this.unitGeoCache = {};
    this.corpses = [];
    this.fx = [];
    this.emitters = [];
    this.proj = [];
    this.matchGroup = null;
    this.flagMeshes = [];
    this.factories = [[], []];
    this.radar = [];
    this.mySide = 0;
    this.names = ['', ''];
    this.cam = { x: 0, z: 60, dist: 75, yaw: 0, pitch: 0.95 };
    this.camMode = 'rts';
    this.followId = 0;
    this.selectedId = 0;
    this.shake = 0;
    this.raycaster = new THREE.Raycaster();
    this.perf = { last: performance.now(), avg: 16, slowT: 0, fastT: 0 };
    this.precompile();

    window.addEventListener('resize', () => this.resize());
  }

  // 처음 쓰일 때 생기는 셰이더 컴파일 끊김 방지 (잔해/데칼/충격파/로터 재질 미리 컴파일)
  precompile() {
    try {
      const tmp = new THREE.Group();
      const g = this.geo.decal;
      for (const m of [this.mats.wreck, this.rotorMat, this.decals[0].m.material, this.shocks[0].m.material, this.mats.ringSel]) tmp.add(new THREE.Mesh(g, m));
      tmp.position.y = -50;
      this.scene.add(tmp);
      this.camera.position.set(0, 60, 80); this.camera.lookAt(0, 0, 0);
      this.renderer.compile(this.scene, this.camera);
      this.scene.remove(tmp);
    } catch (e) { /* 무시 */ }
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  inMatch() { return (typeof App !== 'undefined' && !!App.match) || (typeof TdmGame !== 'undefined' && !!TdmGame.active); }

  // ---------- 하늘 / 조명 / 환경광 ----------
  setupSkyAndLights() {
    const s = this.scene;
    this.sunDir = new THREE.Vector3(0.72, 0.6, 0.34).normalize();
    this.skyU = {
      uTop: { value: new THREE.Color(0x3f78c0) },
      uHorizon: { value: new THREE.Color(0xc4d6e4) },
      uGround: { value: new THREE.Color(0x737a66) },
      uSunDir: { value: this.sunDir },
      uSunColor: { value: new THREE.Color(1.0, 0.9, 0.74) },
      uTime: { value: 0 },
      uClouds: { value: 1 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1300, 32, 16), R3D.skyMaterial(this.skyU));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    s.add(this.sky);
    s.fog = new THREE.FogExp2(this.skyU.uHorizon.value.clone(), 0.0021);
    s.background = null;

    // 환경광 (하늘을 PMREM으로 굽기)
    try {
      const envScene = new THREE.Scene();
      const envU = Object.assign({}, this.skyU, { uClouds: { value: 0 } });
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), R3D.skyMaterial(envU)));
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.envRT = pm.fromScene(envScene, 0.02, 0.1, 200);
      s.environment = this.envRT.texture;
      pm.dispose();
    } catch (e) { console.warn('env map failed', e); }

    this.hemi = new THREE.HemisphereLight(0xd6e6ff, 0x5a5236, 0.32);
    s.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 1.6;
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 400;
    this.shadowExt = 0;
    s.add(sun); s.add(sun.target);
    this.sun = sun;
  }

  makeMaterials() {
    const T = this.textures;
    T.atlas = R3D.unitAtlas();
    T.concrete = R3D.concreteTex(); T.brick = R3D.brickTex(); T.metal = R3D.metalTex(); T.sand = R3D.sandbagTex(); T.wood = R3D.woodTex(); T.fence = R3D.fenceTex();
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0.0 }, o));
    const M = {
      unit: std({ map: T.atlas, vertexColors: true, roughness: 0.68, metalness: 0.12, envMapIntensity: 0.9 }),
      wreck: std({ map: T.atlas, vertexColors: true, color: 0x3d352e, roughness: 1, envMapIntensity: 0.3 }),
      conc: std({ map: T.concrete, vertexColors: true, roughness: 0.92 }),
      brick: std({ map: T.brick, vertexColors: true, roughness: 0.9 }),
      metal: std({ map: T.metal, vertexColors: true, roughness: 0.55, metalness: 0.35 }),
      paint: std({ vertexColors: true, roughness: 0.5, metalness: 0.2 }),
      glass: std({ color: 0x223448, vertexColors: true, roughness: 0.08, metalness: 0.8, envMapIntensity: 1.6 }),
      sand: std({ map: T.sand, vertexColors: true, roughness: 1 }),
      wood: std({ map: T.wood, vertexColors: true, roughness: 0.9 }),
      fence: std({ map: T.fence, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 }),
      tree: std({ vertexColors: true, flatShading: true, roughness: 0.9 }),
      rock: std({ color: 0x8a857a, flatShading: true, roughness: 0.95 }),
      ring: new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false }),
      ringSel: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }),
    };
    return M;
  }

  makeGeometries() {
    return {
      ring: new THREE.RingGeometry(0.85, 1, 40),
      flagSmall: (() => { const g = new THREE.PlaneGeometry(0.9, 0.6, 6, 4); g.translate(0.45, 0, 0); return g; })(),
      rotorDisc: new THREE.CircleGeometry(4.75, 36).rotateX(-Math.PI / 2),
      decal: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      shock: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    };
  }

  mesh(geo, mat, sx, sy, sz, x = 0, y = 0, z = 0, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.castShadow = true;
    if (parent) parent.add(m);
    return m;
  }

  // Builder의 재질 키별로 메쉬 생성
  builderMeshes(b, parent, uv = {}, opts = {}) {
    const out = [];
    for (const k of b.keys()) {
      const world = k !== 'u' && k !== 'tree';
      const geo = b.geometry(k, world, uv[k] || 4);
      const m = new THREE.Mesh(geo, this.mats[k] || this.mats.conc);
      m.castShadow = opts.cast !== false && k !== 'fence' && k !== 'glass';
      m.receiveShadow = true;
      parent.add(m);
      out.push(m);
    }
    return out;
  }

  // ---------- 지형 / 배경 ----------
  buildWorld() {
    const s = this.scene, M = this.mats;
    // 지면: 비균일 격자 (전장은 평지, 바깥은 언덕/산맥)
    const coords = (inner, step, outer) => {
      const a = []; for (let v = -inner; v <= inner + 1e-6; v += step) a.push(v);
      const o = []; let v = inner, st = step;
      while (v < outer) { st = Math.min(st * 1.12, 20); v = Math.min(outer, v + st); o.push(v); }
      return [...o.map(x => -x).reverse(), ...a, ...o];
    };
    const xs = coords(80, 4, 560), zs = coords(140, 4, 600);
    const nx = xs.length, nz = zs.length;
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), colA = new Float32Array(nx * nz * 3);
    const base = new THREE.Color(0x4b6e31);
    const tgt = new THREE.Color(), tmp = new THREE.Color();
    const dry = new THREE.Color(0x8a8a4c), rock = new THREE.Color(0x77736a), snow = new THREE.Color(0xeef2f5), dark = new THREE.Color(0x3a5a2a);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], k = j * nx + i;
      const h = R3D.terrainH(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      uv[k * 2] = (x + 80) / 160; uv[k * 2 + 1] = 1 - (z + 140) / 280;
      const d = Math.hypot(Math.max(0, Math.abs(x) - 44), Math.max(0, Math.abs(z) - 124));
      const w = R3D.smooth(0, 25, d);
      tgt.copy(base);
      const n1 = R3D.fbm(x * 0.012 + 3, z * 0.012 - 7, 3);
      tgt.lerp(dry, R3D.smooth(0.45, 0.75, n1) * 0.7);
      tgt.lerp(dark, R3D.smooth(0.5, 0.2, R3D.fbm(x * 0.03, z * 0.03, 2)) * 0.6);
      tgt.lerp(rock, R3D.smooth(28, 60, h) * (0.6 + 0.4 * n1));
      tgt.lerp(snow, R3D.smooth(105, 135, h + n1 * 25));
      tmp.setRGB(tgt.r / base.r, tgt.g / base.g, tgt.b / base.b);
      colA[k * 3] = 1 + (tmp.r - 1) * w; colA[k * 3 + 1] = 1 + (tmp.g - 1) * w; colA[k * 3 + 2] = 1 + (tmp.b - 1) * w;
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const gt = R3D.tex(R3D.groundCanvas());
    gt.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const detail = R3D.detailTex();
    const gm = new THREE.MeshStandardMaterial({ map: gt, vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.55 });
    gm.onBeforeCompile = sh => {
      sh.uniforms.detailMap = { value: detail };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 dtl = texture2D(detailMap, vUv * vec2(60.0, 105.0)).rgb;
          float dtl2 = texture2D(detailMap, vUv * vec2(7.0, 12.25) + 0.37).r;
          diffuseColor.rgb *= (dtl * 2.0) * (0.8 + dtl2 * 0.4);`);
    };
    const ground = new THREE.Mesh(geo, gm);
    ground.receiveShadow = true;
    s.add(ground);
    this.ground = ground;

    this.buildVegetation();
    this.buildFieldProps();
  }

  buildVegetation() {
    const s = this.scene, M = this.mats;
    R3D.setSeed(1234567);
    const sr = R3D.sr, H = R3D.terrainH;
    // 나무 모델 (침엽수 / 활엽수)
    const pine = new R3D.Builder();
    pine.cyl(0.18, 2.2, 0, 1.1, 0, 0x4a3524, 0, 0, 0, 0, 6);
    pine.add('cone:7', 1.6, 2.4, 1.6, 0, 2.5, 0, 0, 0, 0, 0x2b5426, 0);
    pine.add('cone:7', 1.25, 2.1, 1.25, 0, 3.6, 0, 0, 0.4, 0, 0x30602b, 0);
    pine.add('cone:7', 0.85, 1.8, 0.85, 0, 4.7, 0, 0, 0.8, 0, 0x3a6c31, 0);
    const leaf = new R3D.Builder();
    leaf.cyl(0.22, 2.8, 0, 1.4, 0, 0x5a4330, 0, 0, 0, 0, 6, 0.7);
    leaf.add('ico:1', 1.6, 1.4, 1.6, 0, 3.6, 0, 0, 0, 0, 0x4a7a2e, 0);
    leaf.add('ico:1', 1.15, 1.0, 1.15, 0.9, 3.1, 0.4, 0, 0, 0, 0x3f6e28, 0);
    leaf.add('ico:1', 1.05, 1.0, 1.05, -0.8, 3.3, -0.4, 0, 0, 0, 0x55843a, 0);
    leaf.add('ico:1', 0.95, 0.9, 0.95, 0.1, 4.5, 0.2, 0, 0, 0, 0x5b8a3c, 0);
    const spots = [];
    const tryAdd = (x, z) => {
      const h = H(x, z);
      if (h > 70) return;
      if (Math.abs(x) < 44 && Math.abs(z) < 126) return;
      spots.push([x, h, z]);
    };
    for (let i = 0; i < 900 && spots.length < 520; i++) {
      const side = srnd2() < 0.5 ? -1 : 1;
      const r = Math.pow(sr(0, 1), 1.6);
      tryAdd(side * (46 + r * 200), sr(-260, 260));
    }
    for (let i = 0; i < 160; i++) { const zs = R3D.srnd() < 0.5 ? -1 : 1; tryAdd(sr(-60, 60), zs * sr(130, 230)); }
    function srnd2() { return R3D.srnd(); }
    const mk = (geo, list) => {
      const im = new THREE.InstancedMesh(geo, M.tree, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
      list.forEach((t, i) => {
        const k = sr(0.85, 1.75);
        e.set(sr(-0.05, 0.05), sr(0, 6.28), sr(-0.05, 0.05)); q.setFromEuler(e);
        m.compose(p.set(t[0], t[1] - 0.2, t[2]), q, sc.set(k, k * sr(0.9, 1.2), k));
        im.setMatrixAt(i, m);
        const v = sr(0.8, 1.15); c.setRGB(v * sr(0.92, 1.05), v, v * sr(0.9, 1.0)); im.setColorAt(i, c);
      });
      im.castShadow = true; im.receiveShadow = true;
      s.add(im);
      return im;
    };
    const pines = [], leafs = [];
    spots.forEach((p, i) => (i % 3 === 0 ? leafs : pines).push(p));
    this.vegTrees = [mk(pine.geometry('u'), pines), mk(leaf.geometry('u'), leafs)];

    // 바위
    const rg = new THREE.DodecahedronGeometry(1, 1);
    {
      const p = rg.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 0.75 + R3D.hash2(Math.round(x * 100) + 7 * Math.round(z * 100), Math.round(y * 100)) * 0.5;
        p.setXYZ(i, x * k, y * k * 0.75, z * k);
      }
      rg.computeVertexNormals();
    }
    const rocks = [];
    for (let i = 0; i < 140; i++) {
      const side = R3D.srnd() < 0.5 ? -1 : 1;
      const x = side * sr(37, 120), z = sr(-200, 200);
      rocks.push([x, H(x, z), z, sr(0.5, 2.4)]);
    }
    {
      const im = new THREE.InstancedMesh(rg, M.rock, rocks.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
      rocks.forEach((r, i) => {
        e.set(sr(0, 6), sr(0, 6), sr(0, 6)); q.setFromEuler(e);
        m.compose(p.set(r[0], r[1] + r[3] * 0.15, r[2]), q, sc.set(r[3] * sr(0.8, 1.4), r[3] * sr(0.6, 1), r[3] * sr(0.8, 1.4)));
        im.setMatrixAt(i, m);
        const v = sr(0.75, 1.1); c.setRGB(v, v * 0.98, v * 0.94); im.setColorAt(i, c);
      });
      im.castShadow = true; im.receiveShadow = true;
      s.add(im);
      this.vegRocks = im;
    }
    // 덤불
    const bg = new THREE.IcosahedronGeometry(1, 1);
    const bushes = [];
    for (let i = 0; i < 240; i++) {
      const side = R3D.srnd() < 0.5 ? -1 : 1;
      const x = side * sr(36.5, 70), z = sr(-150, 150);
      if (Math.abs(z) > 80 && Math.abs(x) < 43) continue;
      bushes.push([x, H(x, z), z, sr(0.5, 1.3)]);
    }
    {
      const bm = new THREE.MeshStandardMaterial({ color: 0x3c6428, flatShading: true, roughness: 0.95 });
      const im = new THREE.InstancedMesh(bg, bm, bushes.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
      bushes.forEach((r, i) => {
        q.setFromAxisAngle(p.set(0, 1, 0), sr(0, 6));
        m.compose(p.set(r[0], r[1] + r[3] * 0.3, r[2]), q, sc.set(r[3] * sr(1, 1.6), r[3] * sr(0.6, 0.9), r[3] * sr(1, 1.6)));
        im.setMatrixAt(i, m);
        const v = sr(0.75, 1.2); c.setRGB(v * sr(0.9, 1.15), v, v * 0.9); im.setColorAt(i, c);
      });
      im.castShadow = true; im.receiveShadow = true;
      s.add(im);
      this.vegBush = im;
    }
    // 풀 (바람에 흔들리는 인스턴스 다발)
    {
      const q = [], uv = [], nrm = [];
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
        const P = [[-cx, 0, -cz], [cx, 0, cz], [cx, 1, cz], [-cx, 1, -cz]];
        for (const id of [0, 1, 2, 0, 2, 3]) { q.push(...P[id]); uv.push(id === 1 || id === 2 ? 1 : 0, id >= 2 ? 1 : 0); nrm.push(0, 1, 0); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(q, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      const gm = new THREE.MeshStandardMaterial({ map: R3D.tuftTex(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9 });
      this.grassTime = { value: 0 };
      gm.onBeforeCompile = sh => {
        sh.uniforms.uTime = this.grassTime;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec4 gwp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
              float gph = gwp.x * 0.31 + gwp.z * 0.23;
              transformed.x += sin(uTime * 1.8 + gph) * 0.14 * position.y;
              transformed.z += cos(uTime * 1.3 + gph) * 0.09 * position.y;
            #endif`);
        // 양면 풀잎의 뒷면이 검게 보이지 않도록 법선을 항상 위쪽으로
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));`);
      };
      const tufts = [];
      for (let i = 0; i < 6500; i++) {
        let x, z, k;
        const r = R3D.srnd();
        if (r < 0.62) { const side = R3D.srnd() < 0.5 ? -1 : 1; x = side * sr(36, 95); z = sr(-170, 170); k = sr(0.6, 1.25); }
        else if (r < 0.8) { x = sr(-35, 35); z = sr(-80, 80); if (Math.abs(x) < 6) continue; k = sr(0.3, 0.55); }
        else { x = sr(-60, 60); z = (R3D.srnd() < 0.5 ? -1 : 1) * sr(124, 170); k = sr(0.6, 1.2); }
        if (Math.abs(x) < 42 && Math.abs(z) > 80 && Math.abs(z) < 122) continue;
        tufts.push([x, H(x, z), z, k]);
      }
      const im = new THREE.InstancedMesh(g, gm, tufts.length);
      const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
      tufts.forEach((t, i) => {
        qq.setFromAxisAngle(p.set(0, 1, 0), sr(0, 6.28));
        m.compose(p.set(t[0], t[1] - 0.03, t[2]), qq, sc.set(t[3] * sr(0.9, 1.4), t[3], t[3] * sr(0.9, 1.4)));
        im.setMatrixAt(i, m);
        const v = sr(0.8, 1.15); c.setRGB(v * sr(0.95, 1.12), v, v * 0.9); im.setColorAt(i, c);
      });
      im.receiveShadow = true;
      s.add(im);
      this.vegGrass = im;
    }
  }

  // ---------- 맵 테마 (평원 / 도시 / 사막 / 설원) ----------
  setTheme(name) {
    if (!this._themeBase) {
      this._themeBase = {
        top: this.skyU.uTop.value.clone(), hor: this.skyU.uHorizon.value.clone(), gr: this.skyU.uGround.value.clone(),
        fog: this.scene.fog.density, sun: this.sun.color.clone(), sunI: this.sun.intensity, hemiG: this.hemi.groundColor.clone(), clouds: this.skyU.uClouds.value,
        bush: this.vegBush ? this.vegBush.material.color.clone() : null,
      };
    }
    const B = this._themeBase;
    const T = {
      plains: { ground: [1, 1, 1], top: null, hor: null, fog: 1, trees: true, grass: true, bush: null, sun: null, clouds: 1 },
      city:   { ground: [1.45, 1.02, 2.0], top: 0x5f7896, hor: 0xc9ccd0, fog: 1.25, trees: false, grass: false, bush: 0x4c5544, sun: 0xf2ece4, clouds: 1.4 },
      desert: { ground: [2.55, 1.45, 2.1], top: 0x3f86c8, hor: 0xead9b6, fog: 1.1, trees: false, grass: false, bush: 0x8d7a4a, sun: 0xffe2b8, clouds: 0.3 },
      snow:   { ground: [3.05, 2.12, 4.7], top: 0x8aa3bc, hor: 0xe3e9ee, fog: 1.6, trees: true, grass: false, bush: 0xdfe6ea, sun: 0xeaf1ff, clouds: 1.6 },
    }[name] || null;
    const t = T || { ground: [1, 1, 1], fog: 1, trees: true, grass: true, clouds: 1 };
    this.theme = T ? name : 'plains';
    this.ground.material.color.setRGB(t.ground[0], t.ground[1], t.ground[2]);
    this.skyU.uTop.value.copy(t.top != null ? new THREE.Color(t.top) : B.top);
    this.skyU.uHorizon.value.copy(t.hor != null ? new THREE.Color(t.hor) : B.hor);
    this.skyU.uClouds.value = B.clouds * (t.clouds != null ? t.clouds : 1);
    this.scene.fog.color.copy(this.skyU.uHorizon.value);
    this.scene.fog.density = B.fog * t.fog;
    this.sun.color.copy(t.sun != null ? new THREE.Color(t.sun) : B.sun);
    this.hemi.groundColor.copy(name === 'snow' ? new THREE.Color(0xc8d0d8) : name === 'desert' ? new THREE.Color(0x9a8258) : B.hemiG);
    for (const m of this.vegTrees || []) m.visible = t.trees !== false;
    if (this.vegGrass) this.vegGrass.visible = t.grass !== false;
    if (this.vegBush && B.bush) this.vegBush.material.color.copy(t.bush != null ? new THREE.Color(t.bush) : B.bush);
    if (this.vegRocks) this.vegRocks.material.color.set(name === 'desert' ? 0xd9b98a : name === 'snow' ? 0xe6ecf0 : 0xffffff);
  }

  // 전장 소품: 참호 모래주머니, 대전차 장애물, 폐허
  buildFieldProps() {
    const b = new R3D.Builder();
    R3D.setSeed(777);
    const sr = R3D.sr;
    for (const z0 of [-30, 30]) {
      for (let i = 0; i < 6; i++) {
        const x = -30 + i * 12 + sr(-2, 2), z = z0 + sr(-3, 3), ry = sr(-0.25, 0.25);
        b.box(4.2, 0.95, 1.1, x, 0.47, z, 0xffffff, 0, 0, ry, 0, 'sand');
        b.box(3.4, 0.45, 0.95, x + sr(-0.3, 0.3), 1.15, z, 0xe8e0d0, 0, 0, ry, 0, 'sand');
        b.box(1.0, 0.9, 1.0, x + 2.4 * Math.cos(ry), 0.45, z - 2.4 * Math.sin(ry) + 0.6, 0xffffff, 0, 0, ry + 0.9, 0, 'sand');
      }
    }
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? 1 : -1, x = side * sr(30, 36), z = sr(-60, 60);
      for (let k = 0; k < 3; k++) {
        const e = [[0.7, 0, 0.6], [0.7, 2.1, -0.6], [-0.7, 1.05, 0.6]][k];
        b.box(0.16, 2.1, 0.16, x, 0.75, z, 0x5a4a3a, 0, e[0], e[1], e[2], 'metal');
      }
    }
    // 폐허 벽
    for (const [x, z, ry] of [[-41, 12, 0.2], [41, -18, -0.3], [-40, -45, 1.4], [42, 50, 1.2]]) {
      const c = Math.cos(ry), s = Math.sin(ry);
      const P = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
      let p = P(0, 1.6, 0); b.box(7, 3.2, 0.45, p[0], p[1], p[2], 0xffffff, 0, 0, ry, 0, 'brick');
      p = P(-2.6, 3.5, 0); b.box(1.8, 0.8, 0.45, p[0], p[1], p[2], 0xffffff, 0, 0, ry, 0, 'brick');
      p = P(3.3, 1.1, 2.2); b.box(0.45, 2.2, 4.4, p[0], p[1], p[2], 0xe0e0e0, 0, 0, ry, 0, 'brick');
      for (let k = 0; k < 6; k++) { p = P(sr(-4, 4), 0.2, sr(-2.5, 2.5)); b.box(sr(0.4, 0.9), sr(0.2, 0.5), sr(0.3, 0.7), p[0], p[1], p[2], 0xffffff, 0, sr(0, 1), sr(0, 3), sr(0, 1), 'brick'); }
    }
    this.builderMeshes(b, this.scene, { sand: 2, brick: 3, metal: 3 });
  }

  // ---------- 이펙트 시스템 준비 ----------
  setupFx() {
    const ptex = R3D.particleTex();
    const fog = this.scene.fog;
    this.pSmoke = new R3D.Particles(2600, false, ptex, fog);
    this.pAdd = new R3D.Particles(2400, true, ptex, fog);
    this.scene.add(this.pSmoke.mesh, this.pAdd.mesh);
    // 그을음 자국 (풀)
    const st = R3D.scorchTex();
    this.decals = [];
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(this.geo.decal, new THREE.MeshStandardMaterial({ map: st, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
      m.visible = false; m.receiveShadow = true; m.renderOrder = 1;
      this.scene.add(m);
      this.decals.push({ m, t: 0, life: 1, a: 0 });
    }
    this.decalI = 0;
    // 충격파 링
    const rt = R3D.ringTex();
    this.shocks = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.geo.shock, new THREE.MeshBasicMaterial({ map: rt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd9a0 }));
      m.visible = false; m.renderOrder = 8;
      this.scene.add(m);
      this.shocks.push({ m, t: 1, life: 1, s: 1 });
    }
    // 섬광용 포인트 라이트 풀 (항상 씬에 존재 → 셰이더 재컴파일 없음)
    this.lights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffa04a, 0, 28, 2);
      this.scene.add(l);
      this.lights.push({ l, t: 1, life: 1, i0: 0 });
    }
    this.lightI = 0;
    // 로터 블러 디스크 재질
    this.rotorMat = new THREE.MeshBasicMaterial({ map: R3D.rotorTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85 });
    // 텍스트 팝업 풀
    this.popups = [];
  }

  // ---------- 경기 세팅 (기지, 국기) ----------
  flagTexture(img) {
    const c = document.createElement('canvas');
    c.width = 192; c.height = 128;
    const g = c.getContext('2d');
    if (img) g.drawImage(img, 0, 0, 192, 128); else { g.fillStyle = '#888'; g.fillRect(0, 0, 192, 128); }
    // 천 질감
    g.fillStyle = 'rgba(0,0,0,0.05)';
    for (let y = 0; y < 128; y += 3) g.fillRect(0, y, 192, 1);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  // 국가 이름 라벨 (텍스트 길이에 맞춘 스프라이트)
  labelSprite(text, color, height = 2.4) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const font = 'bold 56px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 64;
    c.width = w; c.height = 88;
    g.font = font;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const gr = g.createLinearGradient(0, 0, 0, 84);
    gr.addColorStop(0, 'rgba(22,28,38,0.86)'); gr.addColorStop(1, 'rgba(8,10,16,0.86)');
    g.fillStyle = gr;
    g.beginPath(); if (g.roundRect) g.roundRect(2, 2, w - 4, 80, 16); else g.rect(2, 2, w - 4, 80); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = color; g.fillRect(16, 74, w - 32, 6);
    g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 6;
    g.fillStyle = '#ffffff'; g.fillText(text, w / 2, 40);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false, fog: false }));
    sp.scale.set(height * w / 88, height, 1);
    sp.renderOrder = 15;
    return sp;
  }

  textSprite(text, color, size = 48, font = 'bold') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.font = `${font} ${size}px "Malgun Gothic", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineJoin = 'round';
    g.strokeText(text, 128, 48);
    g.fillStyle = color; g.fillText(text, 128, 48);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false, fog: false }));
    sp.scale.set(4, 1.5, 1);
    sp.renderOrder = 20;
    return sp;
  }

  initMatch(mySide, flagImages, names) {
    this.clearMatch();
    this.mySide = mySide;
    this.names = names || ['', ''];
    this.matchGroup = new THREE.Group();
    this.scene.add(this.matchGroup);
    if (this.flagMats) this.flagMats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    this.flagMats = [0, 1].map(i => new THREE.MeshStandardMaterial({ map: this.flagTexture(flagImages && flagImages[i]), side: THREE.DoubleSide, roughness: 0.85 }));
    for (let side = 0; side < 2; side++) this.buildBase(side);
    this.cam = { x: 0, z: mySide === 0 ? 68 : -68, dist: 72, yaw: mySide === 0 ? 0 : Math.PI, pitch: 0.95 };
    this.camMode = 'rts';
  }

  clearMatch() {
    if (this.matchGroup) this.scene.remove(this.matchGroup);
    this.matchGroup = null;
    if (this.theme && this.theme !== 'plains') this.setTheme('plains');
    for (const [, o] of this.meshes) this.scene.remove(o.root);
    for (const c of this.corpses) this.scene.remove(c.root);
    for (const f of this.fx) { this.scene.remove(f.obj); f.obj.visible = false; }
    this.meshes.clear(); this.corpses = []; this.fx = []; this.emitters = []; this.proj = [];
    this.flagMeshes = []; this.factories = [[], []]; this.radar = [];
    this.selectedId = 0; this.shake = 0;
    if (this.pSmoke) { this.pSmoke.clear(); this.pAdd.clear(); }
    if (this.decals) for (const d of this.decals) d.m.visible = false;
    if (this.shocks) for (const s of this.shocks) s.m.visible = false;
    if (this.lights) for (const l of this.lights) l.l.intensity = 0;
  }

  // 기지 건물 지오메트리 (진영색 포함, 진영별 캐시)
  buildBase(side) {
    const tm = R3D.team(side);
    const g = this.matchGroup;
    const bz = side === 0 ? GAME.BASE_Z : -GAME.BASE_Z;
    const base = new THREE.Group();
    base.position.set(0, 0, bz);
    if (side === 1) base.rotation.y = Math.PI;
    g.add(base);
    const b = new R3D.Builder();
    const box = (k, w, h, d, x, y, z, c = 0xffffff, ry = 0, rx = 0, rz = 0) => b.box(w, h, d, x, y, z, c, 0, rx, ry, rz, k);
    const cyl = (k, r, h, x, y, z, c = 0xffffff, rx = 0, ry = 0, rz = 0, seg = 14) => b.cyl(r, h, x, y, z, c, 0, rx, ry, rz, seg, 1, k);
    // --- 사령부 (HQ)
    box('conc', 16, 6, 9, 0, 3, 13, 0xe6e1d4);
    box('conc', 16.5, 0.5, 9.5, 0, 6.15, 13, 0xb5b0a4);
    box('conc', 10, 3, 7, 0, 7.9, 14, 0xdcd6c8);
    box('conc', 10.4, 0.4, 7.4, 0, 9.55, 14, 0xb0ab9f);
    for (const [w, d, x, z] of [[16.5, 0.3, 0, 8.4], [16.5, 0.3, 0, 17.6], [0.3, 9.5, -8.1, 13], [0.3, 9.5, 8.1, 13]]) box('conc', w, 0.6, d, x, 6.6, z, 0xc2bdb0);
    box('paint', 16.1, 0.45, 9.1, 0, 5.3, 13, tm.main);
    box('paint', 10.1, 0.35, 7.1, 0, 9.1, 14, tm.main);
    for (const y of [1.9, 4.1]) for (const x of [-6.6, -4.6, -2.6, 2.6, 4.6, 6.6]) {
      box('glass', 1.3, 1.25, 0.12, x, y, 8.47);
      box('conc', 1.55, 0.14, 0.32, x, y - 0.7, 8.4, 0x9a968c);
      box('glass', 1.3, 1.25, 0.12, x, y, 17.53);
    }
    for (const y of [1.9, 4.1]) for (const z of [10.6, 13, 15.4]) for (const x of [-8.03, 8.03]) box('glass', 0.12, 1.25, 1.3, x, y, z);
    for (const x of [-3.6, -1.2, 1.2, 3.6]) box('glass', 1.5, 1.2, 0.12, x, 7.9, 10.47);
    for (const z of [12, 14, 16]) for (const x of [-5.03, 5.03]) box('glass', 0.12, 1.2, 1.3, x, 7.9, z);
    box('glass', 2.8, 2.7, 0.15, 0, 1.35, 8.45);
    box('conc', 3.2, 0.3, 0.4, 0, 2.85, 8.4, 0x8e8a80);
    box('paint', 4.6, 0.2, 2.2, 0, 3.05, 7.5, tm.dark);
    for (const x of [-2.0, 2.0]) box('conc', 0.32, 3.0, 0.32, x, 1.5, 6.6, 0xd0cbc0);
    box('conc', 5.2, 0.16, 2.0, 0, 0.08, 7.4, 0xa9a59b);
    box('conc', 4.6, 0.32, 1.2, 0, 0.16, 7.9, 0xb3afa4);
    // 옥상 설비
    box('metal', 1.6, 0.9, 1.3, -5.6, 6.85, 16, 0xd0d0d0);
    box('metal', 1.6, 0.9, 1.3, 5.8, 6.85, 11, 0xd0d0d0);
    box('metal', 1.2, 0.7, 1.0, -3.0, 9.95, 16.2, 0xc8c8c8);
    cyl('metal', 0.08, 6, 6.6, 9.8, 16.4, 0xcccccc, 0, 0, 0, 6);
    for (let k = 0; k < 3; k++) box('metal', 1.2 - k * 0.3, 0.05, 0.05, 6.6, 8.5 + k * 1.4, 16.4, 0xcccccc);
    box('conc', 1.8, 1.4, 1.8, 3, 10.45, 15.5, 0xc9c4b8);
    // 정문 앞 모래주머니 방어선 (가운데 통로)
    for (let x = -13; x <= 13.01; x += 2.6) {
      if (Math.abs(x) < 2) continue;
      box('sand', 2.6, 1.0, 1.15, x, 0.5, -0.4);
      if (Math.abs(x) > 4) box('sand', 2.2, 0.5, 1.0, x + 0.2, 1.25, -0.4, 0xeae2d2);
    }
    // 방호벽(콘크리트)
    for (let x = 16; x <= 36; x += 3.2) for (const s of [-1, 1]) {
      box('conc', 2.9, 1.0, 0.45, s * x, 0.5, -3.6, 0xc4c0b6);
      box('conc', 2.9, 0.25, 0.85, s * x, 0.12, -3.6, 0xc4c0b6);
    }
    // 감시탑
    for (const s of [-1, 1]) {
      const x = s * 38.5, z = -2.5;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box('wood', 0.24, 7.3, 0.24, x + dx * 1.25, 3.6, z + dz * 1.25, 0x9a8a72, 0, dz * 0.05, -dx * 0.05);
      for (const dz of [-1.3, 1.3]) { box('wood', 0.1, 3.9, 0.1, x, 2.4, z + dz, 0x8a7a62, 0, 0, 0.68); box('wood', 0.1, 3.9, 0.1, x, 2.4, z + dz, 0x8a7a62, 0, 0, -0.68); }
      box('wood', 3.4, 0.25, 3.4, x, 7.1, z, 0xa69478);
      for (const [w, d, ox, oz] of [[3.4, 0.3, 0, -1.55], [3.4, 0.3, 0, 1.55], [0.3, 3.4, -1.55, 0], [0.3, 3.4, 1.55, 0]]) box('sand', w, 0.9, d, x + ox, 7.7, z + oz);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box('wood', 0.14, 2.3, 0.14, x + dx * 1.5, 8.3, z + dz * 1.5, 0x8a7a62);
      b.add('cone:4', 2.9, 1.0, 2.9, x, 9.95, z, 0, Math.PI / 4, 0, 0x6c6458, 0, 'metal');
      cyl('metal', 0.26, 0.45, x - s * 0.8, 8.5, z - 1.1, 0x2d2d2d, 1.2, 0, 0, 10);
      box('wood', 0.6, 7.1, 0.08, x, 3.5, z + 1.42, 0x8a7a62, 0, -0.08);
    }
    // 울타리 (철망 + 기둥)
    const fence = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 4));
      const ry = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i++) { const t = i / n; box('metal', 0.14, 2.7, 0.14, x0 + (x1 - x0) * t, 1.35, z0 + (z1 - z0) * t, 0x8c8c88); }
      box('fence', 0.03, 2.3, len, (x0 + x1) / 2, 1.25, (z0 + z1) / 2, 0xffffff, ry);
      box('metal', 0.05, 0.05, len, (x0 + x1) / 2, 2.62, (z0 + z1) / 2, 0x777777, ry);
    };
    fence(-41, -1, -41, 35); fence(41, -1, 41, 35); fence(-41, 35, 41, 35);
    // 연료 탱크
    for (const x of [-17, -13.6]) {
      cyl('metal', 1.25, 4.6, x, 1.55, 28.5, 0xe8e8e0, Math.PI / 2, 0, 0, 16);
      for (const z of [27, 30]) box('conc', 2.2, 0.5, 0.5, x, 0.25, z, 0xa8a49a);
    }
    box('paint', 0.06, 0.6, 2.4, -18.27, 1.6, 28.5, tm.bright);
    // 드럼통 / 상자
    R3D.setSeed(99 + side);
    const sr = R3D.sr;
    for (let i = 0; i < 9; i++) cyl('metal', 0.32, 0.92, -12 + (i % 3) * 0.7 + sr(-0.1, 0.1), 0.46, 3.2 + ((i / 3) | 0) * 0.7, [0x4d5a3a, 0x7a2e22, 0x3f4f6a][i % 3], 0, 0, 0, 10);
    for (const [x, z, n] of [[12.5, 3.5, 3], [10.5, 19.5, 4], [-10.5, 20.5, 2], [17, 26, 3]]) {
      for (let i = 0; i < n; i++) box('wood', 1.1, 1.1, 1.1, x + (i % 2) * 1.15, 0.55 + (i >= 2 ? 1.1 : 0), z + sr(-0.1, 0.1), 0xffffff, sr(-0.2, 0.2));
    }
    // 국기 게양대
    box('conc', 1.4, 0.5, 1.4, -11, 0.25, 4, 0xbdb8ac);
    cyl('metal', 0.12, 14, -11, 7.2, 4, 0xe0e0e0, 0, 0, 0, 10);
    b.sph(0.3, 0.3, 0.3, -11, 14.3, 4, 0xe0b030, 0, 'paint');
    this.builderMeshes(b, base, { conc: 4, brick: 3, metal: 3, sand: 2, wood: 2.5, fence: 2.2, glass: 4, paint: 4 });

    // 헬리패드
    const hp = new THREE.Mesh(new THREE.CircleGeometry(5, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: R3D.helipadTex(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    hp.position.set(12, 0.03, 28); hp.receiveShadow = true;
    base.add(hp);
    // 레이더
    const rb = new R3D.Builder();
    rb.cyl(0.12, 1.2, 0, 0.6, 0, 0xcccccc, 2, 0, 0, 0, 8);
    rb.add('hemi:16:6', 1.5, 0.5, 1.5, 0, 1.4, 0.2, -1.2, 0, 0, 0xf0f0f0, 0);
    rb.cyl(0.05, 1.0, 0, 1.5, 0.6, 0x333333, 2, -1.2 + Math.PI / 2, 0, 0, 6);
    const dish = new THREE.Mesh(rb.geometry('u'), this.mats.unit);
    dish.castShadow = true;
    dish.position.set(3, 11.15, 15.5);
    base.add(dish);
    this.radar.push(dish);
    // 큰 국기 (펄럭임)
    const fgeo = new THREE.PlaneGeometry(6, 4, 16, 10); fgeo.translate(3, 0, 0);
    const flag = new THREE.Mesh(fgeo, this.flagMats[side]);
    flag.position.set(-10.88, 12.2, 4);
    flag.castShadow = true;
    flag.userData.base = fgeo.attributes.position.array.slice();
    flag.userData.w = 6;
    base.add(flag);
    this.flagMeshes.push(flag);
    // 건물 정면 국가 문장
    const emb = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.8), this.flagMats[side]);
    emb.position.set(0, 4.15, 8.43); emb.rotation.y = Math.PI;
    base.add(emb);
    // 국가 이름 (기지 위)
    if (this.names[side]) {
      const lab = this.labelSprite(this.names[side], SIDE_CSS[side], 3.6);
      lab.position.set(0, 14.5, 13);
      base.add(lab);
    }
    // 공장 자리 (타이쿤)
    const fgeos = this.factoryGeos(side);
    const slots = [[-24, 10], [24, 10], [-30, 2], [30, 2], [-24, 20], [24, 20], [-30, 14], [30, 14]];
    for (const [x, z] of slots) {
      const f = new THREE.Group();
      f.position.set(x, 0, z);
      for (const [k, geo] of fgeos) {
        const m = new THREE.Mesh(geo, this.mats[k]);
        m.castShadow = k !== 'glass'; m.receiveShadow = true;
        f.add(m);
      }
      f.visible = false;
      f.userData.chimney = new THREE.Vector3();
      f.userData.grow = 1;
      base.add(f);
      this.factories[side].push(f);
    }
    base.updateMatrixWorld(true);
    for (const f of this.factories[side]) f.localToWorld(f.userData.chimney.set(2.0, 8.6, 1.4));
  }

  factoryGeos(side) {
    this._facCache = this._facCache || {};
    if (this._facCache[side]) return this._facCache[side];
    const tm = R3D.team(side);
    const b = new R3D.Builder();
    const box = (k, w, h, d, x, y, z, c = 0xffffff, rx = 0, ry = 0, rz = 0) => b.box(w, h, d, x, y, z, c, 0, rx, ry, rz, k);
    box('brick', 6, 3.4, 5, 0, 1.7, 0);
    box('conc', 6.2, 0.3, 5.2, 0, 0.15, 0, 0xb0aca2);
    for (let k = 0; k < 3; k++) {
      const zc = -1.67 + k * 1.67;
      box('paint', 6.3, 0.1, 1.8, 0, 3.79, zc, tm.main, 0.45);
      box('glass', 6.1, 0.77, 0.06, 0, 3.79, zc - 0.8);
    }
    box('metal', 3.2, 2.6, 0.1, 0, 1.3, -2.53, 0xb8b8b0);
    box('paint', 3.6, 0.25, 0.14, 0, 2.72, -2.54, 0x222222);
    box('paint', 0.2, 2.7, 0.14, -1.7, 1.35, -2.54, 0xe2b82a);
    box('paint', 0.2, 2.7, 0.14, 1.7, 1.35, -2.54, 0xe2b82a);
    box('paint', 1.6, 0.55, 0.08, 0, 3.05, -2.56, 0xe0b030);
    for (const z of [-1.2, 1.2]) for (const x of [-3.03, 3.03]) box('glass', 0.08, 0.9, 1.1, x, 2.2, z);
    b.cyl(0.38, 8.2, 2.0, 4.1, 1.4, 0xffffff, 0, 0, 0, 0, 12, 0.85, 'brick');
    b.cyl(0.42, 0.45, 2.0, 7.5, 1.4, tm.bright, 0, 0, 0, 0, 12, 0.85, 'paint');
    b.cyl(0.85, 3.8, -3.75, 1.9, 1.0, 0xd8d8d2, 0, 0, 0, 0, 14, 1, 'metal');
    b.add('cone:14', 0.85, 0.5, 0.85, -3.75, 4.05, 1.0, 0, 0, 0, 0xc0c0ba, 0, 'metal');
    b.cyl(0.12, 1.2, -3.15, 3.0, 1.0, 0x9a9a94, 0, 0, 0, Math.PI / 2, 8, 1, 'metal');
    box('metal', 0.7, 0.55, 0.7, -1.6, 4.2, 1.6, 0xaaaaaa);
    box('wood', 0.9, 0.9, 0.9, 2.5, 0.45, -3.1);
    box('wood', 0.9, 0.9, 0.9, 2.4, 1.35, -3.1, 0xe8e0d8, 0, 0.3);
    const out = b.keys().map(k => [k, b.geometry(k, true, { brick: 3, metal: 2, conc: 4, wood: 2 }[k] || 4)]);
    this._facCache[side] = out;
    return out;
  }

  // ---------- 유닛 모델 ----------
  unitGeos(type, side) {
    const key = type + side;
    if (this.unitGeoCache[key]) return this.unitGeoCache[key];
    let g;
    if (type === 'tank') g = R3D.tankParts(side);
    else if (type === 'apc') g = R3D.apcParts(side);
    else if (type === 'heli') g = R3D.heliParts(side);
    else g = R3D.soldierParts(type, side);
    return (this.unitGeoCache[key] = g);
  }

  buildUnit(type, side) {
    const G = this.unitGeos(type, side), meta = G.meta;
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.rotation.order = 'YXZ';
    root.add(body);
    const o = { root, body, type, side, legs: [], arms: null, rotor: null, tailRotor: null, turret: null, gun: null, walk: 0, yaw: 0, hullYaw: 0, spd: 0, recoil: 0, dustT: 0, shots: 0, bank: 0, meta };
    const mk = (geo, parent, x = 0, y = 0, z = 0, cast = true) => { const m = new THREE.Mesh(geo, this.mats.unit); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; };
    const flagMat = this.flagMats ? this.flagMats[side] : this.mats.unit;
    o.muzzle = new THREE.Object3D();
    if (G.legs) {
      mk(G.body, body);
      for (const x of [-0.12, 0.12]) o.legs.push(mk(G.legs, body, x, 0.93, 0, false));
      const arms = new THREE.Group(); arms.position.set(0, 1.47, 0); body.add(arms);
      mk(G.arms, arms, 0, 0, 0, type !== 'infantry');
      o.arms = arms;
      o.muzzle.position.fromArray(meta.muzzle); arms.add(o.muzzle);
      if (type === 'commander') {
        const fl = new THREE.Mesh(this.geo.flagSmall, flagMat);
        fl.position.set(0.18, 2.5, -0.2); fl.castShadow = true;
        body.add(fl);
        root.scale.setScalar(1.15);
      }
      if (type === 'marine') root.scale.setScalar(1.08);
      if (type === 'sf') root.scale.setScalar(1.12);
    } else {
      mk(G.body, body);
      if (G.turret) {
        const tur = new THREE.Group(); tur.position.fromArray(meta.turret); body.add(tur);
        mk(G.turret, tur);
        const gun = new THREE.Group(); gun.position.fromArray(meta.gun); tur.add(gun);
        mk(G.gun, gun);
        o.turret = tur; o.gun = gun; o.gunZ = meta.gun[2];
        o.muzzle.position.fromArray(meta.muzzle); gun.add(o.muzzle);
        const fl = new THREE.Mesh(this.geo.flagSmall, flagMat);
        fl.position.fromArray(meta.flag); fl.castShadow = true;
        (type === 'tank' ? tur : body).add(fl);
      }
      if (G.rotor) {
        const rot = new THREE.Group(); rot.position.fromArray(meta.rotor); body.add(rot);
        mk(G.rotor, rot);
        const disc = new THREE.Mesh(this.geo.rotorDisc, this.rotorMat);
        disc.position.y = 0.02; disc.renderOrder = 3;
        rot.add(disc);
        const tr = new THREE.Group(); tr.position.fromArray(meta.tail); body.add(tr);
        mk(G.tail, tr, 0, 0, 0, false);
        o.rotor = rot; o.disc = disc; o.tailRotor = tr;
        o.muzzle.position.fromArray(meta.muzzle); body.add(o.muzzle);
      }
    }
    o.h = meta.h;

    // 체력 바
    const c = document.createElement('canvas'); c.width = 128; c.height = 20;
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false, fog: false }));
    const w = type === 'heli' || type === 'apc' || type === 'tank' ? 3 : 1.6;
    sp.scale.set(w, w * 0.16, 1);
    sp.position.y = o.h + 0.3;
    sp.renderOrder = 10;
    root.add(sp);
    o.hpCanvas = c; o.hpTex = tex; o.hpSprite = sp; o.lastHp = -1;

    if (type === 'commander') {
      const star = this.textSprite('★', '#ffd23f', 64);
      star.scale.set(1.3, 1.3, 1); star.position.y = 3.6;
      root.add(star);
      o.star = star;
      if (this.names && this.names[side]) {
        const lab = this.labelSprite(this.names[side] + tr(' 사령관', ' Commander'), SIDE_CSS[side], 0.9);
        lab.position.y = 4.5;
        root.add(lab);
        o.label = lab;
      }
    }
    root.traverse(ch => { ch.userData.unitId = 0; });
    this.scene.add(root);
    return o;
  }

  drawHp(o, hp, maxHp, ctrl) {
    const r = Math.max(0, Math.min(1, hp / maxHp));
    const key = Math.round(r * 60) + (ctrl ? 100 : 0);
    if (key === o.lastHp) return;
    o.lastHp = key;
    const g = o.hpCanvas.getContext('2d');
    g.clearRect(0, 0, 128, 20);
    g.fillStyle = 'rgba(8,10,14,0.75)';
    g.beginPath(); if (g.roundRect) g.roundRect(0, 0, 128, 20, 6); else g.rect(0, 0, 128, 20); g.fill();
    const col = r > 0.6 ? ['#6ee7a0', '#22a35a'] : r > 0.3 ? ['#fde047', '#ca8a04'] : ['#f87171', '#b91c1c'];
    const gr = g.createLinearGradient(0, 3, 0, 17); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
    g.fillStyle = gr; g.fillRect(8, 4, 116 * r, 12);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(8, 4, 116 * r, 3);
    g.fillStyle = SIDE_CSS[o.side]; g.fillRect(2, 2, 4, 16);
    if (ctrl) { g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.strokeRect(1.5, 1.5, 125, 17); }
    o.hpTex.needsUpdate = true;
  }

  // ---------- 상태 동기화 ----------
  sync(units, sides, dt) {
    const seen = this._seen; seen.clear();
    const k = Math.min(1, dt * 12), idt = 1 / Math.max(dt, 1e-3);
    for (const u of units) {
      if (!u.alive) continue;
      seen.add(u.id);
      let o = this.meshes.get(u.id);
      if (!o) {
        o = this.buildUnit(u.type, u.side);
        o.root.position.set(u.x, u.y, u.z);
        o.yaw = o.hullYaw = u.yaw;
        o.root.traverse(ch => { ch.userData.unitId = u.id; });
        this.meshes.set(u.id, o);
        if (!UNIT_TYPES[u.type].fly) this.spawnDust(u.x, u.z, u.type === 'tank' || u.type === 'apc' ? 2 : 1);
      }
      o.data = u;
      const p = o.root.position;
      const ox = p.x, oz = p.z;
      p.x += (u.x - p.x) * k; p.z += (u.z - p.z) * k;
      p.y += (u.y - p.y) * k;
      const vx = (p.x - ox) * idt, vz = (p.z - oz) * idt;
      const spd = Math.sqrt(vx * vx + vz * vz);
      o.spd += (spd - o.spd) * Math.min(1, dt * 8);
      const prevYaw = o.yaw;
      o.yaw += angDiff(u.yaw, o.yaw) * Math.min(1, dt * 10);
      o.recoil = Math.max(0, o.recoil - dt * 5);
      const mv = Math.min(1, o.spd / 3);
      if (o.legs.length) {
        o.body.rotation.y = o.yaw;
        if (o.spd > 0.5) o.walk += dt * (6 + o.spd * 1.4); else o.walk *= 0.85;
        const sw = Math.sin(o.walk) * 0.6 * mv;
        o.legs[0].rotation.x = sw; o.legs[1].rotation.x = -sw;
        o.body.position.y = Math.abs(Math.sin(o.walk)) * 0.06 * mv;
        o.body.rotation.x = 0.07 * mv;
        o.arms.rotation.x = -o.recoil * 0.22 + Math.sin(o.walk * 2) * 0.04 * mv + Math.sin(this.clock * 1.7 + u.id) * 0.015;
        o.arms.position.z = -o.recoil * 0.05;
      } else if (o.turret) {
        if (o.spd > 0.6) o.hullYaw += angDiff(Math.atan2(vx, vz), o.hullYaw) * Math.min(1, dt * 3.5);
        o.body.rotation.y = o.hullYaw;
        o.turret.rotation.y = angDiff(o.yaw, o.hullYaw);
        o.gun.position.z = o.gunZ - o.recoil * (o.type === 'tank' ? 0.5 : 0.15);
        o.body.rotation.x = -o.recoil * o.recoil * (o.type === 'tank' ? 0.06 : 0.015);
        o.body.position.y = Math.sin(this.clock * 15 + u.id) * 0.012 * mv;
        if (o.spd > 1.2) {
          o.dustT -= dt;
          if (o.dustT <= 0) {
            o.dustT = 0.08;
            const s = Math.sin(o.hullYaw), c = Math.cos(o.hullYaw), side = Math.random() < 0.5 ? -1 : 1;
            const lx = side * 1.1, lz = -2.2;
            this.dust(p.x + lx * c + lz * s, 0.35, p.z - lx * s + lz * c, 0.9, 0.28);
          }
        }
      } else if (o.rotor) {
        o.body.rotation.y = o.yaw;
        const fwd = vx * Math.sin(o.yaw) + vz * Math.cos(o.yaw);
        const yr = angDiff(o.yaw, prevYaw) * idt;
        o.bank += (R3D.clamp(-yr * 0.25, -0.45, 0.45) - o.bank) * Math.min(1, dt * 3);
        o.body.rotation.x += (R3D.clamp(fwd * 0.03, -0.15, 0.3) - o.body.rotation.x) * Math.min(1, dt * 3);
        o.body.rotation.z = o.bank;
        o.rotor.rotation.y += dt * 24;
        o.tailRotor.rotation.x += dt * 40;
        o.body.position.y = Math.sin(this.clock * 1.6 + u.id) * 0.25;
      }
      if (o.star) o.star.position.y = 3.6 + Math.sin(this.clock * 3) * 0.2;
      this.drawHp(o, u.hp, u.maxHp, u.ctrl);
      const show = u.hp < u.maxHp - 0.5 || u.ctrl || u.id === this.selectedId || u.type === 'commander';
      o.hpSprite.visible = show && !(this.camMode === 'fps' && u.id === this.followId);
    }
    for (const [id, o] of this.meshes) {
      if (!seen.has(id)) {
        this.meshes.delete(id);
        this.makeCorpse(o);
      }
    }
    // 공장
    if (sides) for (let s = 0; s < 2; s++) {
      const n = (sides[s] && sides[s].factories) || 0;
      this.factories[s].forEach((f, i) => {
        if (i < n && !f.visible) {
          f.visible = true; f.scale.set(1, 0.01, 1); f.userData.grow = 0;
          const wp = this._v1; f.getWorldPosition(wp);
          for (let j = 0; j < 14; j++) this.dust(wp.x + R3D.rnd(-3.5, 3.5), 0.4, wp.z + R3D.rnd(-3, 3), 1.6, 0.4);
        } else if (i >= n && f.visible && n === 0) f.visible = false;
        if (f.visible && f.userData.grow < 1) {
          f.userData.grow = Math.min(1, f.userData.grow + dt * 1.2);
          const t = f.userData.grow;
          f.scale.y = t < 1 ? 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.06 : 1;
        }
      });
    }
  }

  makeCorpse(o) {
    o.hpSprite.visible = false;
    if (o.star) o.star.visible = false;
    if (o.label) o.label.visible = false;
    const T = UNIT_TYPES[o.type];
    const c = { root: o.root, body: o.body, o, t: 0, type: o.type, vy: 0, fly: !!T.fly, inf: T.cat === 'inf', life: T.cat === 'inf' ? 6 : 13, landed: false, dir: Math.random() < 0.5 ? -1 : 1, fall: 0 };
    if (!c.inf) {
      o.root.traverse(m => { if (m.isMesh && m.material === this.mats.unit) m.material = this.mats.wreck; });
      if (o.disc) o.disc.visible = false;
      const p = o.root.position;
      if (c.fly) {
        c.trail = this.addEmitter(p.x, p.y, p.z, 99, 'trail', o.root);
      } else {
        this.addEmitter(p.x, 1.2, p.z, 9, 'wreck');
        if (o.type === 'tank' && o.turret) c.tur = { vy: R3D.rnd(7, 10), vr: R3D.rnd(-5, 5), vz: R3D.rnd(-1.5, 1.5), y0: o.turret.position.y };
      }
    } else {
      c.yaw0 = o.body.rotation.y;
    }
    this.corpses.push(c);
    while (this.corpses.length > 46) { const d = this.corpses.shift(); this.scene.remove(d.root); }
  }

  updateCorpses(dt) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.t += dt;
      const p = c.root.position;
      if (c.fly && !c.landed) {
        c.vy -= 16 * dt;
        p.y += c.vy * dt;
        c.body.rotation.y += dt * 4.5;
        c.body.rotation.z += dt * 0.7 * c.dir;
        c.body.rotation.x += dt * 0.3;
        if (c.o.rotor) c.o.rotor.rotation.y += dt * 8;
        if (p.y <= 0.7) {
          p.y = 0.7; c.landed = true; c.t = Math.max(c.t, 1);
          c.body.rotation.z = 0.45 * c.dir; c.body.rotation.x = 0.1;
          if (c.trail) c.trail.t = c.trail.dur;
          this.explosion(p.x, 1, p.z, 2.4, true);
          this.addEmitter(p.x, 1.0, p.z, 10, 'wreck');
          this.sfx('bigexplosion', p.x, 1, p.z);
        }
      } else if (c.inf) {
        c.fall = Math.min(1, c.fall + dt * 3.2);
        const e = c.fall * c.fall;
        c.body.rotation.x = -c.dir * e * Math.PI / 2;
        c.body.position.y = e * 0.14;
        if (c.o.arms) c.o.arms.rotation.x = -e * 1.2;
      }
      if (c.tur) {
        const tr = c.o.turret;
        c.tur.vy -= 22 * dt;
        tr.position.y += c.tur.vy * dt;
        tr.position.z += c.tur.vz * dt;
        tr.rotation.x += c.tur.vr * dt;
        if (tr.position.y < c.tur.y0 - 0.9 && c.tur.vy < 0) { tr.position.y = c.tur.y0 - 0.9; tr.rotation.x = 0.35 * Math.sign(c.tur.vr); c.tur = null; }
      }
      if (c.t > c.life - 2) p.y -= dt * (c.inf ? 0.4 : 0.7);
      if (c.t > c.life) { this.scene.remove(c.root); this.corpses.splice(i, 1); }
    }
  }

  // ---------- 이펙트 ----------
  sfx(name, x, y, z, o) {
    if (typeof Sound === 'undefined') return;
    const a = this._sfxOpt || (this._sfxOpt = {});
    a.x = x; a.y = y; a.z = z; a.size = o && o.size; a.vol = o && o.vol !== undefined ? o.vol : undefined;
    Sound.play(name, x === undefined ? null : a);
  }

  findShooter(type, x, z) {
    let best = null, bd = 6;
    for (const [, o] of this.meshes) {
      if (o.type !== type || !o.data) continue;
      const d = Math.abs(o.data.x - x) + Math.abs(o.data.z - z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  handleEvent(e) {
    if (e.k === 'shot') this.onShot(e);
    else if (e.k === 'boom') {
      const s = e.s || 1;
      this.explosion(e.x, Math.max(0.2, e.y + 0.3), e.z, 1.15 * s, false);
      this.sfx('explosion', e.x, e.y, e.z, { size: s });
    } else if (e.k === 'die') {
      const T = UNIT_TYPES[e.t];
      if (T.cat !== 'inf') {
        if (!T.fly) { this.explosion(e.x, e.y + 1, e.z, 2.6, true); this.sfx('bigexplosion', e.x, e.y, e.z); }
        else { this.explosion(e.x, e.y, e.z, 1.6, false); this.sfx('explosion', e.x, e.y, e.z, { size: 1.6 }); }
      } else {
        this.dust(e.x, 0.4, e.z, 0.8, 0.35);
        this.sfx('death', e.x, e.y + 1, e.z);
      }
      if (e.ks === this.mySide) {
        this.popup('+G$' + GAME.KILL_REWARD, '#7CFC7C', e.x, e.y + 3, e.z, 1.4, 2.5);
        if (this.inMatch()) this.sfx('coin');
      }
    } else if (e.k === 'heal') {
      const o = this.meshes.get(e.b);
      if (o) {
        const p = o.root.position;
        this.popup('+', '#4ade80', p.x, p.y + 2, p.z, 0.9, 1.5, 80);
        for (let i = 0; i < 5; i++) this.pAdd.spawn(p.x + R3D.rnd(-0.5, 0.5), p.y + R3D.rnd(0.4, 1.6), p.z + R3D.rnd(-0.5, 0.5), 0, R3D.rnd(0.8, 1.6), 0, 0.9, 0.25, 0.1, 0.4, 2.2, 0.8, 1, 2, 0, 0.5, 0, 2);
      }
    } else if (e.k === 'spawn') {
      if (e.side === this.mySide && this.inMatch()) this.sfx('spawn');
    } else if (e.k === 'factory') {
      const f = this.factories[e.side] && this.factories[e.side][(e.n || 1) - 1];
      if (f) { const wp = this._v2; f.getWorldPosition(wp); this.sfx('build', wp.x, 2, wp.z, { vol: e.side === this.mySide ? 1.4 : 0.8 }); }
    } else if (e.k === 'over') {
      if (this.inMatch()) this.sfx(e.w === this.mySide ? 'victory' : 'defeat');
    }
  }

  onShot(e) {
    const a = e.a, b = e.b, t = e.t;
    const o = this.findShooter(t, a[0], a[2]);
    const m = this._v1.set(a[0], a[1], a[2]);
    if (o) { o.recoil = 1; o.shots++; o.muzzle.getWorldPosition(m); }
    const dx = b[0] - m.x, dy = b[1] - m.y, dz = b[2] - m.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
    const A = this.pAdd, S = this.pSmoke, rnd = R3D.rnd;
    const hitUnit = b[1] > 0.6;
    const flash = (sz, life = 0.06) => {
      A.spawn(m.x, m.y, m.z, 0, 0, 0, life, sz, sz * 1.3, 4, 2.6, 1.2, 1, 1, 0, 0, 0, 2);
      A.spawn(m.x + nx * sz * 0.4, m.y + ny * sz * 0.4, m.z + nz * sz * 0.4, nx * 0.01, ny * 0.01, nz * 0.01, life, sz * 0.5, sz * 0.6, 4, 2.2, 0.9, 1, 2, 0, 0, sz * 1.2, 2);
      A.spawn(m.x + nx * sz * 0.9, m.y + ny * sz * 0.9, m.z + nz * sz * 0.9, nx * 30, ny * 30, nz * 30, life, sz * 0.35, sz * 0.35, 3, 1.8, 0.7, 1, 2, 0, 0, sz * 1.0, 2);
    };
    const tracer = (speed, w, r, g, bl, st, delay = 0, spread = 0) => {
      const ex = b[0] + (spread ? rnd(-spread, spread) : 0), ey = b[1] + (spread ? rnd(-spread, spread) * 0.5 : 0), ez = b[2] + (spread ? rnd(-spread, spread) : 0);
      const ddx = ex - m.x, ddy = ey - m.y, ddz = ez - m.z, dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 1;
      A.spawn(m.x, m.y, m.z, (ddx / dd) * speed, (ddy / dd) * speed, (ddz / dd) * speed, dd / speed, w, w, r, g, bl, 1, 3, 0, 0, st, 2, delay);
      return dd / speed + delay;
    };
    const impact = (delay, big) => {
      if (hitUnit) {
        for (let i = 0; i < (big ? 6 : 3); i++) A.spawn(b[0], b[1], b[2], rnd(-5, 5), rnd(1, 6), rnd(-5, 5), rnd(0.15, 0.35), 0.05, 0.03, 4, 2.4, 1, 1, 3, 12, 1, 0.3, 2, delay);
        S.spawn(b[0], b[1], b[2], rnd(-0.3, 0.3), 0.6, rnd(-0.3, 0.3), 0.7, 0.25, big ? 1.4 : 0.7, 0.45, 0.43, 0.4, 0.4, 0, 0, 1.5, 0, 0, delay);
      } else {
        S.spawn(b[0], 0.25, b[2], rnd(-0.4, 0.4), rnd(1.2, 2.4), rnd(-0.4, 0.4), rnd(0.8, 1.2), 0.25, big ? 1.8 : 1.0, 0.42, 0.36, 0.27, 0.55, 0, 2, 1.5, 0, 0, delay);
        for (let i = 0; i < 3; i++) S.spawn(b[0], 0.1, b[2], rnd(-1.5, 1.5), rnd(2, 4.5), rnd(-1.5, 1.5), 0.6, 0.08, 0.08, 0.2, 0.16, 0.11, 1, 0, 12, 0.5, 0, 3, delay);
      }
    };
    if (t === 'tank') {
      flash(2.4, 0.09);
      this.flashLight(m.x, m.y, m.z, 5, 0.12);
      for (let i = 0; i < 8; i++) S.spawn(m.x + nx * 0.5, m.y, m.z + nz * 0.5, nx * rnd(2, 7) + rnd(-1.2, 1.2), rnd(0.2, 1.4), nz * rnd(2, 7) + rnd(-1.2, 1.2), rnd(1.4, 2.4), 0.6, 2.6, 0.62, 0.6, 0.57, 0.5, 0, -0.3, 1.8);
      if (o) { const p = o.root.position; for (let i = 0; i < 8; i++) { const ang = Math.random() * R3D.TAU; this.dust(p.x + Math.cos(ang) * 2, 0.3, p.z + Math.sin(ang) * 2, 1.2, 0.3, Math.cos(ang) * 3, Math.sin(ang) * 3); } }
      const tt = tracer(150, 0.22, 4, 2.4, 1.0, 3.5);
      if (!hitUnit) impact(tt, true);
      this.sfx('cannon', m.x, m.y, m.z);
      this.addShake(0.35, m.x, m.z);
    } else if (t === 'sniper') {
      flash(0.9);
      const tt = tracer(420, 0.09, 4, 4, 3.8, 9);
      for (let i = 1; i < 9; i++) { const k = i / 9; S.spawn(m.x + dx * k, m.y + dy * k, m.z + dz * k, rnd(-0.1, 0.1), 0.15, rnd(-0.1, 0.1), rnd(1.0, 1.6), 0.12, 0.45, 0.85, 0.85, 0.85, 0.22, 0, 0, 0.5, 0, 0, k * tt); }
      impact(tt, true);
      this.sfx('sniper', m.x, m.y, m.z);
    } else if (t === 'apc') {
      flash(0.9);
      let tt = 0;
      for (let i = 0; i < 3; i++) tt = tracer(190, 0.11, 4, 1.8, 0.6, 2.5, i * 0.07, 0.6);
      impact(tt, false);
      this.sfx('mg', m.x, m.y, m.z);
    } else if (t === 'heli') {
      if (o && o.shots % 3 === 0) {
        this.launchRocket(o, m, b);
        this.sfx('rocket', m.x, m.y, m.z);
      } else {
        flash(0.8);
        let tt = 0;
        for (let i = 0; i < 4; i++) tt = tracer(200, 0.1, 4, 1.4, 1.0, 2.5, i * 0.06, 0.8);
        impact(tt, false);
        this.sfx('heligun', m.x, m.y, m.z);
      }
    } else {
      flash(t === 'commander' ? 0.4 : 0.5);
      const tt = tracer(230, 0.06, 4, 3, 1.4, 2.2);
      if (Math.random() < 0.6) impact(tt, false);
      for (let i = 0; i < 1; i++) S.spawn(m.x, m.y, m.z, nx * 0.6, 0.4, nz * 0.6, 0.8, 0.15, 0.5, 0.75, 0.75, 0.75, 0.25, 0, 0, 1.5);
      this.sfx(t === 'medic' ? 'smg' : t === 'commander' ? 'pistol' : 'rifle', m.x, m.y, m.z);
    }
  }

  launchRocket(o, m, b) {
    const side = (o.shots / 3) % 2 ? 1 : -1;
    const lx = side * 0.95, ly = -0.45, lz = 0.95;
    const yaw = o.body.rotation.y, s = Math.sin(yaw), c = Math.cos(yaw), p = o.root.position;
    const x = p.x + lx * c + lz * s, y = p.y + o.body.position.y + ly, z = p.z - lx * s + lz * c;
    const dx = b[0] - x, dy = b[1] - y, dz = b[2] - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const sp = 70;
    this.proj.push({ x, y, z, vx: dx / d * sp, vy: dy / d * sp, vz: dz / d * sp, t: 0, life: d / sp, tx: b[0], ty: b[1], tz: b[2] });
    this.pAdd.spawn(x, y, z, 0, 0, 0, 0.08, 1.2, 1.6, 4, 2.4, 1, 1, 1, 0, 0, 0, 2);
  }

  updateProjectiles(dt) {
    const A = this.pAdd, S = this.pSmoke, rnd = R3D.rnd;
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const r = this.proj[i];
      r.t += dt;
      const steps = 3;
      for (let k = 0; k < steps; k++) {
        const f = (k + 1) / steps;
        S.spawn(r.x + r.vx * dt * f, r.y + r.vy * dt * f, r.z + r.vz * dt * f, rnd(-0.3, 0.3), rnd(0.2, 0.6), rnd(-0.3, 0.3), rnd(1.0, 1.6), 0.25, 1.2, 0.8, 0.8, 0.8, 0.45, 0, 0, 1.2);
      }
      r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
      A.spawn(r.x, r.y, r.z, r.vx * 0.5, r.vy * 0.5, r.vz * 0.5, 0.04, 0.5, 0.4, 4, 2.6, 1.2, 1, 2, 0, 0, 1.6, 2);
      if (r.t >= r.life) {
        this.explosion(r.tx, Math.max(0.3, r.ty), r.tz, 0.9, false);
        this.sfx('explosion', r.tx, r.ty, r.tz, { size: 0.8 });
        this.proj.splice(i, 1);
      }
    }
  }

  dust(x, y, z, s = 1, a = 0.3, vx = 0, vz = 0) {
    const r = R3D.rnd;
    this.pSmoke.spawn(x, y, z, vx + r(-0.4, 0.4), r(0.3, 0.9), vz + r(-0.4, 0.4), r(1.2, 2.2), 0.5 * s, 2.4 * s, 0.56, 0.49, 0.38, a, 0, -0.05, 1.6);
  }
  spawnDust(x, z, s) { for (let i = 0; i < 5 * s; i++) this.dust(x + R3D.rnd(-1, 1) * s, 0.3, z + R3D.rnd(-1, 1) * s, 0.7 * s, 0.3); }

  explosion(x, y, z, s, big) {
    const A = this.pAdd, S = this.pSmoke, r = R3D.rnd;
    const ground = y < 2.5;
    // 섬광 + 빛
    A.spawn(x, y + 0.3, z, 0, 0, 0, 0.14, 2.5 * s, 4.5 * s, 4, 3, 2, 1, 2, 0, 0, 0, 2);
    A.spawn(x, y + 0.3, z, 0, 0, 0, 0.1, 2 * s, 3 * s, 4, 3, 2, 1, 1, 0, 0, 0, 2);
    this.flashLight(x, y + 1.5, z, 7 * s, 0.4 + 0.1 * s);
    // 불덩이
    const nf = Math.round(8 + 6 * s);
    for (let i = 0; i < nf; i++) {
      const vy = r(1, 4) * s;
      A.spawn(x + r(-0.4, 0.4) * s, y + r(0, 0.6) * s, z + r(-0.4, 0.4) * s, r(-2.5, 2.5) * s, vy, r(-2.5, 2.5) * s, r(0.45, 0.9) * (0.8 + 0.2 * s), 0.8 * s, r(2.2, 3.2) * s, 3.4, r(1.4, 2.0), 0.45, r(0.6, 0.9), 0, -1.5, 2.2, 0, 1, r(0, 0.06));
    }
    // 검은 연기
    const ns = Math.round(4 + 4 * s);
    for (let i = 0; i < ns; i++) {
      const g = r(0.13, 0.24);
      S.spawn(x + r(-0.8, 0.8) * s, y + r(0.2, 1.2) * s, z + r(-0.8, 0.8) * s, r(-1, 1) * s + 0.6, r(1.4, 3.2), r(-1, 1) * s + 0.25, r(2.2, 3.8) + s * 0.4, 1.2 * s, r(4, 6) * s, g, g * 0.95, g * 0.9, r(0.55, 0.8), 0, -0.25, 1.1, 0, 0, r(0.05, 0.25));
    }
    // 불꽃 파편
    const nk = Math.round(10 + 8 * s);
    for (let i = 0; i < nk; i++) {
      const sp = r(6, 16) * Math.sqrt(s), ang = Math.random() * R3D.TAU, up = r(0.3, 1);
      A.spawn(x, y + 0.3, z, Math.cos(ang) * sp * (1 - up * 0.5), up * sp, Math.sin(ang) * sp * (1 - up * 0.5), r(0.5, 1.2), 0.07, 0.04, 4, 2.2, 0.8, 1, 3, 16, 0.4, 0.8, 2);
    }
    if (ground) {
      // 흙 덩어리 + 흙먼지
      for (let i = 0; i < 6 + 4 * s; i++) {
        const sp = r(4, 9) * Math.sqrt(s), ang = Math.random() * R3D.TAU;
        S.spawn(x, 0.3, z, Math.cos(ang) * sp * 0.5, r(4, 9) * Math.sqrt(s), Math.sin(ang) * sp * 0.5, r(1, 1.6), 0.18 * s, 0.14 * s, 0.17, 0.14, 0.1, 1, 0, 16, 0.3, 0, 3);
      }
      for (let i = 0; i < 6; i++) { const ang = (i / 6) * R3D.TAU; this.dust(x + Math.cos(ang) * s, 0.3, z + Math.sin(ang) * s, 1.4 * s, 0.4, Math.cos(ang) * 4 * s, Math.sin(ang) * 4 * s); }
      this.shockwave(x, z, s);
      this.scorch(x, z, 1.5 * s + 0.8);
    }
    this.addShake((big ? 0.9 : 0.4) * Math.min(1.5, s), x, z);
  }

  flashLight(x, y, z, i0, life) {
    const L = this.lights[this.lightI++ % this.lights.length];
    L.l.position.set(x, y, z); L.t = 0; L.life = life; L.i0 = i0; L.l.intensity = i0;
  }
  shockwave(x, z, s) {
    const sw = this.shocks.find(q => q.t >= q.life) || this.shocks[0];
    sw.t = 0; sw.life = 0.35; sw.s = s;
    sw.m.position.set(x, 0.15, z); sw.m.visible = true;
  }
  scorch(x, z, size) {
    const d = this.decals[this.decalI++ % this.decals.length];
    d.m.position.set(x, 0.02, z);
    d.m.rotation.y = Math.random() * R3D.TAU;
    d.m.scale.set(size, 1, size);
    d.t = 0; d.life = 30; d.m.visible = true; d.m.material.opacity = 0.9;
  }
  addShake(amt, x, z) {
    const lx = this.listenerX || 0, lz = this.listenerZ || 0;
    const d = Math.hypot(x - lx, z - lz);
    const f = Math.max(0, 1 - d / 55) * (this.camMode === 'fps' ? 1.2 : 0.8);
    this.shake = Math.min(1.2, this.shake + amt * f);
  }
  popup(text, color, x, y, z, life, up, size = 54) {
    this._popTex = this._popTex || {};
    const key = text + color + size;
    if (!this._popTex[key]) this._popTex[key] = this.textSprite(text, color, size).material.map;
    let sp = this.popups.find(p => !p.visible);
    if (!sp) {
      if (this.popups.length > 24) return;
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true, toneMapped: false, fog: false }));
      sp.renderOrder = 20;
      this.popups.push(sp);
    }
    sp.material.map = this._popTex[key]; sp.material.needsUpdate = true;
    sp.material.opacity = 1;
    sp.scale.set(text === '+' ? 2 : 4, text === '+' ? 0.75 : 1.5, 1);
    sp.position.set(x, y, z); sp.visible = true;
    this.scene.add(sp);
    this.fx.push({ obj: sp, t: 0, life, up });
  }
  addEmitter(x, y, z, dur, kind, follow) {
    const em = { x, y, z, t: 0, dur, kind, follow, acc: 0 };
    this.emitters.push(em);
    return em;
  }

  updateEmitters(dt) {
    const A = this.pAdd, S = this.pSmoke, r = R3D.rnd;
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const em = this.emitters[i];
      em.t += dt;
      if (em.t >= em.dur) { this.emitters.splice(i, 1); continue; }
      if (em.follow) { em.x = em.follow.position.x; em.y = em.follow.position.y + 0.5; em.z = em.follow.position.z; }
      const k = 1 - em.t / em.dur;
      em.acc += dt;
      // 파티클이 많으면 잔해 연기 빈도를 낮춤 (과도한 오버드로 방지)
      const busy = S.n > S.cap * 0.55 ? 2.5 : 1;
      const step = (em.kind === 'trail' ? 0.025 : 0.11) * busy;
      while (em.acc >= step) {
        em.acc -= step;
        if (em.kind === 'wreck') {
          if (Math.random() < k + 0.2) A.spawn(em.x + r(-0.7, 0.7), em.y + r(-0.2, 0.4), em.z + r(-0.7, 0.7), r(-0.3, 0.3), r(1.5, 3), r(-0.3, 0.3), r(0.4, 0.8), 0.6, 1.6 * (0.4 + k), 3, 1.4, 0.4, 0.8, 0, -0.5, 1, 0, 1);
          const g = r(0.08, 0.16);
          S.spawn(em.x + r(-0.5, 0.5), em.y + 0.6, em.z + r(-0.5, 0.5), 0.8 + r(-0.3, 0.3), r(2.2, 3.4), 0.3 + r(-0.3, 0.3), r(3, 4.5), 0.8, r(4, 6), g, g, g, 0.6 * (0.3 + 0.7 * k), 0, -0.1, 0.4);
        } else if (em.kind === 'trail') {
          A.spawn(em.x, em.y, em.z, r(-0.5, 0.5), r(-0.5, 0.5), r(-0.5, 0.5), 0.3, 0.8, 1.6, 3, 1.3, 0.4, 0.8, 0, 0, 1, 0, 1);
          const g = r(0.1, 0.18);
          S.spawn(em.x, em.y, em.z, r(-0.4, 0.4), r(0.5, 1.2), r(-0.4, 0.4), r(2.5, 3.5), 0.8, 3.5, g, g, g, 0.7, 0, 0, 0.6);
        }
      }
    }
    // 공장 굴뚝 연기
    this.smokeT = (this.smokeT || 0) - dt;
    if (this.smokeT <= 0) {
      this.smokeT = S.n > S.cap * 0.55 ? 0.4 : 0.18;
      for (let s = 0; s < 2; s++) for (const f of this.factories[s]) {
        if (!f.visible || f.userData.grow < 1) continue;
        const c = f.userData.chimney, g = r(0.3, 0.45);
        S.spawn(c.x + r(-0.15, 0.15), c.y, c.z + r(-0.15, 0.15), 0.9 + r(-0.2, 0.2), r(1.6, 2.4), 0.35 + r(-0.2, 0.2), r(4, 6), 0.5, r(3.5, 5), g, g * 0.98, g * 0.95, 0.45, 0, -0.05, 0.25);
      }
    }
  }

  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const r = f.t / f.life;
      if (r >= 1) { f.obj.visible = false; this.scene.remove(f.obj); this.fx.splice(i, 1); continue; }
      if (f.up) f.obj.position.y += f.up * dt * (1 - r * 0.6);
      f.obj.material.opacity = 1 - r * r;
    }
    for (const d of this.decals) {
      if (!d.m.visible) continue;
      d.t += dt;
      if (d.t >= d.life) { d.m.visible = false; continue; }
      d.m.material.opacity = 0.7 * Math.min(1, (d.life - d.t) / 6);
    }
    for (const s of this.shocks) {
      if (s.t >= s.life) { s.m.visible = false; continue; }
      s.t += dt;
      const r = Math.min(1, s.t / s.life);
      const sc = (2 + 14 * Math.sqrt(r)) * s.s;
      s.m.scale.set(sc, 1, sc);
      s.m.material.opacity = (1 - r) * 0.7;
    }
    for (const L of this.lights) {
      if (L.t >= L.life) { L.l.intensity = 0; continue; }
      L.t += dt;
      const k = Math.max(0, 1 - L.t / L.life);
      L.l.intensity = L.i0 * k * k;
    }
    this.pSmoke.update(dt);
    this.pAdd.update(dt);
  }

  // ---------- 카메라 ----------
  panCamera(dx, dz) {
    const c = this.cam, s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    // dz>0: 화면 위쪽(전방)
    c.x += (-s * dz + co * dx);
    c.z += (-co * dz - s * dx);
    c.x = Math.max(-60, Math.min(60, c.x));
    c.z = Math.max(-110, Math.min(110, c.z));
  }
  zoom(f) { this.cam.dist = Math.max(25, Math.min(150, this.cam.dist * f)); }

  updateRtsCamera() {
    const c = this.cam;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this.camera.position.set(c.x + Math.sin(c.yaw) * cp * c.dist, sp * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(c.x, 0, c.z);
  }

  // 직접 참전 시 3인칭 카메라
  updateFollowCamera(id, yaw, pitch) {
    const o = this.meshes.get(id);
    if (!o) return null;
    const T = UNIT_TYPES[o.type];
    const p = o.root.position;
    const dist = T.cat === 'inf' ? 5.5 : T.fly ? 13 : 10;
    const h = T.cat === 'inf' ? 2.2 : T.fly ? 2.5 : 3.6;
    const dir = this._aim.d.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const side = T.cat === 'inf' ? 0.9 : 0;
    const pos = this._aim.o.set(p.x - dir.x * dist + rx * side, p.y + h - dir.y * dist, p.z - dir.z * dist + rz * side);
    if (pos.y < 0.6) pos.y = 0.6;
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
    return this._aim;
  }

  // ----- 1인칭 (팀 모드) -----
  updateFirstPerson(x, y, z, yaw, pitch, wpn, moving, dt) {
    const dir = this._aim.d.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const pos = this._aim.o.set(x, y, z);
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
    this.updateViewmodel(wpn, moving, dt || 0.016);
    return this._aim;
  }
  buildViewmodel(wpn) {
    if (!this.vmRoot) {
      this.vmRoot = new THREE.Group();
      this.camera.add(this.vmRoot);
      if (!this.camera.parent) this.scene.add(this.camera);
      this.vmModels = {};
      const flashMat = new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending });
      this.vmFlash = new THREE.Sprite(flashMat);
      this.vmFlash.scale.set(0.18, 0.18, 1);
      this.vmFlash.renderOrder = 1000;
      this.vmRoot.add(this.vmFlash);
    }
    if (this.vmModels[wpn]) return this.vmModels[wpn];
    const g = new THREE.Group();
    const mk = (c, m = 0.3, r = 0.6) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r, depthTest: true });
    const dark = mk(0x1d1f22, 0.6, 0.45), metal = mk(0x3a3d42, 0.7, 0.35), wood = mk(0x5a3d22, 0.1, 0.8), olive = mk(0x4c5a33, 0.2, 0.7), skin = mk(0xd9a77e, 0, 0.9), glove = mk(0x2a2a26, 0, 0.9);
    const box = (w, h, d, m, x, y, zz) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, zz); g.add(o); return o; };
    const cyl = (r, l, m, x, y, zz) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 10), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, zz); g.add(o); return o; };
    let len = 0.6;
    if (wpn === 'rifle') { box(0.06, 0.09, 0.42, dark, 0, 0, 0); cyl(0.013, 0.3, metal, 0, 0.015, -0.34); box(0.045, 0.12, 0.05, dark, 0, -0.09, -0.04); box(0.05, 0.08, 0.2, olive, 0, -0.01, 0.27); box(0.02, 0.03, 0.12, metal, 0, 0.065, 0.02); len = 0.5; }
    else if (wpn === 'smg') { box(0.055, 0.08, 0.3, dark, 0, 0, 0); cyl(0.012, 0.14, metal, 0, 0.01, -0.21); box(0.04, 0.16, 0.04, dark, 0, -0.11, -0.02); box(0.02, 0.05, 0.16, metal, 0, -0.01, 0.2); len = 0.3; }
    else if (wpn === 'shotgun') { box(0.06, 0.08, 0.3, wood, 0, -0.01, 0.12); cyl(0.02, 0.5, metal, 0, 0.02, -0.25); cyl(0.018, 0.3, wood, 0, -0.025, -0.22); box(0.055, 0.07, 0.15, dark, 0, 0.01, -0.02); len = 0.5; }
    else if (wpn === 'sniper') { box(0.055, 0.08, 0.5, olive, 0, 0, 0.02); cyl(0.012, 0.45, metal, 0, 0.015, -0.45); cyl(0.028, 0.24, dark, 0, 0.085, -0.02); box(0.04, 0.1, 0.05, dark, 0, -0.08, 0.02); len = 0.68; }
    else if (wpn === 'lmg') { box(0.08, 0.11, 0.5, dark, 0, 0, 0); cyl(0.018, 0.36, metal, 0, 0.02, -0.42); box(0.12, 0.12, 0.12, olive, 0, -0.1, -0.05); box(0.06, 0.09, 0.18, dark, 0, -0.01, 0.32); len = 0.6; }
    else if (wpn === 'rpg') { cyl(0.05, 0.9, olive, 0, 0.03, -0.1); const war = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.2, 10), metal); war.rotation.x = -Math.PI / 2; war.position.set(0, 0.03, -0.64); g.add(war); box(0.04, 0.12, 0.05, dark, 0, -0.07, 0.05); len = 0.75; }
    else if (wpn === 'sf') { // 특전사 소총: 검은 총몸 + 소음기 + 조준경
      box(0.055, 0.085, 0.4, dark, 0, 0, 0); cyl(0.024, 0.3, metal, 0, 0.015, -0.36); box(0.04, 0.13, 0.05, dark, 0, -0.09, -0.03);
      cyl(0.022, 0.16, dark, 0, 0.075, -0.02); box(0.05, 0.07, 0.18, dark, 0, -0.01, 0.26); box(0.02, 0.03, 0.08, metal, 0.035, 0.0, -0.12); len = 0.52;
    }
    // 손
    box(0.07, 0.07, 0.11, glove, 0.0, -0.07, 0.08); box(0.08, 0.07, 0.12, glove, -0.02, -0.04, -0.2);
    box(0.05, 0.05, 0.14, skin, -0.04, -0.07, 0.12).rotation.y = 0.35;
    g.scale.setScalar(0.72);
    g.traverse(o => { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 999; });
    g.userData.len = len;
    g.visible = false;
    this.vmRoot.add(g);
    this.vmModels[wpn] = g;
    return g;
  }
  setViewmodel(on, wpn) {
    if (on) this.buildViewmodel(wpn);
    if (!this.vmRoot) return;
    for (const k in this.vmModels) this.vmModels[k].visible = on && k === wpn;
    this.vmWpn = wpn; this.vmOn = on;
    if (!on) this.vmFlash.material.opacity = 0;
  }
  viewKick(wpn) {
    this.vmKick = Math.min(1, (this.vmKick || 0) + (wpn === 'sniper' || wpn === 'rpg' || wpn === 'shotgun' ? 1 : 0.45));
    this.vmFlashT = 0.05;
  }
  viewmodelTip() {
    const g = this.vmModels && this.vmModels[this.vmWpn];
    if (!g || !g.visible) return null;
    const v = new THREE.Vector3(0, 0.02, -(g.userData.len || 0.5) - 0.04);
    g.localToWorld(v);
    return [v.x, v.y, v.z];
  }
  updateViewmodel(wpn, moving, dt) {
    if (!this.vmRoot || !this.vmOn) return;
    const g = this.vmModels[wpn];
    if (!g) return;
    this.vmT = (this.vmT || 0) + dt * (moving ? 9 : 1.5);
    const bob = moving ? 0.012 : 0.003;
    this.vmKick = Math.max(0, (this.vmKick || 0) - dt * 7);
    const k = this.vmKick;
    g.position.set(0.17 + Math.cos(this.vmT * 0.5) * bob, -0.17 + Math.abs(Math.sin(this.vmT)) * bob - k * 0.02, -0.42 + k * 0.06);
    g.rotation.set(k * 0.18, 0, 0);
    this.vmFlashT = (this.vmFlashT || 0) - dt;
    const f = this.vmFlash;
    f.material.opacity = this.vmFlashT > 0 ? 1 : 0;
    if (this.vmFlashT > 0) { f.position.set(g.position.x, g.position.y + 0.015, g.position.z - (g.userData.len || 0.5) * 0.72 - 0.04); f.material.rotation = Math.random() * 6; }
  }

  pick(clientX, clientY) {
    const v = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const objs = [];
    for (const [, o] of this.meshes) objs.push(o.root);
    const hits = this.raycaster.intersectObjects(objs, true);
    for (const h of hits) if (h.object.userData.unitId && !h.object.isSprite) return h.object.userData.unitId;
    // 근처 유닛 (지면 교차점 기준)
    const gp = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), gp)) {
      let best = 0, bd = 3;
      for (const [id, o] of this.meshes) {
        const d = Math.hypot(o.root.position.x - gp.x, o.root.position.z - gp.z);
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    }
    return 0;
  }

  setSelection(id) {
    if (!this.selRing) {
      this.selRing = new THREE.Mesh(this.geo.ring, this.mats.ringSel);
      this.selRing.rotation.x = -Math.PI / 2;
      this.selRing.renderOrder = 4;
      this.scene.add(this.selRing);
    }
    this.selectedId = id;
  }

  animateFlag(geo, base, w, amp, speed) {
    const pos = geo.attributes.position, a = pos.array, t = this.clock * speed;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], k = x / w;
      a[i * 3 + 2] = (Math.sin(x * (5.5 / w) - t + y * (1.5 / w)) * amp + Math.sin(x * (13 / w) - t * 1.7) * amp * 0.25) * k;
      a[i * 3 + 1] = y - k * k * amp * 0.15;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // 그림자 카메라를 시점 주변으로 이동 (텍셀 스냅으로 떨림 방지)
  updateShadow(fx, fz, ext) {
    const sun = this.sun, sc = sun.shadow.camera;
    ext = Math.round(ext / 10) * 10;
    if (ext !== this.shadowExt) {
      this.shadowExt = ext;
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
      sc.updateProjectionMatrix();
    }
    const F = this.sunDir;
    const R = this._v2.set(F.z, 0, -F.x).normalize();
    const U = this._v3.crossVectors(F, R).normalize();
    const texel = (2 * ext) / 2048;
    let r = fx * R.x + fz * R.z, u = fx * U.x + fz * U.z;
    const f = fx * F.x + fz * F.z;
    r = Math.round(r / texel) * texel; u = Math.round(u / texel) * texel;
    const cx = R.x * r + U.x * u + F.x * f, cy = R.y * r + U.y * u + F.y * f, cz = R.z * r + U.z * u + F.z * f;
    sun.target.position.set(cx, cy, cz);
    sun.position.set(cx + F.x * 180, cy + F.y * 180, cz + F.z * 180);
  }

  // 프레임 시간에 따라 해상도 자동 조절
  adaptQuality() {
    const now = performance.now(), P = this.perf;
    const ms = now - P.last;
    P.last = now;
    if (ms > 100 || document.hidden) return; // 백그라운드 스로틀은 무시
    P.avg += (ms - P.avg) * 0.05;
    P.fails = P.fails || {};
    // 60Hz 수직동기에서 프레임 간격은 ~16.7ms → 18ms 미만이면 여유 있음
    if (P.avg > 24) { P.slowT += ms; P.fastT = 0; } else if (P.avg < 18) { P.fastT += ms; P.slowT = 0; } else { P.slowT = 0; P.fastT = 0; }
    if (P.slowT > 2500 && this.pr > 0.75) {
      P.fails[this.pr] = (P.fails[this.pr] || 0) + 1;
      this.pr = Math.max(0.75, this.pr - 0.25); this.renderer.setPixelRatio(this.pr); P.slowT = 0; P.avg = 18;
    }
    const up = Math.min(this.maxPR, this.pr + 0.25);
    if (this.pr < this.maxPR && P.fastT > 6000 * (1 + 4 * (P.fails[up] || 0))) { this.pr = up; this.renderer.setPixelRatio(this.pr); P.fastT = 0; }
  }

  frame(dt) {
    this.clock += dt;
    this.adaptQuality();
    this.skyU.uTime.value = this.clock;
    if (this.grassTime) this.grassTime.value = this.clock;
    // 국기 펄럭임
    for (const f of this.flagMeshes) this.animateFlag(f.geometry, f.userData.base, f.userData.w, 0.45, 5);
    if (!this._flagBase) this._flagBase = this.geo.flagSmall.attributes.position.array.slice();
    this.animateFlag(this.geo.flagSmall, this._flagBase, 0.9, 0.09, 8);
    for (const d of this.radar) d.rotation.y += dt * 1.5;
    // 선택 링
    if (this.selRing) {
      const o = this.meshes.get(this.selectedId);
      this.selRing.visible = !!o && this.camMode === 'rts';
      if (o) {
        const r = UNIT_TYPES[o.type].radius * 1.6 + 0.4;
        this.selRing.scale.setScalar(r * (1 + Math.sin(this.clock * 6) * 0.05));
        this.selRing.position.set(o.root.position.x, 0.08, o.root.position.z);
        this.mats.ringSel.color.set(o.side === this.mySide ? 0x7dffb0 : 0xff7d7d);
      }
    }
    this.updateCorpses(dt);
    this.updateProjectiles(dt);
    this.updateEmitters(dt);
    this.updateFx(dt);
    if (this.camMode === 'rts') this.updateRtsCamera();

    // 시점 기준점 (그림자 / 소리)
    const cam = this.camera;
    let fx, fz, ext;
    const fo = this.camMode === 'fps' ? this.meshes.get(this.followId) : null;
    if (fo) { fx = fo.root.position.x; fz = fo.root.position.z; ext = 50; }
    else {
      const c = this.cam;
      fx = c.x - Math.sin(c.yaw) * c.dist * 0.25; fz = c.z - Math.cos(c.yaw) * c.dist * 0.25;
      ext = R3D.clamp(c.dist * 1.0, 35, 130);
    }
    this.updateShadow(fx, fz, ext);
    this.sky.position.copy(cam.position);
    // 효과음 리스너
    this.listenerX = fo ? cam.position.x : this.cam.x; this.listenerZ = fo ? cam.position.z : this.cam.z;
    if (typeof Sound !== 'undefined') {
      const e = cam.matrixWorld.elements;
      if (fo) Sound.setListener(cam.position.x, cam.position.y, cam.position.z, e[0], e[2], 0);
      else Sound.setListener(this.cam.x, 0, this.cam.z, e[0], e[2], this.cam.dist * 0.4);
      // 가장 가까운 헬기 로터음
      let near = 0;
      for (const [, o] of this.meshes) {
        if (!o.rotor) continue;
        const d = Math.hypot(o.root.position.x - this.listenerX, o.root.position.z - this.listenerZ) + (fo ? 0 : this.cam.dist * 0.3);
        near = Math.max(near, 1 - d / 70);
      }
      Sound.setRotor(near);
      Sound.setScene(this.inMatch() ? 1 : 0.35);
    }
    // 카메라 흔들림 (렌더 동안만 적용)
    this.shake *= Math.exp(-dt * 5);
    const sh = this.shake > 0.01 ? this.shake : 0;
    if (sh) {
      this._camSave.copy(cam.position);
      cam.position.x += (Math.random() - 0.5) * sh * 0.6;
      cam.position.y += (Math.random() - 0.5) * sh * 0.6;
      cam.position.z += (Math.random() - 0.5) * sh * 0.6;
    }
    this.renderer.render(this.scene, cam);
    if (sh) cam.position.copy(this._camSave);
  }
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
