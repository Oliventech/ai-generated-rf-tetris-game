/**
 * Simple Tetris AI for self-play / demo mode.
 * Evaluates all possible placements and picks the best one.
 */

class AutoPlayer {
  #active = false;
  #moveQueue = [];

  get active() { return this.#active; }

  start() {
    this.#active = true;
    this.#moveQueue = [];
  }

  stop() {
    this.#active = false;
    this.#moveQueue = [];
  }

  /**
   * Called each frame by game loop. Returns next action or null.
   * Actions: 'left', 'right', 'rotateCW', 'hardDrop'
   */
  getNextMove(board, piece, holdType, nextQueue) {
    if (!this.#active || !piece) return null;

    // If we have queued moves, serve them
    if (this.#moveQueue.length > 0) {
      return this.#moveQueue.shift();
    }

    // Compute best placement
    const best = this.#findBestPlacement(board, piece);
    if (!best) return 'hardDrop';

    // Build move queue: rotations first, then horizontal moves, then drop
    const moves = [];

    // Rotations
    let rotations = (best.rotation - piece.rotation + 4) % 4;
    if (rotations === 3) rotations = -1; // CCW is faster
    for (let i = 0; i < Math.abs(rotations); i++) {
      moves.push(rotations < 0 ? 'rotateCCW' : 'rotateCW');
    }

    // Horizontal movement
    const dx = best.x - piece.x;
    const dir = dx > 0 ? 'right' : 'left';
    for (let i = 0; i < Math.abs(dx); i++) {
      moves.push(dir);
    }

    // Use soft drops so the piece visibly travels down — more dramatic for demo
    const dropY = best.y ?? 0;
    const softDropCount = Math.max(0, dropY - piece.y);
    for (let i = 0; i < softDropCount; i++) {
      moves.push('softDrop');
    }
    // Final hard drop to lock in place
    moves.push('hardDrop');
    this.#moveQueue = moves;

    return this.#moveQueue.shift();
  }

  #findBestPlacement(board, piece) {
    let bestScore = -Infinity;
    let bestMove = null;
    const grid = board.grid;
    const cols = board.cols;
    const totalRows = board.totalRows;

    for (let rot = 0; rot < 4; rot++) {
      const shape = piece.getShape(rot);
      const result = this.#evaluateRotation(grid, shape, piece, rot, cols, totalRows);
      if (result && result.score > bestScore) {
        bestScore = result.score;
        bestMove = result.move;
      }
    }

    return bestMove;
  }

  #evaluateRotation(grid, shape, piece, rot, cols, totalRows) {
    let bestScore = -Infinity;
    let bestMove = null;

    for (let testX = -2; testX < cols + 2; testX++) {
      if (this.#collides(grid, shape, testX, piece.y, cols, totalRows)) continue;

      let testY = piece.y;
      while (!this.#collides(grid, shape, testX, testY + 1, cols, totalRows)) {
        testY++;
      }

      const simGrid = this.#simulatePlacement(grid, shape, piece, testX, testY, cols, totalRows);
      const score = this.#evaluateBoard(simGrid, cols, totalRows, testY);
      if (score > bestScore) {
        bestScore = score;
        bestMove = { x: testX, y: testY, rotation: rot };
      }
    }

    return bestMove ? { score: bestScore, move: bestMove } : null;
  }

  #simulatePlacement(grid, shape, piece, testX, testY, cols, totalRows) {
    const simGrid = grid.map(row => [...row]);
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const gx = testX + c;
        const gy = testY + r + 2;
        if (gy >= 0 && gy < totalRows && gx >= 0 && gx < cols) {
          simGrid[gy][gx] = piece.color;
        }
      }
    }
    return simGrid;
  }

  #collides(grid, shape, px, py, cols, totalRows) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const x = px + c;
        const y = py + r + 2; // HIDDEN_ROWS
        if (x < 0 || x >= cols || y >= totalRows) return true;
        if (y < 0) continue;
        if (grid[y][x] !== null) return true;
      }
    }
    return false;
  }

  #evaluateBoard(grid, cols, totalRows, landingY) {
    let score = 0;

    // Count complete lines
    let linesCleared = 0;
    for (let r = 0; r < totalRows; r++) {
      if (grid[r].every(cell => cell !== null)) linesCleared++;
    }
    score += linesCleared * 800;

    // Column heights and aggregate height
    const heights = this.#getColumnHeights(grid, cols, totalRows);
    for (const h of heights) score -= h * 3;

    // Holes and bumpiness
    score -= this.#countHoles(grid, cols, totalRows) * 50;
    score -= this.#calcBumpiness(heights) * 4;
    score += landingY * 2;

    return score;
  }

  #getColumnHeights(grid, cols, totalRows) {
    const heights = new Array(cols).fill(0);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < totalRows; r++) {
        if (grid[r][c] !== null) {
          heights[c] = totalRows - r;
          break;
        }
      }
    }
    return heights;
  }

  #countHoles(grid, cols, totalRows) {
    let holes = 0;
    for (let c = 0; c < cols; c++) {
      let foundBlock = false;
      for (let r = 0; r < totalRows; r++) {
        if (grid[r][c] !== null) foundBlock = true;
        else if (foundBlock) holes++;
      }
    }
    return holes;
  }

  #calcBumpiness(heights) {
    let bumpiness = 0;
    for (let c = 0; c < heights.length - 1; c++) {
      bumpiness += Math.abs(heights[c] - heights[c + 1]);
    }
    return bumpiness;
  }
}

export { AutoPlayer };
