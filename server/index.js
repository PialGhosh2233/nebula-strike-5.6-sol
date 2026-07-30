import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ENEMY_TYPES,
  GAME_CONFIG,
  PLAYER_CONFIG,
  WEAPON_CONFIG,
} from '../src/config.js';

const PORT = Math.max(1, Number(process.env.PORT) || 3001);
const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const MAX_PLAYERS = 4;
const PVP_RESPAWN_MS = 3500;
const PVP_KILL_SCORE = 1000;
const PVP_LASER_GRACE_RADIUS = 1.15;
const PICKUP_MAX_COUNT = 4;
const PICKUP_RADIUS = 6;
const PICKUP_LIFETIME_MS = 45_000;
const PICKUP_FIRST_SPAWN_MS = 1800;
const PICKUP_MIN_SPAWN_MS = 7000;
const PICKUP_MAX_SPAWN_MS = 12_000;
const MAX_MESSAGE_BYTES = 16 * 1024;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_ROOT = resolve(PROJECT_ROOT, 'dist');

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
});

const rooms = new Map();
let enemySequence = 0;
let pickupSequence = 0;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function sanitizeVector(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return [
    finiteNumber(Number(value[0]), fallback[0]),
    finiteNumber(Number(value[1]), fallback[1]),
    finiteNumber(Number(value[2]), fallback[2]),
  ];
}

function sanitizeQuaternion(value) {
  if (!Array.isArray(value) || value.length < 4) return [0, 0, 0, 1];
  const quaternion = [
    finiteNumber(Number(value[0])),
    finiteNumber(Number(value[1])),
    finiteNumber(Number(value[2])),
    finiteNumber(Number(value[3]), 1),
  ];
  const length = Math.hypot(...quaternion);
  if (length < 0.0001) return [0, 0, 0, 1];
  return quaternion.map((component) => component / length);
}

function addScaled(target, vector, scalar) {
  target[0] += vector[0] * scalar;
  target[1] += vector[1] * scalar;
  target[2] += vector[2] * scalar;
  return target;
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function normalize(vector, fallback = [0, 0, -1]) {
  const magnitude = length(vector);
  if (magnitude < 0.0001) return [...fallback];
  return vector.map((component) => component / magnitude);
}

function limit(vector, maximum) {
  const magnitude = length(vector);
  if (magnitude > maximum && magnitude > 0) {
    const scale = maximum / magnitude;
    vector[0] *= scale;
    vector[1] *= scale;
    vector[2] *= scale;
  }
  return vector;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function randomDirection() {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radial = Math.sqrt(Math.max(0, 1 - z * z));
  return [Math.cos(angle) * radial, z, Math.sin(angle) * radial];
}

function randomRoomCode() {
  let code = '';
  do {
    code = Array.from(
      { length: 6 },
      () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)],
    ).join('');
  } while (rooms.has(code));
  return code;
}

function sanitizeRoomCode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

function sanitizeName(value) {
  const name = String(value ?? '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .slice(0, 16);
  return name || `Pilot-${Math.floor(100 + Math.random() * 900)}`;
}

function safeSend(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    socket.terminate();
  }
}

function broadcast(room, payload, except = null) {
  const serialized = JSON.stringify(payload);
  for (const player of room.players.values()) {
    if (player.socket === except || player.socket.readyState !== WebSocket.OPEN) {
      continue;
    }
    player.socket.send(serialized);
  }
}

function createPlayer(socket, name, index) {
  const angle = (index / MAX_PLAYERS) * Math.PI * 2;
  return {
    id: randomUUID(),
    socket,
    name: sanitizeName(name),
    color: ['cyan', 'purple', 'orange', 'blue'][index % 4],
    position: [Math.sin(angle) * 22, (index % 2) * 8 - 4, 80 + Math.cos(angle) * 22],
    quaternion: [0, 0, 0, 1],
    velocity: [0, 0, -26],
    health: PLAYER_CONFIG.maxHealth,
    shield: PLAYER_CONFIG.maxShield,
    missiles: PLAYER_CONFIG.missileAmmo,
    alive: true,
    boosting: false,
    evading: false,
    score: 0,
    kills: 0,
    deaths: 0,
    respawnAt: 0,
    lastTransformAt: Date.now(),
    lastSeenAt: Date.now(),
    lastFireAt: 0,
    lastMissileAt: 0,
    lastDamageAt: -Infinity,
  };
}

