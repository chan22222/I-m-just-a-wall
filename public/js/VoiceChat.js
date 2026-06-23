// =============================================================================
// VoiceChat.js  -  음성채팅 (WebRTC P2P 메시 + Socket.io 시그널링)
// -----------------------------------------------------------------------------
//  - B: 음성채팅 참여/나가기  (join/leave)
//  - V: 마이크 ON/OFF        (mute/unmute)
//  - 같은 방에서 참여한 사람끼리 서로 들림(풀 메시). 새로 들어온 쪽이 기존
//    참여자에게 offer 를 보내므로 양쪽이 동시에 offer 하는 충돌(glare)이 없다.
//  - getUserMedia 는 보안 컨텍스트(HTTPS 또는 localhost)에서만 동작한다.
//    LAN(http://192.168.x.x) 에서는 브라우저가 마이크를 막으므로 onStatus 로
//    오류를 알린다.
// =============================================================================

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export class VoiceChat {
  constructor(socket, { onStatus } = {}) {
    this.socket = socket;
    this.onStatus = onStatus || (() => {});
    this.joined = false;
    this.micOn = true;
    this.master = 1; // 사용자 볼륨(0~1) — 거리 볼륨에 곱해짐
    this.localStream = null;
    this.peers = new Map(); // peerId -> { pc, audioEl, pendingIce: [], distVol }
    this._bindSignaling();
  }

  // ---- 시그널링 수신 ------------------------------------------------------
  _bindSignaling() {
    // 내가 새로 참여 → 기존 참여자 목록을 받고 각자에게 offer 를 보낸다
    this.socket.on('voicePeers', ({ ids }) => {
      (ids || []).forEach((id) => this._callPeer(id));
    });
    this.socket.on('voiceLeft', ({ id }) => this._removePeer(id));
    this.socket.on('voiceSignal', ({ from, desc, ice }) => this._onSignal(from, desc, ice));
  }

  // ---- 참여 / 나가기 ------------------------------------------------------
  async join() {
    if (this.joined) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.onStatus({ error: '이 브라우저/환경에서는 마이크를 쓸 수 없어요 (HTTPS 필요)' });
      return;
    }
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      this.onStatus({ error: this._micErrorMessage(err) });
      return;
    }
    this.joined = true;
    this.micOn = true;
    this._applyMic();
    this.socket.emit('voiceJoin');
    this._emitStatus();
  }

  leave() {
    if (!this.joined) return;
    this.joined = false;
    this.socket.emit('voiceLeave');
    for (const id of [...this.peers.keys()]) this._removePeer(id);
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this._emitStatus();
  }

  toggle() {
    if (this.joined) this.leave();
    else this.join();
  }

  // ---- 마이크 ON/OFF ------------------------------------------------------
  toggleMic() {
    if (!this.joined) {
      this.onStatus({ error: 'B 로 음성채팅에 먼저 참여하세요' });
      return;
    }
    this.micOn = !this.micOn;
    this._applyMic();
    this._emitStatus();
  }

  _applyMic() {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach((t) => { t.enabled = this.micOn; });
  }

  // 거리 기반 볼륨: GameScene 이 거리로 계산한 값(0~1)을 넣어준다(사용자 볼륨이 곱해짐)
  setPeerVolume(peerId, vol) {
    const entry = this.peers.get(peerId);
    if (!entry || !entry.audioEl) return;
    entry.distVol = vol;
    const v = Math.max(0, Math.min(1, vol * this.master));
    if (entry.audioEl.volume !== v) entry.audioEl.volume = v;
  }

  // 사용자 볼륨 설정(슬라이더, 0~1) — 현재 거리 볼륨에 즉시 반영
  setMaster(v) {
    this.master = Math.max(0, Math.min(1, v));
    for (const entry of this.peers.values()) {
      if (!entry.audioEl) continue;
      const dv = entry.distVol == null ? 1 : entry.distVol;
      entry.audioEl.volume = Math.max(0, Math.min(1, dv * this.master));
    }
    this._emitStatus();
  }

  // 키(− / =)용 상대 조절
  adjustVolume(delta) {
    this.setMaster(Math.round((this.master + delta) * 100) / 100);
  }

  // ---- 피어 연결 ----------------------------------------------------------
  _createPeer(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const entry = { pc, audioEl: null, pendingIce: [] };
    this.peers.set(peerId, entry);

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) this.socket.emit('voiceSignal', { to: peerId, ice: e.candidate });
    };
    pc.ontrack = (e) => {
      if (!entry.audioEl) {
        const el = document.createElement('audio');
        el.autoplay = true;
        el.dataset.peer = peerId;
        document.body.appendChild(el);
        entry.audioEl = el;
      }
      entry.audioEl.srcObject = e.streams[0];
      // 자동재생 정책으로 막힐 수 있어 명시적으로 play 시도
      const p = entry.audioEl.play();
      if (p && p.catch) p.catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this._removePeer(peerId); // 끊긴 피어 정리(인원 갱신)
      } else {
        this._emitStatus();
      }
    };
    this._emitStatus(); // 피어 추가 즉시 인원 반영(실시간)
    return entry;
  }

  // 내가 발신자가 되어 offer 전송
  async _callPeer(peerId) {
    const entry = this._createPeer(peerId);
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      this.socket.emit('voiceSignal', { to: peerId, desc: entry.pc.localDescription });
    } catch (err) {
      // 연결 실패 시 다음 시도를 위해 정리
      this._removePeer(peerId);
    }
  }

  async _onSignal(from, desc, ice) {
    try {
      if (desc) {
        const entry = this._createPeer(from);
        const pc = entry.pc;
        if (desc.type === 'offer') {
          await pc.setRemoteDescription(desc);
          await this._flushIce(entry);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.socket.emit('voiceSignal', { to: from, desc: pc.localDescription });
        } else if (desc.type === 'answer') {
          await pc.setRemoteDescription(desc);
          await this._flushIce(entry);
        }
      } else if (ice) {
        const entry = this._createPeer(from);
        const pc = entry.pc;
        // 원격 설명(setRemoteDescription) 전에 도착한 후보는 잠시 보관 후 적용
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(ice);
        } else {
          entry.pendingIce.push(ice);
        }
      }
    } catch (err) {
      // 시그널 처리 중 오류는 치명적이지 않음(무시하고 진행)
    }
  }

  async _flushIce(entry) {
    if (!entry.pendingIce.length) return;
    const list = entry.pendingIce.splice(0);
    for (const ice of list) {
      try { await entry.pc.addIceCandidate(ice); } catch (err) { /* noop */ }
    }
  }

  _removePeer(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    try {
      entry.pc.ontrack = null;
      entry.pc.onicecandidate = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
    } catch (err) { /* noop */ }
    if (entry.audioEl) {
      entry.audioEl.srcObject = null;
      entry.audioEl.remove();
    }
    this.peers.delete(peerId);
    this._emitStatus(); // 인원 갱신
  }

  // ---- 상태 알림 ----------------------------------------------------------
  _emitStatus() {
    this.onStatus({
      joined: this.joined,
      micOn: this.micOn,
      peers: this.peers.size,
      master: this.master,
    });
  }

  _micErrorMessage(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return '마이크 권한이 거부됐어요 (또는 HTTPS 필요)';
    }
    if (name === 'NotFoundError') return '마이크 장치를 찾을 수 없어요';
    return '마이크를 켜지 못했어요: ' + (name || '알 수 없는 오류');
  }
}
