const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

function val(v) {
  return v != null ? v : 'N/A';
}

function generateMarkdown(documentId, data) {
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

  const content = lines.join('\n');
  const filePath = path.join(OUTPUT_DIR, `${documentId}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');

  return `${documentId}.md`;
}

function updateTitle(documentId, newTitle) {
  const filePath = path.join(OUTPUT_DIR, `${documentId}.md`);
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  const updated = content.replace(/^# .+/m, `# ${newTitle}`);
  fs.writeFileSync(filePath, updated, 'utf-8');
  return newTitle;
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
  fs.unlinkSync(filePath);
  return true;
}

module.exports = { generateMarkdown, updateTitle, listDocuments, getDocument, deleteDocument };
