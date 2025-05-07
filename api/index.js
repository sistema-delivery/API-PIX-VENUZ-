require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Conexão MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/venuzpay', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Model de usuário
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

// Injeta credenciais VenuzPay
app.use((req, res, next) => {
  req.venuzAuth = {
    publicKey: process.env.VENUZ_PUBLIC_KEY,
    secretKey: process.env.VENUZ_SECRET_KEY,
  };
  next();
});

// Rotas
app.get('/api', (req, res) => {
  res.json({ ok: true, message: 'API VenuzPay ativo' });
});

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

app.post('/api/webhook/pix', async (req, res) => {
  const { id, status } = req.body;
  console.log(`Webhook recebido. Pix ${id} agora está com status ${status}.`);
  res.status(200).send('OK');
});

// Só em dev local
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () =>
    console.log(`Dev server rodando em http://localhost:${port}`)
  );
}

module.exports = app;
