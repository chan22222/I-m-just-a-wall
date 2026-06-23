# imjustawall 🧱🎨

Phaser 3 기반 2.5D 탑뷰 숨바꼭질 게임 (어몽어스 / Goose Goose Duck 느낌).
**자기 캐릭터(고양이)에 직접 픽셀아트를 그려 캔버스로 위장**하고, 술래는 **부채꼴 시야**로 숨은 사람을 찾는다.

## 실행

```bash
npm install
npm start
# 브라우저에서 http://localhost:3000 접속
```

멀티플레이 테스트는 **창 두 개**(또는 시크릿창)로 같은 주소를 열면 된다.
방을 나누려면 `?room=방이름` 쿼리를 붙인다. 예) `http://localhost:3000/?room=test`

## 조작

| 키 | 동작 |
|----|------|
| `WASD` | 이동 |
| `E` | 캔버스 꺼내기 / 집어넣기 (들면 멈춰서 위장 · 아주 느리게만 이동 가능) |
| `Q` | 캔버스에 그리기(편집) — 캐릭터로 줌인되어 격자에 그림 |
| `R` | 휘파람 (반경 안 사람에게 소리 + 🎵) |
| `Space` | 점프 (2.5D 높이축 hop · 캔버스 든 상태에선 불가) |
| 마우스 | 술래 시야 방향 |

캐릭터는 `public/character/`의 고양이 스프라이트시트(Idle/Run/Jump/Fall/Canvas, 32×32)로 애니메이션된다.

## 그리기 / 위장

- `Q`를 누르면 고양이가 캔버스를 꺼내는 애니메이션 후, 카메라가 캐릭터로 줌인되고 캐릭터 위에 격자가 뜬다.
- 마우스로 격자(= 캐릭터 영역) 안에 픽셀을 칠한다. **우클릭 = 지우개**. 빠르게 드래그해도 선이 끊기지 않는다.
- `Q`(또는 [적용])로 반영, [취소]로 되돌린다. 다 지우고 적용하면 위장이 해제된다.
- 그림은 고양이를 *교체*하지 않고 **위에 덧입히는 오버레이**다. 그래서 그림이 없거나 캔버스를 집어넣으면 고양이 본체가 그대로 보인다.
- **캔버스를 든 상태에서만** 위장 그림이 보이며, 멀티플레이로 동기화된다.

## 단계별 구현 위치

1. **Phaser 기본 세팅 + WASD** — `public/js/main.js`, `GameScene` 의 `create()` / `update()` 이동 블록
2. **그리기 시스템** — `public/js/DrawingBoard.js`(색/브러시·그림 데이터), `GameScene._paintPointer()` / `applyDrawing()`
3. **멀티플레이 (Node.js + Socket.io)** — `server.js`, `GameScene._setupNetwork()`
4. **시야 시스템 (술래 부채꼴 마스킹)** — `GameScene._setupVision()` / `_updateVision()`
5. **부가 기능 (휘파람 + 이모티콘)** — `GameScene._onWhistle()` / `_playWhistle()` / `_popEmoji()`

## 기술 메모

- 시야: `RenderTexture`를 어둠으로 채운 뒤, 가장자리가 흐린(블러+그라데이션) 빛 텍스처를 `erase()`해 부채꼴 구멍을 낸다. 시야 밖은 숨기지 않고 어둠으로만 가린다.
- 위장 그림: 32×32 PNG `dataURL`로 전송되어 `textures.addImage()`로 오버레이 스프라이트에 입혀진다.
- 휘파람: 에셋 파일 없이 Web Audio `OscillatorNode`로 생성한다.
