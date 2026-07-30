import * as THREE from 'three';
import { ENEMY_TYPES, GAME_CONFIG, WEAPON_CONFIG } from './config.js';
import { FORWARD, clamp, damp, randomRange } from './utils/MathUtils.js';

const _toPlayer = new THREE.Vector3();
const _desiredDirection = new THREE.Vector3();
const _steering = new THREE.Vector3();
const _avoidance = new THREE.Vector3();
const _separation = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _aimDirection = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _worldPoint = new THREE.Vector3();
const _targetQuaternion = new THREE.Quaternion();
const _shotDirection = new THREE.Vector3();
const _shotQuaternion = new THREE.Quaternion();
const _worldUp = new THREE.Vector3(0, 1, 0);

export class Enemy {
  constructor(scene, assetManager, type = 'fighter') {
    this.scene = scene;
    this.type = type;
    this.config = ENEMY_TYPES[type] ?? ENEMY_TYPES.fighter;
    this.group = new THREE.Group();
    this.model = assetManager.createEnemyShip(type);
    this.group.add(this.model);
    this.scene.add(this.group);
    this.velocity = new THREE.Vector3();
    this.active = false;
    this.alive = false;
    this.targeted = false;
    this.seed = Math.random() * 1000;
    this.time = 0;
    this.state = 'patrol';
    this.health = this.config.health;
    this.maxHealth = this.config.health;
    this.damageAmount = this.config.damage;
    this.speedMultiplier = 1;
    this.fireTimer = Math.random();
    this.retreatTimer = 0;
    this.retreatCooldown = 0;
    this.hitFlashTimer = 0;
    this.patternCounter = 0;
    this.radius =
      this.model.userData.collisionRadius ?? this.config.radius;
    this.isBoss = type === 'boss';
    this.scoreValue = this.config.score;
    this._materialState = new Map();

    for (const material of this.model.userData.hullMaterials ?? []) {
      this._materialState.set(material, {
        intensity: material.emissiveIntensity ?? 0,
        emissive: material.emissive?.clone?.() ?? null,
      });
    }

    this.#createIndicators();
    this.deactivate();
  }

  #createIndicators() {
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffdf63,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.targetRing = new THREE.Mesh(
      new THREE.TorusGeometry(this.radius * 1.35, 0.075, 6, 36),
      ringMaterial,
    );
    this.targetRing.visible = false;
    this.targetRing.position.z = 0.25;
    this.group.add(this.targetRing);

