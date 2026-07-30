import * as THREE from 'three';

const PICKUP_COLOR = 0xffa548;

export class PickupManager {
  constructor(scene) {
    this.scene = scene;
    this.pickups = new Map();
    this.coreGeometry = new THREE.OctahedronGeometry(1.45, 0);
    this.ringGeometry = new THREE.TorusGeometry(2.35, 0.11, 8, 32);
    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: PICKUP_COLOR,
      emissive: PICKUP_COLOR,
      emissiveIntensity: 3.2,
      metalness: 0.35,
      roughness: 0.25,
    });
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc36f,
      transparent: true,
      opacity: 0.82,
      toneMapped: false,
    });
  }

  #create(state) {
    const group = new THREE.Group();
    group.name = `MissilePickup-${state.id}`;
    const core = new THREE.Mesh(this.coreGeometry, this.coreMaterial);
    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    const crossRing = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    crossRing.rotation.x = Math.PI / 2;
    group.add(core, ring, crossRing);
    group.position.fromArray(state.position);
    group.userData.phase = Math.random() * Math.PI * 2;
    this.scene.add(group);
    const pickup = { id: state.id, type: state.type, group };
    this.pickups.set(state.id, pickup);
    return pickup;
  }

  sync(states = []) {
    const activeIds = new Set();
    for (const state of states) {
      activeIds.add(state.id);
      const pickup = this.pickups.get(state.id) ?? this.#create(state);
      pickup.group.position.fromArray(state.position);
    }
    for (const id of this.pickups.keys()) {
      if (!activeIds.has(id)) this.remove(id);
    }
  }

  update(deltaTime, elapsedTime) {
    for (const pickup of this.pickups.values()) {
      pickup.group.rotation.y += deltaTime * 1.35;
      pickup.group.rotation.z += deltaTime * 0.55;
      const pulse = 1 + Math.sin(elapsedTime * 3 + pickup.group.userData.phase) * 0.12;
      pickup.group.scale.setScalar(pulse);
    }
  }

  remove(id) {
    const pickup = this.pickups.get(id);
    if (!pickup) return;
    this.scene.remove(pickup.group);
    this.pickups.delete(id);
  }

  reset() {
    for (const id of [...this.pickups.keys()]) this.remove(id);
  }

  dispose() {
    this.reset();
    this.coreGeometry.dispose();
    this.ringGeometry.dispose();
    this.coreMaterial.dispose();
    this.ringMaterial.dispose();
  }
}

export default PickupManager;
