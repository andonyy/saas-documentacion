# Facturas OCR - Sistema Local

Sistema 100% local para digitalizar tickets y facturas. Sube una foto desde el navegador o desde Telegram, extrae los datos con OCR y los guarda automaticamente en tu vault de Obsidian. Incluye dashboards web para visualizar el vault y controlar gastos mensuales.

**Sin APIs cloud. Sin costes. Todo en tu PC. Solo accesible desde localhost.**

---

## Arquitectura

```
                    +------------------+
                    |   Telegram Bot   |  <-- Fotos desde movil
                    |  /gastos command |      (solo entrada, no expone puertos)
                    +--------+---------+
                             |
  +---------------+    +-----v------+    +-------------------+
  | Frontend web  +--->| Node.js API+--->| Python OCR Server |
  | localhost:3000|    | puerto 3000|    | puerto 5555       |
  +---------------+    +-----+------+    +-------------------+
  | index.html    |          |           | EasyOCR + GPU     |
  | db.html       |          |           | OpenCV preproceso |
  | vault.html    |          |           | Regex extraccion  |
  | gastos.html   |          |           +-------------------+
  +---------------+    +-----v------+
                       | Obsidian   |
                       | Vault      |
                       | (markdown) |
                       +------------+
```

### Pipeline paso a paso

1. **Subes una foto** desde el navegador (drag & drop) o Telegram (como documento)
2. **Node.js** recibe la imagen y la envia al servidor OCR Python
3. **OpenCV preprocesa** la imagen:
   - Convierte a escala de grises
   - Aplica CLAHE (Contrast Limited Adaptive Histogram Equalization)
   - Elimina ruido (fastNlMeansDenoising)
   - Binariza con threshold adaptativo o Otsu
   - Genera 3 variantes con diferentes configuraciones de contraste
4. **EasyOCR** (con GPU si hay CUDA) lee cada variante de la imagen
5. **Fusion de detecciones**: agrupa resultados por posicion, elige la mejor lectura de cada zona
6. **Correccion OCR**: regex que arreglan errores tipicos (caracteres confundidos)
7. **Extraccion de datos**: regex especializados extraen NIF, fecha, importes, conceptos, forma de pago
8. **Validacion numerica**: verifica que total = subtotal + IVA, recalcula si no cuadra
9. **Genera markdown** con frontmatter YAML y tablas
10. **Guarda en Obsidian** automaticamente en `30 Documentos fuente/`

### Seguridad

- El servidor web **solo escucha en 127.0.0.1** (no accesible desde otros dispositivos)
- El bot de Telegram solo acepta mensajes de IDs autorizados
- El bot hace polling (no expone puertos, no necesita webhook)
- No se envian datos a ningun servicio externo

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
git clone https://github.com/andonyy/saas-documentacion.git "Saas documentacion"
cd "Saas documentacion"
```

### 2. Instalar Node.js

Instalar [fnm](https://github.com/Schniz/fnm) o descargar Node.js directamente:

```bash
fnm install 24
fnm use 24
node --version  # debe mostrar v24.x
```

### 3. Instalar dependencias Node.js

```bash
cd invoice-processor
npm install
```

Esto instala: express, multer, uuid, dotenv, sharp, node-telegram-bot-api

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

# IMPORTANTE: EasyOCR necesita NumPy < 2
pip install "numpy<2" --force-reinstall
```

### 6. Verificar que CUDA funciona

```bash
conda activate ocr
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

Debe mostrar `CUDA: True` si tienes GPU NVIDIA con drivers actualizados.

### 7. Configurar el archivo .env

Crear un archivo `.env` en `invoice-processor/`:

```env
PORT=3000
OBSIDIAN_VAULT_PATH=C:\Users\TU_USUARIO\ObsidianVault\30 Documentos fuente
TELEGRAM_BOT_TOKEN=tu_token_de_botfather
TELEGRAM_ALLOWED_USERS=tu_telegram_user_id
```

| Variable | Obligatorio | Descripcion |
|----------|-------------|-------------|
| `PORT` | No | Puerto del servidor web (defecto: 3000) |
| `OBSIDIAN_VAULT_PATH` | No | Ruta a la carpeta de documentos en Obsidian. Defecto: `~/ObsidianVault/30 Documentos fuente` |
| `TELEGRAM_BOT_TOKEN` | No | Token de @BotFather. Sin token, el bot no arranca (el resto funciona) |
| `TELEGRAM_ALLOWED_USERS` | No | IDs de Telegram separados por comas. Sin IDs, acepta a cualquiera |

### 8. Configurar el Vault de Obsidian

Crear la estructura de carpetas en tu vault:

```
ObsidianVault/
  +-- Dashboard.md
  +-- 00 Ideas a desarrollar/
  +-- 10 Proyectos activos/
  +-- 20 Conocimiento y criterios/
  +-- 30 Documentos fuente/        <-- aqui se guardan las facturas
  +-- 40 Personas y entidades/
  +-- 90 Proyectos archivados/
  +-- Templates/
