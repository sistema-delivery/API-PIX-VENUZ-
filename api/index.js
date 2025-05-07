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
 * Cria cobrança Pix na VenuzPay via POST /pix/create
 * Body: { amount, description?, externalId?, customerEmail? }
 */
app.post('/api/pix/create', async (req, res) => {
  const createUrl = `${BASE_URL}/pix/create`;
  const fallbackUrl = `${BASE_URL}/cob`;
  const { amount, description, externalId, customerEmail } = req.body;
  const createPayload = {
    amount,
    description: description || 'Cobrança via API',
    externalId: externalId || `pix_${Date.now()}`,
    ...(customerEmail && { customerEmail }),
  };
  console.log('[API] In /api/pix/create - attempting URL:', createUrl, 'payload:', createPayload);

  // Tenta primeiro /pix/create, senão /cob
  try {
    let response;
    try {
      response = await axios.post(createUrl, createPayload, { headers: req.venuzHeaders });
      console.log('[API] Success at /pix/create:', response.status);
    } catch (err) {
      console.warn('[API] /pix/create failed, status', err.response?.status, 'trying /cob');
      response = await axios.post(fallbackUrl, createPayload, { headers: req.venuzHeaders });
      console.log('[API] Success at /cob:', response.status);
    }
    console.log('[API] Response data:', response.data);
    const data = response.data;
    // Suporta respostas com diferentes chaves
    const pixId = data.id || data.txid || data.externalId;
    const qrCodeBase64 = data.qrCodeBase64 || data.qrCode || data.qr_code;
    const qrCodeText = data.qrCodeText || data.payload || data.text;
    return res.status(201).json({ pixId, qrCodeBase64, qrCodeText });
  } catch (err) {
    console.error('[API] Final error creating Pix:', err.response?.status, err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({ error: err.response?.data || 'Falha ao criar cobrança Pix.' });
  }
});

/**
 * GET /api/pix/status/:id
 * Consulta status da cobrança Pix via GET /pix/status/:id ou /cob/:id
 */
app.get('/api/pix/status/:id', async (req, res) => {
  const { id } = req.params;
  const statusUrls = [`${BASE_URL}/pix/status/${id}`, `${BASE_URL}/cob/${id}`];
  console.log('[API] In /api/pix/status - trying URLs:', statusUrls);
  for (const url of statusUrls) {
    try {
      const response = await axios.get(url, { headers: req.venuzHeaders });
      console.log('[API] Success at', url, response.data);
      return res.json(response.data);
    } catch (err) {
      console.warn('[API] Status check failed at', url, err.response?.status);
    }
  }
  console.error('[API] All status endpoints failed for id', id);
  return res.status(404).json({ error: 'Status Pix não encontrado.' });
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
