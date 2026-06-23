// =============================================================================
// main.js  -  [1단계] Phaser 3 기본 세팅 (부팅)
// =============================================================================
import { GameScene } from './GameScene.js';
import { ChromaticAberrationPostFX } from './PostFX.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: '#0b0d12',
  pixelArt: true, // 픽셀아트 텍스처를 또렷하게(nearest 스케일)
  scale: {
    mode: Phaser.Scale.RESIZE,        // 브라우저 창에 꽉 차게
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  // 커스텀 포스트 셰이더(색수차) 등록 — 카메라에서 setPostPipeline 으로 사용
  pipeline: [ChromaticAberrationPostFX],
  scene: [GameScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
