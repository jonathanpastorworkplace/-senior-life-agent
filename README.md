# Agente WhatsApp — Senior Life Insurance (Luis Osorio)

## Pasos para activar en Railway + Twilio

---

### PASO 1 — Subir a GitHub

1. Ve a github.com y crea una cuenta gratis si no tienes
2. Crea un repositorio nuevo llamado: `senior-life-agent`
3. Sube estos 3 archivos: `index.js`, `package.json`, `railway.toml`

---

### PASO 2 — Desplegar en Railway

1. Ve a railway.app y crea cuenta con tu GitHub
2. Click "New Project" → "Deploy from GitHub repo"
3. Selecciona `senior-life-agent`
4. Railway lo desplegará automáticamente

### Agregar variables de entorno en Railway:
- Ve a tu proyecto → Settings → Variables
- Agrega:
  - `ANTHROPIC_API_KEY` = tu API key de Anthropic
  - `PORT` = 3000

5. Copia la URL que te da Railway (ejemplo: `https://senior-life-agent.up.railway.app`)

---

### PASO 3 — Configurar Twilio

1. Ve a twilio.com y crea cuenta gratis
2. En el dashboard busca "WhatsApp Sandbox"
3. Activa el sandbox siguiendo las instrucciones
4. En "Sandbox Settings" → "When a message comes in" pega:
   `https://TU-URL-RAILWAY.up.railway.app/whatsapp`
5. Guarda

---

### PASO 4 — Probar

1. Desde tu WhatsApp envía el código de activación del sandbox de Twilio
2. Luego escribe: "Hola, me interesa el seguro de gastos finales"
3. El agente responderá automáticamente siguiendo el script de Luis Osorio

---

### El agente hace:
- Sigue el script completo de ventas de Luis Osorio
- Califica al cliente (salud, edad, estado)
- Presenta los 3 planes con precios reales
- Cuando el cliente elige → notifica para que Luis llame a cerrar

---

### Costo estimado mensual:
- Railway: $5/mes (plan Hobby)
- Twilio: ~$0.005 por mensaje (~$5-15/mes con uso normal)
- Anthropic API: ~$5-10/mes dependiendo del volumen
- **Total: ~$15-30/mes**
