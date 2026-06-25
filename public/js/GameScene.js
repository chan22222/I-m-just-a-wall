// =============================================================================
// GameScene.js  -  게임 본체 (2.5D 탑뷰 / 고양이 스프라이트)
//   [1단계] Phaser 기본 세팅 + WASD 이동
//   [2단계] 위장 그림 — 캐릭터 위에 직접 그리기(줌인 + 격자 페인팅)
//   [3단계] Socket.io 멀티플레이 동기화 (이동/애니/점프/위장그림)
//   [4단계] 술래 시야(부채꼴 마스킹) + 숨는 사람 은닉
//   [5단계] 휘파람(E) 사운드 + 반경 내 이모티콘
//
//   조작: WASD 이동 / E 휘파람 / Space 점프 / Q 위장그리기 / 마우스 술래시야
// =============================================================================

import { DrawingBoard } from './DrawingBoard.js';
import { VoiceChat } from './VoiceChat.js';
import { ChromaticAberrationPostFX } from './PostFX.js';
import { MapBuilder } from './MapBuilder.js';

const SPEED = 300;        // 이동 속도(px/s)
const SEEKER_SPEED = 360; // 술래 이동 속도
const HOLD_SPEED = 55;    // 캔버스 든 채 이동 속도(매우 느림)
const JUMP_VEL = 380;     // 점프 초기 상승 속도(z, px/s)
const GRAVITY = 1200;     // 중력(z, px/s^2)
const CONE_HALF = Phaser.Math.DEG_TO_RAD * 45; // 부채꼴 반각(전체 90도)
const CONE_R = 780;       // 시야 거리(가시거리 더 늘림)
const NEAR_R = 180;       // 술래 주변 항상 보이는 반경 — 커진 캐릭터를 안 가리게
const WHISTLE_R = 420;        // 🎵 이펙트(숨는이)가 뜨는 반경
const WHISTLE_MAX_R = 800;    // 소리가 들리는 최대 거리(이 거리에서 가장 작게)
const VOICE_NEAR_R = 160;     // 음성채팅: 이 거리 안은 최대 볼륨
const VOICE_MAX_R = 700;      // 음성채팅: 이 거리부터는 안 들림(볼륨 0)
// 사격(술래) — 마우스 방향 발사로 숨는이 잡기
const GUN_RANGE = 400;    // 사거리
const HIT_RADIUS = 48;    // 명중 판정 반경(조준선에서 이 거리 안이면 맞음)
const GUN_CD = 650;       // 명중/평소 쿨다운(ms)
const GUN_CD_MISS = 2000; // 빗맞힘 쿨다운(ms)
const SLOW_MS = 100;      // 발사 후 둔화 지속(ms) — 아주 짧게
const SLOW_FACTOR = 0.4;  // 둔화 시 속도 배율
const SHOT_HEAR_R = 1500; // 총소리가 들리는 최대 거리(이 거리에서 가장 작게)
const SHOT_KNOCKBACK = 800; // 발사 시 뒤로 밀리는 초기 속도(px/s)
const ROLE_COLOR = { seeker: 0xff5a5a, hider: 0x5fe08a };
const HIDER_SETS = ['gray', 'lemon', 'orange']; // 숨는이 색 세트(랜덤 배정)
const UI_FONT = '"Galmuri11", "Malgun Gothic", monospace'; // UI 폰트(버튼·명찰 등 동일 스택)

// 표시 규격 (캐릭터 96 → 144, 약 1.5배)
const CAT_DH = 144;               // 고양이 표시 크기(정사각, origin 하단중심)
const SEEKER_SCALE = 1.25;        // 술래는 숨는이보다 조금 큼
const DRAW_REGION = 84;           // 위장 그림(=그리기 격자) 크기 — 캐릭터 몸통 크기에 맞춤
const REGION_CY = 63;             // 그림 영역 중심 높이(발에서 위로) — 고양이/캔버스 몸통 위치
const SEEKER_REGION = 70;         // 술래 꾸미기 영역 폭
const SEEKER_REGION_H = 118;      // 술래 꾸미기 영역 높이(세로로 길게)
const SEEKER_REGION_CY = 71;      // 술래 꾸미기 영역 중심(몸통보다 살짝 위 — 상의)
const SHADOW_W = 81, SHADOW_H = 30;
const VIS_OFFY = 66;              // 시야/카메라 원점 높이(발 → 몸통 중앙)
const DRAW_ZOOM = 4;             // 그리기 모드 카메라 줌(작은 영역을 크게 보이게)
// 스프라이트 프레임 여백 보정: 실제 그림은 32px 중 y[10..27]만 차지
// anchor(발 기준점)에서 위로 — 실제 머리/발 위치 (CAT_DH/32 = 4.5 배율)
const HEAD_OFF = Math.round(CAT_DH * (32 - 10) / 32); // 머리 꼭대기 ≈ 99
const FEET_OFF = Math.round(CAT_DH * (32 - 27) / 32); // 실제 발바닥 ≈ 23

