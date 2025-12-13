const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const GRID = 30;

// Server tick duration (ms) – keep in sync with server TICK_RATE
const TICK_DURATION = 100; // 1000 / 10

let socket;
let players = {};
let prevPlayers = {};
let foods = [];
let myId;
let isSpectator = false;

// last state update time for interpolation
let lastStateTime = performance.now();

// last game summary for menu
let lastGameMsg = '';
let lastFinalScoresHtml = '';

// Popup element
const popup = document.createElement("div");
popup.className = "popup";
popup.style.display = "none";
document.body.appendChild(popup);

// Persistent clientId for spectator logic
let clientId = localStorage.getItem('snakeClientId');
if (!clientId) {
  clientId = 'c-' + Math.random().toString(36).slice(2);
  localStorage.setItem('snakeClientId', clientId);
}

// === AI toggle state ===
let aiEnabled = true;

function toggleAI() {
  aiEnabled = !aiEnabled;
  const btn = document.getElementById('aiToggle');
  if (!btn) return;
  if (aiEnabled) {
    btn.textContent = 'AI In';
    btn.classList.remove('ai-off');
  } else {
    btn.textContent = 'AI Out';
    btn.classList.add('ai-off');
  }
}

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* -----------------------------
   RESPONSIVE SQUARE CANVAS
   (fits screen, stays sharp)
----------------------------- */

let dpr = window.devicePixelRatio || 1;
let bgGradient = null;

function resizeCanvas() {
  const gameDiv = document.getElementById('game');
  const sidebar = document.querySelector('.sidebar');
  if (!gameDiv || !canvas) return;

  // Only when game is visible
  if (gameDiv.style.display !== 'flex') return;

  const padding = 16; // from CSS
  const sidebarWidth = sidebar ? sidebar.offsetWidth + 16 : 0;

  const availableWidth = window.innerWidth - sidebarWidth - padding;
  const availableHeight = window.innerHeight - padding;

  // Square board that best fits available space
  const size = Math.max(280, Math.min(availableWidth, availableHeight));

  dpr = window.devicePixelRatio || 1;

  // CSS size (logical pixels)
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';

  // Actual pixel resolution for sharp rendering
  canvas.width = size * dpr;
  canvas.height = size * dpr;

  // Reset transform so 1 unit in code = 1 CSS pixel
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Force background gradient to recompute with new size
  bgGradient = null;
}

window.addEventListener('resize', () => {
  resizeCanvas();
});

/* -----------------------------
   CONNECTION / ROOM
----------------------------- */

function joinRoom() {
  const room = document.getElementById('roomInput').value.trim() || 'lobby';
  const name = document.getElementById('nameInput').value.trim() || 'Guest';

  socket = io();

  // pass aiEnabled as 4th argument
  socket.emit('joinRoom', room, name, clientId, aiEnabled);

  socket.on('joined', data => {
    myId = data.yourId;
    isSpectator = !!data.spectator;

    document.getElementById('menu').style.display = 'none';
    document.getElementById('game').style.display = 'flex';
    document.title = `Snake | Room: ${room}`;

    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = isSpectator
        ? 'You are spectating this round.'
        : '';
    }

    // After game layout is visible, size the canvas
    requestAnimationFrame(resizeCanvas);
  });

  socket.on('gameState', state => {
    // Store previous players for interpolation
    prevPlayers = deepCopy(players);
    players = state.players;
    foods = state.foods;
    lastStateTime = performance.now();

    updateScores();
  });

  socket.on('gameOver', msg => showFinalPopup(msg));
}

function showFinalPopup(text) {
  popup.style.display = "flex";

  const sortedPlayers = Object.values(players)
    .sort((a, b) => b.score - a.score);

  const scoreHTML = sortedPlayers
    .map(p => `<div style="color:${p.color}; font-size:20px; text-align:center">${p.name}: ${p.score}</div>`)
    .join("");

  // Save a version for the menu page
  lastFinalScoresHtml = sortedPlayers
    .map(p => `<div class="player-line" style="color:${p.color}">${p.name}: ${p.score}</div>`)
    .join("");
  lastGameMsg = text;

  let countdown = 5;

  popup.innerHTML = `
    <div>
      <h1>${text}</h1>
      <h2>Final Scores</h2>
      ${scoreHTML}
      <h3>Returning in <span id="cd">${countdown}</span>...</h3>
    </div>
  `;

  const interval = setInterval(() => {
    countdown--;
    const c = document.getElementById("cd");
    if (c) c.textContent = countdown;

    if (countdown <= 0) {
      clearInterval(interval);
      popup.style.display = "none";
      returnToMenu();
    }
  }, 1000);
}

function returnToMenu() {
  const finalScoresDiv = document.getElementById('finalScores');
  if (finalScoresDiv && lastFinalScoresHtml) {
    finalScoresDiv.innerHTML = `
      <h2>Last Game Results</h2>
      <div class="final-message">${lastGameMsg}</div>
      ${lastFinalScoresHtml}
    `;
  }

  players = {};
  prevPlayers = {};
  myId = null;
  isSpectator = false;

  if (socket) socket.disconnect();

  document.getElementById('game').style.display = 'none';
  document.getElementById('menu').style.display = 'flex';

  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = '';
}

/* -----------------------------
   INPUT HANDLING
----------------------------- */

