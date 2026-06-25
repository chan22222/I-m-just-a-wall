// =============================================================================
// server.js  -  [3단계] 멀티플레이 연동 (Node.js + Socket.io)
// -----------------------------------------------------------------------------
// - 정적 파일(public)을 서빙하고
// - 방(room) 단위로 플레이어 상태를 관리하며
// - 위치 이동 / 위장 그림 / 휘파람 이벤트를 같은 방의 다른 유저에게 중계한다.
// =============================================================================

import express from 'express';
import http from 'http';
import os from 'os';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // 위장 그림(dataURL/base64 PNG)은 용량이 커질 수 있으므로 버퍼 상한을 넉넉히 둔다.
  maxHttpBufferSize: 5 * 1024 * 1024, // 5MB
});

app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------------------------------------------
// 방 상태 저장소
//   rooms = {
//     [roomId]: {
//       players: { [socketId]: { id, role, x, y, angle, name, dataURL } }
//     }
//   }
// -----------------------------------------------------------------------------
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { players: new Map(), isPublic: false, name: '' });
  }
  return rooms.get(roomId);
}

// 방 코드(5자리, 혼동되는 글자 제외)
function genRoomCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += ch[Math.floor(Math.random() * ch.length)];
  return s;
}

// 숫자 옵션 범위 제한(잘못된 값이면 기본값)
function clampNum(v, min, max, def) {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, Math.round(v)));
}

// 이름 미입력(비공개 방) 시 자동으로 붙일 랜덤 방 이름
const ROOM_ADJ = ['은밀한', '조용한', '깜깜한', '수상한', '아늑한', '비밀의', '한적한', '으슥한'];
const ROOM_NOUN = ['아지트', '은신처', '대기실', '놀이터', '소굴', '다락방', '창고', '비밀기지'];
function genRoomName() {
  const a = ROOM_ADJ[Math.floor(Math.random() * ROOM_ADJ.length)];
  const n = ROOM_NOUN[Math.floor(Math.random() * ROOM_NOUN.length)];
  return `${a} ${n}`;
}

// 같은 이름의 (사람이 있는) 방이 이미 있는지
function roomNameExists(name) {
  for (const room of rooms.values()) {
    if (room.players.size > 0 && room.name === name) return true;
  }
  return false;
}

// 전역 닉네임 점유(소켓별). 닉은 방 선택 전에 확정되며 전체에서 유일해야 함.
const nicks = new Map(); // socketId -> nick
const NICK_RE = /^[A-Za-z0-9가-힣]{1,16}$/; // 한글·영문·숫자만(공백·특수문자 불가)
function nickTaken(nick, exceptId) {
  const lower = nick.toLowerCase();
  for (const [id, n] of nicks) {
    if (id !== exceptId && n.toLowerCase() === lower) return true;
  }
  return false;
}

// 배열 제자리 셔플(Fisher-Yates)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 방에 술래(seeker)가 이미 있으면 hider, 없으면 seeker 로 역할 배정
function assignRole(room) {
  let hasSeeker = false;
  for (const p of room.players.values()) {
    if (p.role === 'seeker') hasSeeker = true;
  }
  return hasSeeker ? 'hider' : 'seeker';
}

// 월드 크기(클라이언트와 동일하게 유지). 스폰 위치 계산용.
// 군도 맵(위, y 0~3764) + 전용 로비 방(아래) 을 한 월드에 둔다
const WORLD = { width: 6688, height: 5440 }; // 타일 64px × 105×85

