const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const OBSIDIAN_DIR = process.env.OBSIDIAN_VAULT_PATH || path.join(require('os').homedir(), 'ObsidianVault', 'Facturas', 'Procesadas');

function val(v) {
  return v != null ? v : 'N/A';
}

function buildFrontmatter(documentId, data) {
  const lines = [];
  lines.push('---');
  lines.push(`id: "${documentId}"`);
  lines.push(`tags: [factura, procesada]`);
  lines.push(`invoice_number: "${val(data.invoiceNumber)}"`);
  lines.push(`date: "${val(data.date)}"`);
  lines.push(`due_date: "${val(data.dueDate)}"`);
  lines.push(`sender: "${data.sender ? val(data.sender.name) : 'N/A'}"`);
  lines.push(`receiver: "${data.receiver ? val(data.receiver.name) : 'N/A'}"`);
  lines.push(`total: ${data.total != null ? data.total : 0}`);
  lines.push(`currency: "${val(data.currency)}"`);
  lines.push(`status: "procesada"`);
  lines.push(`created: "${new Date().toISOString()}"`);
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

function buildMarkdownBody(documentId, data) {
  const lines = [];

  lines.push(`# ${val(data.title)}`);
  lines.push('');
  lines.push(`**Document ID:** ${documentId}`);
  lines.push(`**Generado:** ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Detalles de Factura');
  lines.push('');
  lines.push('| Campo | Valor |');
  lines.push('|-------|-------|');
  lines.push(`| Número de Factura | ${val(data.invoiceNumber)} |`);
  lines.push(`| Fecha | ${val(data.date)} |`);
  lines.push(`| Fecha de Vencimiento | ${val(data.dueDate)} |`);
  lines.push(`| Moneda | ${val(data.currency)} |`);
  lines.push('');

  if (data.sender) {
    lines.push('## Emisor');
    lines.push('');
    lines.push('| Campo | Valor |');
    lines.push('|-------|-------|');
    lines.push(`| Nombre | ${val(data.sender.name)} |`);
    lines.push(`| Dirección | ${val(data.sender.address)} |`);
    lines.push(`| NIF/CIF | ${val(data.sender.taxId)} |`);
    lines.push('');
  }

  if (data.receiver) {
    lines.push('## Receptor');
    lines.push('');
    lines.push('| Campo | Valor |');
    lines.push('|-------|-------|');
    lines.push(`| Nombre | ${val(data.receiver.name)} |`);
    lines.push(`| Dirección | ${val(data.receiver.address)} |`);
    lines.push(`| NIF/CIF | ${val(data.receiver.taxId)} |`);
    lines.push('');
  }

  if (data.lineItems && data.lineItems.length > 0) {
    lines.push('## Líneas de Factura');
    lines.push('');
    lines.push('| # | Descripción | Cantidad | Precio Unitario | Total |');
    lines.push('|---|-------------|----------|-----------------|-------|');
    data.lineItems.forEach((item, i) => {
      lines.push(`| ${i + 1} | ${val(item.description)} | ${val(item.quantity)} | ${val(item.unitPrice)} | ${val(item.total)} |`);
    });
    lines.push('');
  }

  lines.push('## Totales');
  lines.push('');
  lines.push('| Concepto | Importe |');
  lines.push('|----------|---------|');
  lines.push(`| Subtotal | ${val(data.subtotal)} |`);
  lines.push(`| Impuesto (${val(data.taxRate)}) | ${val(data.taxAmount)} |`);
  lines.push(`| **Total** | **${val(data.total)}** |`);
  lines.push('');

  if (data.paymentTerms || data.notes) {
    lines.push('## Información Adicional');
    lines.push('');
    if (data.paymentTerms) lines.push(`**Condiciones de Pago:** ${data.paymentTerms}`);
    if (data.notes) lines.push(`**Notas:** ${data.notes}`);
    lines.push('');
  }

  return lines.join('\n');
}

function generateMarkdown(documentId, data) {
  const frontmatter = buildFrontmatter(documentId, data);
  const body = buildMarkdownBody(documentId, data);
  const content = frontmatter + body;

  // Save to local output
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const localPath = path.join(OUTPUT_DIR, `${documentId}.md`);
  fs.writeFileSync(localPath, content, 'utf-8');

  // Save to Obsidian vault
  fs.mkdirSync(OBSIDIAN_DIR, { recursive: true });
  const title = data.title || documentId;
  const safeTitle = title.replace(/[<>:"/\\|?*]/g, '-').substring(0, 100);
  const obsidianPath = path.join(OBSIDIAN_DIR, `${safeTitle}.md`);
  fs.writeFileSync(obsidianPath, content, 'utf-8');

  return `${documentId}.md`;
}

function updateTitle(documentId, newTitle) {
  const filePath = path.join(OUTPUT_DIR, `${documentId}.md`);
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  const updated = content.replace(/^# .+/m, `# ${newTitle}`);
  fs.writeFileSync(filePath, updated, 'utf-8');

  // Update in Obsidian too - find by id in frontmatter
  syncToObsidian(documentId, updated, newTitle);

  return newTitle;
}

function syncToObsidian(documentId, content, title) {
  if (!fs.existsSync(OBSIDIAN_DIR)) return;

  // Remove old file with this ID
  const files = fs.readdirSync(OBSIDIAN_DIR).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const fPath = path.join(OBSIDIAN_DIR, f);
    const fContent = fs.readFileSync(fPath, 'utf-8');
    if (fContent.includes(`id: "${documentId}"`)) {
      fs.unlinkSync(fPath);
      break;
    }
  }

  // Write new file with updated title
  const safeTitle = (title || documentId).replace(/[<>:"/\\|?*]/g, '-').substring(0, 100);
  const obsidianPath = path.join(OBSIDIAN_DIR, `${safeTitle}.md`);
  fs.writeFileSync(obsidianPath, content, 'utf-8');
}

function listDocuments() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];

  return fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filePath = path.join(OUTPUT_DIR, f);
      const content = fs.readFileSync(filePath, 'utf-8');
      const titleMatch = content.match(/^# (.+)/m);
      const stat = fs.statSync(filePath);
      return {
        id: f.replace('.md', ''),
        filename: f,
        title: titleMatch ? titleMatch[1] : 'Sin título',
        createdAt: stat.birthtime,
      };
    });
}

function getDocument(documentId) {
  const filePath = path.join(OUTPUT_DIR, `${documentId}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

function deleteDocument(documentId) {
  const filePath = path.join(OUTPUT_DIR, `${documentId}.md`);
  if (!fs.existsSync(filePath)) return false;

  // Also delete from Obsidian
  const content = fs.readFileSync(filePath, 'utf-8');
  if (fs.existsSync(OBSIDIAN_DIR)) {
    const files = fs.readdirSync(OBSIDIAN_DIR).filter(f => f.endsWith('.md'));
    for (const f of files) {
      const fPath = path.join(OBSIDIAN_DIR, f);
      const fContent = fs.readFileSync(fPath, 'utf-8');
      if (fContent.includes(`id: "${documentId}"`)) {
        fs.unlinkSync(fPath);
        break;
      }
    }
  }

  fs.unlinkSync(filePath);
  return true;
}

module.exports = { generateMarkdown, updateTitle, listDocuments, getDocument, deleteDocument };
