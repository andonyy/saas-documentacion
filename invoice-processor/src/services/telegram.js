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
      `*Facturas OCR*\n\nEnviame una foto de un ticket o factura y la proceso automaticamente.\n\nEl resultado se guarda en Obsidian.\n\n*Comandos:*\n/gastos - Resumen de gastos del mes\n\nTu ID: \`${msg.from.id}\``,
      { parse_mode: 'Markdown' }
    );
  });

  // /gastos - Resumen de gastos del mes
  bot.onText(/\/gastos/, (msg) => {
    if (!isAllowed(msg, allowedUsers)) return;
    const summary = getSpendingSummary();
    bot.sendMessage(msg.chat.id, summary, { parse_mode: 'Markdown' });
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

function getSpendingSummary() {
  const VAULT_DIR = process.env.OBSIDIAN_VAULT_PATH || path.join(require('os').homedir(), 'ObsidianVault', '30 Documentos fuente');
  if (!fs.existsSync(VAULT_DIR)) return 'No se encontro la carpeta de documentos.';

  const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const files = fs.readdirSync(VAULT_DIR).filter(f => f.endsWith('.md'));
  const invoices = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(VAULT_DIR, file), 'utf-8');
    const fm = {};
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      fmMatch[1].split('\n').forEach(line => {
        const m = line.match(/^(\w[\w_]*)\s*:\s*(.+)/);
        if (m) fm[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
      });
    }

    const total = parseFloat(fm.total) || 0;
    if (total <= 0) continue;

    let dateObj = null;
    const dateStr = fm.fecha_documento || '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      dateObj = new Date(dateStr);
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [d, m, y] = dateStr.split('/');
      dateObj = new Date(`${y}-${m}-${d}`);
    }

    invoices.push({
      sender: fm.sender || file.replace('.md', ''),
      total,
      currency: fm.currency || 'EUR',
      date: dateStr,
      dateObj,
      month: dateObj ? dateObj.getMonth() : -1,
      year: dateObj ? dateObj.getFullYear() : -1
    });
  }

  // Este mes
  const thisMonth = invoices.filter(i => i.month === currentMonth && i.year === currentYear);
  const thisMonthTotal = thisMonth.reduce((s, i) => s + i.total, 0);

  // Mes anterior
  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  const lastMonth = invoices.filter(i => i.month === prevMonth && i.year === prevYear);
  const lastMonthTotal = lastMonth.reduce((s, i) => s + i.total, 0);

  // Total general
  const grandTotal = invoices.reduce((s, i) => s + i.total, 0);

  // Construir mensaje
  const lines = [];
  lines.push('*Resumen de gastos*\n');

  // Este mes
  lines.push(`*${MONTH_NAMES[currentMonth]} ${currentYear}*`);
  if (thisMonth.length > 0) {
    thisMonth.sort((a, b) => (b.dateObj || 0) - (a.dateObj || 0));
    thisMonth.forEach(inv => {
      lines.push(`  ${inv.sender}: *${inv.total.toFixed(2)}* ${inv.currency}`);
    });
    lines.push(`\`Total: ${thisMonthTotal.toFixed(2)} EUR\` (${thisMonth.length} fact.)`);
  } else {
    lines.push('  Sin facturas');
  }

  // Mes anterior
  lines.push(`\n*${MONTH_NAMES[prevMonth]} ${prevYear}*`);
  if (lastMonth.length > 0) {
    lines.push(`\`Total: ${lastMonthTotal.toFixed(2)} EUR\` (${lastMonth.length} fact.)`);
  } else {
    lines.push('  Sin facturas');
  }

  // Comparativa
  if (thisMonthTotal > 0 && lastMonthTotal > 0) {
    const diff = thisMonthTotal - lastMonthTotal;
    const pct = ((diff / lastMonthTotal) * 100).toFixed(0);
    const arrow = diff > 0 ? 'mas' : 'menos';
    lines.push(`\n${Math.abs(diff).toFixed(2)} EUR ${arrow} que el mes pasado (${pct > 0 ? '+' : ''}${pct}%)`);
  }

  // Acumulado
  lines.push(`\n*Acumulado total:* ${grandTotal.toFixed(2)} EUR (${invoices.length} fact.)`);

  // Ticket medio
  if (invoices.length > 0) {
    const avg = grandTotal / invoices.length;
    lines.push(`*Ticket medio:* ${avg.toFixed(2)} EUR`);
  }

  // Top 3
  const bySender = {};
  invoices.forEach(i => {
    if (!bySender[i.sender]) bySender[i.sender] = 0;
    bySender[i.sender] += i.total;
  });
  const top = Object.entries(bySender).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length > 0) {
    lines.push('\n*Top gastos:*');
    top.forEach(([name, total], i) => {
      lines.push(`  ${i + 1}. ${name}: ${total.toFixed(2)} EUR`);
    });
  }

  return lines.join('\n');
}

module.exports = { startTelegramBot };
