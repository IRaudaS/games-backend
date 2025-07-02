// server.js - Backend unificado para juegos familiares
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuración
const PORT = process.env.PORT || 8080;

// Configuración de PostgreSQL (Cloud SQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://username:password@localhost/rummy_db',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Constantes del juego
const COLORS = ['rojo', 'azul', 'verde', 'naranja'];
const TOTAL_TILES = 106;

// Almacén de juegos en memoria (en producción usarías Redis)
const games = new Map();
const playerSockets = new Map();

// Crear conjunto de fichas
function createTileSet() {
  const tiles = [];
  let id = 0;
  
  // 2 sets de fichas numeradas (1-13 en 4 colores)
  for (let set = 0; set < 2; set++) {
    for (let color of COLORS) {
      for (let num = 1; num <= 13; num++) {
        tiles.push({
          id: id++,
          number: num,
          color: color,
          isJoker: false
        });
      }
    }
  }
  
  // 2 comodines
  tiles.push({ id: id++, number: '★', color: 'joker', isJoker: true });
  tiles.push({ id: id++, number: '★', color: 'joker', isJoker: true });
  
  return tiles;
}

// Mezclar array
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Generar código de sala único
function generateRoomCode() {
  return 'RUMMY-' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Validar escalera
function isValidRun(tiles) {
  if (tiles.length < 3) return false;
  
  const nonJokers = tiles.filter(t => !t.isJoker);
  if (nonJokers.length === 0) return false;
  
  const color = nonJokers[0].color;
  if (!nonJokers.every(t => t.color === color)) return false;
  
  const numbers = nonJokers.map(t => t.number).sort((a, b) => a - b);
  
  // Verificar secuencia consecutiva
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] !== numbers[i-1] + 1) return false;
  }
  
  return true;
}

// Validar grupo (mismo número, diferentes colores)
function isValidGroup(tiles) {
  if (tiles.length < 3) return false;
  
  const nonJokers = tiles.filter(t => !t.isJoker);
  if (nonJokers.length === 0) return false;
  
  const number = nonJokers[0].number;
  if (!nonJokers.every(t => t.number === number)) return false;
  
  const colors = new Set(nonJokers.map(t => t.color));
  return colors.size === nonJokers.length;
}

// Validar combinación
function isValidMeld(tiles) {
  return isValidRun(tiles) || isValidGroup(tiles);
}

// Calcular valor de fichas
function calculateTileValue(tile) {
  return tile.isJoker ? 0 : tile.number;
}

// Inicializar base de datos
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id VARCHAR(20) PRIMARY KEY,
        player1 VARCHAR(50),
        player2 VARCHAR(50),
        current_player VARCHAR(50),
        game_state JSONB,
        status VARCHAR(20) DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_moves (
        id SERIAL PRIMARY KEY,
        game_id VARCHAR(20) REFERENCES games(id),
        player VARCHAR(50),
        move_type VARCHAR(30),
        move_data JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Base de datos inicializada');
  } catch (error) {
    console.error('❌ Error inicializando BD:', error);
  }
}

// API Routes

// Crear nuevo juego
app.post('/api/rummy/games', async (req, res) => {
  try {
    const { playerName } = req.body;
    const gameId = generateRoomCode();
    
    // Crear fichas y repartir
    const allTiles = shuffleArray(createTileSet());
    const player1Hand = allTiles.slice(0, 14);
    const player2Hand = allTiles.slice(14, 28);
    const remainingTiles = allTiles.slice(28);
    
    const gameState = {
      tiles: remainingTiles,
      player1Hand,
      player2Hand,
      tableGroups: [],
      player1Score: 0,
      player2Score: 0,
      player1InitialMeld: false,
      player2InitialMeld: false,
      currentPlayer: playerName
    };
    
    // Guardar en base de datos
    await pool.query(
      'INSERT INTO games (id, player1, current_player, game_state) VALUES ($1, $2, $3, $4)',
      [gameId, playerName, playerName, gameState]
    );
    
    // Guardar en memoria
    games.set(gameId, {
      id: gameId,
      player1: playerName,
      player2: null,
      status: 'waiting',
      gameState
    });
    
    res.json({ 
      gameId, 
      message: `Juego creado. Comparte el código: ${gameId}`,
      player: playerName
    });
  } catch (error) {
    console.error('Error creando juego:', error);
    res.status(500).json({ error: 'Error creando juego' });
  }
});

