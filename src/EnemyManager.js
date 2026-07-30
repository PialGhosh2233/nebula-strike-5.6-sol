import * as THREE from 'three';
import { Enemy } from './Enemy.js';
import { GAME_CONFIG } from './config.js';
import { randomPointOnShell } from './utils/MathUtils.js';

const _spawnPosition = new THREE.Vector3();
const _candidate = new THREE.Vector3();

export class EnemyManager {
  constructor(scene, assetManager) {
    this.scene = scene;
    this.assetManager = assetManager;
    this.enemies = [];
  }

  spawn(type, playerPosition, obstacles, difficulty = {}) {
    let enemy = this.enemies.find(
      (candidate) => !candidate.active && candidate.type === type,
    );
    if (!enemy) {
      enemy = new Enemy(this.scene, this.assetManager, type);
      this.enemies.push(enemy);
    }

    this.#findSpawnPosition(playerPosition, obstacles, _spawnPosition);
    enemy.reset(_spawnPosition, difficulty);
    return enemy;
  }

  spawnAt(type, position, difficulty = {}) {
    let enemy = this.enemies.find(
      (candidate) => !candidate.active && candidate.type === type,
    );
    if (!enemy) {
      enemy = new Enemy(this.scene, this.assetManager, type);
      this.enemies.push(enemy);
    }
    enemy.reset(position, difficulty);
    return enemy;
  }

  #findSpawnPosition(playerPosition, obstacles, out) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      randomPointOnShell(_candidate, 285, 520);
      _candidate.add(playerPosition);
      if (_candidate.length() > GAME_CONFIG.arenaRadius - 55) {
        _candidate
          .normalize()
          .multiplyScalar(GAME_CONFIG.arenaRadius - 55);
      }
      const clearOfObstacles = obstacles.every(
        (obstacle) =>
          _candidate.distanceToSquared(obstacle.position) >
          (obstacle.radius + 42) ** 2,
      );
      const clearOfEnemies = this.enemies.every(
        (enemy) =>
          !enemy.active ||
          _candidate.distanceToSquared(enemy.group.position) > 75 ** 2,
      );
      if (clearOfObstacles && clearOfEnemies) {
        out.copy(_candidate);
        return out;
      }
    }
    out.copy(_candidate);
    return out;
  }

  update(deltaTime, context) {
    context.enemies = this.enemies;
    for (const enemy of this.enemies) {
      if (enemy.active) {
        enemy.update(deltaTime, context);
      }
    }
  }

  deactivate(enemy) {
    enemy?.deactivate();
  }

  setTarget(target) {
    for (const enemy of this.enemies) {
      if (enemy.active) enemy.setTargeted(enemy === target);
    }
  }

  getActive() {
    return this.enemies.filter((enemy) => enemy.active);
  }

  get activeCount() {
    let count = 0;
    for (const enemy of this.enemies) {
      if (enemy.active) count += 1;
    }
    return count;
  }

  get activeBoss() {
    return this.enemies.find((enemy) => enemy.active && enemy.isBoss) ?? null;
  }

  reset() {
    for (const enemy of this.enemies) enemy.deactivate();
  }

  dispose() {
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies.length = 0;
  }
}