const keys = {};
window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  keys[e.key] = true;
  if (!socket) return;

  // Spectators can't control snakes but can toggle fullscreen
  if (isSpectator) {
    if (e.key.toLowerCase() === "f") toggleFullscreen();
    return;
  }

  if (e.key.toLowerCase() === 'z') socket.emit('speedBoost', true);

  if (e.key.toLowerCase() === "f") toggleFullscreen();
});

window.addEventListener('keyup', e => {
  keys[e.key] = false;
  if (!socket) return;

  if (isSpectator) return;

  if (e.key.toLowerCase() === 'z') socket.emit('speedBoost', false);
});

setInterval(() => {
  if (!socket || isSpectator) return;

  if (keys['ArrowUp'] || keys['w']) socket.emit('direction', 'up');
  if (keys['ArrowDown'] || keys['s']) socket.emit('direction', 'down');
  if (keys['ArrowLeft'] || keys['a']) socket.emit('direction', 'left');
  if (keys['ArrowRight'] || keys['d']) socket.emit('direction', 'right');

}, 100);

/* -----------------------------
   SCOREBOARD
----------------------------- */

function updateScores() {
  document.getElementById('scores').innerHTML =
    Object.values(players)
      .sort((a, b) => b.score - a.score)
      .map(p => `<div style="color:${p.color}">${p.name}: ${p.score} ${!p.alive ? '☠' : ''}</div>`)
      .join('');
}

/* -----------------------------
   RENDERING / SMOOTH MOVEMENT
----------------------------- */

function ensureBackgroundGradient(drawHeight) {
  if (!bgGradient) {
    bgGradient = ctx.createLinearGradient(0, 0, 0, drawHeight);
    bgGradient.addColorStop(0, "#05090f");
    bgGradient.addColorStop(0.5, "#050505");
    bgGradient.addColorStop(1, "#020308");
  }
}

function drawSmooth() {
  if (canvas.width === 0 || canvas.height === 0) return;

  const drawSize = canvas.width / dpr; // since we scaled equally, width = height logically
  const drawWidth = drawSize;
  const drawHeight = drawSize;

  ensureBackgroundGradient(drawHeight);

  const now = performance.now();
  let t = (now - lastStateTime) / TICK_DURATION;
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  const cellSize = drawWidth / GRID;

  // Background
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, drawWidth, drawHeight);

  // Subtle grid
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    const x = i * cellSize;
    const y = i * cellSize;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, drawHeight);
    ctx.strokeStyle = "#1a1a1a";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(drawWidth, y);
    ctx.strokeStyle = "#1a1a1a";
    ctx.stroke();
  }
  ctx.restore();

  // Food: pulsating squares
  const pulse = 0.7 + 0.15 * Math.sin(now / 250);
  foods.forEach(f => {
    const size = (cellSize - 4) * pulse;
    const px = f.x * cellSize + (cellSize - size) / 2;
    const py = f.y * cellSize + (cellSize - size) / 2;

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 10;
    ctx.fillRect(px, py, size, size);
    ctx.restore();
  });

  // Snakes: blocky style with fixed wrap interpolation
  for (let id in players) {
    const p = players[id];
    if (!p.trail) continue;

    const prev = prevPlayers[id] || { trail: [] };
    const prevTrail = prev.trail || [];
    const currTrail = p.trail;

    for (let i = 0; i < currTrail.length; i++) {
      const currSeg = currTrail[i];
      const prevSeg = prevTrail[i] || currSeg;

      // Prevent interpolation across wrap edges
      let dx = currSeg.x - prevSeg.x;
      let dy = currSeg.y - prevSeg.y;
      if (Math.abs(dx) > GRID / 2) dx = 0;
      if (Math.abs(dy) > GRID / 2) dy = 0;

      const x = prevSeg.x + dx * t;
      const y = prevSeg.y + dy * t;

      const px = x * cellSize + 2;
      const py = y * cellSize + 2;
      const size = cellSize - 4;

      const isHead = (i === currTrail.length - 1);

      ctx.save();
      ctx.fillStyle = isHead ? p.color : (p.color + "88");
      ctx.shadowColor = p.color;
      ctx.shadowBlur = isHead ? 14 : 6;
      ctx.fillRect(px, py, size, size);
      ctx.restore();
    }
  }
}

/* Master render loop */
function renderLoop() {
  drawSmooth();
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

/* -------------------------------------------
   FULLSCREEN FEATURE (Desktop + Mobile)
--------------------------------------------*/

// request fullscreen
function goFullscreen() {
  const elem = document.getElementById("game");
  if (elem.requestFullscreen) elem.requestFullscreen();
  else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
  else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
}

// exit fullscreen
function exitFullscreen() {
  if (document.exitFullscreen) document.exitFullscreen();
  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  else if (document.msExitFullscreen) document.msExitFullscreen();
}

// toggle fullscreen
function toggleFullscreen() {
  if (!document.fullscreenElement &&
      !document.webkitFullscreenElement &&
      !document.msFullscreenElement) {
    goFullscreen();
    setTimeout(resizeCanvas, 300);
  } else {
    exitFullscreen();
    setTimeout(resizeCanvas, 300);
  }
}

// mobile: double-tap canvas for fullscreen
let lastTap = 0;
canvas.addEventListener("touchstart", () => {
  const now = Date.now();
  if (now - lastTap < 300) toggleFullscreen();
  lastTap = now;
});
