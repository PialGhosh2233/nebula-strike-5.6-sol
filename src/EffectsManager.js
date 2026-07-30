import * as THREE from 'three';
import { GAME_CONFIG, QUALITY_PRESETS } from './config.js';
import { ObjectPool } from './utils/ObjectPool.js';
import { randomRange } from './utils/MathUtils.js';

const EFFECT_COLORS = Object.freeze({
  cyan: 0x4efcff,
  blue: 0x3d7dff,
  red: 0xff315d,
  orange: 0xff8a38,
  purple: 0xb45cff,
  white: 0xffffff,
});

const _direction = new THREE.Vector3();
const _jitter = new THREE.Vector3();
const _identity = new THREE.Quaternion();

export class EffectsManager {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = QUALITY_PRESETS[quality] ? quality : 'high';
    this.activeCount = 0;
    this.nextIndex = 0;
    this.geometry = new THREE.IcosahedronGeometry(0.32, 0);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.instancedMesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      GAME_CONFIG.particlePoolSize,
    );
    this.instancedMesh.name = 'PooledParticleEffects';
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.instancedMesh);

    this._matrix = new THREE.Matrix4();
    this._scale = new THREE.Vector3();
    this._fadedColor = new THREE.Color();
    this.pool = new ObjectPool(
      () => this.#createParticle(),
      (particle) => this.#resetParticle(particle),
      GAME_CONFIG.particlePoolSize,
    );

    for (const particle of this.pool.all) {
      this.instancedMesh.setColorAt(particle.index, particle.color);
      this.#writeParticle(particle, 0);
    }
    this.instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.instanceColor.needsUpdate = true;
  }

  #createParticle() {
    return {
      index: this.nextIndex++,
      active: false,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      color: new THREE.Color(0xffffff),
      life: 0,
      maxLife: 1,
      drag: 1,
      startScale: 1,
      endScale: 0,
    };
  }

  #resetParticle(particle) {
    if (particle.active) {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
    particle.active = false;
    particle.velocity.set(0, 0, 0);
    this.#writeParticle(particle, 0);
  }

  #writeParticle(particle, scale, brightness = 1) {
    this._scale.setScalar(Math.max(0, scale));
    this._matrix.compose(particle.position, _identity, this._scale);
    this.instancedMesh.setMatrixAt(particle.index, this._matrix);
    this._fadedColor
      .copy(particle.color)
      .multiplyScalar(Math.max(0.04, brightness));
    this.instancedMesh.setColorAt(particle.index, this._fadedColor);
  }

  #spawnParticle(
    position,
    velocity,
    color,
    scale,
    life,
    drag = 1.8,
    endScale = 0,
  ) {
    if (this.activeCount >= GAME_CONFIG.particlePoolSize) return null;
    const particle = this.pool.acquire();
    particle.active = true;
    particle.position.copy(position);
    particle.velocity.copy(velocity);
    particle.color.set(color);
    particle.life = life;
    particle.maxLife = life;
    particle.drag = drag;
    particle.startScale = scale;
    particle.endScale = endScale;
    this.activeCount += 1;
    this.#writeParticle(particle, scale);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.instanceColor.needsUpdate = true;
    return particle;
  }

  spawnImpact(position, color = 'cyan', intensity = 1) {
    const count = this.#scaledCount(Math.round(7 + intensity * 5));
    for (let index = 0; index < count; index += 1) {
      _direction
        .set(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
        )
        .normalize()
        .multiplyScalar(randomRange(12, 34) * intensity);
      this.#spawnParticle(
        position,
        _direction,
        EFFECT_COLORS[color] ?? EFFECT_COLORS.cyan,
        randomRange(0.18, 0.52) * intensity,
        randomRange(0.24, 0.55),
      );
    }
  }

  spawnExplosion(position, color = 'orange', intensity = 1) {
    const count = this.#scaledCount(Math.round(22 + intensity * 18));
    for (let index = 0; index < count; index += 1) {
      _direction
        .set(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
        )
        .normalize()
        .multiplyScalar(randomRange(15, 62) * Math.sqrt(intensity));
      const selectedColor =
        index % 4 === 0 ? EFFECT_COLORS.white : EFFECT_COLORS[color];
      this.#spawnParticle(
        position,
        _direction,
        selectedColor ?? EFFECT_COLORS.orange,
        randomRange(0.45, 1.5) * Math.sqrt(intensity),
        randomRange(0.55, 1.25),
        1.35,
      );
    }
    this.#spawnParticle(
      position,
      _direction.set(0, 0, 0),
      EFFECT_COLORS.white,
      2.2 * intensity,
      0.22,
      0,
      5.5 * intensity,
    );
  }

  spawnTrail(position, color = 'orange', scale = 0.35) {
    if (
      Math.random() >
      QUALITY_PRESETS[this.quality].particleScale
    ) {
      return;
    }
    _direction.set(
      randomRange(-1.2, 1.2),
      randomRange(-1.2, 1.2),
      randomRange(-1.2, 1.2),
    );
    this.#spawnParticle(
      position,
      _direction,
      EFFECT_COLORS[color] ?? EFFECT_COLORS.orange,
      scale,
      randomRange(0.28, 0.48),
      2.7,
    );
  }

  spawnEngine(position, velocity, boosting = false) {
    if (
      Math.random() >
      QUALITY_PRESETS[this.quality].particleScale
    ) {
      return;
    }
    _direction
      .copy(velocity)
      .multiplyScalar(-0.05)
      .add(
        _jitter.set(
          randomRange(-1.3, 1.3),
          randomRange(-1.3, 1.3),
          randomRange(-1.3, 1.3),
        ),
      );
    this.#spawnParticle(
      position,
      _direction,
      boosting ? EFFECT_COLORS.purple : EFFECT_COLORS.blue,
      boosting ? 0.48 : 0.28,
      boosting ? 0.48 : 0.32,
      3.2,
    );
  }

  update(deltaTime) {
    let matrixChanged = false;
    let colorChanged = false;
    for (const particle of this.pool.all) {
      if (!particle.active) continue;
      particle.life -= deltaTime;
      if (particle.life <= 0) {
        this.pool.release(particle);
        matrixChanged = true;
        continue;
      }
      particle.position.addScaledVector(particle.velocity, deltaTime);
      particle.velocity.multiplyScalar(Math.exp(-particle.drag * deltaTime));
      const ratio = particle.life / particle.maxLife;
      const scale =
        particle.endScale +
        (particle.startScale - particle.endScale) * ratio;
      this.#writeParticle(particle, scale, Math.min(1, ratio * 1.8));
      matrixChanged = true;
      colorChanged = true;
    }
    if (matrixChanged) this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (colorChanged) this.instancedMesh.instanceColor.needsUpdate = true;
  }

  setQuality(quality) {
    this.quality = QUALITY_PRESETS[quality] ? quality : 'high';
  }

  #scaledCount(count) {
    return Math.max(
      1,
      Math.round(count * QUALITY_PRESETS[this.quality].particleScale),
    );
  }

  reset() {
    this.pool.releaseAll();
    this.activeCount = 0;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.instancedMesh);
    this.geometry.dispose();
    this.material.dispose();
    this.pool.all.length = 0;
    this.pool.available.length = 0;
  }
}
