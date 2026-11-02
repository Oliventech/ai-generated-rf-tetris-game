/**
 * EffectsEngine — visual effects, particles, animations.
 * Extracted from Renderer for modularity (< 1000 lines per file).
 */
import { drawCell, remapColor, getThemeAccent } from './cell-themes.js';
import { Particle, MAX_PARTICLES, STARS } from './particles.js';

const CELL_SIZE = 32;
const COLS = 10;
const ROWS = 20;

// Line clear timing, in animation time (the speed slider's default of 2× plays it in real time).
const LOOSEN_MS = 100;          // rows sit loose before the first block lets go
const SWEEP_MS = 750;           // first to last column release, left to right
const RELEASE_JITTER_MS = 15;   // keeps stacked rows from releasing in perfect lockstep
const SLIDE_DELAY_MS = 50;      // pause between the last release and the slide
const ROW_SOUND_GAP_MS = 90;    // spaces out row sounds on multi-line clears
const MAX_FRAME_MS = 50;        // a resumed or stalled frame must not jump the animation

const LOOSE_SCALE = 0.86;       // blocks shrink in their row while waiting to let go
const SLIDE_GRAVITY = 70;       // rows/s² for the stack settling after a clear
const CUBE_GRAVITY = 44;        // rows/s² for released blocks
const CUBES_PER_SIDE = 2;       // each block breaks into a 2×2 of smaller cubes
const POP_SPEED = 6;            // rows/s upward kick when a cube lets go
const CUBE_DRIFT = 0.8;         // rows/s of sideways scatter
const CUBE_SPIN = 12;           // rad/s
const CUBE_GROWTH = 0.35;       // extra scale after falling the full board height

class EffectsEngine {
  // Animation state
  particles = [];
  shakeAmount = 0;
  shakeDecay = 0.9;
  flashAlpha = 0;
  flashColor = '#c8d8ff';
  frameCount = 0;
  rowFlashData = [];
  sweepBeams = [];
  dissolveGrid = [];
  peelRows = [];
  peelCubes = [];
  peelElapsed = 0;
  peelEnd = 0;
  vanishPhase = false;
  stepSeconds = 0;
  lastClockTime = 0;
  cubeSprites = new Map();
  slamLines = [];
  lockPulse = null;
  crackLines = [];
  floatingTexts = [];
  fallingCells = [];
  collapseGrid = [];
  collapseActive = false;
  starSpeedBoost = 0;
  dangerLevel = 0;
  prevDangerLevel = 0;
  pieceTrail = [];
  lockBounce = null;
  soundCallbacks = null;
  animSpeed = 2;
  visualTheme = 'glass';

  get isAnimating() {
    return this.vanishPhase || this.fallingCells.length > 0;
  }

  /** Reset all animation state — call on game start/restart. */
  resetAnimations() {
    this.vanishPhase = false;
    this.peelRows = [];
    this.peelCubes = [];
    this.fallingCells = [];
    this.collapseActive = false;
    this.collapseGrid = [];
    this.shakeAmount = 0;
  }

  get isCollapsing() {
    return this.collapseActive;
  }

