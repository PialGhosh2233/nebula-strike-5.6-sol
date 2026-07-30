import WebSocket from 'ws';

const URL = process.env.TEST_WS_URL || 'ws://127.0.0.1:3001/ws';
const timeout = (milliseconds, message) =>
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), milliseconds).unref();
  });
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function createClient(name, roomCode = '') {
  const socket = new WebSocket(URL);
  const messages = [];
  const waiters = [];

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.predicate(message)) {
        waiters.splice(index, 1);
        waiter.resolve(message);
      }
    }
  });

  const waitFor = (predicate, milliseconds = 6000) =>
    Promise.race([
      new Promise((resolve) => {
        const existing = messages.find(predicate);
        if (existing) resolve(existing);
        else waiters.push({ predicate, resolve });
      }),
      timeout(milliseconds, `Timed out waiting for ${name} message.`),
    ]);

  const opened = new Promise((resolve, reject) => {
    socket.once('open', () => {
      socket.send(JSON.stringify({ type: 'join', name, roomCode }));
      resolve();
    });
    socket.once('error', reject);
  });

  return { socket, messages, waitFor, opened };
}

function direction(from, to) {
  const vector = to.map((value, index) => value - from[index]);
  const magnitude = Math.hypot(...vector);
  return vector.map((value) => value / magnitude);
}

function distance(from, to) {
  return Math.hypot(...to.map((value, index) => value - from[index]));
}

const alpha = createClient('Alpha');
await alpha.opened;
const alphaWelcome = await alpha.waitFor((message) => message.type === 'welcome');

const bravo = createClient('Bravo', alphaWelcome.roomCode);
await bravo.opened;
const bravoWelcome = await bravo.waitFor((message) => message.type === 'welcome');

if (alphaWelcome.roomCode !== bravoWelcome.roomCode) {
  throw new Error('Players did not join the same room.');
}

const joined = await alpha.waitFor(
  (message) =>
    message.type === 'event' &&
    message.event === 'playerJoined' &&
    message.player?.name === 'Bravo',
);
if (joined.playerCount !== 2) throw new Error('Room player count did not reach two.');

const liveSnapshot = await alpha.waitFor(
  (message) => {
    if (
      message.type !== 'snapshot' ||
      message.state !== 'playing' ||
      message.players?.length !== 2
    ) {
      return false;
    }
    return true;
  },
  15000,
);

const alphaState = liveSnapshot.players.find(
  (player) => player.id === alphaWelcome.playerId,
);
const target = liveSnapshot.players.find(
  (player) => player.id === bravoWelcome.playerId,
);
alpha.socket.send(JSON.stringify({
  type: 'state',
  position: alphaState.position,
  quaternion: alphaState.quaternion,
  velocity: alphaState.velocity,
  boosting: false,
}));
alpha.socket.send(JSON.stringify({
  type: 'fire',
  position: alphaState.position,
  direction: direction(alphaState.position, target.position),
}));

await alpha.waitFor(
  (message) =>
    message.type === 'event' &&
    message.event === 'playerHit' &&
    message.playerId === bravoWelcome.playerId &&
    message.attackerId === alphaWelcome.playerId,
);

alpha.socket.send(JSON.stringify({
  type: 'missile',
  targetId: target.id,
}));
const missileSnapshot = await alpha.waitFor(
  (message) => {
    if (message.type !== 'snapshot') return false;
    const player = message.players?.find(
      (candidate) => candidate.id === alphaWelcome.playerId,
    );
    return player?.missiles === 5;
  },
);
if (!missileSnapshot) throw new Error('Missile ammunition was not authoritative.');

for (let shot = 0; shot < 12; shot += 1) {
  alpha.socket.send(JSON.stringify({
    type: 'fire',
    position: alphaState.position,
    direction: direction(alphaState.position, target.position),
  }));
  await delay(115);
}

