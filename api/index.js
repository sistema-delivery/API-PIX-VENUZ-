require('dotenv').config();
const serverless = require('serverless-http');
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const axios      = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

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

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Erro conectando ao MongoDB:', err));
}

const API_BASE        = 'https://app.venuzpay.com/api/v1';
const CREATE_PIX_URL  = `${API_BASE}/gateway/pix/receive`;
const STATUS_PIX_URL  = `${API_BASE}/gateway/pix/status`;

app.use((req, res, next) => {
  req.venuzHeaders = {
    'x-public-key': VENUZ_PUBLIC_KEY,
    'x-secret-key': VENUZ_SECRET_KEY,
    'Content-Type': 'application/json'
  };
  next();
});

app.get('/',    (req, res) => res.json({ ok: true, message: 'root OK' }));
app.get('/api', (req, res) => res.json({ ok: true, message: '/api OK' }));

// 1) Cria cobrança PIX
app.post('/api/pix/create', async (req, res) => {
  const {
    identifier,
    amount,
    shippingFee = 0,
    extraFee    = 0,
    discount    = 0,
    client      = {},
    products    = [],
    splits      = [],
    dueDate,
    metadata    = {},
    callbackUrl
  } = req.body;

  const payload = {
    identifier: identifier || `tg_${Date.now()}`,
    amount,
    shippingFee,
    extraFee,
    discount,
    client,
    products,
    splits,
    metadata: { ...metadata, source: 'telegram' }
  };

  if (dueDate) payload.dueDate = dueDate;

  if (callbackUrl && /^https?:\/\//.test(callbackUrl)) {
    payload.callbackUrl = callbackUrl;
  } else if (WEBHOOK_BASE_URL) {
    payload.callbackUrl = `${WEBHOOK_BASE_URL.replace(/\/+$/, '')}/api/webhook/pix`;
  }

  console.log('[API] Criando PIX em', CREATE_PIX_URL, payload);
  try {
    const { data, status } = await axios.post(
      CREATE_PIX_URL,
      payload,
      { headers: req.venuzHeaders }
    );
    console.log('[API] VenuzPay retornou:', status, data);

    // Extrai exatamente os campos que a doc oficial usa:
    const {
      transactionId,
      status: txStatus,
      fee,
      order,
      pix = {}
    } = data;

    // pix.base64 e pix.code são os campos corretos
    const qrCodeBase64 = pix.base64;
    const qrCodeText   = pix.code;

    // Retorna num formato que o bot espera:
    return res.status(201).json({
      transactionId,
      status: txStatus,
      fee,
      order,
      pix: {
        base64: qrCodeBase64,
        code:   qrCodeText
      }
    });

  } catch (err) {
    console.error(
      '[API] Erro criando PIX:',
      err.response?.status,
      err.response?.data || err.message
    );
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
    return res
      .status(err.response?.status || 500)
      .json(err.response?.data || { message: err.message });
  }
});

app.post('/api/webhook/pix', (req, res) => {
  // 1) Loga todo o corpo para debug
  console.log('[Webhook] Payload recebido:', JSON.stringify(req.body, null, 2));

  // 2) Extrai corretamente os campos dentro de `transaction`
  const { event, token } = req.body;
  const tx           = req.body.transaction || {};
  const transactionId = tx.id;
  const identifier    = tx.identifier;
  const status        = tx.status;

  console.log(`🔔 Webhook Pix [${event}]: tx.id=${transactionId}, identifier=${identifier}, status=${status}`);

  // 3) Aqui você processa: salva no banco, notifica o bot, etc.

  // 4) Responde 2XX para confirmar recebimento
  return res.status(200).json({ received: true });
});

app.listen(3000, () => console.log('Rodando local em :3000'));
module.exports = app;
module.exports.handler = serverless(app);
