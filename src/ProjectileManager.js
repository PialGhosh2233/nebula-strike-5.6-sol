import * as THREE from 'three';
import { GAME_CONFIG, WEAPON_CONFIG } from './config.js';
import { FORWARD } from './utils/MathUtils.js';
import { ObjectPool } from './utils/ObjectPool.js';

const _direction = new THREE.Vector3();
const _orientation = new THREE.Quaternion();

export class ProjectileManager {
  constructor(scene, assetManager) {
    this.scene = scene;
    this.assetManager = assetManager;
    this.pool = new ObjectPool(
      () => this.#createProjectile(),
      (projectile) => this.#resetProjectile(projectile),
      GAME_CONFIG.projectilePoolSize,
    );
  }

  #createProjectile() {
    const projectile = {
      active: false,
      mesh: this.assetManager.createProjectileMesh('player'),
      velocity: new THREE.Vector3(),
      previousPosition: new THREE.Vector3(),
      team: 'player',
      damage: 0,
      radius: 0.4,
      lifetime: 0,
      owner: null,
    };
    projectile.mesh.visible = false;
    this.scene.add(projectile.mesh);
    return projectile;
  }

  #resetProjectile(projectile) {
    projectile.active = false;
    projectile.mesh.visible = false;
    projectile.owner = null;
    projectile.velocity.set(0, 0, 0);
  }

  spawn({
    position,
    direction,
    team,
    damage,
    speed,
    radius,
    lifetime,
    owner = null,
    inheritedVelocity = null,
  }) {
    const projectile = this.pool.acquire();
    projectile.active = true;
    projectile.team = team;
    projectile.damage = damage;
    projectile.radius = radius;
    projectile.lifetime = lifetime;
    projectile.owner = owner;
    projectile.mesh.userData.setTeam?.(team);
    projectile.mesh.position.copy(position);
    projectile.previousPosition.copy(position);
    _direction.copy(direction).normalize();
    projectile.velocity.copy(_direction).multiplyScalar(speed);
    if (inheritedVelocity) {
      projectile.velocity.addScaledVector(inheritedVelocity, 0.32);
    }
    _orientation.setFromUnitVectors(FORWARD, _direction);
    projectile.mesh.quaternion.copy(_orientation);
    projectile.mesh.visible = true;
    return projectile;
  }

  spawnPlayer(position, direction, owner, inheritedVelocity) {
    const config = WEAPON_CONFIG.playerLaser;
    return this.spawn({
      position,
      direction,
      team: 'player',
      damage: config.damage,
      speed: config.speed,
      radius: config.radius,
      lifetime: config.lifetime,
      owner,
      inheritedVelocity,
    });
  }

  spawnEnemy(position, direction, damage, owner) {
    const config = WEAPON_CONFIG.enemyLaser;
    return this.spawn({
      position,
      direction,
      team: 'enemy',
      damage,
      speed: config.speed,
      radius: config.radius,
      lifetime: config.lifetime,
      owner,
    });
  }

  update(deltaTime) {
    const maxDistanceSquared =
      GAME_CONFIG.arenaRadius * GAME_CONFIG.arenaRadius * 2.25;
    for (const projectile of this.pool.all) {
      if (!projectile.active) continue;
      projectile.previousPosition.copy(projectile.mesh.position);
      projectile.mesh.position.addScaledVector(
        projectile.velocity,
        deltaTime,
      );
      projectile.lifetime -= deltaTime;
      if (
        projectile.lifetime <= 0 ||
        projectile.mesh.position.lengthSq() > maxDistanceSquared
      ) {
        this.deactivate(projectile);
      }
    }
  }

  deactivate(projectile) {
    if (!projectile?.active) return;
    this.pool.release(projectile);
  }

  reset() {
    this.pool.releaseAll();
  }

  get active() {
    return this.pool.all;
  }

  dispose() {
    for (const projectile of this.pool.all) {
      this.scene.remove(projectile.mesh);
    }
    this.pool.all.length = 0;
    this.pool.available.length = 0;
  }
}
