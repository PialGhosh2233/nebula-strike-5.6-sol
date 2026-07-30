import * as THREE from 'three';
import { damp } from './utils/MathUtils.js';

const _forward = new THREE.Vector3();
const _desiredPosition = new THREE.Vector3();
const _desiredTarget = new THREE.Vector3();
const _cameraOffset = new THREE.Vector3(0, 6.5, 16.5);
const _lookOffset = new THREE.Vector3(0, 1.4, -38);

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.lookTarget = new THREE.Vector3();
    this.trauma = 0;
    this.baseFov = 68;
    this.camera.fov = this.baseFov;
  }

  reset(player) {
    _desiredPosition
      .copy(_cameraOffset)
      .applyQuaternion(player.group.quaternion)
      .add(player.group.position);
    this.camera.position.copy(_desiredPosition);
    this.lookTarget
      .copy(_lookOffset)
      .applyQuaternion(player.group.quaternion)
      .add(player.group.position);
    this.camera.lookAt(this.lookTarget);
    this.trauma = 0;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  update(deltaTime, player) {
    player.getForward(_forward);
    _desiredPosition
      .copy(_cameraOffset)
      .applyQuaternion(player.group.quaternion)
      .add(player.group.position)
      .addScaledVector(player.velocity, -0.012);
    _desiredTarget
      .copy(player.group.position)
      .addScaledVector(_forward, 42)
      .addScaledVector(player.velocity, 0.045);

    this.camera.position.lerp(
      _desiredPosition,
      1 - Math.exp(-14 * deltaTime),
    );
    this.lookTarget.lerp(
      _desiredTarget,
      1 - Math.exp(-12 * deltaTime),
    );

    if (this.trauma > 0.001) {
      const shake = this.trauma * this.trauma;
      this.camera.position.x += (Math.random() * 2 - 1) * shake * 1.3;
      this.camera.position.y += (Math.random() * 2 - 1) * shake * 1.1;
      this.camera.position.z += (Math.random() * 2 - 1) * shake * 0.7;
      this.trauma = Math.max(0, this.trauma - 1.7 * deltaTime);
    }

    this.camera.lookAt(this.lookTarget);
    const targetFov = player.boosting ? 75 : this.baseFov;
    const nextFov = damp(this.camera.fov, targetFov, 6, deltaTime);
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  addShake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
}
