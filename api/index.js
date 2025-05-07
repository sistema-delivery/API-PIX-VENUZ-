require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Conexão condicional com MongoDB
const dbUri = process.env.MONGODB_URI;
if (dbUri) {
  mongoose.connect(dbUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
    .then(() => console.log('MongoDB conectado'))
    .catch(err => console.error('Erro conectando ao MongoDB:', err));
} else {
  console.warn('MONGODB_URI não definida - pulando conexão com MongoDB');
}

// Model de usuário (opcional)
const UsuarioSchema = new mongoose.Schema({
  nome: String,
  email: String,
  pixTransactions: [
    {
      pixId: String,
      amount: Number,
      status: String,
      createdAt: { type: Date, default: Date.now },
    }
  ]
});
const Usuario = mongoose.model('Usuario', UsuarioSchema);

// Middleware de autenticação VenuzPay
app.use((req, res, next) => {
  req.venuzAuth = {
    publicKey: process.env.VENUZ_PUBLIC_KEY,
    secretKey: process.env.VENUZ_SECRET_KEY,
  };
  next();
});

// Rota raiz (health check)
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'API VenuzPay ativo (raiz)' });
});

// Rota /api (alternativa)
app.get('/api', (req, res) => {
  res.json({ ok: true, message: 'API VenuzPay ativo (/api)' });
});

// POST /api/pix/create - cria cobrança Pix na VenuzPay
app.post('/api/pix/create', async (req, res) => {
  try {
    const { amount, description, externalId, customerEmail } = req.body;
    const payload = {
      amount,
      description: description || 'Cobrança via API',
      externalId: externalId || `pix_${Date.now()}`,
      ...(customerEmail && { customerEmail }),
    };

    const response = await axios.post(
      'https://app.venuzpay.com/api/v1/pix/create',
      payload,
      {
        headers: {
          'x-public-key': req.venuzAuth.publicKey,
          'x-secret-key': req.venuzAuth.secretKey,
          'Content-Type': 'application/json',
        }
      }
    );

    const { id, qrCodeBase64, qrCodeText } = response.data;
    res.status(201).json({ pixId: id, qrCodeBase64, qrCodeText });
  } catch (err) {
    console.error('Erro criando Pix:', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao criar cobrança Pix.' });
  }
});

// GET /api/pix/status/:id - consulta status da cobrança
app.get('/api/pix/status/:id', async (req, res) => {
  try {
    const pixId = req.params.id;
    const response = await axios.get(
      `https://app.venuzpay.com/api/v1/pix/status/${pixId}`,
      {
        headers: {
          'x-public-key': req.venuzAuth.publicKey,
          'x-secret-key': req.venuzAuth.secretKey,
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error('Erro consultando status Pix:', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao consultar status Pix.' });
  }
});

// POST /api/webhook/pix - webhook de notificações
app.post('/api/webhook/pix', (req, res) => {
  const { id, status } = req.body;
  console.log(`Webhook recebido. Pix ${id} agora está com status ${status}.`);
  res.status(200).send('OK');
});

// Apenas para desenvolvimento local
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Dev server rodando em http://localhost:${port}`));
}

module.exports = app;
