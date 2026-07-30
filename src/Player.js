import * as THREE from 'three';
import { GAME_CONFIG, PLAYER_CONFIG } from './config.js';
import { FORWARD, clamp, damp } from './utils/MathUtils.js';

const _forward = new THREE.Vector3();
const _acceleration = new THREE.Vector3();
const _inward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _mouse = { x: 0, y: 0 };
const _targetQuaternion = new THREE.Quaternion();
const _targetEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _localPoint = new THREE.Vector3();

export class Player {
  constructor(scene, assetManager) {
    this.scene = scene;
    this.assetManager = assetManager;
    this.group = new THREE.Group();
    this.group.name = 'Player';
    this.model = assetManager.createPlayerShip();
    this.group.add(this.model);
    this.scene.add(this.group);

    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = PLAYER_CONFIG.maxHealth;
    this.shield = PLAYER_CONFIG.maxShield;
    this.afterburner = PLAYER_CONFIG.boostCapacity;
    this.missiles = PLAYER_CONFIG.missileAmmo;
    this.fireTimer = 0;
    this.missileTimer = 0;
    this.rollTimer = 0;
    this.rollCooldown = 0;
    this.rollDirection = 1;
    this.visualBank = 0;
    this.timeSinceDamage = Infinity;
    this.collisionCooldown = 0;
    this.alive = true;
    this.boosting = false;
    this.radius =
      this.model.userData.collisionRadius ?? PLAYER_CONFIG.radius;
    this.turnInput = 0;
    this.throttleInput = 0;

    this.reset();
  }