  addCrackLines(clearedRows) {
    for (const row of clearedRows) {
      // Several crack lines emanate from random points along the row
      const crackCount = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < crackCount; i++) {
        const startX = Math.random() * COLS * CELL_SIZE;
        const startY = row * CELL_SIZE + Math.random() * CELL_SIZE;
        const segments = [];
        let cx = startX;
        let cy = startY;
        const segCount = 4 + Math.floor(Math.random() * 5);
        for (let s = 0; s < segCount; s++) {
          const nx = cx + (Math.random() - 0.5) * CELL_SIZE * 1.5;
          const ny = cy + (Math.random() - 0.5) * CELL_SIZE;
          segments.push({ x1: cx, y1: cy, x2: nx, y2: ny });
          cx = nx;
          cy = ny;
        }
        this.crackLines.push({ segments, alpha: 1, delay: i * 2 });
      }
    }
  }

  addRowFlashes(clearedRows, isTetris) {
    const color = isTetris ? '#ffe080' : '#ffffff';
    for (let i = 0; i < clearedRows.length; i++) {
      // Stagger each row's flash — each row lights up one after another
      this.rowFlashData.push({ row: clearedRows[i], alpha: 1.5, color, delay: i * 18 });
    }
  }

  addSweepBeams(clearedRows, count, isTetris) {
    const accent = getThemeAccent(this.visualTheme);
    const color = isTetris ? '#ffe080' : accent.slam;
    for (let i = 0; i < clearedRows.length; i++) {
      this.sweepBeams.push({
        row: clearedRows[i],
        x: -CELL_SIZE * 3,
        speed: 4 + count,
        width: CELL_SIZE * 5,
        alpha: 0.95,
        delay: 15 + i * 8,
        color,
      });
    }
  }

  addDissolveEffects(clearedRows, clearedRowColors) {
    for (let i = 0; i < clearedRows.length; i++) {
      const row = clearedRows[i];
      const colors = clearedRowColors[i];
      for (let c = 0; c < colors.length; c++) {
        if (!colors[c]) continue;
        const remapped = remapColor(colors[c], this.visualTheme);
        const shardCount = 3 + Math.floor(Math.random() * 2);
        for (let s = 0; s < shardCount; s++) {
          const offsetX = (Math.random() - 0.5) * CELL_SIZE * 0.6;
          const offsetY = (Math.random() - 0.5) * CELL_SIZE * 0.6;
          this.dissolveGrid.push({
            px: c * CELL_SIZE + CELL_SIZE / 2 + offsetX,
            py: row * CELL_SIZE + CELL_SIZE / 2 + offsetY,
            color: remapped,
            scale: 0.4 + Math.random() * 0.5,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.06,
            alpha: 1,
            delay: 25 + i * 8 + c * 1.5 + s * 3,
            vx: (Math.random() - 0.5) * 2,
            vy: -0.3 + Math.random() * -1.5,
            isShard: true,
          });
        }
      }
    }
  }

  addExplosionParticles(clearedRows, clearedRowColors, count) {
    const particlesPerCell = 4 + count * 3;
    const accent = getThemeAccent(this.visualTheme);
    for (let i = 0; i < clearedRows.length; i++) {
      const row = clearedRows[i];
      const colors = clearedRowColors[i];
      for (let c = 0; c < colors.length; c++) {
        const cx = c * CELL_SIZE + CELL_SIZE / 2;
        const cy = row * CELL_SIZE + CELL_SIZE / 2;
        const color = remapColor(colors[c], this.visualTheme) || accent.dust;
        for (let p = 0; p < particlesPerCell; p++) {
          if (this.particles.length < MAX_PARTICLES) {
            const shard = new Particle(cx, cy, color);
            if (Math.random() < 0.4) {
              shard.color = accent.shard;
            }
            this.particles.push(shard);
          }
        }
      }
    }
  }

  addSlamLines(piece, intensity) {
    const slamColor = remapColor(piece.color, this.visualTheme);
    const shape = piece.shape;
    for (let c = 0; c < shape[0].length; c++) {
      for (let r = 0; r < shape.length; r++) {
        if (shape[r][c]) {
          this.slamLines.push({
            x: (piece.x + c) * CELL_SIZE + CELL_SIZE / 2,
            topY: 0,
            bottomY: (piece.y + r) * CELL_SIZE,
            alpha: 0.5 * intensity,
            width: 2,
            color: slamColor,
          });
          break;
        }
      }
    }
  }

  addDustParticles(piece) {
    const accent = getThemeAccent(this.visualTheme);
    const dustColor = remapColor(piece.color, this.visualTheme) || accent.dust;
    const shape = piece.shape;
    for (let c = 0; c < shape[0].length; c++) {
      for (let r = shape.length - 1; r >= 0; r--) {
        if (shape[r][c]) {
          const cx = (piece.x + c) * CELL_SIZE + CELL_SIZE / 2;
          const cy = (piece.y + r + 1) * CELL_SIZE;
          for (let i = 0; i < 3; i++) {
            if (this.particles.length < MAX_PARTICLES) {
              const p = new Particle(cx, cy, dustColor);
              p.vy = -(Math.random() * 2 + 0.5);
              p.vx = (Math.random() - 0.5) * 6;
              p.size = 1.5 + Math.random() * 2;
              p.gravity = 0.08;
              this.particles.push(p);
            }
          }
          break;
        }
      }
    }
  }

  drawStars(ctx, w, h) {
    const time = this.frameCount * 0.02 * this.starSpeedBoost;
    // Decay speed boost back to 1
    this.starSpeedBoost += (1 - this.starSpeedBoost) * 0.02;
    for (const star of STARS) {
      const twinkle = 0.3 + 0.7 * ((Math.sin(time * star.speed + star.phase) + 1) * 0.5);
      ctx.globalAlpha = twinkle * 0.6;
      ctx.fillStyle = '#6090c0';
      ctx.beginPath();
      ctx.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawVignette(ctx, w, h) {
    const vig = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, h * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  drawSlamLines(ctx) {
    if (this.slamLines.length === 0) return;
    const accent = getThemeAccent(this.visualTheme);
    for (const sl of this.slamLines) {
      ctx.save();
      ctx.globalAlpha = sl.alpha;
      ctx.strokeStyle = sl.color || accent.slam;
      ctx.lineWidth = sl.width;
      ctx.beginPath();
      ctx.moveTo(sl.x, sl.topY);
      ctx.lineTo(sl.x, sl.bottomY);
      ctx.stroke();
      ctx.restore();
      sl.alpha *= 0.85;
    }
    this.slamLines = this.slamLines.filter(sl => sl.alpha > 0.01);
  }

  drawCrackLines(ctx) {
    if (this.crackLines.length === 0) return;
    const accent = getThemeAccent(this.visualTheme);
    for (const cl of this.crackLines) {
      if (cl.delay > 0) { cl.delay--; continue; }
      ctx.save();
      ctx.globalAlpha = cl.alpha;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = accent.slam;
      ctx.shadowBlur = 8 * cl.alpha;
      ctx.lineWidth = 1.5;
      for (const seg of cl.segments) {
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
      }
      ctx.restore();
      cl.alpha -= 0.008;
    }
    this.crackLines = this.crackLines.filter(cl => cl.alpha > 0.01);
  }

  drawRowFlashes(ctx) {
    if (this.rowFlashData.length === 0) return;
    for (const rf of this.rowFlashData) {
      if (rf.delay > 0) { rf.delay--; continue; }
      ctx.save();
      // Pulsing glow effect — brighter and more visible
      const pulse = 0.85 + 0.15 * Math.sin(this.frameCount * 0.4);
      ctx.globalAlpha = Math.min(1, rf.alpha) * pulse;
      ctx.fillStyle = rf.color;
      ctx.fillRect(0, rf.row * CELL_SIZE - 4, COLS * CELL_SIZE, CELL_SIZE + 8);
      ctx.shadowColor = rf.color;
      ctx.shadowBlur = 40 * Math.min(1, rf.alpha);
      ctx.fillRect(0, rf.row * CELL_SIZE - 6, COLS * CELL_SIZE, CELL_SIZE + 12);
      ctx.restore();
      rf.alpha -= 0.012;
    }
    this.rowFlashData = this.rowFlashData.filter(rf => rf.alpha > 0.01);
  }

  drawSweepBeams(ctx) {
    if (this.sweepBeams.length === 0) return;
    for (const sb of this.sweepBeams) {
      if (sb.delay > 0) { sb.delay--; continue; }
      ctx.save();
      ctx.globalAlpha = sb.alpha;
      const grad = ctx.createLinearGradient(sb.x, 0, sb.x + sb.width, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.2, sb.color);
      grad.addColorStop(0.5, '#ffffff');
      grad.addColorStop(0.8, sb.color);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(sb.x, sb.row * CELL_SIZE - 3, sb.width, CELL_SIZE + 6);
      ctx.restore();
      sb.x += sb.speed;
      if (sb.x > COLS * CELL_SIZE + sb.width) sb.alpha = 0;
      sb.alpha *= 0.995;
    }
    this.sweepBeams = this.sweepBeams.filter(sb => sb.alpha > 0.01);
  }

  drawDissolvingCells(ctx) {
    if (this.dissolveGrid.length === 0) return;
    for (const dc of this.dissolveGrid) {
      if (dc.delay > 0) { dc.delay--; continue; }
      ctx.save();
      ctx.globalAlpha = dc.alpha;
      ctx.translate(dc.px, dc.py);
      ctx.rotate(dc.rotation);
      ctx.scale(dc.scale, dc.scale);
      const half = CELL_SIZE / 2;

      // Draw as glass shard triangle
      ctx.beginPath();
      ctx.moveTo(0, -half);
      ctx.lineTo(half * 0.7, half * 0.6);
      ctx.lineTo(-half * 0.5, half * 0.4);
      ctx.closePath();
      ctx.fillStyle = dc.color;
      ctx.shadowColor = dc.color;
      ctx.shadowBlur = 10 * dc.alpha;
      ctx.fill();
      // Glass edge highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.restore();
      dc.rotation += dc.rotSpeed;
      dc.scale *= 0.992;
      dc.alpha -= 0.005;
      dc.px += dc.vx;
      dc.py += dc.vy;
      dc.vy += 0.02;
    }
    this.dissolveGrid = this.dissolveGrid.filter(dc => dc.alpha > 0.01);
  }

  drawFallingCells(ctx) {
    if (this.fallingCells.length === 0) return;
    if (this.vanishPhase) {
      for (const fc of this.fallingCells) {
        drawCell(ctx, fc.col, fc.fromY, fc.color, 1, this.visualTheme, CELL_SIZE);
      }
      return;
    }
    // Every cell shares one velocity, so the stack slides as a solid slab.
    for (const fc of this.fallingCells) {
      fc.velocity += SLIDE_GRAVITY * this.stepSeconds;
      fc.currentY = Math.min(fc.toY, fc.currentY + fc.velocity * this.stepSeconds);
      drawCell(ctx, fc.col, fc.currentY, fc.color, 1, this.visualTheme, CELL_SIZE);
    }
    this.fallingCells = this.fallingCells.filter(fc => fc.currentY < fc.toY);
  }

  /** Advance the animation clock by real elapsed time, scaled by the speed slider. */
  advanceClock(now) {
    const elapsed = Math.min(Math.max(now - this.lastClockTime, 0), MAX_FRAME_MS);
    this.lastClockTime = now;
    this.stepSeconds = (elapsed / 1000) * (this.animSpeed / 2);
  }

  /** Begin a line clear: rows come loose, then let go of their blocks left to right. */
  startPeel(clearedRows, clearedRowColors) {
    const count = clearedRows.length;
    const lastRelease = LOOSEN_MS + SWEEP_MS + RELEASE_JITTER_MS;
    this.peelRows = clearedRows.map((row, i) => ({
      row,
      rowIndex: i,
      cells: clearedRowColors[i].map((color, col) => ({
        col,
        color,
        releaseAt: LOOSEN_MS + (col / (COLS - 1)) * SWEEP_MS + Math.random() * RELEASE_JITTER_MS,
      })),
      looseSoundAt: i * ROW_SOUND_GAP_MS,
      clearSoundAt: lastRelease - (count - 1 - i) * ROW_SOUND_GAP_MS,
      looseSoundPlayed: false,
      clearSoundPlayed: false,
    }));
    this.peelElapsed = 0;
    this.peelEnd = lastRelease + SLIDE_DELAY_MS;
    this.vanishPhase = true;
  }

  drawPeelingRows(ctx) {
    if (!this.vanishPhase) return;
    this.peelElapsed += this.stepSeconds * 1000;
    for (const pr of this.peelRows) {
      this.#playPeelSounds(pr);
      pr.cells = pr.cells.filter((cell) => {
        if (this.peelElapsed >= cell.releaseAt) {
          this.#releaseCubes(cell, pr.row);
          return false;
        }
        this.#drawLooseCell(ctx, cell, pr.row);
        return true;
      });
    }
    if (this.peelElapsed >= this.peelEnd) {
      this.vanishPhase = false;
      this.peelRows = [];
    }
  }

  #playPeelSounds(pr) {
    if (!pr.looseSoundPlayed && this.peelElapsed >= pr.looseSoundAt) {
      pr.looseSoundPlayed = true;
      this.soundCallbacks.onRowHighlight(pr.rowIndex);
    }
    if (!pr.clearSoundPlayed && this.peelElapsed >= pr.clearSoundAt) {
      pr.clearSoundPlayed = true;
      this.soundCallbacks.onRowCleared(pr.rowIndex);
    }
  }

  /** A block still in its row, drawn smaller over a dark backing so the row reads as coming apart. */
  #drawLooseCell(ctx, cell, row) {
    const cx = (cell.col + 0.5) * CELL_SIZE;
    const cy = (row + 0.5) * CELL_SIZE;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(cell.col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    ctx.translate(cx, cy);
    ctx.scale(LOOSE_SCALE, LOOSE_SCALE);
    ctx.translate(-cx, -cy);
    drawCell(ctx, cell.col, row, cell.color, 1, this.visualTheme, CELL_SIZE);
    ctx.restore();
  }

  /** Break a block into small cubes; its right half lets go a moment later, keeping the sweep smooth. */
  #releaseCubes(cell, row) {
    const columnGap = SWEEP_MS / (COLS - 1) / 1000;
    const sprite = this.#cubeSprite(cell.color);
    for (let cx = 0; cx < CUBES_PER_SIDE; cx++) {
      for (let cy = 0; cy < CUBES_PER_SIDE; cy++) {
        const y = row + (cy + 0.5) / CUBES_PER_SIDE;
        this.peelCubes.push({
          x: cell.col + (cx + 0.5) / CUBES_PER_SIDE,
          y,
          startY: y,
          wait: (cx / CUBES_PER_SIDE) * columnGap,
          vx: (Math.random() - 0.5) * CUBE_DRIFT,
          vy: -POP_SPEED * (0.9 + Math.random() * 0.2),
          rotation: 0,
          spin: (Math.random() - 0.5) * CUBE_SPIN,
          tumble: Math.random() * Math.PI * 2,
          tumbleSpeed: (Math.random() - 0.5) * CUBE_SPIN,
          sprite,
        });
      }
    }
  }

  /** A block drawn once per theme and colour, so a thick ribbon stays cheap to draw. */
  #cubeSprite(color) {
    const key = `${this.visualTheme}:${color}`;
    let sprite = this.cubeSprites.get(key);
    if (!sprite) {
      sprite = document.createElement('canvas');
      sprite.width = CELL_SIZE;
      sprite.height = CELL_SIZE;
      drawCell(sprite.getContext('2d'), 0, 0, color, 1, this.visualTheme, CELL_SIZE);
      this.cubeSprites.set(key, sprite);
    }
    return sprite;
  }

  /** Released cubes fall on top of the board until they leave the bottom of the canvas. */
  drawPeelCubes(ctx) {
    if (this.peelCubes.length === 0) return;
    const size = CELL_SIZE / CUBES_PER_SIDE;
    const half = size / 2;
    const dt = this.stepSeconds;
    for (const cube of this.peelCubes) {
      if (cube.wait > 0) {
        cube.wait -= dt;
      } else {
        cube.vy += CUBE_GRAVITY * dt;
        cube.x += cube.vx * dt;
        cube.y += cube.vy * dt;
        cube.rotation += cube.spin * dt;
        cube.tumble += cube.tumbleSpeed * dt;
      }
      const grow = 1 + (Math.max(0, cube.y - cube.startY) / ROWS) * CUBE_GROWTH;
      ctx.save();
      ctx.translate(cube.x * CELL_SIZE, cube.y * CELL_SIZE);
      ctx.rotate(cube.rotation);
      ctx.scale(grow * (0.85 + 0.15 * Math.cos(cube.tumble)), grow * (0.85 + 0.15 * Math.sin(cube.tumble)));
      ctx.drawImage(cube.sprite, -half, -half, size, size);
      ctx.restore();
    }
    this.peelCubes = this.peelCubes.filter(cube => cube.y < ROWS + 2);
  }

  drawLockPulse(ctx) {
    if (!this.lockPulse) return;
    const lp = this.lockPulse;
    ctx.save();
    ctx.globalAlpha = lp.alpha;
    for (const cell of lp.cells) {
      ctx.save();
      ctx.translate(cell.x, cell.y);
      ctx.scale(lp.scale, lp.scale);
      ctx.shadowColor = cell.color;
      ctx.shadowBlur = 15 * lp.alpha;
      ctx.fillStyle = cell.color;
      ctx.fillRect(-CELL_SIZE / 2 + 1, -CELL_SIZE / 2 + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.restore();
    }
    ctx.restore();
    lp.scale += (1 - lp.scale) * 0.3;
    lp.alpha *= 0.82;
    if (lp.alpha < 0.02) this.lockPulse = null;
  }

  drawFloatingTexts(ctx) {
    if (this.floatingTexts.length === 0) return;
    for (const ft of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = ft.alpha;
      ctx.font = `bold ${ft.size}px 'Courier New', monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = ft.color;
      ctx.shadowColor = ft.color;
      ctx.shadowBlur = 10;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
      ft.y += ft.vy;
      ft.vy *= 0.97;
      ft.alpha -= 0.02;
    }
    this.floatingTexts = this.floatingTexts.filter(ft => ft.alpha > 0.01);
  }

  drawCollapseGrid(ctx) {
    if (this.collapseGrid.length === 0) {
      if (this.collapseActive) this.collapseActive = false;
      return;
    }
    const half = CELL_SIZE / 2;
    for (const dc of this.collapseGrid) {
      if (dc.delay > 0) { dc.delay--; continue; }
      ctx.save();
      ctx.globalAlpha = dc.alpha;
      ctx.translate(dc.px, dc.py);
      ctx.rotate(dc.rotation);

      ctx.fillStyle = dc.color;
      ctx.fillRect(-half + 1, -half + 1, CELL_SIZE - 2, CELL_SIZE - 2);

      ctx.restore();
      dc.rotation += dc.rotSpeed;
      dc.vy += dc.gravity;
      dc.py += dc.vy;
      dc.px += dc.vx;
      dc.alpha -= 0.008;
    }
    this.collapseGrid = this.collapseGrid.filter(
      dc => dc.alpha > 0.01 && dc.py < (ROWS + 5) * CELL_SIZE
    );
  }

  drawDangerZone(ctx) {
    if (this.dangerLevel < 0.05) return;
    const d = this.dangerLevel;
    const w = COLS * CELL_SIZE;
    const h = ROWS * CELL_SIZE;
    const pulse = 0.5 + 0.5 * Math.sin(this.frameCount * (0.08 + d * 0.12));

    this.#drawDangerOverlay(ctx, d, pulse, w, h);
    this.#drawDangerBorder(ctx, d, pulse, w, h);

    if (d > 0.5) {
      const textAlpha = (d - 0.5) * 2 * pulse;
      ctx.save();
      ctx.globalAlpha = Math.min(0.9, textAlpha);
      ctx.font = `bold ${20 + Math.floor(d * 10)}px 'Courier New', monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff4040';
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 15;
      ctx.fillText('⚠ DANGER ⚠', w / 2, 30);
      ctx.restore();
    }

    if (d > 0.1 && this.prevDangerLevel < 0.1) {
      this.floatingTexts.push({
        text: 'DANGER ZONE!', x: w / 2, y: h * 0.3,
        alpha: 1.5, color: '#ff4040', size: 28, vy: -1,
      });
    }
    this.prevDangerLevel = d;
  }

  #drawDangerOverlay(ctx, d, pulse, w) {
    const height = Math.max(3, Math.ceil(10 * d)) * CELL_SIZE;
    ctx.save();
    ctx.globalAlpha = d * 0.4 * pulse;
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#ff2020');
    grad.addColorStop(0.5, 'rgba(255,40,20,0.5)');
    grad.addColorStop(1, 'rgba(255,32,32,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, height);
    ctx.restore();
  }

  #drawDangerBorder(ctx, d, pulse, w, h) {
    ctx.save();
    ctx.globalAlpha = d * 0.6 * pulse;
    ctx.fillStyle = '#ff3030';
    ctx.fillRect(0, 0, 3, h);
    ctx.fillRect(w - 3, 0, 3, h);
    ctx.restore();
  }

  drawBoardEdgeGlow(ctx, w, h) {
    const intensity = 0.08;
    const color = this.dangerLevel > 0.5 ? '255,60,60' : '90,176,255';
    // Left edge
    const left = ctx.createLinearGradient(0, 0, 6, 0);
    left.addColorStop(0, `rgba(${color},${intensity})`);
    left.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, 6, h);
    // Right edge
    const right = ctx.createLinearGradient(w, 0, w - 6, 0);
    right.addColorStop(0, `rgba(${color},${intensity})`);
    right.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = right;
    ctx.fillRect(w - 6, 0, 6, h);
    // Bottom edge
    const bottom = ctx.createLinearGradient(0, h, 0, h - 6);
    bottom.addColorStop(0, `rgba(${color},${intensity * 1.5})`);
    bottom.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = bottom;
    ctx.fillRect(0, h - 6, w, 6);
  }

  drawPieceTrail(ctx) {
    for (const t of this.pieceTrail) {
      if (t.alpha < 0.02) continue;
      ctx.save();
      ctx.globalAlpha = t.alpha;
      for (let r = 0; r < t.shape.length; r++) {
        for (let c = 0; c < t.shape[r].length; c++) {
          if (t.shape[r][c]) {
            drawCell(ctx, t.x + c, t.y + r, t.color, t.alpha, this.visualTheme, CELL_SIZE);
          }
        }
      }
      ctx.restore();
      t.alpha *= 0.5;
    }
    this.pieceTrail = this.pieceTrail.filter(t => t.alpha > 0.02);
  }

  drawLockBounce(ctx) {
    if (!this.lockBounce) return;
    const lb = this.lockBounce;
    ctx.save();
    for (const cell of lb.cells) {
      ctx.save();
      ctx.translate(cell.x, cell.y);
      ctx.scale(lb.scaleX, lb.scaleY);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = cell.color;
      ctx.fillRect(-CELL_SIZE / 2 + 1, -CELL_SIZE / 2 + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.restore();
    }
    ctx.restore();

    // Spring physics
    lb.velX += (1 - lb.scaleX) * 0.3;
    lb.velY += (1 - lb.scaleY) * 0.3;
    lb.velX *= 0.75;
    lb.velY *= 0.75;
    lb.scaleX += lb.velX;
    lb.scaleY += lb.velY;

    if (Math.abs(lb.scaleX - 1) < 0.01 && Math.abs(lb.scaleY - 1) < 0.01) {
      this.lockBounce = null;
    }
  }

  textColor(text) {
    if (text.includes('PERFECT')) return '#ff80ff';
    if (text.includes('BACK')) return '#ffa040';
    if (text.includes('T-SPIN')) return '#c060ff';
    return '#80c0ff';
  }

}

export { EffectsEngine };