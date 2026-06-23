// =============================================================================
// DrawingBoard.js  -  [2단계] 그리기 시스템 (인게임 캐릭터 페인팅)
// -----------------------------------------------------------------------------
// 화면 중앙 큰 캔버스가 아니라, "캐릭터 위에 직접" 그린다.
//  - 이 모듈은 그림 데이터(16x16 cells), 색/브러시 선택 도구막대만 담당.
//  - 실제 칠하기(포인터 → 셀 좌표)와 화면 표시는 GameScene 이 캐릭터 위에서 한다.
//  - cells[y][x] = '#rrggbb' 또는 null(투명)
// =============================================================================

const PALETTE = [
  '#000000', '#ffffff', '#e23b3b', '#f08c1d', '#f5d020',
  '#3bd16f', '#1d9bf0', '#2f4bf0', '#9b59f0', '#f04bb0',
  '#7a4a2b', '#bdbdbd', '#5a8f3c', '#1f6d6d', '#ff9ec4',
];

export class DrawingBoard {
  constructor({ onApply, onClose } = {}) {
    this.onApply = onApply;
    this.onClose = onClose;
    this.GRID = 32; // 그리기 해상도(32x32)

    this.color = '#e23b3b';
    this.colorNum = 0xe23b3b;
    this.brush = 1;
    this.open = false;

    this.cells = this._blankCells();

    // 되돌리기/다시(undo/redo) 히스토리
    this.history = [];
    this.histIndex = -1;

    this.toolbar = document.getElementById('paint-toolbar');
    this._buildPalette();
    this._bindButtons();
    this._updateCurColor();
  }

  _blankCells() {
    return Array.from({ length: this.GRID }, () =>
      Array.from({ length: this.GRID }, () => null)
    );
  }

  // ---- 되돌리기/다시 ------------------------------------------------------
  _snapshot() {
    return this.cells.map((row) => row.slice());
  }

  resetHistory() {
    this.history = [this._snapshot()];
    this.histIndex = 0;
  }

  // 한 획(stroke) 끝났을 때 호출 → 현재 상태를 히스토리에 추가
  pushHistory() {
    this.history = this.history.slice(0, this.histIndex + 1); // redo 가지 버림
    this.history.push(this._snapshot());
    if (this.history.length > 50) this.history.shift();
    this.histIndex = this.history.length - 1;
  }

  undo() {
    if (this.histIndex <= 0) return false;
    this.histIndex -= 1;
    this.cells = this.history[this.histIndex].map((row) => row.slice());
    return true;
  }

  redo() {
    if (this.histIndex >= this.history.length - 1) return false;
    this.histIndex += 1;
    this.cells = this.history[this.histIndex].map((row) => row.slice());
    return true;
  }

  // 스포이드: 색을 현재 색으로 지정 + 팔레트 강조
  pickColor(hex) {
    if (!hex) return;
    this.color = hex;
    this.colorNum = parseInt(hex.slice(1), 16);
    const wrap = document.getElementById('palette');
    if (wrap) {
      wrap.querySelectorAll('.swatch').forEach((s) => {
        s.classList.toggle('active', (s.dataset.tip || '').toLowerCase() === hex.toLowerCase());
      });
    }
    this._updateCurColor();
  }

  _updateCurColor() {
    const el = document.getElementById('cur-color');
    if (el) el.style.background = this.color;
  }

  isOpen() {
    return this.open;
  }

  show() {
    this.open = true;
    this.toolbar.classList.remove('hidden');
  }

