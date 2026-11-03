/**
 * Main game class — state management, game loop, piece spawning, gravity.
 */
import { Board } from './board.js';
import { Piece, BagRandomizer } from './piece.js';
import { InputHandler } from './input.js';
import { Renderer } from './renderer.js';
import { Scoring } from './scoring.js';
import { SoundEngine } from './sound.js';
import { AutoPlayer } from './autoplay.js';
import { DemoCycler } from './demo-cycler.js';

const LOCK_DELAY = 500; // ms
const IS_MOBILE = window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;
const SPEED_STOPS = [1, 2, 4, 8];
const SPEED_LABELS = ['0.25×', '0.5×', '1×', '2×'];
const DROP_SPEED_STOPS = [0.5, 1, 2, 4, 6, 8, 10];
const DROP_SPEED_LABELS = ['0.5×', '1×', '2×', '4×', '6×', '8×', '10×'];

class Game {
  #board;
  #renderer;
  #input;
  #scoring;
  #sound;
  #bag;
  #autoPlayer;
  #demoCycler;
  #autoMoveTimer = 0;

  #btnStart;
  #btnPause;
  #btnStop;
  #btnDemo;
  #btnMute;

  #currentPiece = null;
  #holdType = null;
  #holdUsed = false;
  #nextQueue = [];

  #state = 'idle'; // idle | playing | paused | gameOver
  #lastDropTime = 0;
  #lockTimer = null;
  #lockStartTime = 0;
  #lockMoveCount = 0;
  #animFrameId = null;
  #lastAutoTime = 0;
  #lastTimestamp = 0;
  #lastActionWasRotation = false;
  #inputBuffer = null;
  #dangerPulseTimer = 0;
  #lastPiecePos = null; // for trail tracking
  #demoFrozen = false;   // true during demo setting changes
  #demoFreezeTime = 0;   // timestamp when freeze started (safety timeout)
  #playerSpeed = '1';    // the clear speed the player chose, restored when the demo stops

