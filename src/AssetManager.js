import * as THREE from 'three';

const PLAYER_PALETTE = {
  hull: 0x376f98,
  panel: 0x173650,
  trim: 0x73efff,
  canopy: 0x65dfff,
  engine: 0x54f3ff,
};

const ENEMY_PALETTES = {
  scout: {
    hull: 0x7d275d,
    panel: 0x32152c,
    trim: 0xff5ca8,
    canopy: 0xff7bbb,
    engine: 0xff3da4,
  },
  fighter: {
    hull: 0x823332,
    panel: 0x341817,
    trim: 0xff715e,
    canopy: 0xffa06c,
    engine: 0xff5a36,
  },
  heavy: {
    hull: 0x70502d,
    panel: 0x302416,
    trim: 0xffb34c,
    canopy: 0xffd26c,
    engine: 0xff7a2f,
  },
  boss: {
    hull: 0x592967,
    panel: 0x25142f,
    trim: 0xe367ff,
    canopy: 0xff79ef,
    engine: 0xd946ff,
  },
};

function prismGeometry(points, thickness = 0.22) {
  const geometry = new THREE.BufferGeometry();
  const half = thickness * 0.5;
  const positions = [];
  const indices = [];
  const count = points.length;
  const contour = points.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);

  for (const [x, z] of points) positions.push(x, half, z);
  for (const [x, z] of points) positions.push(x, -half, z);

  for (const [a, b, c] of faces) {
    const [ax, az] = points[a];
    const [bx, bz] = points[b];
    const [cx, cz] = points[c];
    const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (normalY >= 0) {
      indices.push(a, b, c);
      indices.push(count + a, count + c, count + b);
    } else {
      indices.push(a, c, b);
      indices.push(count + a, count + b, count + c);
    }
  }

  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    indices.push(i, next, count + next);
    indices.push(i, count + next, count + i);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function applyTransform(object, transform = {}) {
  const {
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
  } = transform;

  object.position.set(...position);
  object.rotation.set(...rotation);
  object.scale.set(...scale);
  return object;
}

/**
 * Creates the game's procedural, reusable visual assets.
 *
 * Geometries and projectile materials are shared. Ship materials remain local to
 * each ship so hit flashes and engine intensity can be changed independently.
 */
export class AssetManager {
  constructor() {
    this._geometries = new Map();
    this._sharedMaterials = new Map();
    this._ownedGeometries = new Set();
    this._ownedMaterials = new Set();
    this._ownedTextures = new Set();
    this._engineGlowTexture = null;
  }

  _geometry(key, create) {
    if (!this._geometries.has(key)) {
      const geometry = create();
      this._geometries.set(key, geometry);
      this._ownedGeometries.add(geometry);
    }
    return this._geometries.get(key);
  }

  _trackMaterial(material) {
    this._ownedMaterials.add(material);
    return material;
  }

