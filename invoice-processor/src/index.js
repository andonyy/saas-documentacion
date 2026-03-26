require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const invoiceRoutes = require('./routes/invoices');

const app = express();
app.use(express.json());

fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });

app.use('/api/invoices', invoiceRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Invoice processor running on http://localhost:${PORT}`);
});
