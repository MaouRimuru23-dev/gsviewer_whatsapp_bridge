const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys'); const express = require('express'); const QRCode = require('qrcode'); const axios = require('axios');
const app = express(); const PORT = process.env.PORT || 3000;
// URL de tu servidor Python en Render const PYTHON_WEBHOOK = 'https://gsviewer-whatsapp-bot.onrender.com/webhook';
let currentQR = ''; let isConnected = false;
async function connectToWhatsApp() { const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
});

sock.ev.on('creds.update', saveCreds);

sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
        currentQR = qr;
        isConnected = false;
        console.log('Nuevo código QR generado.');
    }
    if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('Conexión cerrada. Reconectando...', shouldReconnect);
        if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
        console.log('✅ ¡WhatsApp vinculado y activo para GSViewer!');
        isConnected = true;
        currentQR = '';
    }
});

// Escuchar mensajes entrantes de WhatsApp
sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
        if (msg.key.fromMe) continue; // Ignorar mensajes propios
        
        const jid = msg.key.remoteJid;
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

        if (!text) continue;

        console.log(`📩 Mensaje recibido de ${jid}: ${text}`);

        try {
            // Enviar el mensaje al servidor Flask de Python
            const res = await axios.post(PYTHON_WEBHOOK, {
                message: text,
                sender: jid
            });

            const responseText = res.data?.response;
            if (responseText) {
                await sock.sendMessage(jid, { text: responseText });
                console.log(`📤 Respuesta enviada a ${jid}`);
            }
        } catch (err) {
            console.error('❌ Error comunicando con el servidor Python:', err.message);
        }
    }
});
}
// Servidor Web para mostrar el Código QR en pantalla app.get('/', async (req, res) => { if (isConnected) { return res.send(<div style="text-align:center; font-family:sans-serif; margin-top:50px; color:green;"> <h1>✅ GSViewer WhatsApp Bot Conectado y Activo!</h1> <p>El bot está escuchando y respondiendo consultas en vivo.</p> </div>); } if (!currentQR) { return res.send(<div style="text-align:center; font-family:sans-serif; margin-top:50px;"> <h1>⏳ Generando código QR...</h1> <p>Recarga la página en unos segundos.</p> </div>); } try { const qrImage = await QRCode.toDataURL(currentQR); res.send(<div style="text-align:center; font-family:sans-serif; margin-top:50px;"> <h2>📲 Escanea este Código QR con tu WhatsApp</h2> <p>Abre WhatsApp en tu teléfono ➔ <b>Dispositivos vinculados</b> ➔ <b>Vincular un dispositivo</b></p> <img src="${qrImage}" style="width:300px; height:300px;"/> </div>); } catch (err) { res.send('Error mostrando el código QR.'); } });
app.listen(PORT, () => { console.log(`[Servidor puente escuchando en el puerto ${PORT}]`); connectToWhatsApp(); });