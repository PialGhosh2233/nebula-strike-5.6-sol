import { Game } from './Game.js';

const canvas = document.getElementById('game-canvas');
const root = document.getElementById('game-root');
const menu = document.getElementById('main-menu');
const errorPanel = document.getElementById('webgl-error');
const errorMessage = document.getElementById('webgl-error-message');

function showCompatibilityError(message) {
  root.dataset.gameState = 'error';
  menu?.classList.remove('is-active');
  menu?.setAttribute('aria-hidden', 'true');
  errorPanel?.classList.add('is-active');
  errorPanel?.setAttribute('aria-hidden', 'false');
  if (errorMessage) errorMessage.textContent = message;
}

if (!canvas) {
  throw new Error('The game canvas is missing from index.html.');
}

const context = canvas.getContext('webgl2', {
  antialias: true,
  alpha: false,
  depth: true,
  stencil: false,
  powerPreference: 'high-performance',
});

if (!context) {
  showCompatibilityError(
    'Nebula Strike requires WebGL2 hardware acceleration. Update your browser and graphics drivers, then reload this page.',
  );
} else {
  try {
    const game = new Game(canvas, context);
    const handlePageHide = (event) => {
      if (event.persisted) {
        game.pause();
      } else {
        game.dispose();
        window.removeEventListener('pagehide', handlePageHide);
      }
    };
    window.addEventListener('pagehide', handlePageHide);
  } catch (error) {
    console.error(error);
    showCompatibilityError(
      'The combat renderer could not start. Reload the page, or try a current desktop browser with hardware acceleration enabled.',
    );
  }
}