function createRoom(code = randomRoomCode()) {
  const now = Date.now();
  const room = {
    code,
    players: new Map(),
    enemies: new Map(),
    missiles: [],
    pickups: new Map(),
    wave: 0,
    score: 0,
    kills: 0,
    elapsed: 0,
    state: 'countdown',
    countdownUntil: now + GAME_CONFIG.countdownSeconds * 1000,
    nextPickupAt: now + GAME_CONFIG.countdownSeconds * 1000 + PICKUP_FIRST_SPAWN_MS,
    intermissionUntil: 0,
    lastTickAt: Date.now(),
    emptySince: 0,
  };
  rooms.set(code, room);
  return room;
}

function findQuickRoom() {
  for (const room of rooms.values()) {
    if (
      room.players.size < MAX_PLAYERS &&
      room.state !== 'gameover'
    ) {
      return room;
    }
  }
  return createRoom();
}

function resetPlayer(player, index) {
  const replacement = createPlayer(player.socket, player.name, index);
  Object.assign(player, {
    position: replacement.position,
    quaternion: replacement.quaternion,
    velocity: replacement.velocity,
    health: replacement.health,
    shield: replacement.shield,
    missiles: replacement.missiles,
    alive: true,
    boosting: false,
    evading: false,
    score: 0,
    kills: 0,
    deaths: 0,
    respawnAt: 0,
    lastTransformAt: Date.now(),
    lastFireAt: 0,
    lastMissileAt: 0,
    lastDamageAt: -Infinity,
  });
}

function resetRoom(room) {
  room.enemies.clear();
  room.missiles.length = 0;
  room.pickups.clear();
  room.wave = 1;
  room.score = 0;
  room.kills = 0;
  room.elapsed = 0;
  room.state = 'countdown';
  room.countdownUntil = Date.now() + GAME_CONFIG.countdownSeconds * 1000;
  room.nextPickupAt = room.countdownUntil + PICKUP_FIRST_SPAWN_MS;
  room.intermissionUntil = 0;
  let index = 0;
  for (const player of room.players.values()) {
    resetPlayer(player, index);
    index += 1;
  }
  broadcast(room, { type: 'event', event: 'roomReset' });
}

function scheduleNextPickup(room, now) {
  room.nextPickupAt = now + PICKUP_MIN_SPAWN_MS +
    Math.random() * (PICKUP_MAX_SPAWN_MS - PICKUP_MIN_SPAWN_MS);
}

function spawnMissilePickup(room, now) {
  const direction = randomDirection();
  const radius = 120 + Math.random() * 400;
  const pickup = {
    id: `missile-drop-${++pickupSequence}`,
    type: 'missile',
    position: direction.map((component) => component * radius),
    expiresAt: now + PICKUP_LIFETIME_MS,
  };
  room.pickups.set(pickup.id, pickup);
  scheduleNextPickup(room, now);
  broadcast(room, {
    type: 'event',
    event: 'pickupSpawned',
    pickup: {
      id: pickup.id,
      type: pickup.type,
      position: pickup.position,
    },
  });
}

function updatePickups(room, now) {
  if (
    room.state === 'playing' &&
    room.pickups.size < PICKUP_MAX_COUNT &&
    now >= room.nextPickupAt
  ) {
    spawnMissilePickup(room, now);
  }

  for (const [id, pickup] of room.pickups) {
    if (now >= pickup.expiresAt) {
      room.pickups.delete(id);
      continue;
    }
    for (const player of room.players.values()) {
      if (
        !player.alive ||
        player.missiles >= PLAYER_CONFIG.missileAmmo ||
        distance(player.position, pickup.position) >
          PICKUP_RADIUS + PLAYER_CONFIG.radius
      ) {
        continue;
      }
      player.missiles = PLAYER_CONFIG.missileAmmo;
      room.pickups.delete(id);
      broadcast(room, {
        type: 'event',
        event: 'pickupCollected',
        pickupId: id,
        pickupType: pickup.type,
        playerId: player.id,
        playerName: player.name,
        position: pickup.position,
        missiles: player.missiles,
      });
      break;
    }
  }
}