io.on('connection', (socket) => {
  let currentRoomId = null;

  // 공통 입장 처리: 역할 배정 + 플레이어 생성 + init 전송
  function doJoin(roomId, nickname) {
    currentRoomId = roomId;
    socket.join(roomId);
    const room = getRoom(roomId);
    const role = 'hider'; // 로비에선 모두 숨는이 — 시작할 때 술래를 랜덤 배정
    const me = {
      id: socket.id,
      role,
      color: Math.floor(Math.random() * 3), // 숨는이 색(gray/lemon/orange) 랜덤 인덱스
      name: (nickname || `P-${socket.id.slice(0, 4)}`).toString().slice(0, 16),
      // 입장 시엔 로비 방에서 대기(시작하면 클라가 게임 맵으로 텔레포트)
      x: 3400 + (Math.random() - 0.5) * 760,
      y: 4416 + (Math.random() - 0.5) * 460,
      angle: 0,
      dataURL: null, // 아직 위장 그림 없음
      // 진행 중인 방에 난입하면 죽은 것처럼 관전(라운드 끝나면 다음 판부터 참여)
      caught: room.phase === 'playing',
      score: 0,      // 점수(술래=킬 500 / 숨는이=술래 근접 초당 10)
    };
    room.players.set(socket.id, me);
    socket.emit('init', {
      id: socket.id,
      role,
      caught: me.caught, // 난입 관전 여부
      world: WORLD,
      players: Array.from(room.players.values()),
      roomId,
      roomName: room.name,
      isPublic: room.isPublic,
      // 방 옵션 + 진행 단계/방장 여부 + 술래 대기 남은 시간(시계차 무관하게 ms)
      options: {
        maxPlayers: room.maxPlayers || 12,
        seekerCount: room.seekerCount || 2,
        seekerWait: room.seekerWait || 70,
        hiderTime: room.hiderTime || 200,
        revealTime: room.revealTime || 30,
        whistleTime: room.whistleTime || 30,
        mode: room.mode || 'basic',
      },
      phase: room.phase || 'lobby',
      isHost: room.hostId === socket.id,
      hostId: room.hostId,
      seekerRemainMs: room.seekerReleaseAt ? Math.max(0, room.seekerReleaseAt - Date.now()) : 0,
      whistleRemainMs: room.nextWhistleAt ? Math.max(0, room.nextWhistleAt - Date.now()) : 0,
      hiderRemainMs: room.hiderEndAt ? Math.max(0, room.hiderEndAt - Date.now()) : 0,
      revealRemainMs: room.revealEndAt ? Math.max(0, room.revealEndAt - Date.now()) : 0,
    });
    socket.to(roomId).emit('playerJoined', me);
    broadcastScores(roomId);
    console.log(`[join] room=${roomId} id=${socket.id} role=${role} total=${room.players.size}`);
  }

  // 닉네임 확정(전역 유일 + 형식 검증). 확정 후 바꿀 수 없음.
  socket.on('setNick', ({ nick } = {}) => {
    nick = String(nick || '').trim();
    if (!NICK_RE.test(nick)) {
      socket.emit('nickError', { message: '한글·영문·숫자만 가능해요 (공백·특수문자 불가).' });
      return;
    }
    if (nickTaken(nick, socket.id)) {
      socket.emit('nickError', { message: '이미 접속된 아이디입니다.' });
      return;
    }
    nicks.set(socket.id, nick);
    socket.emit('nickOk', { nick });
  });

  // 방 만들기(공개/비공개 + 옵션) → 코드 생성 후 자동 입장
  socket.on('createRoom', ({ name, isPublic, nickname, maxPlayers, seekerWait, hiderTime, revealTime, seekerCount, whistleTime, mode } = {}) => {
    name = String(name || '').slice(0, 20).trim();
    if (name) {
      if (roomNameExists(name)) {
        socket.emit('joinError', { message: '이미 있는 방 이름 입니다.' });
        return;
      }
    } else {
      // 이름 미입력(비공개 방) → 유일한 랜덤 이름 자동 생성
      do { name = genRoomName(); } while (roomNameExists(name));
    }
    let code;
    do { code = genRoomCode(); } while (rooms.has(code));
    const room = getRoom(code);
    room.isPublic = !!isPublic;
    room.name = name;
    room.hostId = socket.id;   // 방장(시작 권한)
    room.phase = 'lobby';      // lobby → playing
    room.maxPlayers = clampNum(maxPlayers, 2, 30, 12);
    room.seekerWait = clampNum(seekerWait, 5, 200, 70);
    room.hiderTime = clampNum(hiderTime, 30, 600, 200);
    room.revealTime = clampNum(revealTime, 5, 100, 30);
    room.whistleTime = clampNum(whistleTime, 3, 50, 10);
    room.seekerCount = clampNum(seekerCount, 1, 3, 1);
    room.mode = mode === 'infection' ? 'infection' : 'basic';
    socket.emit('roomCreated', { roomId: code, isPublic: room.isPublic });
    doJoin(code, nickname);
  });

  // 방 참가(코드/공개목록 ID) — 존재하고 인원이 있고 가득 차지 않은 방만
  socket.on('joinRoom', ({ roomId, nickname } = {}) => {
    roomId = String(roomId || '').trim().toUpperCase().slice(0, 12);
    const room = rooms.get(roomId);
    if (!roomId || !room || room.players.size === 0) {
      socket.emit('joinError', { message: '방을 찾을 수 없습니다.' });
      return;
    }
    if (room.players.size >= (room.maxPlayers || 12)) {
      socket.emit('joinError', { message: '방이 가득 찼습니다.' });
      return;
    }
    doJoin(roomId, nickname);
  });

  // 방 옵션 일괄 수정 — 방장만, 로비 단계에서만
  socket.on('updateRoomOptions', (opts = {}) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    room.maxPlayers = clampNum(opts.maxPlayers, 2, 30, room.maxPlayers || 12);
    room.seekerCount = clampNum(opts.seekerCount, 1, 3, room.seekerCount || 1);
    room.seekerWait = clampNum(opts.seekerWait, 5, 200, room.seekerWait || 70);
    room.hiderTime = clampNum(opts.hiderTime, 30, 600, room.hiderTime || 200);
    room.revealTime = clampNum(opts.revealTime, 5, 100, room.revealTime || 30);
    room.whistleTime = clampNum(opts.whistleTime, 3, 50, room.whistleTime || 10);
    room.mode = opts.mode === 'infection' ? 'infection' : 'basic';
    // 변경된(검증된) 옵션을 방 전체에 브로드캐스트 — 다른 플레이어도 최신 설정을 보도록
    io.to(currentRoomId).emit('roomOptions', {
      maxPlayers: room.maxPlayers,
      seekerCount: room.seekerCount,
      seekerWait: room.seekerWait,
      hiderTime: room.hiderTime,
      revealTime: room.revealTime,
      whistleTime: room.whistleTime,
      mode: room.mode,
    });
  });

  // 게임 시작 — 방장만. 바로 시작하지 않고 15초 카운트다운 후 라운드 개시
  socket.on('startGame', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    // 공개 방은 최소 3명 필요, 비공개 방은 혼자서도 시작 가능
    const minPlayers = room.isPublic ? 3 : 1;
    if (room.players.size < minPlayers) {
      socket.emit('startError', { message: `게임 시작에는 최소 ${minPlayers}명이 필요합니다.` });
      return;
    }
    room.phase = 'starting';
    room.startAt = Date.now() + 15000;
    io.to(currentRoomId).emit('gameStarting', { remainMs: 15000 });
  });

  // 공개 방 목록
  socket.on('listRooms', () => {
    const list = [];
    for (const [id, room] of rooms) {
      if (room.isPublic && room.players.size > 0) {
        list.push({
          id, name: room.name || id, count: room.players.size,
          max: room.maxPlayers || 12, mode: room.mode || 'basic',
          seekers: room.seekerCount || 2, phase: room.phase || 'lobby',
          seekerWait: room.seekerWait || 70, hiderTime: room.hiderTime || 200,
          revealTime: room.revealTime || 30, whistleTime: room.whistleTime || 30,
        });
      }
    }
    socket.emit('roomList', list);
  });

  // -------------------------------------------------------------------------
  // 이동 동기화: 위치 + 바라보는 각도(시야 방향)
  // -------------------------------------------------------------------------
  socket.on('move', ({ x, y, angle, z, anim, flip, holding } = {}) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.x = x;
    p.y = y;
    p.angle = angle;
    p.holding = !!holding; // 늦게 입장하는 사람도 받도록 저장
    // 높이축(z) / 애니메이션 / 좌우반전 / 캔버스 들고있음 도 그대로 중계
    // volatile: 최신 위치만 중요 → 네트워크가 밀리면 버퍼에 쌓지 않고 드롭(폭주 방지)
    socket.to(currentRoomId).volatile.emit('playerMoved', { id: socket.id, x, y, angle, z, anim, flip, holding });
  });

  // -------------------------------------------------------------------------
  // [2단계 연동] 위장 그림 동기화: A가 자기 몸에 그린 그림을 방 전체에 중계
  //   dataURL: 그림판 캔버스를 toDataURL('image/png') 한 base64 문자열
  // -------------------------------------------------------------------------
  socket.on('draw', ({ dataURL } = {}) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    // null = 그림 지움(기본 고양이로 복귀). 나중에 입장하는 사람도 최신 모습을 받도록 저장
    p.dataURL = dataURL || null;
    socket.to(currentRoomId).emit('playerDrew', { id: socket.id, dataURL: p.dataURL });
  });

  // -------------------------------------------------------------------------
  // [5단계] 휘파람: 위치를 같이 보내서, 받는 쪽에서 반경 판정을 한다.
  // -------------------------------------------------------------------------
  socket.on('whistle', ({ x, y } = {}) => {
    if (!currentRoomId) return;
    // 본인 포함 방 전체에 broadcast (본인도 이펙트를 보도록)
    // 강제 휘파람 타이머는 각 클라이언트가 개인적으로 관리(직접 불면 본인 카운트만 리셋)
    io.to(currentRoomId).emit('playerWhistled', { id: socket.id, x, y });
  });

  // -------------------------------------------------------------------------
  // 채팅: 방 전체(본인 포함)에 중계
  // -------------------------------------------------------------------------
  socket.on('chat', ({ text } = {}) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    const msg = String(text || '').trim().slice(0, 120);
    if (!msg) return;
    io.to(currentRoomId).emit('chatMessage', { id: socket.id, name: p.name, text: msg });
  });

  // 강퇴: 방장만. 대상에게 알린 뒤 잠시 후 연결 종료(→ disconnect 핸들러가 방 정리·호스트 인계)
  socket.on('kickPlayer', ({ id } = {}) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id) return; // 방장만 강퇴 가능
    if (!id || id === socket.id) return;             // 자기 자신은 강퇴 불가
    if (!room.players.has(id)) return;               // 같은 방의 플레이어만
    const target = io.sockets.sockets.get(id);
    if (!target) return;
    io.to(id).emit('kicked'); // 대상에게 강퇴 안내(클라가 타이틀로 복귀)
    setTimeout(() => { const t = io.sockets.sockets.get(id); if (t) t.disconnect(true); }, 200);
  });

  // -------------------------------------------------------------------------
  // 사격으로 숨는이 잡기: 술래가 명중 판정 후 보냄 → 서버가 확정·중계 + 승리 체크
  // -------------------------------------------------------------------------
  socket.on('catch', ({ targetId } = {}) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.phase !== 'playing') return; // 정답 공개/종료 단계엔 잡기 무시
    const shooter = room.players.get(socket.id);
    const target = room.players.get(targetId);
    if (!shooter || shooter.role !== 'seeker') return;
    if (!target || target.role !== 'hider' || target.caught) return;
    shooter.score = (shooter.score || 0) + 500; // 킬 보너스
    if (room.mode === 'infection') {
      // 감염모드: 잡힌 자리에 시체+그림을 남기고(전시), 본인은 술래로 부활해 즉시 추격
      io.to(currentRoomId).emit('corpseSpawn', { id: targetId });
      target.role = 'seeker';
      target.dataURL = null; // 술래로 변신 → 위장 그림 제거(그림은 시체에만 남음)
      io.to(currentRoomId).emit('rolesUpdated', [{ id: targetId, role: 'seeker' }]);
      io.to(targetId).emit('infected');
    } else {
      // 휘파람/기본: 잡힌 자리에 시체를 남기고(감염처럼), 본인은 유령(흑백 반투명·이동 가능)
      io.to(currentRoomId).emit('corpseSpawn', { id: targetId });
      target.caught = true;
      io.to(currentRoomId).emit('playerCaught', { id: targetId });
    }
    broadcastScores(currentRoomId);
    // 안 잡힌/감염 안 된 숨는이가 0명이면 술래 승리
    const remaining = [...room.players.values()].filter((p) => p.role === 'hider' && !p.caught).length;
    if (remaining === 0) endRound(currentRoomId, room, 'seeker');
  });

  // -------------------------------------------------------------------------
  // 음성채팅 시그널링 (WebRTC P2P 메시)
  //   voiceJoin  : 새 참여자에게 기존 참여자 목록(voicePeers)을 주고 명단에 추가
  //   voiceLeave : 명단에서 빼고 다른 참여자에게 알림(voiceLeft)
  //   voiceSignal: offer/answer/ICE 후보를 대상 소켓에게 그대로 중계
  // -------------------------------------------------------------------------
  function leaveVoice() {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || !room.voice) return;
    if (room.voice.delete(socket.id)) {
      socket.to(currentRoomId).emit('voiceLeft', { id: socket.id });
    }
  }

  socket.on('voiceJoin', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (!room.voice) room.voice = new Set();
    // 새 참여자가 발신자가 되어 기존 참여자에게 offer 를 보낸다(중복 offer 방지)
    const peers = [...room.voice].filter((id) => id !== socket.id);
    socket.emit('voicePeers', { ids: peers });
    room.voice.add(socket.id);
  });

  socket.on('voiceLeave', () => leaveVoice());

  socket.on('voiceSignal', ({ to, desc, ice } = {}) => {
    if (!to) return;
    io.to(to).emit('voiceSignal', { from: socket.id, desc, ice });
  });

  // 발사 포즈 동기화: 술래가 쏘면 같은 방의 다른 사람에게 발사 포즈(gun_shot)를 알림
  socket.on('shoot', () => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('playerShot', { id: socket.id });
  });

  socket.on('disconnect', () => {
    nicks.delete(socket.id); // 닉네임 점유 해제
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    leaveVoice();
    room.players.delete(socket.id);
    socket.to(currentRoomId).emit('playerLeft', { id: socket.id });
    // 방장이 나가면 남은 사람 아무에게나 인계(안 그러면 시작·설정이 막혀 방이 먹통이 됨)
    if (room.hostId === socket.id && room.players.size > 0) {
      room.hostId = room.players.keys().next().value;
      io.to(currentRoomId).emit('hostChanged', { hostId: room.hostId });
    }
    broadcastScores(currentRoomId);
    console.log(`[leave] room=${currentRoomId} id=${socket.id} total=${room.players.size}`);
    if (room.players.size === 0) rooms.delete(currentRoomId);
  });
});

