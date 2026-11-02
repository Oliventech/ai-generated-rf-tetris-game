# Tetris Game

A fully-featured, browser-based Tetris game with dramatic sound effects, eye-catching animations, and mobile touch controls — built entirely with **AI pair programming** using GitHub Copilot in just a couple of hours.

## Play Now

[**Play the game live**](https://oliventech.github.io/ai-generated-rf-tetris-game/)

## What Is This?

A modern Tetris clone that runs directly in your browser with zero dependencies — pure HTML5, CSS3, and vanilla JavaScript. No frameworks, no build tools, no npm install. Just open and play.

### Features

- **Classic Tetris gameplay** — 10×20 grid, 7 standard tetrominoes (I, O, T, S, Z, J, L)
- **Super Rotation System (SRS)** with wall kicks for competitive-quality rotation
- **7-bag randomizer** for fair piece distribution
- **Ghost piece** showing where the piece will land
- **Hold piece** — swap the current piece once per drop
- **Next piece preview** — see the next 3 coming pieces
- **DAS/ARR** (Delayed Auto Shift / Auto Repeat Rate) for competitive movement speed
- **T-spin detection** with bonus scoring
- **Back-to-back bonus** for consecutive difficult clears
- **Combo system** with escalating rewards
- **Perfect clear detection** with bonus scoring
- **Progressive difficulty** — gravity increases every 10 lines
- **9 visual themes** — Glass, Concrete, Crystal, Metal, Ice, Wood, Plastic, Gold, Silver

### Sound Design

All sounds are generated procedurally using the **Web Audio API** — no audio files needed:

- **9 selectable sound themes**: Glass Shatter, Concrete Break, Crystal Chime, Metal Clang, Ice Crack, Wood Knock, Plastic Pop, Gold Ring, Silver Chime
- Row sounds synced to the line clear animation
- Dramatic line clear effects with shattering/breaking sounds
- Impact thuds on hard drop, crystalline clicks on rotation
- Escalating drama for Tetris (4-line) clears
- Combo hit, T-spin, back-to-back, and perfect clear audio cues
- Danger zone heartbeat pulse when the stack gets high
- Adjustable volume and clear speed controls

### Visual Effects

- **Peeling line clear**: full rows come loose, then blocks let go left to right and tumble off the board in an arc; multi-line clears peel together as one thick ribbon
- **Sliding stack**: the rows above slide down together, loose blocks at the top of a column drop into gaps up to 2 cells deep, and any row that completes clears too; longer cracks stay open
- **Per-theme cell rendering** — each of the 9 themes has a distinct visual style for both board cells and preview panels
- Screen shake on hard drops
- Piece trail motion blur
- Lock bounce with squash-and-stretch
- Lock pulse glow on placed pieces
- Floating combo text and score popups
- Danger zone pulsing when the stack gets high
- Game over collapse cascade with rotation and gravity
- Level-up celebration with golden particles
- Animated stars background with speed boost on clears
- Board edge glow and vignette

### Mobile Support

- Fully responsive layout that adapts to any screen size
- Touch gesture controls: swipe left/right to move, swipe down to hard drop, tap to rotate, two-finger tap to hold
- Slide-out hamburger menu with all settings
- Mobile-optimized hold/next panels and stats bar
- Orientation lock warning on landscape
- Tutorial overlay for first-time mobile users

### Demo Mode

Hit the **DEMO** button (or press `D`) to watch the AI autoplay — it evaluates all possible placements and picks the best move using a weighted heuristic covering height, holes, bumpiness, and line clears.

## Architecture & Design Practices

### SOLID Principles

This project follows SOLID principles adapted for a vanilla JavaScript ES module architecture:

- **Single Responsibility** — Each module has one clear purpose: `Board` manages the grid and collision, `Piece` defines shapes and rotation, `Renderer` handles canvas drawing, `SoundEngine` manages audio, `Scoring` tracks points and levels, `InputHandler` processes keyboard and touch, `EffectsEngine` runs visual animations, `AutoPlayer` drives AI demo mode.
- **Open/Closed** — New sound themes are added by creating a new theme module in `js/sounds/` and registering it in the `THEME_MAP` — no modification to the `SoundEngine` dispatcher. New visual themes follow the same pattern via dispatch tables in `cell-themes.js`.
- **Liskov Substitution** — All 9 sound theme modules expose the same interface (spawn, rotate, lock, hardDrop, lineClear, etc.). Any theme can be swapped at runtime without affecting the sound engine.
- **Interface Segregation** — The `EffectsEngine` exposes granular methods (`drawPeelingRows`, `drawPeelCubes`, `drawFallingCells`, etc.) so the `Renderer` only calls what it needs per frame.
- **Dependency Inversion** — High-level modules (`Game`) depend on abstractions. Sound callbacks are injected into the renderer via `setSoundCallbacks()`. The renderer doesn't know about the sound engine directly.

### Design Patterns Used

| Pattern | Where | Purpose |
|---------|-------|---------|
| **Strategy** | `js/sounds/*.js` | 9 interchangeable sound theme modules behind a common interface |
| **Dispatch Table** | `js/rendering/cell-themes.js` | Theme-keyed maps (`MINI_CELL_DRAWERS`, `PREVIEW_CELL_DRAWERS`) replace switch statements |
| **Observer** | `js/input.js` | Event callback registration via `on(action, callback)` |
| **Facade** | `js/sound.js` | Thin dispatcher that delegates to the active theme module |
| **Composition** | `js/renderer.js` → `js/rendering/effects.js` | Renderer composes an `EffectsEngine` for all animation state and drawing |
| **Module Pattern** | All files | ES modules with explicit `export` for encapsulation |

### Coding Standards

- **Files stay around 1,000 lines or less** — largest is `game.js` at 1,018 lines
- **No function exceeds 50 lines** — complex methods are split into focused helpers (e.g., `Game` constructor uses 7 `#init*()` methods, `drawFrame` delegates to 6 private helper methods)
- **ES2020+ features** — private class fields (`#field`), optional chaining (`?.`), nullish coalescing, `Object.freeze()`, arrow functions, template literals
- **`const`/`let` only** — no `var` anywhere
- **Class syntax** for all game entities (`Board`, `Piece`, `Renderer`, `SoundEngine`, `EffectsEngine`, `InputHandler`, `Scoring`, `AutoPlayer`, `Particle`)
- **`requestAnimationFrame`** for the game loop — no `setInterval`
- **Feature detection** for Web Audio API with graceful silent fallback
- **Zero dependencies** — no npm, no CDN, no build step
- **No transpilation needed** — runs natively in all modern browsers (ES2020+)

### Project Structure

```
index.html                        — Entry point, canvas, UI layout
css/
  style.css                       — Core styling, dark theme, layout
  responsive.css                  — Mobile breakpoints, orientation handling
js/
  game.js                         — Main game loop, state machine, init
  board.js                        — Grid, collision, line clearing, gravity
  piece.js                        — Tetromino shapes, SRS rotation, wall kicks
  input.js                        — Keyboard (DAS/ARR) + touch gesture handling
  sound.js                        — Sound engine facade (dispatches to themes)
  renderer.js                     — Canvas rendering, delegates to effects/themes
  scoring.js                      — Score, level, combo, T-spin, B2B tracking
  autoplay.js                     — AI demo player with heuristic evaluation
  demo-cycler.js                  — Cycles settings during demo mode
  rendering/
    effects.js                    — EffectsEngine: line clear peel, sliding stack,
                                    particles, screen shake, danger zone
    cell-themes.js                — Per-theme cell drawing (9 themes), dispatch tables
    particles.js                  — Particle class, star field, constants
  sounds/
    sound-context.js              — Shared AudioContext wrapper
    glass-theme.js                — Glass shatter sound theme
    concrete-theme.js             — Concrete break sound theme
    crystal-theme.js              — Crystal chime sound theme
    metal-theme.js                — Metal clang sound theme
    ice-theme.js                  — Ice crack sound theme
    wood-theme.js                 — Wood knock sound theme
    plastic-theme.js              — Plastic pop sound theme
    gold-theme.js                 — Gold ring sound theme
    silver-theme.js               — Silver chime sound theme
```

**Total: ~9,200 lines across 24 source files — all under 1,000 lines each.**

## How It Was Built

This entire game was built using **GitHub Copilot** with custom skills and instructions:

1. **Scaffolded** the project structure with a prompt file that defined the full game specification
2. **Generated** all game logic (board, pieces, SRS rotation, collision, scoring) through AI-assisted coding
3. **Designed** procedural sound effects using a dedicated sound design skill with Web Audio API recipes
4. **Created** dramatic animations using an eye-catching animations skill with particle systems and multi-phase effects
5. **Polished** the UI/UX with a visual enhancement skill covering colors, layout, and responsive design
6. **Added** mobile touch controls and responsive CSS for phone/tablet play
7. **Refactored** to enforce coding guidelines — max 1,000 lines/file, max 50 lines/function, SOLID principles throughout
8. **Extended** with 9 visual + sound themes using Strategy pattern and dispatch tables

## Reusable GitHub Copilot Skills

This repo includes a full set of **GitHub Copilot custom skills, instructions, and prompts** designed to be reusable for building any browser-based canvas game — not just Tetris. If you're building a falling-block game, match-3 puzzle, grid-based arcade game, or any HTML5 Canvas project, you can copy the `.github/` folder into your own repo and Copilot will use these skills automatically.

### Skills (`.github/skills/`)

| Skill | Description |
|-------|-------------|
| **eye-catching-animations** | Multi-phase clear animations, shockwaves, screen shake, dissolve effects, freeze frames, particle bursts, level-up celebrations, game-over collapse |
| **next-level-game** | Comprehensive enhancement guide: DAS/ARR controls, combo systems, back-to-back bonuses, settings panel, high scores, input buffering, touch controls, statistics |
| **sound-design** | Addictive audio design: layered sounds, harmonic tuning, reverb, pitch randomization, combo escalation, mixing/mastering, psychoacoustic tricks |
| **sound-effects** | Web Audio API fundamentals: oscillators, noise buffers, filters, envelopes, procedural impact/shatter/click/chime sounds, volume control |
| **canvas-game** | Core game development: grid systems, collision detection, element definitions, rotation/wall kicks, scoring templates, gravity progression, game loop patterns |
| **ui-ux-enhancement** | Visual polish: gradient cells, glow effects, dark themes, responsive layout, overlay transitions, HUD design, ghost/preview elements, background effects |

Each skill includes a `SKILL.md` with recipes and a `references/` folder with drop-in code snippets.

### Instructions (`.github/instructions/`)

| File | Applies To | Purpose |
|------|-----------|---------|
| `canvas.instructions.md` | `js/renderer.js` | Canvas rendering pipeline, grid layout, animation patterns, HUD guidelines |
| `javascript.instructions.md` | `**/*.js` | ES module conventions, class patterns, code quality standards |
| `sound.instructions.md` | `js/sound.js` | Web Audio API setup, audio node types, sound design patterns, mixing rules |

### Prompts (`.github/prompts/`)

| Prompt | Purpose |
|--------|---------|
| `scaffold-game.prompt.md` | Generate a complete game skeleton (board, elements, loop, input, renderer, scoring) |
| `add-sound-effects.prompt.md` | Add procedural Web Audio API sounds with theme support |
| `add-particles.prompt.md` | Add particle system for clear/shatter animations |
| `fix-or-enhance.prompt.md` | Debug or add features following project conventions |

### How to Use in Your Own Project

1. Copy the `.github/` folder into your canvas game repository
2. Copilot will automatically apply instructions based on `applyTo` patterns
3. Skills activate when your request matches their description keywords
4. Use `@workspace /scaffold-game` to generate a game skeleton from scratch
5. Adapt the `copilot-instructions.md` game design template to your specific game

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Rendering | HTML5 Canvas |
| Audio | Web Audio API (procedural) |
| Styling | CSS3 (no preprocessor) |
| Logic | Vanilla JavaScript (ES modules) |
| Hosting | GitHub Pages |
| Build step | None — open `index.html` and play |

## Controls

### Keyboard
| Key | Action |
|-----|--------|
| ← → | Move left/right |
| ↓ | Soft drop |
| Space | Hard drop |
| ↑ or X | Rotate clockwise |
| Z or Ctrl | Rotate counter-clockwise |
| C or Shift | Hold piece |
| Enter | Start game |
| P | Pause |
| M | Mute |
| D | Demo mode |

### Mobile
Swipe left/right to move, swipe down to hard drop, tap to rotate, two-finger tap to hold. The ☰ button opens pause, volume and settings.

## Run Locally

No build step required:

```bash
# Option 1: Python
python3 -m http.server 8080

# Option 2: Node
npx serve .

# Then open http://localhost:8080
```

## License

Personal project — built for fun with AI.
