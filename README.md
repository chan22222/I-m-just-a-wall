# imjustawall 🧱🎨

Phaser 3 기반 2.5D 탑뷰 숨바꼭질 게임 (어몽어스 / Goose Goose Duck 느낌).
**자기 캐릭터에 직접 픽셀아트를 그려서 위장하고**, 술래는 **부채꼴 시야**로 숨은 사람을 찾는다.

## 실행

```bash
npm install
npm start
# 브라우저에서 http://localhost:3000 접속
```

멀티플레이 테스트는 **창 두 개**(또는 시크릿창)로 같은 주소를 열면 된다.
방을 나누려면 `?room=방이름` 쿼리를 붙인다. 예) `http://localhost:3000/?room=test`

- 같은 방의 **첫 번째 접속자 = 술래(seeker)**, 나머지는 **숨는이(hider)** 로 자동 배정.

## 조작

| 키 | 동작 |
|----|------|
| `WASD` | 이동 |
| `Q` | 위장(그리기) 모드 열기/닫기 |
| `E` | 휘파람 (반경 안 사람에게 소리+🎵) · 그림판이 열려 있을 땐 그림 적용 |
| `Space` | 점프 (2.5D 높이축 hop) |
| 마우스 | 술래 시야 방향 |

캐릭터는 `public/character/`의 고양이 스프라이트시트(Idle/Run/Jump/Fall, 32×32)로 애니메이션된다. 이동하면 Run, 멈추면 Idle, 점프하면 Jump→Fall.

그림판: 왼쪽 캔버스에 드래그로 픽셀을 칠하고, **우클릭=지우개**. [적용]을 누르면 내 캐릭터가 그 그림으로 바뀌고 다른 사람 화면에도 동기화된다.

## 단계별 구현 위치

요청한 5단계가 코드에 그대로 매핑되어 있다.

1. **Phaser 기본 세팅 + WASD** — `public/js/main.js`, `GameScene.create()` / `update()` 의 이동 블록
2. **그리기 시스템** — `public/js/DrawingBoard.js`, `GameScene.applyDrawing()`
3. **멀티플레이 (Node.js + Socket.io)** — `server.js`, `GameScene._setupNetwork()`
4. **시야 시스템 (술래 부채꼴 마스킹)** — `GameScene._setupVision()` / `_updateVision()`
5. **부가 기능 (휘파람 + 이모티콘)** — `GameScene._onWhistle()` / `_playWhistle()` / `_popEmoji()`

## 기술 메모

- 시야는 `RenderTexture` 를 화면 전체 어둠으로 채운 뒤, 매 프레임 부채꼴 스탬프를 `erase()` 해 구멍을 내는 방식. 숨은 사람 노출 판정은 월드 좌표 부채꼴 `Phaser.Geom.Polygon.Contains` 로 한다.
- 위장 그림은 16×16 PNG `dataURL` 로 전송되어 `textures.addImage()` 로 캐릭터 텍스처에 입혀진다.
- 휘파람 소리는 에셋 파일 없이 Web Audio `OscillatorNode` 로 생성한다.
