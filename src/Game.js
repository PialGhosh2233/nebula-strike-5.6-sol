import * as THREE from 'three';
import { AssetManager } from './AssetManager.js';
import { Environment } from './Environment.js';
import { InputManager } from './InputManager.js';
import { Player } from './Player.js';
import { CameraController } from './CameraController.js';
import { ProjectileManager } from './ProjectileManager.js';
import { MissileManager } from './MissileManager.js';
import { EffectsManager } from './EffectsManager.js';
import { EnemyManager } from './EnemyManager.js';
import { WaveManager } from './WaveManager.js';
import { CollisionSystem } from './CollisionSystem.js';
import { AudioManager } from './AudioManager.js';
import { UIManager } from './UIManager.js';
import {
  GAME_CONFIG,
  GAME_STATE,
  PLAYER_CONFIG,
  QUALITY_PRESETS,
} from './config.js';
import { safeGetStorage, safeSetStorage } from './utils/MathUtils.js';

const _muzzlePosition = new THREE.Vector3();
const _missilePosition = new THREE.Vector3();
const _enginePosition = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _toEnemy = new THREE.Vector3();
const _screenPosition = new THREE.Vector3();
const _damageDirection = new THREE.Vector3();
const _engineLocal = new THREE.Vector3(0, -0.08, 2.8);

export class Game {
  constructor(canvas, context) {
    this.canvas = canvas;
    this.context = context;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      68,
      window.innerWidth / window.innerHeight,
      0.1,
      5000,
    );
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.state = GAME_STATE.MENU;
    this.previousPlayableState = GAME_STATE.PLAYING;
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.elapsedTime = 0;
    this.score = 0;
    this.kills = 0;
    this.highScore = Math.max(
      0,
      Number(safeGetStorage('nebula-strike.high-score', 0)) || 0,
    );
    this.runStartingHighScore = this.highScore;
    this.quality = QUALITY_PRESETS[
      safeGetStorage('nebula-strike.quality', 'high')
    ]
      ? safeGetStorage('nebula-strike.quality', 'high')
      : 'high';
    this.countdownTimer = GAME_CONFIG.countdownSeconds;
    this.lastCountdownValue = null;
    this.lockTarget = null;
    this.lockProgress = 0;
    this.locked = false;
    this.muzzleSide = -1;
    this.engineParticleTimer = 0;
    this.warningTimer = 0;
    this.audioUpdateAccumulator = 0;
    this.hudTimer = 0;
    this.lastVisualFrame = 0;
    this.disposed = false;

    this.assetManager = new AssetManager();
    this.environment = new Environment(this.scene, {
      quality: this.quality,
      arenaRadius: GAME_CONFIG.arenaRadius,
    });
    this.effects = new EffectsManager(this.scene, this.quality);
    this.audio = new AudioManager();
    this.ui = new UIManager({
      onStart: () => this.start(),
      onRestart: () => this.restart(),
      onResume: () => this.resume(),
      onMute: (muted) => this.audio.setMuted(muted),
      onVolume: (volume) => this.audio.setVolume(volume),
      onQuality: (quality) => this.setQuality(quality),
      onPointerLock: () => this.input.requestPointerLock(),
    });
    this.input = new InputManager(
      this.canvas,
      () => this.togglePause(),
      (locked, wasLocked) => {
        if (
          wasLocked &&
          !locked &&
          (this.state === GAME_STATE.PLAYING ||
            this.state === GAME_STATE.COUNTDOWN)
        ) {
          this.pause();
        }
      },
    );
    this.player = new Player(this.scene, this.assetManager);
    this.cameraController = new CameraController(this.camera);
    this.projectileManager = new ProjectileManager(
      this.scene,
      this.assetManager,
    );
    this.missileManager = new MissileManager(
      this.scene,
      this.assetManager,
      this.effects,
    );
    this.enemyManager = new EnemyManager(this.scene, this.assetManager);
    this.waveManager = new WaveManager(
      this.enemyManager,
      this.player,
      this.environment.obstacles,
      {
        onWaveStart: (wave, bossWave) =>
          this.#onWaveStart(wave, bossWave),
        onIntermission: () => this.#onIntermission(),
      },
    );
    this.collisionSystem = new CollisionSystem({
      projectileManager: this.projectileManager,
      missileManager: this.missileManager,
      enemyManager: this.enemyManager,
      effects: this.effects,
      audio: this.audio,
      cameraController: this.cameraController,
      callbacks: {
        onEnemyHit: (enemy, damage) => this.#onEnemyHit(enemy, damage),
        onEnemyKilled: (enemy) => this.#onEnemyKilled(enemy),
        onPlayerDamaged: (damage, source, result) =>
          this.#onPlayerDamaged(damage, source, result),
      },
    });

