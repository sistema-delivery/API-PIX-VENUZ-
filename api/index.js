require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Variáveis de ambiente obrigatórias
const {
  VENUZ_PUBLIC_KEY,
  VENUZ_SECRET_KEY,
  MONGODB_URI,
  CREATE_PATH,
  WEBHOOK_BASE_URL
} = process.env;
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

// URL base da API VenuzPay (sem versão no path, conforme documentação)
const BASE_URL = 'https://app.venuzpay.com';
// Define endpoint de criação: usa CREATE_PATH se for URL absoluta, senão usa path padrão relativo
const DEFAULT_PATH = '/gateway/pix/receive';
function getCreateUrl() {
  if (CREATE_PATH) {
    if (/^https?:\/\//.test(CREATE_PATH)) {
      return CREATE_PATH;
    }
    return `${BASE_URL.replace(/\/+$/,'')}${CREATE_PATH}`;
  }
  return `${BASE_URL}${DEFAULT_PATH}`;
}

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
 * Cria cobrança Pix na VenuzPay
 * Body: { amount, externalId?, customerEmail?, shippingFee?, extraFee?, discount?, products?, splits?, dueDate?, metadata?, callbackUrl? }
 */
app.post('/api/pix/create', async (req, res) => {
  const url = getCreateUrl();
  const {
    amount,
    externalId,
    customerEmail,
    shippingFee = 0,
    extraFee = 0,
    discount = 0,
    products = [],
    splits = [],
    dueDate,
    metadata = {},
    callbackUrl: callbackUrlBody
  } = req.body;

  const payload = {
    identifier: externalId || `tg_${Date.now()}`,
    amount,
    shippingFee,
    extraFee,
    discount,
    client: { email: customerEmail || '' },
    products,
    splits,
    metadata: { ...metadata, source: 'telegram' }
  };

  if (callbackUrlBody && /^https?:\/\//.test(callbackUrlBody)) {
    payload.callbackUrl = callbackUrlBody;
  } else if (WEBHOOK_BASE_URL && /^https?:\/\//.test(WEBHOOK_BASE_URL)) {
    payload.callbackUrl = `${WEBHOOK_BASE_URL.replace(/\/+$/,'')}/api/webhook/pix`;
  }

  if (dueDate) payload.dueDate = dueDate;

  console.log('[API] Criando PIX em', url, 'com payload:', payload);
  try {
    const response = await axios.post(url, payload, { headers: req.venuzHeaders });
    const data = response.data;
    console.log('[API] VenuzPay retornou:', response.status, data);

    const { transactionId, status, fee, order, pix = {} } = data;
    const qrCodeBase64 = pix.qrCodeImage || pix.qrCodeBase64;
    const qrCodeText = pix.qrCodeText || pix.payload;

    return res.status(201).json({ transactionId, status, fee, order, qrCodeBase64, qrCodeText });
  } catch (err) {
    console.error('[API] Erro criando PIX:', err.response?.status, err.response?.data || err.message);
    const statusCode = err.response?.status || 500;
    const errBody = err.response?.data || { message: err.message };
    return res.status(statusCode).json(errBody);
  }
});

/**
 * GET /api/pix/status/:id
 * Consulta status da cobrança via GET /pix/status/:id ou /cob/:id
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
  const { transactionId, status } = req.body;
  console.log(`Webhook Pix recebido: ${transactionId} -> ${status}`);
  // TODO: tratar atualização de status no seu sistema
  return res.status(200).send('OK');
});

// Execução em dev local apenas
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Dev server rodando: http://localhost:${port}`));
}

module.exports = app;
