const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const PYTHON_WEBHOOK = 'https://gsviewer-whatsapp-bot.onrender.com/webhook';

let currentQR = '';
let isConnected = false;

app.use(express.json());

app.get('/', async (req, res) => {
  if (isConnected) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>GSViewer WhatsApp Bot</title></head>
      <body style="text-align:center; font-family:sans-serif; margin-top:50px; background:#0B1120; color:white;">
        <h1 style="color:#4CAF50;">✅ ¡GSViewer WhatsApp Bot Conectado y Activo!</h1>
        <p style="color:#B0B0B0;">El bot está escuchando y respondiendo consultas de Grand Summoners en vivo.</p>
      </body>
      </html>
    `);
  }

  if (!currentQR) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>GSViewer WhatsApp Bot</title><meta http-equiv="refresh" content="3"></head>
      <body style="text-align:center; font-family:sans-serif; margin-top:50px; background:#0B1120; color:white;">
        <h1>⏳ Generando código QR...</h1>
        <p style="color:#AAA;">La página se recargará automáticamente en 3 segundos.</p>
      </body>
      </html>
    `);
  }

  try {
    const qrImage = await QRCode.toDataURL(currentQR);
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Vincular GSViewer WhatsApp</title><meta http-equiv="refresh" content="10"></head>
      <body style="text-align:center; font-family:sans-serif; margin-top:40px; background:#0B1120; color:white;">
        <h2>📲 Escanea este Código QR con tu WhatsApp</h2>
        <p style="color:#AAA;">Abre WhatsApp en tu teléfono ➔ <b>Dispositivos vinculados</b> ➔ <b>Vincular un dispositivo</b></p>
        <div style="background:white; display:inline-block; padding:15px; border-radius:15px; margin-top:10px;">
          <img src="${qrImage}" style="width:280px; height:280px; display:block;"/>
        </div>
        <p style="font-size:12px; color:#888; margin-top:15px;">El código se recarga automáticamente si expira.</p>
      </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send('Error generando imagen del código QR.');
  }
});

async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['GSViewer Bot', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = qr;
        isConnected = false;
        console.log('⚡ Nuevo código QR listo para escaneo.');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`Conexión cerrada (código ${statusCode}). Reconectando: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(connectToWhatsApp, 3000);
        }
      } else if (connection === 'open') {
        console.log('✅ ¡WhatsApp vinculado exitosamente para GSViewer!');
        isConnected = true;
        currentQR = '';
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          '';

        if (!text) continue;

        console.log(`📩 [WhatsApp In] ${jid}: ${text}`);

        try {
          const res = await axios.post(
            PYTHON_WEBHOOK,
            {
              message: text,
              sender: jid
            },
            { timeout: 10000 }
          );

          const responseText = res.data?.response;
          if (responseText) {
            await sock.sendMessage(jid, { text: responseText });
            console.log(`📤 [WhatsApp Out] Enviado a ${jid}`);
          }
        } catch (err) {
          console.error('❌ Error enviando mensaje al webhook de Python:', err.message);
        }
      }
    });
  } catch (e) {
    console.error('Error conectando Baileys:', e);
    setTimeout(connectToWhatsApp, 5000);
  }
}

app.listen(PORT, () => {
  console.log(`[🚀 Servidor puente escuchando en puerto ${PORT}]`);
  connectToWhatsApp();
});