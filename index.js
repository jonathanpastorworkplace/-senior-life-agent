const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const puppeteer = require('puppeteer-core');

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
6. SALUD una por una: hospitalizado, cancer/derrame, tabaco actual, tabaco 10 años o presión mayor a 135/85, altura en pies y pulgadas, peso en libras, medicamentos
7. Cremación, entierro o repatriación?
8. Beneficios del programa
9. Tres planes: Bueno 68.41 al mes, Mejor 78.95 al mes, Óptimo 89.49 al mes
10. Cuando elija el plan, confirma y termina con:
##LEAD## nombre|apellido|fechaNacimiento|genero|ciudad|estado|hospitalizado|cancer|tabaco|tabaco10|pies|pulgadas|peso|medicamentos|plan

REGLAS:
- Máximo 2 oraciones por parte
- UNA pregunta a la vez
- Sin asteriscos ni markdown
- Historia del Sr. Salvador si el cliente duda
- SIEMPRE en español natural latino`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function llenarPortal(datos) {
  const token = process.env.BROWSERLESS_TOKEN;
  const agentId = process.env.SRLIFE_AGENT_ID;
  const password = process.env.SRLIFE_PASSWORD;
  const luisNumber = process.env.LUIS_WHATSAPP;
  const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://production-sfo.browserless.io?token=${token}`,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // LOGIN
    console.log('Entrando al portal...');
    await page.goto('https://telesales.srlife.net/login', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input', { timeout: 10000 });
    const inputs = await page.$$('input');
    if (inputs[0]) { await inputs[0].click(); await inputs[0].type(agentId); }
    if (inputs[1]) { await inputs[1].click(); await inputs[1].type(password); }
    await page.click('button[type="submit"], input[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    console.log('Login exitoso');

    // PÁGINA 1 — Asegurado Propuesto
    await page.goto('https://telesales.srlife.net/prequalifying/app_start_page', { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForSelector('input', { timeout: 10000 });
    await sleep(1000);

    const allInputs = await page.$$('input[type="text"], input:not([type="radio"]):not([type="checkbox"]):not([type="submit"]):not([type="button"])');
    if (allInputs[0]) { await allInputs[0].triple_click(); await allInputs[0].type(datos.nombre); }
    if (allInputs[1]) { await allInputs[1].triple_click(); await allInputs[1].type(datos.apellido); }

    await page.$eval('input[type="date"]', (el, val) => { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }, datos.fechaNacimiento);

    const generoValue = datos.genero === 'MASCULINO' ? 'MASCULINO/HOMBRE' : 'FEMENINO/MUJER';
    const selects = await page.$$('select');
    for (const sel of selects) {
      const opts = await sel.evaluate(el => Array.from(el.options).map(o => o.value));
      if (opts.some(o => o.includes('MASCULINO') || o.includes('FEMENINO'))) {
        await sel.select(generoValue).catch(() => sel.select(opts.find(o => o.includes(datos.genero === 'MASCULINO' ? 'MASC' : 'FEM')) || opts[1]));
        break;
      }
    }

    const cityInputs = await page.$$('input[type="text"]');
    for (const inp of cityInputs) {
      const ph = await inp.evaluate(el => (el.placeholder || '').toLowerCase());
      if (ph.includes('ciudad') || ph.includes('city')) { await inp.type(datos.ciudad); break; }
    }

    const stateSelects = await page.$$('select');
    for (const sel of stateSelects) {
      const opts = await sel.evaluate(el => Array.from(el.options).map(o => ({ val: o.value, txt: o.text })));
      if (opts.some(o => o.txt.includes('FLORIDA') || o.txt.includes('CALIFORNIA') || o.txt.includes('TEXAS'))) {
        const match = opts.find(o => o.txt.toUpperCase().includes(datos.estado.toUpperCase()));
        if (match) await sel.select(match.val);
        break;
      }
    }

    await page.click('button:not([type="button"]), input[value*="SIGUIENTE"]').catch(() => {});
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});

    // PÁGINA 2 — Hospitalizaciones y Salud
    await page.waitForSelector('input[type="radio"]', { timeout: 10000 });
    await sleep(500);
    const radios1 = await page.$$('input[type="radio"]');
    // Hospitalizado NO=índice 1, SI=índice 0
    const hospIdx = datos.hospitalizado === 'NO' ? 1 : 0;
    if (radios1[hospIdx]) await radios1[hospIdx].click();
    const cancerIdx = datos.cancer === 'NO' ? 3 : 2;
    if (radios1[cancerIdx]) await radios1[cancerIdx].click();
    await page.click('button, input[value*="SIGUIENTE"]').catch(() => {});
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});

    // PÁGINA 3 — Tabaco
    await page.waitForSelector('input[type="radio"]', { timeout: 10000 });
    await sleep(500);
    const radios2 = await page.$$('input[type="radio"]');
    const tabacoIdx = datos.tabaco === 'NO' ? 1 : 0;
    if (radios2[tabacoIdx]) await radios2[tabacoIdx].click();
    const tabaco10Idx = datos.tabaco10 === 'NO' ? 3 : 2;
    if (radios2[tabaco10Idx]) await radios2[tabaco10Idx].click();
    await page.click('button, input[value*="SIGUIENTE"]').catch(() => {});
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});

    // PÁGINA 4 — Altura, Peso y Medicamentos
    await page.waitForSelector('select', { timeout: 10000 });
    await sleep(500);
    const selects4 = await page.$$('select');
    if (selects4[0]) await selects4[0].select(datos.pies).catch(() => {});
    if (selects4[1]) await selects4[1].select(datos.pulgadas).catch(() => {});
    const pesoInput = await page.$('input[type="number"], input[type="text"]');
    if (pesoInput) { await pesoInput.click(); await pesoInput.type(datos.peso); }
    const radios3 = await page.$$('input[type="radio"]');
    const medsIdx = datos.medicamentos === 'NO' ? 1 : 0;
    if (radios3[medsIdx]) await radios3[medsIdx].click();
    await page.click('button, input[value*="SIGUIENTE"]').catch(() => {});
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});

    // PÁGINA 5 — Seleccionar Producto
    await sleep(2000);
    const productoTexto = (datos.hospitalizado === 'NO' && datos.cancer === 'NO' && datos.tabaco === 'NO' && datos.tabaco10 === 'NO')
      ? 'MÁXIMO PREFERIDO' : (datos.tabaco === 'SI' || datos.tabaco10 === 'SI') ? 'SUPER PREFERIDO' : 'PREFERIDO';

    const items = await page.$$('li, tr, div[role="button"], .product-item');
    for (const item of items) {
      const text = await item.evaluate(el => el.textContent.toUpperCase());
      if (text.includes(productoTexto.replace('Á', 'A').replace('É', 'E'))) {
        await item.click();
        break;
      }
    }
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});

    // PÁGINA 6 — Capturar planes reales
    await sleep(2000);
    const pageText = await page.evaluate(() => document.body.innerText);
    console.log('Planes capturados:', pageText.substring(0, 500));

    await browser.close();

    // Notificar a Luis con planes reales
    const mensaje = `✅ LEAD CALIFICADO - Portal llenado automaticamente!

👤 ${datos.nombre} ${datos.apellido}
📍 ${datos.ciudad}, ${datos.estado}
📅 ${datos.fechaNacimiento} | ${datos.genero}

🏥 SALUD:
• Hospitalizado: ${datos.hospitalizado}
• Cancer/derrame: ${datos.cancer}
• Tabaco: ${datos.tabaco}
• Medicamentos: ${datos.medicamentos}

💰 PLAN ELEGIDO: ${datos.plan}
📋 Producto: ${productoTexto}

El portal ya fue llenado. Entre a revisar los planes exactos y llame para cerrar!
telesales.srlife.net`;

    if (luisNumber) {
      await twilioClient.messages.create({
        from: twilioNumber,
        to: `whatsapp:+${luisNumber}`,
        body: mensaje
      });
    }

  } catch (error) {
    console.error('Error llenando portal:', error.message);
    if (browser) await browser.close().catch(() => {});

    if (luisNumber) {
      const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
      await twilioClient.messages.create({
        from: twilioNumber,
        to: `whatsapp:+${luisNumber}`,
        body: `LEAD CALIFICADO (llenar portal manualmente):
Cliente: ${datos.nombre} ${datos.apellido}
${datos.ciudad}, ${datos.estado}
Plan: ${datos.plan}
telesales.srlife.net`
      }).catch(e => console.error('Error notif:', e));
    }
  }
}