```

El sistema genera automaticamente los archivos markdown en `30 Documentos fuente/`.

### 9. Configurar el bot de Telegram

1. Abrir Telegram y buscar `@BotFather`
2. Enviar `/newbot` y seguir las instrucciones (nombre y username del bot)
3. Copiar el token que te da BotFather
4. Pegarlo en `.env` como `TELEGRAM_BOT_TOKEN`
5. Arrancar el servidor y enviar `/start` a tu bot
6. El bot te responde con tu ID de usuario
7. Poner tu ID en `.env` como `TELEGRAM_ALLOWED_USERS`
8. Reiniciar el servidor

### 10. Configurar el launcher (.bat)

Edita `Facturas OCR.bat` y cambia las rutas de PYTHON y NODE a las de tu sistema:

```bat
set "PYTHON=C:\Users\TU_USUARIO\anaconda3\envs\ocr\python.exe"
set "NODE=C:\ruta\a\tu\node.exe"
```

Para encontrar las rutas:

```cmd
where python
where node
```

---

## Uso

### Opcion A: Doble clic (recomendado)

Ejecuta `Facturas OCR.bat` desde la carpeta `Saas documentacion`.

Arranca todo automaticamente (OCR Python + Node.js + Telegram bot) y abre el navegador.

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

### Opcion C: Telegram (desde el movil)

Envia una foto de un ticket al bot en Telegram. El bot procesa la imagen con OCR y guarda el resultado en Obsidian automaticamente.

**IMPORTANTE**: Enviar como **documento/archivo**, no como foto. Telegram comprime las fotos y el OCR falla. Como documento mantiene la calidad original.

En Telegram: clip adjuntar > Archivo > seleccionar la foto > enviar.

### Opcion D: Solo CLI (sin navegador)

```bash
conda activate ocr
python src/ocr_engine.py foto_ticket.jpg
```

Muestra el JSON extraido directamente en la terminal.

---

## Paginas web (localhost:3000)

| Pagina | URL | Descripcion |
|--------|-----|-------------|
| Subir factura | `/` (`index.html`) | Frontend para subir fotos con drag & drop |
| Base de datos | `/db.html` | Tabla con todas las facturas procesadas, busqueda y detalle |
| Visor Vault | `/vault.html` | Navegador del vault de Obsidian con arbol de carpetas, renderizado de notas, wikilinks clicables, backlinks y grafo de relaciones |
| Dashboard gastos | `/gastos.html` | KPIs de gasto mensual, grafico por mes, top establecimientos, detalle por mes |

Todas las paginas tienen navegacion entre si en la cabecera.

---

## Bot de Telegram

### Comandos

| Comando | Descripcion |
|---------|-------------|
| `/start` | Muestra bienvenida, comandos disponibles y tu ID de usuario |
| `/gastos` | Resumen de gastos: mes actual, mes anterior, comparativa, acumulado, ticket medio, top establecimientos |
| Enviar documento | Procesa el ticket con OCR y guarda en Obsidian |
| Enviar foto | Tambien funciona pero con menos calidad (Telegram comprime) |

### Flujo

```
Foto en Telegram --> Bot Node.js --> OCR Python --> Obsidian
                                                --> Respuesta con resumen al chat
```

### Seguridad

- Solo los usuarios en `TELEGRAM_ALLOWED_USERS` pueden usar el bot
- El bot usa polling (no webhook), no expone ningun puerto a internet
- Los archivos descargados se eliminan despues de procesarlos
- El servidor web solo escucha en 127.0.0.1 (localhost)

---

## Estructura del proyecto

```
Saas documentacion/
  |
  +-- Facturas OCR.bat              # Launcher: arranca todo con doble clic
  +-- Cerrar Facturas OCR.bat       # Para los servidores
  +-- Base de Datos Facturas.bat    # Abre el visor del vault en el navegador
  +-- README.md
  |
  +-- front/
  |     +-- index.html              # Frontend web (dark mode, drag & drop)
  |     +-- db.html                 # Base de datos de facturas
  |     +-- vault.html              # Visor del vault de Obsidian
  |     +-- gastos.html             # Dashboard de gastos mensuales
  |
  +-- invoice-processor/
  |     +-- .env                    # Config (rutas, tokens, IDs)
  |     +-- package.json
  |     |
  |     +-- src/
  |     |     +-- index.js          # Express server (solo localhost) + Telegram boot
  |     |     +-- ocr_engine.py     # Motor OCR Python (EasyOCR + OpenCV + regex)
  |     |     +-- ocr-server.py     # Micro-servicio OCR HTTP alternativo
  |     |     |
  |     |     +-- routes/
  |     |     |     +-- invoices.js # API REST para facturas
  |     |     |     +-- vault.js    # API REST para leer el vault de Obsidian
  |     |     |
  |     |     +-- services/
  |     |           +-- anthropic.js   # Puente Node -> Python OCR
  |     |           +-- markdown.js    # Generador markdown + sync Obsidian
  |     |           +-- telegram.js    # Bot Telegram (fotos + /gastos)
  |     |
  |     +-- src/output/             # Copias locales de los markdown
  |     +-- src/uploads/            # Imagenes temporales (se borran tras procesar)
