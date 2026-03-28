"""
Micro-servicio OCR local usando EasyOCR + OpenCV.
Optimizado para tickets térmicos de bajo contraste.
Puerto: 5555
"""

import sys
import json
import base64
import numpy as np
import cv2
import easyocr
from http.server import HTTPServer, BaseHTTPRequestHandler

# Inicializar EasyOCR con español (descarga modelos la primera vez)
print("Cargando EasyOCR (español)...")
reader = easyocr.Reader(['es'], gpu=True)
print("EasyOCR listo!")


def preprocess_receipt(img_bytes):
    """Preprocesado optimizado para tickets térmicos."""
    # Decodificar imagen
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError("No se pudo decodificar la imagen")

    # Convertir a escala de grises
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # CLAHE - Contrast Limited Adaptive Histogram Equalization
    # Ideal para tickets térmicos con contraste irregular
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # Denoising
    denoised = cv2.fastNlMeansDenoising(enhanced, h=10)

    # Binarización adaptativa (mejor que threshold fijo para tickets)
    binary = cv2.adaptiveThreshold(
        denoised, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=15,
        C=8
    )

    # Sharpening
    kernel = np.array([[-1, -1, -1],
                       [-1,  9, -1],
                       [-1, -1, -1]])
    sharpened = cv2.filter2D(binary, -1, kernel)

    return sharpened


class OCRHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/ocr':
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers['Content-Length'])
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
            img_bytes = base64.b64decode(data['image'])

            # Preprocesar imagen
            print("Preprocesando imagen...")
            processed = preprocess_receipt(img_bytes)

            # OCR con EasyOCR - doble pasada para bajo contraste
            print("Ejecutando EasyOCR...")
            results = reader.readtext(
                processed,
                detail=1,
                paragraph=False,
                contrast_ths=0.05,      # umbral bajo para capturar texto tenue
                adjust_contrast=0.7,    # ajuste de contraste automático
                width_ths=0.7,          # agrupar texto cercano
            )

            # Extraer texto ordenado por posición vertical
            lines = []
            for item in results:
                bbox = item[0]
                text = item[1]
                conf = item[2] if len(item) > 2 else 0.0
                # bbox es [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
                y_pos = bbox[0][1]
                lines.append({
                    'text': text,
                    'confidence': round(float(conf), 3),
                    'y': float(y_pos)
                })

            # Ordenar por posición vertical
            lines.sort(key=lambda x: x['y'])
            full_text = '\n'.join([l['text'] for l in lines])

            print(f"OCR completado: {len(lines)} líneas detectadas")
            print("--- Texto ---")
            print(full_text)
            print("--- Fin ---")

            response = {
                'text': full_text,
                'lines': lines,
                'line_count': len(lines)
            }

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))

        except Exception as e:
            print(f"Error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def log_message(self, format, *args):
        print(f"[OCR Server] {args[0]}")


if __name__ == '__main__':
    port = 5555
    server = HTTPServer(('127.0.0.1', port), OCRHandler)
    print(f"OCR Server escuchando en http://localhost:{port}")
    server.serve_forever()