// Unirse a juego
app.post('/api/rummy/games/:gameId/join', async (req, res) => {
  try {
    const { gameId } = req.params;
    const { playerName } = req.body;
    
    const game = games.get(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Juego no encontrado' });
    }
    
    if (game.player2) {
      return res.status(400).json({ error: 'Juego lleno' });
    }
    
    if (game.player1 === playerName) {
      return res.status(400).json({ error: 'Ya estás en este juego' });
    }
    
    // Actualizar juego
    game.player2 = playerName;
    game.status = 'playing';
    
    // Actualizar base de datos
    await pool.query(
      'UPDATE games SET player2 = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [playerName, 'playing', gameId]
    );
    
    res.json({ 
      gameId,
      message: `Te uniste al juego. ¡A jugar!`,
      player: playerName,
      opponent: game.player1
    });
    
    // Notificar a todos los sockets del juego
    io.to(gameId).emit('playerJoined', {
      player2: playerName,
      status: 'playing',
      message: `${playerName} se unió al juego. ¡Comienza la partida!`
    });
    
  } catch (error) {
    console.error('Error uniéndose al juego:', error);
    res.status(500).json({ error: 'Error uniéndose al juego' });
  }
});

// Obtener estado del juego
app.get('/api/rummy/games/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = games.get(gameId);
    
    if (!game) {
      return res.status(404).json({ error: 'Juego no encontrado' });
    }
    
    res.json(game);
  } catch (error) {
    console.error('Error obteniendo juego:', error);
    res.status(500).json({ error: 'Error obteniendo juego' });
  }
});

// Health check
//app.get('/health', (req, res) => {
//  res.json({ status: 'OK', timestamp: new Date().toISOString() });
//});
app.get('/api/rummy/health', (req, res) => {
    res.json({ status: 'OK', game: 'Rummy', timestamp: new Date().toISOString() });
  });

// Socket.IO para tiempo real
io.on('connection', (socket) => {
  console.log(`✅ Usuario conectado: ${socket.id}`);
  
  // Unirse a sala de juego
  socket.on('joinGame', async (data) => {
    const { gameId, playerName } = data;
    
    try {
      const game = games.get(gameId);
      if (!game) {
        socket.emit('error', { message: 'Juego no encontrado' });
        return;
      }
      
      // Verificar que el jugador puede unirse
      if (game.player1 !== playerName && game.player2 !== playerName) {
        socket.emit('error', { message: 'No estás autorizado para este juego' });
        return;
      }
      
      socket.join(gameId);
      playerSockets.set(socket.id, { gameId, playerName });
      
      // Enviar estado inicial
      socket.emit('gameState', {
        game,
        playerName,
        yourHand: playerName === game.player1 ? game.gameState.player1Hand : game.gameState.player2Hand
      });
      
      console.log(`${playerName} se unió al juego ${gameId}`);
      
    } catch (error) {
      console.error('Error en joinGame:', error);
      socket.emit('error', { message: 'Error uniéndose al juego' });
    }
  });
  
  // Hacer jugada
  socket.on('makeMove', async (data) => {
    const playerInfo = playerSockets.get(socket.id);
    if (!playerInfo) {
      socket.emit('error', { message: 'No estás en un juego' });
      return;
    }
    
    const { gameId, playerName } = playerInfo;
    const { moveType, moveData } = data;
    
    try {
      const game = games.get(gameId);
      if (!game || game.status !== 'playing') {
        socket.emit('error', { message: 'Juego no disponible' });
        return;
      }
      
      // Verificar turno
      if (game.gameState.currentPlayer !== playerName) {
        socket.emit('error', { message: 'No es tu turno' });
        return;
      }
      
      let moveResult = null;
      
      switch (moveType) {
        case 'formGroup':
          moveResult = await handleFormGroup(game, playerName, moveData);
          break;
        case 'drawTile':
          moveResult = await handleDrawTile(game, playerName);
          break;
        case 'endTurn':
          moveResult = await handleEndTurn(game, playerName);
          break;
        default:
          socket.emit('error', { message: 'Tipo de jugada inválido' });
          return;
      }
      
      if (moveResult.success) {
        // Guardar jugada en BD
        await pool.query(
          'INSERT INTO game_moves (game_id, player, move_type, move_data) VALUES ($1, $2, $3, $4)',
          [gameId, playerName, moveType, moveData]
        );
        
        // Actualizar estado en BD
        await pool.query(
          'UPDATE games SET game_state = $1, current_player = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [game.gameState, game.gameState.currentPlayer, gameId]
        );
        
        // Emitir nuevo estado a todos los jugadores
        io.to(gameId).emit('gameUpdated', {
          gameState: game.gameState,
          move: { player: playerName, type: moveType, result: moveResult.message },
          timestamp: new Date().toISOString()
        });
        
        // Enviar manos específicas a cada jugador
        const player1Socket = Array.from(io.sockets.sockets.values())
          .find(s => playerSockets.get(s.id)?.playerName === game.player1);
        const player2Socket = Array.from(io.sockets.sockets.values())
          .find(s => playerSockets.get(s.id)?.playerName === game.player2);
          
        if (player1Socket) {
          player1Socket.emit('yourHand', game.gameState.player1Hand);
        }
        if (player2Socket) {
          player2Socket.emit('yourHand', game.gameState.player2Hand);
        }
        
      } else {
        socket.emit('moveError', { message: moveResult.message });
      }
      
    } catch (error) {
      console.error('Error en makeMove:', error);
      socket.emit('error', { message: 'Error procesando jugada' });
    }
  });
  
  socket.on('disconnect', () => {
    const playerInfo = playerSockets.get(socket.id);
    if (playerInfo) {
      console.log(`❌ ${playerInfo.playerName} se desconectó del juego ${playerInfo.gameId}`);
      playerSockets.delete(socket.id);
    }
  });
});

