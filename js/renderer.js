/**
 * Canvas rendering — board, pieces, ghost, grid, side panels, particles, screen shake.
 */
import { getColorForType, getShapeForType } from './piece.js';
import { drawCell, drawMiniCell, drawPreviewPiece, lightenColor, darkenColor, hexToRgba, remapColor } from './rendering/cell-themes.js';
import { EffectsEngine } from './rendering/effects.js';
import { Particle, MAX_PARTICLES } from './rendering/particles.js';

const CELL_SIZE = 32;
const COLS = 10;
const ROWS = 20;

class Renderer {
  #gameCtx;
  #holdCtx;
  #nextCtx;
  #mobileHoldCtx;
  #mobileNextCtx;
  #scoreEl;
  #levelEl;
  #linesEl;
  #overlayEl;
  #overlayTextEl;
  #mobileScoreEl;
  #mobileLevelEl;
  #mobileLinesEl;
  #fx = new EffectsEngine();
  #displayScore = 0;
  #displayLines = 0;
  #bgGradient = null;
  #frameCount = 0;

  // Hard drop slam lines

  // Piece lock pulse

  // Glass crack lines

  // Floating combo text

  // Game over collapse

  // Star speed boost for background reactivity
  #starSpeedBoost = 1;

  // Danger zone (0 = safe, 1 = critical)

  // Piece trail

  // Lock bounce

  // Sound callbacks for animation-synced audio

  // Animation speed multiplier (1 = normal, 2 = 2× faster)
  #animSpeed = 4;

  // Visual theme for block rendering (matches sound theme)
  #visualTheme = 'glass';

