const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PROMPT = `Extrae todos los datos de esta factura o documento. Devuelve un objeto JSON con estos campos:
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
Usa null para campos no encontrados. Devuelve SOLO el JSON, sin bloques de código markdown.`;

async function extractInvoiceData(base64Data, mediaType) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: mediaType,
        data: base64Data,
      },
    },
    PROMPT,
  ]);

  const responseText = result.response.text();

  try {
    return JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No se pudo parsear la respuesta de Gemini como JSON');
  }
}

module.exports = { extractInvoiceData };