// Handlers de jugadas
async function handleFormGroup(game, playerName, moveData) {
  const { selectedTiles } = moveData;
  
  if (!selectedTiles || selectedTiles.length < 3) {
    return { success: false, message: 'Necesitas al menos 3 fichas para formar un grupo' };
  }
  
  if (!isValidMeld(selectedTiles)) {
    return { success: false, message: 'Las fichas seleccionadas no forman un grupo válido' };
  }
  
  const isPlayer1 = game.player1 === playerName;
  const playerHand = isPlayer1 ? game.gameState.player1Hand : game.gameState.player2Hand;
  const playerInitialMeld = isPlayer1 ? game.gameState.player1InitialMeld : game.gameState.player2InitialMeld;
  
  // Verificar que el jugador tiene todas las fichas
  for (let tile of selectedTiles) {
    if (!playerHand.find(t => t.id === tile.id)) {
      return { success: false, message: 'No puedes usar fichas que no tienes' };
    }
  }
  
  // Verificar bajada inicial (30 puntos)
  if (!playerInitialMeld) {
    const groupValue = selectedTiles.reduce((sum, tile) => sum + calculateTileValue(tile), 0);
    if (groupValue < 30) {
      return { success: false, message: 'Tu primera bajada debe sumar al menos 30 puntos' };
    }
  }
  
  // Aplicar jugada
  game.gameState.tableGroups.push(selectedTiles);
  
  // Remover fichas de la mano del jugador
  if (isPlayer1) {
    game.gameState.player1Hand = game.gameState.player1Hand.filter(
      tile => !selectedTiles.some(st => st.id === tile.id)
    );
    if (!playerInitialMeld) game.gameState.player1InitialMeld = true;
  } else {
    game.gameState.player2Hand = game.gameState.player2Hand.filter(
      tile => !selectedTiles.some(st => st.id === tile.id)
    );
    if (!playerInitialMeld) game.gameState.player2InitialMeld = true;
  }
  
  // Verificar si el juego terminó
  const currentHand = isPlayer1 ? game.gameState.player1Hand : game.gameState.player2Hand;
  if (currentHand.length === 0) {
    await handleGameEnd(game, playerName);
    return { success: true, message: `¡${playerName} ha ganado la partida!` };
  }
  
  return { success: true, message: `Grupo válido formado por ${playerName}` };
}

