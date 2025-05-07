require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Variáveis de ambiente obrigatórias
const { VENUZ_PUBLIC_KEY, VENUZ_SECRET_KEY, MONGODB_URI, CREATE_PATH } = process.env;
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
// Endpoint de criação configurável via ENV (ex: '/pix/create' ou '/cob')
const CREATE_ENDPOINT = CREATE_PATH || '/pix/create';

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
 * Cria cobrança Pix na VenuzPay. Path configurável via CREATE_PATH.
 * Body: { amount, description?, externalId?, customerEmail? }
 */
app.post('/api/pix/create', async (req, res) => {
  const createUrl = `${BASE_URL}${CREATE_ENDPOINT}`;
  const { amount, description, externalId, customerEmail } = req.body;
  const payload = {
    amount,
    // para algumas APIs este campo pode ser txid, externalId ou id
    txid: externalId || `pix_${Date.now()}`,
    description: description || 'Cobrança via API',
    ...(customerEmail && { customerEmail }),
  };
  console.log('[API] Chamando VenuzPay em', createUrl, 'com payload:', payload);
  try {
    const response = await axios.post(createUrl, payload, { headers: req.venuzHeaders });
    console.log('[API] Response:', response.status, response.data);
    const data = response.data;
    // Ajuste chaves conforme retorno
    const pixId = data.id || data.txid || data.externalId;
    const qrCodeBase64 = data.qrCodeBase64 || data.qrCode || data.qr_code;
    const qrCodeText = data.qrCodeText || data.payload || data.text;
    return res.status(201).json({ pixId, qrCodeBase64, qrCodeText });
  } catch (err) {
    console.error('[API] Erro criando Pix:', err.response?.status, err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({ error: err.response?.data || 'Falha ao criar cobrança Pix.' });
  }
});

/**
 * GET /api/pix/status/:id
 * Consulta status da cobrança via GET /cob/:id ou /pix/status/:id (não configurável)
 */
app.get('/api/pix/status/:id', async (req, res) => {
  const { id } = req.params;
  const urls = [`${BASE_URL}/pix/status/${id}`, `${BASE_URL}/cob/${id}`];
  console.log('[API] Consultando status em', urls);
  for (const url of urls) {
    try {
      const response = await axios.get(url, { headers: req.venuzHeaders });
      console.log('[API] Status', url, response.status, response.data);
      return res.json(response.data);
    } catch (err) {
      console.warn('[API] Falha em', url, err.response?.status);
    }
  }
  return res.status(404).json({ error: 'Status Pix não encontrado.' });
});

// Webhook Pix
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
