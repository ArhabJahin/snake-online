const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const GRID = 30;
const GRID_SIZE = canvas.width / GRID;

let socket;
let players = {};
let foods = [];
let myId;
let isSpectator = false; // NEW

// NEW: persistent clientId (per browser storage)
let clientId = localStorage.getItem('snakeClientId');
if (!clientId) {
  clientId = 'c-' + Math.random().toString(36).slice(2);
  localStorage.setItem('snakeClientId', clientId);
}

const popup = document.createElement("div");
popup.className = "popup";
popup.style.display = "none";
document.body.appendChild(popup);

function joinRoom() {
  const room = document.getElementById('roomInput').value.trim() || 'lobby';
  const name = document.getElementById('nameInput').value.trim() || 'Guest';

  socket = io();
  // send clientId too
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
    players = state.players;
    foods = state.foods;
    updateScores();
    draw();
  });

  socket.on('gameOver', msg => showFinalPopup(msg));
}

function showFinalPopup(text) {
  popup.style.display = "flex";

  const scoreHTML = Object.values(players)
    .sort((a, b) => b.score - a.score)
    .map(p => `<div style="color:${p.color}; font-size:20px">${p.name}: ${p.score}</div>`)
    .join("");

  let countdown = 5;

  popup.innerHTML = `
    <h1>${text}</h1>
    <h2>Final Scores</h2>
    ${scoreHTML}
    <h3>Returning in <span id="cd">${countdown}</span>...</h3>
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
  players = {};
  myId = null;
  isSpectator = false; // reset local flag

  if (socket) socket.disconnect();

  document.getElementById('game').style.display = 'none';
  document.getElementById('menu').style.display = 'block';

  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = '';
}

const keys = {};
window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  keys[e.key] = true;
  if (!socket) return;

  // spectators can't input gameplay actions
  if (isSpectator) {
    // Still allow fullscreen toggle even as spectator
    if (e.key.toLowerCase() === "f") toggleFullscreen();
    return;
  }

  if (e.key.toLowerCase() === 'z') socket.emit('speedBoost', true);

  // Fullscreen toggle (F key)
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

function updateScores() {
  document.getElementById('scores').innerHTML =
    Object.values(players)
      .sort((a, b) => b.score - a.score)
      .map(p => `<div style="color:${p.color}">${p.name}: ${p.score} ${!p.alive ? '☠' : ''}</div>`)
      .join('');
}

function draw() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  foods.forEach(f => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(f.x * GRID_SIZE + 2, f.y * GRID_SIZE + 2, GRID_SIZE - 4, GRID_SIZE - 4);
  });

  for (let id in players) {
    const p = players[id];
    if (!p.trail) continue;

    p.trail.forEach((seg, i) => {
      ctx.fillStyle = (i === p.trail.length - 1) ? p.color : p.color + "88";
      ctx.fillRect(seg.x * GRID_SIZE + 2, seg.y * GRID_SIZE + 2, GRID_SIZE - 4, GRID_SIZE - 4);
    });
  }
}

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

// mobile: double-tap canvas
let lastTap = 0;
canvas.addEventListener("touchstart", () => {
  const now = Date.now();
  if (now - lastTap < 300) toggleFullscreen();
  lastTap = now;
});