async function handleDrawTile(game, playerName) {
  if (game.gameState.tiles.length === 0) {
    return { success: false, message: 'No hay más fichas en el mazo' };
  }
  
  const newTile = game.gameState.tiles.shift();
  const isPlayer1 = game.player1 === playerName;
  
  if (isPlayer1) {
    game.gameState.player1Hand.push(newTile);
  } else {
    game.gameState.player2Hand.push(newTile);
  }
  
  return { success: true, message: `${playerName} tomó una ficha del mazo` };
}

async function handleEndTurn(game, playerName) {
  // Cambiar turno
  game.gameState.currentPlayer = game.gameState.currentPlayer === game.player1 ? game.player2 : game.player1;
  
  return { success: true, message: `Turno terminado. Ahora juega ${game.gameState.currentPlayer}` };
}

async function handleGameEnd(game, winner) {
  game.status = 'finished';
  
  const isPlayer1Winner = game.player1 === winner;
  const loserHand = isPlayer1Winner ? game.gameState.player2Hand : game.gameState.player1Hand;
  const points = loserHand.reduce((sum, tile) => sum + calculateTileValue(tile), 0);
  
  if (isPlayer1Winner) {
    game.gameState.player1Score += points;
  } else {
    game.gameState.player2Score += points;
  }
  
  // Actualizar en BD
  await pool.query(
    'UPDATE games SET status = $1, game_state = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    [game.status, game.gameState, game.id]
  );
}



// =================== WHEEL FORTUNE GAME LOGIC ===================

// Jugadores fijos para wheel-fortune
const FIXED_PLAYERS_WHEEL = ['Peepo', 'Nachito', 'Fer'];

// Valores de la ruleta
const WHEEL_VALUES = [
  500, 800, 1000, 1500, 2000, 2500,
  'BANCARROTA', 'PIERDE_TURNO', 
  500, 1000, 1500, 2000
];

// Variables para wheel-fortune
const wheelGames = new Map();
const wheelPlayerSockets = new Map();
const wheelConnectedPlayers = new Map();

// Funciones auxiliares del wheel fortune
function spinWheel() {
  return WHEEL_VALUES[Math.floor(Math.random() * WHEEL_VALUES.length)];
}

function checkLetter(phrase, letter) {
  letter = letter.toUpperCase();
  const count = (phrase.match(new RegExp(letter, 'g')) || []).length;
  return {
    found: count > 0,
    count: count,
    letter: letter
  };
}

function revealLetters(phrase, revealedLetters) {
  return phrase.split('').map(char => {
    if (char === ' ') return '   ';
    if (revealedLetters.includes(char.toUpperCase())) return char;
    return '_';
  }).join(' ');
}

function isPhraseComplete(phrase, revealedLetters) {
  const uniqueLetters = [...new Set(phrase.replace(/\s/g, '').split(''))];
  return uniqueLetters.every(letter => revealedLetters.includes(letter.toUpperCase()));
}

function getNextPlayerWheel(currentPlayer) {
  const currentIndex = FIXED_PLAYERS_WHEEL.indexOf(currentPlayer);
  return FIXED_PLAYERS_WHEEL[(currentIndex + 1) % FIXED_PLAYERS_WHEEL.length];
}

async function saveWheelGameState(game) {
  await pool.query(
    `UPDATE wheel_games 
     SET revealed_letters = $1, current_player = $2, player_money = $3, 
         game_status = $4, consonants_used = $5, vowels_used = $6, last_activity = CURRENT_TIMESTAMP
     WHERE id = $7`,
    [
      JSON.stringify(game.revealedLetters),
      game.currentPlayer,
      JSON.stringify(game.playerMoney),
      game.gameStatus,
      JSON.stringify(game.consonantsUsed),
      JSON.stringify(game.vowelsUsed),
      game.id
    ]
  );
}