  _standardMaterial({
    color,
    emissive = 0x000000,
    emissiveIntensity = 0,
    metalness = 0.6,
    roughness = 0.34,
    transparent = false,
    opacity = 1,
    side = THREE.FrontSide,
  }) {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity,
      metalness,
      roughness,
      transparent,
      opacity,
      side,
    });
    return this._trackMaterial(material);
  }

  _shipMaterials(palette) {
    const hull = this._standardMaterial({
      color: palette.hull,
      metalness: 0.78,
      roughness: 0.3,
    });
    const panel = this._standardMaterial({
      color: palette.panel,
      metalness: 0.86,
      roughness: 0.4,
    });
    const trim = this._standardMaterial({
      color: palette.trim,
      emissive: palette.trim,
      emissiveIntensity: 0.45,
      metalness: 0.55,
      roughness: 0.25,
    });
    const canopy = this._standardMaterial({
      color: palette.canopy,
      emissive: palette.canopy,
      emissiveIntensity: 0.75,
      metalness: 0.28,
      roughness: 0.12,
    });
    const engine = this._standardMaterial({
      color: palette.engine,
      emissive: palette.engine,
      emissiveIntensity: 4,
      metalness: 0.05,
      roughness: 0.16,
    });
    engine.toneMapped = false;

    return { hull, panel, trim, canopy, engine };
  }

  _addPart(group, geometry, material, transform) {
    const mesh = applyTransform(new THREE.Mesh(geometry, material), transform);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  }

  _getGlowTexture() {
    if (this._engineGlowTexture) return this._engineGlowTexture;

    let texture;
    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext('2d');
      if (context) {
        const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 31);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.12, 'rgba(210,250,255,0.98)');
        gradient.addColorStop(0.42, 'rgba(90,190,255,0.62)');
        gradient.addColorStop(1, 'rgba(20,70,255,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 64, 64);
        texture = new THREE.CanvasTexture(canvas);
      }
    }

    if (!texture) {
      const size = 32;
      const data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const dx = (x + 0.5) / size * 2 - 1;
          const dy = (y + 0.5) / size * 2 - 1;
          const alpha = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
          const offset = (y * size + x) * 4;
          data[offset] = 190;
          data[offset + 1] = 235;
          data[offset + 2] = 255;
          data[offset + 3] = Math.round(alpha * alpha * 255);
        }
      }
      texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      texture.needsUpdate = true;
    }

    texture.name = 'procedural-engine-glow';
    texture.colorSpace = THREE.SRGBColorSpace;
    this._engineGlowTexture = texture;
    this._ownedTextures.add(texture);
    return texture;
  }

  _addEngine(group, materials, position, radius, engineMaterials, engineGlows) {
    const nozzleGeometry = this._geometry(
      'engine-nozzle',
      () => new THREE.CylinderGeometry(0.78, 1, 0.62, 12, 1, false),
    );
    const coreGeometry = this._geometry(
      'engine-core',
      () => new THREE.CylinderGeometry(0.64, 0.64, 0.15, 12),
    );

    this._addPart(group, nozzleGeometry, materials.panel, {
      position,
      rotation: [Math.PI / 2, 0, 0],
      scale: [radius, radius, radius],
    });

    const corePosition = [position[0], position[1], position[2] + radius * 0.34];
    this._addPart(group, coreGeometry, materials.engine, {
      position: corePosition,
      rotation: [Math.PI / 2, 0, 0],
      scale: [radius, radius, radius],
    });

    const glowMaterial = this._trackMaterial(new THREE.SpriteMaterial({
      map: this._getGlowTexture(),
      color: materials.engine.color,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }));
    const glow = new THREE.Sprite(glowMaterial);
    glow.position.set(position[0], position[1], position[2] + radius * 0.55);
    glow.scale.set(radius * 3.2, radius * 3.2, 1);
    glow.userData.baseScale = radius * 3.2;
    glow.userData.baseOpacity = 0.82;
    group.add(glow);

    if (!engineMaterials.includes(materials.engine)) engineMaterials.push(materials.engine);
    engineGlows.push(glow);
  }

  _finalizeShip(group, type, collisionRadius, materials, engineMaterials, engineGlows) {
    group.name = type === 'player' ? 'PlayerShip' : `EnemyShip-${type}`;
    group.userData.shipType = type;
    group.userData.collisionRadius = collisionRadius;
    group.userData.engineMaterials = engineMaterials;
    group.userData.engineGlows = engineGlows;
    group.userData.hullMaterials = [
      materials.hull,
      materials.panel,
      materials.trim,
      materials.canopy,
    ];
    group.userData.forward = new THREE.Vector3(0, 0, -1);
    return group;
  }

  createPlayerShip() {
    const group = new THREE.Group();
    const materials = this._shipMaterials(PLAYER_PALETTE);
    const engineMaterials = [];
    const engineGlows = [];

    const playerWing = this._geometry('player-wing', () => prismGeometry([
      [0, -2.75],
      [1.25, -1.1],
      [5.1, 1.25],
      [4.15, 2.05],
      [1.25, 1.2],
      [0, 2.35],
      [-1.25, 1.2],
      [-4.15, 2.05],
      [-5.1, 1.25],
      [-1.25, -1.1],
    ], 0.24));
    const cone = this._geometry('cone-16', () => new THREE.ConeGeometry(1, 2, 16));
    const sphere = this._geometry('sphere-16', () => new THREE.SphereGeometry(1, 16, 10));
    const box = this._geometry('unit-box', () => new THREE.BoxGeometry(1, 1, 1));
    const barrel = this._geometry(
      'weapon-barrel',
      () => new THREE.CylinderGeometry(0.12, 0.16, 1, 8),
    );

    this._addPart(group, playerWing, materials.hull);
    this._addPart(group, cone, materials.hull, {
      position: [0, 0.28, -1.9],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [1.05, 2.7, 0.72],
    });
    this._addPart(group, box, materials.panel, {
      position: [0, -0.05, 0.55],
      scale: [1.42, 0.58, 3.25],
    });
    this._addPart(group, sphere, materials.canopy, {
      position: [0, 0.61, -0.62],
      scale: [0.73, 0.42, 1.28],
    });
    this._addPart(group, box, materials.trim, {
      position: [0, 0.22, 1.48],
      scale: [0.19, 0.07, 1.55],
    });

    for (const side of [-1, 1]) {
      this._addPart(group, box, materials.panel, {
        position: [side * 3.08, 0.04, 1.18],
        rotation: [0, side * -0.12, side * -0.035],
        scale: [1.25, 0.48, 1.18],
      });
      this._addPart(group, barrel, materials.trim, {
        position: [side * 3.88, -0.05, -0.05],
        rotation: [Math.PI / 2, 0, 0],
        scale: [1, 1.4, 1],
      });
      this._addEngine(
        group,
        materials,
        [side * 1.65, -0.02, 1.78],
        0.52,
        engineMaterials,
        engineGlows,
      );
    }

    return this._finalizeShip(
      group,
      'player',
      4.25,
      materials,
      engineMaterials,
      engineGlows,
    );
  }

  createEnemyShip(type = 'fighter') {
    const normalizedType = Object.hasOwn(ENEMY_PALETTES, type) ? type : 'fighter';
    if (normalizedType === 'scout') return this._createScout();
    if (normalizedType === 'heavy') return this._createHeavy();
    if (normalizedType === 'boss') return this._createBoss();
    return this._createFighter();
  }

  _createScout() {
    const group = new THREE.Group();
    const materials = this._shipMaterials(ENEMY_PALETTES.scout);
    const engineMaterials = [];
    const engineGlows = [];
    const wing = this._geometry('scout-wing', () => prismGeometry([
      [0, -2.65],
      [1.05, -0.72],
      [3.1, 1.55],
      [0.62, 0.92],
      [0, 1.65],
      [-0.62, 0.92],
      [-3.1, 1.55],
      [-1.05, -0.72],
    ], 0.17));
    const cone = this._geometry('cone-16', () => new THREE.ConeGeometry(1, 2, 16));
    const sphere = this._geometry('sphere-16', () => new THREE.SphereGeometry(1, 16, 10));
    const box = this._geometry('unit-box', () => new THREE.BoxGeometry(1, 1, 1));

    this._addPart(group, wing, materials.hull);
    this._addPart(group, cone, materials.panel, {
      position: [0, 0.14, -1.3],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [0.65, 2.05, 0.52],
    });
    this._addPart(group, sphere, materials.canopy, {
      position: [0, 0.38, -0.42],
      scale: [0.45, 0.27, 0.72],
    });
    for (const side of [-1, 1]) {
      this._addPart(group, box, materials.trim, {
        position: [side * 1.33, 0.16, 0.45],
        rotation: [0, 0, side * -0.22],
        scale: [0.12, 0.5, 1.35],
      });
      this._addEngine(
        group,
        materials,
        [side * 0.7, -0.04, 1.2],
        0.31,
        engineMaterials,
        engineGlows,
      );
    }

    return this._finalizeShip(
      group,
      'scout',
      2.8,
      materials,
      engineMaterials,
      engineGlows,
    );
  }

  _createFighter() {
    const group = new THREE.Group();
    const materials = this._shipMaterials(ENEMY_PALETTES.fighter);
    const engineMaterials = [];
    const engineGlows = [];
    const wing = this._geometry('fighter-wing', () => prismGeometry([
      [0, -3.1],
      [1.15, -0.9],
      [4.1, 0.95],
      [3.55, 1.78],
      [1.0, 1.2],
      [0, 2.25],
      [-1.0, 1.2],
      [-3.55, 1.78],
      [-4.1, 0.95],
      [-1.15, -0.9],
    ], 0.3));
    const cone = this._geometry('cone-16', () => new THREE.ConeGeometry(1, 2, 16));
    const sphere = this._geometry('sphere-16', () => new THREE.SphereGeometry(1, 16, 10));
    const box = this._geometry('unit-box', () => new THREE.BoxGeometry(1, 1, 1));
    const barrel = this._geometry(
      'weapon-barrel',
      () => new THREE.CylinderGeometry(0.12, 0.16, 1, 8),
    );

    this._addPart(group, wing, materials.hull);
    this._addPart(group, box, materials.panel, {
      position: [0, 0.02, 0.15],
      scale: [1.2, 0.72, 3.55],
    });
    this._addPart(group, cone, materials.hull, {
      position: [0, 0.16, -2.2],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [0.85, 2.15, 0.62],
    });
    this._addPart(group, sphere, materials.canopy, {
      position: [0, 0.57, -0.76],
      scale: [0.58, 0.34, 0.95],
    });
    for (const side of [-1, 1]) {
      this._addPart(group, barrel, materials.trim, {
        position: [side * 2.68, -0.03, -0.68],
        rotation: [Math.PI / 2, 0, 0],
        scale: [1, 1.65, 1],
      });
      this._addEngine(
        group,
        materials,
        [side * 1.15, -0.03, 1.65],
        0.42,
        engineMaterials,
        engineGlows,
      );
    }

    return this._finalizeShip(
      group,
      'fighter',
      3.8,
      materials,
      engineMaterials,
      engineGlows,
    );
  }

  _createHeavy() {
    const group = new THREE.Group();
    const materials = this._shipMaterials(ENEMY_PALETTES.heavy);
    const engineMaterials = [];
    const engineGlows = [];
    const wing = this._geometry('heavy-wing', () => prismGeometry([
      [0, -3.1],
      [1.7, -1.65],
      [5.25, -0.05],
      [5.15, 2.15],
      [1.45, 1.45],
      [0, 2.5],
      [-1.45, 1.45],
      [-5.15, 2.15],
      [-5.25, -0.05],
      [-1.7, -1.65],
    ], 0.5));
    const sphere = this._geometry('sphere-16', () => new THREE.SphereGeometry(1, 16, 10));
    const box = this._geometry('unit-box', () => new THREE.BoxGeometry(1, 1, 1));
    const cone = this._geometry('cone-16', () => new THREE.ConeGeometry(1, 2, 16));
    const barrel = this._geometry(
      'heavy-barrel',
      () => new THREE.CylinderGeometry(0.2, 0.25, 1, 10),
    );

    this._addPart(group, wing, materials.hull);
    this._addPart(group, box, materials.panel, {
      position: [0, 0.12, 0.15],
      scale: [2.45, 1.22, 3.95],
    });
    this._addPart(group, cone, materials.hull, {
      position: [0, 0.17, -2.65],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [1.28, 2.25, 0.84],
    });
    this._addPart(group, sphere, materials.canopy, {
      position: [0, 0.95, -0.75],
      scale: [0.88, 0.46, 1.1],
    });

    for (const side of [-1, 1]) {
      this._addPart(group, box, materials.panel, {
        position: [side * 3.72, 0.25, 0.7],
        scale: [1.55, 1.05, 2.45],
      });
      this._addPart(group, barrel, materials.trim, {
        position: [side * 4.05, 0.05, -1.5],
        rotation: [Math.PI / 2, 0, 0],
        scale: [1.3, 2.6, 1.3],
      });
      this._addEngine(
        group,
        materials,
        [side * 3.62, 0.0, 2.02],
        0.58,
        engineMaterials,
        engineGlows,
      );
    }
    this._addEngine(
      group,
      materials,
      [0, -0.22, 2.25],
      0.68,
      engineMaterials,
      engineGlows,
    );

    return this._finalizeShip(
      group,
      'heavy',
      5.7,
      materials,
      engineMaterials,
      engineGlows,
    );
  }

  _createBoss() {
    const group = new THREE.Group();
    const materials = this._shipMaterials(ENEMY_PALETTES.boss);
    const engineMaterials = [];
    const engineGlows = [];
    const wing = this._geometry('boss-wing', () => prismGeometry([
      [0, -7.6],
      [2.4, -4.1],
      [8.1, -2.3],
      [14.5, 1.2],
      [12.9, 4.45],
      [7.0, 3.1],
      [3.25, 5.4],
      [0, 4.1],
      [-3.25, 5.4],
      [-7.0, 3.1],
      [-12.9, 4.45],
      [-14.5, 1.2],
      [-8.1, -2.3],
      [-2.4, -4.1],
    ], 0.78));
    const sphere = this._geometry('sphere-16', () => new THREE.SphereGeometry(1, 16, 10));
    const box = this._geometry('unit-box', () => new THREE.BoxGeometry(1, 1, 1));
    const cone = this._geometry('cone-16', () => new THREE.ConeGeometry(1, 2, 16));
    const barrel = this._geometry(
      'boss-barrel',
      () => new THREE.CylinderGeometry(0.24, 0.32, 1, 10),
    );

    this._addPart(group, wing, materials.hull);
    this._addPart(group, box, materials.panel, {
      position: [0, 0.22, -0.1],
      scale: [5.2, 2.25, 9.3],
    });
    this._addPart(group, cone, materials.hull, {
      position: [0, 0.35, -6.4],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [2.7, 3.1, 1.55],
    });
    this._addPart(group, sphere, materials.canopy, {
      position: [0, 1.78, -2.65],
      scale: [1.85, 0.82, 2.6],
    });
    this._addPart(group, sphere, materials.engine, {
      position: [0, 0.68, 0.05],
      scale: [1.16, 0.32, 1.55],
    });

    for (const side of [-1, 1]) {
      this._addPart(group, box, materials.panel, {
        position: [side * 7.9, 0.42, 1.25],
        rotation: [0, side * 0.08, 0],
        scale: [4.5, 1.48, 4.45],
      });
      this._addPart(group, barrel, materials.trim, {
        position: [side * 9.9, 0.15, -2.85],
        rotation: [Math.PI / 2, 0, 0],
        scale: [1.65, 4.2, 1.65],
      });
      this._addPart(group, barrel, materials.trim, {
        position: [side * 5.3, -0.05, -4.05],
        rotation: [Math.PI / 2, 0, 0],
        scale: [1.25, 3.2, 1.25],
      });
      this._addEngine(
        group,
        materials,
        [side * 3.0, -0.45, 4.45],
        1.0,
        engineMaterials,
        engineGlows,
      );
      this._addEngine(
        group,
        materials,
        [side * 8.4, -0.2, 3.4],
        0.82,
        engineMaterials,
        engineGlows,
      );
    }
    this._addEngine(
      group,
      materials,
      [0, -0.5, 4.75],
      1.2,
      engineMaterials,
      engineGlows,
    );

    return this._finalizeShip(
      group,
      'boss',
      14.5,
      materials,
      engineMaterials,
      engineGlows,
    );
  }

  createProjectileMesh(team = 'player') {
    const ensureMaterial = (projectileTeam) => {
      const enemyMaterial = projectileTeam === 'enemy';
      const key = enemyMaterial ? 'projectile-enemy' : 'projectile-player';
      if (this._sharedMaterials.has(key)) {
        return this._sharedMaterials.get(key);
      }
      const color = enemyMaterial ? 0xff4e62 : 0x54edff;
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      this._sharedMaterials.set(key, material);
      this._ownedMaterials.add(material);
      return material;
    };

    const isEnemy = team === 'enemy';
    const geometry = this._geometry(
      'projectile-bolt',
      () => new THREE.SphereGeometry(0.18, 8, 6),
    );
    const mesh = new THREE.Mesh(geometry, ensureMaterial(team));
    mesh.name = isEnemy ? 'EnemyProjectile' : 'PlayerProjectile';
    mesh.scale.set(1, 1, 4.5);
    mesh.frustumCulled = false;
    mesh.userData.team = isEnemy ? 'enemy' : 'player';
    mesh.userData.collisionRadius = 0.32;
    mesh.userData.setTeam = (nextTeam) => {
      const nextIsEnemy = nextTeam === 'enemy';
      mesh.material = ensureMaterial(nextTeam);
      mesh.name = nextIsEnemy ? 'EnemyProjectile' : 'PlayerProjectile';
      mesh.userData.team = nextIsEnemy ? 'enemy' : 'player';
    };
    return mesh;
  }

  createMissileMesh() {
    const group = new THREE.Group();
    const body = this._standardMaterial({
      color: 0xc7d4dc,
      metalness: 0.82,
      roughness: 0.27,
    });
    const dark = this._standardMaterial({
      color: 0x162632,
      metalness: 0.7,
      roughness: 0.36,
    });
    const tip = this._standardMaterial({
      color: 0xff754e,
      emissive: 0xff3218,
      emissiveIntensity: 0.65,
      metalness: 0.35,
      roughness: 0.28,
    });
    const engine = this._standardMaterial({
      color: 0x6eeeff,
      emissive: 0x42e9ff,
      emissiveIntensity: 4.5,
      metalness: 0.05,
      roughness: 0.15,
    });
    engine.toneMapped = false;

    const cylinder = this._geometry(
      'missile-cylinder',
      () => new THREE.CylinderGeometry(0.34, 0.34, 2.5, 10),
    );
    const cone = this._geometry(
      'missile-cone',
      () => new THREE.ConeGeometry(0.35, 0.9, 10),
    );
    const box = this._geometry('unit-box', () => new THREE.BoxGeometry(1, 1, 1));
    const core = this._geometry(
      'missile-core',
      () => new THREE.CylinderGeometry(0.24, 0.24, 0.12, 10),
    );

    this._addPart(group, cylinder, body, {
      rotation: [Math.PI / 2, 0, 0],
    });
    this._addPart(group, cone, tip, {
      position: [0, 0, -1.69],
      rotation: [-Math.PI / 2, 0, 0],
    });
    this._addPart(group, core, engine, {
      position: [0, 0, 1.31],
      rotation: [Math.PI / 2, 0, 0],
    });
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const fin = this._addPart(group, box, dark, {
        position: [Math.cos(angle) * 0.48, Math.sin(angle) * 0.48, 0.8],
        rotation: [0, 0, angle],
        scale: [0.55, 0.08, 0.72],
      });
      fin.rotation.z = angle;
    }

    const glowMaterial = this._trackMaterial(new THREE.SpriteMaterial({
      map: this._getGlowTexture(),
      color: 0x70eaff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }));
    const glow = new THREE.Sprite(glowMaterial);
    glow.position.set(0, 0, 1.46);
    glow.scale.set(1.5, 1.5, 1);
    glow.userData.baseScale = 1.5;
    group.add(glow);

    group.name = 'HomingMissile';
    group.userData.collisionRadius = 0.55;
    group.userData.engineMaterials = [engine];
    group.userData.engineGlows = [glow];
    group.userData.forward = new THREE.Vector3(0, 0, -1);
    return group;
  }

  dispose() {
    for (const geometry of this._ownedGeometries) geometry.dispose();
    for (const material of this._ownedMaterials) material.dispose();
    for (const texture of this._ownedTextures) texture.dispose();

    this._geometries.clear();
    this._sharedMaterials.clear();
    this._ownedGeometries.clear();
    this._ownedMaterials.clear();
    this._ownedTextures.clear();
    this._engineGlowTexture = null;
  }
}

export default AssetManager;
