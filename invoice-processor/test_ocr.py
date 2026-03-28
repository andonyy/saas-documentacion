import os
import numpy as np
import cv2
import easyocr

print("Cargando EasyOCR...")
reader = easyocr.Reader(['es'], gpu=False)
print("Listo!")

img_path = os.path.join(os.environ['USERPROFILE'], 'OneDrive', 'Escritorio', 'IMG_20260326_121809 (2).jpg')
print(f"Leyendo: {img_path}")

with open(img_path, 'rb') as f:
    img_bytes = f.read()

nparr = np.frombuffer(img_bytes, np.uint8)
img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# CLAHE
clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
enhanced = clahe.apply(gray)

# Denoise
denoised = cv2.fastNlMeansDenoising(enhanced, h=10)

# Binarización adaptativa
binary = cv2.adaptiveThreshold(
    denoised, 255,
    cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv2.THRESH_BINARY,
    blockSize=15, C=8
)

# Sharpening
kernel = np.array([[-1,-1,-1],[-1,9,-1],[-1,-1,-1]])
sharpened = cv2.filter2D(binary, -1, kernel)

print("Ejecutando OCR...")
results = reader.readtext(sharpened, detail=1, paragraph=False, contrast_ths=0.05, adjust_contrast=0.7)

print(f"\n{len(results)} detecciones:")
print("=== TEXTO OCR ===")
for item in results:
    text = item[1]
    conf = item[2]
    print(f"  [{conf:.2f}] {text}")

full_text = '\n'.join([item[1] for item in sorted(results, key=lambda x: x[0][0][1])])
print("\n=== TEXTO COMPLETO ===")
print(full_text)
print("=== FIN ===")