    this.healthBar = new THREE.Group();
    const width = this.isBoss ? 0 : Math.max(4.5, this.radius * 1.65);
    if (!this.isBoss) {
      const background = new THREE.Mesh(
        new THREE.PlaneGeometry(width + 0.35, 0.6),
        new THREE.MeshBasicMaterial({
          color: 0x07111d,
          transparent: true,
          opacity: 0.86,
          depthTest: false,
          depthWrite: false,
        }),
      );
      this.healthFill = new THREE.Mesh(
        new THREE.PlaneGeometry(width, 0.3),
        new THREE.MeshBasicMaterial({
          color: this.type === 'heavy' ? 0xff9a4a : 0xff4f78,
          transparent: true,
          opacity: 0.92,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      this.healthFill.position.z = 0.01;
      this.healthFill.userData.width = width;
      this.healthBar.add(background, this.healthFill);
      this.scene.add(this.healthBar);
    }
    this.healthBar.visible = false;
  }

  reset(position, difficulty = {}) {
    const healthScale = difficulty.health ?? 1;
    this.maxHealth = Math.round(this.config.health * healthScale);
    this.health = this.maxHealth;
    this.damageAmount = this.config.damage * (difficulty.damage ?? 1);
    this.speedMultiplier = difficulty.speed ?? 1;
    this.scoreValue = Math.round(
      this.config.score * (difficulty.score ?? 1),
    );
    this.group.position.copy(position);
    this.group.quaternion.identity();
    this.model.rotation.set(0, 0, 0);
    this.velocity
      .set(
        randomRange(-1, 1),
        randomRange(-0.45, 0.45),
        randomRange(-1, 1),
      )
      .normalize()
      .multiplyScalar(this.config.speed * 0.35);
    this.active = true;
    this.alive = true;
    this.group.visible = true;
    this.healthBar.visible = !this.isBoss;
    this.targeted = false;
    this.targetRing.visible = false;
    this.time = 0;
    this.state = 'patrol';
    this.fireTimer = randomRange(0.35, this.config.fireCooldown + 0.7);
    this.retreatTimer = 0;
    this.retreatCooldown = 0;
    this.hitFlashTimer = 0;
    this.patternCounter = 0;
    this.seed = Math.random() * 1000;
    this.#updateHealthIndicator();
    this.#restoreMaterials();
  }

  update(deltaTime, context) {
    if (!this.active || !this.alive) return;
    this.time += deltaTime;
    this.fireTimer -= deltaTime;
    this.retreatCooldown = Math.max(0, this.retreatCooldown - deltaTime);

    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= deltaTime;
      if (this.hitFlashTimer <= 0) this.#restoreMaterials();
    }

    const player = context.player;
    _toPlayer.copy(player.group.position).sub(this.group.position);
    const distance = _toPlayer.length();
    if (distance > 0.001) _toPlayer.multiplyScalar(1 / distance);

    const healthRatio = this.health / this.maxHealth;
    if (
      !this.isBoss &&
      healthRatio < this.config.retreatThreshold &&
      this.state !== 'retreat' &&
      this.retreatCooldown <= 0
    ) {
      this.state = 'retreat';
      this.retreatTimer = randomRange(2.1, 3.5);
    }

    if (this.state === 'retreat') {
      this.retreatTimer -= deltaTime;
      if (this.retreatTimer <= 0) {
        this.state = 'chase';
        this.retreatCooldown = 8;
      }
    } else if (distance > this.config.attackRange * 0.92) {
      this.state = 'chase';
    } else {
      this.state = 'attack';
    }

    this.#computeSteering(context, distance);
    this.#move(deltaTime);
    this.#tryFire(context, distance);
    this.#updateVisuals(deltaTime, context.camera);
  }

  #computeSteering(context, distance) {
    _desiredDirection.set(0, 0, 0);
    if (this.state === 'retreat') {
      _desiredDirection.copy(_toPlayer).multiplyScalar(-1);
    } else if (this.state === 'chase') {
      _desiredDirection.copy(_toPlayer);
    } else {
      const distanceError =
        (distance - this.config.preferredDistance) /
        Math.max(1, this.config.preferredDistance);
      _desiredDirection
        .copy(_toPlayer)
        .multiplyScalar(clamp(distanceError, -1, 1));
      _offset
        .crossVectors(_toPlayer, _worldUp)
        .normalize()
        .multiplyScalar(Math.sin(this.seed) > 0 ? 0.9 : -0.9);
      _desiredDirection.add(_offset);
    }

    const evadeStrength =
      this.config.evade *
      (this.isBoss ? 0.45 + this.phase * 0.18 : 1);
    _desiredDirection.x +=
      Math.sin(this.time * (1.8 + evadeStrength) + this.seed) *
      0.34 *
      evadeStrength;
    _desiredDirection.y +=
      Math.cos(this.time * (1.35 + evadeStrength) + this.seed * 0.71) *
      0.28 *
      evadeStrength;

    _avoidance.set(0, 0, 0);
    for (const obstacle of context.obstacles) {
      _offset.copy(this.group.position).sub(obstacle.position);
      const safeDistance = obstacle.radius + this.radius + 42;
      const distanceSquared = _offset.lengthSq();
      if (
        distanceSquared > 0.001 &&
        distanceSquared < safeDistance * safeDistance
      ) {
        const distanceToObstacle = Math.sqrt(distanceSquared);
        _avoidance.addScaledVector(
          _offset,
          ((safeDistance - distanceToObstacle) / safeDistance) *
            (2.8 / distanceToObstacle),
        );
      }
    }

    _separation.set(0, 0, 0);
    for (const other of context.enemies) {
      if (other === this || !other.active) continue;
      _offset.copy(this.group.position).sub(other.group.position);
      const minimumDistance = this.radius + other.radius + 16;
      const distanceSquared = _offset.lengthSq();
      if (
        distanceSquared > 0.01 &&
        distanceSquared < minimumDistance * minimumDistance
      ) {
        _separation.addScaledVector(
          _offset,
          1.2 / Math.max(distanceSquared, 1),
        );
      }
    }

    _steering
      .copy(_desiredDirection)
      .addScaledVector(_avoidance, 2.7)
      .addScaledVector(_separation, 2.2);

    const distanceFromCenter = this.group.position.length();
    if (distanceFromCenter > GAME_CONFIG.arenaRadius - 95) {
      _steering.addScaledVector(
        _offset.copy(this.group.position).normalize(),
        -3.5,
      );
    }
    if (_steering.lengthSq() < 0.001) _steering.copy(_toPlayer);
    _steering.normalize();
  }