function respawnPlayer(room, player) {
  const index = [...room.players.keys()].indexOf(player.id);
  const { score, kills, deaths } = player;
  resetPlayer(player, Math.max(0, index));
  player.score = score;
  player.kills = kills;
  player.deaths = deaths;
  broadcast(room, {
    type: 'event',
    event: 'playerRespawned',
    playerId: player.id,
    name: player.name,
    position: player.position,
  });
}

function enemyTypeForIndex(wave, index, bossWave) {
  if (bossWave && index === 0) return 'boss';
  if (wave >= 3 && index % 5 === 0) return 'heavy';
  if (wave >= 2 && index % 3 !== 0) return 'fighter';
  return 'scout';
}

function spawnEnemy(room, type, index) {
  const config = ENEMY_TYPES[type];
  const healthScale = 1 + Math.max(0, room.wave - 1) * (type === 'boss' ? 0.16 : 0.11);
  const damageScale = 1 + Math.max(0, room.wave - 1) * 0.065;
  const speedScale = Math.min(1.5, 1 + Math.max(0, room.wave - 1) * 0.025);
  const direction = randomDirection();
  const radius = 310 + Math.random() * 170;
  const position = direction.map((component) => component * radius);
  const tangent = normalize([-direction[2], direction[1] * 0.25, direction[0]]);
  const maxHealth = Math.round(config.health * healthScale);
  const id = `enemy-${++enemySequence}`;
  room.enemies.set(id, {
    id,
    type,
    position,
    velocity: tangent.map((component) => component * config.speed * 0.35),
    health: maxHealth,
    maxHealth,
    radius: config.radius,
    damage: config.damage * damageScale,
    speed: config.speed * speedScale,
    acceleration: config.acceleration,
    attackRange: config.attackRange,
    preferredDistance: config.preferredDistance,
    fireCooldown: config.fireCooldown,
    fireTimer: 0.35 + Math.random() * config.fireCooldown,
    scoreValue: Math.round(config.score * (1 + (room.wave - 1) * 0.12)),
    seed: Math.random() * 1000 + index,
    time: 0,
  });
}

function spawnNextWave(room) {
  room.wave += 1;
  const bossWave = room.wave % GAME_CONFIG.bossEvery === 0;
  const playerScale = Math.max(1, room.players.size);
  const regularCount = Math.min(18, 4 + room.wave + (playerScale - 1) * 2);
  const count = bossWave ? 1 + Math.min(3, playerScale) : regularCount;
  for (let index = 0; index < count; index += 1) {
    spawnEnemy(room, enemyTypeForIndex(room.wave, index, bossWave), index);
  }
  for (const player of room.players.values()) {
    if (room.wave > 1) {
      player.shield = Math.min(PLAYER_CONFIG.maxShield, player.shield + 24);
      player.missiles = Math.min(PLAYER_CONFIG.missileAmmo, player.missiles + 1);
    }
  }
  broadcast(room, {
    type: 'event',
    event: 'wave',
    wave: room.wave,
    boss: bossWave,
    enemies: room.enemies.size,
  });
}

function damagePlayer(room, player, amount, source, attacker = null) {
  if (!player.alive || player.evading) return;
  player.lastDamageAt = room.elapsed;
  let remaining = Math.max(0, amount);
  const shieldDamage = Math.min(player.shield, remaining);
  player.shield -= shieldDamage;
  remaining -= shieldDamage;
  const hullDamage = Math.min(player.health, remaining);
  player.health -= hullDamage;
  if (player.health <= 0) {
    player.health = 0;
    player.alive = false;
    player.velocity = [0, 0, 0];
    player.deaths += 1;
    player.respawnAt = Date.now() + PVP_RESPAWN_MS;
    if (attacker && attacker.id !== player.id) {
      attacker.kills += 1;
      attacker.score += PVP_KILL_SCORE;
      attacker.missiles = PLAYER_CONFIG.missileAmmo;
      room.kills += 1;
      room.score += PVP_KILL_SCORE;
    }
    broadcast(room, {
      type: 'event',
      event: 'playerDestroyed',
      playerId: player.id,
      playerName: player.name,
      killerId: attacker?.id ?? null,
      killerName: attacker?.name ?? 'Unknown',
      position: player.position,
      respawnSeconds: PVP_RESPAWN_MS / 1000,
      missilesRefilled: Boolean(attacker && attacker.id !== player.id),
    });
  }
  broadcast(room, {
    type: 'event',
    event: 'playerHit',
    playerId: player.id,
    amount,
    shieldDamage,
    hullDamage,
    dead: !player.alive,
    attackerId: attacker?.id ?? null,
    source,
  });
}