  /** Set animation speed multiplier. */
  setAnimSpeed(m) { this.#fx.animSpeed = Math.max(0.25, Math.min(8, m)); }

  /** Set visual theme for block rendering. */
  setVisualTheme(theme) { this.#visualTheme = theme; this.#fx.visualTheme = theme; }

  /** True while line clear animation is playing — game logic should pause. */
  get isAnimating() { return this.#fx.isAnimating; }

  /** Reset all animation state — call on game start/restart. */
  resetAnimations() { this.#fx.resetAnimations(); }

  constructor() {
    const gameCanvas = document.getElementById('game-canvas');
    gameCanvas.width = COLS * CELL_SIZE;
    gameCanvas.height = ROWS * CELL_SIZE;
    this.#gameCtx = gameCanvas.getContext('2d');

    // Sound callbacks default to no-ops
    this.#fx.soundCallbacks = { onRowHighlight: () => {}, onCellPop: () => {}, onRowCleared: () => {} };

    // Rich multi-stop background gradient
    this.#bgGradient = this.#gameCtx.createLinearGradient(0, 0, 0, ROWS * CELL_SIZE);
    this.#bgGradient.addColorStop(0, '#06101f');
    this.#bgGradient.addColorStop(0.3, '#0a1628');
    this.#bgGradient.addColorStop(0.6, '#0d1b2a');
    this.#bgGradient.addColorStop(1, '#120e28');

    this.#holdCtx = document.getElementById('hold-canvas').getContext('2d');
    this.#nextCtx = document.getElementById('next-canvas').getContext('2d');

    // Mobile hold/next canvases (may not exist on desktop, safe to check)
    const mhc = document.getElementById('mobile-hold-canvas');
    const mnc = document.getElementById('mobile-next-canvas');
    this.#mobileHoldCtx = mhc ? mhc.getContext('2d') : null;
    this.#mobileNextCtx = mnc ? mnc.getContext('2d') : null;
    this.#scoreEl = document.getElementById('score-value');
    this.#levelEl = document.getElementById('level-value');
    this.#linesEl = document.getElementById('lines-value');
    this.#overlayEl = document.getElementById('overlay');
    this.#overlayTextEl = document.getElementById('overlay-text');
    this.#mobileScoreEl = document.getElementById('mobile-score');
    this.#mobileLevelEl = document.getElementById('mobile-level');
    this.#mobileLinesEl = document.getElementById('mobile-lines');
  }

  /**
   * Set sound callbacks for animation-synced audio.
   * { onRowHighlight(rowIndex), onCellPop(col, totalCols), onRowCleared(rowIndex) }
   */
  setSoundCallbacks(callbacks) {
    this.#fx.soundCallbacks = callbacks;
    this.#fx.soundCallbacks = { ...this.#fx.soundCallbacks, ...callbacks };
  }

  /**
   * Line clear animation: rows come loose, blocks let go left to right and fall off the board.
   */
  triggerLineClearEffect(clearedRows, clearedRowColors) {
    this.#fx.startPeel(clearedRows, clearedRowColors);
    this.#fx.starSpeedBoost = 2 + clearedRows.length;
  }

  /**
   * Hard drop slam lines + dust particles at landing site.
   */
  triggerHardDropEffect(piece, dropDistance) {
    if (dropDistance < 2) return;
    const intensity = Math.min(dropDistance / 10, 1);
    this.#fx.shakeAmount = 2 + intensity * 6;
    this.#fx.addSlamLines(piece, intensity);
    this.#fx.addDustParticles(piece);
  }

  /**
   * Lock pulse — brief scale-up then fade on the locked piece cells.
   */
  triggerLockPulse(piece) {
    const cells = [];
    const shape = piece.shape;
    const c = remapColor(piece.color, this.#visualTheme);
    for (let r = 0; r < shape.length; r++) {
      for (let col = 0; col < shape[r].length; col++) {
        if (shape[r][col]) {
          cells.push({
            x: (piece.x + col) * CELL_SIZE + CELL_SIZE / 2,
            y: (piece.y + r) * CELL_SIZE + CELL_SIZE / 2,
            color: c,
          });
        }
      }
    }
    this.#fx.lockPulse = { cells, scale: 1.12, alpha: 0.7 };
  }

  /**
   * Floating text that rises and fades (used for combos, T-spins, B2B, etc.).
   */
  triggerComboText(text, row) {
    if (!text) return;
    this.#fx.floatingTexts.push({
      text,
      x: (COLS * CELL_SIZE) / 2,
      y: Math.max(2, row) * CELL_SIZE,
      alpha: 1,
      color: this.#fx.textColor(text),
      size: text.includes('PERFECT') ? 28 : 20,
      vy: -2,
    });
  }

  /**
   * Slide the rows above a clear down once the peel has finished.
   */
  triggerFallingCells(fallingCells) {
    if (!fallingCells || fallingCells.length === 0) return;
    for (const fc of fallingCells) {
      this.#fx.fallingCells.push({
        col: fc.col,
        fromY: fc.fromRow,
        toY: fc.toRow,
        currentY: fc.fromRow,
        color: fc.color,
        velocity: 0,
      });
    }
  }

  drawFrame(state) {
    const ctx = this.#gameCtx;
    const canvasW = COLS * CELL_SIZE;
    const canvasH = ROWS * CELL_SIZE;
    this.#fx.frameCount++;
    this.#fx.advanceClock(performance.now());

    ctx.save();
    this.#applyScreenShake(ctx);
    ctx.clearRect(-10, -10, canvasW + 20, canvasH + 20);

    this.#drawBackground(ctx, canvasW, canvasH);
    this.#drawBoardLayer(ctx, state, canvasW, canvasH);
    this.#drawActivePiece(ctx, state);

    this.#fx.drawLockPulse(ctx);
    this.#fx.drawLockBounce(ctx);
    this.#drawFlashOverlay(ctx, canvasW, canvasH);
    this.#fx.drawPeelCubes(ctx);
    this.#tickParticles(ctx);
    this.#fx.drawFloatingTexts(ctx);

    ctx.restore();

    this.#drawHoldPiece(state.holdType);
    this.#drawNextPieces(state.nextTypes);
    this.#updateStats(state.score, state.level, state.lines, state.highScore);
  }

  #applyScreenShake(ctx) {
    if (this.#fx.shakeAmount > 0.5) {
      const sx = (Math.random() - 0.5) * this.#fx.shakeAmount;
      const sy = (Math.random() - 0.5) * this.#fx.shakeAmount;
      ctx.translate(sx, sy);
      this.#fx.shakeAmount *= this.#fx.shakeDecay;
    } else {
      this.#fx.shakeAmount = 0;
    }
  }

