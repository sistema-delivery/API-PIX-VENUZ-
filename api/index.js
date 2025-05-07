const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const mercadopago = require('mercadopago');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Conexão com o MongoDB
typeof process.env.MONGO_URI === 'undefined' && console.error('ERRO: A variável MONGO_URI não está definida.') && process.exit(1);

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Conectado ao MongoDB!'))
.catch((err) => {
  console.error('Erro ao conectar ao MongoDB:', err);
  process.exit(1);
});

// Configuração do Mercado Pago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// Modelo simples para "usuarios"
const Usuario = mongoose.model('Usuario', new mongoose.Schema({
  nome: String,
  email: String,
}));

// Rota GET básica
app.get('/', (req, res) => {
  res.send('Olá, mundo! Seu servidor Node.js está rodando e conectado ao MongoDB.');
});

// Rotas para gerenciamento de usuários
app.post('/usuarios', async (req, res) => {
  const { nome, email } = req.body;
  if (!nome || !email) {
    return res.status(400).json({ message: 'Nome e email são obrigatórios' });
  }
  try {
    const novoUsuario = new Usuario({ nome, email });
    await novoUsuario.save();
    res.status(201).json({ message: 'Usuário criado com sucesso', usuario: novoUsuario });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao salvar o usuário', error: err.message });
  }
});

app.get('/usuarios', async (req, res) => {
  try {
    const usuarios = await Usuario.find();
    res.json(usuarios);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar usuários', error: err.message });
  }
});

app.delete('/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Usuario.findByIdAndDelete(id);
    res.json({ message: 'Usuário deletado com sucesso' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao deletar usuário', error: err.message });
  }
});

app.put('/usuarios/:id', async (req, res) => {
  const { nome, email } = req.body;
  const { id } = req.params;
  if (!nome || !email) {
    return res.status(400).json({ message: 'Nome e email são obrigatórios' });
  }
  try {
    const usuarioAtualizado = await Usuario.findByIdAndUpdate(
      id,
      { nome, email },
      { new: true }
    );
    res.json({ message: 'Usuário atualizado com sucesso', usuario: usuarioAtualizado });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao atualizar usuário', error: err.message });
  }
});

// Integração com Mercado Pago para criar pagamento via Pix
app.post('/mp-pix', async (req, res) => {
  const { valor, nome, email } = req.body;
  if (!valor) {
    return res.status(400).json({ message: 'Valor é obrigatório' });
  }

  const payment_data = {
    transaction_amount: valor,
    description: 'Cobrança via Pix',
    payment_method_id: 'pix',
    payer: {
      email: email || 'cliente@example.com',
      first_name: nome || 'Cliente'
    }
  };

  try {
    const paymentResponse = await mercadopago.payment.create(payment_data);
    const { point_of_interaction } = paymentResponse.body;
    // Retorna também o transaction_id para polling
    res.json({
      message: 'Pagamento criado com sucesso!',
      pix: point_of_interaction,
      payment: paymentResponse.body,
      transaction_id: paymentResponse.body.id
    });
  } catch (err) {
    console.error('Erro ao criar pagamento no Mercado Pago:', err);
    res.status(500).json({ message: 'Erro ao criar pagamento', error: err.message });
  }
});

// Endpoint para checar status do pagamento via Pix
app.get('/mp-pix/status/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const mpResponse = await mercadopago.payment.get(id);
    const status = mpResponse.body.status; // ex: 'pending', 'approved', etc.
    res.json({
      pago: status === 'approved',
      status
    });
  } catch (err) {
    console.error('Erro ao checar status do Pix:', err);
    res.status(500).json({ message: 'Erro ao consultar status', error: err.message });
  }
});

// Endpoint de Webhook para receber notificações do Mercado Pago
app.post('/webhook/mp', (req, res) => {
  const notificacao = req.body;
  console.log('Notificação recebida do Mercado Pago:', notificacao);
  // Implemente lógica para atualizar status de pagamento em seu BD, se desejar
  res.status(200).send('Notificação recebida');
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
