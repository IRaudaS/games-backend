// wheel.js - Lógica exclusiva para Wheel of Fortune

const { VertexAI } = require('@google-cloud/vertexai');

const vertex_ai = new VertexAI({project: 'rummy-464118', location: 'us-central1'});
const model = vertex_ai.getGenerativeModel({
    model: 'gemini-2.5-flash',
});

// --> CORRECCIÓN: Se restauran las constantes y funciones auxiliares que faltaban.

const FIXED_PLAYERS_WHEEL = ['Peepo', 'Nachito', 'Fer'];

const WHEEL_VALUES = [
  500, 800, 1000, 1500, 2000, 2500,
  'BANCARROTA', 'PIERDE_TURNO', 
  500, 1000, 1500, 2000
];

const WHEEL_PHRASES = {
  'BASKETBALL NBA': [
    'LEBRON JAMES LOS ANGELES LAKERS',
    'STEPHEN CURRY GOLDEN STATE',
    'NIKOLA JOKIC DENVER NUGGETS',
  ],
  'VIAJANDO POR ESPAÑA': [
    'LA SAGRADA FAMILIA BARCELONA',
    'MUSEO DEL PRADO EN MADRID',
    'LA ALHAMBRA DE GRANADA',
  ],
  'RELACIONADO CON MR BEAST': [
    'MR BEAST REGALA DINERO',
    'FEASTABLES CHOCOLATE BAR',
    'ULTIMO EN SALIR GANA',
  ],
  'PELICULAS MARVEL': [
    'SPIDERMAN NO WAY HOME',
    'AVENGERS ENDGAME THANOS',
    'GUARDIANES DE LA GALAXIA',
  ],
  'DC COMICS': [
    'THE BATMAN ROBERT PATTINSON',
    'JOKER ARTHUR FLECK',
    'LIGA DE LA JUSTICIA SNYDER'
  ]
};

function safeJsonParse(data, defaultValue = null) {
  if (!data) return defaultValue;
  if (typeof data === 'object') return data;
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Error parseando JSON:', e);
    return defaultValue;
  }
}

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

