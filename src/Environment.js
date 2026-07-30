import * as THREE from 'three';
import { QUALITY_PRESETS } from './config.js';

const NEBULA_COLORS = [
  0x185d9b,
  0x65227d,
  0x166a7d,
  0x922f68,
  0x30499c,
  0x6f255f,
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function colorToRgb(color) {
  const value = new THREE.Color(color);
  return {
    r: Math.round(value.r * 255),
    g: Math.round(value.g * 255),
    b: Math.round(value.b * 255),
  };
}

/**
 * A deterministic procedural space arena.
 *
 * Obstacles are intentionally kept in world space and never drift, so callers can
 * safely use `environment.obstacles` directly for sphere collision tests.
 */
export class Environment {
  constructor(scene, { quality = 'high', arenaRadius = 700 } = {}) {
    if (!scene?.isScene) {
      throw new TypeError('Environment requires a THREE.Scene instance.');
    }

    this.scene = scene;
    this.arenaRadius = Math.max(120, Number(arenaRadius) || 700);
    this.obstacles = [];
    this.quality = null;
    this.time = 0;
    this.disposed = false;

    this.root = new THREE.Group();
    this.root.name = 'SpaceEnvironment';
    this.scene.add(this.root);

    this.skyGroup = new THREE.Group();
    this.skyGroup.name = 'DistantSky';
    this.celestialGroup = new THREE.Group();
    this.celestialGroup.name = 'DistantCelestials';
    this.asteroidGroup = new THREE.Group();
    this.asteroidGroup.name = 'AsteroidField';
    this.debrisGroup = new THREE.Group();
    this.debrisGroup.name = 'FloatingDebris';
    this.boundaryGroup = new THREE.Group();
    this.boundaryGroup.name = 'ArenaBoundary';
    this.root.add(
      this.skyGroup,
      this.celestialGroup,
      this.asteroidGroup,
      this.debrisGroup,
      this.boundaryGroup,
    );

    this._ownedGeometries = new Set();
    this._ownedMaterials = new Set();
    this._ownedTextures = new Set();
    this._allObstacles = [];
    this._nebulaSprites = [];
    this._celestials = [];
    this._lights = [];
    this._parallaxTarget = new THREE.Vector3();
    this._random = seededRandom(0x5a17c0de);

    this._previousBackground = this.scene.background;
    this._backgroundColor = new THREE.Color(0x01030b);
    if (this.scene.background == null) this.scene.background = this._backgroundColor;

    this._createLighting();
    this._createStarfield();
    this._createNebulae();
    this._createCelestials();
    this._createAsteroids();
    this._createDebris();
    this._createBoundary();
    this.setQuality(quality);
    this.reset();
  }

  _trackGeometry(geometry) {
    this._ownedGeometries.add(geometry);
    return geometry;
  }

  _trackMaterial(material) {
    this._ownedMaterials.add(material);
    return material;
  }

  _trackTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    this._ownedTextures.add(texture);
    return texture;
  }

  _randomDirection(target = new THREE.Vector3()) {
    const z = this._random() * 2 - 1;
    const angle = this._random() * Math.PI * 2;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    return target.set(
      Math.cos(angle) * radial,
      z,
      Math.sin(angle) * radial,
    );
  }

  _createLighting() {
    const hemisphere = new THREE.HemisphereLight(0x4f7fbd, 0x160b22, 0.72);
    hemisphere.name = 'SpaceFillLight';

    const key = new THREE.DirectionalLight(0xa7d8ff, 2.15);
    key.name = 'BlueStarKeyLight';
    key.position.set(-160, 110, -190);

    const magentaRim = new THREE.PointLight(
      0xd452ff,
      130,
      this.arenaRadius * 1.8,
      1.75,
    );
    magentaRim.name = 'NebulaRimLight';
    magentaRim.position.set(
      this.arenaRadius * 0.58,
      -this.arenaRadius * 0.23,
      this.arenaRadius * 0.32,
    );

    const cyanRim = new THREE.PointLight(
      0x38d9ff,
      105,
      this.arenaRadius * 1.55,
      1.8,
    );
    cyanRim.name = 'CyanRimLight';
    cyanRim.position.set(
      -this.arenaRadius * 0.52,
      this.arenaRadius * 0.28,
      -this.arenaRadius * 0.18,
    );

    this.root.add(hemisphere, key, magentaRim, cyanRim);
    this._lights.push(hemisphere, key, magentaRim, cyanRim);
    this._magentaRim = magentaRim;
    this._cyanRim = cyanRim;
  }

  _createStarfield() {
    const count = QUALITY_PRESETS.high.stars;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const direction = new THREE.Vector3();
    const color = new THREE.Color();
    const palettes = [0x8fcaff, 0xffffff, 0xa0f3ff, 0xd8b4ff, 0xffd2bb];
    const innerRadius = this.arenaRadius * 1.12;
    const radiusRange = this.arenaRadius * 2.75;

    for (let i = 0; i < count; i += 1) {
      this._randomDirection(direction);
      const radius = innerRadius + Math.pow(this._random(), 0.55) * radiusRange;
      const positionOffset = i * 3;
      positions[positionOffset] = direction.x * radius;
      positions[positionOffset + 1] = direction.y * radius;
      positions[positionOffset + 2] = direction.z * radius;

      color.set(palettes[Math.floor(this._random() * palettes.length)]);
      const brightness = 0.58 + this._random() * 0.42;
      colors[positionOffset] = color.r * brightness;
      colors[positionOffset + 1] = color.g * brightness;
      colors[positionOffset + 2] = color.b * brightness;
    }

    const geometry = this._trackGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const material = this._trackMaterial(new THREE.PointsMaterial({
      size: 2.1,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
      vertexColors: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }));
    this.starfield = new THREE.Points(geometry, material);
    this.starfield.name = 'ProceduralStarfield';
    this.starfield.frustumCulled = false;
    this.skyGroup.add(this.starfield);
  }

  _makeNebulaTexture(hexColor, seed) {
    const random = seededRandom(seed);
    const { r, g, b } = colorToRgb(hexColor);

    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext('2d');
      if (context) {
        context.clearRect(0, 0, 256, 256);
        context.globalCompositeOperation = 'lighter';

        for (let i = 0; i < 34; i += 1) {
          const x = 40 + random() * 176;
          const y = 40 + random() * 176;
          const radius = 22 + random() * 72;
          const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
          const alpha = 0.025 + random() * 0.075;
          gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
          gradient.addColorStop(0.42, `rgba(${r},${g},${b},${alpha * 0.45})`);
          gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
          context.fillStyle = gradient;
          context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }

        const core = context.createRadialGradient(128, 128, 8, 128, 128, 126);
        core.addColorStop(0, `rgba(${r},${g},${b},0.22)`);
        core.addColorStop(0.38, `rgba(${r},${g},${b},0.1)`);
        core.addColorStop(1, `rgba(${r},${g},${b},0)`);
        context.fillStyle = core;
        context.fillRect(0, 0, 256, 256);

        return this._trackTexture(new THREE.CanvasTexture(canvas));
      }
    }

    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const nx = (x + 0.5) / size * 2 - 1;
        const ny = (y + 0.5) / size * 2 - 1;
        const distance = Math.sqrt(nx * nx + ny * ny);
        const turbulence = 0.72 + Math.sin(nx * 12 + ny * 9 + seed) * 0.13;
        const alpha = Math.max(0, 1 - distance) ** 2 * turbulence;
        const offset = (y * size + x) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = Math.round(alpha * 120);
      }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return this._trackTexture(texture);
  }

  _createNebulae() {
    const direction = new THREE.Vector3();
    for (let i = 0; i < QUALITY_PRESETS.high.nebulae; i += 1) {
      const color = NEBULA_COLORS[i % NEBULA_COLORS.length];
      const texture = this._makeNebulaTexture(color, 0x9121 + i * 117);
      const material = this._trackMaterial(new THREE.SpriteMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        rotation: this._random() * Math.PI * 2,
      }));
      const sprite = new THREE.Sprite(material);
      this._randomDirection(direction);
      const radius = this.arenaRadius * (1.48 + this._random() * 0.7);
      sprite.position.copy(direction).multiplyScalar(radius);
      const size = this.arenaRadius * (0.82 + this._random() * 0.52);
      sprite.scale.set(size, size * (0.58 + this._random() * 0.36), 1);
      sprite.renderOrder = -10;
      sprite.userData.baseOpacity = material.opacity;
      sprite.userData.drift = (this._random() - 0.5) * 0.006;
      this.skyGroup.add(sprite);
      this._nebulaSprites.push(sprite);
    }
  }

  _makePlanetTexture(colors, seed) {
    const random = seededRandom(seed);
    const width = 256;
    const height = 128;

    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context) {
        const gradient = context.createLinearGradient(0, 0, 0, height);
        colors.forEach((value, index) => {
          const rgb = colorToRgb(value);
          gradient.addColorStop(
            index / Math.max(1, colors.length - 1),
            `rgb(${rgb.r},${rgb.g},${rgb.b})`,
          );
        });
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);

        context.globalCompositeOperation = 'soft-light';
        for (let i = 0; i < 38; i += 1) {
          const y = random() * height;
          const bandHeight = 1 + random() * 7;
          context.fillStyle = `rgba(255,255,255,${0.025 + random() * 0.075})`;
          context.fillRect(0, y, width, bandHeight);
        }
        return this._trackTexture(new THREE.CanvasTexture(canvas));
      }
    }

    const data = new Uint8Array(width * height * 4);
    const parsed = colors.map((value) => colorToRgb(value));
    for (let y = 0; y < height; y += 1) {
      const scaled = (y / (height - 1)) * (parsed.length - 1);
      const first = Math.floor(scaled);
      const second = Math.min(parsed.length - 1, first + 1);
      const mix = scaled - first;
      for (let x = 0; x < width; x += 1) {
        const noise = Math.sin(x * 0.08 + y * 0.37 + seed) * 5;
        const offset = (y * width + x) * 4;
        data[offset] = THREE.MathUtils.clamp(
          parsed[first].r * (1 - mix) + parsed[second].r * mix + noise,
          0,
          255,
        );
        data[offset + 1] = THREE.MathUtils.clamp(
          parsed[first].g * (1 - mix) + parsed[second].g * mix + noise,
          0,
          255,
        );
        data[offset + 2] = THREE.MathUtils.clamp(
          parsed[first].b * (1 - mix) + parsed[second].b * mix + noise,
          0,
          255,
        );
        data[offset + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return this._trackTexture(texture);
  }

  _createCelestials() {
    const planetGeometry = this._trackGeometry(new THREE.SphereGeometry(1, 40, 24));
    const ringGeometry = this._trackGeometry(new THREE.RingGeometry(1.25, 2.05, 72));

    const planetDefinitions = [
      {
        position: [-1.35, 0.43, -1.78],
        radius: 82,
        colors: [0x071a36, 0x24647c, 0x8ac0a6, 0x1d4968],
        emissive: 0x0a2438,
        ring: true,
      },
      {
        position: [1.5, -0.35, -1.25],
        radius: 48,
        colors: [0x2d142b, 0x813853, 0xb96d65, 0x4e1d46],
        emissive: 0x260d25,
        ring: false,
      },
      {
        position: [0.54, 1.26, 1.64],
        radius: 29,
        colors: [0x102340, 0x285e8b, 0x8bc7d9, 0x183c6a],
        emissive: 0x0b1d38,
        ring: false,
      },
    ];

    planetDefinitions.forEach((definition, index) => {
      const texture = this._makePlanetTexture(
        definition.colors,
        0x2109 + index * 419,
      );
      texture.wrapS = THREE.RepeatWrapping;
      const material = this._trackMaterial(new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        emissive: definition.emissive,
        emissiveIntensity: 0.55,
        metalness: 0,
        roughness: 0.91,
      }));
      const planet = new THREE.Mesh(planetGeometry, material);
      planet.position.set(...definition.position).multiplyScalar(this.arenaRadius);
      planet.scale.setScalar(definition.radius * (this.arenaRadius / 700));
      planet.rotation.set(
        this._random() * 0.4,
        this._random() * Math.PI,
        (this._random() - 0.5) * 0.3,
      );
      planet.userData.spin = 0.003 + index * 0.0015;
      planet.userData.initialRotation = planet.rotation.clone();
      this.celestialGroup.add(planet);
      this._celestials.push(planet);

      if (definition.ring) {
        const ringMaterial = this._trackMaterial(new THREE.MeshBasicMaterial({
          color: 0x8bc7d9,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
        }));
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.position.copy(planet.position);
        ring.scale.setScalar(definition.radius * (this.arenaRadius / 700));
        ring.rotation.set(Math.PI * 0.62, 0.18, -0.22);
        ring.userData.spin = -0.0018;
        ring.userData.initialRotation = ring.rotation.clone();
        this.celestialGroup.add(ring);
        this._celestials.push(ring);
      }
    });
  }

  _makeAsteroidGeometry(seed) {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const position = geometry.getAttribute('position');
    const vector = new THREE.Vector3();

    for (let i = 0; i < position.count; i += 1) {
      vector.fromBufferAttribute(position, i);
      const distortion = 0.78
        + Math.abs(Math.sin(
          vector.x * 3.9
          + vector.y * 5.3
          + vector.z * 7.1
          + seed * 0.017,
        )) * 0.34;
      vector.multiplyScalar(distortion);
      position.setXYZ(i, vector.x, vector.y, vector.z);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return this._trackGeometry(geometry);
  }

  _createAsteroids() {
    const geometries = [
      this._makeAsteroidGeometry(17),
      this._makeAsteroidGeometry(53),
      this._makeAsteroidGeometry(101),
      this._makeAsteroidGeometry(197),
    ];
    const materials = [
      this._trackMaterial(new THREE.MeshStandardMaterial({
        color: 0x4d5260,
        roughness: 0.93,
        metalness: 0.08,
        flatShading: true,
      })),
      this._trackMaterial(new THREE.MeshStandardMaterial({
        color: 0x5c4c53,
        roughness: 0.96,
        metalness: 0.05,
        flatShading: true,
      })),
      this._trackMaterial(new THREE.MeshStandardMaterial({
        color: 0x3f5255,
        roughness: 0.9,
        metalness: 0.12,
        flatShading: true,
      })),
    ];

    const safeSpawnRadius = Math.min(145, this.arenaRadius * 0.3);
    const minimumSize = Math.max(5, this.arenaRadius * 0.012);
    const maximumSize = Math.max(minimumSize + 3, this.arenaRadius * 0.038);
    const direction = new THREE.Vector3();
    const candidate = new THREE.Vector3();

    for (let index = 0; index < QUALITY_PRESETS.high.asteroids; index += 1) {
      const baseRadius = THREE.MathUtils.lerp(
        minimumSize,
        maximumSize,
        this._random() ** 1.35,
      );
      let foundPosition = false;

      for (let attempt = 0; attempt < 80; attempt += 1) {
        this._randomDirection(direction);
        direction.y *= 0.78;
        direction.normalize();
        const maxDistance = Math.max(
          safeSpawnRadius + 8,
          this.arenaRadius - baseRadius - 24,
        );
        const distance = THREE.MathUtils.lerp(
          safeSpawnRadius + baseRadius,
          maxDistance,
          this._random() ** 0.78,
        );
        candidate.copy(direction).multiplyScalar(distance);
        foundPosition = this._allObstacles.every((other) => (
          candidate.distanceToSquared(other.position)
          > (baseRadius + other.radius + 22) ** 2
        ));
        if (foundPosition) break;
      }

      if (!foundPosition) {
        const angle = (index / QUALITY_PRESETS.high.asteroids) * Math.PI * 2;
        const distance = safeSpawnRadius
          + (this.arenaRadius - safeSpawnRadius - baseRadius - 25)
          * ((index % 5) + 1) / 6;
        candidate.set(
          Math.cos(angle) * distance,
          ((index % 3) - 1) * this.arenaRadius * 0.16,
          Math.sin(angle) * distance,
        );
      }

      const mesh = new THREE.Mesh(
        geometries[index % geometries.length],
        materials[index % materials.length],
      );
      const scaleX = baseRadius * (0.8 + this._random() * 0.35);
      const scaleY = baseRadius * (0.7 + this._random() * 0.38);
      const scaleZ = baseRadius * (0.82 + this._random() * 0.32);
      mesh.position.copy(candidate);
      mesh.scale.set(scaleX, scaleY, scaleZ);
      mesh.rotation.set(
        this._random() * Math.PI,
        this._random() * Math.PI,
        this._random() * Math.PI,
      );
      mesh.name = `Asteroid-${index + 1}`;
      mesh.userData.spin = new THREE.Vector3(
        (this._random() - 0.5) * 0.09,
        (this._random() - 0.5) * 0.09,
        (this._random() - 0.5) * 0.09,
      );
      mesh.userData.initialRotation = mesh.rotation.clone();
      this.asteroidGroup.add(mesh);

      const obstacle = {
        mesh,
        position: mesh.position,
        radius:
          Math.max(scaleX, scaleY, scaleZ) *
          (mesh.geometry.boundingSphere?.radius ?? 1),
      };
      mesh.userData.obstacleRadius = obstacle.radius;
      this._allObstacles.push(obstacle);
    }
  }

  _createDebris() {
    const count = QUALITY_PRESETS.high.debris;
    const geometry = this._trackGeometry(new THREE.TetrahedronGeometry(1, 0));
    const material = this._trackMaterial(new THREE.MeshStandardMaterial({
      color: 0x566574,
      emissive: 0x09121b,
      emissiveIntensity: 0.4,
      roughness: 0.7,
      metalness: 0.64,
      flatShading: true,
    }));
    const debris = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const direction = new THREE.Vector3();

    for (let i = 0; i < count; i += 1) {
      this._randomDirection(direction);
      const distance = this.arenaRadius * (0.2 + this._random() * 0.72);
      position.copy(direction).multiplyScalar(distance);
      euler.set(
        this._random() * Math.PI,
        this._random() * Math.PI,
        this._random() * Math.PI,
      );
      quaternion.setFromEuler(euler);
      const size = 0.55 + this._random() * 2.5;
      scale.set(
        size * (0.35 + this._random()),
        size * (0.22 + this._random() * 0.68),
        size * (0.7 + this._random() * 1.7),
      );
      matrix.compose(position, quaternion, scale);
      debris.setMatrixAt(i, matrix);
    }

    debris.instanceMatrix.needsUpdate = true;
    debris.frustumCulled = false;
    debris.name = 'InstancedSpaceDebris';
    this.debrisGroup.add(debris);
    this.debris = debris;
  }

  _createBoundary() {
    const shellGeometry = this._trackGeometry(new THREE.SphereGeometry(
      this.arenaRadius,
      28,
      16,
    ));
    const shellMaterial = this._trackMaterial(new THREE.MeshBasicMaterial({
      color: 0x4f9dcb,
      transparent: true,
      opacity: 0.026,
      wireframe: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }));
    const shell = new THREE.Mesh(shellGeometry, shellMaterial);
    shell.name = 'ArenaContainmentShell';
    shell.renderOrder = 4;
    this.boundaryGroup.add(shell);
    this._boundaryShell = shell;

    const ringGeometry = this._trackGeometry(new THREE.TorusGeometry(
      this.arenaRadius,
      Math.max(0.35, this.arenaRadius * 0.0011),
      6,
      160,
    ));
    const ringMaterial = this._trackMaterial(new THREE.MeshBasicMaterial({
      color: 0x64cbff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }));

    [
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
      [0, Math.PI / 2, 0],
    ].forEach((rotation, index) => {
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.set(...rotation);
      ring.name = `ArenaGuideRing-${index + 1}`;
      this.boundaryGroup.add(ring);
    });
  }

  getObstacles() {
    return this.obstacles;
  }

  setQuality(quality) {
    const normalized = Object.hasOwn(QUALITY_PRESETS, quality) ? quality : 'high';
    const profile = QUALITY_PRESETS[normalized];
    this.quality = normalized;

    if (this.starfield) {
      this.starfield.geometry.setDrawRange(0, profile.stars);
      this.starfield.material.size = normalized === 'low' ? 2.5 : 2.1;
      this.starfield.material.needsUpdate = true;
    }

    this._nebulaSprites.forEach((sprite, index) => {
      sprite.visible = index < profile.nebulae;
    });

    this.obstacles.length = 0;
    this._allObstacles.forEach((obstacle, index) => {
      const active = index < profile.asteroids;
      obstacle.mesh.visible = active;
      if (active) this.obstacles.push(obstacle);
    });

    if (this.debris) this.debris.count = profile.debris;
    return this;
  }

  update(dt, playerPosition) {
    if (this.disposed) return;
    const step = THREE.MathUtils.clamp(Number(dt) || 0, 0, 0.1);
    this.time += step;

    this.starfield.rotation.y += step * 0.0011;
    this.starfield.rotation.x = Math.sin(this.time * 0.025) * 0.006;
    this.debrisGroup.rotation.y += step * 0.006;
    this.debrisGroup.rotation.z = Math.sin(this.time * 0.018) * 0.015;

    if (playerPosition?.isVector3) {
      const followAlpha = 1 - Math.exp(-step * 0.55);
      this._parallaxTarget.copy(playerPosition).multiplyScalar(0.055);
      this.starfield.position.lerp(this._parallaxTarget, followAlpha);
      this._parallaxTarget.copy(playerPosition).multiplyScalar(0.025);
      this._nebulaSprites.forEach((sprite) => {
        if (!sprite.visible) return;
        sprite.material.rotation += sprite.userData.drift * step;
      });
      this.skyGroup.position.lerp(this._parallaxTarget, followAlpha * 0.42);
    } else {
      this._nebulaSprites.forEach((sprite) => {
        if (sprite.visible) sprite.material.rotation += sprite.userData.drift * step;
      });
    }

    for (const celestial of this._celestials) {
      celestial.rotation.y += celestial.userData.spin * step;
    }

    for (const obstacle of this.obstacles) {
      const { spin } = obstacle.mesh.userData;
      obstacle.mesh.rotation.x += spin.x * step;
      obstacle.mesh.rotation.y += spin.y * step;
      obstacle.mesh.rotation.z += spin.z * step;
    }

    const pulse = Math.sin(this.time * 0.72);
    this._boundaryShell.material.opacity = 0.023 + (pulse + 1) * 0.004;
    this._magentaRim.intensity = 126 + pulse * 9;
    this._cyanRim.intensity = 102 - pulse * 7;
  }

  reset() {
    this.time = 0;
    this.skyGroup.position.set(0, 0, 0);
    this.starfield.position.set(0, 0, 0);
    this.starfield.rotation.set(0, 0, 0);
    this.debrisGroup.rotation.set(0, 0, 0);
    this.boundaryGroup.rotation.set(0, 0, 0);

    this._allObstacles.forEach(({ mesh }) => {
      mesh.rotation.copy(mesh.userData.initialRotation);
    });
    this._celestials.forEach((celestial) => {
      celestial.rotation.copy(celestial.userData.initialRotation);
    });
    this._nebulaSprites.forEach((sprite) => {
      sprite.material.opacity = sprite.userData.baseOpacity;
    });
    return this;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    this.root.removeFromParent();
    if (this.scene.background === this._backgroundColor) {
      this.scene.background = this._previousBackground;
    }

    for (const geometry of this._ownedGeometries) geometry.dispose();
    for (const material of this._ownedMaterials) material.dispose();
    for (const texture of this._ownedTextures) texture.dispose();
    this._ownedGeometries.clear();
    this._ownedMaterials.clear();
    this._ownedTextures.clear();
    this.obstacles.length = 0;
    this._allObstacles.length = 0;
    this._nebulaSprites.length = 0;
    this._celestials.length = 0;
    this._lights.length = 0;
  }
}

export default Environment;
