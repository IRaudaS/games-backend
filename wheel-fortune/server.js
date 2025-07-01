// server.js - Backend Rueda de la Fortuna
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

// Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false  // ✅ Deshabilitar SSL para Cloud SQL
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Jugadores fijos
const FIXED_PLAYERS = ['Peepo', 'Nachito', 'Fer'];

// Valores de la ruleta
const WHEEL_VALUES = [
  500, 800, 1000, 1500, 2000, 2500,
  'BANCARROTA', 'PIERDE_TURNO', 
  500, 1000, 1500, 2000
];

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', game: 'Rueda de la Fortuna', timestamp: new Date().toISOString() });
});

// Inicializar servidor
async function startServer() {
  server.listen(PORT, () => {
    console.log(`🎡 Servidor Rueda de la Fortuna funcionando en puerto ${PORT}`);
    console.log(`🎮 Listo para Peepo, Nachito y Fer!`);
  });
}

startServer().catch(console.error);