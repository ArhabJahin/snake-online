const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs'); // for saving/loading Q-table

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ====== ADJUSTABLE GAME SETTINGS ======
const SPEED_BASE = 50;
const NORMAL_SPEED = 50;
const BOOST_SPEED = 90;

const BOOST_SHRINK_RATE = 1.3;
const GRID = 30;
const TICK_RATE = 10;
const FOOD_COUNT = 5;

// ====== AI SETTINGS / Q-LEARNING ======
const AI_NAME = '🤖 AI Snake';
const AI_COLOR = '#00ffff'; // unique-ish bright cyan
const AI_ALPHA = 0.1;       // learning rate
const AI_GAMMA = 0.95;      // discount factor
const AI_EPSILON = 0.1;     // exploration rate
const AI_REWARD_STEP = -0.01;
const AI_REWARD_FOOD = 1.0;
const AI_REWARD_DEATH = -1.5;

// ====== Q-TABLE PERSISTENCE SETTINGS ======
const Q_FILE = path.join(__dirname, 'qtable.json');

// in-memory Q-table
let qTable = {};
let qDirty = false; // track if there are unsaved changes

// load Q-table from disk if it exists
function loadQTable() {
  try {
    if (fs.existsSync(Q_FILE)) {
      const data = fs.readFileSync(Q_FILE, 'utf8');
      qTable = JSON.parse(data);
      console.log(`[Q] Loaded Q-table from ${Q_FILE} with ${Object.keys(qTable).length} states.`);
    } else {
      console.log('[Q] No existing Q-table found, starting fresh.');
    }
  } catch (err) {
    console.error('[Q] Failed to load Q-table:', err);
    qTable = {};
  }
}

// save Q-table to disk (async)
function saveQTable(callback) {
  try {
    fs.writeFile(Q_FILE, JSON.stringify(qTable), err => {
      if (err) {
        console.error('[Q] Failed to save Q-table:', err);
        if (callback) callback(err);
      } else {
        qDirty = false;
        if (callback) callback(null);
      }
    });
  } catch (err) {
    console.error('[Q] Failed to save Q-table:', err);
    if (callback) callback(err);
  }
}

// periodically flush Q-table to disk if dirty
setInterval(() => {
  if (qDirty) {
    saveQTable();
  }
}, 5000);

// save once on process exit (best-effort)
process.on('SIGINT', () => {
  console.log('\n[Q] Process exiting, saving Q-table one last time...');
  if (qDirty) {
    try {
      fs.writeFileSync(Q_FILE, JSON.stringify(qTable));
      console.log('[Q] Q-table saved (sync).');
    } catch (err) {
      console.error('[Q] Failed to save Q-table on exit:', err);
    }
  }
  process.exit();
});

// load Q-table at startup
loadQTable();

// helpers for Q-table
function getQ(state) {
  if (!qTable[state]) {
    qTable[state] = { straight: 0, left: 0, right: 0 };
    qDirty = true;
  }
  return qTable[state];
}

function chooseAIAction(state) {
  const actions = ['straight', 'left', 'right'];

  // exploration
  if (Math.random() < AI_EPSILON) {
    return actions[Math.floor(Math.random() * actions.length)];
  }

  // exploitation
  const q = getQ(state);
  let bestAction = actions[0];
  let bestValue = q[bestAction];

  for (let i = 1; i < actions.length; i++) {
    const a = actions[i];
    if (q[a] > bestValue) {
      bestValue = q[a];
      bestAction = a;
    }
  }
  return bestAction;
}

function updateQ(prevState, prevAction, reward, nextState) {
  if (!prevState || !prevAction) return;

  const qPrev = getQ(prevState);
  const current = qPrev[prevAction];

  let maxNext = 0;
  if (nextState) {
    const qNext = getQ(nextState);
    maxNext = Math.max(qNext.straight, qNext.left, qNext.right);
  }

  const target = reward + AI_GAMMA * maxNext;
  qPrev[prevAction] = current + AI_ALPHA * (target - current);

  qDirty = true;
}