// Banco de frases
const WHEEL_PHRASES = {
  'PELICULAS MARVEL': [
    'IRON MAN TONY STARK GENIUS',
    'SPIDER MAN PETER PARKER',
    'THOR HAMMER MJOLNIR ASGARD',
    'CAPTAIN AMERICA STEVE ROGERS',
    'AVENGERS ENDGAME THANOS'
  ],
  'BASKETBALL NBA': [
    'LEBRON JAMES GOAT DEBATE',
    'STEPHEN CURRY THREE POINTER',
    'MICHAEL JORDAN BULLS',
    'KOBE BRYANT MAMBA MENTALITY',
    'NBA PLAYOFFS CHAMPIONSHIP'
  ],
  'GENERAL': [
    'NINTENDO SWITCH MARIO',
    'POKEMON PIKACHU TRAINER',
    'MINECRAFT STEVE CREEPER',
    'FORTNITE BATTLE ROYALE',
    'AMONG US IMPOSTOR'
  ]
};

async function getRandomPhraseWheel(category = null) {
  const categories = Object.keys(WHEEL_PHRASES);
  const selectedCategory = category || categories[Math.floor(Math.random() * categories.length)];
  
  const phrases = WHEEL_PHRASES[selectedCategory] || WHEEL_PHRASES['GENERAL'];
  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  
  return {
    phrase: phrase.toUpperCase(),
    category: selectedCategory
  };
}

// Inicializar tablas wheel fortune
async function initWheelDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wheel_games (
        id VARCHAR(20) PRIMARY KEY,
        phrase VARCHAR(200),
        category VARCHAR(50),
        revealed_letters JSONB DEFAULT '[]',
        current_player VARCHAR(50),
        player_money JSONB DEFAULT '{}',
        game_status VARCHAR(20) DEFAULT 'playing',
        round_number INTEGER DEFAULT 1,
        consonants_used JSONB DEFAULT '[]',
        vowels_used JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wheel_moves (
        id SERIAL PRIMARY KEY,
        game_id VARCHAR(20) REFERENCES wheel_games(id),
        player VARCHAR(50),
        move_type VARCHAR(30),
        move_data JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Tablas Wheel Fortune inicializadas');
  } catch (error) {
    console.error('❌ Error inicializando tablas Wheel:', error);
  }
}

// =================== WHEEL FORTUNE ROUTES ===================

// Health check wheel
app.get('/api/wheel/health', (req, res) => {
  res.json({ status: 'OK', game: 'Wheel Fortune', timestamp: new Date().toISOString() });
});