function rewardEnemyKill(room, enemy, player) {
  room.score += enemy.scoreValue;
  room.kills += 1;
  if (player) {
    player.score += enemy.scoreValue;
    player.kills += 1;
  }
  room.enemies.delete(enemy.id);
  broadcast(room, {
    type: 'event',
    event: 'enemyDestroyed',
    enemyId: enemy.id,
    enemyType: enemy.type,
    position: enemy.position,
    reward: enemy.scoreValue,
    playerId: player?.id ?? null,
  });
}

function damageEnemy(room, enemy, amount, player) {
  if (!enemy || amount <= 0) return;
  enemy.health = Math.max(0, enemy.health - amount);
  broadcast(room, {
    type: 'event',
    event: 'enemyHit',
    enemyId: enemy.id,
    position: enemy.position,
    amount,
    playerId: player?.id ?? null,
  });
  if (enemy.health <= 0) rewardEnemyKill(room, enemy, player);
}

function nearestAlivePlayer(room, position) {
  let selected = null;
  let selectedDistance = Infinity;
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const currentDistance = distance(position, player.position);
    if (currentDistance < selectedDistance) {
      selected = player;
      selectedDistance = currentDistance;
    }
  }
  return { player: selected, distance: selectedDistance };
}

function updateEnemy(room, enemy, deltaTime) {
  enemy.time += deltaTime;
  enemy.fireTimer -= deltaTime;
  const target = nearestAlivePlayer(room, enemy.position);
  if (!target.player) return;

  const toPlayer = normalize(subtract(target.player.position, enemy.position));
  const distanceError = clamp(
    (target.distance - enemy.preferredDistance) / Math.max(1, enemy.preferredDistance),
    -1,
    1,
  );
  const side = normalize([-toPlayer[2], Math.sin(enemy.seed) * 0.18, toPlayer[0]]);
  const steering = normalize([
    toPlayer[0] * distanceError + side[0] * 0.82 + Math.sin(enemy.time * 1.7 + enemy.seed) * 0.18,
    toPlayer[1] * distanceError + side[1] * 0.82 + Math.cos(enemy.time * 1.3 + enemy.seed) * 0.12,
    toPlayer[2] * distanceError + side[2] * 0.82,
  ]);

  const desiredVelocity = steering.map((component) => component * enemy.speed);
  const blend = 1 - Math.exp(
    -(enemy.acceleration / Math.max(1, enemy.speed)) * deltaTime,
  );
  for (let axis = 0; axis < 3; axis += 1) {
    enemy.velocity[axis] += (desiredVelocity[axis] - enemy.velocity[axis]) * blend;
  }
  addScaled(enemy.position, enemy.velocity, deltaTime);
  const centerDistance = length(enemy.position);
  if (centerDistance > GAME_CONFIG.arenaRadius - enemy.radius) {
    const inward = normalize(enemy.position);
    enemy.position = inward.map(
      (component) => component * (GAME_CONFIG.arenaRadius - enemy.radius),
    );
    const outwardSpeed = dot(enemy.velocity, inward);
    if (outwardSpeed > 0) addScaled(enemy.velocity, inward, -outwardSpeed);
  }

  if (enemy.fireTimer <= 0 && target.distance <= enemy.attackRange) {
    enemy.fireTimer = enemy.fireCooldown * (0.82 + Math.random() * 0.36);
    const aimDirection = normalize(subtract(target.player.position, enemy.position));
    broadcast(room, {
      type: 'event',
      event: 'enemyFire',
      enemyId: enemy.id,
      position: enemy.position,
      direction: aimDirection,
      damage: enemy.damage,
    });
    const accuracy = enemy.type === 'boss' ? 0.84 : enemy.type === 'heavy' ? 0.72 : 0.62;
    if (Math.random() < accuracy) {
      damagePlayer(room, target.player, enemy.damage, enemy.position);
    }
  }
}

