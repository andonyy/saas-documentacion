const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { extractInvoiceData } = require('./anthropic');
const { generateMarkdown } = require('./markdown');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('Telegram bot: sin token (TELEGRAM_BOT_TOKEN no configurado)');
    return null;
  }

  const bot = new TelegramBot(token, {
    polling: { interval: 1000, autoStart: true }
  });

  bot.on('polling_error', (err) => {
    console.log('Telegram polling error:', err.code || err.message);
  });
  const allowedUsers = process.env.TELEGRAM_ALLOWED_USERS
    ? process.env.TELEGRAM_ALLOWED_USERS.split(',').map(id => parseInt(id.trim()))
    : [];

  console.log(`Telegram bot activo${allowedUsers.length ? ` (usuarios: ${allowedUsers.join(', ')})` : ' (abierto a todos)'}`);

  // /start
  bot.onText(/\/start/, (msg) => {
    if (!isAllowed(msg, allowedUsers)) return;
    bot.sendMessage(msg.chat.id,
      `*Facturas OCR*\n\nEnviame una foto de un ticket o factura y la proceso automaticamente.\n\nEl resultado se guarda en Obsidian.\n\nTu ID: \`${msg.from.id}\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Foto recibida
  bot.on('photo', async (msg) => {
    if (!isAllowed(msg, allowedUsers)) {
      bot.sendMessage(msg.chat.id, `No autorizado. Tu ID: ${msg.from.id}`);
      return;
    }

    const chatId = msg.chat.id;

    try {
      // Coger la foto de mayor resolucion (ultima del array)
      const photo = msg.photo[msg.photo.length - 1];
      const statusMsg = await bot.sendMessage(chatId, 'Procesando factura...');

      // Descargar foto
      const filePath = await bot.downloadFile(photo.file_id, UPLOADS_DIR);
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');

      // Determinar tipo MIME
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
      const mediaType = mimeTypes[ext] || 'image/jpeg';

      // Actualizar estado
      await bot.editMessageText('OCR en proceso (EasyOCR + GPU)...', { chat_id: chatId, message_id: statusMsg.message_id });

      // Procesar con OCR
      const data = await extractInvoiceData(base64Data, mediaType);

      // Guardar en Obsidian
      const documentId = uuidv4();
      const filename = generateMarkdown(documentId, data);

      // Actualizar estado
      await bot.editMessageText('Guardado en Obsidian. Preparando resumen...', { chat_id: chatId, message_id: statusMsg.message_id });

      // Formatear respuesta
      const lines = [];
      lines.push('*Factura procesada*\n');

      if (data.title) lines.push(`*${data.title}*`);
      if (data.invoiceNumber) lines.push(`N: ${data.invoiceNumber}`);
      if (data.date) lines.push(`Fecha: ${data.date}`);

      if (data.sender) {
        if (data.sender.taxId) lines.push(`NIF: \`${data.sender.taxId}\``);
        if (data.sender.address) lines.push(`Dir: ${data.sender.address}`);
      }

      if (data.lineItems && data.lineItems.length > 0) {
        lines.push('\n*Conceptos:*');
        data.lineItems.forEach(item => {
          lines.push(`  ${item.description} - ${item.unitPrice} x ${item.quantity} = ${item.total}`);
        });
      }

      lines.push('');
      if (data.subtotal) lines.push(`Subtotal: ${data.subtotal}`);
      if (data.taxRate) lines.push(`${data.taxRate}: ${data.taxAmount}`);
      if (data.total) lines.push(`*Total: ${data.total} ${data.currency || 'EUR'}*`);
      if (data.paymentTerms) lines.push(`Pago: ${data.paymentTerms}`);

      lines.push(`\nGuardado en Obsidian`);

      await bot.editMessageText(lines.join('\n'), {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown',
      });

      // Limpiar archivo temporal
      try { fs.unlinkSync(filePath); } catch {}

    } catch (err) {
      console.error('Telegram OCR error:', err.message);
      bot.sendMessage(chatId, `Error: ${err.message}`);
    }
  });

  // Documento (PDF, archivo de imagen)
  bot.on('document', async (msg) => {
    if (!isAllowed(msg, allowedUsers)) return;

    const doc = msg.document;
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

    if (!validTypes.includes(doc.mime_type)) {
      bot.sendMessage(msg.chat.id, 'Envia una imagen (JPG, PNG, WebP) o PDF.');
      return;
    }

    // Reusar la logica de fotos creando un evento simulado
    try {
      const chatId = msg.chat.id;
      const statusMsg = await bot.sendMessage(chatId, 'Procesando documento...');

      const filePath = await bot.downloadFile(doc.file_id, UPLOADS_DIR);
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');

      await bot.editMessageText('OCR en proceso...', { chat_id: chatId, message_id: statusMsg.message_id });

      const data = await extractInvoiceData(base64Data, doc.mime_type);
      const documentId = uuidv4();
      generateMarkdown(documentId, data);

      const summary = formatSummary(data);
      await bot.editMessageText(summary, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown',
      });

      try { fs.unlinkSync(filePath); } catch {}

    } catch (err) {
      console.error('Telegram doc error:', err.message);
      bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // Mensaje de texto generico
  bot.on('message', (msg) => {
    if (msg.photo || msg.document) return;
    if (msg.text && msg.text.startsWith('/')) return;
    if (!isAllowed(msg, allowedUsers)) return;

    bot.sendMessage(msg.chat.id, 'Enviame una foto de un ticket o factura para procesarla.');
  });

  return bot;
}

function isAllowed(msg, allowedUsers) {
  if (allowedUsers.length === 0) return true;
  return allowedUsers.includes(msg.from.id);
}

function formatSummary(data) {
  const lines = ['*Factura procesada*\n'];
  if (data.title) lines.push(`*${data.title}*`);
  if (data.invoiceNumber) lines.push(`N: ${data.invoiceNumber}`);
  if (data.date) lines.push(`Fecha: ${data.date}`);
  if (data.sender && data.sender.taxId) lines.push(`NIF: \`${data.sender.taxId}\``);
  if (data.total) lines.push(`*Total: ${data.total} ${data.currency || 'EUR'}*`);
  if (data.paymentTerms) lines.push(`Pago: ${data.paymentTerms}`);
  lines.push('\nGuardado en Obsidian');
  return lines.join('\n');
}

module.exports = { startTelegramBot };
