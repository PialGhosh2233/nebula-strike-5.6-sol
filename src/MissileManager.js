import * as THREE from 'three';
import { GAME_CONFIG, WEAPON_CONFIG } from './config.js';
import { FORWARD } from './utils/MathUtils.js';
import { ObjectPool } from './utils/ObjectPool.js';

const _desired = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _orientation = new THREE.Quaternion();

export class MissileManager {
  constructor(scene, assetManager, effectsManager) {
    this.scene = scene;
    this.assetManager = assetManager;
    this.effects = effectsManager;
    this.pool = new ObjectPool(
      () => this.#createMissile(),
      (missile) => this.#resetMissile(missile),
      GAME_CONFIG.missilePoolSize,
    );
  }

  #createMissile() {
    const missile = {
      active: false,
      mesh: this.assetManager.createMissileMesh(),
      velocity: new THREE.Vector3(),
      previousPosition: new THREE.Vector3(),
      target: null,
      lifetime: 0,
      trailTimer: 0,
      radius: WEAPON_CONFIG.missile.radius,
      damage: WEAPON_CONFIG.missile.damage,
    };
    missile.mesh.visible = false;
    this.scene.add(missile.mesh);
    return missile;
  }

  #resetMissile(missile) {
    missile.active = false;
    missile.mesh.visible = false;
    missile.target = null;
    missile.velocity.set(0, 0, 0);
  }

  spawn(position, direction, target, inheritedVelocity = null) {
    if (!target?.alive) return null;
    const missile = this.pool.acquire();
    missile.active = true;
    missile.mesh.visible = true;
    missile.mesh.position.copy(position);
    missile.previousPosition.copy(position);
    missile.target = target;
    missile.lifetime = WEAPON_CONFIG.missile.lifetime;
    missile.trailTimer = 0;
    missile.velocity
      .copy(direction)
      .normalize()
      .multiplyScalar(WEAPON_CONFIG.missile.speed);
    if (inheritedVelocity) {
      missile.velocity.addScaledVector(inheritedVelocity, 0.35);
    }
    return missile;
  }

  update(deltaTime) {
    const config = WEAPON_CONFIG.missile;
    for (const missile of this.pool.all) {
      if (!missile.active) continue;
      missile.previousPosition.copy(missile.mesh.position);
      missile.lifetime -= deltaTime;

      if (missile.target?.alive) {
        _desired
          .copy(missile.target.group.position)
          .sub(missile.mesh.position)
          .normalize();
        _direction.copy(missile.velocity).normalize();
        _direction.lerp(
          _desired,
          1 - Math.exp(-config.turnRate * deltaTime),
        );
        _direction.normalize();
        const speed = Math.min(
          config.maxSpeed,
          missile.velocity.length() + config.acceleration * deltaTime,
        );
        missile.velocity.copy(_direction).multiplyScalar(speed);
      }

      missile.mesh.position.addScaledVector(missile.velocity, deltaTime);
      _direction.copy(missile.velocity).normalize();
      _orientation.setFromUnitVectors(FORWARD, _direction);
      missile.mesh.quaternion.copy(_orientation);

      missile.trailTimer -= deltaTime;
      if (missile.trailTimer <= 0) {
        missile.trailTimer = 0.035;
        this.effects.spawnTrail(missile.mesh.position, 'orange', 0.42);
      }

      if (
        missile.lifetime <= 0 ||
        missile.mesh.position.length() >
          GAME_CONFIG.arenaRadius * 1.35
      ) {
        this.deactivate(missile);
      }
    }
  }

  deactivate(missile) {
    if (!missile?.active) return;
    this.pool.release(missile);
  }

  reset() {
    this.pool.releaseAll();
  }

  get active() {
    return this.pool.all;
  }

  dispose() {
    for (const missile of this.pool.all) {
      this.scene.remove(missile.mesh);
    }
    this.pool.all.length = 0;
    this.pool.available.length = 0;
  }
}
