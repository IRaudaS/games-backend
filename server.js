// server.js - Backend unificado para juegos familiares

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const initializeRummy = require('./rummy.js');
const initializeWheelOfFortune = require('./wheel.js');

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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://username:password@localhost/rummy_db',
  ssl: false 
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));


// Inicializar base de datos
async function initDatabases() {
  try {
    // Inicialización de la tabla de Rummy
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
    
    // Inicialización de la tabla de Wheel of Fortune
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
    
    console.log('✅ Todas las bases de datos inicializadas');
  } catch (error) {
    console.error('❌ Error inicializando bases de datos:', error);
  }
}

// Pasamos las dependencias (app, io, pool) a cada módulo
initializeRummy(app, io, pool);
initializeWheelOfFortune(app, pool);


// Rutas principales
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    games: ['Rummy', 'Wheel Fortune'],
    timestamp: new Date().toISOString() 
  });
});

app.get('/', (req, res) => {
    res.send(`<h1>🎮 Family Games Backend</h1><p>Versión Modular</p>`);
});

// Servir frontend en producción
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

// Inicializar servidor
async function startServer() {
  await initDatabases();
  
  server.listen(PORT, () => {
    console.log(`🚀 Family games backend modular funcionando en puerto ${PORT}`);
  });
}

startServer().catch(console.error);