  #move(deltaTime) {
    const stateSpeed =
      this.state === 'retreat'
        ? 1.12
        : this.state === 'attack'
          ? 0.82
          : 1;
    const phaseSpeed = this.isBoss ? 1 + (this.phase - 1) * 0.12 : 1;
    const desiredSpeed =
      this.config.speed *
      this.speedMultiplier *
      stateSpeed *
      phaseSpeed;
    _desiredDirection.copy(_steering).multiplyScalar(desiredSpeed);
    this.velocity.lerp(
      _desiredDirection,
      1 -
        Math.exp(
          -(this.config.acceleration / Math.max(1, this.config.speed)) *
            deltaTime,
        ),
    );
    this.group.position.addScaledVector(this.velocity, deltaTime);

    if (this.group.position.length() > GAME_CONFIG.arenaRadius - this.radius) {
      this.group.position
        .normalize()
        .multiplyScalar(GAME_CONFIG.arenaRadius - this.radius);
    }

    if (this.velocity.lengthSq() > 0.01) {
      _forward.copy(this.velocity).normalize();
      _targetQuaternion.setFromUnitVectors(FORWARD, _forward);
      this.group.quaternion.slerp(
        _targetQuaternion,
        1 - Math.exp(-this.config.turnRate * deltaTime),
      );
    }
  }

  #tryFire(context, distance) {
    if (
      !context.player.alive ||
      this.fireTimer > 0 ||
      distance > this.config.attackRange
    ) {
      return;
    }

    const predictionTime =
      (distance / WEAPON_CONFIG.enemyLaser.speed) *
      (this.isBoss ? 0.86 : 0.68);
    _aimPoint
      .copy(context.player.group.position)
      .addScaledVector(context.player.velocity, predictionTime);
    _aimDirection.copy(_aimPoint).sub(this.group.position).normalize();
    _forward.copy(FORWARD).applyQuaternion(this.group.quaternion);
    if (_forward.dot(_aimDirection) < (this.isBoss ? 0.76 : 0.88)) return;

    this.fireTimer =
      this.config.fireCooldown *
      randomRange(0.82, 1.18) *
      (this.isBoss ? 1 - (this.phase - 1) * 0.13 : 1);
    this.patternCounter += 1;
    this.group.updateMatrixWorld();
    _worldPoint.set(0, 0, -this.radius * 0.72);
    _muzzle.copy(_worldPoint).applyMatrix4(this.group.matrixWorld);

    if (!this.isBoss || this.phase === 1) {
      context.projectileManager.spawnEnemy(
        _muzzle,
        _aimDirection,
        this.damageAmount,
        this,
      );
    } else if (this.phase === 2) {
      for (const angle of [-0.105, 0, 0.105]) {
        _shotQuaternion.setFromAxisAngle(_worldUp, angle);
        _shotDirection.copy(_aimDirection).applyQuaternion(_shotQuaternion);
        context.projectileManager.spawnEnemy(
          _muzzle,
          _shotDirection,
          this.damageAmount * 0.82,
          this,
        );
      }
    } else if (this.patternCounter % 3 === 0) {
      for (let index = 0; index < 10; index += 1) {
        const angle = (index / 10) * Math.PI * 2;
        _shotDirection.set(Math.cos(angle), Math.sin(angle) * 0.38, Math.sin(angle));
        _shotDirection.normalize();
        context.projectileManager.spawnEnemy(
          _muzzle,
          _shotDirection,
          this.damageAmount * 0.7,
          this,
        );
      }
    } else {
      for (const angle of [-0.16, -0.08, 0, 0.08, 0.16]) {
        _shotQuaternion.setFromAxisAngle(_worldUp, angle);
        _shotDirection.copy(_aimDirection).applyQuaternion(_shotQuaternion);
        context.projectileManager.spawnEnemy(
          _muzzle,
          _shotDirection,
          this.damageAmount * 0.72,
          this,
        );
      }
    }
    context.onEnemyFire?.(this);
  }

  #updateVisuals(deltaTime, camera) {
    const targetBank =
      Math.sin(this.time * (1.1 + this.config.evade) + this.seed) *
      0.24 *
      this.config.evade;
    this.model.rotation.z = damp(
      this.model.rotation.z,
      targetBank,
      4,
      deltaTime,
    );

    const pulse = 1 + Math.sin(this.time * 9 + this.seed) * 0.08;
    for (const glow of this.model.userData.engineGlows ?? []) {
      const base = glow.userData.baseScale ?? 1;
      glow.scale.setScalar(base * pulse);
    }

    this.targetRing.visible = this.targeted;
    if (this.targeted) {
      const ringScale = 1 + Math.sin(this.time * 7) * 0.06;
      this.targetRing.scale.setScalar(ringScale);
      this.targetRing.rotation.z += deltaTime * 1.4;
    }

    if (!this.isBoss && camera) {
      this.healthBar.position
        .copy(this.group.position)
        .add(_offset.set(0, this.radius + 3.4, 0));
      this.healthBar.quaternion.copy(camera.quaternion);
    }
  }

  #updateHealthIndicator() {
    if (this.isBoss || !this.healthFill) return;
    const ratio = clamp(this.health / this.maxHealth, 0, 1);
    this.healthFill.scale.x = Math.max(0.001, ratio);
    const width = this.healthFill.userData.width;
    this.healthFill.position.x = -((1 - ratio) * width) / 2;
    this.healthFill.material.color.setHSL(ratio * 0.32, 0.85, 0.58);
  }

  setTargeted(targeted) {
    this.targeted = Boolean(targeted) && this.active;
    this.targetRing.visible = this.targeted;
  }

  damage(amount) {
    if (!this.alive) return { applied: false, dead: true };
    this.health = Math.max(0, this.health - amount);
    this.hitFlashTimer = 0.09;
    for (const material of this.model.userData.hullMaterials ?? []) {
      material.emissive?.set?.(0xffffff);
      material.emissiveIntensity = 2.4;
    }
    this.#updateHealthIndicator();
    if (this.health <= 0) {
      this.alive = false;
      return { applied: true, dead: true };
    }
    return { applied: true, dead: false };
  }

  #restoreMaterials() {
    for (const [material, state] of this._materialState) {
      material.emissiveIntensity = state.intensity;
      if (state.emissive) material.emissive.copy(state.emissive);
    }
  }

  deactivate() {
    this.active = false;
    this.alive = false;
    this.targeted = false;
    this.group.visible = false;
    this.healthBar.visible = false;
    this.targetRing.visible = false;
  }

  get phase() {
    if (!this.isBoss) return 1;
    const ratio = this.health / Math.max(1, this.maxHealth);
    return ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.healthBar);
    this.targetRing.geometry.dispose();
    this.targetRing.material.dispose();
    for (const child of this.healthBar.children) {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
  }
}