function updatePendingMissiles(room, now) {
  for (let index = room.missiles.length - 1; index >= 0; index -= 1) {
    const missile = room.missiles[index];
    if (now < missile.impactAt) continue;
    room.missiles.splice(index, 1);
    const target = room.players.get(missile.targetId);
    if (!target?.alive) continue;
    const player = room.players.get(missile.playerId);
    const impactPosition = [...target.position];
    for (const candidate of room.players.values()) {
      if (!candidate.alive || candidate.id === player?.id) continue;
      const impactDistance = distance(candidate.position, impactPosition);
      if (impactDistance > WEAPON_CONFIG.missile.splashRadius + PLAYER_CONFIG.radius) {
        continue;
      }
      const falloff = Math.max(
        0.22,
        1 - impactDistance / WEAPON_CONFIG.missile.splashRadius,
      );
      const damage =
        candidate.id === target.id
          ? WEAPON_CONFIG.missile.damage
          : WEAPON_CONFIG.missile.splashDamage * falloff;
      damagePlayer(room, candidate, damage, impactPosition, player);
    }
    broadcast(room, {
      type: 'event',
      event: 'missileImpact',
      position: impactPosition,
      playerId: player?.id ?? null,
    });
  }
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    position: player.position,
    quaternion: player.quaternion,
    velocity: player.velocity,
    health: Math.round(player.health * 10) / 10,
    shield: Math.round(player.shield * 10) / 10,
    missiles: player.missiles,
    alive: player.alive,
    boosting: player.boosting,
    score: player.score,
    kills: player.kills,
    deaths: player.deaths,
    respawnAt: player.respawnAt,
  };
}

function serializeEnemy(enemy) {
  return {
    id: enemy.id,
    type: enemy.type,
    position: enemy.position,
    velocity: enemy.velocity,
    health: Math.round(enemy.health * 10) / 10,
    maxHealth: enemy.maxHealth,
  };
}

function createSnapshot(room, now = Date.now()) {
  return {
    type: 'snapshot',
    serverTime: now,
    roomCode: room.code,
    state: room.state,
    countdown: Math.max(0, (room.countdownUntil - now) / 1000),
    players: [...room.players.values()].map(serializePlayer),
    enemies: [...room.enemies.values()].map(serializeEnemy),
    pickups: [...room.pickups.values()].map((pickup) => ({
      id: pickup.id,
      type: pickup.type,
      position: pickup.position,
      expiresAt: pickup.expiresAt,
    })),
    wave: room.wave,
    score: room.score,
    kills: room.kills,
    elapsed: room.elapsed,
    intermission: room.state === 'intermission',
  };
}

function updateRoom(room, now) {
  const deltaTime = clamp((now - room.lastTickAt) / 1000, 0, 0.1);
  room.lastTickAt = now;
  if (room.players.size === 0) {
    if (!room.emptySince) room.emptySince = now;
    return;
  }
  room.emptySince = 0;

  for (const player of room.players.values()) {
    if (!player.alive && player.respawnAt > 0 && now >= player.respawnAt) {
      respawnPlayer(room, player);
    }
    if (
      player.alive &&
      room.elapsed - player.lastDamageAt >= PLAYER_CONFIG.shieldRegenDelay
    ) {
      player.shield = Math.min(
        PLAYER_CONFIG.maxShield,
        player.shield + PLAYER_CONFIG.shieldRegenRate * deltaTime,
      );
    }
  }

  if (room.state === 'countdown' && now >= room.countdownUntil) {
    room.state = 'playing';
  }

  if (room.state === 'playing') {
    room.elapsed += deltaTime;
    updatePendingMissiles(room, now);
    updatePickups(room, now);
  }

  broadcast(room, createSnapshot(room, now));
}

