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

const SPEED = 240;        // 이동 속도(px/s)
const SEEKER_SPEED = 360; // 술래 이동 속도(1.5배)
const HOLD_SPEED = 55;    // 캔버스 든 채 이동 속도(매우 느림)
const JUMP_VEL = 380;     // 점프 초기 상승 속도(z, px/s)
const GRAVITY = 1200;     // 중력(z, px/s^2)
const CONE_HALF = Phaser.Math.DEG_TO_RAD * 45; // 부채꼴 반각(전체 90도)
const CONE_R = 780;       // 시야 거리(가시거리 더 늘림)
const NEAR_R = 180;       // 술래 주변 항상 보이는 반경 — 커진 캐릭터를 안 가리게
const WHISTLE_R = 420;
const ROLE_COLOR = { seeker: 0xff5a5a, hider: 0x5fe08a };
const HIDER_SETS = ['gray', 'lemon', 'orange']; // 숨는이 색 세트(랜덤 배정)

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
    // 숨는이: HIDER/<색> 3종(gray/lemon/orange), 구조 동일
    HIDER_SETS.forEach((c) => {
      const H = 'character/HIDER/' + c + '/';
      this.load.spritesheet(c + '_idle', H + '1_Cat_Idle-Sheet.png', F);
      this.load.spritesheet(c + '_run', H + '2_Cat_Run-Sheet.png', F);
      this.load.spritesheet(c + '_jump', H + '3_Cat_Jump-Sheet.png', F);
      this.load.spritesheet(c + '_fall', H + '4_Cat_Fall-Sheet.png', F);
      this.load.spritesheet(c + '_canvas', H + '5_Cat_Canvas-Sheet.png', F);
    });
  }

  create() {
    this.world = { width: 1600, height: 1200 };
    this.players = new Map();
    this.props = [];
    this.myId = null;
    this.myRole = null;
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

    this._makeAnims();
    this._makePropTextures();
    this._drawBackground();
    this._spawnProps();

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
    }, false); // capture 끔 → 채팅 입력창에 글자가 정상 입력되도록

    this._setupChat();

    // 우클릭(지우개) 시 브라우저 메뉴 방지
    this.input.mouse.disableContextMenu();

    // [2단계] 캐릭터 위 페인팅: 도구막대 + 포인터 입력
    this.board = new DrawingBoard({
      onApply: () => this._applyAndHold(),
      onClose: () => this._cancelToHold(),
    });
    this.drawGfx = this.add.graphics().setDepth(DEPTH_DRAW).setVisible(false);

    this._lastCell = null;      // 빠르게 움직일 때 점 끊김 방지용(직전 칠한 셀)
    this._strokeDirty = false;  // 이번 스트로크에서 실제로 칠했는지
    this._eyedropMode = false;  // 스포이드 버튼 모드
    this.input.on('pointerdown', (ptr) => {
      if (this.chatOpen) { this.chatInput.blur(); return; } // 게임(캔버스) 클릭 시 채팅 해제
      if (!this.board.isOpen()) return;
      if (this._eyedropMode) { this._eyedropper(); this._setEyedrop(false); return; } // 클릭=색 추출
      this._lastCell = null;    // 새 스트로크 시작(이전 획과 연결 안 함)
      this._strokeDirty = false;
      this._paintPointer(ptr);
    });
    this.input.on('pointermove', (ptr) => {
      if (this.board.isOpen() && !this._eyedropMode && ptr.isDown) this._paintPointer(ptr);
    });
    this.input.on('pointerup', () => {
      if (this.board.isOpen() && this._strokeDirty) this.board.pushHistory(); // 한 획 = 되돌리기 1단계
      this._strokeDirty = false;
      this._lastCell = null;
    });

    // 스포이드 버튼: 누르면 찍기 모드 토글, 캔버스 클릭하면 색 추출
    const pickBtn = document.getElementById('btn-pick');
    if (pickBtn) pickBtn.addEventListener('click', () => this._setEyedrop(!this._eyedropMode));

    this._setupVision();   // [4단계]
    this._setupNetwork();  // [3단계]

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

  _drawBackground() {
    const g = this.add.graphics().setDepth(DEPTH_BG);
    g.fillStyle(0x171b24, 1);
    g.fillRect(0, 0, this.world.width, this.world.height);
    g.lineStyle(1, 0x222838, 1);
    const step = 64;
    for (let x = 0; x <= this.world.width; x += step) g.lineBetween(x, 0, x, this.world.height);
    for (let y = 0; y <= this.world.height; y += step) g.lineBetween(0, y, this.world.width, y);
    g.lineStyle(6, 0x3a4356, 1);
    g.strokeRect(0, 0, this.world.width, this.world.height);
  }

  _spawnProps() {
    const layout = [
      { tex: 'propPillar', x: 420, y: 360 }, { tex: 'propPillar', x: 1180, y: 360 },
      { tex: 'propPillar', x: 420, y: 880 }, { tex: 'propPillar', x: 1180, y: 880 },
      { tex: 'propCrate', x: 700, y: 500 }, { tex: 'propCrate', x: 760, y: 520 },
      { tex: 'propCrate', x: 980, y: 760 },
      { tex: 'propPlant', x: 560, y: 640 }, { tex: 'propPlant', x: 1040, y: 460 },
      { tex: 'propPlant', x: 820, y: 940 },
    ];
    layout.forEach((o) => {
      this.add.ellipse(o.x, o.y, 40, 14, 0x000000, 0.28).setDepth(DEPTH_SHADOW);
      this.props.push(this.add.image(o.x, o.y, o.tex).setOrigin(0.5, 1).setDepth(o.y));
    });
  }

  // ===========================================================================
  // [4단계] 시야 시스템
  // ===========================================================================
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
      if (id === this.myId) return;
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
    const cx = Math.floor((ptr.worldX - left) / cellW);
    const cy = Math.floor((ptr.worldY - top) / cellH);
    const erase = ptr.rightButtonDown();

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
    r.snapshotPixel(px, py, (color) => {
      const hex = '#' + [color.red, color.green, color.blue]
        .map((v) => v.toString(16).padStart(2, '0')).join('');
      this.board.pickColor(hex);
    });
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
  _setupNetwork() {
    const socket = io();
    this.socket = socket;
    const params = new URLSearchParams(location.search);
    const roomId = params.get('room') || 'lobby';

    socket.on('connect', () => socket.emit('joinRoom', { roomId }));

    socket.on('init', ({ id, role, world, players }) => {
      this.myId = id;
      this.myRole = role;
      if (world) this.world = world;
      players.forEach((p) => this._addPlayer(p));
      this._updateRoleBadge();
      if (role === 'seeker') this.fog.setVisible(true);
    });

    socket.on('playerJoined', (p) => this._addPlayer(p));

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
    socket.on('chatMessage', ({ id, name, text }) => this._addChatMessage(name, text, id === this.myId));

    socket.on('playerLeft', ({ id }) => {
      const p = this.players.get(id);
      if (!p) return;
      p.body.destroy();
      p.skin.destroy();
      p.shadow.destroy();
      p.label.destroy();
      this.players.delete(id);
    });
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

    const isMe = info.id === this.myId;
    const label = this.add.text(0, 0, info.name, {
      fontFamily: 'monospace', fontSize: '16px',
      // 본인=노랑, 술래(남이 볼 때)=빨강, 그 외=흰색 (색으로 구분)
      color: isMe ? '#ffd83b' : (isSeekerP ? '#ff5a5a' : '#e7e9ee'),
      backgroundColor: 'rgba(0,0,0,0.4)', padding: { x: 5, y: 2 },
    }).setOrigin(0.5);

    const p = {
      id: info.id, role: info.role, name: info.name,
      set, scale, regionW, regionH, regionCY,
      shadow, body, skin, label,
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
      hasDrawing: false,
      skinDataURL: null,
    };
    this.players.set(info.id, p);

    if (info.dataURL) this.applyDrawing(info.id, info.dataURL);
  }

  _updateRoleBadge() {
    const badge = document.getElementById('role-badge');
    if (!badge) return;
    if (this.myRole === 'seeker') {
      badge.textContent = '🔦 술래 (SEEKER) — 부채꼴 시야로 찾아라';
      badge.className = 'seeker';
    } else {
      badge.textContent = '🫥 숨는이 (HIDER) — 위장하고 숨어라';
      badge.className = 'hider';
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

  _playWhistle() {
    this._ensureAudio();
    const ctx = this.audioCtx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(1750, t + 0.14);
    o.frequency.exponentialRampToValueAtTime(1150, t + 0.30);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.45);
  }

  _onWhistle(id, x, y) {
    const me = this.players.get(this.myId);
    if (!me) return;
    if (Phaser.Math.Distance.Between(me.x, me.y, x, y) > WHISTLE_R) return;
    this._playWhistle();
    this._popEmoji(x, y, '🎵');
  }

  _popEmoji(x, y, emoji) {
    const txt = this.add.text(x, y - CAT_DH, emoji, { fontSize: '28px' })
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

    // [1단계] 이동 + 점프
    //   closed  : 평소 속도, 점프 가능
    //   holding : 캔버스 든 채 아주 느리게 이동(점프 불가, 캔버스 포즈 유지)
    if (me && !this.chatOpen && (this.drawState === 'closed' || this.drawState === 'holding')) {
      const holding = this.drawState === 'holding';
      const baseSpeed = this.myRole === 'seeker' ? SEEKER_SPEED : SPEED;
      const speed = holding ? HOLD_SPEED : baseSpeed;
      let vx = 0, vy = 0;
      if (this.keys.a.isDown) vx -= 1;
      if (this.keys.d.isDown) vx += 1;
      if (this.keys.w.isDown) vy -= 1;
      if (this.keys.s.isDown) vy += 1;
      const moving = vx !== 0 || vy !== 0;

      if (moving) {
        const len = Math.hypot(vx, vy);
        me.x = Phaser.Math.Clamp(me.x + (vx / len) * speed * dt, 30, this.world.width - 30);
        me.y = Phaser.Math.Clamp(me.y + (vy / len) * speed * dt, 40, this.world.height - 10);
        if (vx < 0) me.facingLeft = true;
        else if (vx > 0) me.facingLeft = false;
      }

      // 점프/이동 애니는 평소(closed)에만 — 캔버스 들고는 점프 불가 + 캔버스 포즈 유지
      if (!holding) {
        if (Phaser.Input.Keyboard.JustDown(this.keys.space) && me.z === 0) {
          me.zVel = JUMP_VEL;
        }
        if (me.z > 0 || me.zVel > 0) {
          me.z += me.zVel * dt;
          me.zVel -= GRAVITY * dt;
          if (me.z <= 0) { me.z = 0; me.zVel = 0; }
        }
        if (me.z > 0) me.localAnim = me.zVel > 0 ? 'jump' : 'fall';
        else me.localAnim = moving ? 'run' : 'idle'; // 세트가 술래(걸음)/숨는이 run 텍스처를 결정
      }

      const ptr = this.input.activePointer;
      this.facingAngle = Phaser.Math.Angle.Between(me.x, me.y - VIS_OFFY * me.scale, ptr.worldX, ptr.worldY);
    }

    // [2단계] 키 입력
    const isSeeker = this.myRole === 'seeker';
    //  E = 캔버스 꺼내기/집어넣기 (숨는이 전용 — 술래는 위장 안 함)
    if (!isSeeker && Phaser.Input.Keyboard.JustDown(this.keys.e)) {
      if (this.drawState === 'closed') this._takeOut('hold');
      else if (this.drawState === 'holding') this._putAway();
    }
    //  Q = 그리기
    //   술래: 캐릭터 꾸미기(바로 편집 → 적용하면 코스튬으로 항상 표시)
    //   숨는이: 캔버스 꺼내 그리기(위장)
    if (Phaser.Input.Keyboard.JustDown(this.keys.q)) {
      if (isSeeker) {
        if (this.drawState === 'closed') this._openEditor();
        else if (this.drawState === 'drawing') this._applyAndHold();
      } else {
        if (this.drawState === 'closed') this._takeOut('draw');
        else if (this.drawState === 'holding') this._openEditor();
        else if (this.drawState === 'drawing') this._applyAndHold();
      }
    }
    //  R = 휘파람 (이동/들고있을 때만)
    if (Phaser.Input.Keyboard.JustDown(this.keys.r) && me) {
      if (this.drawState === 'closed' || this.drawState === 'holding') {
        this._ensureAudio();
        if (this.socket) this.socket.emit('whistle', { x: Math.round(me.x), y: Math.round(me.y) });
      }
    }
    //  T = 채팅 입력창 열기 (그리는 중이 아닐 때)
    if (Phaser.Input.Keyboard.JustDown(this.keys.t) &&
        (this.drawState === 'closed' || this.drawState === 'holding')) {
      this._openChat();
    }
    //  그리기 모드 전용 키
    if (this.drawState === 'drawing') {
      if (this.keys.space.isDown && time - (this._lastPick || 0) > 60) {
        this._lastPick = time;       // Space 누르고 있으면 스포이드 지속
        this._eyedropper();
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.z)) this.board.undo();
      if (Phaser.Input.Keyboard.JustDown(this.keys.x)) this.board.redo();
      if (Phaser.Input.Keyboard.JustDown(this.keys.openBracket)) this.board.setBrush(this.board.brush - 1);
      if (Phaser.Input.Keyboard.JustDown(this.keys.closeBracket)) this.board.setBrush(this.board.brush + 1);
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
    this.players.forEach((p, id) => {
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

      // 그림자: 실제 발에서 아래로 살짝 띄움
      p.shadow.x = p.x; p.shadow.y = p.y - FEET_OFF * p.scale + 12;
      p.shadow.setScale(Phaser.Math.Clamp(1 - off * 0.012, 0.45, 1));

      // 명찰: 실제 머리 위로 띄움(캐릭터가 커져도 안 겹치게)
      p.label.x = p.x;
      p.label.y = p.y - HEAD_OFF * p.scale - 22 - off;
      p.label.setDepth(p.y + 0.1);
    });

    if (me) this.cameraTarget.setPosition(me.x, me.y - VIS_OFFY * me.scale);

    // [2단계] 그리기 오버레이(캐릭터 위 격자) — 'drawing' 상태에서만
    if (this.drawState === 'drawing' && me) {
      this._renderDrawOverlay(me);
    }

    // [4단계] 술래 시야 + 안개
    //  - 평소 줌(≈1): 안개 보이고 부채꼴 시야 갱신
    //  - 그리기 줌인 중: 시야 고정. 충분히 확대(≈최대)됐을 때만 안개를 걷음
    //    → 주변이 화면 밖으로 벗어났을 때만 걷어, 맵은 안 드러나고 캐릭터만 잘 보이게
    if (this.myRole === 'seeker' && me && this.fog) {
      const zoom = this.cameras.main.zoom;
      if (zoom <= 1.05) {
        this.fog.setVisible(true);
        this._updateVision(me);
      } else {
        this.fog.setVisible(zoom < DRAW_ZOOM * 0.85); // 거의 다 확대되면 안개 숨김
      }
    }
  }
}
