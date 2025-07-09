// wheel.js - Lógica exclusiva para Wheel of Fortune

const { VertexAI } = require('@google-cloud/vertexai');

const vertex_ai = new VertexAI({project: 'rummy-464118', location: 'us-central1'});
const model = vertex_ai.getGenerativeModel({ model: 'gemini-2.5-flash' });

const FIXED_PLAYERS_WHEEL = ['Peepo', 'Nachito', 'Fer'];
const WHEEL_VALUES = [ 500, 800, 1000, 1500, 2000, 2500, 'ADIOS 1/2 $$', 'PIERDE_TURNO', 500, 1000, 1500, 2000 ];
const WHEEL_PHRASES = { /* ... (sin cambios) ... */ };

function safeJsonParse(data, defaultValue = null) { /* ... */ }
function spinWheel() { return WHEEL_VALUES[Math.floor(Math.random() * WHEEL_VALUES.length)]; }
function checkLetter(phrase, letter) { /* ... */ }
function revealLetters(phrase, revealedLetters) { /* ... */ }
function isPhraseComplete(phrase, revealedLetters) { /* ... */ }
function getNextPlayerWheel(currentPlayer) { /* ... */ }
async function saveWheelGameState(pool, game) { /* ... */ }
async function getRandomPhraseWheel(category = null) { /* ... */ }

module.exports = function(app, pool) {
    app.get('/api/wheel/health', (req, res) => { /* ... */ });
    app.post('/api/wheel/games', async (req, res) => { /* ... */ });
    app.get('/api/wheel/games/:gameId', async (req, res) => { /* ... */ });
    app.get('/api/wheel/my-games/:player', async (req, res) => { /* ... */ });

    app.post('/api/wheel/games/:gameId/play', async (req, res) => {
        try {
            const { gameId } = req.params;
            const { player, action, data } = req.body;
            
            const result = await pool.query('SELECT * FROM wheel_games WHERE id = $1', [gameId]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Juego no encontrado' });
            
            const row = result.rows[0];
            const game = {
              id: row.id, phrase: row.phrase, category: row.category,
              revealedLetters: safeJsonParse(row.revealed_letters, []),
              currentPlayer: row.current_player,
              playerMoney: safeJsonParse(row.player_money, {}),
              gameStatus: row.game_status,
              roundNumber: row.round_number || 1,
              consonantsUsed: safeJsonParse(row.consonants_used, []),
              vowelsUsed: safeJsonParse(row.vowels_used, [])
            };
            
            if (game.currentPlayer !== player) return res.status(400).json({ error: 'No es tu turno' });
            
            let gameResult = { success: true, message: '' };
            
            switch (action) {
              case 'spin':
                const spinResult = spinWheel();
                // --> CORRECCIÓN: La lógica de 'ADIOS 1/2 $$' y 'PIERDE_TURNO' se maneja aquí mismo.
                if (spinResult === 'ADIOS 1/2 $$') {
                    game.playerMoney[player] = Math.floor(game.playerMoney[player] / 2);
                    game.currentPlayer = getNextPlayerWheel(player);
                    gameResult = { success: true, message: `¡Adiós a la mitad de tu dinero, ${player}!`, wheelValue: spinResult };
                } else if (spinResult === 'PIERDE_TURNO') {
                    game.currentPlayer = getNextPlayerWheel(player);
                    gameResult = { success: true, message: `${player} pierde el turno.`, wheelValue: spinResult };
                } else {
                    gameResult = { success: true, message: `${player} giró por $${spinResult}`, wheelValue: spinResult };
                }
                break;
              
              case 'guess_consonant':
                const { letter, wheelValue } = data;
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
                            gameResult = { success: true, message: `¡${player} completó la frase y ganó ${game.playerMoney[player]}!`, gameComplete: true };
                        } else {
                            gameResult = { success: true, message: `¡Correcto! ${letterCheck.count} '${letter}' por $${earnings}` };
                        }
                    } else {
                        game.currentPlayer = getNextPlayerWheel(player);
                        gameResult = { success: true, message: `No hay '${letter}'. Turno de ${game.currentPlayer}` };
                    }
                }
                break;

              // ... (casos 'buy_vowel' y 'solve_phrase' sin cambios) ...
            }
            
            await saveWheelGameState(pool, game);
            await pool.query('INSERT INTO wheel_moves (game_id, player, move_type, move_data) VALUES ($1, $2, $3, $4)', [gameId, player, action, JSON.stringify(data)]);
            
            res.json({ ...gameResult, game: { ...game, displayPhrase: revealLetters(game.phrase, game.revealedLetters) } });
        } catch (error) {
            console.error('Error en jugada wheel:', error);
            res.status(500).json({ error: 'Error procesando jugada', details: error.message });
        }
    });
};