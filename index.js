const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Guardar conversaciones por número de teléfono
const conversations = new Map();

const SYSTEM_PROMPT = `Eres el asistente virtual de Luis Osorio del Centro de Inscripciones para el Beneficio de los Gastos Funerales de Senior Life Insurance (54 años en el mercado).

OBJETIVO: Seguir el script de ventas de Luis Osorio por WhatsApp, de forma natural y conversacional.

FLUJO OBLIGATORIO (UNA pregunta a la vez):
1. Bienvenida: preguntar nombre y apellido del cliente
2. ¿Para quién es el seguro? (él/ella o un ser querido)
3. Impacto emocional: "Si ayer hubiese ocurrido un fallecimiento en su familia, ¿estaría preparado(a) financieramente?" — esperar NO y empatizar
4. Datos básicos: fecha de nacimiento completa, género, ciudad y estado
5. ¿Toma sus propias decisiones económicas?
6. SALUD (una por una):
   a. ¿Hospitalizado actualmente o en centro de enfermería? SI/NO
   b. ¿Diagnóstico de cáncer o derrame cerebral? SI/NO
   c. ¿Usa tabaco o nicotina actualmente? SI/NO
   d. ¿En los últimos 10 años usó tabaco/nicotina o presión arterial >135/85? SI/NO
   e. ¿Cuánto mide? (pies y pulgadas)
   f. ¿Cuánto pesa? (libras)
   g. ¿Toma medicamentos recetados? SI/NO
7. ¿Cremación, entierro tradicional o repatriación?
8. Beneficios del programa: Family Support Service, descuentos 60%, prima nivelada, cobertura nacional e internacional, sin down payment
9. Determinar producto según salud:
   - Sin hospitalización + sin cáncer + sin tabaco + sin presión alta = "Seguro de Vida Entera Máximo Preferido"
   - Con tabaco O presión alta = "Seguro de Vida Entera Super Preferido"
   - Con más condiciones = "Seguro de Vida Entera Preferido"
10. Presentar 3 planes:
    - Plan Bueno: $15,500 natural y accidental — $68.41/mes (~$2.28/día)
    - Plan Mejor: $18,000 natural y accidental — $78.95/mes (~$2.63/día)
    - Plan Óptimo: $20,500 natural y accidental — $89.49/mes (~$2.98/día)
11. Cuando el cliente elija un plan, confirmar y decir que Luis Osorio lo contactará para finalizar.

TÉCNICAS DEL SCRIPT:
- Respuestas CORTAS (máximo 3-4 oraciones) — es WhatsApp, no email
- Una pregunta a la vez
- Confirmaciones: "¿correcto?", "¿de acuerdo?", "¿verdad?"
- Si hospitalizado=NO: "Gracias a Dios. Lamentablemente muchas personas nos llaman desde el hospital y ya no podemos ayudarlas."
- Historia del Sr. Salvador (53 años, murió sin el plan) si el cliente duda
- Si buena salud: "La felicito, eso será muy favorable para ser aprobado(a)"
- Si medicamentos: "La felicito, significa que mantiene sus condiciones bajo control"
- Si quiere consultar: "Ningún familiar se molesta porque dejemos esto arreglado"
- Urgencia: "El mejor momento fue ayer, el segundo es hoy"
- Al final cuando elija plan: notificar que Luis Osorio lo contactará pronto
- SIEMPRE en español, cálido y profesional
- NO uses markdown, asteriscos ni formato especial — es WhatsApp texto plano`;

app.get('/', (req, res) => {
  res.send('Agente Senior Life Insurance - Luis Osorio - Activo ✓');
});

app.post('/whatsapp', async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const incomingMsg = req.body.Body?.trim();
  const from = req.body.From;

  if (!incomingMsg) {
    twiml.message('Hola, bienvenido a Senior Life Insurance. ¿En qué le puedo ayudar?');
    return res.type('text/xml').send(twiml.toString());
  }

  // Obtener o crear historial de conversación
  if (!conversations.has(from)) {
    conversations.set(from, []);
  }
  const history = conversations.get(from);
  history.push({ role: 'user', content: incomingMsg });

  // Limitar historial a últimos 20 mensajes para no exceder tokens
  const recentHistory = history.slice(-20);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: recentHistory,
    });

    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });

    // WhatsApp tiene límite de 1600 caracteres por mensaje
    if (reply.length > 1500) {
      const parts = reply.match(/.{1,1500}/gs) || [reply];
      parts.forEach(part => twiml.message(part));
    } else {
      twiml.message(reply);
    }

    // Si el cliente eligió un plan, notificar a Luis (log por ahora)
    if (reply.toLowerCase().includes('luis osorio lo contactará') || 
        reply.toLowerCase().includes('plan seleccionado')) {
      console.log(`LEAD CALIFICADO - ${from}: ${incomingMsg}`);
    }

  } catch (error) {
    console.error('Error API Anthropic:', error);
    twiml.message('Disculpe, tuve un problema técnico. Por favor escríbame de nuevo en un momento.');
  }

  res.type('text/xml').send(twiml.toString());
});

// Endpoint para reiniciar conversación
app.post('/reset', (req, res) => {
  const { phone } = req.body;
  if (phone && conversations.has(phone)) {
    conversations.delete(phone);
    res.json({ success: true, message: `Conversación de ${phone} reiniciada` });
  } else {
    res.json({ success: false, message: 'Número no encontrado' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agente Senior Life activo en puerto ${PORT}`);
});