// 점수판 동기화: 방 전체 플레이어의 점수/역할을 브로드캐스트
function broadcastScores(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const scores = [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, role: p.role, score: p.score || 0, caught: !!p.caught,
  }));
  io.to(roomId).emit('scores', scores);
}

// 라운드 개시: 술래 선정 + 단계 시각 설정 후 방 전체에 알림(카운트다운 종료 시 호출)
function beginRound(roomId, room) {
  room.phase = 'playing';
  room.seekerReleaseAt = Date.now() + (room.seekerWait || 70) * 1000;
  room.nextWhistleAt = Date.now() + (room.whistleTime || 30) * 1000; // 강제 휘파람 첫 발동
  room.hiderEndAt = room.seekerReleaseAt + (room.hiderTime || 200) * 1000;
  room.revealEndAt = 0;
  // 술래 선정: 지원 구역(로비 가운데) 안 플레이어 우선 → 정원 초과 시 추첨, 미달 시 나머지에서 추첨
  const SZ = { x: 3400, y: 4416, r2: 150 * 150 };
  const players = [...room.players.values()];
  const inZone = (p) => { const dx = (p.x || 0) - SZ.x, dy = (p.y || 0) - SZ.y; return dx * dx + dy * dy < SZ.r2; };
  const volunteers = shuffle(players.filter(inZone));
  const others = shuffle(players.filter((p) => !inZone(p)));
  const sc = Math.min(room.seekerCount || 2, players.length);
  let seekers = volunteers.slice(0, sc);
  if (seekers.length < sc) seekers = seekers.concat(others.slice(0, sc - seekers.length));
  const seekerIds = new Set(seekers.map((p) => p.id));
  players.forEach((p) => { p.role = seekerIds.has(p.id) ? 'seeker' : 'hider'; p.caught = false; });
  const remain = Math.max(0, room.seekerReleaseAt - Date.now());
  for (const p of players) {
    io.to(p.id).emit('gameStarted', { seekerRemainMs: remain, role: p.role, mode: room.mode || 'basic' });
  }
  io.to(roomId).emit('rolesUpdated', players.map((p) => ({ id: p.id, role: p.role })));
  broadcastScores(roomId);
}

