const OCR_URL = process.env.OCR_URL || 'http://localhost:5555';

async function extractInvoiceData(base64Data, mediaType) {
  const response = await fetch(`${OCR_URL}/ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Data }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OCR Server error (${response.status}): ${error}`);
  }

  const result = await response.json();
  return result.data;
}

module.exports = { extractInvoiceData };