// ====== AI STATE REPRESENTATION ======
function getAIState(room, p) {
  let dir;
  if (p.dx === 1 && p.dy === 0) dir = 'R';
  else if (p.dx === -1 && p.dy === 0) dir = 'L';
  else if (p.dx === 0 && p.dy === -1) dir = 'U';
  else dir = 'D';

  const danger = getAIDangers(room, p);
  const { dangerFront, dangerLeft, dangerRight } = danger;

  const { foodDx, foodDy } = getFoodDirection(room, p);

  return `D:${dir}|DF:${dangerFront}|DL:${dangerLeft}|DR:${dangerRight}|FX:${foodDx}|FY:${foodDy}`;
}

function isOccupiedBySnake(room, x, y) {
  for (const id in room.players) {
    const pl = room.players[id];
    if (!pl.alive || !pl.trail) continue;
    if (pl.trail.some(seg => seg.x === x && seg.y === y)) {
      return true;
    }
  }
  return false;
}

function getAIDangers(room, p) {
  const { x, y, dx, dy } = p;

  const forward = {
    x: (x + dx + GRID) % GRID,
    y: (y + dy + GRID) % GRID
  };

  const leftDir = { dx: dy, dy: -dx };
  const left = {
    x: (x + leftDir.dx + GRID) % GRID,
    y: (y + leftDir.dy + GRID) % GRID
  };

  const rightDir = { dx: -dy, dy: dx };
  const right = {
    x: (x + rightDir.dx + GRID) % GRID,
    y: (y + rightDir.dy + GRID) % GRID
  };

  return {
    dangerFront: isOccupiedBySnake(room, forward.x, forward.y) ? 1 : 0,
    dangerLeft: isOccupiedBySnake(room, left.x, left.y) ? 1 : 0,
    dangerRight: isOccupiedBySnake(room, right.x, right.y) ? 1 : 0
  };
}

function getFoodDirection(room, p) {
  if (!room.foods.length) {
    return { foodDx: 0, foodDy: 0 };
  }

  let best = null;
  let bestDist = Infinity;
  const { x, y } = p;

  for (const f of room.foods) {
    const dx = f.x - x;
    const dy = f.y - y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = f;
    }
  }

  let rawDx = 0;
  let rawDy = 0;

  if (best.x > x) rawDx = 1;
  else if (best.x < x) rawDx = -1;
  if (best.y > y) rawDy = 1;
  else if (best.y < y) rawDy = -1;

  return { foodDx: rawDx, foodDy: rawDy };
}

function applyAIActionDirection(p, action) {
  if (action === 'straight') return;

  const oldDx = p.dx;
  const oldDy = p.dy;

  if (action === 'left') {
    p.dx = oldDy;
    p.dy = -oldDx;
  } else if (action === 'right') {
    p.dx = -oldDy;
    p.dy = oldDx;
  }
}

// ====== ROOMS / GAME ======

const rooms = {};

// reset a room for a brand new game (fresh players but keep hasAI)
function resetRoomForNewGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.players = {};
  room.foods = [];
  room.nextId = 1;
  room.deadClientIds.clear();
  room.gameEnded = false;

  if (room.hasAI) {
    addAIPlayer(roomId);
  }

  for (let i = 0; i < FOOD_COUNT; i++) spawnFood(roomId);

  console.log(`[ROOM ${roomId}] New round started. hasAI=${room.hasAI}`);
}

function createRoom(id, hasAI = true) {
  rooms[id] = {
    players: {},
    foods: [],
    nextId: 1,
    gameEnded: false,
    deadClientIds: new Set(),
    hasAI: !!hasAI
  };

  resetRoomForNewGame(id);
}

function addAIPlayer(roomId) {
  const room = rooms[roomId];
  const playerId = room.nextId++;

  const startX = Math.floor(GRID / 3);
  const startY = Math.floor(GRID / 3);

  room.players[playerId] = {
    id: playerId,
    clientId: null,
    name: AI_NAME,
    color: AI_COLOR,
    x: startX, y: startY,
    dx: 1, dy: 0,

    trail: [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY }
    ],

    score: 0,
    alive: true,
    speedBoost: false,

    moveProgress: 0,
    shrinkProgress: 0,

    isAI: true
  };
}

