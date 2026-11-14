// ===== UI 도우미 & 국기 처리 =====
const $ = id => document.getElementById(id);

const UI = {
  screens: ['screen-title', 'screen-menu', 'screen-matching', 'screen-flag', 'screen-result', 'screen-shop', 'screen-units', 'screen-pause', 'screen-tdm-lobby'],
  show(id) { for (const s of this.screens) $(s).classList.toggle('hidden', s !== id); },
  hideAll() { for (const s of this.screens) $(s).classList.add('hidden'); },
  toastTimer: 0,
  toast(msg, ms = 1800) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  },
  announceTimer: 0,
  announce(msg, color = '#fff', ms = 2000) {
    const a = $('announce');
    a.textContent = msg; a.style.color = color; a.classList.add('show');
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => a.classList.remove('show'), ms);
  },
  killfeed(html) {
    const kf = $('killfeed');
    const d = document.createElement('div');
    d.innerHTML = html;
    kf.prepend(d);
    while (kf.children.length > 6) kf.lastChild.remove();
    setTimeout(() => d.remove(), 6000);
  },
  money(n) { return 'G$' + Math.floor(n).toLocaleString(LANG === 'ko' ? 'ko-KR' : 'en-US'); },
  // 영어 브라우저면 index.html의 data-en* 속성으로 텍스트 교체
  applyLang() {
    if (LANG !== 'en') return;
    document.documentElement.lang = 'en';
    document.querySelectorAll('[data-en-html]').forEach(e => { e.innerHTML = e.dataset.enHtml; });
    document.querySelectorAll('[data-en]').forEach(e => { e.textContent = e.dataset.en; });
    document.querySelectorAll('[data-en-ph]').forEach(e => { e.placeholder = e.dataset.enPh; });
    document.querySelectorAll('[data-en-title]').forEach(e => { e.title = e.dataset.enTitle; });
  },
  time(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); },
};

// ---------- 국기 ----------
const Flags = {
  W: 192, H: 128,
  palette: ['#c8102e', '#003da5', '#ffffff', '#ffcd00', '#009a44', '#000000', '#ff6a13', '#6a1b9a', '#00a3e0', '#7b3f00', '#e4002b', '#002868'],
  pick(n) {
    const p = [...this.palette].sort(() => Math.random() - 0.5);
    return p.slice(0, n);
  },
  star(g, cx, cy, r, color) {
    g.fillStyle = color; g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  },
  random() {
    const c = document.createElement('canvas');
    c.width = this.W; c.height = this.H;
    const g = c.getContext('2d'), W = this.W, H = this.H;
    const [a, b, d, e] = this.pick(4);
    const type = Math.floor(Math.random() * 7);
    if (type === 0) { [a, b, d].forEach((col, i) => { g.fillStyle = col; g.fillRect(i * W / 3, 0, W / 3 + 1, H); }); }
    else if (type === 1) { [a, b, d].forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * H / 3, W, H / 3 + 1); }); }
    else if (type === 2) { g.fillStyle = a; g.fillRect(0, 0, W, H); g.fillStyle = b; g.fillRect(W * 0.3, 0, W * 0.14, H); g.fillRect(0, H * 0.43, W, H * 0.14); }
    else if (type === 3) { g.fillStyle = a; g.fillRect(0, 0, W, H); g.fillStyle = b; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.lineTo(0, H); g.fill(); }
    else if (type === 4) { g.fillStyle = a; g.fillRect(0, 0, W, H); g.fillStyle = b; g.beginPath(); g.arc(W / 2, H / 2, H * 0.3, 0, Math.PI * 2); g.fill(); }
    else if (type === 5) { g.fillStyle = a; g.fillRect(0, 0, W, H / 2); g.fillStyle = b; g.fillRect(0, H / 2, W, H / 2); g.fillStyle = d; g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.4, H / 2); g.lineTo(0, H); g.fill(); }
    else { for (let i = 0; i < 7; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(0, i * H / 7, W, H / 7 + 1); } g.fillStyle = d; g.fillRect(0, 0, W * 0.42, H * 4 / 7); }
    if (Math.random() < 0.6) {
      const pos = type === 6 ? [W * 0.21, H * 0.28] : type === 5 ? [W * 0.13, H / 2] : type === 2 ? [W * 0.15, H * 0.2] : [W / 2, H / 2];
      this.star(g, pos[0], pos[1], H * 0.16, e === a || e === b ? '#ffcd00' : e);
    }
    return c.toDataURL('image/png');
  },
  // 업로드한 이미지 파일을 국기 크기로 잘라서 dataURL로
  fromFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = this.W; c.height = this.H;
          const g = c.getContext('2d');
          const s = Math.max(this.W / img.width, this.H / img.height);
          const w = img.width * s, h = img.height * s;
          g.drawImage(img, (this.W - w) / 2, (this.H - h) / 2, w, h);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  },
  load(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  },
  async draw(canvas, dataUrl) {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) { g.fillStyle = '#333'; g.fillRect(0, 0, canvas.width, canvas.height); g.fillStyle = '#888'; g.font = '20px sans-serif'; g.textAlign = 'center'; g.fillText('?', canvas.width / 2, canvas.height / 2 + 7); return; }
    const img = await this.load(dataUrl);
    if (img) g.drawImage(img, 0, 0, canvas.width, canvas.height);
  },
};
