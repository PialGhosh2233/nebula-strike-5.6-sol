import * as THREE from 'three';
import { WEAPON_CONFIG } from './config.js';
import { segmentSphereIntersects } from './utils/MathUtils.js';

const _normal = new THREE.Vector3();
const _impactPoint = new THREE.Vector3();

export class CollisionSystem {
  constructor({
    projectileManager,
    missileManager,
    enemyManager,
    effects,
    audio,
    cameraController,
    callbacks = {},
  }) {
    this.projectileManager = projectileManager;
    this.missileManager = missileManager;
    this.enemyManager = enemyManager;
    this.effects = effects;
    this.audio = audio;
    this.cameraController = cameraController;
    this.callbacks = callbacks;
  }

  update(player, obstacles) {
    this.#projectileCollisions(player, obstacles);
    this.#missileCollisions(obstacles);
    this.#shipObstacleCollisions(player, obstacles);
  }

  #projectileCollisions(player, obstacles) {
    for (const projectile of this.projectileManager.active) {
      if (!projectile.active) continue;

      if (this.#projectileHitObstacle(projectile, obstacles)) continue;

      if (projectile.team === 'player') {
        for (const enemy of this.enemyManager.enemies) {
          if (!enemy.active || !enemy.alive || enemy === projectile.owner) {
            continue;
          }
          if (
            segmentSphereIntersects(
              projectile.previousPosition,
              projectile.mesh.position,
              enemy.group.position,
              enemy.radius + projectile.radius,
            )
          ) {
            _impactPoint.copy(projectile.mesh.position);
            this.projectileManager.deactivate(projectile);
            const result = enemy.damage(projectile.damage);
            this.effects.spawnImpact(_impactPoint, 'cyan', 1);
            this.audio.playHit?.();
            this.callbacks.onEnemyHit?.(enemy, projectile.damage);
            if (result.dead) this.callbacks.onEnemyKilled?.(enemy);
            break;
          }
        }
      } else if (
        player.alive &&
        segmentSphereIntersects(
          projectile.previousPosition,
          projectile.mesh.position,
          player.group.position,
          player.radius + projectile.radius,
        )
      ) {
        _impactPoint.copy(projectile.mesh.position);
        this.projectileManager.deactivate(projectile);
        this.effects.spawnImpact(_impactPoint, 'red', 1.1);
        const result = player.damage(projectile.damage);
        if (result.applied) {
          this.cameraController.addShake(0.18);
          this.callbacks.onPlayerDamaged?.(
            projectile.damage,
            projectile.previousPosition,
            result,
          );
        }
      }
    }
  }

  #projectileHitObstacle(projectile, obstacles) {
    for (const obstacle of obstacles) {
      if (
        segmentSphereIntersects(
          projectile.previousPosition,
          projectile.mesh.position,
          obstacle.position,
          obstacle.radius + projectile.radius,
        )
      ) {
        _impactPoint.copy(projectile.mesh.position);
        this.projectileManager.deactivate(projectile);
        this.effects.spawnImpact(
          _impactPoint,
          projectile.team === 'player' ? 'blue' : 'red',
          0.72,
        );
        return true;
      }
    }
    return false;
  }

  #missileCollisions(obstacles) {
    for (const missile of this.missileManager.active) {
      if (!missile.active) continue;

      let hit = false;
      let directHit = null;
      for (const obstacle of obstacles) {
        if (
          segmentSphereIntersects(
            missile.previousPosition,
            missile.mesh.position,
            obstacle.position,
            obstacle.radius + missile.radius,
          )
        ) {
          hit = true;
          break;
        }
      }

      const target = missile.target;
      if (
        !hit &&
        target?.active &&
        target.alive &&
        segmentSphereIntersects(
          missile.previousPosition,
          missile.mesh.position,
          target.group.position,
          target.radius + missile.radius + 1.2,
        )
      ) {
        hit = true;
        directHit = target;
      }

      if (!hit) {
        for (const enemy of this.enemyManager.enemies) {
          if (!enemy.active || !enemy.alive) continue;
          if (
            segmentSphereIntersects(
              missile.previousPosition,
              missile.mesh.position,
              enemy.group.position,
              enemy.radius + missile.radius + 1.2,
            )
          ) {
            hit = true;
            directHit = enemy;
            break;
          }
        }
      }

      if (!hit) continue;
      _impactPoint.copy(missile.mesh.position);
      this.missileManager.deactivate(missile);
      this.effects.spawnExplosion(_impactPoint, 'orange', 1.55);
      this.audio.playExplosion?.(1.15);
      this.cameraController.addShake(0.34);

      for (const enemy of this.enemyManager.enemies) {
        if (!enemy.active || !enemy.alive) continue;
        const distance = enemy.group.position.distanceTo(_impactPoint);
        if (distance > WEAPON_CONFIG.missile.splashRadius + enemy.radius) {
          continue;
        }
        const falloff = Math.max(
          0.22,
          1 - distance / WEAPON_CONFIG.missile.splashRadius,
        );
        const damage =
          enemy === directHit
            ? WEAPON_CONFIG.missile.damage
            : WEAPON_CONFIG.missile.splashDamage * falloff;
        const result = enemy.damage(damage);
        this.callbacks.onEnemyHit?.(enemy, damage);
        if (result.dead) this.callbacks.onEnemyKilled?.(enemy);
      }
    }
  }

  #shipObstacleCollisions(player, obstacles) {
    if (!player.alive) return;
    for (const obstacle of obstacles) {
      _normal.copy(player.group.position).sub(obstacle.position);
      const minimumDistance = obstacle.radius + player.radius;
      const distanceSquared = _normal.lengthSq();
      if (
        distanceSquared <= 0.001 ||
        distanceSquared >= minimumDistance * minimumDistance
      ) {
        continue;
      }
      const distance = Math.sqrt(distanceSquared);
      _normal.multiplyScalar(1 / distance);
      player.group.position
        .copy(obstacle.position)
        .addScaledVector(_normal, minimumDistance + 0.1);
      const result = player.collide(
        _normal,
        Math.min(2.5, player.speed / 55),
      );
      if (result?.applied) {
        this.effects.spawnImpact(player.group.position, 'orange', 1.4);
        this.cameraController.addShake(0.42);
        this.callbacks.onPlayerDamaged?.(
          result.shieldDamage + result.hullDamage,
          obstacle.position,
          result,
        );
      }
      break;
    }
  }
}
