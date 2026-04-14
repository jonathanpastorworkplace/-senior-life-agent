const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const puppeteer = require('puppeteer');

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
##LEAD## nombre|apellido|MM/DD/AAAA|MASCULINO o FEMENINO|ciudad|estado|SI o NO|SI o NO|SI o NO|SI o NO|pies|pulgadas|peso|SI o NO|Bueno o Mejor o Óptimo

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
  const agentId = process.env.SRLIFE_AGENT_ID;
  const password = process.env.SRLIFE_PASSWORD;
  const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
  const luisNumber = process.env.LUIS_WHATSAPP;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // LOGIN
    console.log('Entrando al portal...');
    await page.goto('https://telesales.srlife.net/login', { waitUntil: 'networkidle2' });
    await page.type('input[name="agent_id"], input[placeholder*="Agent"], input[type="text"]', agentId);
    await page.type('input[name="password"], input[type="password"]', password);
    await page.click('button[type="submit"], input[type="submit"], .login-btn');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('Login exitoso');

    // IR A APLICACIÓN
    await page.goto('https://telesales.srlife.net/prequalifying/app_start_page', { waitUntil: 'networkidle2' });

    // PÁGINA 1 — Asegurado Propuesto
    console.log('Llenando página 1...');
    await page.waitForSelector('input', { timeout: 10000 });
    
    const inputs = await page.$$('input[type="text"], input:not([type])');
    if (inputs[0]) await inputs[0].type(datos.nombre);
    if (inputs[1]) await inputs[1].type(datos.apellido);

    // Fecha de nacimiento
    await page.$eval('input[type="date"]', (el, val) => { el.value = val; }, datos.fechaNacimiento);

    // Género
    await page.select('select', datos.genero === 'MASCULINO' ? 'MASCULINO/HOMBRE' : 'FEMENINO/MUJER');

    // Ciudad
    const cityInputs = await page.$$('input[type="text"]');
    for (const input of cityInputs) {
      const placeholder = await input.evaluate(el => el.placeholder || '');
      if (placeholder.toLowerCase().includes('ciudad')) {
        await input.type(datos.ciudad);
        break;
      }
    }

    // Estado
    const selects = await page.$$('select');
    for (const select of selects) {
      const options = await select.evaluate(el => Array.from(el.options).map(o => o.text));
      if (options.some(o => o.includes('FLORIDA') || o.includes('CALIFORNIA'))) {
        await select.select(datos.estado.toUpperCase());
        break;
      }
    }

    await page.click('button:has-text("SIGUIENTE"), .siguiente, [value="SIGUIENTE"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // PÁGINA 2 — Hospitalizaciones y Salud
    console.log('Llenando página 2...');
    await page.waitForSelector('input[type="radio"]', { timeout: 10000 });
    
    const radios = await page.$$('input[type="radio"]');
    // Hospitalizado: SI=0, NO=1
    if (datos.hospitalizado === 'NO' && radios[1]) await radios[1].click();
    else if (radios[0]) await radios[0].click();
    // Cancer: SI=2, NO=3
    if (datos.cancer === 'NO' && radios[3]) await radios[3].click();
    else if (radios[2]) await radios[2].click();

    await page.click('button, .siguiente');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // PÁGINA 3 — Tabaco y Nicotina
    console.log('Llenando página 3...');
    await page.waitForSelector('input[type="radio"]', { timeout: 10000 });
    
    const radios2 = await page.$$('input[type="radio"]');
    if (datos.tabaco === 'NO' && radios2[1]) await radios2[1].click();
    else if (radios2[0]) await radios2[0].click();
    if (datos.tabaco10 === 'NO' && radios2[3]) await radios2[3].click();
    else if (radios2[2]) await radios2[2].click();

    await page.click('button, .siguiente');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // PÁGINA 4 — Altura, Peso y Medicamentos
    console.log('Llenando página 4...');
    await page.waitForSelector('select', { timeout: 10000 });
    
    const selectsP4 = await page.$$('select');
    if (selectsP4[0]) await selectsP4[0].select(datos.alturaPies);
    if (selectsP4[1]) await selectsP4[1].select(datos.alturaPulgadas);

    const pesoInput = await page.$('input[type="number"], input[placeholder*="peso"], input[placeholder*="Peso"]');
    if (pesoInput) await pesoInput.type(datos.peso);

    const radios3 = await page.$$('input[type="radio"]');
    if (datos.medicamentos === 'NO' && radios3[1]) await radios3[1].click();
    else if (radios3[0]) await radios3[0].click();

    await page.click('button, .siguiente');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // PÁGINA 5 — Seleccionar Producto
    console.log('Seleccionando producto...');
    await page.waitForSelector('li, .product-item, table tr', { timeout: 10000 });
    
    // Seleccionar Máximo Preferido basado en el perfil de salud
    const productoTexto = datos.hospitalizado === 'NO' && datos.cancer === 'NO' && datos.tabaco === 'NO' && datos.tabaco10 === 'NO'
      ? 'MÁXIMO PREFERIDO'
      : datos.tabaco === 'SI' || datos.tabaco10 === 'SI'
        ? 'SUPER PREFERIDO'
        : 'PREFERIDO';

    const items = await page.$$('li, tr, .product-item');
    for (const item of items) {
      const text = await item.evaluate(el => el.textContent.toUpperCase());
      if (text.includes(productoTexto)) {
        await item.click();
        break;
      }
    }

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // PÁGINA 6 — Capturar planes y precios
    console.log('Capturando planes...');
    await sleep(2000);
    
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const pageContent = await page.evaluate(() => document.body.innerText);

    // Extraer precios de los planes
    let planesTexto = 'Planes disponibles:\n';
    const precios = pageContent.match(/\$[\d,]+\.?\d*/g) || [];
    const planNames = ['Bueno', 'Mejor', 'Óptimo'];
    precios.slice(0, 6).forEach((precio, i) => {
      if (i < 3) planesTexto += `${planNames[i]}: ${precio}/mes\n`;
    });

    await browser.close();

    // Notificar a Luis con los planes reales
    const mensaje = `NUEVO LEAD CALIFICADO

Cliente: ${datos.nombre} ${datos.apellido}
Fecha nac: ${datos.fechaNacimiento}
${datos.ciudad}, ${datos.estado}

SALUD:
Hospitalizado: ${datos.hospitalizado}
Cancer/derrame: ${datos.cancer}
Tabaco: ${datos.tabaco}
Medicamentos: ${datos.medicamentos}

PLAN ELEGIDO: ${datos.plan}

${planesTexto}
Producto: ${productoTexto}

Portal ya llenado automaticamente!
Llame para cerrar la venta.`;

    if (luisNumber) {
      await twilioClient.messages.create({
        from: twilioNumber,
        to: `whatsapp:${luisNumber}`,
        body: mensaje
      });
      console.log('Notificacion enviada a Luis con planes reales');
    }

  } catch (error) {
    console.error('Error llenando portal:', error.message);
    if (browser) await browser.close();
    
    // Notificar a Luis igualmente con los datos aunque falle el portal
    if (luisNumber) {
      const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
      await twilioClient.messages.create({
        from: twilioNumber,
        to: `whatsapp:+${luisNumber}`,
        body: `LEAD CALIFICADO (llenar portal manualmente):
Cliente: ${datos.nombre} ${datos.apellido}
${datos.ciudad}, ${datos.estado}
Plan elegido: ${datos.plan}
Portal: telesales.srlife.net`
      }).catch(e => console.error('Error notificando:', e));
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
    tabaco10: campos[9], alturaPies: campos[10], alturaPulgadas: campos[11],
    peso: campos[12], medicamentos: campos[13], plan: campos[14]
  };
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
    const response = await anthropic.messages.create({
      model: 'claude-haiku-3-5-20241022',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: recentHistory,
    });

    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });

    const lead = parsearLead(reply);
    if (lead) {
      console.log('LEAD CALIFICADO:', JSON.stringify(lead));
      llenarPortal(lead); // ejecutar en background
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
