const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const GRID = 30;
const GRID_SIZE = canvas.width / GRID;

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

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function joinRoom() {
  const room = document.getElementById('roomInput').value.trim() || 'lobby';
  const name = document.getElementById('nameInput').value.trim() || 'Guest';

  socket = io();
  socket.emit('joinRoom', room, name, clientId);

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

let bgGradient = null;

function ensureBackgroundGradient() {
  if (!bgGradient) {
    bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGradient.addColorStop(0, "#05090f");
    bgGradient.addColorStop(0.5, "#050505");
    bgGradient.addColorStop(1, "#020308");
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function drawSmooth() {
  ensureBackgroundGradient();

  const now = performance.now();
  let t = (now - lastStateTime) / TICK_DURATION;
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  // Background
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw subtle grid
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    const x = i * GRID_SIZE;
    const y = i * GRID_SIZE;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.strokeStyle = "#1a1a1a";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.strokeStyle = "#1a1a1a";
    ctx.stroke();
  }
  ctx.restore();

  // Food: pulsating circles
  const pulse = 0.7 + 0.15 * Math.sin(now / 250);
  foods.forEach(f => {
    const cx = (f.x + 0.5) * GRID_SIZE;
    const cy = (f.y + 0.5) * GRID_SIZE;
    const r = (GRID_SIZE / 2 - 5) * pulse;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#aaaaaa");
    ctx.fillStyle = grad;
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();
  });

  // Snakes with interpolation for smoother movement
  for (let id in players) {
    const p = players[id];
    if (!p.trail) continue;

    const prev = prevPlayers[id] || { trail: [] };
    const prevTrail = prev.trail || [];
    const currTrail = p.trail;

    for (let i = 0; i < currTrail.length; i++) {
      const currSeg = currTrail[i];
      const prevSeg = prevTrail[i] || currSeg;

      // handle interpolation
      let x = lerp(prevSeg.x, currSeg.x, t);
      let y = lerp(prevSeg.y, currSeg.y, t);

      const cx = (x + 0.5) * GRID_SIZE;
      const cy = (y + 0.5) * GRID_SIZE;

      const isHead = (i === currTrail.length - 1);
      const baseRadius = GRID_SIZE / 2 - 4;
      const radius = isHead ? baseRadius + 2 : baseRadius - 2;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);

      // body fade
      const alpha = isHead ? 1.0 : 0.6;
      ctx.fillStyle = p.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');

      ctx.shadowColor = p.color;
      ctx.shadowBlur = isHead ? 18 : 10;
      ctx.fill();

      if (isHead) {
        // tiny "eye" highlight
        ctx.beginPath();
        ctx.arc(cx + 3, cy - 3, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffffcc";
        ctx.fill();
      }

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
  } else {
    exitFullscreen();
  }
}

// mobile: double-tap canvas for fullscreen
let lastTap = 0;
canvas.addEventListener("touchstart", () => {
  const now = Date.now();
  if (now - lastTap < 300) toggleFullscreen();
  lastTap = now;
});
