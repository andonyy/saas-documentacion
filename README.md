# Facturas OCR - Sistema Local

Sistema 100% local para digitalizar tickets y facturas. Sube una foto, extrae los datos con OCR y los guarda automaticamente en tu vault de Obsidian.

**Sin APIs cloud. Sin costes. Todo en tu PC.**

---

## Como funciona

```
Foto del ticket
      |
      v
  [Frontend web]  ---->  [Node.js API]  ---->  [Python OCR Server]
  (localhost:3000)        (puerto 3000)          (puerto 5555)
                               |                      |
                               |              EasyOCR + GPU (CUDA)
                               |              OpenCV preprocesado
                               |              Regex post-procesado
                               |                      |
                               v                      v
                      [Markdown generator]    Datos estructurados JSON
                               |
                               v
                    Obsidian Vault / 30 Documentos fuente
```

### Pipeline paso a paso

1. **Subes una foto** desde el navegador (drag & drop o seleccionar archivo)
2. **Node.js** recibe la imagen y la envia al servidor OCR Python
3. **OpenCV preprocesa** la imagen para maximizar la legibilidad:
   - Convierte a escala de grises
   - Aplica CLAHE (Contrast Limited Adaptive Histogram Equalization)
   - Elimina ruido (fastNlMeansDenoising)
   - Binariza con threshold adaptativo o Otsu
   - Genera 3 variantes con diferentes configuraciones de contraste
4. **EasyOCR** (con GPU si hay CUDA) lee cada variante de la imagen
5. **Fusion de detecciones**: agrupa resultados por posicion, elige la mejor lectura de cada zona
6. **Correccion OCR**: regex que arreglan errores tipicos (caracteres confundidos, nombres vascos/espanoles)
7. **Extraccion de datos**: regex especializados extraen NIF, fecha, importes, conceptos, forma de pago
8. **Validacion numerica**: verifica que total = subtotal + IVA, recalcula si no cuadra
9. **Genera markdown** con frontmatter YAML y tablas
10. **Guarda en Obsidian** automaticamente en `30 Documentos fuente/`

---

## Requisitos

| Componente | Version | Para que |
|-----------|---------|----------|
| Windows 10/11 | - | Sistema operativo |
| Node.js | v24+ | Servidor web y API |
| Python | 3.11 | Motor OCR |
| Anaconda/Miniconda | - | Gestionar entorno Python |
| NVIDIA GPU | cualquiera | Acelerar OCR (opcional, funciona en CPU) |
| CUDA | 12.x | Drivers GPU para PyTorch |
| Obsidian | - | Vault donde se guardan las facturas |

### Espacio en disco

- EasyOCR modelos: ~200 MB (se descargan la primera vez)
- PyTorch CUDA: ~2.5 GB
- Proyecto: ~50 MB

---

## Instalacion desde cero

### 1. Clonar el repositorio

```bash
git clone <url-del-repo> "Saas documentacion"
cd "Saas documentacion"
```

### 2. Instalar Node.js

