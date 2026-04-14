Vaya a GitHub y abra el archivo:

**github.com/jonathanpastorworkplace/-senior-life-agent**

1. Click en **"index.js"**
2. Click en el lápiz ✏️ arriba a la derecha
3. Se abre el editor — seleccione todo con **Cmd+A** y borre todo
4. Copie todo el texto de abajo y péguelo ahí
5. Click **"Commit changes"**

Aquí está el código completo para copiar:Vaya a GitHub, abra `index.js`, click en el lápiz ✏️, borre todo con **Cmd+A** y pegue esto:

```javascript
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
- Repites lo que dice el cliente para mostrar que escuchaste
- Usas "usted" con respeto pero de forma cercana
- NUNCA suenas a script o ventas agresivas

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
6. SALUD una por una: hospitalizado, cáncer/derrame, tabaco actual, tabaco 10 años o presión >135/85, altura en pies y pulgadas, peso en libras, medicamentos
7. Cremación, entierro o repatriación?
8. Beneficios del programa
9. Tres planes: Bueno $68.41/mes, Mejor $78.95/mes, Óptimo $89.49/mes
10. Cuando elija el plan, responde confirmando y termina tu mensaje con esta línea exacta:
##LEAD## nombre|apellido|fechaNacimiento|genero|ciudad|estado|hospitalizado|cancer|tabaco|tabaco10años|alturaPies|alturaPulgadas|peso|medicamentos|plan

REGLAS:
- Máximo 2 oraciones por parte
- UNA pregunta a la vez
- Sin asteriscos ni markdown
- Historia del Sr. Salvador si el cliente duda
- SIEMPRE en español natural latino`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function notificarLuis(datos, plan) {
  const luisNumber = process.env.LUIS_WHATSAPP;
  const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
  if (!luisNumber) return;
  const mensaje = `NUEVO LEAD CALIFICADO

Cliente: ${datos.nombre} ${datos.apellido}
Fecha nac: ${datos.fechaNacimiento}
Genero: ${datos.genero}
${datos.ciudad}, ${datos.estado}

SALUD:
Hospitalizado: ${datos.hospitalizado}
Cancer/derrame: ${datos.cancer}
Tabaco actual: ${datos.tabaco}
Tabaco 10 anos/presion: ${datos.tabaco10}
Altura: ${datos.alturaPies} pies ${datos.alturaPulgadas} pulg
Peso: ${datos.peso} lbs
Medicamentos: ${datos.medicamentos}

PLAN ELEGIDO: ${plan}

Portal: telesales.srlife.net/prequalifying/app_start_page

Llame pronto para cerrar la venta!`;
  try {
    await twilioClient.messages.create({ from: twilioNumber, to: `whatsapp:${luisNumber}`, body: mensaje });
    console.log('Notificacion enviada a Luis');
  } catch (e) { console.error('Error notificando a Luis:', e.message); }
}

function parsearLead(texto) {
  const match = texto.match(/##LEAD##\s*(.+)/);
  if (!match) return null;
  const campos = match[1].split('|');
  if (campos.length < 15) return null;
  return { nombre: campos[0], apellido: campos[1], fechaNacimiento: campos[2], genero: campos[3], ciudad: campos[4], estado: campos[5], hospitalizado: campos[6], cancer: campos[7], tabaco: campos[8], tabaco10: campos[9], alturaPies: campos[10], alturaPulgadas: campos[11], peso: campos[12], medicamentos: campos[13], plan: campos[14] };
}

app.get('/', (req, res) => { res.send('Agente Senior Life Insurance - Luis Osorio - Activo'); });

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
    const response = await anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: SYSTEM_PROMPT, messages: recentHistory });
    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });
    const lead = parsearLead(reply);
    if (lead) { console.log('LEAD:', JSON.stringify(lead)); await notificarLuis(lead, lead.plan); }
    const replyLimpio = reply.replace(/##LEAD##.*/g, '').trim();
    const parts = replyLimpio.split('---PAUSA---').map(p => p.trim()).filter(p => p.length > 0);
    if (parts[0]) await twilioClient.messages.create({ from: twilioNumber, to: from, body: parts[0] });
    if (parts[1]) { await sleep(2500 + Math.random() * 2000); await twilioClient.messages.create({ from: twilioNumber, to: from, body: parts[1] }); }
  } catch (error) {
    console.error('Error:', error);
    try { await twilioClient.messages.create({ from: twilioNumber, to: from, body: 'Disculpe, tuve un pequeño problema. Me puede repetir lo que me dijo?' }); } catch (e) {}
  }
});

app.post('/reset', (req, res) => {
  const { phone } = req.body;
  if (phone && conversations.has(phone)) { conversations.delete(phone); res.json({ success: true }); }
  else res.json({ success: false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agente Senior Life activo en puerto ${PORT}`));
```

Cuando haga **"Commit changes"** Railway se actualiza solo. ¿Pudo pegarlo? 😊