// 라운드 종료: 승패 알림 + 로비 복귀 예약(술래 승은 10초 안내, 숨는이 승은 즉시)
function endRound(roomId, room, winner, returnMs) {
  if (room.phase === 'ended') return;
  room.phase = 'ended';
  // 기본 복귀 시간: 술래 승 10초 / 숨는이 승(정답 공개 후) 즉시. 명시값이 오면 그대로 사용
  if (returnMs == null) returnMs = winner === 'seeker' ? 10000 : 0;
  room.returnToLobbyAt = Date.now() + returnMs;
  io.to(roomId).emit('gameOver', { winner, returnMs });
}

// 로비로 복귀: 단계/역할/잡힘/위치 초기화 후 방 전체에 알림(점수·위장 그림은 유지)
function resetToLobby(roomId, room) {
  room.phase = 'lobby';
  room.seekerReleaseAt = 0; room.nextWhistleAt = 0;
  room.hiderEndAt = 0; room.revealEndAt = 0; room.returnToLobbyAt = 0;
  for (const p of room.players.values()) {
    p.role = 'hider';
    p.caught = false;
    p.dataURL = null; // 판이 끝나면 위장 그림 초기화
    p.x = 3400 + (Math.random() - 0.5) * 760;
    p.y = 4416 + (Math.random() - 0.5) * 460;
  }
  io.to(roomId).emit('returnToLobby', {
    players: [...room.players.values()].map((p) => ({
      id: p.id, role: p.role, x: p.x, y: p.y, name: p.name, color: p.color, dataURL: p.dataURL || null,
    })),
  });
  broadcastScores(roomId);
}