function spawnFood(roomId) {
  const room = rooms[roomId];
  let x, y;

  do {
    x = Math.floor(Math.random() * GRID);
    y = Math.floor(Math.random() * GRID);
  } while (
    Object.values(room.players).some(
      p => p.alive && p.trail.some(s => s.x === x && s.y === y)
    ) ||
    room.foods.some(f => f.x === x && f.y === y)
  );

  room.foods.push({ x, y });
}

io.on('connection', socket => {
  socket.on('joinRoom', (roomId, playerName, clientId, aiEnabled) => {
    roomId = (roomId || 'lobby').trim().toLowerCase();
    clientId = (clientId || socket.id);
    socket.clientId = clientId;

    // Interpret aiEnabled (default: true)
    let aiFlag;
    if (typeof aiEnabled === 'boolean') {
      aiFlag = aiEnabled;
    } else if (typeof aiEnabled === 'string') {
      aiFlag = aiEnabled !== 'false';
    } else {
      aiFlag = true;
    }

    if (!rooms[roomId]) {
      createRoom(roomId, aiFlag);
    }

    const room = rooms[roomId];

    // If previous game ended, first human of new round decides AI in/out
    if (room.gameEnded) {
      room.hasAI = aiFlag;
      resetRoomForNewGame(roomId);
    }

    if (socket.roomId) socket.leave(socket.roomId);

    socket.join(roomId);
    socket.roomId = roomId;

    // if this client died earlier this round, they spectate
    const isSpectator =
      !room.gameEnded && room.deadClientIds.has(clientId);

    if (isSpectator) {
      socket.playerId = null;
      socket.emit('joined', { yourId: null, spectator: true });
      io.to(roomId).emit('gameState', getState(room));
      return;
    }

    const playerId = room.nextId++;
    socket.playerId = playerId;

    const colors = [
      '#ff4d4d', '#4dff4d', '#4d4dff', '#ffff4d',
      '#ff4dff', '#4dffff', '#ff8800', '#ffffff'
    ];

    const startX = Math.floor((2 * GRID) / 3);
    const startY = Math.floor((2 * GRID) / 3);

    room.players[playerId] = {
      id: playerId,
      clientId,
      name: playerName.trim() || `Snake ${playerId}`,
      color: colors[(playerId - 1) % colors.length],
      x: startX, y: startY,
      dx: -1, dy: 0,

      trail: [
        { x: startX, y: startY },
        { x: startX + 1, y: startY },
        { x: startX + 2, y: startY }
      ],

      score: 0,
      alive: true,
      speedBoost: false,

      moveProgress: 0,
      shrinkProgress: 0,
      isAI: false
    };

    socket.emit('joined', { yourId: playerId, spectator: false });
    io.to(roomId).emit('gameState', getState(room));
  });

  socket.on('direction', dir => {
    const p = rooms[socket.roomId]?.players?.[socket.playerId];
    if (!p || !p.alive || p.isAI) return;

    if (dir === 'left' && p.dx !== 1) { p.dx = -1; p.dy = 0; }
    if (dir === 'right' && p.dx !== -1) { p.dx = 1; p.dy = 0; }
    if (dir === 'up' && p.dy !== 1) { p.dx = 0; p.dy = -1; }
    if (dir === 'down' && p.dy !== -1) { p.dx = 0; p.dy = 1; }
  });

  socket.on('speedBoost', on => {
    const p = rooms[socket.roomId]?.players?.[socket.playerId];
    if (!p || p.isAI) return;

    if (p.trail.length <= 3) {
      p.speedBoost = false;
      return;
    }

    p.speedBoost = !!on;
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (room && room.players[socket.playerId]) {
      const pl = room.players[socket.playerId];
      pl.alive = false;
      pl.trail = [];

      if (Object.values(room.players).every(p => !p.alive))
        delete rooms[socket.roomId];
    }
  });
});

function getState(room) {
  return {
    players: Object.fromEntries(
      Object.entries(room.players).map(([id, p]) => [
        id,
        {
          name: p.name,
          color: p.color,
          trail: p.alive ? p.trail : [],
          score: p.score,
          alive: p.alive
        }
      ])
    ),
    foods: room.foods
  };
}

