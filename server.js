// server.js - Backend unificado para juegos familiares

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

// --> NUEVO: Importamos los módulos de cada juego
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


// Inicializar base de datos (esta lógica se queda aquí)
async function initDatabases() {
  try {
    // Inicialización de la tabla de Rummy
    await pool.query(`CREATE TABLE IF NOT EXISTS games (...)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS game_moves (...)`);
    
    // Inicialización de la tabla de Wheel of Fortune
    await pool.query(`CREATE TABLE IF NOT EXISTS wheel_games (...)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS wheel_moves (...)`);
    
    console.log('✅ Todas las bases de datos inicializadas');
  } catch (error) {
    console.error('❌ Error inicializando bases de datos:', error);
  }
}

// --> NUEVO: Pasamos las dependencias (app, io, pool) a cada módulo
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