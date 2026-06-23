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

    this.toolbar = document.getElementById('paint-toolbar');
    this._buildPalette();
    this._bindButtons();
  }

  _blankCells() {
    return Array.from({ length: this.GRID }, () =>
      Array.from({ length: this.GRID }, () => null)
    );
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
    if (!dataURL) return;
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

  // GameScene 이 포인터→셀 변환 후 호출
  paint(cx, cy, erase) {
    const r = this.brush - 1;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= this.GRID || y >= this.GRID) continue;
        this.cells[y][x] = erase ? null : this.color;
      }
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
      sw.title = c;
      sw.addEventListener('click', () => {
        this.color = c;
        this.colorNum = parseInt(c.slice(1), 16);
        wrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
        sw.classList.add('active');
      });
      wrap.appendChild(sw);
    });
  }

  _bindButtons() {
    document.getElementById('btn-clear').addEventListener('click', () => this.clearCells());
    document.getElementById('btn-apply').addEventListener('click', () => this.onApply && this.onApply());
    document.getElementById('btn-close').addEventListener('click', () => this.onClose && this.onClose());
    document.getElementById('brush-size').addEventListener('input', (e) => {
      this.brush = parseInt(e.target.value, 10);
    });
  }
}
