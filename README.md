# Nebula Strike

Nebula Strike is a browser-based 3D arcade space-combat game built with Three.js, WebGL2, and Vite. It is a single-player survival run set in one procedural arena: fly a third-person fighter, manage shields and afterburner energy, acquire missile locks, and clear increasingly difficult enemy waves. Every fifth wave includes a three-phase dreadnought boss.

The ships, arena, visual effects, and audio are generated at runtime. The project does not require a game server or downloaded model, texture, or sound assets.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0` (required by the installed Vite 7 release)
- npm
- A current desktop version of Chrome, Firefox, Edge, or Safari
- WebGL2 and hardware acceleration
- A keyboard and mouse

There are no touch controls or WebGL1 fallback. If WebGL2 creation fails, the game shows a compatibility screen instead of starting. Web Audio is optional: unsupported or blocked audio degrades silently and does not stop gameplay.

## Install and run

Install the exact dependency versions recorded in `package-lock.json`:

```bash
npm ci
```

Start the Vite development server:

```bash
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).

Create a production bundle:

```bash
npm run build
```

Vite writes the static build to `dist/`. Test that build locally with:

```bash
npm run preview
```

The preview server normally uses `http://localhost:4173`. The project uses Vite's default root entry (`index.html`) and does not require a custom Vite configuration. Its pinned packages are Three.js `0.180.0` and Vite `7.3.6`.

The available npm scripts are:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server with hot reload |
| `npm run build` | Create the optimized production build |
| `npm run preview` | Serve the production build locally |

There are currently no automated test or lint scripts.

## Controls

Click **Launch mission** to start and grant the browser a user gesture for pointer lock and audio. If pointer lock is denied or later released, keyboard steering still works; use the **Mouse aim** button to request it again.

| Input | Action |
| --- | --- |
| Mouse | Pitch and yaw while the pointer is locked |
| `W` | Forward thrust |
| `S` | Reverse thrust / brake against forward momentum |
| `A` / `D` | Yaw left / right; also choose combat-roll direction |
| Hold `Shift` + `W` | Engage the afterburner while charge remains |
| Hold `Space` | Fire alternating pulse cannons |
| `E` | Launch a seeker missile at a fully locked target |
| `Q` | Perform a cooldown-limited combat roll with brief damage avoidance |
| `Esc` | Pause or resume |

The always-available settings panel provides mute, master volume, graphics quality, and pointer-lock controls. Pausing releases pointer lock, and switching away from the browser tab pauses an active mission automatically.

## Features

- Inertial third-person flight with forward and reverse thrust, speed limits, banking, a rechargeable afterburner, an arena warning zone, and a hard containment boundary
- Regenerating shields over a separate hull-health pool; shield regeneration begins after avoiding damage for 3.2 seconds
- Rapid pulse cannons plus six accelerating, homing missiles with splash damage
- Automatic target selection inside the forward lock cone, with a 480-unit range and a 0.72-second lock acquisition
- Four procedural enemy classes: Razor Scout, Viper Fighter, Marauder Heavy, and Dreadnought Axiom
- Enemy chase, attack, and retreat states with predictive aim, evasive motion, obstacle avoidance, and separation steering
- Three boss phases that escalate from single shots to spread and radial firing patterns
- Endless wave escalation, capped non-boss wave size, four-second intermissions, and a boss encounter every fifth wave
- Procedural ships, engine glows, starfield, nebula sprites, celestial bodies, asteroid obstacles, instanced debris, and arena guide geometry
- Swept projectile and missile collision checks, asteroid impacts, missile area damage, pooled combat objects, particles, hit flashes, explosions, trails, and camera shake
- A full HUD with hull, shield, boost, ammunition, score, best score, wave, hostile and kill counts, mission timer, target-lock feedback, announcements, directional damage feedback, and boss health
- Menu, launch countdown, play, pause, game-over, and WebGL error states
- ACES tone mapping with additive sprite, emissive-material, and particle glow
- Runtime-synthesized engine, afterburner, weapon, impact, warning, explosion, and music audio

