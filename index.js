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
Parte 1: reacción h