// 뎁스 밴드 (배경 < 그림자 < 링 < 몸체/오브젝트(y) < 안개 < 이모티콘 < 그리기오버레이)
const DEPTH_BG = -1000;
const DEPTH_SHADOW = -5;
const DEPTH_RING = -4;
const DEPTH_FOG = 5000;
const DEPTH_EMOJI = 6000;
const DEPTH_DRAW = 7000;

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  preload() {
    const F = { frameWidth: 32, frameHeight: 32 };
    // 술래: SEEKER 폴더 (걸음 = 6_seekermoving)
    const S = 'character/SEEKER/';
    this.load.spritesheet('seeker_idle', S + '1_Cat_Idle-Sheet.png', F);
    this.load.spritesheet('seeker_run', S + '6_Cat_seekermoving-Sheet.png', F);
    this.load.spritesheet('seeker_jump', S + '3_Cat_Jump-Sheet.png', F);
    this.load.spritesheet('seeker_fall', S + '4_Cat_Fall-Sheet.png', F);
    this.load.spritesheet('seeker_canvas', S + '5_Cat_Canvas-Sheet.png', F);
    // 술래 총 오버레이(32×32 단일 프레임): idle / 이동 / 발사 포즈
    this.load.image('gun_idle', S + 'gun_idle.png');
    this.load.image('gun_moving', S + 'gun_moving.png');
    this.load.image('gun_shot', S + '7_Cat_gun_shot.png');
    // SproutLands 타일맵 에셋(맵 대개편)
    const SL = 'map/SproutLands/';
    this.load.image('ts_grass', SL + 'Tilesets/Grass.png');
    this.load.image('ts_water', SL + 'Tilesets/Water.png');
    this.load.image('ts_dirt',  SL + 'Tilesets/Tilled_Dirt_v2.png');
    this.load.image('obj_biom', SL + 'Objects/Basic_Grass_Biom_things.png');
    this.load.image('obj_coop', SL + 'Objects/Free_Chicken_House.png');   // 닭장(오두막)
    this.load.image('obj_bridge', SL + 'Objects/Wood_Bridge.png');        // 나무 다리
    this.load.image('obj_chest', SL + 'Objects/Chest.png');               // 보물상자
    this.load.image('zone_seeker', 'map/seeker.png');                     // 술래 지원 구역 발판
    this.load.spritesheet('ts_fence', SL + 'Tilesets/Fences.png', { frameWidth: 16, frameHeight: 16 });
    // 커스텀 마우스 커서(크로스헤어/cursor)는 DOM(#game-cursor)으로 렌더 → Phaser 텍스처 불필요
    // 숨는이: HIDER/<색> 3종(gray/lemon/orange), 구조 동일
    HIDER_SETS.forEach((c) => {
      const H = 'character/HIDER/' + c + '/';
      this.load.spritesheet(c + '_idle', H + '1_Cat_Idle-Sheet.png', F);
      this.load.spritesheet(c + '_run', H + '2_Cat_Run-Sheet.png', F);
      this.load.spritesheet(c + '_jump', H + '3_Cat_Jump-Sheet.png', F);
      this.load.spritesheet(c + '_fall', H + '4_Cat_Fall-Sheet.png', F);
      this.load.spritesheet(c + '_canvas', H + '5_Cat_Canvas-Sheet.png', F);
      this.load.image(c + '_dead', H + '6_Cat_dead.png'); // 잡혔을 때 시체
    });
  }

  create() {
    this.world = { width: 6688, height: 5440 }; // 군도(위) + 로비 방(아래), 타일 64px × 105×85
    this.players = new Map();
    this.props = [];
    this.myId = null;
    this.myRole = null;
    this._hideTags = false;   // 숨는이 H 토글: 모든 명찰/그림자 숨김(본인 시야)
    this.facingAngle = 0;
    this.lastSent = 0;
    this.audioCtx = null;
    // 캔버스 상태:
    //   'closed'  : 평소(이동 가능, 캔버스 안 듦)
    //   'opening' : 캔버스 꺼내는 애니(이동 불가, 전환)
    //   'holding' : 캔버스 들고 멈춤(이동 불가, 위장 그림 표시) ← 마지막 프레임 고정
    //   'drawing' : 캔버스에 그리는 편집 모드(줌인)
    //   'closing' : 캔버스 집어넣는 애니(이동 불가, 전환)
    // opening/closing(애니 재생) 중에는 키 입력이 막혀 연타 불가
    this.drawState = 'closed';
    this.openIntent = 'hold'; // 캔버스 꺼낼 때 의도: 'hold'(들고만) | 'draw'(편집)
    // 사격/잡힘 상태
    this._gunCdUntil = 0;
    this._slowUntil = 0;
    this.caught = false;
    this.gameEnded = false;

    this._makeAnims();
    this._makePropTextures(); // 이펙트 파티클(fx-dot) 등 텍스처 생성
    this._ensureUiFont();      // Galmuri11 웹폰트 로드 후 명찰/host 표기 다시 그림
    // SproutLands 타일맵으로 맵 생성 + 충돌 박스 수집(나무/물/덤불/울타리)
    this.map = new MapBuilder(this);
    this.obstacles = this.map.build(this.world);

    this.cameras.main.setBounds(0, 0, this.world.width, this.world.height);
    this.cameraTarget = this.add.zone(this.world.width / 2, this.world.height / 2, 1, 1);
    this.cameras.main.startFollow(this.cameraTarget, true, 0.18, 0.18);

    this.keys = this.input.keyboard.addKeys({
      w: 'W', a: 'A', s: 'S', d: 'D',
      q: 'Q', e: 'E', r: 'R', t: 'T', space: 'SPACE',
      z: 'Z', x: 'X',                 // 그리기 되돌리기/다시
      esc: 'ESC',                     // 그리기 취소
      openBracket: 'OPEN_BRACKET',    // [ 브러시 작게
      closeBracket: 'CLOSED_BRACKET', // ] 브러시 크게
      v: 'V', b: 'B',                 // V 마이크 ON/OFF · B 음성채팅 참여
      h: 'H',                         // H 명찰/그림자 숨김 토글(숨는이)
      volDown: 'MINUS', volUp: 'PLUS', // − / = 음성 볼륨 조절
    }, false); // capture 끔 → 채팅 입력창에 글자가 정상 입력되도록

    // 오디오는 사용자 제스처가 있어야 시작됨 → 첫 입력에 깨워 숨는이도 총소리/휘파람을 듣게
    const unlockAudio = () => this._ensureAudio();
    this.input.once('pointerdown', unlockAudio);
    this.input.keyboard.once('keydown', unlockAudio);

    this._setupChat();

    // 우클릭(지우개) 시 브라우저 메뉴 방지
    this.input.mouse.disableContextMenu();

    // [2단계] 캐릭터 위 페인팅: 도구막대 + 포인터 입력
    this.board = new DrawingBoard({
      onApply: () => this._applyAndHold(),
      onClose: () => this._cancelToHold(),
    });
    this.drawGfx = this.add.graphics().setDepth(DEPTH_DRAW).setVisible(false);
    // 재장전 바(로컬 술래 발밑) — 발사 쿨다운 진행 표시
    this.reloadGfx = this.add.graphics().setDepth(DEPTH_EMOJI - 2).setVisible(false);
    // 잡힌 사람의 남은 그림 테두리(위치 표시) — 매 프레임 다시 그림
    this.deadGfx = this.add.graphics().setDepth(DEPTH_FOG - 1);
    this._seekerReleaseAt = 0;
    this._phase = 'lobby';
    // 로비 술래 지원 구역(가운데) — seeker 발판 이미지(로비 단계에만 표시)
    // depth = 단상 위쪽 영역 안쪽 → 캐릭터가 단상 위쪽(뒤)에 서면 단상 윗부분이 발을 가림(2.5D)
    // 로비 공간에 항상 두어 게임 중에도 유지
    this.zoneImg = this.add.image(3400, 4416, 'zone_seeker').setScale(4).setDepth(4416 - 55);
    // 단상(점프로 올라가는 z 플랫폼): 이 위에 서면 술래 지원
    this._podium = { x: 3400, y: 4416, r: 138, r2: 138 * 138, h: 40 };
    // 커스텀 마우스 커서(DOM): 캔버스/UI/셰이더 위에 항상 표시 + 마우스를 따라다님
    this._setupCursor();

    this._lastCell = null;      // 빠르게 움직일 때 점 끊김 방지용(직전 칠한 셀)
    this._lastPaintCell = null; // Shift+클릭 직선용 앵커(마지막으로 실제 칠한 칸)
    this._strokeDirty = false;  // 이번 스트로크에서 실제로 칠했는지
    this._eyedropMode = false;  // 스포이드 버튼 모드
    this.input.on('pointerdown', (ptr) => {
      if (this.chatOpen) { this.chatInput.blur(); return; } // 게임(캔버스) 클릭 시 채팅 해제
      if (!this.board.isOpen()) {
        // 그리는 중이 아닐 때
        if (ptr.leftButtonDown() && !this.caught && !this.gameEnded && this.drawState === 'closed') {
          this._playPointerClick();                 // 좌클릭 시 커스텀 포인터 클릭 애니(술래/숨는이 공통)
          if (this.myRole === 'seeker') this._shoot(); // 술래는 추가로 사격
        }
        return;
      }
      if (this._eyedropMode) { this._eyedropper(); this._setEyedrop(false); return; } // 클릭=색 추출
      // Shift+클릭: 직전 점 → 클릭 점을 직선으로(포토샵 방식). 보간 시작점을 직전 앵커로 둔다.
      const shift = ptr.event && ptr.event.shiftKey;
      this._strokeDirty = false;
      this._strokeStart = null; // 이번 스트로크의 일자 고정 기준 초기화
      this._lastCell = (shift && this._lastPaintCell) ? { ...this._lastPaintCell } : null;
      this._paintPointer(ptr); // _lastCell 이 있으면 그 점부터 현재까지 직선 보간
    });
    this.input.on('pointermove', (ptr) => {
      if (this.board.isOpen() && !this._eyedropMode && ptr.isDown) this._paintPointer(ptr);
    });
    this.input.on('pointerup', () => {
      if (this.board.isOpen() && this._strokeDirty) this.board.pushHistory(); // 한 획 = 되돌리기 1단계
      this._strokeDirty = false;
      this._lastCell = null;
      this._strokeStart = null;
    });

    // 스포이드 버튼: 누르면 찍기 모드 토글, 캔버스 클릭하면 색 추출
    const pickBtn = document.getElementById('btn-pick');
    if (pickBtn) pickBtn.addEventListener('click', () => this._setEyedrop(!this._eyedropMode));

    // 안개(시야 제한) 제거 — 술래도 맵 전체를 봄. 대신 포스트 셰이더로 분위기 연출.
    this._setupPostFX();
    this._setupNetwork();  // [3단계]

    // 음성채팅 (V 마이크 / B 참여 / 호버 슬라이더 볼륨) — 소켓 생성 후 연결
    this.voice = new VoiceChat(this.socket, { onStatus: (s) => this._updateVoiceStatus(s) });
    this._setupVoiceUI();
    this._updateVoiceStatus({ joined: false });

    this.scale.on('resize', this._onResize, this);
  }

  // ===========================================================================
  // 애니메이션 / 텍스처 / 배경
  // ===========================================================================
  _makeAnims() {
    const A = this.anims;
    const mk = (key, end, fr, rep) => {
      if (!A.exists(key)) A.create({ key, frames: A.generateFrameNumbers(key, { start: 0, end }), frameRate: fr, repeat: rep });
    };
    // 술래 세트 (run = seekermoving 8프레임)
    mk('seeker_idle', 7, 8, -1);
    mk('seeker_run', 7, 14, -1);
    mk('seeker_jump', 3, 12, 0);
    mk('seeker_fall', 3, 12, 0);
    mk('seeker_canvas', 3, 9, 0);
    // 숨는이 색 세트 (run = 2_Run 10프레임)
    HIDER_SETS.forEach((c) => {
      mk(c + '_idle', 7, 8, -1);
      mk(c + '_run', 9, 16, -1);
      mk(c + '_jump', 3, 12, 0);
      mk(c + '_fall', 3, 12, 0);
      mk(c + '_canvas', 3, 9, 0);
    });
  }

  _makePropTextures() {
    if (!this.textures.exists('fx-dot')) { // 이펙트 파티클(작은 원)
      const g = this.make.graphics({ add: false });
      g.fillStyle(0xffffff, 1); g.fillCircle(6, 6, 6);
      g.generateTexture('fx-dot', 12, 12); g.destroy();
    }
    if (!this.textures.exists('propPillar')) {
      const g = this.make.graphics({ add: false });
      g.fillStyle(0x5a6273, 1); g.fillRect(8, 8, 24, 84);
      g.fillStyle(0x474e5d, 1); g.fillRect(8, 8, 8, 84);
      g.fillStyle(0x6e7689, 1); g.fillRect(26, 8, 6, 84);
      g.fillStyle(0x3c424f, 1); g.fillRect(4, 84, 32, 11); g.fillRect(4, 2, 32, 10);
      g.lineStyle(2, 0x262b34, 1); g.strokeRect(8, 8, 24, 84);
      g.generateTexture('propPillar', 40, 96); g.destroy();
    }
    if (!this.textures.exists('propCrate')) {
      const g = this.make.graphics({ add: false });
      g.fillStyle(0x9c6b3f, 1); g.fillRoundedRect(2, 2, 44, 40, 4);
      g.fillStyle(0x7d5430, 1); g.fillRect(2, 20, 44, 4); g.fillRect(22, 2, 4, 40);
      g.lineStyle(2, 0x3a2a1a, 1); g.strokeRoundedRect(2, 2, 44, 40, 4);
      g.generateTexture('propCrate', 48, 44); g.destroy();
    }
    if (!this.textures.exists('propPlant')) {
      const g = this.make.graphics({ add: false });
      g.fillStyle(0xb5703a, 1); g.fillRect(10, 40, 20, 14);
      g.fillStyle(0x8c5530, 1); g.fillRect(8, 38, 24, 6);
      g.fillStyle(0x2f8a47, 1); g.fillCircle(20, 26, 14); g.fillCircle(11, 30, 9); g.fillCircle(29, 30, 9);
      g.fillStyle(0x43b061, 1); g.fillCircle(19, 21, 8);
      g.generateTexture('propPlant', 40, 56); g.destroy();
    }
  }

  // Phaser 캔버스 텍스트는 생성 시점의 폰트로 한 번 구워진다. 웹폰트(Galmuri11)가
  // 늦게 로드되면 명찰이 폴백 폰트로 남으므로, 로드 완료 후 기존 명찰/host 표기를 다시 그린다.
  _ensureUiFont() {
    try {
      if (!document.fonts || !document.fonts.load) return;
      document.fonts.load('16px "Galmuri11"').then(() => {
        this.players.forEach((p) => {
          if (p.label) p.label.updateText();
          if (p.hostTag) p.hostTag.updateText();
        });
      }).catch(() => { /* 폰트 로드 실패 시 폴백 폰트 유지 */ });
    } catch (e) { /* document.fonts 미지원 환경: 폴백 유지 */ }
  }

  // 술래 추격 대기: 시작 후 대기 시간 동안 로비에 머물다, 끝나면 게임 맵으로 텔레포트
  _applyLobby(me) {
    const wo = document.getElementById('wait-overlay');
    // 술래·숨는이 모두 추격 시작 카운트다운을 봄(숨는이도 술래 등장 시점을 알도록)
    const waiting = me && this._phase === 'playing' && this._seekerReleaseAt && Date.now() < this._seekerReleaseAt;
    if (waiting) {
      if (wo) {
        const sec = Math.max(0, Math.ceil((this._seekerReleaseAt - Date.now()) / 1000));
        wo.textContent = this.myRole === 'seeker'
          ? `🔒 추격 시작까지 ${sec}초`
          : `👁 술래 등장까지 ${sec}초`;
        wo.classList.remove('hidden');
      }
    } else {
      if (wo && !wo.classList.contains('hidden')) wo.classList.add('hidden');
      // 대기 끝났는데 아직 로비(아래 영역)면 게임 맵으로 이동(1회)
      if (me && this.myRole === 'seeker' && this._phase === 'playing' && this._seekerReleaseAt && me.y > 3900) {
        this._teleportToGame();
        this._seekerReleaseAt = 0;
      }
    }
  }

  // 강제 휘파람까지 남은 시간 표시(숨는이 · 휘파람 모드일 때만)
  _applyWhistleTimer() {
    const el = document.getElementById('whistle-timer');
    if (!el) return;
    const show = this._phase === 'playing' && this._mode !== 'infection' && !this.gameEnded
      && this.myRole === 'hider' && !this.caught && this._nextWhistleAt;
    if (show) {
      const sec = Math.max(0, Math.ceil((this._nextWhistleAt - Date.now()) / 1000));
      el.textContent = `🎵 휘파람까지 ${sec}초`;
      el.classList.remove('hidden');
    } else if (!el.classList.contains('hidden')) {
      el.classList.add('hidden');
    }
  }

  // 탐색 시간 / 정답 공개 카운트다운(모두 공용, 추격 카운트와 같은 위치)
  _applyRoundTimer() {
    const el = document.getElementById('round-timer');
    if (!el) return;
    let text = null;
    if (this._phase === 'starting' && this._startCountAt) {
      const s = Math.max(0, Math.ceil((this._startCountAt - Date.now()) / 1000));
      text = `게임 시작까지 ${s}초`;
    } else if (this._phase === 'playing' && this._hiderEndAt && !this.gameEnded) {
      // 추격 시작 후에만 탐색 카운트(대기 중엔 wait-overlay 가 카운트)
      const chasing = !this._seekerReleaseAt || Date.now() >= this._seekerReleaseAt;
      if (chasing) {
        const s = Math.max(0, Math.ceil((this._hiderEndAt - Date.now()) / 1000));
        text = `🔍 탐색 종료까지 ${s}초`;
      }
    }
    if (text) { el.textContent = text; el.classList.remove('hidden'); }
    else if (!el.classList.contains('hidden')) el.classList.add('hidden');
  }

  // 정답 공개: 살아남은 숨는이를 유령(흑백 반투명)으로 노출하고, 위치 네비게이션 마커 생성
  _startReveal(hiders) {
    hiders.forEach((h) => {
      const p = this.players.get(h.id);
      // 잡힘과 동일하게: 그 자리에 시체+그림을 남기고(전시) 본인은 유령으로 공개(revealed → 술래에게도 보임)
      if (p) {
        this._spawnCorpse(p);
        p.caught = true; p.ghost = true; p.revealed = true;
      }
      if (h.id === this.myId) {
        this.caught = true;
        this.ghost = true; // 정답 공개 유령도 이동 가능
        this._resetCanvasState();
        const badge = document.getElementById('role-badge');
        if (badge) {
          badge.textContent = '🏁 라운드 종료 — 위치 공개';
          badge.removeAttribute('data-tip');
          badge.className = '';
        }
      }
    });
    this._clearRevealNav();
    // 본인 외 살아남은 숨는이마다 화살표 + 닉네임
    this._revealTargets = hiders.filter((h) => h.id !== this.myId).map((h) => this._makeNavMarker(h));
    // 정답 공개와 동시에 숨는이 승리 메시지 표시(이미 승패 확정)
    this._showWinMessage('hider');
    // 술래 승과 동일하게, 승리 메시지 아래에 로비 복귀 카운트(정답 공개 시간이 카운트다운됨)
    if (!this._gameOverSub) {
      const cam = this.cameras.main;
      this._gameOverSub = this.add.text(cam.width / 2, cam.height * 0.66 + 62, '', {
        fontFamily: UI_FONT, fontSize: '18px', fontStyle: 'bold',
        color: '#e7e9ee', stroke: '#101218', strokeThickness: 5, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(99999);
    }
  }

  _makeNavMarker(h) {
    const arrow = this.add.triangle(0, 0, 8, 0, 0, 16, 16, 16, 0xffd83b)
      .setScrollFactor(0).setDepth(99990).setOrigin(0.5, 0.5);
    const label = this.add.text(0, 0, h.name, {
      fontFamily: UI_FONT, fontSize: '14px', fontStyle: 'bold', color: '#ffd83b',
      backgroundColor: 'rgba(0,0,0,0.65)', padding: { x: 5, y: 2 },
    }).setScrollFactor(0).setDepth(99991).setOrigin(0.5, 0.5);
    return { id: h.id, x: h.x, y: h.y, arrow, label };
  }

  // 매 프레임 네비게이션 마커를 화면 위치(또는 가장자리 화살표)로 갱신
  _updateRevealNav() {
    if (this._phase !== 'reveal' || !this._revealTargets || !this._revealTargets.length) return;
    const cam = this.cameras.main;
    const wv = cam.worldView;
    const W = cam.width, H = cam.height;
    const cx = W / 2, cy = H / 2;
    // 화살표 위치: 화면끝(가장자리)과 술래(중앙)의 중간쯤 — 중앙에서 화면 절반의 절반 거리
    const reachX = cx * 0.5, reachY = cy * 0.5;
    const me = this.players.get(this.myId);
    const NEAR2 = 400 * 400; // 본인이 이만큼 가까이 오면 그 타겟 마커가 사라짐
    this._revealTargets.forEach((t) => {
      // 본인이 타겟 근처에 오면 마커 숨김
      if (me) {
        const ddx = t.x - me.x, ddy = t.y - me.y;
        if (ddx * ddx + ddy * ddy < NEAR2) { t.arrow.setVisible(false); t.label.setVisible(false); return; }
      }
      // 근처 아니면 화면 안/밖 상관없이 항상 가장자리 화살표 + 닉네임(타겟 방향)
      const sx = (t.x - wv.x) / wv.width * W;
      const sy = (t.y - wv.y) / wv.height * H;
      const dx = sx - cx, dy = sy - cy;
      const ang = Math.atan2(dy, dx);
      const sc = Math.min(reachX / Math.max(Math.abs(dx), 0.001), reachY / Math.max(Math.abs(dy), 0.001));
      const mx = cx + dx * sc, my = cy + dy * sc;
      t.arrow.setPosition(mx, my).setRotation(ang + Math.PI / 2).setVisible(true);
      t.label.setPosition(mx, my - 20).setVisible(true);
    });
  }

  _clearRevealNav() {
    if (this._revealTargets) {
      this._revealTargets.forEach((t) => { t.arrow.destroy(); t.label.destroy(); });
    }
    this._revealTargets = null;
  }

  // 게임 맵(군도 중앙 리스폰존)으로 이동
  _teleportToGame() {
    const me = this.players.get(this.myId);
    if (!me) return;
    me.x = 3400 + (Math.random() - 0.5) * 200;
    me.y = 2640 + (Math.random() - 0.5) * 120;
    me._kbx = 0; me._kby = 0;
  }

  // 이동 충돌: 발밑(x,y)이 물(섬 밖)이거나 나무/덤불 밑동에 닿으면 true
  _hitObstacle(x, y) {
    const map = this.map;
    // 섬 밖(물)이면 막기 — land 마스크 기반
    if (map && map.landMask) {
      const t = map.tile, m = map.landMask;
      const tx = Math.floor(x / t), ty = Math.floor(y / t);
      if (ty < 0 || ty >= m.length || tx < 0 || tx >= m[0].length || !m[ty][tx]) return true;
    }
    // 나무/덤불 밑동 박스
    const r = 9, list = this.obstacles;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r) return true;
      }
    }
    return false;
  }

  // ===========================================================================
  // [4단계] 시야 시스템
  // ===========================================================================
  // 포스트 셰이더(ChronosOverload 스타일): Vignette + Bloom(내장) + Chromatic Aberration(커스텀)
  _setupPostFX() {
    const cam = this.cameras.main;
    if (!cam || !cam.postFX) return; // WebGL 아니면 건너뜀(캔버스 폴백)
    this._chromaBase = 0.01;     // 평소 거의 안 보일 만큼 약한 색수차
    this._vignetteStrength = 0.7; // 평소 비네팅 강도
    // Bloom 은 매 프레임 풀스크린 다중 블러라 렉 → 제거. 비네팅은 진하게(가벼움).
    this._vignette = cam.postFX.addVignette(0.5, 0.5, 0.8, this._vignetteStrength);
    cam.setPostPipeline(ChromaticAberrationPostFX);  // 색수차(커스텀, 단일 패스 → 가벼움)
    const ca = cam.getPostPipeline(ChromaticAberrationPostFX);
    this.chroma = Array.isArray(ca) ? ca[0] : ca;
    if (this.chroma) this.chroma.intensity = this._chromaBase;
    this._fxDrawing = false;
  }

  // 순간 색수차 펄스(발사/피격 등) → 기본값으로 부드럽게 복귀
  _pulseChroma(v) {
    if (!this.chroma) return;
    this.tweens.killTweensOf(this.chroma);
    this.chroma.intensity = v;
    this.tweens.add({ targets: this.chroma, intensity: this._chromaBase, duration: 280, ease: 'Quad.easeOut' });
  }

  _setupVision() {
    const W = this.scale.gameSize.width;
    const H = this.scale.gameSize.height;
    this._makeLightTextures(); // 가장자리가 흐린 빛 텍스처(부채꼴/근접 원)
    this.fog = this.add.renderTexture(0, 0, W, H)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_FOG).setVisible(false);
    // 안개에서 지워낼(밝힐) 빛 이미지 — 그라데이션이라 경계가 부드럽다
    this.coneLight = this.make.image({ key: 'lightCone', add: false }).setOrigin(this._coneOriginX, 0.5);
    this.nearLight = this.make.image({ key: 'lightNear', add: false }).setOrigin(0.5, 0.5);
  }

  // 캔버스로 가장자리가 흐린(블러+그라데이션) 빛 텍스처 생성
  _makeLightTextures() {
    const pad = 48;
    // 부채꼴 빛: 꼭짓점이 왼쪽-중앙, +x 방향으로 펼쳐짐
    const R = CONE_R;
    const w = R + pad * 2;
    const h = R * 2 + pad * 2;
    const ax = pad, ay = h / 2;
    this._coneOriginX = ax / w; // 이미지 원점을 꼭짓점에 맞춤
    if (!this.textures.exists('lightCone')) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.filter = `blur(${Math.round(R * 0.05)}px)`; // 경계 흐리게
      const grad = ctx.createRadialGradient(ax, ay, R * 0.12, ax, ay, R);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.96)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.arc(ax, ay, R, -CONE_HALF, CONE_HALF);
      ctx.closePath();
      ctx.fill();
      this.textures.addCanvas('lightCone', c);
    }
    // 근접 원 빛(발밑 항상 밝힘)
    if (!this.textures.exists('lightNear')) {
      const r = NEAR_R + 24;
      const d = r * 2;
      const c = document.createElement('canvas');
      c.width = d; c.height = d;
      const ctx = c.getContext('2d');
      const grad = ctx.createRadialGradient(r, r, r * 0.45, r, r, r);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.7, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, d, d);
      this.textures.addCanvas('lightNear', c);
    }
  }

  _onResize(gameSize) {
    if (this.fog && gameSize.width > 0 && gameSize.height > 0) {
      this.fog.resize(gameSize.width, gameSize.height);
    }
  }

  _updateVision(local) {
    const cam = this.cameras.main;
    const sx = local.x - cam.scrollX;
    const sy = local.y - VIS_OFFY * local.scale - cam.scrollY;

    // 가장자리가 흐린 빛 이미지를 안개에서 지워낸다(부드러운 경계)
    this.coneLight.setPosition(sx, sy).setRotation(this.facingAngle);
    this.nearLight.setPosition(sx, sy);

    this.fog.clear();
    this.fog.fill(0x05060a, 0.99);
    this.fog.erase(this.coneLight);
    this.fog.erase(this.nearLight);

    // 부채꼴 밖이라도 플레이어를 숨기지 않는다 → 안개 어둠만으로 가림
    // (가까이 가면 나타나고 멀어지면 사라지는 '깜빡임 단서'를 없애 더 어렵게)
    // 술래는 남의 명찰/그림자는 안 보이게 한다.
    this.players.forEach((p, id) => {
      if (id === this.myId || p.caught) return; // 시체는 렌더 루프가 처리
      p.shadow.setVisible(false);
      p.label.setVisible(false);
    });
  }

  // ===========================================================================
  // [2단계] 캐릭터 위 그리기
  // ===========================================================================
  // E(꺼내기): 고양이가 캔버스 꺼내는 애니 → 끝나면 holding(들고 멈춤) 또는 drawing(편집)
  _takeOut(intent) {
    const me = this.players.get(this.myId);
    if (!me || this.drawState !== 'closed') return;
    this.openIntent = intent;
    this.drawState = 'opening';
    me.z = 0; me.zVel = 0; // 점프 중 진입해도 바닥에서

    me.currentAnim = 'canvas';
    me.body.play(me.set + '_canvas');
    me.body.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.drawState !== 'opening') return;
      if (this.openIntent === 'draw') this._openEditor();
      else this.drawState = 'holding'; // 마지막 프레임 고정(멈춤)
    });
  }

  // E(집어넣기): 캔버스 집어넣는 애니(역재생) → 끝나면 이동 가능
  _putAway() {
    const me = this.players.get(this.myId);
    if (!me || this.drawState !== 'holding') return;
    this.drawState = 'closing';
    me.currentAnim = 'canvas';
    me.body.playReverse(me.set + '_canvas');
    me.body.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.drawState !== 'closing') return;
      this.drawState = 'closed';
      me.currentAnim = null; // 다음 프레임에 이동 애니로 복귀
    });
  }

  // Q(그리기): 줌인 편집 모드. 숨는이는 holding에서, 술래는 closed에서 바로 진입.
  _openEditor() {
    const me = this.players.get(this.myId);
    if (!me) return;
    if (this.myRole === 'seeker') {
      me.z = 0; me.zVel = 0;            // 점프 중 진입해도 바닥에서
      me.currentAnim = 'idle';      // 꾸미는 동안 차분한 기본 포즈(캐릭터 위에 그림)
      me.body.play(me.set + '_idle');
    }
    this.drawState = 'drawing';
    this._lastPaintCell = null; // 새 편집 세션 → 직선 앵커 초기화
    // 영역 비율에 맞춰 격자 칸수 설정 → 칸이 정사각(폭 32칸 기준, 높이는 비율만큼)
    const cols = 32;
    const rows = Math.max(8, Math.round(cols * me.regionH / me.regionW));
    this.board.setGrid(cols, rows);
    this.cameras.main.zoomTo(DRAW_ZOOM, 220);
    this.board.show();
    this.board.loadFromDataURL(me.skinDataURL || null); // 기존 그림 불러와 편집/지우기
    this.drawGfx.setVisible(true);
  }

  // 편집 종료 공통: 줌아웃 후 — 숨는이는 holding(캔버스 든 상태), 술래는 closed(코스튬 항상 표시)
  _exitEditor() {
    this._setEyedrop(false); // 스포이드 모드 해제
    this.board.hide();
    this.drawGfx.setVisible(false).clear();
    this.cameras.main.zoomTo(1, 220);
    if (this.myRole === 'seeker') {
      this.drawState = 'closed';
      const me = this.players.get(this.myId);
      if (me) me.currentAnim = null; // 다음 프레임에 이동 애니로 복귀
    } else {
      this.drawState = 'holding';
    }
  }

  // 적용(Q/적용버튼): 그림 반영 후 holding 으로
  _applyAndHold() {
    if (this.drawState !== 'drawing') return;
    const dataURL = this.board.hasAnyPaint() ? this.board.toDataURL() : null;
    this.applyDrawing(this.myId, dataURL);
    if (this.socket) this.socket.emit('draw', { dataURL });
    this._exitEditor();
  }

  // 취소(닫기버튼): 적용 없이 holding 으로
  _cancelToHold() {
    if (this.drawState !== 'drawing') return;
    this._exitEditor();
  }

  // 그림 영역(폭 w × 높이 h), 중심 (x, y - regionCY). 32x32 격자 → cellW/cellH
  _drawRegion(me) {
    const s = me.scale || 1;
    const w = me.regionW * s;
    const h = me.regionH * s;
    const left = me.x - w / 2;
    const top = me.y - me.regionCY * s - h / 2;
    return { left, top, w, h, cellW: w / this.board.cols, cellH: h / this.board.rows };
  }

  // 포인터 → 셀. 그림 영역 밖이면 무시 → "캐릭터 위에만" 칠해짐
  // 직전 셀과 현재 셀 사이를 보간해서, 빠르게 움직여도 끊기지 않고 선으로 이어 칠한다.
  _paintPointer(ptr) {
    const me = this.players.get(this.myId);
    if (!me) return;
    const { left, top, cellW, cellH } = this._drawRegion(me);
    let cx = Math.floor((ptr.worldX - left) / cellW);
    let cy = Math.floor((ptr.worldY - top) / cellH);
    const erase = ptr.rightButtonDown();

    if (!this._strokeStart) this._strokeStart = { cx, cy }; // 스트로크 시작점(일자 고정 기준)
    // Shift 누르고 있으면 시작점 기준 수평/수직(일자)으로 고정
    if (ptr.event && ptr.event.shiftKey) {
      if (Math.abs(cx - this._strokeStart.cx) >= Math.abs(cy - this._strokeStart.cy)) cy = this._strokeStart.cy;
      else cx = this._strokeStart.cx;
    }

    const prev = this._lastCell;
    if (prev && (prev.cx !== cx || prev.cy !== cy)) {
      const dx = cx - prev.cx;
      const dy = cy - prev.cy;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let i = 1; i <= steps; i++) {
        this._paintCell(Math.round(prev.cx + (dx * i) / steps), Math.round(prev.cy + (dy * i) / steps), erase);
      }
    } else {
      this._paintCell(cx, cy, erase);
    }
    this._lastCell = { cx, cy }; // 영역 밖이어도 추적(다음 보간 연속성)
  }

  _paintCell(cx, cy, erase) {
    if (cx < 0 || cy < 0 || cx >= this.board.cols || cy >= this.board.rows) return;
    this.board.paint(cx, cy, erase);
    this._strokeDirty = true;
    this._lastPaintCell = { cx, cy }; // 직선(Shift) 앵커 — 스트로크 넘어도 유지
  }

  // ===========================================================================
  // 커스텀 마우스 커서(DOM) 초기화: 마우스를 따라다니게 위치 갱신
  _setupCursor() {
    this._cursorEl = document.getElementById('game-cursor');
    this._rangeEl = document.getElementById('game-cursor-range');  // 사거리 끝 마커
    this._cursorShown = false;
    this._rangeShown = false;
    this._cursorAnimTimer = null;
    this._rangeAnimTimer = null;
    this._cursorOut = false;  // 술래 사거리 밖 여부 — 밖이면 crosshairs2.png 사용
    if (!this._cursorEl) return;
    this._onCursorMove = (e) => {
      this._cursorEl.style.left = e.clientX + 'px';
      this._cursorEl.style.top = e.clientY + 'px';
    };
    window.addEventListener('mousemove', this._onCursorMove);
  }

  // 역할별 커서 이미지: 술래=크로스헤어 / 숨는이=cursor
  // 두 시트 모두 hotspot(조준점·화살표 끝)이 프레임 중앙(7,7)이라 정렬은 -50%,-50% 로 동일
  _applyCursorRole(role) {
    const el = this._cursorEl;
    if (!el) return;
    const seeker = role === 'seeker';
    el.style.backgroundImage = `url('ui/${seeker ? 'crosshairs' : 'cursor'}.png')`;
    el.style.transform = 'translate(-50%, -50%)';
    el.style.backgroundPosition = '0 0';
    this._cursorOut = false;
  }

  // 커서 클릭 애니(좌클릭 시 무조건): 프레임 2→3→4 재생 후 1(0번)로 복귀, frameRate 11(절반)
  //  메인 커서 + (사거리 밖이면) 사거리 끝 마커 둘 다 재생
  _playPointerClick() {
    this._animCursorEl(this._cursorEl, '_cursorAnimTimer');
    if (this._rangeShown) this._animCursorEl(this._rangeEl, '_rangeAnimTimer');
  }

  // 단일 커서 DOM 에 클릭 애니 재생(background-position 프레임 전환)
  _animCursorEl(el, timerKey) {
    if (!el) return;
    if (this[timerKey]) { clearInterval(this[timerKey]); this[timerKey] = null; }
    const seq = [1, 2, 3, 0];   // 2,3,4 번 프레임 → 1번(0) 복귀
    const frameMs = 1000 / 11;
    let i = 0;
    const step = () => {
      el.style.backgroundPosition = (-60 * seq[i]) + 'px 0';
      i += 1;
      if (i >= seq.length) { clearInterval(this[timerKey]); this[timerKey] = null; }
    };
    step();
    this[timerKey] = window.setInterval(step, frameMs);
  }

  // 사격(술래) — 마우스 방향으로 발사, 시야 안 숨는이에 맞으면 잡음
  // ===========================================================================
  _shoot() {
    const me = this.players.get(this.myId);
    if (!me) return;
    if (this._phase !== 'playing') return;                                   // 로비 중엔 발사 불가
    if (this._seekerReleaseAt && Date.now() < this._seekerReleaseAt) return; // 대기 중엔 발사 불가
    const now = this.time.now;
    if (now < this._gunCdUntil) return;

    const off = me.z || 0;                        // 점프 높이(스프라이트가 위로 솟은 만큼)
    const ox = me.x;
    const oy = me.y - VIS_OFFY * me.scale - off;  // 조준 원점(점프 중엔 그만큼 위)
    const ptr = this.input.activePointer;
    const aimX = ptr.worldX, aimY = ptr.worldY;       // 목적지(커서)
    const aimDist = Math.hypot(aimX - ox, aimY - oy) || 1;

    // 목적지(커서) 근처에 있는 숨는이만 명중 (지나가는 길의 다른 사람은 안 맞음) + 사거리 내
    let hit = null, best = Infinity;
    this.players.forEach((p, id) => {
      if (id === this.myId || p.role !== 'hider' || p.caught) return;
      const cx = p.x, cy = p.y - 61 * p.scale; // 숨는이 몸통 중심
      if (Math.hypot(cx - ox, cy - oy) > GUN_RANGE) return; // 사거리
      const d = Math.hypot(cx - aimX, cy - aimY);           // 커서와의 거리
      if (d <= HIT_RADIUS && d < best) { hit = p; best = d; }
    });

    // 사거리 내 목적지 좌표
    const len = Math.min(aimDist, GUN_RANGE);
    const ux = (aimX - ox) / aimDist, uy = (aimY - oy) / aimDist;
    // 총구 위치: 손 높이에서 조준 방향으로 앞쪽 + 바라보는 쪽으로 조금 더(x), 살짝 위로(y)
    const fx = me.facingLeft ? -1 : 1;
    const mx = ox + ux * (32 * me.scale) + fx * (10 * me.scale);
    const my = (me.y - 60 * me.scale - off) + uy * (32 * me.scale); // 총구쪽(점프 높이 반영)
    const destX = ox + ux * len, destY = oy + uy * len;
    this._drawTracer(mx, my, destX, destY);           // 총구 → 목적지 탄선(아주 옅게)
    this._impactEffect(destX, destY);                 // 목적지 임팩트(커서)
    this._muzzleFlash(mx, my, Math.atan2(uy, ux));    // 총구 플래시
    this._playShot();
    me.gunShotUntil = now + 280;                 // 발사 중: gun_moving + gun_shot 동시 표시
    if (me.gun) me.gun.setTexture('gun_moving'); // 베이스 즉시 이동 포즈
    if (me.gunShot) me.gunShot.setVisible(true); // gun_shot 즉시(0ms) 동시 표시
    me.facingLeft = aimX < ox;                   // 쏘는 방향(커서)을 바라보게 좌우 전환
    me._kbx = -ux * SHOT_KNOCKBACK;              // 발사 반동: 뒤로 살짝 밀림
    me._kby = -uy * SHOT_KNOCKBACK;
    this._pulseChroma(0.09);                     // 발사 순간 색수차 펄스(크게)
    if (this.socket) this.socket.emit('shoot');  // 다른 클라이언트에도 발사 포즈 표시

    this._slowUntil = now + SLOW_MS; // 발사 후 아주 짧은 둔화(매 발)
    this._gunCdFrom = now;           // 재장전 바 진행도 계산용 시작 시각
    if (hit) {
      this._pendingKillName = this._nameOf(hit.id); // 점수 팝업용(처치 대상 닉네임)
      if (this.socket) this.socket.emit('catch', { targetId: hit.id });
      this._gunCdUntil = now + GUN_CD;
    } else {
      // 빗맞힘: 긴 쿨다운(둔화는 위에서 짧게 공통 적용)
      this._gunCdUntil = now + GUN_CD_MISS;
    }
  }

  // 총구 → 목적지(커서) 탄선. 아주 옅게만 깜빡이고 곧 사라짐.
  _drawTracer(x1, y1, x2, y2) {
    const line = this.add.graphics().setDepth(DEPTH_EMOJI + 1);
    line.lineStyle(6, 0xfff2a0, 0.15); // 옅게
    line.lineBetween(x1, y1, x2, y2);
    this.tweens.add({ targets: line, alpha: 0, duration: 200, onComplete: () => line.destroy() });
  }

  // 목표지점 임팩트(발사 시): 파티클 폭발
  _impactEffect(x, y) {
    const p = this.add.particles(x, y, 'fx-dot', {
      speed: { min: 80, max: 280 },
      scale: { start: 2, end: 0 },
      lifespan: 400, tint: [0xffffff, 0xffe066, 0xff7a5a], emitting: false,
    }).setDepth(DEPTH_EMOJI + 2);
    p.explode(14);
    this.time.delayedCall(480, () => p.destroy());
  }

  // 처치(kill) 이펙트: 별/반짝이 뿅 (귀엽게)
  _killEffect(x, y) {
    // 파스텔 파티클 뿅 (살짝 떨어지며)
    const p = this.add.particles(x, y, 'fx-dot', {
      speed: { min: 90, max: 240 },
      scale: { start: 2.6, end: 0 },
      lifespan: 600,
      gravityY: 320,
      tint: [0xffd1e8, 0xfff3a0, 0xb6f0d8, 0xc9b8ff, 0xa8e0ff],
      emitting: false,
    }).setDepth(DEPTH_EMOJI + 3);
    p.explode(18);
    this.time.delayedCall(700, () => p.destroy());
    // 가운데 별이 뽁 튀어나왔다 떠오르며 사라짐
    const star = this.add.text(x, y, '⭐', { fontSize: '36px', padding: { x: 6, y: 10 } })
      .setOrigin(0.5).setDepth(DEPTH_EMOJI + 4).setScale(0.3);
    this.tweens.add({
      targets: star, scale: 1.5, duration: 220, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({ targets: star, alpha: 0, y: y - 34, duration: 320, onComplete: () => star.destroy() }),
    });
    // 작은 반짝이 사방으로
    for (let i = 0; i < 5; i++) {
      const ang = (Math.PI * 2 * i) / 5 + 0.5;
      const s = this.add.text(x, y, '✨', { fontSize: '20px', padding: { x: 4, y: 6 } })
        .setOrigin(0.5).setDepth(DEPTH_EMOJI + 4);
      this.tweens.add({
        targets: s, x: x + Math.cos(ang) * 48, y: y + Math.sin(ang) * 48,
        alpha: 0, scale: 0.4, duration: 500, ease: 'Cubic.easeOut',
        onComplete: () => s.destroy(),
      });
    }
  }

  // 발사 이펙트: 총구 플래시 + 방향 파티클 (ChronosOverload 스타일)
  _muzzleFlash(x, y, angle) {
    const tint = 0xffe066;
    const flash = this.add.circle(x, y, 10, tint, 0.85).setDepth(DEPTH_EMOJI + 1);
    this.tweens.add({ targets: flash, alpha: 0, scale: 2.4, duration: 90, onComplete: () => flash.destroy() });
    const deg = Phaser.Math.RadToDeg(angle);
    const p = this.add.particles(x, y, 'fx-dot', {
      speed: { min: 140, max: 320 },
      angle: { min: deg - 18, max: deg + 18 },
      scale: { start: 1.3, end: 0 },
      lifespan: 200, tint, emitting: false,
    }).setDepth(DEPTH_EMOJI);
    p.explode(7);
    this.time.delayedCall(260, () => p.destroy());
  }

  _playShot(vol = 1) {
    this._ensureAudio();
    const ctx = this.audioCtx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const gg = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(680, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    const peak = Math.max(0.0008, 0.2 * vol); // 거리별 음량
    gg.gain.setValueAtTime(0.0001, t);
    gg.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(gg); gg.connect(ctx.destination);
    o.start(t); o.stop(t + 0.16);
  }

  // 잡힘 처리: 해당 숨는이를 화면에서 제거(관전 아웃)
  _onCaught(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.caught = true;
    p.ghost = true; // 유령(흑백 반투명·이동 가능). 시체는 corpseSpawn 이 별도로 전시
    this._killEffect(p.x, p.y - 61 * p.scale); // 처치 폭발(EFFECT 시트)
    this._pulseChroma(0.08); // 처치 순간 색수차 펄스
    if (id === this.myId) {
      this.caught = true;
      this.ghost = true;
      // 그리기 중이었으면 정리(줌/도구막대 닫기)
      this.board.hide();
      this.drawGfx.setVisible(false).clear();
      this._setEyedrop(false);
      this.cameras.main.zoomTo(1, 150);
      this.drawState = 'closed';
      const badge = document.getElementById('role-badge');
      if (badge) {
        badge.textContent = '👻 유령 — 관전 이동 가능';
        badge.removeAttribute('data-tip');
        badge.className = '';
      }
    }
  }

  // 게임 중 이탈: 마지막 위치에 문 이모지 + "닉네임 탈주"(회색) 마커를 남긴다(라운드 종료 시 정리)
  _spawnQuitMarker(p) {
    const emoji = this.add.text(p.x, p.y - 36, '🚪', { fontSize: '36px', padding: { x: 4, y: 8 } })
      .setOrigin(0.5).setDepth(p.y + 0.4);
    const label = this.add.text(p.x, p.y - 80, p.name + ' 탈주', {
      fontFamily: UI_FONT, fontSize: '14px', fontStyle: 'bold', color: '#9aa0ab',
      backgroundColor: 'rgba(0,0,0,0.5)', padding: { x: 5, y: 2 },
    }).setOrigin(0.5).setDepth(p.y + 0.5);
    this._quitMarkers = this._quitMarkers || [];
    this._quitMarkers.push(emoji, label);
  }

  // 감염모드: 잡힌 숨는이의 스냅샷(위치/그림)으로 고정된 시체 엔티티를 만든다.
  // 원본 플레이어는 곧 술래로 부활하므로, 시체는 시체대로 그 자리에 전시된다.
  _spawnCorpse(src) {
    this._corpseSeq = (this._corpseSeq || 0) + 1;
    const cid = '__corpse_' + this._corpseSeq;
    this._addPlayer({
      id: cid, role: 'hider', name: src.name, color: src.color,
      x: src.x, y: src.y, angle: src.angle, caught: true,
      dataURL: src.skinDataURL,
    });
    const c = this.players.get(cid);
    if (c) c.isCorpse = true; // 조준/네트워크 대상 아님(클라 전용 전시물)
  }

  // 진행 중인 방에 난입했을 때: 죽은 것처럼 관전 상태로 진입(처치 폭발 효과는 없이)
  _enterSpectator() {
    this.caught = true;
    const me = this.players.get(this.myId);
    if (me) me.caught = true;
    if (this.board) this.board.hide();
    if (this.drawGfx) this.drawGfx.setVisible(false).clear();
    this._setEyedrop(false);
    this.drawState = 'closed';
    if (this.cameras && this.cameras.main) this.cameras.main.zoomTo(1, 0);
    const badge = document.getElementById('role-badge');
    if (badge) {
      badge.textContent = '💀 관전 중 — 다음 판 대기';
      badge.removeAttribute('data-tip');
      badge.className = '';
    }
  }

  _onGameOver(winner, returnMs = 0) {
    if (this.gameEnded) return;
    this.gameEnded = true;
    this._clearRevealNav();
    this._returnAt = returnMs > 0 ? Date.now() + returnMs : 0;
    // 정답 공개(reveal) 단계에서 온 숨는이 승은 이미 메시지를 띄웠으므로 새로 만들지 않음.
    // 단, 술래 이탈처럼 reveal 없이 들어온 숨는이 승은 여기서 메시지를 띄운다.
    if (winner === 'hider' && this._phase === 'reveal') return;
    this._showWinMessage(winner);
    const cam = this.cameras.main;
    // 로비 복귀 안내 카운트 — 승리 메시지 아래
    this._gameOverSub = this.add.text(cam.width / 2, cam.height * 0.66 + 62, '', {
      fontFamily: UI_FONT, fontSize: '18px', fontStyle: 'bold',
      color: '#e7e9ee', stroke: '#101218', strokeThickness: 5, align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(99999);
  }

  // 화면 중앙 상단에 잠깐 뜨는 안내(인원 부족 등)
  _toast(msg) {
    if (this._toastEl) this._toastEl.destroy();
    const cam = this.cameras.main;
    this._toastEl = this.add.text(cam.width / 2, cam.height * 0.76, msg, {
      fontFamily: UI_FONT, fontSize: '20px', fontStyle: 'bold',
      color: '#ff6b6b', stroke: '#101218', strokeThickness: 6, align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(99999);
    const el = this._toastEl;
    this.time.delayedCall(2200, () => { if (el) el.destroy(); if (this._toastEl === el) this._toastEl = null; });
  }

  // 승리 메시지(중앙). 정답 공개 시작(숨는이 승) 또는 게임 종료(술래 승) 시 한 번만 생성
  _showWinMessage(winner) {
    if (this._gameOverText) return;
    const cam = this.cameras.main;
    const msg = winner === 'seeker' ? 'SEEKER 승리!' : 'HIDER 승리!';
    this._gameOverText = this.add.text(cam.width / 2, cam.height * 0.66, msg, {
      fontFamily: UI_FONT, fontSize: '40px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#101218', strokeThickness: 8,
      align: 'center', lineSpacing: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(99999);
  }

  // 종료 화면의 로비 복귀 카운트 갱신(매 프레임)
  _applyGameOverCountdown() {
    if (!this._gameOverSub) return;
    if (this._phase === 'reveal' && this._revealEndAt) {
      // 숨는이 승: 정답 공개 시간이 끝나면 로비로 복귀
      const s = Math.max(0, Math.ceil((this._revealEndAt - Date.now()) / 1000));
      this._gameOverSub.setText(s > 0 ? `정답 공개 · ${s}초 후 로비로 돌아갑니다` : '로비로 이동 중…');
    } else if (this._returnAt) {
      const s = Math.max(0, Math.ceil((this._returnAt - Date.now()) / 1000));
      this._gameOverSub.setText(s > 0 ? `${s}초 후 로비로 돌아갑니다` : '로비로 이동 중…');
    } else {
      this._gameOverSub.setText('곧 로비로 돌아갑니다…');
    }
  }

  // 라운드 종료 후 로비로 복귀: 화면/상태/역할/위치 초기화(서버 returnToLobby)
  _returnToLobby(players) {
    this._clearRevealNav();
    if (this._gameOverText) { this._gameOverText.destroy(); this._gameOverText = null; }
    if (this._gameOverSub) { this._gameOverSub.destroy(); this._gameOverSub = null; }
    this._returnAt = 0;
    ['wait-overlay', 'round-timer', 'whistle-timer'].forEach((id) => {
      const e = document.getElementById(id); if (e) e.classList.add('hidden');
    });
    this._phase = 'lobby';
    this.gameEnded = false;
    this.caught = false;
    this.ghost = false;
    this._seekerReleaseAt = 0; this._nextWhistleAt = 0; this._hiderEndAt = 0; this._revealEndAt = 0;
    // 감염 시체 등 클라 전용 잔여 엔티티 제거(다음 판에 남지 않도록)
    for (const [id, p] of [...this.players]) {
      if (p.isCorpse) {
        ['shadow', 'body', 'skin', 'label', 'gun', 'gunShot', 'hostTag', 'bubble'].forEach((k) => { if (p[k]) p[k].destroy(); });
        this.players.delete(id);
      }
    }
    // 탈주 마커 정리
    if (this._quitMarkers) { this._quitMarkers.forEach((m) => m.destroy()); this._quitMarkers = null; }
    // 모든 플레이어 역할/위치/잡힘 리셋(로비는 모두 숨는이)
    players.forEach((info) => {
      let p = this.players.get(info.id);
      if (!p) { this._addPlayer(info); return; }
      if (p.role !== info.role) { this._changeRole(info.id, info.role); p = this.players.get(info.id); }
      if (!p) return;
      p.caught = false;
      p.ghost = false;
      p.revealed = false;
      if (p.body) p.body.clearTint().setAlpha(1); // 유령 흑백/반투명 복구
      if (p.skin) p.skin.setAlpha(1);
      this.applyDrawing(info.id, null); // 판 끝나면 위장 그림 제거
      p.x = info.x; p.y = info.y;
      p.target.x = info.x; p.target.y = info.y;
      p.z = 0; p.zVel = 0;
    });
    if (this.board) this.board.loadFromDataURL(null); // 본인 캔버스 초기화
    this.myRole = 'hider';
    this._resetCanvasState();
    this._updateRoleBadge();
    this._buildHud();
    this._applyCursorRole('hider');
    this._updateStartButton();
    const me = this.players.get(this.myId);
    this.cameras.main.zoomTo(1, 0);
    if (me) this.cameras.main.centerOn(me.x, me.y);
  }

  // 스포이드 찍기 모드 on/off (버튼 강조 + 커서 변경)
  _setEyedrop(on) {
    this._eyedropMode = !!on;
    const btn = document.getElementById('btn-pick');
    if (btn) btn.classList.toggle('active', this._eyedropMode);
    this.input.setDefaultCursor(this._eyedropMode ? 'crosshair' : 'default');
  }

  // 스포이드(Space 또는 찍기 모드 클릭): 포인터 위치의 색을 현재 색으로
  // 그림 영역의 칠한 셀이면 정확한 색을, 그 외(맵·지형지물·다른 캐릭터)는 화면 픽셀을 추출
  _eyedropper() {
    const me = this.players.get(this.myId);
    if (!me) return;
    const cam = this.cameras.main;
    const ptr = this.input.activePointer;
    const { left, top, cellW, cellH } = this._drawRegion(me);
    const cx = Math.floor((ptr.worldX - left) / cellW);
    const cy = Math.floor((ptr.worldY - top) / cellH);
    const inGrid = cx >= 0 && cy >= 0 && cx < this.board.cols && cy < this.board.rows;

    // 1) 칠해진 칸 → 정확한 색 즉시
    if (inGrid && this.board.cells[cy][cx]) {
      this.board.pickColor(this.board.cells[cy][cx]);
      return;
    }

    // 2) 그 외 → 화면 픽셀 추출. 칸 안(빈칸)은 격자선을 피하려 '칸 중앙'을, 칸 밖(맵)은 커서를 샘플
    const r = this.game.renderer;
    if (!r || !r.snapshotPixel) return;
    let px = ptr.x, py = ptr.y;
    if (inGrid) {
      const wx = left + (cx + 0.5) * cellW;
      const wy = top + (cy + 0.5) * cellH;
      px = (wx - cam.worldView.x) * cam.zoom;
      py = (wy - cam.worldView.y) * cam.zoom;
    }
    // 그리기 모드에선 postFX 가 꺼져 있으므로(아래 _applyPostFXForState) 원본 색이 그대로 추출됨
    r.snapshotPixel(px, py, (color) => {
      const hex = '#' + [color.red, color.green, color.blue]
        .map((v) => v.toString(16).padStart(2, '0')).join('');
      this.board.pickColor(hex);
    });
  }

  // 셰이더(비네팅·색수차)는 그리기 줌인이 '거의 다 확대된 뒤'에 꺼진다(다 확대되고 나서 사라짐).
  // 평소(줌≈1)엔 켜져 있고, 줌아웃되면 다시 켜짐.
  _applyPostFXForState() {
    const cam = this.cameras.main;
    if (!cam) return;
    const off = cam.zoom >= DRAW_ZOOM * 0.85;
    if (off === this._fxDrawing) return;
    this._fxDrawing = off;
    // 즉시 끄지 않고 트윈으로 서서히 사라지게/다시 나타나게
    if (this._vignette) {
      this.tweens.killTweensOf(this._vignette);
      this.tweens.add({ targets: this._vignette, strength: off ? 0 : this._vignetteStrength, duration: 400, ease: 'Sine.easeInOut' });
    }
    if (this.chroma) {
      this.tweens.killTweensOf(this.chroma);
      this.tweens.add({ targets: this.chroma, intensity: off ? 0 : this._chromaBase, duration: 400, ease: 'Sine.easeInOut' });
    }
  }

  // 그리기 모드에서 캐릭터 위에 격자/칠한 셀/테두리 표시
  _renderDrawOverlay(me) {
    const g = this.drawGfx;
    const { left, top, w, h, cellW, cellH } = this._drawRegion(me);
    const COLS = this.board.cols, ROWS = this.board.rows;
    const lw = 1 / this.cameras.main.zoom; // 줌과 무관하게 화면상 ~1px 선
    g.clear();
    // (검은 반투명 배경 제거 — 캐릭터 색이 어두워져 스포이드가 틀린 색을 뽑던 원인)
    // 칠한 셀
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = this.board.cells[y][x];
        if (!c) continue;
        g.fillStyle(parseInt(c.slice(1), 16), 1);
        g.fillRect(left + x * cellW, top + y * cellH, cellW, cellH);
      }
    }
    // 격자선 (더 투명하게)
    g.lineStyle(lw, 0xffffff, 0.08);
    for (let i = 0; i <= COLS; i++) g.lineBetween(left + i * cellW, top, left + i * cellW, top + h);
    for (let i = 0; i <= ROWS; i++) g.lineBetween(left, top + i * cellH, left + w, top + i * cellH);
    // 테두리(그릴 수 있는 영역 표시)
    g.lineStyle(lw * 2, 0xffe27a, 0.9);
    g.strokeRect(left, top, w, h);

    // 브러시 미리보기: 커서 위치에 칠해질 영역을 반투명으로
    // (스포이드 모드 또는 Space 추출 중엔 숨김 → 미리보기 색이 샘플에 섞이지 않게)
    if (!this._eyedropMode && !this.keys.space.isDown) {
      const ptr = this.input.activePointer;
      const hx = Math.floor((ptr.worldX - left) / cellW);
      const hy = Math.floor((ptr.worldY - top) / cellH);
      if (hx >= 0 && hy >= 0 && hx < COLS && hy < ROWS) {
        g.fillStyle(parseInt(this.board.color.slice(1), 16), 0.5);
        for (const [dx, dy] of this.board.brushOffsets()) {
          const x = hx + dx, y = hy + dy;
          if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
          g.fillRect(left + x * cellW, top + y * cellH, cellW, cellH);
        }
        g.lineStyle(lw * 1.5, 0xffffff, 0.85); // 중심 칸 강조
        g.strokeRect(left + hx * cellW, top + hy * cellH, cellW, cellH);
      }
    }
  }

  // ===========================================================================
  // [3단계] 네트워크
  // ===========================================================================
  // 타이틀/로비 화면: 방 만들기·참가(공개/비공개) 버튼 처리
  _setupTitle() {
    const screen = document.getElementById('title-screen');
    if (!screen) return;
    const show = (name) => this._showTitleStep(name);
    const nick = () => this._nick || '';
    this._bindModeDescs(); // 모드 설명(방 만들기/설정 모달) 초기화 + 변경 시 갱신
    // 저장된 닉네임이 있으면 입력창에 미리 채움(자동 확정 실패 대비)
    try {
      const saved = localStorage.getItem('imjustawall_nick');
      const nickInput = document.getElementById('ts-nick');
      if (saved && nickInput) nickInput.value = saved;
    } catch (e) { /* 무시 */ }

    screen.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      this._titleMsg('');
      switch (btn.dataset.act) {
        case 'set-nick': {
          const v = (document.getElementById('ts-nick').value || '').trim();
          if (!v) { this._titleMsg('닉네임을 입력하세요.'); break; }
          if (!/^[A-Za-z0-9가-힣]{1,16}$/.test(v)) {
            this._titleMsg('한글·영문·숫자만 가능해요 (공백·특수문자 불가).'); break;
          }
          const ok = await this._confirm(`'${v}'(으)로 결정하시겠어요?\n닉네임은 나중에 바꿀 수 없습니다.`);
          if (!ok) break;
          this.socket.emit('setNick', { nick: v }); // 서버가 중복 확인 후 nickOk/nickError 응답
          break;
        }
        case 'create-menu': show('create'); break;
        case 'join-menu': show('public-list'); this.socket.emit('listRooms'); break;
        case 'back': show('main'); break;
        case 'create': {
          const isPublic = btn.dataset.public === '1';
          const name = (document.getElementById('ts-roomname').value || '').trim();
          // 공개 방은 이름 필수, 비공개 방은 비우면 서버가 랜덤 이름 생성
          if (isPublic && !name) { this._titleMsg('방 이름을 입력하세요.'); break; }
          const num = (id) => Number(document.getElementById(id).value);
          this.socket.emit('createRoom', {
            name, isPublic, nickname: nick(),
            maxPlayers: num('ts-max'), seekerCount: num('ts-seekers'), seekerWait: num('ts-swait'),
            hiderTime: num('ts-htime'), revealTime: num('ts-reveal'), whistleTime: num('ts-whistle'),
            mode: document.getElementById('ts-mode').value,
          });
          break;
        }
        case 'refresh': this.socket.emit('listRooms'); break;
        case 'join-code': {
          const code = (document.getElementById('ts-code').value || '').trim();
          if (!code) { this._titleMsg('코드를 입력하세요.'); break; }
          this.socket.emit('joinRoom', { roomId: code, nickname: nick() });
          break;
        }
        default: break;
      }
    });

    const listEl = document.getElementById('ts-roomlist');
    if (listEl) listEl.addEventListener('click', (e) => {
      const row = e.target.closest('.ts-room');
      if (!row || !row.dataset.id) return;
      this.socket.emit('joinRoom', { roomId: row.dataset.id, nickname: nick() });
    });

    const startBtn = document.getElementById('start-btn');
    if (startBtn) startBtn.addEventListener('click', () => { this.socket.emit('startGame'); startBtn.blur(); });
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => this._openSettings());
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) settingsModal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sm]');
      if (!b) return;
      if (b.dataset.sm === 'save') {
        const num = (id) => Number(document.getElementById(id).value);
        const opts = {
          maxPlayers: num('rs-max'), seekerCount: num('rs-seekers'),
          seekerWait: num('rs-swait'), hiderTime: num('rs-htime'), revealTime: num('rs-reveal'),
          whistleTime: num('rs-whistle'),
          mode: document.getElementById('rs-mode').value,
        };
        this.socket.emit('updateRoomOptions', opts);
        this._options = { ...this._options, ...opts };
        this._mode = opts.mode;
        if (this._roomId) this._showRoomCode(this._roomId, this._roomPublic, opts); // 방 코드 모드/옵션 갱신
      }
      settingsModal.classList.add('hidden');
    });
  }

  // 방장+로비 단계에서만 로비 컨트롤(설정+시작) 표시
  _updateStartButton() {
    const el = document.getElementById('lobby-controls');
    if (el) el.classList.toggle('hidden', !(this._phase === 'lobby' && this._isHost));
  }

  // 대기실에서만 방장 명찰 왼쪽에 'host' 표기(게임 시작되면 제거)
  _refreshHostTags() {
    const inLobby = this._phase === 'lobby' || this._phase === 'starting';
    this.players.forEach((p) => {
      if (inLobby && p.id === this._hostId) {
        if (!p.hostTag) {
          // 명찰과 같은 검은 배경, 강조색(골드)으로 'host' 표기
          p.hostTag = this.add.text(0, 0, 'host', {
            fontFamily: UI_FONT, fontSize: '9px', color: '#ffd83b',
            backgroundColor: 'rgba(0,0,0,0.4)', padding: { x: 5, y: 2 },
          }).setOrigin(0.5);
        }
      } else if (p.hostTag) {
        p.hostTag.destroy();
        p.hostTag = null;
      }
    });
  }

  // 모드별 간단한 설명 텍스트
  _modeDescText(v) {
    return v === 'infection'
      ? '잡힌 HIDER도 SEEKER가 되어 함께 추격합니다.'
      : '일정 시간마다 HIDER가 휘파람을 불어 위치가 드러납니다.';
  }

  // 모드 표시 이름(방 코드 옆에 노출)
  _modeName(v) {
    return v === 'infection' ? '감염 - 아까까진 동료였는데' : '기본 - 휘파람을 참을 수 없어';
  }

  _updateModeDesc(selId, descId, whistleId) {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const infection = sel.value === 'infection';
    const d = document.getElementById(descId);
    if (d) d.textContent = this._modeDescText(sel.value);
    // 감염모드는 강제 휘파람이 없음 → 강제 휘파람(초) 입력 비활성화
    const w = whistleId && document.getElementById(whistleId);
    if (w) w.disabled = infection;
  }

  // 모드 select 변경 시 설명/강제휘파람 활성화 갱신 + 초기 표시(방 만들기/설정 모달 양쪽)
  _bindModeDescs() {
    [['ts-mode', 'ts-mode-desc', 'ts-whistle'], ['rs-mode', 'rs-mode-desc', 'rs-whistle']].forEach(([s, d, w]) => {
      const sel = document.getElementById(s);
      if (!sel) return;
      this._updateModeDesc(s, d, w);
      sel.addEventListener('change', () => this._updateModeDesc(s, d, w));
    });
  }

  // 방 설정 모달 열기(현재 옵션을 채워서)
  _openSettings() {
    const o = this._options || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    set('rs-max', o.maxPlayers); set('rs-seekers', o.seekerCount);
    set('rs-swait', o.seekerWait); set('rs-htime', o.hiderTime); set('rs-reveal', o.revealTime);
    set('rs-whistle', o.whistleTime);
    const ms = document.getElementById('rs-mode'); if (ms) ms.value = o.mode || 'basic';
    this._updateModeDesc('rs-mode', 'rs-mode-desc', 'rs-whistle');
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
  }

  _renderRoomList(list) {
    const el = document.getElementById('ts-roomlist');
    if (!el) return;
    if (!Array.isArray(list) || !list.length) {
      el.innerHTML = '<div class="ts-room-empty">열려 있는 공개 방이 없습니다.</div>';
      return;
    }
    el.innerHTML = list.map((r) => {
      const mode = r.mode === 'infection' ? '감염' : '기본';
      const phase = r.phase === 'playing' ? '진행중' : '대기중';
      const times = [
        `대기 ${r.seekerWait || 70}초`,
        `탐색 ${r.hiderTime || 200}초`,
        `정답 ${r.revealTime || 30}초`,
      ];
      if (r.mode !== 'infection') times.push(`휘파람 ${r.whistleTime || 30}초`);
      return `<div class="ts-room" data-id="${this._esc(r.id)}">` +
        `<div class="ts-room-main"><span class="ts-room-name">${this._esc(r.name)}</span>` +
        `<span class="ts-room-count${r.phase === 'playing' ? ' playing' : ''}">${r.count}/${r.max || 12}명</span></div>` +
        `<div class="ts-room-info">${mode} · 술래 ${r.seekers || 2}명 · ${phase}</div>` +
        `<div class="ts-room-info ts-room-times">⏱ ${this._esc(times.join(' · '))}</div></div>`;
    }).join('');
  }

  _titleMsg(msg) {
    const el = document.getElementById('ts-msg');
    if (el) el.textContent = msg || '';
  }

  _showTitleStep(name) {
    const screen = document.getElementById('title-screen');
    if (screen) screen.querySelectorAll('.ts-step').forEach((s) => s.classList.toggle('hidden', s.dataset.step !== name));
  }

  // 게임 UI 스타일 확인 모달 → Promise<boolean>
  _confirm(message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      if (!modal) { resolve(true); return; }
      modal.querySelector('.cm-msg').textContent = message;
      modal.classList.remove('hidden');
      const onClick = (e) => {
        const b = e.target.closest('[data-cm]');
        if (!b) return;
        modal.classList.add('hidden');
        modal.removeEventListener('click', onClick);
        resolve(b.dataset.cm === 'ok');
      };
      modal.addEventListener('click', onClick);
    });
  }

  _hideTitle() {
    const s = document.getElementById('title-screen');
    if (s) s.classList.add('hidden');
  }

  _showRoomCode(roomId, isPublic, opts) {
    const el = document.getElementById('room-code');
    if (!el || !roomId) return;
    this._roomId = roomId; this._roomPublic = isPublic; // 옵션/모드 변경 시 갱신용
    const o = opts || this._options || {};
    const m = o.mode || this._mode || 'basic';
    const parts = [
      `최대 ${o.maxPlayers || 12}명`,
      `술래 ${o.seekerCount || 2}명`,
      `대기 ${o.seekerWait || 70}초`,
      `탐색 ${o.hiderTime || 200}초`,
      `정답 ${o.revealTime || 30}초`,
    ];
    if (m !== 'infection') parts.push(`휘파람 ${o.whistleTime || 30}초`); // 감염모드는 강제 휘파람 없음
    el.innerHTML = `${isPublic ? '🌐 공개' : '🔒 비공개'} · 코드 <b>${this._esc(roomId)}</b>`
      + `<span class="room-code-mode">${this._esc(this._modeName(m))}</span>`
      + `<span class="room-code-opts">${this._esc(parts.join(' · '))}</span>`;
    el.classList.remove('hidden');
  }

  _setupNetwork() {
    const socket = io();
    this.socket = socket;
    // 접속하자마자 입장하지 않고, 타이틀에서 방을 만들거나 참가한다.
    this._setupTitle();

    // 닉네임 확정 결과
    socket.on('nickOk', ({ nick } = {}) => {
      this._nick = nick;
      try { localStorage.setItem('imjustawall_nick', nick); } catch (e) { /* 무시 */ }
      this._showTitleStep('main');
    });
    socket.on('nickError', ({ message } = {}) => {
      this._showTitleStep('nickname');
      this._titleMsg(message || '닉네임을 사용할 수 없어요.');
    });

    // 연결되면: 저장된 닉이 있으면 자동 확정(→ 메인), 없으면 닉네임 입력 화면으로
    socket.on('connect', () => {
      let saved = null;
      try { saved = localStorage.getItem('imjustawall_nick'); } catch (e) { /* 무시 */ }
      if (saved) socket.emit('setNick', { nick: saved });
      else this._showTitleStep('nickname');
    });

    socket.on('roomList', (list) => this._renderRoomList(list));
    socket.on('roomCreated', ({ roomId } = {}) => { this._myRoomCode = roomId; });
    socket.on('joinError', ({ message } = {}) => this._titleMsg(message || '입장에 실패했습니다.'));

    socket.on('init', ({ id, role, caught, world, players, roomId, isPublic, phase, isHost, hostId, seekerRemainMs, whistleRemainMs, hiderRemainMs, revealRemainMs, options }) => {
      this.myId = id;
      this.myRole = role;
      if (world) this.world = world;
      players.forEach((p) => this._addPlayer(p));
      this._updateRoleBadge();
      // 진행 중인 방에 난입 → 죽은 것처럼 관전(이동/조작 불가, 화면만 관전)
      if (caught) this._enterSpectator();
      this._buildHud();
      // 마우스 포인터: 술래=크로스헤어(중앙 정렬), 숨는이=cursor(좌상단 화살표 끝 기준)
      this._applyCursorRole(role);
      this._hideTitle();
      this._showRoomCode(roomId, isPublic, options);
      this._phase = phase || 'lobby';
      this._isHost = !!isHost;
      this._hostId = hostId || null;
      this._options = options || {};
      this._mode = (options && options.mode) || 'basic';
      // 게임 중 입장 시 남은 추격 대기 반영(술래·숨는이 모두 카운트다운 표시). 로비면 0
      this._seekerReleaseAt = (this._phase === 'playing' && seekerRemainMs > 0)
        ? Date.now() + seekerRemainMs : 0;
      // 강제 휘파람 카운트다운(게임 중 입장 시 남은 시간 반영)
      this._nextWhistleAt = (this._phase === 'playing' && this._mode !== 'infection' && whistleRemainMs > 0)
        ? Date.now() + whistleRemainMs : 0;
      // 탐색/정답 공개 카운트다운(게임 중 입장 시 남은 시간 반영)
      this._hiderEndAt = (this._phase === 'playing' && hiderRemainMs > 0) ? Date.now() + hiderRemainMs : 0;
      this._revealEndAt = (this._phase === 'reveal' && revealRemainMs > 0) ? Date.now() + revealRemainMs : 0;
      this._updateStartButton();
      this._refreshHostTags(); // 대기실 방장 명찰 옆 'host' 표기
      // 게임 중 입장(늦참): 게임 맵으로. 술래는 남은 대기가 있으면 대기 후 update 가 보냄.
      if (this._phase === 'playing') {
        if (role === 'hider' || (role === 'seeker' && !this._seekerReleaseAt)) this._teleportToGame();
      }
    });

    // 시작 불가(인원 부족 등) 안내
    socket.on('startError', ({ message } = {}) => this._toast(message || '게임을 시작할 수 없습니다.'));

    // 방장이 시작 누름 → 15초 카운트다운(아직 로비, 역할 미정)
    socket.on('gameStarting', ({ remainMs } = {}) => {
      this._phase = 'starting';
      this._startCountAt = Date.now() + (remainMs || 0);
      this._updateStartButton(); // 카운트 중엔 시작 버튼 숨김
    });

    // 방장이 시작 → 역할 배정 후 HIDER 즉시 게임 맵으로, SEEKER 는 대기 후 이동
    socket.on('gameStarted', ({ seekerRemainMs, role, mode } = {}) => {
      this._phase = 'playing';
      if (mode) this._mode = mode;
      if (role) this._changeRole(this.myId, role); // 스프라이트 교체 + myRole 갱신
      this._updateStartButton();
      this._refreshHostTags(); // 게임 시작 → 대기실 'host' 표기 제거
      // 모두 카운트다운 공유: 숨는이는 표시용(즉시 게임 맵), 술래는 대기 후 이동
      this._seekerReleaseAt = Date.now() + (seekerRemainMs || 0);
      // 강제 휘파람 카운트다운 시작(감염모드는 없음)
      this._nextWhistleAt = this._mode !== 'infection' ? Date.now() + this._whistleInterval() : 0;
      // 탐색 종료 시각(추격 시작 + 탐색 시간) — 모두 카운트다운 공유
      this._hiderEndAt = Date.now() + (seekerRemainMs || 0) + ((this._options && this._options.hiderTime) || 200) * 1000;
      this._revealEndAt = 0;
      if (this.myRole === 'hider') this._teleportToGame();
    });

    // 방 전체 역할 동기화(다른 플레이어 스프라이트 교체)
    socket.on('rolesUpdated', (roles) => {
      if (Array.isArray(roles)) roles.forEach(({ id, role }) => this._changeRole(id, role));
    });

    // 감염모드: 본인이 잡혀 술래가 됨 → 즉시 추격(대기 없음)
    socket.on('infected', () => { this._seekerReleaseAt = 0; });

    // 감염모드: 잡힌 자리에 시체+그림을 남김(원본은 곧 rolesUpdated 로 술래 부활)
    socket.on('corpseSpawn', ({ id } = {}) => {
      const src = this.players.get(id);
      if (src) this._spawnCorpse(src);
    });

    // "휘파람을 참을 수 없어": 서버 주기 신호 → 내가 숨는이면 강제로 휘파람(위치 노출)
    socket.on('forceWhistle', () => {
      this._nextWhistleAt = Date.now() + this._whistleInterval(); // 강제 발동됨 → 다음 카운트다운 시작
      if (this.myRole === 'hider' && !this.caught) this._actWhistle(true);
    });

    // 누군가 직접 휘파람을 불어 강제 타이머가 리셋됨(방 전체 동기화)
    socket.on('whistleReset', ({ remainMs } = {}) => {
      this._nextWhistleAt = Date.now() + (remainMs || this._whistleInterval());
    });

    // 탐색 시간 종료 → 정답 공개: 살아남은 숨는이를 시체처럼 노출 + 위치 네비게이션
    socket.on('revealStart', ({ remainMs, hiders } = {}) => {
      this._phase = 'reveal';
      this._revealEndAt = Date.now() + (remainMs || 0);
      this._startReveal(hiders || []);
    });

    socket.on('playerJoined', (p) => this._addPlayer(p));

    // 방장이 방 설정을 바꾸면 방 전체가 최신 옵션을 반영(코드 패널 표시 갱신)
    socket.on('roomOptions', (options = {}) => {
      this._options = { ...this._options, ...options };
      this._mode = options.mode || this._mode || 'basic';
      if (this._roomId) this._showRoomCode(this._roomId, this._roomPublic, this._options);
    });

    // 방장이 나가 다른 사람에게 인계됨 → 왕관 이동 + 내가 방장이면 로비 컨트롤 표시
    socket.on('hostChanged', ({ hostId } = {}) => {
      this._hostId = hostId || null;
      this._isHost = (hostId === this.myId);
      this._refreshHostTags();
      this._updateStartButton();
      if (this._isHost) this._toast('방장이 나가 당신이 방장이 되었습니다.');
    });

    // 점수판: 본인 점수는 즉시, 남의 점수는 20초마다 갱신(점수판에 카운트다운 표시)
    socket.on('scores', (latest) => this._onScores(latest));
    this._nextSyncAt = Date.now() + 20000;
    this._scoreSyncTimer = window.setInterval(() => {
      const now = Date.now();
      if (now >= this._nextSyncAt && this._latestScores) {
        this._displayScores = this._latestScores.map((s) => ({ ...s }));
        this._nextSyncAt = now + 20000;
      }
      if (this._displayScores) this._renderScoreboard(this._displayScores); // 매초 카운트다운 갱신
    }, 1000);

    socket.on('playerMoved', ({ id, x, y, angle, z, anim, flip, holding }) => {
      const p = this.players.get(id);
      if (!p) return;
      p.target.x = x;
      p.target.y = y;
      p.angle = angle;
      p.z = z || 0;
      if (typeof flip === 'boolean') p.facingLeft = flip;
      if (anim) p.anim = anim;
      p.holding = !!holding;
      p.lastMove = this.time.now;
    });

    socket.on('playerDrew', ({ id, dataURL }) => this.applyDrawing(id, dataURL));
    socket.on('playerWhistled', ({ id, x, y }) => this._onWhistle(id, x, y));
    socket.on('chatMessage', ({ id, name, text }) => {
      this._addChatMessage(name, text, id === this.myId);
      this._showChatBubble(id, name, text); // 캐릭터 위 말풍선(명찰 대신 '닉네임 : 메시지')
    });
    socket.on('playerCaught', ({ id }) => this._onCaught(id));
    socket.on('gameOver', ({ winner, returnMs } = {}) => this._onGameOver(winner, returnMs));
    socket.on('returnToLobby', ({ players } = {}) => this._returnToLobby(players || []));
    socket.on('playerShot', ({ id }) => {
      const p = this.players.get(id);
      if (!p) return;
      const now = this.time.now;
      p.gunShotUntil = now + 280;   // 발사 중: gun_moving + gun_shot 동시 표시
      // 총소리: 술래뿐 아니라 근처 플레이어(숨는이)도 거리별 음량으로 들림
      const me = this.players.get(this.myId);
      if (me) {
        const d = Phaser.Math.Distance.Between(me.x, me.y, p.x, p.y);
        if (d <= SHOT_HEAR_R) this._playShot(Phaser.Math.Clamp(1 - d / SHOT_HEAR_R, 0.1, 1));
      }
    });

    socket.on('playerLeft', ({ id }) => {
      const p = this.players.get(id);
      if (!p) return;
      // 게임 진행 중 이탈 → 마지막 위치에 탈주 표시(문 + 닉네임)
      if ((this._phase === 'playing' || this._phase === 'reveal') && !p.isCorpse) {
        this._spawnQuitMarker(p);
      }
      p.body.destroy();
      p.skin.destroy();
      p.shadow.destroy();
      p.label.destroy();
      if (p.hostTag) p.hostTag.destroy();
      if (p.bubble) p.bubble.destroy();
      if (p.gun) p.gun.destroy();
      if (p.gunShot) p.gunShot.destroy();
      this.players.delete(id);
    });
  }

  // 역할 변경: 기존 스프라이트를 지우고 새 역할로 재생성(본인이면 HUD/커서도 갱신)
  _changeRole(id, newRole) {
    const p = this.players.get(id);
    if (!p || p.role === newRole) return;
    // 역할이 바뀌면 위장 그림(region/scale 다름)과 캔버스 든 상태는 리셋한다.
    //  - dataURL 미전달: 숨는이 그림이 술래 몸에 그대로 칠해지는 버그 방지
    //  - holding=false: 캔버스 든 채 변신해 이속이 느린 채 남는 버그 방지
    const info = {
      id, role: newRole, name: p.name, color: p.color,
      x: p.x, y: p.y, angle: p.angle, holding: false, caught: p.caught,
    };
    ['shadow', 'body', 'skin', 'label', 'gun', 'gunShot', 'hostTag', 'bubble'].forEach((k) => { if (p[k]) p[k].destroy(); });
    this.players.delete(id);
    this._addPlayer(info);
    if (id === this.myId) {
      this.myRole = newRole;
      this._resetCanvasState(); // 캔버스/그림/이속(drawState) 정리
      this._updateRoleBadge();
      this._buildHud();
      this._applyCursorRole(newRole);
    }
  }

  // 캔버스 세션 상태 초기화(역할 변경 등): drawState 를 closed 로 되돌려 이속·그림 잔상 제거
  _resetCanvasState() {
    this.drawState = 'closed';
    if (this.board) this.board.hide();
    if (this.drawGfx) this.drawGfx.setVisible(false).clear();
    this._setEyedrop(false);
    if (this.cameras && this.cameras.main) this.cameras.main.zoomTo(1, 0);
  }

  _addPlayer(info) {
    if (this.players.has(info.id)) return;

    // 스프라이트 세트: 술래=seeker, 숨는이=gray/lemon/orange 중 (서버가 준 색 인덱스)
    const set = info.role === 'seeker'
      ? 'seeker'
      : HIDER_SETS[(info.color || 0) % HIDER_SETS.length];
    const isSeekerP = info.role === 'seeker';
    const scale = isSeekerP ? SEEKER_SCALE : 1;             // 술래가 조금 더 큼
    const regionW = isSeekerP ? SEEKER_REGION : DRAW_REGION;   // 술래 꾸미기 영역 폭
    const regionH = isSeekerP ? SEEKER_REGION_H : DRAW_REGION; // 술래 꾸미기 영역 높이(세로로 김)
    const regionCY = isSeekerP ? SEEKER_REGION_CY : REGION_CY;

    const shadow = this.add.ellipse(info.x, info.y, SHADOW_W * scale, SHADOW_H * scale, 0x000000, 0.35).setDepth(DEPTH_SHADOW);

    const body = this.add.sprite(info.x, info.y, set + '_idle', 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(CAT_DH * scale, CAT_DH * scale);
    body.play(set + '_idle');

    // 위장/꾸미기 그림 오버레이. 그림 없으면 숨김.
    const skin = this.add.image(info.x, info.y, set + '_idle')
      .setOrigin(0.5, 0.5)
      .setDisplaySize(regionW * scale, regionH * scale)
      .setVisible(false);

    // 술래 총 오버레이(몸 위에 한 겹 더). 숨는이는 없음.
    //  - gun: 평상시 idle / 이동 시 gun_moving (베이스)
    //  - gunShot: 발사 시 gun_shot 을 베이스 위에 '동시에' 겹쳐 표시
    const gun = isSeekerP
      ? this.add.image(info.x, info.y, 'gun_idle')
          .setOrigin(0.5, 1)
          .setDisplaySize(CAT_DH * scale, CAT_DH * scale)
      : null;
    const gunShot = isSeekerP
      ? this.add.image(info.x, info.y, 'gun_shot')
          .setOrigin(0.5, 1)
          .setDisplaySize(CAT_DH * scale, CAT_DH * scale)
          .setVisible(false)
      : null;

    const isMe = info.id === this.myId;
    // 술래는 캐릭터가 크므로(SEEKER_SCALE) 명찰도 같은 비율로 키운다(숨는이 13px 기준)
    const labelPx = Math.round(13 * (isSeekerP ? SEEKER_SCALE : 1));
    const label = this.add.text(0, 0, info.name, {
      fontFamily: UI_FONT, fontSize: `${labelPx}px`,
      // 본인=노랑, 술래(남이 볼 때)=빨강, 그 외=흰색 (색으로 구분)
      color: isMe ? '#ffd83b' : (isSeekerP ? '#ff5a5a' : '#e7e9ee'),
      backgroundColor: 'rgba(0,0,0,0.4)', padding: { x: 5, y: 2 },
    }).setOrigin(0.5);

    const p = {
      id: info.id, role: info.role, name: info.name, color: info.color || 0,
      set, scale, regionW, regionH, regionCY,
      shadow, body, skin, label, gun, gunShot,
      gunShotUntil: 0,        // 발사 중(gun_moving + gun_shot 동시 표시) 종료 시각
      x: info.x, y: info.y,
      target: { x: info.x, y: info.y },
      angle: info.angle || 0,
      z: 0, zVel: 0,
      facingLeft: false,
      anim: 'idle',        // 애니 상태값(idle/run/jump/fall/canvas) — 세트로 키 조합
      localAnim: 'idle',
      currentAnim: null,
      lastMove: 0,
      holding: !!info.holding,
      caught: !!info.caught,
      hasDrawing: false,
      skinDataURL: null,
    };
    this.players.set(info.id, p);

    if (info.dataURL) this.applyDrawing(info.id, info.dataURL);
  }

  _updateRoleBadge() {
    const badge = document.getElementById('role-badge');
    if (!badge) return;
    // 아이콘(SVG)은 className(seeker/hider)으로 CSS가 전환 → innerHTML 건드리지 않음
    const title = badge.querySelector('.rb-title');
    const sub = badge.querySelector('.rb-sub');
    if (this.myRole === 'seeker') {
      badge.className = 'hud-card seeker';
      if (title) title.textContent = 'SEEKER';
      if (sub) sub.textContent = '숨은 HIDER를 찾으세요';
    } else {
      badge.className = 'hud-card hider';
      if (title) title.textContent = 'HIDER';
      if (sub) sub.textContent = '위장하고 숨으세요';
    }
  }

  // 음성채팅 거리별 볼륨: 가까울수록 크게, VOICE_MAX_R 밖이면 0(안 들림)
  _updateVoiceVolumes() {
    if (!this.voice || !this.voice.joined || this.voice.peers.size === 0) return;
    const me = this.players.get(this.myId);
    if (!me) return;
    const span = VOICE_MAX_R - VOICE_NEAR_R;
    for (const peerId of this.voice.peers.keys()) {
      const p = this.players.get(peerId);
      let vol = 1;
      if (p) {
        const d = Phaser.Math.Distance.Between(me.x, me.y, p.x, p.y);
        vol = Phaser.Math.Clamp((VOICE_MAX_R - d) / span, 0, 1);
      }
      this.voice.setPeerVolume(peerId, vol);
    }
  }

  // ---- 조작 액션(키·버튼 공용) ----------------------------------------------
  _actJump() {
    const me = this.players.get(this.myId);
    if (!me || this.caught || this.gameEnded || this.chatOpen) return;
    if (this.drawState !== 'closed') return;       // 캔버스 들거나 그리는 중엔 점프 불가
    if (me.z <= this._groundHeight(me.x, me.y) + 1) me.zVel = JUMP_VEL; // 바닥/단상 위에서만
  }

  // 단상 중심까지의 (위쪽을 좁힌) 제곱 거리. top 이 클수록 위쪽 판정이 좁음
  _podiumDist2(x, y, top) {
    const p = this._podium;
    if (!p) return Infinity;
    const dx = x - p.x;
    let dy = y - p.y;
    if (dy < 0) dy *= top;
    return dx * dx + dy * dy;
  }

  // 발밑 바닥 높이(단상 위면 단상 높이)
  _groundHeight(x, y) {
    const p = this._podium;
    if (p && this._podiumDist2(x, y, 1.55) < p.r2) return p.h;
    return 0;
  }

  // 단상 옆면 충돌: 충분히 높지 않으면(z < 단상높이) 단상 안으로 더 들어가는 이동만 막음
  // (접선/탈출 방향은 허용 → 가장자리에서 미끄러짐, 끼임 없음)
  _podiumBlock(x, y) {
    const p = this._podium;
    if (!p) return false;
    const me = this.players.get(this.myId);
    if (!me || me.z >= p.h - 4) return false; // 점프로 충분히 높으면 통과
    const d2 = this._podiumDist2(x, y, 1.55);
    if (d2 >= p.r2) return false;             // 단상 밖이면 통과
    const cd2 = this._podiumDist2(me.x, me.y, 1.55);
    return d2 < cd2;                          // 중심으로 더 가까워지는 이동만 차단
  }

  _actWhistle(forced = false) {
    if (this.myRole === 'seeker') return; // 술래는 휘파람을 불지 않음(위치 노출 대상 아님)
    const me = this.players.get(this.myId);
    if (!me || this.caught || this.gameEnded) return;
    if (this.drawState !== 'closed' && this.drawState !== 'holding') return;
    this._ensureAudio();
    if (this.socket) this.socket.emit('whistle', { x: Math.round(me.x), y: Math.round(me.y), forced });
    // 직접 분 휘파람이면 다음 강제 휘파람 카운트다운을 설정 시간으로 리셋
    if (!forced) this._nextWhistleAt = Date.now() + this._whistleInterval();
  }

  // 강제 휘파람 주기(ms). 옵션값(초) 기반, 기본 30초
  _whistleInterval() {
    return ((this._options && this._options.whistleTime) || 30) * 1000;
  }

  _actCanvas() { // E (숨는이): 캔버스 꺼내기/집어넣기
    if (this.caught || this.gameEnded || this.myRole === 'seeker') return;
    if (this.drawState === 'closed') this._takeOut('hold');
    else if (this.drawState === 'holding') this._putAway();
  }

  _actDraw() { // Q: 술래=꾸미기 / 숨는이=위장 그리기
    if (this.caught || this.gameEnded) return;
    if (this.myRole === 'seeker') {
      if (this.drawState === 'closed') this._openEditor();
      else if (this.drawState === 'drawing') this._applyAndHold();
    } else {
      if (this.drawState === 'closed') this._takeOut('draw');
      else if (this.drawState === 'holding') this._openEditor();
      else if (this.drawState === 'drawing') this._applyAndHold();
    }
  }

  // 도움말 HUD: 현재 역할에서 실제로 동작하는 조작을 '클릭 가능한 버튼'으로 표시(키도 동작)
  _buildHud() {
    const hud = document.getElementById('hud');
    if (!hud) return;
    const seeker = this.myRole === 'seeker';
    const btns = [];
    if (seeker) {
      btns.push({ key: 'Q', label: '꾸미기', act: () => this._actDraw() });
    } else {
      btns.push({ key: 'E', label: '위장', canvas: true, act: () => this._actCanvas() });
      btns.push({ key: 'Q', label: '그리기', act: () => this._actDraw() });
      btns.push({ key: 'R', label: '휘파람', act: () => this._actWhistle() }); // 숨는이만
    }
    btns.push({ key: 'SPACE', label: '점프', act: () => this._actJump() });
    if (!seeker) {
      // 숨는이 전용: 모든 명찰/그림자 숨김 토글
      btns.push({ key: 'H', label: this._hideTags ? '명찰표시' : '명찰숨김', tags: true, act: () => this._toggleTags() });
    }
    hud.innerHTML = '';
    this._canvasLblEl = null;
    this._tagsLblEl = null;
    btns.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hud-btn';
      el.innerHTML = `<span class="hud-lbl">${b.label}</span><span class="hud-key">${b.key}</span>`;
      el.addEventListener('click', () => { b.act(); el.blur(); }); // 누른 뒤 포커스 해제(스페이스 재입력 방지)
      if (b.canvas) this._canvasLblEl = el.querySelector('.hud-lbl'); // 위장↔위장취소 라벨 토글용
      if (b.tags) this._tagsLblEl = el.querySelector('.hud-lbl');     // 명찰숨김↔명찰표시 라벨 토글용
      hud.appendChild(el);
    });
  }

  // 서버 점수 수신: 본인 점수는 즉시 반영, 남의 점수는 직전 표시값 유지(30초 타이머가 동기화)
  _onScores(latest) {
    if (!Array.isArray(latest)) return;
    this._latestScores = latest;
    // 본인 점수 증가분 → 가운데 하단 팝 텍스트 + 효과음
    const meLatest = latest.find((s) => s.id === this.myId);
    if (meLatest) {
      if (this._myScore != null && meLatest.score > this._myScore) {
        this._showScorePop(meLatest.score - this._myScore);
        this._playScoreSfx();
      }
      this._myScore = meLatest.score;
    }
    const prevById = {};
    (this._displayScores || []).forEach((s) => { prevById[s.id] = s; });
    this._displayScores = latest.map((s) => {
      if (s.id === this.myId) return { ...s };          // 본인: 즉시 최신
      const old = prevById[s.id];
      return old ? { ...s, score: old.score } : { ...s }; // 남: 점수만 직전값, 새 멤버는 최신
    });
    this._renderScoreboard(this._displayScores);
  }

  // 점수 획득 팝업(가운데 하단): 상대 닉네임 + 점수, 색상 구분, 위로 떠오르며 사라짐
  _showScorePop(delta) {
    const host = document.getElementById('score-pop');
    if (!host) return;
    let reason;
    if (this.myRole === 'seeker') {
      const who = this._esc(this._pendingKillName || '상대');
      reason = `<span style="color:#5fe08a">${who}</span> 처치 <span style="color:#ffd83b">+${delta}</span>`;
    } else {
      const who = this._esc(this._nearSeekersLabel());
      reason = `<span style="color:#ff6b6b">${who}</span>의 시야 안 <span style="color:#ffd83b">+${delta}</span>`;
    }
    const el = document.createElement('div');
    el.className = 'score-pop-item';
    el.innerHTML = reason;
    host.appendChild(el);
    void el.offsetWidth;          // 강제 reflow → 초기 상태 렌더 후 transition 발동(매번 동작)
    el.classList.add('rise');
    setTimeout(() => el.remove(), 2400);
  }

  // 점수판(서버 scores)에서 id 의 닉네임 조회
  _nameOf(id) {
    const s = (this._latestScores || []).find((x) => x.id === id);
    return s ? s.name : null;
  }

  // 내(숨는이) 위치 기준 가장 가까운 술래의 닉네임
  _nearestSeekerName() {
    const me = this.players.get(this.myId);
    if (!me) return null;
    let best = Infinity, id = null;
    this.players.forEach((p, pid) => {
      if (p.role !== 'seeker' || p.caught) return;
      const d = Math.hypot((p.x || 0) - me.x, (p.y || 0) - me.y);
      if (d < best) { best = d; id = pid; }
    });
    return id ? this._nameOf(id) : null;
  }

  // 점수 범위(500) 안 술래들: 가장 가까운 닉네임 + 여럿이면 "외 N인" (서버 SCORE_RANGE 와 동일)
  _nearSeekersLabel() {
    const me = this.players.get(this.myId);
    if (!me) return '술래';
    const RANGE2 = 500 * 500;
    let best = Infinity, nearest = null, count = 0;
    this.players.forEach((p) => {
      if (p.role !== 'seeker' || p.caught) return;
      const dx = (p.x || 0) - me.x, dy = (p.y || 0) - me.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < RANGE2) {
        count++;
        if (d2 < best) { best = d2; nearest = p; }
      }
    });
    if (!nearest) return this._nearestSeekerName() || '술래';
    const name = nearest.name || '술래';
    return count > 1 ? `${name} 외 ${count - 1}인` : name;
  }

  // 점수 획득 효과음(가벼운 틱)
  _playScoreSfx() {
    this._ensureAudio();
    const ctx = this.audioCtx;
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.connect(g); g.connect(ctx.destination);
    const now = ctx.currentTime;
    o.frequency.setValueAtTime(1400, now);
    o.frequency.exponentialRampToValueAtTime(1900, now + 0.05);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.0385, now + 0.01); // 볼륨 30% 감소
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.start(now); o.stop(now + 0.14);
  }

  // 점수판 렌더: 점수 내림차순. 술래=킬 500 / 숨는이=술래 근접 초당 10
  _renderScoreboard(scores) {
    const el = document.getElementById('scoreboard');
    if (!el || !Array.isArray(scores)) return;
    const rows = scores.slice().sort((a, b) => b.score - a.score);
    const remain = this._nextSyncAt ? Math.max(0, Math.ceil((this._nextSyncAt - Date.now()) / 1000)) : 20;
    const html = [`<div class="sb-title">점수판 · 다음 갱신 ${remain}초</div>`];
    rows.forEach((s) => {
      const seeker = s.role === 'seeker';
      const cls = `sb-row ${seeker ? 'seeker' : 'hider'}${s.id === this.myId ? ' me' : ''}${s.caught ? ' dead' : ''}`;
      const dead = s.caught ? ' ❌' : '';
      html.push(`<div class="${cls}"><span class="sb-tag">${seeker ? 'SEEKER' : 'HIDER'}</span>` +
        `<span class="sb-name">${this._esc(s.name)}${dead}</span>` +
        `<span class="sb-score">${s.score}</span></div>`);
    });
    el.innerHTML = html.join('');
  }

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // 숨는이: 모든 명찰/그림자 숨김 토글(본인 시야에만). update 의 렌더 루프가 _hideTags 를 반영.
  _toggleTags() {
    this._hideTags = !this._hideTags;
    if (this._tagsLblEl) this._tagsLblEl.textContent = this._hideTags ? '명찰표시' : '명찰숨김';
  }

  // 음성 컨트롤 UI 바인딩(헤드셋/마이크 버튼 + 볼륨 슬라이더). create 에서 1회 호출.
  _setupVoiceUI() {
    const power = document.getElementById('vc-power');
    const mic = document.getElementById('vc-mic');
    const vol = document.getElementById('vc-volume');
    this._voiceToast = document.getElementById('voice-toast');
    if (power) power.addEventListener('click', () => this.voice && this.voice.toggle());
    if (mic) mic.addEventListener('click', () => this.voice && this.voice.toggleMic());
    if (vol) {
      const apply = () => {
        const val = parseInt(vol.value, 10) || 0;
        vol.style.setProperty('--vc-fill', val + '%');
        if (this.voice) this.voice.setMaster(val / 100);
      };
      vol.addEventListener('input', apply);
      vol.style.setProperty('--vc-fill', vol.value + '%');
    }
  }

  // 음성채팅 상태 표시. VoiceChat 이 상태가 바뀔 때마다 호출 → 실시간 반영.
  // 항상 this.voice 의 현재 상태를 읽어 그린다(전달된 s 의 error 는 토스트로만 사용).
  _updateVoiceStatus(s) {
    if (s && s.error) this._showVoiceToast(s.error);
    this._renderVoiceState();
  }

  _showVoiceToast(msg) {
    const el = this._voiceToast || document.getElementById('voice-toast');
    if (!el) return;
    el.textContent = '⚠️ ' + msg;
    el.classList.add('show');
    clearTimeout(this._voiceToastTimer);
    this._voiceToastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  _renderVoiceState() {
    const panel = document.getElementById('voice-panel');
    if (!panel) return;
    const v = this.voice;
    const joined = !!(v && v.joined);
    const micOn = !!(v && v.micOn);

    // mute 사선(.mic-slash)은 panel.muted 클래스로 CSS가 전환 → SVG innerHTML 안 건드림
    panel.className = 'hud-card ' + (joined ? (micOn ? 'on' : 'muted') : 'off');

    const mic = document.getElementById('vc-mic');
    if (mic) mic.title = joined ? (micOn ? '마이크 끄기 (V)' : '마이크 켜기 (V)') : '음성채팅 참여 후 사용 (B)';

    const power = document.getElementById('vc-power');
    if (power) power.title = joined ? '음성채팅 나가기 (B)' : '음성채팅 참여 (B)';

    const count = document.getElementById('vc-count');
    if (count) count.textContent = '참가자 ' + ((v ? v.peers.size : 0) + 1);

    // 슬라이더를 현재 볼륨에 동기화(드래그 중이 아닐 때만 — 키로 바꿨을 때 반영)
    const vol = document.getElementById('vc-volume');
    if (vol && v && document.activeElement !== vol) {
      const pct = Math.round((v.master == null ? 1 : v.master) * 100);
      vol.value = String(pct);
      vol.style.setProperty('--vc-fill', pct + '%');
    }
  }

  // ===========================================================================
  // 채팅 (T 열기 / Enter 전송 / Esc 취소)
  // ===========================================================================
  // 입력창은 항상 우상단에 보이고("채팅 - T"), 포커스되면 활성화된다.
  _setupChat() {
    this.chatOpen = false;
    this.chatInput = document.getElementById('chat-input');
    this.chatLog = document.getElementById('chat-log');
    if (!this.chatInput) return;
    this.chatInput.addEventListener('focus', () => this._onChatFocus());
    this.chatInput.addEventListener('blur', () => this._onChatBlur());
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Phaser 키보드로 전파 막기
      if (e.key === 'Enter') this._sendChat();
      else if (e.key === 'Escape') this.chatInput.blur(); // 취소
    });
  }

  _onChatFocus() {
    this.chatOpen = true;
    this.input.keyboard.resetKeys();      // 눌린 키 초기화(이동 멈춤)
    this.input.keyboard.enabled = false;  // 타이핑 중 게임 조작 차단
    this.chatInput.placeholder = 'Enter 전송 · Esc 취소';
  }

  _onChatBlur() {
    this.chatOpen = false;
    this.chatInput.value = '';
    this.chatInput.placeholder = '채팅 - T';
    this.input.keyboard.enabled = true;
    this.input.keyboard.resetKeys();
  }

  _openChat() { // T 키
    if (this.chatOpen || !this.chatInput) return;
    this.chatInput.focus(); // → _onChatFocus
  }

  _sendChat() {
    const text = this.chatInput.value.trim();
    if (text && this.socket) this.socket.emit('chat', { text });
    this.chatInput.blur(); // → _onChatBlur (값 비우고 조작 복구)
  }

  // textContent 사용(HTML 주입 방지)
  _addChatMessage(name, text, isMe) {
    if (!this.chatLog) return;
    const div = document.createElement('div');
    div.className = 'chat-msg' + (isMe ? ' me' : '');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = name;
    div.appendChild(who);
    div.appendChild(document.createTextNode(text));
    this.chatLog.appendChild(div);
    while (this.chatLog.children.length > 8) this.chatLog.removeChild(this.chatLog.firstChild);
    window.setTimeout(() => { if (div.parentNode) div.remove(); }, 30000);
  }

  // 캐릭터 머리 위 말풍선. 옅은 어두운 배경 + 테두리 + 아래로 향한 꼬리.
  // Graphics(도형)+Text 를 컨테이너로 묶는다. 컨테이너 로컬 원점(0,0) = 꼬리 끝 →
  // update 루프에서 명찰 바로 위에 끝점을 맞추고, 표시 여부는 명찰과 동일 규칙을 따른다.
  _showChatBubble(id, name, text) {
    const p = this.players.get(id);
    if (!p) return;
    const msg = String(text || '').trim().slice(0, 60);
    if (!msg) return;
    // 말풍선엔 명찰 대신 '닉네임 : 메시지' 를 함께 표기
    const line = `${name || p.name} : ${msg}`;
    if (!p.bubble) {
      const g = this.add.graphics();
      const t = this.add.text(0, 0, '', {
        fontFamily: UI_FONT, fontSize: '13px', color: '#e7e9ee',
        align: 'center', wordWrap: { width: 220 },
      }).setOrigin(0.5, 0.5);
      p.bubbleG = g;
      p.bubbleText = t;
      p.bubble = this.add.container(0, 0, [g, t]); // destroy 시 자식(도형/글자)도 함께 정리됨
    }
    p.bubbleText.setText(line);
    this._drawChatBubble(p);
    p.bubble.setVisible(true);
    p.bubbleUntil = Date.now() + 4000;
  }

  // 말풍선 도형을 글자 크기에 맞춰 다시 그린다(둥근 사각형 본문 + 아래 꼬리, 한 번에 fill/stroke).
  _drawChatBubble(p) {
    const t = p.bubbleText, g = p.bubbleG;
    const padX = 9, padY = 6, tailW = 12, tailH = 8;
    const w = Math.ceil(t.width) + padX * 2;
    const h = Math.ceil(t.height) + padY * 2;
    const r = Math.min(8, Math.min(w, h) / 2);
    t.setPosition(0, -tailH - h / 2); // 본문 중앙(꼬리 끝이 원점, 본문은 그 위)
    const rad = Phaser.Math.DegToRad;
    g.clear();
    g.fillStyle(0x101218, 0.82);     // 옅은 어두운 배경
    g.lineStyle(1.5, 0xc7ccd6, 0.9); // 밝은 테두리
    g.beginPath();
    g.moveTo(-w / 2 + r, -tailH - h);                                 // 윗변 시작
    g.lineTo(w / 2 - r, -tailH - h);                                  // 윗변
    g.arc(w / 2 - r, -tailH - h + r, r, rad(-90), rad(0));            // 우상 모서리
    g.lineTo(w / 2, -tailH - r);                                      // 오른변
    g.arc(w / 2 - r, -tailH - r, r, rad(0), rad(90));                 // 우하 모서리
    g.lineTo(tailW / 2, -tailH);                                      // 아랫변 → 꼬리 오른쪽
    g.lineTo(0, 0);                                                   // 꼬리 끝(아래)
    g.lineTo(-tailW / 2, -tailH);                                     // 꼬리 왼쪽 → 아랫변
    g.lineTo(-w / 2 + r, -tailH);                                     // 아랫변
    g.arc(-w / 2 + r, -tailH - r, r, rad(90), rad(180));             // 좌하 모서리
    g.lineTo(-w / 2, -tailH - h + r);                                 // 왼변
    g.arc(-w / 2 + r, -tailH - h + r, r, rad(180), rad(270));        // 좌상 모서리
    g.closePath();
    g.fillPath();
    g.strokePath();
  }

  // 고양이는 항상 애니메이션(본체로 늘 존재)
  _setAnim(p, state) {
    if (!state || p.currentAnim === state) return;
    p.currentAnim = state;
    p.body.play(p.set + '_' + state, true);
  }

  // [2단계] 위장 그림 → 고양이 위 오버레이(skin). null 이면 오버레이 제거(고양이만 남음)
  applyDrawing(id, dataURL) {
    const p = this.players.get(id);
    if (!p) return;
    p.skinDataURL = dataURL || null;

    if (!dataURL) {
      // 빈 그림 → 그림만 제거, 고양이는 그대로 존재
      p.hasDrawing = false;
      if (p.skin) p.skin.setVisible(false);
      return;
    }

    const key = 'body_' + id;
    const img = new Image();
    img.onload = () => {
      if (this.textures.exists(key)) this.textures.remove(key);
      this.textures.addImage(key, img);
      p.skin.setTexture(key);
      p.skin.setOrigin(0.5, 0.5);
      p.skin.setDisplaySize(p.regionW * p.scale, p.regionH * p.scale);
      p.hasDrawing = true;
      p.skin.setVisible(true);
    };
    img.src = dataURL;
  }

  // ===========================================================================
  // [5단계] 휘파람 (E)
  // ===========================================================================
  _ensureAudio() {
    if (!this.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AC();
    }
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
  }

  _playWhistle(vol = 1) {
    this._ensureAudio();
    const ctx = this.audioCtx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(1750, t + 0.14);
    o.frequency.exponentialRampToValueAtTime(1150, t + 0.30);
    const peak = Math.max(0.0008, 0.25 * vol); // 거리별 최대 음량
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.45);
  }

  _onWhistle(id, x, y) {
    const me = this.players.get(this.myId);
    if (!me) return;
    const isMine = id === this.myId;
    const dist = Phaser.Math.Distance.Between(me.x, me.y, x, y);
    if (!isMine && dist > WHISTLE_MAX_R) return; // 최대 가청거리 밖이면 무시
    // 거리별 음량: 가까울수록 크고 멀수록 작게(내 휘파람은 최대) — 시야와 무관
    const vol = isMine ? 1 : Phaser.Math.Clamp(1 - dist / WHISTLE_MAX_R, 0.06, 1);
    this._playWhistle(vol);
    // 이펙트(🎵): 숨는이는 반경 안에서만 / 술래는 자기 휘파람만 (위치 단서 방지)
    if (isMine || (this.myRole !== 'seeker' && dist <= WHISTLE_R)) {
      this._popEmoji(x, y, '🎵');
    }
  }

  _popEmoji(x, y, emoji) {
    const txt = this.add.text(x, y - CAT_DH, emoji, { fontSize: '28px', padding: { x: 5, y: 8 } })
      .setOrigin(0.5).setDepth(DEPTH_EMOJI);
    this.tweens.add({
      targets: txt, y: y - CAT_DH - 50, alpha: { from: 1, to: 0 },
      duration: 1100, ease: 'Cubic.easeOut', onComplete: () => txt.destroy(),
    });
  }

  // ===========================================================================
  // 메인 루프
  // ===========================================================================
  update(time, delta) {
    const me = this.players.get(this.myId);
    const dt = delta / 1000;
    this._applyPostFXForState(); // 그리기 모드 진입/이탈 시 셰이더 on/off

    // [1단계] 이동 + 점프
    //   closed  : 평소 속도, 점프 가능
    //   holding : 캔버스 든 채 아주 느리게 이동(점프 불가, 캔버스 포즈 유지)
    if (me && !this.chatOpen && (!this.caught || this.ghost) && (this.drawState === 'closed' || this.drawState === 'holding')) {
      const holding = this.drawState === 'holding';
      let baseSpeed = this.myRole === 'seeker' ? SEEKER_SPEED : SPEED;
      if (time < this._slowUntil) baseSpeed *= SLOW_FACTOR; // 빗맞힘 후 둔화(술래)
      const speed = holding ? HOLD_SPEED : baseSpeed;
      let vx = 0, vy = 0;
      if (this.keys.a.isDown) vx -= 1;
      if (this.keys.d.isDown) vx += 1;
      if (this.keys.w.isDown) vy -= 1;
      if (this.keys.s.isDown) vy += 1;
      const moving = vx !== 0 || vy !== 0;

      if (moving) {
        const len = Math.hypot(vx, vy);
        // 캐릭터는 발(아래)이 기준이고 스프라이트가 위로 솟으므로, 머리가 맵 위 경계를
        // 넘지 않도록 상단 클램프를 스프라이트 높이만큼 내려준다.
        const topLimit = CAT_DH * me.scale * 0.85;
        // 축 분리 이동 + 장애물 충돌(막히면 그 축만 정지 → 벽 따라 미끄러짐)
        const nx = Phaser.Math.Clamp(me.x + (vx / len) * speed * dt, 30, this.world.width - 30);
        const ny = Phaser.Math.Clamp(me.y + (vy / len) * speed * dt, topLimit, this.world.height - 10);
        if (!this._hitObstacle(nx, me.y) && !this._podiumBlock(nx, me.y)) me.x = nx;
        if (!this._hitObstacle(me.x, ny) && !this._podiumBlock(me.x, ny)) me.y = ny;
        if (vx < 0) me.facingLeft = true;
        else if (vx > 0) me.facingLeft = false;
      }

      // 발사 반동(넉백): 쏠 때 _shoot 가 me._kbx/_kby 를 설정 → 뒤로 살짝 밀리며 감쇠
      if (me._kbx || me._kby) {
        const topLimit = CAT_DH * me.scale * 0.85;
        const nx = Phaser.Math.Clamp(me.x + me._kbx * dt, 30, this.world.width - 30);
        const ny = Phaser.Math.Clamp(me.y + me._kby * dt, topLimit, this.world.height - 10);
        if (!this._hitObstacle(nx, me.y)) me.x = nx;
        if (!this._hitObstacle(me.x, ny)) me.y = ny;
        me._kbx *= 0.8; me._kby *= 0.8;
        if (Math.abs(me._kbx) < 6 && Math.abs(me._kby) < 6) { me._kbx = 0; me._kby = 0; }
      }

      // 점프/이동 애니는 평소(closed)에만 — 캔버스 들고는 점프 불가 + 캔버스 포즈 유지
      if (!holding) {
        const ground = this._groundHeight(me.x, me.y);
        if (Phaser.Input.Keyboard.JustDown(this.keys.space)) this._actJump();
        if (me.z > ground || me.zVel > 0) {
          me.z += me.zVel * dt;
          me.zVel -= GRAVITY * dt;
          if (me.z <= ground) { me.z = ground; me.zVel = 0; }
        } else {
          me.z = ground; // 단상 위면 그 높이 유지
        }
        if (me.z > ground) me.localAnim = me.zVel > 0 ? 'jump' : 'fall';
        else me.localAnim = moving ? 'run' : 'idle'; // 세트가 술래(걸음)/숨는이 run 텍스처를 결정
      }

      const ptr = this.input.activePointer;
      this.facingAngle = Phaser.Math.Angle.Between(me.x, me.y - VIS_OFFY * me.scale, ptr.worldX, ptr.worldY);
      // 발사 중엔 쏘는(커서) 방향을 바라보게 좌우 전환(이동 입력보다 우선)
      if (this.myRole === 'seeker' && time < (me.gunShotUntil || 0)) {
        me.facingLeft = Math.cos(this.facingAngle) < 0;
      }
    }

    // 술래 로비 대기(추격 시작 전까지 가둠)
    this._applyLobby(me);
    // 강제 휘파람 카운트다운 표시
    this._applyWhistleTimer();
    // 탐색/정답 공개 카운트다운 + 정답 공개 네비게이션
    this._applyRoundTimer();
    this._updateRevealNav();
    this._applyGameOverCountdown(); // 종료 화면 로비 복귀 카운트

    // [2단계] 키 입력 (잡혀서 관전 중이면 게임 조작 잠금)
    const isSeeker = this.myRole === 'seeker';
    // 타이틀/입력창(닉네임·방이름·채팅)에 포커스 중이거나 게임 입장 전이면 게임 키 무시
    const typing = !!(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName));
    const locked = this.caught || this.gameEnded || !this.myId || typing;
    //  E = 캔버스 꺼내기/집어넣기 (숨는이 전용 — 술래는 위장 안 함)
    if (!locked && !isSeeker && Phaser.Input.Keyboard.JustDown(this.keys.e)) this._actCanvas();
    //  Q = 그리기 (술래: 꾸미기 / 숨는이: 위장)
    if (!locked && Phaser.Input.Keyboard.JustDown(this.keys.q)) this._actDraw();
    //  R = 휘파람
    if (!locked && Phaser.Input.Keyboard.JustDown(this.keys.r)) this._actWhistle();
    //  H = (숨는이) 모든 명찰/그림자 숨김 토글 — 본인 시야에만
    if (!locked && !this.chatOpen && !isSeeker &&
        Phaser.Input.Keyboard.JustDown(this.keys.h)) this._toggleTags();
    //  T = 채팅 입력창 열기 (그리는 중이 아닐 때)
    if (Phaser.Input.Keyboard.JustDown(this.keys.t) && !typing && this.myId &&
        (this.drawState === 'closed' || this.drawState === 'holding')) {
      this._openChat();
    }
    //  V = 마이크 ON/OFF · B = 음성채팅 참여 ON/OFF · − / = 볼륨
    if (this.voice && !typing && this.myId) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.v)) this.voice.toggleMic();
      if (Phaser.Input.Keyboard.JustDown(this.keys.b)) this.voice.toggle();
      if (Phaser.Input.Keyboard.JustDown(this.keys.volUp)) this.voice.adjustVolume(0.1);
      if (Phaser.Input.Keyboard.JustDown(this.keys.volDown)) this.voice.adjustVolume(-0.1);
    }
    //  거리별 음성 볼륨(약 8Hz면 충분)
    if (time - (this._lastVoiceVol || 0) > 120) {
      this._lastVoiceVol = time;
      this._updateVoiceVolumes();
    }
    //  그리기 모드 전용 키
    if (this.drawState === 'drawing') {
      if (this.keys.space.isDown && time - (this._lastPick || 0) > 60) {
        this._lastPick = time;       // Space 누르고 있으면 스포이드 지속
        this._eyedropper();
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.z)) this.board.undo();
      if (Phaser.Input.Keyboard.JustDown(this.keys.x)) this.board.redo();
      // [ ] 브러시 크기: 눌렀을 때 1회 + 누르고 있으면 반복(연타 불필요)
      const brushStep = (d) => { this.board.setBrush(this.board.brush + d); this._lastBrushAt = time; };
      if (Phaser.Input.Keyboard.JustDown(this.keys.openBracket)) brushStep(-1);
      else if (Phaser.Input.Keyboard.JustDown(this.keys.closeBracket)) brushStep(1);
      else if (time - (this._lastBrushAt || 0) > 110) {
        if (this.keys.openBracket.isDown) brushStep(-1);
        else if (this.keys.closeBracket.isDown) brushStep(1);
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) this._cancelToHold(); // 취소
    }

    // 상태 동기화(약 20Hz): 위치/높이/애니/방향 + 캔버스 들고있음 여부
    if (me && this.socket && time - this.lastSent > 50) {
      this.lastSent = time;
      // 술래는 캔버스를 들지 않음 → holding 항상 false, 편집 중엔 idle 로 표시
      let holding, anim;
      if (this.myRole === 'seeker') {
        holding = false;
        anim = this.drawState === 'closed' ? me.localAnim : 'idle';
      } else {
        holding = this.drawState === 'holding' || this.drawState === 'drawing';
        anim = this.drawState === 'closed' ? me.localAnim : 'canvas';
      }
      this.socket.emit('move', {
        x: Math.round(me.x), y: Math.round(me.y), angle: this.facingAngle,
        z: Math.round(me.z), anim, flip: me.facingLeft, holding,
      });
    }

    // ★ 2.5D 렌더
    if (this.deadGfx) this.deadGfx.clear(); // 잡힌 그림 테두리는 매 프레임 다시 그림
    // 술래의 정렬 깊이(=술래 y). 위장(그림 표시)한 숨는이만 이 아래로 눌러 술래가 항상 위.
    let seekerY = null;
    this.players.forEach((pp) => { if (pp.role === 'seeker' && !pp.caught) seekerY = pp.y; });

    this.players.forEach((p, id) => {
      if (p.caught && !p.ghost) { // 잡힘(관전 아웃): 그림은 죽은 자리 그대로 전시 + 시체는 그 아래로(살짝 겹침)
        const sc = p.scale;
        if (p.gun) p.gun.setVisible(false); // (술래는 안 잡히지만) 방어적으로 총 숨김
        if (p.gunShot) p.gunShot.setVisible(false);
        if (p.currentAnim !== '__dead') {
          p.currentAnim = '__dead';
          p.body.anims.stop();
          p.body.setTexture(p.set + '_dead');
          p.body.setOrigin(0.5, 1);
          p.body.setDisplaySize(CAT_DH * sc, CAT_DH * sc);
        }
        let corpseY = p.y; // 그림 없으면 그냥 바닥
        if (p.hasDrawing) {
          // 그림: 살아있을 때 위장 위치 그대로(이동/변형 X)
          p.skin.setOrigin(0.5, 0.5);
          p.skin.x = p.x;
          p.skin.y = p.y - p.regionCY * sc;
          p.skin.setFlipX(false);
          p.skin.setDepth(p.y); // 그림은 뒤
          p.skin.setVisible(true);
          // 남은 그림 테두리(위치 표시): 그림 영역에 프레임
          if (this.deadGfx) {
            const w = p.regionW * sc, h = p.regionH * sc;
            const bx = p.x - w / 2, by = (p.y - p.regionCY * sc) - h / 2;
            this.deadGfx.lineStyle(2, 0xffd83b, 0.5).strokeRect(bx, by, w, h); // 노란 테두리(투명도 50%)
          }
          // 시체: 그림 아래로 내리되 머리만 그림 밑단과 살짝 겹치게
          const drawBottom = p.y - p.regionCY * sc + (p.regionH * sc) / 2;
          corpseY = drawBottom - 58 + HEAD_OFF * sc; // 더 많이 겹침
        } else {
          p.skin.setVisible(false);
        }
        p.body.x = p.x; p.body.y = corpseY;
        p.body.setFlipX(false);
        p.body.setDepth(p.y + 0.3); // 시체가 그림보다 앞
        p.body.setVisible(true);
        p.shadow.x = p.x; p.shadow.y = corpseY - FEET_OFF * sc + 12;
        p.shadow.setScale(1);
        p.shadow.setVisible(true);
        // 시체에도 닉네임 표시(머리 위)
        p.label.x = p.x;
        p.label.y = corpseY - 64 * sc;
        p.label.setColor('#9aa0ab'); // 죽은 사람 이름은 회색
        p.label.setDepth(p.y + 0.5);
        p.label.setVisible(true);
        return;
      }
      if (id !== this.myId) {
        p.x = Phaser.Math.Linear(p.x, p.target.x, 0.25);
        p.y = Phaser.Math.Linear(p.y, p.target.y, 0.25);
        if (p.holding) {
          this._setAnim(p, 'canvas'); // 캔버스 들고 멈춤(마지막 프레임 유지)
        } else {
          this._setAnim(p, p.anim);
        }
      } else if (this.drawState === 'closed') {
        // 캔버스 세션 중엔 _takeOut/_putAway 가 body 애니를 직접 제어 → 덮어쓰기 금지
        this._setAnim(p, p.localAnim);
      }

      // 술래: 발사 중엔 점프/낙하 포즈를 잠깐 서있는(이동) 포즈로 → 총 오버레이와 정렬
      if (p.role === 'seeker' && time < (p.gunShotUntil || 0)) {
        const a = id === this.myId ? p.localAnim : p.anim;
        if (a === 'jump' || a === 'fall') this._setAnim(p, 'run');
      }

      const off = p.z || 0;
      p.body.x = p.x;
      p.body.y = p.y - off;
      // 캔버스를 든/그리는 동안엔 본체도 뒤집지 않음 → 그림과 항상 같은 방향
      const inCanvas = id === this.myId ? this.drawState !== 'closed' : p.holding;
      p.body.setFlipX(inCanvas ? false : p.facingLeft);
      p.body.setDepth(p.y);

      // 그림 오버레이: 몸통 중심에 맞춤, 살짝 위 depth
      p.skin.x = p.x;
      p.skin.y = p.y - p.regionCY * p.scale - off;
      p.skin.setDepth(p.y + 0.05);
      if (p.role === 'seeker') {
        // 술래: 코스튬처럼 항상 표시 + 캐릭터와 함께 좌우반전 (편집 중인 본인은 숨김)
        const editingSelf = id === this.myId && this.drawState === 'drawing';
        p.skin.setVisible(p.hasDrawing && !editingSelf);
        p.skin.setFlipX(p.facingLeft);
      } else {
        // 숨는이: 캔버스를 들고 있을 때만 표시, 방향 고정(안 뒤집힘)
        const holdingShown = id === this.myId ? this.drawState === 'holding' : p.holding;
        p.skin.setVisible(holdingShown && p.hasDrawing);
        p.skin.setFlipX(false);
      }

      // 위장(그림 표시) 중인 숨는이는 술래보다 뒤로 눌러, 술래가 무빙만으로 들키는 것을 방지.
      // 단, 가로로 가까운(겹칠 수 있는) 술래에게만 적용 — 멀리 있는 술래의 y 때문에 깊이가
      // 과하게 낮아져 사이의 오브젝트를 뚫고 뒤로 가는 버그를 막는다.
      if (p.role === 'hider' && p.skin.visible) {
        let ny = null, bestDx = Infinity;
        this.players.forEach((s) => {
          if (s.role !== 'seeker' || s.caught) return;
          const dx = Math.abs(s.x - p.x);
          if (dx < bestDx) { bestDx = dx; ny = s.y; }
        });
        if (ny != null && bestDx < 100) {
          const dep = Math.min(p.y, ny - 1);
          p.body.setDepth(dep);
          p.skin.setDepth(dep + 0.05);
        }
      }

      // 술래 총 오버레이: 몸/코스튬 위에 한 겹 더 (발사 중엔 gun_moving 위에 gun_shot 동시 표시)
      if (p.gun) {
        const editingSelf = id === this.myId && this.drawState !== 'closed';
        const firing = time < (p.gunShotUntil || 0);
        if (editingSelf) {
          p.gun.setVisible(false); // 꾸미기 중엔 가림(그리는 부위 안 가리게)
          if (p.gunShot) p.gunShot.setVisible(false);
        } else {
          const animState = id === this.myId ? p.localAnim : p.anim;
          // 베이스: 이동 중이거나 발사 중이면 gun_moving, 그 외 gun_idle
          const baseTex = (animState !== 'idle' || firing) ? 'gun_moving' : 'gun_idle';
          if (p.gun.texture.key !== baseTex) p.gun.setTexture(baseTex);
          p.gun.x = p.x;
          p.gun.y = p.y - off;
          p.gun.setFlipX(p.facingLeft);
          p.gun.setDepth(p.y + 0.25); // gun_moving(베이스)이 gun_shot 보다 위
          p.gun.setVisible(true);
          // 발사 중: gun_shot 을 베이스 아래에 겹쳐 '동시에' 표시 (gun_moving 이 위)
          if (p.gunShot) {
            if (firing) {
              p.gunShot.x = p.x;
              p.gunShot.y = p.y - off;
              p.gunShot.setFlipX(p.facingLeft);
              p.gunShot.setDepth(p.y + 0.2);
              p.gunShot.setVisible(true);
            } else {
              p.gunShot.setVisible(false);
            }
          }
        }
      }

      // 그림자: 실제 발에서 아래로 살짝 띄움
      // 단상 위면 그림자도 그 높이로, 단 서서히(오르내릴 때 부드럽게)
      const sg = this._groundHeight(p.x, p.y);
      p._shadowG = Phaser.Math.Linear(p._shadowG || 0, sg, 0.12);
      p.shadow.x = p.x; p.shadow.y = p.y - p._shadowG - FEET_OFF * p.scale + 12;
      p.shadow.setDepth(sg > 0 ? (4416 - 54) : DEPTH_SHADOW); // 단상 위면 발판보다 앞에(안 가려지게)
      p.shadow.setScale(Phaser.Math.Clamp(1 - (off - sg) * 0.012, 0.45, 1)); // 단상 높이는 빼고 점프 높이만 반영

      // 명찰: 실제 머리 위로 띄움(캐릭터가 커져도 안 겹치게)
      p.label.x = p.x;
      p.label.y = p.y - HEAD_OFF * p.scale - 22 - off;
      p.label.setDepth(p.y + 0.1);

      // 방장 'host' 표기: 명찰 위쪽 가운데에 띄워 따라다님(대기실에서만 존재)
      if (p.hostTag) {
        p.hostTag.x = p.label.x;
        p.hostTag.y = p.label.y - p.label.height / 2 - p.hostTag.height / 2 - 1;
        p.hostTag.setDepth(p.y + 0.11);
      }

      // 채팅 말풍선: 사라진 명찰 자리를 대신하도록 꼬리 끝을 명찰 하단(머리쪽)에 맞춤(표시 여부는 아래에서)
      if (p.bubble) {
        p.bubble.x = p.x;
        p.bubble.y = p.label.y + p.label.height / 2;
        p.bubble.setDepth(p.y + 0.2);
      }

      // 명찰 표시 여부(본인 시야에만 적용):
      //  · 술래  → 남(숨는이)의 명찰은 숨김(본인 것만 표시)
      //  · 숨는이 → H 토글(_hideTags) 시 모든 사람 숨김
      const tagShow = this.myRole === 'seeker'
        ? (id === this.myId || p.role === 'seeker')
        : !this._hideTags;
      p.label.setVisible(tagShow);
      if (p.hostTag) p.hostTag.setVisible(tagShow);

      // 그림자: 캔버스(위장)를 꺼낸 동안에만 사라짐 — 그 외엔 술래에게도 항상 보임
      const canvasOut = id === this.myId
        ? (this.drawState === 'holding' || this.drawState === 'drawing')
        : p.holding;
      p.shadow.setVisible(!canvasOut);

      // 유령(휘파람/기본 사망): 흑백+반투명. 죽은 사람끼리만 보임 / 정답 공개(revealed)면 모두에게 보임. 명찰·그림자 없음
      const ghostShown = (id === this.myId) || this.caught || p.revealed; // 이 유령이 내 시야에 보이는지
      if (p.ghost) {
        p.body.setTint(0x5a5a5a).setAlpha(ghostShown ? 0.4 : 0);
        if (p.skin) p.skin.setAlpha(ghostShown ? 0.4 : 0);
        p.shadow.setVisible(false);
        p.label.setVisible(false);
      }

      // 말풍선 노출 규칙 + 4초 후 사라짐:
      //  · 살아있는 캐릭터 → 명찰과 동일(술래엔 숨김 + H 토글). 떠 있는 동안 명찰 대신 표시
      //  · 유령(사망)     → 유령끼리만(유령 본체가 보일 때만) 표시
      const bubbleVisible = p.ghost ? ghostShown : p.label.visible;
      const bubbleOn = !!p.bubble && bubbleVisible && Date.now() <= (p.bubbleUntil || 0);
      if (p.bubble) p.bubble.setVisible(bubbleOn);
      if (bubbleOn && !p.ghost) { // 유령은 명찰이 이미 없으니 가릴 명찰도 없음
        p.label.setVisible(false);
        if (p.hostTag) p.hostTag.setVisible(false);
      }
    });

    if (me) this.cameraTarget.setPosition(me.x, me.y - VIS_OFFY * me.scale);

    // 재장전 바: 로컬 술래가 쿨다운 중일 때 발밑에 진행도 표시(가득 차면 사라짐 = 발사 가능)
    if (this.reloadGfx) {
      if (me && this.myRole === 'seeker' && !this.caught && this._gunCdFrom != null && time < this._gunCdUntil) {
        const dur = Math.max(1, this._gunCdUntil - this._gunCdFrom);
        const prog = Phaser.Math.Clamp((time - this._gunCdFrom) / dur, 0, 1);
        const w = 46, h = 6;
        const bx = Math.round(me.x - w / 2), by = Math.round(me.y + 10);
        this.reloadGfx.clear();
        this.reloadGfx.fillStyle(0x0a0c14, 0.95).fillRect(bx - 2, by - 2, w + 4, h + 4); // 테두리
        this.reloadGfx.fillStyle(0x232a3d, 1).fillRect(bx, by, w, h);                     // 트랙
        this.reloadGfx.fillStyle(0xffd83b, 1).fillRect(bx, by, Math.round(w * prog), h);  // 채움
        this.reloadGfx.setVisible(true);
      } else {
        this.reloadGfx.setVisible(false);
      }
    }

    // 위장(E) 버튼: 위장 중(holding)이면 '위장취소'로 라벨 전환
    if (this._canvasLblEl) {
      const t = this.drawState === 'holding' ? '위장취소' : '위장';
      if (this._canvasLblEl.textContent !== t) this._canvasLblEl.textContent = t;
    }

    // [2단계] 그리기 오버레이(캐릭터 위 격자) — 'drawing' 상태에서만
    if (this.drawState === 'drawing' && me) {
      this._renderDrawOverlay(me);
    }

    // 커스텀 포인터(술래=크로스헤어 / 숨는이=cursor): 평소 표시, 그리기/잡힘/게임종료 시엔 숨김
    if (this._cursorEl && this.myRole) {
      const show = !this.caught && !this.gameEnded
        && this.drawState === 'closed' && !this.board.isOpen();
      if (show !== this._cursorShown) {
        this._cursorShown = show;
        this._cursorEl.style.display = show ? 'block' : 'none';
        document.body.classList.toggle('cursor-hidden', show);
        if (!show && this._rangeEl && this._rangeShown) {  // 커서 숨길 땐 사거리 마커도 숨김
          this._rangeShown = false; this._rangeEl.style.display = 'none';
        }
      }
      // 술래: 조준점이 술래 기점 사거리(GUN_RANGE) 밖이면…
      //  · 마우스 커서 → crosshairs2.png (못 닿음 표시)
      //  · 사거리 끝(실제 탄착 지점) → 원래 크로스헤어 마커 표시
      if (show && this.myRole === 'seeker' && me) {
        const off = me.z || 0;
        const oy = me.y - VIS_OFFY * me.scale - off;   // _shoot 와 동일한 조준 원점
        const ptr = this.input.activePointer;
        const dx = ptr.worldX - me.x, dy = ptr.worldY - oy;
        const dist = Math.hypot(dx, dy) || 1;
        const out = dist > GUN_RANGE;
        if (out !== this._cursorOut) {
          this._cursorOut = out;
          this._cursorEl.style.backgroundImage = `url('ui/${out ? 'crosshairs2' : 'crosshairs'}.png')`;
        }
        if (this._rangeEl) {
          if (out) {
            // 사거리 끝 지점(월드) → 화면 좌표 변환(zoom=1: world - scroll)
            const k = GUN_RANGE / dist;
            const cam = this.cameras.main;
            this._rangeEl.style.left = (me.x + dx * k - cam.scrollX) + 'px';
            this._rangeEl.style.top = (oy + dy * k - cam.scrollY) + 'px';
            if (!this._rangeShown) { this._rangeShown = true; this._rangeEl.style.display = 'block'; }
          } else if (this._rangeShown) {
            this._rangeShown = false; this._rangeEl.style.display = 'none';
          }
        }
      }
    }

    // 오브젝트(나무/덤불) 반투명: '내 캐릭터' 주변 작은 원형 반경 안에 들면 살짝 비치게
    //  (본인 시야에만 — 남의 위치가 오브젝트 투명으로 드러나지 않게)
    if (this.map && this.map.objects) {
      const objs = this.map.objects;
      const R2 = 70 * 70; // 투명해지는 반경(작게)
      const near = me && !this.caught;
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        let hide = false;
        if (near) {
          const dx = me.x - o.x, dy = me.y - o.y;
          hide = dx * dx + dy * dy < R2;
        }
        const tgt = hide ? 0.4 : 1;
        o.img.alpha += (tgt - o.img.alpha) * 0.2; // 부드럽게 전환
      }
    }
  }
}