// Crear nuevo juego wheel
app.post('/api/wheel/games', async (req, res) => {
  try {
    const { category } = req.body;
    const gameId = 'WHEEL-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    
    const { phrase, category: selectedCategory } = await getRandomPhraseWheel(category);
    
    const initialMoney = {};
    FIXED_PLAYERS_WHEEL.forEach(player => {
      initialMoney[player] = 0;
    });
    
    // Guardar en base de datos
    await pool.query(
      `INSERT INTO wheel_games 
       (id, phrase, category, revealed_letters, current_player, player_money, consonants_used, vowels_used) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        gameId, phrase, selectedCategory, 
        JSON.stringify([]), FIXED_PLAYERS_WHEEL[0], JSON.stringify(initialMoney),
        JSON.stringify([]), JSON.stringify([])
      ]
    );
    
    res.json({ 
      gameId,
      message: `Juego creado: ${selectedCategory}`,
      category: selectedCategory,
      players: FIXED_PLAYERS_WHEEL
    });
  } catch (error) {
    console.error('Error creando juego wheel:', error);
    res.status(500).json({ error: 'Error creando juego' });
  }
});

// Obtener estado del juego
app.get('/api/wheel/games/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM wheel_games WHERE id = $1',
      [gameId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Juego no encontrado' });
    }
    
    const gameData = result.rows[0];
    const game = {
      id: gameData.id,
      phrase: gameData.phrase,
      category: gameData.category,
      revealedLetters: gameData.revealed_letters ? JSON.parse(gameData.revealed_letters) : [],
      currentPlayer: gameData.current_player,
      playerMoney: gameData.player_money ? JSON.parse(gameData.player_money) : {},
      gameStatus: gameData.game_status,
      roundNumber: gameData.round_number || 1,
      consonantsUsed: gameData.consonants_used ? JSON.parse(gameData.consonants_used) : [],
      vowelsUsed: gameData.vowels_used ? JSON.parse(gameData.vowels_used) : [],
      displayPhrase: revealLetters(gameData.phrase, gameData.revealed_letters ? JSON.parse(gameData.revealed_letters) : [])
    };
    
    res.json(game);
  } catch (error) {
    console.error('Error obteniendo juego wheel:', error);
    res.status(500).json({ error: 'Error obteniendo juego' });
  }
});

// Obtener juegos activos de un jugador
app.get('/api/wheel/my-games/:player', async (req, res) => {
  try {
    const { player } = req.params;
    
    const result = await pool.query(
      `SELECT id, category, current_player, player_money, game_status, last_activity
       FROM wheel_games 
       WHERE game_status = 'playing' 
       AND (current_player = $1 OR player_money::text LIKE '%"' || $1 || '"%')
       ORDER BY last_activity DESC`,
      [player]
    );
    
    const myGames = result.rows.map(row => ({
      gameId: row.id,
      category: row.category,
      currentPlayer: row.current_player,
      isMyTurn: row.current_player === player,
      myMoney: JSON.parse(row.player_money)[player] || 0,
      lastActivity: row.last_activity,
      status: row.game_status
    }));
    
    res.json({ games: myGames });
  } catch (error) {
    console.error('Error obteniendo juegos wheel:', error);
    res.status(500).json({ error: 'Error obteniendo juegos' });
  }
});

// Hacer jugada
app.post('/api/wheel/games/:gameId/play', async (req, res) => {
  try {
    const { gameId } = req.params;
    const { player, action, data } = req.body;
    
    // Cargar juego desde BD
    const result = await pool.query('SELECT * FROM wheel_games WHERE id = $1', [gameId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Juego no encontrado' });
    }
    
    const row = result.rows[0];
    const game = {
      id: row.id,
      phrase: row.phrase,
      category: row.category,
      revealedLetters: JSON.parse(row.revealed_letters),
      currentPlayer: row.current_player,
      playerMoney: JSON.parse(row.player_money),
      gameStatus: row.game_status,
      roundNumber: row.round_number,
      consonantsUsed: JSON.parse(row.consonants_used),
      vowelsUsed: JSON.parse(row.vowels_used)
    };
    
    if (game.currentPlayer !== player) {
      return res.status(400).json({ error: 'No es tu turno' });
    }
    
    let gameResult = { success: false, message: '' };
    
    switch (action) {
      case 'spin':
        const spinResult = spinWheel();
        gameResult = {
          success: true,
          message: `${player} giró: ${spinResult}`,
          wheelValue: spinResult,
          nextAction: typeof spinResult === 'number' ? 'guess_consonant' : 'lose_turn'
        };
        break;
        
      case 'guess_consonant':
        const { letter, wheelValue } = data;
        
        if (typeof wheelValue !== 'number') {
          if (wheelValue === 'BANCARROTA') {
            game.playerMoney[player] = 0;
            game.currentPlayer = getNextPlayerWheel(player);
            gameResult = { success: true, message: `${player} perdió todo - BANCARROTA!` };
          } else if (wheelValue === 'PIERDE_TURNO') {
            game.currentPlayer = getNextPlayerWheel(player);
            gameResult = { success: true, message: `${player} pierde el turno` };
          }
        } else {
          if (game.consonantsUsed.includes(letter.toUpperCase())) {
            gameResult = { success: false, message: 'Esa consonante ya fue usada' };
          } else {
            const letterCheck = checkLetter(game.phrase, letter);
            game.consonantsUsed.push(letter.toUpperCase());
            
            if (letterCheck.found) {
              game.revealedLetters.push(letter.toUpperCase());
              const earnings = wheelValue * letterCheck.count;
              game.playerMoney[player] += earnings;
              
              if (isPhraseComplete(game.phrase, game.revealedLetters)) {
                game.gameStatus = 'completed';
                gameResult = { 
                  success: true, 
                  message: `¡${player} completó la frase y ganó $${game.playerMoney[player]}!`,
                  gameComplete: true
                };
              } else {
                gameResult = { 
                  success: true, 
                  message: `¡Correcto! ${letterCheck.count} letra(s) '${letter}' - $${earnings}`
                };
              }
            } else {
              game.currentPlayer = getNextPlayerWheel(player);
              gameResult = { 
                success: true, 
                message: `No hay letra '${letter}' - turno de ${game.currentPlayer}` 
              };
            }
          }
        }
        break;
        
      case 'buy_vowel':
        const vowel = data.letter;
        
        if (game.playerMoney[player] < 250) {
          gameResult = { success: false, message: 'No tienes suficiente dinero para comprar una vocal ($250)' };
        } else if (game.vowelsUsed.includes(vowel.toUpperCase())) {
          gameResult = { success: false, message: 'Esa vocal ya fue comprada' };
        } else {
          game.vowelsUsed.push(vowel.toUpperCase());
          game.playerMoney[player] -= 250;
          
          const letterCheck = checkLetter(game.phrase, vowel);
          if (letterCheck.found) {
            game.revealedLetters.push(vowel.toUpperCase());
            
            if (isPhraseComplete(game.phrase, game.revealedLetters)) {
              game.gameStatus = 'completed';
              gameResult = { 
                success: true, 
                message: `¡${player} completó la frase con '${vowel}' y ganó $${game.playerMoney[player]}!`,
                gameComplete: true
              };
            } else {
              gameResult = { 
                success: true, 
                message: `¡Correcto! ${letterCheck.count} vocal(es) '${vowel}' por $250`
              };
            }
          } else {
            game.currentPlayer = getNextPlayerWheel(player);
            gameResult = { 
              success: true, 
              message: `No hay vocal '${vowel}' - turno de ${game.currentPlayer}` 
            };
          }
        }
        break;
        
      case 'solve_phrase':
        const solution = data.solution;
        const normalizedSolution = solution.toUpperCase().replace(/\s+/g, ' ').trim();
        const normalizedPhrase = game.phrase.replace(/\s+/g, ' ').trim();
        
        if (normalizedSolution === normalizedPhrase) {
          game.gameStatus = 'completed';
          game.revealedLetters = [...new Set(game.phrase.replace(/\s/g, '').split(''))];
          gameResult = {
            success: true,
            message: `¡${player} resolvió la frase y ganó $${game.playerMoney[player]}!`,
            gameComplete: true
          };
        } else {
          game.currentPlayer = getNextPlayerWheel(player);
          gameResult = {
            success: true,
            message: `Solución incorrecta - turno de ${game.currentPlayer}`
          };
        }
        break;
        
      default:
        return res.status(400).json({ error: 'Acción inválida' });
    }
    
    if (gameResult.success) {
      // Guardar en BD
      await saveWheelGameState(game);
      
      // Guardar jugada
      await pool.query(
        'INSERT INTO wheel_moves (game_id, player, move_type, move_data) VALUES ($1, $2, $3, $4)',
        [gameId, player, action, JSON.stringify(data)]
      );
    }
    
    res.json({
      ...gameResult,
      game: {
        ...game,
        displayPhrase: revealLetters(game.phrase, game.revealedLetters)
      }
    });
  } catch (error) {
    console.error('Error en jugada wheel:', error);
    res.status(500).json({ error: 'Error procesando jugada' });
  }
});

// =================== UPDATED MAIN ROUTES ===================

// Health check general actualizado
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    games: ['Rummy', 'Wheel Fortune'],
    timestamp: new Date().toISOString() 
  });
});

// Ruta principal
app.get('/', (req, res) => {
    res.send(`
      <h1>🎮 Family Games Backend</h1>
      <p>Backend unificado para juegos familiares</p>
      <ul>
        <li><a href="/api/rummy/health">🃏 Rummy Health Check</a></li>
        <li><a href="/api/wheel/health">🎡 Wheel Fortune Health Check</a></li>
        <li><a href="/health">📊 General Health Check</a></li>
      </ul>
      <p><strong>URLs importantes:</strong></p>
      <ul>
        <li>Rummy API: <code>/api/rummy/*</code></li>
        <li>Wheel Fortune API: <code>/api/wheel/*</code></li>
      </ul>
    `);
  });

// Servir frontend en producción
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}
  // Inicializar servidor
async function startServer() {
  await initDatabase();
  await initWheelDatabase(); // ✅ Agregar esta línea
  
  server.listen(PORT, () => {
    console.log(`🚀 Family games backend funcionando en puerto ${PORT}`);
    console.log(`🎮 Rummy y Wheel of fortune listos`);
  });
}

startServer().catch(console.error);