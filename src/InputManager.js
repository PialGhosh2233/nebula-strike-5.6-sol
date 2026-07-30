export class InputManager {
  constructor(canvas, onPause, onPointerLockChange = null) {
    this.canvas = canvas;
    this.onPause = onPause;
    this.onPointerLockChange = onPointerLockChange;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.pointerLocked = false;

    this._onKeyDown = this.#onKeyDown.bind(this);
    this._onKeyUp = this.#onKeyUp.bind(this);
    this._onMouseMove = this.#onMouseMove.bind(this);
    this._onPointerLock = this.#onPointerLock.bind(this);
    this._onBlur = this.clear.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLock);
  }

  #onKeyDown(event) {
    const gameplayCodes = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyQ',
      'KeyE',
      'Space',
      'ShiftLeft',
      'ShiftRight',
    ]);
    if (gameplayCodes.has(event.code)) event.preventDefault();

    if (!event.repeat) this.pressed.add(event.code);
    this.keys.add(event.code);

    if (event.code === 'Escape' && !event.repeat) {
      this.onPause?.();
    }
  }

  #onKeyUp(event) {
    this.keys.delete(event.code);
  }

  #onMouseMove(event) {
    if (!this.pointerLocked) return;
    this.mouseDeltaX += event.movementX;
    this.mouseDeltaY += event.movementY;
  }

  #onPointerLock() {
    const wasLocked = this.pointerLocked;
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) {
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
    }
    this.onPointerLockChange?.(this.pointerLocked, wasLocked);
  }

  isDown(code) {
    return this.keys.has(code);
  }

  consumePressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  consumeMouseDelta(out = { x: 0, y: 0 }) {
    out.x = this.mouseDeltaX;
    out.y = this.mouseDeltaY;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return out;
  }

  requestPointerLock() {
    if (document.pointerLockElement !== this.canvas) {
      try {
        const request = this.canvas.requestPointerLock?.();
        request?.catch?.(() => {
          // Pointer lock is optional and may be denied outside a user gesture.
        });
      } catch {
        // Keyboard steering remains fully available without pointer lock.
      }
    }
  }

  releasePointerLock() {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
  }

  clear() {
    this.keys.clear();
    this.pressed.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }

  endFrame() {
    this.pressed.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLock);
    this.clear();
  }
}
