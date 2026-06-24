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
    rooms.set(roomId, { players: new Map() });
  }
  return rooms.get(roomId);
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
const WORLD = { width: 6688, height: 3764 }; // 군도 맵(타일 64px × 105×59)

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('joinRoom', ({ roomId, name } = {}) => {
    roomId = (roomId || 'lobby').toString().slice(0, 24);
    currentRoomId = roomId;
    socket.join(roomId);

    const room = getRoom(roomId);
    const role = assignRole(room);

    const me = {
      id: socket.id,
      role,
      color: Math.floor(Math.random() * 3), // 숨는이 색(gray/lemon/orange) 랜덤 인덱스
      name: (name || `P-${socket.id.slice(0, 4)}`).toString().slice(0, 16),
      // 중앙 섬의 안전 영역에서 스폰(군도 맵 — 물/호수 회피, 타일 64px)
      x: 3000 + Math.random() * 800,
      y: 2580 + Math.random() * 160,
      angle: 0,
      dataURL: null, // 아직 위장 그림 없음
      caught: false, // 술래에게 잡혔는지
    };
    room.players.set(socket.id, me);

    // 접속한 본인에게: 내 정보 + 방의 기존 플레이어 목록 전달
    socket.emit('init', {
      id: socket.id,
      role,
      world: WORLD,
      players: Array.from(room.players.values()),
    });

    // 같은 방 다른 사람에게: 새 플레이어 입장 알림
    socket.to(roomId).emit('playerJoined', me);

    console.log(`[join] room=${roomId} id=${socket.id} role=${role} total=${room.players.size}`);
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
    socket.to(currentRoomId).emit('playerMoved', { id: socket.id, x, y, angle, z, anim, flip, holding });
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

  // -------------------------------------------------------------------------
  // 사격으로 숨는이 잡기: 술래가 명중 판정 후 보냄 → 서버가 확정·중계 + 승리 체크
  // -------------------------------------------------------------------------
  socket.on('catch', ({ targetId } = {}) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const shooter = room.players.get(socket.id);
    const target = room.players.get(targetId);
    if (!shooter || shooter.role !== 'seeker') return;
    if (!target || target.role !== 'hider' || target.caught) return;
    target.caught = true;
    io.to(currentRoomId).emit('playerCaught', { id: targetId });
    // 안 잡힌 숨는이가 0명이면 술래 승리
    const remaining = [...room.players.values()].filter((p) => p.role === 'hider' && !p.caught).length;
    if (remaining === 0) io.to(currentRoomId).emit('gameOver', { winner: 'seeker' });
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
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    leaveVoice();
    room.players.delete(socket.id);
    socket.to(currentRoomId).emit('playerLeft', { id: socket.id });
    console.log(`[leave] room=${currentRoomId} id=${socket.id} total=${room.players.size}`);
    if (room.players.size === 0) rooms.delete(currentRoomId);
  });
});

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