Instalar [fnm](https://github.com/Schniz/fnm) o descargar Node.js directamente:

```bash
fnm install 24
fnm use 24
```

### 3. Instalar dependencias Node.js

```bash
cd invoice-processor
npm install
```

Esto instala: express, multer, uuid, dotenv, sharp, tesseract.js

### 4. Crear entorno Python con Anaconda

```bash
conda create -n ocr python=3.11 -y
conda activate ocr
```

### 5. Instalar dependencias Python

```bash
# OpenCV y EasyOCR
pip install opencv-python-headless easyocr

# PyTorch con CUDA (para GPU NVIDIA)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124

# Si no tienes GPU NVIDIA, instalar version CPU:
# pip install torch torchvision
```

### 6. Verificar que CUDA funciona

```bash
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

Debe mostrar `CUDA: True` si tienes GPU NVIDIA con drivers actualizados.

### 7. Configurar Obsidian vault

Crear un archivo `.env` en `invoice-processor/`:

```env
OBSIDIAN_VAULT_PATH=C:\Users\TU_USUARIO\ObsidianVault\30 Documentos fuente
PORT=3000
```

Si no configuras `OBSIDIAN_VAULT_PATH`, usa por defecto `~/ObsidianVault/30 Documentos fuente`.

### 8. Configurar el launcher (.bat)

Edita `Facturas OCR.bat` y cambia las rutas de PYTHON y NODE a las de tu sistema:

```bat
set "PYTHON=C:\Users\TU_USUARIO\anaconda3\envs\ocr\python.exe"
set "NODE=C:\ruta\a\tu\node.exe"
```

---

## Uso

### Opcion A: Doble clic (recomendado)

Ejecuta `Facturas OCR.bat` desde la carpeta `Saas documentacion` o el acceso directo del escritorio.

Arranca todo automaticamente y abre el navegador.

### Opcion B: Manual (dos terminales)

**Terminal 1 - Servidor OCR:**

```bash
conda activate ocr
cd invoice-processor
python src/ocr_engine.py --server
```

Espera a que muestre `OCR Server en http://localhost:5555`

**Terminal 2 - Servidor web:**

```bash
cd invoice-processor
node src/index.js
```

Abre `http://localhost:3000` en el navegador.

### Opcion C: Solo CLI (sin navegador)

```bash
conda activate ocr
python src/ocr_engine.py foto_ticket.jpg
```

Muestra el JSON extraido directamente en la terminal.

---

## Estructura del proyecto

```
Saas documentacion/
  |
  +-- Facturas OCR.bat          # Launcher: arranca todo con doble clic
  +-- Cerrar Facturas OCR.bat   # Para los servidores
  +-- README.md
  |
  +-- front/
  |     +-- index.html          # Frontend web (dark mode, drag & drop)
  |
  +-- invoice-processor/
  |     +-- .env                # Config (OBSIDIAN_VAULT_PATH, PORT)
  |     +-- package.json
  |     |
  |     +-- src/
  |     |     +-- index.js               # Express server + CORS + static files
  |     |     +-- ocr_engine.py          # Motor OCR Python (EasyOCR + OpenCV)
  |     |     |
  |     |     +-- routes/
  |     |     |     +-- invoices.js      # API REST endpoints
  |     |     |
  |     |     +-- services/
  |     |           +-- anthropic.js     # Puente Node -> Python OCR
  |     |           +-- markdown.js      # Generador de markdown + Obsidian sync
  |     |
  |     +-- src/output/                  # Copias locales de los markdown
  |     +-- src/uploads/                 # Imagenes subidas temporalmente
  |
  +-- Apis/                              # API keys (Gemini, Anthropic)
```

---

## API REST

Todos los endpoints estan en `http://localhost:3000/api/invoices/`

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `POST /api/invoices/` | Procesar una imagen | Sube imagen, ejecuta OCR, guarda en Obsidian |
| `POST /api/invoices/batch` | Procesar varias | Hasta 20 imagenes a la vez |
| `GET /api/invoices/` | Listar documentos | Todos los documentos procesados |
| `GET /api/invoices/:id` | Ver documento | Devuelve el markdown generado |
| `GET /api/invoices/:id/download` | Descargar | Descarga el archivo .md |
| `GET /api/invoices/search?q=texto` | Buscar | Busca en el contenido |
| `PUT /api/invoices/:id/title` | Cambiar titulo | `{ "title": "nuevo" }` |
| `DELETE /api/invoices/:id` | Eliminar | Borra local y de Obsidian |
| `GET /health` | Estado del servidor | `{ "status": "ok" }` |

### Ejemplo con curl

```bash
curl -X POST http://localhost:3000/api/invoices/ \
  -F "document=@foto_ticket.jpg"
```

Respuesta:

```json
{
  "id": "uuid-del-documento",
  "filename": "uuid.md",
  "data": {
    "title": "Kantina Lekuona U.T.E.",
    "invoiceNumber": "T-73800",
    "date": "07/12/2025",
    "sender": {
      "name": "Kantina Lekuona U.T.E.",
      "address": "Ugarritza Etorbidea 1, Errenteria, 20100",
      "taxId": "U06975544"
    },
    "lineItems": [
      { "description": "2 ZURITO KELLER", "quantity": 2, "unitPrice": 1.80, "total": 3.60 }
    ],
    "subtotal": 3.27,
    "taxRate": "IVA 10%",
    "taxAmount": 0.33,
    "total": 3.60,
    "currency": "EUR",
    "paymentTerms": "Efectivo"
  }
}
```

---

## Motor OCR: como funciona por dentro

### Porque no Tesseract

Tesseract es el OCR open source mas conocido, pero falla con tickets termicos de bajo contraste. Lo probamos y el resultado era ilegible. El papel termico se desvanece y Tesseract no puede con ello.

### Porque EasyOCR

EasyOCR usa redes neuronales (CRAFT para deteccion + CRNN para reconocimiento) que manejan mucho mejor el texto degradado. Ademas:

- Soporta espanol de serie
- Tiene parametro `contrast_ths` para texto de bajo contraste
- Funciona en GPU con CUDA (3-5x mas rapido)
- Es pip install, sin binarios externos

### Preprocesado con OpenCV

La clave del rendimiento esta en el preprocesado. El motor genera **3 variantes** de cada imagen:

1. **CLAHE + threshold adaptativo**: Ecualiza contraste por bloques. Ideal para tickets donde una parte esta mas oscura que otra.

2. **Contraste lineal alto + Otsu**: Estira los niveles de gris agresivamente y deja que Otsu calcule el umbral optimo. Captura texto muy tenue.

3. **CLAHE fuerte + threshold fijo**: Mas agresivo que la variante 1. Captura detalles que las otras pierden.

EasyOCR procesa las 3 variantes y el motor **fusiona los resultados**: agrupa detecciones por posicion (Y,X) y elige la de mayor confianza para cada zona.

### Post-procesado con regex

Los caracteres confundidos por el OCR se corrigen con reglas:

- `Lekuony` -> `Lekuona` (nombres vascos)
- `Etorbidea` se detecta aunque este roto en `Et orb idea`
- `Efec-iv)` -> `Efectivo`
- NIFs se buscan con patron `[A-Z]\d{8}`
- Importes se extraen y se verifican: `total = subtotal + IVA`

### Porque no un LLM local

Probamos Qwen2.5-VL-7B para leer la imagen directamente. Resultado: alucino todos los datos. Los LLMs de 7B no tienen capacidad suficiente para OCR fiable. Los de 72B necesitan 48+ GB de RAM.

La combinacion EasyOCR (lee los caracteres) + regex (estructura los datos) funciona mejor que cualquier LLM local en este hardware.

---

## Formato de salida en Obsidian

Cada factura se guarda como un archivo markdown con frontmatter YAML:

```yaml
---
id: "uuid"
tags: [documento-fuente, factura]
tipo: factura
fecha_documento: "07/12/2025"
invoice_number: "T-73800"
sender: "Kantina Lekuona U.T.E."
total: 3.6
currency: "EUR"
status: "procesada"
---
```

El body contiene tablas markdown con los detalles del emisor, conceptos, totales y forma de pago. Obsidian los indexa automaticamente y aparecen en el Dashboard.

---

## Limitaciones conocidas

- **Tickets muy desvanecidos**: Si el ticket es casi blanco, el OCR no puede leer nada. Esto es una limitacion fisica, no del software.
- **Fechas**: Es el campo mas dificil de leer. Los digitos de la fecha suelen estar en la zona mas tenue del ticket.
- **Algun digito del NIF**: El OCR puede confundir 0 y 9, 7 y 2. Los importes suelen leerse bien porque son mas grandes.
- **GPU**: Sin GPU funciona igual pero 3-5x mas lento (30-60 seg en vez de 10-15 seg por ticket).

---

## Troubleshooting

### El .bat dice "Node.js no encontrado"

La ruta de node.exe depende de como lo instalaste. Busca donde esta:

```cmd
where node
```

O busca manualmente:

```cmd
dir /s /b C:\Users\TU_USUARIO\node.exe
```

Edita la linea `set "NODE=..."` en `Facturas OCR.bat` con la ruta correcta.

### CUDA no disponible

```bash
python -c "import torch; print(torch.cuda.is_available())"
```

Si dice `False`:
1. Verifica que tienes GPU NVIDIA: `nvidia-smi`
2. Reinstala PyTorch con CUDA: `pip install torch --index-url https://download.pytorch.org/whl/cu124`
3. Si no tienes GPU NVIDIA, edita `ocr_engine.py` linea 20: cambia `gpu=True` a `gpu=False`

### El OCR no arranca (paso 3 se queda colgado)

Abre una terminal y ejecuta manualmente:

```bash
conda activate ocr
python invoice-processor/src/ocr_engine.py --server
```

Mira el error que sale. Los mas comunes:
- `ModuleNotFoundError`: falta instalar algo (`pip install easyocr opencv-python-headless`)
- `CUDA error`: problema de drivers GPU, cambia a `gpu=False`

### Los importes no cuadran

El motor valida automaticamente que `total = subtotal + IVA`. Si el OCR lee mal un importe, el motor recalcula. Pero si lee mal los tres, no puede corregirlo.

---

## Tecnologias

| Tecnologia | Version | Funcion |
|-----------|---------|---------|
| EasyOCR | 1.7.1 | OCR con redes neuronales |
| OpenCV | 4.8+ | Preprocesado de imagenes |
| PyTorch | 2.6+ | Backend GPU para EasyOCR |
| CUDA | 12.4 | Aceleracion GPU |
| Express.js | 4.x | API REST |
| Sharp | 0.33+ | Procesado de imagen en Node |
| Multer | 1.x | Upload de archivos |
| Obsidian | - | Vault de documentos |
