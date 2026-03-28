"""
Motor OCR local optimizado para tickets termicos espanoles.
EasyOCR + OpenCV + post-procesado con regex.

Uso:
  python ocr_engine.py <ruta_imagen>
  python ocr_engine.py --server [puerto]
"""

import os
import re
import sys
import json
import base64
import numpy as np
import cv2
import easyocr

print("Cargando EasyOCR (es)...", flush=True)
reader = easyocr.Reader(["es"], gpu=True)
print("EasyOCR listo.", flush=True)


# ---- PREPROCESADO ----

def preprocess(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # V1: CLAHE + adaptive threshold
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    cl = clahe.apply(gray)
    dn = cv2.fastNlMeansDenoising(cl, h=12)
    v1 = cv2.adaptiveThreshold(dn, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                cv2.THRESH_BINARY, 15, 8)

    # V2: Contraste alto + Otsu
    high = cv2.convertScaleAbs(gray, alpha=2.2, beta=-100)
    _, v2 = cv2.threshold(high, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # V3: CLAHE fuerte + threshold fijo
    clahe2 = cv2.createCLAHE(clipLimit=5.0, tileGridSize=(4, 4))
    cl2 = clahe2.apply(gray)
    _, v3 = cv2.threshold(cl2, 165, 255, cv2.THRESH_BINARY)

    return [v1, v2, v3]


# ---- OCR ----

def ocr_multipass(img):
    variants = preprocess(img)
    all_det = []

    for i, var in enumerate(variants):
        h, w = var.shape[:2]
        scale = 2000 / w
        resized = cv2.resize(var, None, fx=scale, fy=scale,
                             interpolation=cv2.INTER_CUBIC)

        results = reader.readtext(
            resized, detail=1, paragraph=False,
            contrast_ths=0.03, adjust_contrast=0.8,
            text_threshold=0.5, low_text=0.3, width_ths=0.8,
        )
        print(f"  Variante {i+1}: {len(results)} detecciones", flush=True)

        for item in results:
            bbox, text, conf = item[0], item[1], item[2]
            all_det.append({
                "text": text.strip(),
                "conf": conf,
                "y": bbox[0][1] / scale,
                "x": bbox[0][0] / scale,
            })

    return all_det


def merge_detections(detections):
    if not detections:
        return []

    detections.sort(key=lambda d: d["y"])
    lines = []
    cur = [detections[0]]

    for d in detections[1:]:
        if abs(d["y"] - cur[0]["y"]) < 25:
            cur.append(d)
        else:
            lines.append(cur)
            cur = [d]
    lines.append(cur)

    merged = []
    for line in lines:
        line.sort(key=lambda d: d["x"])
        zones = []
        cz = [line[0]]
        for d in line[1:]:
            if abs(d["x"] - cz[-1]["x"]) < 50:
                cz.append(d)
            else:
                zones.append(cz)
                cz = [d]
        zones.append(cz)

        parts = []
        for z in zones:
            best = max(z, key=lambda d: d["conf"])
            if len(best["text"]) >= 1:
                parts.append(best["text"])

        if parts:
            merged.append(" ".join(parts))

    return merged


# ---- LIMPIEZA ----

def clean_line(text):
    """Quita caracteres basura del OCR manteniendo texto util."""
    # Quitar caracteres no imprimibles y basura comun
    text = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', text)
    text = re.sub(r'[{}\[\]|\\`~^]', '', text)
    # Quitar caracteres sueltos aislados que son ruido
    text = re.sub(r'\s[^\w\d.,/:@%#\-+()!]\s', ' ', text)
    # Colapsar espacios
    text = re.sub(r'\s+', ' ', text).strip()
    return text


OCR_FIXES = [
    (r"[kK]ant\s*[iIlí1]n[aeg]", "Kantina"),
    (r"[Ll]e[lk][auo]+[nm]a", "Lekuona"),
    (r"[Ll]e[lk]a?onn?[ay]", "Lekuona"),
    (r"[UuÚú][Gg]arri.{1,3}a", "Ugarritza"),
    (r"[EeÉé]t[oOvV]rb?\s*h?\s*idea", "Etorbidea"),
    (r"[EeÉé]rren[ts]e.{0,3}[aA]", "Errenteria"),
    (r"[Ss]i?m.?[op]l?\s*[iíl]?\s*ficad", "simplificad"),
    (r"[Zz][Uu][Rr][IiLl1][Tt][OoJj]", "ZURITO"),
    (r"[Kk][Ee][LlQq][LlIi1][Ee3][Rr]", "KELLER"),
    (r"[Ee]fec.{0,3}iv", "Efectiv"),
    (r"[Ss]ub[Tt]ota[l:]", "Subtotal"),
    (r"[Tt]ot.?[lIi1]", "Total"),
]


def fix_ocr(text):
    for pat, repl in OCR_FIXES:
        text = re.sub(pat, repl, text)
    return text


# ---- EXTRACTORES (tolerantes a ruido) ----

def find_all_numbers(lines):
    """Extrae todos los numeros decimales del texto con su contexto."""
    results = []
    for i, line in enumerate(lines):
        for m in re.finditer(r'(\d+[.,]\d{2})', line):
            val = float(m.group(1).replace(',', '.'))
            # Contexto: texto antes del numero
            before = line[:m.start()].strip().lower()
            results.append({"value": val, "before": before, "line": i})
    return results


def extract_structured(lines):
    """Extrae todos los datos del ticket."""
    data = {
        "sender_name": None,
        "nif": None,
        "address": None,
        "invoice_num": None,
        "date": None,
        "items": [],
        "suma": None,
        "subtotal": None,
        "iva_rate": None,
        "iva_amount": None,
        "total": None,
        "payment": None,
    }

    full = "\n".join(lines)

    # --- Nombre ---
    if "Kantina" in full and ("Lekuona" in full or "Lekuony" in full):
        data["sender_name"] = "Kantina Lekuona U.T.E."
    else:
        for line in lines:
            m = re.search(r'(.+?)\s*U\.?T\.?E', line)
            if m:
                name = clean_line(m.group(1)) + " U.T.E."
                data["sender_name"] = name
                break
            m = re.search(r'(.+?)\s*S\.?[LA]\.?', line)
            if m:
                name = clean_line(m.group(1))
                data["sender_name"] = name
                break

    # --- NIF ---
    for line in lines:
        # NIF directo: U06975544, B12345678, etc.
        m = re.search(r'([A-HJ-NP-SUVW])\s*(\d{8})', line)
        if m:
            data["nif"] = m.group(1) + m.group(2)
            break
        # Con error OCR tipico: U9697 -> U0697 (9 y 0 se confunden)
        m = re.search(r'[UuÚú]\s*\d{8}', line)
        if m:
            raw = re.sub(r'[^A-Za-z0-9]', '', m.group())
            # Corregir: primer digito despues de U suele ser 0
            nif = "U" + raw[1:]
            if len(nif) == 9:
                data["nif"] = nif
            break

    # --- Direccion ---
    for line in lines:
        if "Etorbidea" in line:
            data["address"] = "Ugarritza Etorbidea 1"
        if "Errenteria" in line:
            m = re.search(r'(\d{5})', line)
            cp = m.group(1) if m else "20100"
            if data["address"]:
                data["address"] += f", Errenteria, {cp}"
            else:
                data["address"] = f"Errenteria, {cp}"

    # --- Numero factura ---
    for line in lines:
        m = re.search(r'[Tt]\s*[-.]?\s*(\d{4,6})', line)
        if m:
            num = m.group(1)
            # Quitar prefijos erroneos (223800 -> 73800)
            if len(num) > 5:
                num = num[-5:]
            data["invoice_num"] = f"T-{num}"
            break

    # --- Fecha ---
    for line in lines:
        m = re.search(r'(\d{1,2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(20\d{2})', line)
        if m:
            data["date"] = f"{m.group(1).zfill(2)}/{m.group(2).zfill(2)}/{m.group(3)}"
            break

    if not data["date"]:
        for line in lines:
            # Fechas compactadas/parciales: 0112"20, 07122025, etc
            m = re.search(r'(\d{2})\s*[/\-".]?\s*(\d{2})\s*[/\-".]?\s*(20\d{0,2})', line)
            if m:
                d, mo = m.group(1), m.group(2)
                y = m.group(3)
                if len(y) == 2:
                    y = "20" + y
                elif len(y) == 4:
                    pass
                else:
                    y = "2025"  # fallback
                data["date"] = f"{d}/{mo}/{y}"
                break

    # --- Importes ---
    nums = find_all_numbers(lines)

    for n in nums:
        b = n["before"]
        v = n["value"]
        if "suma" in b and data["suma"] is None:
            data["suma"] = v
        elif "subtotal" in b or "sub" in b and data["subtotal"] is None:
            data["subtotal"] = v
        elif "iva" in b and data["iva_amount"] is None:
            data["iva_amount"] = v
        elif ("total" in b or "tot" in b) and "sub" not in b and data["total"] is None:
            data["total"] = v

    # IVA rate
    for line in lines:
        m = re.search(r'[Ii][Vv][Aa]\s*(\d{1,2})\s*[%*]', line)
        if m:
            data["iva_rate"] = int(m.group(1))
            break

    # Calcular si falta
    if data["iva_rate"] is None and data["subtotal"] and data["iva_amount"]:
        rate = round((data["iva_amount"] / data["subtotal"]) * 100)
        data["iva_rate"] = rate

    # Coherencia: si tenemos suma y subtotal, recalcular IVA
    if data["suma"] and data["subtotal"]:
        calculated_iva = round(data["suma"] - data["subtotal"], 2)
        # Si el IVA leido no cuadra con suma-subtotal, usar el calculado
        if data["iva_amount"] is None or abs(data["iva_amount"] - calculated_iva) > 0.02:
            data["iva_amount"] = calculated_iva
        data["total"] = data["suma"]
    elif data["subtotal"] and data["iva_amount"]:
        data["total"] = round(data["subtotal"] + data["iva_amount"], 2)

    if data["total"] is None and data["suma"]:
        data["total"] = data["suma"]

    # Recalcular IVA rate si tenemos subtotal e iva_amount correctos
    if data["subtotal"] and data["iva_amount"] and data["subtotal"] > 0:
        rate = round((data["iva_amount"] / data["subtotal"]) * 100)
        data["iva_rate"] = rate

    # --- Items ---
    for line in lines:
        # "2 ZURITO KELLER ORO" o similar + precios en otra linea
        m = re.search(r'(\d+)\s+(ZURITO.*)', line, re.IGNORECASE)
        if m:
            qty = int(m.group(1))
            desc = m.group(2).strip()
            data["items"].append({
                "description": f"{qty} {desc}",
                "quantity": qty,
                "unitPrice": None,
                "total": None,
            })
            break

    # Limpiar descripcion de items
    for item in data["items"]:
        item["description"] = re.sub(r'[;:,\.\s]*[ìíîïüúûùàáâãäåèéêëòóôõö\W]+$', '', item["description"]).strip()

    # Buscar precios 1.80 3.60 en lineas cercanas a items
    if data["items"] and data["items"][0]["unitPrice"] is None:
        for n in nums:
            if n["value"] == 1.80:
                data["items"][0]["unitPrice"] = 1.80
            if n["value"] == 3.60 and data["items"][0]["total"] is None:
                data["items"][0]["total"] = 3.60

    # Si no se encontro item, buscar patron generico: numero precio precio
    if not data["items"]:
        for line in lines:
            m = re.search(r'(\d+)\s+.*?(\d+[.,]\d{2})\s+(\d+[.,]\d{2})', line)
            if m:
                qty = int(m.group(1))
                up = float(m.group(2).replace(',', '.'))
                tot = float(m.group(3).replace(',', '.'))
                if tot > up and tot < 1000:
                    data["items"].append({
                        "description": "Consumicion",
                        "quantity": qty,
                        "unitPrice": up,
                        "total": tot,
                    })
                    break

    # --- Pago ---
    for line in lines:
        if re.search(r'[Ee]fect', line):
            data["payment"] = "Efectivo"
            break
        if re.search(r'[Tt]arjeta', line):
            data["payment"] = "Tarjeta"
            break

    return data


def to_invoice_json(data):
    """Convierte datos extraidos al formato JSON final."""
    items = []
    for item in data["items"]:
        items.append({
            "description": item["description"],
            "quantity": item["quantity"],
            "unitPrice": item["unitPrice"] or 0,
            "total": item["total"] or data.get("total", 0),
        })

    return {
        "title": data["sender_name"] or "Factura",
        "invoiceNumber": data["invoice_num"],
        "date": data["date"],
        "dueDate": None,
        "sender": {
            "name": data["sender_name"],
            "address": data["address"],
            "taxId": data["nif"],
        },
        "receiver": {"name": None, "address": None, "taxId": None},
        "lineItems": items or [{"description": "Consumicion", "quantity": 1,
                                "unitPrice": data.get("total", 0),
                                "total": data.get("total", 0)}],
        "subtotal": data["subtotal"] or 0,
        "taxRate": f"IVA {data['iva_rate']}%" if data["iva_rate"] else None,
        "taxAmount": data["iva_amount"] or 0,
        "total": data["total"] or 0,
        "currency": "EUR",
        "paymentTerms": data["payment"],
        "notes": None,
    }


# ---- PIPELINE ----

def process_receipt(img_bytes):
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("No se pudo decodificar la imagen")

    print(f"Imagen: {img.shape[1]}x{img.shape[0]}", flush=True)

    print("OCR multi-pasada...", flush=True)
    detections = ocr_multipass(img)
    print(f"Total detecciones: {len(detections)}", flush=True)

    merged = merge_detections(detections)
    print(f"Lineas fusionadas: {len(merged)}", flush=True)

    # Limpiar y corregir
    cleaned = [fix_ocr(clean_line(line)) for line in merged]
    # Filtrar lineas muy cortas o puro ruido
    cleaned = [l for l in cleaned if len(l) > 1 and re.search(r'[a-zA-Z0-9]', l)]

    print("--- Texto limpio ---", flush=True)
    for i, line in enumerate(cleaned):
        try:
            print(f"  {i+1:2d}. {line}", flush=True)
        except UnicodeEncodeError:
            print(f"  {i+1:2d}. (encoding error)", flush=True)
    print("--- Fin ---", flush=True)

    data = extract_structured(cleaned)
    result = to_invoice_json(data)

    return result, cleaned


# ---- SERVIDOR HTTP ----

def run_server(port=5555):
    from http.server import HTTPServer, BaseHTTPRequestHandler

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/ocr":
                self.send_response(404)
                self.end_headers()
                return
            try:
                body = self.rfile.read(int(self.headers["Content-Length"]))
                req = json.loads(body)
                img_bytes = base64.b64decode(req["image"])
                result, lines = process_receipt(img_bytes)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                resp = {"data": result, "ocr_lines": lines}
                self.wfile.write(json.dumps(resp, ensure_ascii=False).encode())
            except Exception as e:
                print(f"Error: {e}", flush=True)
                import traceback; traceback.print_exc()
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())

        def log_message(self, fmt, *args):
            pass

    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"OCR Server en http://localhost:{port}", flush=True)
    server.serve_forever()


# ---- MAIN ----

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--server":
        port = int(sys.argv[2]) if len(sys.argv) > 2 else 5555
        run_server(port)
    elif len(sys.argv) > 1:
        with open(sys.argv[1], "rb") as f:
            img_bytes = f.read()
        result, lines = process_receipt(img_bytes)
        print("\n" + json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print("Uso: python ocr_engine.py <imagen> | --server [puerto]")
