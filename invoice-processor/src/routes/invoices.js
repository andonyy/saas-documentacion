const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { extractInvoiceData } = require('../services/anthropic');
const { generateMarkdown, updateTitle, listDocuments, getDocument } = require('../services/markdown');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no soportado. Use PDF, JPEG, PNG, WebP o GIF.'));
    }
  },
});

// POST / - Subir documento y extraer datos
router.post('/', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún documento' });
    }

    const fileBuffer = fs.readFileSync(req.file.path);
    const base64Data = fileBuffer.toString('base64');
    const mediaType = req.file.mimetype;

    const extractedData = await extractInvoiceData(base64Data, mediaType);
    const documentId = uuidv4();
    const filename = generateMarkdown(documentId, extractedData);

    res.status(201).json({
      id: documentId,
      filename,
      data: extractedData,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / - Listar documentos generados
router.get('/', (req, res) => {
  const documents = listDocuments();
  res.json(documents);
});

// GET /:id - Obtener un documento markdown
router.get('/:id', (req, res) => {
  const content = getDocument(req.params.id);
  if (!content) {
    return res.status(404).json({ error: 'Documento no encontrado' });
  }
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.send(content);
});

// PUT /:id/title - Modificar el título del documento
router.put('/:id/title', (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Se requiere un título válido' });
  }

  const newTitle = updateTitle(req.params.id, title.trim());
  if (!newTitle) {
    return res.status(404).json({ error: 'Documento no encontrado' });
  }

  res.json({ id: req.params.id, title: newTitle });
});

module.exports = router;
