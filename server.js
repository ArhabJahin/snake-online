const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

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

const GROWTH_PER_FOOD = 50;
const BOOST_SHRINK_RATE = 1.3;
const GRID = 30;
const TICK_RATE = 10;
const FOOD_COUNT = 5;

const rooms = {};

function createRoom(id) {
  rooms[id] = {
    players: {},
    foods: [],
    nextId: 1,
    gameEnded: false,
    deadClientIds: new Set() // track clients that died this round
  };
  for (let i = 0; i < FOOD_COUNT; i++) spawnFood(id);
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
  // joinRoom now has clientId to persist death/spectator status
  socket.on('joinRoom', (roomId, playerName, clientId) => {
    roomId = (roomId || 'lobby').trim().toLowerCase();
    clientId = (clientId || socket.id);
    socket.clientId = clientId;

    if (!rooms[roomId]) createRoom(roomId);
    const room = rooms[roomId];

    if (socket.roomId) socket.leave(socket.roomId);

    socket.join(roomId);
    socket.roomId = roomId;

    // If this client died earlier this round, they are forced to spectate
    const isSpectator = !room.gameEnded && room.deadClientIds.has(clientId);

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

    const startX = Math.floor(GRID / 2);
    const startY = Math.floor(GRID / 2);

    room.players[playerId] = {
      id: playerId,
      clientId,
      name: playerName.trim() || `Snake ${playerId}`,
      color: colors[(playerId - 1) % colors.length],
      x: startX, y: startY,
      dx: 1, dy: 0,

      trail: [
        { x: startX, y: startY },
        { x: startX - 1, y: startY },
        { x: startX - 2, y: startY }
      ],

      growthBuffer: 0,
      score: 0,
      alive: true,
      speedBoost: false,

      moveProgress: 0,
      shrinkProgress: 0
    };

    socket.emit('joined', { yourId: playerId, spectator: false });
    io.to(roomId).emit('gameState', getState(room));
  });

  socket.on('direction', dir => {
    const p = rooms[socket.roomId]?.players?.[socket.playerId];
    if (!p || !p.alive) return;

    if (dir === 'left' && p.dx !== 1) { p.dx = -1; p.dy = 0; }
    if (dir === 'right' && p.dx !== -1) { p.dx = 1; p.dy = 0; }
    if (dir === 'up' && p.dy !== 1) { p.dx = 0; p.dy = -1; }
    if (dir === 'down' && p.dy !== -1) { p.dx = 0; p.dy = 1; }
  });

  socket.on('speedBoost', on => {
    const p = rooms[socket.roomId]?.players?.[socket.playerId];
    if (!p) return;

    if (p.trail.length <= 3) {
      p.speedBoost = false;
      return;
    }

    p.speedBoost = !!on;
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (room && room.players[socket.playerId]) {
      room.players[socket.playerId].alive = false;
      room.players[socket.playerId].trail = [];

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

// GAME LOOP
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];

    let aliveCount = 0;
    let winner = null;

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

        // === Movement ===
        p.x = (p.x + p.dx + GRID) % GRID;
        p.y = (p.y + p.dy + GRID) % GRID;

        const head = { x: p.x, y: p.y };

        // === Collision check ===
        for (const oid in room.players) {
          if (oid === id) continue;
          const o = room.players[oid];
          if (o.alive &&
              o.trail.some(seg => seg.x === head.x && seg.y === head.y)) {
            p.alive = false;
            p.trail = [];

            // mark this client as dead for this round
            if (p.clientId) {
              room.deadClientIds.add(p.clientId);
            }
          }
        }
        if (!p.alive) break;

        // === Food check ===
        let ateFood = false;
        for (let i = 0; i < room.foods.length; i++) {
          const f = room.foods[i];
          if (f.x === head.x && f.y === head.y) {
            ateFood = true;
            p.score++;
            p.growthBuffer += GROWTH_PER_FOOD;
            room.foods.splice(i, 1);
            spawnFood(roomId);
            break;
          }
        }

        // === Add new head ===
        p.trail.push(head);

        if (ateFood) {
          while (p.growthBuffer >= 1) {
            p.growthBuffer -= 1;
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
      }

      if (p.alive) {
        aliveCount++;
        winner = p;
      }
    }

    io.to(roomId).emit('gameState', getState(room));

    if (!room.gameEnded &&
      aliveCount <= 1 &&
      Object.keys(room.players).length > 1) {
      room.gameEnded = true;
      io.to(roomId).emit(
        'gameOver',
        winner ? `${winner.name} WINS!` : 'Draw!'
      );

      // new round can be played, reset the dead list
      room.deadClientIds.clear();
    }
  }
}, 1000 / TICK_RATE);

server.listen(3000, () =>
  console.log("Server running on http://localhost:3000")
);
