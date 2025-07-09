// rummy.js - Lógica exclusiva para el juego de Rummy

const { VertexAI } = require('@google-cloud/vertexai');

const vertex_ai = new VertexAI({project: 'rummy-464118', location: 'us-central1'});
const model = vertex_ai.getGenerativeModel({
    model: 'gemini-2.5-flash',
});

const RUMMY_BACKUP_TIPS = [
    "Un comodín guardado es un 'te quiero' para el futuro de la partida.",
    "¿Esa jugada fue tan brillante como los ojos de tu aloe?",
    "Desde México hasta Chile, ¡que esta jugada cruce fronteras!",
    "Recuerda, en el Rummy y en el amor, la paciencia es clave.",
    "¡Qué movimiento! Digno de la jugadora favorita de Rummy."
];

async function getCouplesRummyMessage(playerName) {
    const prompt = `Actúa como un comentarista divertido y un poco romántico para una partida de Rummy, el de fichas y números, no el de cartas entre una pareja, Olianna y Nacho. El jugador llamado '${playerName}' acaba de hacer su primera jugada importante ('bajar' sus fichas). Genera un mensaje corto y juguetón para celebrar este momento clave. Sé creativo y juguetón. Responde únicamente con el mensaje. Olianna actualmente está en Valdivia, Chile y Nacho en la Ciudad de México y por eso juegan este juego a distancia. El Rummy es el juego favorito de Olianna. Entre ellos tienen una forma juguetona de decirse "Mi aloe" porque un autocorrector puso mal "mi amor" una vez, asi que los puedes llamar "Aloes" ocasionalmente. Olianna es de Venezuela y Nacho de México.`;
    try {
        const request = { contents: [{role: 'user', parts: [{text: prompt}]}] };
        const result = await model.generateContent(request);
        return result.response.candidates[0].content.parts[0].text.trim().replace(/"/g, '');
    } catch (error) {
        console.error("Error al llamar a Gemini para el consejo de Rummy, usando respaldo:", error);
        return RUMMY_BACKUP_TIPS[Math.floor(Math.random() * RUMMY_BACKUP_TIPS.length)];
    }
}

const COLORS = ['rojo', 'azul', 'verde', 'naranja'];
const TOTAL_TILES = 106;

function createTileSet() {
  const tiles = [];
  let id = 0;
  for (let set = 0; set < 2; set++) {
    for (let color of COLORS) {
      for (let num = 1; num <= 13; num++) {
        tiles.push({ id: id++, number: num, color: color, isJoker: false });
      }
    }
  }
  tiles.push({ id: id++, number: '★', color: 'joker', isJoker: true });
  tiles.push({ id: id++, number: '★', color: 'joker', isJoker: true });
  return tiles;
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function generateRoomCode() {
  return 'RUMMY-' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

function isValidRun(tiles) {
  if (tiles.length < 3) return false;
  const nonJokers = tiles.filter(t => !t.isJoker);
  if (nonJokers.length === 0) return false;
  const color = nonJokers[0].color;
  if (!nonJokers.every(t => t.color === color)) return false;
  const numbers = nonJokers.map(t => t.number).sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] !== numbers[i-1] + 1) return false;
  }
  return true;
}

function isValidGroup(tiles) {
  if (tiles.length < 3) return false;
  const nonJokers = tiles.filter(t => !t.isJoker);
  if (nonJokers.length === 0) return false;
  const number = nonJokers[0].number;
  if (!nonJokers.every(t => t.number === number)) return false;
  const colors = new Set(nonJokers.map(t => t.color));
  return colors.size === nonJokers.length;
}

function isValidMeld(tiles) {
  return isValidRun(tiles) || isValidGroup(tiles);
}

function calculateTileValue(tile) {
  return tile.isJoker ? 0 : tile.number;
}

