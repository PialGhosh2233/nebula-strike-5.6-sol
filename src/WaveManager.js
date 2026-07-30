import { GAME_CONFIG } from './config.js';

export class WaveManager {
  constructor(enemyManager, player, obstacles, callbacks = {}) {
    this.enemyManager = enemyManager;
    this.player = player;
    this.obstacles = obstacles;
    this.callbacks = callbacks;
    this.wave = 0;
    this.waveActive = false;
    this.intermission = false;
    this.intermissionTimer = 0;
  }

  reset() {
    this.wave = 0;
    this.waveActive = false;
    this.intermission = false;
    this.intermissionTimer = 0;
  }

  start() {
    if (this.waveActive) return;
    this.#spawnNextWave();
  }

  update(deltaTime) {
    if (this.waveActive && this.enemyManager.activeCount === 0) {
      this.waveActive = false;
      this.intermission = true;
      this.intermissionTimer = GAME_CONFIG.waveDelay;
      this.callbacks.onIntermission?.(this.intermissionTimer);
    }

    if (!this.intermission) return;
    this.intermissionTimer = Math.max(0, this.intermissionTimer - deltaTime);
    this.callbacks.onIntermissionTick?.(this.intermissionTimer);
    if (this.intermissionTimer <= 0) {
      this.intermission = false;
      this.#spawnNextWave();
    }
  }

  #spawnNextWave() {
    this.wave += 1;
    this.waveActive = true;
    const bossWave = this.wave % GAME_CONFIG.bossEvery === 0;
    const difficulty = {
      health: 1 + (this.wave - 1) * 0.105,
      damage: 1 + (this.wave - 1) * 0.07,
      speed: Math.min(1.25, 1 + (this.wave - 1) * 0.018),
      score: 1 + (this.wave - 1) * 0.045,
    };

    if (bossWave) {
      this.enemyManager.spawn(
        'boss',
        this.player.group.position,
        this.obstacles,
        {
          ...difficulty,
          health: difficulty.health * 1.08,
        },
      );
      const escortCount = Math.min(5, 2 + Math.floor(this.wave / 5));
      for (let index = 0; index < escortCount; index += 1) {
        this.enemyManager.spawn(
          index % 2 === 0 ? 'scout' : 'fighter',
          this.player.group.position,
          this.obstacles,
          difficulty,
        );
      }
    } else {
      const enemyCount = Math.min(18, 3 + Math.ceil(this.wave * 1.25));
      for (let index = 0; index < enemyCount; index += 1) {
        let type = 'fighter';
        const selector = (index * 0.37 + this.wave * 0.19) % 1;
        if (this.wave < 2 || selector < 0.32) type = 'scout';
        else if (this.wave >= 3 && selector > 0.76) type = 'heavy';
        this.enemyManager.spawn(
          type,
          this.player.group.position,
          this.obstacles,
          difficulty,
        );
      }
    }

    this.callbacks.onWaveStart?.(this.wave, bossWave);
  }
}