  // 기존 그림(dataURL)을 16x16 cells 로 복원 → 편집/지우기 가능
  loadFromDataURL(dataURL) {
    this.clearCells();
    if (!dataURL) { this.resetHistory(); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = this.GRID;
      c.height = this.GRID;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, this.GRID, this.GRID);
      const data = ctx.getImageData(0, 0, this.GRID, this.GRID).data;
      for (let y = 0; y < this.GRID; y++) {
        for (let x = 0; x < this.GRID; x++) {
          const i = (y * this.GRID + x) * 4;
          if (data[i + 3] > 10) {
            const hex = [data[i], data[i + 1], data[i + 2]]
              .map((v) => v.toString(16).padStart(2, '0')).join('');
            this.cells[y][x] = '#' + hex;
          }
        }
      }
      this.resetHistory(); // 불러온 그림을 되돌리기 기준점으로
    };
    img.src = dataURL;
  }

  hide() {
    this.open = false;
    this.toolbar.classList.add('hidden');
  }

  clearCells() {
    this.cells = this._blankCells();
  }

  hasAnyPaint() {
    return this.cells.some((row) => row.some((c) => c));
  }

  // 원형 브러시 오프셋(짝수 크기는 픽셀 사이 중심) — SPRITFY 방식
  _brushOffsets(size) {
    if (size <= 1) return [[0, 0]];
    const offs = [];
    const r = size / 2;
    const rSq = r * r;
    const even = size % 2 === 0;
    const lo = even ? Math.ceil(-r) + 1 : Math.ceil(-r);
    const hi = even ? Math.floor(r) : Math.floor(r);
    for (let dy = lo; dy <= hi; dy++) {
      for (let dx = lo; dx <= hi; dx++) {
        const ddx = even ? dx - 0.5 : dx;
        const ddy = even ? dy - 0.5 : dy;
        if (ddx * ddx + ddy * ddy <= rSq) offs.push([dx, dy]);
      }
    }
    return offs;
  }

  // 현재 브러시 오프셋(크기별 캐시)
  brushOffsets() {
    if (this._offSize !== this.brush) {
      this._off = this._brushOffsets(this.brush);
      this._offSize = this.brush;
    }
    return this._off;
  }

  // 브러시 크기 설정(1~16) + 슬라이더/숫자 동기화 — [ ] 키와 슬라이더 공용
  setBrush(n) {
    this.brush = Math.max(1, Math.min(16, n | 0));
    const slider = document.getElementById('brush-size');
    if (slider) slider.value = String(this.brush);
    const val = document.getElementById('brush-val');
    if (val) val.textContent = this.brush;
  }

  // GameScene 이 포인터→셀 변환 후 호출 (원형 브러시로 칠함)
  paint(cx, cy, erase) {
    for (const [dx, dy] of this.brushOffsets()) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= this.GRID || y >= this.GRID) continue;
      this.cells[y][x] = erase ? null : this.color;
    }
  }

  // 16x16 PNG dataURL (캐릭터 텍스처로 사용)
  toDataURL() {
    const out = document.createElement('canvas');
    out.width = this.GRID;
    out.height = this.GRID;
    const ctx = out.getContext('2d');
    for (let y = 0; y < this.GRID; y++) {
      for (let x = 0; x < this.GRID; x++) {
        const c = this.cells[y][x];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return out.toDataURL('image/png');
  }

  // ---- 도구막대 ----------------------------------------------------------
  _buildPalette() {
    const wrap = document.getElementById('palette');
    wrap.innerHTML = '';
    PALETTE.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'swatch' + (c === this.color ? ' active' : '');
      sw.style.background = c;
      sw.dataset.tip = c;
      sw.addEventListener('click', () => {
        this.color = c;
        this.colorNum = parseInt(c.slice(1), 16);
        wrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
        sw.classList.add('active');
        this._updateCurColor();
      });
      wrap.appendChild(sw);
    });
  }

  _bindButtons() {
    document.getElementById('btn-clear').addEventListener('click', () => { this.clearCells(); this.pushHistory(); });
    document.getElementById('btn-apply').addEventListener('click', () => this.onApply && this.onApply());
    document.getElementById('btn-close').addEventListener('click', () => this.onClose && this.onClose());
    const brushVal = document.getElementById('brush-val');
    if (brushVal) brushVal.textContent = this.brush;
    document.getElementById('brush-size').addEventListener('input', (e) => {
      this.setBrush(parseInt(e.target.value, 10));
    });
    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
    const redoBtn = document.getElementById('btn-redo');
    if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
  }
}
