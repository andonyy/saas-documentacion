@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Facturas OCR - Iniciando...
color 0A

echo.
echo  ============================================
echo   FACTURAS OCR - Sistema Local
echo  ============================================
echo.

:: Rutas
set "PYTHON=C:\Users\andon\anaconda3\envs\ocr\python.exe"
set "NODE=C:\Users\andon\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\fnm\node-versions\v24.14.1\installation\node.exe"
set "PROJECT=%~dp0invoice-processor"
set "OCR_SCRIPT=%PROJECT%\src\ocr_engine.py"

echo  Verificando rutas...
if not exist "%PYTHON%" (
    echo  [ERROR] Python no encontrado
    pause & exit /b 1
)
echo    Python OK
if not exist "%NODE%" (
    echo  [ERROR] Node.js no encontrado
    pause & exit /b 1
)
echo    Node OK
echo.

:: Matar procesos previos
echo  [1/4] Limpiando procesos anteriores...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5555.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 /nobreak >nul

:: Arrancar OCR Python (GPU)
echo  [2/4] Arrancando OCR (EasyOCR + GPU)...
set "PYTHONIOENCODING=utf-8"
start /min "OCR-Server" cmd /c ""%PYTHON%" "%OCR_SCRIPT%" --server"

:: Esperar a que cargue EasyOCR (max 60 seg)
echo  [3/4] Cargando modelos OCR (puede tardar 15-30 seg)...
set /a count=0
:wait_ocr
timeout /t 3 /nobreak >nul
set /a count+=1

:: Intentar conectar al servidor OCR
curl -s -o nul -w "%%{http_code}" http://localhost:5555/ >"%TEMP%\ocr_check.txt" 2>nul
set /p HTTP_CODE=<"%TEMP%\ocr_check.txt"
if "%HTTP_CODE%"=="501" goto ocr_ready
if "%HTTP_CODE%"=="200" goto ocr_ready
if "%HTTP_CODE%"=="404" goto ocr_ready

if !count! GEQ 20 (
    echo.
    echo  [ERROR] OCR no arranco tras 60 segundos
    echo  Revisa si hay algun error en la ventana OCR-Server
    pause & exit /b 1
)
echo         Esperando... (!count!/20)
goto wait_ocr

:ocr_ready
echo         OCR listo.

:: Arrancar Node.js
echo  [4/4] Arrancando servidor web...
start /min "Node-Server" cmd /c "cd /d "%PROJECT%" && "%NODE%" src\index.js"

timeout /t 3 /nobreak >nul

:: Abrir navegador
echo.
echo  ============================================
echo   TODO LISTO
echo  ============================================
echo.
echo   http://localhost:3000
echo.

start "" http://localhost:3000

title Facturas OCR - Ejecutando
echo  Cierra esta ventana para parar todo.
echo.

:loop
timeout /t 5 /nobreak >nul
goto loop
