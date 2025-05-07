require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Variáveis de ambiente obrigatórias
const { VENUZ_PUBLIC_KEY, VENUZ_SECRET_KEY, MONGODB_URI } = process.env;
if (!VENUZ_PUBLIC_KEY || !VENUZ_SECRET_KEY) {
  console.error('Variáveis VENUZ_PUBLIC_KEY ou VENUZ_SECRET_KEY não definidas. Abortando.');
  process.exit(1);
}

// Conexão condicional com MongoDB (opcional)
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB conectado'))
    .catch(err => console.error('Erro conectando ao MongoDB:', err));
} else {
  console.warn('MONGODB_URI não definida - pulando conexão com MongoDB');
}

// URL base da API VenuzPay
const BASE_URL = 'https://app.venuzpay.com/api/v1';

// Middleware de autenticação VenuzPay: chaves em headers
app.use((req, res, next) => {
  req.venuzHeaders = {
    'x-public-key': VENUZ_PUBLIC_KEY,
    'x-secret-key': VENUZ_SECRET_KEY,
    'Content-Type': 'application/json',
  };
  next();
});

// Health checks
app.get('/', (req, res) => res.json({ ok: true, message: 'API VenuzPay ativo (raiz)' }));
app.get('/api', (req, res) => res.json({ ok: true, message: 'API VenuzPay ativo (/api)' }));

/**
 * POST /api/pix/create
 * Cria cobrança Pix (Cobrança imediata) na VenuzPay via POST /cob
 * Body: { amount: Number, description?: String, externalId?: String, customerEmail?: String }
 */
app.post('/api/pix/create', async (req, res) => {
  const url = `${BASE_URL}/cob`;
  const { amount, description, externalId, customerEmail } = req.body;
  // Aqui, usamos externalId como txid
  const payload = {
    amount,
    txid: externalId || `pix_${Date.now()}`,
    description: description || 'Cobrança via API',
    ...(customerEmail && { customerEmail }),
  };
  console.debug('POST VenuzPay create:', url, payload);
  try {
    const response = await axios.post(url, payload, { headers: req.venuzHeaders });
    console.debug('Resposta create:', response.status, response.data);
    // Espera-se que a resposta contenha: txid, qrCode (base64 ou URL)
    const { txid, qrCode, payload } = response.data;
    return res.status(201).json({ pixId: txid, qrCodeBase64: qrCode, qrCodeText: payload });
  } catch (err) {
    console.error('Erro criando Pix:', err.response?.status, err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({ error: err.response?.data || 'Falha ao criar cobrança Pix.' });
  }
});

/**
 * GET /api/pix/status/:id
 * Consulta status da cobrança via GET /cob/{txid}
 */
app.get('/api/pix/status/:id', async (req, res) => {
  const txid = req.params.id;
  const url = `${BASE_URL}/cob/${txid}`;
  console.debug('GET VenuzPay status:', url);
  try {
    const response = await axios.get(url, { headers: req.venuzHeaders });
    console.debug('Resposta status:', response.status, response.data);
    return res.json(response.data);
  } catch (err) {
    console.error('Erro consultando status Pix:', err.response?.status, err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({ error: err.response?.data || 'Falha ao consultar status Pix.' });
  }
});

// Webhook Pix (não altera payload)
app.post('/api/webhook/pix', (req, res) => {
  const { id, status } = req.body;
  console.log(`Webhook Pix recebido: ${id} -> ${status}`);
  return res.status(200).send('OK');
});

// Execução em dev local apenas
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Dev server rodando: http://localhost:${port}`));
}

module.exports = app;
