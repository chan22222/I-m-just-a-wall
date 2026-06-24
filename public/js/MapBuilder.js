// =============================================================================
// MapBuilder.js  -  SproutLands 타일 기반 "군도(섬)" 맵 생성
//   · 물을 베이스로 깔고 잔디 섬 여러 개를 띄운다(섬 위에서만 플레이)
//   · 섬 경계/호수는 8방향 autotile 로 불규칙한 자연 물가
//   · 맵 가장자리·모서리는 항상 물 → 셰이더 그림자 사각지대 차단
//   · 충돌은 land 마스크 기반(물=통과 불가) + 나무/덤불 밑동 박스
//   맵은 고정 시드 PRNG → 모든 클라이언트가 동일한 섬 배치를 본다.
// =============================================================================

const TS = 16;          // 원본 타일 크기(px)
const SCALE = 4;        // 4배 확대(타일/오브젝트를 큼직하게)
const T = TS * SCALE;   // 화면상 타일 크기(64px)

export class MapBuilder {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = [];
    this.objects = [];   // 반투명 처리용 오브젝트(나무/덤불 등)
    this.landMask = null;
    this.tile = T;
  }

  build(world) {
    const s = this.scene;
    const COLS = Math.ceil(world.width / T);
    const ROWS = Math.ceil(world.height / T);
    this.cols = COLS; this.rows = ROWS;

    // 고정 시드 PRNG
    let seed = 20240625;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    // 블롭(원) — 각도별 반경 노이즈로 불규칙한 경계
    const mkBlobs = (arr) => arr.map((b) => ({ x: b.x, y: b.y, r: b.r, n: Array.from({ length: 12 }, () => 0.75 + rnd() * 0.5) }));
    // 섬: 중앙 큰 섬 + 위성 섬 4개 + 좁은 다리(병목)
    const islands = mkBlobs([
      { x: 52, y: 29, r: 14 }, { x: 43, y: 27, r: 9 }, { x: 61, y: 30, r: 9 }, { x: 52, y: 37, r: 9 }, { x: 50, y: 22, r: 8 },
      { x: 16, y: 13, r: 8 }, { x: 24, y: 16, r: 6 },   // 좌상
      { x: 89, y: 13, r: 8 }, { x: 81, y: 18, r: 6 },   // 우상
      { x: 17, y: 46, r: 8 }, { x: 26, y: 48, r: 6 },   // 좌하
      { x: 89, y: 46, r: 8 }, { x: 80, y: 44, r: 6 },   // 우하
      // 다리(잔디 목) — 위성↔중앙 연결(촘촘한 blob 으로 끊김 방지)
      { x: 30, y: 18, r: 4 }, { x: 35, y: 21, r: 4 }, { x: 40, y: 24, r: 4 },
      { x: 75, y: 18, r: 4 }, { x: 70, y: 21, r: 4 }, { x: 65, y: 24, r: 4 },
      { x: 31, y: 43, r: 4 }, { x: 36, y: 40, r: 4 }, { x: 41, y: 37, r: 4 },
      { x: 74, y: 43, r: 4 }, { x: 69, y: 40, r: 4 }, { x: 64, y: 37, r: 4 },
    ]);
    // 호수(섬 안 물 구멍) — 불규칙
    const lakes = mkBlobs([
      { x: 57, y: 33, r: 4 }, { x: 45, y: 25, r: 3 },
      { x: 88, y: 47, r: 3 },
    ]);

    const inBlob = (tx, ty, b) => {
      const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
      if (d > b.r * 1.5) return false;
      const ang = Math.atan2(dy, dx) + Math.PI;     // 0~2π
      const f = ang / (2 * Math.PI) * b.n.length;
      const i0 = Math.floor(f) % b.n.length, i1 = (i0 + 1) % b.n.length, t = f - Math.floor(f);
      const rr = b.r * (b.n[i0] * (1 - t) + b.n[i1] * t);
      return d < rr;
    };

    // land 마스크 생성(가장자리 3칸은 항상 물)
    const land = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (tx < 3 || tx >= COLS - 3 || ty < 3 || ty >= ROWS - 3) continue;
        let isLand = islands.some((b) => inBlob(tx, ty, b));
        if (isLand && lakes.some((b) => inBlob(tx, ty, b))) isLand = false; // 호수 빼기
        land[ty][tx] = isLand;
      }
    }
    // 여드름/반도 정리: 직교 이웃 land 가 2 미만인 돌출 셀 제거(매끈한 해안선) + 호수 1칸 메우기
    const lat = (x, y) => y >= 0 && y < ROWS && x >= 0 && x < COLS && land[y][x];
    for (let pass = 0; pass < 2; pass++) {
      const toLand = [], toWater = [];
      for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
        if (tx < 3 || tx >= COLS - 3 || ty < 3 || ty >= ROWS - 3) continue;
        const c = (lat(tx, ty - 1) ? 1 : 0) + (lat(tx, ty + 1) ? 1 : 0) + (lat(tx - 1, ty) ? 1 : 0) + (lat(tx + 1, ty) ? 1 : 0);
        if (land[ty][tx]) { if (c < 2) toWater.push([tx, ty]); }     // 돌출(여드름) 제거
        else if (c >= 4) toLand.push([tx, ty]);                       // 1칸 구멍 메우기
      }
      toWater.forEach(([x, y]) => { land[y][x] = false; });
      toLand.forEach(([x, y]) => { land[y][x] = true; });
    }
    this.landMask = land;

    // 타일맵 레이어
    const map = s.make.tilemap({ tileWidth: TS, tileHeight: TS, width: COLS, height: ROWS });
    const tsGrass = map.addTilesetImage('grass', 'ts_grass', TS, TS, 0, 0, 0);
    const tsWater = map.addTilesetImage('water', 'ts_water', TS, TS, 0, 0, 100);
    const water = map.createBlankLayer('water', tsWater, 0, 0).setScale(SCALE).setDepth(-1000);
    const grass = map.createBlankLayer('grass', tsGrass, 0, 0).setScale(SCALE).setDepth(-999);
    const gG = tsGrass.firstgid, gW = tsWater.firstgid;

    // 물 전체 + 잔디 섬(autotile)
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        water.putTileAt(gW + 0, tx, ty);
        if (land[ty][tx]) grass.putTileAt(gG + this._grassIdx(land, tx, ty, ROWS, COLS), tx, ty);
      }
    }

    // 오브젝트 프레임 정의
    this._defineFrames();

    // 섬 "완전 내부"(8이웃 land) 셀만 추려 장식/스폰 후보로
    const at = (x, y) => y >= 0 && y < ROWS && x >= 0 && x < COLS && land[y][x];
    const inner = [];
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (!land[ty][tx]) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!at(tx + dx, ty + dy)) { ok = false; break; }
        if (ok) inner.push({ tx, ty });
      }
    }

    // 나무/덤불 산포(내부 셀에서만, 서로 겹치지 않게)
    // 리스폰존(서버 스폰 좌표와 동일: 3400,2640)을 미리 등록해 주변에 오브젝트가 안 생기게 함
    const placed = [{ x: 3400, y: 2640 }];
    const tooClose = (px, py, d) => placed.some((q) => Math.hypot(q.x - px, q.y - py) < d);
    const trees = ['tree_m', 'tree_a', 'tree_s', 'tree_m'];
    const props = ['bush', 'bush2', 'stump', 'log', 'rock_l', 'rock_s', 'rock_l'];
    const treeWant = Math.min(95, Math.floor(inner.length * 0.09));
    const propWant = Math.min(56, Math.floor(inner.length * 0.055));
    const pick = () => inner[Math.floor(rnd() * inner.length)];

    for (let i = 0, tries = 0; i < treeWant && tries < treeWant * 16; tries++) {
      const c = pick(); if (!c) break;
      const px = (c.tx + 0.5) * T, py = (c.ty + 1) * T;
      if (tooClose(px, py, T * 2.3)) continue;
      this._obj(px, py, trees[Math.floor(rnd() * trees.length)]);
      this.obstacles.push({ x: px - 18, y: py, w: 36, h: 26 });
      placed.push({ x: px, y: py }); i++;
    }
    for (let i = 0, tries = 0; i < propWant && tries < propWant * 16; tries++) {
      const c = pick(); if (!c) break;
      const px = (c.tx + 0.5) * T, py = (c.ty + 1) * T;
      if (tooClose(px, py, T * 1.8)) continue;
      const key = props[Math.floor(rnd() * props.length)];
      this._obj(px, py, key);
      if (key === 'bush' || key === 'bush2') this.obstacles.push({ x: px - 34, y: py, w: 68, h: 26 });
      else if (key === 'rock_l' || key === 'rock_s') this.obstacles.push({ x: px - 26, y: py - 4, w: 52, h: 24 });
      placed.push({ x: px, y: py }); i++;
    }

    // 장식(버섯/꽃/해바라기) — 충돌 없음
    const decos = ['mush_r', 'mush_p', 'sunflower', 'flower_p', 'flower_y', 'flower_p', 'flower_y'];
    const decoWant = Math.min(64, Math.floor(inner.length * 0.065));
    for (let i = 0, tries = 0; i < decoWant && tries < decoWant * 16; tries++) {
      const c = pick(); if (!c) break;
      const px = (c.tx + 0.5) * T, py = (c.ty + 1) * T;
      if (tooClose(px, py, T * 1.1)) continue;
      this._obj(px, py, decos[Math.floor(rnd() * decos.length)]);
      placed.push({ x: px, y: py }); i++;
    }

    // 닭장(오두막) — 큰 섬 내부 고정 위치, 충돌(은폐)
    [{ tx: 48, ty: 33 }, { tx: 23, ty: 46 }, { tx: 85, ty: 46 }].forEach((c) => {
      if (!at(c.tx, c.ty)) return;
      const px = (c.tx + 0.5) * T, py = (c.ty + 1) * T;
      this._place(px, py, 'obj_coop', undefined, 3);
      this.obstacles.push({ x: px - 42, y: py - 30, w: 84, h: 32 });
      placed.push({ x: px, y: py });
    });

    // 나무 다리 — 다리 목 위에 바닥으로 깔기(반투명 제외, 캐릭터 아래)
    [{ tx: 35, ty: 21 }, { tx: 70, ty: 21 }, { tx: 36, ty: 40 }, { tx: 69, ty: 40 }].forEach((b) => {
      if (!at(b.tx, b.ty)) return;
      this._place((b.tx + 0.5) * T, (b.ty + 1.2) * T, 'obj_bridge', 'bridge_h', SCALE, -990);
    });

    // 보물상자 — 포인트 장식(드물게)
    for (let i = 0, tries = 0; i < 2 && tries < 60; tries++) {
      const c = pick(); if (!c) break;
      const px = (c.tx + 0.5) * T, py = (c.ty + 1) * T;
      if (tooClose(px, py, T * 1.5)) continue;
      this._place(px, py, 'obj_chest', 'chest0', 3);
      placed.push({ x: px, y: py }); i++;
    }

    // 물속 바위(장식) — 물은 이미 통과 불가라 충돌 없이 점점이 배치
    const waterCells = [];
    for (let ty = 4; ty < ROWS - 4; ty++) for (let tx = 4; tx < COLS - 4; tx++) {
      if (!land[ty][tx]) waterCells.push({ tx, ty });
    }
    const waterRockWant = Math.min(288, Math.floor(waterCells.length * 0.072));
    for (let i = 0, tries = 0; i < waterRockWant && tries < waterRockWant * 16; tries++) {
      const c = waterCells[Math.floor(rnd() * waterCells.length)]; if (!c) break;
      const px = (c.tx + 0.5) * T, py = (c.ty + 1) * T;
      if (tooClose(px, py, T * 1.8)) continue;
      this._obj(px, py, rnd() < 0.82 ? 'rock_l' : 'rock_s'); // 큰바위 위주
      placed.push({ x: px, y: py }); i++;
    }

    return this.obstacles;
  }

  // 8방향 autotile: 이웃 land 여부로 잔디 가장자리/코너/inner 타일 선택
  _grassIdx(L, tx, ty, rows, cols) {
    const at = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols && L[y][x];
    const N = at(tx, ty - 1), S = at(tx, ty + 1), E = at(tx + 1, ty), W = at(tx - 1, ty);
    const NE = at(tx + 1, ty - 1), NW = at(tx - 1, ty - 1), SE = at(tx + 1, ty + 1), SW = at(tx - 1, ty + 1);
    // 가로/세로 1칸 폭(반도·다리 끝)
    if (!N && !S) { if (E && W) return 34; if (!W && E) return 33; if (W && !E) return 35; return 36; }
    if (!E && !W) { if (N && S) return 14; if (!N && S) return 3; if (N && !S) return 25; return 36; }
    // 외부 코너(인접 두 직교가 물)
    if (!N && !W) return 0;
    if (!N && !E) return 2;
    if (!S && !W) return 22;
    if (!S && !E) return 24;
    // 한 직교가 물(직선 가장자리)
    if (!N) return 1;
    if (!S) return 23;
    if (!W) return 11;
    if (!E) return 13;
    // 직교 모두 land → 대각이 물이면 오목 inner 코너
    if (!NW) return 28;
    if (!NE) return 27;
    if (!SW) return 17;
    if (!SE) return 16;
    // 완전 내부: 민짜 + V자 풀싹(56·67, 다수) + 동그란 풀무더기(58·59·69·70, 소량)
    const h = ((tx * 131) ^ (ty * 557)) >>> 0;
    const v = (h % 1000) / 1000;
    if (v < 0.45) return 12;   // 민짜
    if (v < 0.68) return 56;   // V자(어두운)
    if (v < 0.90) return 67;   // V자(밝은)
    if (v < 0.93) return 58;   // 동그란(소량)
    if (v < 0.95) return 59;
    if (v < 0.98) return 69;
    return 70;
  }

  _defineFrames() {
    const tex = this.scene.textures.get('obj_biom');
    if (!tex.has('tree_m')) {
      const F = {
        tree_s: [0, 0, 16, 31], tree_m: [17, 0, 29, 31], tree_a: [49, 0, 29, 31],
        bush: [0, 47, 34, 17], bush2: [35, 63, 34, 16], stump: [79, 66, 18, 13], log: [63, 48, 18, 15],
        rock_l: [128, 16, 16, 15], rock_s: [112, 16, 13, 12],            // 바위(은폐)
        mush_r: [96, 1, 13, 13], mush_p: [112, 0, 13, 14],               // 버섯
        sunflower: [128, 32, 15, 30], flower_p: [96, 48, 13, 13], flower_y: [96, 33, 12, 11], // 꽃/해바라기
      };
      Object.keys(F).forEach((k) => { const v = F[k]; tex.add(k, 0, v[0], v[1], v[2], v[3]); });
    }
    const tb = this.scene.textures.get('obj_bridge');
    if (tb && !tb.has('bridge_h')) tb.add('bridge_h', 0, 32, 0, 31, 16); // 가로 다리
    const tc = this.scene.textures.get('obj_chest');
    if (tc && !tc.has('chest0')) tc.add('chest0', 0, 16, 14, 26, 18);    // 닫힌 상자
  }

  _obj(px, py, key) { return this._place(px, py, 'obj_biom', key, SCALE); }

  // 오브젝트 배치. depthOff 가 주어지면 바닥(다리)으로 깔고 반투명 대상에서 제외
  _place(px, py, texKey, frame, scale, depthOff) {
    const s = this.scene;
    const isFloor = depthOff != null;
    const img = s.add.image(px, py, texKey, frame).setOrigin(0.5, 1).setScale(scale).setDepth(isFloor ? depthOff : py);
    if (!isFloor) this.objects.push({ img, x: px, y: py }); // 본인 주변 반경 반투명용
    return img;
  }
}
