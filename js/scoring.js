/**
 * Score calculation, level progression, combo/B2B tracking, T-spin scoring.
 */

const LINE_POINTS = Object.freeze([0, 100, 300, 500, 800]);
const TSPIN_POINTS = Object.freeze({ none: 400, single: 800, double: 1200, triple: 1600 });
const MINI_TSPIN_POINTS = Object.freeze({ none: 100, single: 200 });
const PERFECT_CLEAR_POINTS = 3000;
const LINES_PER_LEVEL = 10;
const COMBO_BONUS = 50; // per combo level per game level

// Gravity: frames per drop at 60fps per level
const GRAVITY_TABLE = Object.freeze([
  48, 43, 38, 33, 28, 23, 18, 13, 8, 6,
  6, 6, 6, 5, 5, 5, 4, 4, 4, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 2,
]);

class Scoring {
  #score = 0;
  #level = 1;
  #lines = 0;
  #combo = 0;
  #backToBack = 0;
  #lastClearWasDifficult = false;
  #highScore = 0;
  #dropSpeedMultiplier = 1;

  get score() { return this.#score; }
  get level() { return this.#level; }
  get lines() { return this.#lines; }
  get combo() { return this.#combo; }
  get backToBack() { return this.#backToBack; }
  get highScore() { return this.#highScore; }

  /** Set drop speed multiplier (0.5 = half speed, 2 = double speed). */
  setDropSpeedMultiplier(m) { this.#dropSpeedMultiplier = Math.max(0.25, Math.min(10, m)); }

  constructor() {
    this.#loadHighScore();
  }

  reset() {
    this.#score = 0;
    this.#level = 1;
    this.#lines = 0;
    this.#combo = 0;
    this.#backToBack = 0;
    this.#lastClearWasDifficult = false;
  }

  /**
   * Add points for cleared lines with T-spin type.
   * Returns { leveledUp, pointsAwarded, isBackToBack, combo }.
   */
  addLineClear(count, tSpinType = 'none') {
    if (count < 0) return { leveledUp: false, pointsAwarded: 0, isBackToBack: false, combo: 0 };

    // Combo tracking
    this.#combo++;

    // Calculate base points
    let points = this.#calcBasePoints(count, tSpinType) * this.#level;

    // Back-to-back + combo bonuses
    const { isBackToBack, total } = this.#applyBonuses(points, count, tSpinType);
    points = total;

    this.#score += points;

    // Lines and level
    if (count > 0) {
      this.#lines += count;
    }
    const newLevel = Math.floor(this.#lines / LINES_PER_LEVEL) + 1;
    let leveledUp = false;
    if (newLevel > this.#level) {
      this.#level = newLevel;
      leveledUp = true;
    }

    // High score
    if (this.#score > this.#highScore) {
      this.#highScore = this.#score;
      this.#saveHighScore();
    }

    return { leveledUp, pointsAwarded: points, isBackToBack, combo: this.#combo };
  }

  /** Add points for a perfect clear. */
  addPerfectClear() {
    const points = PERFECT_CLEAR_POINTS * this.#level;
    this.#score += points;
    if (this.#score > this.#highScore) {
      this.#highScore = this.#score;
      this.#saveHighScore();
    }
    return points;
  }

  /** Reset combo when a piece locks without clearing lines. */
  resetCombo() {
    this.#combo = 0;
  }

  addSoftDrop(cells) {
    this.#score += cells;
  }

  addHardDrop(cells) {
    this.#score += cells * 2;
  }

  /**
   * Get the current gravity interval in milliseconds.
   */
  getDropInterval() {
    const idx = Math.min(this.#level - 1, GRAVITY_TABLE.length - 1);
    const frames = GRAVITY_TABLE[idx];
    return (frames / 60) * 1000 / this.#dropSpeedMultiplier;
  }

  #calcBasePoints(count, tSpinType) {
    if (tSpinType === 'full') {
      const lookup = [TSPIN_POINTS.none, TSPIN_POINTS.single, TSPIN_POINTS.double, TSPIN_POINTS.triple];
      return lookup[count] ?? TSPIN_POINTS.triple;
    }
    if (tSpinType === 'mini') {
      return count === 0 ? MINI_TSPIN_POINTS.none : MINI_TSPIN_POINTS.single;
    }
    return LINE_POINTS[Math.min(count, LINE_POINTS.length - 1)];
  }

  #applyBonuses(basePoints, count, tSpinType) {
    let total = basePoints;
    const isDifficult = count >= 4 || (tSpinType !== 'none' && count > 0);
    let isBackToBack = false;

    if (isDifficult && this.#lastClearWasDifficult) {
      this.#backToBack++;
      total = Math.floor(total * 1.5);
      isBackToBack = true;
    }
    if (isDifficult) {
      this.#lastClearWasDifficult = true;
    } else if (count > 0) {
      this.#backToBack = 0;
      this.#lastClearWasDifficult = false;
    }

    if (this.#combo > 1) total += COMBO_BONUS * this.#combo * this.#level;

    return { isBackToBack, total };
  }

  #loadHighScore() {
    try {
      this.#highScore = Number(localStorage.getItem('tetris-highscore')) || 0;
    } catch { this.#highScore = 0; }
  }

  #saveHighScore() {
    try {
      localStorage.setItem('tetris-highscore', String(this.#highScore));
    } catch { /* localStorage unavailable */ }
  }
}

export { Scoring };