// ====== GAME LOOP ======
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];

    // If the game is ended, freeze snakes & just keep final state.
    if (room.gameEnded) continue;

    let aliveCount = 0;
    let humanAliveCount = 0;
    let aiAliveCount = 0;
    let winner = null;
    let aiWinner = null;

    for (const id in room.players) {
      const p = room.players[id];
      if (!p.alive) continue;

      if (p.trail.length <= 3) p.speedBoost = false;

      const speed = p.speedBoost
        ? BOOST_SPEED / SPEED_BASE
        : NORMAL_SPEED / SPEED_BASE;

      p.moveProgress += speed;
      const steps = Math.floor(p.moveProgress);
      p.moveProgress -= steps;

      for (let s = 0; s < steps; s++) {
        let prevState = null;
        let action = null;
        if (p.isAI) {
          prevState = getAIState(room, p);
          action = chooseAIAction(prevState);
          applyAIActionDirection(p, action);
        }

        p.x = (p.x + p.dx + GRID) % GRID;
        p.y = (p.y + p.dy + GRID) % GRID;

        const head = { x: p.x, y: p.y };

        // Collision
        for (const oid in room.players) {
          if (oid === id) continue;
          const o = room.players[oid];
          if (o.alive &&
              o.trail.some(seg => seg.x === head.x && seg.y === head.y)) {
            p.alive = false;
            p.trail = [];

            if (!p.isAI && p.clientId) {
              room.deadClientIds.add(p.clientId);
            }
          }
        }

        let reward = AI_REWARD_STEP;
        let ateFood = false;

        if (!p.alive) {
          if (p.isAI && prevState && action) {
            reward = AI_REWARD_DEATH;
            updateQ(prevState, action, reward, null);
          }
          break;
        }

        // Food
        for (let i = 0; i < room.foods.length; i++) {
          const f = room.foods[i];
          if (f.x === head.x && f.y === head.y) {
            ateFood = true;
            p.score++;
            room.foods.splice(i, 1);
            spawnFood(roomId);
            break;
          }
        }

        p.trail.push(head);

        if (ateFood) {
          if (p.isAI && prevState && action) {
            reward = AI_REWARD_FOOD;
          }
        } else {
          if (p.speedBoost) {
            p.shrinkProgress += BOOST_SHRINK_RATE;
            while (p.shrinkProgress >= 1 && p.trail.length > 3) {
              p.trail.shift();
              p.shrinkProgress -= 1;
            }
          } else {
            p.trail.shift();
          }
        }

        if (p.isAI && prevState && action && p.alive) {
          const nextState = getAIState(room, p);
          updateQ(prevState, action, reward, nextState);
        }
      }

      if (p.alive) {
        aliveCount++;
        winner = p;

        if (p.isAI) {
          aiAliveCount++;
          if (!aiWinner) aiWinner = p;
        } else {
          humanAliveCount++;
        }
      }
    }

    io.to(roomId).emit('gameState', getState(room));

    const totalPlayers = Object.keys(room.players).length;

    // If no humans left but AI alive -> AI auto wins
    if (!room.gameEnded &&
        humanAliveCount === 0 &&
        aiAliveCount > 0 &&
        totalPlayers > 1) {
      room.gameEnded = true;
      const w = aiWinner || winner;
      const message = `${w.name} WINS! (All humans are dead 👀)`;
      io.to(roomId).emit('gameOver', message);
      room.deadClientIds.clear();
      continue;
    }

    // Normal last-snake-standing logic
    if (!room.gameEnded &&
        aliveCount <= 1 &&
        totalPlayers > 1) {
      room.gameEnded = true;

      let message = 'Draw!';
      if (winner) {
        if (winner.isAI) {
          message = `${winner.name} WINS! (All humans are dead 👀)`;
        } else {
          message = `${winner.name} WINS!`;
        }
      }

      io.to(roomId).emit('gameOver', message);
      room.deadClientIds.clear();
    }
  }
}, 1000 / TICK_RATE);

server.listen(3000, () =>
  console.log("Server running on http://localhost:3000")
);