  reset() {
    this.group.visible = true;
    this.group.position.set(0, 0, 80);
    this.group.quaternion.identity();
    this.model.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, -26);
    this.yaw = 0;
    this.pitch = 0;
    this.health = PLAYER_CONFIG.maxHealth;
    this.shield = PLAYER_CONFIG.maxShield;
    this.afterburner = PLAYER_CONFIG.boostCapacity;
    this.missiles = PLAYER_CONFIG.missileAmmo;
    this.fireTimer = 0;
    this.missileTimer = 0;
    this.rollTimer = 0;
    this.rollCooldown = 0;
    this.rollDirection = 1;
    this.visualBank = 0;
    this.timeSinceDamage = Infinity;
    this.collisionCooldown = 0;
    this.alive = true;
    this.boosting = false;
  }

  update(deltaTime, input) {
    if (!this.alive) return;

    this.fireTimer = Math.max(0, this.fireTimer - deltaTime);
    this.missileTimer = Math.max(0, this.missileTimer - deltaTime);
    this.rollCooldown = Math.max(0, this.rollCooldown - deltaTime);
    this.collisionCooldown = Math.max(0, this.collisionCooldown - deltaTime);
    this.timeSinceDamage += deltaTime;

    if (
      this.timeSinceDamage >= PLAYER_CONFIG.shieldRegenDelay &&
      this.shield < PLAYER_CONFIG.maxShield
    ) {
      this.shield = Math.min(
        PLAYER_CONFIG.maxShield,
        this.shield + PLAYER_CONFIG.shieldRegenRate * deltaTime,
      );
    }

    this.turnInput =
      Number(input.isDown('KeyD')) - Number(input.isDown('KeyA'));
    this.throttleInput =
      Number(input.isDown('KeyW')) - Number(input.isDown('KeyS'));

    input.consumeMouseDelta(_mouse);
    this.yaw -=
      this.turnInput * PLAYER_CONFIG.yawSpeed * deltaTime +
      _mouse.x * PLAYER_CONFIG.mouseSensitivity;
    this.pitch = clamp(
      this.pitch - _mouse.y * PLAYER_CONFIG.mouseSensitivity,
      -PLAYER_CONFIG.maxPitch,
      PLAYER_CONFIG.maxPitch,
    );

    _targetEuler.set(this.pitch, this.yaw, 0, 'YXZ');
    _targetQuaternion.setFromEuler(_targetEuler);
    this.group.quaternion.slerp(
      _targetQuaternion,
      1 - Math.exp(-10 * deltaTime),
    );

    if (input.consumePressed('KeyQ') && this.rollCooldown <= 0) {
      this.rollTimer = PLAYER_CONFIG.rollDuration;
      this.rollCooldown = PLAYER_CONFIG.rollCooldown;
      this.rollDirection =
        this.turnInput === 0 ? 1 : Math.sign(this.turnInput);
      _right
        .set(1, 0, 0)
        .applyQuaternion(this.group.quaternion)
        .normalize();
      this.velocity.addScaledVector(_right, this.rollDirection * 18);
    }

    const wantsBoost =
      (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) &&
      this.throttleInput > 0 &&
      this.afterburner > 0;
    this.boosting = wantsBoost;

    if (this.boosting) {
      this.afterburner = Math.max(
        0,
        this.afterburner - PLAYER_CONFIG.boostDrain * deltaTime,
      );
    } else {
      this.afterburner = Math.min(
        PLAYER_CONFIG.boostCapacity,
        this.afterburner + PLAYER_CONFIG.boostRegen * deltaTime,
      );
    }

    this.getForward(_forward);
    let thrust = 0;
    if (this.throttleInput > 0) {
      thrust = this.boosting
        ? PLAYER_CONFIG.boostAcceleration
        : PLAYER_CONFIG.acceleration;
    } else if (this.throttleInput < 0) {
      thrust = -PLAYER_CONFIG.reverseAcceleration;
    }

    _acceleration.copy(_forward).multiplyScalar(thrust);
    this.velocity.addScaledVector(_acceleration, deltaTime);
    this.velocity.multiplyScalar(Math.exp(-PLAYER_CONFIG.drag * deltaTime));

    const currentSpeed = this.velocity.length();
    const speedLimit = this.boosting
      ? PLAYER_CONFIG.boostSpeed
      : Math.max(
          PLAYER_CONFIG.normalSpeed,
          currentSpeed - PLAYER_CONFIG.acceleration * 0.72 * deltaTime,
        );
    if (currentSpeed > speedLimit) {
      this.velocity.setLength(speedLimit);
    }

    const distanceFromCenter = this.group.position.length();
    if (
      distanceFromCenter >
      GAME_CONFIG.arenaRadius - GAME_CONFIG.arenaWarningDistance
    ) {
      const boundaryFactor = clamp(
        (distanceFromCenter -
          (GAME_CONFIG.arenaRadius - GAME_CONFIG.arenaWarningDistance)) /
          GAME_CONFIG.arenaWarningDistance,
        0,
        1,
      );
      _inward
        .copy(this.group.position)
        .normalize()
        .multiplyScalar(-130 * boundaryFactor * deltaTime);
      this.velocity.add(_inward);
    }

    this.group.position.addScaledVector(this.velocity, deltaTime);
    if (this.group.position.length() > GAME_CONFIG.arenaRadius) {
      _inward.copy(this.group.position).normalize();
      this.group.position.copy(_inward).multiplyScalar(GAME_CONFIG.arenaRadius);
      const outwardSpeed = this.velocity.dot(_inward);
      if (outwardSpeed > 0) {
        this.velocity.addScaledVector(_inward, -outwardSpeed);
      }
    }

    this.#updateVisuals(deltaTime);
  }

  #updateVisuals(deltaTime) {
    this.visualBank = damp(
      this.visualBank,
      -this.turnInput * 0.55,
      8,
      deltaTime,
    );
    let roll = this.visualBank;
    if (this.rollTimer > 0) {
      this.rollTimer = Math.max(0, this.rollTimer - deltaTime);
      const progress =
        1 - this.rollTimer / Math.max(PLAYER_CONFIG.rollDuration, 0.001);
      roll += Math.PI * 2 * progress * this.rollDirection;
    }
    this.model.rotation.z = roll;
    this.model.rotation.x = damp(
      this.model.rotation.x,
      -this.throttleInput * 0.08,
      7,
      deltaTime,
    );

    const engineIntensity = this.boosting ? 5.2 : 2.2;
    const engineScale = this.boosting ? 1.75 : 1;
    const engineMaterials = this.model.userData.engineMaterials ?? [];
    for (const material of engineMaterials) {
      material.emissiveIntensity = damp(
        material.emissiveIntensity ?? 1,
        engineIntensity,
        9,
        deltaTime,
      );
    }
    const engineGlows = this.model.userData.engineGlows ?? [];
    for (const glow of engineGlows) {
      const baseScale = glow.userData.baseScale ?? 1;
      const target = baseScale * engineScale;
      const next = damp(glow.scale.x, target, 10, deltaTime);
      glow.scale.setScalar(next);
    }
  }

  getForward(out = new THREE.Vector3()) {
    return out.copy(FORWARD).applyQuaternion(this.group.quaternion).normalize();
  }

  getMuzzlePosition(side, out = new THREE.Vector3()) {
    this.group.updateMatrixWorld();
    _localPoint.set(side * 3.86, -0.05, -0.82);
    return out.copy(_localPoint).applyMatrix4(this.group.matrixWorld);
  }

  getMissilePosition(out = new THREE.Vector3()) {
    this.group.updateMatrixWorld();
    _localPoint.set(0, -0.62, 0.35);
    return out.copy(_localPoint).applyMatrix4(this.group.matrixWorld);
  }

  canFire() {
    return this.alive && this.fireTimer <= 0;
  }

  markFired() {
    this.fireTimer = PLAYER_CONFIG.fireCooldown;
  }

  canLaunchMissile() {
    return this.alive && this.missiles > 0 && this.missileTimer <= 0;
  }

  markMissileLaunched() {
    this.missiles = Math.max(0, this.missiles - 1);
    this.missileTimer = PLAYER_CONFIG.missileCooldown;
  }

  damage(amount) {
    if (!this.alive || this.rollTimer > PLAYER_CONFIG.rollDuration * 0.25) {
      return { applied: false, shieldDamage: 0, hullDamage: 0, dead: false };
    }

    this.timeSinceDamage = 0;
    let remaining = amount;
    const shieldDamage = Math.min(this.shield, remaining);
    this.shield -= shieldDamage;
    remaining -= shieldDamage;
    const hullDamage = Math.min(this.health, remaining);
    this.health -= hullDamage;

    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.group.visible = false;
    }

    return {
      applied: true,
      shieldDamage,
      hullDamage,
      dead: !this.alive,
    };
  }

  collide(normal, severity = 1) {
    if (!this.alive || this.collisionCooldown > 0) return null;
    const outwardVelocity = this.velocity.dot(normal);
    if (outwardVelocity < 0) {
      this.velocity.addScaledVector(normal, -1.65 * outwardVelocity);
    }
    this.velocity.multiplyScalar(0.62);
    this.collisionCooldown = 0.55;
    return this.damage(8 + severity * 7);
  }

  get speed() {
    return this.velocity.length();
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
