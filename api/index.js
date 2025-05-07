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
  WEBHOOK_BASE_URL
} = process.env;
if (!VENUZ_PUBLIC_KEY || !VENUZ_SECRET_KEY) {
  console.error('Variáveis VENUZ_PUBLIC_KEY ou VENUZ_SECRET_KEY não definidas. Abortando.');
  process.exit(1);
}

// Conexão condicional com MongoDB
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB conectado'))
    .catch(err => console.error('Erro conectando ao MongoDB:', err));
} else {
  console.warn('MONGODB_URI não definida - pulando conexão com MongoDB');
}

// URL do Gateway Pix
const GATEWAY_URL = 'https://app.venuzpay.com/api/v1/gateway/pix/receive';

// Middleware de autenticação VenuzPay
typeof process !== 'undefined' && app.use((req, res, next) => {
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

// Receber Pix - proxy para gateway
app.post('/api/pix/create', async (req, res) => {
  const {
    identifier,
    amount,
    client,
    shippingFee = 0,
    extraFee = 0,
    discount = 0,
    products = [],
    splits = [],
    dueDate,
    metadata = {},
    callbackUrl
  } = req.body;

  // Validações mínimas
  if (!identifier || typeof identifier !== 'string') {
    return res.status(400).json({ message: 'identifier (string) obrigatório.' });
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ message: 'amount (number > 0) obrigatório.' });
  }
  if (!client || !client.email || typeof client.email !== 'string') {
    return res.status(400).json({ message: 'client.email (string) obrigatório.' });
  }

  // Montar payload conforme documentação do Gateway
  const payload = {
    identifier,
    amount,
    shippingFee,
    extraFee,
    discount,
    client: { email: client.email },
    products,
    splits,
    metadata,
  };
  if (dueDate) payload.dueDate = dueDate;
  if (callbackUrl) {
    payload.callbackUrl = callbackUrl;
  } else if (WEBHOOK_BASE_URL) {
    payload.callbackUrl = `${WEBHOOK_BASE_URL.replace(/\/+$/, '')}/api/webhook/pix`;
  }

  try {
    console.log('[API] Proxy criando PIX para gateway:', payload);
    const { data } = await axios.post(GATEWAY_URL, payload, { headers: req.venuzHeaders });
    return res.status(201).json(data);
  } catch (err) {
    console.error('[API] Erro no proxy ao criar PIX:', err.response?.status, err.response?.data || err.message);
    const status = err.response?.status || 500;
    const body = err.response?.data || { message: err.message };
    return res.status(status).json(body);
  }
});

// Consulta status Pix proxy (opcional)
app.get('/api/pix/status/:id', async (req, res) => {
  const { id } = req.params;
  // Pode encaminhar similarmente ao gateway se desejar
  return res.status(501).json({ message: 'Consulta de status não implementada nesta proxy.' });
});

// Webhook Pix
app.post('/api/webhook/pix', (req, res) => {
  const { transactionId, status } = req.body;
  console.log(`Webhook Pix recebido: ${transactionId} -> ${status}`);
  return res.status(200).send('OK');
});

module.exports = app;