## Gameplay notes

A launch begins with a three-second countdown, then starts wave one. Standard waves mix scouts, fighters, and—beginning at wave three—heavy ships. Enemy health, damage, speed, and score value scale with the wave; regular waves stop growing at 18 ships. Boss waves replace the regular formation with one dreadnought and a small escort.

Keep enemies near the center of the crosshair to build a missile lock. A missile cannot launch until the lock is complete, ammunition is available, and its short weapon cooldown has elapsed. Missile explosions damage the selected target and can damage nearby enemies.

Shields absorb damage before the hull and recharge after the damage delay. The afterburner recharges whenever it is not engaged. Clearing a wave restores 28 afterburner charge; the start of every wave after the first restores 24 shield points and one missile, up to the normal maximums. Asteroids block shots and missiles and damage the player on collision.

The run ends when hull health reaches zero. Score comes from destroyed enemies and increases with wave difficulty. Restarting resets the mission, while the best score remains saved when browser storage is available.

## Quality, audio, and saved settings

Quality changes apply immediately. The renderer caps its pixel ratio, the environment changes its visible procedural-object counts, and particle density is scaled:

| Preset | Pixel-ratio cap | Stars | Nebulae | Asteroids | Debris | Particle scale |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Low | 1.0 | 900 | 2 | 12 | 38 | 55% |
| Medium | 1.4 | 1,900 | 4 | 20 | 85 | 80% |
| High | 1.8 | 3,400 | 6 | 30 | 150 | 100% |

Each preset also applies a total render-pixel budget, so the effective pixel ratio can be lower than the listed cap on very high-resolution displays. The game uses direct WebGL2 rendering instead of a half-float post-processing chain, which makes it more reliable on integrated and virtualized GPUs while retaining glow through additive effects. Graphics quality defaults to High.

Audio is built entirely with the Web Audio API. Its context is created lazily after a user interaction to comply with browser autoplay policies. Engine pitch follows ship speed, afterburner and low-hull states alter the active mix, and sound effects and music share a master volume. The default volume is 72%, and mute defaults to off.

The game uses these `localStorage` entries:

| Key | Saved value |
| --- | --- |
| `nebula-strike.high-score` | Best combat score |
| `nebula-strike.quality` | `low`, `medium`, or `high` |
| `nebula-strike.audio.volume` | Master volume from `0` to `1` |
| `nebula-strike.audio.muted` | Mute state |

Storage access is guarded. Private browsing restrictions or disabled storage cause the game to use defaults for that session rather than fail.

## Project structure

```text
.
├── index.html                    # Canvas, HUD, menus, settings, and error UI
├── package.json                  # Pinned runtime/dev dependencies and npm scripts
├── package-lock.json             # Reproducible npm dependency graph
├── public/
│   └── favicon.svg               # Site icon
└── src/
    ├── main.js                   # WebGL2 check and Game bootstrap
    ├── Game.js                   # State machine, system ownership, and frame orchestration
    ├── config.js                 # Gameplay values, enemy data, quality data, and state constants
    ├── AssetManager.js           # Procedural ships, projectile, missile, and shared GPU assets
    ├── AudioManager.js           # Procedural Web Audio graph, music, effects, and audio settings
    ├── CameraController.js       # Chase camera, boost FOV, and camera trauma
    ├── CollisionSystem.js        # Projectile, missile, player, and obstacle collision resolution
    ├── EffectsManager.js         # Pooled impacts, explosions, engine particles, and trails
    ├── Enemy.js                  # Shared enemy state machine, steering, firing, and boss phases
    ├── EnemyManager.js           # Enemy reuse, spawning, updates, targeting, and counts
    ├── Environment.js            # Procedural arena, lighting, obstacles, and quality visibility
    ├── InputManager.js           # Keyboard state, pointer lock, and per-frame mouse input
    ├── MissileManager.js         # Pooled homing-missile lifecycle
    ├── Player.js                 # Fighter movement, resources, cooldowns, damage, and hard bounds
    ├── ProjectileManager.js      # Pooled player/enemy laser lifecycle
    ├── UIManager.js              # DOM state transitions, HUD updates, and settings callbacks
    ├── WaveManager.js            # Wave composition, scaling, bosses, and intermissions
    ├── styles.css                # Responsive presentation, HUD, menus, and effects
    └── utils/
        ├── MathUtils.js          # Math, swept-sphere collision, formatting, and safe storage helpers
        └── ObjectPool.js         # Reusable object-pool implementation
```

