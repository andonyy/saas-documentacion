const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

function buildContentBlock(base64Data, mediaType) {
  if (mediaType === 'application/pdf') {
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64Data,
      },
    };
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType,
      data: base64Data,
    },
  };
}

async function extractInvoiceData(base64Data, mediaType) {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          buildContentBlock(base64Data, mediaType),
          {
            type: 'text',
            text: `Extrae todos los datos de esta factura o documento. Devuelve un objeto JSON con estos campos:
{
  "title": "título del documento o etiqueta de factura",
  "invoiceNumber": "...",
  "date": "...",
  "dueDate": "...",
  "sender": { "name": "...", "address": "...", "taxId": "..." },
  "receiver": { "name": "...", "address": "...", "taxId": "..." },
  "lineItems": [{ "description": "...", "quantity": 0, "unitPrice": 0, "total": 0 }],
  "subtotal": 0,
  "taxRate": "...",
  "taxAmount": 0,
  "total": 0,
  "currency": "...",
  "paymentTerms": "...",
  "notes": "..."
}
Usa null para campos no encontrados. Devuelve SOLO el JSON, sin bloques de código markdown.`,
          },
        ],
      },
    ],
  });

  const responseText = message.content[0].text;

  try {
    return JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No se pudo parsear la respuesta de Claude como JSON');
  }
}

module.exports = { extractInvoiceData };
