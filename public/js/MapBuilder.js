// =============================================================================
// MapBuilder.js  -  SproutLands 타일 기반 맵 생성
//   · 잔디 베이스(Tilemap) + 연못(물) + 밭(흙) 9-slice
//   · 나무/덤불/그루터기/통나무 장식(2.5D depth 정렬) + 울타리
//   · 충돌 박스(obstacles) 수집 → 술래/숨는이 이동 충돌에 사용
//   맵은 고정 시드 PRNG 로 생성 → 모든 클라이언트가 동일한 맵을 봄.
// =============================================================================

const TS = 16;          // 원본 타일 크기(px)
const SCALE = 2;        // 2배 확대(게임 월드 스케일과 동일)
const T = TS * SCALE;   // 화면상 타일 크기(32px)

// 잔디/흙 "섬" 9-slice 인덱스(중앙은 꽉 차고, 가장자리는 바깥이 투명) — 밭(흙섬)용
const ISLAND = { TL: 0, T: 1, TR: 2, L: 11, C: 12, R: 13, BL: 22, B: 23, BR: 24 };
// 연못 가장자리: 변은 직선(잔디섬 변), 코너만 오목(inner) — 깔끔한 물가
const POND = { N: 23, S: 1, W: 13, E: 11, NW: 16, NE: 17, SW: 27, SE: 28 };
// 울타리(Fences 4x4): 가로 13/14/15, 세로 0/4/8
const FENCE_H = { L: 13, M: 14, R: 15 };
const FENCE_V = { T: 0, M: 4, B: 8 };

