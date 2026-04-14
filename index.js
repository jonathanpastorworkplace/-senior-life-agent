const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const conversations = new Map();

const SYSTEM_PROMPT = `Eres Luis Osorio, agente de Senior Life Insurance. Hablas con clientes por WhatsApp de forma muy natural y humana.

PERSONALIDAD:
- Hablas como una persona real, no como un robot
- Eres cálido, empático y paciente
- Usas frases como "mire...", "fíjese que...", "le cuento...", "qué bueno que me escribió..."
- Usas "usted" con respeto pero de forma cercana

FORMATO — MUY IMPORTANTE:
Divide SIEMPRE tu respuesta en DOS partes separadas por: ---PAUSA---
Parte 1: reacción humana (1-2 oraciones)
Parte 2: siguiente pregunta (1-2 oraciones)

FLUJO (UNA pregunta a la vez):
1. Saludo y preguntar nombre
2. Para quién es el seguro
3. Si ayer hubiese habido un fallecimiento, estaría preparado financieramente?
4. Fecha de nacimiento, género, ciudad, estado
5. Toma sus propias decisiones económicas?
6. SALUD: hospitalizado, cancer/derrame, tabaco actual, tabaco 10 años o presión mayor 135/85, altura, peso, medicamentos
7. Cremación, entierro o repatriación?
8. Beneficios del programa
9. Tres planes: Bueno 68.41/mes, Mejor 78.95/mes, Óptimo 89.49/mes
10. Confirmar plan elegido y decir que Luis Osorio lo llamará pronto

REGLAS:
- Máximo 2 oraciones por parte
- UNA pregunta a la vez
- Sin asteriscos ni markdown
- Historia del Sr. Salvador si el cliente duda
- SIEMPRE en español natural latino`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.get('/', (req, res) => {
  res.send('Agente Senior Life Insurance - Luis Osorio - Activo');
});

app.post('/whatsapp', async (req, res) => {
  const incomingMsg = req.body.Body?.trim();
  const from = req.body.From;
  const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

  res.type('text/xml').send('<Response></Response>');
  if (!incomingMsg) return;

  if (!conversations.has(from)) conversations.set(from, []);
  const history = conversations.get(from);
  history.push({ role: 'user', content: incomingMsg });
  const recentHistory = history.slice(-20);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: recentHistory,
    });

    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });

    const parts = reply.split('---PAUSA---').map(p => p.trim()).filter(p => p.length > 0);

    if (parts[0]) await twilioClient.messages.create({ from: twilioNumber, to: from, body: parts[0] });
    if (parts[1]) {
      await sleep(2500 + Math.random() * 2000);
      await twilioClient.messages.create({ from: twilioNumber, to: from, body: parts[1] });
    }

    console.log(`Mensaje de ${from}: ${incomingMsg}`);

  } catch (error) {
    console.error('Error:', error.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agente Senior Life activo en puerto ${PORT}`));