await alpha.waitFor(
  (message) =>
    message.type === 'event' &&
    message.event === 'playerDestroyed' &&
    message.playerId === bravoWelcome.playerId &&
    message.killerId === alphaWelcome.playerId,
  6000,
);
await alpha.waitFor(
  (message) => {
    if (message.type !== 'snapshot') return false;
    const alphaPlayer = message.players?.find(
      (candidate) => candidate.id === alphaWelcome.playerId,
    );
    const bravoPlayer = message.players?.find(
      (candidate) => candidate.id === bravoWelcome.playerId,
    );
    return alphaPlayer?.kills === 1 &&
      alphaPlayer?.score === 1000 &&
      alphaPlayer?.missiles === 6 &&
      bravoPlayer?.alive === true &&
      bravoPlayer?.deaths === 1;
  },
  8000,
);

const pickupSnapshot = await alpha.waitFor(
  (message) =>
    message.type === 'snapshot' &&
    message.pickups?.some((pickup) => pickup.type === 'missile'),
  8000,
);
const supply = pickupSnapshot.pickups.find((pickup) => pickup.type === 'missile');
const alphaBeforePickup = pickupSnapshot.players.find(
  (player) => player.id === alphaWelcome.playerId,
);
alpha.socket.send(JSON.stringify({
  type: 'missile',
  targetId: bravoWelcome.playerId,
}));
await alpha.waitFor(
  (message) => {
    if (
      message.type !== 'snapshot' ||
      message.serverTime <= pickupSnapshot.serverTime
    ) return false;
    const player = message.players?.find(
      (candidate) => candidate.id === alphaWelcome.playerId,
    );
    return player?.missiles === 5;
  },
);

const supplyDistance = distance(alphaBeforePickup.position, supply.position);
const movementSteps = Math.max(1, Math.ceil(supplyDistance / 24));
for (let step = 1; step <= movementSteps; step += 1) {
  const progress = step / movementSteps;
  alpha.socket.send(JSON.stringify({
    type: 'state',
    position: alphaBeforePickup.position.map(
      (value, index) => value + (supply.position[index] - value) * progress,
    ),
    quaternion: alphaBeforePickup.quaternion,
    velocity: [0, 0, 0],
    boosting: false,
  }));
  await delay(110);
}
await alpha.waitFor(
  (message) =>
    message.type === 'event' &&
    message.event === 'pickupCollected' &&
    message.pickupId === supply.id &&
    message.playerId === alphaWelcome.playerId &&
    message.missiles === 6,
);

const sentAt = Date.now();
alpha.socket.send(JSON.stringify({ type: 'ping', sentAt }));
const pong = await alpha.waitFor(
  (message) => message.type === 'pong' && message.sentAt === sentAt,
);
if (!pong) throw new Error('Application ping/pong failed.');

bravo.socket.close();
await alpha.waitFor(
  (message) =>
    message.type === 'event' &&
    message.event === 'playerLeft' &&
    message.playerId === bravoWelcome.playerId,
);

alpha.socket.send(JSON.stringify({ type: 'restart' }));
await alpha.waitFor(
  (message) => message.type === 'event' && message.event === 'roomReset',
);
await alpha.waitFor(
  (message) =>
    message.type === 'snapshot' &&
    message.state === 'countdown' &&
    message.wave === 1,
);

alpha.socket.close();
console.log(JSON.stringify({
  passed: true,
  roomCode: alphaWelcome.roomCode,
  playersTested: 2,
  wave: liveSnapshot.wave,
  opponents: liveSnapshot.players.length - 1,
  checks: [
    'join-room',
    'two-player-snapshot',
    'authoritative-pvp-laser-hit',
    'authoritative-missile-ammo',
    'pvp-kill-credit',
    'kill-missile-refill',
    'automatic-respawn',
    'random-missile-drop',
    'missile-drop-collection',
    'ping-pong',
    'disconnect-event',
    'room-restart',
  ],
}, null, 2));