export class MapBuilder {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = [];
  }

  build(world) {
    const s = this.scene;
    const COLS = Math.ceil(world.width / T);
    const ROWS = Math.ceil(world.height / T);

    const map = s.make.tilemap({ tileWidth: TS, tileHeight: TS, width: COLS, height: ROWS });
    // 여러 타일셋을 한 맵에 추가 → firstgid 를 명시해 gid 범위 충돌 방지
    const tsGrass = map.addTilesetImage('grass', 'ts_grass', TS, TS, 0, 0, 0);
    const tsWater = map.addTilesetImage('water', 'ts_water', TS, TS, 0, 0, 100);
    const tsDirt  = map.addTilesetImage('dirt',  'ts_dirt',  TS, TS, 0, 0, 200);

    const base  = map.createBlankLayer('base',  tsGrass, 0, 0).setScale(SCALE).setDepth(-1000);
    const water = map.createBlankLayer('water', tsWater, 0, 0).setScale(SCALE).setDepth(-999);
    const pedge = map.createBlankLayer('pedge', tsGrass, 0, 0).setScale(SCALE).setDepth(-998);
    const field = map.createBlankLayer('field', tsDirt,  0, 0).setScale(SCALE).setDepth(-997);
    [base, water, pedge, field].forEach((l) => l.setScrollFactor(1));

    const gG = tsGrass.firstgid, gW = tsWater.firstgid, gD = tsDirt.firstgid;

    // 고정 시드 PRNG(LCG) — 모든 클라가 동일한 맵
    let seed = 20240624;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    // 1) 잔디 베이스 전체(가끔 풀 디테일 variation)
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const r = rnd();
        const idx = r < 0.86 ? 12 : (r < 0.93 ? 56 : 67);
        base.putTileAt(gG + idx, x, y);
      }
    }

    // 2) 연못(물 + 잔디 테두리). 연못=잔디에 뚫린 구멍이라 섬과 코너가 반대.
    const ponds = [
      { x1: 12, y1: 9,  x2: 23, y2: 17 },
      { x1: 70, y1: 33, x2: 83, y2: 43 },
      { x1: 45, y1: 43, x2: 55, y2: 51 },
    ];
    ponds.forEach((p) => {
      for (let y = p.y1; y <= p.y2; y++) for (let x = p.x1; x <= p.x2; x++) water.putTileAt(gW + 0, x, y);
      // 잔디가 물을 둥글게 감싸는 오목 가장자리(변/코너)
      for (let x = p.x1 + 1; x < p.x2; x++) { pedge.putTileAt(gG + POND.N, x, p.y1); pedge.putTileAt(gG + POND.S, x, p.y2); }
      for (let y = p.y1 + 1; y < p.y2; y++) { pedge.putTileAt(gG + POND.W, p.x1, y); pedge.putTileAt(gG + POND.E, p.x2, y); }
      pedge.putTileAt(gG + POND.NW, p.x1, p.y1); pedge.putTileAt(gG + POND.NE, p.x2, p.y1);
      pedge.putTileAt(gG + POND.SW, p.x1, p.y2); pedge.putTileAt(gG + POND.SE, p.x2, p.y2);
      // 충돌: 물 내부(발밑 평면 기준 약간 아래로 — 위에서 덜 막히고 아래서 덜 겹침)
      this.obstacles.push({ x: (p.x1 + 1) * T, y: (p.y1 + 1) * T + 18, w: (p.x2 - p.x1 - 1) * T, h: (p.y2 - p.y1 - 1) * T });
    });

    // 3) 밭(흙 섬 9-slice)
    const fields = [
      { x1: 30, y1: 20, x2: 40, y2: 27 },
      { x1: 87, y1: 11, x2: 97, y2: 18 },
    ];
    fields.forEach((p) => {
      for (let y = p.y1; y <= p.y2; y++) for (let x = p.x1; x <= p.x2; x++) field.putTileAt(gD + ISLAND.C, x, y);
      for (let x = p.x1; x <= p.x2; x++) { field.putTileAt(gD + ISLAND.T, x, p.y1); field.putTileAt(gD + ISLAND.B, x, p.y2); }
      for (let y = p.y1; y <= p.y2; y++) { field.putTileAt(gD + ISLAND.L, p.x1, y); field.putTileAt(gD + ISLAND.R, p.x2, y); }
      field.putTileAt(gD + ISLAND.TL, p.x1, p.y1); field.putTileAt(gD + ISLAND.TR, p.x2, p.y1);
      field.putTileAt(gD + ISLAND.BL, p.x1, p.y2); field.putTileAt(gD + ISLAND.BR, p.x2, p.y2);
    });

    // 4) 오브젝트 프레임 정의(Basic_Grass_Biom_things 시트 crop)
    this._defineFrames();

    const inRect = (tx, ty, list, pad = 1) =>
      list.some((p) => tx >= p.x1 - pad && tx <= p.x2 + pad && ty >= p.y1 - pad && ty <= p.y2 + pad);
    const placed = [];
    const tooClose = (px, py, d) => placed.some((q) => Math.hypot(q.x - px, q.y - py) < d);

    // 5) 나무 산포(연못/밭 회피) — 밑동 충돌 + 은폐
    const trees = ['tree_m', 'tree_a', 'tree_s', 'tree_m'];
    let want = 50, tries = 0;
    while (placed.length < want && tries < want * 14) {
      tries++;
      const tx = 2 + Math.floor(rnd() * (COLS - 4));
      const ty = 2 + Math.floor(rnd() * (ROWS - 4));
      if (inRect(tx, ty, ponds) || inRect(tx, ty, fields)) continue;
      const px = (tx + 0.5) * T, py = (ty + 1) * T;
      if (tooClose(px, py, T * 2.3)) continue;
      this._obj(px, py, trees[Math.floor(rnd() * trees.length)]);
      this.obstacles.push({ x: px - 12, y: py, w: 24, h: 16 }); // 밑동(발밑 정렬)
      placed.push({ x: px, y: py });
    }

    // 6) 덤불/그루터기/통나무 산포
    const props = ['bush', 'bush2', 'stump', 'log', 'bush'];
    let pwant = 26, ptries = 0, pc = 0;
    while (pc < pwant && ptries < pwant * 14) {
      ptries++;
      const tx = 2 + Math.floor(rnd() * (COLS - 4));
      const ty = 2 + Math.floor(rnd() * (ROWS - 4));
      if (inRect(tx, ty, ponds) || inRect(tx, ty, fields)) continue;
      const px = (tx + 0.5) * T, py = (ty + 1) * T;
      if (tooClose(px, py, T * 1.8)) continue;
      const key = props[Math.floor(rnd() * props.length)];
      this._obj(px, py, key);
      if (key === 'bush' || key === 'bush2') this.obstacles.push({ x: px - 22, y: py - 1, w: 44, h: 16 });
      placed.push({ x: px, y: py });
      pc++;
    }

    // 7) 울타리 라인(엄폐물). 가로/세로 일자.
    const fenceLines = [
      { x: 26, y: 30, len: 9, dir: 'h' },
      { x: 60, y: 14, len: 7, dir: 'v' },
      { x: 92, y: 38, len: 8, dir: 'h' },
      { x: 18, y: 40, len: 6, dir: 'v' },
    ];
    fenceLines.forEach((L) => {
      for (let i = 0; i < L.len; i++) {
        if (L.dir === 'h') {
          const fi = i === 0 ? FENCE_H.L : (i === L.len - 1 ? FENCE_H.R : FENCE_H.M);
          this._fence(L.x + i, L.y, fi);
        } else {
          const fi = i === 0 ? FENCE_V.T : (i === L.len - 1 ? FENCE_V.B : FENCE_V.M);
          this._fence(L.x, L.y + i, fi);
        }
      }
      if (L.dir === 'h') this.obstacles.push({ x: L.x * T, y: L.y * T + T - 10, w: L.len * T, h: 12 });
      else this.obstacles.push({ x: L.x * T + T / 2 - 6, y: L.y * T, w: 12, h: L.len * T });
    });

    return this.obstacles;
  }

  // Basic_Grass_Biom_things 시트에서 오브젝트 프레임을 잘라 등록
  _defineFrames() {
    const tex = this.scene.textures.get('obj_biom');
    if (tex.has('tree_m')) return;
    const F = {
      tree_s: [0, 0, 16, 31], tree_m: [17, 0, 29, 31], tree_a: [49, 0, 29, 31],
      bush: [0, 47, 34, 17], bush2: [35, 63, 34, 16], stump: [79, 66, 18, 13], log: [63, 48, 18, 15],
    };
    Object.keys(F).forEach((k) => { const v = F[k]; tex.add(k, 0, v[0], v[1], v[2], v[3]); });
  }

  // 오브젝트 1개 배치(발밑 origin, 2.5D depth = 발밑 y) + 옅은 그림자
  _obj(px, py, key) {
    const s = this.scene;
    s.add.ellipse(px, py - 2, 26, 9, 0x000000, 0.16).setDepth(py - 1);
    return s.add.image(px, py, 'obj_biom', key).setOrigin(0.5, 1).setScale(SCALE).setDepth(py);
  }

  // 울타리 1칸(발밑 origin, depth 살짝 낮춰 캐릭터가 앞/뒤로 자연스럽게)
  _fence(tx, ty, fi) {
    const s = this.scene;
    s.add.image((tx + 0.5) * T, (ty + 1) * T, 'ts_fence', fi)
      .setOrigin(0.5, 1).setScale(SCALE).setDepth((ty + 1) * T - 6);
  }
}