    this.enemyContext = {
      player: this.player,
      obstacles: this.environment.obstacles,
      projectileManager: this.projectileManager,
      camera: this.camera,
      onEnemyFire: () => this.audio.playLaser(true),
      enemies: this.enemyManager.enemies,
    };

    this._animate = this.#animate.bind(this);
    this._onResize = this.#onResize.bind(this);
    this._onVisibility = this.#onVisibility.bind(this);
    this._onContextLost = this.#onContextLost.bind(this);
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
    this.canvas.addEventListener('webglcontextlost', this._onContextLost);

    this.cameraController.reset(this.player);
    this.#configureRenderer();
    this.#onResize();
    this.ui.setMuted(this.audio.muted);
    this.ui.setVolume(this.audio.getVolume());
    this.ui.setQuality(this.quality);
    this.ui.showMenu();
    this.#updateHUD(true);
    this.renderer.setAnimationLoop(this._animate);
  }

  async start() {
    if (this.state !== GAME_STATE.MENU) return;
    const audioReady = this.audio.resume();
    this.restart();
    this.input.requestPointerLock();
    await audioReady;
  }

  restart() {
    this.enemyManager.reset();
    this.projectileManager.reset();
    this.missileManager.reset();
    this.effects.reset();
    this.waveManager.reset();
    this.environment.reset();
    this.player.reset();
    this.cameraController.reset(this.player);
    this.audio.reset();
    this.audio.startMusic();
    this.input.clear();

    this.score = 0;
    this.kills = 0;
    this.elapsedTime = 0;
    this.countdownTimer = GAME_CONFIG.countdownSeconds;
    this.lastCountdownValue = null;
    this.lockProgress = 0;
    this.locked = false;
    this.lockTarget = null;
    this.muzzleSide = -1;
    this.engineParticleTimer = 0;
    this.warningTimer = 0;
    this.audioUpdateAccumulator = 0;
    this.runStartingHighScore = this.highScore;
    this.state = GAME_STATE.COUNTDOWN;
    this.ui.showCountdown(Math.ceil(this.countdownTimer));
    this.#updateHUD(true);
    this.input.requestPointerLock();
    this.timer.reset();
  }

  pause() {
    if (
      this.state !== GAME_STATE.PLAYING &&
      this.state !== GAME_STATE.COUNTDOWN
    ) {
      return;
    }
    this.previousPlayableState = this.state;
    this.state = GAME_STATE.PAUSED;
    this.input.clear();
    this.input.releasePointerLock();
    this.ui.showPause();
    this.audio.update(0, {
      speedRatio: 0,
      boosting: false,
      lowHealth: false,
      playing: false,
    });
  }

  resume() {
    if (this.state !== GAME_STATE.PAUSED) return;
    this.state = this.previousPlayableState;
    if (this.state === GAME_STATE.COUNTDOWN) {
      this.ui.showCountdown(Math.ceil(this.countdownTimer));
    } else {
      this.ui.showPlaying();
    }
    this.input.clear();
    this.input.requestPointerLock();
    void this.audio.resume();
    this.timer.reset();
  }

  togglePause() {
    if (this.state === GAME_STATE.PAUSED) this.resume();
    else this.pause();
  }

  setQuality(quality) {
    if (!QUALITY_PRESETS[quality]) return;
    this.quality = quality;
    safeSetStorage('nebula-strike.quality', quality);
    this.environment.setQuality(quality);
    this.effects.setQuality(quality);
    this.ui.setQuality(quality);
    this.#configureRenderer();
    this.#onResize();
  }

  #configureRenderer() {
    this.#updateRenderPixelRatio();
    this.renderer.shadowMap.enabled = false;
  }

  #updateRenderPixelRatio(
    width = Math.max(1, window.innerWidth),
    height = Math.max(1, window.innerHeight),
  ) {
    const preset = QUALITY_PRESETS[this.quality];
    const desiredRatio = Math.min(
      window.devicePixelRatio || 1,
      preset.pixelRatio,
    );
    const pixelBudget =
      this.quality === 'high'
        ? 4_200_000
        : this.quality === 'medium'
          ? 3_200_000
          : 2_100_000;
    const budgetRatio = Math.sqrt(pixelBudget / Math.max(1, width * height));
    const pixelRatio = Math.max(
      0.5,
      Math.min(desiredRatio, budgetRatio),
    );
    this.renderer.setPixelRatio(pixelRatio);
  }

  #animate(timestamp) {
    if (this.disposed) return;
    if (this.state === GAME_STATE.PAUSED) {
      this.input.endFrame();
      return;
    }
    const now = performance.now();
    if (
      (this.state === GAME_STATE.MENU ||
        this.state === GAME_STATE.GAME_OVER) &&
      now - this.lastVisualFrame < 1000 / 30
    ) {
      this.input.endFrame();
      return;
    }
    this.lastVisualFrame = now;
    this.timer.update(timestamp);
    const realDeltaTime = Math.min(this.timer.getDelta(), 0.25);
    const deltaTime = Math.min(realDeltaTime, GAME_CONFIG.maxDeltaTime);

    if (this.state === GAME_STATE.COUNTDOWN) {
      this.#updateCountdown(deltaTime, realDeltaTime);
    } else if (this.state === GAME_STATE.PLAYING) {
      this.#updateGameplay(deltaTime, realDeltaTime);
    } else {
      this.environment.update(deltaTime, this.player.group.position);
      this.effects.update(deltaTime);
      if (this.state === GAME_STATE.MENU) {
        this.player.model.rotation.z =
          Math.sin(performance.now() * 0.00045) * 0.055;
      }
    }

    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  }

  #updateCountdown(deltaTime, realDeltaTime) {
    this.countdownTimer -= realDeltaTime;
    this.environment.update(deltaTime, this.player.group.position);
    this.effects.update(deltaTime);
    this.cameraController.update(deltaTime, this.player);
    const value = Math.max(0, Math.ceil(this.countdownTimer));
    if (value !== this.lastCountdownValue) {
      this.lastCountdownValue = value;
      this.ui.showCountdown(value);
    }
    if (this.countdownTimer <= 0) {
      this.state = GAME_STATE.PLAYING;
      this.ui.showPlaying();
      this.waveManager.start();
    }
    this.#updateAudio(realDeltaTime);
    this.#updateHUD(false, realDeltaTime);
  }

  #updateGameplay(deltaTime, realDeltaTime) {
    this.elapsedTime += realDeltaTime;
    this.player.update(deltaTime, this.input);
    this.#updateTargetLock(deltaTime);
    this.#handleWeapons();
    this.enemyManager.update(deltaTime, this.enemyContext);
    this.projectileManager.update(deltaTime);
    this.missileManager.update(deltaTime);
    this.collisionSystem.update(this.player, this.environment.obstacles);
    this.waveManager.update(realDeltaTime);
    this.#spawnEngineTrail(deltaTime);
    this.effects.update(deltaTime);
    this.environment.update(deltaTime, this.player.group.position);
    this.cameraController.update(deltaTime, this.player);
    this.#updateAudio(realDeltaTime);
    this.#updateHUD(false, realDeltaTime);

    if (!this.player.alive) this.#gameOver();
  }

  #handleWeapons() {
    this.player.getForward(_forward);
    if (this.input.isDown('Space') && this.player.canFire()) {
      this.muzzleSide *= -1;
      this.player.getMuzzlePosition(this.muzzleSide, _muzzlePosition);
      this.projectileManager.spawnPlayer(
        _muzzlePosition,
        _forward,
        this.player,
        this.player.velocity,
      );
      this.effects.spawnTrail(_muzzlePosition, 'cyan', 0.24);
      this.player.markFired();
      this.audio.playLaser(false);
      this.cameraController.addShake(0.022);
    }

    if (this.input.consumePressed('KeyE')) {
      if (
        this.locked &&
        this.lockTarget?.alive &&
        this.player.canLaunchMissile()
      ) {
        this.player.getMissilePosition(_missilePosition);
        this.missileManager.spawn(
          _missilePosition,
          _forward,
          this.lockTarget,
          this.player.velocity,
        );
        this.player.markMissileLaunched();
        this.audio.playMissile();
        this.cameraController.addShake(0.08);
      } else if (this.player.missiles > 0) {
        this.audio.playWarning();
      }
    }
  }

  #updateTargetLock(deltaTime) {
    this.player.getForward(_forward);
    let bestTarget = null;
    let bestDot = GAME_CONFIG.lockConeDot;

    for (const enemy of this.enemyManager.enemies) {
      if (!enemy.active || !enemy.alive) continue;
      _toEnemy.copy(enemy.group.position).sub(this.player.group.position);
      const distance = _toEnemy.length();
      if (distance > GAME_CONFIG.lockRange || distance < 0.001) continue;
      _toEnemy.multiplyScalar(1 / distance);
      const dot = _forward.dot(_toEnemy);
      if (dot > bestDot) {
        bestDot = dot;
        bestTarget = enemy;
      }
    }

    if (bestTarget !== this.lockTarget) {
      this.lockTarget = bestTarget;
      this.lockProgress = 0;
      this.locked = false;
    } else if (bestTarget) {
      this.lockProgress = Math.min(
        GAME_CONFIG.lockTime,
        this.lockProgress + deltaTime,
      );
      this.locked = this.lockProgress >= GAME_CONFIG.lockTime;
    } else {
      this.lockProgress = 0;
      this.locked = false;
    }
    this.enemyManager.setTarget(this.lockTarget);
  }

  #spawnEngineTrail(deltaTime) {
    this.engineParticleTimer -= deltaTime;
    if (this.engineParticleTimer > 0) return;
    this.engineParticleTimer = this.player.boosting ? 0.025 : 0.065;
    this.player.group.updateMatrixWorld();
    _enginePosition
      .copy(_engineLocal)
      .applyMatrix4(this.player.group.matrixWorld);
    this.effects.spawnEngine(
      _enginePosition,
      this.player.velocity,
      this.player.boosting,
    );
  }

  #updateAudio(deltaTime) {
    this.audioUpdateAccumulator += deltaTime;
    if (this.audioUpdateAccumulator < 1 / 30) return;
    const audioDeltaTime = this.audioUpdateAccumulator;
    this.audioUpdateAccumulator = 0;
    const speedRatio =
      this.player.speed /
      (this.player.boosting
        ? PLAYER_CONFIG.boostSpeed
        : PLAYER_CONFIG.normalSpeed);
    const lowHealth =
      this.player.health / PLAYER_CONFIG.maxHealth <= 0.25 &&
      this.player.alive;
    this.audio.update(audioDeltaTime, {
      speedRatio,
      boosting: this.player.boosting,
      lowHealth,
      playing:
        this.state === GAME_STATE.PLAYING ||
        this.state === GAME_STATE.COUNTDOWN,
    });

    if (lowHealth) {
      this.warningTimer -= audioDeltaTime;
      if (this.warningTimer <= 0) {
        this.warningTimer = 2.3;
        this.audio.playWarning();
      }
    } else {
      this.warningTimer = 0;
    }
  }

  #onWaveStart(wave, bossWave) {
    if (wave > 1) {
      this.player.missiles = Math.min(
        PLAYER_CONFIG.missileAmmo,
        this.player.missiles + 1,
      );
      this.player.shield = Math.min(
        PLAYER_CONFIG.maxShield,
        this.player.shield + 24,
      );
    }
    this.ui.showWaveAnnouncement(
      bossWave ? `Boss wave // ${String(wave).padStart(2, '0')}` : `Wave ${String(wave).padStart(2, '0')}`,
      bossWave
        ? 'Dreadnought signature detected'
        : `${this.enemyManager.activeCount} hostile signatures inbound`,
    );
    if (bossWave) this.cameraController.addShake(0.28);
  }

  #onIntermission() {
    this.ui.showWaveAnnouncement(
      'Sector clear',
      `Next wave in ${GAME_CONFIG.waveDelay} seconds`,
    );
    this.player.afterburner = Math.min(
      PLAYER_CONFIG.boostCapacity,
      this.player.afterburner + 28,
    );
  }

  #onEnemyHit() {
    this.ui.showHitMarker();
  }

  #onEnemyKilled(enemy) {
    if (!enemy.active) return;
    _screenPosition.copy(enemy.group.position).project(this.camera);
    const x = (_screenPosition.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_screenPosition.y * 0.5 + 0.5) * window.innerHeight;
    const reward = enemy.scoreValue;
    this.score += reward;
    this.kills += 1;
    this.ui.showScorePopup(reward, x, y);
    this.effects.spawnExplosion(
      enemy.group.position,
      enemy.isBoss ? 'purple' : 'orange',
      enemy.isBoss ? 3.2 : enemy.type === 'heavy' ? 1.75 : 1.15,
    );
    this.audio.playExplosion(enemy.isBoss ? 2 : 1);
    this.cameraController.addShake(enemy.isBoss ? 0.75 : 0.22);
    this.enemyManager.deactivate(enemy);
    if (this.lockTarget === enemy) {
      this.lockTarget = null;
      this.lockProgress = 0;
      this.locked = false;
    }
    if (this.score > this.highScore) {
      this.highScore = this.score;
      safeSetStorage('nebula-strike.high-score', this.highScore);
    }
  }

  #onPlayerDamaged(damage, source, result) {
    _damageDirection.copy(source).project(this.camera);
    const angle =
      (Math.atan2(_damageDirection.x, -_damageDirection.y) * 180) / Math.PI;
    this.ui.showDamage(angle);
    if (result.dead) {
      this.effects.spawnExplosion(this.player.group.position, 'cyan', 2.8);
      this.audio.playExplosion(1.9);
      this.cameraController.addShake(1);
    } else if (damage > 16) {
      this.cameraController.addShake(0.12);
    }
  }

  #updateHUD(force = false, deltaTime = 0) {
    this.hudTimer -= deltaTime;
    if (!force && this.hudTimer > 0) return;
    this.hudTimer = 0.065;
    const boss = this.enemyManager.activeBoss;
    let lockStatus = 'No target';
    if (this.lockTarget) {
      lockStatus = this.locked
        ? { status: 'locked', label: this.lockTarget.config.label }
        : this.lockProgress / GAME_CONFIG.lockTime;
    }
    const boundaryDistance = this.player.group.position.length();
    const status =
      boundaryDistance > GAME_CONFIG.arenaRadius - GAME_CONFIG.arenaWarningDistance
        ? 'RETURN TO COMBAT ZONE'
        : this.player.boosting
          ? 'AFTERBURNER ENGAGED'
          : this.waveManager.intermission
            ? 'SECTOR SECURE'
            : 'Combat systems nominal';

    this.ui.updateHUD({
      health: this.player.health,
      maxHealth: PLAYER_CONFIG.maxHealth,
      shield: this.player.shield,
      maxShield: PLAYER_CONFIG.maxShield,
      boost: this.player.afterburner,
      maxBoost: PLAYER_CONFIG.boostCapacity,
      missiles: this.player.missiles,
      score: this.score,
      highScore: this.highScore,
      wave: Math.max(1, this.waveManager.wave),
      enemies: this.enemyManager.activeCount,
      kills: this.kills,
      time: this.elapsedTime,
      lockStatus,
      status,
      boss: boss
        ? {
            health: boss.health,
            maxHealth: boss.maxHealth,
            name: `${boss.config.label} // phase ${boss.phase}`,
            visible: true,
          }
        : null,
    });
  }

  #gameOver() {
    if (this.state === GAME_STATE.GAME_OVER) return;
    this.state = GAME_STATE.GAME_OVER;
    this.input.clear();
    this.input.releasePointerLock();
    this.audio.stopMusic();
    this.audio.update(0, {
      speedRatio: 0,
      boosting: false,
      lowHealth: false,
      playing: false,
    });
    const newHighScore =
      this.score > this.runStartingHighScore && this.score > 0;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      safeSetStorage('nebula-strike.high-score', this.highScore);
    }
    this.ui.showGameOver({
      score: this.score,
      highScore: this.highScore,
      wave: this.waveManager.wave,
      kills: this.kills,
      time: this.elapsedTime,
      newHighScore,
    });
  }

  #onResize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.#updateRenderPixelRatio(width, height);
    this.renderer.setSize(width, height, false);
  }

  #onVisibility() {
    if (document.hidden) this.pause();
    this.timer.reset();
  }

  #onContextLost(event) {
    event.preventDefault();
    this.pause();
    this.ui.showWebGLError(
      'The WebGL2 graphics context was lost. Reload the page to restart the simulation.',
    );
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.input.dispose();
    this.ui.dispose();
    this.audio.dispose();
    this.enemyManager.dispose();
    this.projectileManager.dispose();
    this.missileManager.dispose();
    this.effects.dispose();
    this.player.dispose();
    this.environment.dispose();
    this.assetManager.dispose();
    this.timer.dispose();
    this.renderer.dispose();
  }
}

export default Game;