function handleTransform(room, player, message) {
  if (!player.alive) return;
  const now = Date.now();
  const elapsed = clamp((now - player.lastTransformAt) / 1000, 0.01, 0.5);
  const requestedPosition = sanitizeVector(message.position, player.position);
  const offset = subtract(requestedPosition, player.position);
  const maximumDistance = PLAYER_CONFIG.boostSpeed * elapsed * 1.8 + 10;
  limit(offset, maximumDistance);
  player.position = addScaled([...player.position], offset, 1);
  const centerDistance = length(player.position);
  if (centerDistance > GAME_CONFIG.arenaRadius) {
    const direction = normalize(player.position);
    player.position = direction.map(
      (component) => component * GAME_CONFIG.arenaRadius,
    );
  }
  player.quaternion = sanitizeQuaternion(message.quaternion);
  player.velocity = limit(
    sanitizeVector(message.velocity, player.velocity),
    PLAYER_CONFIG.boostSpeed * 1.25,
  );
  player.boosting = Boolean(message.boosting);
  player.evading = Boolean(message.evading);
  player.lastTransformAt = now;
  player.lastSeenAt = now;
}

function raySphereDistance(origin, direction, center, radius) {
  const toCenter = subtract(center, origin);
  const projection = dot(toCenter, direction);
  if (projection < 0) return Infinity;
  const perpendicularSquared = dot(toCenter, toCenter) - projection * projection;
  if (perpendicularSquared > radius * radius) return Infinity;
  const offset = Math.sqrt(Math.max(0, radius * radius - perpendicularSquared));
  return Math.max(0, projection - offset);
}

function handleFire(room, player, message) {
  const now = Date.now();
  if (
    room.state !== 'playing' ||
    !player.alive ||
    now - player.lastFireAt < PLAYER_CONFIG.fireCooldown * 900
  ) {
    return;
  }
  player.lastFireAt = now;
  const origin = sanitizeVector(message.position, player.position);
  if (distance(origin, player.position) > 12) origin.splice(0, 3, ...player.position);
  const direction = normalize(sanitizeVector(message.direction, [0, 0, -1]));
  let selected = null;
  let selectedDistance = Infinity;
  for (const candidate of room.players.values()) {
    if (candidate.id === player.id || !candidate.alive) continue;
    const hitDistance = raySphereDistance(
      origin,
      direction,
      candidate.position,
      PLAYER_CONFIG.radius +
        WEAPON_CONFIG.playerLaser.radius +
        PVP_LASER_GRACE_RADIUS,
    );
    if (hitDistance < selectedDistance && hitDistance <= 560) {
      selected = candidate;
      selectedDistance = hitDistance;
    }
  }
  broadcast(room, {
    type: 'event',
    event: 'laser',
    playerId: player.id,
    position: origin,
    direction,
    hitPlayerId: selected?.id ?? null,
  }, player.socket);
  if (selected) {
    damagePlayer(room, selected, WEAPON_CONFIG.playerLaser.damage, origin, player);
  }
}

function handleMissile(room, player, message) {
  const now = Date.now();
  if (
    room.state !== 'playing' ||
    !player.alive ||
    player.missiles <= 0 ||
    now - player.lastMissileAt < PLAYER_CONFIG.missileCooldown * 1000
  ) {
    return;
  }
  const target = room.players.get(String(message.targetId ?? ''));
  if (
    !target ||
    target.id === player.id ||
    !target.alive ||
    distance(player.position, target.position) > GAME_CONFIG.lockRange + 40
  ) {
    return;
  }
  player.lastMissileAt = now;
  player.missiles -= 1;
  const travelSeconds = clamp(
    distance(player.position, target.position) / WEAPON_CONFIG.missile.maxSpeed,
    0.55,
    WEAPON_CONFIG.missile.lifetime,
  );
  room.missiles.push({
    playerId: player.id,
    targetId: target.id,
    impactAt: now + travelSeconds * 1000,
  });
  broadcast(room, {
    type: 'event',
    event: 'missile',
    playerId: player.id,
    targetId: target.id,
    position: player.position,
  }, player.socket);
}