```

---

## API REST

Todos los endpoints estan en `http://localhost:3000`

### Facturas

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
| `GET /health` | Estado | `{ "status": "ok" }` |

### Vault

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET /api/vault/tree` | Arbol de archivos | Estructura completa del vault con metadata |
| `GET /api/vault/note?path=ruta` | Leer nota | Contenido markdown de una nota |
| `GET /api/vault/graph` | Grafo | Nodos y links entre notas (wikilinks) |

---

## Motor OCR: como funciona

### Porque EasyOCR y no Tesseract

Tesseract falla con tickets termicos de bajo contraste. Lo probamos y el resultado era ilegible. EasyOCR usa redes neuronales (CRAFT + CRNN) que manejan mucho mejor el texto degradado.

### Porque no un LLM local

Probamos Qwen2.5-VL-7B. Resultado: alucino todos los datos. Los LLMs de 7B no son fiables para OCR. Los de 72B necesitan 48+ GB de RAM.

La combinacion EasyOCR + regex funciona mejor que cualquier LLM local en hardware consumer.

### Preprocesado con OpenCV

El motor genera **3 variantes** de cada imagen:

1. **CLAHE + threshold adaptativo**: Ecualiza contraste por bloques
2. **Contraste lineal alto + Otsu**: Estira niveles de gris agresivamente
3. **CLAHE fuerte + threshold fijo**: Mas agresivo, captura detalles sutiles

EasyOCR procesa las 3 y el motor fusiona resultados: elige la mejor deteccion por zona.

### Post-procesado con regex

- Corrige caracteres confundidos por el OCR
- Busca NIFs con patron `[A-Z]\d{8}`
- Extrae importes y verifica: `total = subtotal + IVA`
- Recalcula si no cuadra

---

## Formato de salida en Obsidian

Cada factura se guarda como markdown con frontmatter YAML:

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

El body contiene tablas markdown con emisor, conceptos, totales y forma de pago. Obsidian los indexa automaticamente.

---

## Limitaciones conocidas

- **Telegram fotos vs documentos**: Enviar siempre como documento/archivo, no como foto. Telegram comprime las fotos y el OCR falla.
- **Tickets muy desvanecidos**: Si el ticket es casi blanco, ningun OCR puede leerlo.
- **Fechas**: Es el campo mas dificil. Los digitos suelen estar en la zona mas tenue.
- **Algun digito del NIF**: El OCR puede confundir 0/9, 7/2. Los importes suelen leerse mejor.
- **GPU**: Sin GPU funciona igual pero 3-5x mas lento (30-60 seg vs 10-15 seg por ticket).

---

## Troubleshooting

### El .bat dice "Node.js no encontrado"

```cmd
where node
```

Edita `set "NODE=..."` en `Facturas OCR.bat` con la ruta correcta.

### CUDA no disponible

```bash
python -c "import torch; print(torch.cuda.is_available())"
```

Si `False`:
1. Verifica GPU: `nvidia-smi`
2. Reinstala PyTorch: `pip install torch --index-url https://download.pytorch.org/whl/cu124`
3. Sin GPU: edita `ocr_engine.py`, cambia `gpu=True` a `gpu=False`

### NumPy error de compatibilidad

```bash
pip install "numpy<2" opencv-python-headless --force-reinstall
```

### El OCR no arranca

```bash
conda activate ocr
python invoice-processor/src/ocr_engine.py --server
```

Errores comunes:
- `ModuleNotFoundError`: `pip install easyocr opencv-python-headless`
- `CUDA error`: cambia a `gpu=False`

### El bot de Telegram no recibe mensajes

1. Verificar token: el bot debe responder a `https://api.telegram.org/bot<TOKEN>/getMe`
2. Si revocaste el token en BotFather, actualizar `.env` y reiniciar
3. Solo un proceso puede hacer polling del mismo bot a la vez

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
| node-telegram-bot-api | 0.67 | Bot de Telegram |
| Obsidian | - | Vault de documentos |
| dotenv | 16.x | Variables de entorno |
| uuid | 11.x | Identificadores unicos |