function parsearLead(texto) {
  const match = texto.match(/##LEAD##\s*(.+)/);
  if (!match) return null;
  const campos = match[1].split('|');
  if (campos.length < 15) return null;
  return {
    nombre: campos[0], apellido: campos[1], fechaNacimiento: campos[2],
    genero: campos[3], ciudad: campos[4], estado: campos[5],
    hospitalizado: campos[6], cancer: campos[7], tabaco: campos[8],
    tabaco10: campos[9], pies: campos[10], pulgadas: campos[11],
    peso: campos[12], medicamentos: campos[13], plan: campos[14]
  };
}

app.get('/', (req, res) => { res.send('Agente Senior Life - Luis Osorio - Activo con Browserless'); });

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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: recentHistory,
    });

    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });

    const lead = parsearLead(reply);
    if (lead) {
      console.log('LEAD CALIFICADO:', JSON.stringify(lead));
      llenarPortal(lead); // en background
    }

    const replyLimpio = reply.replace(/##LEAD##.*/g, '').trim();
    const parts = replyLimpio.split('---PAUSA---').map(p => p.trim()).filter(p => p.length > 0);

    if (parts[0]) await twilioClient.messages.create({ from: twilioNumber, to: from, body: parts[0] });
    if (parts[1]) {
      await sleep(2500 + Math.random() * 2000);
      await twilioClient.messages.create({ from: twilioNumber, to: from, body: parts[1] });
    }

  } catch (error) {
    console.error('Error:', error);
    try {
      await twilioClient.messages.create({ from: twilioNumber, to: from, body: 'Disculpe, tuve un pequeño problema. Me puede repetir lo que me dijo?' });
    } catch (e) {}
  }
});

app.post('/reset', (req, res) => {
  const { phone } = req.body;
  if (phone && conversations.has(phone)) { conversations.delete(phone); res.json({ success: true }); }
  else res.json({ success: false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agente Senior Life activo en puerto ${PORT}`));