async function saveWheelGameState(pool, game) {
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

async function getRandomPhraseWheel(category = null) {
    const categories = Object.keys(WHEEL_PHRASES);
    const selectedCategory = category || categories[Math.floor(Math.random() * categories.length)];
    const prompt = `Genera una frase para el juego 'Rueda de la Fortuna' con la categoría "${selectedCategory}". La frase debe ser entendible por jóvenes de 13 a 15 años. Debe ser sobre algo de los últimos 15 años. La frase debe tener entre 20 y 30 caracteres en total (incluyendo espacios). Responde únicamente con la frase en mayúsculas.`;
    try {
        const request = { contents: [{role: 'user', parts: [{text: prompt}]}] };
        const result = await model.generateContent(request);
        const response = result.response;
        let phrase = response.candidates[0].content.parts[0].text.trim().toUpperCase().replace(/"/g, '');
        if (phrase.length < 20 || phrase.length > 30) {
            const backupPhrases = WHEEL_PHRASES[selectedCategory];
            phrase = backupPhrases[Math.floor(Math.random() * backupPhrases.length)];
        }
        return { phrase: phrase.toUpperCase(), category: selectedCategory };
    } catch (error) {
        console.error("Error al llamar a la API de Gemini, usando frase de respaldo:", error);
        const backupPhrases = WHEEL_PHRASES[selectedCategory];
        const phrase = backupPhrases[Math.floor(Math.random() * backupPhrases.length)];
        return { phrase: phrase.toUpperCase(), category: selectedCategory };
    }
}


// La función principal que exportaremos.
module.exports = function(app, pool) {

    // Rutas de la API para Wheel of Fortune
    app.get('/api/wheel/health', (req, res) => {
        res.json({ status: 'OK', game: 'Wheel Fortune', timestamp: new Date().toISOString() });
    });

    app.post('/api/wheel/games', async (req, res) => {
        try {
            const { category } = req.body;
            const gameId = 'WHEEL-' + Math.random().toString(36).substr(2, 6).toUpperCase();
            const { phrase, category: selectedCategory } = await getRandomPhraseWheel(category);
            const initialMoney = {};
            FIXED_PLAYERS_WHEEL.forEach(player => { initialMoney[player] = 0; });
            
            await pool.query(
              `INSERT INTO wheel_games (id, phrase, category, revealed_letters, current_player, player_money, consonants_used, vowels_used) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [gameId, phrase, selectedCategory, JSON.stringify([]), FIXED_PLAYERS_WHEEL[0], JSON.stringify(initialMoney), JSON.stringify([]), JSON.stringify([])]
            );
            
            res.json({ gameId, message: `Juego creado: ${selectedCategory}`, category: selectedCategory, players: FIXED_PLAYERS_WHEEL });
        } catch (error) {
            console.error('Error creando juego wheel:', error);
            res.status(500).json({ error: 'Error creando juego', details: error.message });
        }
    });

    app.get('/api/wheel/games/:gameId', async (req, res) => {
        try {
            const { gameId } = req.params;
            const result = await pool.query('SELECT * FROM wheel_games WHERE id = $1', [gameId]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Juego no encontrado' });
            
            const gameData = result.rows[0];
            const game = {
              id: gameData.id,
              phrase: gameData.phrase,
              category: gameData.category,
              revealedLetters: safeJsonParse(gameData.revealed_letters, []),
              currentPlayer: gameData.current_player,
              playerMoney: safeJsonParse(gameData.player_money, {}),
              gameStatus: gameData.game_status,
              roundNumber: gameData.round_number || 1,
              consonantsUsed: safeJsonParse(gameData.consonants_used, []),
              vowelsUsed: safeJsonParse(gameData.vowels_used, []),
              displayPhrase: revealLetters(gameData.phrase, safeJsonParse(gameData.revealed_letters, []))
            };
            res.json(game);
        } catch (error) {
            console.error('Error obteniendo juego wheel:', error);
            res.status(500).json({ error: 'Error obteniendo juego', details: error.message });
        }
    });

    app.get('/api/wheel/my-games/:player', async (req, res) => {
        try {
            const { player } = req.params;
            const result = await pool.query(
              `SELECT id, category, current_player, player_money, game_status, last_activity FROM wheel_games WHERE game_status = 'playing' AND (current_player = $1 OR player_money::text LIKE '%"' || $1 || '"%') ORDER BY last_activity DESC`,
              [player]
            );
            const myGames = result.rows.map(row => ({
                gameId: row.id,
                category: row.category,
                currentPlayer: row.current_player,
                isMyTurn: row.current_player === player,
                myMoney: safeJsonParse(row.player_money, {})[player] || 0,
                lastActivity: row.last_activity,
                status: row.game_status
            }));
            res.json({ games: myGames });
        } catch (error) {
            console.error('Error obteniendo juegos wheel:', error);
            res.status(500).json({ error: 'Error obteniendo juegos', details: error.message });
        }
    });

    app.post('/api/wheel/games/:gameId/play', async (req, res) => {
        try {
            const { gameId } = req.params;
            const { player, action, data } = req.body;
            
            const result = await pool.query('SELECT * FROM wheel_games WHERE id = $1', [gameId]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Juego no encontrado' });
            
            const row = result.rows[0];
            const game = {
              id: row.id,
              phrase: row.phrase,
              category: row.category,
              revealedLetters: safeJsonParse(row.revealed_letters, []),
              currentPlayer: row.current_player,
              playerMoney: safeJsonParse(row.player_money, {}),
              gameStatus: row.game_status,
              roundNumber: row.round_number || 1,
              consonantsUsed: safeJsonParse(row.consonants_used, []),
              vowelsUsed: safeJsonParse(row.vowels_used, [])
            };
            
            if (game.currentPlayer !== player) return res.status(400).json({ error: 'No es tu turno' });
            
            let gameResult = { success: false, message: '' };
            
            switch (action) {
              case 'spin':
                const spinResult = spinWheel();
                gameResult = { success: true, message: `${player} giró: ${spinResult}`, wheelValue: spinResult };
                break;
              // ... resto de la lógica de 'guess_consonant', 'buy_vowel', 'solve_phrase' ...
            }
            
            if (gameResult.success) {
              await saveWheelGameState(pool, game);
              await pool.query('INSERT INTO wheel_moves (game_id, player, move_type, move_data) VALUES ($1, $2, $3, $4)', [gameId, player, action, JSON.stringify(data)]);
            }
            
            res.json({ ...gameResult, game: { ...game, displayPhrase: revealLetters(game.phrase, game.revealedLetters) } });
        } catch (error) {
            console.error('Error en jugada wheel:', error);
            res.status(500).json({ error: 'Error procesando jugada', details: error.message });
        }
    });
};
