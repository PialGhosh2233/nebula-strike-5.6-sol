const NOOP = () => {};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const asFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const formatScore = (value) => {
  const score = Math.max(0, Math.round(asFiniteNumber(value)));
  return String(score).padStart(6, "0");
};

const formatCount = (value, minimumLength = 2) => {
  const count = Math.max(0, Math.round(asFiniteNumber(value)));
  return String(count).padStart(minimumLength, "0");
};

const formatTime = (value) => {
  if (typeof value === "string") {
    return value;
  }

  const totalSeconds = Math.max(0, Math.floor(asFiniteNumber(value)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/**
 * Owns the HTML HUD and screen transitions. Game systems only need to pass plain
 * state objects to this class; no game logic is coupled to DOM selectors.
 */
export class UIManager {
  constructor(callbacks = {}) {
    this.callbacks = {
      onStart: callbacks.onStart ?? NOOP,
      onRestart: callbacks.onRestart ?? NOOP,
      onResume: callbacks.onResume ?? NOOP,
      onMute: callbacks.onMute ?? NOOP,
      onVolume: callbacks.onVolume ?? NOOP,
      onQuality: callbacks.onQuality ?? NOOP,
      onPointerLock: callbacks.onPointerLock ?? NOOP,
    };

    this.elements = this.#cacheElements();
    this.listeners = [];
    this.timers = new Map();
    this.popupTimers = new Map();
    this.muted = false;
    this.volume = asFiniteNumber(this.elements.volumeSlider?.value, 0.7);
    this.quality = this.elements.qualitySelect?.value ?? "high";
    this.disposed = false;
    this.metricState = {
      health: 100,
      maxHealth: 100,
      shield: 100,
      maxShield: 100,
      boost: 100,
      maxBoost: 100,
    };
    this.hudState = {
      score: 0,
      highScore: 0,
      wave: 1,
      enemies: 0,
      kills: 0,
      time: 0,
      missiles: 6,
    };

    this.#bindControls();
    this.setMuted(false);
    this.setVolume(this.volume);
    this.setQuality(this.quality);
    this.setPointerLocked(false);
  }

  #cacheElements() {
    const byId = (id) => document.getElementById(id);

    return {
      root: byId("game-root"),
      canvas: byId("game-canvas"),
      hud: byId("hud"),
      mainMenu: byId("main-menu"),
      pauseScreen: byId("pause-screen"),
      gameOverScreen: byId("game-over-screen"),
      countdownOverlay: byId("countdown-overlay"),
      countdownValue: byId("countdown-value"),
      webglError: byId("webgl-error"),
      webglErrorMessage: byId("webgl-error-message"),

      startButton: byId("start-button"),
      restartButton: byId("restart-button"),
      pauseRestartButton: byId("pause-restart-button"),
      resumeButton: byId("pause-resume-button"),

      scoreValue: byId("score-value"),
      highScoreValue: byId("high-score-value"),
      waveValue: byId("wave-value"),
      enemyCountValue: byId("enemy-count-value"),
      killCountValue: byId("kill-count-value"),
      timerValue: byId("timer-value"),
      missileCountValue: byId("missile-count-value"),
      flightStatus: byId("flight-status"),

      healthFill: byId("health-fill"),
      healthValue: byId("health-value"),
      healthTrack: byId("health-fill")?.parentElement ?? null,
      healthMeter: byId("health-fill")?.closest(".meter") ?? null,
      shieldFill: byId("shield-fill"),
      shieldValue: byId("shield-value"),
      shieldTrack: byId("shield-fill")?.parentElement ?? null,
      shieldMeter: byId("shield-fill")?.closest(".meter") ?? null,
      boostFill: byId("boost-fill"),
      boostValue: byId("boost-value"),
      boostTrack: byId("boost-fill")?.parentElement ?? null,
      boostMeter: byId("boost-fill")?.closest(".meter") ?? null,

      crosshair: byId("crosshair"),
      lockStatus: byId("missile-lock-status"),
      bossBar: byId("boss-bar"),
      bossName: byId("boss-name"),
      bossHealthFill: byId("boss-health-fill"),
      bossHealthValue: byId("boss-health-value"),
      bossHealthTrack: byId("boss-health-fill")?.parentElement ?? null,

      waveAnnouncement: byId("wave-announcement"),
      waveAnnouncementTitle: byId("wave-announcement-title"),
      waveAnnouncementSubtitle: byId("wave-announcement-subtitle"),
      hitMarker: byId("hit-marker"),
      damageIndicator: byId("damage-indicator"),
      damageVignette: byId("damage-vignette"),
      scorePopups: byId("score-popups"),

      gameOverScore: byId("game-over-score"),
      gameOverRecord: byId("game-over-record"),
      gameOverWave: byId("game-over-wave"),
      gameOverKills: byId("game-over-kills"),
      gameOverTime: byId("game-over-time"),

      settingsPanel: byId("settings-panel"),
      muteButton: byId("mute-button"),
      volumeSlider: byId("volume-slider"),
      volumeValue: byId("volume-value"),
      qualitySelect: byId("quality-select"),
      pointerLockButton: byId("pointer-lock-button"),
    };
  }

  #listen(element, type, listener, options) {
    if (!element) {
      return;
    }

    element.addEventListener(type, listener, options);
    this.listeners.push({ element, type, listener, options });
  }

  #bindControls() {
    this.#listen(this.elements.startButton, "click", () => this.callbacks.onStart());
    this.#listen(this.elements.restartButton, "click", () => this.callbacks.onRestart());
    this.#listen(this.elements.pauseRestartButton, "click", () => this.callbacks.onRestart());
    this.#listen(this.elements.resumeButton, "click", () => this.callbacks.onResume());

    this.#listen(this.elements.muteButton, "click", () => {
      const nextMuted = !this.muted;
      this.setMuted(nextMuted);
      this.callbacks.onMute(nextMuted);
    });

    this.#listen(this.elements.volumeSlider, "input", (event) => {
      const nextVolume = asFiniteNumber(event.currentTarget.value, this.volume);
      this.setVolume(nextVolume);
      this.callbacks.onVolume(this.volume);
    });

    this.#listen(this.elements.qualitySelect, "change", (event) => {
      this.setQuality(event.currentTarget.value);
      this.callbacks.onQuality(this.quality);
    });

    this.#listen(this.elements.pointerLockButton, "click", () => {
      this.callbacks.onPointerLock();
    });

    this.#listen(document, "pointerlockchange", () => {
      this.setPointerLocked(document.pointerLockElement === this.elements.canvas);
    });
  }

  #setScreen(element, active) {
    if (!element) {
      return;
    }

    element.classList.toggle("is-active", active);
    element.setAttribute("aria-hidden", String(!active));
  }

  #setGameState(state) {
    if (this.elements.root) {
      this.elements.root.dataset.gameState = state;
    }
  }

  #clearTimer(name) {
    const timer = this.timers.get(name);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(name);
    }
  }

  #setTimer(name, callback, duration) {
    this.#clearTimer(name);
    const timer = window.setTimeout(() => {
      this.timers.delete(name);
      callback();
    }, duration);
    this.timers.set(name, timer);
  }

  #restartAnimation(element) {
    if (!element) {
      return;
    }

    element.style.animation = "none";
    void element.offsetWidth;
    element.style.animation = "";
  }

  #focus(element) {
    if (!element || typeof element.focus !== "function") {
      return;
    }

    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }

  showMenu() {
    if (this.disposed) {
      return;
    }

    this.#setGameState("menu");
    this.#setScreen(this.elements.mainMenu, true);
    this.#setScreen(this.elements.pauseScreen, false);
    this.#setScreen(this.elements.gameOverScreen, false);
    this.#setScreen(this.elements.countdownOverlay, false);
    this.#setScreen(this.elements.webglError, false);
    this.#setScreen(this.elements.hud, false);
    this.#setScreen(this.elements.bossBar, false);
    this.#focus(this.elements.startButton);
  }

  showCountdown(value) {
    if (this.disposed) {
      return;
    }

    if (value === null || value === undefined || value === false) {
      this.#setScreen(this.elements.countdownOverlay, false);
      return;
    }

    this.#setGameState("countdown");
    this.#setScreen(this.elements.mainMenu, false);
    this.#setScreen(this.elements.pauseScreen, false);
    this.#setScreen(this.elements.gameOverScreen, false);
    this.#setScreen(this.elements.webglError, false);
    this.#setScreen(this.elements.hud, true);
    this.#setScreen(this.elements.countdownOverlay, true);

    if (this.elements.countdownValue) {
      const numericValue = Number(value);
      this.elements.countdownValue.textContent =
        Number.isFinite(numericValue) && numericValue <= 0 ? "GO" : String(value);
      this.#restartAnimation(this.elements.countdownValue);
    }
  }

  showPlaying() {
    if (this.disposed) {
      return;
    }

    this.#setGameState("playing");
    this.#setScreen(this.elements.mainMenu, false);
    this.#setScreen(this.elements.pauseScreen, false);
    this.#setScreen(this.elements.gameOverScreen, false);
    this.#setScreen(this.elements.countdownOverlay, false);
    this.#setScreen(this.elements.webglError, false);
    this.#setScreen(this.elements.hud, true);
    this.#focus(this.elements.canvas);
  }

  showPause() {
    if (this.disposed) {
      return;
    }

    this.#setGameState("paused");
    this.#setScreen(this.elements.mainMenu, false);
    this.#setScreen(this.elements.gameOverScreen, false);
    this.#setScreen(this.elements.countdownOverlay, false);
    this.#setScreen(this.elements.pauseScreen, true);
    this.#setScreen(this.elements.hud, true);
    this.#focus(this.elements.resumeButton);
  }

  showGameOver(stats = {}) {
    if (this.disposed) {
      return;
    }

    const score = firstDefined(stats.score, stats.finalScore, this.hudState.score, 0);
    const previousHighScore = firstDefined(stats.highScore, stats.bestScore, this.hudState.highScore, 0);
    const highScore = Math.max(asFiniteNumber(score), asFiniteNumber(previousHighScore));
    const wave = firstDefined(stats.wave, stats.waveReached, this.hudState.wave, 1);
    const kills = firstDefined(stats.kills, stats.enemyKills, this.hudState.kills, 0);
    const time = firstDefined(stats.time, stats.survivalTime, stats.elapsedTime, this.hudState.time, 0);

    if (this.elements.gameOverScore) {
      this.elements.gameOverScore.textContent = formatScore(score);
    }
    if (this.elements.gameOverRecord) {
      const isRecord = Boolean(stats.newHighScore) || asFiniteNumber(score) > asFiniteNumber(this.hudState.highScore);
      this.elements.gameOverRecord.textContent = isRecord
        ? `New high score · ${formatScore(highScore)}`
        : `High score · ${formatScore(highScore)}`;
    }
    if (this.elements.gameOverWave) {
      this.elements.gameOverWave.textContent = formatCount(wave);
    }
    if (this.elements.gameOverKills) {
      this.elements.gameOverKills.textContent = formatCount(kills);
    }
    if (this.elements.gameOverTime) {
      this.elements.gameOverTime.textContent = formatTime(time);
    }

    this.#setGameState("game-over");
    this.#setScreen(this.elements.mainMenu, false);
    this.#setScreen(this.elements.pauseScreen, false);
    this.#setScreen(this.elements.countdownOverlay, false);
    this.#setScreen(this.elements.gameOverScreen, true);
    this.#setScreen(this.elements.hud, true);
    this.#focus(this.elements.restartButton);
  }

  updateHUD(data = {}) {
    if (this.disposed || !data) {
      return;
    }

    const player = data.player ?? {};
    const health = firstDefined(data.health, data.playerHealth, player.health, player.hp);
    const maxHealth = firstDefined(data.maxHealth, data.playerMaxHealth, player.maxHealth, player.maxHp);
    const shield = firstDefined(data.shield, data.playerShield, player.shield);
    const maxShield = firstDefined(data.maxShield, data.playerMaxShield, player.maxShield);
    const boost = firstDefined(
      data.boost,
      data.afterburner,
      data.boostEnergy,
      player.boost,
      player.afterburner,
      player.afterburnerEnergy,
    );
    const maxBoost = firstDefined(
      data.maxBoost,
      data.boostMax,
      data.maxAfterburner,
      data.afterburnerMax,
      data.maxBoostEnergy,
      player.maxBoost,
      player.maxAfterburner,
      player.maxAfterburnerEnergy,
    );

    if (maxHealth !== undefined) this.metricState.maxHealth = Math.max(1, asFiniteNumber(maxHealth, 100));
    if (maxShield !== undefined) this.metricState.maxShield = Math.max(1, asFiniteNumber(maxShield, 100));
    if (maxBoost !== undefined) this.metricState.maxBoost = Math.max(1, asFiniteNumber(maxBoost, 100));
    if (health !== undefined) this.metricState.health = asFiniteNumber(health, this.metricState.health);
    if (shield !== undefined) this.metricState.shield = asFiniteNumber(shield, this.metricState.shield);
    if (boost !== undefined) this.metricState.boost = asFiniteNumber(boost, this.metricState.boost);

    if (health !== undefined || maxHealth !== undefined) {
      this.#updateMeter(
        "health",
        this.metricState.health,
        this.metricState.maxHealth,
        this.elements.healthFill,
        this.elements.healthValue,
        this.elements.healthTrack,
        this.elements.healthMeter,
      );
    }
    if (shield !== undefined || maxShield !== undefined) {
      this.#updateMeter(
        "shield",
        this.metricState.shield,
        this.metricState.maxShield,
        this.elements.shieldFill,
        this.elements.shieldValue,
        this.elements.shieldTrack,
        this.elements.shieldMeter,
      );
    }
    if (boost !== undefined || maxBoost !== undefined) {
      this.#updateMeter(
        "boost",
        this.metricState.boost,
        this.metricState.maxBoost,
        this.elements.boostFill,
        this.elements.boostValue,
        this.elements.boostTrack,
        this.elements.boostMeter,
      );
    }

    const score = firstDefined(data.score, data.points);
    const highScore = firstDefined(data.highScore, data.bestScore);
    const wave = firstDefined(data.wave, data.currentWave);
    const enemies = firstDefined(
      data.enemies,
      data.enemiesRemaining,
      data.remainingEnemies,
      data.enemyCount,
    );
    const kills = firstDefined(data.kills, data.enemyKills, data.killCount);
    const time = firstDefined(data.time, data.survivalTime, data.elapsedTime);
    const missiles = firstDefined(
      data.missiles,
      data.missileAmmo,
      data.missilesRemaining,
      player.missiles,
      player.missileAmmo,
    );

    if (score !== undefined) {
      this.hudState.score = score;
      if (this.elements.scoreValue) this.elements.scoreValue.textContent = formatScore(score);
    }
    if (highScore !== undefined) {
      this.hudState.highScore = highScore;
      if (this.elements.highScoreValue) {
        this.elements.highScoreValue.textContent = formatScore(highScore);
      }
    }
    if (wave !== undefined) {
      this.hudState.wave = wave;
      if (this.elements.waveValue) this.elements.waveValue.textContent = formatCount(wave);
    }
    if (enemies !== undefined) {
      this.hudState.enemies = enemies;
      if (this.elements.enemyCountValue) {
        this.elements.enemyCountValue.textContent = formatCount(enemies);
      }
    }
    if (kills !== undefined) {
      this.hudState.kills = kills;
      if (this.elements.killCountValue) {
        this.elements.killCountValue.textContent = formatCount(kills);
      }
    }
    if (time !== undefined) {
      this.hudState.time = time;
      if (this.elements.timerValue) this.elements.timerValue.textContent = formatTime(time);
    }
    if (missiles !== undefined) {
      this.hudState.missiles = missiles;
      if (this.elements.missileCountValue) {
        this.elements.missileCountValue.textContent = formatCount(missiles);
      }
    }

    const lockStatus = firstDefined(
      data.lockStatus,
      data.missileLock,
      data.locked,
      data.targetLocked,
      data.targetLock,
      data.lockProgress,
    );
    if (lockStatus !== undefined) {
      this.#updateLockStatus(lockStatus);
    }

    const status = firstDefined(data.status, data.flightStatus, data.message);
    if (status !== undefined && this.elements.flightStatus) {
      this.elements.flightStatus.textContent = String(status);
    }

    const boss = data.boss;
    const bossHealth = firstDefined(
      data.bossHealth,
      boss?.health,
      boss?.hp,
      boss?.currentHealth,
      boss?.currentHp,
    );
    const bossMaxHealth = firstDefined(
      data.bossMaxHealth,
      boss?.maxHealth,
      boss?.maxHp,
      boss?.healthMax,
      100,
    );
    const bossName = firstDefined(data.bossName, boss?.name, boss?.type);
    const bossVisible = firstDefined(data.bossVisible, boss?.visible);

    if (boss === null || bossVisible === false) {
      this.#setScreen(this.elements.bossBar, false);
    } else if (bossHealth !== undefined || bossVisible === true) {
      const percentage = clamp(asFiniteNumber(bossHealth, bossMaxHealth) / Math.max(1, asFiniteNumber(bossMaxHealth, 100)));

      this.#setScreen(this.elements.bossBar, true);
      if (this.elements.bossHealthFill) {
        this.elements.bossHealthFill.style.width = `${percentage * 100}%`;
      }
      if (this.elements.bossHealthValue) {
        this.elements.bossHealthValue.textContent = `${Math.ceil(percentage * 100)}%`;
      }
      if (this.elements.bossHealthTrack) {
        this.elements.bossHealthTrack.setAttribute("aria-valuenow", String(Math.round(percentage * 100)));
      }
      if (bossName !== undefined && this.elements.bossName) {
        this.elements.bossName.textContent = String(bossName);
      }
    }
  }

  #updateMeter(name, value, maximum, fill, output, track, meter) {
    const percentage = clamp(asFiniteNumber(value) / Math.max(1, asFiniteNumber(maximum, 100)));
    const percentValue = Math.round(percentage * 100);

    if (fill) {
      fill.style.width = `${percentage * 100}%`;
    }
    if (output) {
      output.textContent = `${Math.ceil(percentage * 100)}%`;
    }
    if (track) {
      track.setAttribute("aria-valuenow", String(percentValue));
    }
    if (meter) {
      meter.classList.toggle("is-critical", name === "health" && percentage <= 0.25);
    }
  }

  #updateLockStatus(status) {
    let mode = "idle";
    let label = "No target";

    if (typeof status === "object" && status !== null) {
      const lockData = status;
      label = firstDefined(lockData.label, lockData.targetName, lockData.target, label);
      if (lockData.locked === true) {
        status = true;
      } else if (lockData.locking === true) {
        status = "locking";
      } else {
        status = firstDefined(
          lockData.status,
          lockData.state,
          lockData.progress,
          lockData.lockProgress,
          false,
        );
      }
    }

    if (
      status === true ||
      status === "locked" ||
      status === "lock" ||
      (typeof status === "number" && status >= 1)
    ) {
      mode = "locked";
      label = label === "No target" ? "Target locked" : label;
    } else if (
      status === "locking" ||
      status === "acquiring" ||
      (typeof status === "number" && status > 0)
    ) {
      mode = "locking";
      label =
        typeof status === "number"
          ? `Acquiring ${Math.round(clamp(status) * 100)}%`
          : label === "No target"
            ? "Acquiring target"
            : label;
    } else if (typeof status === "string" && !["none", "idle", "unlocked"].includes(status)) {
      label = status;
    }

    if (this.elements.crosshair) {
      this.elements.crosshair.classList.toggle("is-locking", mode === "locking");
      this.elements.crosshair.classList.toggle("is-locked", mode === "locked");
    }
    if (this.elements.lockStatus) {
      this.elements.lockStatus.textContent = String(label);
    }
  }

  showWaveAnnouncement(text, subtext = "") {
    if (this.disposed || !this.elements.waveAnnouncement) {
      return;
    }

    if (this.elements.waveAnnouncementTitle) {
      this.elements.waveAnnouncementTitle.textContent = String(text ?? "");
    }
    if (this.elements.waveAnnouncementSubtitle) {
      this.elements.waveAnnouncementSubtitle.textContent = String(subtext ?? "");
      this.elements.waveAnnouncementSubtitle.hidden = !subtext;
    }

    this.elements.waveAnnouncement.classList.remove("is-active");
    void this.elements.waveAnnouncement.offsetWidth;
    this.elements.waveAnnouncement.classList.add("is-active");
    this.elements.waveAnnouncement.setAttribute("aria-hidden", "false");

    this.#setTimer("waveAnnouncement", () => {
      this.elements.waveAnnouncement?.classList.remove("is-active");
      this.elements.waveAnnouncement?.setAttribute("aria-hidden", "true");
    }, 2850);
  }

  showHitMarker() {
    if (this.disposed || !this.elements.hitMarker) {
      return;
    }

    this.elements.hitMarker.classList.remove("is-active");
    void this.elements.hitMarker.offsetWidth;
    this.elements.hitMarker.classList.add("is-active");

    this.#setTimer("hitMarker", () => {
      this.elements.hitMarker?.classList.remove("is-active");
    }, 300);
  }

  showDamage(directionAngle = 0) {
    if (this.disposed) {
      return;
    }

    if (this.elements.damageIndicator) {
      const angle =
        typeof directionAngle === "string"
          ? directionAngle
          : `${asFiniteNumber(directionAngle, 0)}deg`;
      this.elements.damageIndicator.style.setProperty("--damage-angle", angle);
      this.elements.damageIndicator.classList.remove("is-active");
      void this.elements.damageIndicator.offsetWidth;
      this.elements.damageIndicator.classList.add("is-active");
    }

    if (this.elements.damageVignette) {
      this.elements.damageVignette.classList.remove("is-active");
      void this.elements.damageVignette.offsetWidth;
      this.elements.damageVignette.classList.add("is-active");
    }

    this.#setTimer("damageIndicator", () => {
      this.elements.damageIndicator?.classList.remove("is-active");
    }, 800);
    this.#setTimer("damageVignette", () => {
      this.elements.damageVignette?.classList.remove("is-active");
    }, 540);
  }

  showScorePopup(value, screenX, screenY) {
    if (this.disposed || !this.elements.scorePopups) {
      return;
    }

    const bounds = this.elements.root?.getBoundingClientRect() ?? {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const x = clamp(
      asFiniteNumber(screenX, bounds.width * 0.5),
      24,
      Math.max(24, bounds.width - 24),
    );
    const y = clamp(
      asFiniteNumber(screenY, bounds.height * 0.45),
      24,
      Math.max(24, bounds.height - 24),
    );
    const popup = document.createElement("span");
    const numericValue = Number(value);

    popup.className = "score-popup";
    popup.textContent = Number.isFinite(numericValue)
      ? `${numericValue >= 0 ? "+" : "−"}${Math.abs(Math.round(numericValue)).toLocaleString()}`
      : String(value ?? "");
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
    this.elements.scorePopups.appendChild(popup);

    const removePopup = () => {
      const timer = this.popupTimers.get(popup);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        this.popupTimers.delete(popup);
      }
      popup.remove();
    };

    popup.addEventListener("animationend", removePopup, { once: true });
    this.popupTimers.set(popup, window.setTimeout(removePopup, 1250));
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.elements.muteButton) {
      return;
    }

    this.elements.muteButton.classList.toggle("is-muted", this.muted);
    this.elements.muteButton.setAttribute("aria-pressed", String(this.muted));
    this.elements.muteButton.setAttribute("aria-label", this.muted ? "Unmute audio" : "Mute audio");
    this.elements.muteButton.title = this.muted ? "Unmute audio" : "Mute audio";
  }

  setVolume(value) {
    this.volume = clamp(asFiniteNumber(value, this.volume));

    if (this.elements.volumeSlider) {
      this.elements.volumeSlider.value = String(this.volume);
      this.elements.volumeSlider.style.setProperty("--volume", String(this.volume));
      this.elements.volumeSlider.setAttribute("aria-valuetext", `${Math.round(this.volume * 100)} percent`);
    }
    if (this.elements.volumeValue) {
      this.elements.volumeValue.textContent = `${Math.round(this.volume * 100)}%`;
    }
  }

  setQuality(value) {
    const quality = String(value ?? "high").toLowerCase();
    const select = this.elements.qualitySelect;
    const hasOption = !select || [...select.options].some((option) => option.value === quality);

    this.quality = hasOption ? quality : "high";
    if (select) {
      select.value = this.quality;
    }
    if (this.elements.root) {
      this.elements.root.dataset.quality = this.quality;
    }
  }

  setPointerLocked(locked) {
    if (!this.elements.pointerLockButton) {
      return;
    }

    const isLocked = Boolean(locked);
    this.elements.pointerLockButton.classList.toggle("is-active", isLocked);
    this.elements.pointerLockButton.setAttribute("aria-pressed", String(isLocked));
    const dot = this.elements.pointerLockButton.querySelector(".pointer-dot");
    this.elements.pointerLockButton.replaceChildren();
    if (dot) this.elements.pointerLockButton.appendChild(dot);
    this.elements.pointerLockButton.append(
      document.createTextNode(isLocked ? " Mouse linked" : " Mouse aim"),
    );
  }

  showWebGLError(message) {
    if (this.disposed) {
      return;
    }

    if (message && this.elements.webglErrorMessage) {
      this.elements.webglErrorMessage.textContent = String(message);
    }

    this.#setGameState("error");
    this.#setScreen(this.elements.mainMenu, false);
    this.#setScreen(this.elements.pauseScreen, false);
    this.#setScreen(this.elements.gameOverScreen, false);
    this.#setScreen(this.elements.countdownOverlay, false);
    this.#setScreen(this.elements.hud, false);
    this.#setScreen(this.elements.webglError, true);
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    for (const { element, type, listener, options } of this.listeners) {
      element.removeEventListener(type, listener, options);
    }
    this.listeners.length = 0;

    for (const timer of this.timers.values()) {
      window.clearTimeout(timer);
    }
    this.timers.clear();

    for (const [popup, timer] of this.popupTimers) {
      window.clearTimeout(timer);
      popup.remove();
    }
    this.popupTimers.clear();
  }
}

export default UIManager;
