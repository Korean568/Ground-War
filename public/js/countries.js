// ===== 세계 국가 목록 + 국기 그리기 (팀 모드에서 랜덤 추첨) =====
const COUNTRIES = (() => {
  const W = 192, H = 128;
  const hStripes = (cols) => g => cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * H / cols.length, W, H / cols.length + 1); });
  const vStripes = (cols) => g => cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * W / cols.length, 0, W / cols.length + 1, H); });
  const nordic = (bg, cross, inner) => g => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = cross; g.fillRect(W * 0.28, 0, W * 0.16, H); g.fillRect(0, H * 0.4, W, H * 0.2);
    if (inner) { g.fillStyle = inner; g.fillRect(W * 0.32, 0, W * 0.08, H); g.fillRect(0, H * 0.46, W, H * 0.08); }
  };
  const star = (g, cx, cy, r, col) => {
    g.fillStyle = col; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  };
  const circle = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const unionJack = (g, w, h) => {
    g.save();
    g.fillStyle = '#012169'; g.fillRect(0, 0, w, h);
    g.lineWidth = h * 0.2; g.strokeStyle = '#fff';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
    g.lineWidth = h * 0.07; g.strokeStyle = '#C8102E';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
    g.fillStyle = '#fff'; g.fillRect(w * 0.42, 0, w * 0.16, h); g.fillRect(0, h * 0.36, w, h * 0.28);
    g.fillStyle = '#C8102E'; g.fillRect(w * 0.45, 0, w * 0.1, h); g.fillRect(0, h * 0.41, w, h * 0.18);
    g.restore();
  };
  return [
    { name: tr('대한민국', 'South Korea'), draw: g => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, r = 30;
      g.save(); g.translate(cx, cy); g.rotate(Math.atan2(2, 3));
      g.fillStyle = '#CD2E3A'; g.beginPath(); g.arc(0, 0, r, Math.PI, 0); g.fill();
      g.fillStyle = '#0047A0'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI); g.fill();
      circle(g, -r / 2, 0, r / 2, '#CD2E3A'); circle(g, r / 2, 0, r / 2, '#0047A0');
      g.restore();
      g.fillStyle = '#000';
      [[-1, -1], [1, 1], [1, -1], [-1, 1]].forEach(([sx, sy], k) => {
        g.save(); g.translate(cx + sx * 62, cy + sy * 38); g.rotate(sx * sy > 0 ? -Math.atan2(2, 3) + Math.PI / 2 : Math.atan2(2, 3) + Math.PI / 2);
        for (let i = 0; i < 3; i++) {
          const broken = (k === 1 && i !== 1) || (k === 2 && i === 1) || (k === 3);
          if (broken) { g.fillRect(-12, -10 + i * 8, 10, 5); g.fillRect(2, -10 + i * 8, 10, 5); } else g.fillRect(-12, -10 + i * 8, 24, 5);
        }
        g.restore();
      });
    } },
    { name: tr('일본', 'Japan'), draw: g => { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); circle(g, W / 2, H / 2, 38, '#BC002D'); } },
    { name: tr('미국', 'United States'), draw: g => {
      for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#fff' : '#B22234'; g.fillRect(0, i * H / 13, W, H / 13 + 1); }
      g.fillStyle = '#3C3B6E'; g.fillRect(0, 0, W * 0.4, H * 7 / 13);
      for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) star(g, 8 + c * 12.5, 8 + r * 13, 3.5, '#fff');
    } },
    { name: tr('영국', 'United Kingdom'), draw: g => unionJack(g, W, H) },
    { name: tr('프랑스', 'France'), draw: vStripes(['#0055A4', '#fff', '#EF4135']) },
    { name: tr('독일', 'Germany'), draw: hStripes(['#000', '#DD0000', '#FFCE00']) },
    { name: tr('이탈리아', 'Italy'), draw: vStripes(['#009246', '#fff', '#CE2B37']) },
    { name: tr('캐나다', 'Canada'), draw: g => {
      g.fillStyle = '#D52B1E'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(W / 4, 0, W / 2, H);
      star(g, W / 2, H / 2 - 4, 30, '#D52B1E'); g.fillStyle = '#D52B1E'; g.fillRect(W / 2 - 2, H / 2 + 10, 4, 22);
    } },
    { name: tr('중국', 'China'), draw: g => {
      g.fillStyle = '#DE2910'; g.fillRect(0, 0, W, H); star(g, 32, 32, 19, '#FFDE00');
      [[64, 13], [76, 26], [76, 44], [64, 57]].forEach(([x, y]) => star(g, x, y, 6, '#FFDE00'));
    } },
    { name: tr('러시아', 'Russia'), draw: hStripes(['#fff', '#0039A6', '#D52B1E']) },
    { name: tr('브라질', 'Brazil'), draw: g => {
      g.fillStyle = '#009C3B'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#FFDF00'; g.beginPath(); g.moveTo(W / 2, 12); g.lineTo(W - 16, H / 2); g.lineTo(W / 2, H - 12); g.lineTo(16, H / 2); g.fill();
      circle(g, W / 2, H / 2, 28, '#002776');
      g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(W / 2 + 20, H / 2 + 40, 60, Math.PI * 1.15, Math.PI * 1.55); g.stroke();
    } },
    { name: tr('인도', 'India'), draw: g => {
      hStripes(['#FF9933', '#fff', '#138808'])(g);
      g.strokeStyle = '#000080'; g.lineWidth = 2; g.beginPath(); g.arc(W / 2, H / 2, 16, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.cos(a) * 16, H / 2 + Math.sin(a) * 16); g.stroke(); }
    } },
    { name: tr('스웨덴', 'Sweden'), draw: nordic('#006AA7', '#FECC00') },
    { name: tr('노르웨이', 'Norway'), draw: nordic('#BA0C2F', '#fff', '#00205B') },
    { name: tr('핀란드', 'Finland'), draw: nordic('#fff', '#002F6C') },
    { name: tr('덴마크', 'Denmark'), draw: nordic('#C8102E', '#fff') },
    { name: tr('스위스', 'Switzerland'), draw: g => { g.fillStyle = '#DA291C'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(W / 2 - 10, H / 2 - 34, 20, 68); g.fillRect(W / 2 - 34, H / 2 - 10, 68, 20); } },
    { name: tr('튀르키예', 'Türkiye'), draw: g => {
      g.fillStyle = '#E30A17'; g.fillRect(0, 0, W, H); circle(g, 72, H / 2, 32, '#fff'); circle(g, 80, H / 2, 26, '#E30A17'); star(g, 112, H / 2, 12, '#fff');
    } },
    { name: tr('베트남', 'Vietnam'), draw: g => { g.fillStyle = '#DA251D'; g.fillRect(0, 0, W, H); star(g, W / 2, H / 2 + 3, 36, '#FFFF00'); } },
    { name: tr('멕시코', 'Mexico'), draw: g => { vStripes(['#006847', '#fff', '#CE1126'])(g); circle(g, W / 2, H / 2, 16, '#8B5A2B'); circle(g, W / 2, H / 2, 10, '#4a7a2a'); } },
    { name: tr('아르헨티나', 'Argentina'), draw: g => { hStripes(['#74ACDF', '#fff', '#74ACDF'])(g); circle(g, W / 2, H / 2, 12, '#F6B40E'); } },
    { name: tr('스페인', 'Spain'), draw: g => { g.fillStyle = '#AA151B'; g.fillRect(0, 0, W, H); g.fillStyle = '#F1BF00'; g.fillRect(0, H / 4, W, H / 2); g.fillStyle = '#AA151B'; g.fillRect(48, 46, 18, 36); } },
    { name: tr('네덜란드', 'Netherlands'), draw: hStripes(['#AE1C28', '#fff', '#21468B']) },
    { name: tr('벨기에', 'Belgium'), draw: vStripes(['#000', '#FAE042', '#ED2939']) },
    { name: tr('폴란드', 'Poland'), draw: hStripes(['#fff', '#DC143C']) },
    { name: tr('우크라이나', 'Ukraine'), draw: hStripes(['#0057B7', '#FFD700']) },
    { name: tr('이집트', 'Egypt'), draw: g => { hStripes(['#CE1126', '#fff', '#000'])(g); circle(g, W / 2, H / 2, 12, '#C09300'); } },
    { name: tr('호주', 'Australia'), draw: g => {
      g.fillStyle = '#012169'; g.fillRect(0, 0, W, H); unionJack(g, W / 2, H / 2);
      star(g, W / 4, H * 0.75, 14, '#fff');
      [[150, 30], [130, 64], [168, 60], [150, 104], [158, 80]].forEach(([x, y], i) => star(g, x, y, i === 4 ? 4 : 8, '#fff'));
    } },
    { name: tr('태국', 'Thailand'), draw: hStripes(['#A51931', '#F4F5F8', '#2D2A4A', '#2D2A4A', '#F4F5F8', '#A51931']) },
    { name: tr('인도네시아', 'Indonesia'), draw: hStripes(['#FF0000', '#fff']) },
    { name: tr('그리스', 'Greece'), draw: g => {
      for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#fff' : '#0D5EAF'; g.fillRect(0, i * H / 9, W, H / 9 + 1); }
      g.fillStyle = '#0D5EAF'; g.fillRect(0, 0, 72, 72); g.fillStyle = '#fff'; g.fillRect(28, 0, 16, 72); g.fillRect(0, 28, 72, 16);
    } },
    { name: tr('아일랜드', 'Ireland'), draw: vStripes(['#169B62', '#fff', '#FF883E']) },
    { name: tr('포르투갈', 'Portugal'), draw: g => { g.fillStyle = '#006600'; g.fillRect(0, 0, W * 0.4, H); g.fillStyle = '#FF0000'; g.fillRect(W * 0.4, 0, W * 0.6, H); circle(g, W * 0.4, H / 2, 22, '#FFCC00'); circle(g, W * 0.4, H / 2, 14, '#FF0000'); } },
    { name: tr('오스트리아', 'Austria'), draw: hStripes(['#ED2939', '#fff', '#ED2939']) },
    { name: tr('나이지리아', 'Nigeria'), draw: vStripes(['#008751', '#fff', '#008751']) },
    { name: tr('필리핀', 'Philippines'), draw: g => {
      g.fillStyle = '#0038A8'; g.fillRect(0, 0, W, H / 2); g.fillStyle = '#CE1126'; g.fillRect(0, H / 2, W, H / 2);
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.43, H / 2); g.lineTo(0, H); g.fill(); circle(g, 26, H / 2, 10, '#FCD116');
    } },
    { name: tr('칠레', 'Chile'), draw: g => { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H / 2); g.fillStyle = '#D52B1E'; g.fillRect(0, H / 2, W, H / 2); g.fillStyle = '#0039A6'; g.fillRect(0, 0, 64, H / 2); star(g, 32, H / 4, 14, '#fff'); } },
    { name: tr('뉴질랜드', 'New Zealand'), draw: g => {
      g.fillStyle = '#012169'; g.fillRect(0, 0, W, H); unionJack(g, W / 2, H / 2);
      [[146, 34], [128, 62], [162, 58], [146, 102]].forEach(([x, y]) => { star(g, x, y, 10, '#fff'); star(g, x, y, 7, '#C8102E'); });
    } },
  ].map((c, i) => Object.assign(c, { id: i }));
})();

function countryFlag(idx) {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 128;
  const g = c.getContext('2d');
  COUNTRIES[idx].draw(g);
  return c.toDataURL('image/png');
}
function drawTwoCountries() {
  const a = Math.floor(Math.random() * COUNTRIES.length);
  let b = Math.floor(Math.random() * (COUNTRIES.length - 1));
  if (b >= a) b++;
  return [a, b];
}
