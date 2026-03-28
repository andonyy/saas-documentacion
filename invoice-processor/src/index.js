const path = require('path');
const dotenv = require('dotenv');
const envResult = dotenv.config({ path: path.join(__dirname, '..', '.env') });
if (envResult.parsed) {
  Object.assign(process.env, envResult.parsed);
}
const express = require('express');
const fs = require('fs');
const invoiceRoutes = require('./routes/invoices');

const app = express();
app.use(express.json());

// CORS para el frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Servir frontend
const frontDir = path.join(__dirname, '..', '..', 'front');
app.use(express.static(frontDir));

fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.use('/api/invoices', invoiceRoutes);

const vaultRoutes = require('./routes/vault');
app.use('/api/vault', vaultRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Invoice processor running on http://localhost:${PORT}`);

  // Arrancar Telegram bot si hay token
  const { startTelegramBot } = require('./services/telegram');
  startTelegramBot();
});
