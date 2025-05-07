require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connection (ajuste URI se precisar)
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/venuzpay', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Model de usuário (exemplo)
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

// Middleware: injeta credenciais VenuzPay
app.use((req, res, next) => {
  req.venuzAuth = {
    publicKey: process.env.VENUZ_PUBLIC_KEY,
    secretKey: process.env.VENUZ_SECRET_KEY,
  };
  next();
});

// Rota de teste
app.get('/api', (req, res) => {
  res.json({ ok: true, message: 'API VenuzPay ativo' });
});

/**
 * POST /api/pix/create
 * Cria cobrança Pix na VenuzPay
 * Body esperado: { amount: Number, description?: String, externalId?: String, customerEmail?: String }
 */
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

    // Exemplo de response esperado:
    // { id: 'abc123', qrCodeBase64: '...', qrCodeText: '000201...' }
    const { id, qrCodeBase64, qrCodeText } = response.data;

    // Salva no usuário (opcional)
    // await Usuario.updateOne(
    //   { email: customerEmail },
    //   { $push: { pixTransactions: { pixId: id, amount, status: 'pending' } } },
    //   { upsert: true }
    // );

    res.status(201).json({ 
      pixId: id, 
      qrCodeBase64, 
      qrCodeText 
    });
  } catch (err) {
    console.error('Erro criando Pix:', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao criar cobrança Pix.' });
  }
});

/**
 * GET /api/pix/status/:id
 * Consulta status de cobrança Pix na VenuzPay
 */
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

    // Exemplo de response esperado:
    // { id: 'abc123', status: 'pending'|'paid'|'expired', paidAt: '...' }
    res.json(response.data);
  } catch (err) {
    console.error('Erro consultando status Pix:', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao consultar status Pix.' });
  }
});

/**
 * (Opcional) Webhook de notificações da VenuzPay
 * Caso configurado na dashboard da VenuzPay
 */
app.post('/api/webhook/pix', async (req, res) => {
  const { id, status } = req.body;
  console.log(`Webhook recebido. Pix ${id} está agora com status ${status}.`);

  // Atualize o status no banco, se desejar:
  // await Usuario.updateOne(
  //   { 'pixTransactions.pixId': id },
  //   { $set: { 'pixTransactions.$.status': status } }
  // );

  res.status(200).send('OK');
});

// Inicialização do servidor
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
