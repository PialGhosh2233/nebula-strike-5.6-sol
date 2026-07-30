import * as THREE from 'three';
import { damp } from './utils/MathUtils.js';

const PLAYER_COLORS = Object.freeze({
  cyan: 0x58f5ff,
  purple: 0xc56bff,
  orange: 0xffa14f,
  blue: 0x5b91ff,
});

function createNameTag(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(2, 8, 18, 0.78)';
  context.fillRect(8, 8, 240, 48);
  context.strokeStyle = `#${new THREE.Color(color).getHexString()}`;
  context.lineWidth = 2;
  context.strokeRect(8, 8, 240, 48);
  context.fillStyle = '#eafcff';
  context.font = '600 22px monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(name).slice(0, 16).toUpperCase(), 128, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(10.5, 2.65, 1);
  sprite.position.set(0, 4.8, 0);
  return { sprite, texture, material };
}

export class RemotePlayerManager {
  constructor(scene, assetManager) {
    this.scene = scene;
    this.assetManager = assetManager;
    this.players = new Map();
  }

  #create(state) {
    const group = new THREE.Group();
    group.name = `RemotePlayer-${state.id}`;
    const model = this.assetManager.createPlayerShip();
    const color = PLAYER_COLORS[state.color] ?? PLAYER_COLORS.cyan;
    const materials = model.userData.hullMaterials ?? [];
    materials[2]?.color?.setHex?.(color);
    materials[2]?.emissive?.setHex?.(color);
    materials[3]?.color?.setHex?.(color);
    for (const material of model.userData.engineMaterials ?? []) {
      material.color?.setHex?.(color);
      material.emissive?.setHex?.(color);
    }
    const nameTag = createNameTag(state.name, color);
    group.add(model, nameTag.sprite);
    group.position.fromArray(state.position);
    group.quaternion.fromArray(state.quaternion);
    this.scene.add(group);
    const remote = {
      id: state.id,
      networkId: state.id,
      name: state.name,
      config: { label: state.name },
      group,
      model,
      nameTag,
      targetPosition: new THREE.Vector3().fromArray(state.position),
      targetQuaternion: new THREE.Quaternion().fromArray(state.quaternion),
      velocity: new THREE.Vector3().fromArray(state.velocity),
      boosting: Boolean(state.boosting),
      alive: state.alive !== false,
      health: state.health,
      shield: state.shield,
    };
    this.players.set(state.id, remote);
    return remote;
  }

  sync(states, localPlayerId) {
    const activeIds = new Set();
    for (const state of states ?? []) {
      if (state.id === localPlayerId) continue;
      activeIds.add(state.id);
      const remote = this.players.get(state.id) ?? this.#create(state);
      remote.name = state.name;
      remote.config.label = state.name;
      remote.targetPosition.fromArray(state.position);
      remote.targetQuaternion.fromArray(state.quaternion);
      remote.velocity.fromArray(state.velocity);
      remote.boosting = Boolean(state.boosting);
      remote.alive = state.alive !== false;
      remote.health = state.health;
      remote.shield = state.shield;
      remote.group.visible = remote.alive;
    }
    for (const [id] of this.players) {
      if (!activeIds.has(id)) this.remove(id);
    }
  }

  update(deltaTime) {
    const positionBlend = 1 - Math.exp(-11 * deltaTime);
    const rotationBlend = 1 - Math.exp(-13 * deltaTime);
    for (const remote of this.players.values()) {
      if (!remote.alive) continue;
      remote.group.position.lerp(remote.targetPosition, positionBlend);
      remote.group.quaternion.slerp(
        remote.targetQuaternion,
        rotationBlend,
      );
      const engineIntensity = remote.boosting ? 5.2 : 2.2;
      const engineScale = remote.boosting ? 1.75 : 1;
      for (const material of remote.model.userData.engineMaterials ?? []) {
        material.emissiveIntensity = damp(
          material.emissiveIntensity ?? 1,
          engineIntensity,
          9,
          deltaTime,
        );
      }
      for (const glow of remote.model.userData.engineGlows ?? []) {
        const base = glow.userData.baseScale ?? 1;
        const scale = damp(glow.scale.x, base * engineScale, 10, deltaTime);
        glow.scale.setScalar(scale);
      }
    }
  }

  remove(id) {
    const remote = this.players.get(id);
    if (!remote) return;
    this.scene.remove(remote.group);
    remote.nameTag.texture.dispose();
    remote.nameTag.material.dispose();
    this.players.delete(id);
  }

  reset() {
    for (const id of [...this.players.keys()]) this.remove(id);
  }

  dispose() {
    this.reset();
  }
}

export default RemotePlayerManager;