  #drawBackground(ctx, w, h) {
    ctx.fillStyle = this.#bgGradient;
    ctx.fillRect(0, 0, w, h);
    this.#fx.drawStars(ctx, w, h);
    this.#fx.drawVignette(ctx, w, h);
  }

  #drawBoardLayer(ctx, state, w, h) {
    this.#drawGrid(ctx);
    this.#fx.drawBoardEdgeGlow(ctx, w, h);
    this.#fx.drawSlamLines(ctx);
    if (!this.#fx.collapseActive) {
      this.#drawBoard(ctx, state.visibleGrid);
    }
    this.#fx.drawDangerZone(ctx);
    this.#fx.drawFallingCells(ctx);
    this.#fx.drawPeelingRows(ctx);
    this.#fx.drawCrackLines(ctx);
    this.#fx.drawRowFlashes(ctx);
    this.#fx.drawSweepBeams(ctx);
    this.#fx.drawDissolvingCells(ctx);
    this.#fx.drawCollapseGrid(ctx);
  }

  #drawActivePiece(ctx, state) {
    if (!state.currentPiece || state.gameOver) return;
    this.#fx.drawPieceTrail(ctx);
    if (state.ghostY !== undefined) {
      this.#drawGhostPiece(ctx, state.currentPiece.shape, state.currentPiece.x, state.ghostY, state.currentPiece.color);
    }
    ctx.shadowColor = remapColor(state.currentPiece.color, this.#visualTheme);
    ctx.shadowBlur = 18;
    this.#drawPiece(ctx, state.currentPiece.shape, state.currentPiece.x, state.currentPiece.y, state.currentPiece.color, 1);
    ctx.shadowBlur = 0;
  }

  #drawFlashOverlay(ctx, w, h) {
    if (this.#fx.flashAlpha <= 0.01) return;
    ctx.globalAlpha = Math.min(1, this.#fx.flashAlpha);
    ctx.fillStyle = this.#fx.flashColor;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    this.#fx.flashAlpha *= 0.96;
  }

  #tickParticles(ctx) {
    this.#fx.particles = this.#fx.particles.filter(p => p.life > 0);
    for (const p of this.#fx.particles) {
      p.update();
      p.draw(ctx);
    }
  }

  showOverlay(text) {
    this.#overlayTextEl.textContent = text;
    this.#overlayEl.classList.remove('hidden');
    this.#overlayEl.classList.add('visible');
  }

  hideOverlay() {
    this.#overlayEl.classList.remove('visible');
    this.#overlayEl.classList.add('hidden');
  }

  #drawGrid(ctx) {
    ctx.strokeStyle = 'rgba(27, 58, 92, 0.35)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL_SIZE);
      ctx.lineTo(COLS * CELL_SIZE, r * CELL_SIZE);
      ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL_SIZE, 0);
      ctx.lineTo(c * CELL_SIZE, ROWS * CELL_SIZE);
      ctx.stroke();
    }
  }

  #drawBoard(ctx, grid) {
    // Build a set of cells that are currently being animated (falling)
    // so we don't draw them at their final position yet.
    const fallingSet = new Set();
    for (const fc of this.#fx.fallingCells) {
      fallingSet.add(`${Math.round(fc.toY)},${fc.col}`);
    }

    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c]) {
          if (fallingSet.has(`${r},${c}`)) continue; // skip — being animated
          drawCell(ctx, c, r, grid[r][c], 1, this.#visualTheme, CELL_SIZE);
        }
      }
    }
  }

  #drawPiece(ctx, shape, px, py, color, alpha) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          drawCell(ctx, px + c, py + r, color, alpha, this.#visualTheme, CELL_SIZE);
        }
      }
    }
  }

  #drawGhostPiece(ctx, shape, px, py, color) {
    const c = remapColor(color, this.#visualTheme);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = hexToRgba(c, 0.45);
    ctx.fillStyle = hexToRgba(c, 0.07);
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          const cx = (px + c) * CELL_SIZE;
          const cy = (py + r) * CELL_SIZE;
          if (py + r < 0) continue;
          ctx.fillRect(cx + 1, cy + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          ctx.strokeRect(cx + 2, cy + 2, CELL_SIZE - 4, CELL_SIZE - 4);
        }
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Glass theme — translucent, smooth, with glossy shine and reflections */
  /** Concrete theme — rough, matte, textured with visible aggregate */
  /** Crystal theme — faceted, prismatic, with rainbow refraction */
  /** Metal theme — brushed steel, reflective, industrial */
  /** Ice theme — frosted, translucent, with crystalline surface cracks */
  /** Wood theme — warm grain lines, natural matte finish */
  /** Plastic theme — bright, shiny, round, toy-like */
  /** Gold theme — rich warm metallic with strong specular highlight */
  /** Silver theme — cool metallic with polished mirror-like finish */
  /** Simplified theme-aware cell for small preview canvases */
  #drawHoldPiece(type) {
    this.#drawHoldToCanvas(this.#holdCtx, type);
    if (this.#mobileHoldCtx) this.#drawHoldToCanvas(this.#mobileHoldCtx, type);
  }

  #drawHoldToCanvas(ctx, type) {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, '#0c1a2e');
    bg.addColorStop(1, '#0a1222');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!type) return;
    drawPreviewPiece(ctx, type, canvas.width, canvas.height, this.#visualTheme);
  }

  #drawNextPieces(types) {
    this.#drawNextToCanvas(this.#nextCtx, types, 24);
    if (this.#mobileNextCtx) this.#drawNextToCanvas(this.#mobileNextCtx, types, 12);
  }

  #drawNextToCanvas(ctx, types, cellSize) {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, '#0c1a2e');
    bg.addColorStop(1, '#0a1222');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!types || types.length === 0) return;

    const slotH = canvas.height / 3;
    for (let i = 0; i < types.length; i++) {
      const shape = getShapeForType(types[i]);
      const color = getColorForType(types[i]);
      const offsetX = (canvas.width - shape[0].length * cellSize) / 2;
      const offsetY = i * slotH + (slotH - shape.length * cellSize) / 2;

      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c]) {
            const px = offsetX + c * cellSize;
            const py = offsetY + r * cellSize;
            const inset = 1;
            const w = cellSize - 2;
            drawMiniCell(ctx, px, py, inset, w, cellSize, color, this.#visualTheme);
          }
        }
      }

      if (i < types.length - 1) {
        ctx.strokeStyle = 'rgba(27, 58, 92, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(10, (i + 1) * slotH);
        ctx.lineTo(canvas.width - 10, (i + 1) * slotH);
        ctx.stroke();
      }
    }
  }

  #updateStats(score, level, lines, highScore) {
    // Smooth score tween
    this.#displayScore += (score - this.#displayScore) * 0.15;
    this.#displayLines += (lines - this.#displayLines) * 0.2;
    const roundedScore = Math.round(this.#displayScore);
    const roundedLines = Math.round(this.#displayLines);
    this.#scoreEl.textContent = roundedScore;
    this.#levelEl.textContent = level;
    this.#linesEl.textContent = roundedLines;
    if (this.#mobileScoreEl) this.#mobileScoreEl.textContent = roundedScore;
    if (this.#mobileLevelEl) this.#mobileLevelEl.textContent = level;
    if (this.#mobileLinesEl) this.#mobileLinesEl.textContent = roundedLines;
    const hsEl = document.getElementById('high-score');
    if (hsEl) hsEl.textContent = highScore || 0;
  }

  /**
   * Level-up celebration: golden flash + floating text + extra shake.
   */
  triggerLevelUpEffect(newLevel) {
    // Flash gold
    this.#fx.flashColor = '#ffe060';
    this.#fx.flashAlpha = 0.5;
    this.#fx.shakeAmount = 6;

    // Add large floating text
    this.#fx.floatingTexts.push({
      text: `LEVEL ${newLevel}`,
      x: (COLS * CELL_SIZE) / 2,
      y: (ROWS * CELL_SIZE) / 2,
      alpha: 1.2,
      color: '#ffe060',
      size: 36,
      vy: -1.5,
    });

    // Add golden particles
    const cx = (COLS * CELL_SIZE) / 2;
    const cy = (ROWS * CELL_SIZE) / 2;
    for (let i = 0; i < 40 && this.#fx.particles.length < MAX_PARTICLES; i++) {
      const angle = (Math.PI * 2 * i) / 40;
      const speed = 2 + Math.random() * 4;
      const p = new Particle(cx, cy, '#ffe060');
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.size = 2 + Math.random() * 3;
      p.life = 50 + Math.random() * 30;
      p.gravity = 0.03;
      this.#fx.particles.push(p);
    }
  }

  /**
   * Game over collapse — cells fall row by row from top to bottom with staggered delay.
   */
  triggerGameOverCollapse(grid) {
    this.#fx.collapseGrid = [];
    this.#fx.collapseActive = true;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c]) {
          const delay = r * 3 + Math.random() * 4; // top rows first
          this.#fx.collapseGrid.push({
            px: c * CELL_SIZE + CELL_SIZE / 2,
            py: r * CELL_SIZE + CELL_SIZE / 2,
            color: remapColor(grid[r][c], this.#visualTheme),
            alpha: 1,
            delay,
            vy: 0,
            vx: (Math.random() - 0.5) * 2,
            rotation: 0,
            rotSpeed: (Math.random() - 0.5) * 0.1,
            gravity: 0.15 + Math.random() * 0.1,
          });
        }
      }
    }
    this.#fx.shakeAmount = 8;
  }

  /**
   * Set danger level from game (0 = safe, 1 = critical).
   */
  setDangerLevel(level) { this.#fx.dangerLevel = level; }

  /** Whether the game over collapse animation is still playing. */
  get isCollapsing() { return this.#fx.isCollapsing; }

  /**
   * Add a piece trail frame for motion blur.
   */
  addTrailFrame(piece) {
    if (!piece) return;
    this.#fx.pieceTrail.push({
      shape: piece.shape,
      x: piece.x, y: piece.y,
      color: piece.color,
      alpha: 0.25,
    });
    if (this.#fx.pieceTrail.length > 3) this.#fx.pieceTrail.shift();
  }

  /**
   * Lock bounce — brief squash then spring back.
   */
  triggerLockBounce(piece) {
    const cells = [];
    const shape = piece.shape;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          cells.push({
            x: (piece.x + c) * CELL_SIZE + CELL_SIZE / 2,
            y: (piece.y + r) * CELL_SIZE + CELL_SIZE / 2,
            color: remapColor(piece.color, this.#visualTheme),
          });
        }
      }
    }
    this.#fx.lockBounce = { cells, scaleX: 1.15, scaleY: 0.75, velX: 0, velY: 0 };
  }

  // ─── New draw methods ────────────────────────────────────────────────

}

export { Renderer };