module.exports = function(app, io, pool) {
    const games = new Map();
    const playerSockets = new Map();

    async function handleGameEnd(game, winner) {
        game.status = 'finished';
        const isPlayer1Winner = game.player1 === winner;
        const loserHand = isPlayer1Winner ? game.gameState.player2Hand : game.gameState.player1Hand;
        const points = loserHand.reduce((sum, tile) => sum + calculateTileValue(tile), 0);
        if (isPlayer1Winner) game.gameState.player1Score += points;
        else game.gameState.player2Score += points;
        await pool.query('UPDATE games SET status = $1, game_state = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [game.status, game.gameState, game.id]);
    }

    async function handleFormGroup(game, playerName, moveData) {
        const { selectedTiles } = moveData;
        if (!selectedTiles || selectedTiles.length < 3) return { success: false, message: 'Necesitas al menos 3 fichas para formar un grupo' };
        if (!isValidMeld(selectedTiles)) return { success: false, message: 'Las fichas seleccionadas no forman un grupo válido' };
        
        const isPlayer1 = game.player1 === playerName;
        const playerHand = isPlayer1 ? game.gameState.player1Hand : game.gameState.player2Hand;
        const playerInitialMeld = isPlayer1 ? game.gameState.player1InitialMeld : game.gameState.player2InitialMeld;

        for (let tile of selectedTiles) {
            if (!playerHand.find(t => t.id === tile.id)) return { success: false, message: 'No puedes usar fichas que no tienes' };
        }

        if (!playerInitialMeld) {
            const groupValue = selectedTiles.reduce((sum, tile) => sum + calculateTileValue(tile), 0);
            if (groupValue < game.gameState.initialMeldPoints) {
                return { success: false, message: `Tu primera bajada debe sumar al menos ${game.gameState.initialMeldPoints} puntos` };
            }
            game.gameState.currentTip = await getCouplesRummyMessage(playerName);
        }
        
        game.gameState.tableGroups.push(selectedTiles);
        
        if (isPlayer1) {
            game.gameState.player1Hand = game.gameState.player1Hand.filter(tile => !selectedTiles.some(st => st.id === tile.id));
            if (!playerInitialMeld) game.gameState.player1InitialMeld = true;
        } else {
            game.gameState.player2Hand = game.gameState.player2Hand.filter(tile => !selectedTiles.some(st => st.id === tile.id));
            if (!playerInitialMeld) game.gameState.player2InitialMeld = true;
        }
        
        const currentHand = isPlayer1 ? game.gameState.player1Hand : game.gameState.player2Hand;
        if (currentHand.length === 0) {
            await handleGameEnd(game, playerName);
            return { success: true, message: `¡${playerName} ha ganado la partida!` };
        }
        
        return { success: true, message: `Grupo válido formado por ${playerName}` };
    }

    async function handleDrawTile(game, playerName) {
        if (game.gameState.hasDrawnThisTurn) return { success: false, message: 'Ya tomaste una ficha en este turno.' };
        if (game.gameState.tiles.length === 0) return { success: false, message: 'No hay más fichas en el mazo' };
        
        const newTile = game.gameState.tiles.shift();
        const isPlayer1 = game.player1 === playerName;
        if (isPlayer1) game.gameState.player1Hand.push(newTile);
        else game.gameState.player2Hand.push(newTile);
        
        game.gameState.hasDrawnThisTurn = true;
        return { success: true, message: `${playerName} tomó una ficha del mazo` };
    }

    async function handleEndTurn(game, playerName) {
        game.gameState.currentPlayer = game.gameState.currentPlayer === game.player1 ? game.player2 : game.player1;
        game.gameState.hasDrawnThisTurn = false;
        return { success: true, message: `Turno terminado. Ahora juega ${game.gameState.currentPlayer}` };
    }

    app.post('/api/rummy/games', async (req, res) => {
        try {
            const { playerName, initialMeldPoints = 30 } = req.body;
            const gameId = generateRoomCode();
            const allTiles = shuffleArray(createTileSet());
            const gameState = {
                tiles: allTiles.slice(28),
                player1Hand: allTiles.slice(0, 14),
                player2Hand: allTiles.slice(14, 28),
                tableGroups: [],
                player1Score: 0,
                player2Score: 0,
                player1InitialMeld: false,
                player2InitialMeld: false,
                currentPlayer: playerName,
                currentTip: "¡Que comience la partida de los Aloes!",
                initialMeldPoints: parseInt(initialMeldPoints, 10),
                hasDrawnThisTurn: false,
                isProcessing: false,
            };
            await pool.query('INSERT INTO games (id, player1, current_player, game_state) VALUES ($1, $2, $3, $4)', [gameId, playerName, playerName, gameState]);
            games.set(gameId, { id: gameId, player1: playerName, player2: null, status: 'waiting', gameState });
            res.json({ gameId, message: `Juego creado. Comparte el código: ${gameId}`, player: playerName });
        } catch (error) {
            console.error('Error creando juego:', error);
            res.status(500).json({ error: 'Error creando juego' });
        }
    });

    app.post('/api/rummy/games/:gameId/join', async (req, res) => {
        try {
            const { gameId } = req.params;
            const { playerName } = req.body;
            const game = games.get(gameId);
            if (!game) return res.status(404).json({ error: 'Juego no encontrado' });
            if (game.player2) return res.status(400).json({ error: 'Juego lleno' });
            if (game.player1 === playerName) return res.status(400).json({ error: 'Ya estás en este juego' });
            
            game.player2 = playerName;
            game.status = 'playing';
            await pool.query('UPDATE games SET player2 = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [playerName, 'playing', gameId]);
            res.json({ gameId, message: `Te uniste al juego. ¡A jugar!`, player: playerName, opponent: game.player1 });
            io.to(gameId).emit('playerJoined', { player2: playerName, status: 'playing', message: `${playerName} se unió al juego. ¡Comienza la partida!` });
        } catch (error) {
            console.error('Error uniéndose al juego:', error);
            res.status(500).json({ error: 'Error uniéndose al juego' });
        }
    });

    app.get('/api/rummy/health', (req, res) => {
        res.json({ status: 'OK', game: 'Rummy', timestamp: new Date().toISOString() });
    });

    io.on('connection', (socket) => {
        socket.on('joinGame', async (data) => {
            const { gameId, playerName } = data;
            try {
                const game = games.get(gameId);
                if (!game) return socket.emit('error', { message: 'Juego no encontrado' });
                if (game.player1 !== playerName && game.player2 !== playerName) return socket.emit('error', { message: 'No estás autorizado para este juego' });
                
                socket.join(gameId);
                playerSockets.set(socket.id, { gameId, playerName });
                socket.emit('gameState', { game, playerName, yourHand: playerName === game.player1 ? game.gameState.player1Hand : game.gameState.player2Hand });
                console.log(`${playerName} se unió al juego ${gameId}`);
            } catch (error) {
                console.error('Error en joinGame:', error);
                socket.emit('error', { message: 'Error uniéndose al juego' });
            }
        });

        socket.on('makeMove', async (data) => {
            const playerInfo = playerSockets.get(socket.id);
            if (!playerInfo) return socket.emit('error', { message: 'No estás en un juego' });
            
            const { gameId, playerName } = playerInfo;
            const game = games.get(gameId);

            if (game.gameState.isProcessing) {
                return socket.emit('moveError', { message: 'Espera, se está procesando otra jugada.' });
            }

            game.gameState.isProcessing = true;
            try {
                const { moveType, moveData } = data;
                if (!game || game.status !== 'playing') throw new Error('Juego no disponible');
                if (game.gameState.currentPlayer !== playerName) throw new Error('No es tu turno');
                
                let moveResult = null;
                switch (moveType) {
                    case 'formGroup': moveResult = await handleFormGroup(game, playerName, moveData); break;
                    case 'drawTile': moveResult = await handleDrawTile(game, playerName); break;
                    case 'endTurn': moveResult = await handleEndTurn(game, playerName); break;
                    default: throw new Error('Tipo de jugada inválido');
                }
                
                if (moveResult.success) {
                    await pool.query('INSERT INTO game_moves (game_id, player, move_type, move_data) VALUES ($1, $2, $3, $4)', [gameId, playerName, moveType, moveData]);
                    await pool.query('UPDATE games SET game_state = $1, current_player = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [game.gameState, game.gameState.currentPlayer, gameId]);
                    io.to(gameId).emit('gameUpdated', { gameState: game.gameState, move: { player: playerName, type: moveType, result: moveResult.message }, timestamp: new Date().toISOString() });
                    
                    const player1Socket = Array.from(io.sockets.sockets.values()).find(s => playerSockets.get(s.id)?.playerName === game.player1);
                    const player2Socket = Array.from(io.sockets.sockets.values()).find(s => playerSockets.get(s.id)?.playerName === game.player2);
                    if (player1Socket) player1Socket.emit('yourHand', game.gameState.player1Hand);
                    if (player2Socket) player2Socket.emit('yourHand', game.gameState.player2Hand);
                } else {
                    socket.emit('moveError', { message: moveResult.message });
                }
            } catch (error) {
                console.error('Error en makeMove:', error);
                socket.emit('error', { message: error.message || 'Error procesando jugada' });
            } finally {
                if (game) game.gameState.isProcessing = false;
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
};