function handleClientMessage(socket, data) {
  const rateNow = Date.now();
  if (!socket.rateWindowAt || rateNow - socket.rateWindowAt >= 1000) {
    socket.rateWindowAt = rateNow;
    socket.rateCount = 0;
  }
  socket.rateCount += 1;
  if (socket.rateCount > 120) {
    socket.close(1008, 'Message rate exceeded');
    return;
  }
  if (typeof data !== 'string' && !Buffer.isBuffer(data)) return;
  if (Buffer.byteLength(data) > MAX_MESSAGE_BYTES) {
    socket.close(1009, 'Message too large');
    return;
  }
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    return;
  }

  if (message.type === 'join' && !socket.playerId) {
    const requestedCode = sanitizeRoomCode(message.roomCode);
    let room = requestedCode ? rooms.get(requestedCode) : findQuickRoom();
    if (!room && requestedCode) room = createRoom(requestedCode);
    if (!room || room.players.size >= MAX_PLAYERS) {
      safeSend(socket, {
        type: 'error',
        code: 'ROOM_FULL',
        message: 'That squad is full. Use another room code.',
      });
      return;
    }
    const player = createPlayer(socket, message.name, room.players.size);
    room.players.set(player.id, player);
    socket.playerId = player.id;
    socket.roomCode = room.code;
    if (room.wave === 0) room.wave = 1;
    safeSend(socket, {
      type: 'welcome',
      playerId: player.id,
      roomCode: room.code,
      maxPlayers: MAX_PLAYERS,
      snapshot: createSnapshot(room),
    });
    broadcast(room, {
      type: 'event',
      event: 'playerJoined',
      player: serializePlayer(player),
      playerCount: room.players.size,
    }, socket);
    return;
  }

  const room = rooms.get(socket.roomCode);
  const player = room?.players.get(socket.playerId);
  if (!room || !player) return;
  player.lastSeenAt = Date.now();

  if (message.type === 'state') handleTransform(room, player, message);
  else if (message.type === 'fire') handleFire(room, player, message);
  else if (message.type === 'missile') handleMissile(room, player, message);
  else if (message.type === 'restart') resetRoom(room);
  else if (message.type === 'ping') {
    safeSend(socket, { type: 'pong', sentAt: Number(message.sentAt) || Date.now() });
  }
}

function removeSocket(socket) {
  const room = rooms.get(socket.roomCode);
  if (!room || !socket.playerId) return;
  const player = room.players.get(socket.playerId);
  room.players.delete(socket.playerId);
  if (player) {
    broadcast(room, {
      type: 'event',
      event: 'playerLeft',
      playerId: player.id,
      name: player.name,
      playerCount: room.players.size,
    });
  }
  if (room.players.size === 0) room.emptySince = Date.now();
}

function serveStatic(request, response) {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      players: [...rooms.values()].reduce((total, room) => total + room.players.size, 0),
    }));
    return;
  }

  if (!existsSync(DIST_ROOT)) {
    response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Client build missing. Run npm run build before starting production.');
    return;
  }

  const pathname = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`).pathname;
  const requestedPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  let filePath = resolve(DIST_ROOT, `.${requestedPath}`);
  if (!filePath.startsWith(`${DIST_ROOT}${sep}`) && filePath !== DIST_ROOT) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = resolve(DIST_ROOT, 'index.html');
  }
  const extension = extname(filePath).toLowerCase();
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'cache-control': extension === '.html'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(serveStatic);
const websocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_MESSAGE_BYTES,
  perMessageDeflate: false,
});

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(
    request.url,
    `http://${request.headers.host ?? 'localhost'}`,
  ).pathname;
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const requestHost = request.headers.host;
  const requestOrigin = request.headers.origin;
  if (requestOrigin && requestHost) {
    try {
      const originHost = new URL(requestOrigin).host;
      const allowedOrigins = String(process.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (
        originHost !== requestHost &&
        !allowedOrigins.includes(requestOrigin)
      ) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    } catch {
      socket.destroy();
      return;
    }
  }
  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    websocketServer.emit('connection', websocket, request);
  });
});

websocketServer.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });
  socket.on('message', (data) => handleClientMessage(socket, data));
  socket.on('close', () => removeSocket(socket));
  socket.on('error', () => removeSocket(socket));
  safeSend(socket, { type: 'hello', protocol: 1, tickRate: TICK_RATE });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    updateRoom(room, now);
    if (room.emptySince && now - room.emptySince > 60_000) rooms.delete(code);
  }
}, TICK_MS).unref();

setInterval(() => {
  for (const socket of websocketServer.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 20_000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nebula Strike multiplayer server listening on port ${PORT}`);
});

function shutdown() {
  for (const socket of websocketServer.clients) socket.close(1001, 'Server restart');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