## Architecture and frame order

`main.js` explicitly requests a WebGL2 context and creates one `Game`. `Game` owns the scene, direct renderer, state transitions, and all specialized managers. `AssetManager` and `Environment` generate the visual content; gameplay systems exchange narrow references and callbacks, while `UIManager` is the DOM boundary.

During active play, each clamped frame (`deltaTime` is capped at 0.05 seconds) runs in this order:

1. Advance mission time and update player movement/resources.
2. Select and progress the missile-lock target, then handle player weapons.
3. Update enemy AI and enemy firing.
4. Move laser projectiles and missiles.
5. Resolve projectile, missile, and ship-versus-asteroid collisions.
6. Advance wave/intermission state and spawn the player engine trail.
7. Update particles, the procedural environment, and the chase camera.
8. Update procedural audio and the rate-limited HUD, then check for game over.
9. Clear one-frame input and render directly through WebGL2.

Projectiles, missiles, and particles are preallocated through `ObjectPool` and expand only if their initial pools are exhausted. Enemy instances are reused by type after deactivation.

## Extension points

### Ships

- Build or change procedural meshes in `AssetManager.createPlayerShip()`, `createEnemyShip()`, and the enemy-specific `_createScout()`, `_createFighter()`, `_createHeavy()`, and `_createBoss()` builders.
- Keep the `userData` contract established by `_finalizeShip()`—especially collision radius, hull materials, engine materials, and engine glows—because player, enemy, and effect code consumes it.
- Tune player flight and survivability in `PLAYER_CONFIG`; change movement/resource behavior in `Player`.

### Weapons

- Add balance data to `WEAPON_CONFIG`.
- Add the weapon mesh factory to `AssetManager`, then put pooled movement/lifetime behavior beside `ProjectileManager` or `MissileManager`.
- Wire input and cooldown/ammunition behavior through `InputManager`, `Player`, and `Game.#handleWeapons()`.
- Resolve hits in `CollisionSystem`, and add matching HUD markup/state in `index.html` and `UIManager` when the weapon needs player-facing status.

### Enemies

- Add a keyed entry to `ENEMY_TYPES` and a matching palette/mesh path in `AssetManager.createEnemyShip()`.
- Select and spawn the new key in `WaveManager.#spawnNextWave()`.
- The existing `Enemy` class can drive stat-based variants. Add type-specific steering or firing branches in `Enemy` when a new class needs behavior beyond the shared chase/attack/retreat model.
- `EnemyManager` already reuses inactive instances by their `type` key.

### Waves

- Change boss cadence and intermission length with `GAME_CONFIG.bossEvery` and `GAME_CONFIG.waveDelay`.
- Edit composition, count caps, escorts, and difficulty multipliers in `WaveManager.#spawnNextWave()`.
- Use the existing `onWaveStart` and `onIntermission` callbacks for rewards, announcements, or other orchestration in `Game`.

### Levels

The current game has one deterministic arena and no campaign or level loader. `Environment` is the level boundary: its creation methods define sky, lighting, asteroids, debris, and containment.

To add levels, parameterize `Environment` with a level definition or introduce an environment factory, then have `Game` swap/reset it at a chosen wave boundary. Preserve the obstacle interface used by spawning and collision code—each active obstacle exposes `mesh`, `position`, and `radius`—and define per-level quality counts if layouts have different density requirements.

## Credits

Created by Pial Ghosh with implementation assistance from OpenAI Codex.