// 근접 점수: 술래가 SCORE_RANGE 안에 있는 숨는이는 초당 +10점(위험 보상)
const SCORE_RANGE = 500;
const SCORE_RANGE_SQ = SCORE_RANGE * SCORE_RANGE; // sqrt 없이 제곱 거리로 비교
const SCORE_PER_SEC = 10;
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.players.size === 0) continue;
    // --- 라운드 단계 전환 ---
    if (room.phase === 'starting' && room.startAt && now >= room.startAt) {
      beginRound(roomId, room); // 시작 카운트다운 종료 → 라운드 개시
      continue;
    }
    if (room.phase === 'playing' && room.hiderEndAt && now >= room.hiderEndAt) {
      // 탐색 시간 종료: 살아남은 숨는이가 있으면 숨는이 승 + 정답 공개 단계
      const alive = [...room.players.values()].filter((p) => p.role === 'hider' && !p.caught);
      if (alive.length) {
        room.phase = 'reveal';
        room.revealEndAt = now + (room.revealTime || 30) * 1000;
        io.to(roomId).emit('revealStart', {
          remainMs: (room.revealTime || 30) * 1000,
          hiders: alive.map((p) => ({ id: p.id, x: p.x || 0, y: p.y || 0, name: p.name })),
        });
      } else {
        endRound(roomId, room, 'seeker');
      }
      continue;
    }
    if (room.phase === 'reveal' && room.revealEndAt && now >= room.revealEndAt) {
      endRound(roomId, room, 'hider'); // 정답 공개 끝 → 숨는이 승 + 즉시 로비
      continue;
    }
    // 종료 단계: 안내 시간(술래 승 10초 / 숨는이 승 즉시) 지나면 로비로 복귀
    if (room.phase === 'ended' && room.returnToLobbyAt && now >= room.returnToLobbyAt) {
      resetToLobby(roomId, room);
      continue;
    }
    if (room.phase !== 'playing') continue; // 점수/휘파람은 진행(playing) 중에만
    // 술래가 모두 이탈해 한 명도 남지 않으면 숨는이 승(로비/대기 단계는 위에서 제외됨)
    if (![...room.players.values()].some((p) => p.role === 'seeker' && !p.caught)) {
      endRound(roomId, room, 'hider', 6000); // 결과를 보여줄 시간을 주고 로비로 복귀
      continue;
    }
    // 강제 휘파람("휘파람을 참을 수 없어")은 각 클라이언트가 개인 타이머로 처리(서버 공용 X)
    const players = [...room.players.values()];
    const seekers = players.filter((p) => p.role === 'seeker' && !p.caught);
    const hiders = players.filter((p) => p.role === 'hider' && !p.caught);
    if (!seekers.length || !hiders.length) continue;
    let changed = false;
    for (const h of hiders) {
      // 근처(SCORE_RANGE) 술래 수만큼 점수 — 여러 술래에 둘러싸이면 그만큼 더 받음
      let nearCount = 0;
      for (const s of seekers) {
        const dx = (s.x || 0) - (h.x || 0), dy = (s.y || 0) - (h.y || 0);
        if (dx * dx + dy * dy < SCORE_RANGE_SQ) nearCount++;
      }
      if (nearCount) { h.score = (h.score || 0) + SCORE_PER_SEC * nearCount; changed = true; }
    }
    if (changed) broadcastScores(roomId);
  }
}, 1000);

const PORT = process.env.PORT || 3000;
// 0.0.0.0 → 같은 네트워크의 다른 기기에서도 접속 가능
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  imjustawall 서버 실행 중 (port ${PORT})`);
  console.log(`   - 내 PC:        http://localhost:${PORT}`);
  // 같은 와이파이/공유기에 있는 친구가 들어올 주소(들)
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   - 같은 네트워크: http://${net.address}:${PORT}   (${name})`);
      }
    }
  }
  console.log('');
});
