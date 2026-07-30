const RECONNECT_DELAYS = [1000, 2000, 4000, 7000];

function websocketUrl() {
  const configured = import.meta.env.VITE_WS_URL?.trim();
  if (configured) return configured;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = import.meta.env.DEV
    ? ':3001'
    : window.location.port
      ? `:${window.location.port}`
      : '';
  return `${protocol}//${window.location.hostname}${port}/ws`;
}

export class NetworkManager {
  constructor(callbacks = {}) {
    this.callbacks = {
      onWelcome: callbacks.onWelcome ?? (() => {}),
      onSnapshot: callbacks.onSnapshot ?? (() => {}),
      onEvent: callbacks.onEvent ?? (() => {}),
      onStatus: callbacks.onStatus ?? (() => {}),
    };
    this.socket = null;
    this.playerId = null;
    this.roomCode = '';
    this.playerName = '';
    this.connected = false;
    this.connecting = false;
    this.manualClose = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.latency = 0;
    this.lastStateSentAt = 0;
    this.disposed = false;
    this._connectResolve = null;
    this._connectReject = null;
  }

  connect({ name, roomCode = '' }) {
    if (this.disposed) {
      return Promise.reject(new Error('Network manager is disposed.'));
    }
    this.disconnect(false);
    this.playerName = String(name || 'Pilot').slice(0, 16);
    this.roomCode = String(roomCode || '').toUpperCase().slice(0, 8);
    this.manualClose = false;
    this.reconnectAttempt = 0;
    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;
      this.#openSocket();
    });
  }

  #openSocket() {
    if (this.disposed || this.manualClose || this.connecting) return;
    this.connecting = true;
    this.callbacks.onStatus({
      state: this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      roomCode: this.roomCode,
      latency: this.latency,
    });

    let socket;
    try {
      socket = new WebSocket(websocketUrl());
    } catch (error) {
      this.connecting = false;
      this.#handleConnectFailure(error);
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (socket !== this.socket) return;
      this.connecting = false;
      this.#send({
        type: 'join',
        name: this.playerName,
        roomCode: this.roomCode,
      });
    });

    socket.addEventListener('message', (event) => {
      if (socket !== this.socket) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      this.#handleMessage(message);
    });

    socket.addEventListener('close', () => {
      if (socket !== this.socket) return;
      this.connected = false;
      this.connecting = false;
      this.#stopPing();
      this.callbacks.onStatus({
        state: this.manualClose ? 'offline' : 'reconnecting',
        roomCode: this.roomCode,
        latency: this.latency,
      });
      if (!this.manualClose && !this.disposed) this.#scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      if (!this.connected && this._connectReject) {
        const reject = this._connectReject;
        this._connectResolve = null;
        this._connectReject = null;
        reject(new Error('Could not reach the multiplayer server.'));
      }
    });
  }

  #handleMessage(message) {
    if (message.type === 'welcome') {
      const wasReconnect = this.reconnectAttempt > 0;
      this.playerId = message.playerId;
      this.roomCode = message.roomCode;
      this.connected = true;
      this.connecting = false;
      this.reconnectAttempt = 0;
      this.callbacks.onWelcome({ ...message, reconnected: wasReconnect });
      this.callbacks.onStatus({
        state: 'online',
        roomCode: this.roomCode,
        latency: this.latency,
        playerCount: message.snapshot?.players?.length ?? 1,
      });
      this.#startPing();
      if (this._connectResolve) {
        this._connectResolve(message);
        this._connectResolve = null;
        this._connectReject = null;
      }
    } else if (message.type === 'snapshot') {
      this.callbacks.onSnapshot(message);
      this.callbacks.onStatus({
        state: 'online',
        roomCode: this.roomCode,
        latency: this.latency,
        playerCount: message.players?.length ?? 1,
      });
    } else if (message.type === 'event') {
      this.callbacks.onEvent(message);
    } else if (message.type === 'pong') {
      this.latency = Math.max(0, Math.round(performance.now() - message.sentAt));
    } else if (message.type === 'error') {
      const error = new Error(message.message || 'Multiplayer server error.');
      error.code = message.code;
      if (this._connectReject) {
        this._connectReject(error);
        this._connectResolve = null;
        this._connectReject = null;
      }
      this.callbacks.onStatus({
        state: 'error',
        message: error.message,
        roomCode: this.roomCode,
      });
    }
  }

  #handleConnectFailure(error) {
    if (this._connectReject) {
      this._connectReject(error);
      this._connectResolve = null;
      this._connectReject = null;
    }
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    if (this.reconnectTimer || this.manualClose || this.disposed) return;
    const delay =
      RECONNECT_DELAYS[
        Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)
      ];
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.#openSocket();
    }, delay);
  }

  #startPing() {
    this.#stopPing();
    this.pingTimer = window.setInterval(() => {
      this.#send({ type: 'ping', sentAt: performance.now() });
    }, 2500);
  }

  #stopPing() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  #send(payload) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  sendPlayerState(player, force = false) {
    if (!this.connected || !player?.alive) return;
    const now = performance.now();
    if (!force && now - this.lastStateSentAt < 50) return;
    this.lastStateSentAt = now;
    this.#send({
      type: 'state',
      position: player.group.position.toArray(),
      quaternion: player.group.quaternion.toArray(),
      velocity: player.velocity.toArray(),
      boosting: player.boosting,
      evading: player.rollTimer > 0,
    });
  }

  sendFire(position, direction) {
    return this.#send({
      type: 'fire',
      position: position.toArray(),
      direction: direction.toArray(),
    });
  }

  sendMissile(targetId) {
    return this.#send({ type: 'missile', targetId });
  }

  requestRestart() {
    return this.#send({ type: 'restart' });
  }

  disconnect(manual = true) {
    this.manualClose = manual;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.#stopPing();
    if (this.socket) {
      this.socket.close(1000, 'Client leaving');
      this.socket = null;
    }
    this.connected = false;
    this.connecting = false;
    this.playerId = null;
  }

  dispose() {
    this.disposed = true;
    this.disconnect(true);
  }
}

export default NetworkManager;
