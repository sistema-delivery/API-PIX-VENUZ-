// index.js
require('dotenv').config();
const serverless = require('serverless-http');
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const axios      = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Carrega variáveis de ambiente
const {
  VENUZ_PUBLIC_KEY,
  VENUZ_SECRET_KEY,
  MONGODB_URI,
  WEBHOOK_BASE_URL
} = process.env;

if (!VENUZ_PUBLIC_KEY || !VENUZ_SECRET_KEY) {
  console.error('❌ VENUZ_PUBLIC_KEY ou VENUZ_SECRET_KEY não definidas.');
  process.exit(1);
}

// Conexão Mongo (opcional)
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Erro conectando ao MongoDB:', err));
}

// Constantes de API
const API_BASE        = 'https://app.venuzpay.com/api/v1';
const CREATE_PIX_URL  = `${API_BASE}/gateway/pix/receive`;
const STATUS_PIX_URL  = `${API_BASE}/gateway/pix/status`;

// Middleware para injetar headers de autenticação
app.use((req, res, next) => {
  req.venuzHeaders = {
    'x-public-key': VENUZ_PUBLIC_KEY,
    'x-secret-key': VENUZ_SECRET_KEY,
    'Content-Type': 'application/json'
  };
  next();
});

// Health-checks
app.get('/',         (req, res) => res.json({ ok: true, message: 'root OK' }));
app.get('/api',      (req, res) => res.json({ ok: true, message: '/api OK' }));

// 1) Cria cobrança PIX
app.post('/api/pix/create', async (req, res) => {
  const {
    amount,
    externalId,
    customerEmail,
    shippingFee = 0,
    extraFee    = 0,
    discount    = 0,
    products    = [],
    splits      = [],
    dueDate,
    metadata    = {},
    callbackUrl
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

  // callback automático se não vier custom
  if (callbackUrl && /^https?:\/\//.test(callbackUrl)) {
    payload.callbackUrl = callbackUrl;
  } else if (WEBHOOK_BASE_URL) {
    payload.callbackUrl = `${WEBHOOK_BASE_URL.replace(/\/+$/, '')}/api/webhook/pix`;
  }

  if (dueDate) payload.dueDate = dueDate;

  console.log('[API] Criando PIX em', CREATE_PIX_URL, payload);
  try {
    const { data, status } = await axios.post(
      CREATE_PIX_URL,
      payload,
      { headers: req.venuzHeaders }
    );
    console.log('[API] VenuzPay retornou:', status, data);

    const { transactionId, status: txStatus, fee, order, pix = {} } = data;
    const qrCodeBase64 = pix.qrCodeImage || pix.qrCodeBase64;
    const qrCodeText   = pix.qrCodeText  || pix.payload;

    return res.status(201).json({ transactionId, status: txStatus, fee, order, qrCodeBase64, qrCodeText });
  } catch (err) {
    console.error('[API] Erro criando PIX:', err.response?.status, err.response?.data || err.message);
    const code = err.response?.status || 500;
    const body = err.response?.data   || { message: err.message };
    return res.status(code).json(body);
  }
});

// 2) Consulta status PIX
app.get('/api/pix/status/:id', async (req, res) => {
  const { id } = req.params;
  const url = `${STATUS_PIX_URL}/${id}`;

  console.log('[API] Consultando status em', url);
  try {
    const { data } = await axios.get(url, { headers: req.venuzHeaders });
    console.log('[API] Status encontrado:', data);
    return res.json(data);
  } catch (err) {
    console.error('[API] Erro consultando status:', err.response?.status, err.response?.data);
    return res.status(err.response?.status || 500).json(err.response?.data || { message: err.message });
  }
});

// 3) Webhook PIX
app.post('/api/webhook/pix', (req, res) => {
  const { transactionId, status } = req.body;
  console.log(`🔔 Webhook Pix: ${transactionId} -> ${status}`);
  // Aqui você pode atualizar o MongoDB ou notificar o bot
  return res.status(200).send('OK');
});

// Export para Vercel
app.listen(3000, () => console.log('Rodando local em :3000'));
module.exports = app;
module.exports.handler = serverless(app);
