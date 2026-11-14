// 국가 전쟁 - 멀티플레이 서버
// 정적 파일 제공 + WebSocket 매칭/중계 + 전체 플레이어 전략 학습 데이터 저장
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

// 서버 로그 언어: 한국어 시스템 → 한국어, 그 외 → 영어
const LANG = (process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || 'en').toLowerCase().startsWith('ko') ? 'ko' : 'en';
function tr(ko, en) { return LANG === 'ko' ? ko : en; }

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const LEARN_FILE = path.join(__dirname, 'learning.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- 전체 플레이어 전략 학습 데이터 ----------
let globalLearn = { matches: 0, buy: {}, factories: 0, firstAttackSum: 0, firstAttackN: 0, rushes: 0, possess: 0 };
try { globalLearn = Object.assign(globalLearn, JSON.parse(fs.readFileSync(LEARN_FILE, 'utf8'))); } catch (e) { /* 처음 실행 */ }
let saveTimer = null;
function saveLearn() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(LEARN_FILE, JSON.stringify(globalLearn), () => {}), 500);
}
let tdmLearn = [];
try { tdmLearn = JSON.parse(fs.readFileSync(path.join(__dirname, 'learning-tdm.json'), 'utf8')); } catch (e) { /* 처음 */ }
function mergeLearn(s) {
  if (!s || typeof s !== 'object') return;
  if (s.tdm) { // 팀 모드: 최근 플레이어 패턴 요약 50개 보관
    tdmLearn.push(s.tdm);
    if (tdmLearn.length > 50) tdmLearn.shift();
    fs.writeFile(path.join(__dirname, 'learning-tdm.json'), JSON.stringify(tdmLearn), () => {});
    return;
  }
  globalLearn.matches += 1;
  for (const k in (s.buy || {})) {
    const v = Number(s.buy[k]) || 0;
    if (v > 0 && v < 1000) globalLearn.buy[k] = (globalLearn.buy[k] || 0) + v;
  }
  globalLearn.factories += Math.min(20, Number(s.factories) || 0);
  if (s.firstAttack >= 0 && s.firstAttack < 3600) {
    globalLearn.firstAttackSum += s.firstAttack; globalLearn.firstAttackN += 1;
    if (s.firstAttack < 45) globalLearn.rushes += 1;
  }
  globalLearn.possess += Math.min(50, Number(s.possess) || 0);
  saveLearn();
}

// ---------- 매칭 / 중계 ----------
const wss = new WebSocketServer({ server });
let waiting = null;
let nextId = 1;

function send(ws, obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcastOnline() {
  const n = wss.clients.size;
  wss.clients.forEach(c => send(c, { type: 'online', n }));
}
function unlink(ws) {
  if (waiting === ws) waiting = null;
  if (ws.peer) {
    const p = ws.peer;
    ws.peer = null;
    if (p.peer === ws) { p.peer = null; send(p, { type: 'peerLeft' }); }
  }
}

wss.on('connection', ws => {
  ws.id = nextId++;
  ws.peer = null;
  send(ws, { type: 'hello', id: ws.id, learn: globalLearn, learnTdm: tdmLearn });
  broadcastOnline();

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    switch (m.type) {
      case 'queue':
        unlink(ws);
        ws.name = String(m.name || tr('플레이어', 'Player')).slice(0, 16);
        ws.level = Number(m.level) || 1;
        if (waiting && waiting !== ws && waiting.readyState === WebSocket.OPEN) {
          const a = waiting; waiting = null;
          a.peer = ws; ws.peer = a;
          send(a, { type: 'matched', side: 0, opponent: { name: ws.name, level: ws.level } });
          send(ws, { type: 'matched', side: 1, opponent: { name: a.name, level: a.level } });
          console.log(tr(`[매칭] ${a.name} vs ${ws.name}`, `[match] ${a.name} vs ${ws.name}`));
        } else {
          waiting = ws;
          send(ws, { type: 'queued' });
        }
        break;
      case 'cancel':
        if (waiting === ws) waiting = null;
        break;
      case 'leave':
        unlink(ws);
        break;
      case 'learn':
        mergeLearn(m.stats);
        break;
      case 'pres': { // 팀 모드: presence 상태 공유
        ws.pres = ws.pres || {};
        const patch = m.patch || {};
        for (const k in patch) { if (patch[k] === null) delete ws.pres[k]; else ws.pres[k] = patch[k]; }
        presDirty = true;
        break;
      }
      case 'getLearn':
        send(ws, { type: 'learnData', learn: globalLearn });
        break;
      default:
        // flag, start, cmd, snap, end 등은 상대에게 그대로 중계
        if (ws.peer && ws.peer.readyState === WebSocket.OPEN) ws.peer.send(raw.toString());
    }
  });

  ws.on('close', () => { unlink(ws); broadcastOnline(); if (ws.pres) presDirty = true; });
});

// presence 를 쓰는 사람들에게 20Hz 로 전체 상태 방송
let presDirty = false;
setInterval(() => {
  if (!presDirty) return;
  presDirty = false;
  const members = [...wss.clients].filter(c => c.pres && c.readyState === WebSocket.OPEN);
  const peers = members.map(c => ({ peer: 'p' + String(c.id).padStart(6, '0'), presence: c.pres }));
  const body = JSON.stringify(peers);
  for (const c of members) c.send(`{"type":"peers","me":"p${String(c.id).padStart(6, '0')}","peers":${body}}`);
}, 50);

server.listen(PORT, () => {
  console.log('==========================================');
  console.log(tr('  Ground Wars 서버 실행 중', '  Ground Wars server running'));
  console.log(tr(`  이 컴퓨터:   http://localhost:${PORT}`, `  This PC:    http://localhost:${PORT}`));
  const nets = os.networkInterfaces();
  for (const name in nets) for (const n of nets[name]) {
    if (n.family === 'IPv4' && !n.internal) console.log(tr(`  같은 와이파이: http://${n.address}:${PORT}`, `  Same Wi-Fi: http://${n.address}:${PORT}`));
  }
  console.log('==========================================');
});
