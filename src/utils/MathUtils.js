import * as THREE from 'three';

export const FORWARD = Object.freeze(new THREE.Vector3(0, 0, -1));
export const UP = Object.freeze(new THREE.Vector3(0, 1, 0));

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function damp(current, target, smoothing, deltaTime) {
  return THREE.MathUtils.lerp(
    current,
    target,
    1 - Math.exp(-smoothing * deltaTime),
  );
}

export function dampVector(vector, target, smoothing, deltaTime) {
  vector.lerp(target, 1 - Math.exp(-smoothing * deltaTime));
  return vector;
}

export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

export function randomPointOnShell(out, minRadius, maxRadius) {
  out
    .set(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    )
    .normalize()
    .multiplyScalar(randomRange(minRadius, maxRadius));
  return out;
}

export function segmentSphereIntersects(start, end, center, radius) {
  const sx = start.x - center.x;
  const sy = start.y - center.y;
  const sz = start.z - center.z;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;

  if (lengthSquared <= Number.EPSILON) {
    return sx * sx + sy * sy + sz * sz <= radius * radius;
  }

  const t = clamp(-(sx * dx + sy * dy + sz * dz) / lengthSquared, 0, 1);
  const cx = sx + dx * t;
  const cy = sy + dy * t;
  const cz = sz + dz * t;
  return cx * cx + cy * cy + cz * cz <= radius * radius;
}

export function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function safeGetStorage(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function safeSetStorage(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage can be disabled in privacy contexts; gameplay remains available.
  }
}

export function disposeObject3D(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => {
        material.map?.dispose?.();
        material.dispose?.();
      });
    } else if (object.material) {
      object.material.map?.dispose?.();
      object.material.dispose?.();
    }
  });
}
