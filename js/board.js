/**
 * Board grid, collision detection, and line clearing.
 */

const COLS = 10;
const ROWS = 20;
const HIDDEN_ROWS = 2;
const TOTAL_ROWS = ROWS + HIDDEN_ROWS;
const MAX_FILL_DEPTH = 2; // loose blocks drop into a gap this deep; longer cracks stay open

class Board {
  #grid;

  constructor() {
    this.#grid = this.#createEmptyGrid();
  }

  get grid() { return this.#grid; }
  get cols() { return COLS; }
  get rows() { return ROWS; }
  get totalRows() { return TOTAL_ROWS; }

  #createEmptyGrid() {
    return Array.from({ length: TOTAL_ROWS }, () => new Array(COLS).fill(null));
  }

  reset() {
    this.#grid = this.#createEmptyGrid();
  }

  /**
   * Check if a piece shape at (px, py) collides with walls or locked blocks.
   */
  collides(shape, px, py) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const x = px + c;
        const y = py + r + HIDDEN_ROWS;
        if (x < 0 || x >= COLS || y >= TOTAL_ROWS) return true;
        if (y < 0) continue;
        if (this.#grid[y][x] !== null) return true;
      }
    }
    return false;
  }

  /**
   * Lock a piece onto the board.
   */
  lock(piece) {
    const shape = piece.shape;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const x = piece.x + c;
        const y = piece.y + r + HIDDEN_ROWS;
        if (y >= 0 && y < TOTAL_ROWS && x >= 0 && x < COLS) {
          this.#grid[y][x] = piece.color;
        }
      }
    }
  }

  /**
   * Clear completed lines, shift the rows above them down, then let loose blocks
   * settle. Settling can complete more rows; game.js clears those once the slide ends.
   * Returns falling cell data for the slide animation.
   */
  clearLines() {
    const fullRows = [];
    for (let r = 0; r < TOTAL_ROWS; r++) {
      if (this.#grid[r].every(cell => cell !== null)) {
        fullRows.push(r);
      }
    }

    if (fullRows.length === 0) {
      return { linesCleared: 0, clearedRows: [], clearedRowColors: [], fallingCells: [] };
    }

    // Record for visual effects (convert to visible row index)
    const clearedRows = fullRows.map(r => r - HIDDEN_ROWS);
    const clearedRowColors = fullRows.map(r => [...this.#grid[r]]);

    return {
      linesCleared: fullRows.length,
      clearedRows,
      clearedRowColors,
      fallingCells: this.#removeRows(fullRows),
    };
  }

  /**
   * Remove the given rows and settle what is left, one column at a time.
   * Records movement data for the slide animation.
   */
  #removeRows(fullRows) {
    const fallingCells = [];
    for (let c = 0; c < COLS; c++) {
      const column = this.#settleColumn(this.#shiftedColumn(c, fullRows));
      for (let r = 0; r < TOTAL_ROWS; r++) {
        const cell = column[r];
        this.#grid[r][c] = cell ? cell.color : null;
        if (cell && cell.fromRow !== r) {
          fallingCells.push({
            col: c,
            fromRow: cell.fromRow - HIDDEN_ROWS,
            toRow: r - HIDDEN_ROWS,
            color: cell.color,
          });
        }
      }
    }
    return fallingCells;
  }

  /** A column with the given rows taken out; each cell remembers the row it started in. */
  #shiftedColumn(c, fullRows) {
    const kept = [];
    for (let r = 0; r < TOTAL_ROWS; r++) {
      if (fullRows.includes(r)) continue;
      const color = this.#grid[r][c];
      kept.push(color !== null ? { color, fromRow: r } : null);
    }
    return [...new Array(fullRows.length).fill(null), ...kept];
  }

  /**
   * Drop the run of blocks at the top of a column into the gap below it, and repeat.
   * Stops at a gap deeper than MAX_FILL_DEPTH, unless nothing at all is under the run.
   */
  #settleColumn(column) {
    for (;;) {
      const top = column.findIndex(Boolean);
      if (top < 0) return column;
      let gap = top;
      while (gap < TOTAL_ROWS && column[gap]) gap++;
      let floor = gap;
      while (floor < TOTAL_ROWS && !column[floor]) floor++;
      const depth = floor - gap;
      if (depth === 0 || (depth > MAX_FILL_DEPTH && floor < TOTAL_ROWS)) return column;
      column.splice(gap, depth);
      column.unshift(...new Array(depth).fill(null));
    }
  }

  /**
   * Get the y position where the piece would land (for ghost piece).
   */
  getDropPosition(piece) {
    let testY = piece.y;
    while (!this.collides(piece.shape, piece.x, testY + 1)) {
      testY++;
    }
    return testY;
  }

  /**
   * Check if the top hidden rows have any blocks (game over condition).
   */
  isTopBlocked() {
    for (let r = 0; r < HIDDEN_ROWS; r++) {
      if (this.#grid[r].some(cell => cell !== null)) return true;
    }
    return false;
  }

  /**
   * Get the visible portion of the grid (rows without hidden rows).
   */
  getVisibleGrid() {
    return this.#grid.slice(HIDDEN_ROWS);
  }

  /**
   * Detect T-spin after a T piece locks. Uses the 3-corner rule.
   * Returns 'none', 'mini', or 'full'.
   */
  detectTSpin(piece, lastActionWasRotation) {
    if (piece.type !== 'T' || !lastActionWasRotation) return 'none';

    // Center of the T piece bounding box in grid coords
    const cx = piece.x + 1;
    const cy = piece.y + 1 + HIDDEN_ROWS;

    // Check the 4 diagonal corners around T center
    const corners = [
      this.#isFilled(cx - 1, cy - 1),
      this.#isFilled(cx + 1, cy - 1),
      this.#isFilled(cx + 1, cy + 1),
      this.#isFilled(cx - 1, cy + 1),
    ];
    const filledCount = corners.filter(Boolean).length;
    if (filledCount < 3) return 'none';

    // Determine front corners based on rotation state
    // rotation 0: T points up    -> front corners: top-left(0), top-right(1)
    // rotation 1: T points right -> front corners: top-right(1), bottom-right(2)
    // rotation 2: T points down  -> front corners: bottom-right(2), bottom-left(3)
    // rotation 3: T points left  -> front corners: bottom-left(3), top-left(0)
    const rot = piece.rotation % 4;
    const frontA = corners[rot];
    const frontB = corners[(rot + 1) % 4];

    return (frontA && frontB) ? 'full' : 'mini';
  }

  /** Check if a grid position is filled or out of bounds (counts as filled). */
  #isFilled(x, y) {
    if (x < 0 || x >= COLS || y < 0 || y >= TOTAL_ROWS) return true;
    return this.#grid[y][x] !== null;
  }

  /** Check if the entire board is empty (for perfect clear detection). */
  isPerfectClear() {
    for (let r = 0; r < TOTAL_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.#grid[r][c] !== null) return false;
      }
    }
    return true;
  }

  /** Get highest occupied visible row (0 = top, ROWS-1 = bottom). Returns ROWS if empty. */
  getHighestBlock() {
    for (let r = HIDDEN_ROWS; r < TOTAL_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.#grid[r][c] !== null) return r - HIDDEN_ROWS;
      }
    }
    return ROWS;
  }
}

export { Board };