  constructor() {
    this.#board = new Board();
    this.#renderer = new Renderer();
    this.#input = new InputHandler();
    this.#scoring = new Scoring();
    this.#sound = new SoundEngine();
    this.#bag = new BagRandomizer();
    this.#autoPlayer = new AutoPlayer();
    this.#demoCycler = new DemoCycler({
      onThemeChange: (v) => this.#demoApplyTheme(v),
      onVolumeChange: (v) => this.#demoApplyVolume(v),
      onSpeedChange: (v) => this.#syncSpeed(v),
      onMute: () => this.#demoSetMuted(true),
      onUnmute: () => this.#demoSetMuted(false),
      onFreeze: () => this.#demoFreeze(),
      onUnfreeze: () => this.#demoUnfreeze(),
      onHighlight: (type) => this.#demoHighlightDesktop(type),
      onClearHighlight: () => this.#demoClearDesktopHighlight(),
    });

    this.#bindInput();
    this.#input.attach();
    this.#initUI();
    this.#initButtonBar();
    this.#initDesktopSettings();
    this.#initMobileDrawer();
    this.#initMobileSettings();
    this.#initDemoControls();
    this.#initAudioUnlock();
  }

  /** Tutorial overlay, orientation lock, and sound callbacks. */
  #initUI() {
    const tutorialOverlay = document.getElementById('tutorial-overlay');
    const tutorialBtn = document.getElementById('tutorial-start-btn');
    tutorialBtn?.addEventListener('click', () => {
      this.#sound.init();
      this.#handleStart();
    });
    if (!localStorage.getItem('tetris-tutorial-seen')) {
      tutorialOverlay?.classList.add('visible');
      this.#renderer.showOverlay('');
    } else {
      this.#renderer.showOverlay(IS_MOBILE ? 'TAP TO START' : 'PRESS ENTER TO START');
      if (IS_MOBILE) this.#showHamburgerHint();
    }

    if (IS_MOBILE) {
      const orientationHandler = () => {
        const isLandscape = window.matchMedia('(orientation: landscape)').matches;
        if (isLandscape && this.#state === 'playing') {
          this.#togglePause();
        }
      };
      window.matchMedia('(orientation: landscape)').addEventListener('change', orientationHandler);
    }

    this.#renderer.setSoundCallbacks({
      onRowHighlight: (rowIndex) => this.#sound.playRowHighlight(rowIndex),
      onCellPop: (col, totalCols) => this.#sound.playCellPop(col, totalCols),
      onRowCleared: (rowIndex) => this.#sound.playRowCleared(rowIndex),
      onPeelStart: (rows, sweep, delay) => this.#sound.playClearStart(rows, sweep, delay),
    });
  }

  /** Desktop button bar: start, pause, stop, demo, mute. */
  #initButtonBar() {
    this.#btnStart = document.getElementById('btn-start');
    this.#btnPause = document.getElementById('btn-pause');
    this.#btnStop = document.getElementById('btn-stop');
    this.#btnDemo = document.getElementById('btn-demo');
    this.#btnMute = document.getElementById('btn-mute');

    this.#btnStart?.addEventListener('click', () => {
      this.#sound.init();
      this.#handleStart();
    });
    this.#btnPause?.addEventListener('click', () => {
      this.#sound.init();
      this.#togglePause();
    });
    this.#btnStop?.addEventListener('click', () => {
      this.#sound.init();
      this.#stopGame();
    });
    this.#btnDemo?.addEventListener('click', () => {
      this.#sound.init();
      this.#toggleDemo();
    });
    this.#btnMute?.addEventListener('click', () => {
      this.#sound.init();
      this.#sound.toggleMute();
      this.#updateMuteButton();
    });
  }

  /** Desktop sound theme, volume, and speed sliders. */
  #initDesktopSettings() {
    const themeSelect = document.getElementById('sound-theme');
    themeSelect?.addEventListener('change', (e) => {
      this.#sound.init();
      this.#sound.setSoundTheme(e.target.value);
      this.#renderer.setVisualTheme(e.target.value);
      this.#sound.playLineClear(2);
    });

    const volumeSlider = document.getElementById('volume-slider');
    volumeSlider?.addEventListener('input', (e) => {
      this.#sound.init();
      this.#sound.setVolume(Number(e.target.value) / 100);
    });

    const speedSlider = document.getElementById('speed-slider');
    speedSlider?.addEventListener('input', (e) => {
      this.#setPlayerSpeed(e.target.value);
    });

    const dropSpeedSlider = document.getElementById('drop-speed-slider');
    dropSpeedSlider?.addEventListener('input', (e) => {
      this.#syncDropSpeed(e.target.value);
    });
  }

  /** Bind a mobile drawer button: init sound, run action, close drawer. */
  #mobileBtn(id, action, drawer) {
    document.getElementById(id)?.addEventListener('click', (e) => {
      e.preventDefault();
      this.#sound.init();
      action();
      drawer?.classList.add('drawer-hidden');
    });
  }

  /** Mobile hamburger menu, game buttons, and help. */
  #initMobileDrawer() {
    const mobileDrawer = document.getElementById('mobile-drawer');
    const hamburgerHint = document.getElementById('hamburger-hint');
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    mobileMenuToggle?.addEventListener('click', (e) => {
      e.preventDefault();
      this.#sound.init();
      mobileMenuToggle.classList.remove('hamburger-highlight');
      hamburgerHint?.classList.remove('visible');
      mobileDrawer?.classList.toggle('drawer-hidden');
      if (this.#state === 'playing') this.#togglePause();
    });

    this.#mobileBtn('mobile-btn-start', () => this.#handleStart(), mobileDrawer);
    this.#mobileBtn('mobile-btn-stop', () => this.#stopGame(), mobileDrawer);
    this.#mobileBtn('mobile-btn-demo', () => this.#toggleDemo(), mobileDrawer);
    this.#mobileBtn('mobile-btn-pause', () => this.#togglePause(), mobileDrawer);

    document.getElementById('mobile-btn-mute')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.#sound.init();
      this.#sound.toggleMute();
      this.#updateMuteButton();
      e.currentTarget.textContent = this.#sound.muted ? '🔇 MUTED' : '🔊 SOUND';
    });
    document.getElementById('mobile-btn-help')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('tutorial-overlay')?.classList.add('visible');
      mobileDrawer?.classList.add('drawer-hidden');
    });
  }

  /** Mobile theme, volume, and speed sliders. */
  #initMobileSettings() {
    const mobileTheme = document.getElementById('mobile-sound-theme');
    mobileTheme?.addEventListener('change', (e) => {
      this.#sound.init();
      this.#sound.setSoundTheme(e.target.value);
      this.#renderer.setVisualTheme(e.target.value);
      this.#sound.playLineClear(2);
      const desktopSelect = document.getElementById('sound-theme');
      if (desktopSelect) desktopSelect.value = e.target.value;
    });

    const mobileVolume = document.getElementById('mobile-volume');
    mobileVolume?.addEventListener('input', (e) => {
      this.#sound.init();
      this.#sound.setVolume(Number(e.target.value) / 100);
      const desktopSlider = document.getElementById('volume-slider');
      if (desktopSlider) desktopSlider.value = e.target.value;
    });

    const mobileSpeed = document.getElementById('mobile-speed');
    mobileSpeed?.addEventListener('input', (e) => {
      this.#setPlayerSpeed(e.target.value);
    });

    const mobileDropSpeed = document.getElementById('mobile-drop-speed');
    mobileDropSpeed?.addEventListener('input', (e) => {
      this.#syncDropSpeed(e.target.value);
    });
  }

  /** Sync drop-speed controls across desktop, mobile, and demo panels. */
  #syncDropSpeed(value) {
    const idx = Number(value);
    const mult = DROP_SPEED_STOPS[idx];
    this.#scoring.setDropSpeedMultiplier(mult);
    const label = DROP_SPEED_LABELS[idx];
    for (const [sId, lId] of [['drop-speed-slider', 'drop-speed-label'], ['mobile-drop-speed', 'mobile-drop-speed-label'], ['demo-drop-speed', 'demo-drop-speed-label']]) {
      const s = document.getElementById(sId);
      const l = document.getElementById(lId);
      if (s) s.value = value;
      if (l) l.textContent = label;
    }
  }

  /** Sync speed controls across desktop, mobile, and demo panels. */
  #setPlayerSpeed(value) {
    this.#playerSpeed = value;
    this.#syncSpeed(value);
  }

  #syncSpeed(value) {
    const idx = Number(value);
    const mult = SPEED_STOPS[idx];
    this.#renderer.setAnimSpeed(mult);
    this.#sound.setAnimSpeed(mult);
    const label = SPEED_LABELS[idx];
    for (const [sId, lId] of [['speed-slider', 'speed-label'], ['mobile-speed', 'mobile-speed-label'], ['demo-speed', 'demo-speed-label']]) {
      const s = document.getElementById(sId);
      const l = document.getElementById(lId);
      if (s) s.value = value;
      if (l) l.textContent = label;
    }
  }

  /** Demo mode floating controls: volume, speed, theme, mute, stop. */
  #initDemoControls() {
    const demoMuteBtn = document.getElementById('demo-mute-btn');

    document.getElementById('demo-volume')?.addEventListener('input', (e) => {
      this.#sound.init();
      const val = Number(e.target.value);
      this.#sound.setVolume(val / 100);
      const ds = document.getElementById('volume-slider');
      const ms = document.getElementById('mobile-volume');
      if (ds) ds.value = val;
      if (ms) ms.value = val;
    });

    document.getElementById('demo-speed')?.addEventListener('input', (e) => {
      this.#setPlayerSpeed(e.target.value);
    });

    document.getElementById('demo-drop-speed')?.addEventListener('input', (e) => {
      this.#syncDropSpeed(e.target.value);
    });

    document.getElementById('demo-theme')?.addEventListener('change', (e) => {
      this.#sound.init();
      this.#sound.setSoundTheme(e.target.value);
      this.#renderer.setVisualTheme(e.target.value);
      this.#sound.playLineClear(2);
      const ds = document.getElementById('sound-theme');
      const ms = document.getElementById('mobile-sound-theme');
      if (ds) ds.value = e.target.value;
      if (ms) ms.value = e.target.value;
    });

    demoMuteBtn?.addEventListener('click', () => {
      this.#sound.init();
      this.#sound.toggleMute();
      this.#updateMuteButton();
      demoMuteBtn.textContent = this.#sound.muted ? '🔇 MUTED' : '🔊 SOUND';
    });

    document.getElementById('demo-stop-btn')?.addEventListener('click', () => {
      this.#toggleDemo();
    });
  }

  /** Unlock audio context on first user interaction (iOS requirement). */
  #initAudioUnlock() {
    const unlockAudio = () => {
      this.#sound.init();
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('touchend', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('touchstart', unlockAudio);
    document.addEventListener('touchend', unlockAudio);
    document.addEventListener('click', unlockAudio);
  }

  #bindInput() {
    this.#input.on('start', () => this.#handleStart());
    this.#input.on('left', () => this.#bufferedAction('left'));
    this.#input.on('right', () => this.#bufferedAction('right'));
    this.#input.on('softDrop', () => this.#bufferedAction('softDrop'));
    this.#input.on('hardDrop', () => this.#bufferedAction('hardDrop'));
    this.#input.on('rotateCW', () => this.#bufferedAction('rotateCW'));
    this.#input.on('rotateCCW', () => this.#bufferedAction('rotateCCW'));
    this.#input.on('hold', () => this.#bufferedAction('hold'));
    this.#input.on('pause', () => this.#togglePause());
    this.#input.on('mute', () => {
      this.#sound.toggleMute();
      this.#updateMuteButton();
    });
    this.#input.on('demo', () => this.#toggleDemo());
  }

  /** Buffer actions during animations, execute immediately otherwise. */
  #bufferedAction(action) {
    if (this.#autoPlayer.active) return;
    if (this.#renderer.isAnimating) {
      this.#inputBuffer = action;
      return;
    }
    this.#executeAction(action);
  }

  #flushInputBuffer() {
    if (this.#inputBuffer) {
      const action = this.#inputBuffer;
      this.#inputBuffer = null;
      this.#executeAction(action);
    }
  }

  #showHamburgerHint() {
    const hint = document.getElementById('hamburger-hint');
    const toggle = document.getElementById('mobile-menu-toggle');
    if (!hint || !toggle) return;
    toggle.classList.add('hamburger-highlight');
    hint.classList.add('visible');
  }

  #handleStart() {
    if (this.#autoPlayer.active) return;
    const tutOverlay = document.getElementById('tutorial-overlay');
    const wasTutorial = tutOverlay?.classList.contains('visible');
    tutOverlay?.classList.remove('visible');
    document.getElementById('mobile-menu-toggle')?.classList.remove('hamburger-highlight');
    document.getElementById('hamburger-hint')?.classList.remove('visible');
    if (wasTutorial) {
      localStorage.setItem('tetris-tutorial-seen', '1');
      this.#sound.init();
      this.#sound.warmUp();
      if (IS_MOBILE) {
        this.#showHamburgerHint();
      } else {
        this.#showDesktopSettingsHint();
      }
    }
    if (this.#state === 'idle' || this.#state === 'gameOver') {
      this.#startGame();
    } else if (this.#state === 'paused') {
      this.#togglePause();
      document.getElementById('mobile-drawer')?.classList.add('drawer-hidden');
    }
  }

  #startGame() {
    // Eagerly init + resume audio context — avoids mobile delay
    this.#sound.init();
    this.#sound.warmUp();
    this.#demoFrozen = false;
    this.#wasAnimating = false;
    this.#renderer.resetAnimations();
    this.#board.reset();
    this.#scoring.reset();
    this.#holdType = null;
    this.#holdUsed = false;
    this.#bag = new BagRandomizer();
    this.#nextQueue = [];

    // Fill next queue
    for (let i = 0; i < 3; i++) {
      this.#nextQueue.push(this.#bag.next());
    }

    this.#state = 'playing';
    this.#lastActionWasRotation = false;
    this.#renderer.hideOverlay();
    this.#spawnPiece();
    this.#lastDropTime = performance.now();
    this.#lastTimestamp = performance.now();
    this.#updateButtons();
    this.#gameLoop(performance.now());
  }

  #spawnPiece() {
    const type = this.#nextQueue.shift();
    this.#nextQueue.push(this.#bag.next());
    this.#currentPiece = new Piece(type);
    this.#lockTimer = null;
    this.#lockMoveCount = 0;
    this.#holdUsed = false;
    this.#lastActionWasRotation = false;
    this.#sound.playSpawn();

    // Check if spawn position is blocked
    if (this.#board.collides(this.#currentPiece.shape, this.#currentPiece.x, this.#currentPiece.y)) {
      this.#gameOver();
    }
  }

  #wasAnimating = false;
  #lastClearRows = 1;

  #handleAnimationPause(timestamp) {
    if (this.#renderer.isAnimating) {
      this.#wasAnimating = true;
      this.#render();
      this.#animFrameId = requestAnimationFrame((t) => this.#gameLoop(t));
      return true;
    }
    if (this.#wasAnimating) {
      this.#wasAnimating = false;
      this.#sound.playStackLand(this.#lastClearRows);
      this.#renderer.triggerStackLand(this.#lastClearRows);
      this.#lastDropTime = timestamp;
      this.#lastAutoTime = timestamp;
      if (this.#lockTimer !== null) {
        this.#lockStartTime = timestamp;
      }

      // Blocks that settled into a gap may have completed more rows.
      const chain = this.#board.clearLines();
      if (chain.linesCleared > 0) {
        this.#registerClear(chain, 'none');
        this.#wasAnimating = true;
        this.#render();
        this.#animFrameId = requestAnimationFrame((t) => this.#gameLoop(t));
        return true;
      }

      // The next piece enters once the stack has finished sliding.
      if (!this.#currentPiece) this.#spawnPiece();
      this.#flushInputBuffer();
    }
    return false;
  }

  #gameLoop(timestamp) {
    if (this.#state !== 'playing') return;

    // Keep rendering but skip all game logic when demo-frozen
    if (this.#demoFrozen) {
      // Safety: force unfreeze after 5s to prevent permanent freeze
      if (performance.now() - this.#demoFreezeTime > 5000) {
        this.#demoFrozen = false;
      } else {
        this.#lastTimestamp = timestamp;
        this.#render();
        this.#animFrameId = requestAnimationFrame((t) => this.#gameLoop(t));
        return;
      }
    }

    // DAS auto-repeat
    const deltaMs = timestamp - (this.#lastTimestamp || timestamp);
    this.#lastTimestamp = timestamp;
    this.#input.updateDAS(deltaMs);

    // During line clear animation — keep rendering but pause game logic
    if (this.#handleAnimationPause(timestamp)) return;

    // AI auto-play moves — fast pace, animations provide the drama
    if (this.#autoPlayer.active && this.#currentPiece) {
      this.#autoMoveTimer += (timestamp - (this.#lastAutoTime || timestamp));
      this.#lastAutoTime = timestamp;
      if (this.#autoMoveTimer >= 80) {
        this.#autoMoveTimer = 0;
        const action = this.#autoPlayer.getNextMove(
          this.#board, this.#currentPiece, this.#holdType, this.#nextQueue
        );
        if (action) this.#executeAction(action);
      }
    }

    // Gravity
    const dropInterval = this.#scoring.getDropInterval();
    if (timestamp - this.#lastDropTime >= dropInterval) {
      this.#applyGravity();
      this.#lastDropTime = timestamp;
    }

    // Lock delay
    if (this.#lockTimer !== null) {
      if (timestamp - this.#lockStartTime >= LOCK_DELAY) {
        this.#lockPiece();
      }
    }

    // Danger zone heartbeat sound
    this.#updateDangerPulse(deltaMs);

    this.#render();
    this.#animFrameId = requestAnimationFrame((t) => this.#gameLoop(t));
  }

  #applyGravity() {
    if (!this.#currentPiece) return;
    if (this.#board.collides(this.#currentPiece.shape, this.#currentPiece.x, this.#currentPiece.y + 1)) {
      // Piece is resting — start lock delay if not already started
      if (this.#lockTimer === null) {
        this.#lockTimer = true;
        this.#lockStartTime = performance.now();
      }
    } else {
      this.#currentPiece.y++;
    }
  }

  #move(dx, dy) {
    if (this.#state !== 'playing' || !this.#currentPiece) return;
    if (!this.#board.collides(this.#currentPiece.shape, this.#currentPiece.x + dx, this.#currentPiece.y + dy)) {
      this.#currentPiece.x += dx;
      this.#currentPiece.y += dy;
      this.#lastActionWasRotation = false;
      if (dx !== 0) this.#sound.playMove();
      // Reset lock delay if piece is on ground and player moves it (max 15 resets)
      if (this.#lockTimer !== null && this.#lockMoveCount < 15) {
        this.#lockMoveCount++;
        if (this.#board.collides(this.#currentPiece.shape, this.#currentPiece.x, this.#currentPiece.y + 1)) {
          this.#lockStartTime = performance.now();
        } else {
          this.#lockTimer = null;
        }
      }
    }
  }

  #softDrop() {
    if (this.#state !== 'playing' || !this.#currentPiece) return;
    if (!this.#board.collides(this.#currentPiece.shape, this.#currentPiece.x, this.#currentPiece.y + 1)) {
      this.#currentPiece.y++;
      this.#scoring.addSoftDrop(1);
      this.#lastDropTime = performance.now();
    }
  }

  #hardDrop() {
    if (this.#state !== 'playing' || !this.#currentPiece) return;
    const startY = this.#currentPiece.y;
    const dropY = this.#board.getDropPosition(this.#currentPiece);
    this.#currentPiece.y = dropY;
    const dropDistance = dropY - startY;
    this.#scoring.addHardDrop(dropDistance);
    this.#sound.playHardDrop();
    this.#renderer.triggerHardDropEffect(this.#currentPiece, dropDistance);
    this.#lockPiece();
  }

  #rotate(direction) {
    if (this.#state !== 'playing' || !this.#currentPiece) return;

    const fromRotation = this.#currentPiece.rotation;
    const toRotation = (fromRotation + direction + 4) % 4;
    const newShape = this.#currentPiece.getShape(toRotation);
    const kicks = this.#currentPiece.getWallKicks(fromRotation, toRotation);

    for (const [dx, dy] of kicks) {
      if (!this.#board.collides(newShape, this.#currentPiece.x + dx, this.#currentPiece.y - dy)) {
        this.#currentPiece.x += dx;
        this.#currentPiece.y -= dy;
        this.#currentPiece.rotation = toRotation;
        this.#lastActionWasRotation = true;
        this.#sound.playRotate();

        // Reset lock delay on successful rotation (max 15 resets)
        if (this.#lockTimer !== null && this.#lockMoveCount < 15) {
          this.#lockMoveCount++;
          if (this.#board.collides(this.#currentPiece.shape, this.#currentPiece.x, this.#currentPiece.y + 1)) {
            this.#lockStartTime = performance.now();
          } else {
            this.#lockTimer = null;
          }
        }
        return;
      }
    }
  }

  #hold() {
    if (this.#state !== 'playing' || !this.#currentPiece || this.#holdUsed) return;

    this.#sound.playHold();
    const currentType = this.#currentPiece.type;
    if (this.#holdType === null) {
      this.#holdType = currentType;
      this.#spawnPiece();
    } else {
      const swapType = this.#holdType;
      this.#holdType = currentType;
      this.#currentPiece = new Piece(swapType);
      this.#lockTimer = null;

      if (this.#board.collides(this.#currentPiece.shape, this.#currentPiece.x, this.#currentPiece.y)) {
        this.#gameOver();
      }
    }
    this.#holdUsed = true;
  }

  #lockPiece() {
    if (!this.#currentPiece) return;

    // Detect T-spin before locking
    const tSpinType = this.#board.detectTSpin(this.#currentPiece, this.#lastActionWasRotation);

    this.#board.lock(this.#currentPiece);
    this.#sound.playLock();
    this.#renderer.triggerLockPulse(this.#currentPiece);
    this.#renderer.triggerLockBounce(this.#currentPiece);
    this.#lockTimer = null;

    const clear = this.#board.clearLines();
    const { linesCleared } = clear;
    if (linesCleared > 0) {
      this.#registerClear(clear, tSpinType);
    } else {
      this.#scoring.resetCombo();
      this.#sound.resetCombo();
    }

    if (this.#board.isTopBlocked()) {
      this.#gameOver();
      return;
    }

    // No piece on the board during a line clear; #handleAnimationPause spawns the next one.
    if (linesCleared > 0) {
      this.#currentPiece = null;
      return;
    }

    this.#spawnPiece();
  }

  /** Score a line clear and start its animation. */
  #registerClear(clear, tSpinType) {
    const result = this.#scoring.addLineClear(clear.linesCleared, tSpinType);
    this.#lastClearRows = clear.linesCleared;
    this.#renderer.triggerLineClearEffect(clear.clearedRows, clear.clearedRowColors);
    this.#renderer.triggerFallingCells(clear.fallingCells);
    this.#showClearFeedback(tSpinType, clear.linesCleared, result, clear.clearedRows);
    if (result.leveledUp) {
      this.#sound.playLevelUp();
      this.#renderer.triggerLevelUpEffect(this.#scoring.level);
    }
  }

  #updateDangerPulse(deltaMs) {
    const highBlock = this.#board.getHighestBlock();
    if (highBlock > 10) { this.#dangerPulseTimer = 0; return; }
    const intensity = 10 - highBlock; // 1–10
    // Pulse more frequently as danger increases
    const interval = Math.max(300, 800 - intensity * 50);
    this.#dangerPulseTimer += deltaMs;
    if (this.#dangerPulseTimer >= interval) {
      this.#dangerPulseTimer = 0;
      this.#sound.playDangerPulse(intensity);
    }
  }

  #showClearFeedback(tSpinType, linesCleared, result, clearedRows) {
    if (tSpinType !== 'none') {
      const label = tSpinType === 'mini' ? 'MINI T-SPIN' : 'T-SPIN';
      const lineLabels = ['', ' SINGLE', ' DOUBLE', ' TRIPLE'];
      this.#renderer.triggerComboText(label + (lineLabels[linesCleared] || ''), clearedRows[0]);
      this.#sound.playTSpin(tSpinType);
    }
    if (result.combo > 1) {
      this.#renderer.triggerComboText(`${result.combo} COMBO`, clearedRows[0] - 1);
      this.#sound.playComboHit(result.combo);
    }
    if (result.isBackToBack) {
      this.#renderer.triggerComboText('BACK-TO-BACK', clearedRows[0] - 2);
      this.#sound.playBackToBack();
    }
    if (this.#board.isPerfectClear()) {
      this.#scoring.addPerfectClear();
      this.#renderer.triggerComboText('PERFECT CLEAR!', 10);
      this.#sound.playPerfectClear();
    }
  }

  #togglePause() {
    if (this.#autoPlayer.active) return;
    if (this.#state === 'playing') {
      this.#state = 'paused';
      this.#sound.playPause();
      if (this.#animFrameId) {
        cancelAnimationFrame(this.#animFrameId);
        this.#animFrameId = null;
      }
      this.#renderer.showOverlay(IS_MOBILE ? 'PAUSED\nTAP TO RESUME' : 'PAUSED\nPRESS P TO RESUME');
      this.#updateButtons();
    } else if (this.#state === 'paused') {
      this.#state = 'playing';
      this.#sound.playUnpause();
      this.#renderer.hideOverlay();
      this.#lastDropTime = performance.now();
      if (this.#lockTimer !== null) {
        this.#lockStartTime = performance.now();
      }
      this.#updateButtons();
      this.#gameLoop(performance.now());
    }
  }

  #gameOver() {
    this.#state = 'gameOver';
    this.#currentPiece = null;
    this.#demoFrozen = false;
    this.#wasAnimating = false;
    this.#renderer.resetAnimations();
    this.#sound.playGameOver();

    // Trigger visual collapse animation
    this.#renderer.triggerGameOverCollapse(this.#board.getVisibleGrid());
    // Clear the board so static cells don't show beneath the collapse
    this.#board.reset();

    if (this.#animFrameId) {
      cancelAnimationFrame(this.#animFrameId);
      this.#animFrameId = null;
    }

    // Continue rendering for collapse animation, show overlay when done
    this.#runCollapseAnimation();
    this.#updateButtons();
  }

  /** Keep rendering during game over collapse animation, then show overlay. */
  #runCollapseAnimation() {
    let frames = 0;
    const animate = () => {
      this.#render();
      frames++;
      if (this.#renderer.isCollapsing && frames < 240) {
        requestAnimationFrame(animate);
      } else {
        // Collapse finished — now show the overlay
        this.#showGameOverOverlay();
      }
    };
    requestAnimationFrame(animate);
  }

  #showGameOverOverlay() {
    if (this.#autoPlayer.active) {
      setTimeout(() => {
        if (this.#autoPlayer.active) this.#startGame();
      }, 2000);
      this.#renderer.showOverlay('DEMO MODE\nGAME OVER\nRESTARTING...');
    } else {
      const hs = this.#scoring.highScore;
      this.#renderer.showOverlay(`GAME OVER\nSCORE: ${this.#scoring.score}\nBEST: ${hs}\n${IS_MOBILE ? 'TAP TO RESTART' : 'PRESS ENTER TO RESTART'}`);
    }
  }

  #executeAction(action) {
    switch (action) {
      case 'left': this.#move(-1, 0); break;
      case 'right': this.#move(1, 0); break;
      case 'rotateCW': this.#rotate(1); break;
      case 'rotateCCW': this.#rotate(-1); break;
      case 'hardDrop': this.#hardDrop(); break;
      case 'softDrop': this.#softDrop(); break;
      case 'hold': this.#hold(); break;
    }
  }

  #toggleDemo() {
    const demoControls = document.getElementById('demo-controls');
    if (this.#autoPlayer.active) {
      // Stop demo
      this.#autoPlayer.stop();
      this.#demoCycler.stop();
      this.#syncSpeed(this.#playerSpeed);
      this.#demoFrozen = false;
      this.#state = 'gameOver';
      this.#currentPiece = null;
      this.#wasAnimating = false;
      this.#renderer.resetAnimations();
      if (this.#animFrameId) {
        cancelAnimationFrame(this.#animFrameId);
        this.#animFrameId = null;
      }
      this.#render();
      this.#renderer.showOverlay(IS_MOBILE ? 'TAP TO START' : 'PRESS ENTER TO START');
      this.#btnDemo?.classList.remove('active');
      demoControls?.classList.add('demo-controls-hidden');
      this.#updateButtons();
    } else {
      // Start demo
      this.#autoPlayer.start();
      this.#btnDemo?.classList.add('active');
      demoControls?.classList.remove('demo-controls-hidden');
      // Sync demo controls with current values
      const dv = document.getElementById('demo-volume');
      const ds = document.getElementById('demo-speed');
      const dt = document.getElementById('demo-theme');
      const dl = document.getElementById('demo-speed-label');
      if (dv) dv.value = document.getElementById('volume-slider')?.value || 70;
      if (ds) ds.value = document.getElementById('speed-slider')?.value || '1';
      if (dt) dt.value = document.getElementById('sound-theme')?.value || 'glass';
      if (dl) dl.textContent = SPEED_LABELS[Number(ds?.value || 2)];
      if (this.#state !== 'playing') {
        this.#startGame();
      }
      // Start settings cycler after game is running
      this.#demoCycler.start();
      this.#updateButtons();
    }
  }

  #stopGame() {
    if (this.#state === 'idle') return;
    if (this.#autoPlayer.active) {
      this.#autoPlayer.stop();
      this.#demoCycler.stop();
      this.#syncSpeed(this.#playerSpeed);
      this.#demoFrozen = false;
      this.#btnDemo?.classList.remove('active');
    }
    document.getElementById('demo-controls')?.classList.add('demo-controls-hidden');
    this.#state = 'idle';
    this.#currentPiece = null;
    if (this.#animFrameId) {
      cancelAnimationFrame(this.#animFrameId);
      this.#animFrameId = null;
    }
    this.#wasAnimating = false;
    this.#renderer.resetAnimations();
    this.#board.reset();
    this.#scoring.reset();
    this.#holdType = null;
    this.#render();
    this.#renderer.showOverlay(IS_MOBILE ? 'TAP TO START' : 'PRESS ENTER TO START');
    this.#updateButtons();
  }

  #updateButtons() {
    const playing = this.#state === 'playing';
    const paused = this.#state === 'paused';
    const active = playing || paused;

    if (this.#btnStart) {
      this.#btnStart.textContent = (this.#state === 'gameOver') ? '▶ RESTART' : '▶ START';
      this.#btnStart.disabled = playing;
    }
    if (this.#btnPause) {
      this.#btnPause.textContent = paused ? '▶ RESUME' : '⏸ PAUSE';
      this.#btnPause.disabled = !active;
    }
    if (this.#btnStop) {
      this.#btnStop.disabled = !active && this.#state !== 'gameOver';
    }
  }

  #updateMuteButton() {
    const muted = this.#sound.muted;
    const text = muted ? '🔇 MUTED' : '🔊 SOUND';
    if (this.#btnMute) {
      this.#btnMute.textContent = text;
      this.#btnMute.classList.toggle('active', muted);
    }
    const mobileMute = document.getElementById('mobile-btn-mute');
    if (mobileMute) mobileMute.textContent = text;
    const demoMute = document.getElementById('demo-mute-btn');
    if (demoMute) demoMute.textContent = text;
  }

  /** Freeze blocks during demo setting changes — keeps rendering. */
  #demoFreeze() {
    if (this.#state !== 'playing') return false;
    this.#demoFrozen = true;
    this.#demoFreezeTime = performance.now();
    this.#lastDropTime = performance.now();
    this.#lastAutoTime = performance.now();
    return true;
  }

  /** Unfreeze blocks — reset timing so no jump in gravity. */
  #demoUnfreeze() {
    this.#demoFrozen = false;
    const now = performance.now();
    this.#lastDropTime = now;
    this.#lastAutoTime = now;
    this.#lastTimestamp = now;
  }

  /** Apply theme change from demo cycler across all UI panels. */
  #demoApplyTheme(value) {
    this.#sound.setSoundTheme(value);
    this.#renderer.setVisualTheme(value);
    this.#sound.playLineClear(2);
    for (const id of ['sound-theme', 'mobile-sound-theme', 'demo-theme']) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }
  }

  /** Apply volume change from demo cycler across all UI panels. */
  #demoApplyVolume(value) {
    this.#sound.setVolume(value / 100);
    for (const id of ['volume-slider', 'mobile-volume', 'demo-volume']) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }
  }

  /** Set muted state from demo cycler (only toggles if state differs). */
  #demoSetMuted(muted) {
    if (this.#sound.muted !== muted) {
      this.#sound.toggleMute();
      this.#updateMuteButton();
    }
  }

  /** Map setting type → desktop sidebar section ID. */
  #demoHighlightDesktop(type) {
    const map = {
      theme: 'theme-section',
      volume: 'volume-section',
      speed: 'speed-section',
      mute: 'button-section',
      unmute: 'button-section',
    };
    const id = map[type];
    if (id) {
      document.getElementById(id)?.classList.add('demo-section-highlight');
    }
  }

  #demoClearDesktopHighlight() {
    for (const el of document.querySelectorAll('.demo-section-highlight')) {
      el.classList.remove('demo-section-highlight');
    }
  }

  /** Highlight desktop settings panel briefly after tutorial dismissal. */
  #showDesktopSettingsHint() {
    const sections = ['theme-section', 'volume-section', 'speed-section'];
    for (const id of sections) {
      document.getElementById(id)?.classList.add('settings-highlight');
    }
    setTimeout(() => {
      for (const id of sections) {
        document.getElementById(id)?.classList.remove('settings-highlight');
      }
    }, 4500);
  }

  #render() {
    const ghostY = this.#currentPiece ? this.#board.getDropPosition(this.#currentPiece) : undefined;

    // Danger zone detection — start warning at row 10 (top ~42% of board)
    const highestBlock = this.#board.getHighestBlock();
    const dangerThreshold = 10;
    const dangerLevel = highestBlock <= dangerThreshold
      ? (dangerThreshold - highestBlock) / dangerThreshold : 0;
    this.#renderer.setDangerLevel(dangerLevel);

    // Piece trail — add frame when piece moves
    if (this.#currentPiece) {
      const posKey = `${this.#currentPiece.x},${this.#currentPiece.y}`;
      if (this.#lastPiecePos !== posKey) {
        this.#renderer.addTrailFrame(this.#currentPiece);
        this.#lastPiecePos = posKey;
      }
    }

    this.#renderer.drawFrame({
      visibleGrid: this.#board.getVisibleGrid(),
      currentPiece: this.#currentPiece,
      ghostY,
      holdType: this.#holdType,
      nextTypes: this.#nextQueue,
      score: this.#scoring.score,
      level: this.#scoring.level,
      lines: this.#scoring.lines,
      highScore: this.#scoring.highScore,
      combo: this.#scoring.combo,
      gameOver: this.#state === 'gameOver',
    });
  }
}

// Initialize game on DOM ready
const game = new Game();
